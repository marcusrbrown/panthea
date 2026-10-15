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
import type { WorldViewModel } from "../store";
import { BACKGROUND } from "./decor";
import { CAMERA_ORIGIN, LOGICAL_SIZE } from "./layout";
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

test("the ground diamond lands whole and centred on the canvas: 576 wide from the left edge to the right, its top vertex 92 px down", async () => {
  const painted = await paint(
    ground(withTerrain(), "mortal", PLACE.mortal),
    "mortal",
    PLACE.mortal,
  );
  expect([painted.width, painted.height]).toEqual([576, 384]);

  const box = extent(painted);
  // The 9x9 lattice: 576 across, 288 down; its first tile's top is 160 above the layout origin.
  expect(box.left).toBeLessThanOrEqual(1);
  expect(box.right).toBeGreaterThanOrEqual(574);
  expect(box.top).toBe(canvasY(160));
  expect(box.bottom).toBeGreaterThanOrEqual(canvasY(-128) - 3);
  expect(box.bottom).toBeLessThan(LOGICAL_SIZE.height);
  // Centred across the canvas, and the diamond's middle is a ground pixel.
  expect(box.left + box.right + 1).toBe(LOGICAL_SIZE.width);
  expect(isBackground(painted, canvasX(0), canvasY(16))).toBe(false);
  // The four canvas corners are outside the diamond, on the background.
  for (const [x, y] of [
    [2, 2],
    [LOGICAL_SIZE.width - 3, 2],
    [2, LOGICAL_SIZE.height - 3],
    [LOGICAL_SIZE.width - 3, LOGICAL_SIZE.height - 3],
  ] as const)
    expect(isBackground(painted, x, y), `${x},${y}`).toBe(true);
});

test("a building stands on the back half of the ground: the pixels it adds lie in its own cell, above the diamond's middle, on the canvas", async () => {
  const view = withTerrain();
  const bare = await paint(
    ground(view, "mortal", PLACE.mortal),
    "mortal",
    PLACE.mortal,
  );
  const withBuilding = await paint(
    {
      ...view,
      realms: {
        ...view.realms,
        mortal: view.realms.mortal.map((l) =>
          l.id === PLACE.mortal ? { ...l, actors: [] } : l,
        ),
      },
    },
    "mortal",
    PLACE.mortal,
  );

  const added = extent(withBuilding, bare);
  expect(added.count).toBeGreaterThan(1000);
  // The house is the 192x192 cell with its foot at (96, 136), the foot 80 above the layout origin.
  const foot = { x: canvasX(0), y: canvasY(80) };
  expect(added.left).toBeGreaterThanOrEqual(foot.x - 96);
  expect(added.right).toBeLessThan(foot.x + 96);
  expect(added.bottom).toBeLessThan(foot.y + 56);
  // Its foot stands above the middle of the diamond (16 above the origin): the back half.
  expect(foot.y).toBeLessThan(canvasY(16));
  expect(added.bottom).toBeLessThan(canvasY(16));
  // And the whole of it is on the canvas.
  expect(added.top).toBeGreaterThanOrEqual(0);
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
  // The first actor's foot is 28 left of and 48 below the layout origin; the placeholder is 16x16 on its foot.
  const foot = { x: canvasX(-28), y: canvasY(-48) };
  expect(added.left).toBeGreaterThanOrEqual(foot.x - 8);
  expect(added.right).toBeLessThanOrEqual(foot.x + 8);
  expect(added.bottom).toBeLessThanOrEqual(foot.y);
  expect(foot.y).toBeGreaterThan(canvasY(16));
  expect(added.top).toBeGreaterThanOrEqual(canvasY(16) - 8);
  expect(added.bottom).toBeLessThan(LOGICAL_SIZE.height);
});

test("an Olympus place draws its god on the bare background: Zeus, in his cell, on the canvas", async () => {
  const painted = await paint(withTerrain(), "olympus", PLACE.olympus);

  const box = extent(painted);
  expect(box.count).toBeGreaterThan(100);
  // Zeus's first slot: the 64x80 cell with its foot at (32, 80), the foot 28 left of and 48 below the layout origin.
  const foot = { x: canvasX(-28), y: canvasY(-48) };
  expect(box.left).toBeGreaterThanOrEqual(foot.x - 32);
  expect(box.right).toBeLessThan(foot.x + 32);
  expect(box.top).toBeGreaterThanOrEqual(foot.y - 80);
  expect(box.bottom).toBeLessThanOrEqual(foot.y);
  // No ground under Olympus: the corners and the diamond's middle row away from Zeus are the background.
  expect(isBackground(painted, 4, 4)).toBe(true);
  expect(isBackground(painted, canvasX(200), canvasY(16))).toBe(true);
});
