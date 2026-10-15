import { expect, test } from "bun:test";
import { EMPTY_SNAPSHOT } from "@panthea/assets/browser";
import {
  FIRE_ASSET,
  STRUCTURE_ANCHORS,
  STRUCTURE_ASSETS,
} from "@panthea/renderer";
import { BUILDING_STATUSES, type BuildingStatus } from "@panthea/world";

import { fakeSource } from "../../test/canon-fixture";
import {
  COMMITTED_CANON_ATLASES,
  committedCanonPayload,
} from "../../test/zeus-retro-fixture";
import { createCanonClient } from "../assets/canon";
import type { ViewActor, ViewBuilding, ViewLocation } from "../store";
import {
  type ActorItem,
  actorInstances,
  type SpriteItem,
  spriteInstances,
} from "./actors";
import { BUILDING_SLOT, buildingFoot, PLACE_ORIGIN } from "./layout";
import {
  planStructures,
  type StructureItem,
  structureArtOf,
  structureStateOf,
} from "./structures";

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
  const foot = buildingFoot(PLACE_ORIGIN, 0, 1);
  const anchor = STRUCTURE_ANCHORS.building.fire;
  expect(base.foot).toEqual(foot);
  // The anchor is an offset down the screen; the layout's y points up.
  expect(fire.foot).toEqual({ x: foot.x + anchor.x, y: foot.y - anchor.y });
  // The fire sorts by the building's foot, not its own, so it is never behind the roof it burns on.
  expect(fire.depthFoot).toEqual(foot);
});

test("only a burning building has a fire: every other status draws its one structure sprite", async () => {
  for (const status of BUILDING_STATUSES) {
    const items = await plan(place([building("hut", status)]));
    expect(items).toHaveLength(status === "burning" ? 2 : 1);
  }
});

test("buildings stand at their slots, each by its own foot, in a row centred on the place", async () => {
  const items = await plan(
    place([building("a", "operational"), building("b", "operational")]),
  );

  expect(items.map((item) => item.foot)).toEqual([
    buildingFoot(PLACE_ORIGIN, 0, 2),
    buildingFoot(PLACE_ORIGIN, 1, 2),
  ]);
  expect(items.map((item) => item.foot.x)).toEqual([
    -BUILDING_SLOT.dx / 2,
    BUILDING_SLOT.dx / 2,
  ]);
});

test("the structures of one place never overlap: the drawn cells of two or three buildings of any art and status are disjoint", async () => {
  const kinds = [
    ["old-oak", "operational"],
    ["the-tavern", "burning"],
    ["the-forge", "destroyed"],
  ] as const;
  for (const count of [1, 2, 3]) {
    const items = await plan(
      place(kinds.slice(0, count).map(([id, status]) => building(id, status))),
    );
    const { instances } = spriteInstances(items, "structure");
    const cells = instances
      .filter((instance) => !instance.id.endsWith(":fire"))
      .map((instance) => ({
        id: instance.id,
        left: instance.x,
        right: instance.x + instance.w,
      }))
      .sort((a, b) => a.left - b.left);

    expect(cells).toHaveLength(count);
    for (const [index, cell] of cells.entries()) {
      const next = cells[index + 1];
      if (next !== undefined) expect(cell.right).toBeLessThanOrEqual(next.left);
    }
  }
});

test("with no place followed there are no structures and no actors to plan", async () => {
  expect(planStructures(undefined, await snapshot())).toEqual([]);
});

test("a building whose art is not published draws the shared placeholder, and so does its fire", async () => {
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
});

test("structures are sprites on the structure layer, placed by the manifest pivot at the foot", async () => {
  const locations = place([building("the-tavern", "burning")]);
  const items = await plan(locations);
  const { instances, dropped } = spriteInstances(items, "structure");
  const [base, fire] = items;
  if (base === undefined || fire === undefined) throw new Error("no items");

  expect(dropped).toEqual([]);
  const house = instances.find((one) => one.id === base.id);
  const flame = instances.find((one) => one.id === fire.id);
  expect(house).toMatchObject({
    layer: "structure",
    // House: 192x192, pivot (96, 136).
    x: base.foot.x - 96,
    y: -base.foot.y - 136,
    w: 192,
    h: 192,
  });
  expect(flame).toMatchObject({
    layer: "structure",
    // Fire: 64x88, pivot (32, 88).
    x: fire.foot.x - 32,
    y: -fire.foot.y - 88,
    w: 64,
    h: 88,
  });
});

function actorAt(id: string, foot: { x: number; y: number }): ActorItem {
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
    foot,
    art: {
      source: "placeholder",
      reason: "missing-id",
      pixels: { width: 16, height: 16, rgba: new Uint8Array(16 * 16 * 4) },
    },
  };
}

test("an actor below a building draws in front of it, one above it behind, and a fire draws over its own building", async () => {
  const locations = place([building("the-tavern", "burning")]);
  const items = await plan(locations);
  const [base, fire] = items;
  if (base === undefined || fire === undefined) throw new Error("no items");
  const foot = base.foot;
  const structures = spriteInstances(items, "structure").instances;
  const actors = actorInstances([
    actorAt("front", { x: foot.x, y: foot.y - 40 }),
    actorAt("behind", { x: foot.x, y: foot.y + 40 }),
    actorAt("beside", { x: foot.x + 30, y: foot.y }),
  ]).instances;
  const z = (id: string) =>
    [...structures, ...actors].find((one) => one.id === id)?.z ?? Number.NaN;

  expect(z("actor:front")).toBeGreaterThan(z(base.id));
  expect(z("actor:behind")).toBeLessThan(z(base.id));
  // At the building's own depth the structure layer is behind the actor layer.
  expect(z("actor:beside")).toBeGreaterThan(z(base.id));
  expect(z(fire.id)).toBeGreaterThan(z(base.id));
  // The fire is a structure, so an actor in front of the building is in front of its fire too.
  expect(z("actor:front")).toBeGreaterThan(z(fire.id));
});

test("structure instances do not depend on the order the items are given in", async () => {
  const items = await plan(
    place([
      building("b", "burning"),
      building("a", "operational"),
      building("c", "destroyed"),
    ]),
  );

  const forward = spriteInstances(items, "structure").instances;
  const backward = spriteInstances([...items].reverse(), "structure").instances;

  expect(backward).toEqual(forward);
});

test("sprite items without their own depth foot are sorted by their foot", () => {
  const item = (id: string, y: number): SpriteItem => ({
    id,
    foot: { x: 0, y },
    art: {
      source: "placeholder",
      reason: "missing-id",
      pixels: { width: 16, height: 16, rgba: new Uint8Array(16 * 16 * 4) },
    },
  });

  const { instances } = spriteInstances(
    [item("near", -40), item("far", 40)],
    "structure",
  );

  expect(instances.map((one) => one.id)).toEqual(["far", "near"]);
});
