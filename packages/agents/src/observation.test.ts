import { expect, test } from "bun:test";
import {
  applyEvent,
  createPrng,
  getActor,
  getBuilding,
  getLocation,
  type PerceptionSnapshot,
  perceive,
  runTick,
  submitProposal,
  toEntityId,
  type WorldState,
  withActor,
  withBuilding,
} from "@panthea/world";
import { godIntentSchema, type ParsedGodIntent, rememberedBy } from "./context";
import {
  buildModelProposal,
  type ModelProposalResult,
  snapshotFacts,
} from "./observation";
import {
  actorAt,
  actorWithCapabilities,
  committedEvent,
  godProfile,
  greekState,
} from "./test-fixtures";

const id = toEntityId;

function snapshotAt(state: WorldState, actor = "zeus"): PerceptionSnapshot {
  const snapshot = perceive(state, id(actor));
  if (!snapshot) throw new Error(`${actor} perceives nothing`);
  return snapshot;
}

/** Zeus on the mountain path; the authored pack gives him `divine`, so olympus-gate is open to him. */
const zeusAtMountain = () => actorAt(greekState(), "zeus", "mountain-path");

/** Zeus at the tavern, where the-tavern stands. */
const tavernState = () => actorAt(greekState(), "zeus", "tavern");

/** What a model would answer, parsed the only way an intent can be: through the god's schema against the snapshot. */
function parsed(
  snapshot: PerceptionSnapshot,
  raw: Record<string, unknown>,
  god = "zeus",
): ParsedGodIntent {
  const result = godIntentSchema(godProfile(god), snapshot).parse(raw);
  if (!result.ok) throw new Error(`${result.path}: ${result.message}`);
  return result.value;
}

function build(
  snapshot: PerceptionSnapshot,
  raw: Record<string, unknown>,
  actor = "zeus",
) {
  const result = buildModelProposal(
    id(actor),
    snapshot,
    parsed(snapshot, raw, actor),
  );
  if (!result.ok || result.kind !== "proposal") {
    throw new Error(`expected a proposal, got ${JSON.stringify(result)}`);
  }
  return result;
}

const strikeTavern = { action: "strike", target: "the-tavern", power: 3 };

const revisionsOf = (proposal: {
  expectedRevisions: readonly { entityId: string; revision: number }[];
}) =>
  proposal.expectedRevisions.map((r) => `${r.entityId}@${r.revision}`).sort();

// --- What the service sets -------------------------------------------------------

test("a strike proposal is built by the service: actor, source, observation id, targets, and revisions", () => {
  const snapshot = snapshotAt(tavernState());
  const { observation, proposal } = build(snapshot, strikeTavern);

  expect(proposal).toMatchObject({
    schemaVersion: 1,
    kind: "strike",
    actor: "zeus",
    target: "the-tavern",
    power: 3,
    targets: ["the-tavern"],
    source: "model",
    observationId: observation.id,
  });
  expect(observation).toMatchObject({
    schemaVersion: 1,
    observer: "zeus",
    stateRevision: snapshot.stateRevision,
    source: "model",
  });
  expect(revisionsOf(proposal)).toEqual(["tavern@0", "the-tavern@0", "zeus@0"]);
  // The wire parser accepts what the builder produced.
  expect(submitProposal(proposal).ok).toBe(true);
});

test('the service stamps source "model" on both the proposal and its observation; the caller cannot choose it', () => {
  const snapshot = snapshotAt(tavernState());
  const { observation, proposal } = build(snapshot, strikeTavern);
  expect(proposal.source).toBe("model");
  expect(observation.source).toBe("model");
  expect(buildModelProposal.length).toBe(3);
});

test("a travel and a legend pin nothing; a trip across realms is the same travel, with no via to name", () => {
  const snapshot = snapshotAt(tavernState());
  const travel = build(snapshot, { action: "travel", to: "town-square" });
  expect(travel.proposal).toMatchObject({
    kind: "travel",
    to: "town-square",
    targets: [],
  });
  expect(revisionsOf(travel.proposal)).toEqual([]);

  const legend = build(snapshot, { action: "legend", assertion: "Hear me." });
  expect(legend.proposal).toMatchObject({
    kind: "legend",
    assertion: "Hear me.",
  });
  expect(revisionsOf(legend.proposal)).toEqual([]);

  const atMountain = snapshotAt(zeusAtMountain());
  const crossing = build(atMountain, { action: "travel", to: "olympus-gate" });
  expect(crossing.proposal).toMatchObject({
    kind: "travel",
    to: "olympus-gate",
  });
  expect(crossing.proposal).not.toHaveProperty("via");
  expect(revisionsOf(crossing.proposal)).toEqual([]);
});

test("factsRead is a subset of what the snapshot holds and names what the intent used", () => {
  const event = committedEvent({
    kind: "building-ignited",
    entityId: "the-tavern",
  });
  const state = tavernState();
  const snapshot = perceive(state, id("zeus"), [event]) as PerceptionSnapshot;
  const held = snapshotFacts(snapshot);

  const strike = build(snapshot, strikeTavern).observation;
  expect(strike.factsRead).toContain("building:the-tavern.status");
  expect(strike.factsRead).toContain("actor:zeus.inventory");
  const linked = build(snapshot, {
    action: "legend",
    assertion: "It burned.",
    linkedEventId: event.id,
  }).observation;
  expect(linked.factsRead).toContain(`event:${event.id}`);

  for (const observation of [strike, linked]) {
    expect(observation.factsRead.length).toBeGreaterThan(0);
    for (const fact of observation.factsRead) expect(held.has(fact)).toBe(true);
  }
  // Facts the intent did not use are not claimed.
  expect(strike.factsRead).not.toContain(`event:${event.id}`);
  // Nothing outside the snapshot is ever a fact read.
  expect(held.has("building:old-oak.status")).toBe(false);
});

test("each proposal gets a fresh observation id", () => {
  const snapshot = snapshotAt(tavernState());
  const first = build(snapshot, strikeTavern).observation.id;
  const second = build(snapshot, strikeTavern).observation.id;
  expect(first).not.toBe(second);
});

// --- Refusal before journaling ------------------------------------------------------

test("an intent parsed against another snapshot is refused when its target is not in this one", () => {
  // Parsed where the oak and the great hall are in reach, built against the tavern.
  const elsewhere = snapshotAt(actorAt(greekState(), "zeus", "town-square"));
  const tavern = snapshotAt(tavernState());
  const stale: Record<string, unknown>[] = [
    { action: "strike", target: "old-oak", power: 1 },
  ];
  for (const raw of stale) {
    const result = buildModelProposal(
      id("zeus"),
      tavern,
      parsed(elsewhere, raw),
    );
    expect(result.ok).toBe(false);
  }

  // A place the god could reach when it thought and cannot now: parsed with the capability, built without it.
  const plain = snapshotAt(actorWithCapabilities(tavernState(), "zeus", []));
  const unreachable = buildModelProposal(
    id("zeus"),
    plain,
    parsed(tavern, { action: "travel", to: "olympus-gate" }),
  );
  expect(unreachable.ok).toBe(false);

  const event = committedEvent({
    kind: "building-ignited",
    entityId: "the-tavern",
  });
  const withEvent = perceive(tavernState(), id("zeus"), [event]);
  if (!withEvent) throw new Error("no snapshot");
  const linked = buildModelProposal(
    id("zeus"),
    tavern,
    parsed(withEvent, {
      action: "legend",
      assertion: "x",
      linkedEventId: event.id,
    }),
  );
  expect(linked.ok).toBe(false);
});

test("a snapshot taken by another actor cannot back the proposal", () => {
  const snapshot = snapshotAt(tavernState());
  const result = buildModelProposal(
    id("hera"),
    snapshot,
    parsed(snapshot, strikeTavern),
  );
  expect(result.ok).toBe(false);
});

// --- wait -------------------------------------------------------------------------

test("a wait builds no proposal and no observation, so nothing can be journaled", () => {
  const snapshot = snapshotAt(tavernState());
  const result = buildModelProposal(
    id("zeus"),
    snapshot,
    parsed(snapshot, { action: "wait" }),
  );
  expect(result).toEqual({ ok: true, kind: "wait" });
  expect("proposal" in result).toBe(false);
  expect("observation" in result).toBe(false);
});

test("a wait from another actor's snapshot is still refused", () => {
  const snapshot = snapshotAt(tavernState());
  const result = buildModelProposal(
    id("hera"),
    snapshot,
    parsed(snapshot, { action: "wait" }),
  );
  expect(result.ok).toBe(false);
});

test("the result is a discriminated union: a wait cannot be read as a proposal", () => {
  const snapshot = snapshotAt(tavernState());
  const result: ModelProposalResult = buildModelProposal(
    id("zeus"),
    snapshot,
    parsed(snapshot, { action: "wait" }),
  );
  const readsProposalWithoutNarrowing = () => {
    if (result.ok) {
      // @ts-expect-error `ok` alone does not narrow: a wait carries no proposal
      return result.proposal;
    }
    return undefined;
  };
  expect(typeof readsProposalWithoutNarrowing).toBe("function");
  if (result.ok && result.kind === "proposal") {
    expect(result.proposal.kind).toBeDefined();
  }
});

// --- Branded intents ----------------------------------------------------------------

test("a hand-built intent cannot be passed to buildModelProposal", () => {
  const snapshot = snapshotAt(tavernState());
  const handBuilt = () =>
    buildModelProposal(
      id("zeus"),
      snapshot,
      // @ts-expect-error a hand-built intent skipped godIntentSchema's parse, and with it the power and availability checks
      { action: "strike", target: id("the-tavern"), power: 999 },
    );
  expect(typeof handBuilt).toBe("function");
});

// --- Against the real validator --------------------------------------------------

function runProposal(
  state: WorldState,
  proposal: Parameters<typeof runTick>[2][number],
) {
  return runTick(state, createPrng(1), [proposal]);
}

test("unchanged since the snapshot, the proposal commits; positive control for the stale cases", () => {
  const state = tavernState();
  const { proposal } = build(snapshotAt(state), strikeTavern);

  const tick = runProposal(state, proposal);
  expect(tick.rejected).toEqual([]);
  expect(tick.committed).toHaveLength(1);
  expect(tick.events.map((event) => event.kind)).toContain("building-ignited");
});

test("the target changed after the snapshot: the proposal is rejected stale-target", () => {
  const state = tavernState();
  const { proposal } = build(snapshotAt(state), strikeTavern);

  // Hera damages the tavern first, through the real tick.
  const heraStrike = build(
    snapshotAt(actorAt(state, "hera", "tavern"), "hera"),
    { action: "strike", target: "the-tavern", power: 1 },
    "hera",
  ).proposal;
  const afterHera = runProposal(actorAt(state, "hera", "tavern"), heraStrike);
  expect(afterHera.committed).toHaveLength(1);
  const damaged = getBuilding(afterHera.state, id("the-tavern"));
  expect(damaged?.revision).toBeGreaterThan(0);

  const late = runProposal(afterHera.state, proposal);
  expect(late.committed).toEqual([]);
  expect(late.rejected).toHaveLength(1);
  expect(late.rejected[0]?.reason).toBe("stale-target");
  expect(late.rejected[0]?.message).toContain("the-tavern");
});

test("the location's occupancy changed after the snapshot: a strike, which keeps its location pin, is rejected stale-target", () => {
  const state = tavernState();
  const { proposal } = build(snapshotAt(state), strikeTavern);

  // The farmer walks into the tavern, through the real tick.
  const farmerAtSquare = actorAt(state, "farmer", "town-square");
  const walk = submitProposal({
    schemaVersion: 1,
    kind: "move",
    actor: "farmer",
    to: "tavern",
    targets: [],
    expectedRevisions: [],
    source: "fixture",
    observationId: "obs-walk",
  });
  if (!walk.ok) throw new Error(walk.rejection.message);
  const moved = runProposal(farmerAtSquare, walk.proposal);
  expect(moved.committed).toHaveLength(1);
  expect(getLocation(moved.state, id("tavern"))?.revision).toBeGreaterThan(0);

  const late = runProposal(moved.state, proposal);
  expect(late.rejected[0]?.reason).toBe("stale-target");
});

test("Zeus's own goods changed after the snapshot: the proposal is rejected stale-target", () => {
  const state = tavernState();
  const { proposal } = build(snapshotAt(state), strikeTavern);
  const zeus = getActor(state, id("zeus"));
  if (!zeus) throw new Error("no zeus");
  const spent = {
    ...state,
    actors: new Map(state.actors).set(id("zeus"), {
      ...zeus,
      revision: zeus.revision + 1,
    }),
  };
  expect(runProposal(spent, proposal).rejected[0]?.reason).toBe("stale-target");
});

test("a building's revision bump alone makes the proposal stale", () => {
  const state = tavernState();
  const { proposal } = build(snapshotAt(state), strikeTavern);
  const tavern = getBuilding(state, id("the-tavern"));
  if (!tavern) throw new Error("no tavern building");
  const bumped = withBuilding(state, {
    ...tavern,
    revision: tavern.revision + 1,
  });
  expect(runProposal(bumped, proposal).rejected[0]?.reason).toBe(
    "stale-target",
  );
});

test("a mortal is still refused restricted-realm for the same transition; positive control for the deity's commit below", () => {
  const state = actorAt(greekState(), "farmer", "mountain-path");
  const attempt = submitProposal({
    schemaVersion: 1,
    kind: "realm-transition",
    actor: "farmer",
    to: "olympus-gate",
    via: "mountain-path",
    targets: [],
    expectedRevisions: [],
    source: "fixture",
    observationId: "obs-mortal",
  });
  if (!attempt.ok) throw new Error(attempt.rejection.message);
  const tick = runProposal(state, attempt.proposal);
  expect(tick.committed).toEqual([]);
  expect(tick.rejected[0]?.reason).toBe("restricted-realm");
});

test("a model-built travel across realms commits through the real tick from the authored pack alone: the journey starts, the world crosses, and the god arrives", () => {
  const state = zeusAtMountain();
  const { proposal } = build(snapshotAt(state), {
    action: "travel",
    to: "olympus-gate",
  });
  expect(proposal).toMatchObject({ kind: "travel", to: "olympus-gate" });

  const tick = runProposal(state, proposal);
  expect(tick.rejected).toEqual([]);
  expect(tick.committed).toHaveLength(1);
  expect(tick.committed[0]?.events.map((event) => event.kind)).toEqual([
    "journey-started",
  ]);
  expect(
    tick.environmentEvents
      .filter((event) => event.entityId === id("zeus"))
      .map((event) => event.kind),
  ).toEqual(["realm-transitioned", "journey-ended"]);
  expect(getActor(tick.state, id("zeus"))?.locationId).toBe(id("olympus-gate"));
});

// --- report -----------------------------------------------------------------------------

/** Zeus and the farmer at the tavern, where Zeus can tell the farmer something. */
const withFarmer = () => actorAt(tavernState(), "farmer", "tavern");

test("a report proposal names its listener as a target and does not pin the listener's revision; the claim and the words are the god's own", () => {
  const snapshot = snapshotAt(withFarmer());
  const { observation, proposal } = build(snapshot, {
    action: "report",
    listener: "farmer",
    content: "Lightning found your tavern.",
    claim: { effect: "harm", agent: "zeus", target: "the-tavern" },
  });
  expect(proposal).toMatchObject({
    kind: "report",
    actor: "zeus",
    listener: "farmer",
    content: "Lightning found your tavern.",
    claim: { effect: "harm", agent: "zeus", target: "the-tavern" },
    targets: ["farmer"],
    source: "model",
    observationId: observation.id,
  });
  // The listener's liveness and presence are judged again when the report is
  // validated; pinning its whole revision only refused a report because the
  // listener gathered or traded while the god thought.
  expect(proposal.expectedRevisions.map((r) => r.entityId)).not.toContain(
    id("farmer"),
  );
  // Every fact the observation cites is in the snapshot.
  const facts = snapshotFacts(snapshot);
  for (const fact of observation.factsRead) expect(facts.has(fact)).toBe(true);
  expect(observation.factsRead).toContain("actor:farmer.location");
  expect(submitProposal(proposal).ok).toBe(true);
});

test("a report against the real validator: it commits when the listener has not moved, and is refused as not-adjacent when the listener has", () => {
  const snapshot = snapshotAt(withFarmer());
  const { proposal } = build(snapshot, {
    action: "report",
    listener: "farmer",
    content: "A word.",
  });

  // Control: nothing changed since the snapshot, so it commits.
  const committed = runTick(withFarmer(), createPrng(1), [proposal]);
  expect(committed.rejected).toEqual([]);
  expect(committed.events.map((e) => e.kind)).toContain("report-told");

  // The farmer walks off before the proposal is admitted.
  const moved = actorAt(withFarmer(), "farmer", "town-square");
  const movedFarmer = getActor(moved, id("farmer"));
  if (!movedFarmer) throw new Error("no farmer");
  const stale = runTick(
    {
      ...moved,
      actors: new Map(moved.actors).set(id("farmer"), {
        ...movedFarmer,
        revision: movedFarmer.revision + 1,
      }),
    },
    createPrng(1),
    [proposal],
  );
  expect(stale.rejected.map((r) => r.reason)).toEqual(["not-adjacent"]);
});

test("a strike pins the god, its location, and the building, never the building's owner: the owner's inventory changing does not stale it", () => {
  const base = withFarmer();
  const { proposal } = build(snapshotAt(base), strikeTavern);
  expect(revisionsOf(proposal)).toEqual(["tavern@0", "the-tavern@0", "zeus@0"]);
  const farmer = getActor(base, id("farmer"));
  if (!farmer) throw new Error("no farmer");
  const traded = withActor(base, {
    ...farmer,
    inventory: new Map(farmer.inventory).set("food", 99),
    revision: farmer.revision + 1,
  });
  expect(runTick(traded, createPrng(1), [proposal]).rejected).toEqual([]);
});

test("a report still commits after the listener's inventory changed while the god thought, and is refused as dead-actor if the listener died", () => {
  const { proposal } = build(snapshotAt(withFarmer()), {
    action: "report",
    listener: "farmer",
    content: "A word.",
  });
  const state = withFarmer();
  const farmer = getActor(state, id("farmer"));
  if (!farmer) throw new Error("no farmer");
  const gathered = withActor(state, {
    ...farmer,
    inventory: new Map(farmer.inventory).set(
      "food",
      (farmer.inventory.get("food") ?? 0) + 1,
    ),
    revision: farmer.revision + 1,
  });
  const ran = runTick(gathered, createPrng(1), [proposal]);
  expect(ran.rejected).toEqual([]);
  expect(ran.events.map((e) => e.kind)).toContain("report-told");

  const dead = withActor(state, {
    ...farmer,
    alive: false,
    revision: farmer.revision + 1,
  });
  expect(
    runTick(dead, createPrng(1), [proposal]).rejected.map((r) => r.reason),
  ).toEqual(["dead-actor"]);
});

test("a report intent parsed against an older snapshot is refused when its listener is not in the one it is built from", () => {
  const older = snapshotAt(withFarmer());
  const intent = parsed(older, {
    action: "report",
    listener: "farmer",
    content: "A word.",
  });
  // Zeus is alone now.
  const newer = snapshotAt(tavernState());
  const result = buildModelProposal(id("zeus"), newer, intent);
  expect(result.ok).toBe(false);
  // Control: built from the snapshot it was parsed against, it builds.
  expect(buildModelProposal(id("zeus"), older, intent)).toMatchObject({
    ok: true,
    kind: "proposal",
  });
});

// --- A bystander coming or going is not a reason to refuse an action -----------------------
//
// Report, move, and legend pin only the god's own revision. The location's
// revision goes up whenever anyone arrives or leaves, and the validator already
// judges at commit time what that pin protected: the listener's presence for a
// report, adjacency and access for a move, the audience for a legend.

const arrives = (state: WorldState, actor: string, to: string) =>
  applyEvent(
    state,
    committedEvent({ kind: "entity-moved", entityId: id(actor), to: id(to) }),
  );

const rejectedReasons = (
  state: WorldState,
  proposal: Parameters<typeof runTick>[2][number],
) => runProposal(state, proposal).rejected.map((r) => r.reason);

const reportToFarmer = {
  action: "report",
  listener: "farmer",
  content: "A word.",
};

test("report, travel, and legend pin nothing; strike pins the god, its location, and the building", () => {
  const snapshot = snapshotAt(tavernState());
  for (const raw of [
    { action: "travel", to: "town-square" },
    { action: "travel", to: "great-hall" },
    { action: "legend", assertion: "Hear me." },
  ]) {
    expect(revisionsOf(build(snapshot, raw).proposal)).toEqual([]);
  }
  expect(
    revisionsOf(build(snapshotAt(withFarmer()), reportToFarmer).proposal),
  ).toEqual([]);
  expect(revisionsOf(build(snapshot, strikeTavern).proposal)).toEqual([
    "tavern@0",
    "the-tavern@0",
    "zeus@0",
  ]);
});

test("a report still commits when a bystander arrived at, or left, the god's location while the god thought", () => {
  const arrival = withFarmer();
  const { proposal } = build(snapshotAt(arrival), reportToFarmer);
  const arrived = runProposal(
    arrives(arrival, "woodcutter", "tavern"),
    proposal,
  );
  expect(arrived.rejected).toEqual([]);
  expect(arrived.events.map((e) => e.kind)).toContain("report-told");

  const crowded = actorAt(withFarmer(), "woodcutter", "tavern");
  const built = build(snapshotAt(crowded), reportToFarmer).proposal;
  const left = runProposal(
    arrives(crowded, "woodcutter", "town-square"),
    built,
  );
  expect(left.rejected).toEqual([]);
  expect(left.events.map((e) => e.kind)).toContain("report-told");
});

test("a travel still commits when someone arrived at, or left, the god's origin while the god thought", () => {
  const state = tavernState();
  const { proposal } = build(snapshotAt(state), {
    action: "travel",
    to: "town-square",
  });
  const arrived = runProposal(arrives(state, "woodcutter", "tavern"), proposal);
  expect(arrived.rejected).toEqual([]);
  expect(arrived.events.map((e) => e.kind)).toContain("entity-moved");

  const crowded = actorAt(state, "woodcutter", "tavern");
  const built = build(snapshotAt(crowded), {
    action: "travel",
    to: "town-square",
  }).proposal;
  const left = runProposal(
    arrives(crowded, "woodcutter", "town-square"),
    built,
  );
  expect(left.rejected).toEqual([]);
});

test("a legend still commits when a hearer arrived while the god thought, and the newcomer is in its audience", () => {
  const state = tavernState();
  const { proposal } = build(snapshotAt(state), {
    action: "legend",
    assertion: "Hear me.",
  });
  const ran = runProposal(arrives(state, "farmer", "tavern"), proposal);
  expect(ran.rejected).toEqual([]);
  const legend = ran.events.find((e) => e.kind === "legend-recorded");
  expect(legend).toMatchObject({ hearers: ["farmer"] });
});

// What the dropped pin protected is still judged at commit time, for the real reason.

test("a report is still refused when the listener left (not-adjacent) or died (dead-actor)", () => {
  const state = withFarmer();
  const { proposal } = build(snapshotAt(state), reportToFarmer);
  expect(
    rejectedReasons(arrives(state, "farmer", "town-square"), proposal),
  ).toEqual(["not-adjacent"]);
  const farmer = getActor(state, id("farmer"));
  if (!farmer) throw new Error("no farmer");
  const dead = withActor(state, {
    ...farmer,
    alive: false,
    revision: farmer.revision + 1,
  });
  expect(rejectedReasons(dead, proposal)).toEqual(["dead-actor"]);
});

test("a travel is still refused when no route reaches the destination any more (not-adjacent) or the god lost access to it (restricted-realm)", () => {
  const state = tavernState();
  const { proposal } = build(snapshotAt(state), {
    action: "travel",
    to: "town-square",
  });
  const square = state.locations.get(id("town-square"));
  if (!square) throw new Error("no square");
  const severed: WorldState = {
    ...state,
    locations: new Map(state.locations).set(id("town-square"), {
      ...square,
      edges: square.edges.filter((edge) => edge.to !== id("tavern")),
    }),
  };
  // The path was declared from the square; with it gone there is no edge either way.
  expect(rejectedReasons(severed, proposal)).toEqual(["not-adjacent"]);

  // Olympus Gate needs the divine capability; the god's own is what a commit checks.
  const hall = actorAt(greekState(), "zeus", "great-hall");
  const outward = build(snapshotAt(hall), {
    action: "travel",
    to: "olympus-gate",
  }).proposal;
  expect(runProposal(hall, outward).rejected).toEqual([]);
  expect(
    rejectedReasons(actorWithCapabilities(hall, "zeus", []), outward),
  ).toEqual(["restricted-realm"]);
});

test("a legend is still refused for its real reason: a claim naming something that no longer exists is malformed", () => {
  const state = tavernState();
  const { proposal } = build(snapshotAt(state), {
    action: "legend",
    assertion: "The tavern was struck.",
    claim: { effect: "harm", agent: "zeus", target: "the-tavern" },
  });
  expect(runProposal(state, proposal).rejected).toEqual([]);
  const buildings = new Map(state.buildings);
  buildings.delete(id("the-tavern"));
  expect(rejectedReasons({ ...state, buildings }, proposal)).toEqual([
    "malformed",
  ]);
});

// The god's own revision is not pinned either. A mortal's worship credits the
// god's divinity, which raises its revision without moving it, and a god that is
// worshipped while it thinks must not lose its turn. Everything the pin would
// have protected is judged again at commit: liveness before any rule
// (validate.ts, validateProposal), the god's current location and access for a
// move (handleMove), its co-location with the listener and what it cites for a
// report (handleReport), and the audience at its place for a legend (handleLegend).

const worshipped = (state: WorldState) =>
  applyEvent(
    state,
    committedEvent({
      kind: "worship-performed",
      entityId: id("farmer"),
      deity: id("zeus"),
      favorEffect: "gather-bonus",
      favorExpiresAtTick: 99,
    }),
  );

test("a report still commits when a mortal's worship raised the god's own revision while the god thought", () => {
  const state = withFarmer();
  const { proposal } = build(snapshotAt(state), reportToFarmer);
  expect(rejectedReasons(worshipped(state), proposal)).toEqual([]);
});

test("a travel still commits when a mortal's worship raised the god's own revision while the god thought", () => {
  const state = tavernState();
  const { proposal } = build(snapshotAt(state), {
    action: "travel",
    to: "town-square",
  });
  expect(rejectedReasons(worshipped(state), proposal)).toEqual([]);
});

test("a legend still commits when a mortal's worship raised the god's own revision while the god thought", () => {
  const state = tavernState();
  const { proposal } = build(snapshotAt(state), {
    action: "legend",
    assertion: "Hear me.",
  });
  expect(rejectedReasons(worshipped(state), proposal)).toEqual([]);
});

// What the god's own pin used to protect is still judged at commit, for the real reason.

test("a report is refused as not-adjacent when the god itself moved away from the listener while it thought", () => {
  const state = withFarmer();
  const { proposal } = build(snapshotAt(state), reportToFarmer);
  expect(
    rejectedReasons(arrives(state, "zeus", "town-square"), proposal),
  ).toEqual(["not-adjacent"]);
});

test("a travel is refused as malformed when the god is already at the place it set out for", () => {
  const state = tavernState();
  const { proposal } = build(snapshotAt(state), {
    action: "travel",
    to: "town-square",
  });
  // Zeus has already walked to the square: there is nowhere to travel.
  expect(
    rejectedReasons(arrives(state, "zeus", "town-square"), proposal),
  ).toEqual(["malformed"]);
  // Control: still at the origin, the same proposal commits.
  expect(runProposal(state, proposal).rejected).toEqual([]);
});

test("a travel is refused as restricted-realm when the god lost the capability the destination needs, even though losing it raised its revision", () => {
  const hall = actorAt(greekState(), "zeus", "great-hall");
  const { proposal } = build(snapshotAt(hall), {
    action: "travel",
    to: "olympus-gate",
  });
  const zeus = getActor(hall, id("zeus"));
  if (!zeus) throw new Error("no zeus");
  const stripped = withActor(hall, {
    ...zeus,
    capabilities: [],
    revision: zeus.revision + 1,
  });
  expect(rejectedReasons(stripped, proposal)).toEqual(["restricted-realm"]);
});

test("a legend told after the god itself moved commits and is heard by whoever is at the god's new place, not the old one", () => {
  const state = actorAt(tavernState(), "woodcutter", "town-square");
  const crowded = actorAt(state, "farmer", "tavern");
  const { proposal } = build(snapshotAt(crowded), {
    action: "legend",
    assertion: "Hear me.",
  });
  // Zeus walks to the square before the legend is validated: the farmer stays at the tavern.
  const ran = runProposal(arrives(crowded, "zeus", "town-square"), proposal);
  expect(ran.rejected).toEqual([]);
  const legend = ran.events.find((e) => e.kind === "legend-recorded");
  // The woodcutter is there, and so is anyone else who lives at the square; the farmer at the tavern is not.
  expect(legend).toMatchObject({
    hearers: expect.arrayContaining(["woodcutter"]),
  });
  expect(legend).not.toMatchObject({
    hearers: expect.arrayContaining(["farmer"]),
  });
});

// --- Practice moves ----------------------------------------------------------------

/** Hera was told of something Zeus did (a told memory of a real report), and may cite it. */
function heraHearsOfZeus(): { state: WorldState; cause: string } {
  const at = (state: WorldState, overrides: Record<string, unknown>) =>
    applyEvent(state, {
      schemaVersion: 1,
      tick: 0,
      simTime: 0,
      correlationId: "fixture",
      causationId: "fixture",
      approximate: false,
      sequence: state.lastSequence + 1,
      ...overrides,
    } as never);
  let state = at(greekState(), {
    id: "evt-0-1",
    kind: "report-told",
    entityId: "farmer",
    listenerId: "hera",
    content: "Zeus visited a nymph",
  });
  state = at(state, {
    id: "evt-0-2",
    kind: "memory-recorded",
    memoryKind: "told",
    entityId: "hera",
    sourceEventId: "evt-0-1",
    teller: "farmer",
    content: "Zeus visited a nymph",
    subjects: ["farmer", "hera"],
    salience: 4,
  });
  return { state, cause: "evt-0-1" };
}

const term = {
  kind: "be-at",
  party: "zeus",
  place: "altar",
  deadlineTicks: 80,
};

test("a demand rests on a cause the god was shown and pins nothing; its facts are ones the snapshot holds", () => {
  const { state, cause } = heraHearsOfZeus();
  const snapshot = snapshotAt(state, "hera");
  const remembered = rememberedBy(state, id("hera"));
  const intent = godIntentSchema(
    godProfile("hera"),
    snapshot,
    remembered,
  ).parse({
    action: "practice",
    move: "demand",
    cause,
    term,
  });
  if (!intent.ok) throw new Error(intent.message);
  const built = buildModelProposal(
    id("hera"),
    snapshot,
    intent.value,
    remembered,
  );
  if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
  expect(built.proposal.expectedRevisions).toEqual([]);
  expect(built.proposal).toMatchObject({
    kind: "practice",
    move: "demand",
    counterparty: "zeus",
    cause,
    term,
  });
  expect(built.observation.factsRead.some((f) => f.startsWith("memory:"))).toBe(
    true,
  );
  const facts = snapshotFacts(snapshot, remembered);
  for (const fact of built.observation.factsRead) {
    expect(facts.has(fact)).toBe(true);
  }
  // Control: the same demand where the god was shown no such cause is refused by the builder.
  const unshown = buildModelProposal(id("hera"), snapshot, intent.value, {
    ...remembered,
    practice: { ...remembered.practice, causes: [] },
  });
  expect(unshown.ok).toBe(false);
});

test("counter, accept, refuse, and withdraw each pin only their thread's revision; a thread the god was not shown is refused", () => {
  const { state: heard, cause } = heraHearsOfZeus();
  const opened = runTick(heard, createPrng(1), [
    (() => {
      const submitted = submitProposal({
        schemaVersion: 1,
        actor: "hera",
        targets: [],
        expectedRevisions: [],
        source: "fixture",
        observationId: "obs-d",
        kind: "practice",
        move: "demand",
        counterparty: "zeus",
        cause,
        term,
      });
      if (!submitted.ok) throw new Error(submitted.rejection.message);
      return submitted.proposal;
    })(),
  ]);
  expect(opened.rejected).toEqual([]);
  const [thread] = [...opened.state.threads.values()];
  if (!thread) throw new Error("no thread");
  const snapshot = snapshotAt(opened.state, "zeus");
  const remembered = rememberedBy(opened.state, id("zeus"));
  const schema = godIntentSchema(godProfile("zeus"), snapshot, remembered);
  for (const raw of [
    { move: "accept", swear: false },
    { move: "refuse" },
    { move: "withdraw" },
    { move: "counter", term: { ...term, deadlineTicks: 120 } },
  ]) {
    const intent = schema.parse({
      action: "practice",
      thread: thread.id,
      ...raw,
    });
    if (!intent.ok) throw new Error(intent.message);
    const built = buildModelProposal(
      id("zeus"),
      snapshot,
      intent.value,
      remembered,
    );
    if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
    expect(built.proposal.expectedRevisions).toEqual([
      { entityId: thread.id as unknown as string, revision: thread.revision },
    ] as never);
    expect(built.proposal).toMatchObject({
      kind: "practice",
      move: raw.move,
      thread: thread.id,
    });
    expect(built.observation.factsRead).toContain(`thread:${thread.id}`);
    expect(snapshotFacts(snapshot, remembered).has(`thread:${thread.id}`)).toBe(
      true,
    );
  }
  // A thread the god was not shown cannot be built into a proposal, whatever intent was parsed.
  const accept = schema.parse({
    action: "practice",
    move: "accept",
    thread: thread.id,
  });
  if (!accept.ok) throw new Error(accept.message);
  expect(
    buildModelProposal(id("zeus"), snapshot, accept.value, {
      ...remembered,
      threads: [],
    }).ok,
  ).toBe(false);
});
