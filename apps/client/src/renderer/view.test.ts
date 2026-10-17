// The game's renderer driven end to end on the software backend, and read back in canvas pixels: the whole mapping from
// the layout's world space through the camera the renderer sets (CAMERA_ORIGIN) to the target's pixels. The scene tests
// read sprite positions in world space; these read where the pixels actually land, so a camera that is ignored, or a
// layout that lies outside it, shows up here as a ground or a figure in the wrong place or not on the canvas at all.

import { afterEach, expect, test } from "bun:test";
import type { Realm } from "@panthea/contracts";
import { decodeFixture, fakeSource, indexText } from "../../test/canon-fixture";
import { softBackend } from "../../test/soft-backend";
import { tilePayload } from "../../test/tile-fixture";
import { PLACE, viewWithZeus } from "../../test/view-fixture";
import {
  COMMITTED_CANON_ATLASES,
  committedCanonPayload,
} from "../../test/zeus-retro-fixture";
import { type CanonProblem, createCanonClient } from "../assets/canon";
import { createObserver, followedPlace } from "../observer";
import type { WorldViewModel } from "../store";
import { BACKGROUND } from "./decor";
import {
  actorCell,
  buildingCell,
  CAMERA_ORIGIN,
  cellFoot,
  type GridCell,
  LOGICAL_SIZE,
  MAX_ACTORS_PER_PLACE,
} from "./layout";
import { createWorldRenderer, type WorldRenderer } from "./scene";

const mounted: WorldRenderer[] = [];
afterEach(() => {
  for (const renderer of mounted.splice(0)) renderer.dispose();
});

/** The committed canon (houses, oaks, fire, Zeus) and the tile set, as one registry the shell would hand over. */
function registry() {
  const tile = tilePayload();
  const committed = committedCanonPayload();
  return {
    payload: {
      ...committed,
      // The index lists assets sorted by id, as the registry writes it.
      index: indexText(
        [
          ...JSON.parse(committed.index ?? "{}").entries,
          ...JSON.parse(tile.payload.index ?? "{}").entries,
        ].sort((a, b) => (a.assetId < b.assetId ? -1 : 1)),
      ),
      manifests: [...committed.manifests, ...tile.payload.manifests],
    },
    atlases: new Map([...COMMITTED_CANON_ATLASES, ...tile.atlases]),
  };
}

interface Painted {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** Draws `place` of `realm` through the game's renderer at the game's own camera, and reads the target back. */
async function paint(
  view: WorldViewModel,
  realm: Realm,
  place: string,
): Promise<Painted> {
  const { payload, atlases } = registry();
  const problems: CanonProblem[] = [];
  const canon = createCanonClient({
    source: fakeSource(payload, atlases),
    onProblem: (problem) => problems.push(problem),
  });
  const backend = softBackend({ size: LOGICAL_SIZE, background: BACKGROUND });
  const renderer = createWorldRenderer(
    { width: 0, height: 0, style: {} } as unknown as HTMLCanvasElement,
    {
      canon,
      createBackend: () => backend,
      decode: decodeFixture,
      devicePixelRatio: () => 1,
      available: () => ({ width: 714, height: 635 }),
    },
  );
  mounted.push(renderer);
  await renderer.start(() => {});
  await renderer.draw(view, realm, place);
  // A registry or art problem would draw a placeholder or bare ground, and read as a layout fault below.
  expect(problems).toEqual([]);
  return backend.readRenderTarget();
}

const SQUARE_ROWS = [
  "ggggfggg",
  "gfffffgg",
  "gffffffg",
  "ffffffff",
  "gffffffg",
  "gffffffg",
  "gfffffgg",
  "ggggfggg",
];

const withTerrain = () =>
  viewWithZeus({
    terrain: { [PLACE.mortal]: { set: "grass-flagstone", rows: SQUARE_ROWS } },
  });

/** A view with the place's buildings and actors taken away: the bare ground. */
function ground(view: WorldViewModel, realm: Realm, place: string) {
  return {
    ...view,
    realms: {
      ...view.realms,
      [realm]: view.realms[realm].map((l) =>
        l.id === place ? { ...l, buildings: [], actors: [] } : l,
      ),
    },
  };
}

const at = (p: Painted, x: number, y: number): readonly number[] => {
  const i = (y * p.width + x) * 4;
  return [p.data[i] ?? 0, p.data[i + 1] ?? 0, p.data[i + 2] ?? 0];
};
const isBackground = (p: Painted, x: number, y: number) =>
  at(p, x, y).every((c, k) => c === BACKGROUND[k]);

/** The smallest box holding every pixel that is not the background, or the pixels that differ from `other`. */
function extent(p: Painted, other?: Painted) {
  let left = p.width;
  let right = -1;
  let top = p.height;
  let bottom = -1;
  let count = 0;
  for (let y = 0; y < p.height; y += 1)
    for (let x = 0; x < p.width; x += 1) {
      const marked =
        other === undefined
          ? !isBackground(p, x, y)
          : at(p, x, y).some((c, k) => c !== at(other, x, y)[k]);
      if (!marked) continue;
      count += 1;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  return { left, right, top, bottom, count };
}

/** World space (x right, y up, the layout origin) to the target's pixels, by the camera the game sets. */
const canvasX = (worldX: number) => worldX - CAMERA_ORIGIN.x;
const canvasY = (worldY: number) => -worldY - CAMERA_ORIGIN.y;

/** A view whose followed mortal place holds `count` placeholder inhabitants, none of them a god. */
function crowded(count: number): WorldViewModel {
  const view = withTerrain();
  const people = Array.from({ length: count }, (_, index) => ({
    id: `person-${String(index).padStart(2, "0")}`,
    locationId: PLACE.mortal,
    alive: true,
    sprite: "placeholder-person",
    isDeity: false,
    inventory: [],
  }));
  return {
    ...view,
    realms: {
      ...view.realms,
      mortal: view.realms.mortal.map((l) =>
        l.id === PLACE.mortal ? { ...l, buildings: [], actors: people } : l,
      ),
    },
  };
}

/** The pixels of `painted` inside `box` that differ from `other`'s. */
function differing(
  painted: Painted,
  other: Painted,
  box: { left: number; right: number; top: number; bottom: number },
): number {
  let count = 0;
  for (let y = box.top; y < box.bottom; y += 1)
    for (let x = box.left; x < box.right; x += 1)
      if (at(painted, x, y).some((c, k) => c !== at(other, x, y)[k]))
        count += 1;
  return count;
}

test("the ground diamond lands whole and centred on the canvas: 576 wide from the left edge to the right, its top tile 87 px down", async () => {
  const painted = await paint(
    ground(withTerrain(), "mortal", PLACE.mortal),
    "mortal",
    PLACE.mortal,
  );
  expect([painted.width, painted.height]).toEqual([576, 384]);

  const box = extent(painted);
  // The 9x9 lattice: 576 across, 288 down; its first tile's top is 144 above the world origin.
  expect(box.left).toBeLessThanOrEqual(1);
  expect(box.right).toBeGreaterThanOrEqual(574);
  expect(box.top).toBe(canvasY(144));
  expect(box.bottom).toBeGreaterThanOrEqual(canvasY(-144) - 3);
  expect(box.bottom).toBeLessThan(LOGICAL_SIZE.height);
  // Centred across the canvas, and the diamond's middle is a ground pixel.
  expect(box.left + box.right + 1).toBe(LOGICAL_SIZE.width);
  expect(isBackground(painted, canvasX(0), canvasY(0))).toBe(false);
  // The four canvas corners are outside the diamond, on the background.
  for (const [x, y] of [
    [2, 2],
    [LOGICAL_SIZE.width - 3, 2],
    [2, LOGICAL_SIZE.height - 3],
    [LOGICAL_SIZE.width - 3, LOGICAL_SIZE.height - 3],
  ] as const)
    expect(isBackground(painted, x, y), `${x},${y}`).toBe(true);
});

test("a building stands on the back half of the ground: its foot is above the diamond's middle, the pixels it adds lie in its own cell on the canvas, and its plinth is on the ground", async () => {
  const view = withTerrain();
  const bare = await paint(
    ground(view, "mortal", PLACE.mortal),
    "mortal",
    PLACE.mortal,
  );
  // One house: the tavern, and no one else at the place.
  const withBuilding = await paint(
    {
      ...view,
      realms: {
        ...view.realms,
        mortal: view.realms.mortal.map((l) =>
          l.id === PLACE.mortal
            ? {
                ...l,
                actors: [],
                buildings: l.buildings.filter((b) => b.id === "the-tavern"),
              }
            : l,
        ),
      },
    },
    "mortal",
    PLACE.mortal,
  );

  const added = extent(withBuilding, bare);
  expect(added.count).toBeGreaterThan(1000);
  // The lone building's slot is the cell (2, 3): the house's 192x192 cell has its foot at (65, 181) on that cell's
  // bottom vertex, the plinth's lowest point.
  const foot = cellFoot(buildingCell(0, 1) as GridCell);
  const at0 = { x: canvasX(foot.x), y: canvasY(foot.y) };
  expect(added.left).toBeGreaterThanOrEqual(at0.x - 65);
  expect(added.right).toBeLessThan(at0.x + 127);
  // The lowest pixel of the house is the plinth's tip, on the foot: the row above the vertex row.
  expect(added.bottom).toBe(at0.y - 1);
  // Its foot stands above the middle of the diamond: the back half.
  expect(at0.y).toBeLessThan(canvasY(0));
  // And the whole of it is on the canvas.
  expect(added.top).toBeGreaterThanOrEqual(0);
  // The art's plinth, the rows at its bottom, stands on ground: no pixel of it is over bare background.
  for (let y = added.bottom - 24; y <= added.bottom; y += 1)
    for (let x = added.left; x <= added.right; x += 1)
      if (at(withBuilding, x, y).some((c, k) => c !== at(bare, x, y)[k]))
        expect(isBackground(bare, x, y), `plinth pixel ${x},${y}`).toBe(false);
});

test("an actor stands on the front half of the ground: the pixels it adds lie in its cell, below the diamond's middle, on the canvas", async () => {
  const view = withTerrain();
  const bare = await paint(
    ground(view, "mortal", PLACE.mortal),
    "mortal",
    PLACE.mortal,
  );
  const withActor = await paint(
    {
      ...view,
      realms: {
        ...view.realms,
        mortal: view.realms.mortal.map((l) =>
          l.id === PLACE.mortal ? { ...l, buildings: [] } : l,
        ),
      },
    },
    "mortal",
    PLACE.mortal,
  );

  const added = extent(withActor, bare);
  expect(added.count).toBeGreaterThan(20);
  // The first actor stands on the first actor cell; the placeholder is 16x16 on its foot.
  const cell = cellFoot(actorCell(0) as GridCell);
  const foot = { x: canvasX(cell.x), y: canvasY(cell.y) };
  expect(added.left).toBeGreaterThanOrEqual(foot.x - 8);
  expect(added.right).toBeLessThanOrEqual(foot.x + 8);
  expect(added.bottom).toBeLessThanOrEqual(foot.y);
  expect(foot.y).toBeGreaterThan(canvasY(0));
  expect(added.top).toBeGreaterThanOrEqual(canvasY(0) - 8);
  expect(added.bottom).toBeLessThan(LOGICAL_SIZE.height);
});

test("a crowded place shows every actor's own pixels: each of 14 placeholders adds pixels inside its own cell's 16x16 box, and none is hidden", async () => {
  const bare = await paint(
    ground(crowded(MAX_ACTORS_PER_PLACE), "mortal", PLACE.mortal),
    "mortal",
    PLACE.mortal,
  );
  const crowd = await paint(
    crowded(MAX_ACTORS_PER_PLACE),
    "mortal",
    PLACE.mortal,
  );

  for (let index = 0; index < MAX_ACTORS_PER_PLACE; index += 1) {
    const foot = cellFoot(actorCell(index) as GridCell);
    const left = canvasX(foot.x) - 8;
    const top = canvasY(foot.y) - 16;
    const added = differing(crowd, bare, {
      left,
      right: left + 16,
      top,
      bottom: top + 16,
    });
    // The placeholder is a figure in a 16x16 cell; a good part of it is opaque.
    expect(added, `actor ${index}`).toBeGreaterThan(40);
  }
});

test("Olympus shows Zeus and Hera side by side on the bare background, each in its own cell", async () => {
  const view = withTerrain();
  const hera = {
    id: "hera",
    locationId: PLACE.olympus,
    alive: true,
    sprite: "placeholder-hera",
    isDeity: true,
    inventory: [],
  };
  const both: WorldViewModel = {
    ...view,
    realms: {
      ...view.realms,
      olympus: view.realms.olympus.map((l) =>
        l.id === PLACE.olympus ? { ...l, actors: [...l.actors, hera] } : l,
      ),
    },
  };
  const painted = await paint(both, "olympus", PLACE.olympus);
  const zeusOnly = await paint(withTerrain(), "olympus", PLACE.olympus);

  // Zeus (the 64x80 cell, foot at (32, 80)) stands on the first cell, Hera (16x16) on the second.
  const zeusFoot = cellFoot(actorCell(0) as GridCell);
  const heraFoot = cellFoot(actorCell(1) as GridCell);
  const zeusBox = extent(zeusOnly);
  expect(zeusBox.count).toBeGreaterThan(100);
  expect(zeusBox.left).toBeGreaterThanOrEqual(canvasX(zeusFoot.x) - 32);
  expect(zeusBox.right).toBeLessThan(canvasX(zeusFoot.x) + 32);
  expect(zeusBox.bottom).toBeLessThanOrEqual(canvasY(zeusFoot.y));
  // Hera adds her own pixels, in her cell's box, beside Zeus and not under him.
  const left = canvasX(heraFoot.x) - 8;
  const top = canvasY(heraFoot.y) - 16;
  expect(
    differing(painted, zeusOnly, {
      left,
      right: left + 16,
      top,
      bottom: top + 16,
    }),
  ).toBeGreaterThan(40);
  expect(left).toBeGreaterThanOrEqual(zeusBox.right);
  // The same row, 64 apart: side by side.
  expect(heraFoot.y).toBe(zeusFoot.y);
  expect(heraFoot.x - zeusFoot.x).toBe(64);
  // No ground under Olympus, and the corners are the background.
  expect(isBackground(painted, 4, 4)).toBe(true);
  expect(isBackground(painted, canvasX(200), canvasY(0))).toBe(true);
});

test("a game that starts idle draws the town square's ground: the observer's default place, from the view alone, with no pick", async () => {
  const view = withTerrain();
  const idle = createObserver().update(view);
  expect(idle.kind).toBe("idle");

  // What the shell does: the place to draw is the followed place, whatever the observer is doing.
  const place = followedPlace(idle, view);
  if (place === undefined) throw new Error("an idle observer has no place");
  const painted = await paint(
    ground(view, place.realm, place.locationId),
    place.realm,
    place.locationId,
  );

  // The same pixels as when the square is picked: a whole, centred diamond, not bare background.
  const box = extent(painted);
  expect(box.left).toBeLessThanOrEqual(1);
  expect(box.right).toBeGreaterThanOrEqual(574);
  expect(box.left + box.right + 1).toBe(LOGICAL_SIZE.width);
  expect(box.top).toBe(canvasY(144));
  expect(isBackground(painted, canvasX(0), canvasY(0))).toBe(false);
  const picked = createObserver();
  picked.pick({ kind: "location", id: PLACE.mortal });
  const target = followedPlace(picked.update(view), view);
  expect(target).toEqual(place);
});
