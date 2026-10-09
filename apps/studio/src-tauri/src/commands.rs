//! Invoke commands exposed to the main window's webview. They are the whole
//! surface (see capabilities/studio.json): the webview holds no shell, file,
//! dialog or network permission. Every command here is a thin wrapper over
//! `bridge`, supplying managed state, the native pickers and the editor
//! launcher. A path is picked, used and dropped in Rust; no reply carries one.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::bridge::{self, CommandError, LaunchFailure, PreviewTarget};
use crate::config::{editor_executable, ConfigStore};
use crate::poll::apply_subscribe;
use crate::state::{host_state, read_only_holder, HostState, StudioState};

/// Where the app is, for the webview: whether a config is chosen and what the
/// sidecar is doing. It carries no path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ConfigStatus {
    pub configured: bool,
    pub state: HostState,
}

fn configured(config: &ConfigStore) -> bool {
    config.path().is_some()
}

fn status(state: &StudioState, config: &ConfigStore) -> ConfigStatus {
    let configured = configured(config);
    let lifecycle = state
        .lifecycle
        .lock()
        .expect("sidecar state mutex poisoned");
    let state = host_state(&lifecycle, configured);
    ConfigStatus {
        configured,
        state: if read_only_holder(&lifecycle, state).is_some() {
            HostState::ReadOnly
        } else {
            state
        },
    }
}

/// Calls one op from the schema table. An op or argument outside it is refused
/// before the sidecar is contacted.
#[tauri::command]
pub async fn studio_call(
    state: State<'_, StudioState>,
    config: State<'_, ConfigStore>,
    op: String,
    args: Option<Value>,
) -> Result<Value, CommandError> {
    bridge::studio_call(
        &state.mux,
        configured(&config),
        &state.dirty,
        &op,
        args.unwrap_or(Value::Null),
    )
    .await
}

/// Subscribes to snapshots. The latest cached one is replayed at once; after
/// that only changes are sent.
#[tauri::command]
pub fn subscribe_studio(state: State<'_, StudioState>, channel: Channel<Value>) {
    let mut lifecycle = state
        .lifecycle
        .lock()
        .expect("sidecar state mutex poisoned");
    apply_subscribe(&mut lifecycle, channel);
}

/// The validated atlas for a selection, as raw bytes, only under the version key
/// it was resolved with (`{source, id}` and `v`). The placeholder a resolution
/// names is fetched by its hash alone (`{placeholder}`, no `v`).
#[tauri::command]
pub async fn preview_bytes(
    state: State<'_, StudioState>,
    config: State<'_, ConfigStore>,
    selection: PreviewTarget,
    v: Option<String>,
) -> Result<Response, CommandError> {
    bridge::preview_bytes(&state.mux, configured(&config), &selection, v.as_deref())
        .await
        .map(Response::new)
}

fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
}

/// Starts Aseprite on `file` as a detached process: native code, argv only, no
/// shell. The child is reaped on its own thread so it never lingers as a zombie.
fn launch_editor(config: &ConfigStore, file: &Path) -> Result<(), LaunchFailure> {
    let config_path = config.path().ok_or(LaunchFailure::NoEditor)?;
    let path_var = std::env::var("PATH").ok();
    let executable = editor_executable(&config_path, path_var.as_deref(), &is_executable)
        .ok_or(LaunchFailure::NoEditor)?;
    let mut child = Command::new(executable)
        .arg(file)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| LaunchFailure::Failed)?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

/// Opens (or reopens) an edit in the session and launches Aseprite on its
/// workspace. The reply says whether the editor launched, and carries no path.
#[tauri::command]
pub async fn edit_open(
    app: AppHandle,
    state: State<'_, StudioState>,
    config: State<'_, ConfigStore>,
    edit_id: String,
    working_set_id: String,
    slots: Vec<String>,
) -> Result<Value, CommandError> {
    bridge::edit_open(
        &state.mux,
        configured(&config),
        &state.dirty,
        &edit_id,
        &working_set_id,
        slots,
        |file| launch_editor(&app.state::<ConfigStore>(), file),
    )
    .await
}

/// Picks a folder with the native dialog. Blocks its thread until the owner
/// answers, so it runs off the main thread and the async workers.
async fn pick_folder(app: AppHandle) -> Option<PathBuf> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folder()
            .and_then(|picked| picked.into_path().ok())
    })
    .await
    .ok()
    .flatten()
}

async fn pick_file(
    app: AppHandle,
    label: &'static str,
    extension: &'static str,
) -> Option<PathBuf> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter(label, &[extension])
            .blocking_pick_file()
            .and_then(|picked| picked.into_path().ok())
    })
    .await
    .ok()
    .flatten()
}

/// Exports an edit's sheet, metadata and workspace into a folder the owner picks.
#[tauri::command]
pub async fn edit_export(
    app: AppHandle,
    state: State<'_, StudioState>,
    config: State<'_, ConfigStore>,
    edit_id: String,
) -> Result<Value, CommandError> {
    bridge::edit_export(
        &state.mux,
        configured(&config),
        &state.dirty,
        &edit_id,
        || pick_folder(app),
    )
    .await
}

/// Imports (or, with `finish`, finishes with) a sheet and its metadata the owner
/// picks.
#[tauri::command]
pub async fn edit_import(
    app: AppHandle,
    state: State<'_, StudioState>,
    config: State<'_, ConfigStore>,
    edit_id: String,
    finish: Option<bool>,
) -> Result<Value, CommandError> {
    let (png_app, json_app) = (app.clone(), app);
    bridge::edit_import(
        &state.mux,
        configured(&config),
        &state.dirty,
        &edit_id,
        finish.unwrap_or(false),
        || pick_file(png_app, "Sheet", "png"),
        || pick_file(json_app, "Sheet metadata", "json"),
    )
    .await
}

#[tauri::command]
pub fn config_status(
    state: State<'_, StudioState>,
    config: State<'_, ConfigStore>,
) -> ConfigStatus {
    status(&state, &config)
}

/// Lets the owner pick a studio config file, keeps it as the setting and
/// restarts the sidecar on it. `cancelled` and `invalid` leave the setting as it
/// was.
#[tauri::command]
pub async fn config_choose(
    app: AppHandle,
    state: State<'_, StudioState>,
    config: State<'_, ConfigStore>,
) -> Result<Value, CommandError> {
    let picked = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || {
            app.dialog()
                .file()
                .add_filter("Studio config", &["json"])
                .blocking_pick_file()
                .and_then(|picked| picked.into_path().ok())
        }
    })
    .await
    .ok()
    .flatten();
    let Some(picked) = picked else {
        return Ok(serde_json::json!({ "cancelled": true }));
    };
    config.set(&picked).map_err(|error| CommandError {
        code: "invalid-config".into(),
        message: error.to_string(),
        retryable: false,
        detail: None,
    })?;
    // The restart ends the old session first (its lock), so it runs off the workers.
    let restarting = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::sidecar::apply_restart_sidecar(restarting);
    });
    Ok(serde_json::to_value(status(&state, &config)).expect("status serializes"))
}
