// The scene's layout on the shared pixel core. The scene draws one place, the
// one the observer follows, at the layout origin: its buildings in a row above
// it and its actors in rows below, in render-target pixel space: whole pixels,
// x right, y UP (three's convention, which the shared camera uses). The core
// draws the scene at 1x into a fixed-size target and enlarges it by a whole zoom.
// Under them lies the place's ground, an 8x8 grid of terrain drawn as a 9x9 lattice
// of 64x32 tiles: 576 across and 288 down, centred across the view, with its top
// vertex (lattice point (0, 0)) 144 above the layout origin. Its middle, 16 above
// the origin, divides the buildings' back rows (feet 80 above the origin) from the
// actors' front rows (feet 48 and 63 below it).
//
// Logical size, by arithmetic (the layout test recomputes every extent from the
// published manifests):
//   actors    : the largest actor cell is the 112x96 god-tall at pivot (56, 78), so a
//               cell reaches 56 left and right of its foot, 78 above it and 18 below;
//               the actor slots run from x = -28 to +44, in two rows at y = -48 and -63
//   buildings : the house and the oak are 192x192 cells with the foot at the pivot,
//               (96, 136) and (96, 164): 96 left and right of the foot. The feet stand
//               in one row 80 above the place, one cell (192) apart and centred on it,
//               so no two structures' cells overlap: one at 0, two at -96 and +96,
//               three at -192, 0 and +192. The fire's cell is 64x88 (pivot at its
//               bottom centre) and sits on the structure's anchor (STRUCTURE_ANCHORS:
//               79 above the oak's foot, 57 above the house's)
//   ground    : the tiles' boxes run from x = -288 to +288, from 160 above the layout origin
//               (the first tile's top, 16 above the grid's top vertex) to 128 below it
//               (the last tile's bottom), so the ground is the deepest content
//   rings     : an event ring is at most 24 px in radius, 128 right of and 23 below the place,
//               clear of the actors (the widest cell in the last column ends at x = 100)
//   right     : 192 + 96 = 288, the third building's cell (an actor's reach is 100)
//   left      : -(192 + 96) = -288
//   top       : 80 + 79 + 88 = 247, the oak's fire (the oak's own top is 80 + 164 = 244)
//   bottom    : -128, the ground's last tile (the second actor row ends at -81)
// The camera fits that content, so it is off centre: the width is 2 x 288 = 576, on
// the 16 px grid already; the height is 247 + 128 = 375 rounded up to 384, with the top
// edge at 252 (5 above the content) and the bottom edge at -132 (4 below it). That is
// inside the scene area of the default 1280x720 window (714x635, see the layout
// test), so the canvas is shown whole at zoom 1 at a device pixel ratio of 1 and at
// zoom 2 at 2. A strike is exempt above the top edge only: its impact and everything
// below it are inside (the oak's bolt is 116 above its impact, which is 181 above the
// layout origin, so its top leaves by 45). The target is sized for up to 3 buildings
// and 14 actors (two rows) at a place and for the cells above. Authored worlds hold at
// most 2 buildings and 8 inhabitants in a place. Anything beyond clips at the target's
// edge.

import {
  type CanvasMetrics,
  canvasMetrics,
  type LogicalSize,
} from "@panthea/renderer";

export const LOGICAL_SIZE: LogicalSize = { width: 576, height: 384 };

/** The world row (y up) of the target's top edge: the content reaches 247 above the layout origin and 128 below it. */
const VIEW_TOP = 252;

/** Top-left of the viewport in the core's screen space (y down): centred across, and set to the content's rows down. */
export const CAMERA_ORIGIN = {
  x: -LOGICAL_SIZE.width / 2,
  y: -VIEW_TOP,
} as const;

/**
 * Where lattice point (0, 0) of the ground is centred, in world space (y up): the top vertex of the 8x8 grid's
 * diamond. The tile of lattice point (x, y) is the shared `latticeOrigin(x, y)` box moved to here.
 */
export const GROUND_ORIGIN: WorldPoint = { x: 0, y: 144 };

/** The lattice points the ground draws: 0 to 8 on each axis, the grid's 8 cells and the half tile round them, row by row. */
export const GROUND_POINTS: readonly {
  readonly x: number;
  readonly y: number;
}[] = Array.from({ length: 81 }, (_, index) => ({
  x: index % 9,
  y: Math.floor(index / 9),
}));

/** The scene's event rings: offset from their place, from the smallest radius in steps of 4. */
export const EVENT_RING = {
  dx: 128,
  dy: -23,
  radius: 16,
  step: 4,
  sizes: 3,
  /** The largest radius a ring is drawn at. */
  radiusMax: 24,
} as const;

/** Where the followed place stands: the middle of the scene, the origin every slot is measured from. */
export const PLACE_ORIGIN: WorldPoint = { x: 0, y: 0 };

export const MAX_BUILDINGS_PER_PLACE = 3;
export const MAX_ACTORS_PER_PLACE = 14;

/** The largest cell the layout is sized for: the 112x96 `god-tall` cell with its pivot (56, 78). */
export const MAX_ACTOR_CELL = {
  width: 112,
  height: 96,
  pivotX: 56,
  pivotY: 78,
} as const;

/** Buildings stand in one row `y` above their place, `dx` apart: the width of the widest structure cell. */
export const BUILDING_SLOT = { dx: 192, y: 80 } as const;

/** Where an actor's foot sits relative to its place, and the grid of slots around it. */
export const ACTOR_FOOT = {
  x: -28,
  y: -48,
  columns: 7,
  dx: 12,
  dy: 15,
} as const;

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

export function actorFoot(place: WorldPoint, index: number): WorldPoint {
  return {
    x: place.x + ACTOR_FOOT.x + (index % ACTOR_FOOT.columns) * ACTOR_FOOT.dx,
    y:
      place.y +
      ACTOR_FOOT.y -
      Math.floor(index / ACTOR_FOOT.columns) * ACTOR_FOOT.dy,
  };
}

/**
 * The foot of the building in slot `index` of `count` at `place`: the point its
 * art's pivot sits on. The row is centred on the place, so a lone building
 * stands at it and two stand half a slot either side.
 */
export function buildingFoot(
  place: WorldPoint,
  index: number,
  count: number,
): WorldPoint {
  return {
    x: place.x + (index - (count - 1) / 2) * BUILDING_SLOT.dx,
    y: place.y + BUILDING_SLOT.y,
  };
}

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
