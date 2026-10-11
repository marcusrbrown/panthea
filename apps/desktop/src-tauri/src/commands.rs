// Invoke commands exposed to the main window's webview: subscribing to
// the frame stream, relaying a presentation receipt, the model settings
// and endpoint-key commands, and the two read-only canon commands
// (`canon_registry`, `canon_atlas`). No other command is reachable from
// the renderer (see capabilities/proxy.json). Key commands are
// write-only: set, delete, and a set/missing status. None returns a key
// value, and `KeyStore::get` has no command. The canon commands return
// only integrity-verified registry text and atlas bytes addressed by
// sha256; the webview never sends a path.

use std::collections::BTreeMap;
use std::sync::Arc;

use serde_json::Value;
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Manager, State};

use crate::canon::{CanonRegistry, CanonStore};
use crate::keys::{key_statuses, KeyError, KeyStatus, KeyStore};
use crate::settings::SettingsStore;
use crate::state::SidecarState;

/// Managed state wrapping the credential store: the one seam the
/// commands (and, in a later unit, the sidecar spawn path) go through.
pub struct KeyVault(pub Arc<dyn KeyStore>);

/// Credential-store calls block and can raise an OS prompt, so they run
/// off the main thread and the async runtime's workers.
async fn run_key_op<T: Send + 'static>(
    vault: &KeyVault,
    op: impl FnOnce(&dyn KeyStore) -> Result<T, KeyError> + Send + 'static,
) -> Result<T, String> {
    let store = vault.0.clone();
    tauri::async_runtime::spawn_blocking(move || op(store.as_ref()))
        .await
        .map_err(|_| "the Keychain operation did not complete".to_string())?
        .map_err(|error| error.to_string())
}

/// Restarts the sidecar so a settings change takes effect. Detached: the
/// command that caused it reports its own outcome, and the restart (a kill, a
/// spawn, Keychain reads) runs off the main thread and the async workers.
fn apply_in_background(app: AppHandle) {
    drop(tauri::async_runtime::spawn_blocking(move || {
        crate::sidecar::apply_restart_sidecar(app);
    }));
}

/// The saved settings JSON, or `null` when none were saved yet.
#[tauri::command]
pub fn read_model_settings(store: State<SettingsStore>) -> Result<Option<String>, String> {
    store.read().map_err(|error| error.to_string())
}

/// Stores the settings JSON verbatim, then restarts the sidecar so the new
/// settings apply. The caller validates; the shell only caps the size.
#[tauri::command]
pub fn save_model_settings(
    app: AppHandle,
    store: State<SettingsStore>,
    settings: String,
) -> Result<(), String> {
    store.write(&settings).map_err(|error| error.to_string())?;
    apply_in_background(app);
    Ok(())
}

/// Stores an endpoint's key in the Keychain, then restarts the sidecar so it
/// starts with the new key. The error text never includes the key.
#[tauri::command]
pub async fn set_endpoint_key(
    app: AppHandle,
    vault: State<'_, KeyVault>,
    key_ref: String,
    key: String,
) -> Result<(), String> {
    run_key_op(&vault, move |store| store.set(&key_ref, &key)).await?;
    apply_in_background(app);
    Ok(())
}

/// Removes an endpoint's key, then restarts the sidecar without it.
#[tauri::command]
pub async fn delete_endpoint_key(
    app: AppHandle,
    vault: State<'_, KeyVault>,
    key_ref: String,
) -> Result<(), String> {
    run_key_op(&vault, move |store| store.delete(&key_ref)).await?;
    apply_in_background(app);
    Ok(())
}

/// `set` or `missing` for each `key_ref`; never a value.
#[tauri::command]
pub async fn endpoint_key_status(
    vault: State<'_, KeyVault>,
    key_refs: Vec<String>,
) -> Result<BTreeMap<String, KeyStatus>, String> {
    run_key_op(&vault, move |store| key_statuses(store, &key_refs)).await
}

/// Stores `frames` as the subscribed Channel; a resubscribe (e.g. after
/// the webview reloads) replaces whatever channel was stored before.
/// Pushed to on every subsequent poll by the proxy's poll task -- but if
/// a frame has already been polled, that cached frame is sent right
/// away too, so a newly (re)subscribing webview sees the world's
/// current state immediately rather than waiting up to a second for the
/// next poll.
#[tauri::command]
pub fn subscribe_world(state: State<SidecarState>, frames: Channel<Value>) {
    let mut lifecycle = state
        .lifecycle
        .lock()
        .expect("sidecar state mutex poisoned");
    crate::proxy::apply_subscribe(&mut lifecycle, frames);
}

/// Relays a presentation receipt for `event_id`, attributed to the
/// current sidecar session. Fails if no sidecar session is active yet.
#[tauri::command]
pub async fn present_event(app: AppHandle, event_id: String) -> Result<(), String> {
    let (session, session_id) = {
        let state = app.state::<SidecarState>();
        let lifecycle = state
            .lifecycle
            .lock()
            .expect("sidecar state mutex poisoned");
        let session = lifecycle
            .session
            .clone()
            .ok_or_else(|| "no active sidecar session".to_string())?;
        let session_id = lifecycle
            .last_frame
            .as_ref()
            .map(|frame| frame.session_id.clone())
            .ok_or_else(|| "no frame received yet".to_string())?;
        (session, session_id)
    };
    crate::proxy::present_event(session.port, &session.token, &session_id, &event_id).await
}

fn canon_registry_of(store: &CanonStore) -> CanonRegistry {
    store.registry().clone()
}

fn canon_atlas_of(store: &CanonStore, hash: &str) -> Result<Vec<u8>, String> {
    store
        .atlas(hash)
        .map(<[u8]>::to_vec)
        .map_err(|error| error.to_string())
}

/// The verified canon registry as text for the webview to parse: the index,
/// every manifest whose bytes hash to its name (each with that hash, which the
/// index's revisions are matched against), the vocabulary, which kind of
/// root was read, and the files that were dropped. Loaded once at startup.
#[tauri::command]
pub fn canon_registry(store: State<CanonStore>) -> CanonRegistry {
    canon_registry_of(&store)
}

/// A verified atlas blob as raw bytes (`ipc::Response`, no JSON number array).
/// The webview names it by sha256 only: a malformed or unverified hash is
/// refused from memory, and no path ever crosses the boundary.
#[tauri::command]
pub fn canon_atlas(store: State<CanonStore>, hash: String) -> Result<Response, String> {
    canon_atlas_of(&store, &hash).map(Response::new)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use crate::keys::testing::MemoryKeyStore;

    const SENTINEL: &str = "sk-sentinel-DO-NOT-LEAK-0123456789";

    /// Every command the main window's webview can invoke. Adding a command
    /// means adding it here, to the handler list in lib.rs, to the app
    /// manifest in build.rs, and to capabilities/proxy.json.
    const REACHABLE_COMMANDS: [&str; 9] = [
        "subscribe_world",
        "present_event",
        "read_model_settings",
        "save_model_settings",
        "set_endpoint_key",
        "delete_endpoint_key",
        "endpoint_key_status",
        "canon_registry",
        "canon_atlas",
    ];

    fn expected_commands() -> BTreeSet<String> {
        REACHABLE_COMMANDS.iter().map(|c| c.to_string()).collect()
    }

    /// The quoted names between `open` and the next `close` in `source`.
    fn names_between(source: &str, open: &str, close: &str, prefix: &str) -> BTreeSet<String> {
        let start = source.find(open).expect("open marker") + open.len();
        let end = start + source[start..].find(close).expect("close marker");
        source[start..end]
            .split(',')
            .map(|item| item.trim().trim_matches('"').trim_start_matches(prefix))
            .filter(|item| !item.is_empty())
            .map(str::to_string)
            .collect()
    }

    #[test]
    fn the_capability_lists_exactly_the_existing_commands_plus_the_two_canon_ones() {
        let capability: Value =
            serde_json::from_str(include_str!("../capabilities/proxy.json")).unwrap();
        let granted: BTreeSet<String> = capability["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|permission| permission.as_str().expect("plain permission").to_string())
            .collect();
        let expected: BTreeSet<String> = REACHABLE_COMMANDS
            .iter()
            .map(|command| format!("allow-{}", command.replace('_', "-")))
            .collect();
        assert_eq!(granted, expected);
    }

    #[test]
    fn the_app_manifest_and_the_handler_list_name_the_same_commands() {
        let build = include_str!("../build.rs");
        let manifest = names_between(build, "commands(&[", "]", "");
        assert_eq!(manifest, expected_commands());

        let lib = include_str!("lib.rs");
        let handlers = names_between(lib, "generate_handler![", "]", "commands::");
        assert_eq!(handlers, expected_commands());
    }

    #[test]
    fn the_header_comment_names_the_canon_commands() {
        let header: String = include_str!("commands.rs")
            .lines()
            .take_while(|line| line.starts_with("//"))
            .collect::<Vec<_>>()
            .join(" ");
        assert!(header.contains("canon_registry") && header.contains("canon_atlas"));
    }

    fn store_over_a_fixture() -> (CanonStore, String, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("panthea-canon-cmd-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let atlas = b"\x89PNG command atlas";
        let hash = crate::canon::sha256_hex(atlas);
        std::fs::create_dir_all(root.join("registry/blobs")).unwrap();
        std::fs::create_dir_all(root.join("registry/manifests")).unwrap();
        std::fs::write(root.join(format!("registry/blobs/{hash}.png")), atlas).unwrap();
        std::fs::write(root.join("registry/index.json"), b"{}").unwrap();
        std::fs::write(root.join("vocabulary.json"), b"{}").unwrap();
        (
            CanonStore::load(Some(&root), crate::canon::RootKind::Repo),
            hash,
            root,
        )
    }

    #[test]
    fn the_canon_commands_serve_the_registry_and_a_verified_atlas() {
        let (store, hash, root) = store_over_a_fixture();

        let registry = canon_registry_of(&store);
        assert_eq!(registry.index.as_deref(), Some("{}"));
        assert_eq!(registry.vocabulary.as_deref(), Some("{}"));

        assert_eq!(
            canon_atlas_of(&store, &hash).unwrap(),
            b"\x89PNG command atlas"
        );
        let refused = canon_atlas_of(&store, "../../etc/passwd").unwrap_err();
        assert!(!refused.contains("/etc"));
        assert!(canon_atlas_of(&store, &"0".repeat(64)).is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    fn vault(store: MemoryKeyStore) -> KeyVault {
        KeyVault(Arc::new(store))
    }

    // These drive `run_key_op` with the same closures the commands pass,
    // so the commands' wiring and error mapping are covered without a
    // running app.

    #[test]
    fn set_then_status_then_delete_round_trips_through_the_command_path() {
        let vault = vault(MemoryKeyStore::default());
        tauri::async_runtime::block_on(async {
            run_key_op(&vault, |store| store.set("zeus-key", SENTINEL))
                .await
                .unwrap();
            let refs = vec!["zeus-key".to_string()];
            let statuses = run_key_op(&vault, {
                let refs = refs.clone();
                move |store| key_statuses(store, &refs)
            })
            .await
            .unwrap();
            assert_eq!(statuses["zeus-key"], KeyStatus::Set);

            run_key_op(&vault, |store| store.delete("zeus-key"))
                .await
                .unwrap();
            let statuses = run_key_op(&vault, move |store| key_statuses(store, &refs))
                .await
                .unwrap();
            assert_eq!(statuses["zeus-key"], KeyStatus::Missing);
        });
    }

    #[test]
    fn a_failing_store_returns_an_error_string_without_the_key() {
        let vault = vault(MemoryKeyStore::failing());
        let error = tauri::async_runtime::block_on(run_key_op(&vault, |store| {
            store.set("zeus-key", SENTINEL)
        }))
        .unwrap_err();
        assert!(!error.is_empty());
        assert!(!error.contains(SENTINEL));
    }

    #[test]
    fn what_a_status_command_returns_serializes_without_the_key() {
        let vault = vault(MemoryKeyStore::default());
        let json = tauri::async_runtime::block_on(async {
            run_key_op(&vault, |store| store.set("zeus-key", SENTINEL))
                .await
                .unwrap();
            let statuses = run_key_op(&vault, |store| {
                key_statuses(store, &["zeus-key".to_string()])
            })
            .await
            .unwrap();
            serde_json::to_string(&statuses).unwrap()
        });
        assert_eq!(json, r#"{"zeus-key":"set"}"#);
        assert!(!json.contains(SENTINEL));
    }
}
