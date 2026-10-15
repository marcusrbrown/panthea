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
import { type RgbaImage, tileDiamondRow } from "../conformance";
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

/** Where lattice point (0, 0) is in the patch the post step keeps: the box's corner, the halo, and the half tile. */
export function patchOrigin(period: number): readonly [number, number] {
  return [
    (TILE_CELL.w / 2) * period + GROUND_HALO,
    TILE_CELL.h / 2 + GROUND_HALO,
  ];
}

/** The size of the patch the post step keeps. */
export function patchSize(period: number): {
  readonly w: number;
  readonly h: number;
} {
  return {
    w: TILE_CELL.w * period + 2 * GROUND_HALO,
    h: TILE_CELL.h * period + 2 * GROUND_HALO,
  };
}

/** Every cell pixel of the N x N period: the union of the diamonds centred on lattice (0..N-1, 0..N-1). */
export function rhombusPixels(
  period: number,
  pivot: readonly [number, number],
): [number, number][] {
  const pixels: [number, number][] = [];
  for (let i = 0; i < period; i += 1) {
    for (let j = 0; j < period; j += 1) {
      const left = pivot[0] + (TILE_CELL.w / 2) * (i - j) - TILE_CELL.w / 2;
      const top = pivot[1] + (TILE_CELL.h / 2) * (i + j) - TILE_CELL.h / 2;
      for (let row = 0; row < TILE_CELL.h; row += 1) {
        const run = tileDiamondRow(row);
        if (run === null) continue;
        for (let x = run.x0; x < run.x1; x += 1)
          pixels.push([left + x, top + row]);
      }
    }
  }
  return pixels;
}

export interface PatchGate {
  /** Rhombus pixels compared along each lattice axis. */
  readonly compared: number;
  /** Rhombus pixels whose colour differs from the pixel one period along the first lattice axis. */
  readonly alongI: number;
  /** ... and one period along the second. */
  readonly alongJ: number;
  /** Rhombus pixels that are not opaque. */
  readonly transparent: number;
  /** Rhombus pixels whose shifted copy lies outside the image. */
  readonly outside: number;
}

/**
 * The patch gate on a posted cell: the centre period's colours equal the same period one period
 * along each lattice axis. Colour only (alpha is opaque in the period), on the rhombus mask.
 */
export function patchGate(
  image: RgbaImage,
  period: number,
  pivot: readonly [number, number],
): PatchGate {
  const step = {
    i: [(TILE_CELL.w / 2) * period, (TILE_CELL.h / 2) * period],
    j: [-(TILE_CELL.w / 2) * period, (TILE_CELL.h / 2) * period],
  } as const;
  const at = (x: number, y: number) => (y * image.width + x) * 4;
  let alongI = 0;
  let alongJ = 0;
  let transparent = 0;
  let outside = 0;
  const pixels = rhombusPixels(period, pivot);
  const same = (p: number, q: number) =>
    image.rgba[p] === image.rgba[q] &&
    image.rgba[p + 1] === image.rgba[q + 1] &&
    image.rgba[p + 2] === image.rgba[q + 2];
  for (const [x, y] of pixels) {
    const here = at(x, y);
    if (image.rgba[here + 3] !== 255) transparent += 1;
    for (const [axis, [dx, dy]] of [
      ["i", step.i],
      ["j", step.j],
    ] as const) {
      const sx = x + (dx as number);
      const sy = y + (dy as number);
      if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) {
        outside += 1;
        continue;
      }
      if (!same(here, at(sx, sy))) {
        if (axis === "i") alongI += 1;
        else alongJ += 1;
      }
    }
  }
  return { compared: pixels.length, alongI, alongJ, transparent, outside };
}
