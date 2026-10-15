// The geometry a ground profile shares between the render script, the post step and the stamper.
// Pure: no filesystem, no process.
//
// A ground set is drawn on 64x32 diamonds, one per lattice point. One lattice step is (32, 16)
// pixels along the first axis and (-32, 16) along the second; the world origin is lattice point
// (0, 0) and projects to the profile's cell pivot. A patch covers N x N lattice steps, so the
// N x N diamonds centred on lattice (0..N-1, 0..N-1) are the period. Their cells (64x32, row 31
// empty) make a box 64N x 32N whose top-left cell corner is at pivot - (32N, 16); the patch the
// post step keeps is that box with a halo of `GROUND_HALO` pixels on every side.

import { TILE_CELL } from "@panthea/contracts";
import type { Crop } from "./post";

/** Pixels round the period's box that the patch keeps: half a tile, so a stamper can read across a tile border. */
export const GROUND_HALO = 32;

/** The pixel offset of one lattice step along each lattice axis, at 1x. */
export const LATTICE_STEP_PX = {
  i: { x: TILE_CELL.w / 2, y: TILE_CELL.h / 2 },
  j: { x: -TILE_CELL.w / 2, y: TILE_CELL.h / 2 },
} as const;

/** Metres along a ground axis that project to one lattice step: `32 * sqrt(2) / ppu`, so a step is a whole 32x16 px. */
export function tileSideM(pixelsPerUnit: number): number {
  return ((TILE_CELL.w / 2) * Math.SQRT2) / pixelsPerUnit;
}

/** The box of the N x N period's cells, in cell pixels, for a world origin at `pivot`. */
export function periodBox(
  period: number,
  pivot: readonly [number, number],
): Crop {
  return {
    x: pivot[0] - (TILE_CELL.w / 2) * period,
    y: pivot[1] - TILE_CELL.h / 2,
    w: TILE_CELL.w * period,
    h: TILE_CELL.h * period,
  };
}

/** The patch the post step keeps: the period's box and its halo. */
export function groundCrop(
  period: number,
  pivot: readonly [number, number],
): Crop {
  const box = periodBox(period, pivot);
  return {
    x: box.x - GROUND_HALO,
    y: box.y - GROUND_HALO,
    w: box.w + 2 * GROUND_HALO,
    h: box.h + 2 * GROUND_HALO,
  };
}
