import { expect, test } from "bun:test";
import type { ContentPack, EventId, WorldEvent } from "@panthea/contracts";
import { runTick } from "./actions";
import {
  decideRoutineProposal,
  foodWant,
  isMealtime,
  surplusWant,
} from "./routines";
import {
  type ActorState,
  buildingBase,
  createInitialWorldState,
  createPrng,
  getActor,
  needKey,
  toEntityId,
  type WorldState,
  withActor,
  withBuilding,
} from "./state";

function rules(
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

function pack(overrides: Partial<ContentPack> = {}): ContentPack {
  return {
    schemaVersion: 1,
    realms: ["mortal"],
    resources: [],
    locations: [{ id: "square", realm: "mortal", name: "Square", edges: [] }],
    buildings: [],
    inhabitants: [],
    rules: rules({ gatherAmount: 2, consumeAmount: 1, value_food: 3 }),
    recipes: {},
    ...overrides,
  };
}

test("a dead actor never gets a routine proposal", () => {
  let state = createInitialWorldState(pack());
  state = withActor(state, {
    id: toEntityId("ghost"),
    locationId: toEntityId("square"),
    alive: false,
    capabilities: [],
    inventory: new Map(),
    drives: { thrift: 1, appetite: 0, greed: 0, piety: 0 },
    revision: 0,
  });
  expect(decideRoutineProposal(state, toEntityId("ghost"))).toBeUndefined();
});

test("an actor with no authored drives is not routine-driven", () => {
  let state = createInitialWorldState(pack());
  state = withActor(state, {
    id: toEntityId("wanderer"),
    locationId: toEntityId("square"),
    alive: true,
    capabilities: [],
    inventory: new Map(),
    revision: 0,
  });
  expect(decideRoutineProposal(state, toEntityId("wanderer"))).toBeUndefined();
});

test("with nothing else eligible, a gatherer falls back to gathering its own resource", () => {
  let state = createInitialWorldState(pack());
  state = withActor(state, {
    id: toEntityId("woodcutter"),
    locationId: toEntityId("square"),
    alive: true,
    capabilities: [],
    inventory: new Map(),
    drives: { thrift: 0.5, appetite: 0.1, greed: 0.3, piety: 0 },
    gathers: "wood",
    revision: 0,
  });
  const result = decideRoutineProposal(state, toEntityId("woodcutter"));
  if (!result) throw new Error("expected a routine result");
  expect(result.proposal).toMatchObject({
    kind: "gather",
    resource: "wood",
    amount: 2,
  });
  expect(result.proposal.observationId).toBe(result.observation.id);
  expect(result.observation.observer).toBe(toEntityId("woodcutter"));
  expect(result.observation.source).toBe("routine");
});

test("a routine never proposes a trade the counterparty's own acceptance rule would decline", () => {
  let state = createInitialWorldState(pack());
  state = withActor(state, {
    id: toEntityId("woodcutter"),
    locationId: toEntityId("square"),
    alive: true,
    capabilities: [],
    inventory: new Map([["wood", 4]]),
    gathers: "wood",
    revision: 0,
    drives: { thrift: 0, appetite: 0, greed: 0.9, piety: 0 },
  });
  state = withActor(state, {
    id: toEntityId("thrifty-buyer"),
    locationId: toEntityId("square"),
    alive: true,
    capabilities: [],
    inventory: new Map([["currency", 100]]),
    revision: 0,
    drives: { thrift: 0.9, appetite: 0, greed: 0, piety: 0 },
  });
  const result = decideRoutineProposal(state, toEntityId("woodcutter"));
  if (!result) throw new Error("expected a routine result");
  // The only other actor present would decline this exact trade (its
  // demand exceeds the offered value), so the routine falls back to
  // gathering instead of proposing a trade that would just be rejected.
  expect(result.proposal.kind).toBe("gather");
});

test("two inhabitants with different dominant drives choose different actions from the same state", () => {
  const base = () => {
    let state = createInitialWorldState(pack());
    state = withActor(state, {
      id: toEntityId("self"),
      locationId: toEntityId("square"),
      alive: true,
      capabilities: [],
      inventory: new Map([["wood", 4]]),
      gathers: "wood",
      revision: 0,
      drives: { thrift: 0, appetite: 0, greed: 0, piety: 0 },
    });
    state = withActor(state, {
      id: toEntityId("buyer"),
      locationId: toEntityId("square"),
      alive: true,
      capabilities: [],
      inventory: new Map([["currency", 10]]),
      revision: 0,
    });
    return state;
  };

  const appetiteState = withActor(base(), {
    id: toEntityId("self"),
    locationId: toEntityId("square"),
    alive: true,
    capabilities: [],
    inventory: new Map([["wood", 4]]),
    gathers: "wood",
    revision: 0,
    drives: { thrift: 0, appetite: 0.9, greed: 0, piety: 0 },
  });
  const greedState = withActor(base(), {
    id: toEntityId("self"),
    locationId: toEntityId("square"),
    alive: true,
    capabilities: [],
    inventory: new Map([["wood", 4]]),
    gathers: "wood",
    revision: 0,
    drives: { thrift: 0, appetite: 0, greed: 0.9, piety: 0 },
  });

  const appetiteChoice = decideRoutineProposal(
    appetiteState,
    toEntityId("self"),
  );
  const greedChoice = decideRoutineProposal(greedState, toEntityId("self"));

  // Appetite has no eligible consume/buy path here (no food anywhere), so
  // it falls back to the same low-utility gather as everyone else; greed
  // outranks that fallback with the higher-utility sell candidate.
  expect(appetiteChoice?.proposal.kind).toBe("gather");
  expect(greedChoice?.proposal.kind).toBe("trade");
});

test("a hungry actor with currency buys food from a co-located seller over gathering", () => {
  let state = createInitialWorldState(pack());
  state = withActor(state, {
    id: toEntityId("hungry"),
    locationId: toEntityId("square"),
    alive: true,
    capabilities: [],
    inventory: new Map([["currency", 10]]),
    gathers: "wood",
    revision: 0,
    drives: { thrift: 0, appetite: 0.9, greed: 0, piety: 0 },
  });
  state = withActor(state, {
    id: toEntityId("seller"),
    locationId: toEntityId("square"),
    alive: true,
    capabilities: [],
    inventory: new Map([["food", 5]]),
    // Only a food producer sells food.
    gathers: "food",
    revision: 0,
  });
  const result = decideRoutineProposal(state, toEntityId("hungry"));
  expect(result?.proposal).toMatchObject({
    kind: "trade",
    counterparty: "seller",
    give: [{ resource: "currency", amount: 3 }],
    receive: [{ resource: "food", amount: 1 }],
  });
});

test("an actor holding enough food consumes it", () => {
  let state = createInitialWorldState(pack());
  state = withActor(state, {
    id: toEntityId("fed"),
    locationId: toEntityId("square"),
    alive: true,
    capabilities: [],
    inventory: new Map([["food", 2]]),
    revision: 0,
    drives: { thrift: 0, appetite: 0.9, greed: 0, piety: 0 },
  });
  const result = decideRoutineProposal(state, toEntityId("fed"));
  expect(result?.proposal).toMatchObject({
    kind: "consume",
    resource: "food",
    amount: 1,
  });
});

test("an actor holding recipe inputs proposes to produce over gathering", () => {
  let state = createInitialWorldState(
    pack({
      recipes: {
        planks: {
          inputs: [{ resource: "wood", amount: 2 }],
          outputs: [{ resource: "planks", amount: 1 }],
        },
      },
    }),
  );
  state = withActor(state, {
    id: toEntityId("carpenter"),
    locationId: toEntityId("square"),
    alive: true,
    capabilities: [],
    inventory: new Map([["wood", 2]]),
    gathers: "wood",
    revision: 0,
    drives: { thrift: 0.9, appetite: 0, greed: 0, piety: 0 },
  });
  const result = decideRoutineProposal(state, toEntityId("carpenter"));
  expect(result?.proposal).toMatchObject({
    kind: "produce",
    output: "planks",
    quantity: 1,
  });
});

test("an actor holding a recipe's output sells the surplus to a co-located buyer", () => {
  let state = createInitialWorldState(
    pack({
      rules: rules({ value_planks: 2 }),
      recipes: {
        planks: {
          inputs: [{ resource: "wood", amount: 2 }],
          outputs: [{ resource: "planks", amount: 1 }],
        },
      },
    }),
  );
  state = withActor(state, {
    id: toEntityId("carpenter"),
    locationId: toEntityId("square"),
    alive: true,
    capabilities: [],
    inventory: new Map([["planks", 2]]),
    revision: 0,
    // The carpenter works the recipe: it fells the wood it turns into planks.
    gathers: "wood",
    drives: { thrift: 0.6, appetite: 0, greed: 0, piety: 0 },
  });
  state = withActor(state, {
    id: toEntityId("buyer"),
    locationId: toEntityId("square"),
    alive: true,
    capabilities: [],
    inventory: new Map([["currency", 10]]),
    revision: 0,
  });
  const result = decideRoutineProposal(state, toEntityId("carpenter"));
  expect(result?.proposal).toMatchObject({
    kind: "trade",
    counterparty: "buyer",
    give: [{ resource: "planks", amount: 1 }],
    receive: [{ resource: "currency", amount: 2 }],
  });
});

test("a buyer who merely holds a recipe's output keeps it: only someone who works the recipe sells what it makes, so two traders never pass a good back and forth", () => {
  let state = createInitialWorldState(
    pack({
      rules: rules({ value_planks: 2 }),
      recipes: {
        planks: {
          inputs: [{ resource: "wood", amount: 2 }],
          outputs: [{ resource: "planks", amount: 1 }],
        },
      },
    }),
  );
  const trader = (id: string, planks: number) => ({
    id: toEntityId(id),
    locationId: toEntityId("square"),
    alive: true,
    capabilities: [],
    inventory: new Map([
      ["planks", planks],
      ["currency", 10],
    ]),
    revision: 0,
    drives: { thrift: 0.6, appetite: 0, greed: 0.6, piety: 0 },
  });
  state = withActor(state, trader("holder", 2));
  state = withActor(state, trader("other", 0));
  expect(decideRoutineProposal(state, toEntityId("holder"))).toBeUndefined();
});

test("a gatherer does not sell its surplus to someone who gathers the same good: two gatherers of one thing would pass it back and forth and never gather", () => {
  let state = createInitialWorldState(
    pack({ rules: rules({ value_fish: 2, gatherAmount: 2 }) }),
  );
  const fisher = (id: string, fish: number) => ({
    id: toEntityId(id),
    locationId: toEntityId("square"),
    alive: true,
    capabilities: [],
    inventory: new Map([
      ["fish", fish],
      ["currency", 10],
    ]),
    revision: 0,
    gathers: "fish",
    drives: { thrift: 0.1, appetite: 0, greed: 0.6, piety: 0 },
  });
  state = withActor(state, fisher("kallias", 2));
  state = withActor(state, fisher("melina", 0));
  // Melina has the money and would accept, but she gathers fish herself.
  expect(
    decideRoutineProposal(state, toEntityId("kallias"))?.proposal,
  ).toMatchObject({
    kind: "gather",
  });
  // A buyer who does not gather it is another matter.
  state = withActor(state, {
    id: toEntityId("ferryman"),
    locationId: toEntityId("square"),
    alive: true,
    capabilities: [],
    inventory: new Map([["currency", 10]]),
    revision: 0,
    drives: { thrift: 0.1, appetite: 0, greed: 0.6, piety: 0 },
  });
  expect(
    decideRoutineProposal(state, toEntityId("kallias"))?.proposal,
  ).toMatchObject({
    kind: "trade",
    counterparty: "ferryman",
    give: [{ resource: "fish", amount: 2 }],
  });
});

test("an owner holding enough materials proposes to repair its destroyed building over any ordinary choice", () => {
  let state = createInitialWorldState(
    pack({
      rules: rules({ repairCostPlanks: 2, repairAmountPerTick: 1 }),
      buildings: [
        {
          id: "the-tavern",
          locationId: "square",
          name: "The Tavern",
          material: "wood",
          combustible: true,
          services: ["drink"],
          inventory: [],
          owner: "farmer",
        },
      ],
    }),
  );
  const tavern = state.buildings.get(toEntityId("the-tavern"));
  if (!tavern) throw new Error("expected the tavern fixture building");
  state = withBuilding(state, { ...buildingBase(tavern), status: "destroyed" });
  state = withActor(state, {
    id: toEntityId("farmer"),
    locationId: toEntityId("square"),
    alive: true,
    capabilities: [],
    inventory: new Map([["planks", 3]]),
    revision: 0,
    drives: { thrift: 0.1, appetite: 0, greed: 0, piety: 0 },
  });
  const result = decideRoutineProposal(state, toEntityId("farmer"));
  expect(result?.proposal).toMatchObject({
    kind: "repair",
    structure: "the-tavern",
  });
});

test("an actor without a gatherable resource and nothing else eligible gets no proposal", () => {
  let state = createInitialWorldState(pack());
  state = withActor(state, {
    id: toEntityId("idle"),
    locationId: toEntityId("square"),
    alive: true,
    capabilities: [],
    inventory: new Map(),
    revision: 0,
    drives: { thrift: 0, appetite: 0, greed: 0, piety: 0 },
  });
  expect(decideRoutineProposal(state, toEntityId("idle"))).toBeUndefined();
});

// --- Occasional hunger ------------------------------------------------------------------------

const MEAL_RULES = { gatherAmount: 2, consumeAmount: 1, value_food: 3 };

/** A routine mortal at `at` holding `inventory`, with `extra` set over the defaults. */
function mortal(
  name: string,
  at: string,
  inventory: Record<string, number>,
  extra: Partial<ActorState> = {},
): ActorState {
  return {
    id: toEntityId(name),
    locationId: toEntityId(at),
    alive: true,
    capabilities: [],
    inventory: new Map(Object.entries(inventory)),
    revision: 0,
    drives: { thrift: 0, appetite: 0.12, greed: 0, piety: 0 },
    ...extra,
  };
}

/** Square, path and field in a line: two steps from the square to the field. */
const LINE: ContentPack["locations"] = [
  {
    id: "square",
    realm: "mortal",
    name: "Square",
    edges: [{ to: "path", transport: "path", bidirectional: true }],
  },
  {
    id: "path",
    realm: "mortal",
    name: "Path",
    edges: [{ to: "field", transport: "path", bidirectional: true }],
  },
  { id: "field", realm: "mortal", name: "Field", edges: [] },
];

function lineWorld(
  mealIntervalTicks: number | undefined,
  actors: readonly ActorState[],
): WorldState {
  let state = createInitialWorldState(
    pack({
      locations: LINE,
      rules: rules({
        ...MEAL_RULES,
        ...(mealIntervalTicks === undefined ? {} : { mealIntervalTicks }),
      }),
    }),
  );
  for (const actor of actors) state = withActor(state, actor);
  return state;
}

/** The world's tick, set directly: routines read only the last committed state. */
const atTick = (state: WorldState, tick: number): WorldState => ({
  ...state,
  tick,
});

test("with a meal interval, a mortal holding food eats once every interval and no more, even when a sale would otherwise outrank the meal", () => {
  const diner = mortal(
    "diner",
    "square",
    { food: 9, wood: 4 },
    {
      gathers: "wood",
      drives: { thrift: 0, appetite: 0.12, greed: 0.9, piety: 0 },
    },
  );
  const base = lineWorld(5, [
    diner,
    mortal("buyer", "square", { currency: 50 }),
  ]);
  const eatingTicks: number[] = [];
  for (let tick = 0; tick < 15; tick += 1) {
    const proposal = decideRoutineProposal(
      atTick(base, tick),
      toEntityId("diner"),
    )?.proposal;
    if (proposal?.kind === "consume") eatingTicks.push(tick);
    // Off its mealtime the same mortal sells its wood instead.
    else expect(proposal?.kind).toBe("trade");
  }
  expect(eatingTicks).toHaveLength(3);
  expect(eatingTicks[1]).toBe((eatingTicks[0] as number) + 5);
  expect(eatingTicks[2]).toBe((eatingTicks[0] as number) + 10);
});

test("mortals do not all sit down at once: mealtime is offset by who they are", () => {
  const state = lineWorld(7, []);
  const names = ["woodcutter", "farmer", "iris", "kallias", "ismene", "damon"];
  const mealtimes = new Set(
    names.map((name) =>
      [...Array(7).keys()].find((tick) =>
        isMealtime(atTick(state, tick), toEntityId(name)),
      ),
    ),
  );
  expect(mealtimes.size).toBeGreaterThan(1);
});

test("with no meal interval a mortal eats whenever it holds food, as before", () => {
  const base = lineWorld(undefined, [mortal("fed", "square", { food: 9 })]);
  for (let tick = 0; tick < 4; tick += 1) {
    expect(
      decideRoutineProposal(atTick(base, tick), toEntityId("fed"))?.proposal
        .kind,
    ).toBe("consume");
  }
});

test("only a food producer sells food: a mortal that merely holds a meal keeps it", () => {
  const state = lineWorld(undefined, [
    mortal("hungry", "square", { currency: 10 }),
    mortal("holder", "square", { food: 5, currency: 10 }),
  ]);
  const want = foodWant(
    state,
    toEntityId("hungry"),
    getActor(state, toEntityId("hungry")) as ActorState,
  );
  expect(want).toMatchObject({ resource: "food", unmet: "no-seller" });
});

test("a food producer does not push its food on buyers who are not hungry: it keeps gathering, and sells only to whoever asks", () => {
  const state = lineWorld(undefined, [
    mortal(
      "farmer",
      "square",
      { food: 6 },
      {
        gathers: "food",
        drives: { thrift: 0, appetite: 0, greed: 0.9, piety: 0 },
      },
    ),
    // Flush, and already holding its meal.
    mortal("neighbour", "square", { currency: 40, food: 1 }),
  ]);
  const farmer = getActor(state, toEntityId("farmer")) as ActorState;
  expect(surplusWant(state, farmer.id, farmer)).toBeUndefined();
  expect(decideRoutineProposal(state, farmer.id)?.proposal.kind).toBe("gather");
});

/** `state` with the mortal's food shortfall open since `since`, as the need scan records it. */
function hungryFor(state: WorldState, since: number): WorldState {
  const needs = new Map(state.needs);
  needs.set(needKey(toEntityId("hungry"), "food"), {
    actor: toEntityId("hungry"),
    resource: "food",
    reason: "no-seller",
    eventId: "evt-1-1" as EventId,
    tick: since,
  });
  return { ...state, needs };
}

const wantOf = (state: WorldState, name = "hungry") =>
  foodWant(
    state,
    toEntityId(name),
    getActor(state, toEntityId(name)) as ActorState,
  );

test("a hungry mortal where no producer works walks toward the nearest one instead of failing in place", () => {
  const state = lineWorld(undefined, [
    mortal("hungry", "square", { currency: 10 }),
    mortal("farmer", "field", { food: 4 }, { gathers: "food" }),
  ]);
  // Two steps away: the first is the path. The shortfall is still real, so it is still an unmet need.
  expect(wantOf(state)).toMatchObject({
    resource: "food",
    unmet: "no-seller",
    trip: "path",
  });
  expect(
    decideRoutineProposal(state, toEntityId("hungry"))?.proposal,
  ).toMatchObject({ kind: "move", to: "path" });
});

test("with a meal interval a mortal first waits that long, less a tick, for a producer to turn up where it stands, then walks", () => {
  const base = atTick(
    lineWorld(5, [
      mortal("hungry", "square", { currency: 10 }),
      mortal("farmer", "field", { food: 4 }, { gathers: "food" }),
    ]),
    10,
  );
  // The shortfall opened 2 ticks ago: still patient (it waits 4 ticks).
  expect(wantOf(hungryFor(base, 8))).toEqual({
    resource: "food",
    unmet: "no-seller",
  });
  // Opened 4 ticks ago: it walks.
  expect(wantOf(hungryFor(base, 6))).toMatchObject({ trip: "path" });
});

test("no walk when it would lead nowhere: no producer holds food, none is reachable, or one stands here and will restock", () => {
  const hungry = () => mortal("hungry", "square", { currency: 10 });
  const noTrip = { resource: "food", unmet: "no-seller" } as const;

  // The only producer is out of food.
  expect(
    wantOf(
      lineWorld(undefined, [
        hungry(),
        mortal("farmer", "field", {}, { gathers: "food" }),
      ]),
    ),
  ).toEqual(noTrip);

  // The only producer is on an island no route reaches.
  expect(
    wantOf(
      lineWorld(undefined, [
        hungry(),
        mortal("farmer", "nowhere", { food: 4 }, { gathers: "food" }),
      ]),
    ),
  ).toEqual(noTrip);

  // A producer stands here but is momentarily out: waiting beats wandering off, however long the wait, even with food elsewhere.
  const crowded = lineWorld(undefined, [
    hungry(),
    mortal("local", "square", {}, { gathers: "food" }),
    mortal("farmer", "field", { food: 4 }, { gathers: "food" }),
  ]);
  expect(wantOf(hungryFor(atTick(crowded, 500), 1))).toEqual(noTrip);
});

/** Runs `ticks` ticks of the routines of every mortal in `state`. */
function runDay(state: WorldState, ticks: number) {
  let current = state;
  let prng = createPrng(1);
  const events: WorldEvent[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    const proposals = [...current.actors.keys()].flatMap((actorId) => {
      const decided = decideRoutineProposal(current, actorId);
      return decided ? [decided.proposal] : [];
    });
    const result = runTick(current, prng, proposals);
    current = result.state;
    prng = result.prng;
    events.push(...result.events);
  }
  return { state: current, events };
}

test("a hungry mortal with no producer at hand walks to one, buys a meal, and eats: its shortfall is recorded once and closes when it is fed, not every tick", () => {
  const { state, events } = runDay(
    lineWorld(4, [
      mortal("hungry", "square", { currency: 10 }),
      mortal("farmer", "field", { food: 4 }, { gathers: "food" }),
    ]),
    16,
  );
  expect(getActor(state, toEntityId("hungry"))?.locationId).toBe(
    toEntityId("field"),
  );
  expect(
    events.some(
      (e) =>
        e.kind === "resource-traded" &&
        e.entityId === "hungry" &&
        e.counterpartyId === "farmer" &&
        e.receive.some((line) => line.resource === "food"),
    ),
  ).toBe(true);
  expect(
    events.some(
      (e) => e.kind === "resource-consumed" && e.entityId === "hungry",
    ),
  ).toBe(true);
  // One shortfall while it walked (the other, at the very end, is it running out of money after three meals), closed once it was fed.
  const noSeller = events.filter(
    (e) =>
      e.kind === "unmet-need" &&
      e.entityId === "hungry" &&
      e.reason === "no-seller",
  );
  expect(noSeller).toHaveLength(1);
  expect(
    events.some((e) => e.kind === "need-met" && e.entityId === "hungry"),
  ).toBe(true);
});

test("no meal passes back and forth: over a long stretch, food moves only from a producer to someone who asked, never the other way, and never between the same pair in both directions", () => {
  const { events } = runDay(
    lineWorld(3, [
      mortal(
        "farmer",
        "square",
        { food: 2, currency: 10 },
        {
          gathers: "food",
          drives: { thrift: 0.2, appetite: 0.12, greed: 0.5, piety: 0 },
        },
      ),
      mortal(
        "herder",
        "square",
        { food: 2, currency: 10 },
        {
          gathers: "food",
          drives: { thrift: 0.2, appetite: 0.12, greed: 0.5, piety: 0 },
        },
      ),
      mortal("ann", "square", { food: 1, currency: 30 }),
      mortal("bea", "square", { food: 1, currency: 30 }),
    ]),
    60,
  );
  const sales = new Set<string>();
  for (const e of events) {
    if (e.kind !== "resource-traded") continue;
    const sold = e.give.some((line) => line.resource === "food");
    const bought = e.receive.some((line) => line.resource === "food");
    if (sold === bought) continue;
    const [seller, buyer] = sold
      ? [e.entityId, e.counterpartyId]
      : [e.counterpartyId, e.entityId];
    sales.add(`${seller}>${buyer}`);
    // Only producers sell food.
    expect(["farmer", "herder"]).toContain(String(seller));
  }
  expect(sales.size).toBeGreaterThan(0);
  for (const sale of sales) {
    const [seller, buyer] = sale.split(">");
    expect(sales.has(`${buyer}>${seller}`)).toBe(false);
  }
});
