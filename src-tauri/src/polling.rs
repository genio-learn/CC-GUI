//! Background polling loops mirroring the TUI's orchestration: PR status
//! checks (persisted to the shared state store) and auto-pull of project main
//! branches (blocked reasons surfaced on project headers).

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use claude_commander::git::{
    check_pr_for_branch, is_gh_available, run_project_pull, PrCheckResult, PullOutcome,
};
use claude_commander::session::apply_assignment;
use futures::StreamExt;

use crate::service::service;

/// Cap concurrent `gh` fan-outs (each holds 3+ pipe FDs; macOS defaults to a
/// 256-FD limit under launchd). Mirrors the TUI's PR_FANOUT_CONCURRENCY.
const PR_FANOUT_CONCURRENCY: usize = 8;
const PULL_FANOUT_CONCURRENCY: usize = 4;

/// Blocked reason per project id, read by `build_groups` for header badges.
pub static PULL_BLOCKED: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn spawn_polling_loops() {
    spawn_pr_loop();
    spawn_project_pull_loop();
}

/// Every `pr_check_interval_secs`: check the PR for each session's branch via
/// `gh`, and persist the result exactly the way the TUI does (including
/// clearing on authoritative not-found, preserving on transient failure, and
/// re-running section assignment).
fn spawn_pr_loop() {
    tauri::async_runtime::spawn(async move {
        // Startup grace so launch doesn't immediately fan out `gh` calls.
        tokio::time::sleep(Duration::from_secs(5)).await;
        if !is_gh_available().await {
            tracing::info!("gh not available; PR polling disabled");
            return;
        }
        loop {
            let interval = match service().await {
                Ok(svc) => {
                    poll_prs_once(svc).await;
                    svc.read_config().pr_check_interval_secs.max(30)
                }
                Err(_) => 120,
            };
            tokio::time::sleep(Duration::from_secs(interval)).await;
        }
    });
}

async fn poll_prs_once(svc: &claude_commander::api::CommanderService) {
    let sessions: Vec<(claude_commander::session::SessionId, String, std::path::PathBuf)> = {
        let state = svc.store().read().await;
        state
            .sessions
            .values()
            .filter(|s| s.status != claude_commander::session::SessionStatus::Creating)
            .filter_map(|s| {
                let project = state.projects.get(&s.project_id)?;
                Some((s.id, s.branch.clone(), project.repo_path.clone()))
            })
            .collect()
    };
    if sessions.is_empty() {
        return;
    }

    let results: Vec<_> = futures::stream::iter(sessions.into_iter().map(
        |(session_id, branch, repo_path)| async move {
            let result = check_pr_for_branch(&repo_path, &branch).await;
            (session_id, result)
        },
    ))
    .buffer_unordered(PR_FANOUT_CONCURRENCY)
    .collect()
    .await;

    let sections = svc.read_config().sections;
    let now = chrono::Utc::now();
    let _ = svc
        .store()
        .mutate(move |state| {
            for (session_id, result) in &results {
                let Some(session) = state.get_session_mut(session_id) else {
                    continue;
                };
                match result {
                    PrCheckResult::Found(info) => {
                        session.pr_number = Some(info.number);
                        session.pr_url = Some(info.url.clone());
                        session.pr_state = Some(info.state);
                        session.pr_draft = info.is_draft;
                        session.pr_labels = info.labels.clone();
                        session.pr_merged = info.merged();
                        session.review_decision = info.review_decision;
                        session.pr_reviewers = info.reviewers.clone();
                        session.pr_base_branch = info.base_ref_name.clone();
                    }
                    PrCheckResult::NotFound => {
                        // Authoritative "no PR" — clear cached fields.
                        session.pr_number = None;
                        session.pr_url = None;
                        session.pr_state = None;
                        session.pr_draft = false;
                        session.pr_labels.clear();
                        session.pr_merged = false;
                        session.review_decision = None;
                        session.pr_reviewers.clear();
                        session.pr_base_branch = None;
                    }
                    PrCheckResult::FetchFailed => {
                        // Transient (network/auth) — keep cached state.
                    }
                }
            }
            for session in state.sessions.values_mut() {
                apply_assignment(session, &sections, now);
            }
        })
        .await;

    // Refresh tmux status bars with the new PR info (running sessions only),
    // mirroring the TUI. Snapshot under the lock, then do async tmux I/O.
    let updates: Vec<_> = {
        let state = svc.store().read().await;
        state
            .sessions
            .values()
            .filter(|s| s.status == claude_commander::session::SessionStatus::Running)
            .map(|s| {
                (
                    s.tmux_session_name.clone(),
                    svc.status_bar_info(s, &state),
                )
            })
            .collect()
    };
    for (tmux_name, info) in &updates {
        svc.session_manager()
            .tmux
            .configure_status_bar(tmux_name, info)
            .await;
    }
}

/// Every minute, sweep projects and fast-forward main branches that are due
/// (per `project_pull_interval_secs`). Blocked reasons land in `PULL_BLOCKED`.
fn spawn_project_pull_loop() {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(10)).await;
        let mut last_pull: HashMap<String, std::time::Instant> = HashMap::new();
        loop {
            if let Ok(svc) = service().await {
                let interval = Duration::from_secs(svc.read_config().project_pull_interval_secs);
                let projects: Vec<(String, std::path::PathBuf, String)> = {
                    let state = svc.store().read().await;
                    state
                        .projects
                        .values()
                        .map(|p| {
                            (
                                p.id.to_string(),
                                p.repo_path.clone(),
                                p.main_branch.clone(),
                            )
                        })
                        .collect()
                };
                let due: Vec<_> = projects
                    .into_iter()
                    .filter(|(id, _, _)| {
                        last_pull
                            .get(id)
                            .is_none_or(|t| t.elapsed() >= interval)
                    })
                    .collect();
                let outcomes: Vec<(String, PullOutcome)> = futures::stream::iter(
                    due.into_iter().map(|(id, path, main)| async move {
                        let outcome = run_project_pull(&path, &main).await;
                        (id, outcome)
                    }),
                )
                .buffer_unordered(PULL_FANOUT_CONCURRENCY)
                .collect()
                .await;
                for (id, outcome) in outcomes {
                    last_pull.insert(id.clone(), std::time::Instant::now());
                    let mut blocked = PULL_BLOCKED.lock().unwrap();
                    match outcome {
                        PullOutcome::Advanced | PullOutcome::UpToDate => {
                            blocked.remove(&id);
                        }
                        PullOutcome::Blocked(reason) => {
                            blocked.insert(id, reason.as_str().to_string());
                        }
                        // A fetch failure says nothing new — keep prior state.
                        PullOutcome::SoftFail => {}
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    });
}
