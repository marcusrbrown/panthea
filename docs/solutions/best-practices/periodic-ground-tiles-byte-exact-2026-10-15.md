---
title: "Periodic ground tiles: render one period, stamp the dual grid, audit by regeneration"
date: 2026-10-15
category: best-practices
module: assets
problem_type: design_pattern
component: tooling
severity: medium
applies_when:
  - "Adding or changing a ground profile (build kind ground) under tools/render/profiles/"
  - "Changing the dual-grid stamper in packages/assets/src/tiles/"
  - "Changing the Blender ground build, its render settings, or the post step's crop"
  - "Choosing which lattice offset a tile draws in a harness or scene"
tags: [tiles, dual-grid, periodic, blender, eevee, stamper, patch-gate, audit]
---

# Periodic ground tiles: render one period, stamp the dual grid, audit by regeneration

## Context

A place's ground is a dual-grid tile set of 16 masks of four corners (N=1, E=2, S=4, W=8; a set bit means `over`), in the format of ADR-0009. The base and over terrains are Blender-rendered patches that repeat with period N (4 for `grass-flagstone`), and `stampTileSet` in `packages/assets/src/tiles/build.ts` cuts every mask at every lattice offset from them. The patch, the stamp and the offset are three places a seam can enter, and none shows in a single tile.

## Guidance

1. **Derive the tile side from the camera.** One lattice step is 32×16 px, so a ground axis step is `32√2 / ppu` metres (`Ground.__init__` in `tools/render/blender/render.py`). Never hard-code the metre value.
2. **Instance periods and crop the centre.** `Ground.REPEAT` is 5: five periods per axis, centred on the origin's period (two each side of it). `groundCrop` in `packages/assets/src/render/ground.ts` keeps the centre period plus a halo.
3. **Pin every term that depends on other pixels.** `fresh_scene` sets TAA samples to 1 and turns off ray tracing, fast GI, shadows and volumetric shadows, so a ground pixel depends on its own surface only.
4. **Tag every ground solid `ground` and set `outline: false`.** `parseStructureProfile` requires the key on a ground profile; `post.ts` treats an absent key as outline on.
5. **Gate the patch before stamping.** `patchGate` compares each pixel's RGB with its copy one period along each lattice axis (`alongI`, `alongJ`), counts non-opaque pixels (`transparent`), and counts pixels whose copy leaves the frame (`outside`). All four failure counts must be zero; `compared` is the sample size.
6. **Keep the blend field continuous and the threshold strict.** `periodicValueNoise` wraps on both axes, and the noise wavelength (`stamp.wavelengthTiles`) divides the period. A pixel is `over` only when the field is strictly above 1/2 (`isOver`), so ties go to base. A bridge term keeps the diagonal masks 5 and 10 connected.
7. **Cycle offsets by translating the lattice.** Move the lattice coordinates, not the offset index:

   ```ts
   // apps/studio/src/harness/layout.ts
   offset: tileOffsetAt(
     x + (cycle % period),
     y + Math.floor(cycle / period),
     period,
   ),
   ```

8. **Audit by regeneration at publish.** `publish.ts` calls `auditRendered`, which dispatches to `auditTile`; the procedure is in ADR-0009. `parseAssetManifest` refuses any tile provenance other than `rendered`, so no tile reaches canon unaudited.

**Tests:** `packages/assets/src/render/ground.test.ts` (the gate passes a periodic mosaic and fails an N−1 mosaic) and `apps/studio/src/harness/layout.test.ts`, "cycles the offset by translating the lattice" (every neighbour pair agrees at all 16 cycles). The live patch gate runs under `PANTHEA_LIVE_BLENDER=1`.

## Related

- [Keep procedural effects byte-exact and audit them by regeneration](procedural-effects-byte-exact-and-audited-2026-10-14.md)
- [Studio-owned isometric projection and depth](studio-owned-isometric-projection-depth-2026-10-08.md)
- [ADR-0009](../../decisions/0009-asset-registry-lifecycle-and-uris.md), [#239](https://github.com/marcusrbrown/panthea/pull/239)
