#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod groups;
mod projects;
mod pty;
mod review;
mod service;
mod sessions;

fn main() {
    tauri::Builder::default()
        .manage(pty::PtyState::default())
        .setup(|app| {
            groups::spawn_sessions_loop(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            groups::get_groups,
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
