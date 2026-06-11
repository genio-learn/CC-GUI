#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

/// The single live PTY attachment (spike: one terminal at a time).
struct PtyHandle {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
struct PtyState {
    current: Mutex<Option<PtyHandle>>,
}

#[derive(Serialize, Clone)]
struct SessionRow {
    id: String,
    title: String,
    branch: String,
    status: String,
    program: String,
    project: String,
    tmux_session_name: String,
}

/// List sessions via the claude-commander library. Reads the shared state
/// store directly because `SessionInfo` doesn't expose `tmux_session_name`
/// (upstream PR candidate — see PLAN.md phase 3).
#[tauri::command]
async fn list_sessions() -> Result<Vec<SessionRow>, String> {
    let config = claude_commander::Config::load().map_err(|e| e.to_string())?;
    let service =
        claude_commander::api::CommanderService::for_cli(config).map_err(|e| e.to_string())?;
    let state = service.store().read().await;
    let mut rows: Vec<SessionRow> = state
        .sessions
        .values()
        .map(|s| SessionRow {
            id: s.id.to_string(),
            title: s.title.clone(),
            branch: s.branch.clone(),
            status: s.status.to_string(),
            program: s.program.clone(),
            project: state
                .projects
                .get(&s.project_id)
                .map(|p| p.name.clone())
                .unwrap_or_default(),
            tmux_session_name: s.tmux_session_name.clone(),
        })
        .collect();
    rows.sort_by(|a, b| (&a.project, &a.title).cmp(&(&b.project, &b.title)));
    Ok(rows)
}

/// Attach to a tmux session: spawn `tmux attach-session` on a fresh PTY and
/// stream its output to the frontend over `on_data`.
#[tauri::command]
fn attach(
    state: State<'_, PtyState>,
    tmux_session: String,
    on_data: Channel<Vec<u8>>,
) -> Result<(), String> {
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
    });

    let replaced = state.current.lock().unwrap().replace(PtyHandle {
        writer,
        master: pair.master,
        child,
    });
    if let Some(mut old) = replaced {
        let _ = old.child.kill();
    }
    Ok(())
}

#[tauri::command]
fn write_pty(state: State<'_, PtyState>, data: String) -> Result<(), String> {
    if let Some(handle) = state.current.lock().unwrap().as_mut() {
        handle
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn resize_pty(state: State<'_, PtyState>, rows: u16, cols: u16) -> Result<(), String> {
    if let Some(handle) = state.current.lock().unwrap().as_ref() {
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
fn detach(state: State<'_, PtyState>) -> Result<(), String> {
    if let Some(mut handle) = state.current.lock().unwrap().take() {
        let _ = handle.child.kill();
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(PtyState::default())
        .invoke_handler(tauri::generate_handler![
            list_sessions,
            attach,
            write_pty,
            resize_pty,
            detach
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
