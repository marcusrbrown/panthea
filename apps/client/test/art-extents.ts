// Test support: the opaque extents of a published structure's art, from its manifest and its atlas bytes: how far
// the opaque pixels of every frame of every state reach from the pivot (the foot) on each side, in pixels.
// A box of the art, not of its cell: the cells are 192x192 and mostly transparent.

import { decodePng } from "@panthea/assets/studio";

export interface ArtBox {
  /** Pixels left of the foot, right of it, above it and below it (all non-negative). */
  readonly left: number;
  readonly right: number;
  readonly up: number;
  readonly down: number;
}

interface Manifest {
  readonly pivot: { readonly x: number; readonly y: number };
  readonly animations: readonly {
    readonly frames: readonly {
      readonly rect: {
        readonly x: number;
        readonly y: number;
        readonly w: number;
        readonly h: number;
      };
    }[];
  }[];
}

export function artBox(manifestText: string, atlas: Uint8Array): ArtBox {
  const manifest = JSON.parse(manifestText) as Manifest;
  const decoded = decodePng(atlas);
  if (!decoded.ok) throw new Error("the atlas does not decode");
  const { rgba, width } = decoded.image;
  let x0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const animation of manifest.animations)
    for (const { rect } of animation.frames)
      for (let y = 0; y < rect.h; y += 1)
        for (let x = 0; x < rect.w; x += 1)
          if ((rgba[((rect.y + y) * width + rect.x + x) * 4 + 3] ?? 0) > 0) {
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y);
          }
  if (x1 < x0) throw new Error("the art has no opaque pixel");
  return {
    left: manifest.pivot.x - x0,
    right: x1 + 1 - manifest.pivot.x,
    up: manifest.pivot.y - y0,
    down: y1 + 1 - manifest.pivot.y,
  };
}
