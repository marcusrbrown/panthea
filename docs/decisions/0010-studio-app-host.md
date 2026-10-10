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

**Snapshots by polling `list`** (`poll.rs`). The host polls the sidecar's read-only ops on a timer re-armed after each tick, and pushes one full snapshot over a `Channel` only when it changes. It replays the cached snapshot to a new subscriber. `source-keys` rides in the snapshot, so preview changes travel the same channel. On the real 71 MB store every `status` or `list` takes about 160 ms (each re-reads the whole store), so an idle tick reads `status` alone, and the six lists are re-read only when the status changed, when this app changed something, or every fifth tick. That is the lesson of [the progress-poll starvation fix](../solutions/performance-issues/progress-poll-starved-job-drain-2026-10-08.md): a poll's cost must not make it always due. The gap is one second after a tick finishes. (2026-10-09: an editor save changes no count, so `status` also carries each open edit's saved-sheet hash, `openEdits`; a change re-reads the lists on the next tick. See [the edit-save lag learning](../solutions/performance-issues/studio-edit-save-lag-and-unreviewed-finish-2026-10-09.md).)

**Raw bytes over `ipc::Response`.** `preview_bytes(selection, v)` asks `source-bytes`, decodes the base64 in Rust and returns the PNG bytes. A stale version is a typed `stale-version` error. There is no custom URI scheme: it bypasses capabilities.

**Rust-only dialogs and a native editor launch.** Export folders, import files and the config file are chosen with `tauri-plugin-dialog` from Rust, off the main thread; the webview has no `dialog:*` permission. `edit_open` calls the session's `open`, takes `workspacePath` from the reply, strips it, and starts Aseprite on that file with `std::process::Command` (argv only, no shell scope). The Aseprite path comes from the config's `editor.executable`, then `PATH`, then the macOS bundle. No reply to the webview carries a path.

**Config.** The one setting is the path to a CLI studio config JSON, kept in the app data directory. With none set, no sidecar starts and the app reports `not-configured`; `studio_call` refuses with that reason. Choosing a config restarts the sidecar on it, after the old session releases the root.

**Quit (superseded 2026-10-09, see below).** The host closes the sidecar's stdin, waits `QUIT_BOUND` (5 s) for it to exit, then kills it. An idle session was measured at 10–18 ms from end of input to exit. A session that owns an image server also waits for that server's term grace (2 s in the creative-run config). The sidecar also self-terminates on parent death (`--parent-pid`).

**Quit (2026-10-09, supersedes the paragraph above).** Closing the sidecar's stdin is not enough: end of input makes a session drain its queue (the CLI's behaviour, kept), so a quit during a generation waited out the job, and the fixed 5 s bound then killed the sidecar mid-job and left its detached image server running. The host now retires the launch (pending requests fail, stdin closes), sends the sidecar `SIGTERM`, and waits for it to exit. The sidecar's interrupt path aborts the running job and stops the server group it owns before it releases the root's lock and exits. The wait is derived from the launch's own config: `runtime.deadlines.termGraceMs + killMs` (what the sidecar may spend stopping a server that ignores TERM) plus a 3 s margin, 15 s for the creative-run config. `QUIT_BOUND` (5 s) remains only as the fallback when the config's deadlines cannot be read. After the bound the host sends `SIGKILL`. `teardown.rs` tests the order (TERM, wait, kill) and the bound; `tools/studio/src/index.test.ts` pins that end of input followed by `SIGTERM` during a running job aborts it and leaves no server process.

**Deliberately absent.** No `tauri-plugin-single-instance`: a second app finds the root locked, and the session answers `busy`, which the UI shows as read-only. No custom URI scheme, no Finder reveal, and no webview `shell:*`, `fs:*` or `dialog:*` permission. `tauri-plugin-shell` is used only to spawn the sidecar.

## Consequences

- A sidecar that ignores end of input is killed after the bound. Its image server, in its own process group, is then not stopped by the session. This is the cost of a bounded quit. The runtime refuses to use a server it did not start (`endpoint 127.0.0.1:<port> is already in use`), so a survivor blocks the next generation until the owner stops it. (Narrowed by the quit change above: a quit now signals TERM first, so the server survives only if the sidecar ignores TERM for longer than the derived bound.)
- A snapshot costs the sidecar up to about 1.1 s of reads when the store changes, issued one at a time so the drain gets a turn between them. The store's growth makes this worse; a cheaper status read in the session would remove the need for the five-tick refresh.
- The schema table can drift from the dispatcher; the parity test fails when a row names an argument the session does not know.
- Native code launches an editor on a path from the sidecar's reply. That path is the session's own workspace file, never webview input.

## Correction: a held root

The "Deliberately absent" paragraph above says a second app finds the root locked and "the session answers `busy`, which the UI shows as read-only". That was never true: the session answered `busy` once and exited `1`, so the host restarted it three times and showed "Unavailable 3/3". Superseded: a session on a held root now stays up read-only. Reads are served, every other op is refused with `root-locked` naming the holder's pid, and `status` reports `rootLock`. The host maps a running sidecar whose polled `status.rootLock` is `other` to a distinct `read-only` state (`lockHolder` is the pid) that spends no restart and is never `unavailable`. The session takes the lock lazily, at the first write after the holder has gone; there is no lock polling. The earlier `sidecarPid` signal in snapshots was dropped in favour of this explicit state.

## Evidence/links

[Plan Unit 3](../plans/2026-10-08-003-feat-studio-tauri-app-plan.md), [ADR-0003](0003-simulation-service.md) (sidecar lifecycle), [ADR-0008](0008-world-state-and-client-transport.md) (changed-frame channel), [ADR-0009](0009-asset-registry-lifecycle-and-uris.md), `apps/studio/src-tauri/tests/sidecar_integration.rs`, [CSP learning](../solutions/integration-issues/koota-new-function-tauri-csp-2026-09-27.md).
