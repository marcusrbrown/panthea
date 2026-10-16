import { expect, test } from "bun:test";
import { EMPTY_SNAPSHOT } from "@panthea/assets/browser";
import { fakeSource, zeusPayload } from "../../test/canon-fixture";
import { viewWithZeus } from "../../test/view-fixture";
import {
  RETRO_ATLAS_HASH,
  RETRO_REVISION,
  retroPayload,
} from "../../test/zeus-retro-fixture";
import { createCanonClient } from "../assets/canon";
import type { ViewActor } from "../store";
import { type ActorItem, actorEntity, planActors } from "./actors";
import { ACTOR_CELLS, cellFoot, type GridCell } from "./layout";
import { composeWorld } from "./world";

async function snapshot() {
  const canon = createCanonClient({ source: fakeSource(zeusPayload()) });
  return (await canon.load()).snapshot;
}

test("Zeus's sprite resolves to zeus-sprite idle-south, the other inhabitants to the placeholder", async () => {
  const view = viewWithZeus();
  const locations = view.realms.olympus;
  const planned = planActors(locations[0], await snapshot());

  const zeus = planned.find((item) => item.actor.id === "zeus");
  expect(zeus?.actor.sprite).toBe("zeus-sprite");
  if (zeus?.art.source !== "canon")
    throw new Error("expected canon art for Zeus");
  expect(String(zeus.art.resolution.assetId)).toBe("zeus-sprite");
  expect(zeus.art.resolution.frames.map((frame) => frame.durationMs)).toEqual([
    333, 167, 333, 167,
  ]);

  // The scene draws one place: each mortal place plans its own inhabitants and no other's.
  const [square, agora] = ["town-square", "agora"].map((id) =>
    view.realms.mortal.find((location) => location.id === id),
  );
  const others = planActors(square, await snapshot());
  expect(others.map((item) => item.actor.sprite)).toEqual([
    "placeholder-woodcutter",
  ]);
  expect(
    planActors(agora, await snapshot()).map((item) => item.actor.sprite),
  ).toEqual(["placeholder-farmer"]);
  expect(planActors(undefined, await snapshot())).toEqual([]);
  for (const item of others) {
    expect(item.art).toMatchObject({
      source: "placeholder",
      reason: "missing-id",
    });
  }
});

test("an empty snapshot draws every actor as the placeholder", () => {
  const view = viewWithZeus();
  const locations = view.realms.olympus;
  const planned = planActors(locations[0], EMPTY_SNAPSHOT);

  expect(planned).toHaveLength(1);
  expect(planned[0]?.art.source).toBe("placeholder");
});

function actor(overrides: Partial<ViewActor> = {}): ViewActor {
  return {
    id: "a",
    locationId: "p",
    alive: true,
    sprite: "placeholder-a",
    isDeity: false,
    inventory: [],
    ...overrides,
  };
}

function placeholderItem(id: string, cell: GridCell): ActorItem {
  return {
    id: `actor:${id}`,
    actor: actor({ id }),
    cell,
    art: {
      source: "placeholder",
      reason: "missing-id",
      pixels: { width: 16, height: 16, rgba: new Uint8Array(16 * 16 * 4) },
    },
  };
}

/** The actors placed by the shared scene, in the layout's world. */
function placed(items: readonly ActorItem[]) {
  const composed = composeWorld(items.map(actorEntity));
  expect(composed.refused).toEqual([]);
  return composed.instances;
}

test("a placeholder stands on its cell: the bottom centre of its 16x16 cell on the cell's bottom vertex", () => {
  const cell = { x: 4, y: 5 };
  const [instance] = placed([placeholderItem("a", cell)]);
  const foot = cellFoot(cell);

  // Screen space is y down: the instance's y is the top edge, the foot's world y negated, less the height.
  expect(instance).toMatchObject({
    id: "actor:a",
    layer: "actor",
    x: foot.x - 8,
    y: -foot.y - 16,
    w: 16,
    h: 16,
    cell: { x: 4, y: 5, z: 0 },
    depth: 9,
  });
  expect(instance?.art).toMatchObject({
    source: "placeholder",
    placeholder: { width: 16, height: 16 },
  });
});

test("a canon actor is placed by the manifest's pivot on its cell and drawn at the cell size", async () => {
  const view = viewWithZeus();
  const locations = view.realms.olympus;
  const planned = planActors(locations[0], await snapshot());

  const zeus = placed(planned).find((instance) => instance.id === "actor:zeus");
  const foot = cellFoot(planned[0]?.cell as GridCell);
  expect(zeus).toMatchObject({
    x: foot.x - 32,
    y: -foot.y - 80,
    w: 64,
    h: 80,
  });
  expect(zeus?.art.source).toBe("canon");
});

test("actors take the layout's cells by index, one to a cell, and one past the 14 is not drawn", () => {
  const people = Array.from({ length: 16 }, (_, index) =>
    actor({
      id: `p${String(index).padStart(2, "0")}`,
      sprite: "placeholder-p",
    }),
  );
  const planned = planActors(
    {
      id: "p",
      name: "P",
      realm: "mortal",
      edges: [],
      actors: people,
      buildings: [],
    },
    EMPTY_SNAPSHOT,
  );

  expect(planned).toHaveLength(14);
  expect(planned.map((item) => item.cell)).toEqual([...ACTOR_CELLS]);
  expect(
    new Set(planned.map((item) => `${item.cell.x},${item.cell.y}`)).size,
  ).toBe(14);
  // Every one of them is placed on its own cell by the shared scene, and no two overlap.
  const instances = placed(planned);
  expect(instances).toHaveLength(14);
  const boxes = instances.map((i) => ({
    left: i.x,
    right: i.x + i.w,
    top: i.y,
    bottom: i.y + i.h,
  }));
  for (const [a, boxA] of boxes.entries())
    for (const [b, boxB] of boxes.entries())
      if (b > a)
        expect(
          boxA.right <= boxB.left ||
            boxB.right <= boxA.left ||
            boxA.bottom <= boxB.top ||
            boxB.bottom <= boxA.top,
          `actors ${a} and ${b}`,
        ).toBe(true);
});

test("an actor on a cell of greater x + y draws in front, and cells of one x + y tie by id", () => {
  const instances = placed([
    placeholderItem("back", { x: 2, y: 2 }),
    placeholderItem("front", { x: 6, y: 6 }),
    placeholderItem("tie-b", { x: 5, y: 3 }),
    placeholderItem("tie-a", { x: 3, y: 5 }),
  ]);

  const z = (id: string) =>
    instances.find((i) => i.id === `actor:${id}`)?.z ?? Number.NaN;
  expect(z("front")).toBeGreaterThan(z("tie-a"));
  expect(z("tie-a")).toBeLessThan(z("tie-b"));
  expect(z("tie-b")).toBeGreaterThan(z("back"));
  expect(new Set(instances.map((i) => i.z)).size).toBe(4);
});

test("the placed actors do not depend on the order they are given in", () => {
  const items = [
    placeholderItem("a", { x: 4, y: 5 }),
    placeholderItem("b", { x: 5, y: 4 }),
    placeholderItem("c", { x: 5, y: 5 }),
    placeholderItem("d", { x: 3, y: 6 }),
  ];

  expect(placed([...items].reverse())).toEqual(placed(items));
});

test("promoted Zeus resolves to zeus-retro idle-south (10 frames of 250 ms, pivot 56,78), and a pre-promotion actor on zeus-sprite still resolves to its own cells", async () => {
  const canon = createCanonClient({
    source: fakeSource(retroPayload()),
  });
  const { snapshot } = await canon.load();
  const view = viewWithZeus({}, "zeus-retro");
  const locations = view.realms.olympus;
  const [promoted] = planActors(locations[0], snapshot).filter(
    (item) => item.actor.id === "zeus",
  );
  if (promoted?.art.source !== "canon")
    throw new Error("expected canon art for promoted Zeus");
  expect(String(promoted.art.resolution.assetId)).toBe("zeus-retro");
  expect(String(promoted.art.resolution.revision)).toBe(RETRO_REVISION);
  expect(String(promoted.art.resolution.atlas.blob)).toBe(RETRO_ATLAS_HASH);
  expect(promoted.art.resolution.frames).toHaveLength(10);
  expect(
    promoted.art.resolution.frames.every((frame) => frame.durationMs === 250),
  ).toBe(true);
  expect(promoted.art.resolution.pivot).toEqual({ x: 56, y: 78 });

  const legacyView = viewWithZeus({}, "zeus-sprite");
  const legacyLocations = legacyView.realms.olympus;
  const [elder] = planActors(legacyLocations[0], snapshot).filter(
    (item) => item.actor.id === "zeus",
  );
  if (elder?.art.source !== "canon")
    throw new Error("expected canon art for the pre-promotion actor");
  expect(String(elder.art.resolution.assetId)).toBe("zeus-sprite");
  expect(elder.art.resolution.pivot).toEqual({ x: 32, y: 80 });
  expect(elder.art.resolution.frames.map((frame) => frame.durationMs)).toEqual([
    333, 167, 333, 167,
  ]);
});
