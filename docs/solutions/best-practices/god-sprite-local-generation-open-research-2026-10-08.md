---
title: "Local 64x80 god sprites on a 16 GiB M1 Pro: palette downscale at any ratio, then specified pixel edits"
date: 2026-10-08
last_updated: 2026-10-08
category: best-practices
module: art-local
problem_type: best_practice
component: tooling
severity: high
applies_when:
  - "Turning a local generated full-body image into a 64x80 god sprite"
  - "A generated figure has the right identity but the wrong height after conforming"
  - "Conformance passes but the sprite does not read at 1x"
related_components:
  - assets
tags: [sprites, pixel-art, local-models, m1-pro, z-image, palette-downscale, outline, idle-animation]
---

# Local 64x80 god sprites on a 16 GiB M1 Pro: palette downscale at any ratio, then specified pixel edits

## Context

Zeus has a canon idle-south sprite, `zeus-sprite` (#188), made entirely on this machine. The target, from `docs/product/art-guide.md`, is a 64×80 cell, a figure 48–56 px tall, a 1 px selective outline in the darkest shade of the local ramp, at most 16 Olympus colours, binary alpha, a pivot at (32,80), and Zeus's bolt.

Earlier this doc recorded the sprite as open research, with Zeus on `placeholder-zeus` and every route rejected. That was superseded on 2026-10-08. The failed routes are kept below as the record.

The missing piece was the downscale. Every earlier route reduced by a whole number: conforming accepts only a scale where source size = scale × cell, so a 512×640 render is always scale 8, and one route snapped 11× nearest-neighbour. Figure height then followed the model's composition: 62–70 px against 48–56.

## Guidance

1. **Generate only the base, through the studio.** Z-Image Turbo text-to-image (Apache-2.0), 512×640, 8 seeds. Take the look from the canon portrait through the studio's `--style-note`, without editing content:
   - swept-back hair, a long white beard, a draped himation;
   - front view, full body, both feet visible;
   - the bolt raised in the viewer-left hand;
   - a plain flat background with no scenery.

   Pick the strongest king-god figure. A cleanup cannot rescue a weak base.
2. **Re-key at source resolution with recorded rules, never by hand-erasing.** Use, in order:
   - a border-flood key;
   - a ground-shadow colour band limited to the lowest rows, plus a low-chroma fringe;
   - a second flood, which frees the gap between the legs;
   - keep the largest 8-connected component.

   Measure the two soles and their midpoint at source resolution. Measure body height (crown to soles) separately from the raised-bolt tip. See `tools/probes/art-edit/run_sprite_c2a.py`.
3. **Downscale at any ratio onto the palette, then conform at scale 1.**
   - Scale = target body height ÷ source body height.
   - Each output pixel covers a source rectangle. Mode sampling takes the palette colour with the most covered area once each source pixel is snapped in OKLab.
   - Coverage of 0.5 or more makes the pixel opaque; alpha is binary.
   - Add a 1 px exterior outline in the darkest shade of the ramp, then place by the soles' midpoint: soles on row 78, outline on row 79.

   Mode gave the cleanest flat clusters. Area-average and unfake's content-adaptive method left mixed-shade speckle. The chosen tile was a 50 px body, 54 px with the bolt. See `tools/probes/art-edit/sprite_downscale.py`.

4. **Have the independent reviewer write the pixel spec, and apply it as data under budgets.** The spec fixes three regions:
   - **Face:** 2 dark eyes, 2 white brows, 1 nose-shadow pixel, the beard edge, and no mouth. At this size a face is eyes and brow (art guide).
   - **Bolt:** an angular Z on a 3-segment centreline, 2 px fill, a 1 px tip, entering the fist, with nothing below the fist. Remove the old prop and its halo.
   - **Cloth:** consolidate the stipple into folds.

   Each region has a ceiling. The script refuses any write outside its region and any region over budget: 131 of 920 pixels changed, against a ceiling of 184. See `sprite_cleanup_c2b.py`.
5. **Fix the outline in its own pass, recolouring only.** The alpha mask stays identical. The rules:
   - each exterior pixel becomes the darkest shade of the ramp it bounds;
   - the inner pixel of a 2 px band becomes the next-darker shade;
   - overlap lines stay 1 px, in the front form's darkest shade;
   - seams inside one form become its shadow tone.

   The reviewer ruled on the cases the rules could not settle: layer order, the soles' base row, and which overlap lines to keep. That pass recoloured 236 pixels. See `sprite_cleanup_c2c.py`.
6. **Author the idle as pixel operations with fixed parts.** The frames:
   - **F0:** the static frame.
   - **F1:** a 2-pixel chest-fold shift.
   - **F2:** a cluster mask (head, beard, shoulders, upper chest) moves up 1 px. Cells it vacates are filled from below, plus 3 repair pixels. It holds F1's fold, because a fold that drops back at the peak moves against the breath.
   - **F3:** a 1-pixel change.

   The bolt, fist, raised forearm, robe and feet are identical in every frame, and tests prove it. Timing is 333/167/333/167 ms. Idle allows 3–6 fps (`content/greek/assets/vocabulary.json`), because a flat 6 fps loop (668 ms) read as a brisk bob. See `sprite_idle_c2.py`.
7. **Pack and publish through the studio.**
   - Conform the 512×640 job at scale 8 only as the lineage pick. Its own report fails, which doesn't matter.
   - Run set-create, pick, open, export.
   - Replace the sheet with the scripted frames, their durations and the pivot slice.
   - Import and finish with scripted provenance, then pack, approve by revision, and publish through a config whose `registryRoot` is `content/greek/assets/registry`.

   See [Scripted art edits record method script](scripted-art-edits-record-method-script-provenance-2026-10-08.md).

## Why This Matters

The generator is good at a figure's identity and modelling, and bad at an exact cell. Downscaling at any ratio moves height, palette, alpha, outline and pivot into deterministic code. That leaves the model the part it does well. Specs with budgets keep each edit small enough to review. They also stop a cleanup from replacing the modelling that made the base worth keeping.

## When to Apply

- Any god or mortal world sprite from local generation.
- A pose and identity worth keeping that fails height, palette, outline or pivot.
- Review feedback that can be stated as regions, coordinates and colours.
- A restrained idle, not a walk or an action cycle. Those are still drawn or generated and repaired.

## Examples

**Height.** The best earlier pose came out 63 px tall at the forced scale 8. Downscaling at any ratio hit 50, 54 and 56 px exactly on all 48 tiles from the any-ratio methods (`tools/probes/art-edit/README.md`, "Sprite downscale (Phase A)").

**Redraw against a spec.**
- **B1** rebuilt the figure as a mirrored half plus patches. It changed 912 of 1050 pixels, lost the base's light and volume, and was rejected.
- **C2b** changed 131 of 920 pixels inside three declared regions and kept the base's modelling.

**What didn't work**

| Route | Why it failed |
|---|---|
| Z-Image text-to-image at a forced integer scale (r1–r4c) | Scenery iconography polluted prompts, and "facing south" needed view wording. The height came from the composition. |
| Re-conform at a smaller scale | `conformance.ts` accepts only source = scale × cell. |
| Pixel edits without a spec (r5–r7) | Blurry, a cloak that read as tattered, a stray dagger. |
| FLUX.2 Klein + pixel-walk LoRA | Chibi proportions, a walk sheet, no bolt. |
| SDXL + pixel-art-xl | A readable silhouette but no bolt, and OpenRAIL-M keeps it out of canon. |
| Bolt inpainting | No clear bolt on 8 seeds. |
| Masked img2img from a hand-blocked init (r8, r9) | The init background was the outline shade, so keying removed the outline. Rejected. |
| Mirrored redraw over a downscaled SDXL tile (B1) | Replaced the modelling with primitives: a symmetric "toy". |
| Light-touch cleanup of that tile (B2, B2c) | Passed independent review. The owner rejected it: the bolt read as a snake, the face as noise, and it did not read as Zeus. The base was too weak. |

## Related

- `tools/probes/art-edit/README.md`: the "Sprite downscale (Phase A)" through "Sprite Phase C2 idle" sections.
- `docs/evidence/asset-studio/unit5/README.md`: the Zeus god sprite section.
- [Scripted art edits record method script](scripted-art-edits-record-method-script-provenance-2026-10-08.md).
- [Generated art independent review roles](../workflow-issues/generated-art-independent-review-roles-2026-10-08.md).
- [Consistent portrait expressions from one masked base](portrait-expressions-from-one-masked-base-2026-10-08.md): the same cleanup discipline for portraits.
- [Canon registry polluted validator fixtures](../test-failures/canon-registry-polluted-validator-fixtures-2026-10-08.md): the sprite publish hit it again.
- ADR-0007, local image generation.
