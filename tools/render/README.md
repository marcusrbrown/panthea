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

## Zeus profile (retro makeover, 2026-10-12)

The profile is the source of every number below; `profile.test.ts` pins the ones that matter. Probe round 3 values are in brackets.

- **Mass and bearing.** Body scale 1.16 × 1.08 × 1.00 [1.28 × 1.18 × 0.90], legs 1.03× long and 1.07× thick, feet 1.00×, head scale 1.75. The spine extends 6° in total (2° each at `spine_01`, `_02`, `_03`) and the head pitch is -20° (the chin slightly lifted). Both arms hang from the clip with its own elbow bend, with no aimed or carry-arm override, and the hands are softly curled at 38°.
- **No global leg stance.** The old 6° thigh adduction on every state is gone. Idle has its own planted-leg policy (`pose.idle`): the anatomical right leg is brought forward, the feet are separated sideways, the knee crouch is reduced and both soles are aimed alike so both feet are grounded. Walk uses the clip's stride as it is. The sole midpoint and ground height are calibrated on the final idle pose, after proportions and policy.
- **Chiton.** Ankle length: its hem is at z 0.15 m, which shows a few pixels of foot and ankle, with broad vertical folds (4) and a wider skirt. Its hem ring and belt use the `pale-gold` trim. `garment.pelvisShare` is 0.15 so a seated figure's thighs carry the skirt with them instead of through it.
- **Himation.** An open draped mesh (not a closed ring) over the character's **left** shoulder (+X in rig space), the same in every facing and never mirrored: a shoulder-and-back mantle strip and a diagonal chest strip, 3 and 2 broad folds, skinned by height to `clavicle_l`, the spine, the pelvis and the thighs, never to the nearest arm. Role `himation`, ramp `lapis`.
- **Face and hair.** The kit beard is smoothed (3 passes), scaled, tapered and moved clear of the chest into one mass, and hair and beard each use 2 or 3 tones (`materials.<role>.bandShades`); the large surfaces keep the camera's 5 bands. The face stamp (an eye pixel and a brow) is the only authored art.
- **Colour.** Olympus ramps only: `cloud` chiton, `pale-gold` skin, belt and edge, `lapis` himation, `marble` hair and beard. No prop, no lightning motif.
- **States, frames and timing.** Per state in `clips`: `idle` 10 frames × 250 ms (the full 2.5 s `Idle_Loop`), `seated` 8 frames of 209, 208, 208, 209, 208, 208, 209 and 208 ms, `walk` 16 × 50 ms. All loop (`loopStart` 0). These are proposals for the owner to critique from the animated preview; the vocabulary's frame and rate rules for `god-tall` bound them, and the engine refuses a profile outside them before Blender starts. There is no `act` clip: act is deferred.
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
