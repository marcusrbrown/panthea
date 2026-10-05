# art-local-2: local image-generation comparison

## Question

Which local chain can generate pixel-art character source images on the M1 Pro 16 GB baseline, and how do the candidates compare on time per image, sampled resident memory, with-LoRA versus no-LoRA output at a fixed seed, and restart-based cancellation? Measurements only; the owner reviews quality and chooses the chain.

Status: measurements recorded for three arms; the Z-Image LoRA arm is unavailable. Draft generator: Z-Image-Turbo without LoRA at 512x640. SDXL + pixel-art-xl stays as a measured comparison. The generator comparison is measured; the studio headroom test belongs to the studio's Unit 7 verification, once the studio exists. The durable machine-readable record is [evidence/unit1-measurements.json](evidence/unit1-measurements.json). Raw results, logs and images stay in the gitignored `results/` directory.

## Host and runtime

- Host: Apple M1 Pro, 16 GiB (17,179,869,184 bytes), Darwin 24.6.0. Metal initialised on `MTL0` (Apple M1 Pro; `recommendedMaxWorkingSetSize` 11453.25 MB) in every server log. The harness records `metalVerified: false` by design; the server log lines are the evidence.
- Runtime: `stable-diffusion.cpp` release `master-929-3f8527a` (commit `3f8527a46c54ecf4cb4ed6003da8e8982283c73c`, MIT), `sd-server` sha256 `37fa5c1dfa673262abdf8ba0b9294144c7d666dbec40e688a1596d975fe57cae`. Archive size and sha256 are in [components.json](components.json).
- Components are pinned by immutable source commit, size, sha256 and licence in [components.json](components.json). Before the matrix every runtime and component file was re-hashed: all matched. The one file never fetched is the Z-Image LoRA (below).

## Method

One server per arm, one request at a time, fixed seed `20261003`, same subject prompt and negative prompt for every arm (exact text in `arms/*.json`). Per cell: 1 warmup and 3 timed samples, with the LoRA and as a same-seed no-LoRA control (the no-LoRA arm has a single `none` variant). Cells are 512x640 and 768x768. Each arm ends with a cancellation probe: abort a 512x640 job 15 s in by restarting the server, then time abort-to-exit, restart-to-ready and restart-to-idle (CPU below 5%).

Each generation is bounded at 30 minutes, the server at 2 hours (4 hours for FLUX, whose matrix measured 7,508 s). With n=3 per cell variant, p95 equals the sample maximum (nearest-rank), so treat p50 and p95 as a spread, not a distribution.

Settings that differ by arm:

| Arm | Sampler, steps, cfg | LoRA multiplier | Server flags of note |
| --- | --- | --- | --- |
| FLUX.2 klein base 4B (Q4_0) | euler, 20, 4 | 1.0 | `--offload-to-cpu --diffusion-fa` |
| Z-Image-Turbo (Q3_K), no LoRA | euler, 8, 1 | none | `--offload-to-cpu --diffusion-fa` |
| SDXL base 1.0 + pixel-art-xl | euler_a, 20, 7 | 1.2 | `--lora-apply-mode at_runtime` |

### Commands

From `tools/probes/art-local-2`:

```sh
bun test && bun run typecheck                       # harness tests and typecheck
bun run src/stage.ts runtime                        # pinned release archive, then extract and sha256-verify bin/release/sd-server (needs `unzip`)
bun run src/stage.ts flux2-klein-base-4b            # stage an arm's components, verified by sha256
bun run src/stage.ts sdxl-pixel-art-xl
bun run src/stage.ts z-image-turbo                  # the Civitai LoRA needs an authenticated download; see below
```

Full matrix, run one at a time with nothing else heavy running:

```sh
bun run src/cli.ts --config arms/z-image-turbo.json --out results/full         # blocked: exit 2
bun run src/cli.ts --config arms/z-image-turbo-nolora.json --out results/full  # exit 0
bun run src/cli.ts --config arms/sdxl-pixel-art-xl.json --out results/full     # exit 0
bun run src/cli.ts --config arms/flux2-klein-base-4b.json --out results/full   # exit 0
```

`*.smoke.json` configs run one 512x640 cell with no warmup and one sample.

Per arm the CLI writes `results/full/<arm>/results.json`, `images/` and `logs/server-<n>.log` (one log per server start, including the restart after the cancel probe). Server output is retained up to 8 MiB and the full text is saved; `results.json` keeps only a 4,000-character `logTail` summary plus `logFile` and `logTruncated`. All logs in this record have `logTruncated: false`. Paths in `results.json` and the logs are redacted.

## Results

Time is wall milliseconds per generation. RSS is the sampled peak of the server process tree in KiB, read once per second through `ps` (a lower bound, not a guaranteed maximum). Hashes are the first 12 hex characters of the PNG sha256; repeats within a cell were byte-identical. All 40 listed PNGs are valid, with the expected dimensions.

| Arm | Cell | Warmup | Samples | p50 | p95 | Peak RSS (KiB) | Output |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Z-Image no-LoRA | 512x640 | 85,417 | 76,737 / 76,698 / 76,185 | 76,698 | 76,737 | 6,399,248 | `67b4e98ade48` |
| Z-Image no-LoRA | 768x768 | 144,753 | 149,065 / 147,959 / 148,968 | 148,968 | 149,065 | 8,760,400 | `fe52976d306d` |
| SDXL + LoRA | 512x640 | 117,702 | 104,817 / 104,744 / 104,867 | 104,817 | 104,867 | 7,235,744 | `d520d8d0e215` |
| SDXL control | 512x640 | 58,328 | 49,482 / 49,326 / 49,716 | 49,482 | 49,716 | 7,385,440 | `dcbfc74bd2a5` |
| SDXL + LoRA | 768x768 | 202,693 | 203,345 / 203,092 / 198,349 | 203,092 | 203,345 | 7,008,016 | `18cb98dddcc2` |
| SDXL control | 768x768 | 89,078 | 90,674 / 88,997 / 88,133 | 88,997 | 90,674 | 6,848,352 | `c9406084bdbe` |
| FLUX + LoRA | 512x640 | 432,544 | 429,142 / 428,617 / 427,819 | 428,617 | 429,142 | 5,525,072 | `d1e63af1d5c9` |
| FLUX control | 512x640 | 288,137 | 282,242 / 281,745 / 282,387 | 282,242 | 282,387 | 6,942,624 | `e82a09c98bae` |
| FLUX + LoRA | 768x768 | 695,340 | 690,347 / 687,144 / 686,863 | 687,144 | 690,347 | 7,117,376 | `e00288d24a88` |
| FLUX control | 768x768 | 469,278 | 465,207 / 465,107 / 465,284 | 465,207 | 465,284 | 6,961,792 | `8149fc2634a2` |

With-LoRA and control hashes differ in every paired cell. That shows the LoRA changed the output; it does not show the LoRA was applied correctly or that the result looks better. Server logs report `apply lora at runtime` and all LoRA tensors applied (SDXL 2166 / 2166, FLUX 160 / 160); the no-LoRA arm's logs contain no LoRA lines.

### Cancellation (restart-based)

| Arm | Abort to exit | Restart to ready | Cancel to idle | Restart to idle |
| --- | --- | --- | --- | --- |
| Z-Image no-LoRA | 135.8 ms | 880.7 ms | 1,868.0 ms | 1,732.2 ms |
| SDXL | 63.2 ms | 309.6 ms | 1,184.1 ms | 1,120.8 ms |
| FLUX | 92.1 ms | 824.2 ms | 2,001.8 ms | 1,909.7 ms |

Cancel to idle is the time from the cancel request until the replacement's process-tree CPU was below 5%. It was measured after the idle wait, so it includes it; readiness (restart to ready) is separate, taken at the moment the replacement answered. The harness now also records a true cancel-to-ready total, but these results predate that, and the spawn duration needed to derive it was not recorded. Every probe ended `cancelled` with no result recorded and no escalation to SIGKILL. These are restart times for the whole server; the server cannot cancel one job over HTTP.

### Host headroom observed during the runs

These are three different quantities; do not compare them to each other.

- Disk free (`df -k`, GiB, not memory): minimum 7.04 (Z-Image no-LoRA), 8.00 (SDXL), 7.35 (FLUX). The run's abort threshold was 4 GiB.
- Memory free (`memory_pressure -Q` system-wide percentage): 24-79% (Z-Image), 8-82% (SDXL, four 10 s samples under 10%), 25-78% (FLUX).
- Swap used (`vm.swapusage`, MB): 2,761-4,720.6 (Z-Image), 1,922.8-3,311.1 (SDXL), 2,614.8-3,751.5 (FLUX).
- Sampled server RSS (KiB, above) is separate again.

The monitor sampled every 10 s; the RSS sampler ran at 1 s. This shows one heavy job running alone. It does not measure coexistence with the studio, simulation or renderer.

## Z-Image with the LoRA: unavailable

The approved benchmark-only Civitai LoRA (model 1770073, version 2454660, file 2344890) needs an authenticated download; the unauthenticated request returned HTTP 401. It was not retried, bypassed or replaced. The full `arms/z-image-turbo.json` therefore reports all four cells `unavailable` (exit 2) with no server started and no images. `arms/z-image-turbo-nolora.json` measures the base model alone as the no-LoRA arm. The declared sha256 is in the manifest and the licence is benchmark-only: never canon, never publication.

## SDXL notes

1. **LoRA apply mode (workaround, root cause not established).** With the default `--lora-apply-mode auto` the SDXL with-LoRA smoke cell failed: the server aborted (SIGABRT) while applying the LoRA. The backtrace runs through `LoraModel::apply`; the abort message was not captured. The server documents `auto` as `immediately` for non-quantised weights. With `--lora-apply-mode at_runtime` the same cell completed, and the flag is now set in both SDXL configs. One n=1 comparison supports the workaround, not a cause. The earlier art-local probe also recorded a LoRA crash on non-quantised weights with a different build.
2. **768x768 with-LoRA Metal memory shortfall and automatic tiling.** In the full run each of the four 768x768 with-LoRA generations logged: Metal device reported 4,214.31 MB free of 10,922.67 MB with 6,707.69 MB of weights tracked, against 4,256.14 MB needed (3,744.14 MB budget needed, 3,702.61 MB available). That is about 42 MB short. The server then logged `Reducing VAE decode tiles from 768x768 to 256x256 image pixels` and `VAE decode ran out of memory; retrying with spatial tiling`, and finished with a tiled decode (23.4-24.4 s versus 9.2-10.1 s for the untiled control decode). The log has 8 `[ERROR]` lines (four repeats of `vae segment 1/1 (graph) failed during weight preparation` and `vae decode compute failed`) and 16 `[WARN]` lines; all four generations still produced valid PNGs. The 42 MB is a Metal device figure, not system free memory.
3. **Order of the error lines is unknown.** The harness stores stdout then stderr, so the error lines (stderr) sit after the warnings (stdout). Reading them as the failed first decode attempts fits the counts and messages but is a hypothesis.
4. **Decode path confounds the 768x768 comparison.** The with-LoRA cell ran a tiled decode and the control ran untiled.
5. **Explicit-tiling experiment (n=1, separate from the n=3 matrix).** A single 768x768 pair with `--vae-tiling` added completed with no WARN or ERROR lines and tiled decodes for both variants: with-LoRA 214,671 ms (sampling 186.80 s, decode 24.10 s, RSS 7,245,632 KiB, `20c4b2ba51d8`), control 112,247 ms (decode 23.34 s, RSS 7,218,160 KiB, `46eacc49b0e7`). Both hashes differ from the full-matrix hashes and the pair still differs from each other. Why the automatic and explicit tiled with-LoRA outputs differ is unknown, and this single run does not replace the full n=3 cells.

## Draft generator

Z-Image-Turbo (Q3_K) without LoRA at 512x640, preferred for its tall, modern-looking output. Draft only, not canon; art-guide conformance, palette and alpha are not certified.

- **Z-Image-Turbo no-LoRA, 512x640** (euler, 8 steps, cfg 1): p50/p95 76.70/76.74 s at n=3 (samples 76,737 / 76,698 / 76,185 ms; p95 is the sample maximum), below the plan's 90-120 s planning target.
- **SDXL + pixel-art-xl LoRA, 512x640** (`--lora-apply-mode at_runtime`), measured comparison: p50/p95 104.82/104.87 s at n=3, inside that target; the 768x768 cell (p95 203.35 s, tiled-decode caveat above) is outside it.
- FLUX.2 klein base 4B + spritesheet LoRA: slowest arm (768x768 with-LoRA p50 687.14 s). The LoRA was trained on a 512x512 spritesheet layout; the 512x640 and 768x768 cells do not match it, and the effect of that mismatch was not evaluated.

## Static target-size review

Four static reductions of existing full-matrix sample 0 outputs (seed 20261003), for the proposed 64x80 and 96x96 draft targets. No model was run and nothing was regenerated; this is not conformance evidence.

| Source | Sampler, steps, cfg | Source hash | Target | Output hash |
| --- | --- | --- | --- | --- |
| SDXL + LoRA 512x640 | euler_a, 20, 7 | `d520d8d0e215` | 64x80 | `1ead97001437` |
| Z-Image no-LoRA 512x640 | euler, 8, 1 | `67b4e98ade48` | 64x80 | `a026885aee78` |
| SDXL + LoRA 768x768 | euler_a, 20, 7 | `18cb98dddcc2` | 96x96 | `73779dc04e91` |
| Z-Image no-LoRA 768x768 | euler, 8, 1 | `fe52976d306d` | 96x96 | `244ff0b9d363` |

- Method: scale 8 on both axes; destination pixel `d` takes source `floor((d + 0.5) * 8)` (offset +4). No crop, palette change, background removal, normalization or other resize.
- Format: sources are 8-bit opaque RGB PNGs with a `tEXt` chunk; outputs are 8-bit RGBA PNGs with alpha 255 and no `tEXt` or profile chunks.
- Storage: the derivatives, two local review sheets, manifest and helper scripts sit in the gitignored `results/target-size-review/`. They are local, not durable, and no image is committed. Full hashes and paths are in [evidence/unit1-measurements.json](evidence/unit1-measurements.json) (`targetSizeReview`).

## Studio headroom: unmeasured

`apps/studio` and `tools/studio` do not exist, so there is no studio workload to run beside the generator. The headroom test moves to Unit 7 verification: one heavy Z-Image 512x640 job beside the real studio.

## Not measured

- Art-guide conformance, palette and alpha checks.
- Coexistence with the studio, simulation or renderer; the runs measured one job alone.
- Studio headroom: unmeasured, see [Studio headroom](#studio-headroom-unmeasured).
- Conformance of the 64x80 and 96x96 reductions (see [Static target-size review](#static-target-size-review)).
- Licensing acceptance, canon use and output redistribution. Generated images are not promoted by this record.

## Caveats

- n=3 per variant, one seed, one prompt, one host; p95 is the sample maximum.
- The first FLUX launch was killed by a tool timeout (not by the harness) after four 512x640 with-LoRA images and left no results file or logs. It is excluded; the recorded FLUX numbers come from one complete rerun.
- Image accounting: 40 PNG files are listed and exist (8 + 16 + 16), 10 unique by content. Warmup images are listed alongside samples.
- Local review sheets may exist under `results/contact-sheets/` and `results/target-size-review/` on the machine that ran the matrix. They are gitignored and not durable, so do not rely on them in review; the owner has not directed promoting any image.

## Files

- [components.json](components.json): pinned runtime and component manifest.
- [arms/](arms): full and smoke configs per arm.
- [evidence/unit1-measurements.json](evidence/unit1-measurements.json): sanitized measurements, hashes, log counts and headroom for this README.
- `src/`: harness (CLI, server driver, process control, RSS sampler, redaction) and its tests. `runArm` takes an optional `readUsage` hook (default: the real `ps` reader), so the arm tests script their RSS and CPU readings; `src/rss.test.ts` is the one test that samples a live process. A config's `server.restartReadyTimeoutMs` (optional, default `readyTimeoutMs`) bounds the cancel probe's replacement separately from the first launch.
