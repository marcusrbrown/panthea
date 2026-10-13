import { expect, test } from "bun:test";
import type { ContentPack, Proposal, WorldEvent } from "@panthea/contracts";
import { applyEvents, runTick, submitProposal } from "./actions";
import { decode, encode } from "./codec";
import { getGoal } from "./goals";
import { perceive } from "./perception";
import {
  createInitialWorldState,
  createPrng,
  toEntityId,
  type WorldState,
} from "./state";

const id = toEntityId;

function pack(): ContentPack {
  return {
    schemaVersion: 1,
    realms: ["mortal"],
    resources: [],
    locations: [
      {
        id: "tavern",
        realm: "mortal",
        name: "The Tavern",
        edges: [{ to: "square", transport: "path", bidirectional: true }],
      },
      { id: "square", realm: "mortal", name: "The Square", edges: [] },
    ],
    buildings: [
      {
        id: "the-tavern",
        locationId: "tavern",
        name: "The Tavern House",
        material: "wood",
        combustible: true,
        services: [],
        inventory: [],
        owner: "farmer",
      },
    ],
    inhabitants: [
      {
        id: "zeus",
        sprite: "placeholder-zeus",
        name: "Zeus",
        locationId: "tavern",
        deity: true,
        startingInventory: [{ resource: "divinity", amount: 100 }],
      },
      {
        id: "hera",
        sprite: "placeholder-hera",
        name: "Hera",
        locationId: "tavern",
        deity: true,
      },
      {
        id: "farmer",
        sprite: "placeholder-farmer",
        name: "The Farmer",
        locationId: "tavern",
      },
      {
        id: "bard",
        sprite: "placeholder-bard",
        name: "The Bard",
        locationId: "square",
      },
    ],
    rules: {
      catchUpCapMs: 0,
      catchUpChunkMs: 0,
      checkpointIntervalMs: 0,
      maxProposalsPerTick: 100,
      fireBalance: { igniteThreshold: 3 },
      economyBalance: {},
    },
    recipes: {},
  };
}

let observations = 0;
function propose(raw: Record<string, unknown>): Proposal {
  observations += 1;
  const submitted = submitProposal({
    schemaVersion: 1,
    targets: [],
    expectedRevisions: [],
    source: "model",
    observationId: `obs-g${observations}`,
    ...raw,
  });
  if (!submitted.ok) throw new Error(submitted.rejection.message);
  return submitted.proposal;
}

const SET = (text: string, target: string) => ({ set: { text, target } });
const END = (outcome: string) => ({ end: { outcome } });

function tick(state: WorldState, ...queue: Proposal[]) {
  return runTick(state, createPrng(1), queue);
}

const kinds = (events: readonly WorldEvent[]) => events.map((e) => e.kind);
const goalEvents = (events: readonly WorldEvent[]) =>
  events.filter((e) => e.kind === "goal-set" || e.kind === "goal-ended");

const start = () => createInitialWorldState(pack());

// --- Setting and ending -------------------------------------------------------------------

test("a goal set on a move proposal records goal-set and the active goal shows its text, target, and the event that set it", () => {
  const result = tick(
    start(),
    propose({
      actor: "hera",
      kind: "move",
      to: "square",
      goal: SET("Win the farmer's devotion.", "farmer"),
    }),
  );
  expect(result.rejected).toEqual([]);
  const set = result.events.find((e) => e.kind === "goal-set");
  expect(set).toMatchObject({
    kind: "goal-set",
    entityId: "hera",
    text: "Win the farmer's devotion.",
    target: "farmer",
  });
  expect(getGoal(result.state, id("hera")) as unknown).toEqual({
    text: "Win the farmer's devotion.",
    target: "farmer",
    eventId: set?.id,
    sequence: set?.sequence,
    tick: set?.tick,
  });
  // The action itself still happened, and the goal came with its proposal's observation.
  expect(kinds(result.events)).toContain("entity-moved");
  expect(set?.correlationId as string).toBe(
    result.committed[0]?.proposal.observationId as string,
  );
  // Control: no one else has a goal.
  expect(getGoal(result.state, id("zeus"))).toBeUndefined();
});

test("a goal ended as achieved records goal-ended with that outcome, naming the goal it ends, and clears the active goal", () => {
  const first = tick(
    start(),
    propose({
      actor: "zeus",
      kind: "goal",
      goal: SET("Punish the farmer.", "farmer"),
    }),
  );
  const setId = getGoal(first.state, id("zeus"))?.eventId;
  const ended = tick(
    first.state,
    propose({ actor: "zeus", kind: "goal", goal: END("achieved") }),
  );
  expect(ended.events.find((e) => e.kind === "goal-ended")).toMatchObject({
    entityId: "zeus",
    outcome: "achieved",
    goalEventId: setId,
  });
  expect(getGoal(ended.state, id("zeus"))).toBeUndefined();
  // Control: ending with no active goal records nothing.
  const nothing = tick(
    ended.state,
    propose({ actor: "zeus", kind: "goal", goal: END("failed") }),
  );
  expect(goalEvents(nothing.events)).toEqual([]);
});

test("setting a goal while one is active ends the old one as abandoned, then sets the new one", () => {
  const first = tick(
    start(),
    propose({
      actor: "hera",
      kind: "goal",
      goal: SET("Make Zeus admit it.", "zeus"),
    }),
  );
  const oldId = getGoal(first.state, id("hera"))?.eventId;
  const second = tick(
    first.state,
    propose({
      actor: "hera",
      kind: "goal",
      goal: SET("Win the farmer.", "farmer"),
    }),
  );
  const events = goalEvents(second.events);
  expect(events.map((e) => e.kind)).toEqual(["goal-ended", "goal-set"]);
  expect(events[0]).toMatchObject({ outcome: "abandoned", goalEventId: oldId });
  expect(String(getGoal(second.state, id("hera"))?.target)).toBe("farmer");
  // Sequence follows the order: the end comes first.
  expect(events[0]?.sequence).toBeLessThan(events[1]?.sequence ?? 0);
});

test("an explicit end and a new set in one turn record the end first, as the declared outcome, with no extra abandonment", () => {
  const first = tick(
    start(),
    propose({
      actor: "hera",
      kind: "goal",
      goal: SET("Make Zeus admit it.", "zeus"),
    }),
  );
  const second = tick(
    first.state,
    propose({
      actor: "hera",
      kind: "move",
      to: "square",
      goal: { ...END("achieved"), ...SET("Win the farmer.", "farmer") },
    }),
  );
  const events = goalEvents(second.events);
  expect(events.map((e) => e.kind)).toEqual(["goal-ended", "goal-set"]);
  expect(events[0]).toMatchObject({ outcome: "achieved" });
  expect(getGoal(second.state, id("hera"))?.text).toBe("Win the farmer.");
});

// --- Whatever becomes of the action ----------------------------------------------------------

test("a strike rejected as stale-target still records the goal set it carried, and its rejection is unchanged", () => {
  const proposal = propose({
    actor: "zeus",
    kind: "strike",
    target: "the-tavern",
    power: 1,
    // A revision the building does not have: the proposal is stale.
    expectedRevisions: [{ entityId: "the-tavern", revision: 99 }],
    goal: SET("Burn the farmer's tavern.", "farmer"),
  });
  const result = tick(start(), proposal);
  expect(result.committed).toEqual([]);
  expect(result.rejected).toHaveLength(1);
  expect(result.rejected[0]?.reason).toBe("stale-target");
  // The goal is recorded and listed with the rejection.
  const goal = goalEvents(result.events);
  expect(kinds(goal)).toEqual(["goal-set"]);
  expect(result.rejected[0]?.goalEvents.map((e) => e.id)).toEqual(
    goal.map((e) => e.id),
  );
  expect(getGoal(result.state, id("zeus"))?.text).toBe(
    "Burn the farmer's tavern.",
  );
  // Control: the same strike with current revisions commits, and the goal rides along.
  const fresh = tick(
    start(),
    propose({
      actor: "zeus",
      kind: "strike",
      target: "the-tavern",
      power: 1,
      goal: SET("Burn the farmer's tavern.", "farmer"),
    }),
  );
  expect(fresh.rejected).toEqual([]);
  expect(kinds(fresh.committed[0]?.events ?? [])).toContain("goal-set");
});

test("a proposal rejected as busy-actor still records its goal change: goal events never use the action slot", () => {
  const result = tick(
    start(),
    propose({ actor: "hera", kind: "move", to: "square" }),
    propose({
      actor: "hera",
      kind: "move",
      to: "tavern",
      goal: SET("Win the farmer.", "farmer"),
    }),
  );
  expect(result.rejected.map((r) => r.reason)).toEqual(["busy-actor"]);
  expect(String(getGoal(result.state, id("hera"))?.target)).toBe("farmer");
});

test("a goal-only proposal records its goal event and no action event, and leaves the actor's action slot free", () => {
  const result = tick(
    start(),
    propose({
      actor: "hera",
      kind: "goal",
      goal: SET("Win the farmer.", "farmer"),
    }),
    propose({ actor: "hera", kind: "move", to: "square" }),
  );
  expect(result.rejected).toEqual([]);
  expect(result.committed).toHaveLength(2);
  expect(kinds(result.committed[0]?.events ?? [])).toEqual(["goal-set"]);
  expect(kinds(result.committed[1]?.events ?? [])).toEqual(["entity-moved"]);
  // Control: two actions in one tick still collide.
  const twice = tick(
    start(),
    propose({ actor: "hera", kind: "move", to: "square" }),
    propose({ actor: "hera", kind: "move", to: "tavern" }),
  );
  expect(twice.rejected.map((r) => r.reason)).toEqual(["busy-actor"]);
});

test("a goal change from an actor who does not exist or is dead records nothing", () => {
  const nobody = tick(
    start(),
    propose({ actor: "nobody", kind: "goal", goal: SET("Be.", "zeus") }),
  );
  expect(goalEvents(nobody.events)).toEqual([]);
  const state = start();
  const hera = state.actors.get(id("hera"));
  if (!hera) throw new Error("no hera");
  const dead: WorldState = {
    ...state,
    actors: new Map(state.actors).set(id("hera"), { ...hera, alive: false }),
  };
  const result = tick(
    dead,
    propose({ actor: "hera", kind: "goal", goal: SET("Be.", "zeus") }),
  );
  expect(goalEvents(result.events)).toEqual([]);
  // Control: the living actor's identical change records.
  expect(
    goalEvents(
      tick(
        start(),
        propose({ actor: "hera", kind: "goal", goal: SET("Be.", "zeus") }),
      ).events,
    ),
  ).toHaveLength(1);
});

test("the world never judges a goal: a target that is dead, absent, or not an actor at all is recorded as given", () => {
  const result = tick(
    start(),
    propose({
      actor: "hera",
      kind: "goal",
      goal: SET("Find the unseen.", "nowhere-at-all"),
    }),
  );
  expect(String(getGoal(result.state, id("hera"))?.target)).toBe(
    "nowhere-at-all",
  );
});

// --- Privacy -----------------------------------------------------------------------------------

test("another actor never perceives a goal event, and no witnessed memory is formed of one", () => {
  const result = tick(
    start(),
    propose({
      actor: "hera",
      kind: "goal",
      goal: SET("Win the farmer.", "farmer"),
    }),
  );
  expect(kinds(result.events)).toEqual(["goal-set"]);
  for (const observer of ["zeus", "farmer", "hera", "bard"]) {
    const seen = perceive(result.state, id(observer), result.events);
    expect(seen?.events ?? []).toEqual([]);
  }
  expect(result.derivedEvents).toEqual([]);
  expect(result.state.memories.size).toBe(0);
  // Control: a visible event beside it is perceived.
  const moved = tick(
    start(),
    propose({
      actor: "hera",
      kind: "move",
      to: "square",
      goal: SET("Win the farmer.", "farmer"),
    }),
  );
  const seen = perceive(moved.state, id("bard"), moved.events);
  expect(seen?.events.map((e) => e.kind)).toEqual(["entity-moved"]);
});

// --- Replay and storage ----------------------------------------------------------------------------

test("replaying the log reproduces every god's active goal, and the projection survives encode and decode", () => {
  let state = start();
  const initial = state;
  const log: WorldEvent[] = [];
  for (const queue of [
    [
      propose({
        actor: "hera",
        kind: "goal",
        goal: SET("Make Zeus admit it.", "zeus"),
      }),
    ],
    [
      propose({
        actor: "zeus",
        kind: "goal",
        goal: SET("Punish the farmer.", "farmer"),
      }),
    ],
    [
      propose({
        actor: "hera",
        kind: "move",
        to: "square",
        goal: SET("Win the farmer.", "farmer"),
      }),
    ],
    [propose({ actor: "zeus", kind: "goal", goal: END("achieved") })],
  ]) {
    const result = tick(state, ...queue);
    state = result.state;
    log.push(...result.events);
  }
  const replayed = applyEvents(initial, log);
  expect([...replayed.goals]).toEqual([...state.goals]);
  expect(String(getGoal(replayed, id("hera"))?.target)).toBe("farmer");
  expect(getGoal(replayed, id("zeus"))).toBeUndefined();

  const restored = decode(JSON.parse(JSON.stringify(encode(state))));
  expect([...restored.goals]).toEqual([...state.goals]);
});

test("decode refuses a goal held by someone who is not an actor", () => {
  const state = tick(
    start(),
    propose({
      actor: "hera",
      kind: "goal",
      goal: SET("Win the farmer.", "farmer"),
    }),
  ).state;
  const encoded = JSON.parse(JSON.stringify(encode(state)));
  expect(() => decode(encoded)).not.toThrow();
  const [, goal] = encoded.goals[0];
  expect(() => decode({ ...encoded, goals: [["ghost", goal]] })).toThrow(
    /ghost/,
  );
  expect(() =>
    decode({ ...encoded, goals: [["hera", { ...goal, text: "" }]] }),
  ).toThrow();
});

// --- The gate (petition features on) ------------------------------------------------------

const LOCK = 40;

/** The same world with the petition tunables stated, so goals are gated. */
function gated(): WorldState {
  const base = createInitialWorldState(pack());
  return {
    ...base,
    rules: { ...base.rules, petitionBalance: { goalLockTicks: LOCK } },
  };
}

/** A world where Hera set her goal at tick 1. */
function heraHasGoal(): WorldState {
  const result = tick(
    gated(),
    propose({
      actor: "hera",
      kind: "goal",
      goal: SET("Win the farmer.", "farmer"),
    }),
  );
  return result.state;
}

const later = (state: WorldState, ticks: number): WorldState => ({
  ...state,
  tick: state.tick + ticks,
});

const refusals = (events: readonly WorldEvent[]) =>
  events.filter((e) => e.kind === "goal-change-refused");

const replaceWith = (text = "Make Zeus admit it.", target = "zeus") =>
  propose({ actor: "hera", kind: "goal", goal: SET(text, target) });

test("setting the same goal again records nothing; so does text that differs only by case and spacing", () => {
  const state = heraHasGoal();
  const eventsBefore = state.lastSequence;
  for (const text of [
    "Win the farmer.",
    "win the farmer.",
    "  WIN   the\tfarmer.  ",
  ]) {
    const result = tick(
      later(state, 1),
      propose({ actor: "hera", kind: "goal", goal: SET(text, "farmer") }),
    );
    expect(goalEvents(result.events)).toEqual([]);
    expect(refusals(result.events)).toEqual([]);
    expect(result.state.lastSequence).toBe(eventsBefore);
    expect(getGoal(result.state, id("hera"))?.text).toBe("Win the farmer.");
  }
  // Control: the same words aimed at someone else are a different goal, and are gated like any replacement.
  const other = tick(
    later(state, 1),
    propose({
      actor: "hera",
      kind: "goal",
      goal: SET("Win the farmer.", "bard"),
    }),
  );
  expect(refusals(other.events)).toHaveLength(1);
});

test("a replacement two ticks after the set, with no news, is refused: the goal stays, and the refusal says why and when it unlocks", () => {
  const state = heraHasGoal();
  const result = tick(later(state, 1), replaceWith());
  expect(result.rejected).toEqual([]);
  expect(goalEvents(result.events)).toEqual([]);
  const [refused] = refusals(result.events);
  expect(refused).toMatchObject({
    kind: "goal-change-refused",
    entityId: "hera",
    reason: "locked",
    attempted: "replace",
    unlocksInTicks: LOCK - (result.state.tick - 1),
  });
  expect(getGoal(result.state, id("hera"))?.text).toBe("Win the farmer.");
  // It is private: no one else perceives it, and no memory is formed of it.
  expect(
    perceive(result.state, id("zeus"), [refused as WorldEvent])?.events,
  ).toEqual([]);
  expect(result.state.memories.size).toBe(0);
});

test("once the lock has passed a replacement is allowed: the old goal is abandoned and the new one set", () => {
  const state = heraHasGoal();
  const set = getGoal(state, id("hera"));
  const atLock = later(
    state,
    LOCK -
      1 -
      (state.tick - (set?.tick ?? 0)) +
      (state.tick - (set?.tick ?? 0)),
  );
  // One tick before the lock passes: still refused.
  const early = tick(
    { ...state, tick: (set?.tick ?? 0) + LOCK - 2 },
    replaceWith(),
  );
  expect(early.state.tick).toBe((set?.tick ?? 0) + LOCK - 1);
  expect(refusals(early.events)).toHaveLength(1);
  // On the tick the lock passes: allowed.
  const open = tick(
    { ...state, tick: (set?.tick ?? 0) + LOCK - 1 },
    replaceWith(),
  );
  expect(open.state.tick).toBe((set?.tick ?? 0) + LOCK);
  expect(refusals(open.events)).toEqual([]);
  expect(goalEvents(open.events).map((e) => e.kind)).toEqual([
    "goal-ended",
    "goal-set",
  ]);
  expect(getGoal(open.state, id("hera"))?.text).toBe("Make Zeus admit it.");
  void atLock;
});

test("something since the set unlocks it: a memory whose subjects include the target, or a petition addressed to this god; not one addressed to the other", () => {
  const state = heraHasGoal();
  const set = getGoal(state, id("hera"));
  const sequence = (set?.sequence ?? 0) + 1;
  const memory = (subjects: string[], after = sequence) => ({
    ...state,
    memories: new Map(state.memories).set(id("hera"), [
      {
        id: "evt-9-9" as never,
        sourceEventId: "evt-9-8" as never,
        salience: 5,
        recordedAt: after,
        subjects: subjects.map(id),
        kind: "witnessed" as const,
        eventKind: "entity-moved" as const,
      },
    ]),
  });
  // A memory of the target, formed since the goal was set.
  expect(
    refusals(tick(later(memory(["farmer"]), 1), replaceWith()).events),
  ).toEqual([]);
  // About someone else, or from before the set: no.
  expect(
    refusals(tick(later(memory(["bard"]), 1), replaceWith()).events),
  ).toHaveLength(1);
  expect(
    refusals(
      tick(later(memory(["farmer"], set?.sequence ?? 0), 1), replaceWith())
        .events,
    ),
  ).toHaveLength(1);

  const withPetition = (god: string, afterSequence = sequence) => ({
    ...state,
    petitions: new Map(state.petitions).set("evt-8-8" as never, {
      id: "evt-8-8" as never,
      petitioner: id("farmer"),
      god: id(god),
      cause: "evt-7-7" as never,
      about: {
        eventId: "evt-7-7" as never,
        tick: state.tick,
        kind: "need" as const,
        resource: "food",
      },
      request: {
        kind: "help" as const,
        need: { kind: "resource" as const, resource: "food" },
      },
      tick: state.tick + 1,
      sequence: afterSequence,
      status: "open" as const,
    }),
  });
  expect(
    refusals(tick(later(withPetition("hera"), 1), replaceWith()).events),
  ).toEqual([]);
  // The other god's petition does not unlock Hera's goal.
  expect(
    refusals(tick(later(withPetition("zeus"), 1), replaceWith()).events),
  ).toHaveLength(1);
  // A petition from before the set is not news.
  expect(
    refusals(
      tick(later(withPetition("hera", set?.sequence ?? 0), 1), replaceWith())
        .events,
    ),
  ).toHaveLength(1);
});

test("ending a goal as achieved or failed is allowed at any time; abandoning one is gated", () => {
  const state = later(heraHasGoal(), 1);
  for (const outcome of ["achieved", "failed"]) {
    const result = tick(
      state,
      propose({ actor: "hera", kind: "goal", goal: END(outcome) }),
    );
    expect(refusals(result.events)).toEqual([]);
    expect(goalEvents(result.events)).toMatchObject([
      { kind: "goal-ended", outcome },
    ]);
    expect(getGoal(result.state, id("hera"))).toBeUndefined();
  }
  const abandon = tick(
    state,
    propose({ actor: "hera", kind: "goal", goal: END("abandoned") }),
  );
  expect(refusals(abandon.events)).toMatchObject([
    { attempted: "abandon", reason: "locked" },
  ]);
  expect(getGoal(abandon.state, id("hera"))?.text).toBe("Win the farmer.");
  // An explicit achieved-then-set in one turn is not a replacement: nothing to gate.
  const done = tick(
    state,
    propose({
      actor: "hera",
      kind: "goal",
      goal: { ...END("achieved"), ...SET("Make Zeus admit it.", "zeus") },
    }),
  );
  expect(refusals(done.events)).toEqual([]);
  expect(getGoal(done.state, id("hera"))?.text).toBe("Make Zeus admit it.");
  // A first goal, with none active, is never gated.
  expect(refusals(tick(gated(), replaceWith()).events)).toEqual([]);
});

test("a refused change rides on its action whatever becomes of it: a rejected action still records the refusal, and replay reproduces the state", () => {
  const state = later(heraHasGoal(), 1);
  const stale = propose({
    actor: "zeus",
    kind: "strike",
    target: "the-tavern",
    power: 1,
    expectedRevisions: [{ entityId: "the-tavern", revision: 999 }],
    goal: SET("Burn it.", "farmer"),
  });
  const zeusGoal = tick(
    state,
    propose({ actor: "zeus", kind: "goal", goal: SET("Calm.", "hera") }),
  ).state;
  const result = tick(later(zeusGoal, 1), stale);
  expect(result.rejected.map((r) => r.reason)).toEqual(["stale-target"]);
  const refused = refusals(result.events);
  expect(refused).toHaveLength(1);
  expect(result.rejected[0]?.goalEvents.map((e) => e.id)).toEqual(
    refused.map((e) => e.id),
  );
  const replayed = applyEvents(
    createInitialWorldState(pack()),
    result.events.map((e) => e),
  );
  expect(getGoal(replayed, id("zeus"))).toBeUndefined();
});

test("a world whose pack states no petition tunables leaves goals ungated, as before", () => {
  const first = tick(
    start(),
    propose({ actor: "hera", kind: "goal", goal: SET("A.", "farmer") }),
  ).state;
  const swap = tick(
    first,
    propose({ actor: "hera", kind: "goal", goal: SET("B.", "zeus") }),
  );
  expect(refusals(swap.events)).toEqual([]);
  expect(goalEvents(swap.events).map((e) => e.kind)).toEqual([
    "goal-ended",
    "goal-set",
  ]);
});
