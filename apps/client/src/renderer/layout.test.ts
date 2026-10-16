import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  bottomVertex,
  canvasMetrics,
  depthOf,
  latticeOrigin,
  STRUCTURE_ANCHORS,
  STRUCTURE_FOOTPRINTS,
  STRUCTURE_PIVOTS,
} from "@panthea/renderer";

import { type ArtBox, artBox } from "../../test/art-extents";
import {
  FIRE_ATLAS_BYTES,
  FIRE_MANIFEST_TEXT,
  HOUSE_ATLAS_BYTES,
  HOUSE_MANIFEST_TEXT,
  OAK_ATLAS_BYTES,
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
  // The house's foot is the plinth's lowest point, (65, 181); the oak's is its trunk.
  expect(BUILDING_CELL).toEqual({
    width: 192,
    height: 192,
    pivotX: 65,
    pivotY: 181,
  });
  expect({ x: BUILDING_CELL.pivotX, y: BUILDING_CELL.pivotY }).toEqual(
    STRUCTURE_PIVOTS.building,
  );
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
    building: { w: 2, h: 3 },
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

/**
 * Where a structure touches the ground, as a predicate on a point of the grid (cell units: x down-right, y down-left,
 * the cell (X, Y) the square [X, X + 1] x [Y, Y + 1]), for a structure whose footprint's bottom cell is (X, Y). The
 * foot stands on that cell's bottom vertex, (X + 1, Y + 1).
 *  - The house is the plinth of render.py's `House`: a 4.5 by 3.5 m slab on its centre, the porch's two slabs
 *    (2.8 m wide, from the slab's front 0.1 m inside it to 2.9 m) and the step (1.5 m wide, 2.95 to 3.35 m), with
 *    the foot on the porch's front corner (1.4, 2.9) m. A tile is 1.556 m (32 sqrt(2) / 29.0788 pixels per metre).
 *  - The oak is the root flare round the trunk, which the foot stands on: a disc of 0.9 tile (the roots reach 39 px
 *    each side, 1.34 m).
 */
const TILE_M = (32 * Math.SQRT2) / 29.0788;
function contactOf(art: "building" | "tree", cell: GridCell) {
  const [fx, fy] = [cell.x + 1, cell.y + 1];
  if (art === "tree")
    return (gx: number, gy: number) =>
      (gx - fx) ** 2 + (gy - fy) ** 2 <= 0.9 ** 2;
  return (gx: number, gy: number) => {
    const x = 1.4 + (gx - fx) * TILE_M;
    const y = 2.9 + (gy - fy) * TILE_M;
    return (
      (Math.abs(x) <= 2.25 && Math.abs(y) <= 1.75) ||
      (Math.abs(x) <= 1.4 && y >= 1.4 && y <= 2.9) ||
      (Math.abs(x) <= 0.75 && y >= 2.95 && y <= 3.35)
    );
  };
}

/** The sampled points of a contact region, across the grid and a half tile beyond it. */
function contactPoints(art: "building" | "tree", cell: GridCell): Set<string> {
  const inside = contactOf(art, cell);
  const points = new Set<string>();
  for (let i = -20; i <= 180; i += 1)
    for (let j = -20; j <= 180; j += 1)
      if (inside(i / 20, j / 20)) points.add(`${i},${j}`);
  return points;
}

/** The cells of a cell-square a contact region touches, by its sampled points. */
function touches(points: ReadonlySet<string>, cell: GridCell): boolean {
  for (let i = cell.x * 20; i <= (cell.x + 1) * 20; i += 1)
    for (let j = cell.y * 20; j <= (cell.y + 1) * 20; j += 1)
      if (points.has(`${i},${j}`)) return true;
  return false;
}

test("buildings stand in the back rows: every footprint cell is on the back half (depth 7 or less), the feet are on or just below the middle, and one building's is above it", () => {
  expect(BUILDING_SLOTS).toHaveLength(MAX_BUILDINGS_PER_PLACE);
  for (let count = 1; count <= MAX_BUILDINGS_PER_PLACE; count += 1) {
    expect(BUILDING_SLOTS[count - 1]).toHaveLength(count);
    for (let index = 0; index < count; index += 1) {
      const bottom = buildingCell(index, count) as GridCell;
      const foot = cellFoot(bottom);
      // The house's footprint, the larger, reaches back from the foot's cell; none of it is past the middle rows.
      for (const cell of coveredBy(bottom, "building"))
        expect(depthAt(cell), `${index} of ${count}`).toBeLessThanOrEqual(7);
      // The foot is the cell's bottom vertex, so at depth 7 it is on the row below the middle: 15 px down.
      expect(foot.y, `${index} of ${count}`).toBeGreaterThanOrEqual(-15);
    }
  }
  expect(cellFoot(buildingCell(0, 1) as GridCell).y).toBeGreaterThan(0);
});

test("the structures of one place never overlap: for any mix of house and oak in any slots, the footprints are on the grid and disjoint, and so is the ground each touches", () => {
  for (let count = 1; count <= MAX_BUILDINGS_PER_PLACE; count += 1) {
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
      const grounds: Set<string>[] = [];
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
        const ground = contactPoints(art, bottom);
        // The ground it touches lies on the ground drawn: the grid and the half tile round it.
        for (const point of ground) {
          const [i, j] = point.split(",").map(Number) as [number, number];
          expect(i, `${art} ${index}/${count}`).toBeGreaterThanOrEqual(-10);
          expect(j).toBeGreaterThanOrEqual(-10);
          expect(i).toBeLessThanOrEqual(170);
          expect(j).toBeLessThanOrEqual(170);
        }
        for (const other of grounds)
          for (const point of ground)
            expect(
              other.has(point),
              `${art} ${index}/${count} touches another's ground`,
            ).toBe(false);
        grounds.push(ground);
      }
    }
  }
  // Past the table there is no slot, and a count past it has none either.
  expect(
    buildingCell(MAX_BUILDINGS_PER_PLACE, MAX_BUILDINGS_PER_PLACE),
  ).toBeUndefined();
  expect(buildingCell(0, MAX_BUILDINGS_PER_PLACE + 1)).toBeUndefined();
});

/**
 * The box each structure's art covers, in pixels from its foot (y up): the opaque extents of every frame of every state,
 * from the published atlases, not the 192x192 cells. The house's also holds its fire, which stands on the roof.
 */
const ART_BOX: Record<keyof typeof FOOTPRINT_OF, ArtBox> = (() => {
  const house = artBox(HOUSE_MANIFEST_TEXT, HOUSE_ATLAS_BYTES);
  const fire = artBox(FIRE_MANIFEST_TEXT, FIRE_ATLAS_BYTES);
  const anchor = STRUCTURE_ANCHORS.building.fire;
  // The fire's pivot is on the anchor, which is an offset down the screen from the foot.
  const fireRight = anchor.x + fire.right;
  const fireLeft = fire.left - anchor.x;
  const fireTop = -anchor.y + fire.up;
  return {
    building: {
      left: Math.max(house.left, fireLeft),
      right: Math.max(house.right, fireRight),
      up: Math.max(house.up, fireTop),
      down: house.down,
    },
    tree: artBox(OAK_MANIFEST_TEXT, OAK_ATLAS_BYTES),
  };
})();

/** The box of `art` standing on `cell`, in world space (y up): left, right, top, bottom. */
function artBoxAt(art: keyof typeof FOOTPRINT_OF, cell: GridCell): Extent {
  const foot = cellFoot(cell);
  const box = ART_BOX[art];
  return {
    left: foot.x - box.left,
    right: foot.x + box.right,
    top: foot.y + box.up,
    bottom: foot.y - box.down,
  };
}

/** The clear space between two boxes, in pixels: positive when apart, the larger of the two axes' gaps. */
function gapBetween(a: Extent, b: Extent): number {
  return Math.max(
    Math.max(a.left - b.right, b.left - a.right),
    Math.max(a.bottom - b.top, b.bottom - a.top),
  );
}

/** Every way the buildings of a place can be house or oak. */
function mixes(count: number): (keyof typeof FOOTPRINT_OF)[][] {
  const all: (keyof typeof FOOTPRINT_OF)[][] = [[]];
  for (let i = 0; i < count; i += 1)
    for (const so_far of all.splice(0))
      all.push([...so_far, "building"], [...so_far, "tree"]);
  return all;
}

/** The least clear space between any two buildings of a table's slots, over every mix of house and oak. */
function tightestGap(count: number): number {
  let tightest = Number.POSITIVE_INFINITY;
  for (const mix of mixes(count))
    for (let i = 0; i < count; i += 1)
      for (let j = i + 1; j < count; j += 1)
        tightest = Math.min(
          tightest,
          gapBetween(
            artBoxAt(
              mix[i] as keyof typeof FOOTPRINT_OF,
              buildingCell(i, count) as GridCell,
            ),
            artBoxAt(
              mix[j] as keyof typeof FOOTPRINT_OF,
              buildingCell(j, count) as GridCell,
            ),
          ),
        );
  return tightest;
}

/** Ground to leave visible between two buildings' art: a house's wall is 8 px of plinth and its steps and a tile is 32 px wide. */
const VISIBLE_GROUND = 16;

test("the art of two buildings of one place never touches: every mix of house and oak in the 1- and 2-building tables leaves visible ground between their boxes", () => {
  // The boxes are the published art's opaque extents: the house reaches 59 left and 119 right of its foot, 164 up and,
  // with its fire, 186; the oak 86 left, 81 right and 156 up.
  expect(ART_BOX.building).toEqual({ left: 59, right: 119, up: 186, down: 0 });
  expect(ART_BOX.tree).toEqual({ left: 86, right: 81, up: 156, down: 21 });
  expect(tightestGap(1)).toBe(Number.POSITIVE_INFINITY);
  for (const count of [2]) {
    for (const mix of mixes(count)) {
      const a = artBoxAt(
        mix[0] as keyof typeof FOOTPRINT_OF,
        buildingCell(0, count) as GridCell,
      );
      const b = artBoxAt(
        mix[1] as keyof typeof FOOTPRINT_OF,
        buildingCell(1, count) as GridCell,
      );
      expect(gapBetween(a, b), mix.join("+")).toBeGreaterThanOrEqual(
        VISIBLE_GROUND,
      );
    }
  }
  // The arithmetic: the slots are a house apart along the screen's x, 256 px, and the widest pairing, a house on the left
  // and an oak on the right, needs 119 + 86 = 205: 51 px of ground.
  expect(tightestGap(2)).toBe(51);
});

test("three buildings do not fit apart on an 8x8 grid: of every three house footprints on it, two have art boxes that overlap, so the 3-building table is the best that grid allows", () => {
  // A house's box is 178 px wide and the feet of any two cells are 32 px per step of x - y apart, over 13 steps at most.
  const cells: GridCell[] = [];
  for (let x = 1; x < GRID_SIZE; x += 1)
    for (let y = 2; y < GRID_SIZE; y += 1) cells.push({ x, y });
  let apart = 0;
  for (let i = 0; i < cells.length; i += 1)
    for (let j = i + 1; j < cells.length; j += 1)
      for (let k = j + 1; k < cells.length; k += 1) {
        const boxes = [cells[i], cells[j], cells[k]].map((c) =>
          artBoxAt("building", c as GridCell),
        );
        if (
          gapBetween(boxes[0] as Extent, boxes[1] as Extent) > 0 &&
          gapBetween(boxes[0] as Extent, boxes[2] as Extent) > 0 &&
          gapBetween(boxes[1] as Extent, boxes[2] as Extent) > 0
        )
          apart += 1;
      }
  expect(apart).toBe(0);
  // The table's own overlap is bounded, and it is the footprints and the ground each touches, checked above, that stay apart.
  expect(tightestGap(3)).toBeGreaterThanOrEqual(-120);
});

test("actors fill the front rows: the 14 cells are the front tip's, depth 10 to 14, one to a cell, none of them on any building's footprint or on the ground it touches", () => {
  expect(ACTOR_CELLS).toHaveLength(MAX_ACTORS_PER_PLACE);
  expect(new Set(ACTOR_CELLS.map(cellKey)).size).toBe(MAX_ACTORS_PER_PLACE);
  // Rows of 4, 4, 3, 2 and 1 from depth 10 to 14: every front cell but the far right of the row of depth 10.
  const front = GRID_CELLS.filter(
    (c) => depthAt(c) >= 10 && !(c.x === 7 && c.y === 3),
  );
  expect(new Set(ACTOR_CELLS.map(cellKey))).toEqual(
    new Set(front.map(cellKey)),
  );
  expect(
    [10, 11, 12, 13, 14].map(
      (d) => ACTOR_CELLS.filter((c) => depthAt(c) === d).length,
    ),
  ).toEqual([4, 4, 3, 2, 1]);

  const footprints = new Set<string>();
  const grounds: Set<string>[] = [];
  for (let count = 1; count <= MAX_BUILDINGS_PER_PLACE; count += 1)
    for (let index = 0; index < count; index += 1) {
      const bottom = buildingCell(index, count) as GridCell;
      for (const art of ["building", "tree"] as const) {
        for (const cell of coveredBy(bottom, art))
          footprints.add(cellKey(cell));
        grounds.push(contactPoints(art, bottom));
      }
    }
  for (const [index, cell] of ACTOR_CELLS.entries()) {
    expect(actorCell(index)).toEqual(cell);
    expect(cell.x).toBeGreaterThanOrEqual(0);
    expect(cell.y).toBeGreaterThanOrEqual(0);
    expect(cell.x).toBeLessThan(GRID_SIZE);
    expect(cell.y).toBeLessThan(GRID_SIZE);
    expect(footprints.has(cellKey(cell)), `actor ${index} on a footprint`).toBe(
      false,
    );
    for (const ground of grounds)
      expect(
        touches(ground, cell),
        `actor ${index} on a building's ground`,
      ).toBe(false);
    // The front half of the diamond, below its middle row, well clear of it.
    expect(cellCentre(cell).y, `actor ${index}`).toBeLessThanOrEqual(-48);
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
  // The arithmetic: 288 across, the ground's 9x9 lattice (512 + 64); 223 up, a burning house's fire: the highest
  // foot is the third building's, 33 above the origin, its fire's pivot is 102 above that, its cell 88 tall;
  // 145 down, the front tip's actor cell: its foot is 127 below the origin and the tall cell reaches 18 below it (the
  // ground's last tile ends at -144).
  expect(widest).toBe(288);
  expect(tallest).toBe(223);
  expect(deepest).toBe(145);
  // The size is not slack: the view's edge is within 12 px of the extent on every side.
  expect(VIEW.right - widest).toBeLessThan(12);
  expect(-VIEW.left - widest).toBeLessThan(12);
  expect(VIEW.top - tallest).toBeLessThan(12);
  expect(-VIEW.bottom - deepest).toBeLessThan(12);
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
  const impact = foot.y - STRUCTURE_ANCHORS.building.strike.y;
  const top = impact + STRIKE_CELL.pivotY;

  expect(top).toBeGreaterThan(VIEW.top);
  expect(impact).toBeLessThan(VIEW.top);
});

test("the camera is off centre to fit the content: 576x384 on the 16 px grid, from 231 above the world origin to 153 below", () => {
  expect(LOGICAL_SIZE).toEqual({ width: 576, height: 384 });
  expect(LOGICAL_SIZE.width % 16).toBe(0);
  expect(LOGICAL_SIZE.height % 16).toBe(0);
  expect(CAMERA_ORIGIN).toEqual({ x: -288, y: -231 });
  expect(VIEW.top).toBe(231);
  expect(VIEW.bottom).toBe(-153);
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

  expect(fit(576, 384).zoom).toBe(1);
  expect(fit(1151, 767, 1).zoom).toBe(1);
  expect(fit(1152, 768, 1).zoom).toBe(2);
  expect(fit(1152, 767, 1).zoom).toBe(1);
  expect(fit(5000, 1151, 1).zoom).toBe(2);
  expect(fit(5000, 1152, 1).zoom).toBe(3);
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
