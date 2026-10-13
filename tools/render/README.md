# tools/render

Data and the GPL render script for the pre-rendered retro sprite pipeline (ADR-0012). This is not a workspace: parsing and checks live in `packages/assets/src/render/` and run in `tools/content` `validate:assets`.

## Contents

- `kits.json`: the curated kit manifest. Per kit: SPDX licence id, source URL, licence file and its sha256, texture skip list, informational status; per file: sha256, size and the profiles that reference it. `sizeCapBytes` caps the total.
- `kits/<kit id>/`: only the glTF, `.bin` and `.glb` files a render profile reads, plus each pack's licence text. Marked binary in `.gitattributes`, so bytes are hashed exactly as committed.

- `camera.json`: the one calibrated camera. The 2:1 orthographic view (60° tilt, 45° turn), 29.0788 px per unit, 4× supersample, the 112×96 `god-tall` cell with pivot (56, 78), the key light and the toon bands. Parsed by `packages/assets/src/render/camera.ts`; its hash joins the revision recipe hash. Requests carry no camera id.
- `profiles/<id>.json`: a model profile (render input, not game content). Kit file refs (kit id, path, sha256, matching `kits.json`), body proportions, garment rings, hair pieces, material roles, the stamp set id, a clip map from semantic state to animation clip with the frames and per-frame durations each state is rendered and played at, a draped himation, and a pose policy keyed by semantic state (`state`, `state:facing`), never by an output clip name. Parsed by `profile.ts`; `validate:assets` checks every ref against `kits.json` and passes the refs to the kit gate.
- `blender/render.py`: the GPL render script, the only new code that imports `bpy`. It reads a recipe (`RenderRecipe` in `script-contract.ts`, which embeds the camera and the profile), builds the figure from the staged kit files only, poses every clip through one function keyed by semantic state, renders colour, part-ID and depth per frame and commits each slot with a `done.json` sentinel. Exit codes: 0 ok, 1 script error, 10 no GPU context, 11 Blender version or build mismatch, 12 input error.
- `stamps/`: authored face stamps per subject (no prop stamps), with `stamps.json` (anchors, variants, per-file sha256). Checked by `validate:assets`; composited by the TypeScript post step.
- `scratch/`: gitignored; hand-run staging and render output.

## Zeus profile (retro makeover, 2026-10-12; r8)

The profile is the source of every number below; `profile.test.ts` pins the ones that matter. Probe round 3 values are in brackets.

- **Mass and bearing.** Body scale 1.16 × 1.08 × 1.00 [1.28 × 1.18 × 0.90], legs 1.03× long and 1.07× thick, feet 1.00×, head scale 1.75. The spine extends 6° in total (2° each at `spine_01`, `_02`, `_03`) and the head pitch is -12° (r7; was -20°, which tucked the chin into the beard). Both arms hang from the clip with its own elbow bend in idle and walk, and the hands are softly curled at 38°.
- **Idle (r8).** The chest breathes (`pose.idle.breath`): `spine_02` and `spine_03` lift 0.014 and 0.024 m along their bones with weight (1 − cos 2πt)/2 over the loop, and `neck_01` gives 0.024 back so the head does not rise. Measured from geometry: about 1.0 px of chest rise across the 10 frames, pelvis bob 0.06 px, feet fixed, and the seam step (frame 9 to frame 0) 0.06 px against a largest step of 0.32 px. `groundFeet` is on for idle too, so the 0.15 px of foot motion in the clip no longer flickers the bottom row.
- **No global leg stance.** Idle has its own planted-leg policy (`pose.idle`): the anatomical right leg is brought forward, the feet are separated sideways, the knee crouch is reduced and both soles are aimed alike so both feet are grounded. The sole midpoint and ground height are calibrated on the final idle pose.
- **Walk is tempered (r7).** `pose.walk.damp` scales the clip's rotations about their mean over the loop: thigh and calf to 75%, upper and lower arm to 60%; `dampLocation` scales the pelvis bob to 50%. `groundFeet` then sets each frame's lowest sole on the ground plane, so the figure does not float (the tempered legs no longer reach the ground on their own). Measured from geometry: peak side-view foot separation 18.5 px, root bob under 1 px.
- **Chiton.** Ankle length: its hem is at z 0.15 m, broad vertical folds (4), `pale-gold` trim at the hem and belt. `garment.pelvisShare` is 0.15. Value: `cloud` with bias 0.1 and shades `[2,3,4,5,5]`, the lightest large mass.
- **Seated garment (r7).** `garment.seated` is a garment of its own for the seated state, chosen in `Figure.apply_pose`: the standing garment's first 7 rings (the torso through the belt), then two closed leg tubes skinned to the thigh, shin and pelvis by row: a broad lap over the thigh whose rows reach the centre line, a knee transition over about 0.08 m, a shin drape standing 0.029 m clear of the other (a 2 px shadow cleft from the front) and a hem 0.17 m above the ground. The torso stays upright (`spine_02` and `spine_03` +4°, `neck_01` -4°) and the hands rest on the lap (`pose.seated.aims` on both arms). `groundFeet` is on, so the soles stand on the ground.
- **Himation.** An open draped mesh over the character's **left** shoulder (+X in rig space), the same in every facing and never mirrored: a mantle strip and a diagonal chest strip. Lapis, shades `[1,1,2,2,3]` so it tops out at lapis 3. The mantle has two broad `creases` (0.04 and 0.035 m deep), kept as crisp facets while the rest of the strip shades smooth; its lower rows follow the pelvis only. Seated (r8), `himation.seated` builds a second mesh from the same strips: it ends at `hemZ` 0.78 in a lip flared 1.25×, and the rows below the hips narrow to 0.72× at the hem, so the cloak drapes over the seat and the chiton shows at the sides. The standing cloak is not shrunk.
- **Beard (r7, r8).** A mesh built for the purpose (`beard` in the profile), not the kit beard: two thin cheek roots (23° arcs, hugging the jaw hinge) and a chin strip of 8 rows, 1.625 to 1.445, skinned to the head bone only. r8 gave the chin a front that hangs straight (y -0.097 to -0.098 from the lip to z 1.50, then curves back to a rounded point) instead of receding, so in profile it reads as a beard hanging from the jaw: about 4 to 5 px wide and 9 to 10 px tall, and about 8 px wide on the chin from the front. The kit `Hair_Beard` files stay vendored (the probes use them) with `referencedBy: []`.
- **Hair (r8).** Built for the purpose (`hair` and `fillet` in the profile), skinned to the head only; the kit hair files left the profile and stay vendored with `referencedBy: []`. A `crown` ring (full 360°, apex 1.824) swells above a thin `pale-gold` `fillet` band on the crown (two rows 0.023 tall at z 1.782 and 1.759, about 1 px) and carries five strand grooves with a parting at the front. Below it, two short locks over the ears (ending at z 1.635, above the jaw) and a long `nape` strip behind (ending at z 1.555, above the shoulders) with three broad creases kept as facets, so the back of the head reads in tone steps. Marble `[2,3,3,4,4]`, bias 0; the band is `pale-gold` `[3,3,4,4,4]`.
- **Face (r7).** `skin` uses `[2,3,3,4,4]`, bias 0, so the face has fewer, calmer planes. The face stamps are one dark eye pixel under a two-pixel brow in front; the side stamps (`face-east-near`, `face-west-near`) are 2×3 with the brow one pixel above the eye, running back from it.
- **Colour.** Olympus ramps only: `cloud` chiton, `pale-gold` skin, belt and edge, `lapis` himation, `marble` hair and beard. 18 distinct colours in the whole matrix with the shadow and outline (limit 48). No prop, no lightning motif.
- **States, frames and timing.** Per state in `clips`: `idle` 10 frames × 250 ms, `seated` 8 frames of 209, 208, 208, 209, 208, 208, 209 and 208 ms, `walk` 16 × 50 ms. All loop (`loopStart` 0). These are proposals for the owner to critique from the animated preview; the vocabulary's frame and rate rules for `god-tall` bound them.
- **Nothing is promoted.** The render is art in progress; `zeus-retro` is not published.

## Licences

- The Blender-side Python (anything that imports a Blender module) is `GPL-3.0-or-later`: the Blender Foundation requires scripts that use its Python API to be GPL. Each such file starts with `# SPDX-License-Identifier: GPL-3.0-or-later` (after a shebang if there is one). The text is in `LICENSES/GPL-3.0-or-later.txt`.
- Everything else in the repository is MIT.
- Rendered output is not covered by the GPL.
- Kit inputs are `CC0-1.0`, or carry an owner assessment record in `kits.json`.

`validate:assets` enforces the split: a Python file importing `bpy*`, `bmesh`, `mathutils`, `gpu`, `bl_math`, `bgl`, `freestyle`, `idprop` or `aud` without the header fails, and a header-carrying file may not use `importlib`, `__import__`, `exec(` or `eval(`.

## Adding a kit file

1. Take the file from the original pack. Keep only what a profile reads and the pack's licence text.
2. Copy it under `kits/<kit id>/` with its companion `.bin` (a glTF's `buffers[].uri` must be a kit file; unused textures go on the kit's `textureSkip` list).
3. Add its entry to `kits.json` (sha256, size, `referencedBy`). A kit that is not `CC0-1.0` needs an `ownerAssessment` record (`by`, `date`, `summary`) before any profile can reference it.
4. Raise `sizeCapBytes` only with a stated reason: the cap is the measured total plus about 25%.
5. Run `bun run --cwd tools/content validate:assets`.

Never commit a vendor zip or an unreferenced file: files on disk and manifest entries must match both ways.
