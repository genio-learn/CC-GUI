//! Session lifecycle, detail, and AI-summary commands.

use std::path::PathBuf;

use claude_commander_core::api::CreateSessionOpts;

use crate::service::{parse_session_id, service, with_service};

/// Detail for one session: full `SessionInfo` (flattened) + agent state,
/// diff stat, and pane preview. `lines` caps the pane capture.
#[tauri::command]
pub async fn get_session_detail(
    id: String,
    lines: Option<usize>,
) -> Result<Option<claude_commander_core::api::SessionDetail>, String> {
    // The service resolves sessions by title or *display* id — the 8-char
    // prefix (`SessionId::to_string`). A full 36-char uuid never matches, so
    // validate it here and query with the display form.
    let query = parse_session_id(&id)?.to_string();
    with_service(move |svc| async move {
        svc.get_session_detail(&query, lines)
            .await
            .map_err(|e| e.to_string())
    })
    .await
}

/// Generate an AI summary of the branch (committed vs main + uncommitted),
/// piped through the Claude CLI with the model from claude-commander config.
/// Slow (up to 60s); the frontend caches results per session.
#[tauri::command]
pub async fn generate_summary(id: String) -> Result<String, String> {
    let sid = parse_session_id(&id)?;
    let svc = service().await?;
    let config = svc.read_config();
    if !config.ai_summary_enabled {
        return Err("AI summaries are disabled in claude-commander config".into());
    }
    let info = {
        let state = svc.store().read().await;
        state.sessions.get(&sid).and_then(|s| {
            let project = state.projects.get(&s.project_id)?;
            Some((s.worktree_path.clone(), project.main_branch.clone()))
        })
    };
    let Some((worktree_path, main_branch)) = info else {
        return Err("session not found".into());
    };
    let diff = claude_commander_core::git::compute_branch_diff(&worktree_path, &main_branch).await;
    claude_commander_core::git::fetch_branch_summary(&diff, &config.ai_summary_model).await
}

#[tauri::command]
pub async fn create_session(project_path: String, title: String) -> Result<String, String> {
    with_service(move |svc| async move {
        let opts = CreateSessionOpts {
            project_path: PathBuf::from(project_path),
            title,
            program: None,
            initial_prompt: None,
            effort: None,
            mode: None,
            model: None,
            base_branch: None,
            section: None,
        };
        let id = svc.create_session(opts).await.map_err(|e| e.to_string())?;
        Ok(id.as_uuid().to_string())
    })
    .await
}

#[tauri::command]
pub async fn kill_session(id: String) -> Result<(), String> {
    let id = parse_session_id(&id)?;
    with_service(move |svc| async move { svc.kill_session(&id).await.map_err(|e| e.to_string()) })
        .await
}

#[tauri::command]
pub async fn restart_session(id: String) -> Result<(), String> {
    let id = parse_session_id(&id)?;
    with_service(
        move |svc| async move { svc.restart_session(&id).await.map_err(|e| e.to_string()) },
    )
    .await
}

#[tauri::command]
pub async fn delete_session(id: String) -> Result<(), String> {
    let id = parse_session_id(&id)?;
    with_service(move |svc| async move { svc.delete_session(&id).await.map_err(|e| e.to_string()) })
        .await
}

/// Rename a session (title only — branch and tmux session are untouched),
/// mirroring the TUI's rename action.
#[tauri::command]
pub async fn rename_session(id: String, title: String) -> Result<(), String> {
    let id = parse_session_id(&id)?;
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("session name cannot be empty".into());
    }
    let svc = service().await?;
    svc.store()
        .mutate(move |state| {
            if let Some(session) = state.get_session_mut(&id) {
                session.title = title;
            }
        })
        .await
        .map_err(|e| e.to_string())
}

/// Sessions whose PR has merged on GitHub: id + branch, for the bulk-delete
/// confirmation. Deletion itself reuses `delete_session` per id.
#[tauri::command]
pub async fn merged_pr_sessions() -> Result<Vec<(String, String)>, String> {
    let svc = service().await?;
    let state = svc.store().read().await;
    Ok(state
        .sessions
        .values()
        .filter(|s| s.pr_is_merged())
        .map(|s| (s.id.as_uuid().to_string(), s.branch.clone()))
        .collect())
}

/// Ensure a session's tmux session is alive before attaching, mirroring the
/// TUI: a stopped session (or dead pane) is transparently recreated, with
/// `--resume` if configured.
#[tauri::command]
pub async fn prepare_attach(id: String) -> Result<(), String> {
    let id = parse_session_id(&id)?;
    with_service(move |svc| async move {
        svc.session_manager()
            .get_attach_command(&id)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())?;
        // Attaching clears the unread flag, mirroring the TUI.
        let _ = svc
            .store()
            .mutate(move |state| {
                if let Some(s) = state.get_session_mut(&id) {
                    s.unread = false;
                }
            })
            .await;
        Ok(())
    })
    .await
}

/// Restart a crashed session fresh by tmux name (used by the frontend's
/// auto-restart-on-end path, mirroring the TUI's crash-loop handling).
#[tauri::command]
pub async fn restart_fresh(tmux_session: String) -> Result<(), String> {
    with_service(move |svc| async move {
        svc.session_manager()
            .restart_session_fresh_by_tmux_name(&tmux_session)
            .await
            .map_err(|e| e.to_string())
    })
    .await
}

/// Ensure the per-worktree shell tmux session exists and return its tmux
/// session name for the frontend to attach a terminal to.
#[tauri::command]
pub async fn prepare_shell(id: String) -> Result<String, String> {
    let id = parse_session_id(&id)?;
    with_service(move |svc| async move {
        svc.session_manager()
            .ensure_shell_session(&id)
            .await
            .map_err(|e| e.to_string())
    })
    .await
}
