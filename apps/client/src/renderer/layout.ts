// The scene's layout on the shared pixel core. Places sit on a ring, buildings
// in a row above each place and actors in rows below it, in render-target
// pixel space: whole pixels, x right, y UP (three's convention, which the
// shared camera uses), origin at the centre of the scene. The core draws the
// scene at 1x into a fixed-size target and enlarges it by a whole zoom.
//
// Logical size, by arithmetic (the layout test recomputes every extent from the
// published manifests):
//   ring radius R = min(205, 110 + 14 * places), so R <= 205
//   actors : the largest actor cell is the 112x96 god-tall at pivot (56, 78), so a
//            cell reaches 56 left and right of its foot, 78 above it and 18 below
//   buildings : the house and the oak are 192x192 cells with the foot at the pivot,
//            (96, 136) and (96, 164): 96 left and right of the foot. A building's
//            foot sits in a slot of a row of three, 60 apart and centred on the
//            place (-60, 0, +60), 40 above it. The fire's cell is 64x88 (pivot at
//            its bottom centre) and the strike's 64x128 (pivot at the impact, 116
//            above the cell's bottom); each sits on the structure's anchor
//            (STRUCTURE_ANCHORS: the strike 101 above the oak's foot, 75 above
//            the house's)
//   right  : 205 + 60 + 96 = 361 (a building slot; an actor's reach is 305)
//   left   : -(205 + 60 + 96) = -361 (an actor's is -289)
//   top    : 205 + 40 + 101 + 116 = 462, the top of a strike on the oak (the oak's
//            own top is 205 + 40 + 164 = 409, its fire's 205 + 40 + 79 + 88 = 412)
//   bottom : -(205 + the actor row at -48, a second row 15 lower, 18 below the pivot) = -286
// A centred camera needs half the width >= 361 and half the height >= 462, so each
// is doubled and rounded up to the 16 px grid: 2 x 361 = 722 -> 736 (half 368, 7 to
// spare) and 2 x 462 = 924 -> 928 (half 464, 2 to spare). That is sized for up to 3
// buildings and 14 actors (two rows) per place and for the cells above. Authored worlds
// hold at most 2 buildings and 8 inhabitants in a place. Anything beyond clips at the
// target's edge. The target is taller than a 1280x720 window, which crops it equally
// above and below (see `fitView`).

import {
  type CanvasMetrics,
  canvasMetrics,
  type LogicalSize,
} from "@panthea/renderer";

import type { ViewLocation } from "../store";

export const LOGICAL_SIZE: LogicalSize = { width: 736, height: 928 };

/** Top-left of the viewport in the core's screen space (y down): the target centred on the origin. */
export const CAMERA_ORIGIN = {
  x: -LOGICAL_SIZE.width / 2,
  y: -LOGICAL_SIZE.height / 2,
} as const;

export const PLACE_RADIUS_MAX = 205;
export const MAX_BUILDINGS_PER_PLACE = 3;
export const MAX_ACTORS_PER_PLACE = 14;

/** The largest cell the layout is sized for: the 112x96 `god-tall` cell with its pivot (56, 78). */
export const MAX_ACTOR_CELL = {
  width: 112,
  height: 96,
  pivotX: 56,
  pivotY: 78,
} as const;

/** Where a building's foot sits relative to its place, and the slots in its row. */
export const BUILDING_FOOT = {
  x: -60,
  y: 40,
  columns: 3,
  dx: 60,
  dy: 40,
} as const;

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

/** Whole pixels, and never -0. */
const whole = (value: number): number => Math.round(value) + 0;

export function locationPoints(
  locations: readonly ViewLocation[],
): Map<string, WorldPoint> {
  const points = new Map<string, WorldPoint>();
  const count = Math.max(1, locations.length);
  locations.forEach((location, index) => {
    const angle =
      count === 1 ? -Math.PI / 2 : (index / count) * Math.PI * 2 - Math.PI / 2;
    const radius =
      count === 1 ? 0 : Math.min(PLACE_RADIUS_MAX, 110 + count * 14);
    points.set(location.id, {
      x: whole(Math.cos(angle) * radius),
      y: whole(Math.sin(angle) * radius),
    });
  });
  return points;
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

/** The foot of the building in slot `index` at `place`: the point its art's pivot sits on. */
export function buildingFoot(place: WorldPoint, index: number): WorldPoint {
  return {
    x:
      place.x +
      BUILDING_FOOT.x +
      (index % BUILDING_FOOT.columns) * BUILDING_FOOT.dx,
    y:
      place.y +
      BUILDING_FOOT.y +
      Math.floor(index / BUILDING_FOOT.columns) * BUILDING_FOOT.dy,
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
