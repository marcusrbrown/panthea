// The scene's layout on the shared pixel core. The scene draws one place, the one the observer
// follows, on an 8x8 grid of cells in the shared isometric projection (64x32 diamonds): its
// ground, an 8x8 grid of terrain drawn as a 9x9 lattice of tiles, then its buildings, actors,
// fire and strike placed on cells of that grid by `composeScene`, depth sorted by the shared
// depth key. Positions are render-target pixel space: whole pixels, x right, y UP (three's
// convention, which the shared camera uses); the world origin is the grid's centre. The core
// draws the scene at 1x into a fixed-size target and enlarges it by a whole zoom.
//
// The grid (cell (x, y), x down-right and y down-left, depth x + y): its top vertex, lattice
// point (0, 0), is 128 above the origin, so the diamond is 512 across and 256 down round it,
// and the ground's 9x9 tiles, a half tile beyond it, 576 by 288. Its middle row is depth 7 to 8.
// Rows are a layout choice:
//   buildings : in the back rows. A slot is the footprint's bottom cell, which is where the
//               art's foot (its pivot) stands, so the table holds bottom cells, and the
//               footprints reach back from them: the house's 2 along x by 3 along y, the oak's
//               1 by 1 (STRUCTURE_FOOTPRINTS). The house's foot is its plinth's lowest point, the
//               porch's front corner, and its slab's wings hang a half cell over the next
//               column; the oak's foot is its trunk, and its roots reach a cell round it. For
//               one building (2, 3). For two (1, 6) and (5, 2): 8 columns of x - y apart, so 256 px
//               along the screen's x, which leaves the widest pairing, a house on the left and an
//               oak on the right (the house reaches 119 px right of its foot, the oak 86 left),
//               256 - 205 = 51 px of ground between the art, and two houses (178 px wide each)
//               78. Their footprints are the back half: every cell of depth 7 or less, so the feet
//               stand on the depth 9 row, 15 px below the middle, and the roofs and walls above it.
//               For three (1, 6), (5, 2) and (2, 2): three houses of 178 px do not fit apart on the
//               grid (the feet of any two cells are at most 352 px apart, and three need 2 x 179), so
//               the third stands behind the other two and its art overlaps theirs: by 82 px at
//               most for a house with a house, 108 for a house with an oak, while no two
//               footprints, and no two plinths or root flares, touch. No authored place has more
//               than two
//   actors    : in the front rows, one to a cell: 14 cells of depth 10 to 14, rows of 4, 4, 3, 2
//               and 1 across the front tip of the diamond (the row of depth 10 lacks its far
//               right cell, which a third building's ground touches), assigned by index from the
//               depth 13 pair, which stand side by side on one screen row, 64 px apart and
//               centred. No cell touches a building's footprint or ground, and no two 16x16
//               placeholders touch
//
// Logical size, by arithmetic (the layout test recomputes every extent from the published
// manifests): the foot of the cell (x, y) is at (32 (x - y), 97 - 16 (x + y)).
//   ground    : x = -288 to +288, from 144 above the origin (the first tile's top, 16 above the
//               grid's top vertex) to 144 below it
//   buildings : the house and the oak are 192x192 cells with the foot at the pivot, (65, 181)
//               and (96, 164). The house's fire is on its roof: STRUCTURE_ANCHORS puts it 102
//               above the foot and 29 right, in a cell 64x88 with its pivot at the bottom
//               centre; the oak's is 79 above its foot. The highest foot is 17 above the
//               origin, at (2, 3); a third building's, behind the others at (2, 2), is 33 above it
//   actors    : the largest cell is the 112x96 god-tall at pivot (56, 78): 56 left and right of
//               its foot, 78 above and 18 below; the lowest foot, the front tip's, is 127 below
//               the origin, so a tall cell there reaches 145 below it
//   ring      : an event ring is at most 24 px in radius, centred on the cell (7, 0), the
//               grid's right corner: x = 224, y = 0
//   top       : 33 + 102 + 88 = 223, a burning third house's fire (the house's own roof is 33 +
//               164 = 197; with two buildings the highest is 17 + 102 + 88 = 207)
//   bottom    : -145, the front tip's tall actor cell (the ground's last tile is at -144)
// The camera fits that content, so it is off centre: the width is 2 x 288 = 576, on the 16 px
// grid already; the height is 223 + 145 = 368 rounded up to 384, with the top edge at 231 (8
// above the content) and the bottom edge at -153 (8 below it). That is inside the scene area
// of the default 1280x720 window (714x635, see the layout test), so the canvas is shown whole
// at zoom 1 at a device pixel ratio of 1 and at zoom 2 at 2. A strike is exempt above the top
// edge only: its impact and everything below it are inside (the house's bolt is 116 above its
// impact, which is 137 above the origin, so its top leaves by 39). The target is sized for up
// to 3 buildings and 14 actors. Authored worlds hold at most 2 buildings and 8 inhabitants in
// a place; a building or actor beyond the tables has no cell and is not drawn.

import {
  bottomVertex,
  type CanvasMetrics,
  canvasMetrics,
  type LogicalSize,
} from "@panthea/renderer";

export const LOGICAL_SIZE: LogicalSize = { width: 576, height: 384 };

/** The world row (y up) of the target's top edge: the content reaches 223 above the origin and 145 below it. */
const VIEW_TOP = 231;

/** Top-left of the viewport in the core's screen space (y down): centred across, and set to the content's rows down. */
export const CAMERA_ORIGIN = {
  x: -LOGICAL_SIZE.width / 2,
  y: -VIEW_TOP,
} as const;

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

/** A cell of the place's grid: x down-right, y down-left, both from 0 to 7. */
export interface GridCell {
  readonly x: number;
  readonly y: number;
}

/** Cells on a side of the grid every place is laid out on. */
export const GRID_SIZE = 8;

/**
 * Where lattice point (0, 0) of the grid is centred, in world space (y up): the diamond's top vertex, 128
 * above the world origin, which is the grid's centre. Everything the shared projection places, tiles and
 * sprites alike, is moved here from the scene's own origin.
 */
export const GRID_ORIGIN: WorldPoint = { x: 0, y: 128 };

/** The lattice points the ground draws: 0 to 8 on each axis, the grid's 8 cells and the half tile round them, row by row. */
export const GROUND_POINTS: readonly {
  readonly x: number;
  readonly y: number;
}[] = Array.from({ length: (GRID_SIZE + 1) ** 2 }, (_, index) => ({
  x: index % (GRID_SIZE + 1),
  y: Math.floor(index / (GRID_SIZE + 1)),
}));

/** The foot of `cell`: the bottom vertex of its diamond, in world space. */
export function cellFoot(cell: GridCell): WorldPoint {
  const vertex = bottomVertex({ ...cell, z: 0 });
  if (!vertex.ok) throw new Error(vertex.detail);
  return {
    x: vertex.value.x + GRID_ORIGIN.x,
    y: GRID_ORIGIN.y - vertex.value.y,
  };
}

/** The centre of `cell`'s diamond, in world space. */
export function cellCentre(cell: GridCell): WorldPoint {
  return {
    x: (cell.x - cell.y) * 32 + GRID_ORIGIN.x,
    y: GRID_ORIGIN.y - (cell.x + cell.y + 1) * 16,
  };
}

export const MAX_BUILDINGS_PER_PLACE = 3;
export const MAX_ACTORS_PER_PLACE = 14;

/**
 * The bottom cell of each building slot, by how many buildings the place has: the cell the structure's foot
 * stands on. Its footprint reaches back from it, so these are the back rows, and for any art the footprints
 * and the ground of one place's slots are disjoint.
 */
export const BUILDING_SLOTS: readonly (readonly GridCell[])[] = [
  [{ x: 2, y: 3 }],
  [
    { x: 1, y: 6 },
    { x: 5, y: 2 },
  ],
  [
    { x: 1, y: 6 },
    { x: 5, y: 2 },
    { x: 2, y: 2 },
  ],
];

/** The cell building `index` of `count` stands on; undefined past the table. */
export function buildingCell(
  index: number,
  count: number,
): GridCell | undefined {
  return BUILDING_SLOTS[count - 1]?.[index];
}

/**
 * Where actors stand, by index: one to a cell, in the front rows: the depth 13 pair, side by side on one screen
 * row, then each row behind from its middle out, to depth 10 (without its far right cell, which the ground of a
 * third building's last slot touches), and last the front tip.
 */
export const ACTOR_CELLS: readonly GridCell[] = [
  { x: 6, y: 7 },
  { x: 7, y: 6 },
  { x: 6, y: 6 },
  { x: 5, y: 7 },
  { x: 7, y: 5 },
  { x: 5, y: 6 },
  { x: 6, y: 5 },
  { x: 4, y: 7 },
  { x: 7, y: 4 },
  { x: 5, y: 5 },
  { x: 4, y: 6 },
  { x: 6, y: 4 },
  { x: 3, y: 7 },
  { x: 7, y: 7 },
];

/** The cell actor `index` stands on; undefined past the table. */
export function actorCell(index: number): GridCell | undefined {
  return ACTOR_CELLS[index];
}

/** The scene's event rings: on the grid's right corner cell, from the smallest radius in steps of 4. */
export const EVENT_RING = {
  cell: { x: 7, y: 0 },
  radius: 16,
  step: 4,
  sizes: 3,
  /** The largest radius a ring is drawn at. */
  radiusMax: 24,
} as const;

/** The largest cell the layout is sized for: the 112x96 `god-tall` cell with its pivot (56, 78). */
export const MAX_ACTOR_CELL = {
  width: 112,
  height: 96,
  pivotX: 56,
  pivotY: 78,
} as const;

export interface FittedView {
  /** The largest whole number such that the target, enlarged, fits the available box. */
  readonly zoom: number;
  readonly metrics: CanvasMetrics;
  /** CSS offsets that centre the canvas on whole device pixels. */
  readonly left: number;
  readonly top: number;
}

/**
 * Fits the target into a box of `available` CSS pixels. The zoom is a whole
 * number, at least 1 (a box too small for the target crops it rather than
 * scaling it fractionally); the canvas backing store is exactly the logical
 * size times the zoom in device pixels.
 */
export function fitView(
  available: { readonly width: number; readonly height: number },
  devicePixelRatio: number,
): FittedView {
  const ratio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  const deviceWidth = Math.floor(Math.max(0, available.width) * ratio);
  const deviceHeight = Math.floor(Math.max(0, available.height) * ratio);
  const zoom = Math.max(
    1,
    Math.floor(
      Math.min(
        deviceWidth / LOGICAL_SIZE.width,
        deviceHeight / LOGICAL_SIZE.height,
      ),
    ),
  );
  const metrics = canvasMetrics(LOGICAL_SIZE, zoom, ratio);
  return {
    zoom,
    metrics,
    left: Math.floor((deviceWidth - metrics.backingWidth) / 2) / ratio,
    top: Math.floor((deviceHeight - metrics.backingHeight) / 2) / ratio,
  };
}
