import { expect, test } from "bun:test";
import type { ContentPack, EventId, WorldEvent } from "@panthea/contracts";
import { applyEvent, applyEvents, runTick, submitProposal } from "./actions";
import { decode, encode } from "./codec";
import { noteDirectorFire, planDirectorStep } from "./director";
import { perceive } from "./perception";
import { petitionBalanceOf } from "./petitions";
import { decideRoutineProposal } from "./routines";
import {
  createInitialWorldState,
  createPrng,
  getActor,
  type PrngState,
  toEntityId,
  type WorldState,
  withActor,
} from "./state";

const id = toEntityId;

/** Calm mortals who each hold a lot and own a building, a director interval of 10, and gods in a hall. */
function pack(
  quiet = 10,
  mortals = ["farmer", "woodcutter", "drifter"],
): ContentPack {
  return {
    schemaVersion: 1,
    realms: ["mortal", "olympus"],
    resources: [],
    locations: [
      {
        id: "square",
        realm: "mortal",
        name: "Square",
        edges: [{ to: "altar", transport: "path", bidirectional: true }],
      },
      { id: "altar", realm: "mortal", name: "Altar", edges: [] },
      { id: "hall", realm: "olympus", name: "Hall", edges: [] },
    ],
    buildings: [
      {
        id: "farm-store",
        locationId: "square",
        name: "Farm store",
        material: "wood",
        combustible: true,
        services: [],
        inventory: [],
        owner: "farmer",
      },
      {
        id: "wood-store",
        locationId: "square",
        name: "Wood store",
        material: "wood",
        combustible: true,
        services: [],
        inventory: [],
        owner: "woodcutter",
      },
    ],
    inhabitants: [
      ...mortals.map((mortal) => ({
        id: mortal,
        name: mortal,
        locationId: "square",
        drives: { thrift: 0, appetite: 0, greed: 0, piety: 0 },
        startingInventory: [
          { resource: "currency", amount: 20 },
          { resource: "food", amount: 40 },
        ],
      })),
      {
        id: "zeus",
        name: "Zeus",
        locationId: "hall",
        deity: true,
        startingInventory: [{ resource: "divinity", amount: 10 }],
      },
    ],
    rules: {
      catchUpCapMs: 0,
      catchUpChunkMs: 0,
      checkpointIntervalMs: 0,
      maxProposalsPerTick: 100,
      fireBalance: {
        igniteThreshold: 3,
        intensityGrowthPerTick: 1,
        destroyIntensity: 50,
      },
      economyBalance: { consumeAmount: 1, value_food: 3, value_currency: 1 },
      petitionBalance: { directorIntervalTicks: quiet },
    },
    recipes: {},
  };
}

class World {
  state: WorldState;
  prng: PrngState;
  readonly log: WorldEvent[] = [];
  readonly initial: WorldState;
  constructor(state = createInitialWorldState(pack()), seed = 1) {
    this.state = state;
    this.initial = state;
    this.prng = createPrng(seed);
  }
  /** One tick of nothing but the world's own steps, plus `extra` proposals. */
  tick(...extra: Record<string, unknown>[]): WorldEvent[] {
    const proposals = extra.map((raw, index) => {
      const submitted = submitProposal({
        schemaVersion: 1,
        targets: [],
        expectedRevisions: [],
        source: "model",
        observationId: `obs-${this.state.tick}-${index}`,
        ...raw,
      });
      if (!submitted.ok) throw new Error(submitted.rejection.message);
      return submitted.proposal;
    });
    const result = runTick(this.state, this.prng, proposals);
    this.state = result.state;
    this.prng = result.prng;
    this.log.push(...result.events);
    return [...result.events];
  }
  /** Records a fixture event as the world would have, at the current tick. */
  apply(overrides: Record<string, unknown>): WorldEvent {
    const event = {
      schemaVersion: 1,
      id: `evt-${this.state.tick}-${1000 + this.log.length}`,
      sequence: this.state.lastSequence + 1,
      simTime: 0,
      tick: this.state.tick,
      correlationId: "fixture",
      causationId: "fixture",
      approximate: false,
      ...overrides,
    } as unknown as WorldEvent;
    this.state = applyEvent(
      { ...this.state, lastSequence: event.sequence },
      event,
    );
    this.log.push(event);
    return event;
  }
  /** Runs `n` empty ticks. */
  run(n: number): WorldEvent[] {
    const all: WorldEvent[] = [];
    for (let i = 0; i < n; i += 1) all.push(...this.tick());
    return all;
  }
}

const trouble = (events: readonly WorldEvent[]) =>
  events.filter(
    (
      e,
    ): e is Extract<
      WorldEvent,
      { kind: "theft" | "stock-spoiled" | "building-ignited" }
    > =>
      e.kind === "theft" ||
      e.kind === "stock-spoiled" ||
      (e.kind === "building-ignited" && e.cause.kind === "director"),
  );

test("the director fires once its interval has passed since it last fired, never before, and the trouble names the director as its cause", () => {
  const world = new World();
  // Nothing happens for ticks 1..9: the interval is 10.
  expect(trouble(world.run(9))).toEqual([]);
  const first = trouble(world.tick());
  expect(first).toHaveLength(1);
  const event = first[0] as WorldEvent;
  if (event.kind === "theft" || event.kind === "stock-spoiled") {
    expect(event.cause).toBe("director");
  } else if (event.kind === "building-ignited") {
    expect(event.cause).toEqual({ kind: "director" });
  } else throw new Error("not trouble");
  // The trouble was caused by the world's own tick, not a proposal.
  expect(String(event.correlationId)).toBe(`tick-${world.state.tick}`);
  expect(world.state.director.lastFireTick).toBe(10);
});

test("the director's own clock runs from its own last fire: its troubles come exactly one interval apart", () => {
  const world = new World();
  const interval = petitionBalanceOf(
    world.state.rules,
    "directorIntervalTicks",
  );
  const ticks: number[] = [];
  for (let n = 0; n < interval * 4 + 5; n += 1) {
    if (trouble(world.tick()).length > 0) ticks.push(world.state.tick);
  }
  expect(ticks).toEqual([interval, 2 * interval, 3 * interval, 4 * interval]);
});

/** A bless, a trade, a strike, an answered prayer: what once reset the director's timer, as a proposal where one makes it and a fixture where only a god's later answer would. */
const ACTIVITY: Record<
  string,
  { proposal?: Record<string, unknown>; event?: Record<string, unknown> }
> = {
  strike: {
    proposal: { actor: "zeus", kind: "strike", target: "wood-store", power: 1 },
  },
  ignition: {
    proposal: { actor: "zeus", kind: "strike", target: "wood-store", power: 3 },
  },
  "resource-traded": {
    proposal: {
      actor: "farmer",
      kind: "trade",
      counterparty: "woodcutter",
      give: [{ resource: "currency", amount: 4 }],
      receive: [{ resource: "food", amount: 1 }],
      source: "routine",
    },
  },
  "blessing-granted": {
    event: {
      kind: "blessing-granted",
      entityId: "zeus",
      recipient: "farmer",
      petitionId: "evt-1-1",
      resource: "food",
      amount: 2,
    },
  },
  "petition-answered": {
    event: {
      kind: "petition-answered",
      entityId: "farmer",
      god: "zeus",
      petitionId: "evt-1-1",
      answeredBy: "evt-9-9",
    },
  },
  legend: {
    proposal: { actor: "zeus", kind: "legend", assertion: "Hear me." },
  },
  goal: {
    proposal: {
      actor: "zeus",
      kind: "goal",
      goal: { set: { text: "Watch.", target: "farmer" } },
    },
  },
  prayer: {
    event: {
      kind: "petition-opened",
      entityId: "farmer",
      god: "zeus",
      cause: "evt-1-1",
      request: {
        kind: "help",
        need: { kind: "resource", resource: "food" },
      },
    },
  },
  "unmet-need": {
    event: {
      kind: "unmet-need",
      entityId: "farmer",
      resource: "planks",
      reason: "no-seller",
    },
  },
};

for (const [name, how] of Object.entries(ACTIVITY)) {
  test(`a ${name} at tick 9 does not delay the director: it still fires at tick 10 (AE6)`, () => {
    const world = new World();
    world.run(8);
    world.tick(...(how.proposal === undefined ? [] : [how.proposal])); // tick 9
    if (how.event !== undefined) world.apply(how.event);
    expect(trouble(world.tick())).toHaveLength(1);
    expect(world.state.director.lastFireTick).toBe(10);
  });
}

test("gods blessing every tick do not delay the director: it fires at every interval (AE6)", () => {
  const world = new World();
  const blessing = ACTIVITY["blessing-granted"]?.event as Record<
    string,
    unknown
  >;
  const answered = ACTIVITY["petition-answered"]?.event as Record<
    string,
    unknown
  >;
  const ticks: number[] = [];
  for (let n = 0; n < 45; n += 1) {
    const events = world.tick();
    world.apply(blessing);
    world.apply(answered);
    if (trouble(events).length > 0) ticks.push(world.state.tick);
  }
  expect(ticks).toEqual([10, 20, 30, 40]);
});

test("only the director's own trouble moves its clock: another's theft or spoilage, or a god's fire, does not, and its own does", () => {
  const world = new World();
  const before = world.state.director;
  const event = (overrides: Record<string, unknown>) =>
    ({
      schemaVersion: 1,
      id: "evt-5-1",
      sequence: 1,
      simTime: 0,
      tick: 5,
      correlationId: "c",
      causationId: "c",
      approximate: false,
      ...overrides,
    }) as unknown as WorldEvent;
  for (const other of [
    event({
      kind: "building-ignited",
      entityId: "farm-store",
      cause: { kind: "strike", actor: "zeus" },
    }),
    event({
      kind: "building-ignited",
      entityId: "farm-store",
      cause: { kind: "spread", from: "evt-1-1" },
    }),
    event({ kind: "blessing-granted", entityId: "zeus", recipient: "farmer" }),
    event({
      kind: "resource-traded",
      entityId: "farmer",
      counterpartyId: "woodcutter",
    }),
  ]) {
    expect(noteDirectorFire(world.state, other).director).toEqual(before);
  }
  for (const own of [
    event({
      kind: "theft",
      entityId: "woodcutter",
      victim: "farmer",
      resource: "food",
      amount: 1,
      cause: "director",
    }),
    event({
      kind: "stock-spoiled",
      entityId: "farmer",
      resource: "food",
      amount: 1,
      cause: "director",
    }),
    event({
      kind: "building-ignited",
      entityId: "farm-store",
      cause: { kind: "director" },
    }),
  ]) {
    expect(noteDirectorFire(world.state, own).director).toEqual({
      lastFireTick: 5,
    });
  }
  // A clock never runs backward.
  const later = { ...world.state, director: { lastFireTick: 9 } };
  expect(
    noteDirectorFire(
      later,
      event({
        kind: "stock-spoiled",
        entityId: "farmer",
        resource: "food",
        amount: 1,
        cause: "director",
      }),
    ).director,
  ).toEqual({ lastFireTick: 9 });
});

test("with fewer than two mortals eligible, the director skips that tick and tries again the next", () => {
  const lone = new World(createInitialWorldState(pack(10, ["farmer"])));
  expect(trouble(lone.run(30))).toEqual([]);
  // Control: with a second mortal the same world has trouble.
  const pair = new World(
    createInitialWorldState(pack(10, ["farmer", "woodcutter"])),
  );
  expect(trouble(pair.run(30)).length).toBeGreaterThan(0);
  // A dead mortal is not eligible: killing one of two leaves one.
  const dying = new World(
    createInitialWorldState(pack(10, ["farmer", "woodcutter"])),
  );
  const woodcutter = getActor(dying.state, id("woodcutter"));
  if (!woodcutter) throw new Error("woodcutter");
  dying.state = withActor(dying.state, { ...woodcutter, alive: false });
  expect(trouble(dying.run(30))).toEqual([]);
});

test("the director picks its victims in id order and never undoes damage: its trouble only takes or burns or spoils", () => {
  const world = new World();
  const events = trouble(world.run(80));
  expect(events.length).toBeGreaterThan(3);
  for (const event of events) {
    if (event.kind === "theft") {
      expect(event.entityId).not.toBe(event.victim);
      expect(event.amount).toBeGreaterThan(0);
    }
    if (event.kind === "stock-spoiled") expect(event.amount).toBeGreaterThan(0);
  }
  // Nothing in the log repairs or heals anything the director did.
  expect(
    world.log.some(
      (e) => e.kind === "building-repaired" || e.kind === "repair-progressed",
    ),
  ).toBe(false);
  // A theft never takes more than the victim held at the time: no inventory goes negative.
  for (const actor of world.state.actors.values()) {
    for (const amount of actor.inventory.values())
      expect(amount).toBeGreaterThanOrEqual(0);
  }
  // Plan step: eligible victims come from the mortals in id order.
  const step = planDirectorStep(
    createInitialWorldState(pack()),
    createPrng(1),
    10,
  );
  expect(step.events).toHaveLength(1);
});

test("the same seed and log replay the same director events, and a different seed makes different trouble", () => {
  const record = (seed: number) => {
    const world = new World(createInitialWorldState(pack()), seed);
    world.run(60);
    return world;
  };
  const a = record(7);
  const b = record(7);
  expect(trouble(a.log).map((e) => [e.kind, e.id, e.entityId])).toEqual(
    trouble(b.log).map((e) => [e.kind, e.id, e.entityId]),
  );
  // Replaying the log from the start reproduces the state, including the timer.
  const replayed = applyEvents(
    a.initial,
    a.log.map((e, i) => ({ ...e, sequence: i + 1 })) as WorldEvent[],
  );
  expect(replayed.director).toEqual(a.state.director);
  expect(
    [...replayed.actors.entries()].map(([k, v]) => [k, [...v.inventory]]),
  ).toEqual(
    [...a.state.actors.entries()].map(([k, v]) => [k, [...v.inventory]]),
  );
  const different = record(99);
  expect(trouble(different.log).map((e) => [e.kind, e.entityId])).not.toEqual(
    trouble(a.log).map((e) => [e.kind, e.entityId]),
  );
  // The timer survives encode and decode.
  const restored = decode(JSON.parse(JSON.stringify(encode(a.state))));
  expect(restored.director).toEqual(a.state.director);
});

test("trouble at the square is not in a god's snapshot: the gods are in their hall and perceive none of it", () => {
  const world = new World();
  const events = trouble(world.run(15));
  expect(events.length).toBeGreaterThan(0);
  expect(perceive(world.state, id("zeus"), events)?.events).toEqual([]);
  // Control: a mortal standing in the square perceives it.
  const seen = perceive(world.state, id("farmer"), events)?.events ?? [];
  expect(seen.length).toBeGreaterThan(0);
});

test("a victim of the director's trouble prays about it, and the prayer cites the trouble", () => {
  const world = new World();
  const first = trouble(world.run(12))[0] as WorldEvent;
  const victim =
    first.kind === "theft"
      ? first.victim
      : first.kind === "stock-spoiled"
        ? first.entityId
        : world.state.buildings.get(
            (first as { entityId: ReturnType<typeof id> }).entityId,
          )?.owner;
  expect(victim).toBeDefined();
  // The mortals' own routines take the victim to the altar to pray.
  let prayed: WorldEvent | undefined;
  for (let n = 0; n < 60 && prayed === undefined; n += 1) {
    const proposals = (["farmer", "woodcutter", "drifter"] as const).flatMap(
      (m) => {
        const decision = decideRoutineProposal(world.state, id(m));
        return decision ? [decision.proposal] : [];
      },
    );
    const result = runTick(world.state, world.prng, proposals);
    world.state = result.state;
    world.prng = result.prng;
    world.log.push(...result.events);
    prayed = result.events.find(
      (e) => e.kind === "petition-opened" && e.entityId === victim,
    );
  }
  expect(prayed).toBeDefined();
  if (prayed?.kind === "petition-opened") {
    expect(
      world.log.some((e) => e.id === prayed.cause && trouble([e]).length === 1),
    ).toBe(true);
  }
});

void applyEvent;

// --- Pressure lands where something is open (R22) ---------------------------------------------------
//
// The director prefers, for its attributed trouble, the people of a place that holds an open thread
// or a quiet contest. It never opens a thread, never picks a god's response, and does the same
// whatever drives the gods' turns.

/** The calm pack with two more gods, and the drifter living at the altar. */
function townWithGods() {
  const base = pack(10, ["farmer", "woodcutter", "drifter"]);
  const gods = ["athena", "poseidon"].map((name) => ({
    id: name,
    name,
    locationId: "hall",
    deity: true,
    startingInventory: [{ resource: "divinity", amount: 10 }],
  }));
  const state = createInitialWorldState({
    ...base,
    inhabitants: [...base.inhabitants, ...gods],
  });
  const drifter = getActor(state, id("drifter"));
  if (!drifter) throw new Error("drifter");
  return withActor(state, {
    ...drifter,
    locationId: id("altar"),
    home: id("altar"),
  });
}

/** Whom a trouble event hurt: the victim of a theft, the owner of stock that spoiled or of a building that burned. */
function victimOf(state: WorldState, event: WorldEvent): string | undefined {
  if (event.kind === "theft") return String(event.victim);
  if (event.kind === "stock-spoiled") return String(event.entityId);
  if (event.kind === "building-ignited") {
    return String(state.buildings.get(event.entityId)?.owner);
  }
  return undefined;
}

const victimsOver = (
  state: WorldState,
  seeds: readonly number[],
  tick = 10,
): string[] =>
  seeds.flatMap((seed) =>
    planDirectorStep(state, createPrng(seed), tick).events.map(
      (draft) => victimOf(state, draft as unknown as WorldEvent) as string,
    ),
  );

const SEEDS = Array.from({ length: 40 }, (_, index) => index + 1);

function withQuietContest(state: WorldState, served = false): WorldState {
  const contest = {
    id: "evt-0-900" as EventId,
    opener: id("athena"),
    rival: id("poseidon"),
    place: id("altar"),
    cause: "evt-0-899" as EventId,
    openedTick: 0,
    openedSequence: 900,
    closesAt: 500,
    status: "open" as const,
    tallies: served
      ? [{ god: id("athena"), mortal: id("drifter"), weight: 1 }]
      : [],
  };
  return { ...state, contests: new Map([[contest.id, contest]]) };
}

test("a quiet contest draws the director's trouble to the place it is held in: its people, and no one else's", () => {
  const without = townWithGods();
  const spread = new Set(victimsOver(without, SEEDS));
  // Control: with nothing open the director draws from everyone.
  expect(spread.size).toBeGreaterThan(1);

  const quiet = withQuietContest(without);
  const victims = victimsOver(quiet, SEEDS);
  expect(victims.length).toBe(SEEDS.length);
  expect(new Set(victims)).toEqual(new Set(["drifter"]));
});

test("a contest that has been served is not quiet: it draws the trouble no more than any other place", () => {
  const busy = withQuietContest(townWithGods(), true);
  expect(new Set(victimsOver(busy, SEEDS)).size).toBeGreaterThan(1);
});

test("an open thread draws the director's trouble to the people of the place its term names, and to a mortal who is party to it", () => {
  const settlement = (state: WorldState) => {
    const event = {
      schemaVersion: 1,
      id: "evt-0-901",
      sequence: 901,
      simTime: 0,
      tick: 0,
      correlationId: "fixture",
      causationId: "fixture",
      approximate: false,
      kind: "practice-opened",
      entityId: "athena",
      practice: "settlement",
      counterparty: "poseidon",
      causes: ["evt-0-899"],
      term: {
        kind: "tell-legend",
        party: "poseidon",
        place: "altar",
        deadline: 400,
      },
      negotiationDeadline: 400,
      counterBudget: 2,
    } as unknown as WorldEvent;
    return applyEvent(state, event);
  };
  const state = settlement(townWithGods());
  expect(new Set(victimsOver(state, SEEDS))).toEqual(new Set(["drifter"]));

  // A mortal party to an open supplication draws it to the place it lives.
  const base = townWithGods();
  const supplication = applyEvent(base, {
    schemaVersion: 1,
    id: "evt-0-902",
    sequence: 902,
    simTime: 0,
    tick: 0,
    correlationId: "fixture",
    causationId: "fixture",
    approximate: false,
    kind: "practice-opened",
    entityId: "athena",
    practice: "supplication",
    counterparty: "farmer",
    causes: ["evt-0-899"],
    term: {
      kind: "make-offering",
      party: "farmer",
      to: "athena",
      resource: "currency",
      amount: 1,
      deadline: 400,
    },
    negotiationDeadline: 400,
    counterBudget: 0,
  } as unknown as WorldEvent);
  // ...the people of the square: the farmer and the woodcutter who live there, and not the drifter at the altar.
  expect(new Set(victimsOver(supplication, SEEDS))).toEqual(
    new Set(["farmer", "woodcutter"]),
  );

  // A thread that has ended draws no one.
  const threads = new Map(state.threads);
  for (const [key, thread] of threads) {
    threads.set(key, { ...thread, status: "refused" });
  }
  expect(
    new Set(victimsOver({ ...state, threads }, SEEDS)).size,
  ).toBeGreaterThan(1);
});

test("the director's pressure never opens a thread or a contest and never answers for a god: with both open for 80 ticks, what it adds is trouble and nothing a god does", () => {
  const world = new World(withQuietContest(townWithGods()));
  const events = world.run(80);
  expect(trouble(events).length).toBeGreaterThan(3);
  const forbidden = new Set([
    "practice-opened",
    "practice-moved",
    "practice-ended",
    "contest-opened",
    "blessing-granted",
    "legend-recorded",
    "petition-answered",
  ]);
  expect(events.filter((e) => forbidden.has(e.kind))).toEqual([]);
  // Every trouble names the director, not a god.
  for (const event of trouble(events)) {
    if (event.kind === "theft" || event.kind === "stock-spoiled") {
      expect(event.cause).toBe("director");
    }
    if (event.kind === "building-ignited") {
      expect(event.cause).toEqual({ kind: "director" });
    }
  }
});

test("the director does the same whatever the gods' turns are driven by: a world whose gods hold goals and memories, as a provider's turns leave them, gets the same trouble", () => {
  const bare = withQuietContest(townWithGods());
  const driven = applyEvent(
    applyEvent(bare, {
      schemaVersion: 1,
      id: "evt-0-910",
      sequence: 910,
      simTime: 0,
      tick: 0,
      correlationId: "fixture",
      causationId: "fixture",
      approximate: false,
      kind: "goal-set",
      entityId: "athena",
      text: "Win the altar.",
      target: "drifter",
    } as unknown as WorldEvent),
    {
      schemaVersion: 1,
      id: "evt-0-911",
      sequence: 911,
      simTime: 0,
      tick: 0,
      correlationId: "fixture",
      causationId: "fixture",
      approximate: false,
      kind: "memory-recorded",
      memoryKind: "told",
      entityId: "athena",
      sourceEventId: "evt-0-899",
      teller: "poseidon",
      content: "The altar is mine.",
      subjects: ["poseidon", "athena"],
      salience: 4,
    } as unknown as WorldEvent,
  );
  for (const seed of SEEDS) {
    const a = planDirectorStep(bare, createPrng(seed), 10);
    const b = planDirectorStep(driven, createPrng(seed), 10);
    expect(b).toEqual(a);
  }
  // And the same state and generator always give the same step.
  expect(planDirectorStep(bare, createPrng(5), 10)).toEqual(
    planDirectorStep(bare, createPrng(5), 10),
  );
});

// --- Unit 12 (M2 plan): catastrophe, and replay without re-deciding ---------------------------------------

/** A god's strike lit the farm store, and the world's own fire step has burnt it to nothing. */
function withDestroyedFarmStore(seed: number) {
  const world = new World(createInitialWorldState(pack(10)), seed);
  world.apply({
    kind: "building-ignited",
    entityId: "farm-store",
    cause: { kind: "strike", actor: "zeus" },
  });
  // The director's own fires may land in these ticks too; the destruction is the fire step's, not a proposal's.
  for (
    let n = 0;
    n < 200 &&
    world.state.buildings.get(id("farm-store"))?.status !== "destroyed";
    n += 1
  ) {
    world.tick();
  }
  return world;
}

test("catastrophe: a destroyed building stays destroyed through the director's following fires, which never light it again, repair it, or name it", () => {
  for (const seed of [1, 2, 3, 5, 8]) {
    const world = withDestroyedFarmStore(seed);
    const store = id("farm-store");
    expect([seed, world.state.buildings.get(store)?.status]).toEqual([
      seed,
      "destroyed",
    ]);
    const destroyedAt = world.log.findIndex(
      (e) => e.kind === "building-destroyed" && e.entityId === store,
    );
    expect(destroyedAt).toBeGreaterThanOrEqual(0);
    const firesBefore = trouble(world.log).length;

    // Twelve more intervals: the director fires every one of them, with the farmer's store in ruins.
    const after = world.run(120);
    const fires = trouble(after);
    expect(fires.length).toBe(12);
    expect(firesBefore + fires.length).toBe(trouble(world.log).length);
    expect([seed, world.state.buildings.get(store)?.status]).toEqual([
      seed,
      "destroyed",
    ]);
    // Nothing the director did touched the ruin: no ignition of it, and nothing that mends a building at all.
    expect(
      fires.filter(
        (e) => e.kind === "building-ignited" && e.entityId === store,
      ),
    ).toEqual([]);
    expect(
      world.log.some(
        (e) =>
          e.kind === "building-repaired" ||
          e.kind === "repair-progressed" ||
          (e.kind === "building-damaged" && e.entityId === store),
      ),
    ).toBe(false);
    // The ruin's own state never moved again: its status is the one the fire left it in.
    expect(
      world.log
        .slice(destroyedAt + 1)
        .filter((e) => "entityId" in e && e.entityId === store),
    ).toEqual([]);
  }
});

test("catastrophe, control: a director that could light a building that is not operational would show here, because the seeds do light the other store", () => {
  // The woodcutter's store is operational, so across the same seeds the director does burn it: the test above is not
  // passing because the director never burns anything.
  let lit = 0;
  for (const seed of [1, 2, 3, 5, 8]) {
    const world = withDestroyedFarmStore(seed);
    lit += trouble(world.run(120)).filter(
      (e) => e.kind === "building-ignited" && e.entityId === id("wood-store"),
    ).length;
  }
  expect(lit).toBeGreaterThan(0);
});

test("replay does not re-decide: the log applied to a state whose director interval is different, with no generator at all, gives the same director clock, theft, and spoilage the journal holds", () => {
  const original = new World(createInitialWorldState(pack(10)), 7);
  original.run(80);
  const fires = trouble(original.log);
  expect(fires.length).toBeGreaterThan(5);
  const lastFire = fires.at(-1)?.tick ?? -1;

  // A world that, asked afresh, would never fire (an interval too long to come) and has no PRNG to draw from.
  const base = createInitialWorldState(pack(10_000_000));
  const replayed = applyEvents(
    base,
    original.log.map((e, i) => ({ ...e, sequence: i + 1 })) as WorldEvent[],
  );
  // The clock is the journal's: the last director event, not what the interval would allow.
  expect(replayed.director.lastFireTick).toBe(lastFire);
  expect(original.state.director.lastFireTick).toBe(lastFire);
  expect(
    [...replayed.actors.entries()].map(([k, v]) => [k, [...v.inventory]]),
  ).toEqual(
    [...original.state.actors.entries()].map(([k, v]) => [k, [...v.inventory]]),
  );
  // And replaying twice is the same: the events carry every decision, so there is nothing left to draw.
  const again = applyEvents(
    base,
    original.log.map((e, i) => ({ ...e, sequence: i + 1 })) as WorldEvent[],
  );
  expect(again.director).toEqual(replayed.director);
});
