#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use claude_commander::api::{CommanderService, CreateSessionOpts};
use claude_commander::session::SessionId;
use claude_commander::tmux::AgentStateDetector;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::OnceCell;

const SESSIONS_REFRESH_MS: u64 = 2000;

static SERVICE: OnceCell<Arc<CommanderService>> = OnceCell::const_new();

async fn service() -> Result<&'static Arc<CommanderService>, String> {
    SERVICE
        .get_or_try_init(|| async {
            let config = claude_commander::Config::load().map_err(|e| e.to_string())?;
            CommanderService::for_cli(config)
                .map(Arc::new)
                .map_err(|e| e.to_string())
        })
        .await
}

/// Run a service operation on a dedicated thread with its own current-thread
/// runtime. Needed because several `CommanderService` methods hold non-Send
/// gix types across awaits, and Tauri async commands require Send futures.
async fn with_service<T, Fut, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    Fut: std::future::Future<Output = Result<T, String>> + 'static,
    F: FnOnce(&'static Arc<CommanderService>) -> Fut + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| e.to_string())?;
        rt.block_on(async move {
            let svc = service().await?;
            f(svc).await
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

// -- Session list ------------------------------------------------------------

#[derive(Serialize, Clone)]
struct SessionRow {
    id: String,
    title: String,
    branch: String,
    status: String,
    program: String,
    agent_state: String,
    tmux_session_name: String,
}

#[derive(Serialize, Clone)]
struct ProjectGroup {
    id: String,
    name: String,
    repo_path: String,
    sessions: Vec<SessionRow>,
}

/// Snapshot projects + sessions from the shared state store. Agent states are
/// filled by the caller (the polling loop has the detector; the initial
/// `get_groups` call reports "unknown" and lets the next tick correct it).
async fn build_groups(
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
async fn get_groups() -> Result<Vec<ProjectGroup>, String> {
    let svc = service().await?;
    let _ = svc.store().reload_if_changed().await;
    Ok(build_groups(svc, None).await)
}

/// Background loop: refresh state from disk (other instances may write it),
/// detect agent states, and push the grouped session list to the frontend.
fn spawn_sessions_loop(app: AppHandle) {
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

/// Detail for one session: full `SessionInfo` (flattened) + agent state,
/// diff stat, and pane preview. `lines` caps the pane capture.
#[tauri::command]
async fn get_session_detail(
    id: String,
    lines: Option<usize>,
) -> Result<Option<claude_commander::api::SessionDetail>, String> {
    with_service(move |svc| async move {
        svc.get_session_detail(&id, lines)
            .await
            .map_err(|e| e.to_string())
    })
    .await
}

// -- Session lifecycle -------------------------------------------------------

fn parse_session_id(id: &str) -> Result<SessionId, String> {
    uuid::Uuid::parse_str(id)
        .map(SessionId::from_uuid)
        .map_err(|e| format!("invalid session id {id}: {e}"))
}

#[tauri::command]
async fn create_session(project_path: String, title: String) -> Result<String, String> {
    with_service(move |svc| async move {
        let opts = CreateSessionOpts {
            project_path: PathBuf::from(project_path),
            title,
            program: None,
            initial_prompt: None,
            effort: None,
            mode: None,
            base_branch: None,
            section: None,
        };
        let id = svc.create_session(opts).await.map_err(|e| e.to_string())?;
        Ok(id.as_uuid().to_string())
    })
    .await
}

#[tauri::command]
async fn kill_session(id: String) -> Result<(), String> {
    let id = parse_session_id(&id)?;
    with_service(move |svc| async move { svc.kill_session(&id).await.map_err(|e| e.to_string()) })
        .await
}

#[tauri::command]
async fn restart_session(id: String) -> Result<(), String> {
    let id = parse_session_id(&id)?;
    with_service(
        move |svc| async move { svc.restart_session(&id).await.map_err(|e| e.to_string()) },
    )
    .await
}

#[tauri::command]
async fn delete_session(id: String) -> Result<(), String> {
    let id = parse_session_id(&id)?;
    with_service(
        move |svc| async move { svc.delete_session(&id).await.map_err(|e| e.to_string()) },
    )
    .await
}

// -- PTY terminals (one per attached tmux session) ---------------------------

struct PtyHandle {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
struct PtyState {
    map: Mutex<HashMap<String, PtyHandle>>,
}

fn remove_pty(state: &PtyState, session: &str) {
    if let Some(mut handle) = state.map.lock().unwrap().remove(session) {
        let _ = handle.child.kill();
    }
}

#[tauri::command]
fn attach(
    app: AppHandle,
    state: State<'_, PtyState>,
    tmux_session: String,
    on_data: Channel<Vec<u8>>,
) -> Result<(), String> {
    // Replace any existing PTY for this session (e.g. re-attach after exit).
    remove_pty(&state, &tmux_session);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new("tmux");
    cmd.args(["attach-session", "-t", &tmux_session]);
    // A GUI process may not have TERM set; tmux refuses to start without one.
    cmd.env("TERM", "xterm-256color");

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let session_name = tmux_session.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if on_data.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
        let pty_state: State<'_, PtyState> = app.state();
        remove_pty(&pty_state, &session_name);
        let _ = app.emit("pty-exit", &session_name);
    });

    state.map.lock().unwrap().insert(
        tmux_session,
        PtyHandle {
            writer,
            master: pair.master,
            child,
        },
    );
    Ok(())
}

#[tauri::command]
fn write_pty(state: State<'_, PtyState>, tmux_session: String, data: String) -> Result<(), String> {
    if let Some(handle) = state.map.lock().unwrap().get_mut(&tmux_session) {
        handle
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn resize_pty(
    state: State<'_, PtyState>,
    tmux_session: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    if let Some(handle) = state.map.lock().unwrap().get(&tmux_session) {
        handle
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn detach(state: State<'_, PtyState>, tmux_session: String) -> Result<(), String> {
    remove_pty(&state, &tmux_session);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(PtyState::default())
        .setup(|app| {
            spawn_sessions_loop(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_groups,
            get_session_detail,
            create_session,
            kill_session,
            restart_session,
            delete_session,
            attach,
            write_pty,
            resize_pty,
            detach
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
