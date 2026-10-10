// Panthea Studio. The host of the packaged asset studio: it supervises the
// studio session as a sidecar, multiplexes request/reply over its stdio, and
// exposes a short list of named commands to the webview. The webview holds no
// path, no shell and no dialog permission.

pub mod bridge;
mod commands;
pub mod config;
pub mod mux;
pub mod poll;
pub mod schema;
pub mod sidecar;
pub mod state;
pub mod teardown;
#[cfg(test)]
mod testkit;

use tauri::{Manager, RunEvent};

use config::ConfigStore;
use state::StudioState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Deliberately absent: the single-instance plugin (a second launch is handled
    // by the session's own root lock, which refuses it with a busy reply) and any
    // custom URI scheme (it would bypass capabilities). See ADR-0010.
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(StudioState::default())
        .invoke_handler(tauri::generate_handler![
            commands::studio_call,
            commands::subscribe_studio,
            commands::preview_bytes,
            commands::edit_open,
            commands::edit_export,
            commands::edit_import,
            commands::config_status,
            commands::config_choose,
        ])
        .setup(|app| {
            app.manage(ConfigStore::new(app.path().app_data_dir()?));
            sidecar::spawn_sidecar(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        // Closing the last window quits: nothing keeps running in a tray, so the
        // sidecar (and the root's lock) goes with it.
        RunEvent::ExitRequested { .. } | RunEvent::Exit => sidecar::quit_sidecar(app_handle),
        _ => {}
    });
}
