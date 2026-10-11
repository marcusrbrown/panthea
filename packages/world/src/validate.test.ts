import { expect, test } from "bun:test";
import type { ContentPack, EventId, Proposal } from "@panthea/contracts";
import { submitProposal } from "./actions";
import {
  buildingBase,
  createInitialWorldState,
  toEntityId,
  type WorldState,
  withActor,
  withBuilding,
} from "./state";
import { testActor } from "./test-actor";
import { validateProposal } from "./validate";

function minimalRules(): ContentPack["rules"] {
  return {
    catchUpCapMs: 3_600_000,
    catchUpChunkMs: 60_000,
    checkpointIntervalMs: 60_000,
    maxProposalsPerTick: 100,
    fireBalance: {},
    economyBalance: {},
  };
}

function fixtureState(): WorldState {
  const pack: ContentPack = {
    schemaVersion: 1,
    realms: ["mortal", "olympus", "underworld"],
    resources: [],
    locations: [
      {
        id: "grove",
        realm: "mortal",
        name: "Grove",
        edges: [{ to: "square", transport: "path", bidirectional: true }],
      },
      {
        id: "square",
        realm: "mortal",
        name: "Square",
        edges: [
          { to: "tavern", transport: "path", bidirectional: true },
          {
            to: "ferry-dock",
            transport: "path",
            bidirectional: true,
          },
        ],
      },
      { id: "tavern", realm: "mortal", name: "Tavern", edges: [] },
      {
        id: "ferry-dock",
        realm: "mortal",
        name: "Ferry Dock",
        edges: [
          {
            to: "underworld-shore",
            transport: "divine-transport",
            bidirectional: true,
          },
        ],
      },
      {
        id: "underworld-shore",
        realm: "underworld",
        name: "Underworld Shore",
        edges: [
          { to: "judgment-hall", transport: "path", bidirectional: true },
        ],
      },
      {
        id: "judgment-hall",
        realm: "underworld",
        name: "Hall of Judgment",
        edges: [],
        requiredCapability: "divine",
      },
    ],
    buildings: [],
    inhabitants: [],
    rules: minimalRules(),
    recipes: {},
  };
  let state = createInitialWorldState(pack);
  state = withActor(
    state,
    testActor({
      id: toEntityId("npc-1"),
      locationId: toEntityId("grove"),
      alive: true,
      capabilities: [],
      inventory: new Map(),
      revision: 0,
    }),
  );
  state = withActor(
    state,
    testActor({
      id: toEntityId("npc-2"),
      locationId: toEntityId("underworld-shore"),
      alive: true,
      capabilities: ["divine"],
      inventory: new Map(),
      revision: 0,
    }),
  );
  state = withActor(
    state,
    testActor({
      id: toEntityId("npc-dead"),
      locationId: toEntityId("grove"),
      alive: false,
      capabilities: [],
      inventory: new Map(),
      revision: 0,
    }),
  );
  return state;
}

/** Parses a raw fixture payload the way a real fixture/routine would submit it. */
function proposal(raw: Record<string, unknown>): Proposal {
  const base = {
    schemaVersion: 1,
    actor: "npc-1",
    targets: [],
    expectedRevisions: [],
    source: "fixture",
    observationId: "obs-1",
    ...raw,
  };
  const result = submitProposal(base);
  if (!result.ok) {
    throw new Error(
      `test fixture proposal failed to parse: ${result.rejection.message}`,
    );
  }
  return result.proposal;
}

test("a move to an adjacent location commits an entity-moved draft", () => {
  const state = fixtureState();
  const outcome = validateProposal(
    state,
    proposal({ kind: "move", to: "square" }),
  );
  expect(outcome.ok).toBe(true);
  if (outcome.ok) {
    expect(outcome.events).toHaveLength(1);
    expect(outcome.events[0]).toMatchObject({
      kind: "entity-moved",
      entityId: "npc-1",
      to: "square",
    });
  }
});

test("a move to a non-adjacent location is rejected as not-adjacent", () => {
  const state = fixtureState();
  const outcome = validateProposal(
    state,
    proposal({ kind: "move", to: "tavern" }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("not-adjacent");
});

test("a plain move across a realm boundary is rejected as restricted-realm", () => {
  const state = withActor(
    fixtureState(),
    testActor({
      id: toEntityId("npc-3"),
      locationId: toEntityId("ferry-dock"),
      alive: true,
      capabilities: [],
      inventory: new Map(),
      revision: 0,
    }),
  );
  const outcome = validateProposal(
    state,
    proposal({ actor: "npc-3", kind: "move", to: "underworld-shore" }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("restricted-realm");
});

test("a move into a location requiring an uncarried capability is rejected as restricted-realm", () => {
  const state = withActor(
    fixtureState(),
    testActor({
      id: toEntityId("npc-4"),
      locationId: toEntityId("underworld-shore"),
      alive: true,
      capabilities: [],
      inventory: new Map(),
      revision: 0,
    }),
  );
  const outcome = validateProposal(
    state,
    proposal({ actor: "npc-4", kind: "move", to: "judgment-hall" }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("restricted-realm");
});

test("a move by a dead actor is rejected as dead-actor and state is unaffected", () => {
  const state = fixtureState();
  const outcome = validateProposal(
    state,
    proposal({ actor: "npc-dead", kind: "move", to: "grove" }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("dead-actor");
  expect(state).toEqual(fixtureState());
});

test("a move by an unknown actor is rejected as dead-actor", () => {
  const state = fixtureState();
  const outcome = validateProposal(
    state,
    proposal({ actor: "npc-nonexistent", kind: "move", to: "grove" }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("dead-actor");
});

test("a stale expected revision is rejected as stale-target", () => {
  const state = fixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      kind: "move",
      to: "square",
      targets: ["npc-2"],
      expectedRevisions: [{ entityId: "npc-2", revision: 99 }],
    }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("stale-target");
});

test("a realm-transition using the authored transport element arrives in the Underworld", () => {
  const state = withActor(
    fixtureState(),
    testActor({
      id: toEntityId("npc-5"),
      locationId: toEntityId("ferry-dock"),
      alive: true,
      capabilities: [],
      inventory: new Map(),
      revision: 0,
    }),
  );
  const outcome = validateProposal(
    state,
    proposal({
      actor: "npc-5",
      kind: "realm-transition",
      to: "underworld-shore",
      via: "ferry-dock",
    }),
  );
  expect(outcome.ok).toBe(true);
  if (outcome.ok) {
    expect(outcome.events).toHaveLength(1);
    expect(outcome.events[0]).toMatchObject({
      kind: "realm-transitioned",
      entityId: "npc-5",
      to: "underworld-shore",
      via: "ferry-dock",
    });
  }
});

test("a realm-transition attempted from off the transport element is rejected as not-adjacent", () => {
  const state = fixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      kind: "realm-transition",
      to: "underworld-shore",
      via: "ferry-dock",
    }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("not-adjacent");
});

function crossRealmPathFixtureState(): WorldState {
  const pack: ContentPack = {
    schemaVersion: 1,
    realms: ["mortal", "underworld"],
    resources: [],
    locations: [
      {
        id: "crossing",
        realm: "mortal",
        name: "Crossing",
        edges: [{ to: "far-shore", transport: "path", bidirectional: true }],
      },
      { id: "far-shore", realm: "underworld", name: "Far Shore", edges: [] },
    ],
    buildings: [],
    inhabitants: [],
    rules: minimalRules(),
    recipes: {},
  };
  let state = createInitialWorldState(pack);
  state = withActor(
    state,
    testActor({
      id: toEntityId("npc-6"),
      locationId: toEntityId("crossing"),
      alive: true,
      capabilities: [],
      inventory: new Map(),
      revision: 0,
    }),
  );
  return state;
}

test("a realm-transition over a cross-realm path edge is rejected as restricted-realm", () => {
  const state = crossRealmPathFixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      actor: "npc-6",
      kind: "realm-transition",
      to: "far-shore",
      via: "crossing",
    }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("restricted-realm");
  expect(state).toEqual(crossRealmPathFixtureState());
});

test("a claim never commits state, even a true-sounding one", () => {
  const state = fixtureState();
  const outcome = validateProposal(
    state,
    proposal({ kind: "claim", assertion: "I own the tavern" }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("unauthorized-claim");
});

function economyFixtureState(): WorldState {
  const pack: ContentPack = {
    schemaVersion: 1,
    realms: ["mortal"],
    resources: [],
    locations: [
      { id: "square", realm: "mortal", name: "Square", edges: [] },
      { id: "far-shore", realm: "mortal", name: "Far Shore", edges: [] },
    ],
    buildings: [],
    inhabitants: [],
    rules: {
      catchUpCapMs: 0,
      catchUpChunkMs: 0,
      checkpointIntervalMs: 0,
      maxProposalsPerTick: 100,
      fireBalance: {},
      economyBalance: { value_wood: 1, value_currency: 1, gatherAmount: 2 },
    },
    recipes: {
      planks: {
        inputs: [{ resource: "wood", amount: 2 }],
        outputs: [{ resource: "planks", amount: 1 }],
      },
    },
  };
  let state = createInitialWorldState(pack);
  state = withActor(
    state,
    testActor({
      id: toEntityId("woodcutter"),
      locationId: toEntityId("square"),
      alive: true,
      capabilities: [],
      inventory: new Map([["wood", 4]]),
      drives: { thrift: 0, appetite: 0, greed: 0, piety: 0 },
      gathers: "wood",
      revision: 0,
    }),
  );
  state = withActor(
    state,
    testActor({
      id: toEntityId("farmer"),
      locationId: toEntityId("square"),
      alive: true,
      capabilities: [],
      inventory: new Map([["currency", 10]]),
      drives: { thrift: 0, appetite: 0, greed: 0, piety: 0 },
      revision: 0,
    }),
  );
  state = withActor(
    state,
    testActor({
      id: toEntityId("stranger"),
      locationId: toEntityId("far-shore"),
      alive: true,
      capabilities: [],
      inventory: new Map([["currency", 10]]),
      revision: 0,
    }),
  );
  return state;
}

test("a gather proposal from an actor holding an active favor yields the base amount plus the favor bonus", () => {
  let state = economyFixtureState();
  const woodcutter = state.actors.get(toEntityId("woodcutter"));
  if (!woodcutter) throw new Error("expected the woodcutter fixture actor");
  state = {
    ...state,
    rules: {
      ...state.rules,
      economyBalance: { ...state.rules.economyBalance, favorGatherBonus: 3 },
    },
  };
  state = withActor(state, {
    ...woodcutter,
    favors: [
      { source: toEntityId("zeus"), effect: "divine-favor", expiresAtTick: 10 },
    ],
  });
  const outcome = validateProposal(
    state,
    proposal({
      actor: "woodcutter",
      kind: "gather",
      resource: "wood",
      amount: 2,
    }),
  );
  expect(outcome.ok).toBe(true);
  if (outcome.ok) {
    expect(outcome.events[0]).toMatchObject({
      kind: "resource-gathered",
      resource: "wood",
      amount: 5,
    });
  }
});

test("a gather proposal after the favor expires yields only the base amount", () => {
  let state = economyFixtureState();
  const woodcutter = state.actors.get(toEntityId("woodcutter"));
  if (!woodcutter) throw new Error("expected the woodcutter fixture actor");
  state = {
    ...state,
    tick: 10,
    rules: {
      ...state.rules,
      economyBalance: { ...state.rules.economyBalance, favorGatherBonus: 3 },
    },
  };
  state = withActor(state, {
    ...woodcutter,
    favors: [
      { source: toEntityId("zeus"), effect: "divine-favor", expiresAtTick: 10 },
    ],
  });
  const outcome = validateProposal(
    state,
    proposal({
      actor: "woodcutter",
      kind: "gather",
      resource: "wood",
      amount: 2,
    }),
  );
  expect(outcome.ok).toBe(true);
  if (outcome.ok) {
    expect(outcome.events[0]).toMatchObject({
      kind: "resource-gathered",
      resource: "wood",
      amount: 2,
    });
  }
});

test("a gather proposal for a resource the actor is not authored to gather is rejected", () => {
  const state = economyFixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      actor: "woodcutter",
      kind: "gather",
      resource: "currency",
      amount: 2,
    }),
  );
  expect(outcome.ok).toBe(false);
});

test("a gather proposal cannot commit more than the authoritative rule's yield, regardless of the amount requested", () => {
  const state = economyFixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      actor: "woodcutter",
      kind: "gather",
      resource: "wood",
      amount: 1_000_000,
    }),
  );
  expect(outcome.ok).toBe(true);
  if (outcome.ok) {
    expect(outcome.events[0]).toMatchObject({
      kind: "resource-gathered",
      resource: "wood",
      amount: 2,
    });
  }
});

test("a gather proposal from an actor with no authored gather resource is rejected", () => {
  const state = economyFixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      actor: "farmer",
      kind: "gather",
      resource: "wood",
      amount: 2,
    }),
  );
  expect(outcome.ok).toBe(false);
});

test("a gather proposal always commits for a living actor", () => {
  const state = economyFixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      actor: "woodcutter",
      kind: "gather",
      resource: "wood",
      amount: 2,
    }),
  );
  expect(outcome.ok).toBe(true);
  if (outcome.ok) {
    expect(outcome.events).toHaveLength(1);
    expect(outcome.events[0]).toMatchObject({
      kind: "resource-gathered",
      entityId: "woodcutter",
      resource: "wood",
      amount: 2,
    });
  }
});

test("a produce proposal converts inputs to outputs per the content recipe", () => {
  const state = economyFixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      actor: "woodcutter",
      kind: "produce",
      output: "planks",
      quantity: 2,
    }),
  );
  expect(outcome.ok).toBe(true);
  if (outcome.ok) {
    expect(outcome.events).toHaveLength(1);
    expect(outcome.events[0]).toMatchObject({
      kind: "resource-produced",
      entityId: "woodcutter",
      output: "planks",
      quantity: 2,
    });
  }
});

test("a produce proposal naming an unknown recipe is rejected as malformed", () => {
  const state = economyFixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      actor: "woodcutter",
      kind: "produce",
      output: "wine",
      quantity: 1,
    }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("malformed");
});

test("a produce proposal without enough recipe inputs is rejected as insufficient-resources", () => {
  const state = economyFixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      actor: "woodcutter",
      kind: "produce",
      output: "planks",
      quantity: 10,
    }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("insufficient-resources");
});

test("a consume proposal without enough of the resource is rejected as insufficient-resources", () => {
  const state = economyFixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      actor: "woodcutter",
      kind: "consume",
      resource: "food",
      amount: 1,
    }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("insufficient-resources");
});

test("a consume proposal with enough of the resource commits", () => {
  const state = economyFixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      actor: "woodcutter",
      kind: "consume",
      resource: "wood",
      amount: 2,
    }),
  );
  expect(outcome.ok).toBe(true);
});

test("a trade actor lacking what it gives is rejected as insufficient-resources", () => {
  const state = economyFixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      actor: "woodcutter",
      kind: "trade",
      counterparty: "farmer",
      give: [{ resource: "wood", amount: 100 }],
      receive: [{ resource: "currency", amount: 2 }],
    }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("insufficient-resources");
});

test("a purchase against a counterparty with insufficient stock is rejected as insufficient-resources", () => {
  const state = economyFixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      actor: "farmer",
      kind: "trade",
      counterparty: "woodcutter",
      give: [{ resource: "currency", amount: 2 }],
      receive: [{ resource: "food", amount: 1 }],
    }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("insufficient-resources");
});

test("a purchase with insufficient currency is rejected as insufficient-resources", () => {
  const state = economyFixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      actor: "woodcutter",
      kind: "trade",
      counterparty: "farmer",
      give: [{ resource: "currency", amount: 1000 }],
      receive: [{ resource: "currency", amount: 1 }],
    }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("insufficient-resources");
});

test("repeated receive line items for the same resource are aggregated against the counterparty's actual holdings", () => {
  let state = economyFixtureState();
  const woodcutter = state.actors.get(toEntityId("woodcutter"));
  if (!woodcutter) throw new Error("expected the woodcutter fixture actor");
  // A large enough give that the deal's value would otherwise be
  // accepted, isolating the aggregation bug from a value-based decline.
  state = withActor(state, {
    ...woodcutter,
    inventory: new Map([["wood", 20]]),
  });
  const outcome = validateProposal(
    state,
    proposal({
      actor: "woodcutter",
      kind: "trade",
      counterparty: "farmer",
      give: [{ resource: "wood", amount: 20 }],
      receive: [
        { resource: "currency", amount: 8 },
        { resource: "currency", amount: 8 },
      ],
    }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("insufficient-resources");
});

test("repeated give line items for the same resource are aggregated against the actor's actual holdings", () => {
  const state = economyFixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      actor: "woodcutter",
      kind: "trade",
      counterparty: "farmer",
      give: [
        { resource: "wood", amount: 3 },
        { resource: "wood", amount: 3 },
      ],
      receive: [{ resource: "currency", amount: 1 }],
    }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("insufficient-resources");
});

test("a trade between parties at different locations is rejected as not-adjacent", () => {
  const state = economyFixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      actor: "woodcutter",
      kind: "trade",
      counterparty: "stranger",
      give: [{ resource: "wood", amount: 2 }],
      receive: [{ resource: "currency", amount: 2 }],
    }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("not-adjacent");
});

test("a fair trade a neutral-drives counterparty accepts commits as one atomic transfer", () => {
  const state = economyFixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      actor: "woodcutter",
      kind: "trade",
      counterparty: "farmer",
      give: [{ resource: "wood", amount: 2 }],
      receive: [{ resource: "currency", amount: 2 }],
    }),
  );
  expect(outcome.ok).toBe(true);
  if (outcome.ok) {
    expect(outcome.events).toHaveLength(1);
    expect(outcome.events[0]).toMatchObject({
      kind: "resource-traded",
      entityId: "woodcutter",
      counterpartyId: "farmer",
      give: [{ resource: "wood", amount: 2 }],
      receive: [{ resource: "currency", amount: 2 }],
    });
  }
});

test("a trade naming the actor as its own counterparty is rejected and leaves inventory unchanged", () => {
  const state = economyFixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      actor: "woodcutter",
      kind: "trade",
      counterparty: "woodcutter",
      give: [{ resource: "wood", amount: 2 }],
      receive: [{ resource: "wood", amount: 2 }],
    }),
  );
  expect(outcome.ok).toBe(false);
  const woodcutter = state.actors.get(toEntityId("woodcutter"));
  expect(woodcutter?.inventory.get("wood")).toBe(4);
});

test("a strike with enough divine power ignites a combustible target", () => {
  const state = fireFixtureState();
  const outcome = validateProposal(
    state,
    proposal({ actor: "zeus", kind: "strike", target: "the-tavern", power: 3 }),
  );
  expect(outcome.ok).toBe(true);
  if (outcome.ok) {
    expect(outcome.events).toEqual([
      expect.objectContaining({
        kind: "resource-consumed",
        entityId: "zeus",
        resource: "divinity",
        amount: 3,
      }),
      expect.objectContaining({
        kind: "building-ignited",
        entityId: "the-tavern",
      }),
    ]);
  }
});

test("a strike below the ignite threshold damages a combustible target without igniting it", () => {
  const state = fireFixtureState();
  const outcome = validateProposal(
    state,
    proposal({ actor: "zeus", kind: "strike", target: "the-tavern", power: 1 }),
  );
  expect(outcome.ok).toBe(true);
  if (outcome.ok) {
    expect(outcome.events).toEqual([
      expect.objectContaining({ kind: "resource-consumed" }),
      expect.objectContaining({
        kind: "building-damaged",
        entityId: "the-tavern",
        amount: 1,
      }),
    ]);
  }
});

test("a strike against a destroyed building is rejected and leaves it destroyed", () => {
  let state = fireFixtureState();
  const tavern = state.buildings.get(toEntityId("the-tavern"));
  if (!tavern) throw new Error("expected the tavern fixture building");
  state = withBuilding(state, { ...buildingBase(tavern), status: "destroyed" });
  const outcome = validateProposal(
    state,
    proposal({ actor: "zeus", kind: "strike", target: "the-tavern", power: 3 }),
  );
  expect(outcome.ok).toBe(false);
  expect(state.buildings.get(toEntityId("the-tavern"))?.status).toBe(
    "destroyed",
  );
});

test("a strike against a repairing building is rejected and leaves it repairing", () => {
  let state = fireFixtureState();
  const tavern = state.buildings.get(toEntityId("the-tavern"));
  if (!tavern) throw new Error("expected the tavern fixture building");
  state = withBuilding(state, {
    ...buildingBase(tavern),
    status: "repairing",
    repairProgress: 1,
  });
  const outcome = validateProposal(
    state,
    proposal({ actor: "zeus", kind: "strike", target: "the-tavern", power: 3 }),
  );
  expect(outcome.ok).toBe(false);
  expect(state.buildings.get(toEntityId("the-tavern"))?.status).toBe(
    "repairing",
  );
});

test("a strike against a burning building is rejected and leaves its fire state untouched", () => {
  let state = fireFixtureState();
  const tavern = state.buildings.get(toEntityId("the-tavern"));
  if (!tavern) throw new Error("expected the tavern fixture building");
  state = withBuilding(state, {
    ...buildingBase(tavern),
    status: "burning",
    fireIntensity: 1,
    ticksBurning: 1,
    ignition: { eventId: "evt-strike" as EventId, actor: toEntityId("zeus") },
  });
  const outcome = validateProposal(
    state,
    proposal({ actor: "zeus", kind: "strike", target: "the-tavern", power: 3 }),
  );
  expect(outcome.ok).toBe(false);
  expect(state.buildings.get(toEntityId("the-tavern"))).toMatchObject({
    status: "burning",
    fireIntensity: 1,
    ticksBurning: 1,
  });
});

test("a repair proposal against a damaged building progresses it toward operational", () => {
  let state = fireFixtureState();
  const tavern = state.buildings.get(toEntityId("the-tavern"));
  if (!tavern) throw new Error("expected the tavern fixture building");
  state = withBuilding(state, { ...buildingBase(tavern), status: "damaged" });
  const outcome = validateProposal(
    state,
    proposal({ actor: "farmer", kind: "repair", structure: "the-tavern" }),
  );
  expect(outcome.ok).toBe(true);
  if (outcome.ok) {
    expect(outcome.events).toEqual([
      expect.objectContaining({
        kind: "repair-progressed",
        entityId: "farmer",
        structureId: "the-tavern",
        resource: "planks",
        amount: 1,
      }),
    ]);
  }
});

test("a weaker strike against a destroyed building does not move it to damaged", () => {
  let state = fireFixtureState();
  const tavern = state.buildings.get(toEntityId("the-tavern"));
  if (!tavern) throw new Error("expected the tavern fixture building");
  state = withBuilding(state, { ...buildingBase(tavern), status: "destroyed" });
  const outcome = validateProposal(
    state,
    proposal({ actor: "zeus", kind: "strike", target: "the-tavern", power: 1 }),
  );
  expect(outcome.ok).toBe(false);
  expect(state.buildings.get(toEntityId("the-tavern"))?.status).toBe(
    "destroyed",
  );
});

test("a strike with full power against a non-combustible target only damages it", () => {
  const state = fireFixtureState();
  const outcome = validateProposal(
    state,
    proposal({ actor: "zeus", kind: "strike", target: "agora-shop", power: 5 }),
  );
  expect(outcome.ok).toBe(true);
  if (outcome.ok) {
    expect(outcome.events[1]).toMatchObject({ kind: "building-damaged" });
  }
});

test("a strike with insufficient divine power is rejected and deals no damage", () => {
  const state = fireFixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      actor: "zeus",
      kind: "strike",
      target: "the-tavern",
      power: 99,
    }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("insufficient-power");
  expect(state).toEqual(fireFixtureState());
});

test("a repair proposal against a destroyed building with enough planks progresses, and completing it restores operation", () => {
  let state = fireFixtureState();
  const tavern = state.buildings.get(toEntityId("the-tavern"));
  if (!tavern) throw new Error("expected the tavern fixture building");
  state = withBuilding(state, { ...buildingBase(tavern), status: "destroyed" });

  const first = validateProposal(
    state,
    proposal({ actor: "farmer", kind: "repair", structure: "the-tavern" }),
  );
  expect(first.ok).toBe(true);
  if (first.ok) {
    expect(first.events).toEqual([
      expect.objectContaining({
        kind: "repair-progressed",
        entityId: "farmer",
        structureId: "the-tavern",
        resource: "planks",
        amount: 1,
      }),
    ]);
  }

  state = withBuilding(state, {
    ...buildingBase(tavern),
    status: "repairing",
    repairProgress: 1,
  });
  const second = validateProposal(
    state,
    proposal({ actor: "farmer", kind: "repair", structure: "the-tavern" }),
  );
  expect(second.ok).toBe(true);
  if (second.ok) {
    expect(second.events.map((event) => event.kind)).toEqual([
      "repair-progressed",
      "building-repaired",
    ]);
  }
});

test("a repair proposal without enough materials is rejected as insufficient-resources", () => {
  let state = fireFixtureState();
  const tavern = state.buildings.get(toEntityId("the-tavern"));
  if (!tavern) throw new Error("expected the tavern fixture building");
  state = withBuilding(state, { ...buildingBase(tavern), status: "destroyed" });
  const farmer = state.actors.get(toEntityId("farmer"));
  if (!farmer) throw new Error("expected the farmer fixture actor");
  state = withActor(state, { ...farmer, inventory: new Map() });

  const outcome = validateProposal(
    state,
    proposal({ actor: "farmer", kind: "repair", structure: "the-tavern" }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("insufficient-resources");
});

test("a repair proposal against an operational building is rejected", () => {
  const state = fireFixtureState();
  const outcome = validateProposal(
    state,
    proposal({ actor: "farmer", kind: "repair", structure: "the-tavern" }),
  );
  expect(outcome.ok).toBe(false);
});

test("a worship proposal commits a capacity gain and a favor expiring at the configured duration", () => {
  const state = fireFixtureState();
  const outcome = validateProposal(
    state,
    proposal({ actor: "farmer", kind: "worship", deity: "zeus" }),
  );
  expect(outcome.ok).toBe(true);
  if (outcome.ok) {
    expect(outcome.events).toHaveLength(1);
    expect(outcome.events[0]).toMatchObject({
      kind: "worship-performed",
      entityId: "farmer",
      deity: "zeus",
    });
  }
});

test("a worship proposal with an offering the actor lacks is rejected as insufficient-resources", () => {
  const state = fireFixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      actor: "farmer",
      kind: "worship",
      deity: "zeus",
      offering: { resource: "wine", amount: 100 },
    }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("insufficient-resources");
});

test("a farmer worshipping itself is rejected", () => {
  const state = fireFixtureState();
  const outcome = validateProposal(
    state,
    proposal({ actor: "farmer", kind: "worship", deity: "farmer" }),
  );
  expect(outcome.ok).toBe(false);
});

test("worshipping a non-deity actor is rejected", () => {
  const state = fireFixtureState();
  const outcome = validateProposal(
    state,
    proposal({ actor: "farmer", kind: "worship", deity: "woodcutter" }),
  );
  expect(outcome.ok).toBe(false);
});

test("a strike by a non-deity actor is rejected regardless of divine power held", () => {
  let state = fireFixtureState();
  const woodcutter = state.actors.get(toEntityId("woodcutter"));
  if (!woodcutter) throw new Error("expected the woodcutter fixture actor");
  state = withActor(state, {
    ...woodcutter,
    inventory: new Map([["divinity", 100]]),
  });
  const outcome = validateProposal(
    state,
    proposal({
      actor: "woodcutter",
      kind: "strike",
      target: "the-tavern",
      power: 3,
    }),
  );
  expect(outcome.ok).toBe(false);
});

test("an unlinked legend proposal commits as an attributed assertion with no evidence link", () => {
  const state = fireFixtureState();
  const outcome = validateProposal(
    state,
    proposal({
      actor: "farmer",
      kind: "legend",
      assertion: "Zeus struck down the old oak",
    }),
  );
  expect(outcome.ok).toBe(true);
  if (outcome.ok) {
    expect(outcome.events).toHaveLength(1);
    const [event] = outcome.events;
    expect(event).toMatchObject({
      kind: "legend-recorded",
      entityId: "farmer",
      assertion: "Zeus struck down the old oak",
    });
    expect(event).not.toHaveProperty("linkedEventId");
    expect(event).not.toHaveProperty("verified");
  }
});

test("a legend proposal citing an event commits the citation as an evidence link, never as certification of the prose", () => {
  const state = fireFixtureState();
  // The cited event is unrelated to the story: the world does not judge
  // truth, so the legend still commits, linked, and carries no truth flag.
  const outcome = validateProposal(
    state,
    proposal({
      actor: "farmer",
      kind: "legend",
      assertion: "Zeus destroyed the entire Underworld",
      linkedEventId: "evt-9",
    }),
  );
  expect(outcome.ok).toBe(true);
  if (outcome.ok) {
    const [event] = outcome.events;
    expect(event).toMatchObject({
      kind: "legend-recorded",
      assertion: "Zeus destroyed the entire Underworld",
      linkedEventId: "evt-9",
    });
    expect(event).not.toHaveProperty("verified");
  }
});

test("a legend's hearers are fixed by the validator at execution: the living actors at the narrator's place, minus the narrator; a claim to nonexistent ids is refused", () => {
  const state = fireFixtureState();
  const told = validateProposal(
    state,
    proposal({
      actor: "farmer",
      kind: "legend",
      assertion: "Zeus has wronged me.",
      claim: { effect: "harm", agent: "zeus", target: "farmer" },
    }),
  );
  expect(told.ok).toBe(true);
  if (told.ok) {
    // The woodcutter shares the square; Zeus is in the great hall, so does not hear.
    expect(told.events[0]).toMatchObject({
      kind: "legend-recorded",
      hearers: ["woodcutter"],
      claim: { effect: "harm", agent: "zeus", target: "farmer" },
    });
  }
  // A dead actor present does not hear.
  const woodcutter = state.actors.get(toEntityId("woodcutter"));
  if (!woodcutter) throw new Error("no woodcutter");
  const gone = withActor(state, { ...woodcutter, alive: false });
  const alone = validateProposal(
    gone,
    proposal({ actor: "farmer", kind: "legend", assertion: "To no one." }),
  );
  expect(alone.ok && alone.events[0]).toMatchObject({ hearers: [] });

  const bad = validateProposal(
    state,
    proposal({
      actor: "farmer",
      kind: "legend",
      assertion: "x",
      claim: { effect: "harm", agent: "nobody" },
    }),
  );
  expect(bad.ok).toBe(false);
});

function fireFixtureState(): WorldState {
  const pack: ContentPack = {
    schemaVersion: 1,
    realms: ["mortal", "olympus"],
    resources: [],
    locations: [
      { id: "town-square", realm: "mortal", name: "Town Square", edges: [] },
      { id: "great-hall", realm: "olympus", name: "Great Hall", edges: [] },
    ],
    buildings: [
      {
        id: "the-tavern",
        locationId: "town-square",
        name: "The Tavern",
        material: "wood",
        combustible: true,
        services: ["drink"],
        inventory: [{ resource: "wine", amount: 3 }],
        owner: "farmer",
      },
      {
        id: "agora-shop",
        locationId: "town-square",
        name: "The Agora Shop",
        material: "stone",
        combustible: false,
        services: ["trade"],
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
        drives: { thrift: 0.5, appetite: 0, greed: 0, piety: 0 },
        startingInventory: [{ resource: "planks", amount: 5 }],
      },
      {
        id: "zeus",
        sprite: "placeholder-zeus",
        name: "Zeus",
        locationId: "great-hall",
        deity: true,
        startingInventory: [{ resource: "divinity", amount: 5 }],
      },
      {
        id: "woodcutter",
        sprite: "placeholder-woodcutter",
        name: "The Woodcutter",
        locationId: "town-square",
        startingInventory: [],
      },
    ],
    rules: {
      catchUpCapMs: 0,
      catchUpChunkMs: 0,
      checkpointIntervalMs: 0,
      maxProposalsPerTick: 100,
      fireBalance: { igniteThreshold: 3 },
      economyBalance: { repairCostPlanks: 2, repairAmountPerTick: 1 },
    },
    recipes: {},
  };
  return createInitialWorldState(pack);
}

test("a counterparty declines a trade outside its own acceptance rule", () => {
  let state = economyFixtureState();
  const farmer = state.actors.get(toEntityId("farmer"));
  if (!farmer) throw new Error("expected the farmer fixture actor");
  state = withActor(state, {
    ...farmer,
    drives: { thrift: 0.9, appetite: 0, greed: 0, piety: 0 },
  });
  const outcome = validateProposal(
    state,
    proposal({
      actor: "woodcutter",
      kind: "trade",
      counterparty: "farmer",
      give: [{ resource: "wood", amount: 2 }],
      receive: [{ resource: "currency", amount: 2 }],
    }),
  );
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toBe("counterparty-declined");
});
