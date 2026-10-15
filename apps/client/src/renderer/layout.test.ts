import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  bottomVertex,
  canvasMetrics,
  depthOf,
  latticeOrigin,
  STRUCTURE_ANCHORS,
  STRUCTURE_FOOTPRINTS,
} from "@panthea/renderer";

import {
  FIRE_MANIFEST_TEXT,
  HOUSE_MANIFEST_TEXT,
  OAK_MANIFEST_TEXT,
  STRIKE_MANIFEST_TEXT,
} from "../../test/structure-fixture";
import {
  ACTOR_CELLS,
  actorCell,
  BUILDING_SLOTS,
  buildingCell,
  CAMERA_ORIGIN,
  cellCentre,
  cellFoot,
  EVENT_RING,
  fitView,
  GRID_ORIGIN,
  GRID_SIZE,
  GROUND_POINTS,
  type GridCell,
  LOGICAL_SIZE,
  MAX_ACTOR_CELL,
  MAX_ACTORS_PER_PLACE,
  MAX_BUILDINGS_PER_PLACE,
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
  readonly footprint: { readonly w: number; readonly h: number };
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
  ["building", BUILDING_CELL, STRUCTURE_ANCHORS.building],
  ["tree", TREE_CELL, STRUCTURE_ANCHORS.tree],
] as const;

const FOOTPRINT_OF = {
  building: cellFootprintOf(HOUSE_MANIFEST_TEXT),
  tree: cellFootprintOf(OAK_MANIFEST_TEXT),
};

function cellFootprintOf(text: string) {
  return (JSON.parse(text) as Manifest).footprint;
}

test("the footprints the layout reserves are the ones the published art declares", () => {
  expect(FOOTPRINT_OF).toEqual(STRUCTURE_FOOTPRINTS);
  expect(FOOTPRINT_OF).toEqual({
    building: { w: 4, h: 3 },
    tree: { w: 1, h: 1 },
  });
});

// --- the grid ------------------------------------------------------------------------------------------------------

const GRID_CELLS: GridCell[] = Array.from(
  { length: GRID_SIZE * GRID_SIZE },
  (_, i) => ({ x: i % GRID_SIZE, y: Math.floor(i / GRID_SIZE) }),
);

const cellKey = (cell: GridCell) => `${cell.x},${cell.y}`;

/** The cells a footprint with its bottom cell at `bottom` covers: it extends back (towards smaller x and y). */
function coveredBy(
  bottom: GridCell,
  art: keyof typeof FOOTPRINT_OF,
): GridCell[] {
  const { w, h } = FOOTPRINT_OF[art];
  const cells: GridCell[] = [];
  for (let x = bottom.x - w + 1; x <= bottom.x; x += 1)
    for (let y = bottom.y - h + 1; y <= bottom.y; y += 1) cells.push({ x, y });
  return cells;
}

const depthAt = (cell: GridCell) => cell.x + cell.y;

test("the grid is 8x8 and the world origin is its centre: lattice point (0, 0), its top vertex, is 128 above it", () => {
  expect(GRID_SIZE).toBe(8);
  expect(GRID_ORIGIN).toEqual({ x: 0, y: 128 });
  // The grid's four corners, in world space: the ground diamond is 512 across and 256 down round the origin.
  expect(cellCentre({ x: 0, y: 0 })).toEqual({ x: 0, y: 112 });
  expect(cellCentre({ x: 7, y: 7 })).toEqual({ x: 0, y: -112 });
  expect(cellCentre({ x: 7, y: 0 })).toEqual({ x: 224, y: 0 });
  expect(cellCentre({ x: 0, y: 7 })).toEqual({ x: -224, y: 0 });
});

test("a cell's foot is the bottom vertex of its diamond, in world space, by the shared projection", () => {
  for (const cell of GRID_CELLS) {
    const vertex = bottomVertex({ ...cell, z: 0 });
    if (!vertex.ok) throw new Error(vertex.detail);
    expect(cellFoot(cell)).toEqual({
      x: vertex.value.x + GRID_ORIGIN.x,
      y: GRID_ORIGIN.y - vertex.value.y,
    });
  }
  // The diamond's bottom vertex is 15 px below its centre: the 31 px diamond sits in the cell's 32 px row.
  expect(cellFoot({ x: 4, y: 4 }).y).toBe(cellCentre({ x: 4, y: 4 }).y - 15);
});

test("buildings stand in the back rows: every slot's footprint, for any art, lies on the grid, and none overlaps another's", () => {
  expect(BUILDING_SLOTS).toHaveLength(MAX_BUILDINGS_PER_PLACE);
  for (let count = 1; count <= MAX_BUILDINGS_PER_PLACE; count += 1) {
    expect(BUILDING_SLOTS[count - 1]).toHaveLength(count);
    // Every pairing of art over the slots, so a house in one and an oak in another.
    const arts: (keyof typeof FOOTPRINT_OF)[][] = [];
    const walk = (so_far: (keyof typeof FOOTPRINT_OF)[]) => {
      if (so_far.length === count) {
        arts.push(so_far);
        return;
      }
      walk([...so_far, "building"]);
      walk([...so_far, "tree"]);
    };
    walk([]);
    for (const choice of arts) {
      const taken = new Set<string>();
      for (const [index, art] of choice.entries()) {
        const bottom = buildingCell(index, count);
        if (bottom === undefined)
          throw new Error(`no slot ${index} of ${count}`);
        for (const cell of coveredBy(bottom, art)) {
          expect(cell.x, `${art} ${index}/${count}`).toBeGreaterThanOrEqual(0);
          expect(cell.y).toBeGreaterThanOrEqual(0);
          expect(cell.x).toBeLessThan(GRID_SIZE);
          expect(cell.y).toBeLessThan(GRID_SIZE);
          expect(
            taken.has(cellKey(cell)),
            `${art} ${index}/${count} overlaps at ${cellKey(cell)}`,
          ).toBe(false);
          taken.add(cellKey(cell));
        }
      }
    }
  }
  // Past the table there is no slot, and a count past it has none either.
  expect(
    buildingCell(MAX_BUILDINGS_PER_PLACE, MAX_BUILDINGS_PER_PLACE),
  ).toBeUndefined();
  expect(buildingCell(0, MAX_BUILDINGS_PER_PLACE + 1)).toBeUndefined();
});

test("actors stand in the front rows, one to a cell: 14 distinct cells on the grid, none on any building's footprint, none in front of the first row of buildings", () => {
  expect(ACTOR_CELLS).toHaveLength(MAX_ACTORS_PER_PLACE);
  expect(new Set(ACTOR_CELLS.map(cellKey)).size).toBe(MAX_ACTORS_PER_PLACE);
  const footprints = new Set<string>();
  let deepestBuilding = -Infinity;
  for (let count = 1; count <= MAX_BUILDINGS_PER_PLACE; count += 1)
    for (let index = 0; index < count; index += 1) {
      const bottom = buildingCell(index, count) as GridCell;
      deepestBuilding = Math.max(deepestBuilding, depthAt(bottom));
      for (const cell of coveredBy(bottom, "building"))
        footprints.add(cellKey(cell));
    }
  for (const [index, cell] of ACTOR_CELLS.entries()) {
    expect(actorCell(index)).toEqual(cell);
    expect(cell.x).toBeGreaterThanOrEqual(0);
    expect(cell.y).toBeGreaterThanOrEqual(0);
    expect(cell.x).toBeLessThan(GRID_SIZE);
    expect(cell.y).toBeLessThan(GRID_SIZE);
    expect(footprints.has(cellKey(cell)), `actor ${index} on a house`).toBe(
      false,
    );
    // The front half of the diamond: below its middle row.
    expect(cellCentre(cell).y, `actor ${index}`).toBeLessThan(0);
    // Not behind the deepest building's bottom cell: depth sorts them in front of it.
    expect(depthAt(cell), `actor ${index}`).toBeGreaterThanOrEqual(
      deepestBuilding,
    );
  }
  expect(actorCell(MAX_ACTORS_PER_PLACE)).toBeUndefined();
  expect(actorCell(-1)).toBeUndefined();
});

test("no two actors' 16x16 cells overlap, wherever their cells are", () => {
  const boxes = ACTOR_CELLS.map((cell) => {
    const foot = cellFoot(cell);
    return {
      left: foot.x - 8,
      right: foot.x + 8,
      top: foot.y + 16,
      bottom: foot.y,
    };
  });
  for (const [a, boxA] of boxes.entries())
    for (const [b, boxB] of boxes.entries()) {
      if (b <= a) continue;
      const apart =
        boxA.right <= boxB.left ||
        boxB.right <= boxA.left ||
        boxA.bottom >= boxB.top ||
        boxB.bottom >= boxA.top;
      expect(apart, `actors ${a} and ${b}`).toBe(true);
    }
});

test("the first two actor cells stand side by side on one screen row, 64 px apart and centred, so two gods stand beside each other", () => {
  const [first, second] = [
    cellFoot(ACTOR_CELLS[0] as GridCell),
    cellFoot(ACTOR_CELLS[1] as GridCell),
  ];
  expect(first.y).toBe(second.y);
  expect(second.x - first.x).toBe(64);
  expect(first.x + second.x).toBe(0);
});

test("the view holds the ground, every actor slot, every structure at its tallest, its fire, the event ring and the strike from its impact down, for any number of buildings and actors", () => {
  let widest = 0;
  let tallest = 0;
  let deepest = 0;
  const extents: Extent[] = [];

  // The ground: the 9x9 lattice of 64x32 boxes, centred on the lattice points' screen positions.
  for (const { x, y } of GROUND_POINTS) {
    const box = latticeOrigin(x, y);
    if (!box.ok) throw new Error(box.detail);
    const left = box.value.x + GRID_ORIGIN.x;
    const top = GRID_ORIGIN.y - box.value.y;
    extents.push({ left, right: left + 64, top, bottom: top - 32 });
  }
  for (const cell of [LEGACY_CELL, GOD_TALL_CELL, MAX_ACTOR_CELL])
    for (let index = 0; index < MAX_ACTORS_PER_PLACE; index += 1)
      extents.push(boxOf(cell, cellFoot(actorCell(index) as GridCell)));
  // An event ring, at its largest, centred on its cell.
  const ring = cellCentre(EVENT_RING.cell);
  extents.push({
    left: ring.x - EVENT_RING.radiusMax,
    right: ring.x + EVENT_RING.radiusMax,
    top: ring.y + EVENT_RING.radiusMax,
    bottom: ring.y - EVENT_RING.radiusMax,
  });
  for (let count = 1; count <= MAX_BUILDINGS_PER_PLACE; count += 1) {
    for (let index = 0; index < count; index += 1) {
      const foot = cellFoot(buildingCell(index, count) as GridCell);
      for (const [, cell, anchors] of STRUCTURES) {
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
  for (const extent of extents) {
    inside(extent);
    widest = Math.max(widest, Math.abs(extent.left), Math.abs(extent.right));
    tallest = Math.max(tallest, extent.top);
    deepest = Math.max(deepest, -extent.bottom);
  }
  // The arithmetic: 288 across, the ground's 9x9 lattice (512 + 64); 184 up, the oak's fire: the oak stands in the
  // slot (3, 2), whose foot is 17 above the origin, and its fire's pivot is 79 above that, its cell 88 tall;
  // 144 down, the ground's last tile (the lowest actor's cell ends at 97, the lowest house at 103).
  expect(widest).toBe(288);
  expect(tallest).toBe(184);
  expect(deepest).toBe(144);
  // The size is not slack: the view's edge is within 8 px of the extent on every side.
  expect(VIEW.right - widest).toBeLessThan(8);
  expect(-VIEW.left - widest).toBeLessThan(8);
  expect(VIEW.top - tallest).toBeLessThan(8);
  expect(-VIEW.bottom - deepest).toBeLessThan(8);
  expect(VIEW.top - tallest).toBeGreaterThanOrEqual(0);
  expect(-VIEW.bottom - deepest).toBeGreaterThanOrEqual(0);
});

test("an event ring stands clear of every actor's cell, whichever cell and slot", () => {
  const ring = cellCentre(EVENT_RING.cell);
  for (const cell of [LEGACY_CELL, GOD_TALL_CELL, MAX_ACTOR_CELL]) {
    for (let index = 0; index < MAX_ACTORS_PER_PLACE; index += 1) {
      const box = boxOf(cell, cellFoot(actorCell(index) as GridCell));
      const apart =
        box.right <= ring.x - EVENT_RING.radiusMax ||
        box.left >= ring.x + EVENT_RING.radiusMax ||
        box.top <= ring.y - EVENT_RING.radiusMax ||
        box.bottom >= ring.y + EVENT_RING.radiusMax;
      expect(apart, `slot ${index}`).toBe(true);
    }
  }
});

test("the highest strike's top leaves the view, and only its top", () => {
  const foot = cellFoot(buildingCell(0, 1) as GridCell);
  const impact = foot.y - STRUCTURE_ANCHORS.tree.strike.y;
  const top = impact + STRIKE_CELL.pivotY;

  expect(top).toBeGreaterThan(VIEW.top);
  expect(impact).toBeLessThan(VIEW.top);
});

test("the camera is off centre to fit the content: 576x336 on the 16 px grid, from 188 above the world origin to 148 below", () => {
  expect(LOGICAL_SIZE).toEqual({ width: 576, height: 336 });
  expect(LOGICAL_SIZE.width % 16).toBe(0);
  expect(LOGICAL_SIZE.height % 16).toBe(0);
  expect(CAMERA_ORIGIN).toEqual({ x: -288, y: -188 });
  expect(VIEW.top).toBe(188);
  expect(VIEW.bottom).toBe(-148);
});

test("a building's depth is the depth of its bottom cell, so an actor in a cell of greater x + y draws in front of it, and one of less behind", () => {
  for (let count = 1; count <= MAX_BUILDINGS_PER_PLACE; count += 1)
    for (let index = 0; index < count; index += 1) {
      const bottom = buildingCell(index, count) as GridCell;
      const origin = {
        x: bottom.x - FOOTPRINT_OF.building.w + 1,
        y: bottom.y - FOOTPRINT_OF.building.h + 1,
        z: 0,
      };
      const depth = depthOf(origin, FOOTPRINT_OF.building);
      if (!depth.ok) throw new Error(depth.detail);
      expect(depth.value).toBe(depthAt(bottom));
    }
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

  expect(fit(576, 336).zoom).toBe(1);
  expect(fit(1151, 671, 1).zoom).toBe(1);
  expect(fit(1152, 672, 1).zoom).toBe(2);
  expect(fit(1152, 671, 1).zoom).toBe(1);
  expect(fit(5000, 1100, 1).zoom).toBe(3);
  expect(fit(10, 10).zoom).toBe(1);
  expect(fit(0, 0).zoom).toBe(1);
  // The canvas is measured in device pixels: a 1000x1000 CSS box at 2x is 2000x2000.
  expect(fit(1000, 1000, 2).zoom).toBe(3);
});

test("a box too small for the target crops it rather than scaling it fractionally", () => {
  const fitted = fitView({ width: 500, height: 300 }, 1);

  expect(fitted.zoom).toBe(1);
  expect(fitted.left).toBe(-38);
  expect(fitted.top).toBe(-18);
});

test("the backing store is exactly logical size x zoom and the CSS box is that over the pixel ratio", () => {
  const fitted = fitView({ width: 576, height: 336 }, 2);

  expect(fitted.metrics).toEqual(canvasMetrics(LOGICAL_SIZE, 2, 2));
  expect(fitted.metrics.backingWidth).toBe(1152);
  expect(fitted.metrics.backingHeight).toBe(672);
  expect(fitted.metrics.cssWidth).toBe(576);
  expect(fitted.metrics.cssHeight).toBe(336);
});

test("the canvas is centred on a whole device pixel", () => {
  const fitted = fitView({ width: 581, height: 341 }, 2);

  // 1162x682 device pixels hold 1152x672: 10 spare on each axis, 5 on each side.
  expect(fitted.left).toBe(5 / 2);
  expect(fitted.top).toBe(5 / 2);
  expect(Number.isInteger(fitted.left * 2)).toBe(true);
  expect(Number.isInteger(fitted.top * 2)).toBe(true);
});
