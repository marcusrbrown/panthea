# Post-step parity fixture

One slot, six frames, for `src/render/post.ts` (retro build-out U5). It lets the parity test run from a clean checkout: no Blender, no ffmpeg, no Python.

## What is in it

| Path | Contents |
| --- | --- |
| `frames/<name>.{colour,id,depth}.png` | The probe's raw 4x passes (448x384, 8-bit RGBA), byte for byte. Depth is 8-bit through the sRGB curve, which is the quantisation `decodePng` reads. |
| `frames.json` | Slot settings (cell 112x96, origin and pivot (56, 78), depth range 18-22 m, overlap threshold 0.05 m, shadow 10x5 px in `olive` shade 1) and each frame's facing and stamp locators (bolt base/tip/depth, eye pixels and depths). |
| `expected/<name>.png` | The probe's own cells for the same frames. |
| `expected.json` | Per-cell facts (height, width, bottom row, colours with and without the shadow, outline, box, overlap pixels, stamp counts), decoded-pixel hashes, and the slot envelope. |
| `palette/` | `palette.json`, `master.gpl`, `master.hex` copied from `content/greek/palette/greek-retro` when the fixture was made (a draft palette). The fixture keeps its own copy so the parity result does not move when the draft palette is edited. |
| `golden.json` | The TypeScript step's decoded-pixel hashes and envelope, with the `POST_STEP_VERSION` they belong to. `src/render/post.test.ts` holds the step to it. |

About 260 KB in all.

## Where it came from

- Probe run: `render_retro.py --tag r3`, item `zeus-tall` (Blender 5.2.2 LTS, build `d13f752e3b9c`), slot `cast` / `west`, frames 0-5. Raw frames from `tools/probes/retro-render/scratch/render-r3/zeus-tall/` in the main checkout.
- Cells: `postprocess_retro.process_item`, unmodified, run by `tools/probes/retro-render/export_parity_fixture.py` with the palette read from `greek-retro` instead of the probe's `scene-palette.json`. The probe flattens a palette in listed order and a mode tie goes to the earliest colour, so the order is part of the result; the studio flattens `greek-retro` the same way (families in file order, first occurrence wins).
- Reproduction: the same six cells made with the probe's own `scene-palette.json` order (`scratch/cells-r3`) are pixel-identical to the exported ones (6/6), and all 144 cells of the r3 `zeus-tall` run are byte-identical when the probe's post step is re-run from its raw frames.
- Why this slot: it has the most stamp variety in a single slot: face stamps (3 px per eye), the bolt at three orientations (135, 0, 90), the protected bolt hand, and one frame (`cast_west_04`) where two bolt pixels are occluded by depth. Paths the slot does not reach (rim pixels drawn over the body, half-way rounding, overlap-line ties) are pinned by unit tests in `src/render/post.test.ts`.

Decoded-pixel hash: sha256 of `"<w>x<h>:"` followed by the RGBA bytes with the RGB of every alpha-0 pixel zeroed. PNG bytes are never compared: Blender writes date and render-time chunks.

## Regenerating

The probe's cells are history; do not regenerate them to make a test pass.

```sh
# probe side (needs ffmpeg and the r3 raw frames):
python3 tools/probes/retro-render/export_parity_fixture.py \
  --scratch <main checkout>/tools/probes/retro-render/scratch --out packages/assets/test/fixtures/render

# a deliberate change to the TypeScript step, in the commit that bumps POST_STEP_VERSION:
bun run packages/assets/test/render/update-golden.ts
```
