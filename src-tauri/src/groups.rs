//! The grouped session list pushed to the sidebar, refreshed on a 2s loop.

use std::collections::HashMap;
use std::time::Duration;

use claude_commander::api::CommanderService;
use claude_commander::tmux::AgentStateDetector;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::service::service;

pub const SESSIONS_REFRESH_MS: u64 = 2000;

#[derive(Serialize, Clone)]
pub struct SessionRow {
    pub id: String,
    pub title: String,
    pub branch: String,
    pub status: String,
    pub program: String,
    pub agent_state: String,
    pub tmux_session_name: String,
}

#[derive(Serialize, Clone)]
pub struct ProjectGroup {
    pub id: String,
    pub name: String,
    pub repo_path: String,
    pub sessions: Vec<SessionRow>,
}

/// Snapshot projects + sessions from the shared state store. Agent states are
/// filled by the caller (the polling loop has the detector; the initial
/// `get_groups` call reports "unknown" and lets the next tick correct it).
pub async fn build_groups(
    svc: &CommanderService,
    mut detect: Option<&mut AgentStateDetector>,
) -> Vec<ProjectGroup> {
    let (projects, sessions) = {
        let state = svc.store().read().await;
        let projects: Vec<_> = state.projects.values().cloned().collect();
        let sessions: Vec<_> = state.sessions.values().cloned().collect();
        (projects, sessions)
    };

    let mut rows_by_project: HashMap<String, Vec<SessionRow>> = HashMap::new();
    for s in &sessions {
        let agent_state = match detect.as_deref_mut() {
            Some(d) if s.status.is_active() && s.program.contains("claude") => {
                format!("{:?}", d.detect(&s.tmux_session_name).await).to_lowercase()
            }
            _ => "unknown".to_string(),
        };
        rows_by_project
            .entry(s.project_id.to_string())
            .or_default()
            .push(SessionRow {
                id: s.id.as_uuid().to_string(),
                title: s.title.clone(),
                branch: s.branch.clone(),
                status: s.status.to_string(),
                program: s.program.clone(),
                agent_state,
                tmux_session_name: s.tmux_session_name.clone(),
            });
    }

    let mut groups: Vec<ProjectGroup> = projects
        .into_iter()
        .map(|p| {
            let mut sessions = rows_by_project.remove(&p.id.to_string()).unwrap_or_default();
            sessions.sort_by(|a, b| a.title.cmp(&b.title));
            ProjectGroup {
                id: p.id.to_string(),
                name: p.name.clone(),
                repo_path: p.repo_path.to_string_lossy().to_string(),
                sessions,
            }
        })
        .collect();
    groups.sort_by(|a, b| a.name.cmp(&b.name));
    groups
}

#[tauri::command]
pub async fn get_groups() -> Result<Vec<ProjectGroup>, String> {
    let svc = service().await?;
    let _ = svc.store().reload_if_changed().await;
    Ok(build_groups(svc, None).await)
}

/// Background loop: refresh state from disk (other instances may write it),
/// detect agent states, and push the grouped session list to the frontend.
pub fn spawn_sessions_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut detector: Option<AgentStateDetector> = None;
        loop {
            if let Ok(svc) = service().await {
                let detector = detector.get_or_insert_with(|| {
                    AgentStateDetector::new(
                        svc.session_manager().tmux.clone(),
                        Duration::from_millis(SESSIONS_REFRESH_MS / 2),
                    )
                });
                let _ = svc.store().reload_if_changed().await;
                let groups = build_groups(svc, Some(detector)).await;
                let _ = app.emit("sessions-updated", &groups);
            }
            tokio::time::sleep(Duration::from_millis(SESSIONS_REFRESH_MS)).await;
        }
    });
}
