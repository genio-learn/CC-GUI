//! PTY terminals: one per attached tmux session, streamed to xterm.js over a
//! Tauri channel.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State};

struct PtyHandle {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState {
    map: Mutex<HashMap<String, PtyHandle>>,
}

fn remove_pty(state: &PtyState, session: &str) {
    if let Some(mut handle) = state.map.lock().unwrap().remove(session) {
        let _ = handle.child.kill();
    }
}

#[tauri::command]
pub fn attach(
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
pub fn write_pty(
    state: State<'_, PtyState>,
    tmux_session: String,
    data: String,
) -> Result<(), String> {
    if let Some(handle) = state.map.lock().unwrap().get_mut(&tmux_session) {
        handle
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn resize_pty(
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
pub fn detach(state: State<'_, PtyState>, tmux_session: String) -> Result<(), String> {
    remove_pty(&state, &tmux_session);
    Ok(())
}
