#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cascade;
mod commander;
mod groups;
mod polling;
mod projects;
mod pty;
mod review;
mod service;
mod sessions;
mod settings;
mod themes;

/// When launched from Finder, a macOS app inherits launchd's minimal PATH
/// (`/usr/bin:/bin:/usr/sbin:/sbin`) — missing Homebrew, nvm, etc. — so tools
/// like `tmux` that the embedded claude-commander spawns by bare name fail with
/// ENOENT. Re-derive PATH from the user's login shell so every child process
/// (tmux, git, the terminal shells) sees what the terminal sees.
#[cfg(target_os = "macos")]
fn inherit_login_path() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let Ok(out) = std::process::Command::new(&shell)
        .args(["-ilc", "printf '__P__%s__P__' \"$PATH\""])
        .output()
    else {
        return;
    };
    let s = String::from_utf8_lossy(&out.stdout);
    let mut parts = s.split("__P__");
    if let (Some(_), Some(path)) = (parts.next(), parts.next()) {
        if !path.is_empty() {
            std::env::set_var("PATH", path);
        }
    }
}

fn main() {
    #[cfg(target_os = "macos")]
    inherit_login_path();

    tauri::Builder::default()
        .manage(pty::PtyState::default())
        .setup(|app| {
            groups::spawn_sessions_loop(app.handle().clone());
            polling::spawn_polling_loops();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            groups::get_groups,
            groups::set_view_mode,
            groups::move_to_section,
            sessions::get_session_detail,
            sessions::generate_summary,
            sessions::create_session,
            sessions::kill_session,
            sessions::restart_session,
            sessions::delete_session,
            sessions::rename_session,
            sessions::merged_pr_sessions,
            sessions::prepare_attach,
            sessions::prepare_shell,
            sessions::restart_fresh,
            commander::prepare_commander,
            settings::get_config,
            settings::get_keybindings,
            settings::save_config,
            themes::list_custom_themes,
            themes::save_custom_theme,
            themes::open_themes_dir,
            cascade::cascade_merge,
            cascade::cascade_resume,
            cascade::cascade_abandon,
            cascade::push_stack,
            projects::add_project,
            projects::scan_directory,
            projects::remove_project,
            projects::prepare_project_shell,
            projects::open_in_editor,
            projects::open_external,
            review::open_review,
            review::create_comment,
            review::delete_comment,
            review::apply_comments,
            pty::attach,
            pty::write_pty,
            pty::resize_pty,
            pty::detach
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
