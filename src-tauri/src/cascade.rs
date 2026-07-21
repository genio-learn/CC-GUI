//! Cascade-merge / push-stack commands. Each returns a short human-readable
//! summary string for the frontend to toast.

use std::collections::BTreeMap;
use std::time::Duration;

use claude_commander::api::CommanderService;
use claude_commander::session::{AgentState, CascadeOutcome, SessionId};
use claude_commander::tmux::AgentStateDetector;

use crate::service::{parse_session_id, with_service};

/// Fresh agent states for the manager's working-agent pre-flight checks.
/// `detect_all` derives each session's harness from its program and reports
/// `Unknown` for unrecognised ones, so no program filter is needed here.
async fn detect_states(svc: &CommanderService) -> BTreeMap<SessionId, AgentState> {
    let sessions: Vec<(SessionId, String, String)> = {
        let state = svc.store().read().await;
        state
            .sessions
            .values()
            .filter(|s| s.status.is_active())
            .map(|s| (s.id, s.tmux_session_name.clone(), s.program.clone()))
            .collect()
    };
    let mut detector = AgentStateDetector::new(svc.session_manager().tmux.clone(), Duration::ZERO);
    detector.detect_all(&sessions).await
}

fn describe(outcome: CascadeOutcome) -> String {
    match outcome {
        CascadeOutcome::Complete { sessions_merged } => {
            format!("Cascade complete: {sessions_merged} session(s) merged")
        }
        CascadeOutcome::PausedOnConflict {
            at,
            sessions_merged,
        } => format!(
            "Cascade paused on a merge conflict at {at} after {sessions_merged} merge(s). \
             Resolve the conflict in that worktree, then run Resume cascade."
        ),
    }
}

#[tauri::command]
pub async fn cascade_merge(id: String) -> Result<String, String> {
    let id = parse_session_id(&id)?;
    with_service(move |svc| async move {
        let states = detect_states(svc).await;
        svc.session_manager()
            .cascade_merge_stack(&id, &states)
            .await
            .map(describe)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn cascade_resume() -> Result<String, String> {
    with_service(move |svc| async move {
        let states = detect_states(svc).await;
        svc.session_manager()
            .cascade_resume(&states)
            .await
            .map(describe)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn cascade_abandon() -> Result<(), String> {
    with_service(move |svc| async move { svc.cascade_abandon().await.map_err(|e| e.to_string()) })
        .await
}

#[tauri::command]
pub async fn push_stack(id: String) -> Result<String, String> {
    let id = parse_session_id(&id)?;
    with_service(move |svc| async move {
        let states = detect_states(svc).await;
        svc.session_manager()
            .push_stack(&id, &states)
            .await
            .map(|o| format!("Pushed {} session branch(es)", o.sessions_pushed))
            .map_err(|e| e.to_string())
    })
    .await
}
