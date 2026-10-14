# blender-sprite: can a headless Blender turn a CC0 rigged humanoid into Panthea sprites?

Status: probe, 2026-10-11 and 2026-10-12, three rounds; [Round 2: Zeus proxy](#round-2-zeus-proxy), [Round 3 criteria](#round-3-criteria-preregistered) and [Round 3](#round-3-bolt-stamp-surface-anchored-shading-seat-fix) are at the end. Evidence for the sprite-pipeline rethink, not a content change. Nothing here is canon; renders go under the gitignored `scratch/`, and the only committed art is the authored bolt stamps in `stamps/` (round 3).

## Outcome

**NO-GO against the current art-guide bar** (the 16-colour hand-pixel canon). Preregistered criteria (a) and (d) failed in both shading variants, (c) passed, and (b) is met only by the authored bolt stamp, not by the render. Details: [Round 3](#round-3-bolt-stamp-surface-anchored-shading-seat-fix) and [Final verdict](#final-verdict).

- **Proven:** the pipeline mechanics. Output is deterministic (decoded pixels identical across runs), a frame renders in about 50 ms, the anchor is fixed at (32, 74) in every cell, selective overlap outlines work from part-ID and depth passes, and an authored stamp composites cleanly against the render's occlusion.
- **Not met:** against hand-pixel canon, rendered motion shows up as frame-to-frame churn. Idle flash pixels run 6–7× canon's rate (about 80–94 per frame against 13), and the idle silhouette-stable change rate is 7–25% against canon's 3.0% (limit 6%).
- **Followed by:** the [retro-render probe](../retro-render/README.md), accepted as [ADR-0012](../../../docs/decisions/0012-pre-rendered-retro-art-direction.md).
- **This probe stays** as a pose and silhouette reference.
- **Requirement:** [X02](../../../docs/product/requirements.md) (art quality). The route fails X02's bar as it stands; X02's acceptance status is unchanged (planned) and the probe is recorded as 2026-10-11 evidence in [traceability.md](../../../docs/product/traceability.md).

**Question.** Can an agent drive headless Blender to turn a CC0 rigged humanoid into 64×80 isometric pixel sprites that meet [the art guide](../../../docs/product/art-guide.md), with directions and animation frames coming from renders instead of pixel-by-pixel specs?

**Answer, short.** Mechanically yes. One script turns a CC0 rig plus four clips into 68 cells per variant (4 facings × 17 frames) in about 3 s of render time per variant, pixel-for-pixel reproducible (decoded pixels; PNG container bytes differ), all 136 cells passing report-only conformance with 8 colours, a 1 px darkest-ramp outline and binary alpha. As art, not yet: the output is a clean but generic pale mannequin with palette-band shimmer between frames (between consecutive frames, 14–15% of stable pixels change palette index in idle and up to 42% in walk), east and west are not mirrors of each other, and the pivot rule in the guide does not hold for rendered feet (see [Pivot](#pivot-where-the-brief-and-the-render-disagree)). The route gives motion, facings and a consistent light for free; the faces, robe, beard and bolt that make Zeus are still unsolved (see [What Zeus would take](#what-zeus-would-take-on-this-route)).

## Method

1. **Inputs pinned.** Blender 5.2.2 LTS (hash `d13f752e3b9c`, built 2026-09-15). Model: Quaternius Universal Animation Library `[Standard]`, `UAL1_Standard.glb` (no root motion), CC0. Hashes and provenance are in [`models.json`](models.json). The mannequin is the base character; no second pack was downloaded.
2. **One script, no UI state.** [`render.py`](render.py) imports the glTF, replaces both materials with a toon shader, builds the scene, camera and light, picks actions and frames and writes files. Everything is in the script or on its command line. Camera, light, frame-sampling and naming maths are pure functions in [`sprite_plan.py`](sprite_plan.py), which Blender's Python imports and the unit tests exercise without Blender.
3. **Look.** EEVEE. Each material is Diffuse → Shader to RGB → RGB to BW → constant ColorRamp → Emission. The ramp colours are palette shades 1–3 of the Olympus `marble` ramp (body) and `lapis` ramp (joints), thresholds 0.50 and 0.78 on the lit value. Shade 0, the darkest, is left for the outline, as the guide's outline rule wants. One fixed sun, no shadows, ambient 0.22. View transform Standard, look None, transparent film, 8-bit RGBA PNG.
4. **Anti-aliasing off.** Pixel filter size 0, one TAA sample, dither 0. In all 136 raw renders no pixel has partial alpha, and every raw colour is already an exact palette entry.
5. **Camera.** Orthographic, rotation X 60°, Y 0°, Z 45° (30° above the horizon, ground tile diamond exactly 2:1, checked in the script). `sensor_fit` is vertical, so `ortho_scale = 80 / px_per_unit`. Scale is calibrated once so the idle south figure is 50 px tall; the 1 px outline above and below makes 52 px, inside the guide's 48–56. That one scale then serves every clip and facing, as a game's fixed camera would. The script cross-checks its own projection against Blender's `world_to_camera_view` (worst error 0.00003 px).
6. **Light.** Fixed in camera space at upper left (and a little toward the viewer), so it is upper left on screen in all four facings. The figure turns, the light does not.
7. **Facings.** South faces the viewer, north away, east is screen right, west screen left. The figure is turned about the vertical axis through its sole midpoint. Forward is read from the T-pose hips, so yaw is 45°, 135°, −135°, −45° for south, east, north, west.
8. **Frames.** `sample_frames()` spaces loop clips evenly over `[start, end)` (the end frame would repeat the first) and one-shots over `[start, end]`. Fractional source frames are rendered as Blender sub-frames. Source frames are recorded per output in `scratch/render/meta.json` and below.
9. **Two routes to a cell.**
   - **direct**: render 64×80, snap to the palette, binary alpha at 128, `add_outline`.
   - **x4**: render 256×320, then `downscale_figure(method="mode", bbox=(0,0,256,320))` from `tools/probes/art-edit/sprite_downscale.py` (method M, mode of palette-snapped pixels, over aligned 4×4 blocks), then the same `add_outline`.
   Both use the existing `load_palette`, `snap_to_palette`, `add_outline` and `measure`. Aligned blocks are deliberate: the earlier probes anchored the sampling grid to the figure's bounding box, which moves the grid from frame to frame and would shimmer an animation.
10. **Measurement and conformance.** [`postprocess.py`](postprocess.py) measures every cell, runs `tools/probes/art-edit/conform_report.ts` (report-only, against the Zeus idle-south slot, as the earlier probes did), and computes flicker, jitter, mirror deviation and direct-vs-4× agreement. [`sprite_metrics.py`](sprite_metrics.py) and [`sheet.py`](sheet.py) hold the pure helpers.

### Clips

| clip | action | frames | source frames (24 fps clock) | loop |
| --- | --- | --- | --- | --- |
| idle | `Idle_Loop` | 4 | 0, 15, 30, 45 (range 0–60) | yes (closure error 4 mm) |
| walk | `Walk_Loop` | 6 | 0, 5.333, 10.667, 16, 21.333, 26.667 (range 0–32) | yes (closure error 0) |
| cast | `Spell_Simple_Shoot` | 5 | 0, 3, 6, 9, 12 (range 0–12) | no |
| sit | `Sitting_Idle_Loop` | 2 | 0, 20 (range 0–40) | yes (closure error 0) |

Hurt and down exist in the same library (`Hit_Chest`, `Hit_Head`, `Death01`) and were not rendered.

## Commands

From the repo root. The model path is the main checkout's `tools/probes/blender-sprite/models/` (see below); every command is deterministic.

```sh
MODEL="<main-checkout>/tools/probes/blender-sprite/models/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb"

# render (long runs: detach with nohup and poll the log; this one takes about 10 s)
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 \
  --python tools/probes/blender-sprite/render.py -- \
  --model "$MODEL" --palette content/greek/palette/palette.json \
  --out tools/probes/blender-sprite/scratch/render --repeat-check --subpixel

# palette, outline, measurements, conformance, flicker, sheets (about 35 s, needs python3, ffmpeg and bun)
python3 tools/probes/blender-sprite/postprocess.py

# tests
python3 -m unittest discover tools/probes/blender-sprite
```

`render.py` options: `--clips idle,walk,cast,sit`, `--directions south,east,north,west`, `--variants direct,x4`, `--sun`, `--ambient`, `--bands`, `--repeat-check` (render one frame twice, compare pixel hashes), `--subpixel` (render idle south frame 0 at fractional pixel offsets).

Outputs: `scratch/render/{direct,x4}/<clip>_<facing>_<NN>.<variant>.png`, `scratch/render/meta.json` (settings, calibration, per-frame source frame and projected foot and pivot positions, timings), `scratch/report/cells/{direct,x4}/*.png` (finished 64×80 cells), `scratch/report/results.json`, `scratch/report/results-tables.md`.

### Assets and models directory

The model files live in the main checkout, outside this worktree, at `<main-checkout>/tools/probes/blender-sprite/models/` (the zip is kept next to its extracted folder). This branch adds `tools/probes/*/models/` to `.gitignore`; nothing under `models/` is committed. Provenance, licence and sha256 of the zip and of each file are in [`models.json`](models.json): source <https://quaternius.itch.io/universal-animation-library>, CC0 1.0, downloaded by the owner through a browser on 2026-10-11 (itch.io's download needs a browser session, so curl could not fetch it), archive sha256 `cc73fc4e…7724`, model sha256 `69591853…7997`.

Blender is GPL-licensed tooling; its renders carry no licence from it. It is a new tool dependency (907 MB installed here, and EEVEE needs a GPU context), which would need owner approval before it joins any pipeline.

## Pivot: where the brief and the render disagree

The brief asks for soles at the pivot (32, 80). Rendered literally, the cell crops the figure. In an oblique view the toe of the foot nearer the camera projects below the sole midpoint: **3.7 to 5.7 px** below it for idle, cast and the walk's worst frame, 1.7–3.5 px for sit (table "Jitter", last column). With the sole midpoint at row 79 those pixels fall off the bottom of the 80-row cell.

What the script does instead: the lowest screen point over every clip, facing and frame goes to row 79 (so the 1 px outline lands on row 79 and the bounding box ends at y = 80, as in canon Zeus), and the sole midpoint's x goes to 32. One fixed camera serves all frames. The true sole midpoint then sits at **(32, 73.7)** in the cell. Consequences:

- A manifest that declares pivot (32, 80) would put the rendered figure about 6 px below the tile's bottom vertex. For this route the pivot must be declared per asset as the projected sole midpoint, (32, 74); the metadata schema already carries a per-asset `pivot (x, y)`. This is a deviation from the guide's wording, and it is the owner's call.
- The bounding box bottom is not at 80 for most frames (rows 72–79), because it depends on facing and pose. Conformance does not check it; the `pivot` check only tests that the declared pivot is inside the cell.

The per-frame sole midpoint, root ground point and lowest vertex were also projected from the 3D rig (sub-pixel, not from bitmaps), see "Jitter".

## Results

Source of every number below: `scratch/report/results.json`, generated by `postprocess.py` from the run described above. Heights include the outline; the guide's 48–56 applies to the standing god, so the walk bob, a raised arm and a seated pose legitimately move it.

### Summary per clip and variant

| clip | variant | cells | height px (incl. outline) | bottom row | colours (max) | outline | binary alpha | conformance | flicker: stable px changed / stable px |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| idle | direct | 16 | 51–52 | 77–79 | 8 | yes | yes | 16/16 | 1036/6851 (15.1%) |
| walk | direct | 24 | 47–54 | 74–78 | 8 | yes | yes | 24/24 | 3006/7141 (42.1%) |
| cast | direct | 20 | 51–58 | 77–79 | 8 | yes | yes | 20/20 | 953/8533 (11.2%) |
| sit | direct | 8 | 35–46 | 72–79 | 8 | yes | yes | 8/8 | 84/1738 (4.8%) |
| idle | x4 | 16 | 51–52 | 77–79 | 8 | yes | yes | 16/16 | 1015/7155 (14.2%) |
| walk | x4 | 24 | 47–54 | 74–79 | 8 | yes | yes | 24/24 | 2860/7288 (39.2%) |
| cast | x4 | 20 | 51–58 | 77–79 | 8 | yes | yes | 20/20 | 803/8741 (9.2%) |
| sit | x4 | 8 | 35–46 | 72–79 | 8 | yes | yes | 8/8 | 60/1794 (3.3%) |

### Per clip, facing and variant

| clip | facing | variant | frames | height | width | bottom row | foot-row midpoint x | sole-cluster midpoint x | colours | off-palette | outline | alpha binary | conformance | flicker changed/stable | stray/isolated px |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| idle | south | direct | 4 | 52 | 22–23 | 79 | 38 | n/a | 8 | 0 | yes | yes | 4/4 pass | 290/1769 | 0/0 |
| idle | east | direct | 4 | 51–52 | 22 | 78 | 27 | n/a | 8 | 0 | yes | yes | 4/4 pass | 278/1583 | 0/0 |
| idle | north | direct | 4 | 52 | 22 | 78 | 38 | n/a | 8 | 0 | yes | yes | 4/4 pass | 212/1921 | 0/0 |
| idle | west | direct | 4 | 51 | 22 | 77 | 25.5 | 32.5 | 8 | 0 | yes | yes | 4/4 pass | 256/1578 | 0/0 |
| walk | south | direct | 6 | 47–50 | 20–21 | 75–78 | 29.5–35.5 | 32.5 | 8 | 0 | yes | yes | 6/6 pass | 988/2261 | 0/0 |
| walk | east | direct | 6 | 48–50 | 18–30 | 74–76 | 25–42.5 | 28.75–33.5 | 8 | 0 | yes | yes | 6/6 pass | 508/1417 | 0/0 |
| walk | north | direct | 6 | 51–54 | 20–21 | 75–78 | 28.5–34.5 | 31.5–31.75 | 8 | 0 | yes | yes | 6/6 pass | 929/2080 | 0/0 |
| walk | west | direct | 6 | 48–50 | 18–30 | 74–76 | 22.5–39 | 30.5–35.25 | 8 | 0 | yes | yes | 6/6 pass | 581/1383 | 0/0 |
| cast | south | direct | 5 | 52 | 19 | 79 | 38 | n/a | 8 | 0 | yes | yes | 5/5 pass | 147/1880 | 0/0 |
| cast | east | direct | 5 | 51 | 38–41 | 78 | 27 | n/a | 8 | 0 | yes | yes | 5/5 pass | 280/2374 | 0/0 |
| cast | north | direct | 5 | 57–58 | 19 | 78 | 38 | n/a | 8 | 0 | yes | yes | 5/5 pass | 261/1982 | 0/0 |
| cast | west | direct | 5 | 51 | 38–41 | 77 | 25.5 | 32.5 | 8 | 0 | yes | yes | 5/5 pass | 265/2297 | 0/0 |
| sit | south | direct | 2 | 46 | 19–20 | 79 | 32 | 32 | 8 | 0 | yes | yes | 2/2 pass | 21/487 | 0/0 |
| sit | east | direct | 2 | 42 | 24 | 77 | 38.5 | n/a | 8 | 0 | yes | yes | 2/2 pass | 24/449 | 0/0 |
| sit | north | direct | 2 | 35 | 19–20 | 72 | 32 | 32 | 8 | 0 | yes | yes | 2/2 pass | 16/396 | 0/0 |
| sit | west | direct | 2 | 42 | 24 | 77 | 25.5 | n/a | 8 | 0 | yes | yes | 2/2 pass | 23/406 | 0/0 |
| idle | south | x4 | 4 | 52 | 22–23 | 79 | 38 | n/a | 8 | 0 | yes | yes | 4/4 pass | 303/1862 | 0/0 |
| idle | east | x4 | 4 | 51–52 | 22 | 78 | 27 | n/a | 8 | 0 | yes | yes | 4/4 pass | 252/1590 | 0/0 |
| idle | north | x4 | 4 | 52 | 23 | 78 | 38 | n/a | 8 | 0 | yes | yes | 4/4 pass | 190/1975 | 0/0 |
| idle | west | x4 | 4 | 51 | 22 | 77 | 25.5 | 32.5 | 8 | 0 | yes | yes | 4/4 pass | 270/1728 | 0/0 |
| walk | south | x4 | 6 | 47–51 | 21–22 | 75–79 | 29.5–35.5 | 32.5 | 8 | 0 | yes | yes | 6/6 pass | 971/2355 | 0/0 |
| walk | east | x4 | 6 | 49–50 | 18–30 | 74–76 | 24.5–42.5 | 28.75–33.25 | 8 | 0 | yes | yes | 6/6 pass | 479/1419 | 0/0 |
| walk | north | x4 | 6 | 52–54 | 21–22 | 76–78 | 28.5–34.5 | 31.5–31.75 | 8 | 0 | yes | yes | 6/6 pass | 854/2083 | 0/0 |
| walk | west | x4 | 6 | 48–50 | 18–30 | 74–76 | 22.5–39 | 30.5–35.25 | 8 | 0 | yes | yes | 6/6 pass | 556/1431 | 0/0 |
| cast | south | x4 | 5 | 52–53 | 19 | 79 | 38 | n/a | 8 | 0 | yes | yes | 5/5 pass | 133/1936 | 0/0 |
| cast | east | x4 | 5 | 51–52 | 38–41 | 78 | 27 | n/a | 8 | 0 | yes | yes | 5/5 pass | 233/2463 | 0/0 |
| cast | north | x4 | 5 | 57–58 | 20 | 78 | 38 | n/a | 8 | 0 | yes | yes | 5/5 pass | 213/2043 | 0/0 |
| cast | west | x4 | 5 | 51 | 38–41 | 77 | 25.5 | 32.5 | 8 | 0 | yes | yes | 5/5 pass | 224/2299 | 0/0 |
| sit | south | x4 | 2 | 46 | 19–20 | 79 | 31.5 | 31.75 | 8 | 0 | yes | yes | 2/2 pass | 15/511 | 0/0 |
| sit | east | x4 | 2 | 42 | 25 | 77 | 38.5 | n/a | 8 | 0 | yes | yes | 2/2 pass | 18/441 | 0/0 |
| sit | north | x4 | 2 | 35 | 19–20 | 72 | 32 | 32.25 | 6 | 0 | yes | yes | 2/2 pass | 9/412 | 0/0 |
| sit | west | x4 | 2 | 42 | 24 | 77 | 25.5 | n/a | 8 | 0 | yes | yes | 2/2 pass | 18/430 | 0/0 |

### Jitter (3D positions through the fixed camera, 1x pixels)

| clip | facing | root ground point | sole midpoint | lowest vertex | worst single foot/ankle bone | figure bottom y range | toe drop below sole midpoint (px) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| idle | south | 0.0 | 0.0002 | 0.0002 | 0.0002 | 0.0 | 5.243–5.2432 |
| idle | east | 0.0 | 0.0001 | 0.0001 | 0.0002 | 0.001 | 4.587–4.5881 |
| idle | north | 0.0 | 0.0001 | 0.0002 | 0.0003 | 0.013 | 4.389–4.402 |
| idle | west | 0.0 | 0.0002 | 0.0002 | 0.0002 | 0.0 | 3.653–3.6532 |
| walk | south | 0.0 | 2.2479 | 6.4858 | 13.4321 | 3.491 | 1.1405–5.6938 |
| walk | east | 0.0 | 4.2454 | 7.2459 | 23.3768 | 2.088 | 0.1293–2.1897 |
| walk | north | 0.0 | 1.9984 | 6.3722 | 11.6651 | 2.738 | 1.9116–4.8607 |
| walk | west | 0.0 | 4.2473 | 7.2515 | 23.3768 | 2.108 | 0.1583–2.1684 |
| cast | south | 0.0 | 0.0004 | 0.0003 | 0.0004 | 0.0 | 5.2429–5.2433 |
| cast | east | 0.0 | 0.0003 | 0.0004 | 0.0004 | 0.0 | 4.5879–4.5882 |
| cast | north | 0.0 | 0.0003 | 0.0003 | 0.0004 | 0.009 | 4.3752–4.3839 |
| cast | west | 0.0 | 0.0004 | 0.0004 | 0.0004 | 0.0 | 3.6529–3.6533 |
| sit | south | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 2.2725–2.2725 |
| sit | east | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 3.5105–3.5105 |
| sit | north | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 1.6952–1.6952 |
| sit | west | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 3.4402–3.4402 |

### Sub-pixel palette stability (idle south frame 0, shifted)

| variant | offset px (dx, dy) | silhouette XOR px | index changed, stable px | index changed, all shared px |
| --- | --- | --- | --- | --- |
| direct | 0.25, 0 | 45 | 71/483 (14.7%) | 119/623 (19.1%) |
| direct | 0.5, 0 | 85 | 114/404 (28.2%) | 211/602 (35.0%) |
| direct | 0.75, 0 | 125 | 151/357 (42.3%) | 292/585 (49.9%) |
| direct | 0, 0.25 | 15 | 68/592 (11.5%) | 82/641 (12.8%) |
| direct | 0, 0.5 | 34 | 119/534 (22.3%) | 150/632 (23.7%) |
| x4 | 0.25, 0 | 50 | 53/468 (11.3%) | 102/623 (16.4%) |
| x4 | 0.5, 0 | 94 | 89/402 (22.1%) | 187/606 (30.9%) |
| x4 | 0.75, 0 | 135 | 134/358 (37.4%) | 278/587 (47.4%) |
| x4 | 0, 0.25 | 14 | 46/596 (7.7%) | 58/648 (9.0%) |
| x4 | 0, 0.5 | 33 | 93/535 (17.4%) | 123/638 (19.3%) |

### East/west mirror

| variant | clip | silhouette XOR px, mirror(east) vs west | index differs, shared px |
| --- | --- | --- | --- |
| direct | idle | 1009 | 1253/1633 (76.7%) |
| direct | walk | 1230 | 1818/2487 (73.1%) |
| direct | cast | 2192 | 1760/2412 (73.0%) |
| direct | sit | 90 | 541/853 (63.4%) |
| x4 | idle | 998 | 1262/1672 (75.5%) |
| x4 | walk | 1226 | 1802/2514 (71.7%) |
| x4 | cast | 2216 | 1753/2442 (71.8%) |
| x4 | sit | 68 | 535/874 (61.2%) |

### Direct against 4x mode (same frame)

| clip | cells | silhouette XOR px / direct opaque px | palette index differs, shared px |
| --- | --- | --- | --- |
| idle | 16 | 203/9331 (2.2%) | 732/9301 (7.9%) |
| walk | 24 | 213/13377 (1.6%) | 1108/13330 (8.3%) |
| cast | 20 | 340/12528 (2.7%) | 1255/12478 (10.1%) |
| sit | 8 | 61/3728 (1.6%) | 350/3717 (9.4%) |

### Timing

| variant | images | first image ms (shader compile) | mean ms after first | median ms | max ms | total ms | post step ms per cell |
| --- | --- | --- | --- | --- | --- | --- | --- |
| direct | 68 | 409.6 | 46.1 | 43.9 | 409.6 | 3501.0 | 66.85 |
| x4 | 68 | 121.5 | 50.4 | 47.5 | 122.1 | 3500.5 | 84.61 |

### Reading the tables

- **Conformance: 136/136 pass, and that is a weak gate.** The report-only check ran grid, canvas, binary alpha, palette, colour count (sprite limit 16), no pure black or white, pivot-in-cell and one connected shape. It does not check height range, bottom row, mirror consistency, facings or outline placement. Every cell also passes with 6–8 colours against Zeus's 13.
- **Height.** Idle is 51–52 px, the target. Walk dips to 47 (the bob). Cast north is 57–58 px with the arm raised, over the guide's 56. Sit is 35–46 because it is seated; north-facing sit loses the legs and reads as a hunched block.
- **Flicker.** "Flicker" counts opaque pixels whose palette index changes between consecutive frames where the pixel and its eight neighbours kept the same opaque/transparent state, so a moved silhouette edge does not count. It also counts legitimate shading change as limbs turn through the light, so the clip rows overstate noise. The sub-pixel table isolates it: the same pose shifted by 0.25 px changes **11–15%** of stable pixels (direct 14.7% / 11.5%, 4× mode 11.3% / 7.7% for a horizontal / vertical shift). The 4× mode route is consistently a few points steadier than direct, and the two cells of one frame differ in 8–10% of shared pixels and 1.6–2.7% of the silhouette. A fixed toon band edge crossing a smoothly moving surface is the cause. A lower-frequency light (two bands, or shading held in the rig's own space) would trade shimmer for flatness; not tried.
- **Jitter.** Idle, cast and sit have planted feet: the root, sole midpoint and lowest vertex move at most **0.0004 px** across frames in every facing, so there is no sub-pixel pivot or foot jitter. The root ground point is fixed in every clip (no root motion in this file). Walk is a real stride: sole midpoint spread of 2–4 px, lowest vertex 6–7 px, expected motion rather than jitter. Foot sliding against the ground was not measured.
- **East and west.** The guide mirrors east for west. Mirrored east and rendered west differ in 61–77% of shared pixels and about 1,000–2,200 silhouette pixels per clip for idle, walk and cast, because the clips are asymmetric (weight on one leg, the cast arm) and because the light is fixed upper left, so a mirror would also flip the light to the upper right. Rendering both facings is cheap here, but if mirroring is wanted the animation must be symmetric or the asymmetry declared, as the guide already allows.
- **Determinism.** The same frame rendered twice in one process gives identical pixels, and two separate Blender runs gave 136/136 pixel-identical PNGs. PNG bytes are not stable between renders (container metadata), so compare decoded pixels. Verified on one machine (Apple GPU, Metal) only.

## Contact sheets

Rows are clips (I idle, W walk, C cast, T sit), column groups are facings in south, east, north, west order with the frame index under each tile (`S0`..), and the leftmost tile is canon Zeus idle frame 0 (`zeus-sprite` atlas, `content/greek/assets/registry/blobs/9976a62d…6a69.png`, 54 px tall, 13 colours) for scale and style.

All under `tools/probes/blender-sprite/scratch/report/`:

| file | what |
| --- | --- |
| `contact-direct-1x.png`, `contact-direct-4x.png` | direct 64×80 route |
| `contact-x4-1x.png`, `contact-x4-4x.png` | 4× render + mode route |
| `contact-compare-1x.png`, `contact-compare-4x.png` | both routes interleaved (`ID` direct, `IX` 4×; same for W, C, T) |
| `silhouette-x4-1x.png` | the 4× route thresholded to black on white (the guide's silhouette test) |
| `cells/{direct,x4}/<clip>_<facing>_<NN>.png` | every finished cell |

The 4× sheets are nearest-neighbour enlargements of the 1× sheets, 4× the pixels per side.

## Honest read at 1×

- It reads as pixel art, not as a render: flat bands, a clean 1 px outline, no anti-aliasing, a coherent light from the upper left across all four facings. Idle, walk and the east/west cast read at native size and in the silhouette test; the walk cycle is the best result.
- It reads as a generic pale mannequin, not as a Panthea figure. It is 20–23 px wide against Zeus's 28, has no face, hair, robe or props, and its three shading bands are blocky next to the hand-placed pixels of the canon sprite. Its blue-grey is on palette but cooler than Zeus's cream and gold.
- Weak spots: the lapis joint pieces show as stray blue dashes at elbows and knees; the shading bands shimmer between frames (see Flicker); the cast arm is foreshortened and barely readable from south and north; seated from south reads as standing, and seated from north is a squat block, so facings need per-clip care; no seat is rendered.
- 4× mode is steadier and costs about 15 ms more per cell in the post step. Direct is nearly as good, because anti-aliasing is off and the raw colours are already exact palette entries, so palette snapping does nothing in either route here. The 4× pass earns its keep only if anti-aliasing or lighting that blends colours is turned on.

## What Zeus would take on this route

A model the mannequin is not: Zeus has a robe, beard, hair, a bolt and an asymmetry (the bolt hand). The work is outside this probe; the plan I would test first:

- **Robe: modelled cloth, not a pixel overlay.** An overlay needs a different hand-drawn robe per frame, per facing, which is the pixel-by-pixel work this route exists to avoid. Instead a low-poly robe skinned to the UAL skeleton (pelvis and thigh weights, plus a few secondary hem bones driven by a cheap spring or a baked cloth pass for sway), with its own material ramp (marble cream body, pale-gold trim). Quaternius's CC0 "Modular Character Outfits - Fantasy" is retargetable to this rig and may supply a base to modify; unchecked, its licence and fit need the same inspection the mannequin got. Same toon shader, so the palette and outline rules apply unchanged.
- **Beard, hair, brow: geometry on the head bone** with a cream ramp. At 52 px these are two or three pixels of mass, so crude modelling is fine; the outline does the shaping.
- **Bolt: a prop mesh parented to `hand_r`**, driven by the existing cast clip, gold ramp. This is also where asymmetry is declared: Zeus's bolt hand makes east and west non-mirrorable, which suits the render-both-facings approach above.
- **Eyes and brow: a small fixed pixel stamp, not a per-frame overlay.** One stamp per facing, positioned each frame from the projected head bone (already recorded in `meta.json`). That is the only place a pixel overlay is justified, because a toon render cannot resolve a 2–3 px feature.
- **Proportions.** The mannequin is slim; broadening shoulders and chest is a rig-scale or shape-key change, not new art. Targeting the canon's 28 px width is a camera and mesh tuning job.
- **Unknown until built:** whether a skirt-like robe over thin legs keeps the walk readable at 1×, and whether the interior overlaps (robe over arm) need outlines. The guide asks for outlines where forms overlap; this probe draws only the exterior outline.

## Limits

- The mannequin is not Zeus. This probe says nothing about robe, face or prop quality.
- One rig, one camera, one light setup, 17 poses × 4 facings. Sub-pixel stability was measured on one pose.
- Conformance ran against the Zeus idle-south slot only, so "pass" means the generic file checks passed.
- Frame durations and fps mapping (10–12 fps act, 3–6 fps idle) are not applied; frames are sampled at the source's 24 fps clock without retiming.
- `Hit_*`, `Death01` (hurt, down) and the `Spell_Simple_Enter/Exit` clips were not rendered. Only the Standard (free) tier was available; the other tiers are paid.
- The seat for `Sitting_Idle_Loop` is absent, so the seated pose has no support and the pivot is the standing ground.
- No interior outlines; a single outline rule (exterior, darkest shade of the adjacent ramp).
- The palette-snap and anti-aliasing paths of `sprite_downscale.py` were exercised on an input that does not need them. Turning anti-aliasing on, or adding textures, would make them matter and was not tried.
- The pivot placement is a deliberate departure from the brief's wording (see Pivot). The literal placement was computed (toe drop) but not rendered.
- Determinism was checked on one macOS machine. EEVEE needs a GPU context, so a headless Linux CI runner would need software GL or a different engine (no alternative engine was tried).
- Blender is a new, large dependency. Using it in the studio needs owner approval.


# Round 2: Zeus proxy

Status: probe, 2026-10-11. Round 1 (above) found the route mechanically sound but the output a generic mannequin; the owner chose a deciding experiment: a crude Zeus-shaped proxy on the same UAL rig, built only by script, rendered through the 4× route only, with the **rule** that the art comes only from the model, materials, rig poses and the scripted post step. No output frame was hand-edited. Every frame that would need hand pixels is logged in `scratch/report/repairs.json` and summarised below; none of those repairs were applied. The verdict rests on that count.

Owner decision also applied: **one fixed per-asset anchor at (32, 74)** for every state and facing. The sole midpoint renders exactly there (the script projects the world origin through the final camera for every pose and records `anchor_px`; the worst deviation is 0.00002 px, and `anchor_all_32_74` is true in every row below). There is no per-frame or per-clip refit, and no pre-pass.

## What was built (all in scripts, from a factory start, nothing saved as .blend)

| piece | how | where |
| --- | --- | --- |
| camera | round 1's: orthographic, X 60° Z 45°, same pixels-per-unit (29.0788, calibrated on the **unmodified** mannequin), so widening is not zoom | `render_zeus.py` |
| body | rest-pose vertex edits: shoulders and chest +5 cm each side (arms shift rigidly, not stretched), arms ×1.3 thick, legs ×1.15, hands ×1.45, head ×1.12 outward and downward (top fixed) so the standing height is unchanged: **50.6 px interior (52.6 with outline), as in round 1**, excluding the bolt | `zeus_proxy.broaden`, `proxy_plan.widen_dx` |
| joints | both mannequin material slots get the one skin material, so the lapis joint pieces are gone | `zeus_proxy.role_slots` |
| robe | 12 rings × 16 vertices, 5 broad folds growing toward the hem, belt and hem trim as a second material, open at neck and hem, arms free (sleeveless). Bone weights copied from the nearest non-arm body vertices; below the hips 45% of the weight moves to the pelvis so the hem lags the legs. No cloth sim | `zeus_proxy.build_robe` |
| beard, hair | beard: 6 rings, bound to `Head`; hair: 6 open rings forming a cap with a face gap, bound to `Head`. Both in the `cloud` ramp, as canon's beard and robe | `build_beard`, `build_hair` |
| bolt | **right hand** (`hand_r`): in canon frame 0 the bolt is in the screen-left raised hand of a south-facing figure, which is the character's right. Planar zigzag, 4 segments, 0.40 m, 0.085 m thick, plane turned 45° about its axis so it keeps about 0.7 of its width from all four facings | `build_bolt`, `proxy_plan.zigzag_points` |
| seat | plain marble block 0.40 × 0.32 m under the seated pelvis, no cloud, only in the sit clip | `build_seat` |
| face | none, by design (see "Face stamp slots") | |
| palette use | skin, trim, belt and bolt in `pale-gold`; robe, beard, hair in `cloud` (canon uses exactly these: `#f3f0dc` robe, `#ddbf70` skin); seat in `marble` | `zeus_proxy.ROLE_RAMP` |
| cast pose | the library's cast clip is **left-handed**, so the whole clip is mirrored (Blender paste-flipped) to put the cast in the bolt hand, then the bolt arm is aimed per frame; south and north have their own aims (outward, depth-aware), east and west cast forward and back. No camera change | `pose_offsets.json`, `zeus_proxy.mirror_pose`, `aim_bones` |
| carry pose | idle, walk and sit hold the bolt raised beside the head (canon idle), aimed per facing (the west-facing bolt arm is the far one and rises on screen, so it carries lower) | `pose_offsets.json` |
| overlap outline | see below | `overlap.py`, `postprocess_zeus.py` |

Frame plan: idle 4, cast 5, sit 2, all four facings; walk 6, south and east only. 56 poses, two shading variants, so 112 cells; sources frames are the same sampling as round 1 (`sample_frames`). The `meta.json` of the render records each pose's source frame, projected anchor and extents.

## Two shading variants (x4 route only; neither is picked)

| id | look |
| --- | --- |
| `a3` | round 1's three bands: ramp shades 1, 2, 3; thresholds 0.50 / 0.78; sun 3.0, ambient 0.22, no fill |
| `b2` | calmer two-tone with canon-like shades per material (robe 2/3, skin 1/2, hair 1/2, trim and bolt 2/3, seat 1/2); one threshold 0.55; sun 3.0, ambient 0.30, plus an opposing fill sun at 0.5 so the shadow side stays soft |

## Selective overlap outline: feasible, implemented

The render writes two extra passes per pose at 4×: a **part-ID pass** (flat emission from a per-face colour attribute: head, torso, arm_l/r, hand_l/r, leg_l/r, robe_upper, robe_skirt, belt, beard, hair, bolt, seat) and a **depth pass** (camera-axis distance through the sRGB curve). The post step takes the modal part of each 4×4 block and its mean depth, then for every 4-neighbour pair of different parts whose depth differs by more than 4 cm it puts a 1 px line on the **farther** pixel in the darkest shade of that pixel's ramp. A line is drawn only if it is necessary: not when the far pixel is already its ramp's darkest shade, and not when the two sides are on different ramps with a lightness gap of at least 0.12 (OKLab). Limbs are one part each, so joints draw nothing. Exterior outline first, then the overlap lines, so lines never thicken the silhouette.

It averages 44–73 line pixels per cell. What it does not do: separate two parts that share a ramp **and** touch at almost the same depth, which is exactly the bolt in the hand (see failures).

## Results (x4 route, both shading variants)

All 112 cells pass report-only conformance, run the same way as round 1 (`conform_report.ts`, Zeus idle-south slot, the same weak checks). The anchor is exactly (32, 74) in every cell. Alpha is binary in every cell. The sit rows say "outline NO" because the measure counts pixels on the cell border as boundary: sit north's seat reaches below the cell (see failures).

### Summary per shading variant and clip (x4 route)

| shading | clip | cells | height px (incl. outline) | bottom row | anchor exactly (32, 74) | colours (max) | outline | binary alpha | conformance | overlap-line px per cell | flicker: stable px changed / stable px | cells needing hand pixels | repair px total (max per cell) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a3 | idle | 16 | 52–54 | 78–79 | yes | 8 | yes | yes | 16/16 | 56.4 | 1898/11477 (16.5%) | 16/16 | 3118 (max 250) |
| a3 | walk | 12 | 48–53 | 74–79 | yes | 8 | yes | yes | 12/12 | 61.7 | 2620/6385 (41.0%) | 12/12 | 1641 (max 195) |
| a3 | cast | 20 | 51–55 | 77–79 | yes | 8 | yes | yes | 20/20 | 49.0 | 1331/11428 (11.6%) | 20/20 | 1384 (max 115) |
| a3 | sit | 8 | 42–48 | 77–79 | yes | 11 | NO | yes | 8/8 | 73.1 | 166/3038 (5.5%) | 8/8 | 592 (max 106) |
| b2 | idle | 16 | 52–54 | 78–79 | yes | 8 | yes | yes | 16/16 | 46.3 | 1421/11477 (12.4%) | 16/16 | 2707 (max 213) |
| b2 | walk | 12 | 48–53 | 74–79 | yes | 8 | yes | yes | 12/12 | 56.2 | 2053/6385 (32.2%) | 12/12 | 1473 (max 176) |
| b2 | cast | 20 | 51–55 | 77–79 | yes | 8 | yes | yes | 20/20 | 44.6 | 1042/11428 (9.1%) | 20/20 | 1367 (max 108) |
| b2 | sit | 8 | 42–48 | 77–79 | yes | 10 | NO | yes | 8/8 | 63.0 | 120/3038 (3.9%) | 8/8 | 592 (max 106) |

### Sub-pixel palette stability (idle south frame 0, shifted, with overlap lines)

Corrected 2026-10-12: the first run of this set posed the cell from the library `Idle_Loop` without the bone offsets and bolt-arm aims the main render applies, so it measured the wrong pose. The set now uses the main render's exact pose sequence, and `--check-subpixel` shows that its zero-offset cell equals the main idle/south/0 cell pixel for pixel (see [Sub-pixel control check](#sub-pixel-control-check)). The first run gave a3 9.7% / 8.7% and b2 7.4% / 7.2% (horizontal / vertical quarter pixel); no verdict or criterion used these numbers.

| variant | offset px (dx, dy) | silhouette XOR px | index changed, stable px | index changed, all shared px |
| --- | --- | --- | --- | --- |
| a3 | 0.25, 0 | 31 | 74/823 (9.0%) | 97/930 (10.4%) |
| a3 | 0.5, 0 | 64 | 130/758 (17.2%) | 187/915 (20.4%) |
| a3 | 0.75, 0 | 100 | 165/690 (23.9%) | 268/899 (29.8%) |
| a3 | 0, 0.25 | 31 | 88/834 (10.6%) | 116/930 (12.5%) |
| a3 | 0, 0.5 | 50 | 126/761 (16.6%) | 176/922 (19.1%) |
| b2 | 0.25, 0 | 31 | 55/823 (6.7%) | 81/930 (8.7%) |
| b2 | 0.5, 0 | 64 | 94/758 (12.4%) | 150/915 (16.4%) |
| b2 | 0.75, 0 | 100 | 148/690 (21.4%) | 244/899 (27.1%) |
| b2 | 0, 0.25 | 31 | 65/834 (7.8%) | 91/930 (9.8%) |
| b2 | 0, 0.5 | 50 | 103/761 (13.5%) | 152/922 (16.5%) |

### Repairs that would need hand pixels (logged, not applied)

| repair kind | a3 (3-band) | b2 (2-tone) |
| --- | --- | --- |
| bolt_touches_body | 13 cells, 142 px | 13 cells, 142 px |
| bottom_crop | 2 cells, 22 px | 2 cells, 22 px |
| edge_crop | 1 cells, 2 px | 1 cells, 2 px |
| review_bolt_reads_as_blob | 56 cells, 3253 px | 56 cells, 3253 px |
| review_sit_legs_hidden | 2 cells, 60 px | 2 cells, 60 px |
| review_walk_legs_hidden | 4 cells, 51 px | 4 cells, 51 px |
| temporal_blips | 33 cells, 3205 px | 33 cells, 2609 px |

### Render timing

| pass | images | total ms | mean ms |
| --- | --- | --- | --- |
| a3 | 62 | 3015.4 | 48.63 |
| b2 | 62 | 2865.9 | 46.22 |
| id | 62 | 2645.0 | 42.66 |
| depth | 62 | 2572.3 | 41.49 |

Wall clock for the whole render script: 12837.4 ms.

### Playback files

| gif | steps | size | bytes | panels left to right | path |
| --- | --- | --- | --- | --- | --- |
| idle-a3-1x | 12 | 328×80 | 23607 | canon zeus idle, south, east, north, west | tools/probes/blender-sprite/scratch/report/zeus-play-idle-a3-1x.gif |
| idle-a3-4x | 12 | 1312×320 | 143445 | canon zeus idle, south, east, north, west | tools/probes/blender-sprite/scratch/report/zeus-play-idle-a3-4x.gif |
| idle-b2-1x | 12 | 328×80 | 22374 | canon zeus idle, south, east, north, west | tools/probes/blender-sprite/scratch/report/zeus-play-idle-b2-1x.gif |
| idle-b2-4x | 12 | 1312×320 | 133110 | canon zeus idle, south, east, north, west | tools/probes/blender-sprite/scratch/report/zeus-play-idle-b2-4x.gif |
| walk-a3-1x | 36 | 196×80 | 43377 | canon zeus idle, south, east | tools/probes/blender-sprite/scratch/report/zeus-play-walk-a3-1x.gif |
| walk-a3-4x | 36 | 784×320 | 266156 | canon zeus idle, south, east | tools/probes/blender-sprite/scratch/report/zeus-play-walk-a3-4x.gif |
| walk-b2-1x | 36 | 196×80 | 41346 | canon zeus idle, south, east | tools/probes/blender-sprite/scratch/report/zeus-play-walk-b2-1x.gif |
| walk-b2-4x | 36 | 784×320 | 251051 | canon zeus idle, south, east | tools/probes/blender-sprite/scratch/report/zeus-play-walk-b2-4x.gif |
| cast-a3-1x | 45 | 328×80 | 92404 | canon zeus idle, south, east, north, west | tools/probes/blender-sprite/scratch/report/zeus-play-cast-a3-1x.gif |
| cast-a3-4x | 45 | 1312×320 | 571056 | canon zeus idle, south, east, north, west | tools/probes/blender-sprite/scratch/report/zeus-play-cast-a3-4x.gif |
| cast-b2-1x | 45 | 328×80 | 88135 | canon zeus idle, south, east, north, west | tools/probes/blender-sprite/scratch/report/zeus-play-cast-b2-1x.gif |
| cast-b2-4x | 45 | 1312×320 | 534312 | canon zeus idle, south, east, north, west | tools/probes/blender-sprite/scratch/report/zeus-play-cast-b2-4x.gif |
| sit-a3-1x | 12 | 328×80 | 24519 | canon zeus idle, south, east, north, west | tools/probes/blender-sprite/scratch/report/zeus-play-sit-a3-1x.gif |
| sit-a3-4x | 12 | 1312×320 | 147552 | canon zeus idle, south, east, north, west | tools/probes/blender-sprite/scratch/report/zeus-play-sit-a3-4x.gif |
| sit-b2-1x | 12 | 328×80 | 23013 | canon zeus idle, south, east, north, west | tools/probes/blender-sprite/scratch/report/zeus-play-sit-b2-1x.gif |
| sit-b2-4x | 12 | 1312×320 | 135207 | canon zeus idle, south, east, north, west | tools/probes/blender-sprite/scratch/report/zeus-play-sit-b2-4x.gif |

### Reading the results

- **Heights.** Idle 52–54, walk 48–53, cast 51–55, sit 42–48, all inside the guide's 48–56 apart from the seated pose, which is shorter because it is seated. **The cast is at or under 56 px in every cell.** Getting there took pose work: the first aims put a raised bolt hand at 58–66 px.
- **Colours.** 8 in idle, walk and cast, 10–11 with the stone seat in sit; the limit is 16.
- **Flicker** is the same measure as round 1 and is inflated by real shading change. Compared with round 1's mannequin (idle 14.2%, walk 39.2%, cast 9.2%, sit 3.3% in the 4× route), the proxy's `a3` is 16.5 / 41.0 / 11.6 / 5.5% and `b2` is 12.4 / 32.2 / 9.1 / 3.9%: the two-tone variant is calmer, the three-band one is no better than the mannequin.
- **Sub-pixel test (rerun, with overlap lines, corrected pose).** The posed Zeus idle shifted a quarter pixel changes 9.0% (horizontal) and 10.6% (vertical) of stable pixels in `a3`, and 6.7% / 7.8% in `b2`, against round 1's 11.3% / 7.7% for the mannequin in the 4× route. The same order: band edges crossing a moving surface are the cause. `b2` is steadier than `a3` in every row.
- **Timing.** Render time per image about 50–60 ms (a3 48.63 ms, b2 46.22 ms, ID 42.66 ms, depth 41.49 ms mean over 62 poses each); the whole script took 12.8 s including the sub-pixel set and import; the post step about 50 s including conformance, sheets and playback.

## The repair count (the deciding number)

Rule: the art was not touched by hand. `repairs.json` lists every cell that would need hand pixels, the pixel count, what would change and why. Automatic detectors run on the finished cells, the part-ID pass and neighbouring frames; findings from looking at the sheets are written as rules over the part map so they are measurable and rerunnable (`repairs.py`, `review_issues`).

- **Every cell needs hand pixels: 56/56 for `a3` and 56/56 for `b2`.** About 120 px per cell in `a3` (6735 px in all) and 110 in `b2` (6139).
- **The bolt is the dominant failure, in every cell (56 per variant, 36–87 px, mean 58).** At 1× the bolt and the hand holding it read as one pale-gold mass, not a zigzag, from every facing. They share a ramp and touch at nearly the same depth, so the overlap rule has nothing to separate. Making the bolt larger helped the 4× view and not the 1× one.
- **Temporal blips: 33 cells per variant** (a3 3,205 px, b2 2,609 px): single-frame palette flashes. In idle and walk some of this is real motion across band edges, so it is an upper bound on cleanup.
- **Bolt touches the head or robe: 13 cells** (idle east, walk east, cast east frame 0, sit east): the near-side arm crosses the body, so the bolt overlaps the torso. Lines separate part of it.
- **Walk legs hidden: walk south frames 0, 1, 3, 4** (7–19 px short): the robe hides the stride from the front.
- **Sit legs hidden: sit north frames 0, 1** (30 px short each): thighs and knees vanish behind the figure and robe.
- **Edge crop: cast south frame 1** (2 px): the outstretched hand touches the left border.
- **Bottom crop: sit north frames 0 and 1** (11 px each): with the fixed anchor the seat's near corner reaches 81.1, 1 px below the cell, so the outline row holds cut-off seat pixels.
- By clip, mean repair pixels per cell in `a3`: idle 195, walk 137, cast 69, sit 74.

## What failed, honestly

- **The bolt never became a readable zigzag at 1×.** Iterations: a helical zigzag (read as a bent stick), then a planar one at three sizes and two plane angles; it reads at 4× and in the silhouette sheet from some facings, not at 1×.
- **Pose tuning was the largest time sink.** The first carry pose used local-axis offsets and put the forearm across the face (four combinations tried, all wrong); it was replaced by aiming bones in rig space. Height and edge budgets then took three rounds for the cast (the far arm of the west facing rises on screen, the south and north wind-ups exceeded 56 px, the east throw ran off the cell). A stale-pose bug (a freshly assigned action is not evaluated when the frame number is unchanged) cost two diagnostic renders.
- **Shading variant `b2` took two tunings**: the first (ambient 0.45, threshold 0.62) was flat and lost the robe's form; the shipped one is the second.
- **Robe and head took three rounds**: the first robe was a wide bell with a leg poking out of the side; the first hair cap hid the face; the first bolt was a block. About twenty debug renders in all before the full runs.
- **Seated from the south, north and the walk from the south** are weak: the robe hides legs, thighs and stride. Seated north also pushes the seat 1 px past the bottom of the cell with the fixed anchor.
- **No face.** The head is hair, beard and a few skin pixels. This round did not try to solve it.
- **West is not the mirror of east for the bolt.** The bolt is in the right hand, so a west-facing figure carries it on the far side; the cell must be rendered, not mirrored, and a mirrored east would put the bolt in the left hand. This is the declared bolt-hand asymmetry, here shown.
- **Conformance still says nothing about any of this**: every cell passes.

## Face stamp slots (not authored)

A small hand-authored per-facing eye/brow stamp would go on the visible head (skin) pixels between the hair cap and the beard, in the head part's bounding box, for the idle frame 0 cells of `a3`:

| facing | head box (x0, y0, x1, y1) | visible head px | hair px | beard px |
| --- | --- | --- | --- | --- |
| south | (29, 29, 35, 37) | 23 | 29 | 32 |
| east | (29, 28, 37, 37) | 16 | 46 | 26 |
| north | (29, 28, 35, 37) | 9 | 47 | 0 |
| west | (27, 28, 35, 37) | 17 | 47 | 24 |

A stamp is 2–4 px (eyes and brow) and would be positioned each frame from the projected `Head` bone, as round 1 suggested. North shows no face; east and west show it in profile.

## Output paths

All under `tools/probes/blender-sprite/scratch/report/` (gitignored):

| file | what |
| --- | --- |
| `zeus-contact-a3-1x.png`, `zeus-contact-a3-4x.png`, `zeus-contact-b2-1x.png`, `zeus-contact-b2-4x.png` | contact sheets, canon Zeus idle frame 0 at the left of every row; rows I idle, W walk (south, east), C cast, T sit |
| `zeus-compare-1x.png`, `zeus-compare-4x.png` | both variants interleaved (`IA`, `IB`: idle, variant `a3`, variant `b2`; same for W, C, T) |
| `zeus-silhouette-a3-1x.png`, `zeus-silhouette-a3-4x.png`, `zeus-silhouette-b2-1x.png`, `zeus-silhouette-b2-4x.png` | silhouette (threshold) sheets at 1× and 4×; the two variants are identical because the alpha is |
| `zeus-play-<clip>-<variant>-<1x\|4x>.gif` | timed playback, 16 files; canon Zeus idle at its own timing in the first panel, then the proxy's facings; see below |
| `zeus-cells/{a3,b2}/<clip>_<facing>_<NN>.png` | every finished 64×80 cell |
| `zeus-subpixel/{a3,b2}/` | the sub-pixel cells |
| `zeus-results.json`, `zeus-results-tables.md` | all numbers above |
| `repairs.json` | the repair log |
| `../zeus-render/{a3,b2,id,depth}/` and `meta.json` | raw 4× renders, part-ID and depth passes, per-pose anchor, extents, source frames |

**Playback timing.** Canon: idle 333/167/333/167 ms, sit 500/500, cast 83/100/83/83/100, walk 100 ms per frame, each looped over 3 s. GIF delays are centiseconds, so 333 ms is written as 33 cs, 167 as 17 and 83 as 8; the loop is not seamless for clips whose period does not divide 3 s. The idle panel at the left of each GIF is canon Zeus, frame 0 to 3 of the `zeus-sprite` atlas, at canon timing for every clip.

## Commands (round 2)

```sh
MODEL="<main-checkout>/tools/probes/blender-sprite/models/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb"

# render: both variants, ID and depth passes, sub-pixel set (about 15 s; detach and poll for longer runs)
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 \
  --python tools/probes/blender-sprite/render_zeus.py -- \
  --model "$MODEL" --palette content/greek/palette/palette.json \
  --out tools/probes/blender-sprite/scratch/zeus-render --subpixel

# post: cells, overlap lines, conformance, flicker, repairs, sheets, GIFs (about 50 s)
python3 tools/probes/blender-sprite/postprocess_zeus.py
```

`render_zeus.py` options: `--check-subpixel` (control check, no `--subpixel` needed; about 10 s), `--variants a3,b2`, `--clips`, `--only clip:facing:index` (one pose, for debugging), `--no-passes`. Pose aims and the mirror list are in `pose_offsets.json`; every proxy dimension is a constant at the top of `zeus_proxy.py` or in `proxy_plan.py`.

## Honest read at 1×

At native size the proxy is a **recognisable robed, bearded figure with a raised arm**: a cream column robe with a gold belt and hem, gold arms and sandals, a white head, a clean outline with a few interior lines where an arm crosses the robe. In the silhouette sheet idle, walk (east), cast (all facings) and sit (east and west) read; the cast arcs are legible, which round 1's mannequin was not. Next to canon Zeus it is clearly the same *kind* of figure and clearly not the same figure: no face, a bell-shaped hem where canon has a straight column with vertical folds, a heavier gold mass for the arm, and above all **no bolt**: the thing in the raised hand is a gold lump. `b2` is the calmer and better of the two at 1×, and the steadier under sub-pixel motion; `a3` has more form. Neither is picked here.

What the route has now delivered mechanically: facings, animation frames, one consistent upper-left light, palette-exact colours (8 to 11 of 16), exact anchor, binary alpha, a 1 px outline plus selective overlap lines, deterministic output, all in about 15 s of render. What it has not: the one canon identifier (the bolt), a face, and clean motion; it needs hand pixels in every one of its 56 cells per variant, about 110 to 120 px each.


# Round 3 criteria (preregistered)

Written before any round-3 render. The file is `scratch/report/r3-criteria.json` (gitignored, so the content is reproduced here); it was not changed afterwards.

- **File sha256:** `48db668c8800e5fa5e98d5d86b780fde29558d83a9de54db6a02e66b4c5f7407`
- **Written:** 2026-10-12T07:22:29Z (UTC), before `render_zeus_r3.py` existed and before any round-3 image was made. The only round-3 work before it was measuring canon Zeus idle to set the reference numbers below.

Round 2 got a NO-GO. The owner chose one bounded further round. **GO needs all four:**

| | criterion | threshold | who judges |
| --- | --- | --- | --- |
| (a) | idle silhouette-stable change rate, on each of the 4 idle facings | at most **6%**, twice canon's 3.0% (canon: 110 changed of 3,644 stable opaque pixels over its 4 idle frames) | script, on the finished cells with the stamp composited |
| (b) | the bolt reads as a zigzag at 1× in every facing | reads | **reviewer** (a reviewer item, not scored by the script) |
| (c) | sit north fits the 64×80 cell with nothing clipped, at the fixed anchor (32, 74), no per-clip scale | no bottom crop, no top or side-edge contact, nothing past a cell edge, both frames, both shading variants | script |
| (d) | the corrected repair estimate is sparse | at most **15 px per cell** on average, and **no clip averages more than 30 px** | script |

How the estimate is counted (corrected after an audit of round 2's `repairs.py`):

1. **Temporal blips** count only pixels whose 3×3 neighbourhood has the same opacity in frames n−1, n and n+1 and whose palette index differs from both neighbours, which agree with each other. This is run on canon Zeus idle's 4 frames as calibration and reported beside ours.
2. **The bolt rule is replaced** by a check of the bolt's own shape. The bolt stamp is authored art (see below), so its pixels are not repair pixels.
3. **The estimate is the union** of unique pixels per cell across all included detectors, not a sum of overlapping issues.
4. **Leg visibility, border contact and bolt adjacency are visibility measures, not readability, and are reported separately,** outside the repair total. The sit-north bottom crop is real and stays in.

Averages are over all cells of a shading variant or clip, including cells with no issue.

**Art direction note from the owner, received after these criteria were written and before the surface-anchored shading was rendered:** the owner wants more detail and a Chrono Trigger look, so the surface-anchored variant bakes **3 shades per material** (shadow, mid, light) plus the darkest-ramp outline instead of 2, staying within 16 colours. The criteria above are unchanged.



# Round 3: bolt stamp, surface-anchored shading, seat fix

Status: probe, 2026-10-12. Round 2 got a NO-GO; the owner chose one more bounded round against the criteria preregistered above ([Round 3 criteria](#round-3-criteria-preregistered), sha256 `48db668c…7407`, rechecked unchanged after the last render). The script pre-checks (a), (c) and (d); (b) is judged by eye.

**Pre-check result: NO-GO on the script's three criteria.** (c) passes. (a) and (d) fail for both shading variants, and by a wide margin. (b), the bolt reading as a zigzag at 1×, is judged by eye rather than scored, and is the one thing that clearly improved.

| shading | (a) idle stable change per facing (limit 6%) | (a) | (b) | (c) sit north fits | (d) repair estimate (limits: 15 mean, 30 per clip) | (d) | pre-check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s3 | south 12.5%, east 16.52%, north 7.89%, west 24.74% (max 24.74%) | **FAIL** | reviewer | pass | 45.61 px/cell; clips idle 94.38, walk 45.42, cast 24.95, sit 0.0 | **FAIL** | **NO-GO** (a and d fail) |
| b2 | south 10.45%, east 16.44%, north 6.72%, west 18.82% (max 18.82%) | **FAIL** | reviewer | pass | 41.09 px/cell; clips idle 80.06, walk 42.17, cast 25.7, sit 0.0 | **FAIL** | **NO-GO** (a and d fail) |

## What changed (all scripted; nothing hand-edited)

1. **Corrected measurement** (`repairs_r3.py`, new; `repairs.py` is left as round 2 had it). Temporal blips count only pixels whose 3×3 neighbourhood has the same opacity in frames n−1, n and n+1, and whose index differs from both neighbours, which agree. The bolt rule is replaced by a check of the stamp's own shape. The estimate is the **union** of unique pixels per cell. Leg visibility, border contact and bolt adjacency are reported separately and are not in the total. The sit-north bottom crop is kept and is now fixed.
2. **Bolt stamp** (`stamp_gen.py`, `stamps/`). The 3D bolt is hidden from every render pass and kept only as a **locator** (its projected base and tip, recorded per pose). In its place, one authored zigzag is composited at the projected bolt-hand point. **The stamp is authored art, not rendered:** a three-segment polyline rasterised by script at eight orientations (0°, 45° … 315°, picked from the screen direction of the hidden bolt), 13 px long, bright pale-gold core (`#f4e4ae`), mid-gold body (`#ddbf70`) and a 1 px darkest-gold outline (`#76572f`), all Olympus palette entries. It is 82 or 90 pixels per variant. It is composited with the part-ID and depth passes: a stamp pixel is hidden where a nearer body part covers it, and it is never drawn over the bolt hand (`hand_r`), so the hand stays distinct. Committed: `stamps/bolt-000.png … bolt-315.png` and `stamps/bolt-stamps.json` (anchor, size, pixel count and angle per variant). Variants used over the 56 poses: 135° (22), 90° (13), 45° (7), and 0°/180°/225°/315° (2 to 4 each); no separate cast-only variants were needed.
3. **Surface-anchored shading, variant `s3`** (`bake_plan.py`, `zeus_proxy.py`, `render_zeus_r3.py`). A fixed upper-left light is baked in **rest pose and object space** into a per-corner value on every mesh (ambient + clamped cosine of the rest normal to the light), and the material turns it into palette shades with a constant ramp and renders it **unlit** (an Attribute node into a ColorRamp into Emission; no diffuse BSDF). The shading therefore rides on the surface and does not respond to the pose or to the lights. Because the light is fixed on screen, the bake is redone per facing (the light turned back by the facing's yaw). **Per the owner's direction (received before this variant was rendered), three shades per material (shadow, mid, light) plus the darkest-ramp outline**, ramp shades 1, 2, 3 of each ramp: skin, belt and trim in `pale-gold`, robe in `cloud`, hair and beard in `marble` (so they separate from the robe), seat in `marble`. Colours in the finished cells: **12** (the limit is 16). Compared against `b2` (round 2's two-tone light-threshold shading, rerendered with the stamp and the new seat); `a3` was dropped.
4. **Seat.** The block went from 0.40 × 0.32 m to **0.30 × 0.22 m, moved 0.13 m forward** in the character's own space. One seat for every facing, no per-clip scale, cell 64×80 and anchor (32, 74) unchanged. Sit north's lowest point went from 81.1 to **78.4**.

Frame set as round 2: idle, cast and sit in 4 facings, walk south and east; 56 poses, two shading variants, 112 cells, x4 route only. The poses are round 2's (`pose_offsets.json` unchanged).

## Results (x4 route, both variants, stamp included)

All 112 cells pass report-only conformance (run as in rounds 1 and 2; same weak checks). The anchor is exactly (32, 74) in every cell, alpha is binary everywhere. The outline measure is false in six cells per variant (cast south frames 1 and 2, east 3, north 1 and 2, sit north 1): where the stamp is clipped by the cell edge, or sits over the hand, a bright stamp pixel is left on the exterior boundary without its outline. In sit north frame 1 that is one pixel at (53, 45).

| shading | clip | cells | height px | bottom row | anchor exactly (32, 74) | colours (max) | outline | binary alpha | conformance | overlap-line px/cell | flicker: stable px changed / stable | repair px per cell (mean) | repair px max | bolt stamp visible |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s3 | idle | 16 | 52–56 | 78–79 | yes | 12 | yes | yes | 16/16 | 52.0 | 1724/11590 (14.9%) | 94.38 | 159 | 84% |
| s3 | walk | 12 | 49–52 | 74–79 | yes | 12 | yes | yes | 12/12 | 52.2 | 2332/6347 (36.7%) | 45.42 | 128 | 87% |
| s3 | cast | 20 | 51–59 | 77–79 | yes | 12 | NO | yes | 20/20 | 39.7 | 1199/11334 (10.6%) | 24.95 | 67 | 60% |
| s3 | sit | 8 | 42–47 | 77–79 | yes | 12 | NO | yes | 8/8 | 74.5 | 141/2948 (4.8%) | 0.0 | 0 | 73% |
| b2 | idle | 16 | 52–56 | 78–79 | yes | 8 | yes | yes | 16/16 | 43.2 | 1461/11590 (12.6%) | 80.06 | 123 | 84% |
| b2 | walk | 12 | 49–52 | 74–79 | yes | 8 | yes | yes | 12/12 | 50.7 | 2071/6347 (32.6%) | 42.17 | 108 | 87% |
| b2 | cast | 20 | 51–59 | 77–79 | yes | 8 | NO | yes | 20/20 | 36.7 | 1023/11334 (9.0%) | 25.7 | 66 | 60% |
| b2 | sit | 8 | 42–47 | 77–79 | yes | 10 | NO | yes | 8/8 | 58.6 | 105/2948 (3.6%) | 0.0 | 0 | 73% |

### Calibration against canon

The corrected temporal detector, run on canon Zeus idle's four `zeus-sprite` frames:

|  | temporal blips, total over 4 idle frames | mean blips per frame | silhouette-stable change rate |
| --- | --- | --- | --- |
| canon Zeus idle | 53 | 13.25 | 3.02% (110/3644) |
| ours s3, idle (16 cells) | 1510 | 94.38 | 12.5 / 16.5 / 7.9 / 24.7% by facing (S/E/N/W) |
| ours b2, idle (16 cells) | 1281 | 80.06 | 10.5 / 16.4 / 6.7 / 18.8% |

Canon's idle has 53 flash pixels in four frames (13 per frame, 1.5% of its triplet-stable pixels). Ours has about 80 to 94 per cell, six to seven times canon's per-frame count, and its silhouette-stable change rate is 2 to 8 times canon's 3.0%.

### Criterion (a): why idle fails

Idle change rate by facing is 12.5 / 16.5 / 7.9 / 24.7% (s3) and 10.5 / 16.4 / 6.7 / 18.8% (b2) for south / east / north / west; the limit is 6%. Surface-anchored shading did **not** help: s3 is slightly worse than b2 on every facing. Where the changes sit (idle, four facings pooled, by body part):

| body part group (idle, 4 facings pooled) | s3 changed / stable | b2 changed / stable |
| --- | --- | --- |
| cloth (robe_upper, robe_skirt, belt, torso) | 726/6550 (11.08%) | 581/6550 (8.87%) |
| limbs (arm_l/r, hand_l/r, leg_l/r) | 616/2726 (22.6%) | 538/2726 (19.74%) |
| head (head, hair, beard) | 307/1116 (27.51%) | 270/1116 (24.19%) |

Cloth is where the surface-anchoring should pay, and cloth is still 11% (s3) against 8.9% (b2), with limbs at 20 to 23% and the head at 24 to 28%. The idle clip is a real arm and torso animation of a few pixels, not a bob, so limbs move across band edges whatever the shading does, and a 3-band bake has more band edges than a 2-tone one. I did not test a pose-less idle (breathing only), which is what canon's idle effectively is, so this round cannot say whether a different idle animation would pass.

### Criterion (c): sit north fits

Both frames, both variants: lowest point 78.4 (limit 79.0), no pixel on the top row or the side columns, left 21.3, right 53.5, top 39.3. Pass. The seat took three tries (see tuning log).

### Criterion (d): the repair estimate

Union of unique pixels per cell, averaged over all cells, flagged or not. Limits: 15 per cell, 30 per clip.

| | s3 | b2 |
| --- | --- | --- |
| mean per cell | 45.6 | 41.1 |
| idle | 94.4 | 80.1 |
| walk | 45.4 | 42.2 |
| cast | 25.0 | 25.7 |
| sit | 0.0 | 0.0 |

For s3 the estimate is **temporal blips 2,145 px** (idle 1,510, walk 545, cast 90), **bolt-shape failures 400 px** (10 cast cells where under 60% of the stamp is visible: cast south frames 0 to 2, east 1, 3, 4, north 1, 2, 4, west 2; the stamp is hidden behind the head or arm, which the occlusion rule is designed to do, but the cell then fails the shape check), and **over-height 9 px** (cast north frame 0, 59 px tall with the stamp). Fixing the measurement removed round 2's ~58 px per cell for the bolt and round 2's inflated blip count, and the figure is still three times the limit, entirely because of idle and walk blips. Cast and sit would pass alone (25 and 0 against 30); idle (94 and 80) and walk (45 and 42) fail the per-clip limit.

### Visibility measures (reported separately, not in the estimate)

- Walk south frames 0, 1, 3, 4: the stride is short by 7 to 19 leg pixels (hem hides the legs). Sit north: both frames short by 30.
- Border contact (top row or side columns): **0 body-part pixels**, but the **stamp** reaches the cell border in 8 cast cells (south 1 and 2, east 3, north 1, 2 and 4, west 0 and 1) and is **clipped by the cell edge in 5** (cast south 1 and 2, north 1 and 2: 15 to 19 stamp pixels outside the cell; east 3: 1). The outstretched cast arm already ends at the edge, so the stamp past the hand has nowhere to go. These clipped pixels are what the bolt-shape check counts in the estimate.
- Stamp touching head, hair, beard or robe: 15 of 56 cells, mean 10.8 px, max 66.
- Cast north frame 0 is **59 px tall** (stamp above the head), the only cell over the 56 px god limit; round 2's cast was entirely at or under 56 px.

### Sub-pixel (quarter-pixel) test

The posed idle shifted, stamp included (percent of silhouette-stable pixels whose index changed). Corrected 2026-10-12 as in round 2: the first run used the unaimed library pose. It gave s3 9.8% / 9.5% and b2 6.7% / 6.8% (horizontal / vertical quarter pixel); no verdict or criterion used these numbers.



| variant | offset px (dx, dy) | silhouette XOR px | index changed, stable px | index changed, all shared px |
| --- | --- | --- | --- | --- |
| s3 | 0.25, 0 | 30 | 77/836 (9.2%) | 106/939 (11.3%) |
| s3 | 0.5, 0 | 84 | 134/721 (18.6%) | 224/912 (24.6%) |
| s3 | 0.75, 0 | 118 | 178/656 (27.1%) | 313/896 (34.9%) |
| s3 | 0, 0.25 | 27 | 81/857 (9.5%) | 105/939 (11.2%) |
| s3 | 0, 0.5 | 44 | 107/790 (13.5%) | 154/933 (16.5%) |
| b2 | 0.25, 0 | 30 | 52/836 (6.2%) | 78/939 (8.3%) |
| b2 | 0.5, 0 | 84 | 94/721 (13.0%) | 177/912 (19.4%) |
| b2 | 0.75, 0 | 118 | 143/656 (21.8%) | 264/896 (29.5%) |
| b2 | 0, 0.25 | 27 | 59/857 (6.9%) | 82/939 (8.7%) |
| b2 | 0, 0.5 | 44 | 97/790 (12.3%) | 140/933 (15.0%) |

Quarter-pixel horizontal: s3 9.2%, b2 6.2%, against round 2's a3 9.0% and b2 6.7% (round 2 b2 had no stamp and a bolt mesh). Surface-anchored shading is not steadier under sub-pixel motion: `s3` is level with round 2's `a3` and about 3 points above `b2` in the same round, plausibly because three bands have more boundary than two.

### Sub-pixel control check

The sub-pixel control is only valid if its zero-offset cell is the main idle/south/0 cell. `--check-subpixel` (on `render_zeus.py` and `render_zeus_r3.py`) renders both per variant and compares the raw 4× images (256×320 = 81,920 pixels, any RGBA channel), exiting 1 on any difference. Before the fix (the sub-pixel branch lacked the bolt-arm aims): round 2 a3 3,083 and b2 2,990 pixels differed; round 3 s3 1,388 and b2 1,392. After the fix all four are 0 of 81,920. Both renderers now build every Zeus pose through one `pose_zeus` function. The corrected sub-pixel sets were rendered separately and merged into the existing render directories, so the main cells, ID and depth passes and render timings are the earlier run's; every other number in the results JSON is unchanged.

## Honest read at 1×

- **The bolt now reads.** At 1× the stamp is a recognisable angular gold zigzag in most idle, walk and cast cells, close to canon's in size and colour, and the hand is separate from it. This is the first round where the thing in the raised hand is a bolt. It is also authored pixel art composited by script, so it says nothing about whether a rendered bolt could ever work.
- **`s3` looks closer to canon than `b2` in still frames:** a cream robe with a mid-grey-blue and a shadow band, a gold belt and arms, a white beard and hair. With the ambient at 0.42 the robe is mostly cream, as in canon; at 0.30 it was mostly blue-grey (tuning log). In animation it is a little noisier than `b2`.
- **Still not Zeus:** no face (a pale blank where the face is), a bell-shaped robe against canon's straight column, a heavy muscular gold arm mass, and animation that shimmers. The cast reads as a throw in the silhouette sheet.
- **What failed:** idle does not hold still (2 to 8 times canon's change rate, 6 to 7 times its flash count), surface-anchored shading did not reduce that, the stamp is hidden or clipped in 10 cast cells (clipped by the cell edge in 5 of them), and one cast cell is over height.

## Tuning log (what took repeated attempts)

| area | iterations |
| --- | --- |
| bolt stamp | 2. First polyline gave a curvy S, which read as a worm at 1×; second used longer jogs, a narrower stroke (core radius 0.65, body 1.0) and a sharper crossover. |
| `s3` shading | 3. Thresholds 0.42 / 0.74 with ambient 0.30 gave almost no light band (front-facing normals reach about 0.69); thresholds 0.46 / 0.64 gave three bands but a blue-grey robe; ambient 0.42 gave the shipped cream robe. The first complete run (ambient 0.30) and the shipped one score the same on (a), (c) and (d); the first run's numbers are kept in `r3-iter1-ambient030-results.json` (idle 14.6%, 11.5% cast, repair mean 45.7 against 45.6 shipped). |
| seat | 4 render rounds. 0.34 × 0.26 m left sit north at 80.6; 0.30 × 0.22 gave 80.3; moving it +0.04 m made it worse (80.9) and −0.04 m better (79.7); −0.09 gave 79.0 and −0.13 (shipped) 78.4, with sit south, east and west unchanged. |
| posing | none this round; round 2's `pose_offsets.json` was reused. |

Total: about 12 single-pose debug renders and two full runs of the pipeline (render about 14 s, post about 48 s each).

## Outputs

All under `tools/probes/blender-sprite/scratch/report/` (gitignored) except the stamps, which are committed under `tools/probes/blender-sprite/stamps/`.

| file | what |
| --- | --- |
| `r3-criteria.json` | the preregistered criteria (sha256 `48db668c8800e5fa5e98d5d86b780fde29558d83a9de54db6a02e66b4c5f7407`) |
| `zeus-r3-contact-s3-1x.png`, `-4x.png`, `zeus-r3-contact-b2-1x.png`, `-4x.png` | contact sheets, canon idle frame 0 at the left of every row; rows I idle, W walk (south, east), C cast, T sit |
| `zeus-r3-compare-1x.png`, `zeus-r3-compare-4x.png` | both variants interleaved (`IS`, `IB`: idle, `s3`, `b2`; same for W, C, T) |
| `zeus-r3-silhouette-s3-1x.png`, `-4x.png`, `zeus-r3-silhouette-b2-1x.png`, `-4x.png` | silhouette sheets |
| `zeus-r3-play-<idle\|walk\|cast\|sit>-<s3\|b2>-<1x\|4x>.gif` | 16 timed GIFs; canon Zeus idle at canon timing in the first panel, then the proxy's facings at canon timing for the clip (idle 333/167/333/167 ms, sit 500/500, cast 83/100/83/83/100, walk 100; centisecond rounding) |
| `zeus-r3-cells/{s3,b2}/<clip>_<facing>_<NN>.png` | every finished 64×80 cell |
| `zeus-r3-subpixel/{s3,b2}/` | the sub-pixel cells |
| `zeus-r3-results.json` | all numbers (summary, pre-check, calibration, flicker, sub-pixel, per-cell facts, stamp use) |
| `repairs-r3.json` | the corrected estimate as a union per cell, canon calibration, visibility measures kept separate, blip rates |
| `r3-iter1-ambient030-results.json` | first full run (ambient 0.30) |
| `../zeus-render-r3/{s3,b2,id,depth}/` and `meta.json` | raw 4× renders, passes, per-pose anchor, extents and bolt locator |

Render time: 13.9 s wall clock for the render script (112 beauty images, 124 passes, the sub-pixel set); post about 48 s.

| pass | images | total ms | mean ms |
| --- | --- | --- | --- |
| s3 | 62 | 3260.5 | 52.59 |
| b2 | 62 | 3071.3 | 49.54 |
| id | 62 | 2954.3 | 47.65 |
| depth | 62 | 2808.7 | 45.3 |

## Commands (round 3)

```sh
MODEL="<main-checkout>/tools/probes/blender-sprite/models/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb"

python3 tools/probes/blender-sprite/stamp_gen.py          # authored stamp (already committed)
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 \
  --python tools/probes/blender-sprite/render_zeus_r3.py -- \
  --model "$MODEL" --palette content/greek/palette/palette.json \
  --out tools/probes/blender-sprite/scratch/zeus-render-r3 --subpixel
python3 tools/probes/blender-sprite/postprocess_zeus_r3.py   # about 48 s
```

`render_zeus_r3.py` options: `--check-subpixel` (control check, no `--subpixel` needed; about 10 s), `--variants s3,b2`, `--seat width,depth,dy` (default `0.30,0.22,-0.13`), `--clips`, `--only clip:facing:index`, `--no-passes`.

## Final verdict

**NO-GO against the current art-guide bar.** GO needed all four preregistered criteria; two failed.

| | result |
| --- | --- |
| (a) idle stable change at most 6% on each facing | **FAIL** in both variants (s3: 12.5 / 16.5 / 7.9 / 24.7%; b2: 10.5 / 16.4 / 6.7 / 18.8% for S / E / N / W; canon 3.0%) |
| (b) bolt reads as a zigzag at 1× in every facing | met **only by the authored stamp**, not by the render (the 3D bolt was removed from the render; the stamp is hidden or clipped in 10 cast cells, clipped by the cell edge in 5) |
| (c) sit north fits the cell | **pass** in both variants (lowest point 78.4, nothing on the top row or side columns) |
| (d) corrected repair estimate sparse | **FAIL** in both variants (s3 45.6 px/cell, b2 41.1; limit 15; idle 94 / 80 and walk 45 / 42 against a per-clip limit of 30) |
| **Verdict** | **NO-GO** against the 16-colour hand-pixel canon. See [Outcome](#outcome) for what the probe did establish and the next step. |
