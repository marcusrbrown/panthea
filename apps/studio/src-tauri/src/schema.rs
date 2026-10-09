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
/// `editCue`) name files by path and stay a CLI path. `finish` takes no files
/// and no step here, so it can only take back what the editor saved.
pub const OPS: &[OpSpec] = &[
    // Reads of durable records.
    spec("status", &[], Read),
    spec("list", &["kind"], Read),
    spec("sheet", &["workingSetId"], Read),
    spec("report", &["workingSetId", "slot"], Read),
    // The latest save of an edit: stored report-only results and the changed
    // pixels against the version before it. By id; it reads without the lock.
    spec("edit-report", &["id"], Read),
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
            "state",
            "direction",
            "ability",
            "expression",
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
        ],
        Long,
    ),
    spec("reroll", &["requestId", "perSlot"], Long),
    spec("abort", &["jobId"], Long),
    spec("remove", &["jobId"], Write),
    // Working sets. Both take ids only; the session decides what a set holds.
    spec("set-create", &["id", "requestId"], Write),
    spec("set-replace-sheet", &["workingSetId", "requestId"], Write),
    // Candidates, edits and final records.
    spec("pick", &["workingSetId", "candidateId", "slot"], Write),
    spec("reject", &["id", "reason"], Write),
    spec("discard", &["id"], Write),
    spec("finish", &["id"], Write),
    spec(
        "pack",
        &[
            "id",
            "workingSetId",
            "assetId",
            "styleTag",
            "footprint",
            "stillFrameMs",
            "carriedParams",
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
        "editStrength",
        "editCue",
        "method",
        "description",
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
                "pick",
                "reject",
                "discard",
                "finish",
                "pack",
                "approve",
                "approve-with-exception",
                "publish",
            ]
        );
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
    fn derive_and_the_path_ops_are_not_callable() {
        for op in [
            "derive",
            "open",
            "import",
            "export",
            "conform",
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
        assert!(matches!(
            check(
                "finish",
                &json!({ "id": "e1", "method": "script", "description": "x" })
            ),
            Err(Refusal::UnknownArgument(_))
        ));
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
        ] {
            assert_eq!(lookup(op).unwrap().class, OpClass::Write, "{op}");
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
