#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use claude_commander::api::{CommanderService, CreateSessionOpts, NewComment};
use claude_commander::comment::{ApplyOutcome, CommentSide};
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
async fn generate_summary(id: String) -> Result<String, String> {
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
    let diff = claude_commander::git::compute_branch_diff(&worktree_path, &main_branch).await;
    claude_commander::git::fetch_branch_summary(&diff, &config.ai_summary_model).await
}

/// Open the review diff for a session: parsed base→working-tree diff plus the
/// session's re-anchored comments.
#[tauri::command]
async fn open_review(id: String) -> Result<claude_commander::api::ReviewSnapshot, String> {
    let id = parse_session_id(&id)?;
    with_service(move |svc| async move { svc.open_review(&id).await.map_err(|e| e.to_string()) })
        .await
}

/// Stage a review comment. `side` is "old" or "new"; `line_range` is the
/// inclusive range on that side; `snippet` re-anchors the comment if the diff
/// changes. Returns the new comment's id.
#[tauri::command]
async fn create_comment(
    id: String,
    file: String,
    side: String,
    line_range: (usize, usize),
    snippet: String,
    comment: String,
) -> Result<String, String> {
    let id = parse_session_id(&id)?;
    let side = match side.as_str() {
        "old" => CommentSide::Old,
        "new" => CommentSide::New,
        other => return Err(format!("invalid comment side {other:?}")),
    };
    with_service(move |svc| async move {
        let draft = NewComment {
            file,
            side,
            line_range,
            snippet,
            comment,
        };
        svc.create_comment(&id, draft)
            .await
            .map(|uuid| uuid.to_string())
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
async fn delete_comment(id: String, comment_id: String) -> Result<(), String> {
    let id = parse_session_id(&id)?;
    let comment_id = uuid::Uuid::parse_str(&comment_id).map_err(|e| e.to_string())?;
    with_service(move |svc| async move {
        svc.delete_comment(&id, comment_id)
            .await
            .map_err(|e| e.to_string())
    })
    .await
}

/// Apply staged comments: composes the markdown brief and injects a pointer
/// prompt into the session's pane (delivery gated on agent state). May block
/// up to the library's hold timeout while a permission prompt clears.
#[tauri::command]
async fn apply_comments(id: String) -> Result<ApplyOutcome, String> {
    let id = parse_session_id(&id)?;
    with_service(move |svc| async move { svc.apply_comments(&id).await.map_err(|e| e.to_string()) })
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

/// Ensure a session's tmux session is alive before attaching, mirroring the
/// TUI: a stopped session (or dead pane) is transparently recreated, with
/// `--resume` if configured.
#[tauri::command]
async fn prepare_attach(id: String) -> Result<(), String> {
    let id = parse_session_id(&id)?;
    with_service(move |svc| async move {
        svc.session_manager()
            .get_attach_command(&id)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
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
            generate_summary,
            open_review,
            create_comment,
            delete_comment,
            apply_comments,
            create_session,
            kill_session,
            restart_session,
            delete_session,
            prepare_attach,
            attach,
            write_pty,
            resize_pty,
            detach
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
