# studio-runtime: real local verification of the studio runtime adapter

## Question

Does the studio runtime adapter (`packages/assets/src/studio/runtime.ts`, built on `@panthea/assets/studio`) drive the selected local image runtime correctly end to end: readiness, native async API mapping, durable results, abort during real generation, and teardown that leaves nothing behind?

Status: one real run on one host, recorded below. This checks runtime correctness only. It says nothing about image quality, palette conformance, approval or publication.

## Method

- Host: Apple M1 Pro, 16 GiB, Darwin 24.6.0, Bun 1.4.2. macOS only; the Linux process-group behaviour is covered by fake-process tests and is not verified here.
- Artifacts: the staged files in the sibling main checkout, `../panthea/tools/probes/art-local-2`, not in this worktree (read only, nothing copied or modified): `bin/release/sd-server` (sha256 `37fa5c1d…cae`, the executable, not the release archive, whose hash differs by design) and the pinned model, text encoder and VAE. `SELECTED_PROFILE` is used unchanged: sd.cpp `master-929-3f8527a`, `z_image_turbo-Q3_K`, `Qwen3-4B-Instruct-2507-Q4_K_M`, `z-image-ae`, no LoRA, euler, 8 steps, cfg 1.
- SDK calls only (no probe execution code): `openStudioSession`, `newRequestRecord` with authored Greek content parsed by the production parsers, `session.submitRequest`, `openRuntime`, `runtime.drain`, `runtime.abort`, `runtime.shutdown`.
- Isolation: a disposable authoring root, one serial runtime child on a loopback port, an explicit empty child environment, finite deadlines (startup 120 s, HTTP 10 s, generation 300 s, TERM grace 2 s, KILL wait 10 s, poll 100 ms).
- Observation: the harness wrapped `globalThis.fetch` to record the request body and the shapes (never the base64) of the production code's own calls, and read `pid, ppid, pgid` from `ps`. Its process-group ownership checks were invalid (see Limitations). No proxy or second server.
- The harness and raw logs are local and untracked (`.context/studio-pipeline/u2-real-runtime/`): `events.jsonl`, `results-reconstructed.json`, the authoring-root stores and PNGs. No images are committed.

## Results (2026-10-06)

| Case | Result |
| --- | --- |
| Sprite, content-derived 512x640, seed `Number.MAX_SAFE_INTEGER` | succeeded. The server accepted that seed for this request; it is not a seed-range proof |
| Portrait, content-derived 768x768, seed 0 | succeeded |
| Sent `img_gen` body | equals the narrowed adapter input field for field: prompt, negative prompt, width, height, seed, `batch_count 1`, `sample_params {euler, 8, guidance.txt_cfg 1}`, `lora []`, `output_format png` |
| Stored result | the stored original PNG sha256 equals the job output hash; the production decoder returns the native width and height and `width*height*4` RGBA bytes |
| Native API shapes | `img_gen` answers 202 with `{created, id, kind, poll_url, status}`; job polls carry `{id, kind, status, created, started, completed, queue_position, result, error}`; a completed job has `result.images[]` of one `{b64_json, index}` |
| Abort during server-reported `generating` | the abort was ledgered about 1 ms after the first `generating` poll (about 52 ms after the job start); `abort()` returned ok after 51 ms. That is the SDK's own teardown check (group members gone, pipes closed), not an independent observation, because the harness's group check was invalid. The ledger and blobs confirm the cancelled job has no outputs and no blob |
| Next job on the same session | ran on a fresh child (pid 69555, replacing the aborted 66654), became ready and completed a 512x640 PNG whose hash matches its blob |
| Normal `shutdown` | returned ok on the first attempt (271 ms); the same root was reopened by the next session |
| Caller that throws while a job is generating, then `shutdown` in `finally` | in the separate corrected rerun, `shutdown` returned ok (60 ms) with no member of the owned group remaining when it returned, the interrupted drain settled `aborted`, the job was recorded cancelled, no blob was stored and the root reopened. No image was completed in this case |
| Survivors | no model group members at reconstruction time for the children 50118, 66654 and 69555. This is not an end-of-run observation; the corrected `finally` rerun independently found none when `shutdown` returned. The analyzer found the artifact hashes and the production source hashes matching their pins |

Timings, wall clock from the `img_gen` response to the completed poll: sprite 90 s, portrait 182 s, second sprite 94 s. The first child spawned about 6.8 s after the run started, mostly artifact verification, which was not timed separately; first readiness took about 7.9 s. The probe measured about 77 s (sprite) and 149 s (portrait); this run was slower, and the cause was not measured.

## Limitations

- Three completed images, one aborted job and one finally case only. Nothing here shows byte-identical output for the same seed and spec, and nothing is claimed about quality, art-guide or palette conformance, studio headroom, coexistence or Linux.
- The abort landed right after the server's first `generating` poll. The status carries no progress, so this does not show how far sampling had advanced.
- No late payload from an aborted job was observed: polling stopped and the child was killed first. Explicit late-output discard is covered by the fake-process tests only.
- The clean cancel-to-replacement-ready time was not measured. The harness's own synchronous `ps` calls blocked its event loop for about 24 s and 34 s; these are harness stalls and do not show an SDK bug. Whether the session stays responsive through abort and replacement was not measured with a timer heartbeat.
- The harness's process-group checks were invalid. Its first version recorded its own `ps` children, which inherited the harness's process group 49781, as owned (`ownGroup: false` in the events), so the old-group, replacement and main-run `finally` group checks are invalid. Its final cleanup SIGKILLed the supervisor group, which included the harness; other members of that group are unknown. The production SDK refuses a child that is not in its own process group and never kills the supervisor group. No claim is made that nothing foreign was affected.
- The first harness script exited 1 and lost its original summary. The valid claims above come from the raw events and the on-disk ledger and blobs, reconstructed, plus the separate corrected `finally` rerun, which exited 0. The harness as a whole did not exit 0.
