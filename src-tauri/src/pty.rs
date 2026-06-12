//! PTY terminals: one per attached tmux session, streamed to xterm.js over a
//! Tauri channel.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State};

/// Monotonic id per attach, so a stale reader thread (whose PTY was replaced
/// by a re-attach under the same tmux name) can tell it no longer owns the
/// map entry and must neither remove it nor emit `pty-exit`.
static NEXT_GENERATION: AtomicU64 = AtomicU64::new(0);

struct PtyHandle {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    generation: u64,
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

/// Remove the PTY only if it is still the given generation. Returns whether
/// the caller owned the live entry (and should report the exit).
fn remove_pty_if_generation(state: &PtyState, session: &str, generation: u64) -> bool {
    let mut map = state.map.lock().unwrap();
    match map.get(session) {
        Some(handle) if handle.generation == generation => {
            if let Some(mut handle) = map.remove(session) {
                let _ = handle.child.kill();
            }
            true
        }
        _ => false,
    }
}

/// Whether a PTY is currently attached to this tmux session.
pub fn is_attached(app: &AppHandle, tmux_session: &str) -> bool {
    let state: State<'_, PtyState> = app.state();
    let attached = state.map.lock().unwrap().contains_key(tmux_session);
    attached
}

/// Payload for the `pty-exit` event: `ended` distinguishes the tmux session
/// having terminated (program exited / killed) from a plain detach, so the
/// frontend can auto-restart crashed sessions the way the TUI does.
#[derive(serde::Serialize, Clone)]
struct PtyExit {
    session: String,
    ended: bool,
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

    let generation = NEXT_GENERATION.fetch_add(1, Ordering::Relaxed);

    // Insert before spawning the reader so the reader's EOF path always finds
    // its own entry (or a newer generation, in which case it stays silent).
    state.map.lock().unwrap().insert(
        tmux_session.clone(),
        PtyHandle {
            writer,
            master: pair.master,
            child,
            generation,
        },
    );

    let session_name = tmux_session;
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
        let owned = {
            let pty_state: State<'_, PtyState> = app.state();
            remove_pty_if_generation(&pty_state, &session_name, generation)
        };
        // A re-attach replaced this PTY while we were reading: the new
        // terminal owns the session now — don't report an exit for it.
        if !owned {
            return;
        }
        // Reader EOF means the attach process exited — either the user
        // detached or the tmux session ended. Check which before notifying.
        tauri::async_runtime::spawn(async move {
            let ended = match crate::service::service().await {
                Ok(svc) => !svc
                    .session_manager()
                    .tmux
                    .session_exists(&session_name)
                    .await
                    .unwrap_or(true),
                Err(_) => false,
            };
            let _ = app.emit(
                "pty-exit",
                PtyExit {
                    session: session_name,
                    ended,
                },
            );
        });
    });

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
