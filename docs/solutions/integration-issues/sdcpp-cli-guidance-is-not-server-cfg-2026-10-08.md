---
title: sd-cli --guidance is not the server's CFG scale
date: 2026-10-08
category: integration-issues
module: assets
problem_type: integration_issue
component: tooling
severity: medium
symptoms:
  - "A studio masked edit drew different pixels than the sd-cli probe with the same seed, prompts, init image, mask and strength"
  - "Plain text-to-image and unmasked img2img also differed between sd-cli and sd-server"
  - "PNG file hashes differed even after the decoded pixels matched"
root_cause: wrong_api
resolution_type: code_fix
tags: [sd-cpp, sd-server, cfg, distilled-guidance, masked-img2img, studio, pixel-parity]
---

# sd-cli --guidance is not the server's CFG scale

## Problem

The studio's masked edits ran through sd-server and were meant to reproduce portraits first made with sd-cli. The probe passed `--guidance 1`, and the studio sent `sample_params.guidance: { txt_cfg: 1 }`. The pixels inside the mask came out different, so the studio was drawing new images instead of the ones the owner had approved.

## Symptoms

- Angry edit, seed 20261010, strength 0.6: the studio output (`b0b98e16…`) differed from the probe (`da897619…`) by about 13k pixels by more than 24 levels, all inside the mask. Pixels outside it nearly matched. These numbers come from the investigation and aren't committed.
- An A/B ran the same settings through both binaries at three levels: plain text-to-image, img2img without a mask, then masked img2img. All three pairs differed, so mask and init-image handling were not the cause.

## What Didn't Work

- **Suspecting the mask or the decoder.** The plain text-to-image pair also differed. Reading sd.cpp at the pinned commit `3f8527a` showed the same image loader on both paths: channel 0 for the init image and channel 1 for the mask. Neither path thresholds, blurs, inverts or resizes the mask.
- **Suspecting the seed.** sd-server randomises only negative seeds.
- **Suspecting the scheduler.** It was the strongest lead from the source, but both binaries logged `get_sigmas with discrete scheduler`.
- **Comparing PNG file hashes.** After the fix, the files still differed: an embedded `parameters` text chunk is longer in the CLI's output, while the image data is identical.

## Solution

sd-cli's verbose log printed its effective settings: `sample_params: (txt_cfg: 7.00, …, distilled_guidance: 1.00, …)`. In sd-cli, `--guidance` sets the *distilled* guidance, and `--cfg-scale` stayed at its default of 7. The studio's `txt_cfg: 1` turned CFG off.

Masked edits now take their guidance from the profile. Plain generation keeps CFG 1.

```ts
// packages/assets/src/studio/provider.ts
sampling: { sampleMethod: "euler", sampleSteps: 8, txtCfg: 1 },
edit: { txtCfg: 7, distilledGuidance: 1 },
```

```ts
// packages/assets/src/studio/edit.ts — sd-server body
guidance:
  input.distilledGuidance === undefined
    ? { txt_cfg: input.txtCfg }
    : { txt_cfg: input.txtCfg, distilled_guidance: input.distilledGuidance },
```

Each job records the `txt_cfg` and `distilled_guidance` it sent. Tests in `packages/assets/src/studio/edit.test.ts` cover both branches.

With `{ txt_cfg: 7, distilled_guidance: 1 }`, the server output decodes to rgb24 MD5 `6aede7c08e21d679c29cc53855c1562b`, the same as the CLI probe. All five Zeus expression edits match their probe outputs pixel for pixel (`docs/evidence/asset-studio/unit5/README.md`).

CFG 7 runs a second, unconditional pass on every step. A masked edit took about 201 s against 101 s at CFG 1.

## Why This Works

The server now receives the two values the CLI actually sampled with. The flag name `--guidance` looks like the server's `guidance` object, but it maps to only one field of it.

## Prevention

- Read each binary's effective-parameter log line before assuming CLI flags and server JSON fields correspond.
- Prove parity on decoded pixels (`ffmpeg -f rawvideo -pix_fmt rgb24 - | md5`), not on PNG bytes, because metadata chunks differ.
- Isolate a divergence from the bottom up: plain text-to-image first, then img2img, then masked. The first pair that differs shows which layer to look at.
- Record the sampling settings each job actually sent, so a mismatch can be traced from provenance alone.

## Related Issues

- [Consistent portrait expressions from one masked base](../best-practices/portrait-expressions-from-one-masked-base-2026-10-08.md): the edits this fix made reproducible.
- [LoRA silent no-op on quantized sd.cpp weights](lora-silent-noop-on-quantized-sdcpp-weights-2026-09-27.md): another sd.cpp case of wrong pixels with nothing reported, found by comparing pixels at a fixed seed.
- [Transparent RGB bytes broke grid recovery](../logic-errors/transparent-rgb-bytes-broke-grid-recovery-2026-10-05.md): compare decoded pixels, not stored bytes.
- PR #174.
