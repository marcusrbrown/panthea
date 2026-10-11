// Panthea desktop shell. Owns the Bun simulation sidecar as a supervised
// child process, proxies its authenticated HTTP frame stream to the
// webview over a Tauri Channel (the token never crosses to the
// renderer), and exposes pause, resume, and stop-background as
// tray-menu operator controls.

pub mod canon;
mod commands;
pub mod keys;
pub mod launch;
pub mod proxy;
pub mod settings;
pub mod sidecar;
mod state;
mod tray;

use tauri::{Manager, RunEvent, WindowEvent};

use canon::CanonStore;
use commands::KeyVault;
use settings::SettingsStore;
use state::SidecarState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // The single-instance plugin runs first, so a duplicate launch is
        // refused before any sidecar spawn or lock check.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState::default())
        .manage(KeyVault(keys::platform_key_store()))
        .invoke_handler(tauri::generate_handler![
            commands::subscribe_world,
            commands::present_event,
            commands::read_model_settings,
            commands::save_model_settings,
            commands::set_endpoint_key,
            commands::delete_endpoint_key,
            commands::endpoint_key_status,
            commands::canon_registry,
            commands::canon_atlas,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // Same directory the sidecar resolves for world saves
            // (`ai.panthe.desktop` under the platform app data dir).
            app.manage(SettingsStore::new(app.path().app_data_dir()?));
            // Verify the bundled canon registry once. A bad or missing
            // registry becomes problems in the payload, never a failed start.
            app.manage(CanonStore::load_for(
                app.path().resource_dir().ok(),
                cfg!(debug_assertions),
            ));
            let tray = tray::build_tray(&handle)?;
            *handle
                .state::<SidecarState>()
                .tray
                .lock()
                .expect("sidecar state mutex poisoned") = Some(tray);
            sidecar::spawn_sidecar(handle.clone());

            if let Some(window) = app.get_webview_window("main") {
                let window_handle = handle.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        let state = window_handle.state::<SidecarState>();
                        let quitting =
                            *state.quitting.lock().expect("sidecar state mutex poisoned");
                        if !quitting {
                            // Keep running in the tray: prevent the
                            // actual close and hide instead.
                            api.prevent_close();
                            if let Some(window) = window_handle.get_webview_window("main") {
                                let _ = window.hide();
                            }
                            *state
                                .window_hidden
                                .lock()
                                .expect("sidecar state mutex poisoned") = true;
                            tray::refresh(&window_handle);
                        }
                    }
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        RunEvent::ExitRequested { api, .. } => {
            let state = app_handle.state::<SidecarState>();
            let quitting = *state.quitting.lock().expect("sidecar state mutex poisoned");
            if !quitting {
                // A window-close-driven exit request keeps the app running
                // in the tray rather than quitting.
                api.prevent_exit();
            }
        }
        RunEvent::Exit => {
            sidecar::stop_sidecar(app_handle);
        }
        _ => {}
    });
}
