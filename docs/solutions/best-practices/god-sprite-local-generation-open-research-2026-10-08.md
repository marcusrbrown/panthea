---
title: Local 64x80 god sprites on a 16 GiB M1 Pro, still open research
date: 2026-10-08
category: best-practices
module: art-local
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - "Planning another local generation trial for a 64x80 god sprite"
  - "Reading failed sprite probes as scoped evidence, not a final ruling"
tags: [sprites, pixel-art, local-models, m1-pro, z-image, sdxl, masked-img2img, open-research]
---

# Local 64x80 god sprites on a 16 GiB M1 Pro, still open research

## Context

The Zeus idle-south sprite is deferred (plan Unit 7 note, owner, 2026-10-08), and Zeus keeps `placeholder-zeus`. Every route tried so far failed the owner's review. **This is not a finding that it can't be done on this machine.** The owner asked for more research and more trials. The target, from `docs/product/art-guide.md`: a 64×80 cell, a figure 48–56 px tall, a head about 1/4 of the height, a clean silhouette that reads at 1×, and Zeus's bolt.

## Guidance

Treat the routes below as the search frontier. In the next trial, change one variable at a time.

| Route | What happened |
|---|---|
| Z-Image text-to-image (r1–r4c) | Scenery iconography ("storm sky", "cloud seat") polluted the prompts, so iconography is now limited to carried items. "Facing south" needed view wording ("front view, facing the viewer"). Figures came out 35 px or 62–70 px tall. |
| Re-conform at a smaller scale | Not possible: `conformance.ts` accepts a scale only when the source size equals scale × cell, so figure height comes from the composition. |
| Agent pixel edits (r5–r7) | Rejected: blurry, a cloak that read as tattered, a stray dagger at the thigh. |
| FLUX.2 Klein + svntax pixel-walk LoRA | Chibi proportions (head 35–45% of the height), soft edges, a walk sheet rather than an idle, no bolt. |
| SDXL + pixel-art-xl | A readable silhouette at about 56 px, but no bolt. The non-integer reduction (about 19.7×) left noise. OpenRAIL-M keeps it out of canon. |
| Bolt inpainting | No clear bolt on any of 8 seeds, across SDXL and Z-Image. |
| Z-Image masked img2img from a hand-blocked 64×80 init, upscaled 8× (r8, 16 jobs) | Seed 20261023 at 0.75 with the full mask read most like Zeus. The pick was seed 20261022 at 0.60 with the bolt protected. The init background `(36,63,99)` is the palette's outline shade, so keying it removed the outline. |
| Scripted outline and 1 px bob (r9) | Reached the measured geometry, but the conform key `(40,65,99) ±32` matches the outline and the navy cloak. The owner said it looked worse than ever. |

## Why This Matters

Each route failed a different constraint: prompt semantics, figure scale, pose, a missing prop, a key colour that collides with the palette, or how it reads. A sprite needs all of them at once. A failure that conformance can't see, readability, still decides the outcome.

## When to Apply

Before any new sprite trial. Untried directions:
- a palette-aware downscale from a 768 px full-body image instead of nearest-neighbour;
- generating at the size where the model is strongest, then cropping to a figure in range;
- an init or key background that is outside the palette and outside the key tolerance;
- the 0.75 full-mask seed 20261023 candidate as a base, cleaned up under the review rules;
- strengths and seeds between those already tried;
- other Apache- or MIT-licensed models that fit in 16 GiB.

## Examples

```yaml
trial:
  target: { cell: 64x80, figure_px: 48-56, head_ratio: ~0.25 }
  background_key: { rgb: [255, 0, 255], reason: outside palette and key tolerance }
  scale_strategy: palette-aware-downscale from 768
  variable_under_test: strength
  fixed: [seed_family, prompt, mask, palette]
```

Treat a trial as inconclusive if it changes the model, prompt, seeds, scale strategy and key all at once.

## Related

- `tools/probes/art-edit/README.md`, `r8-run-manifest.json`, `r9-run-manifest.json`.
- `tools/probes/art-local-2/README.md`: generator timings and licences.
- [LoRA silent no-op on quantized sd.cpp weights](../integration-issues/lora-silent-noop-on-quantized-sdcpp-weights-2026-09-27.md).
- [Consistent portrait expressions from one masked base](portrait-expressions-from-one-masked-base-2026-10-08.md): the masked-edit route that worked for portraits.
- ADR-0007, local image generation.
