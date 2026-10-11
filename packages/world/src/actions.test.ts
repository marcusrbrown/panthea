import { expect, test } from "bun:test";
import type { ContentPack, Proposal } from "@panthea/contracts";
import { applyEvents, runTick, submitProposal } from "./actions";
import { decode, encode } from "./codec";
import {
  createInitialWorldState,
  createPrng,
  toEntityId,
  type WorldState,
  withActor,
} from "./state";
import { testActor } from "./test-actor";

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

function walkPack(): ContentPack {
  return {
    schemaVersion: 1,
    realms: ["mortal", "olympus", "underworld"],
    resources: [],
    locations: [
      {
        id: "wilderness",
        realm: "mortal",
        name: "Wilderness",
        edges: [{ to: "path", transport: "path", bidirectional: true }],
      },
      {
        id: "path",
        realm: "mortal",
        name: "Wilderness Path",
        edges: [{ to: "town", transport: "path", bidirectional: true }],
      },
      { id: "town", realm: "mortal", name: "Town Square", edges: [] },
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
        edges: [],
      },
    ],
    buildings: [],
    inhabitants: [],
    rules: minimalRules(),
    recipes: {},
  };
}

function walkState(): WorldState {
  const state = createInitialWorldState(walkPack());
  return withActor(
    state,
    testActor({
      id: toEntityId("wanderer"),
      locationId: toEntityId("wilderness"),
      alive: true,
      capabilities: [],
      inventory: new Map(),
      revision: 0,
    }),
  );
}

/** Parses a raw fixture payload the way a real fixture/routine would submit it. */
function proposal(raw: Record<string, unknown>): Proposal {
  const base = {
    schemaVersion: 1,
    actor: "wanderer",
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

function moveTo(to: string, overrides: Record<string, unknown> = {}): Proposal {
  return proposal({ kind: "move", to, ...overrides });
}

test("a wilderness-to-town walk commits one entity-moved event per step across ticks", () => {
  let state = walkState();

  const hop1 = runTick(state, createPrng(1), [moveTo("path")]);
  expect(hop1.rejected).toEqual([]);
  expect(hop1.committed).toHaveLength(1);
  expect(hop1.committed[0]?.events).toEqual([
    expect.objectContaining({
      kind: "entity-moved",
      entityId: "wanderer",
      to: "path",
    }),
  ]);
  state = hop1.state;
  expect(state.actors.get(toEntityId("wanderer"))).toMatchObject({
    locationId: "path",
  });

  const hop2 = runTick(state, hop1.prng, [moveTo("town")]);
  expect(hop2.rejected).toEqual([]);
  expect(hop2.committed[0]?.events).toEqual([
    expect.objectContaining({
      kind: "entity-moved",
      entityId: "wanderer",
      to: "town",
    }),
  ]);
  state = hop2.state;
  expect(state.actors.get(toEntityId("wanderer"))).toMatchObject({
    locationId: "town",
  });
});

test("a realm-transition proposal changes realm and location in one event", () => {
  const state = withActor(
    walkState(),
    testActor({
      id: toEntityId("ferryman"),
      locationId: toEntityId("ferry-dock"),
      alive: true,
      capabilities: [],
      inventory: new Map(),
      revision: 0,
    }),
  );

  const result = runTick(state, createPrng(1), [
    proposal({
      actor: "ferryman",
      observationId: "obs-2",
      kind: "realm-transition",
      to: "underworld-shore",
      via: "ferry-dock",
    }),
  ]);

  expect(result.rejected).toEqual([]);
  expect(result.committed[0]?.events).toHaveLength(1);
  expect(result.committed[0]?.events[0]).toMatchObject({
    kind: "realm-transitioned",
    entityId: "ferryman",
    to: "underworld-shore",
    via: "ferry-dock",
  });
  const ferryman = result.state.actors.get(toEntityId("ferryman"));
  expect(ferryman?.locationId).toBe(toEntityId("underworld-shore"));
  expect(
    result.state.locations.get(toEntityId("underworld-shore"))?.realm,
  ).toBe("underworld");
});

test("two same-tick proposals from one actor: the first commits, the second is rejected busy-actor", () => {
  const state = walkState();

  const result = runTick(state, createPrng(1), [
    moveTo("path"),
    moveTo("path", { observationId: "obs-2" }),
  ]);

  expect(result.committed).toHaveLength(1);
  expect(result.rejected).toHaveLength(1);
  expect(result.rejected[0]?.reason).toBe("busy-actor");
  // Only the first move's effect landed.
  expect(result.state.actors.get(toEntityId("wanderer"))?.revision).toBe(1);
});

test("a rejected proposal leaves state unchanged", () => {
  const state = walkState();

  const result = runTick(state, createPrng(1), [moveTo("town")]);
  expect(result.rejected).toHaveLength(1);
  expect(result.rejected[0]?.reason).toBe("not-adjacent");
  expect(result.state.actors).toEqual(state.actors);
  expect(result.state.locations).toEqual(state.locations);
});

test("a malformed fixture proposal is rejected before it ever reaches the queue", () => {
  const submitted = submitProposal({ kind: "move" }); // missing actor, to, etc.
  expect(submitted.ok).toBe(false);
  if (!submitted.ok) {
    expect(submitted.rejection.reason).toBe("malformed");
  }
});

test("applyEvents applied to the recorded event stream reproduces the live committed state", () => {
  const initial = walkState();

  const hop1 = runTick(initial, createPrng(1), [moveTo("path")]);
  const hop2 = runTick(hop1.state, hop1.prng, [
    moveTo("town", { observationId: "obs-2" }),
  ]);

  const allEvents = [
    ...hop1.committed.flatMap((record) => record.events),
    ...hop2.committed.flatMap((record) => record.events),
  ];

  // Rebuild from the initial state through only the recorded event log,
  // ignoring the tick/simTime bookkeeping runTick also advances.
  const rebuilt = applyEvents(initial, allEvents);
  expect(rebuilt.actors).toEqual(hop2.state.actors);
  expect(rebuilt.locations).toEqual(hop2.state.locations);
});

test("event sequence numbers are contiguous across ticks, not reset each tick", () => {
  const state = walkState();

  const hop1 = runTick(state, createPrng(1), [moveTo("path")]);
  expect(hop1.committed[0]?.events[0]?.sequence).toBe(1);
  expect(hop1.state.lastSequence).toBe(1);

  const hop2 = runTick(hop1.state, hop1.prng, [moveTo("town")]);
  expect(hop2.committed[0]?.events[0]?.sequence).toBe(2);
  expect(hop2.state.lastSequence).toBe(2);
});

test("resuming from a restored state (via the codec) continues the sequence rather than restarting it", () => {
  const state = walkState();

  const hop1 = runTick(state, createPrng(1), [moveTo("path")]);
  expect(hop1.state.lastSequence).toBe(1);

  const restored = decode(JSON.parse(JSON.stringify(encode(hop1.state))));
  expect(restored.lastSequence).toBe(1);

  const hop2 = runTick(restored, hop1.prng, [moveTo("town")]);
  expect(hop2.committed[0]?.events[0]?.sequence).toBe(2);
  expect(hop2.state.lastSequence).toBe(2);
});

test("same state, PRNG-irrelevant proposals, and queue produce identical output on repeated runs", () => {
  const state = walkState();
  const queue = [moveTo("path")];

  const runA = runTick(state, createPrng(1), queue);
  const runB = runTick(state, createPrng(1), queue);

  expect(runA.state).toEqual(runB.state);
  expect(runA.prng).toEqual(runB.prng);
  expect(runA.committed).toEqual(runB.committed);
  expect(runA.rejected).toEqual(runB.rejected);
});

function economyWalkPack(): ContentPack {
  return {
    schemaVersion: 1,
    realms: ["mortal"],
    resources: [],
    locations: [{ id: "square", realm: "mortal", name: "Square", edges: [] }],
    buildings: [],
    inhabitants: [],
    rules: {
      catchUpCapMs: 0,
      catchUpChunkMs: 0,
      checkpointIntervalMs: 0,
      maxProposalsPerTick: 100,
      fireBalance: {},
      economyBalance: { value_wood: 1, value_currency: 1, gatherAmount: 4 },
    },
    recipes: {
      planks: {
        inputs: [{ resource: "wood", amount: 2 }],
        outputs: [{ resource: "planks", amount: 1 }],
      },
    },
  };
}

function economyWalkState(): WorldState {
  let state = createInitialWorldState(economyWalkPack());
  state = withActor(
    state,
    testActor({
      id: toEntityId("woodcutter"),
      locationId: toEntityId("square"),
      alive: true,
      capabilities: [],
      inventory: new Map(),
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
  return state;
}

test("a gather, produce, trade, and consume run through a tick and reproduce via replay", () => {
  const state = economyWalkState();

  const gather = runTick(state, createPrng(1), [
    proposal({
      actor: "woodcutter",
      kind: "gather",
      resource: "wood",
      amount: 4,
    }),
  ]);
  expect(gather.rejected).toEqual([]);
  expect(
    gather.state.actors.get(toEntityId("woodcutter"))?.inventory.get("wood"),
  ).toBe(4);

  const trade = runTick(gather.state, gather.prng, [
    proposal({
      actor: "woodcutter",
      observationId: "obs-2",
      kind: "trade",
      counterparty: "farmer",
      give: [{ resource: "wood", amount: 2 }],
      receive: [{ resource: "currency", amount: 2 }],
    }),
  ]);
  expect(trade.rejected).toEqual([]);
  expect(
    trade.state.actors.get(toEntityId("woodcutter"))?.inventory.get("currency"),
  ).toBe(2);
  expect(
    trade.state.actors.get(toEntityId("woodcutter"))?.inventory.get("wood"),
  ).toBe(2);
  expect(
    trade.state.actors.get(toEntityId("farmer"))?.inventory.get("wood"),
  ).toBe(2);
  expect(
    trade.state.actors.get(toEntityId("farmer"))?.inventory.get("currency"),
  ).toBe(8);

  const produce = runTick(trade.state, trade.prng, [
    proposal({
      actor: "woodcutter",
      observationId: "obs-3",
      kind: "produce",
      output: "planks",
      quantity: 1,
    }),
  ]);
  expect(produce.rejected).toEqual([]);
  expect(
    produce.state.actors.get(toEntityId("woodcutter"))?.inventory.has("wood"),
  ).toBe(false);
  expect(
    produce.state.actors.get(toEntityId("woodcutter"))?.inventory.get("planks"),
  ).toBe(1);

  const consume = runTick(produce.state, produce.prng, [
    proposal({
      actor: "woodcutter",
      observationId: "obs-4",
      kind: "consume",
      resource: "currency",
      amount: 2,
    }),
  ]);
  expect(consume.rejected).toEqual([]);
  expect(
    consume.state.actors
      .get(toEntityId("woodcutter"))
      ?.inventory.has("currency"),
  ).toBe(false);

  const allEvents = [
    ...gather.committed.flatMap((r) => r.events),
    ...trade.committed.flatMap((r) => r.events),
    ...produce.committed.flatMap((r) => r.events),
    ...consume.committed.flatMap((r) => r.events),
  ];
  const rebuilt = applyEvents(state, allEvents);
  expect(rebuilt.actors).toEqual(consume.state.actors);
});

function legendBy(narrator: string, assertion: string): Proposal {
  const result = submitProposal({
    schemaVersion: 1,
    actor: narrator,
    targets: [],
    expectedRevisions: [],
    source: "fixture",
    // One unchanged observation, cited by both tellings.
    observationId: "obs-shared",
    kind: "legend",
    assertion,
  });
  if (!result.ok) {
    throw new Error(
      `legend fixture failed to parse: ${result.rejection.message}`,
    );
  }
  return result.proposal;
}

test("two tellings from one unchanged observation on successive ticks both survive, each with its own identity", () => {
  const state = walkState();
  const first = runTick(state, createPrng(1), [
    legendBy("wanderer", "the old oak was struck"),
  ]);
  const second = runTick(first.state, first.prng, [
    legendBy("wanderer", "the old oak was not struck at all"),
  ]);

  expect(second.state.legends.size).toBe(2);
  const tellings = [...second.state.legends.values()].map(
    (legend) => legend.assertion,
  );
  expect(tellings).toEqual([
    "the old oak was struck",
    "the old oak was not struck at all",
  ]);
  expect(new Set(second.state.legends.keys()).size).toBe(2);
});

test("a legend's identity comes from the event that recorded it, so replaying the same events yields the same legends", () => {
  const state = walkState();
  const told = runTick(state, createPrng(1), [
    legendBy("wanderer", "the old oak was struck"),
  ]);

  const replayed = applyEvents(state, told.events);

  expect([...replayed.legends.keys()]).toEqual([...told.state.legends.keys()]);
  expect([...told.state.legends.keys()][0]).toContain(
    String(told.events[0]?.id),
  );
});

test("every event a tick commits records that tick: primary, environmental, and derived alike", () => {
  const state = economyWalkState();
  let current = state;
  let prng = createPrng(1);
  for (let tickNumber = 1; tickNumber <= 3; tickNumber += 1) {
    const result = runTick(current, prng, []);
    current = result.state;
    prng = result.prng;
    expect(result.state.tick).toBe(tickNumber);
    for (const event of result.events) expect(event.tick).toBe(tickNumber);
  }
});

test("only a building that offers a service earns its owner income: a woodshed that sells nothing earns nothing, a shop does", () => {
  const base = economyWalkPack();
  const stocked = (id: string, services: string[]) => ({
    id,
    locationId: "square",
    name: id,
    material: "wood",
    combustible: false,
    services,
    inventory: [],
    owner: "woodcutter",
  });
  const state = createInitialWorldState({
    ...base,
    buildings: [stocked("shop", ["trade"]), stocked("woodshed", [])],
    inhabitants: [
      {
        id: "woodcutter",
        sprite: "placeholder-woodcutter",
        name: "Woodcutter",
        locationId: "square",
      },
    ],
    rules: {
      ...base.rules,
      economyBalance: { ...base.rules.economyBalance, incomePerTick: 1 },
    },
  });
  const result = runTick(state, createPrng(1), []);
  const earned = result.events.filter((e) => e.kind === "income-earned");
  expect(earned).toHaveLength(1);
  expect(earned[0]).toMatchObject({
    entityId: "woodcutter",
    buildingId: "shop",
  });
});
