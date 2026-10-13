import { expect, test } from "bun:test";

import { previewView } from "./fixtures";
import { placeEvents } from "./renderer/presentation";

test("the preview world keeps the actors, buildings, statuses, and summary the preview always showed", () => {
  const view = previewView();

  expect(view.sessionId).toBe("preview-session");
  expect(view.sequence).toBe(17);
  expect(view.tick).toBe(17);
  expect(view.status).toBe("running");
  expect(view.catchUpSummary).toEqual({
    id: "preview-summary",
    appliedMs: 7_200_000,
    skippedMs: 10_800_000,
    majorOutcomes: [
      "The tavern fire spread",
      "A route through the agora reopened",
    ],
    atSequence: 17,
  });

  expect(view.realms.mortal.map((location) => location.id)).toEqual([
    "agora",
    "town-square",
  ]);
  const square = view.realms.mortal.find(
    (location) => location.id === "town-square",
  );
  expect(square?.name).toBe("Town Square");
  expect(square?.actors.map((actor) => [actor.id, actor.alive])).toEqual([
    ["fallen-guard", false],
    ["wanderer", true],
  ]);
  expect(
    square?.actors.find((actor) => actor.id === "wanderer")?.inventory,
  ).toEqual([
    { resource: "currency", amount: 5 },
    { resource: "wood", amount: 2 },
  ]);
  expect(square?.buildings).toEqual([
    {
      id: "the-tavern",
      name: "The Tavern",
      locationId: "town-square",
      status: "burning",
      inventory: [],
      fire: { intensity: 2, ticksBurning: 2, destroyAt: 3 },
    },
  ]);

  const agora = view.realms.mortal.find((location) => location.id === "agora");
  expect(agora?.actors).toEqual([]);
  expect(agora?.buildings).toEqual([
    {
      id: "agora-shop",
      name: "Agora Shop",
      locationId: "agora",
      status: "operational",
      inventory: [{ resource: "planks", amount: 1 }],
    },
  ]);

  const hall = view.realms.olympus[0];
  expect(hall?.name).toBe("Hall of Olympus");
  expect(hall?.actors).toEqual([
    {
      id: "zeus",
      locationId: "olympus-hall",
      alive: true,
      sprite: "placeholder-zeus",
      isDeity: true,
      inventory: [{ resource: "divinity", amount: 10 }],
    },
  ]);
  expect(view.realms.underworld.map((location) => location.name)).toEqual([
    "Underworld Gate",
  ]);
});

test("the preview world's path counts are the ones the map header showed", () => {
  const view = previewView();
  const paths = (id: string) =>
    Object.values(view.realms)
      .flat()
      .find((location) => location.id === id)?.edges.length;

  expect(paths("town-square")).toBe(1);
  expect(paths("agora")).toBe(1);
  expect(paths("olympus-hall")).toBe(0);
  expect(paths("underworld-gate")).toBe(0);
});

test("the preview's recent events use real event kinds, and the drawable ones sit at a subject's location in the mortal realm", () => {
  const view = previewView();

  expect(view.recentEvents.map((event) => event.id as string)).toEqual([
    "evt-strike-14",
    "evt-fire-15",
    "evt-trade-16",
    "evt-worship-17",
  ]);
  const placed = placeEvents(view, "mortal");
  expect(placed.map((entry) => [entry.event.id as string, entry.tone])).toEqual(
    [
      ["evt-strike-14", "fire"],
      ["evt-fire-15", "fire"],
      ["evt-trade-16", "neutral"],
      ["evt-worship-17", "worship"],
    ],
  );
  expect(placed.every((entry) => entry.locationId === "town-square")).toBe(
    true,
  );
});
