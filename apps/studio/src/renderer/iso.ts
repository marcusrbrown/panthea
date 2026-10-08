// Studio-owned isometric projection and depth ordering. Pure functions: tile
// coordinates in, logical screen pixels (y down) and a depth z out. The
// art-guide rules this encodes: 64x32 tiles drawn as 64x31 diamonds, a 16 px
// elevation step, depth `x + y - z` of the footprint's bottom-vertex cell with
// ties broken by layer. three-flatland's TileMap2D is not used for placement:
// it positions tiles orthogonally whatever orientation it is given.

export const TILE_W = 64;
export const TILE_H = 32;
export const DIAMOND_H = 31;
export const ELEVATION_STEP = 16;

/** Supported tile coordinates, inclusive. Anything outside is refused, never clamped. */
export const COORD_MIN = -64;
export const COORD_MAX = 63;
/** Supported elevation steps, inclusive. */
export const ELEVATION_MIN = -8;
export const ELEVATION_MAX = 24;
/** Largest footprint side in tiles. */
export const FOOTPRINT_MAX = 8;

export const LAYERS = [
  "ground",
  "decal",
  "structure",
  "actor",
  "effect",
  "speech",
] as const;
export type Layer = (typeof LAYERS)[number];

/** Distinct stable-order slots per (depth, layer). */
export const ENTITY_SLOTS = 256;

const DEPTH_MIN = 2 * COORD_MIN - ELEVATION_MAX;
const DEPTH_MAX = 2 * COORD_MAX - ELEVATION_MIN;
const DEPTH_COUNT = DEPTH_MAX - DEPTH_MIN + 1;

/**
 * The depth key maps to an integer sprite z in [DEPTH_Z_MIN, DEPTH_Z_MAX];
 * a larger z is nearer the camera. Place an orthographic camera at
 * DEPTH_CAMERA_Z looking down -z with near = DEPTH_NEAR and far = DEPTH_FAR,
 * and every drawable sits inside the frustum. The span is far below 2^24, so
 * distinct keys stay distinct in a 24-bit depth buffer.
 */
export const DEPTH_Z_MIN = 0;
export const DEPTH_Z_MAX =
  DEPTH_Z_MIN + DEPTH_COUNT * LAYERS.length * ENTITY_SLOTS - 1;
export const DEPTH_NEAR = 0.5;
export const DEPTH_CAMERA_Z = DEPTH_Z_MAX + 1;
export const DEPTH_FAR = DEPTH_CAMERA_Z - DEPTH_Z_MIN + 0.5;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Tiles covered along x (w) and y (h). */
export interface Footprint {
  readonly w: number;
  readonly h: number;
}

export interface Cell {
  readonly x: number;
  readonly y: number;
  /** Elevation in steps. */
  readonly z: number;
}

export type RefusalReason =
  | "non-integer"
  | "out-of-range"
  | "bad-footprint"
  | "bad-order";

export interface Refusal {
  readonly reason: RefusalReason;
  readonly detail: string;
}

export type Checked<T> =
  | { readonly ok: true; readonly value: T }
  | ({ readonly ok: false } & Refusal);

const ok = <T>(value: T): Checked<T> => ({ ok: true, value });
const refuse = (reason: RefusalReason, detail: string): Checked<never> => ({
  ok: false,
  reason,
  detail,
});

const SINGLE_TILE: Footprint = { w: 1, h: 1 };

function checkFootprint(footprint: Footprint): Checked<Footprint> {
  for (const [name, side] of [
    ["w", footprint.w],
    ["h", footprint.h],
  ] as const) {
    if (!Number.isInteger(side) || side < 1 || side > FOOTPRINT_MAX) {
      return refuse(
        "bad-footprint",
        `footprint ${name}=${side} must be an integer from 1 to ${FOOTPRINT_MAX}`,
      );
    }
  }
  return ok(footprint);
}

function checkAxis(
  name: string,
  value: number,
  min: number,
  max: number,
): Checked<number> {
  if (!Number.isInteger(value)) {
    return refuse("non-integer", `${name}=${value} is not an integer`);
  }
  if (value < min || value > max) {
    return refuse(
      "out-of-range",
      `${name}=${value} is outside the supported range ${min}..${max}`,
    );
  }
  return ok(value);
}

/** Validates the origin cell and the footprint's far corner, and returns the bottom-vertex cell. */
function bottomCell(cell: Cell, footprint: Footprint): Checked<Cell> {
  const sides = checkFootprint(footprint);
  if (!sides.ok) return sides;
  const z = checkAxis("z", cell.z, ELEVATION_MIN, ELEVATION_MAX);
  if (!z.ok) return z;
  const x = checkAxis("x", cell.x, COORD_MIN, COORD_MAX);
  if (!x.ok) return x;
  const y = checkAxis("y", cell.y, COORD_MIN, COORD_MAX);
  if (!y.ok) return y;
  const farX = checkAxis(
    "x + w - 1",
    cell.x + footprint.w - 1,
    COORD_MIN,
    COORD_MAX,
  );
  if (!farX.ok) return farX;
  const farY = checkAxis(
    "y + h - 1",
    cell.y + footprint.h - 1,
    COORD_MIN,
    COORD_MAX,
  );
  if (!farY.ok) return farY;
  return ok({ x: farX.value, y: farY.value, z: z.value });
}

/**
 * Top-left of the cell's 64x32 box. Cell (0,0,0) has its box at (-32, 0), so
 * its diamond's bottom vertex sits on x = 0.
 */
export function diamondOrigin(cell: Cell): Checked<Point> {
  const checked = bottomCell(cell, SINGLE_TILE);
  if (!checked.ok) return checked;
  return ok({
    x: (cell.x - cell.y) * (TILE_W / 2) - TILE_W / 2,
    y: (cell.x + cell.y) * (TILE_H / 2) - cell.z * ELEVATION_STEP,
  });
}

/**
 * Pixel span of the diamond on `row` of its box, x1 exclusive, or null when
 * the row carries no diamond. Rows 0..30 are drawn; row 31 belongs to the
 * neighbours, which is what makes adjacent tiles lock without a seam row.
 */
export function diamondRow(row: number): { x0: number; x1: number } | null {
  if (!Number.isInteger(row) || row < 0 || row >= DIAMOND_H) return null;
  const half = 2 * (1 + Math.min(row, DIAMOND_H - 1 - row));
  return { x0: TILE_W / 2 - half, x1: TILE_W / 2 + half };
}

/**
 * Screen point, in pixel-edge coordinates, of the footprint's bottom vertex:
 * the lower edge of the last diamond row of the footprint's bottom cell, lifted
 * 16 px per elevation step.
 */
export function bottomVertex(
  cell: Cell,
  footprint: Footprint = SINGLE_TILE,
): Checked<Point> {
  const bottom = bottomCell(cell, footprint);
  if (!bottom.ok) return bottom;
  return ok({
    x: (bottom.value.x - bottom.value.y) * (TILE_W / 2),
    y:
      (bottom.value.x + bottom.value.y) * (TILE_H / 2) +
      DIAMOND_H -
      bottom.value.z * ELEVATION_STEP,
  });
}

/** Top-left of a sprite whose manifest pivot sits on the footprint's bottom vertex. */
export function spriteOrigin(
  cell: Cell,
  footprint: Footprint,
  pivot: Point,
): Checked<Point> {
  const vertex = bottomVertex(cell, footprint);
  if (!vertex.ok) return vertex;
  return ok({ x: vertex.value.x - pivot.x, y: vertex.value.y - pivot.y });
}

/** `x + y - z` of the footprint's bottom-vertex cell. Sprite pixel height plays no part. */
export function depthOf(
  cell: Cell,
  footprint: Footprint = SINGLE_TILE,
): Checked<number> {
  const bottom = bottomCell(cell, footprint);
  if (!bottom.ok) return bottom;
  return ok(bottom.value.x + bottom.value.y - bottom.value.z);
}

export interface DepthKey {
  readonly depth: number;
  readonly layer: Layer;
  /** Stable entity order within the same depth and layer. */
  readonly order: number;
}

/** Strictly monotonic in (depth, layer, order); a larger z draws in front. */
export function depthZ(key: DepthKey): Checked<number> {
  const depth = checkAxis("depth", key.depth, DEPTH_MIN, DEPTH_MAX);
  if (!depth.ok) return depth;
  if (
    !Number.isInteger(key.order) ||
    key.order < 0 ||
    key.order >= ENTITY_SLOTS
  ) {
    return refuse(
      "bad-order",
      `order=${key.order} must be an integer from 0 to ${ENTITY_SLOTS - 1}`,
    );
  }
  const layer = LAYERS.indexOf(key.layer);
  return ok(
    DEPTH_Z_MIN +
      ((depth.value - DEPTH_MIN) * LAYERS.length + layer) * ENTITY_SLOTS +
      key.order,
  );
}
