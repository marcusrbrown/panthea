# tools/render

Data and the GPL render script for the pre-rendered retro sprite pipeline (ADR-0012). This is not a workspace: parsing and checks live in `packages/assets/src/render/` and run in `tools/content` `validate:assets`.

## Contents

- `kits.json`: the curated kit manifest. Per kit: SPDX licence id, source URL, licence file and its sha256, texture skip list, informational status; per file: sha256, size and the profiles that reference it. `sizeCapBytes` caps the total.
- `kits/<kit id>/`: only the glTF, `.bin` and `.glb` files a render profile reads, plus each pack's licence text. Marked binary in `.gitattributes`, so bytes are hashed exactly as committed.

- `camera.json`: the one calibrated camera. The 2:1 orthographic view (60° tilt, 45° turn), 29.0788 px per unit, 4× supersample, the 112×96 `god-tall` cell with pivot (56, 78), the key light and the toon bands. Parsed by `packages/assets/src/render/camera.ts`; its hash joins the revision recipe hash. Requests carry no camera id.
- `profiles/<id>.json`: a model profile (render input, not game content). Kit file refs (kit id, path, sha256, matching `kits.json`), body proportions, garment rings, hair pieces, material roles, the stamp set id, a clip map from semantic state to animation clip and a pose policy keyed by semantic state (`state`, `state:facing`, `state:facing:key`), never by an output clip name. Parsed by `profile.ts`; `validate:assets` checks every ref against `kits.json` and passes the refs to the kit gate.
- `blender/render.py`: the GPL render script, the only new code that imports `bpy`. It reads a recipe (`RenderRecipe` in `script-contract.ts`, which embeds the camera and the profile), builds the figure from the staged kit files only, poses every clip through one function keyed by semantic state, renders colour, part-ID and depth per frame and commits each slot with a `done.json` sentinel. Exit codes: 0 ok, 1 script error, 10 no GPU context, 11 Blender version or build mismatch, 12 input error.
- `stamps/`: authored bolt and face stamps per subject, with `stamps.json` (anchors, variants, per-file sha256). Checked by `validate:assets`; composited by the TypeScript post step.
- `scratch/`: gitignored; hand-run staging and render output.

## Zeus profile: art changes against the probe's round 3

Fixed through profile parameters (probe values in brackets): body scale 1.22 × 1.14 × 0.97 [1.28 × 1.18 × 0.90], legs 1.10× long and 1.25× thick [1.0, 1.0], feet 1.15× [1.0], a 6° thigh adduction on every state (the stance was bow-legged), the robe's hip rings widened to cover the hip (a skin patch showed through), its hem lowered from 0.32 m to 0.25 m (less bare shin), and the robe's shading biased +0.2 on its ramp (it went grey-blue in shade). The seated pose leans the spine forward 24° in total with the neck taking 8° back, which reads lower than the library's 0.90× crouch: 0.71–0.82× idle height over the four facings (the preregistered limit is 0.85).

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
