//! Settings: expose the claude-commander `Config` as JSON for a generic
//! settings form, and write changes back through `update_config`.

use crate::service::service;

#[tauri::command]
pub async fn get_config() -> Result<serde_json::Value, String> {
    let svc = service().await?;
    serde_json::to_value(svc.read_config()).map_err(|e| e.to_string())
}

/// The keybinding table from the claude-commander config, as
/// `{ action_name: ["k", "Ctrl-p", ...] }` (the same serialization as the
/// `[keybindings]` TOML section). The frontend maps these onto GUI actions.
#[tauri::command]
pub async fn get_keybindings() -> Result<serde_json::Value, String> {
    let svc = service().await?;
    serde_json::to_value(svc.read_config().keybindings).map_err(|e| e.to_string())
}

/// Replace the full config with the given JSON (the frontend round-trips the
/// object from `get_config`). Returns whether a restart is required for some
/// changes to take effect.
#[tauri::command]
pub async fn save_config(config: serde_json::Value) -> Result<bool, String> {
    let svc = service().await?;
    let parsed: claude_commander::Config =
        serde_json::from_value(config).map_err(|e| format!("invalid config: {e}"))?;
    svc.update_config(parsed).map_err(|e| e.to_string())?;
    Ok(svc.restart_required())
}
