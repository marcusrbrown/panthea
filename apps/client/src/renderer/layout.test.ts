import { expect, test } from "bun:test";
import { canvasMetrics } from "@panthea/renderer";

import type { ViewLocation } from "../store";
import {
  ACTOR_FOOT,
  actorFoot,
  BUILDING_SIZE,
  buildingCenter,
  CAMERA_ORIGIN,
  fitView,
  LOGICAL_SIZE,
  locationPoints,
  MAX_ACTOR_CELL,
  MAX_ACTORS_PER_PLACE,
  MAX_BUILDINGS_PER_PLACE,
  PLACE_RADIUS_MAX,
} from "./layout";

function places(count: number): ViewLocation[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `place-${index}`,
    name: `Place ${index}`,
    realm: "mortal" as const,
    edges: [],
    actors: [],
    buildings: [],
  }));
}

test("place points are whole pixels, and the ring radius is capped at 205", () => {
  for (let count = 1; count <= 40; count += 1) {
    for (const point of locationPoints(places(count)).values()) {
      expect(Number.isInteger(point.x)).toBe(true);
      expect(Number.isInteger(point.y)).toBe(true);
      expect(Math.hypot(point.x, point.y)).toBeLessThanOrEqual(
        PLACE_RADIUS_MAX + 1,
      );
    }
  }
  expect(PLACE_RADIUS_MAX).toBe(205);
  const only = [...locationPoints(places(1)).values()];
  expect(only).toEqual([{ x: 0, y: 0 }]);
});

test("the logical size contains the whole layout at 1x for any number of places", () => {
  // World coordinates, y up; the camera shows x in [-W/2, W/2] and y in [-H/2, H/2].
  const halfWidth = LOGICAL_SIZE.width / 2;
  const halfHeight = LOGICAL_SIZE.height / 2;
  let widest = 0;
  let tallest = 0;

  for (let count = 1; count <= 40; count += 1) {
    for (const point of locationPoints(places(count)).values()) {
      const extents: {
        left: number;
        right: number;
        top: number;
        bottom: number;
      }[] = [];
      for (let index = 0; index < MAX_ACTORS_PER_PLACE; index += 1) {
        const foot = actorFoot(point, index);
        extents.push({
          left: foot.x - MAX_ACTOR_CELL.pivotX,
          right: foot.x + MAX_ACTOR_CELL.width - MAX_ACTOR_CELL.pivotX,
          top: foot.y + MAX_ACTOR_CELL.pivotY,
          bottom: foot.y,
        });
      }
      for (let index = 0; index < MAX_BUILDINGS_PER_PLACE; index += 1) {
        const center = buildingCenter(point, index);
        extents.push({
          left: center.x - BUILDING_SIZE.width / 2,
          right: center.x + BUILDING_SIZE.width / 2,
          // The flame at full intensity: centred 20 above the building, radius 15.
          top: center.y + 20 + 15,
          bottom: center.y - BUILDING_SIZE.height / 2,
        });
      }
      for (const extent of extents) {
        widest = Math.max(
          widest,
          Math.abs(extent.left),
          Math.abs(extent.right),
        );
        tallest = Math.max(
          tallest,
          Math.abs(extent.top),
          Math.abs(extent.bottom),
        );
        expect(extent.left).toBeGreaterThanOrEqual(-halfWidth);
        expect(extent.right).toBeLessThanOrEqual(halfWidth);
        expect(extent.top).toBeLessThanOrEqual(halfHeight);
        expect(extent.bottom).toBeGreaterThanOrEqual(-halfHeight);
      }
    }
  }
  // The size is not slack: the widest and tallest real extents sit within 8 px of the edge.
  expect(halfWidth - widest).toBeLessThan(8);
  expect(halfHeight - tallest).toBeLessThan(8);
});

test("the camera shows the logical size centred on the layout origin, in whole pixels", () => {
  expect(LOGICAL_SIZE).toEqual({ width: 576, height: 592 });
  expect(CAMERA_ORIGIN).toEqual({ x: -288, y: -296 });
});

test("an actor's foot slot keeps the existing marker arithmetic", () => {
  const origin = { x: 100, y: 40 };
  expect(actorFoot(origin, 0)).toEqual({ x: 72, y: -8 });
  expect(actorFoot(origin, 6)).toEqual({ x: 144, y: -8 });
  expect(actorFoot(origin, 7)).toEqual({ x: 72, y: -23 });
  expect(ACTOR_FOOT).toEqual({ x: -28, y: -48, columns: 7, dx: 12, dy: 15 });
});

test("zoom is the largest whole number that fits the canvas, never below 1", () => {
  const fit = (width: number, height: number, ratio = 1) =>
    fitView({ width, height }, ratio);

  expect(fit(576, 592).zoom).toBe(1);
  expect(fit(1151, 1183, 1).zoom).toBe(1);
  expect(fit(1152, 1184, 1).zoom).toBe(2);
  expect(fit(1152, 1183, 1).zoom).toBe(1);
  expect(fit(5000, 1800, 1).zoom).toBe(3);
  expect(fit(10, 10).zoom).toBe(1);
  expect(fit(0, 0).zoom).toBe(1);
  // The canvas is measured in device pixels: a 900x640 CSS box at 2x is 1800x1280.
  expect(fit(900, 640, 2).zoom).toBe(2);
});

test("the backing store is exactly logical size x zoom and the CSS box is that over the pixel ratio", () => {
  const fitted = fitView({ width: 900, height: 640 }, 2);

  expect(fitted.metrics).toEqual(canvasMetrics(LOGICAL_SIZE, 2, 2));
  expect(fitted.metrics.backingWidth).toBe(1152);
  expect(fitted.metrics.backingHeight).toBe(1184);
  expect(fitted.metrics.cssWidth).toBe(576);
  expect(fitted.metrics.cssHeight).toBe(592);
});

test("the canvas is centred on a whole device pixel", () => {
  const fitted = fitView({ width: 901, height: 641 }, 2);

  // 1802x1282 device pixels hold 1152x1184: 325 and 49 spare on each side.
  expect(fitted.left).toBe(325 / 2);
  expect(fitted.top).toBe(49 / 2);
  expect(Number.isInteger(fitted.left * 2)).toBe(true);
  expect(Number.isInteger(fitted.top * 2)).toBe(true);
});
