// The dual-grid stamper: two periodic terrain patches and a continuous blend field become the tile
// set. Deterministic and pure; the same patches and parameters give the same bytes on any engine
// (only + - * / and Math.floor, and 32-bit integer hashes).
//
// A tile sits at a lattice point P(x, y) and covers the 64x32 diamond round it. Its four corner
// grid cells are N = (x-1, y-1), E = (x, y-1), S = (x, y) and W = (x-1, y), at the diamond's top,
// right, bottom and left vertices; the mask bits are N = 1, E = 2, S = 4, W = 8 and a set bit is
// `over`. For a pixel at lattice coordinates (u, v) the blend field is
//
//   f = bilinear(corners; s = u - x + 1/2, t = v - y + 1/2)  +  noise(u, v)  +  bridge(u, v)
//
// and the pixel is `over` when f is strictly greater than 1/2 (a tie is base).
//   - noise is periodic value noise, amplitude below the margin that keeps the four vertices pure;
//   - bridge is a tent over each tile that is zero on its border and signed by the tile's hash, so
//     a diagonal mask (5, 10), whose bilinear field is exactly 1/2 at its saddle, always has a bridge
//     of one terrain or the other that is several pixels wide.
// The field is a function of (u, v) and of the four corners alone, and it is continuous across a tile
// border (the border is shared by two corners), so neighbouring tiles agree and no seam appears.
//
// Two decorations read the field, never a neighbouring pixel, so they cannot disagree across a border:
//   - the edge band: on the `over` side, where f - 1/2 is within a width that the band noise varies
//     and breaks, the pixel is the flagstone ramp's darkest shade;
//   - an overhang: on the `over` side, within a disc at a hashed point of the period and a little
//     way from the boundary, the pixel is grass.
// Every other pixel is the pixel of its terrain's patch at the same place in the plane.

import {
  TILE_CELL,
  TILE_MASKS,
  tileAtlasRect,
  tileMaskAt,
  tileOffsetAt,
} from "@panthea/contracts";
import { type Rgb, type RgbaImage, tileDiamondRow } from "../conformance";
import { hash2 } from "../effects/random";
import { patchOrigin, patchSize } from "../render/ground";
import { periodicValueNoise } from "./lattice-noise";

/** The length, in pixels, of one lattice step: the unit the band's pixel width is converted to field units by. */
const STEP_PX = 36;

/** The band is absent where its break noise is below this, which leaves it in runs a fraction of a tile long and about half the boundary bare. */
const BAND_BREAK = 0.5;

/** How far an overhang reaches over the boundary at most, in bands. */
const OVERHANG_DEPTH = 2.5;

export interface StampParams {
  readonly period: number;
  readonly noiseSeed: number;
  readonly wavelengthTiles: number;
  readonly amplitude: number;
  readonly edgeBandPx: number;
  readonly overhangs: number;
  /** The flagstone ramp's darkest shade. */
  readonly bandColour: Rgb;
}

export interface Patches {
  readonly base: RgbaImage;
  readonly over: RgbaImage;
}

export type StampResult =
  | { readonly ok: true; readonly image: RgbaImage }
  | { readonly ok: false; readonly message: string };

interface Context {
  readonly params: StampParams;
  readonly patches: Patches;
  readonly origin: readonly [number, number];
  readonly overhangs: readonly { u: number; v: number; r: number }[];
}

function context(params: StampParams, patches: Patches): Context | string {
  const { period } = params;
  const want = patchSize(period);
  for (const [name, image] of [
    ["base", patches.base],
    ["over", patches.over],
  ] as const)
    if (image.width !== want.w || image.height !== want.h)
      return `the ${name} patch is ${image.width}x${image.height}, a period-${period} patch is ${want.w}x${want.h}`;
  if (period % params.wavelengthTiles !== 0)
    return `the noise wavelength ${params.wavelengthTiles} does not divide the period ${period}, so the noise would not repeat`;
  const reach = 3.5 * params.edgeBandPx;
  const overhangs = Array.from({ length: params.overhangs }, (_, k) => ({
    u: hash2(params.noiseSeed + 101, k, 0) * period,
    v: hash2(params.noiseSeed + 101, k, 1) * period,
    r: reach * (0.7 + 0.6 * hash2(params.noiseSeed + 101, k, 2)),
  }));
  return { params, patches, origin: patchOrigin(period), overhangs };
}

/** `value` taken into [0, period) exactly, for a dyadic value. */
const reduced = (value: number, period: number): number =>
  value - period * Math.floor(value / period);

/** The blend field's threshold: over where it is strictly greater than 1/2, so a tie is base. */
export const isOver = (field: number): boolean => field > 0.5;

/** The nearest signed distance between two points of a period, in [-period / 2, period / 2). */
const around = (delta: number, period: number): number =>
  delta - period * Math.floor(delta / period + 0.5);

/**
 * The pixel (cx, cy) of the tile at lattice point (x, y) with corner `mask`: RGBA, or null when
 * the pixel is outside the diamond. Any integer (x, y) gives the same pixel as (x mod N, y mod N).
 */
function pixel(
  ctx: Context,
  mask: number,
  x: number,
  y: number,
  cx: number,
  cy: number,
): readonly [number, number, number, number] | null {
  const span = tileDiamondRow(cy);
  if (span === null || cx < span.x0 || cx >= span.x1) return null;
  const { params, patches, origin } = ctx;
  const n = params.period;
  const ox = cx + 0.5 - TILE_CELL.w / 2;
  const oy = cy + 0.5 - TILE_CELL.h / 2;
  const du = (ox + 2 * oy) / 64;
  const dv = (2 * oy - ox) / 64;
  const u = reduced(x + du, n);
  const v = reduced(y + dv, n);

  // The bilinear blend of the four corner terrains.
  const s = du + 0.5;
  const t = dv + 0.5;
  const corner = (bit: number) => ((mask & bit) === 0 ? 0 : 1);
  const bilinear =
    (1 - s) * (1 - t) * corner(1) +
    s * (1 - t) * corner(2) +
    s * t * corner(4) +
    (1 - s) * t * corner(8);

  const w = params.wavelengthTiles;
  const noise =
    params.amplitude *
    (2 * periodicValueNoise(params.noiseSeed, u / w, v / w, n / w) - 1);
  const px = Math.floor(u + 0.5);
  const py = Math.floor(v + 0.5);
  const tent = Math.max(
    0,
    1 - 2 * Math.max(Math.abs(u - px), Math.abs(v - py)),
  );
  const height = 0.6 + 0.4 * hash2(params.noiseSeed + 17, px % n, py % n);
  const sign = hash2(params.noiseSeed + 29, px % n, py % n) < 0.5 ? -1 : 1;
  const field = bilinear + noise + sign * params.amplitude * height * tent;

  // Which patch pixel this is: the same place in the plane, folded into the one period the patch holds.
  const xo = ((x % n) + n) % n;
  const yo = ((y % n) + n) % n;
  const from = (
    image: RgbaImage,
  ): readonly [number, number, number, number] => {
    const at =
      ((origin[1] + 16 * (xo + yo) + cy - 16) * image.width +
        origin[0] +
        32 * (xo - yo) +
        cx -
        32) *
      4;
    return [
      image.rgba[at] as number,
      image.rgba[at + 1] as number,
      image.rgba[at + 2] as number,
      image.rgba[at + 3] as number,
    ];
  };

  if (!isOver(field)) return from(patches.base);
  const margin = field - 0.5;
  const band = params.edgeBandPx / STEP_PX;
  if (margin <= OVERHANG_DEPTH * band) {
    for (const hang of ctx.overhangs) {
      const du2 = around(u - hang.u, n);
      const dv2 = around(v - hang.v, n);
      const dx = 32 * (du2 - dv2);
      const dy = 16 * (du2 + dv2);
      const d2 = dx * dx + dy * dy;
      // The reach falls from its depth at the centre to nothing at the disc's edge, more slowly than
      // the field climbs away from the boundary, so an overhang is always joined to the grass.
      if (
        d2 < hang.r * hang.r &&
        margin <= OVERHANG_DEPTH * band * (1 - Math.sqrt(d2) / hang.r)
      )
        return from(patches.base);
    }
  }
  const broken = periodicValueNoise(params.noiseSeed + 3, 2 * u, 2 * v, 2 * n);
  if (broken >= BAND_BREAK && margin <= band * (0.5 + broken))
    return [...params.bandColour, 255];
  return from(patches.over);
}

/** One 64x32 cell of the set as RGBA; pixels outside the diamond are transparent. */
function cell(ctx: Context, mask: number, x: number, y: number): Uint8Array {
  const rgba = new Uint8Array(TILE_CELL.w * TILE_CELL.h * 4);
  for (let cy = 0; cy < TILE_CELL.h; cy += 1)
    for (let cx = 0; cx < TILE_CELL.w; cx += 1) {
      const value = pixel(ctx, mask, x, y, cx, cy);
      if (value !== null) rgba.set(value, (cy * TILE_CELL.w + cx) * 4);
    }
  return rgba;
}

/** The atlas: 16 columns by mask, N squared rows by offset, laid out as `tileAtlasRect` says. */
export function stampAtlas(params: StampParams, patches: Patches): StampResult {
  const ctx = context(params, patches);
  if (typeof ctx === "string") return { ok: false, message: ctx };
  const n = params.period;
  const width = TILE_MASKS * TILE_CELL.w;
  const height = n * n * TILE_CELL.h;
  const rgba = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < n * n; offset += 1)
    for (let mask = 0; mask < TILE_MASKS; mask += 1) {
      const rect = tileAtlasRect(mask, offset, n);
      const made = cell(ctx, mask, offset % n, Math.floor(offset / n));
      for (let row = 0; row < rect.h; row += 1)
        rgba.set(
          made.subarray(row * rect.w * 4, (row + 1) * rect.w * 4),
          ((rect.y + row) * width + rect.x) * 4,
        );
    }
  return { ok: true, image: { width, height, rgba } };
}

/**
 * Lays a grid of terrain out as the game lays its ground: one tile per lattice point, (w + 1) by
 * (h + 1) of them, a point's 64x32 box being its grid cell's `diamondOrigin` raised 16 px. Each
 * tile's pixels come from `tileAt`, so the same layout composes the atlas's cells and the direct
 * stamp. The image is 32 (w + h) + 64 wide and 16 (w + h) + 32 high, and transparent where no tile is.
 */
export function composeGrid(
  grid: readonly (readonly number[])[],
  tileAt: (x: number, y: number, mask: number) => Uint8Array,
): RgbaImage {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  const width = TILE_CELL.w * ((w + h) / 2 + 1);
  const height = (TILE_CELL.h / 2) * (w + h) + TILE_CELL.h;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y <= h; y += 1)
    for (let x = 0; x <= w; x += 1) {
      const made = tileAt(x, y, tileMaskAt(grid, x, y));
      const boxX = (x - y) * (TILE_CELL.w / 2) + (TILE_CELL.w / 2) * h;
      const boxY = (x + y) * (TILE_CELL.h / 2);
      for (let row = 0; row < TILE_CELL.h; row += 1)
        for (let col = 0; col < TILE_CELL.w; col += 1) {
          const from = (row * TILE_CELL.w + col) * 4;
          if (made[from + 3] === 0) continue;
          rgba.set(
            made.subarray(from, from + 4),
            ((boxY + row) * width + boxX + col) * 4,
          );
        }
    }
  return { width, height, rgba };
}

/** A grid stamped directly from the patches and the field, with no atlas. */
export function stampGrid(
  params: StampParams,
  patches: Patches,
  grid: readonly (readonly number[])[],
): StampResult {
  const ctx = context(params, patches);
  if (typeof ctx === "string") return { ok: false, message: ctx };
  return {
    ok: true,
    image: composeGrid(grid, (x, y, mask) => cell(ctx, mask, x, y)),
  };
}

/** A grid assembled from the cells of an atlas. */
export function assembleGrid(
  atlas: RgbaImage,
  period: number,
  grid: readonly (readonly number[])[],
): RgbaImage {
  return composeGrid(grid, (x, y, mask) => {
    const rect = tileAtlasRect(mask, tileOffsetAt(x, y, period), period);
    const rgba = new Uint8Array(rect.w * rect.h * 4);
    for (let row = 0; row < rect.h; row += 1)
      rgba.set(
        atlas.rgba.subarray(
          ((rect.y + row) * atlas.width + rect.x) * 4,
          ((rect.y + row) * atlas.width + rect.x + rect.w) * 4,
        ),
        row * rect.w * 4,
      );
    return rgba;
  });
}
