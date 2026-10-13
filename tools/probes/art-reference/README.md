# art-reference: reference-conditioned generation probe (plan unit U1)

Status: **runs complete; verdict provisional.** The thresholds below were committed before any job (see the hash line in the run log). Every score and the verdict in [Results](#results) are the author's read and are not final: an independent reviewer from a different model family makes the call from the contact sheets.

Question (R14): on the pinned `sd-server` `master-929-3f8527a`, can FLUX.2 klein base 4B, given the canon Zeus sprite as `ref_images`, produce a new facing or a new pose while keeping the character's identity? An earlier attempt (A2 in [../art-edit/README.md](../art-edit/README.md)) used `sd-cli -r` for an expression change and failed: the five outputs looked alike and drifted in colour. This probe changes two things: it goes through the server's `ref_images` field, and it asks for a facing or pose change.

## Thresholds (committed before any generation job)

Written before the server was started; the sha256 of this section is recorded in `runs.jsonl` as the first line of the run log, so the thresholds cannot move after the outputs are seen. The reviewer scores against these as written.

### Resource bounds

Measured per run; the baseline numbers come from [../art-local-2/README.md](../art-local-2/README.md) (FLUX control, 512x640, no reference: 282 s p50, 6,942,624 KiB = 6.62 GiB sampled peak RSS, same host, same flags).

| Bound | GO | PARTIAL | NO-GO | Why |
| --- | --- | --- | --- | --- |
| Peak RSS of `sd-server` (sampled 1 Hz via `ps`) | ≤ 8.0 GiB | ≤ 10.0 GiB | > 10.0 GiB | The machine has 16 GiB and Metal reports a 11.2 GB recommended working set. macOS, the studio, the simulation and the renderer need roughly 6–8 GiB beside the generator. 8 GiB is the no-reference baseline plus 1.4 GiB of reference-token headroom. 10 GiB is survivable only if the studio releases its other work while the job runs. |
| Seconds per image, 1 reference | ≤ 600 s | ≤ 1,200 s | > 1,200 s | Twice the no-reference baseline plus slack for the reference tokens. A repair is an owner-triggered background job; a four-frame repair at 600 s is 40 minutes. The A2 CLI runs averaged about 740 s at 768x768. |
| Seconds per image, 2 references | ≤ 900 s | ≤ 1,800 s | > 1,800 s | 1.5× the one-reference bound; the second reference adds tokens again. |

RSS is a lower bound: a 1 Hz sampler can miss a spike, and `ps` RSS does not count Metal-private buffers on unified memory. The README states the measured value and does not round it down.

### Identity checklist

Scored by the reviewer on the 4× contact sheet (reference beside each run), with the 1× palette-mode read as the second view. Each cue is pass (1) or fail (0).

| Cue | Pass when |
| --- | --- |
| C1 Silhouette | A single full-body figure with the reference's proportions: long robe to the feet, one arm raised, one at the side (or the seated equivalent for the pose run). No duplicated or missing limbs, no crop. |
| C2 Beard and crown | A long white-grey beard and the reference's head covering. **Note:** the canon cell shows swept-back silver hair and no distinct gold crown, so a gold crown is neither required nor penalised unless the reference shows one. C2 means the white beard plus the same head treatment as the reference. |
| C3 Palette family | Colours read as the Olympus family: marble off-whites and blue-greys, pale gold, lapis accents. No off-family hues (saturated reds, greens, purples). |
| C4 Held bolt | A gold zigzag thunderbolt held in the raised hand, identifiable as a bolt (not a staff, wand or branch). |

### Facing or pose changed

The reviewer answers yes or no:

- **Facing (west):** the face and torso are turned to the viewer's left, in side or three-quarter view. A mirror of the south-facing figure does not count.
- **Pose (seated):** the hips are bent and the legs are in a seated posture.

A measured guard also applies: silhouette IoU between the output's 1× cell and the reference cell, after aligning feet and the horizontal centre, must be **below 0.95**. At 0.95 or above the run is a copy and "changed" is no.

### Colour drift against the reference

Measured on the palette-mode 1× cell (method M, 54 px, `olympus`, with outline), against the canon cell:

- **TV** = ½ Σ |share_ref(ramp) − share_out(ramp)| over the Olympus ramps, shares computed over opaque pixels.
- **ΔE** = Oklab distance between the mean colour of the opaque pixels of each cell.

| | GO | PARTIAL |
| --- | --- | --- |
| TV | ≤ 0.25 | ≤ 0.40 |
| ΔE (Oklab) | ≤ 0.06 | ≤ 0.10 |

A run needs both numbers inside a tier to be in that tier.

### What a change (facing, pose) must show to pass

All of:

1. The change happened (answer yes, IoU guard met).
2. At least **3 of the 4 cues** pass, and C2 is one of them (an unrecognisable face is not the same character).
3. Colour drift is in the GO tier.
4. The run scores **more cues than the no-reference baseline**. If it does not, the reference had no effect (the A2 failure mode, outputs alike regardless of the reference).
5. The run's RSS and seconds-per-image are inside their GO bounds for its reference count. Runs in the PARTIAL tier of a resource bound pass only at PARTIAL.

A change passes if either its 1-reference run or its 2-reference run passes. Only the facing has a 2-reference run. The cheapest passing configuration is the one recommended to U5.

### Verdict rule

- **GO:** facing and pose both pass at the GO tier of every bound.
- **PARTIAL:** exactly one of facing and pose passes (U5 wires only that change, with that reference count), or both pass but a resource bound is at its PARTIAL tier, or colour drift is at its PARTIAL tier with every other condition met.
- **NO-GO:** neither passes, or RSS is above 10 GiB, or seconds per image exceed the NO-GO bound, or the reference is ignored (condition 4 fails for both changes). Recorded as partial R14.

### Settings

From the pinned `docs/flux2.md` (klein base 4B example): `--cfg-scale 4.0 --steps 20 --offload-to-cpu --diffusion-fa`. The server body uses `sample_params.sample_method: euler`, `sample_steps: 20`, `guidance.txt_cfg: 4.0`, and `guidance.img_cfg: 4.0` (A2 used `--img-cfg-scale 4`, so the settings are held fixed against A2). Seed `20261011`, 512x640, `lora: []`. At most one extra settings variant, only if the first run clearly fails because of the settings (for example the reference is visibly unused).

## Method

Host: Apple M1 Pro, 16 GiB, Darwin 24.6.0 (the same machine as `art-local-2`). Runtime: `sd-server` `master-929-3f8527a`, sha256 `37fa5c1dfa673262abdf8ba0b9294144c7d666dbec40e688a1596d975fe57cae` (matches the pin). Assets from the main checkout's `tools/probes/art-local-2` (models are not in this worktree):

| Role | `ROLE_FLAGS` flag (`packages/assets/src/studio/runtime.ts`) | File |
| --- | --- | --- |
| diffusion-model | `--diffusion-model` | `models/flux-2-klein-base-4b-Q4_0.gguf` |
| text-encoder | `--llm` | `models/Qwen3-4B-Q4_K_M.gguf` |
| vae | `--vae` | `models/flux2-vae.safetensors` |

Server, started detached from `art-local-2` (one server, one job at a time):

```sh
nohup ./bin/release/sd-server --listen-ip 127.0.0.1 --listen-port 18451 \
  --diffusion-model models/flux-2-klein-base-4b-Q4_0.gguf --llm models/Qwen3-4B-Q4_K_M.gguf \
  --vae models/flux2-vae.safetensors --offload-to-cpu --diffusion-fa -v > server.log 2>&1 < /dev/null &
```

Steps, from the scratch directory `.context/studio-pipeline/art-reference/` (gitignored):

```sh
python3 tools/probes/art-reference/prepare.py        # canon idle + seated frame 0, x8 nearest, 512x640 RGBA
bun tools/probes/art-reference/run.ts --pid <sd-server pid>                                          # 4 runs, serial
bun tools/probes/art-reference/run.ts --pid <pid> --only facing-1ref --img-cfg 1.5 --variant -v2     # the one settings variant
python3 tools/probes/art-reference/analyze.py        # M-54 palette read, drift, IoU, contact sheets
```

- **Reference:** the `zeus-sprite` atlas (blob `9976a62d…626a69`, manifest revision `1382b7f7…a56d`), idle south frame 0 at x=0 and seated south frame 0 at x=256, each 64x80, upscaled x8 nearest-neighbour. sha256 `212d8eb4…683b47` (idle) and `06def35c…62f3a8` (seated). The sprite is RGBA with fully transparent background; the pinned `api.md` says RGB-only models drop alpha, so FLUX sees the RGB under alpha 0.
- **Capabilities** (`GET /sdcpp/v1/capabilities`, full JSON in the scratch directory): `features.ref_images: true` and `features_by_mode.img_gen.ref_images: true`; `supported_modes` is `["img_gen"]`; `limits` max 4096x4096, `max_queue_size` 64; `model.stem` `flux-2-klein-base-4b-Q4_0`; `output_formats` png/jpeg/webp. The driver's gate passed, so jobs ran.
- **Accepted body format:** `ref_images` as **raw base64 strings** (no data-URL prefix), PNG bytes, in input order. The server answered `202` with `{id, poll_url}`, and the log shows `preprocess ref[0]` (and `ref[1]` for the two-reference run), `Using 'flux2' preset for reference images` and `EDIT mode`, so the references were consumed. The data-URL form was not exercised live (`api.md` documents both).
- **Body:** `prompt`, `negative_prompt`, `width: 512`, `height: 640`, `seed: 20261011`, `batch_count: 1`, `ref_images: [...]` (omitted for the baseline), `lora: []`, `sample_params: {sample_method: "euler", sample_steps: 20, guidance: {txt_cfg: 4, img_cfg: 4}}`, `output_format: "png"`. Settings come from the pinned `docs/flux2.md` klein base 4B example (`--cfg-scale 4.0 --steps 20`); `img_cfg` 4 matches A2.
- **Prompts** (exact text in `run.ts`): every run shares one style-plus-character description; reference runs add one leading sentence ("Keep the same character, costume, colours and pixel art style as the reference image[s]."). Facing: "…standing, turned to face left in side view (west)". Pose: "…seated on a plain stone seat, front view". The baseline uses the facing prompt without the leading sentence. Negative prompt: `different person, changed costume, altered face, blurry, antialiasing, smooth gradients, photograph, 3d render, text, watermark`.
- **1× read:** `tools/probes/art-edit/sprite_downscale.py`, method M (mode of palette-snapped pixels), 54 px total figure height with the 2 px outline (52 px interior), `olympus` family of `content/greek/palette/palette.json`. Background keyed from the corner colour at tolerance 40, specks under 0.1% dropped, feet placed, outline added.
- **Memory:** the driver samples `ps -o rss=` on the server pid once per poll (1 Hz). RSS turned out to undercount (see Results), so a second sampler (`footprint -p`, every 2 s) was added during the pose run. It missed the baseline and the first facing run.

One process note: the first driver launch sampled the wrong pid (the shell wrapper) and was killed before any job finished; the server was restarted and all four runs started from scratch. The log keeps both capability lines and a note.

## Results

Scratch outputs (gitignored), under `.context/studio-pipeline/art-reference/`:

- `analysis/contact-1x.png` and `analysis/contact-4x.png`: rows 1 to 4 are the baseline, facing 1-ref, pose 1-ref and facing 2-ref; row 5 is the settings variant. In each row tile `0` is the canon idle reference and `5` the canon seated reference; the run tile is the row number (`6` for the variant).
- `analysis/raw-512x640.png`: reference then the five raw outputs, side by side.
- `outputs/*.png`, `analysis/cells/*.png` (the 64x80 cells), `analysis/keyed/*.png`, `analysis/metrics.json`, `runs.jsonl`, `capabilities.json`, `logs/server.log`, `mem.csv`.

### Measured

| Run | Refs | img_cfg | Latency (s) | Peak RSS (GiB, `ps`) | Footprint peak (GiB) | Output sha256 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| baseline | 0 | n/a | 294.8 | 4.39 | not sampled | `71261a6961b603e448e7acf78936ee6f3945c2088d4f4ee4dd3e52350200a7d5` |
| facing-1ref | 1 | 4 | 440.4 | 2.42 | not sampled | `4037a7f0676264b0f25897f7d90dcdba6271f6b6ab3deb754633aabdaf6cf4a9` |
| pose-1ref | 1 | 4 | 419.7 | 3.72 | 6.79 (partial window) | `12298981e7abcccf1b2ac4ac75cf88a227d71be6eb5478a7968569eeb13abe97` |
| facing-2ref | 2 | 4 | 548.1 | 2.88 | 6.80 | `f4858fd0a663f8f445954f6f255ca4966500e4012458297a5f22cee1c8ad48ab` |
| facing-1ref-v2 | 1 | 1.5 | 675.0 | 4.33 | 6.81 | `d2ee9ab635c837a90a93bfe7bb9dca4e7bd05fbbb37b8d1b5341eda8e5894f9e` |

Seed 20261011, 512x640, 20 steps, euler, `txt_cfg` 4, `lora: []`. Request-body hashes and job ids are in `runs.jsonl`. Body sha256 for the four first-pass runs: baseline `3f62f512…14208cf`, facing-1ref `9cb75448…226c0a`, pose-1ref `729a0830…bc0ee`, facing-2ref `2fffe60a…aa84f`.

Memory caveats:

- `ps` RSS peaked at 2.4 to 4.4 GiB, well under the 6.6 GiB that `art-local-2` sampled for the same model without references. `footprint` reads about 6.8 GiB for the runs where it was sampled, and about 6.9 GB on a server that had just started the pose job. Weights are offloaded to CPU and mapped lazily, so RSS swings. **The provisional read uses the larger footprint figure**, which is stricter than the committed RSS rule.
- The host was swapping hard throughout: `vm.swapusage` showed 12.7 to 15.4 GB used. The latencies above include that pressure and the variant's 675 s is probably inflated by it. Run in isolation they would be lower.

### Colour drift and silhouette (committed metric, against the canon idle cell)

| Run | TV | ΔE (Oklab) | Tier | IoU vs idle | Supplementary: TV / ΔE before outline |
| --- | ---: | ---: | --- | ---: | --- |
| baseline | 0.230 | 0.035 | GO | 0.794 | 0.192 / 0.032 |
| facing-1ref | 0.312 | 0.079 | PARTIAL | 0.752 | 0.217 / 0.017 |
| pose-1ref | 0.404 | 0.092 | outside (TV above 0.40) | 0.558 | 0.324 / 0.034 |
| facing-2ref | 0.125 | 0.055 | GO | 0.841 | 0.076 / 0.003 |
| facing-1ref-v2 | 0.362 | 0.102 | outside (ΔE above 0.10) | 0.827 | 0.267 / 0.037 |

Two things inflate TV in every row. The downscale script's outline takes the darkest shade of the adjacent ramp, which lands on the lapis navy for most boundary pixels (lapis share 0.02 in the canon cell, 0.08 to 0.35 in the outputs). The pose run also adds a stone seat, a marble-ramp block. Against the canon **seated** cell instead of the idle cell, pose-1ref scores TV 0.280, ΔE 0.085, IoU 0.809. These are supplementary and do not change the committed numbers.

### Provisional scores (author, from the 4× sheet and the raw outputs)

| Run | Changed? | C1 | C2 | C3 | C4 | Cues | Notes |
| --- | --- | :-: | :-: | :-: | :-: | ---: | --- |
| baseline | yes (west, no reference) | fail | pass | pass | fail | 2 | Bare legs and torso, flame-like torch instead of a bolt. Reads as a different, muscular character. |
| facing-1ref | **no** | pass | pass | pass | pass | 4 | Front-facing near copy of the reference at 8x scale. Bolt, beard, robe and palette are all kept; the facing is not. |
| pose-1ref | yes (seated on a block) | pass | pass | pass | pass | 4 | Identity kept: beard, hood-like hair, cream robe, gold band, bolt in the raised hand. Seat is a grey-blue block. Colours are more saturated than canon before the palette snap. |
| facing-2ref | **no** | pass | pass | pass | pass | 4 | Again a front-facing near copy. The second (seated) reference did not push the facing. |
| facing-1ref-v2 | yes (side view, left) | pass | pass | pass | fail | 3 | Turned correctly, but the bolt is a gold blob, the body is bulkier, the arm is bare and the outline is black. |

The canon cell has silver hair and no distinct gold crown, so C2 was scored as the white beard plus the reference's head treatment (see the checklist note).

### Per-change outcome against the committed rules

- **Facing:** 1-ref and 2-ref did not change the facing (condition 1 fails). The variant (`img_cfg` 1.5) changed it, but loses the bolt (3 of 4 cues, still above the baseline's 2) and misses the drift bound by 0.002 in ΔE (0.102 against 0.10). Its 675 s is also in the PARTIAL time tier. **Does not pass.**
- **Pose (seated, 1 reference):** the change happened, 4 of 4 cues (above the baseline's 2), 420 s and about 6.8 GiB are inside GO. TV is 0.404 against the PARTIAL ceiling of 0.40, so condition 3 fails by 0.004. **Does not pass as written**, by a margin the confounds above are larger than.

### Provisional read: NO-GO as written; pose-only is the defensible alternative

1. **As committed:** neither change passes, so the verdict rule gives **NO-GO, recorded as partial R14**. Both misses are on the colour-drift number (0.004 and 0.002), not on identity.
2. **What the evidence shows beyond the numbers:** `ref_images` works on the pinned build. The reference is consumed, identity survives, and a new *pose* (seated) comes through with the beard, robe, bolt and palette family intact, at 7 minutes and about 6.8 GiB. A new *facing* does not: at the documented settings the model returns the reference nearly unchanged (the A2 failure mode again), and at lower image guidance it turns but drops the bolt. The checkpoint seems to treat "facing" as a property of the reference.
3. **If the reviewer accepts the drift confounds** (outline colour chosen by the downscale script, plus the added seat), pose-1ref is PARTIAL on drift (pre-outline TV 0.324, ΔE 0.034) and the verdict becomes **PARTIAL: pose only, one reference**. U5 would wire only that. The reviewer should decide whether to apply the committed metric as written or re-measure.
4. **Not tried:** the settings-variant allowance (one) was spent on the facing. No pose variant, no second seed, no other facing prompt, no distilled 4B (needs a download and owner approval), no pin change (needs owner approval and an ADR). One seed per run means these are single samples, not a distribution.
5. **Concrete alternative for the facing:** do not rely on reference conditioning for a new facing. Author the west frame, or repair it with a masked edit on a published frame (the other branch of plan unit U5).

Limits on this read: the author scored the cues and the reviewer has not; the baseline is a single sample whose prompt matches the facing run, so the "more cues than baseline" test for the pose run compares against a facing-prompt baseline; the pose-1ref memory window is partial.

## Licences

Checked against the upstream model cards (Hugging Face API, 2026-10-11) and the licences `art-local-2` declares in its `components.json`:

| Component | Licence | Source |
| --- | --- | --- |
| FLUX.2 klein base 4B (Q4_0 GGUF) | Apache-2.0, ungated | `black-forest-labs/FLUX.2-klein-base-4B` card; GGUF is `leejet/FLUX.2-klein-base-4B-GGUF`. The 9B variants are gated and non-commercial; they are not used. |
| Qwen3-4B (Q4_K_M GGUF) | Apache-2.0 | `Qwen/Qwen3-4B` card; GGUF is `unsloth/Qwen3-4B-GGUF` |
| `flux2-vae.safetensors` | Apache-2.0 as declared by `art-local-2` (`Comfy-Org/vae-text-encorder-for-flux-klein-4b`) | **Not independently verified.** The klein base 4B repo ships its own VAE under the repo's Apache-2.0, but in diffusers layout with a different file hash (`ca70d220…`) from the on-disk single file (`868fe7b3…`), so identity of the two was not shown. The FLUX.2-dev card is non-commercial for the dev model, and does not state the VAE's licence separately. |
| `stable-diffusion.cpp` `sd-server` | MIT | `art-local-2` README |

No model or tool was downloaded for this probe. Outputs are research drafts; none is canon-approved.

## Files

- `run.ts`: driver. Builds the `ref_images` body deterministically from PNG bytes, gates on capabilities, runs the jobs, records latency, peak RSS and hashes.
- `run.test.ts`: tests for the body builder and the capabilities gate, with no server and no real timers (injected `http`, `sleep`, `now`, RSS and file effects).
- `prepare.py`: cuts and upscales the reference frames.
- `analyze.py`: 1× read, drift, IoU and contact sheets.

## Verdict (independent review, 2026-10-11)

**NO-GO.** Reference conditioning is not wired into the studio.

- **Facing:** fails. With one or two references the output stays front-facing. At `img_cfg` 1.5 the figure turns west, but the bolt becomes a blob and ΔE misses its bound.
- **Seated pose:** all four identity cues hold, and it is usable as a generated repair candidate for the lower body and seat. It misses the PARTIAL TV ceiling: 0.404 against 0.40, as preregistered.
  - The outline pass inflates TV. Without the outline, TV is 0.324. Against canon seated it is 0.280.
  - Those numbers point to a better evaluation step for the next experiment. They do not change this run's result.
- **Limits:** each condition ran once, with one seed.

The studio's repair route stays as a masked edit on a published frame. A reference request returns `unavailable`, naming this README.

**Next experiment, if wanted:** a preregistered pose-only test. Three seeds, each run with and without one reference on the same seated prompt, through a fixed outline cleanup that matches canon, with the final-cell colour ceilings unchanged.
