import { expect, test } from "bun:test";
import type { ContentPack } from "@panthea/contracts";
import {
  actorHoldsEnoughToRepair,
  applyBuildingRepaired,
  applyRepairProgressed,
  findRepairableBuilding,
  REPAIR_RESOURCE,
  repairAmountPerTickOf,
  repairCostOf,
} from "./repair";
import {
  buildingBase,
  createInitialWorldState,
  toEntityId,
  type WorldState,
  withActor,
  withBuilding,
} from "./state";

function pack(): ContentPack {
  return {
    schemaVersion: 1,
    realms: ["mortal"],
    resources: [],
    locations: [
      { id: "town-square", realm: "mortal", name: "Town Square", edges: [] },
    ],
    buildings: [
      {
        id: "the-tavern",
        locationId: "town-square",
        name: "The Tavern",
        material: "wood",
        combustible: true,
        services: ["drink"],
        inventory: [],
        owner: "farmer",
      },
    ],
    inhabitants: [
      {
        id: "farmer",
        sprite: "placeholder-farmer",
        name: "The Farmer",
        locationId: "town-square",
        startingInventory: [{ resource: "planks", amount: 3 }],
      },
    ],
    rules: {
      catchUpCapMs: 0,
      catchUpChunkMs: 0,
      checkpointIntervalMs: 0,
      maxProposalsPerTick: 100,
      fireBalance: {},
      economyBalance: { repairCostPlanks: 2, repairAmountPerTick: 1 },
    },
    recipes: {},
  };
}

function destroyedState(): WorldState {
  const state = createInitialWorldState(pack());
  const tavern = state.buildings.get(toEntityId("the-tavern"));
  if (!tavern) throw new Error("expected the tavern fixture building");
  return withBuilding(state, { ...buildingBase(tavern), status: "destroyed" });
}

test("repairCostOf and repairAmountPerTickOf read the content-authored balance", () => {
  const state = createInitialWorldState(pack());
  expect(repairCostOf(state)).toBe(2);
  expect(repairAmountPerTickOf(state)).toBe(1);
});

test("REPAIR_RESOURCE is planks", () => {
  expect(REPAIR_RESOURCE).toBe("planks");
});

test("findRepairableBuilding finds a destroyed building the actor owns", () => {
  const state = destroyedState();
  const building = findRepairableBuilding(state, toEntityId("farmer"));
  expect(building?.id).toBe(toEntityId("the-tavern"));
});

test("findRepairableBuilding finds nothing for an operational building", () => {
  const state = createInitialWorldState(pack());
  expect(findRepairableBuilding(state, toEntityId("farmer"))).toBeUndefined();
});

test("actorHoldsEnoughToRepair is true only once the actor holds the per-tick amount", () => {
  const state = destroyedState();
  expect(actorHoldsEnoughToRepair(state, toEntityId("farmer"))).toBe(true);
  const farmer = state.actors.get(toEntityId("farmer"));
  if (!farmer) throw new Error("expected the farmer fixture actor");
  const depleted = withActor(state, { ...farmer, inventory: new Map() });
  expect(actorHoldsEnoughToRepair(depleted, toEntityId("farmer"))).toBe(false);
});

test("applyRepairProgressed debits the repairer and credits the building's progress, entering repairing", () => {
  const state = destroyedState();
  const next = applyRepairProgressed(
    state,
    toEntityId("farmer"),
    toEntityId("the-tavern"),
    "planks",
    1,
  );
  expect(next.actors.get(toEntityId("farmer"))?.inventory.get("planks")).toBe(
    2,
  );
  expect(next.buildings.get(toEntityId("the-tavern"))).toMatchObject({
    status: "repairing",
    repairProgress: 1,
  });
});

test("applyBuildingRepaired restores operational status and clears repair progress", () => {
  const state = destroyedState();
  const tavern = state.buildings.get(toEntityId("the-tavern"));
  if (!tavern) throw new Error("expected the tavern fixture building");
  const inProgress = withBuilding(state, {
    ...buildingBase(tavern),
    status: "repairing",
    repairProgress: 2,
  });
  const next = applyBuildingRepaired(inProgress, toEntityId("the-tavern"));
  const repaired = next.buildings.get(toEntityId("the-tavern"));
  expect(repaired?.status).toBe("operational");
  expect(repaired?.repairProgress).toBeUndefined();
});
