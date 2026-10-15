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
//            its bottom centre) and sits on the structure's anchor
//            (STRUCTURE_ANCHORS: 79 above the oak's foot, 57 above the house's)
//   rings  : an event ring is at most 24 px in radius, 34 right of and 23 below its place
//   right  : 205 + 60 + 96 = 361 (a building slot; an actor's reach is 305)
//   left   : -(205 + 60 + 96) = -361 (an actor's is -289)
//   top    : 205 + 40 + 79 + 88 = 412, the oak's fire (the oak's own top is
//            205 + 40 + 164 = 409)
//   bottom : -(205 + the actor row at -48, a second row 15 lower, 18 below the pivot) = -286
// The camera fits that content, so it is off centre: the width is 2 x 361 = 722
// rounded up to the 16 px grid, 736 (half 368, 7 to spare); the height is 412 + 286 =
// 698 rounded up to 704, with the top edge on the grid at 416 (4 above the content)
// and the bottom edge at -288 (2 below it). That fits a 1280x720 window at zoom 1.
// A strike is exempt above the top edge only: its impact and everything below it are
// inside (the oak's bolt is 116 above its impact, which is 346 above the layout
// origin at the highest place, so its top leaves by 46). The target is sized for up to 3
// buildings and 14 actors (two rows) per place and for the cells above. Authored worlds
// hold at most 2 buildings and 8 inhabitants in a place. Anything beyond clips at the
// target's edge.

import {
  type CanvasMetrics,
  canvasMetrics,
  type LogicalSize,
} from "@panthea/renderer";

import type { ViewLocation } from "../store";

export const LOGICAL_SIZE: LogicalSize = { width: 736, height: 704 };

/** The world row (y up) of the target's top edge: the content reaches 412 above the layout origin and 286 below it. */
const VIEW_TOP = 416;

/** Top-left of the viewport in the core's screen space (y down): centred across, and set to the content's rows down. */
export const CAMERA_ORIGIN = {
  x: -LOGICAL_SIZE.width / 2,
  y: -VIEW_TOP,
} as const;

/** The scene's event rings: offset from their place, from the smallest radius in steps of 4. */
export const EVENT_RING = {
  dx: 34,
  dy: -23,
  radius: 16,
  step: 4,
  sizes: 3,
  /** The largest radius a ring is drawn at. */
  radiusMax: 24,
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
