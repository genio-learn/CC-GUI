//! Custom GUI themes: discover user-authored theme files on disk and reveal the
//! folder. Themes live in `<app_config_dir>/themes/*.json`. Validation lives in
//! the frontend (`src/theme.ts`) so the schema has a single source of truth —
//! here we only read raw JSON and skip files that don't parse.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct CustomThemeFile {
    /// The file's basename, for per-file error reporting in the picker.
    file: String,
    /// Raw parsed JSON; the frontend validates + normalizes it into a Theme.
    content: serde_json::Value,
}

fn themes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|d| d.join("themes"))
        .map_err(|e| format!("no app config dir: {e}"))
}

/// Read every `*.json` in the themes dir as raw JSON, skipping files that don't
/// parse (the frontend reports per-file validation problems). A missing dir is
/// not an error — it just means no custom themes yet, so we return an empty list.
#[tauri::command]
pub fn list_custom_themes(app: AppHandle) -> Result<Vec<CustomThemeFile>, String> {
    let dir = themes_dir(&app)?;
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("failed to read {}: {e}", dir.display())),
    };

    let mut themes = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(content) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        let file = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        themes.push(CustomThemeFile { file, content });
    }
    Ok(themes)
}

/// Write a theme object to `themes/<name>.json` as an editable template. `name`
/// is reduced to a bare filename stem (alphanumerics, `-`, `_`) so the write
/// can't escape the themes dir. Returns the path written, for the success toast.
#[tauri::command]
pub fn save_custom_theme(
    app: AppHandle,
    name: String,
    theme: serde_json::Value,
) -> Result<String, String> {
    let dir = themes_dir(&app)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create {}: {e}", dir.display()))?;
    let stem: String = name
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    let stem = if stem.is_empty() {
        "custom-theme"
    } else {
        &stem
    };
    let path = dir.join(format!("{stem}.json"));
    let json = serde_json::to_string_pretty(&theme).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("failed to write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Ensure the themes dir exists, then reveal it in the platform file manager.
#[tauri::command]
pub fn open_themes_dir(app: AppHandle) -> Result<(), String> {
    let dir = themes_dir(&app)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create {}: {e}", dir.display()))?;
    crate::projects::open_external(dir.to_string_lossy().into_owned())
}
