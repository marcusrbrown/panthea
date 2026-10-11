import { expect, test } from "bun:test";
import type { ContentPack } from "@panthea/contracts";
import { createInitialWorldState, toEntityId } from "./state";
import { testActor } from "./test-actor";
import {
  applyWorshipPerformed,
  DIVINE_CAPACITY_RESOURCE,
  FAVOR_EFFECT,
  favorDurationTicksOf,
  favorGatherBonusOf,
  hasActiveGatherFavor,
  worshipCapacityGainOf,
} from "./worship";

function pack(): ContentPack {
  return {
    schemaVersion: 1,
    realms: ["mortal", "olympus"],
    resources: [],
    locations: [
      { id: "town-square", realm: "mortal", name: "Town Square", edges: [] },
      { id: "great-hall", realm: "olympus", name: "Great Hall", edges: [] },
    ],
    buildings: [],
    inhabitants: [
      {
        id: "farmer",
        sprite: "placeholder-farmer",
        name: "The Farmer",
        locationId: "town-square",
        startingInventory: [{ resource: "wine", amount: 2 }],
      },
      {
        id: "zeus",
        sprite: "placeholder-zeus",
        name: "Zeus",
        locationId: "great-hall",
        startingInventory: [{ resource: "divinity", amount: 1 }],
      },
    ],
    rules: {
      catchUpCapMs: 0,
      catchUpChunkMs: 0,
      checkpointIntervalMs: 0,
      maxProposalsPerTick: 100,
      fireBalance: {},
      economyBalance: { worshipCapacityGain: 2, favorDurationTicks: 5 },
    },
    recipes: {},
  };
}

test("worshipCapacityGainOf and favorDurationTicksOf read the content-authored balance", () => {
  const state = createInitialWorldState(pack());
  expect(worshipCapacityGainOf(state)).toBe(2);
  expect(favorDurationTicksOf(state)).toBe(5);
});

test("applyWorshipPerformed credits the deity's divine capacity and grants the worshiper a favor", () => {
  const state = createInitialWorldState(pack());
  const next = applyWorshipPerformed(
    state,
    toEntityId("farmer"),
    toEntityId("zeus"),
    undefined,
    FAVOR_EFFECT,
    12,
  );
  expect(
    next.actors
      .get(toEntityId("zeus"))
      ?.inventory.get(DIVINE_CAPACITY_RESOURCE),
  ).toBe(3);
  expect(next.actors.get(toEntityId("farmer"))?.favors).toEqual([
    { source: toEntityId("zeus"), effect: FAVOR_EFFECT, expiresAtTick: 12 },
  ]);
});

test("applyWorshipPerformed with an offering debits the worshiper without crediting the deity's inventory of it", () => {
  const state = createInitialWorldState(pack());
  const next = applyWorshipPerformed(
    state,
    toEntityId("farmer"),
    toEntityId("zeus"),
    { resource: "wine", amount: 2 },
    FAVOR_EFFECT,
    12,
  );
  expect(next.actors.get(toEntityId("farmer"))?.inventory.get("wine")).toBe(
    undefined,
  );
  expect(next.actors.get(toEntityId("zeus"))?.inventory.get("wine")).toBe(
    undefined,
  );
});

test("favorGatherBonusOf reads the content-authored bonus, defaulting to zero", () => {
  const state = createInitialWorldState(pack());
  expect(favorGatherBonusOf(state)).toBe(0);
});

test("hasActiveGatherFavor is true only while an active favor with the gather effect is present", () => {
  const actorWithFavor = testActor({
    id: toEntityId("woodcutter"),
    locationId: toEntityId("town-square"),
    alive: true,
    capabilities: [],
    inventory: new Map(),
    favors: [
      { source: toEntityId("zeus"), effect: FAVOR_EFFECT, expiresAtTick: 10 },
    ],
    revision: 0,
  });
  expect(hasActiveGatherFavor(actorWithFavor, 5)).toBe(true);
  expect(hasActiveGatherFavor(actorWithFavor, 10)).toBe(false);
  expect(hasActiveGatherFavor({ ...actorWithFavor, favors: [] }, 5)).toBe(
    false,
  );
});

test("a second worship act appends another favor rather than replacing the first", () => {
  const state = createInitialWorldState(pack());
  const once = applyWorshipPerformed(
    state,
    toEntityId("farmer"),
    toEntityId("zeus"),
    undefined,
    FAVOR_EFFECT,
    10,
  );
  const twice = applyWorshipPerformed(
    once,
    toEntityId("farmer"),
    toEntityId("zeus"),
    undefined,
    FAVOR_EFFECT,
    20,
  );
  expect(twice.actors.get(toEntityId("farmer"))?.favors).toHaveLength(2);
});
