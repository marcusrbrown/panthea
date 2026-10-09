# 0010: Studio app host

## Status

Accepted (2026-10-09) for Unit 3 of the [packaged studio app plan](../plans/2026-10-08-003-feat-studio-tauri-app-plan.md). The window workflow (Unit 5) and the packaged preview (Units 4 and 6) build on it.

## Context

A delegated implementation decision under D26 and the approved plan. Owner approvals recorded 2026-10-08: `tauri-plugin-dialog`, a separate `Cargo.lock` for the studio crate, a new CI job, and a config that points at the CLI's own config file. Requirements: R8, R10–R12, R18, AE9 (asset studio requirements); the plan's parent Unit 7 crate checks.

The studio session (`tools/studio`) already speaks newline-JSON request and reply over stdio, takes no loopback port, and holds the root's lock for writes. The simulation host (`apps/desktop`) fits the lifecycle but not the transport. Its sidecar is polled over authenticated HTTP, and its capability grants the webview a short list of commands. The studio's file-path ops (`export`, `import`, `finish --png`) cannot be exposed to a webview that has no filesystem access.

## Decision

**Separate crate and lock.** `apps/studio/src-tauri` (`ai.panthe.studio`) has its own `Cargo.lock`. `apps/desktop` is untouched, so the two can move tauri versions independently; both pin `tauri =2.12.1` for now.

**Stdio multiplexer** (`mux.rs`). Requests carry monotonic ids and each has one pending reply, so replies may come in any order. A timeout applies per op class: reads 15 s, writes 60 s, `generate`/`reroll`/`abort` 180 s. A reply with an unknown id is dropped and logged by id only. Every attach and reply is fenced by `launch_id`: when a launch ends, its pending requests fail as retryable, and nothing a dead launch still says can complete a later launch's request. The reader frames lines itself with a 64 MiB bound, so multi-megabyte base64 atlases arrive whole. The sidecar's stdout carries replies only.

**Per-op argument schema** (`schema.rs`). `studio_call(op, args)` checks the op and every argument name against one table before the sidecar is contacted. The table is the contract, and a parity test drives the real session with each row. No row names a path. `generate` omits the masked-edit fields, `finish` takes only `id`, and `derive`, `open`, `import`, `export`, `conform` and `source-bytes` are not callable through it. Values are not checked in Rust; the session's dispatcher owns types and required arguments.

**Snapshots by polling `list`** (`poll.rs`). The host polls the sidecar's read-only ops on a timer re-armed after each tick, and pushes one full snapshot over a `Channel` only when it changes. It replays the cached snapshot to a new subscriber. `source-keys` rides in the snapshot, so preview changes travel the same channel. On the real 71 MB store every `status` or `list` takes about 160 ms (each re-reads the whole store), so an idle tick reads `status` alone, and the six lists are re-read only when the status changed, when this app changed something, or every fifth tick. That is the lesson of [the progress-poll starvation fix](../solutions/performance-issues/progress-poll-starved-job-drain-2026-10-08.md): a poll's cost must not make it always due. The gap is one second after a tick finishes.

**Raw bytes over `ipc::Response`.** `preview_bytes(selection, v)` asks `source-bytes`, decodes the base64 in Rust and returns the PNG bytes. A stale version is a typed `stale-version` error. There is no custom URI scheme: it bypasses capabilities.

**Rust-only dialogs and a native editor launch.** Export folders, import files and the config file are chosen with `tauri-plugin-dialog` from Rust, off the main thread; the webview has no `dialog:*` permission. `edit_open` calls the session's `open`, takes `workspacePath` from the reply, strips it, and starts Aseprite on that file with `std::process::Command` (argv only, no shell scope). The Aseprite path comes from the config's `editor.executable`, then `PATH`, then the macOS bundle. No reply to the webview carries a path.

**Config.** The one setting is the path to a CLI studio config JSON, kept in the app data directory. With none set, no sidecar starts and the app reports `not-configured`; `studio_call` refuses with that reason. Choosing a config restarts the sidecar on it, after the old session releases the root.

**Quit.** The host closes the sidecar's stdin, waits `QUIT_BOUND` (5 s) for it to exit, then kills it. An idle session was measured at 10–18 ms from end of input to exit. A session that owns an image server also waits for that server's term grace (2 s in the creative-run config). The sidecar also self-terminates on parent death (`--parent-pid`).

**Deliberately absent.** No `tauri-plugin-single-instance`: a second app finds the root locked, and the session answers `busy`, which the UI shows as read-only. No custom URI scheme, no Finder reveal, and no webview `shell:*`, `fs:*` or `dialog:*` permission. `tauri-plugin-shell` is used only to spawn the sidecar.

## Consequences

- A sidecar that ignores end of input is killed after the bound. Its image server, in its own process group, is then not stopped by the session. This is the cost of a bounded quit. The runtime refuses to use a server it did not start (`endpoint 127.0.0.1:<port> is already in use`), so a survivor blocks the next generation until the owner stops it.
- A snapshot costs the sidecar up to about 1.1 s of reads when the store changes, issued one at a time so the drain gets a turn between them. The store's growth makes this worse; a cheaper status read in the session would remove the need for the five-tick refresh.
- The schema table can drift from the dispatcher; the parity test fails when a row names an argument the session does not know.
- Native code launches an editor on a path from the sidecar's reply. That path is the session's own workspace file, never webview input.

## Evidence/links

[Plan Unit 3](../plans/2026-10-08-003-feat-studio-tauri-app-plan.md), [ADR-0003](0003-simulation-service.md) (sidecar lifecycle), [ADR-0008](0008-world-state-and-client-transport.md) (changed-frame channel), [ADR-0009](0009-asset-registry-lifecycle-and-uris.md), `apps/studio/src-tauri/tests/sidecar_integration.rs`, [CSP learning](../solutions/integration-issues/koota-new-function-tauri-csp-2026-09-27.md).
