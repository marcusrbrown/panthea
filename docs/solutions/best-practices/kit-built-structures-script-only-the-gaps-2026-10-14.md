---
title: Build structures from kit pieces, script only the gaps, keep damage inside the intact silhouette
date: 2026-10-14
category: best-practices
module: assets
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - "Adding or changing a structure profile under tools/render/profiles/"
  - "Adding a damaged or ruin state to a rendered structure"
  - "Adding a kit piece to tools/render/kits.json for a structure"
tags: [structures, blender, kit-pieces, silhouette, floating-check, live-test, licence]
---

# Build structures from kit pieces, script only the gaps, keep damage inside the intact silhouette

## Context

Structures (the Greek house and the oak) are rendered from a `structure` profile by the pinned Blender script `tools/render/blender/render.py`. Each is a 192×192 cell. The foot is the manifest pivot, carried by `STRUCTURE_PIVOTS` in `packages/renderer/src/structures.ts`; the profile's `cell.pivot` is the world-origin pixel the post step uses, not the foot (see [the footprint learning](../logic-errors/structure-footprint-must-match-art-2026-10-15.md)).

## Guidance

1. **Take each part from the profile's `kitFiles` where a kit has it.** The script adds only what no kit piece covers. For the house that is the tile roof and ridge, the gable ends, the cornice and porch architrave, the shutters, sills and lintels, and the door leaf.
2. **A damaged state keeps the intact silhouette.** The damaged house changes colour, not shape. The burnt oak is the intact oak's own limb skeleton with the foliage burnt away, so it never adds a branch where the intact tree has none.
3. **Ruin pieces rest on the ground or on a grounded piece.** The house ruin raises on loose pieces:

   ```python
   loose = mb.floating(0.0)
   if loose:
       raise InputError(f"the ruin has pieces in the air: {loose}")
   ```

   `MeshBuilder.floating` returns solids that neither reach the ground nor touch one that does, by bounding box.
4. **Art from script geometry alone records the repository's licence.** A rendered asset with no licensed input is recorded under the repository's MIT licence as original work (`packages/assets/src/studio/packing.ts`). Kit inputs go through the kit gate.
5. **Check silhouettes with the real renderer.** The default test run uses a fake Blender, which cannot show a silhouette. The live test asserts that the damaged house's alpha equals the intact house's, and that every frame of the burnt oak's loop is a subset of the intact oak's silhouette:

   ```sh
   PANTHEA_LIVE_BLENDER=1 bun test packages/assets/src/render/structure-live.test.ts
   ```

   It skips when no Blender binary is found at `PANTHEA_BLENDER` or the macOS bundle path.

## Related

- [Import a third-party kit only with its licence file](third-party-kit-licence-gate-and-provenance-test-2026-10-12.md)
- [Retro sprite profile: fix the model first](retro-sprite-profile-fix-the-model-first-2026-10-13.md)
- [ADR-0012: pre-rendered retro art direction](../../decisions/0012-pre-rendered-retro-art-direction.md)
