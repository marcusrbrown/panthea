//! The one table of ops the webview may call through `studio_call`, with the
//! argument names each takes and how long each may wait.
//!
//! An op not in the table, or an argument not in its row, never reaches the
//! sidecar. No row names a path: the pickers, the export folder, the import
//! files and the editor are separate native commands that hold paths in Rust.
//! Values are not checked here; the sidecar's own dispatcher checks types and
//! required arguments, so the rules stay in one place.

use serde_json::Value;

use crate::mux::OpClass;

#[derive(Debug, PartialEq, Eq)]
pub struct OpSpec {
    pub op: &'static str,
    /// Every argument name the op accepts.
    pub args: &'static [&'static str],
    pub class: OpClass,
}

const fn spec(op: &'static str, args: &'static [&'static str], class: OpClass) -> OpSpec {
    OpSpec { op, args, class }
}

use OpClass::{Long, Read, Write};

/// Argument names are the session's own (`tools/studio/src/commands.ts`). The
/// masked-edit fields of `generate` (`editBase*`, `editMask`, `editStrength`,
/// `editCue`) name files by path and stay a CLI path; so does `reference`,
/// which the session refuses as unavailable (the probe's NO-GO). `palette` and
/// `pivot` make `generate` and `resolve` a recipe request for a render engine
/// (a palette id and a pixel point, never a place; the render profile comes from
/// the subject, and a recipe request takes no batch, seed or style note). `finish` takes no files:
/// it takes back what the editor saved. It may name the sheet hash it was
/// reviewed at, and carry the step it is recorded with (`method` and
/// `description` are free text published with the asset, not places).
pub const OPS: &[OpSpec] = &[
    // Reads of durable records.
    spec("status", &[], Read),
    spec("list", &["kind"], Read),
    spec("sheet", &["workingSetId"], Read),
    spec("report", &["workingSetId", "slot"], Read),
    // The latest save of an edit: stored report-only results and the changed
    // pixels against the version before it. By id; it reads without the lock.
    spec("edit-report", &["id"], Read),
    // A candidate's stored image, metadata only. Its pixels travel through
    // `preview_bytes`; `candidate-bytes` is not in this table.
    spec("candidate-frames", &["candidateId"], Read),
    spec(
        "resolve",
        &[
            "id",
            "subject",
            "kind",
            "slots",
            "batch",
            "seed",
            "styleNote",
            "palette",
            "pivot",
        ],
        Read,
    ),
    // The preview's asset source (bytes travel through `preview_bytes`).
    spec("source-list", &[], Read),
    spec(
        "source-resolve",
        &[
            "source",
            "id",
            "realm",
            "state",
            "direction",
            "ability",
            "expression",
            "animation",
        ],
        Read,
    ),
    spec("source-keys", &[], Read),
    // The queue.
    spec(
        "generate",
        &[
            "id",
            "subject",
            "kind",
            "slots",
            "batch",
            "seed",
            "styleNote",
            "palette",
            "pivot",
        ],
        Long,
    ),
    spec("reroll", &["requestId", "perSlot", "slotKey"], Long),
    spec("abort", &["jobId"], Long),
    spec("remove", &["jobId"], Write),
    // Working sets. Both take ids only; the session decides what a set holds.
    spec("set-create", &["id", "requestId"], Write),
    spec("set-replace-sheet", &["workingSetId", "requestId"], Write),
    // Conforms one succeeded job into a candidate: by a named set from the
    // config, or with inline parameters. The same session call the CLI makes.
    spec("conform", &["jobId", "set", "params"], Write),
    // Candidates, edits and final records.
    spec("pick", &["workingSetId", "candidateId", "slot"], Write),
    spec("reject", &["id", "reason"], Write),
    spec("discard", &["id"], Write),
    // `reviewed` is the sheet hash of the saved version the owner reviewed (an
    // edit report's `sheetHash`), not a place: the session refuses a finish
    // that would take another sheet.
    spec(
        "finish",
        &["id", "reviewed", "method", "description"],
        Write,
    ),
    // Derives slots from a published revision into a working set: a mirror, a
    // bob, or a palette swap. It names the asset and the slots, never a file.
    spec("derive", &["asset", "op", "from", "to", "params"], Write),
    spec(
        "pack",
        &[
            "id",
            "workingSetId",
            "assetId",
            "styleTag",
            "footprint",
            "stillFrameMs",
            "originalWork",
        ],
        Write,
    ),
    spec("approve", &["id", "confirm", "assessments"], Write),
    spec(
        "approve-with-exception",
        &["id", "confirm", "assessments", "exception"],
        Write,
    ),
    spec("publish", &["id", "confirm"], Write),
    // Gives the writer lock back when the app is idle; the sidecar refuses it
    // with `not-idle` otherwise. It takes the lock lazily again at the next
    // write. No arguments: there is nothing to force.
    spec("release", &[], Write),
];

/// Why a call was refused before the sidecar saw it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refusal {
    UnknownOp,
    UnknownArgument(String),
    NotAnObject,
}

pub fn lookup(op: &str) -> Option<&'static OpSpec> {
    OPS.iter().find(|spec| spec.op == op)
}

/// Checks `op` and the names in `args` against the table. A missing or `null`
/// `args` is an empty object.
pub fn check(op: &str, args: &Value) -> Result<&'static OpSpec, Refusal> {
    let spec = lookup(op).ok_or(Refusal::UnknownOp)?;
    match args {
        Value::Null => {}
        Value::Object(map) => {
            if let Some(stray) = map.keys().find(|key| !spec.args.contains(&key.as_str())) {
                return Err(Refusal::UnknownArgument(stray.clone()));
            }
        }
        _ => return Err(Refusal::NotAnObject),
    }
    Ok(spec)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    /// Names that carry a file, a folder or a place. No row may have one.
    const PATHISH: &[&str] = &[
        "dir",
        "png",
        "json",
        "path",
        "file",
        "folder",
        "root",
        "config",
        "workspace",
        "workspacePath",
        "editMask",
        "editBaseImage",
        "editBaseJob",
        "editBaseOutput",
        "editBaseDescription",
        "editBasePublished",
        "editBaseFrameHash",
        "editStrength",
        "editCue",
    ];

    #[test]
    fn the_table_is_the_app_surface_and_nothing_else() {
        let names: Vec<&str> = OPS.iter().map(|spec| spec.op).collect();
        assert_eq!(
            names,
            [
                "status",
                "list",
                "sheet",
                "report",
                "edit-report",
                "candidate-frames",
                "resolve",
                "source-list",
                "source-resolve",
                "source-keys",
                "generate",
                "reroll",
                "abort",
                "remove",
                "set-create",
                "set-replace-sheet",
                "conform",
                "pick",
                "reject",
                "discard",
                "finish",
                "derive",
                "pack",
                "approve",
                "approve-with-exception",
                "publish",
                "release",
            ]
        );
    }

    #[test]
    fn release_is_a_write_that_takes_no_argument_and_gives_the_lock_back() {
        let row = lookup("release").unwrap();
        assert_eq!(row.args, [] as [&str; 0]);
        assert_eq!(row.class, Write);
        assert!(check("release", &json!({})).is_ok());
        assert!(check("release", &Value::Null).is_ok());
        for stray in ["force", "id", "path", "toString"] {
            assert_eq!(
                check("release", &json!({ stray: true })),
                Err(Refusal::UnknownArgument(stray.into())),
                "{stray}"
            );
        }
    }

    #[test]
    fn candidate_frames_is_a_read_that_takes_one_candidate_id_and_the_bytes_op_is_not_callable() {
        let row = lookup("candidate-frames").unwrap();
        assert_eq!(row.args, ["candidateId"]);
        assert_eq!(row.class, OpClass::Read);
        for stray in ["id", "frame", "path", "dir", "toString"] {
            assert_eq!(
                check("candidate-frames", &json!({ stray: "x" })),
                Err(Refusal::UnknownArgument(stray.into())),
                "{stray}"
            );
        }
        // Pixels reach the webview only through `preview_bytes`, never as base64 in a reply.
        assert!(lookup("candidate-bytes").is_none());
        assert_eq!(
            check("candidate-bytes", &json!({ "candidateId": "a" })),
            Err(Refusal::UnknownOp)
        );
    }

    #[test]
    fn conform_is_a_write_that_takes_a_job_and_a_set_name_or_inline_params_and_never_a_place() {
        let row = lookup("conform").unwrap();
        assert_eq!(row.args, ["jobId", "set", "params"]);
        assert_eq!(row.class, OpClass::Write);
        for arg in row.args {
            assert!(!PATHISH.contains(arg), "conform takes {arg}");
        }
        assert!(check("conform", &json!({ "jobId": "j", "set": "standard" })).is_ok());
        assert!(check("conform", &json!({ "jobId": "j", "params": {} })).is_ok());
        for stray in ["path", "file", "png", "dir", "toString"] {
            assert_eq!(
                check("conform", &json!({ stray: "x" })),
                Err(Refusal::UnknownArgument(stray.into())),
                "{stray}"
            );
        }
    }

    #[test]
    fn reroll_takes_an_optional_slot_key_beside_the_request_and_the_count() {
        let row = lookup("reroll").unwrap();
        assert_eq!(row.args, ["requestId", "perSlot", "slotKey"]);
        assert_eq!(row.class, OpClass::Long);
        assert!(check("reroll", &json!({ "requestId": "r", "perSlot": 1 })).is_ok());
        assert!(check(
            "reroll",
            &json!({ "requestId": "r", "perSlot": 1, "slotKey": "idle/south" })
        )
        .is_ok());
    }

    #[test]
    fn edit_report_is_a_read_that_takes_one_edit_id_and_nothing_else() {
        let row = lookup("edit-report").unwrap();
        assert_eq!(row.args, ["id"]);
        assert_eq!(row.class, OpClass::Read);
        assert!(check("edit-report", &json!({ "id": "e1" })).is_ok());
        for stray in ["path", "dir", "png", "workingSetId", "slot", "toString"] {
            assert_eq!(
                check("edit-report", &json!({ stray: "x" })),
                Err(Refusal::UnknownArgument(stray.into())),
                "{stray}"
            );
        }
    }

    #[test]
    fn the_working_set_ops_take_ids_only_and_never_a_place() {
        assert_eq!(lookup("set-create").unwrap().args, ["id", "requestId"]);
        assert_eq!(
            lookup("set-replace-sheet").unwrap().args,
            ["workingSetId", "requestId"]
        );
        for op in ["set-create", "set-replace-sheet"] {
            assert_eq!(lookup(op).unwrap().class, OpClass::Write, "{op}");
            for arg in lookup(op).unwrap().args {
                assert!(!PATHISH.contains(arg), "{op} takes {arg}");
            }
            assert_eq!(
                check(op, &json!({ "path": "/tmp/x" })),
                Err(Refusal::UnknownArgument("path".into())),
                "{op}"
            );
        }
    }

    #[test]
    fn no_op_name_repeats() {
        let mut names: Vec<&str> = OPS.iter().map(|spec| spec.op).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), OPS.len());
    }

    #[test]
    fn no_row_names_a_path_a_file_or_an_edit_input() {
        for spec in OPS {
            for arg in spec.args {
                assert!(
                    !PATHISH.contains(arg),
                    "{} takes {arg}, which names a file or a place",
                    spec.op
                );
            }
        }
    }

    #[test]
    fn source_resolve_takes_a_realm_and_stays_a_read_with_no_place_in_it() {
        let row = lookup("source-resolve").unwrap();
        assert!(row.args.contains(&"realm"));
        assert_eq!(row.class, Read);
        assert!(check(
            "source-resolve",
            &json!({ "source": "draft", "id": "zeus-take", "realm": "underworld" })
        )
        .is_ok());
    }

    #[test]
    fn source_resolve_takes_an_effect_animation_by_name() {
        let row = lookup("source-resolve").unwrap();
        assert!(row.args.contains(&"animation"));
        assert_eq!(row.class, Read);
        assert!(check(
            "source-resolve",
            &json!({ "source": "canon", "id": "lightning-strike", "animation": "calm" })
        )
        .is_ok());
    }

    #[test]
    fn derive_is_a_write_that_names_an_asset_and_its_slots_and_never_a_place() {
        let row = lookup("derive").unwrap();
        assert_eq!(row.args, ["asset", "op", "from", "to", "params"]);
        assert_eq!(row.class, Write);
        for arg in row.args {
            assert!(!PATHISH.contains(arg), "derive takes {arg}");
        }
        assert!(check(
            "derive",
            &json!({ "asset": "zeus-sprite", "op": "mirror", "from": "idle/east" })
        )
        .is_ok());
        for stray in ["dir", "path", "png", "root", "toString"] {
            assert_eq!(
                check("derive", &json!({ stray: "x" })),
                Err(Refusal::UnknownArgument(stray.into())),
                "{stray}"
            );
        }
    }

    #[test]
    fn the_path_ops_and_an_op_the_table_never_had_are_not_callable() {
        for op in [
            "rotate",
            "open",
            "edit-workspace",
            "import",
            "export",
            "source-bytes",
            "session",
        ] {
            assert_eq!(check(op, &json!({})), Err(Refusal::UnknownOp), "{op}");
            assert!(lookup(op).is_none(), "{op}");
        }
    }

    #[test]
    fn a_name_an_object_would_inherit_or_a_near_miss_is_not_an_op() {
        for op in [
            "toString",
            "constructor",
            "__proto__",
            "hasOwnProperty",
            "valueOf",
            "",
            " status",
            "status ",
            "status\n",
            "STATUS",
            "Status",
            "list/jobs",
        ] {
            assert_eq!(check(op, &json!({})), Err(Refusal::UnknownOp), "{op:?}");
        }
    }

    #[test]
    fn every_row_accepts_each_of_its_own_arguments() {
        for spec in OPS {
            let all: serde_json::Map<String, Value> = spec
                .args
                .iter()
                .map(|arg| ((*arg).into(), json!(1)))
                .collect();
            assert_eq!(check(spec.op, &Value::Object(all)), Ok(spec), "{}", spec.op);
            for arg in spec.args {
                assert!(
                    check(spec.op, &json!({ *arg: 1 })).is_ok(),
                    "{} {arg}",
                    spec.op
                );
            }
            assert!(check(spec.op, &json!({})).is_ok(), "{}", spec.op);
        }
    }

    #[test]
    fn an_argument_outside_the_row_is_refused_by_name_for_every_op() {
        for spec in OPS {
            for stray in [
                "dir",
                "png",
                "json",
                "path",
                "editMask",
                "editBaseImage",
                "editBaseJob",
                "editBasePublished",
                "editBaseFrameHash",
                "reference",
                "editStrength",
                "constructor",
                "__proto__",
                "toString",
                "",
                "ID",
            ] {
                if spec.args.contains(&stray) {
                    continue;
                }
                let mut args = serde_json::Map::new();
                args.insert(stray.to_string(), json!("x"));
                assert_eq!(
                    check(spec.op, &Value::Object(args)),
                    Err(Refusal::UnknownArgument(stray.to_string())),
                    "{} {stray:?}",
                    spec.op
                );
            }
        }
    }

    #[test]
    fn one_stray_key_among_valid_ones_refuses_the_whole_call() {
        assert_eq!(
            check(
                "generate",
                &json!({ "id": "a", "subject": "zeus", "kind": "sprite", "slots": [], "editMask": "/tmp/m.png" })
            ),
            Err(Refusal::UnknownArgument("editMask".into()))
        );
        // Keys are visited in name order, so the first stray one is named.
        assert_eq!(
            check(
                "finish",
                &json!({ "id": "e1", "png": "/tmp/x.png", "json": "/tmp/x.json" })
            ),
            Err(Refusal::UnknownArgument("json".into()))
        );
        assert_eq!(
            check(
                "finish",
                &json!({ "id": "e1", "method": "script", "description": "x", "png": "/tmp/x.png" })
            ),
            Err(Refusal::UnknownArgument("png".into()))
        );
    }

    #[test]
    fn finish_names_the_reviewed_hash_and_may_carry_a_script_step_but_takes_no_file() {
        let row = lookup("finish").unwrap();
        assert_eq!(row.args, ["id", "reviewed", "method", "description"]);
        assert_eq!(row.class, Write);
        assert!(check("finish", &json!({ "id": "e1", "reviewed": "ab" })).is_ok());
        assert!(check(
            "finish",
            &json!({ "id": "e1", "reviewed": "ab", "method": "script", "description": "idle loop" })
        )
        .is_ok());
        for stray in ["png", "json", "dir", "path"] {
            assert_eq!(
                check("finish", &json!({ "id": "e1", stray: "x" })),
                Err(Refusal::UnknownArgument(stray.into()))
            );
        }
        // A hash and a step are free text, not places: none of the three is path-like.
        for free_text in ["reviewed", "method", "description"] {
            assert!(!PATHISH.contains(&free_text), "{free_text}");
        }
    }

    #[test]
    fn only_finish_takes_a_step_and_no_other_op_has_method_or_description() {
        for spec in OPS {
            if spec.op == "finish" {
                continue;
            }
            for arg in ["method", "description"] {
                assert!(!spec.args.contains(&arg), "{} takes {arg}", spec.op);
            }
        }
    }

    #[test]
    fn arguments_must_be_an_object_or_absent() {
        assert!(check("status", &Value::Null).is_ok());
        for args in [
            json!([]),
            json!("x"),
            json!(3),
            json!(true),
            json!([{ "kind": "jobs" }]),
        ] {
            assert_eq!(check("list", &args), Err(Refusal::NotAnObject), "{args}");
        }
    }

    #[test]
    fn generation_and_abort_wait_long_and_reads_wait_short() {
        for op in ["generate", "reroll", "abort"] {
            assert_eq!(lookup(op).unwrap().class, OpClass::Long, "{op}");
        }
        for op in [
            "status",
            "list",
            "sheet",
            "report",
            "edit-report",
            "candidate-frames",
            "resolve",
            "source-list",
            "source-resolve",
            "source-keys",
        ] {
            assert_eq!(lookup(op).unwrap().class, OpClass::Read, "{op}");
        }
        for op in [
            "remove",
            "set-create",
            "set-replace-sheet",
            "pick",
            "reject",
            "discard",
            "finish",
            "pack",
            "approve",
            "approve-with-exception",
            "publish",
            "release",
        ] {
            assert_eq!(lookup(op).unwrap().class, OpClass::Write, "{op}");
        }
    }

    #[test]
    fn generate_and_resolve_take_the_recipe_fields_and_they_are_not_places() {
        for op in ["generate", "resolve"] {
            let row = lookup(op).unwrap();
            assert!(row.args.contains(&"palette"), "{op}");
            assert!(row.args.contains(&"pivot"), "{op}");
            assert!(
                check(
                    op,
                    &json!({ "id": "a", "subject": "zeus", "kind": "sprite", "slots": [], "palette": "greek-retro", "pivot": { "x": 56, "y": 78 } })
                )
                .is_ok(),
                "{op}"
            );
        }
        for free_text in ["palette", "pivot"] {
            assert!(!PATHISH.contains(&free_text), "{free_text}");
        }
        // The engine itself is never named by the webview: no op takes an executable.
        for spec in OPS {
            assert!(
                !spec.args.contains(&"executable"),
                "{} takes executable",
                spec.op
            );
        }
    }

    #[test]
    fn the_masked_edit_fields_are_absent_from_generate_and_resolve() {
        for op in ["generate", "resolve"] {
            let row = lookup(op).unwrap();
            assert!(row.args.iter().all(|arg| !arg.starts_with("edit")), "{op}");
        }
    }
}
