# Studio Tauri app: packaged evidence, headroom and parity

**Scope: the packaged `panthea-studio.app`, run against the real local image runtime on one host.** This covers the owner workflow states, AE6 (queue, remove, abort, restart), AE9 (CLI and app parity), the three negative claims, the packaged-app checks and one headroom run. It is not a quality or art verdict, and it says nothing about Linux, Windows or the game client. What was not proven is listed at the end.

Plan unit: studio app plan (`docs/plans/2026-10-08-003-feat-studio-tauri-app-plan.md`) U6; parent plan Unit 7. Requirements: R8, R10–R12, R16–R18, AE6, AE9; product rows U08 and X02.

## Method

- Host: Apple M1 Pro, 16 GiB, macOS 15.7.9, Bun 1.4.2, Aseprite installed under `/Applications`. Display kept awake for the run.
- App: `bun run tauri build --bundles app` in `apps/studio` at the commit that fixed the conform-set spacing, so the sidecar and the app are the ones built from that tree. The bundle was copied into a scratch directory and run from there. Its sidecar is the bundled `panthea-studio-sidecar`; the lab and parity runs below use that same binary, not the repository source.
- Runtime: the pinned sd.cpp server and models staged under `<main-checkout>/tools/probes/art-local-2` (read only; nothing moved or copied). Z-Image-Turbo Q3_K, 512×640, `SELECTED_PROFILE` unchanged.
- Store: a scratch copy of the owner-run creative pass's studio store (never the original), a scratch copy of the canon registry, and a config derived from that pass's config with one conform set (`ae9-key`: key background, alpha cutoff 128, grid 8/0.6/20, scale 8). Each run below used its own fresh copy, so the runs do not see each other's records.
- Windows are captured with `screencapture -o -x -l <window id>` (window only, no shadow, never the desktop), then reduced from the 2× backing store to 1× and cropped. The 1× images are therefore a downscale of a Retina capture: text is slightly soft. Crops are of the area that shows the state; none is edited.
- The window was driven with the macOS accessibility API (press a named button, focus a named field, type) and the wheel; the app itself was not modified or instrumented. Store contents were read with `readStudioStatus` (lock-free) from outside.
- Before every GPU run: no `sd-server` or `sd-cli` process and no model loaded in Ollama. After every run the app, sidecar and server were gone.

## States

All are the real app on this host. The renderer is on WebGL2: `navigator.gpu` is undefined in this host's WKWebView (`tools/probes/webgpu-wkwebview`, re-run for this unit, default and with every GPU feature flag forced on), so the preview falls back to WebGL2 by D25. The backend name is not shown in the packaged window, so this is inferred, not observed.

| State | File | How it was produced |
| --- | --- | --- |
| Not configured | `not-configured.png` | The app launched with no saved config path |
| Unavailable / staging | `unavailable-staging.png` | A config whose artifact root is an empty directory; one job queued from the form; the job ends `unavailable` with the staging reason |
| Queued | `queued.png` | Three jobs queued from the form (one request, batch 3) before the runtime started |
| Running | `running.png` | The first job `running`, the other two `queued` |
| Aborting / restarting | `aborting-restarting.png` | About 1.2 s after Abort: the aborted job is `cancelled` with the restart note; the third job is `queued` and its Remove button is enabled |
| Cancelled | `cancelled.png` | After the restart: the aborted job `cancelled` (Retry offered), the removed job `removed` |
| Failed | `failed.png` | Two failed jobs from the owner-run store ("interrupted: the session ended while the job was running / queued"). Not produced in this unit |
| Completed | `completed.png` | The third job `completed` on the replacement server |
| Root locked (read-only) | `root-locked.png` | A second app instance (separate user directory) on the same config while the first held the root: "Locked by another studio session (pid N)", header "Read-only (held by pid N)". N is the first app's sidecar, checked with `ps` |
| Editing externally, with a saved edit's diff and report | `editing-externally.png` | "Edit draft" opened an edit and launched the real Aseprite on the workspace file. A scripted batch Aseprite run then redrew one pixel and saved over the same workspace file; the app's watcher imported it ("Saved version · Report only"): frame 1 FAIL on `palette`, 1 pixel changed against the recorded version, pixel diff listed |
| Export/import fallback | `export-import-fallback.png` | The same draft with no editor configured: "Editor unavailable. No Aseprite workspace for this edit. Use export and import below." |
| Failed conformance needing an exception | `failed-conformance.png` | A packed draft whose report is `fail` (`portrait/neutral:palette`): no plain Approve is offered; "Approve with exception" stays disabled until a reason is typed |
| Blocked publish | `blocked-publish-notice.png`, `blocked-publish-record.png` | An approved draft packed against a registry revision that has since moved; "Publish this revision" is refused: "the registry changed since this asset was packed; pack it again against the current revision" |
| Placeholder fallback | `placeholder-fallback.png` | The preview with a portrait draft selected: the sprite slots draw placeholders and the portrait panel draws the draft (with its off-palette pixel visible) |

Image sizes (bytes): `not-configured` 25,902; `unavailable-staging` 26,401; `queued` 15,307; `running` 15,204; `aborting-restarting` 33,176; `cancelled` 14,683; `failed` 12,878; `completed` 7,182; `root-locked` 17,393; `editing-externally` 40,300; `export-import-fallback` 20,920; `failed-conformance` 33,342; `blocked-publish-notice` 9,988; `blocked-publish-record` 28,414; `placeholder-fallback` 11,971; `live-reload-before` 14,755; `live-reload-after` 14,723. About 340 KB in all, lossless; the text-heavy crops do not compress further.

The draft records for the failed-conformance, editing, fallback and blocked-publish states were built through the bundled sidecar's session (`set-create`, `pick`, `open`, `export`, `import`, `finish`, `pack`, `approve`, `publish`) in a scratch copy of the store, with two off-palette pixels written into the neutral portrait frame by a script. They are test records, never published to the real registry.

## AE6: queue three, remove the second, abort the first

On the packaged app, real runtime, one request with batch 3 (`zeus` idle/south). Remove and Abort were pressed through the window. Times are from the store's command ledger, not from the UI.

| Run | Enqueue → first job starts | First start → Remove | Remove → Abort | Abort → third job starts | Third job runs |
| --- | --- | --- | --- | --- | --- |
| 1 (built before the two CSS fixes) | 12.76 s | 7.41 s | 0.33 s | 1.97 s | 95.73 s |
| 2 | 10.77 s | 5.13 s | 1.18 s | 1.87 s | 93.29 s |
| 3 (with window captures) | 11.79 s | 4.53 s | 0.65 s | 1.67 s | 89.74 s |

- The first job went `cancelled` in the same ledger event as the abort; the second went `cancelled` (shown as removed) at Remove. The aborted job has no outputs and no blob; the request has no candidate.
- The runtime restarted: the old server pid was gone and a new one took its place (run 1: 38015 → 38155, the new one seen 0.8 s after the abort; run 2: 66938 → 67288; run 3: 69327 → 69440, which the sampler labelled with each pid it read). The third job started 1.7–2.0 s after the abort and completed.
- **The UI said "about 37 seconds" during these runs.** The measured abort-to-next-job-start is 1.7–2.0 s. The model loads inside the next job, which ran as long as an uncontended first job (about 90 s), so the restart did not add a visible wait. The 37 s copy is not measured here and looks stale. The note was on screen for at least 3.6 s and gone by 7.9 s (run 1, polled).
- Remove stayed available on the queued job during the restart note: polled 3.6 s after the abort in run 1, and visible in `aborting-restarting.png` in run 3. The note's own text is "Queued jobs can still be removed."
- The first Remove click in run 1 hit the running job's Remove button (the card had not yet switched to Abort) and was refused with "job … is running, not queued"; a second click worked. In runs 2 and 3 the first click worked.
- While the restart note is up, it is drawn on every cancelled card in the list, including cancelled jobs from earlier sessions (seen in a misframed capture of run 2, not kept). It is cosmetic.

## AE9: the same request and seed through the CLI and the app

Request: subject `zeus`, kind `sprite`, slot idle/south, batch 1, resolved by the app's own Resolve button (request id `zeus-020624e0`, seed 2356310476). The app generated it, then conformed it with the `ae9-key` set from the card's Conform set select. The CLI path re-ran the same request id and the same seed through `generate` and `conform --set ae9-key` of the bundled sidecar in a fresh store, one shot. `tools/studio/src/parity.ts` then read both candidates without the writer lock and compared the decoded generated image, the decoded conformed 1× image, the conformance report and the metrics.

| | Output PNG sha256 (prefix) | Conformed image sha256 (prefix) | Report | Result |
| --- | --- | --- | --- | --- |
| App | `4821d00b594b` | `189e43b1644e` | pass | |
| CLI, same seed | `4821d00b594b` | `189e43b1644e` | pass | **identical**: 0 of 327,680 generated pixels and 0 of 5,120 conformed pixels differ; report, metrics, params and the job's recorded settings equal; exit 0 |
| CLI, seed + 1 (control) | `3615d5a03d75` | `14ef82a2c9d9` | pass | **differs**: 327,672 of 327,680 generated pixels, 1,387 of 5,120 conformed pixels, `coloursMerged` 888 against 1,209; exit 1 |

The control uses the same request id, so only the seed differs. An earlier control (a different request id and a different seed) differed the same way (327,678 of 327,680 generated pixels).

`tools/studio/src/parity.test.ts` pins the comparison itself and the same-seed/different-seed pair against the staged fake runtime in `bun run check`; the real run is the scripted step above.

The resolved seed is not a function of the request alone: resolving the same request under the same id in the CLI gave 3,867,857,982, not the app's 2,356,310,476. Parity was therefore taken from the seed the app recorded, not from a re-resolve.

## Negative claims, each with a control that flips it

All through the bundled sidecar's session on a scratch copy of the store.

| Claim | Result | Control |
| --- | --- | --- |
| Plain approve refuses a failed report | `approve` of the failed-report draft: refused, `wrong-state`, "conformance failed; approval needs an owner exception with a reason". The window offers no plain Approve for it | `approve` of a passing-report draft: approved, basis `report-pass`. `approve-with-exception` of the failed one with a reason: approved, basis `owner-exception` |
| Late output after abort never becomes a candidate | The aborted job (pid gone) has no output, no blob and no candidate; the request has no candidate (checked in the store after run 3) | The replacement server's job succeeded with one 454,421-byte output. **Not proven on the real runtime:** the abort kills the server, so it cannot answer late. The discard path is covered only by `runtime.test.ts` ("output the old child produces after the abort is never stored or promoted") against the staged fake runtime |
| A stale confirm revision is refused | `publish` with `confirm: "stale"`, and with another draft's revision: refused, `revision-mismatch`, "the confirmed revision is not the asset's current revision"; nothing published | `publish` with the current revision: published (into the scratch registry copy). The window always sends the current revision, so this was driven through the session, not by a click |

Publishing a draft whose registry moved is a different refusal, `wrong-state` ("the registry changed since this asset was packed …"); that one was clicked in the window (Blocked publish above).

## `edit-report` against real saves

Three saves of one neutral-portrait edit through `import` (the export/import path): save 1 changed (40,21) to an off-palette colour: 1 pixel, frame `fail`, `palette`. Save 2 added a second changed pixel: the report diff names only (40,22), measured against save 1, not against the base. Importing save 2 again changed nothing (`changed: false`) and the report stayed as it was: it is not a save. After `finish` the same reply is `state: finished`. The window's saved-edit panel came from the watcher's own import of a scripted Aseprite save (above): 1 pixel changed against the recorded version, `palette` failing.

## Packaged checks

- **CSP and renderer imports.** The packaged CSP (`script-src 'self' 'unsafe-eval'`, `connect-src ipc: http://ipc.localhost`, `img-src 'self' asset: http://asset.localhost data:`) was in force. The preview drew the canon portrait, the draft sprite and the placeholders from atlas bytes read through the command bridge. A blocked import or eval would have left no canvas. No console was available (see below), so no violation count is claimed.
- **Live reload after a draft rewrite.** With the app open on a draft sprite (`live-reload-before.png`), the draft's atlas was rewritten in the store (red and blue channels swapped, new content hash, record repointed) while the app ran. About 8 s later the preview drew the recoloured sprite (`live-reload-after.png`), with no reload and no click.
- **Forced device loss.** **Not run.** The preview harness's loss hook is `window.__studio.preview` / `onDeviceLost`, reachable only from page script; the packaged app has no devtools and no debug URL. Device-loss recovery is covered by `preview.test.ts` and was exercised in the browser run (`docs/evidence/asset-studio/unit6/README.md`), not in the packaged app.

## Headroom

One real Z-Image 512×640 job (`zeus` idle/south, seed from the resolved request) queued from the window of the running packaged app, on a store of its own, with `tools/probes/studio-headroom` sampling every 1 s from before the job (the worker first appears 45 s into the series). Method and sampler are in that probe's README.

| | Before the job (45 s) | While the worker was up (143 s: the 110.0 s job, then the idle server) |
| --- | --- | --- |
| Worker RSS | no worker | peak 3,776 MiB (pid 87612, the only worker pid) |
| Worker physical footprint | no worker | peak 8,548 MiB (same pid); 8,547 MiB at the last sample, still resident |
| Studio app RSS (footprint) | 84 MiB | peak 96 MiB (footprint peak 34 MiB) |
| Sidecar RSS (footprint) | 328 MiB | peak 438 MiB (footprint 46 → peak 331 MiB, 160 MiB at the end) |
| Memory pressure | normal 45 of 45 | normal 18, warn 125, critical 0 |
| Swap used | up to 8,701 MiB | up to 13,041 MiB; swap total grew from 10,240 to 13,312 MiB |
| Free pages (vm_stat) | min 61 MiB | min 14 MiB |
| Free disk | 38,608 MiB at the start | min 34,337 MiB; 35,369 MiB at the end |
| `status` round trip (sidecar, read only) | median 168, p95 187, max 203 ms | median 238, p95 408, max 682 ms; 0 of 188 failed over the whole run |

- The job took 110.0 s, slower than the 89.7–95.7 s of the AE6 jobs; the cause was not measured (the machine already had 8.7 GB of swap in use before the job).
- The worker's RSS is less than half its footprint: judge by the footprint. The swap and disk movement match each other (swap grew by 3 GiB, free disk fell by about 4 GiB); the disk drop was not separately attributed.
- The AE6 runs sampled the same way and saw the same shape: worker footprint peaks of 8,452 and 8,456 MiB (RSS 4,130 and 3,785 MiB), pressure critical in 2 samples each of 115 and 128, round trip median 183 ms (p95 240, max 342) and 183 ms (p95 319, max 653), no failed reads.
- Responsiveness here is the sidecar answering `status` through a second read-only session, not the app's command bridge through the webview.

## Quit during a generation

After the quit change (the app signals the sidecar to stop, so it aborts the running job and stops the image server it owns, instead of closing its input and waiting out the job), the packaged app was quit while a real job ran.

Method: the packaged app on the same host as the other runs, against a scratch copy of the owner-run store and a copy of the creative config (models in the main checkout), with its own user directory. One Z-Image 512×640 job was queued from the window (Resolve request, then Generate, slots reduced to `idle/south`). Once the store showed the job `running` and an `sd-server` process existed, and 3 s later, the app was quit with Cmd-Q. The quit duration is from the keystroke until both the app and its sidecar process were gone. Then `pgrep` for `sd-server` at exit, 5 s and 30 s, the job record, the candidates directory, and a second sidecar session on the same config.

| | Run 1 | Run 2 |
| --- | --- | --- |
| Job state when quit | running (3 s after the server appeared) | running (same) |
| Quit duration | 0.62 s | 0.57 s |
| Host log | `sidecar teardown: Graceful` | `sidecar teardown: Graceful` |
| `sd-server` processes at exit, +5 s, +30 s | none, none, none | none, none, none |
| Job record afterwards | `cancelled`, `cancelledBy: aborted`, no outputs | same |
| Candidates for the job | 0 | 0 |
| Second session opened on the same store | writer: `rootLock` `holder: self`, owner open | same |

- The quit did not wait out the job (about 90 s) and did not need the 15 s bound: the sidecar exited on its own within a second.
- The old behaviour was not re-run as a control on the real runtime; its cause (end of input drains the queue, then the bound kills the sidecar) is from the code, and the order of the signals is pinned by `teardown.rs` tests.

## Edit-save lag

An editor save imported by the session's watcher changes no job or edit count, so the app saw it only on the poller's every-fifth-tick full read. `status` now also carries each open edit's saved-sheet hash (`openEdits`), and a change in it makes the next tick re-read the lists.

Method: the built sidecar on a scratch copy of the 71 MB owner-run store, the native poller's tick logic reproduced in a script (status every tick, the six lists when status changed or every fifth tick, a 1 s gap), and one edit imported at a random time 14 times; the lag is from the import's reply to the first tick whose lists carry the new hash. The old status was emulated by dropping `openEdits` from the same reply.

| | Runs | Min | Median | Max |
| --- | --- | --- | --- | --- |
| Before (`openEdits` dropped) | 14 | 2.72 s | 5.32 s | 7.50 s |
| After | 14 | 1.52 s | 1.85 s | 2.58 s |

The plan's target was about 1 s. What remains is one tick's own cost (a status read of about 160 ms plus six list reads at about 160 ms each, so about 1.2 s) plus the 1 s gap: a save lands at a random point in that cycle. A cheaper list read in the session is the only way below it. Measured on the sidecar and the reproduced tick logic, not through the app's window.

## Findings from the run

1. **The "about 37 seconds" restart copy was not what the runtime does** (above). After these runs the copy dropped the number: "Restarting the image server. The next job reloads the model." The screenshots show the old text.
2. **`blockedReason` is read by the workflow view but nothing sets it.** `Workflow.tsx` disables Publish and shows "Publish blocked: …" only if the asset summary carries `blockedReason`; the host's summaries never do (grepped across `tools`, `packages`, `apps`). So the Publish button is never disabled ahead of time: a blocked publish is only discovered by clicking it and reading the refusal banner. The refusal itself is correct and clear.
3. The resolved seed is not a function of the request or its id: resolving the same request under the same id gave 2,356,310,476 in the app and 3,867,857,982 in the CLI (parity above).

## What was not proven

- **Forced device loss in the packaged app** (above).
- **The WebGL2 backend by observation.** Inferred from `navigator.gpu` being undefined in this host's WKWebView.
- **Late output after an abort on the real runtime.** Only against the fake runtime.
- **The quit proof is two runs of one job on one host**, and the old quit was not re-run as a control. A model that ignores TERM for longer than the derived bound is not covered (it would be killed).
- **Edit-save lag through the app's window.** Measured with the reproduced tick logic, 14 saves; it is still about 1.9 s, not the plan's 1 s.
- **A hand save in the Aseprite window.** The save that reached the watcher was a scripted batch run of the real Aseprite over the workspace file while its window was open. No pixel was drawn by hand.
- **`editor-unavailable` and `launch-failed` in the packaged app.** The fallback shown is the no-workspace reason only; the other two are unit-tested (`EditPanel.test.tsx`).
- **Responsiveness through the app's own command bridge.** Measured on the sidecar only.
- **One run per scenario for headroom and AE9, one host.** No run beside an inference model or the game; the headroom numbers say nothing about either.
- **Image size.** The captures total about 340 KB, not the roughly 100 KB the unit 6 set used; they are lossless crops and were not quantized.
- The failed-job capture is a record from the owner-run store, not a failure produced in this unit.
- No hosted provider, purchase or publication was involved. The one `publish` ran against a scratch copy of the registry.

## Cleanup

Each run ended with no app, sidecar, `sd-server`, `sd-cli`, Aseprite or sampler process running, and the scratch stores, registry copy, config files and app bundle copy were deleted.
