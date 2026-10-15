import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  canvasMetrics,
  latticeOrigin,
  STRUCTURE_ANCHORS,
} from "@panthea/renderer";

import {
  FIRE_MANIFEST_TEXT,
  HOUSE_MANIFEST_TEXT,
  OAK_MANIFEST_TEXT,
  STRIKE_MANIFEST_TEXT,
} from "../../test/structure-fixture";
import {
  ACTOR_FOOT,
  actorFoot,
  BUILDING_SLOT,
  buildingFoot,
  CAMERA_ORIGIN,
  EVENT_RING,
  fitView,
  GROUND_ORIGIN,
  GROUND_POINTS,
  LOGICAL_SIZE,
  MAX_ACTOR_CELL,
  MAX_ACTORS_PER_PLACE,
  MAX_BUILDINGS_PER_PLACE,
  PLACE_ORIGIN,
} from "./layout";

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

const STRUCTURES = [
  [BUILDING_CELL, STRUCTURE_ANCHORS.building],
  [TREE_CELL, STRUCTURE_ANCHORS.tree],
] as const;

test("a place's buildings stand in a centred row, one cell apart, so no two structures' cells overlap, whichever art each is", () => {
  expect<number>(BUILDING_SLOT.dx).toBe(BUILDING_CELL.width);
  expect<number>(BUILDING_SLOT.dx).toBeGreaterThanOrEqual(TREE_CELL.width);

  for (let count = 1; count <= MAX_BUILDINGS_PER_PLACE; count += 1) {
    const feet = Array.from({ length: count }, (_, index) =>
      buildingFoot(PLACE_ORIGIN, index, count),
    );
    // Centred on the place, on whole pixels, all in one row.
    expect(feet.reduce((sum, foot) => sum + foot.x, 0)).toBe(0);
    for (const foot of feet) {
      expect(Number.isInteger(foot.x)).toBe(true);
      expect(foot.y).toBe(BUILDING_SLOT.y);
    }
    // Every pairing of slots and art: the nearer edges of neighbours do not cross.
    const placed = feet.flatMap((foot) =>
      STRUCTURES.map(([cell]) => ({ foot, cell })),
    );
    for (const left of placed) {
      for (const right of placed) {
        if (right.foot.x <= left.foot.x) continue;
        // Touching is not overlapping.
        expect(boxOf(left.cell, left.foot).right).toBeLessThanOrEqual(
          boxOf(right.cell, right.foot).left,
        );
      }
    }
  }
});

test("the view holds every actor slot, every structure at its tallest, its fire, the event rings and the strike from its impact down, for any number of buildings and actors", () => {
  let widest = 0;
  let tallest = 0;
  let deepest = 0;
  const extents: Extent[] = [];

  for (const cell of [LEGACY_CELL, GOD_TALL_CELL, MAX_ACTOR_CELL]) {
    for (let index = 0; index < MAX_ACTORS_PER_PLACE; index += 1) {
      extents.push(boxOf(cell, actorFoot(PLACE_ORIGIN, index)));
    }
  }
  // An event ring, at its largest, drawn at its offset from the place.
  const ring = {
    x: PLACE_ORIGIN.x + EVENT_RING.dx,
    y: PLACE_ORIGIN.y + EVENT_RING.dy,
  };
  extents.push({
    left: ring.x - EVENT_RING.radiusMax,
    right: ring.x + EVENT_RING.radiusMax,
    top: ring.y + EVENT_RING.radiusMax,
    bottom: ring.y - EVENT_RING.radiusMax,
  });
  for (let count = 1; count <= MAX_BUILDINGS_PER_PLACE; count += 1) {
    for (let index = 0; index < count; index += 1) {
      const foot = buildingFoot(PLACE_ORIGIN, index, count);
      for (const [cell, anchors] of STRUCTURES) {
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
  }
  extents.push(...groundBoxes());
  for (const extent of extents) {
    inside(extent);
    widest = Math.max(widest, Math.abs(extent.left), Math.abs(extent.right));
    tallest = Math.max(tallest, extent.top);
    deepest = Math.max(deepest, -extent.bottom);
  }
  // The header's arithmetic: 192 + 96 = 288 across (three buildings, a cell apart, and the 9x9 ground's 576); 80 + 79 +
  // 88 = 247 up (the fire on the oak, above the oak's own 80 + 164 = 244); 128 down (the ground's last tile, below the
  // second actor row's 81).
  expect(widest).toBe(288);
  expect(tallest).toBe(247);
  expect(deepest).toBe(128);
  // The size is not slack: the view's edge is within 8 px of the extent on every side.
  expect(VIEW.right - widest).toBeLessThan(8);
  expect(-VIEW.left - widest).toBeLessThan(8);
  expect(VIEW.top - tallest).toBeLessThan(8);
  expect(VIEW.bottom + deepest).toBeLessThan(8);
});

test("an event ring stands clear of every actor, whichever cell and slot", () => {
  const ring = EVENT_RING.dx - EVENT_RING.radiusMax;

  for (const cell of [LEGACY_CELL, GOD_TALL_CELL, MAX_ACTOR_CELL]) {
    for (let index = 0; index < MAX_ACTORS_PER_PLACE; index += 1) {
      expect(boxOf(cell, actorFoot(PLACE_ORIGIN, index)).right).toBeLessThan(
        ring,
      );
    }
  }
});

test("the highest strike's top leaves the view, and only its top", () => {
  const impact = BUILDING_SLOT.y - STRUCTURE_ANCHORS.tree.strike.y;
  const top = impact + STRIKE_CELL.pivotY;

  expect(top).toBeGreaterThan(VIEW.top);
  expect(impact).toBeLessThan(VIEW.top);
});

test("the camera is off centre to fit the content: 576x384 on the 16 px grid, from 252 above the layout origin to 132 below", () => {
  expect(LOGICAL_SIZE).toEqual({ width: 576, height: 384 });
  expect(LOGICAL_SIZE.width % 16).toBe(0);
  expect(LOGICAL_SIZE.height % 16).toBe(0);
  expect(CAMERA_ORIGIN).toEqual({ x: -288, y: -252 });
  expect(VIEW.top).toBe(252);
  expect(VIEW.bottom).toBe(-132);
});

/** The boxes of the 9x9 ground tiles in world space (y up): the shared lattice origin, moved to the layout's anchor. */
function groundBoxes(): Extent[] {
  return GROUND_POINTS.map(({ x, y }) => {
    const box = latticeOrigin(x, y);
    if (!box.ok) throw new Error(box.detail);
    // latticeOrigin is screen space (y down) from the lattice's own origin; the anchor is where lattice (0, 0) is centred.
    const left = box.value.x + GROUND_ORIGIN.x;
    const top = GROUND_ORIGIN.y - box.value.y;
    return { left, right: left + 64, top, bottom: top - 32 };
  });
}

test("the ground is the 9x9 lattice of tiles round an 8x8 grid: 576 across, 288 down, centred across the view", () => {
  expect(GROUND_POINTS).toHaveLength(81);
  const boxes = groundBoxes();
  expect(Math.min(...boxes.map((b) => b.left))).toBe(-288);
  expect(Math.max(...boxes.map((b) => b.right))).toBe(288);
  expect(
    Math.max(...boxes.map((b) => b.top)) -
      Math.min(...boxes.map((b) => b.bottom)),
  ).toBe(288);
  for (const box of boxes) inside(box);
});

/** The 8x8 grid's diamond in world space: lattice (0,0) is its top vertex, 512 across and 256 down. */
function insideGrid(point: { x: number; y: number }): boolean {
  const centre = GROUND_ORIGIN.y - 128;
  return Math.abs(point.x) / 256 + Math.abs(point.y - centre) / 128 <= 1;
}

test("buildings stand on the grid's back rows and actors on its front rows: every slot's foot is on the grid, buildings above its middle, actors below", () => {
  const middle = GROUND_ORIGIN.y - 128;
  for (let count = 1; count <= 2; count += 1) {
    for (let index = 0; index < count; index += 1) {
      const foot = buildingFoot(PLACE_ORIGIN, index, count);
      expect(insideGrid(foot), `building ${index} of ${count}`).toBe(true);
      expect(foot.y).toBeGreaterThan(middle);
    }
  }
  for (let index = 0; index < MAX_ACTORS_PER_PLACE; index += 1) {
    const foot = actorFoot(PLACE_ORIGIN, index);
    expect(insideGrid(foot), `actor ${index}`).toBe(true);
    expect(foot.y).toBeLessThan(middle);
  }
});

test("a building's foot is its slot: centred on the place, a cell apart, in one row above the actors", () => {
  const origin = { x: 100, y: 40 };

  expect(BUILDING_SLOT).toEqual({ dx: 192, y: 80 });
  expect(buildingFoot(origin, 0, 1)).toEqual({ x: 100, y: 120 });
  expect(buildingFoot(origin, 0, 2)).toEqual({ x: 4, y: 120 });
  expect(buildingFoot(origin, 1, 2)).toEqual({ x: 196, y: 120 });
  expect(buildingFoot(origin, 2, 3)).toEqual({ x: 292, y: 120 });
});

test("an actor's foot slot keeps the existing marker arithmetic", () => {
  const origin = { x: 100, y: 40 };
  expect(actorFoot(origin, 0)).toEqual({ x: 72, y: -8 });
  expect(actorFoot(origin, 6)).toEqual({ x: 144, y: -8 });
  expect(actorFoot(origin, 7)).toEqual({ x: 72, y: -23 });
  expect(ACTOR_FOOT).toEqual({ x: -28, y: -48, columns: 7, dx: 12, dy: 15 });
});

// The scene's area in the window, from the stylesheet: the workspace's side rails at their widest and the topbar and
// footer, in a 1280x720 window (the most the game's box can be; chrome only makes it smaller). The stage fills the
// column between the rails.
const CSS = readFileSync(new URL("../ui/surface.css", import.meta.url), "utf8");
const px = (pattern: RegExp): number => {
  const found = CSS.match(pattern)?.[1];
  if (found === undefined) throw new Error(`surface.css has no ${pattern}`);
  return Number(found);
};
const WINDOW = { width: 1280, height: 720 };
const SCENE_AREA = {
  width:
    WINDOW.width -
    px(
      /\.workspace\s*\{[^}]*grid-template-columns:\s*minmax\(\s*\d+px,\s*(\d+)px\s*\)/s,
    ) -
    px(/\.workspace\s*\{[^}]*\)\s*minmax\(\s*\d+px,\s*(\d+)px\s*\)\s*;/s),
  height:
    WINDOW.height -
    px(/\.topbar\s*\{[^}]*?height:\s*(\d+)px/s) -
    px(/\.bottomline\s*\{[^}]*?min-height:\s*(\d+)px/s),
};

test("the scene area is the window less the rails, topbar and footer, read from the stylesheet", () => {
  expect(SCENE_AREA).toEqual({ width: 714, height: 635 });
});

test("the target fits the scene area, so it is never cropped", () => {
  expect(LOGICAL_SIZE.width).toBeLessThanOrEqual(SCENE_AREA.width);
  expect(LOGICAL_SIZE.height).toBeLessThanOrEqual(SCENE_AREA.height);
});

test("at the default window the scene draws at zoom 1 uncropped at a device pixel ratio of 1, and at zoom 2 uncropped at 2", () => {
  for (const [ratio, zoom] of [
    [1, 1],
    [2, 2],
  ] as const) {
    const fitted = fitView(SCENE_AREA, ratio);

    expect(fitted.zoom).toBe(zoom);
    // The backing store, in device pixels, sits inside the area, so the canvas is shown whole.
    expect(fitted.metrics.backingWidth).toBeLessThanOrEqual(
      SCENE_AREA.width * ratio,
    );
    expect(fitted.metrics.backingHeight).toBeLessThanOrEqual(
      SCENE_AREA.height * ratio,
    );
    expect(fitted.left).toBeGreaterThanOrEqual(0);
    expect(fitted.top).toBeGreaterThanOrEqual(0);
    expect(fitted.metrics.cssWidth).toBe(LOGICAL_SIZE.width * (zoom / ratio));
  }
  // The next whole zoom would not fit: that is what bounds it.
  expect(LOGICAL_SIZE.width * 2).toBeGreaterThan(SCENE_AREA.width);
  expect(LOGICAL_SIZE.width * 3).toBeGreaterThan(SCENE_AREA.width * 2);
});

test("zoom is the largest whole number that fits the canvas, never below 1", () => {
  const fit = (width: number, height: number, ratio = 1) =>
    fitView({ width, height }, ratio);

  expect(fit(576, 384).zoom).toBe(1);
  expect(fit(1151, 767, 1).zoom).toBe(1);
  expect(fit(1152, 768, 1).zoom).toBe(2);
  expect(fit(1152, 767, 1).zoom).toBe(1);
  expect(fit(5000, 1200, 1).zoom).toBe(3);
  expect(fit(10, 10).zoom).toBe(1);
  expect(fit(0, 0).zoom).toBe(1);
  // The canvas is measured in device pixels: a 1000x1000 CSS box at 2x is 2000x2000.
  expect(fit(1000, 1000, 2).zoom).toBe(3);
});

test("a box too small for the target crops it rather than scaling it fractionally", () => {
  const fitted = fitView({ width: 500, height: 300 }, 1);

  expect(fitted.zoom).toBe(1);
  expect(fitted.left).toBe(-38);
  expect(fitted.top).toBe(-42);
});

test("the backing store is exactly logical size x zoom and the CSS box is that over the pixel ratio", () => {
  const fitted = fitView({ width: 576, height: 384 }, 2);

  expect(fitted.metrics).toEqual(canvasMetrics(LOGICAL_SIZE, 2, 2));
  expect(fitted.metrics.backingWidth).toBe(1152);
  expect(fitted.metrics.backingHeight).toBe(768);
  expect(fitted.metrics.cssWidth).toBe(576);
  expect(fitted.metrics.cssHeight).toBe(384);
});

test("the canvas is centred on a whole device pixel", () => {
  const fitted = fitView({ width: 581, height: 389 }, 2);

  // 1162x778 device pixels hold 1152x768: 10 spare on each axis, 5 on each side.
  expect(fitted.left).toBe(5 / 2);
  expect(fitted.top).toBe(5 / 2);
  expect(Number.isInteger(fitted.left * 2)).toBe(true);
  expect(Number.isInteger(fitted.top * 2)).toBe(true);
});
