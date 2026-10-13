# tools/render

Data and the GPL render script for the pre-rendered retro sprite pipeline (ADR-0012). This is not a workspace: parsing and checks live in `packages/assets/src/render/` and run in `tools/content` `validate:assets`.

## Contents

- `kits.json`: the curated kit manifest. Per kit: SPDX licence id, source URL, licence file and its sha256, texture skip list, informational status; per file: sha256, size and the profiles that reference it. `sizeCapBytes` caps the total.
- `kits/<kit id>/`: only the glTF, `.bin` and `.glb` files a render profile reads, plus each pack's licence text. Marked binary in `.gitattributes`, so bytes are hashed exactly as committed.

Profiles, stamps, `camera.json` and `blender/render.py` arrive with later units of the render plan.

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
