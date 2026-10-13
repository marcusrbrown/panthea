---
title: Studio-owned isometric projection and depth over three-flatland
date: 2026-10-08
category: best-practices
module: studio-preview
problem_type: architecture_pattern
component: tooling
severity: high
applies_when:
  - "Placing tiles or sprites in an isometric scene with three-flatland 0.1.0-alpha.10"
  - "Painter order must hold across different atlas textures or material batches"
  - "Adding layers, footprints or occlusion cases to the studio preview"
tags: [studio, isometric, three-flatland, tilemap, depth-order, spritegroup, pixel-art]
---

# Studio-owned isometric projection and depth over three-flatland

## Context

The studio preview (`apps/studio`) pins three-flatland `0.1.0-alpha.10`. Its `TileMap2D` types declare `orientation: 'isometric'`, but the placement code ignores it: `TileLayer.buildInstances` places tiles at `x * tileWidth`, `(height - 1 - y) * tileHeight`. The string `isometric` appears nowhere in the compiled JS.

`apps/studio/src/renderer/iso.test.ts` records this by running it. It builds a `TileMap2D` with `orientation: "isometric"` and gets tile centres (32,48), (96,48), (32,16), (96,16), which is an orthogonal grid.

`Sprite2D.zIndex` doesn't solve ordering either. It is packed as 12 bits, and the sort key includes the batch id. Sprites with different textures land in different batches (`layer.test.ts` pins this), so `zIndex` can't order sprites across textures.

## Guidance

Use three-flatland only to batch and draw sprites. The studio owns projection, depth and lifetimes.

- **Projection is pure code in `apps/studio/src/renderer/iso.ts`:**
  - 64×32 tiles.
  - Diamonds drawn on rows 0–30 only, 64×31, so neighbours share no seam row.
  - A 16 px elevation step.
  - The manifest pivot placed on the bottom vertex of the footprint.

  ```ts
  export const TILE_W = 64;
  export const TILE_H = 32;
  export const DIAMOND_H = 31;
  export const ELEVATION_STEP = 16;
  ```

- **Depth is one integer key:** `x + y − z` of the footprint's bottom-vertex cell, then layer (ground, decal, structure, actor, effect, speech), then id-sorted order inside that depth and layer. `depthZ` maps the key to a z value inside the orthographic near/far range. Coordinates outside the supported range are refused, not clamped.

  ```ts
  export function depthOf(cell: Cell, footprint: Footprint = SINGLE_TILE): Checked<number> {
    const bottom = bottomCell(cell, footprint);
    if (!bottom.ok) return bottom;
    return ok(bottom.value.x + bottom.value.y - bottom.value.z);
  }
  ```

- **Write depth to `position.z` and let the GPU depth test order sprites.** `layerPosition` returns `z: instance.z`, and `place` writes it with `sprite.position.set(at.x, at.y, at.z)`. Materials are alpha-cutout with depth writes. With `alphaTest > 0 && depthWrite`, Flatland skips its CPU sort.

  ```ts
  const material = new Sprite2DMaterial({
    map: texture,
    alphaTest: ALPHA_CUTOFF, // 0.5
    transparent: false,
  });
  ```

- **Construct materials directly, never with `Sprite2DMaterial.getShared`.** Its module-level cache never evicts, so it would leak one material per reload.
- **The layer owns texture lifetimes** (`textures.ts`). `Sprite2D.dispose()` frees only its geometry, never its texture.

## Why This Matters

Trusting the declared orientation draws a square grid that looks almost right at a glance. Trusting `zIndex` gives correct order inside one atlas and wrong order the moment a second texture enters the scene.

The browser checks on the WebGL2 backend passed every occlusion case across two textures in two batches, at 2×, 3× and 4× (`docs/evidence/asset-studio/unit6/README.md`).

## When to Apply

- All studio preview placement, layer ordering and occlusion. Add new rules in `iso.ts`, then pin them with pure tests and the in-page browser checks.
- Re-check this guidance when three-flatland is upgraded. Rerun the `TileMap2D` execution test before relying on any built-in isometric support.

## Examples

Wrong:

```ts
const map = new TileMap2D({ data: { orientation: "isometric", ... } }); // still orthogonal
sprite.zIndex = x + y - z; // only orders within one batch
```

Right:

```ts
// Each returns Checked<T>; out-of-range input is a refusal, not a clamp.
const depth = depthOf(cell, footprint);
if (!depth.ok) return depth;
const z = depthZ({ depth: depth.value, layer: "actor", order });
if (!z.ok) return z;
const origin = spriteOrigin(cell, footprint, pivot);
if (!origin.ok) return origin;
// layer.ts writes z.value to sprite.position.z on an alpha-cutout, depth-writing material
```

## Related

- `docs/solutions/integration-issues/three-webgpurenderer-device-loss-latch-2026-09-27.md`: the same three and three-flatland pin, and recovery on a fresh canvas.
- `docs/solutions/integration-issues/koota-new-function-tauri-csp-2026-09-27.md`: the three-flatland → koota dependency chain.
- `docs/decisions/0002-renderer-backend.md`: its probe evidence describes sortLayer/zIndex and TileMap2D isometric ordering, which this doc narrows.
