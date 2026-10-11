import { expect, test } from "bun:test";
import { EMPTY_SNAPSHOT } from "@panthea/assets/browser";
import { fakeSource, zeusPayload } from "../assets/_test-canon";
import { createCanonClient } from "../assets/canon";
import type { ViewActor } from "../store";
import { viewWithZeus } from "./_test-view";
import { type ActorItem, actorInstances, planActors } from "./actors";
import { locationPoints } from "./layout";

async function snapshot() {
  const canon = createCanonClient({ source: fakeSource(zeusPayload()) });
  return (await canon.load()).snapshot;
}

test("Zeus's sprite resolves to zeus-sprite idle-south, the other inhabitants to the placeholder", async () => {
  const view = viewWithZeus();
  const locations = view.realms.olympus;
  const planned = planActors(
    locations,
    locationPoints(locations),
    await snapshot(),
  );

  const zeus = planned.find((item) => item.actor.id === "zeus");
  expect(zeus?.actor.sprite).toBe("zeus-sprite");
  if (zeus?.art.source !== "canon")
    throw new Error("expected canon art for Zeus");
  expect(String(zeus.art.resolution.assetId)).toBe("zeus-sprite");
  expect(zeus.art.resolution.frames.map((frame) => frame.durationMs)).toEqual([
    333, 167, 333, 167,
  ]);

  const mortal = view.realms.mortal;
  const others = planActors(mortal, locationPoints(mortal), await snapshot());
  expect(others.map((item) => item.actor.sprite)).toEqual([
    "placeholder-farmer",
    "placeholder-woodcutter",
  ]);
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
  const planned = planActors(
    locations,
    locationPoints(locations),
    EMPTY_SNAPSHOT,
  );

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

function placeholderItem(
  id: string,
  foot: { x: number; y: number },
): ActorItem {
  return {
    id: `actor:${id}`,
    actor: actor({ id }),
    foot,
    art: {
      source: "placeholder",
      reason: "missing-id",
      pixels: { width: 16, height: 16, rgba: new Uint8Array(16 * 16 * 4) },
    },
  };
}

test("a placeholder is placed by its foot: the bottom centre of its 16x16 cell", () => {
  const { instances } = actorInstances([
    placeholderItem("a", { x: 10, y: -20 }),
  ]);

  expect(instances).toHaveLength(1);
  const [instance] = instances;
  // Screen space is y down: the foot at world y -20 is screen y 20.
  expect(instance).toMatchObject({
    id: "actor:a",
    layer: "actor",
    x: 2,
    y: 4,
    w: 16,
    h: 16,
  });
  expect(instance?.art).toMatchObject({
    source: "placeholder",
    placeholder: { width: 16, height: 16 },
  });
  expect(instance?.art).not.toHaveProperty("uri");
});

test("a canon actor is placed by the manifest's pivot and drawn at the cell size", async () => {
  const view = viewWithZeus();
  const locations = view.realms.olympus;
  const planned = planActors(
    locations,
    locationPoints(locations),
    await snapshot(),
  );

  const { instances } = actorInstances(planned);

  const zeus = instances.find((instance) => instance.id === "actor:zeus");
  const foot = planned[0]?.foot ?? { x: 0, y: 0 };
  expect(zeus).toMatchObject({
    x: foot.x - 32,
    y: -foot.y - 80,
    w: 64,
    h: 80,
  });
  expect(zeus?.art.source).toBe("canon");
});

test("an actor lower on the screen draws in front, and ties go by id", () => {
  const { instances } = actorInstances([
    placeholderItem("back", { x: 0, y: 100 }),
    placeholderItem("front", { x: 0, y: -100 }),
    placeholderItem("tie-b", { x: 5, y: 0 }),
    placeholderItem("tie-a", { x: -5, y: 0 }),
  ]);

  const z = (id: string) =>
    instances.find((i) => i.id === `actor:${id}`)?.z ?? NaN;
  expect(z("front")).toBeGreaterThan(z("tie-a"));
  expect(z("tie-a")).toBeLessThan(z("tie-b"));
  expect(z("tie-b")).toBeGreaterThan(z("back"));
  expect(new Set(instances.map((i) => i.z)).size).toBe(4);
});

test("the instances do not depend on the order the actors are given in", () => {
  const items = ["a", "b", "c", "d"].map((id, index) =>
    placeholderItem(id, { x: index, y: index % 2 }),
  );

  const forward = actorInstances(items).instances;
  const backward = actorInstances([...items].reverse()).instances;

  expect(backward).toEqual(forward);
});

test("an actor beyond the slots at one depth is reported, not drawn", () => {
  const items = Array.from({ length: 300 }, (_, index) =>
    placeholderItem(`n${String(index).padStart(3, "0")}`, { x: index, y: 0 }),
  );

  const { instances, dropped } = actorInstances(items);

  expect(instances).toHaveLength(256);
  expect(dropped).toHaveLength(44);
});
