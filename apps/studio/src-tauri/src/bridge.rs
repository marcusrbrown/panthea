//! What each command does, apart from Tauri: check the call, talk to the
//! sidecar through the mux, and shape the reply for the webview. The commands
//! in `commands.rs` are thin wrappers that supply the managed state, the native
//! pickers and the editor launcher.
//!
//! A path never crosses to the webview. Native code holds the folder and file
//! the owner picked, passes them to the sidecar, and drops them; the workspace
//! path the sidecar reports goes to the editor launcher and no further.

use std::future::Future;
use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::mux::{Mux, MuxError, OpClass};
use crate::poll::Dirty;
use crate::schema::{self, Refusal};

/// The error every command returns: a code to branch on, a message to show, and
/// whatever else the sidecar said about it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CommandError {
    pub code: String,
    pub message: String,
    /// True when asking again may succeed (the sidecar is starting, restarting
    /// or just went away); false for a refusal, a bad call or a timeout.
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<Value>,
}

impl CommandError {
    fn new(code: &str, message: &str, retryable: bool) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable,
            detail: None,
        }
    }

    pub fn not_configured() -> Self {
        Self::new(
            "not-configured",
            "no studio config file is chosen: choose one first",
            false,
        )
    }
}

impl From<Refusal> for CommandError {
    fn from(refusal: Refusal) -> Self {
        match refusal {
            Refusal::UnknownOp => Self::new("unknown-op", "that op is not available here", false),
            Refusal::UnknownArgument(name) => Self::new(
                "invalid-arguments",
                &format!(
                    "unknown argument \"{}\"",
                    name.chars().take(64).collect::<String>()
                ),
                false,
            ),
            Refusal::NotAnObject => {
                Self::new("invalid-arguments", "arguments must be an object", false)
            }
        }
    }
}

impl From<MuxError> for CommandError {
    fn from(error: MuxError) -> Self {
        let retryable = error.retryable();
        match error {
            MuxError::Unavailable => Self::new(
                "sidecar-unavailable",
                "the studio session is not running",
                retryable,
            ),
            MuxError::Disconnected => Self::new(
                "sidecar-disconnected",
                "the studio session went away before it answered",
                retryable,
            ),
            MuxError::Timeout => Self::new(
                "timeout",
                "the studio session did not answer in time",
                retryable,
            ),
            MuxError::Malformed => Self::new(
                "malformed-reply",
                "the studio session sent a reply the app cannot read",
                retryable,
            ),
            MuxError::Refused {
                code,
                message,
                mut detail,
            } => {
                let mut detail = Value::Object(std::mem::take(&mut detail));
                strip_paths(&mut detail);
                let empty = detail.as_object().is_some_and(Map::is_empty);
                Self {
                    code,
                    message,
                    retryable,
                    detail: (!empty).then_some(detail),
                }
            }
        }
    }
}

/// Removes every field that names a place on disk, wherever it is nested.
pub fn strip_paths(value: &mut Value) {
    match value {
        Value::Object(map) => {
            map.remove("workspacePath");
            map.values_mut().for_each(strip_paths);
        }
        Value::Array(items) => items.iter_mut().for_each(strip_paths),
        _ => {}
    }
}

/// `studio_call`: one of the table's ops, forwarded with its name and arguments
/// unchanged. Refused, before the sidecar is contacted, if the op or an argument
/// is not in the table or no config is chosen.
pub async fn studio_call(
    mux: &Mux,
    configured: bool,
    dirty: &Dirty,
    op: &str,
    args: Value,
) -> Result<Value, CommandError> {
    let spec = schema::check(op, &args)?;
    if !configured {
        return Err(CommandError::not_configured());
    }
    let args = if args.is_null() { json!({}) } else { args };
    let result = mux.request(spec.op, args, spec.class).await;
    if spec.class != OpClass::Read {
        // Even a refusal may follow a partial change; the next poll re-reads.
        dirty.mark();
    }
    let mut value = result?;
    strip_paths(&mut value);
    Ok(value)
}

/// `preview_bytes`: the validated atlas for a selection as raw bytes, only under
/// the version key it was resolved with.
pub async fn preview_bytes(
    mux: &Mux,
    configured: bool,
    source: &str,
    id: &str,
    version: &str,
) -> Result<Vec<u8>, CommandError> {
    if !configured {
        return Err(CommandError::not_configured());
    }
    let args = json!({ "source": source, "id": id, "v": version });
    let reply = mux.request("source-bytes", args, OpClass::Read).await?;
    reply
        .get("base64")
        .and_then(Value::as_str)
        .and_then(|text| base64::engine::general_purpose::STANDARD.decode(text).ok())
        .ok_or_else(|| CommandError::from(MuxError::Malformed))
}

/// Why the editor did not start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchFailure {
    /// No Aseprite was found.
    NoEditor,
    /// It was found and would not start.
    Failed,
}

/// `edit_open`: opens the edit in the session, then launches the editor on the
/// workspace file the session reports. The reply never carries that file's path;
/// it says whether the editor launched so the webview can offer the
/// export-and-import fallback when it did not.
pub async fn edit_open(
    mux: &Mux,
    configured: bool,
    dirty: &Dirty,
    edit_id: &str,
    working_set_id: &str,
    slots: Vec<String>,
    launch: impl FnOnce(&Path) -> Result<(), LaunchFailure>,
) -> Result<Value, CommandError> {
    if !configured {
        return Err(CommandError::not_configured());
    }
    let args = json!({ "id": edit_id, "workingSetId": working_set_id, "slots": slots });
    let result = mux.request("open", args, OpClass::Write).await;
    dirty.mark();
    let mut reply = result?;
    let workspace = reply
        .get("workspacePath")
        .and_then(Value::as_str)
        .map(PathBuf::from);
    strip_paths(&mut reply);
    let editor = match workspace {
        None => json!({ "launched": false, "reason": "no-workspace" }),
        Some(path) => match launch(&path) {
            Ok(()) => json!({ "launched": true }),
            Err(LaunchFailure::NoEditor) => {
                json!({ "launched": false, "reason": "editor-unavailable" })
            }
            Err(LaunchFailure::Failed) => {
                json!({ "launched": false, "reason": "launch-failed" })
            }
        },
    };
    if let Value::Object(map) = &mut reply {
        map.insert("editor".into(), editor);
    }
    Ok(reply)
}

/// A picked path as the text the session's protocol carries. A path that is not
/// valid UTF-8 cannot be sent faithfully, so it is refused rather than mangled.
fn path_text(path: &Path) -> Result<&str, CommandError> {
    path.to_str().ok_or_else(|| CommandError {
        code: "invalid-path".into(),
        message: "the chosen location cannot be used".into(),
        retryable: false,
        detail: None,
    })
}

fn cancelled() -> Value {
    json!({ "cancelled": true })
}

/// `edit_export`: the owner picks a folder, and the session writes the edit's
/// sheet, metadata and workspace into it. `{"cancelled": true}` when no folder
/// was picked.
pub async fn edit_export<Fut>(
    mux: &Mux,
    configured: bool,
    dirty: &Dirty,
    edit_id: &str,
    pick_folder: impl FnOnce() -> Fut,
) -> Result<Value, CommandError>
where
    Fut: Future<Output = Option<PathBuf>>,
{
    if !configured {
        return Err(CommandError::not_configured());
    }
    let Some(dir) = pick_folder().await else {
        return Ok(cancelled());
    };
    let args = json!({ "id": edit_id, "dir": path_text(&dir)? });
    let result = mux.request("export", args, OpClass::Write).await;
    dirty.mark();
    let mut reply = result?;
    strip_paths(&mut reply);
    Ok(reply)
}

/// `edit_import`: the owner picks the sheet and its metadata, and the session
/// imports them, or finishes the edit with them. `{"cancelled": true}` when
/// either pick is cancelled.
pub async fn edit_import<FutA, FutB>(
    mux: &Mux,
    configured: bool,
    dirty: &Dirty,
    edit_id: &str,
    finish: bool,
    pick_png: impl FnOnce() -> FutA,
    pick_json: impl FnOnce() -> FutB,
) -> Result<Value, CommandError>
where
    FutA: Future<Output = Option<PathBuf>>,
    FutB: Future<Output = Option<PathBuf>>,
{
    if !configured {
        return Err(CommandError::not_configured());
    }
    let Some(png) = pick_png().await else {
        return Ok(cancelled());
    };
    let Some(json_file) = pick_json().await else {
        return Ok(cancelled());
    };
    let args = json!({
        "id": edit_id,
        "png": path_text(&png)?,
        "json": path_text(&json_file)?,
    });
    let op = if finish { "finish" } else { "import" };
    let result = mux.request(op, args, OpClass::Write).await;
    dirty.mark();
    let mut reply = result?;
    strip_paths(&mut reply);
    Ok(reply)
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::sync::Arc;

    use super::*;
    use crate::schema::OPS;
    use crate::testkit::{runtime, Reply, Scripted};

    fn attached(
        script: impl Fn(&str, &Value) -> Reply + Send + Sync + 'static,
    ) -> (Arc<Mux>, Scripted, Dirty) {
        let mux = Arc::new(Mux::new());
        let sidecar = Scripted::attach(&mux, 1, script);
        (mux, sidecar, Dirty::default())
    }

    fn echo(op: &str, args: &Value) -> Reply {
        Reply::Ok(json!({ "op": op, "args": args }))
    }

    fn dirty_after(dirty: &Dirty) -> bool {
        // `Dirty::take` is private to poll; observe it through a poll-visible effect.
        dirty.is_marked()
    }

    #[test]
    fn a_table_op_is_forwarded_with_its_name_and_arguments_unchanged() {
        runtime().block_on(async {
            for spec in OPS {
                let (mux, sidecar, dirty) = attached(echo);
                let args: Map<String, Value> = spec
                    .args
                    .iter()
                    .enumerate()
                    .map(|(i, name)| {
                        (
                            (*name).to_string(),
                            json!({ "n": i, "s": "text", "list": [1, "two", null] }),
                        )
                    })
                    .collect();

                let result =
                    studio_call(&mux, true, &dirty, spec.op, Value::Object(args.clone())).await;

                assert_eq!(
                    sidecar.seen(),
                    vec![(spec.op.to_string(), Value::Object(args.clone()))],
                    "{}",
                    spec.op
                );
                assert_eq!(
                    result.unwrap(),
                    json!({ "op": spec.op, "args": args }),
                    "{}",
                    spec.op
                );
            }
        });
    }

    #[test]
    fn absent_arguments_go_to_the_sidecar_as_an_empty_object() {
        runtime().block_on(async {
            let (mux, sidecar, dirty) = attached(echo);
            studio_call(&mux, true, &dirty, "status", Value::Null)
                .await
                .unwrap();
            assert_eq!(sidecar.seen(), vec![("status".to_string(), json!({}))]);
        });
    }

    #[test]
    fn an_op_or_argument_outside_the_table_is_refused_and_the_sidecar_hears_nothing() {
        runtime().block_on(async {
            let (mux, sidecar, dirty) = attached(echo);
            let calls = [
                ("derive", json!({})),
                ("open", json!({ "id": "e" })),
                ("export", json!({ "id": "e", "dir": "/tmp" })),
                (
                    "import",
                    json!({ "id": "e", "png": "/tmp/a.png", "json": "/tmp/a.json" }),
                ),
                ("toString", json!({})),
                ("generate", json!({ "id": "a", "editMask": "/tmp/m.png" })),
                ("finish", json!({ "id": "e", "png": "/tmp/a.png" })),
                ("list", json!({ "kind": "jobs", "dir": "/tmp" })),
                ("status", json!([1])),
            ];
            for (op, args) in calls {
                let error = studio_call(&mux, true, &dirty, op, args.clone())
                    .await
                    .unwrap_err();
                assert!(
                    error.code == "unknown-op" || error.code == "invalid-arguments",
                    "{op}: {}",
                    error.code
                );
                assert!(!error.retryable);
            }
            assert_eq!(sidecar.seen(), vec![]);
            assert!(!dirty_after(&dirty));
        });
    }

    #[test]
    fn the_refusal_names_the_argument_but_never_echoes_its_value() {
        runtime().block_on(async {
            let (mux, _sidecar, dirty) = attached(echo);
            let error = studio_call(
                &mux,
                true,
                &dirty,
                "list",
                json!({ "dir": "/Users/secret/place" }),
            )
            .await
            .unwrap_err();
            assert!(error.message.contains("dir"));
            assert!(!error.message.contains("secret"));
        });
    }

    #[test]
    fn with_no_config_chosen_a_valid_call_is_refused_as_not_configured_and_the_sidecar_hears_nothing(
    ) {
        runtime().block_on(async {
            let (mux, sidecar, dirty) = attached(echo);

            let error = studio_call(&mux, false, &dirty, "status", json!({}))
                .await
                .unwrap_err();

            assert_eq!(error.code, "not-configured");
            assert!(!error.retryable);
            assert_eq!(sidecar.seen(), vec![]);
        });
    }

    #[test]
    fn a_bad_call_is_named_as_bad_even_when_nothing_is_configured() {
        runtime().block_on(async {
            let (mux, _sidecar, dirty) = attached(echo);
            let error = studio_call(&mux, false, &dirty, "derive", json!({}))
                .await
                .unwrap_err();
            assert_eq!(error.code, "unknown-op");
        });
    }

    #[test]
    fn a_workspace_path_in_a_reply_is_removed_wherever_it_is() {
        runtime().block_on(async {
            let (mux, _sidecar, dirty) = attached(|_, _| {
                Reply::Ok(json!({
                    "workspacePath": "/tmp/a",
                    "nested": { "workspacePath": "/tmp/b", "list": [{ "workspacePath": "/tmp/c", "keep": 1 }] }
                }))
            });

            let result = studio_call(&mux, true, &dirty, "status", json!({}))
                .await
                .unwrap();

            assert_eq!(result, json!({ "nested": { "list": [{ "keep": 1 }] } }));
        });
    }

    #[test]
    fn a_sidecar_refusal_keeps_its_code_message_and_details() {
        runtime().block_on(async {
            let (mux, _sidecar, dirty) = attached(|_, _| {
                Reply::Refuse("revision-mismatch", "the confirmed revision is not current")
            });

            let error = studio_call(
                &mux,
                true,
                &dirty,
                "publish",
                json!({ "id": "a", "confirm": "x" }),
            )
            .await
            .unwrap_err();

            assert_eq!(error.code, "revision-mismatch");
            assert_eq!(error.message, "the confirmed revision is not current");
            assert!(!error.retryable);
        });
    }

    #[test]
    fn errors_serialize_with_a_code_a_message_and_a_retryable_flag() {
        let error = CommandError::from(MuxError::Disconnected);
        assert_eq!(
            serde_json::to_value(&error).unwrap(),
            json!({
                "code": "sidecar-disconnected",
                "message": "the studio session went away before it answered",
                "retryable": true
            })
        );
        let refused = CommandError::from(MuxError::Refused {
            code: "invalid-request".into(),
            message: "bad".into(),
            detail: json!({ "error": { "kind": "unknown-subject", "valid": ["zeus"] } })
                .as_object()
                .unwrap()
                .clone(),
        });
        assert_eq!(
            serde_json::to_value(&refused).unwrap()["detail"]["error"]["valid"],
            json!(["zeus"])
        );
    }

    #[test]
    fn only_a_sidecar_that_is_not_there_is_retryable() {
        assert!(CommandError::from(MuxError::Unavailable).retryable);
        assert!(CommandError::from(MuxError::Disconnected).retryable);
        assert!(!CommandError::from(MuxError::Timeout).retryable);
        assert!(!CommandError::from(MuxError::Malformed).retryable);
    }

    #[test]
    fn a_call_with_no_sidecar_attached_is_retryable_unavailable() {
        runtime().block_on(async {
            let mux = Mux::new();
            let dirty = Dirty::default();
            let error = studio_call(&mux, true, &dirty, "status", json!({}))
                .await
                .unwrap_err();
            assert_eq!(error.code, "sidecar-unavailable");
            assert!(error.retryable);
        });
    }

    #[test]
    fn a_call_that_changes_things_marks_the_snapshot_dirty_and_a_read_does_not() {
        runtime().block_on(async {
            let (mux, _sidecar, dirty) = attached(echo);

            studio_call(&mux, true, &dirty, "list", json!({ "kind": "jobs" }))
                .await
                .unwrap();
            assert!(!dirty_after(&dirty));

            studio_call(&mux, true, &dirty, "remove", json!({ "jobId": "j" }))
                .await
                .unwrap();
            assert!(dirty_after(&dirty));
        });
    }

    #[test]
    fn a_change_that_the_sidecar_refused_still_marks_dirty_because_the_state_may_have_moved() {
        runtime().block_on(async {
            let (mux, _sidecar, dirty) = attached(|_, _| Reply::Refuse("busy", "owned elsewhere"));
            let _ = studio_call(&mux, true, &dirty, "remove", json!({ "jobId": "j" })).await;
            assert!(dirty_after(&dirty));
        });
    }

    // preview_bytes

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0, 1, 2, 255, 254];

    fn encoded(bytes: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    #[test]
    fn preview_bytes_asks_for_the_selection_and_version_and_returns_the_raw_bytes() {
        runtime().block_on(async {
            let (mux, sidecar, _dirty) = attached(|_, _| {
                Reply::Ok(
                    json!({ "pixelKey": "k", "width": 1, "height": 1, "base64": encoded(PNG) }),
                )
            });

            let bytes = preview_bytes(&mux, true, "draft", "zeus-take", "k1")
                .await
                .unwrap();

            assert_eq!(bytes, PNG);
            assert_eq!(
                sidecar.seen(),
                vec![(
                    "source-bytes".to_string(),
                    json!({ "source": "draft", "id": "zeus-take", "v": "k1" })
                )]
            );
        });
    }

    #[test]
    fn a_stale_version_is_a_typed_error_with_no_bytes() {
        runtime().block_on(async {
            let (mux, _sidecar, _dirty) =
                attached(|_, _| Reply::Refuse("stale-version", "resolve it again"));

            let error = preview_bytes(&mux, true, "draft", "zeus-take", "old")
                .await
                .unwrap_err();

            assert_eq!(error.code, "stale-version");
            assert!(!error.retryable);
        });
    }

    #[test]
    fn a_reply_that_is_not_valid_base64_is_a_malformed_reply() {
        runtime().block_on(async {
            for result in [
                json!({ "base64": "!!!not base64!!!" }),
                json!({ "base64": 7 }),
                json!({}),
                json!(null),
            ] {
                let (mux, _sidecar, _dirty) = attached(move |_, _| Reply::Ok(result.clone()));
                let error = preview_bytes(&mux, true, "draft", "a", "k")
                    .await
                    .unwrap_err();
                assert_eq!(error.code, "malformed-reply");
            }
        });
    }

    #[test]
    fn preview_bytes_with_no_config_asks_nothing() {
        runtime().block_on(async {
            let (mux, sidecar, _dirty) = attached(echo);
            let error = preview_bytes(&mux, false, "draft", "a", "k")
                .await
                .unwrap_err();
            assert_eq!(error.code, "not-configured");
            assert_eq!(sidecar.seen(), vec![]);
        });
    }

    // edit_open

    fn opened_reply(_: &str, _: &Value) -> Reply {
        Reply::Ok(json!({
            "editId": "e1",
            "slots": ["idle/south"],
            "workspace": { "size": { "w": 64, "h": 80 }, "durationsMs": [167], "tags": [] },
            "workspacePath": "/studio/edits/e1/workspace.aseprite"
        }))
    }

    #[test]
    fn opening_an_edit_launches_the_editor_on_the_reported_file_and_never_returns_the_path() {
        runtime().block_on(async {
            let (mux, sidecar, dirty) = attached(opened_reply);
            let launched = RefCell::new(Vec::<PathBuf>::new());

            let reply = edit_open(
                &mux,
                true,
                &dirty,
                "e1",
                "w",
                vec!["idle/south".into()],
                |path| {
                    launched.borrow_mut().push(path.to_path_buf());
                    Ok(())
                },
            )
            .await
            .unwrap();

            assert_eq!(
                *launched.borrow(),
                vec![PathBuf::from("/studio/edits/e1/workspace.aseprite")]
            );
            assert_eq!(
                sidecar.seen(),
                vec![(
                    "open".to_string(),
                    json!({ "id": "e1", "workingSetId": "w", "slots": ["idle/south"] })
                )]
            );
            assert_eq!(reply["editId"], "e1");
            assert_eq!(reply["workspace"]["size"], json!({ "w": 64, "h": 80 }));
            assert_eq!(reply["editor"], json!({ "launched": true }));
            let text = reply.to_string();
            assert!(!text.contains("/studio"), "{text}");
            assert!(!text.contains("workspacePath"));
            assert!(dirty_after(&dirty));
        });
    }

    #[test]
    fn with_no_editor_the_edit_is_still_open_and_the_reply_says_the_editor_did_not_launch() {
        runtime().block_on(async {
            let (mux, _sidecar, dirty) = attached(opened_reply);

            let reply = edit_open(&mux, true, &dirty, "e1", "w", vec![], |_| {
                Err(LaunchFailure::NoEditor)
            })
            .await
            .unwrap();

            assert_eq!(
                reply["editor"],
                json!({ "launched": false, "reason": "editor-unavailable" })
            );
            assert_eq!(reply["editId"], "e1");
            assert!(!reply.to_string().contains("/studio"));
        });
    }

    #[test]
    fn an_editor_that_will_not_start_is_reported_as_a_launch_failure() {
        runtime().block_on(async {
            let (mux, _sidecar, dirty) = attached(opened_reply);
            let reply = edit_open(&mux, true, &dirty, "e1", "w", vec![], |_| {
                Err(LaunchFailure::Failed)
            })
            .await
            .unwrap();
            assert_eq!(
                reply["editor"],
                json!({ "launched": false, "reason": "launch-failed" })
            );
        });
    }

    #[test]
    fn a_session_that_refuses_the_open_launches_nothing_and_passes_its_refusal_on() {
        runtime().block_on(async {
            let (mux, _sidecar, dirty) =
                attached(|_, _| Reply::Refuse("wrong-state", "edit e1 is finished"));
            let launched = RefCell::new(false);

            let error = edit_open(&mux, true, &dirty, "e1", "w", vec![], |_| {
                *launched.borrow_mut() = true;
                Ok(())
            })
            .await
            .unwrap_err();

            assert_eq!(error.code, "wrong-state");
            assert!(!*launched.borrow());
        });
    }

    #[test]
    fn a_reply_with_no_workspace_launches_nothing_and_says_so() {
        runtime().block_on(async {
            let (mux, _sidecar, dirty) = attached(|_, _| Reply::Ok(json!({ "editId": "e1" })));
            let launched = RefCell::new(false);

            let reply = edit_open(&mux, true, &dirty, "e1", "w", vec![], |_| {
                *launched.borrow_mut() = true;
                Ok(())
            })
            .await
            .unwrap();

            assert!(!*launched.borrow());
            assert_eq!(
                reply["editor"],
                json!({ "launched": false, "reason": "no-workspace" })
            );
        });
    }

    #[test]
    fn opening_with_no_config_contacts_nothing_and_launches_nothing() {
        runtime().block_on(async {
            let (mux, sidecar, dirty) = attached(opened_reply);
            let launched = RefCell::new(false);
            let error = edit_open(&mux, false, &dirty, "e1", "w", vec![], |_| {
                *launched.borrow_mut() = true;
                Ok(())
            })
            .await
            .unwrap_err();
            assert_eq!(error.code, "not-configured");
            assert_eq!(sidecar.seen(), vec![]);
            assert!(!*launched.borrow());
        });
    }

    // edit_export

    #[test]
    fn exporting_passes_the_picked_folder_to_the_session_and_never_returns_it() {
        runtime().block_on(async {
            let (mux, sidecar, dirty) = attached(|_, _| {
                Reply::Ok(json!({ "editId": "e1", "files": ["sheet.png", "sheet.json", "workspace.aseprite"] }))
            });

            let reply = edit_export(&mux, true, &dirty, "e1", || async {
                Some(PathBuf::from("/Users/owner/Desktop/export"))
            })
            .await
            .unwrap();

            assert_eq!(
                sidecar.seen(),
                vec![(
                    "export".to_string(),
                    json!({ "id": "e1", "dir": "/Users/owner/Desktop/export" })
                )]
            );
            assert_eq!(reply["files"], json!(["sheet.png", "sheet.json", "workspace.aseprite"]));
            assert!(!reply.to_string().contains("Desktop"));
            assert!(dirty_after(&dirty));
        });
    }

    #[test]
    fn cancelling_the_folder_picker_exports_nothing() {
        runtime().block_on(async {
            let (mux, sidecar, dirty) = attached(echo);
            let reply = edit_export(&mux, true, &dirty, "e1", || async { None })
                .await
                .unwrap();
            assert_eq!(reply, json!({ "cancelled": true }));
            assert_eq!(sidecar.seen(), vec![]);
        });
    }

    #[test]
    fn with_no_config_the_folder_picker_never_opens() {
        runtime().block_on(async {
            let (mux, sidecar, dirty) = attached(echo);
            let opened = RefCell::new(false);
            let error = edit_export(&mux, false, &dirty, "e1", || {
                *opened.borrow_mut() = true;
                async { Some(PathBuf::from("/x")) }
            })
            .await
            .unwrap_err();
            assert_eq!(error.code, "not-configured");
            assert!(!*opened.borrow());
            assert_eq!(sidecar.seen(), vec![]);
        });
    }

    #[test]
    fn a_picked_folder_that_is_not_text_is_refused_before_the_session_hears_of_it() {
        use std::os::unix::ffi::OsStringExt;
        runtime().block_on(async {
            let (mux, sidecar, dirty) = attached(echo);
            let error = edit_export(&mux, true, &dirty, "e1", || async {
                Some(PathBuf::from(std::ffi::OsString::from_vec(vec![
                    b'/', 0xff, 0xfe,
                ])))
            })
            .await
            .unwrap_err();
            assert_eq!(error.code, "invalid-path");
            assert_eq!(sidecar.seen(), vec![]);
        });
    }

    // edit_import

    #[test]
    fn importing_passes_both_picked_files_and_asks_for_import_or_finish() {
        runtime().block_on(async {
            for (finish, op) in [(false, "import"), (true, "finish")] {
                let (mux, sidecar, dirty) = attached(|_, _| {
                    Reply::Ok(json!({ "editId": "e1", "state": "imported", "changed": true }))
                });

                let reply = edit_import(
                    &mux,
                    true,
                    &dirty,
                    "e1",
                    finish,
                    || async { Some(PathBuf::from("/Users/owner/in/sheet.png")) },
                    || async { Some(PathBuf::from("/Users/owner/in/sheet.json")) },
                )
                .await
                .unwrap();

                assert_eq!(
                    sidecar.seen(),
                    vec![(
                        op.to_string(),
                        json!({
                            "id": "e1",
                            "png": "/Users/owner/in/sheet.png",
                            "json": "/Users/owner/in/sheet.json"
                        })
                    )]
                );
                assert_eq!(reply["changed"], true);
                assert!(!reply.to_string().contains("owner"));
            }
        });
    }

    #[test]
    fn cancelling_either_picker_imports_nothing_and_a_cancelled_first_pick_skips_the_second() {
        runtime().block_on(async {
            let (mux, sidecar, dirty) = attached(echo);
            let second = RefCell::new(false);

            let first_cancelled = edit_import(
                &mux,
                true,
                &dirty,
                "e1",
                false,
                || async { None },
                || {
                    *second.borrow_mut() = true;
                    async { Some(PathBuf::from("/b.json")) }
                },
            )
            .await
            .unwrap();
            let second_cancelled = edit_import(
                &mux,
                true,
                &dirty,
                "e1",
                false,
                || async { Some(PathBuf::from("/a.png")) },
                || async { None },
            )
            .await
            .unwrap();

            assert_eq!(first_cancelled, json!({ "cancelled": true }));
            assert_eq!(second_cancelled, json!({ "cancelled": true }));
            assert!(!*second.borrow());
            assert_eq!(sidecar.seen(), vec![]);
        });
    }

    #[test]
    fn with_no_config_neither_import_picker_opens() {
        runtime().block_on(async {
            let (mux, _sidecar, dirty) = attached(echo);
            let opened = RefCell::new(0);
            let error = edit_import(
                &mux,
                false,
                &dirty,
                "e1",
                false,
                || {
                    *opened.borrow_mut() += 1;
                    async { None }
                },
                || {
                    *opened.borrow_mut() += 1;
                    async { None }
                },
            )
            .await
            .unwrap_err();
            assert_eq!(error.code, "not-configured");
            assert_eq!(*opened.borrow(), 0);
        });
    }
}
