// A god's journey: a destination the world walks one hop a tick. `travel`
// stores it, every tick turns the next hop into a validated move or
// realm-transition, and the journey ends on arrival, on a refused hop, or when
// the god commits another proposal. A refused hop moves nothing.

import { expect, test } from "bun:test";
import type { ContentPack, Proposal, WorldEvent } from "@panthea/contracts";
import { applyEvents, runTick, submitProposal } from "./actions";
import { decode, encode } from "./codec";
import { getJourney } from "./journey";
import { perceive } from "./perception";
import {
  createInitialWorldState,
  createPrng,
  toEntityId,
  type WorldState,
} from "./state";

const id = toEntityId;

/**
 * Tavern and lane hang off the square; the square's divine transport leads to
 * Olympus's gate and its hall. The pit is a plain path from the tavern across
 * realms (not an authored crossing), and the sanctum asks for a capability no
 * one here holds.
 */
function pack(): ContentPack {
  return {
    schemaVersion: 1,
    realms: ["mortal", "olympus", "underworld"],
    resources: [],
    locations: [
      {
        id: "tavern",
        realm: "mortal",
        name: "The Tavern",
        edges: [
          { to: "square", transport: "path", bidirectional: true },
          { to: "pit", transport: "path", bidirectional: true },
        ],
      },
      {
        id: "square",
        realm: "mortal",
        name: "The Square",
        edges: [
          { to: "lane", transport: "path", bidirectional: true },
          { to: "gate", transport: "divine-transport", bidirectional: true },
        ],
      },
      { id: "lane", realm: "mortal", name: "The Lane", edges: [] },
      {
        id: "gate",
        realm: "olympus",
        name: "Olympus Gate",
        requiredCapability: "divine",
        edges: [{ to: "hall", transport: "path", bidirectional: true }],
      },
      { id: "hall", realm: "olympus", name: "The Great Hall", edges: [] },
      { id: "pit", realm: "underworld", name: "The Pit", edges: [] },
      {
        id: "sanctum",
        realm: "olympus",
        name: "The Sanctum",
        requiredCapability: "initiate",
        edges: [{ to: "hall", transport: "path", bidirectional: true }],
      },
    ],
    buildings: [],
    inhabitants: [
      { id: "zeus", name: "Zeus", locationId: "tavern", deity: true },
      { id: "hera", name: "Hera", locationId: "tavern", deity: true },
      { id: "farmer", name: "The Farmer", locationId: "tavern" },
      { id: "bard", name: "The Bard", locationId: "lane" },
    ],
    rules: {
      catchUpCapMs: 0,
      catchUpChunkMs: 0,
      checkpointIntervalMs: 0,
      maxProposalsPerTick: 100,
      fireBalance: {},
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
    observationId: `obs-j${observations}`,
    ...raw,
  });
  if (!submitted.ok) throw new Error(submitted.rejection.message);
  return submitted.proposal;
}

const travel = (actor: string, to: string) =>
  propose({ actor, kind: "travel", to });

function tick(state: WorldState, ...queue: Proposal[]) {
  return runTick(state, createPrng(1), queue);
}

const start = () => createInitialWorldState(pack());

/** `state` with one actor's fields changed, as a penalty or another hand might leave them. */
function withActor(
  state: WorldState,
  actor: string,
  patch: Partial<NonNullable<ReturnType<WorldState["actors"]["get"]>>>,
): WorldState {
  const current = state.actors.get(id(actor));
  if (current === undefined) throw new Error(actor);
  return {
    ...state,
    actors: new Map(state.actors).set(id(actor), { ...current, ...patch }),
  };
}
const kinds = (events: readonly WorldEvent[]) => events.map((e) => e.kind);
const where = (state: WorldState, actor: string) =>
  String(state.actors.get(id(actor))?.locationId);
const journeyEvents = (events: readonly WorldEvent[]) =>
  events.filter(
    (e) => e.kind === "journey-started" || e.kind === "journey-ended",
  );

/** Runs `ticks` empty ticks from `state`, returning each tick's result. */
function idle(state: WorldState, ticks: number) {
  const results = [];
  let current = state;
  for (let i = 0; i < ticks; i += 1) {
    const result = tick(current);
    results.push(result);
    current = result.state;
  }
  return results;
}

// --- Starting --------------------------------------------------------------------------

test("a travel proposal stores a journey and the first hop happens on the tick it is applied", () => {
  const result = tick(start(), travel("zeus", "hall"));
  expect(result.rejected).toEqual([]);
  expect(kinds(result.events)).toEqual(["journey-started", "entity-moved"]);
  const started = result.events[0];
  expect(started).toMatchObject({
    kind: "journey-started",
    entityId: "zeus",
    to: "hall",
  });
  // One hop already: the god stands at the square, still travelling.
  expect(where(result.state, "zeus")).toBe("square");
  expect(getJourney(result.state, id("zeus")) as unknown).toEqual({
    destination: "hall",
    eventId: started?.id,
  });
  // The hop is an ordinary move, caused by the journey it belongs to.
  expect(result.events[1]).toMatchObject({
    kind: "entity-moved",
    entityId: "zeus",
    to: "square",
    correlationId: started?.id,
  });
  // Control: no one else travels.
  expect(getJourney(result.state, id("hera"))).toBeUndefined();
  expect(where(result.state, "hera")).toBe("tavern");
});

test("a one-hop trip costs what a move costs: it starts, moves, and arrives in the same tick", () => {
  const result = tick(start(), travel("zeus", "square"));
  expect(kinds(result.events)).toEqual([
    "journey-started",
    "entity-moved",
    "journey-ended",
  ]);
  expect(result.events[2]).toMatchObject({
    kind: "journey-ended",
    ending: "arrived",
    journeyEventId: result.events[0]?.id,
  });
  expect(where(result.state, "zeus")).toBe("square");
  expect(getJourney(result.state, id("zeus"))).toBeUndefined();
});

// --- Walking --------------------------------------------------------------------------

test("each tick advances a journey one hop, crossing realms only through an authored transport, and an arrived ending follows the last hop", () => {
  const first = tick(start(), travel("zeus", "hall"));
  const [second, third, fourth] = idle(first.state, 3);

  // Tavern -> square (travel's tick), square -> gate across the divine transport, gate -> hall.
  expect(kinds(second?.events ?? [])).toEqual(["realm-transitioned"]);
  expect(second?.events[0]).toMatchObject({
    to: "gate",
    via: "square",
    correlationId: first.events[0]?.id,
  });
  expect(where(second?.state as WorldState, "zeus")).toBe("gate");
  expect(getJourney(second?.state as WorldState, id("zeus"))).toBeDefined();

  expect(kinds(third?.events ?? [])).toEqual(["entity-moved", "journey-ended"]);
  expect(third?.events[1]).toMatchObject({
    kind: "journey-ended",
    ending: "arrived",
    entityId: "zeus",
  });
  expect(where(third?.state as WorldState, "zeus")).toBe("hall");
  expect(getJourney(third?.state as WorldState, id("zeus"))).toBeUndefined();

  // Nothing more happens: the journey is over.
  expect(fourth?.events ?? []).toEqual([]);
  expect(where(fourth?.state as WorldState, "zeus")).toBe("hall");
});

test("the route is recomputed every tick from where the god is, not fixed at the start", () => {
  const first = tick(start(), travel("zeus", "lane"));
  // Tavern -> square -> lane. Someone carries zeus to the lane's far side of the map by another means: a state edit stands in for it.
  const nudged = withActor(first.state, "zeus", { locationId: id("lane") });
  const next = tick(nudged);
  // Already at the destination: it arrives without a hop.
  expect(kinds(next.events)).toEqual(["journey-ended"]);
  expect(next.events[0]).toMatchObject({ ending: "arrived" });
});

// --- Refusal ---------------------------------------------------------------------------

test("a hop the validators refuse ends the journey as refused with the world's reason and moves nothing", () => {
  // The pit lies across a plain path: a route exists, but no authored crossing leads there.
  const result = tick(start(), travel("zeus", "pit"));
  expect(result.rejected).toEqual([]);
  expect(kinds(result.events)).toEqual(["journey-started", "journey-ended"]);
  expect(result.events[1]).toMatchObject({
    kind: "journey-ended",
    ending: "refused",
    reason: "restricted-realm",
    journeyEventId: result.events[0]?.id,
  });
  expect(where(result.state, "zeus")).toBe("tavern");
  expect(getJourney(result.state, id("zeus"))).toBeUndefined();
});

test("a god that loses the capability a place on its route needs is refused at the next hop, stays where it is, and the journey ends", () => {
  const first = tick(start(), travel("zeus", "hall"));
  const stripped = withActor(first.state, "zeus", { capabilities: [] });
  const next = tick(stripped);
  expect(kinds(next.events)).toEqual(["journey-ended"]);
  // The map has a way there; this god may not take it.
  expect(next.events[0]).toMatchObject({
    ending: "refused",
    reason: "restricted-realm",
  });
  expect(where(next.state, "zeus")).toBe("square");
  expect(getJourney(next.state, id("zeus"))).toBeUndefined();
  // No retry: the next tick holds nothing.
  expect(tick(next.state).events).toEqual([]);
});

test("a travel proposal to a place the god may not reach, an unknown place, or the place the god is at is refused at validation and stores nothing", () => {
  for (const [to, reason] of [
    // A place only an initiate may enter: the god lacks the capability, so no route is open to it.
    ["sanctum", "restricted-realm"],
    ["nowhere", "malformed"],
    ["tavern", "malformed"],
  ] as const) {
    const result = tick(start(), travel("zeus", to));
    expect(result.rejected.map((r) => r.reason)).toEqual([reason]);
    expect(journeyEvents(result.events)).toEqual([]);
    expect(result.state.journeys.size).toBe(0);
    expect(where(result.state, "zeus")).toBe("tavern");
  }
});

// --- Replacement ----------------------------------------------------------------------

test("the god's next committed proposal ends the journey as replaced, before that proposal's own events, and no hop follows", () => {
  const first = tick(start(), travel("zeus", "hall"));
  const journeyId = first.events[0]?.id;
  const second = tick(
    first.state,
    propose({ actor: "zeus", kind: "move", to: "tavern" }),
  );
  expect(kinds(second.events)).toEqual(["journey-ended", "entity-moved"]);
  expect(second.events[0]).toMatchObject({
    kind: "journey-ended",
    ending: "replaced",
    journeyEventId: journeyId,
  });
  expect(where(second.state, "zeus")).toBe("tavern");
  expect(getJourney(second.state, id("zeus"))).toBeUndefined();
  expect(tick(second.state).events).toEqual([]);
});

test("a new travel proposal replaces the journey and takes its first hop at once", () => {
  const first = tick(start(), travel("zeus", "hall"));
  const second = tick(first.state, travel("zeus", "lane"));
  expect(kinds(second.events)).toEqual([
    "journey-ended",
    "journey-started",
    "entity-moved",
    "journey-ended",
  ]);
  expect(second.events[0]).toMatchObject({
    ending: "replaced",
    journeyEventId: first.events[0]?.id,
  });
  expect(second.events[3]).toMatchObject({ ending: "arrived" });
  expect(where(second.state, "zeus")).toBe("lane");
});

test("a rejected proposal commits nothing and leaves the journey running", () => {
  const first = tick(start(), travel("zeus", "hall"));
  const second = tick(
    first.state,
    propose({ actor: "zeus", kind: "move", to: "hall" }),
  );
  expect(second.rejected).toHaveLength(1);
  // The journey walked on regardless.
  expect(kinds(second.events)).toEqual(["realm-transitioned"]);
  expect(getJourney(second.state, id("zeus"))).toBeDefined();
});

test("a journey belongs to its god: another actor's proposal does not end it", () => {
  const first = tick(start(), travel("zeus", "hall"));
  const second = tick(
    first.state,
    propose({ actor: "hera", kind: "move", to: "square" }),
  );
  expect(getJourney(second.state, id("zeus"))).toBeDefined();
  expect(second.events.some((e) => e.kind === "journey-ended")).toBe(false);
});

// --- Privacy --------------------------------------------------------------------------

test("a journey is the god's own: no snapshot, the god's included, carries a journey event, while each hop is witnessed like any move", () => {
  const first = tick(start(), travel("zeus", "hall"));
  const [second] = idle(first.state, 1);
  const events = [...first.events, ...(second?.events ?? [])];
  expect(journeyEvents(events)).toHaveLength(1);
  // The farmer stands where the god's first hop landed: he sees the arrival, and nothing of why.
  const atSquare = withActor(second?.state as WorldState, "farmer", {
    locationId: id("square"),
  });
  for (const observer of ["zeus", "farmer", "bard"]) {
    const snapshot = perceive(atSquare, id(observer), events);
    expect(
      snapshot?.events.filter((e) => e.kind.startsWith("journey")) ?? [],
    ).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain("journey");
  }
});

// --- Replay and storage ---------------------------------------------------------------

test("replaying the log reproduces the journey, and the projection survives encode and decode while it is active", () => {
  const initial = start();
  let state = initial;
  const log: WorldEvent[] = [];
  for (const queue of [[travel("zeus", "hall")], [travel("hera", "square")]]) {
    const result = tick(state, ...queue);
    state = result.state;
    log.push(...result.events);
  }
  // Zeus is at the gate, still travelling; Hera has arrived.
  expect(getJourney(state, id("zeus"))?.destination).toBe(id("hall"));
  expect(getJourney(state, id("hera"))).toBeUndefined();
  const replayed = applyEvents(initial, log);
  expect([...replayed.journeys]).toEqual([...state.journeys]);
  expect(where(replayed, "zeus")).toBe(where(state, "zeus"));

  const restored = decode(JSON.parse(JSON.stringify(encode(state))));
  expect([...restored.journeys]).toEqual([...state.journeys]);
  // The restored world walks on exactly as the live one does.
  const live = tick(state);
  const resumed = tick(restored);
  expect(resumed.events).toEqual(live.events);
});

test("the same state and proposals walk the same journey every time", () => {
  const fixed = (actor: string, to: string) =>
    propose({ actor, kind: "travel", to, observationId: "obs-fixed" });
  const run = () => {
    let state = start();
    const events: WorldEvent[] = [];
    for (const queue of [[fixed("zeus", "hall")], [], [], []]) {
      const result = runTick(state, createPrng(7), queue);
      state = result.state;
      events.push(...result.events);
    }
    return JSON.stringify(events);
  };
  expect(run()).toBe(run());
});

test("decode refuses a journey held by someone who is not an actor, or toward a place that is not on the map", () => {
  const state = tick(start(), travel("zeus", "hall")).state;
  const encoded = JSON.parse(JSON.stringify(encode(state)));
  expect(() => decode(encoded)).not.toThrow();
  const [, journey] = encoded.journeys[0];
  expect(() => decode({ ...encoded, journeys: [["ghost", journey]] })).toThrow(
    /ghost/,
  );
  expect(() =>
    decode({
      ...encoded,
      journeys: [["zeus", { ...journey, destination: "atlantis" }]],
    }),
  ).toThrow(/atlantis/);
  expect(() =>
    decode({
      ...encoded,
      journeys: [
        ["zeus", journey],
        ["zeus", journey],
      ],
    }),
  ).toThrow(/duplicate/);
});

test("a place no edge leads to is refused as not-adjacent, as opposed to one the god may not enter", () => {
  const state = createInitialWorldState({
    ...pack(),
    locations: [
      ...pack().locations,
      { id: "island", realm: "mortal", name: "The Island", edges: [] },
    ],
  });
  const result = tick(state, travel("zeus", "island"));
  expect(result.rejected.map((r) => r.reason)).toEqual(["not-adjacent"]);
});
