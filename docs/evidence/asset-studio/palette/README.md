# Greek master palette review

**Status: owner-approved.** This palette approval covers only the master palette; it does not approve assets, licences, or generated images.

The master has 48 unique colours and 12 four-shade ramps: town (`soil`, `olive`, `terracotta`, `stone-sky`), Olympus (`marble`, `pale-gold`, `lapis`, `cloud`), and Underworld (`ash`, `violet`, `bone`, `ember`). Every ramp runs darkest to lightest. The family choices follow the art guide; all RGB values are original Panthea selections, not copied from an external palette.

Review images:

- `palette-sheet.png` (1024×1024) shows each exact master RGB value in ramp order, with a dark border that remains visible on pale swatches.
- `scale-studies.png` (960×440) is the native-size overview. `town-study.png`, `olympus-study.png`, and `underworld-study.png` (each 960×1024) show larger comparisons. View at 100% for native pixels.
- Each realm sheet uses the same original, generic Greek god figure in a 64×80 cell, with a 40×54 figure at cell offset (12, 12), and a 96×96 portrait crop. These are illustrative pixel studies, not Zeus, canon assets, or conformance claims.

To regenerate the PNGs from `palette.json` at the repository root:

```sh
swift docs/evidence/asset-studio/palette/render.swift
```

The renderer draws each figure and portrait once into a native pixel grid. The 4× figure and 3× portrait panels repeat each source pixel in whole blocks; borders and labels sit outside the compared crops. Exact source and zoom rectangles are recorded in `study-panels.json`. Run `python3 docs/evidence/asset-studio/palette/verify_pixels.py` to compare every saved zoom pixel to its native crop; it must report zero mismatches. The renderer uses Swift's macOS CoreGraphics, CoreText, and ImageIO frameworks. No filtered scaling is used. Every sprite pixel is a master colour; the figure cell's page-colour background stands in for transparency. GPL and HEX order match. The palette is owner-approved; the review illustrations remain non-canon. Palette parsing and digest-bound validation are implemented; the approval digest is recorded in `palette.json`.
