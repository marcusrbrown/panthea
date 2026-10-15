import { expect, test } from "bun:test";
import { EMPTY_SNAPSHOT } from "@panthea/assets/browser";
import {
  FIRE_ASSET,
  STRUCTURE_ANCHORS,
  STRUCTURE_ASSETS,
  STRUCTURE_FOOTPRINTS,
} from "@panthea/renderer";
import { BUILDING_STATUSES, type BuildingStatus } from "@panthea/world";

import { fakeSource } from "../../test/canon-fixture";
import {
  COMMITTED_CANON_ATLASES,
  committedCanonPayload,
} from "../../test/zeus-retro-fixture";
import { createCanonClient } from "../assets/canon";
import type { ViewActor, ViewBuilding, ViewLocation } from "../store";
import { type ActorItem, actorEntity } from "./actors";
import { buildingCell, cellFoot, type GridCell } from "./layout";
import {
  planStructures,
  type StructureItem,
  structureArtOf,
  structureEntity,
  structureStateOf,
} from "./structures";
import { composeWorld } from "./world";

async function snapshot() {
  const canon = createCanonClient({
    source: fakeSource(committedCanonPayload(), COMMITTED_CANON_ATLASES),
  });
  return (await canon.load()).snapshot;
}

function building(
  id: string,
  status: BuildingStatus,
  extra: Partial<ViewBuilding> = {},
): ViewBuilding {
  return {
    id,
    name: id,
    locationId: "square",
    status,
    inventory: [],
    ...extra,
  };
}

function place(
  buildings: readonly ViewBuilding[],
  actors: readonly ViewActor[] = [],
): ViewLocation[] {
  return [
    {
      id: "square",
      name: "Square",
      realm: "mortal",
      edges: [],
      actors,
      buildings,
    },
  ];
}

const plan = async (locations: readonly ViewLocation[]) =>
  planStructures(locations[0], await snapshot());

const canonOf = (item: StructureItem | undefined) => {
  if (item?.art.source !== "canon") throw new Error("expected canon art");
  return item.art.resolution;
};

test("every building status maps to the art it draws, and none is left out", () => {
  expect(
    Object.fromEntries(
      BUILDING_STATUSES.map((status) => [status, structureStateOf(status)]),
    ),
  ).toEqual({
    operational: { state: "intact", fire: false, repair: false },
    damaged: { state: "damaged", fire: false, repair: false },
    burning: { state: "damaged", fire: true, repair: false },
    repairing: { state: "damaged", fire: false, repair: true },
    destroyed: { state: "ruin", fire: false, repair: false },
  });
});

test("the Old Oak draws the tree and every other building, whatever it is made of, draws the building", () => {
  expect(structureArtOf("old-oak")).toBe("tree");
  for (const id of ["woodshed", "the-tavern", "agora-shop", "the-forge"]) {
    expect(structureArtOf(id)).toBe("building");
  }
});

test("each status draws its published art: operational intact, damaged and repairing damaged, destroyed ruin", async () => {
  const cell = (status: BuildingStatus) =>
    plan(place([building("hut", status)])).then(([item]) => {
      const resolution = canonOf(item);
      return [
        String(resolution.assetId),
        resolution.frames.map((frame) => frame.rect.x),
      ];
    });

  // The house publishes three one-frame states, side by side on its atlas.
  expect(await cell("operational")).toEqual(["greek-house", [0]]);
  expect(await cell("damaged")).toEqual(["greek-house", [192]]);
  expect(await cell("repairing")).toEqual(["greek-house", [192]]);
  expect(await cell("burning")).toEqual(["greek-house", [192]]);
  expect(await cell("destroyed")).toEqual(["greek-house", [384]]);
});

test("the Old Oak draws the tree's 12-frame wind loops while it stands and the stump when it is destroyed", async () => {
  const [intact] = await plan(place([building("old-oak", "operational")]));
  const [damaged] = await plan(place([building("old-oak", "damaged")]));
  const [ruin] = await plan(place([building("old-oak", "destroyed")]));

  expect(String(canonOf(intact).assetId)).toBe(STRUCTURE_ASSETS.tree);
  expect(canonOf(intact).frames).toHaveLength(12);
  expect(canonOf(intact).loopStart).toBe(0);
  expect(canonOf(damaged).frames).toHaveLength(12);
  expect(canonOf(damaged).frames[0]?.rect.x).toBe(2304);
  expect(canonOf(ruin).frames).toHaveLength(1);
  expect(canonOf(ruin).frames[0]?.rect.x).toBe(4608);
});

/** The structure items placed by the shared scene, in the layout's world. */
function placed(
  items: readonly StructureItem[],
  actors: readonly ActorItem[] = [],
) {
  const composed = composeWorld([
    ...items.map(structureEntity),
    ...actors.map(actorEntity),
  ]);
  expect(composed.refused).toEqual([]);
  return composed.instances;
}

test("a burning building draws the damaged art with the fire loop over it, at the structure's fire anchor", async () => {
  const locations = place([building("the-tavern", "burning")]);
  const items = await plan(locations);
  const [base, fire] = items;

  expect(items.map((item) => item.id)).toEqual([
    "structure:the-tavern",
    "structure:the-tavern:fire",
  ]);
  expect(canonOf(base).frames[0]?.rect.x).toBe(192);
  const burn = canonOf(fire);
  expect(String(burn.assetId)).toBe(FIRE_ASSET);
  expect(burn.kind).toBe("effect");
  expect(burn.frames).toHaveLength(10);
  expect(burn.loopStart).toBeUndefined();

  if (base === undefined || fire === undefined) {
    throw new Error("the plan has no items");
  }
  // The house stands on the slot's bottom cell, its footprint reaching back from it; the fire stands on that same
  // cell, at the anchor, an offset down the screen from the foot.
  const bottom = buildingCell(0, 1) as GridCell;
  const footprint = STRUCTURE_FOOTPRINTS.building;
  expect(base.bottom).toEqual(bottom);
  expect(base.cell).toEqual({
    x: bottom.x - footprint.w + 1,
    y: bottom.y - footprint.h + 1,
  });
  expect(fire.cell).toEqual(bottom);
  expect(fire.offset).toEqual(STRUCTURE_ANCHORS.building.fire);

  const [house, flame] = placed(items);
  const foot = cellFoot(bottom);
  const anchor = STRUCTURE_ANCHORS.building.fire;
  // House: 192x192, pivot (96, 136), on the foot.
  expect(house).toMatchObject({
    id: base.id,
    x: foot.x - 96,
    y: -foot.y - 136,
    depth: bottom.x + bottom.y,
  });
  // Fire: 64x88, pivot (32, 88), on the foot moved by the anchor; the same depth, drawn over the house.
  expect(flame).toMatchObject({
    id: fire.id,
    x: foot.x + anchor.x - 32,
    y: -foot.y + anchor.y - 88,
    depth: bottom.x + bottom.y,
  });
  expect(flame?.z).toBeGreaterThan(house?.z ?? Number.NaN);
});

test("only a burning building has a fire: every other status draws its one structure sprite", async () => {
  for (const status of BUILDING_STATUSES) {
    const items = await plan(place([building("hut", status)]));
    expect(items).toHaveLength(status === "burning" ? 2 : 1);
  }
});

test("buildings stand on their slot's cells, by how many the place has, and one past the slots is not drawn", async () => {
  for (const count of [1, 2, 3]) {
    const items = await plan(
      place(
        Array.from({ length: count }, (_, i) =>
          building(`b${i}`, "operational"),
        ),
      ),
    );
    expect(items.map((item) => item.bottom)).toEqual(
      Array.from(
        { length: count },
        (_, i) => buildingCell(i, count) as GridCell,
      ),
    );
  }
  const four = await plan(
    place(
      Array.from({ length: 4 }, (_, i) => building(`b${i}`, "operational")),
    ),
  );
  expect(four).toEqual([]);
});

test("the structures of one place never overlap: the footprints of two or three buildings of any art and status are disjoint, and every one is on the grid", async () => {
  const kinds = [
    ["old-oak", "operational"],
    ["the-tavern", "burning"],
    ["the-forge", "destroyed"],
  ] as const;
  for (const count of [1, 2, 3]) {
    const items = (
      await plan(
        place(
          kinds.slice(0, count).map(([id, status]) => building(id, status)),
        ),
      )
    ).filter((item) => item.role === "building");
    const taken = new Set<string>();
    expect(items).toHaveLength(count);
    for (const item of items) {
      const { w, h } = STRUCTURE_FOOTPRINTS[structureArtOf(item.building.id)];
      for (let x = item.cell.x; x < item.cell.x + w; x += 1)
        for (let y = item.cell.y; y < item.cell.y + h; y += 1) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(8);
          expect(y).toBeLessThan(8);
          expect(taken.has(`${x},${y}`), `${item.id} at ${x},${y}`).toBe(false);
          taken.add(`${x},${y}`);
        }
    }
  }
});

test("with no place followed there are no structures and no actors to plan", async () => {
  expect(planStructures(undefined, await snapshot())).toEqual([]);
});

test("a building whose art is not published draws the shared placeholder in the footprint its art declares, and so does its fire", async () => {
  const locations = place([building("the-tavern", "burning")]);

  const items = planStructures(locations[0], EMPTY_SNAPSHOT);

  expect(items).toHaveLength(2);
  for (const item of items) {
    expect(item.art).toMatchObject({
      source: "placeholder",
      reason: "missing-id",
    });
    if (item.art.source === "placeholder") {
      expect([item.art.pixels.width, item.art.pixels.height]).toEqual([16, 16]);
    }
  }
  // The placeholder takes the house's 4x3 footprint, so it stands on the same bottom cell and depth as the art would.
  const [house] = placed(items);
  expect(house).toMatchObject({
    footprint: STRUCTURE_FOOTPRINTS.building,
    depth:
      (buildingCell(0, 1) as GridCell).x + (buildingCell(0, 1) as GridCell).y,
  });
});

function actorAt(id: string, cell: GridCell): ActorItem {
  return {
    id: `actor:${id}`,
    actor: {
      id,
      locationId: "square",
      alive: true,
      sprite: `placeholder-${id}`,
      isDeity: false,
      inventory: [],
    },
    cell,
    art: {
      source: "placeholder",
      reason: "missing-id",
      pixels: { width: 16, height: 16, rgba: new Uint8Array(16 * 16 * 4) },
    },
  };
}

test("an actor on a cell in front of a building draws over it, one behind it draws under it, and a fire draws over its own building", async () => {
  const locations = place([building("the-tavern", "burning")]);
  const items = await plan(locations);
  const [base, fire] = items;
  if (base === undefined || fire === undefined) throw new Error("no items");
  const bottom = base.bottom;
  const instances = placed(items, [
    // In front: a cell of greater x + y.
    actorAt("front", { x: bottom.x + 2, y: bottom.y + 2 }),
    // Behind: a cell of smaller x + y, on the building's own footprint.
    actorAt("behind", { x: bottom.x - 2, y: bottom.y - 1 }),
    // Beside: the same x + y as the building's bottom cell.
    actorAt("beside", { x: bottom.x + 1, y: bottom.y - 1 }),
  ]);
  const z = (id: string) =>
    instances.find((one) => one.id === id)?.z ?? Number.NaN;

  expect(z("actor:front")).toBeGreaterThan(z(base.id));
  expect(z("actor:behind")).toBeLessThan(z(base.id));
  // At the building's own depth the structure layer is behind the actor layer.
  expect(z("actor:beside")).toBeGreaterThan(z(base.id));
  expect(z(fire.id)).toBeGreaterThan(z(base.id));
  // The fire is a structure effect on the same cell: an actor in front of the building is in front of its fire too.
  expect(z("actor:front")).toBeGreaterThan(z(fire.id));
  // And the actor behind it is behind the fire as well.
  expect(z("actor:behind")).toBeLessThan(z(fire.id));
});

test("the placed structures do not depend on the order the items are given in", async () => {
  const items = await plan(
    place([
      building("b", "burning"),
      building("a", "operational"),
      building("c", "destroyed"),
    ]),
  );

  expect(placed([...items].reverse())).toEqual(placed(items));
});
