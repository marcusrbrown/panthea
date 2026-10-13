---
title: Import a third-party kit only with its licence file, and test provenance against the import list
date: 2026-10-12
category: best-practices
module: assets
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - "Importing a third-party model, animation or texture pack into a probe or the studio"
  - "A pack ships without a licence file, or its licence is not CC0 or owner-assessed"
  - "A provenance manifest lists the files a renderer reads"
tags: [licence, cc0, third-party-assets, provenance, sha256, import-list, kit-intake]
---

# Import a third-party kit only with its licence file, and test provenance against the import list

## Context

The retro-render probe (#214) imports third-party CC0 packs. The licence rule is in ADR-0012 under Sources. The probe's packs and their status are listed in `tools/probes/retro-render/README.md` under Provenance and recorded in `models.json`.

## Guidance

1. **Check for a licence file inside the archive.** A store page is not enough. Record an excluded pack along with its zip hash, so the exclusion stays visible.
2. **Keep one import list.** `tools/probes/retro-render/retro_assets.py` builds every path the renderer imports, and `provenance_paths()` adds each file's `.bin` and `.mtl` companions. `render_retro.py` takes its import paths only from this module.
3. **Test provenance in both directions.** `test_provenance.py` requires every imported file to appear in `models.json` with a sha256, and every entry recorded as used to be imported:
   ```python
   for path in assets.provenance_paths():
       with self.subTest(path=path):
           self.assertIn(path, recorded)
           self.assertRegex(recorded[path]["sha256"], SHA256)
           # …
   ```
4. **Record re-zips as re-zips.** When an archive arrives re-zipped by a cloud drive, its hash won't match the vendor's download. Hash the files inside it as well.

## Why This Matters

A hash test shows the record matches the files on disk. It doesn't show the files were allowed in, so you need both checks.

## When to Apply

- Before adding a third-party pack to a tool's import list.
- When a renderer starts reading a new file from a pack it already uses.

## Examples

`Hair_Long.gltf` and its `.bin` were imported, but `models.json` had no entry for them. The provenance test caught this.

Known gaps:
- No code enforces the licence rule. `make_models_json.py` records `licenceFile`, but nothing refuses to mark a pack as used when that field is missing.
- The test compares the import list with `models.json`. It does not check the files Blender actually opened.

## Related

- #214, `tools/probes/retro-render/models.json`
- #215, [ADR-0012](../../decisions/0012-pre-rendered-retro-art-direction.md) (Sources)
- [Scripted art edits record method: script](scripted-art-edits-record-method-script-provenance-2026-10-08.md): provenance on the output side
