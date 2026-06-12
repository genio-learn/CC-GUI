//! Project management, editor/browser opening, and project shells.

use std::path::PathBuf;

use serde::Serialize;

use crate::service::{parse_project_id, parse_session_id, service, with_service};

#[tauri::command]
pub async fn add_project(path: String) -> Result<String, String> {
    with_service(move |svc| async move {
        svc.add_project(PathBuf::from(path))
            .await
            .map(|id| id.to_string())
            .map_err(|e| e.to_string())
    })
    .await
}

#[derive(Serialize)]
pub struct ScanOutcome {
    added: usize,
    skipped: usize,
}

/// Scan a directory tree for git repos and add them all as projects.
#[tauri::command]
pub async fn scan_directory(path: String) -> Result<ScanOutcome, String> {
    let dir = PathBuf::from(shellexpand_tilde(&path));
    if !dir.is_dir() {
        return Err(format!("not a directory: {}", dir.display()));
    }
    with_service(move |svc| async move {
        svc.session_manager()
            .scan_directory(&dir)
            .await
            .map(|r| ScanOutcome {
                added: r.added,
                skipped: r.skipped,
            })
            .map_err(|e| e.to_string())
    })
    .await
}

/// Remove a project and all its sessions (kills tmux sessions, removes
/// worktrees).
#[tauri::command]
pub async fn remove_project(id: String) -> Result<(), String> {
    let id = parse_project_id(&id)?;
    with_service(move |svc| async move {
        svc.session_manager()
            .remove_project(&id)
            .await
            .map_err(|e| e.to_string())
    })
    .await
}

/// Ensure the project-level shell tmux session exists and return its name.
#[tauri::command]
pub async fn prepare_project_shell(id: String) -> Result<String, String> {
    let id = parse_project_id(&id)?;
    with_service(move |svc| async move {
        svc.session_manager()
            .ensure_project_shell_session(&id)
            .await
            .map_err(|e| e.to_string())
    })
    .await
}

/// Open a session's worktree in the configured editor (config → $VISUAL →
/// $EDITOR). Terminal editors can't be hosted here, so anything not known to
/// be a GUI editor falls back to the platform opener (Finder/Files).
#[tauri::command]
pub async fn open_in_editor(id: String) -> Result<(), String> {
    let sid = parse_session_id(&id)?;
    let svc = service().await?;
    let worktree = {
        let state = svc.store().read().await;
        state
            .sessions
            .get(&sid)
            .map(|s| s.worktree_path.clone())
            .ok_or("session not found")?
    };
    let config = svc.read_config();
    let editor = config.resolve_editor();
    let use_editor = editor
        .as_deref()
        .map(|e| config.is_gui_editor(e))
        .unwrap_or(false);
    if use_editor {
        let editor = editor.unwrap();
        // The editor config value may carry args (e.g. "code -n").
        let mut parts = editor.split_whitespace();
        let cmd = parts.next().ok_or("empty editor command")?;
        std::process::Command::new(cmd)
            .args(parts)
            .arg(&worktree)
            .spawn()
            .map_err(|e| format!("failed to launch {editor}: {e}"))?;
    } else {
        open_with_platform_opener(worktree.to_string_lossy().as_ref())?;
    }
    Ok(())
}

/// Open a URL (or path) with the platform opener.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    open_with_platform_opener(&url)
}

fn open_with_platform_opener(target: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(target_os = "linux")]
    let opener = "xdg-open";
    #[cfg(target_os = "windows")]
    let opener = "explorer";
    std::process::Command::new(opener)
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("failed to open {target}: {e}"))
}

fn shellexpand_tilde(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return format!("{}/{}", home.to_string_lossy(), rest);
        }
    }
    path.to_string()
}
