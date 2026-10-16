---
title: A structure's footprint and pivot come from its art, and placement is spaced by the art's extents
date: 2026-10-15
category: logic-errors
module: client-view
problem_type: logic_error
component: tooling
symptoms:
  - "Actors stood on the greek house's steps"
  - "The published house declared footprint 4x3 and pivot (96,136); its plinth is 2x3 with its lowest point at (65,181)"
  - "Repacking the house with a corrected pivot and footprint was refused as a change to the published revision"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [structures, footprint, pivot, plinth, placement, packing, layout, art-extents]
---

# A structure's footprint and pivot come from its art, and placement is spaced by the art's extents

## Problem

`greek-house` was published with footprint 4×3 and pivot (96,136), which were the render cell's values rather than the art's. Placement reserves ground from the footprint and stands the art on the pivot, so the house's plinth and its reserved ground disagreed and actors were placed on its steps. Correcting the values was blocked by the pack gate, which refused any pivot or footprint change against a published revision.

## Symptoms

- Actors placed on cells the layout thought were clear stood on the house's steps.
- Packing a fully re-rendered house with the measured values failed with `the published revision has a different footprint` / `different pivot`.

## What Didn't Work

- Treating the profile's `cell.pivot` (96,136) as the foot. It is the pixel the world origin projects to in the render cell (`postStepSettings` in `packages/assets/src/render/recipe.ts`), not where the art touches the ground.
- Spacing buildings by footprints. Art reaches well past its footprint, so footprint-disjoint slots can still overlap roofs.

## Solution

1. **Republish with values measured from the art.** The house's footprint is 2×3 and its pivot (65,181); the atlas blob is unchanged. `STRUCTURE_FOOTPRINTS` and `STRUCTURE_PIVOTS` in `packages/renderer/src/structures.ts` carry them to the client and studio.
2. **Let the pack gate distinguish reuse from re-render.** In `packAsset` (`packages/assets/src/studio/packing.ts`), the pivot and footprint comparison against the published revision runs only when the revision reuses published pixels: carried cells, carried realm variants, or frames repaired from the published atlas (`editsPublished`).

3. **Space slots by opaque art extents.** `BUILDING_SLOTS` in `apps/client/src/renderer/layout.ts` is a hand-chosen table checked by tests that measure every frame of every state from the published atlases (`artBox` in `apps/client/test/art-extents.ts`). Feet sit at `32·(x−y)`, so the two-building slots (1,6) and (5,2) are 256 px apart: 78 px of ground between two houses, 51 px for the tightest house/oak mix.
4. **Cap what the table holds.** `buildingCell` clamps with `MAX_BUILDINGS_PER_PLACE` (3, in `packages/contracts/src/content.ts`), so a building past the table is the only one not drawn, and `tools/content` refuses a place with more.

## Why This Works

The foot and the ground a structure stands on are properties of the art, so they are measured once and published with it. Pixels that are kept were drawn on the published foot, so a revision that reuses any must keep it; a revision that renders every slot may move it. Spacing measured from the art catches what footprint checks can't see.

## Prevention

- `apps/client/src/renderer/layout.test.ts` pins `STRUCTURE_FOOTPRINTS` to the published manifests and the house pivot to `STRUCTURE_PIVOTS.building`, asserts every house/oak mix leaves at least 16 px of ground between two buildings' art boxes, and asserts footprints and actor cells never overlap.
- `packages/renderer/src/structures.test.ts` pins the footprints, pivots and anchors to the committed manifests.
- `packages/assets/src/studio/repair.test.ts` refuses a repair-of-published revision that moves the footprint.
- Three houses can't stand apart on the 8×8 grid (an exhaustive test over every cell a house's bottom can take, x 1–7 and y 2–7), so the three-building slot overlaps by design. No authored place has more than two buildings.

## Related Issues

- [Build structures from kit pieces, script only the gaps](../best-practices/kit-built-structures-script-only-the-gaps-2026-10-14.md)
- [ADR-0012](../../decisions/0012-pre-rendered-retro-art-direction.md), [#241](https://github.com/marcusrbrown/panthea/pull/241)
