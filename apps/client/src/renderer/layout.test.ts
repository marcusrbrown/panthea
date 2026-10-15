import { expect, test } from "bun:test";
import { canvasMetrics, STRUCTURE_ANCHORS } from "@panthea/renderer";

import {
  FIRE_MANIFEST_TEXT,
  HOUSE_MANIFEST_TEXT,
  OAK_MANIFEST_TEXT,
  STRIKE_MANIFEST_TEXT,
} from "../../test/structure-fixture";
import type { ViewLocation } from "../store";
import {
  ACTOR_FOOT,
  actorFoot,
  BUILDING_FOOT,
  buildingFoot,
  CAMERA_ORIGIN,
  EVENT_RING,
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

/** The cells the target must hold: the legacy 64x80 god and the 112x96 `god-tall`, each by its own pivot. */
const LEGACY_CELL = { width: 64, height: 80, pivotX: 32, pivotY: 80 } as const;
const GOD_TALL_CELL = {
  width: 112,
  height: 96,
  pivotX: 56,
  pivotY: 78,
} as const;

test("the largest actor cell is the 112x96 god-tall at pivot (56,78)", () => {
  expect(MAX_ACTOR_CELL).toEqual(GOD_TALL_CELL);
});

interface Cell {
  readonly width: number;
  readonly height: number;
  readonly pivotX: number;
  readonly pivotY: number;
}

interface Manifest {
  readonly cell: { readonly w: number; readonly h: number };
  readonly pivot: { readonly x: number; readonly y: number };
  readonly animations: readonly {
    readonly frames: readonly {
      readonly rect: { readonly w: number; readonly h: number };
    }[];
  }[];
}

/** The published cell of a manifest, read from the committed copy: every frame of every state must be exactly it. */
function cellOf(text: string): Cell {
  const manifest = JSON.parse(text) as Manifest;
  for (const animation of manifest.animations) {
    for (const frame of animation.frames) {
      expect([frame.rect.w, frame.rect.h]).toEqual([
        manifest.cell.w,
        manifest.cell.h,
      ]);
    }
  }
  return {
    width: manifest.cell.w,
    height: manifest.cell.h,
    pivotX: manifest.pivot.x,
    pivotY: manifest.pivot.y,
  };
}

// The published cells, from the manifests. The house and the oak each publish all
// three states (intact, damaged, ruin) on one cell, so one box holds every state.
const BUILDING_CELL = cellOf(HOUSE_MANIFEST_TEXT);
const TREE_CELL = cellOf(OAK_MANIFEST_TEXT);
const FIRE_CELL = cellOf(FIRE_MANIFEST_TEXT);
const STRIKE_CELL = cellOf(STRIKE_MANIFEST_TEXT);

test("the cells the layout is sized for are the published ones", () => {
  expect(BUILDING_CELL).toEqual({
    width: 192,
    height: 192,
    pivotX: 96,
    pivotY: 136,
  });
  expect(TREE_CELL).toEqual({
    width: 192,
    height: 192,
    pivotX: 96,
    pivotY: 164,
  });
  expect(FIRE_CELL).toEqual({ width: 64, height: 88, pivotX: 32, pivotY: 88 });
  expect(STRIKE_CELL).toEqual({
    width: 64,
    height: 128,
    pivotX: 32,
    pivotY: 116,
  });
});

interface Extent {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The box of `cell` with its pivot on `at` (world space, y up). */
function boxOf(cell: Cell, at: { x: number; y: number }): Extent {
  return {
    left: at.x - cell.pivotX,
    right: at.x + cell.width - cell.pivotX,
    top: at.y + cell.pivotY,
    bottom: at.y - (cell.height - cell.pivotY),
  };
}

/** The camera's view in world space (y up): the target, from its top-left corner. */
const VIEW = {
  left: CAMERA_ORIGIN.x,
  right: CAMERA_ORIGIN.x + LOGICAL_SIZE.width,
  top: -CAMERA_ORIGIN.y,
  bottom: -CAMERA_ORIGIN.y - LOGICAL_SIZE.height,
};

const inside = (extent: Extent) => {
  expect(extent.left).toBeGreaterThanOrEqual(VIEW.left);
  expect(extent.right).toBeLessThanOrEqual(VIEW.right);
  expect(extent.top).toBeLessThanOrEqual(VIEW.top);
  expect(extent.bottom).toBeGreaterThanOrEqual(VIEW.bottom);
};

test("the view holds every actor slot, every structure at its tallest, its fire, the event rings and the strike from its impact down, at 1x for any number of places", () => {
  let widest = 0;
  let tallest = 0;
  let deepest = 0;

  for (let count = 1; count <= 40; count += 1) {
    for (const point of locationPoints(places(count)).values()) {
      const extents: Extent[] = [];
      for (const cell of [LEGACY_CELL, GOD_TALL_CELL, MAX_ACTOR_CELL]) {
        for (let index = 0; index < MAX_ACTORS_PER_PLACE; index += 1) {
          extents.push(boxOf(cell, actorFoot(point, index)));
        }
      }
      // An event ring, at its largest, drawn at its offset from the place.
      const ring = {
        x: point.x + EVENT_RING.dx,
        y: point.y + EVENT_RING.dy,
      };
      extents.push({
        left: ring.x - EVENT_RING.radiusMax,
        right: ring.x + EVENT_RING.radiusMax,
        top: ring.y + EVENT_RING.radiusMax,
        bottom: ring.y - EVENT_RING.radiusMax,
      });
      for (let index = 0; index < MAX_BUILDINGS_PER_PLACE; index += 1) {
        const foot = buildingFoot(point, index);
        for (const [cell, anchors] of [
          [BUILDING_CELL, STRUCTURE_ANCHORS.building],
          [TREE_CELL, STRUCTURE_ANCHORS.tree],
        ] as const) {
          // The cell holds the structure in all three states.
          extents.push(boxOf(cell, foot));
          // The anchors are offsets down the screen from the foot.
          extents.push(
            boxOf(FIRE_CELL, {
              x: foot.x + anchors.fire.x,
              y: foot.y - anchors.fire.y,
            }),
          );
          // The strike may leave through the top: only the cell from its impact down must be seen.
          const impact = boxOf(STRIKE_CELL, {
            x: foot.x + anchors.strike.x,
            y: foot.y - anchors.strike.y,
          });
          inside({ ...impact, top: foot.y - anchors.strike.y });
        }
      }
      for (const extent of extents) {
        inside(extent);
        widest = Math.max(
          widest,
          Math.abs(extent.left),
          Math.abs(extent.right),
        );
        tallest = Math.max(tallest, extent.top);
        deepest = Math.max(deepest, -extent.bottom);
      }
    }
  }
  // The header's arithmetic: 205 + 60 + 96 = 361 across (the building slots); 205 + 40 + 79 + 88 = 412 up (the
  // fire on the oak, above the oak's own 205 + 40 + 164 = 409); 286 down (the actor rows).
  expect(widest).toBe(361);
  expect(tallest).toBe(412);
  expect(deepest).toBe(286);
  // The size is not slack: the view's edge is within 8 px of the extent on every side.
  expect(VIEW.right - widest).toBeLessThan(8);
  expect(-VIEW.left - widest).toBeLessThan(8);
  expect(VIEW.top - tallest).toBeLessThan(8);
  expect(VIEW.bottom + deepest).toBeLessThan(8);
});

test("the highest strike's top leaves the view, and only its top", () => {
  const impact = 205 + BUILDING_FOOT.y + -STRUCTURE_ANCHORS.tree.strike.y;
  const top = impact + STRIKE_CELL.pivotY;

  expect(top).toBeGreaterThan(VIEW.top);
  expect(impact).toBeLessThan(VIEW.top);
});

test("the camera is off centre to fit the content: 736x704 on the 16 px grid, from 416 above the layout origin to 288 below", () => {
  // Width 2 x 361 = 722 -> 736. Height 412 + 286 = 698 -> 704, with the top edge on the grid at 416.
  expect(LOGICAL_SIZE).toEqual({ width: 736, height: 704 });
  expect(LOGICAL_SIZE.width % 16).toBe(0);
  expect(LOGICAL_SIZE.height % 16).toBe(0);
  expect(CAMERA_ORIGIN).toEqual({ x: -368, y: -416 });
  expect(VIEW.top).toBe(416);
  expect(VIEW.bottom).toBe(-288);
});

test("the target is no taller than a 1280x720 window", () => {
  expect(LOGICAL_SIZE.height).toBeLessThanOrEqual(720);
  expect(LOGICAL_SIZE.width).toBeLessThanOrEqual(1280);
});

test("a building's foot is its slot: three across a place, centred on it, with a second row above", () => {
  const origin = { x: 100, y: 40 };

  expect(BUILDING_FOOT).toEqual({ x: -60, y: 40, columns: 3, dx: 60, dy: 40 });
  expect(buildingFoot(origin, 0)).toEqual({ x: 40, y: 80 });
  expect(buildingFoot(origin, 1)).toEqual({ x: 100, y: 80 });
  expect(buildingFoot(origin, 2)).toEqual({ x: 160, y: 80 });
  expect(buildingFoot(origin, 3)).toEqual({ x: 40, y: 120 });
});

test("an actor's foot slot keeps the existing marker arithmetic", () => {
  const origin = { x: 100, y: 40 };
  expect(actorFoot(origin, 0)).toEqual({ x: 72, y: -8 });
  expect(actorFoot(origin, 6)).toEqual({ x: 144, y: -8 });
  expect(actorFoot(origin, 7)).toEqual({ x: 72, y: -23 });
  expect(ACTOR_FOOT).toEqual({ x: -28, y: -48, columns: 7, dx: 12, dy: 15 });
});

const fit1280x720 = () => fitView({ width: 1280, height: 720 }, 1);

test("zoom is the largest whole number that fits the canvas, never below 1", () => {
  const fit = (width: number, height: number, ratio = 1) =>
    fitView({ width, height }, ratio);

  expect(fit(736, 704).zoom).toBe(1);
  expect(fit(1471, 1407, 1).zoom).toBe(1);
  expect(fit(1472, 1408, 1).zoom).toBe(2);
  expect(fit(1472, 1407, 1).zoom).toBe(1);
  expect(fit(5000, 2200, 1).zoom).toBe(3);
  expect(fit(10, 10).zoom).toBe(1);
  expect(fit(0, 0).zoom).toBe(1);
  // The canvas is measured in device pixels: a 1000x1000 CSS box at 2x is 2000x2000.
  expect(fit(1000, 1000, 2).zoom).toBe(2);
});

test("at the 1280x720 desktop window the zoom is 1 and the whole 736x704 target is shown, uncropped", () => {
  // The window is the most the game's box can be; chrome only makes it smaller.
  const fitted = fit1280x720();

  expect(fitted.zoom).toBe(1);
  expect(fitted.metrics.backingWidth).toBeLessThanOrEqual(1280);
  expect(fitted.metrics.backingHeight).toBeLessThanOrEqual(720);
  // Centred with room to spare on both axes.
  expect(fitted.top).toBe(8);
  expect(fitted.left).toBe(272);
});

test("the backing store is exactly logical size x zoom and the CSS box is that over the pixel ratio", () => {
  const fitted = fitView({ width: 736, height: 704 }, 2);

  expect(fitted.metrics).toEqual(canvasMetrics(LOGICAL_SIZE, 2, 2));
  expect(fitted.metrics.backingWidth).toBe(1472);
  expect(fitted.metrics.backingHeight).toBe(1408);
  expect(fitted.metrics.cssWidth).toBe(736);
  expect(fitted.metrics.cssHeight).toBe(704);
});

test("the canvas is centred on a whole device pixel", () => {
  const fitted = fitView({ width: 741, height: 709 }, 2);

  // 1482x1418 device pixels hold 1472x1408: 10 spare on each axis, 5 on each side.
  expect(fitted.left).toBe(5 / 2);
  expect(fitted.top).toBe(5 / 2);
  expect(Number.isInteger(fitted.left * 2)).toBe(true);
  expect(Number.isInteger(fitted.top * 2)).toBe(true);
});
