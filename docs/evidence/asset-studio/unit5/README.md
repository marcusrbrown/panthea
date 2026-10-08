# Unit 5 acceptance evidence: first real generation run

**Status: partial.** This records one local run of the real studio CLI host and the selected local runtime. It is not the Unit 5 acceptance run. No image here has been judged, conformed, edited, packed, approved or published, and no real Aseprite run through the CLI has happened yet.

The sections up to "Limits" describe that first run only. Later sections record the Zeus portrait's generation, cleanup, approval and publication (2026-10-08) and the deferred Zeus idle-south sprite.

## What ran

- **Host:** macOS (Apple silicon, 16 GiB), Bun 1.4.2, the studio CLI's long-lived stdio session (`tools/studio`, `main()` driven in-process so a timer shares the host's event loop). One authoring root, an empty temporary registry (the committed canon was not touched), the committed Greek content, and the staged artifacts of the selected profile read in place without copying or downloading.
- **Runtime facts, as the SDK recorded them on each succeeded job:** sd.cpp `master-929-3f8527a` (commit `3f8527a4…`, MIT); `z_image_turbo-Q3_K`, `Qwen3-4B-Instruct-2507-Q4_K_M` and `z-image-ae` (Apache-2.0); no LoRA; euler, 8 steps, cfg 1; native generation 512×640 for the sprite and 768×768 for portraits; batch 1. The SDK's preflight verified the pinned sizes and SHA-256 of the binary and all three components once per session, before that session's first server start, and the artifact files were unchanged afterwards (size and mtime).
- **Inputs:** `tools/studio/src/fixtures/zeus.ts` holds the requests: Zeus idle south (seed 20261006), one portrait request over the six vocabulary expressions (base seed 20261007, so each job takes the base plus its ordinal) and a three-slot idle sprite request for the queue check (base seed 20261008). Every seed, id and timing is explicit. No conformance parameters are given anywhere, so none were run.

## Seven drafts, batch 1

Session A queued the sprite and the portrait request and served them serially on one resident server, then ended at end of input with exit 0. All seven jobs succeeded, each with one original PNG stored under its content hash. Start-to-success time is from the ledger.

| Slot | Seed | Size | Seconds | Original PNG sha256 |
| --- | --- | --- | --- | --- |
| idle/south | 20261006 | 512×640 | 88 | `7cca7e0d3b205bc53682a81e50a4037803c7d8b3f69c4082fc9c8895f32d7281` |
| neutral | 20261007 | 768×768 | 154 | `9b1666454f9343fb3774d75af3da26753eecd61f6f295fcdbab89ce84d54731a` |
| pleased | 20261008 | 768×768 | 160 | `d708f976d3a5314df7c8272493e0c89abfc22a1caac44a11aa940488a0346e45` |
| angry | 20261009 | 768×768 | 164 | `7a4105b9c3582e14ddc06a68bc22dce6bc067a00fcf5a093c6733497dcef2c08` |
| grieving | 20261010 | 768×768 | 156 | `587cdf78ba3eebac4f7e40295fce9b5118e9ba763f7feb865ae2f4bf78e4422c` |
| scheming | 20261011 | 768×768 | 156 | `9d8e313dfedc78737375a43eb89bb1d0b4b5e0ef5e6e92646082c58fa40b038a` |
| awed | 20261012 | 768×768 | 155 | `7616b8caee1fc1e2b4682718bf80ac96961ab0f3f058a603e693b2a5afb780fe` |

The whole session took about 17 minutes, which includes the first preflight hash of the artifacts. The originals are kept unmodified in the local authoring root. Nothing here says the images are good, on model, or usable, and nothing says that the same seed would give the same bytes again.

## Queue check

Session B used a fresh process, then queued three jobs on one request. After the server reported `generating` for the first, the second was removed (it never reached the server) and the first was aborted. The third then ran on a fresh server and succeeded (idle/east, 512×640, `0a460f85ac7f9ca372e84db005db886cfb7fd12fd5e62c49f750e78f618fe0b1`, seed 20261010).

- **Ledger order:** enqueue ×3, start first, remove second, abort first, start third, succeed third; the second is `cancelled` by `removed`, the first `cancelled` by `aborted`, and neither has an output or a blob.
- **Timing:** abort was sent 0.19 s after the first job's start was ledgered, and its answer, which waits until the old server's process group is gone and its pipes are closed, came 52 ms later. The replacement server answered its first readiness request 0.83 s after the abort was sent. That is readiness of the HTTP endpoint only; model loading happens on the first request, and the third job took 84 s from start to success. The SDK's own check found the old process group gone before it answered the abort. A separate observation, taken only after the third job had completed about 85 s later, found the old process gone and the replacement a different process in its own process group.
- **Responsiveness (R8):** a 10 ms timer on the host's own event loop ran from the remove request through the third job's success (85.6 s). Its worst gap was 112.6 ms, a 38 ms gap fell right after the abort answer, and 12 of 7371 ticks exceeded 25 ms. Status requests sent every 250 ms through the window were answered in at most 6.1 ms (339 probes). No synchronous process or file call was made by the harness inside the window. The runtime's own synchronous process-table reads were not changed or removed, so the figures include them. R8 states the requirement without a number, and these figures are observations, not a pass threshold.
- **During the seven drafts,** the same timer's worst gap was 150.8 ms over 17 minutes, with about 70 ms pauses around each finished job.
- Seeds in the queue request repeat three of the portrait seeds numerically; the requests differ in prompt and size.

## Teardown

Session A ended at end of input and session B on `SIGTERM` with the server resident (exit 1, interrupted, as designed); the owned server was stopped before the root lock was released in both. Afterwards no `sd-server` process remained, nothing listened on the configured port, and the authoring root reopened. Approval and publication were never invoked.

## Limits

- One host, one run, macOS only. No Linux or Windows evidence, and no app parity.
- The progress lines on stderr missed the last job's final `succeeded` transition in each drain; completion was taken from the ledger. This was not changed.
- The aborted server was stopped early in its job, when its resident size was about 365 MB, so the model was not yet resident. The only stop of a server with the model resident was session A's end-of-input shutdown, where the nearest heartbeat gap was 35.1 ms. No late payload from a cancelled job arrived in this run: polling stopped and the group was killed first, so discarding a late payload has only been exercised with the fake runtime.
- The real editor has not been run through the CLI. Conformance, hand edits, packing, owner approval and publication remain to do, and the unit's acceptance depends on them.

## Zeus portrait: published canon (2026-10-08)

**Status: owner-approved and published.** Six expressions, one asset `zeus-portrait`, canon revision `7cbaf7aa67a604b70b9c721dd0b31123d984c1e3034f10cba70c84e277c09c2d`. This covers the portrait only; it does not cover the idle-south sprite (below), and it is not a claim about repeatability beyond what is measured here. Images are in `zeus-portrait/`.

### Generation

Host and runtime as in the first run: macOS (Apple silicon, 16 GiB), sd.cpp `master-929-3f8527a`, `z_image_turbo-Q3_K`, `Qwen3-4B-Instruct-2507-Q4_K_M`, `z-image-ae`, no LoRA, euler, 8 steps, 768×768, batch 1. Each job's record names its base, mask, strength and sampling settings, and the packed manifest carries them.

- **Neutral base:** plain text-to-image, job `zeus-portrait-neutral-u7-r3-0001`, seed 20261019, `txt_cfg` 1, output `c3097cd1e2a1c2fcb11545603856a4e5ec6ea811baa5f218c392135c1e8a47ba`.
- **Five expressions:** masked img2img edits of that output, strength 0.6, `txt_cfg` 7, `distilled_guidance` 1, mask `3ef085137ef68e82ce7b89ad71a1538d97b7564f6c36a2408da71da9d922830b`. Each edit's prompt is "same Greek god Zeus, preserve the same head, hairline, face shape, eyes, beard, skin and composition; " plus the cue.

| Expression | Job | Seed | Cue | Output PNG sha256 |
| --- | --- | --- | --- | --- |
| pleased | `zeus-portrait-pleased-edit-u7-r8-0000` | 20261012 | warm broad smile, cheeks raised, crinkled eyes | `a0c41cfcb3ff83867b8583bf105d87d4ccfd5ac11b12ef73fa03b1ca8c64f8e5` |
| angry | `zeus-portrait-angry-edit-u7-r3-0000` | 20261010 | furious scowl, brows drawn hard down | `0c56cef77fc2c08734c4c0bbe385f39f986c0fbf87fbc7849f0913beb12fdc68` |
| grieving | `zeus-portrait-grieving-edit-u7-r8-0000` | 20261011 | grief-stricken, inner brows raised, eyes downcast, mouth turned down | `5b02acd25443a6761eb340484c0923e07d1367a2531d570422ab14725ba82fee` |
| scheming | `zeus-portrait-scheming-edit-u7-r8-0000` | 20261012 | sly one-sided smirk, one brow raised | `eb82c985ac96231d6aea1ba09071ed434a4c087d1107a2ab10abcf3d03f963a7` |
| awed | `zeus-portrait-awed-edit-u7-r8-0000` | 20261013 | astonished, brows high, mouth slightly open | `0e08cc950007713af7c885d8496a3149d283b40446f154f16710deceb265a823` |

The mask is a 768×768 black-and-white PNG with three white regions: two brow-and-lid bands (bounding boxes x371–464, y225–251 and x478–539, y221–249) and one mouth-and-beard region (bounding box x397–549, y337–436). The eyes are outside it.

**What was measured about reproducibility.** The five CFG 7 edits match the earlier command-line probe's outputs pixel for pixel (decoded rgb24 MD5 equal for all five); the PNG files differ in an embedded text chunk, so the file hashes differ. The probe's `--guidance 1` is the distilled guidance and its `--cfg-scale` stayed at 7. The studio first sent `txt_cfg` 1, which gave different pixels (for angry, `b0b98e16…` against the probe's `da897619…`); the edit path now sends `txt_cfg` 7 with `distilled_guidance` 1, and that is what the five jobs above ran. Nothing was measured for the neutral base (one CFG 1 run), so no claim is made that its seed reproduces it.

### Cleanup

The six conformed 96×96 candidates, one per expression, are the starting point. The studio edit `zeus-portraits-scripted-fleck-noise-cleanup-u7-r10c` imports a sheet made by `tools/probes/art-edit/portrait_cleanup_r10.py` from those six frames alone (it does not read another frame and does not build on the earlier cleanup edit). It is a deterministic script, not hand drawing; unit tests are in `tools/probes/art-edit/test_portrait_cleanup_r10.py`.

It may only: replace an isolated single pixel with the majority of its four neighbours; replace a small orange or bright-cream group in the beard zone with its surrounding colour; and sharpen a cool mid-tone pixel that doubles or breaks the 1 px outline. It changes no eye or brow pixel (rectangles x44–59 and x59–72, y22–38) and no mouth line (a cool or dark pixel in the mouth box x48–70, y41–56 that touches another, and anything 4-adjacent to one). Four pixels the rules would change are kept as generated, as transitional shading (angry (51,47), (52,51), (59,54); awed (49,48)), and one exterior pixel, (74,82), is set to the background in every frame.

| Frame | Changed pixels | Outline | Isolated | Fleck | Exterior |
| --- | --- | --- | --- | --- | --- |
| neutral | 74 | 45 | 17 | 11 | 1 |
| pleased | 61 | 28 | 25 | 7 | 1 |
| angry | 71 | 30 | 34 | 6 | 1 |
| grieving | 61 | 27 | 26 | 7 | 1 |
| scheming | 60 | 29 | 23 | 7 | 1 |
| awed | 69 | 29 | 30 | 9 | 1 |
| **total** | **396** | | | | |

Checked from the stored frames, not from the script's report: 0 changed pixels in the eye rectangles and 0 on a mouth line, in every frame. Three lone grey specks inside the mouth box were changed because they touch no line (angry (51,44), grieving (49,46), scheming (51,47)). The cream masses beside the mouth lines were left: they are lip and beard highlights and are 51–92 pixels per expression, essentially unchanged. The per-pixel change list and the exclusion list (each refusal with its reason) are in the local review folder `.context/studio-pipeline/u7-creative/r10c/review/cleanup-changes.json`, which is scratch and not committed.

An earlier cleanup edit (`…-u7-r10`, 388 pixels) is superseded by r10c; the two differ by 12 pixels. Earlier cleanups that painted or replaced mouths were rejected (below) and are not part of this asset.

### Review outcome

- Earlier drafts were rejected (inhuman and inconsistent eyes, mouths that could not be told apart, a comical "O" for awed).
- The owner judged the masked-img2img portraits from the combined mask the best drafts so far, with the expressions correct and the images acceptable with cleanup (more distinct mouths and sharper edges were asked for). Two cleanup attempts that added or replaced mouths were rejected.
- An independent visual review of the scripted cleanup found no mouth added and no expression changed, kept the three grey-speck removals and the cream masses, and asked for the four pixels above to be restored and two exterior pixels set to the background. That produced r10c.
- The owner accepted the r10c "after" frames and approved the draft for canon (2026-10-08).

`zeus-portrait/portraits-before-{1x,4x}.png` are the six generated candidates; `portraits-after-{1x,4x}.png` are the r10c frames. The 4× images are whole-number enlargements of the 1× images. The after 1× PNG has the same sha256 as the r10c edit's sheet. `zeus-portrait/zeus-portrait-atlas.png` is the published atlas.

### Records

| Record | Value |
| --- | --- |
| Working set | `zeus-portraits-u7-r10b` (an earlier set under the id `zeus-portraits-u7-r10` was made from a single-slot request by mistake and was never used) |
| Cleanup edit | `zeus-portraits-scripted-fleck-noise-cleanup-u7-r10c`, sheet sha256 `9976d0401250bb0fd9292c5d9a4eb86fce5030ec98afe32dbec241cc02593b9a` |
| Draft | `draft-zeus-portrait-u7-r10c` |
| Manifest revision and file name | `7cbaf7aa67a604b70b9c721dd0b31123d984c1e3034f10cba70c84e277c09c2d` (sha256 of the canonical manifest, 13,098 bytes) |
| Atlas | `171d42aa567ba3e06a36b66a5ea9b16b2525a921d85cfa08cc341417e8a7eeea`, 576×96, 6 cells of 96×96 at 100 ms |
| Style tag | `panthea-pixel-v1` |
| Pack report | pass: 30 of 30 checks (grid, canvas, binary alpha, palette, colour count for each cell); 9 to 11 colours per cell against the portrait limit of 32 |
| Published | `content/greek/assets/registry/index.json` entry `{"assetId":"zeus-portrait","revision":"7cbaf7aa…09c2d"}`, `manifests/7cbaf7aa….json`, `blobs/171d42aa….png`; state `canon` |
| Subject mapping | `content/greek/assets/subjects/zeus.json` gained `"portrait": "zeus-portrait"` |

**Approval.** `approve --confirm 7cbaf7aa…09c2d` returned state `approved` with basis `report-pass`, then `publish --confirm` the same revision returned state `canon`. The approval reason is `Owner accepted r10c cleaned portraits 2026-10-08`. The studio's approve record has no reason field (the stored record holds only the state and the basis `report-pass`), so the reason is written here and nowhere in the studio record.

**Licences** (all `compatible`, source `pinned-terms`; compatibility facts, not legal clearance):

| Subject | Role | Licence |
| --- | --- | --- |
| `sd-cpp-master-929-3f8527a` | runtime | MIT |
| `z_image_turbo-Q3_K` | model | Apache-2.0 |
| `Qwen3-4B-Instruct-2507-Q4_K_M` | encoder | Apache-2.0 |
| `z-image-ae` | vae | Apache-2.0 |
| `zeus-portrait` | original-work | MIT |

The original-work MIT licence is the one the owner accepted on 2026-10-06 for the cleanup and any hand work.

### Verification

- `bun run --cwd tools/content validate:assets`: exit 0 on the committed content with the canon entry and the portrait mapping.
- `bun run check`: exit 0 (3709 pass, 1 skip, 0 fail across 206 files).
- Two supporting changes made this pass: `biome.json` excludes `content/greek/assets/registry` (the registry's files are written compactly and are content-addressed, so formatting them would change their addresses), and the content validator tests now build their temporary trees with an empty canon and no portrait mappings, so they no longer depend on what has been published.

### Limits

- The packed provenance misdescribes the cleanup in four ways, left as recorded: both cleanup edits are listed under `handEdits` as "hand edit …" although the pixel changes were scripted, and the superseded r10 edit is listed beside r10c although the final pixels do not derive from it; the MIT original-work record carries no author or method, so it does not say the cleanup was scripted; and `relatedJobs` includes three unused neutral jobs (`zeus-portrait-neutral-u7-r3-0000`, `-0002`, `-0003`) from the same request.
- One host, one set of runs, macOS only. The neutral base is a single generation.
- Palette conformance and the pack report show the frames are valid; they say nothing about quality, which is the owner's judgement above.

## Zeus idle-south: deferred

Not published. The owner deferred the Zeus idle-south sprite on 2026-10-08 as a feasibility conflict with R20: no local technique on the 16 GiB M1 Pro produced a usable 64×80 sprite, and every attempt failed owner review. The reasons and the attempts are in the plan's Unit 7 "Sprite deferral (owner, 2026-10-08)" note (`docs/plans/2026-10-05-001-feat-studio-pipeline-cli-plan.md`); the measurements and run records are in `tools/probes/art-edit/README.md` and its `r8-run-manifest.json` and `r9-run-manifest.json`. Zeus keeps the M0 `placeholder-zeus` sprite. An earlier idle-south draft (`draft-zeus-idle-south-u7-r7`) remains an unapproved draft in the authoring store and is not in the registry. The sprite moves to a later unit, human-drawn or generated with a stronger local model.
