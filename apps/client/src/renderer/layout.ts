// The scene's layout on the shared pixel core. Places sit on a ring, buildings
// in a row above each place and actors in rows below it, in render-target
// pixel space: whole pixels, x right, y UP (three's convention, which the
// shared camera uses), origin at the centre of the scene. The core draws the
// scene at 1x into a fixed-size target and enlarges it by a whole zoom.
//
// Logical size, by arithmetic (the layout test recomputes every extent):
//   ring radius R = min(205, 110 + 14 * places), so R <= 205
//   right  : 205 + the last actor slot (-28 + 6 * 12 = +44) + half a 64-wide cell (32) = 281
//   left   : -(205 + the first actor slot (-28) + 32) = -265
//   top    : 205 + a building row at +50, its flame centred 20 above and 15 across
//            (50 + 20 + 15 = 85) = 290
//   bottom : -(205 + the actor row at -48, a second row 15 lower) = -268
// A centred camera needs half the width >= 281 and half the height >= 290,
// so the target is 576 x 592 (halves 288 and 296): 7 and 6 px to spare. That
// is sized for up to 3 buildings and 14 actors (two rows) per place and for
// cells no larger than the 64x80 god cell. Authored worlds hold at most 2
// buildings and 8 inhabitants in a place. Anything beyond clips at the target's
// edge; U6 owns the final size.

import {
  type CanvasMetrics,
  canvasMetrics,
  type LogicalSize,
} from "@panthea/renderer";

import type { ViewLocation } from "../store";

export const LOGICAL_SIZE: LogicalSize = { width: 576, height: 592 };

/** Top-left of the viewport in the core's screen space (y down): the target centred on the origin. */
export const CAMERA_ORIGIN = {
  x: -LOGICAL_SIZE.width / 2,
  y: -LOGICAL_SIZE.height / 2,
} as const;

export const PLACE_RADIUS_MAX = 205;
export const MAX_BUILDINGS_PER_PLACE = 3;
export const MAX_ACTORS_PER_PLACE = 14;

/** The largest cell the layout is sized for: the 64x80 god cell with its foot pivot. */
export const MAX_ACTOR_CELL = {
  width: 64,
  height: 80,
  pivotX: 32,
  pivotY: 80,
} as const;

export const BUILDING_SIZE = { width: 28, height: 22 } as const;

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

export function buildingCenter(place: WorldPoint, index: number): WorldPoint {
  return {
    x: place.x - 46 + (index % 3) * 42,
    y: place.y + 50 + Math.floor(index / 3) * 35,
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
