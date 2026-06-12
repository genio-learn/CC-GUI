//! The persistent project-less commander session (config-gated).

use crate::service::{service, with_service};

/// Ensure the commander tmux session exists (creating or reviving it, and
/// refreshing its CLAUDE.md scaffold) and return its tmux session name.
/// Errors with the library's CommanderDisabled message when the config gate
/// is off.
#[tauri::command]
pub async fn prepare_commander() -> Result<String, String> {
    with_service(move |svc| async move {
        let config = svc.read_config();
        let cmd = claude_commander::cli_args::cli_command();
        claude_commander::commander::ensure_session(&config, &svc.session_manager().tmux, &cmd)
            .await
            .map_err(|e| e.to_string())
    })
    .await
}

/// Commander chip state for the sidebar footer.
#[derive(serde::Serialize, Clone)]
pub struct CommanderStatus {
    pub enabled: bool,
    pub running: bool,
}

pub async fn commander_status() -> CommanderStatus {
    match service().await {
        Ok(svc) => {
            let enabled = svc.read_config().commander_enabled;
            let running = if enabled {
                claude_commander::commander::is_running(&svc.session_manager().tmux).await
            } else {
                false
            };
            CommanderStatus { enabled, running }
        }
        Err(_) => CommanderStatus {
            enabled: false,
            running: false,
        },
    }
}
