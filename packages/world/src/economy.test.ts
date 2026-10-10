import { expect, test } from "bun:test";
import type { ContentPack } from "@panthea/contracts";
import {
  applyRecipe,
  creditActorInventory,
  debitActorInventory,
  evaluateTradeAcceptance,
  getResourceAmount,
  NEUTRAL_DRIVES,
  resourceValue,
  transferBetweenActors,
} from "./economy";
import {
  type ActorState,
  createInitialWorldState,
  toEntityId,
  type WorldState,
  withActor,
} from "./state";
import { testActor } from "./test-actor";

function mustGetActor(state: WorldState, id: string): ActorState {
  const actor = state.actors.get(toEntityId(id));
  if (!actor) throw new Error(`test fixture is missing actor: ${id}`);
  return actor;
}

function minimalRules(
  economyBalance: Record<string, number> = {},
): ContentPack["rules"] {
  return {
    catchUpCapMs: 0,
    catchUpChunkMs: 0,
    checkpointIntervalMs: 0,
    maxProposalsPerTick: 100,
    fireBalance: {},
    economyBalance,
  };
}

function twoActorPack(): ContentPack {
  return {
    schemaVersion: 1,
    realms: ["mortal"],
    resources: [],
    locations: [{ id: "square", realm: "mortal", name: "Square", edges: [] }],
    buildings: [],
    inhabitants: [],
    rules: minimalRules(),
    recipes: {},
  };
}

function stateWithTwoActors() {
  let state = createInitialWorldState(twoActorPack());
  state = withActor(
    state,
    testActor({
      id: toEntityId("a"),
      locationId: toEntityId("square"),
      alive: true,
      capabilities: [],
      inventory: new Map([["wood", 4]]),
      revision: 0,
    }),
  );
  state = withActor(
    state,
    testActor({
      id: toEntityId("b"),
      locationId: toEntityId("square"),
      alive: true,
      capabilities: [],
      inventory: new Map([["currency", 10]]),
      revision: 0,
    }),
  );
  return state;
}

test("getResourceAmount defaults to zero for an absent resource", () => {
  expect(getResourceAmount(new Map(), "wood")).toBe(0);
  expect(getResourceAmount(new Map([["wood", 3]]), "wood")).toBe(3);
});

test("creditActorInventory adds to the named resource and bumps the actor's revision", () => {
  const state = stateWithTwoActors();
  const next = creditActorInventory(state, toEntityId("a"), "wood", 2);
  expect(getResourceAmount(mustGetActor(next, "a").inventory, "wood")).toBe(6);
  expect(mustGetActor(next, "a").revision).toBe(1);
  // The other actor is untouched.
  expect(next.actors.get(toEntityId("b"))).toEqual(
    state.actors.get(toEntityId("b")),
  );
});

test("debitActorInventory removes from the named resource and deletes it at zero", () => {
  const state = stateWithTwoActors();
  const next = debitActorInventory(state, toEntityId("a"), "wood", 4);
  expect(getResourceAmount(mustGetActor(next, "a").inventory, "wood")).toBe(0);
  expect(mustGetActor(next, "a").inventory.has("wood")).toBe(false);
});

test("transferBetweenActors throws when the giver and receiver are the same actor", () => {
  const state = stateWithTwoActors();
  expect(() =>
    transferBetweenActors(
      state,
      toEntityId("a"),
      toEntityId("a"),
      [{ resource: "wood", amount: 4 }],
      [{ resource: "currency", amount: 2 }],
    ),
  ).toThrow();
});

test("transferBetweenActors moves give and receive lines in opposite directions, conserving the total", () => {
  const state = stateWithTwoActors();
  const next = transferBetweenActors(
    state,
    toEntityId("a"),
    toEntityId("b"),
    [{ resource: "wood", amount: 4 }],
    [{ resource: "currency", amount: 2 }],
  );
  const a = mustGetActor(next, "a");
  const b = mustGetActor(next, "b");
  expect(getResourceAmount(a.inventory, "wood")).toBe(0);
  expect(getResourceAmount(a.inventory, "currency")).toBe(2);
  expect(getResourceAmount(b.inventory, "wood")).toBe(4);
  expect(getResourceAmount(b.inventory, "currency")).toBe(8);
  expect(a.revision).toBe(1);
  expect(b.revision).toBe(1);
  // Combined totals across both actors are unchanged by the transfer.
  const totalWood =
    getResourceAmount(a.inventory, "wood") +
    getResourceAmount(b.inventory, "wood");
  const totalCurrency =
    getResourceAmount(a.inventory, "currency") +
    getResourceAmount(b.inventory, "currency");
  expect(totalWood).toBe(4);
  expect(totalCurrency).toBe(10);
});

test("applyRecipe converts inputs into outputs scaled by quantity", () => {
  const state = stateWithTwoActors();
  const recipe = {
    inputs: [{ resource: "wood", amount: 2 }],
    outputs: [{ resource: "planks", amount: 1 }],
  };
  const next = applyRecipe(state, toEntityId("a"), recipe, 2);
  const a = mustGetActor(next, "a");
  expect(getResourceAmount(a.inventory, "wood")).toBe(0);
  expect(getResourceAmount(a.inventory, "planks")).toBe(2);
  expect(a.revision).toBe(1);
});

test("resourceValue falls back to 1 for a resource with no configured value", () => {
  const rules = minimalRules({ value_wood: 3 });
  expect(resourceValue(rules, "wood")).toBe(3);
  expect(resourceValue(rules, "unlisted")).toBe(1);
});

test("evaluateTradeAcceptance accepts a fair trade at neutral drives", () => {
  const rules = minimalRules({ value_wood: 1, value_currency: 1 });
  const accepted = evaluateTradeAcceptance(
    rules,
    NEUTRAL_DRIVES,
    [{ resource: "wood", amount: 2 }],
    [{ resource: "currency", amount: 2 }],
  );
  expect(accepted).toBe(true);
});

test("evaluateTradeAcceptance declines a trade a high-thrift, low-greed counterparty finds unfavorable", () => {
  const rules = minimalRules({ value_wood: 1, value_currency: 1 });
  const declined = evaluateTradeAcceptance(
    rules,
    { thrift: 0.9, appetite: 0, greed: 0, piety: 0 },
    [{ resource: "wood", amount: 2 }],
    [{ resource: "currency", amount: 2 }],
  );
  expect(declined).toBe(false);
});

test("evaluateTradeAcceptance accepts the same trade for a greedier counterparty", () => {
  const rules = minimalRules({ value_wood: 1, value_currency: 1 });
  const accepted = evaluateTradeAcceptance(
    rules,
    { thrift: 0, appetite: 0, greed: 0.5, piety: 0 },
    [{ resource: "wood", amount: 2 }],
    [{ resource: "currency", amount: 2 }],
  );
  expect(accepted).toBe(true);
});

test("conservation: gather is a source, consume is a sink, trade is zero-sum, produce converts one total into another", () => {
  let state = stateWithTwoActors();
  const before = {
    wood:
      getResourceAmount(mustGetActor(state, "a").inventory, "wood") +
      getResourceAmount(mustGetActor(state, "b").inventory, "wood"),
    currency:
      getResourceAmount(mustGetActor(state, "a").inventory, "currency") +
      getResourceAmount(mustGetActor(state, "b").inventory, "currency"),
    planks: 0,
  };

  // Source: gather adds wood from nothing.
  state = creditActorInventory(state, toEntityId("a"), "wood", 3);
  // Sink: consume removes currency (standing in for any consumable).
  state = debitActorInventory(state, toEntityId("b"), "currency", 1);
  // Zero-sum: trade moves resources between the two actors only.
  state = transferBetweenActors(
    state,
    toEntityId("a"),
    toEntityId("b"),
    [{ resource: "wood", amount: 2 }],
    [{ resource: "currency", amount: 2 }],
  );
  // Convert: produce turns wood into planks (sink on wood, source on planks).
  state = applyRecipe(
    state,
    toEntityId("b"),
    {
      inputs: [{ resource: "wood", amount: 2 }],
      outputs: [{ resource: "planks", amount: 1 }],
    },
    1,
  );

  const a = mustGetActor(state, "a");
  const b = mustGetActor(state, "b");
  const after = {
    wood:
      getResourceAmount(a.inventory, "wood") +
      getResourceAmount(b.inventory, "wood"),
    currency:
      getResourceAmount(a.inventory, "currency") +
      getResourceAmount(b.inventory, "currency"),
    planks:
      getResourceAmount(a.inventory, "planks") +
      getResourceAmount(b.inventory, "planks"),
  };

  // Wood: +3 gathered, -2 consumed by the recipe conversion.
  expect(after.wood).toBe(before.wood + 3 - 2);
  // Currency: -1 consumed; the trade only moved it between actors.
  expect(after.currency).toBe(before.currency - 1);
  // Planks: +1 produced from nothing the world had before.
  expect(after.planks).toBe(before.planks + 1);
});
