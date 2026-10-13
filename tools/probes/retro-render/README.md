# retro-render: does a pre-rendered retro look work across a whole scene?

## Outcome

**2026-10-12: the owner accepted the pre-rendered retro direction** after watching timed playback of the scene: a tall Zeus (60–64 px standing) on a 112×96 pose cell, and a 16-frame walk over 800 ms. The art-guide change comes next as an ADR; this probe is its evidence. Nothing here is canon, and the art guide, palette and Zeus's published sprites are unchanged until that ADR lands.

Known open items, all build-out work rather than direction questions:

- Zeus is squat and bow-legged, with gold-stick legs below the hem.
- The mortal's tunic goes grey in shade, with a skin patch at one hip.
- The tree is a plain cone.
- The temple has blank planes (no frieze, fluting or weathering).
- The ground tiles repeat visibly.

Status: probe, 2026-10-12, three rounds; [Round 2: characters](#round-2-characters) and [Round 3: walk resampling](#round-3-walk-resampling) are at the end and supersede the round-1 notes on the animal slot and Zeus's 64×80 cell. Stacked on `probe/blender-sprite`. Provisional target for this probe only; it does not change [the art guide](../../../docs/product/art-guide.md). Nothing here is canon, and the only committed art is what the scripts generate; renders go under the gitignored `scratch/`.

**Question.** The owner wants sprites in the line of Diablo II, Fallout 1/2, Age of Empires II and Dead Cells: pre-rendered, fluid, chunky, more detail, a Chrono Trigger influence. Can an agent-driven headless-Blender pipeline produce a scene (temple, path, tree, Zeus, a mortal) that holds together at that bar, with the existing palette tools and the 64×32 client tile?

**Short answer.** The environment items work. The scene reads as one hand at 1× and 3× for ground, temple, house and tree. Characters are the weak part: Zeus and the mortal read as figures but not as polished sprites. The animal slot is **not rendered**: the farm-animals pack ships no licence file (see Provenance).

## Target (provisional)

| | |
| --- | --- |
| Gods | 64×80 cell, 48–56 px figure, fixed anchor (32, 74) |
| Mortals | the guide's 64×64 cell and 40–48 px; anchor (32, 58) |
| Palette | scene palette of 54 colours (9 ramps × 6 shades), limit 64; up to 48 per sprite |
| Shading | five lit-toon bands (`toon`) against the same bands plus a light 4×4 ordered dither (`dither`); two variants |
| Outline | automatic 1 px darkest-local-ramp exterior outline, plus selective overlap lines from the part-ID and depth passes (reused from `blender-sprite`) |
| Alpha | binary |
| Tile | the client's 64×32 tile drawn as a 64×31 diamond (`packages/renderer/src/iso.ts`) |

## Method

1. **One camera.** Round 1's 2:1 orthographic camera (X 60°, Y 0°, Z 45°) at its calibrated 29.0788 px per metre, shared by every item, so a tile is 1.5563 m on a side and everything sits at one scale. Items differ only in cell size and where the world origin lands in it (`retro_plan.py`).
2. **Palette** (`palette_plan.py`, `palette/scene-palette.json`). Olympus (marble, pale-gold, cloud, lapis) and four town and underworld ramps (soil, olive, terracotta, stone-sky, bone), each grown from 4 to 6 shades by inserting OKLab midpoints into the widest lightness gaps. Every original shade is kept, so canon Zeus and the round-3 bolt stamp are still inside the palette. Shade 0, the darkest, is the outline's; the five bands use shades 1 to 5.
3. **Shading.** Diffuse → Shader to RGB → value (+ per-material bias) → constant 5-stop ColorRamp → Emission, EEVEE, Standard view transform, filter size 0, transparent film. The `dither` variant adds a 4×4 Bayer texture (one texel per final pixel, ±0.08 on the value) before the ramp, so it only changes pixels near a band edge. All 4× renders go through the existing mode-downscale, snap-to-palette and outline steps.
4. **Post step** (`postprocess_retro.py`). 4× → 1× by method M (mode of palette-snapped pixels), 1 px exterior outline, overlap lines from the part-ID and depth passes, then the authored stamps (below). Tiles are cropped to the drawn diamond and take no outline.
5. **Measurements.** Per cell: height, bottom row, colours, outside-palette pixels, outline, binary alpha, anchor; per clip and facing: boil and loop seams (`retro_metrics.py`). Report-only; no gates.

## Items

| item | how it is built |
| --- | --- |
| Zeus | Universal Base Characters male body on the UAL clips (same bone names, no retarget needed). Body scaled 1.28 wide × 1.18 deep × 0.90 high, head and hands scaled up on their bones, then fitted to a 50 px interior. Robe: lofted, bone-weighted, a straighter column than round 3's bell (hem half-width 0.25 m against 0.29). Beard and hair: the pack's own `Hair_Beard` and `Hair_SimpleParted`, bound to the head bone. Bolt: round 3's authored stamps. Face: authored stamps below. Idle 6, walk 8, cast 6 frames; 4 facings |
| Mortal | The female base character in a lofted chiton, `Hair_SimpleParted`, skin and tunic recoloured through ramps; fitted to a 42 px interior (43–45 px with the outline); idle 6, walk 8; south and east |
| Animal | **not rendered** (no licence file in the pack) |
| Tree | Kenney `tree_cone`, scaled to 4 m. Wind loop: 12 frames over 2 s, displacement weighted by height², phase `2π·f/12 − 1.2·(z/h)` so the crown lags the trunk, one cycle per loop, duplicate endpoint excluded (`wind_plan.py`). Frame 12 is also rendered and compared with frame 0 |
| Temple | Peripteral temple from primitives: three-step stylobate, ten columns with bases and capitals, three-band entablature, pediment and gabled roof, cella with a door. 3×2 tile footprint, pivot on the footprint's bottom vertex. Rotated into the tile axes so it aligns with the 2:1 grid |
| House | Quaternius `House_1`, scaled to fit a 2×2 footprint, as a style comparison; its material colours are mapped to ramps by nearest OKLab colour |
| Tiles | One 64×32 path tile (dirt border, flagstones, pebbles) and one grass tile (tufts, three flowers); details stay inside the diamond |

### Authored art that remains

No frame is hand-edited. Two kinds of **authored** pixel art are composited by script, and everything else is scripted geometry and materials:

- **Bolt stamp.** The eight authored orientations from `blender-sprite/stamps/` (82–90 pixels, three palette colours), placed at the projected bolt-hand locator and occluded with the part-ID and depth passes. Not rendered.
- **Face stamp** (`stamp_plan.py`). Eyes and brows only: south 6 pixels (two eyes, two 2-pixel brows), east and west 3 pixels (the eye nearer the camera and a 2-pixel brow), **none on north**. Colours are the lapis and marble darkest shades. Placed at the projected centre of the hidden eye mesh and drawn only on pixels the render left as `head`, so hair and beard cover it. In all 24 idle cells every planned face pixel was drawn.

## Provenance

Source pages, licence text, date (2026-10-11), and sha256 of every zip and every file used are in [`models.json`](models.json). All paths are `<main-checkout>/…`; nothing under `models/` is committed. `retro_assets.py` lists every file the renderer imports (`render_retro.py` builds all its import paths through it), and `test_provenance.py` checks that list against `models.json`, both ways: an imported file without a hash fails, and so does a recorded file nothing imports.

| pack | source | licence | status |
| --- | --- | --- | --- |
| Universal Base Characters [Standard] | quaternius.com/packs/universalbasecharacters.html | CC0 1.0 (`License_Standard.txt`) | used (both base bodies, `Hair_Beard`, `Hair_SimpleParted`, and Zeus's `Hair_Long`) |
| Medieval Village Pack - Dec 2020 | quaternius.com/packs/medievalvillage.html | CC0 1.0 (`License.txt`) | used (`House_1`) |
| Nature Kit 2.1 | kenney.nl/assets/nature-kit | CC0 (`License.txt`) | used (`tree_cone`) |
| KayKit Forest Nature Pack 1.0 FREE | kaylousberg.itch.io/kaykit-forest | CC0 (`License.txt`) | inspected, not used |
| Ultimate Animated Animals | quaternius.com/packs/ultimateanimatedanimals.html | CC0 1.0 (`License.txt`) | used (`Bull`) |
| Farm Animals Animated | quaternius.itch.io/lowpoly-animated-animals | **no licence file ships** | **not used** |
| Universal Animation Library [Standard] | see `tools/probes/blender-sprite/models.json` | CC0 1.0 | animation source |

**Licence surprises.**

- **Farm Animals Animated has no licence file.** The archive holds OBJ, FBX and Blend files and a preview GIF, with no licence text. The itch.io page fetched without a browser did not state the licence either. Per the rule for this probe, it was not used. Its contents are Cow, Horse, Llama, Pig, Pug, Sheep and Zebra: there is no goat, and Sheep is the Mediterranean choice. The bull comes from Ultimate Animated Animals instead.
- **The Medieval Village and Ultimate Animated Animals zips are Google Drive re-zips** (for example `…-20261012T081001Z-1-001`), so their hashes will not match Quaternius's own downloads. Each inner `License.txt` is CC0.
- **Kit materials are not used.** Every material is replaced by a palette ramp; textures are never read.

## Commands

A tag selects one consistent set of directories (`retro_paths.py`): `render_retro.py --tag T` writes `scratch/render-T/<item>/`, `postprocess_retro.py --tag T` reads it and writes `scratch/cells-T/` and `scratch/report/retro-T-<item>-results.json`, `build_report.py --tag T` and `check_resample.py --tag T` read those. `postprocess_retro.py` exits 1, before processing anything, when a requested item has no render; `build_report.py` and `check_resample.py` exit 1 when their inputs are missing.

### Current round (round 3): render, post, report, resample check

Run it as a script from the repository root; it stops at the first failure. `MODELS` is the checkout that holds `models/` (the `<main-checkout>/tools/probes` directory); set `TAG` to render into a fresh scratch tag instead of `r3`.

```sh
set -euo pipefail
: "${MODELS:?set MODELS to <main-checkout>/tools/probes}"
TAG="${TAG:-r3}"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
PROBE=tools/probes/retro-render

for ITEM in zeus zeus-tall mortal bull tree temple house tile; do
  "$BLENDER" --background --factory-startup --python-exit-code 1 \
    --python "$PROBE/render_retro.py" -- \
    --item "$ITEM" --models "$MODELS" --tag "$TAG"
done
python3 "$PROBE/postprocess_retro.py" --tag "$TAG"   # cells, measurements, per-item results
python3 "$PROBE/build_report.py" --tag "$TAG"        # sheets, GIFs, scene mockup
python3 "$PROBE/check_resample.py" --tag "$TAG"      # walk[i] == walk16[2i]; exit 1 on RED
```

Run end to end from a clean shell into a fresh tag, this block took 290 s of wall-clock on this machine (eight Blender processes one after another, then the post step, the report build at about 110 s, and the resample check) and ended with `GREEN` (32 of 32 pairs for Zeus and tall Zeus, 16 of 16 for the mortal, 0 pixels differing).

Regenerate the committed files when their inputs change (neither is part of a render run):

```sh
python3 tools/probes/retro-render/palette_plan.py             # palette/scene-palette.json
python3 tools/probes/retro-render/make_models_json.py --models "$MODELS/retro-render/models"   # models.json
```

`render_retro.py` options: `--tag T` (or `--out DIR`), `--variants toon`, `--only clip:facing:index`, `--no-passes`, `--tree`, `--house`. Blender 5.2.2 LTS (hash `d13f752e3b9c`, built 2026-09-15). Everything is built from a factory start in the process; no `.blend` is saved.

### Historical (round 1/2)

These are the round 1 and round 2 invocations, rewritten for the current tool flags, and kept for the record. The code has changed since (profiles, canvases, shadows, the walk resampling fix), so they do not reproduce the round 1 and 2 outputs; use the current-round sequence above. Round 1 rendered six items into the untagged `scratch/render` (it had no Zeus tall and no bull), round 2 added both and used the tag `r2`:

```sh
# round 1 (untagged directories: --tag "" selects scratch/render and scratch/cells)
for ITEM in tile tree temple house zeus mortal; do
  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 \
    --python tools/probes/retro-render/render_retro.py -- \
    --item $ITEM --models "$MODELS" --out tools/probes/retro-render/scratch/render
done
python3 tools/probes/retro-render/postprocess_retro.py --tag "" --items tile,tree,temple,house,zeus,mortal
# build_report.py now requires cells for all eight items, which round 1 did not have

# round 2 (the same loop over all eight items with --tag r2, then postprocess_retro.py --tag r2 and build_report.py --tag r2)
```

The round 1/2 README listed the round 1 render loop with no tag and ran postprocess and build with their default tag (`r2`), which read `scratch/render-r2` and `scratch/cells-r2`: every item was skipped, the exit status was 0 and no report was written. That is the defect `retro_paths.py` and the exit-1 check close.

## Results

Variant `toon` (`dither` differs by 0 to 3 colours and is in the JSON). Heights include the outline. All 250 cells are in the palette (0 pixels outside it), have binary alpha and the exact origin anchor, and use at most 23 colours, far under the 48 limit.

| item | clip | cells | height px | bottom row | colours (max) | outline | overlap-line px / cell |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Zeus | idle | 24 | 50–56 | 79 | 18 | 12 of 24 | 45.8 |
| Zeus | walk | 32 | 47–59 | 73–79 | 18 | 25 of 32 | 42.1 |
| Zeus | cast | 24 | 51–67 | 79 | 18 | 8 of 24 | 40.9 |
| Mortal | idle | 12 | 43–45 | 63 | 12 | all | 28.0 |
| Mortal | walk | 16 | 41–44 | 58–63 | 12 | all | 35.4 |
| Tree | wind | 13 | 107–110 | 124 | 10 | all | n/a |
| Temple | static | 1 | 189 | 222 | 18 | yes | 401 |
| House | static | 1 | 122 | 154 | 20 | yes | 13 |
| Tile | path, grass | 2 | 31 | 30 | 7, 6 | none (diamond) | n/a |

- **Zeus height.** 50–56 in idle (inside the 48–56 band); **over 56 in 9 cells**: walk north frames 0, 1, 4, 5, 7 (57–59), cast north frames 0, 4, 5 (60–61) and cast west frame 4 (67), all with the bolt arm raised; the stamp, not the body, makes them tall.
- **Zeus outline.** The `outline` measure is false in 35 of 80 cells: the bolt stamp's bright pixels or the toes touch the cell edge, and the stamp is composited after the outline. Feet reach row 79, as in round 1, because the nearer toe sits below the sole midpoint.
- **Bolt stamp.** 79% of stamp pixels visible overall; clipped by the cell edge in 14 of 80 cells (cast south and north mostly).
- **Mortal height** is 41–45, inside 40–48; the pivot is the sole midpoint at (32, 58).
- **Temple and house** use the footprint pivot (bottom vertex): temple 3×2 at (96, 222) in a 192×232 cell; house 2×2 at (96, 168) in a 192×176 cell.

### Boil (information only, not a gate)

Index changes between consecutive frames over silhouette-stable pixels (the pixel and its eight neighbours opaque in both frames). **Noise** is a change inside a part whose mask barely moved (overlap ≥ 0.97 with the previous frame); **motion** is a change inside a part that moved.

| clip | changed / stable (toon) | noise | motion | noise as share of still-part pixels |
| --- | --- | --- | --- | --- |
| Zeus idle | 15.2% | 134 px | 2,967 px | 4.0% (dither 3.4%) |
| Zeus walk | 39.1% | 0 | 7,961 | none (every part moves) |
| Zeus cast | 12.9% | 210 | 1,901 | 3.2% |
| Mortal idle | 17.2% | 40 | 783 | 3.9% (dither 6.7%) |
| Mortal walk | 42.5% | 0 | 1,998 | none |
| Tree wind | 3.6% | no part pass | no part pass | n/a |

Almost all of the churn is motion: parts moving across five band edges. The noise that is left (3–4% of the pixels in parts that did not move) is small, and dithering does not reduce it consistently (lower for Zeus, higher for the mortal). Round 3 measured Zeus idle at 12.5–24.7% on its three-band bake; this is not comparable one for one (different sampling and bands) and is not claimed as an improvement.

### Loop seams

- **Tree wind: frame 12 equals frame 0**, pixel for pixel, in the raw 4× render and in the finished cell, for both variants (`wind_seam.all_identical`). The sway is a single cycle per loop with the endpoint excluded; the pure-Python `wind_plan.displacement` and the vectorised version agree to 2e-16.
- Step ratio (wrap step against the mean step) for Zeus loops is 0.91–1.41, mortal 1.00–1.30, tree 1.09: nothing jumps at the loop point, and the larger ratios are idle frames that barely move.

### Timing

| item | render (wall, both variants and both passes) | mean per image | post step |
| --- | --- | --- | --- |
| Zeus | 17.0 s (320 images) | 43–50 ms | 28 s |
| Mortal | 6.6 s (112 images) | 41–51 ms | 9 s |
| Tree | 1.3 s | 43–52 ms | 4 s |
| Temple | 0.7 s | n/a | 1 s |
| House | 0.7 s | n/a | 1 s |
| Tiles | 0.6 s | n/a | 0.5 s |

Report build (sheets, 12 item GIFs, 4 scene GIFs): 55 s. The whole scene, from nothing to GIFs, is about 2.5 minutes of compute on this machine (six Blender processes, one per item, no GPU tuning).

## Outputs

All under `tools/probes/retro-render/scratch/report/` (gitignored).

| file | what |
| --- | --- |
| `retro-scene-{toon,dither}-still-{1x,3x}.png` | scene mockup: 6×7 diamond tiles, path, temple behind, tree, Zeus, the mortal, a medieval house for comparison, and **canon Zeus idle** beside ours (right of ours, on the grass) |
| `retro-scene-{toon,dither}-anim-{1x,3x}.gif` | the same scene animated; Zeus idle (1000 ms), the walking mortal (800 ms), the tree (2000 ms) and canon Zeus idle (333/167/333/167 ms) each at their own timing, looping every 4 s; delays sum to exactly 400 cs |
| `retro-<item>-<variant>-contact-{1x,4x}.png` | contact sheets, canon Zeus idle frame 0 at the left of the first row; rows are clip and facing, columns frames |
| `retro-<zeus\|mortal\|tree>-<variant>-<clip>-3x.gif` | timed GIF per animated item, canon Zeus idle in the first panel; 12 files |
| `retro-<item>-results.json` | per-cell measurements, boil, seams, timings, dims (every item) |
| `retro-report.json` | the output index |

The cells themselves are in `scratch/cells/<item>/<variant>/`, and raw 4× renders and passes in `scratch/render/<item>/`.

## Honest read

**At 1× and 3× in the scene** (stills; I did not watch the GIFs, I checked their frame counts and exact delays):

- **Works.** The ground tiles lock into a seamless grass and path field at the client tile. The temple reads at once as Greek, sits on its footprint, and shares the palette and light with the house; the house, a kit model recoloured through ramps, looks like the same set of art as the temple. The tree is clean and rounded. Five bands plus the outline give the Chrono Trigger-style flat-shaded look; it is the biggest improvement over the three-band mannequin.
- **Zeus** reads as a bearded, robed figure with a bolt, and the face stamp gives him a face. He is clearly not canon: a bell-ish robe, a heavy gold arm mass, a white cap of hair. The bolt is an authored stamp, so it reads by construction, and it is clipped at the cell edge in 14 cells.
- **The mortal** is crude: the head scales out of proportion, the hair reads as a hat, and the tunic is a flat rectangle. It is the weakest item.
- **Dither vs toon.** At 1× the dither is a faint grain on robes and the temple roof; at 3× it reads as a softer gradient on large surfaces. It adds one to three colours and does not reduce boil. I would pick plain `toon` for characters and leave `dither` as an option for large surfaces (roof, ground), but the owner should judge.

**What still failed or is open.**

- No animal: pack unlicensed (see Provenance).
- Zeus is over 56 px in 9 cells (stamp above the head), and the outline measure fails in 35 where the stamp or feet touch the cell edge.
- Cast poses are weak from south and north: the arm points out of the cell, so I pulled the lateral aim to 0.55; the pose is a throw, not Zeus.
- Characters need real work that this probe did not do: facial form, a modelled robe with vertical folds, proper hands, a mortal with her own proportions and hair. Kitbashing from CC0 kits covers environments well and characters poorly.
- The temple is primitives with no weathering or detail; at this level it works, and it would want ornament (frieze, acroteria, fluting) to carry more.
- Boil is not solved; fluid motion costs palette churn on every moving part, and walk cycles churn about 40% of stable pixels.

## Tuning iterations

| area | iterations |
| --- | --- |
| Band cut points and light | 3 (0.36/0.55/0.74/0.93 at sun 2.8, then 0.40/0.58/0.76/0.92 at sun 3.6 and ambient 0.32); the first washed the robe out |
| Kit colours | 2: kit greens and browns are mid-tone, so they came out too light until a per-material bias of −0.3 to −0.5 was applied |
| Tree choice | 5 trees rendered at 1×: `tree_cone`, `tree_thin`, `tree_pineTallA`, `tree_pineSmallA`, `tree_oak`. `tree_cone` is the closest to a cypress |
| Temple | 3: the pediment's end faces were drawn as roof (material indices reset when a slot list was cleared), a 4×3 footprint was too big for the scene, the pediment was too shallow |
| Zeus build | 6: head and hands as bone scales, non-uniform body scale, the hair meshes, hair material, cast lateral aim, foot scale back to 1.0 (larger feet stuck out at the cell edge) |

## Tests

`python3 -m unittest discover tools/probes/retro-render`: 80 tests covering the palette build, tile geometry, wind-loop maths (including frame N equals frame 0), shading bands and ordered dither, part IDs and depth encoding, the face-stamp placement, boil and seam metrics, the scene timeline (exact, no accumulated rounding), placement and depth order, and GIF delay rewriting. The Blender runs themselves are not unit-tested.

## Round 2: characters

One bounded pass on shape and framing, after a review that found the direction viable and the characters weak. Same rule as before: no output frame is hand-edited; every change goes through the model, the rig, materials, framing or the scripted post step. The authored art is still the bolt stamp and a face stamp, both composited by script.

> **Superseded in part by [Round 3](#round-3-walk-resampling).** The Zeus `walk16` rows below (pose, 8-against-16 numbers, bolt visibility) came from a resampling bug, the tall Zeus canvas is now 112×96, and the shadow's checker rim is gone.

### What changed

| # | change | where |
| --- | --- | --- |
| 1 | **Separate proportion profiles.** Round 1 gave both characters head ×1.7 and hands ×1.55. Zeus: head ×1.5, hands ×1.1 curled into a simple fist, head pitched back 25° (the clips bow it toward the camera), hair that frames the face (the pack's `Hair_SimpleParted` with the front trimmed to a high hairline, side locks and a back mass cut from `Hair_Long`, plus `Hair_Beard`), a straighter robe (hem half-width 0.227 m, was 0.254 m, so the column is 11% narrower at the hem) with five broad folds. Mortal: head ×1.25, hands ×1.1, limbs 12% shorter (a length scale on thigh, shin, upper arm and forearm; the hands and feet keep their size), 20° head pitch, the same trimmed cap plus a top knot, a belted chiton with an open neckline, a flared skirt with broad folds and a trimmed hem. Base meshes are unchanged | `retro_plan.py` (`Profile`, `HairPiece`), `render_retro.py` |
| 2 | **Gods on a 96×96 pose canvas** at the same world and camera scale; no south/north cast compression (round 1 pulled the aim forward to fit 64 px). Two Zeus variants: standing 50 px interior (52 with the outline) and 60 px interior (62 with the outline), the second made by enlarging the model. The mortal keeps her 64×64 cell (her envelope does not clip) | `retro_plan.py`, `postprocess_retro.py` |
| 3 | **Walk smoothness**: `walk` (8 frames) and `walk16` (16 frames) over the same 800 ms, for Zeus and the mortal | `retro_plan.py` |
| 4 | **One exterior outline** on the final combined silhouette. Face and bolt stamps are composited first; the stamp's own darkest-gold outline pixels are drawn only where they lie on the body (a separation line), and the exterior pass draws the rest, so nothing is outlined twice. Overlap lines stay selective | `postprocess_retro.py` |
| 5 | **Contact shadows**: a 2:1 ellipse in one palette colour (`olive` darkest) with a solid core and a checkerboard rim, drawn on empty pixels after the outline. Zeus 10×5 px, the mortal 7×3.5, the bull 14×6, the tree trunk 9×4.5 | `shadow_plan.py` |
| 6 | **Canon placed by its manifest**: canon Zeus uses pivot (32, 80), not (32, 74) | `retro_plan.py` (`CANON`), `scene_plan.py` |
| 7 | **Boil metric honesty and a surface measure** (below) | `retro_metrics.py` |
| 8 | **Toon only**; the dither variant is gone from this pass | `--variants toon` |
| 9 | **Tuning log** with wall-clock time (below) | this file |
| 10 | **Animal**: the Quaternius Ultimate Animated Animals pack arrived; the Bull is in the scene (Provenance below) | `render_retro.py` (`Animal`) |

**A bug found on the way.** `build_garment` called `materials.clear()`, which resets every face's material index to 0. The belt and the hem trim were never drawn in round 1, in either character. Fixed (the garment now only pads its slots); both read as gold bands in round 2.

### Canvas, pivot and envelope

The pivot started at (48, 88). The first full pass showed the nearer toe 8 px below the sole midpoint, on the canvas's last row, so the pivot moved to **(48, 78)** (the envelope centred vertically, slack split between top and bottom). Standing body height, maximum action extent and margin are kept as separate numbers; the envelope covers every cell of every clip and facing including the bolt and face stamps and the outline, but not the shadow.

| item | cell | pivot | standing height (idle, with outline) | action extent from the pivot: up / down / left / right | margin to the canvas edge: top / bottom / left / right |
| --- | --- | --- | --- | --- | --- |
| Zeus (standard) | 96×96 | (48, 78) | 51–55 px | 59 / 8 / 42 / 42 | 19 / 10 / 6 / 6 |
| Zeus (tall) | 96×96 | (48, 78) | 61–63 px | 68 / 9 / 47 / 47 | 10 / 9 / 1 / 1 |
| Mortal | 64×64 | (32, 58) | 43–44 px | 42 / 3 / 12 / 13 | 16 / 3 / 20 / 19 |
| Bull | 80×56 | (34, 37) | 28–36 px (head bob) | 28 / 10 / 18 / 31 | 9 / 9 / 16 / 15 |

- **Nothing clips**, but the tall Zeus's cast spans 94 of 96 px (margin 1 px each side, the arm with the bolt stamp at full reach). A comfortable margin for the tall variant needs a canvas around 112 px wide. The standard variant has 6 px.
- The 64×80 cell and (32, 74) anchor stay in the plan as `GOD_SPRITE_*` for reference; nothing renders on them any more.
- The mortal's first and only envelope fits her cell, so she was not padded. The bull's canvas and pivot were fitted once from its first measured envelope (96×64 / (48, 52) → 80×56 / (34, 37)).

### Results

All 393 cells have 0 pixels outside the palette, binary alpha, the exact origin anchor, and a complete exterior outline (round 1 failed the outline measure on 35 Zeus cells). Colours per cell: Zeus 18, mortal 22, bull 16, far under the 48 limit. Heights include the outline. The stamps are included in the colour counts. *(Round 3 correction: the colour and palette counts here and in the table below were measured on the figure before the contact shadow was drawn, not on the final cell as this sentence said; see [Measurement scope](#measurement-scope-colours-with-the-shadow-everything-else-without).)*

| item | clip | cells | height px | bottom row | colours (max) |
| --- | --- | --- | --- | --- | --- |
| Zeus | idle | 24 | 51–55 | 83–84 | 18 |
| Zeus | walk (8) | 32 | 47–59 | 77–85 | 18 |
| Zeus | walk16 | 64 | 46–54 | 77–85 | 18 |
| Zeus | cast | 24 | 52–66 | 83–84 | 18 |
| Zeus (tall) | idle | 24 | 61–63 | 84–85 | 18 |
| Zeus (tall) | walk (8) | 32 | 56–67 | 76–86 | 18 |
| Zeus (tall) | walk16 | 64 | 55–65 | 76–86 | 18 |
| Zeus (tall) | cast | 24 | 62–76 | 84–85 | 18 |
| Mortal | idle | 12 | 43–44 | 60 | 22 |
| Mortal | walk (8) | 16 | 40–43 | 55–60 | 22 |
| Mortal | walk16 | 32 | 39–43 | 55–60 | 22 |
| Bull | idle | 12 | 28–36 | 40–44 | 15 |
| Bull | walk | 16 | 27–37 | 38–46 | 16 |

- **Height.** Standing Zeus is inside 48–56 (51–55) and the tall variant inside 60–64 (61–63). Heights above that come from the raised bolt arm in the cast (66, 76 tall) and the walk (59, 67 tall): they are the action envelope, not the body.
- **Bolt stamp.** 83.8% of the stamp's core pixels are visible overall (tall: 81.1%). In 4 Zeus cells and 5 tall cells (all `walk16` west, frames 7–10 or 11) the bolt is fully hidden: it is in the right hand, which is on the far side when he faces west mid-stride. Every other cell shows at least 36 of its 42–46 core pixels. The occlusion rule is physically right and reads badly: the signature prop vanishes for a few frames of one walk.
- **Face stamp** (authored, a few pixels): drawn in every idle cell for Zeus (6 px south, 3 px east and west, none north; one west frame drew 2 of 3 because hair covers a pixel). Extended to the mortal this round, in dark brown: 6 px south and 3 px east (2 of 3 in two cells).
- **Render time** (Blender, both passes included): Zeus 22.9 s for 432 images (about 49 ms for a toon image, 46 ms for each pass), Zeus tall 22.8 s, mortal 9.5 s for 180, bull 1.9 s for 28, tree 0.8 s, temple 0.4 s, house 0.4 s, tiles 0.3 s. Post step: Zeus 38.6 s, tall 40.1 s, mortal 14.3 s, the rest under 4 s each. Report build (sheets, 21 GIFs, 2 scenes): 105 s.

### Walk: 8 frames against 16 over the same 800 ms

| | per-step index change, 8 frames | 16 frames |
| --- | --- | --- |
| Zeus | 42.3% of silhouette-stable pixels | 31.0% |
| Zeus (tall) | 43.9% | 31.5% |
| Mortal | 42.5% | 25.9% |

Sixteen frames cut the change between consecutive frames by 27–39%, which is what smoother motion costs less of: each step moves less. It does not remove the churn: about a quarter of the pixels still change index on every step. I judged the contact sheets (`*-walk16-contact-1x.png`: the mortal's east walk reads as a continuous cycle) and did not watch the GIFs, only checked that their delays sum to exactly 400 cs. The scene uses 16 frames for the mortal.

### Boil (information only) and what it cannot see

`retro_metrics.boil_pair` labels **every** index change on a part whose mask moved as "motion". It therefore cannot tell a limb sweeping across band edges from a surface whose shading flickers, and the round-1 README's "almost all of the churn is motion" was only half supported. Round 2 adds `surface_pair`: it counts index changes only on pixels where the **same part is still the visible surface at about the same depth** (3 cm) in both frames, with a silhouette-stable neighbourhood. Limits: a surface that rotates changes its lighting honestly, so a change there is not necessarily noise; the measure is an upper bound on shading instability, and it needs the part and depth passes (the bull and the tree have none).

| clip | changed / stable (all) | of which on persistent surface | persistent-surface pixels that changed | persistent pixels on moving parts that changed | noise (still parts) |
| --- | --- | --- | --- | --- | --- |
| Zeus idle | 15.5% | 64% of the changes | 12.5% | 14.2% | 144 px |
| Zeus cast | 13.3% | | 10.1% | 15.0% | 208 px |
| Zeus walk (8) | 42.3% | | 36.5% | 36.5% | 3 px |
| Mortal idle | 14.0% | 69% of the changes | 12.0% | 13.6% | 37 px |
| Mortal walk (8) | 42.5% | | 31.8% | 31.7% | 11 px |
| Mortal walk16 | 25.9% | | 21.0% | 21.1% | 1 px |

Reading it: in idle, about two thirds of the churn sits on pixels whose part and depth did not change, so it is shading on surfaces that stayed put (a breathing torso turning through a band edge), not displacement. Noise in still parts is small, as in round 1. This is information, not a gate.

### Animal

The owner's Ultimate Animated Animals pack was in the main checkout. Its `License.txt` is CC0 1.0 (checked, text recorded in `models.json`, which also records both zip hashes and the used file). **The Bull** is in the scene: the pack has no goat or sheep; of the options the brief listed (deer, ox, horse) a bull is the one with a Greek reading (the sacrifice, Zeus's own form) and its horns give a readable silhouette. Its own rig and clips (`Idle` over 2000 ms, `Walk` over 800 ms), at mortal scale (34 px interior, 28–37 px with the head bob), south and east. Each of its seven materials is mapped to a scene ramp by hand (the kit colours are nearly black). No part pass, so no overlap lines. The farm pack stays excluded.

### Outputs

Under `tools/probes/retro-render/scratch/report/` (gitignored), all prefixed `retro-r2-`; the round-1 outputs (`retro-*`, no `r2`) are untouched. Cells are in `scratch/cells-r2/` and raw 4× renders and passes in `scratch/render-r2/`.

| file | what |
| --- | --- |
| `scene-{std,tall}-still-{1x,3x}.png` | the scene, once for each Zeus height; canon Zeus idle stands beside ours at its manifest pivot |
| `scene-{std,tall}-anim-{1x,3x}.gif` | the scene animated, every loop at its timing (Zeus idle 1000 ms, mortal walk16 800 ms, tree 2000 ms, bull idle 2000 ms, canon idle 333/167/333/167 ms), 4 s loop, delays sum to 400 cs |
| `<item>-contact-{1x,4x}.png` | per-item contact sheets with canon Zeus idle at the left of the first row (items: zeus, zeus-tall, mortal, bull, tree, temple, house, tile) |
| `<zeus,zeus-tall,mortal>-walk16-contact-{1x,4x}.png` | the 16-frame walk sheets |
| `walk-compare-{zeus,zeus-tall,mortal}-3x.gif` | 8-frame and 16-frame walks, south and east, side by side, same 800 ms |
| `<zeus,zeus-tall>-keypose-{1x,4x}.png` | four-facing idle and cast key poses on the 96×96 canvas (idle 0 and 3, cast 0–5), canon beside |
| `<item>-<clip>-3x.gif` | timed GIF per animated item and clip, canon idle in the first panel |
| `<item>-results.json`, `report.json` | per-cell measurements, envelope, boil and surface, seams, timings |

### Tuning log

Clock times are the machine's UTC clock at each step; the span covers reading renders and deciding as well as running them. Total from the first command to the final report build: about 27 minutes of wall-clock.

| fix | iterations (renders judged) | wall-clock |
| --- | --- | --- |
| Plan: items, 96×96 canvas, canon pivot, bull, walk16, shadows | 1 pass, no tuning | ≈ 1 min |
| Proportion profiles: head and hands | 1 (values chosen once, not retuned) | ≈ 2 min |
| Fist | 1 (the curl sign was right first time) | included above |
| Head pitch | 2 (+25° bowed further, −25° upright; kept −25°) | ≈ 2 min |
| Hair | 4 whole meshes compared, 2 trimmed designs (hairline and side locks; top knot), a geometry probe of the hair bounds | ≈ 5 min |
| Zeus robe | 2 (straighter column; deeper skirt after a thigh poked through) | ≈ 3 min |
| Mortal tunic and neckline | 4 (neckline depth, waist depth after skin showed through the belt, hip depth, belt thickness) | ≈ 4 min |
| Belt and hem trim missing | 3 renders to find (the part pass showed the faces, a colour sample showed the wrong material); 1 line fix | ≈ 3 min |
| Post step: single outline, shadow, envelope, surface measure | 1 pass; two unit-test mistakes of my own fixed | ≈ 2 min |
| Pivot and canvas | 2 full passes (88 → 78); the bull once (96×64 → 80×56) | ≈ 5 min |
| Bull import, orientation and fit | 1 look (forward axis, scale and materials right first time) | ≈ 3 min |
| Scene, sheets, GIFs | 1 pass | ≈ 3 min |

Round-1 tuning is in its own section above. Counts are of renders I looked at, not of every Blender run; the full runs were two for the three characters and one for everything else.

### Honest read, 1× and 3×

At 1× and 3× in the scene stills (I did not watch the GIFs):

- **Better.** The characters now look like drawn people. The mortal reads as a woman in a belted chiton with a top knot, a face and bare feet, in proportion; the bull is recognisably a bull, and the contact shadows set both on the ground (the tree trunk's is barely visible on the grass). Zeus has a face, framed white hair, a beard, fists, a gold belt and hem and a straighter robe; his cast reads from all four facings with the arm out in full.
- **Tall against standard.** Beside the 44 px mortal and canon Zeus, the 62 px Zeus reads as a god and the 52 px one as a large man. I prefer the tall one for scale. It costs the canvas: 94 of 96 px in the cast.
- **Still not canon.** He is broader, squatter and bow-legged next to canon's tall slim column (the UAL idle bends the knees, and the body is scaled to 0.9 of its height); the legs below the hem read as two gold sticks; the beard and hair are cooler white than canon's. The mortal's tunic goes drab grey in shade.
- **Failures.** The bolt vanishes on the far hand in the middle of the west walk (16-frame clip only). The shadow's checker rim is visible as noise at 3×. Walk still churns a quarter or more of the pixels per step. A thin skin patch still pokes through the tunic at one hip.
- **Dead ends.** Mittens (fingers fused) were not tried; fists were enough.

### Authored art and hand pixels that remain

No frame is hand-edited. Authored, composited by script: the eight bolt stamps (round 3 of `blender-sprite`) and the face stamp (eyes and brows, a few pixels per facing, none on north). New this round: the face stamp on the mortal, in her own colours. The contact shadow is a scripted rule, not art.

### Tests

`python3 -m unittest discover tools/probes/retro-render`: 128 tests, 48 new for this round (`test_r2.py`): profiles and bone scales, fist curls, hair trims, canvases and the tall ratio, walk clips, canon placement by the manifest pivot, the scene schedule, shadow shape and placement, envelope and pivot maths, the surface boil measure, face colours. The Blender runs themselves are not unit-tested.

## Round 3: walk resampling

**The bug.** `walk16` is the same animation state as `walk`, sampled at 16 frames instead of 8. The pose overrides (the carry arm, and the `walk:west` facing override) were looked up by the *output clip name*, so `walk` got them and `walk16` matched none and fell back to the raw arm swing. The two clips were in different poses, not just at different sample rates. That is why the bolt vanished only in `walk16` west, and why Round 2's 8-against-16 comparison for Zeus compared two different walks.

**The fix.** `Clip` now carries a semantic `state` (default: its own id; `walk16` declares `state="walk"`). Pose and facing overrides, and the cast branch, are looked up through `rp.override_keys(state, facing)`, so every sample variant of a state shares one pose policy. Stamp placement already keyed on nothing but the pose, so it follows. The pure parts (`Clip.state`, `override_keys`, `pose_state`) are in `retro_plan.py`.

**The check.** `check_resample.py` compares `walk[i]` with `walk16[2i]` pixel for pixel on the finished cells, and checks their source times are identical (`retro_metrics.resample_pairs`, `pixel_mismatches`, `resample_report`, unit-tested). Sample times are exact: `start + span·i/8` equals `start + span·2i/16`.

| | RED (Round 2 code and cells) | GREEN (fixed code) |
| --- | --- | --- |
| Zeus | 0 of 32 pairs match; 7,212 pixels differ | **32 of 32; 0 pixels differ** |
| Zeus (tall) | 0 of 32; 8,191 pixels differ | **32 of 32; 0 pixels differ** |
| Mortal | 16 of 16; 0 | **16 of 16; 0** |

The mortal was never affected because she has no override table. The RED run is the Round 2 cells (`scratch/cells-r2`, report `retro-r2-resample-check.json`); the GREEN run is `retro-r3-resample-check.json`.

### Walk, 8 against 16 frames, corrected

Per-step index change, as a share of silhouette-stable pixels (same measure as Round 2):

| | 8 frames | 16 frames, Round 2 (buggy) | 16 frames, fixed |
| --- | --- | --- | --- |
| Zeus | 42.3% | 31.0% | **27.1%** |
| Zeus (tall) | 43.9% | 31.5% | **28.8%** |
| Mortal | 42.5% | 25.9% | 25.9% (unchanged) |

Sixteen frames cut the step-to-step change by 34–36% for Zeus (Round 2 reported 27–28% from the mismatched clips) and by 39% for the mortal, now that the two clips are the same walk. About a quarter of the pixels still change index on every step.

### Bolt visibility, west-facing walks

| | `walk` west | `walk16` west | cells fully hidden (all clips, all facings) |
| --- | --- | --- | --- |
| Zeus | 300 of 336 core pixels (89%), 0 of 8 cells hidden | 601 of 672 (89%), **0 of 16 hidden** (Round 2: 4 hidden) | 0 |
| Zeus (tall) | 295 of 336 (88%), 0 of 8 | 587 of 672 (87%), **0 of 16** (Round 2: 5) | 0 |

Across every cell the core pixels visible are 90.5% (Zeus) and 88.0% (tall); the least visible cell shows 83% and 80%.

### Canvas and envelope

The standard Zeus stays on 96×96 at pivot (48, 78). The tall Zeus moves to **112×96 with pivot (56, 78)**, the candidate from the review, and the measured envelope confirms it. The envelope covers every state, facing and sample variant, with the bolt and face stamps and the exterior outline, but not the shadow.

| item | cell, pivot | extent from the pivot: up / down / left / right | margin: top / bottom / left / right |
| --- | --- | --- | --- |
| Zeus | 96×96, (48, 78) | 59 / 8 / 42 / 42 | 19 / 10 / 6 / 6 |
| Zeus (tall) | 112×96, (56, 78) | 68 / 9 / 47 / 47 | 10 / 9 / **9 / 9** |

Both keep at least 6 px on every side (the tall Zeus's old 1 px side margin is now 9). Heights are unchanged except the corrected `walk16`: Zeus 46–59 (was 46–54), tall 55–67 (was 55–65); standing heights stay 51–55 and 61–63. All 393 cells still have 0 pixels outside the palette, binary alpha, the exact anchor, a full exterior outline, and at most 23 colours on the final cell (22 on the figure alone; see below).

### Contact shadow

The checkerboard rim is gone. The shadow is one solid 2:1 ellipse in one palette colour (`olive`, one step lighter than the outline shade), drawn on empty pixels after the outline, and a little smaller: Zeus 9×4.5 px, tall 10×5, mortal 6.5×3.25, bull 13×5.5, tree trunk 8×4. This is a post-step change only.

### Measurement scope: colours with the shadow, everything else without

`postprocess_retro.py` used to measure every fact on the figure before the contact shadow, while this README said the shadow was in the colour counts. Now there are two labelled scopes, written to every results file under `measured_on`:

| scope | facts | results keys |
| --- | --- | --- |
| final cell, **shadow included** | colour count, outside-palette pixels | `colours`, `outside_palette` (summary: `colours_max`, `outside_palette`) |
| figure, **shadow-free** | height, width, bottom row, outline, the box the envelope is built from | `height`, `width`, `bottom_row`, `outline`, `box`, `envelope`; the old colour numbers are kept as `colours_figure`, `outside_palette_figure` (summary: `colours_max_figure`) |

The cells themselves did not change (a fresh run is byte-identical to the shipped round 3 cells), only what is counted. The shadow is one palette colour, so the count goes up by 1 on every cell where that colour is not already in the figure:

| item | cells | colours max, figure | colours max, final cell | cells changed |
| --- | --- | --- | --- | --- |
| Zeus | 144 | 18 | **19** | 144 (+1 each) |
| Zeus (tall) | 144 | 18 | **19** | 144 (+1 each) |
| Mortal | 60 | 22 | **23** | 60 (+1 each) |
| Bull | 28 | 15–16 | **16–17** (idle 16, walk 17) | 28 (+1 each) |
| Tree, temple, house, tile | 17 | 10, 18, 20, 6–7 | same | 0 (the tree's shadow colour is already one of its foliage colours) |

Outside-palette pixels stay 0 on the final cell in all 393 cells, and the limit of 48 colours is far away. Height, bottom row, outline and the envelope are unchanged.

### Outputs and cost

Under `tools/probes/retro-render/scratch/report/`, prefixed `retro-r3-`, cells in `scratch/cells-r3/`, raw renders in `scratch/render-r3/` (the bull, tree, temple, house and tiles are copied from `render-r2`: their renders did not change, only their post step). Same set as Round 2: `scene-{std,tall}-still-{1x,3x}.png` and `scene-{std,tall}-anim-{1x,3x}.gif`, `walk-compare-{zeus,zeus-tall,mortal}-3x.gif`, `<zeus,zeus-tall>-keypose-{1x,4x}.png`, per-item contact sheets and GIFs, per-item results, and `resample-check.json`. All GIFs sum to exactly 400 cs. Render: Zeus 24 s, tall 24 s, mortal 11 s (Blender, both passes). Post: 103 s for every item. Report build: 108 s.

### Tuning time

About 8 minutes of wall-clock from the first command (18:04, the machine's UTC clock) to the report build finishing (18:11), and 3 minutes of that were waiting on the post step and the build.

| step | iterations | wall-clock |
| --- | --- | --- |
| RED: write the check, run it on the old cells | 1 | 1 min |
| Fix `Clip.state` and the override lookup | 1 | 1 min |
| Tall canvas 112×96, solid shadow | 1 (the candidate pivot was right; no retune) | 1 min |
| Render, post, check, build | 1 full pass | 5 min |

### Honest read, 1× and 3×

Stills and contact sheets only; I did not watch the GIFs, only checked their frame counts and exact delays.
- The west walk now carries the bolt in every frame, and `walk` and `walk16` are one animation at two sample rates. The shadows are quieter: a plain dark-green oval under each figure instead of a dithered one. The tall Zeus has room.
- Nothing else changed, so the Round 2 read of the characters stands: still squat next to canon, legs like gold sticks below the hem, a skin patch at one hip of the tunic, walk churning about a quarter of the pixels per step.

### Tests

137 for rounds 1 to 3 in `tools/probes/retro-render` (9 new for the resampling fix): the state of each clip, override keys shared by `walk` and `walk16`, only `walk16` being a variant, exact coarse-against-fine sample times, `resample_pairs`, `pixel_mismatches`, the resample report (green only when both time and pixels match), the 112×96 tall canvas and the solid shadow.

167 after the review fixes (30 new, in three files; no Blender needed):

- `test_handoff.py` (18): the render step's `--tag` resolves to the directory postprocess reads (the real `render_retro.parse_args` runs against stand-in Blender modules); postprocess exits 1 and writes nothing on a wrong tag, and for each of the eight items missing in turn; build_report and check_resample read the same tag's cells and results; every item the scene needs is in the item list; the README's current-round block loops over exactly that list and passes the same `--tag "$TAG"` to all four steps.
- `test_provenance.py` (8): every file `retro_assets.imported_assets()` lists, and its `.bin`/`.mtl` companion, is in `models.json` with a sha256 and size; nothing recorded as used is unimported; the animation source matches; `render_retro.py` takes every import path from `retro_assets` and spells none out. Run against the old `models.json` it fails on `Hair_Long.gltf` and `Hair_Long.bin`.
- `test_measure.py` (4): the shadow's colour is counted and palette-checked on the final cell, height and outline stay on the figure.
