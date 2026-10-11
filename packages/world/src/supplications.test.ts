// Supplication: a petition is a supplication thread with no terms, and a god
// may answer it by offering terms: its boon for one offering by the mortal by a
// deadline, with an optional stake on a breach. The world judges both halves.
//
// Everything a petition does with no terms is the existing petitions suite's
// to pin (`petitions.test.ts`); these tests cover what terms add, and that a
// petition nobody offers terms on is untouched by them.

import { expect, test } from "bun:test";
import type {
  ContentPack,
  EventId,
  PracticeTermOffer,
  WorldEvent,
} from "@panthea/contracts";
import {
  applyEvent,
  applyEvents,
  runTick,
  submitProposal,
  type TickOptions,
} from "./actions";
import { decode, encode } from "./codec";
import { getMemories } from "./memory";
import { decideRoutineProposal } from "./routines";
import {
  createInitialWorldState,
  createPrng,
  getActor,
  type PrngState,
  relationshipKey,
  toEntityId,
  type WorldState,
  withActor,
} from "./state";

const id = toEntityId;

const WOLF = {
  form: "wolf",
  capabilitiesGained: ["beast"],
  capabilitiesLost: [],
};

/**
 * A square with an altar, farmer and woodcutter (pious enough to take terms, so
 * neither gathers or trades unless a test says so), and two gods in a hall.
 * Practice tunables are small so a scenario stays short.
 */
function pack(
  balance: Record<string, number> = {},
  mortal: Partial<{ piety: number; gathers: string }> = {},
): ContentPack {
  const person = (name: string, wood: number, food: number) => ({
    id: name,
    sprite: `placeholder-${name}`,
    name,
    locationId: "square",
    drives: {
      thrift: 0,
      appetite: 0,
      greed: 0,
      piety: mortal.piety ?? 0.5,
    },
    startingInventory: [
      { resource: "food", amount: food },
      { resource: "wood", amount: wood },
    ],
  });
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
    buildings: [],
    inhabitants: [
      person("farmer", 3, 60),
      {
        ...person("woodcutter", 3, 60),
        ...(mortal.gathers === undefined ? {} : { gathers: mortal.gathers }),
      },
      ...(["zeus", "hera"] as const).map((god) => ({
        id: god,
        sprite: `placeholder-${god}`,
        name: god,
        locationId: "hall",
        deity: true,
        startingInventory: [{ resource: "divinity", amount: 10 }],
      })),
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
      petitionBalance: { directorIntervalTicks: 100000 },
      practiceBalance: {
        negotiationTicks: 60,
        counterBudget: 2,
        minTermTicks: 5,
        maxTermTicks: 200,
        acceptPietyPercent: 10,
        urgentTicks: 15,
        ...balance,
      },
      practiceStakes: { wolf: WOLF },
    },
    recipes: {},
  };
}

class World {
  state: WorldState;
  prng: PrngState = createPrng(1);
  readonly log: WorldEvent[] = [];
  readonly initial: WorldState;
  last: ReturnType<typeof runTick> | undefined;
  /** Catch-up and the like: what every tick is run with. */
  tickOptions: TickOptions = {};
  constructor(
    balance: Record<string, number> = {},
    mortal: Partial<{ piety: number; gathers: string }> = {},
  ) {
    this.state = createInitialWorldState(pack(balance, mortal));
    this.initial = this.state;
  }
  /** One tick: `extra` fixture proposals (a god's turn) and every mortal's routine proposal. */
  tick(...extra: Record<string, unknown>[]) {
    // A god blesses only a mortal it stands with: a fixture bless brings the god to the petitioner.
    for (const raw of extra) {
      if (raw.kind !== "bless") continue;
      const petition = this.state.petitions.get(raw.petition as EventId);
      const mortal = petition && getActor(this.state, petition.petitioner);
      if (mortal) this.place(String(raw.actor), String(mortal.locationId));
    }
    const proposals = [
      ...extra.map((raw, index) => {
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
      }),
      ...(["farmer", "woodcutter"] as const).flatMap((mortal) => {
        const decision = decideRoutineProposal(this.state, id(mortal));
        const actor = decision?.proposal.actor;
        const claimed = extra.some((raw) => raw.actor === actor);
        return decision && !claimed ? [decision.proposal] : [];
      }),
    ];
    const result = runTick(this.state, this.prng, proposals, this.tickOptions);
    this.state = result.state;
    this.prng = result.prng;
    this.log.push(...result.events);
    this.last = result;
    return result;
  }
  until(done: () => boolean, limit = 300): void {
    for (let n = 0; n < limit && !done(); n += 1) this.tick();
  }
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
  place(who: string, where: string) {
    const actor = getActor(this.state, id(who));
    if (!actor) throw new Error(who);
    this.state = withActor(this.state, { ...actor, locationId: id(where) });
  }
  setInventory(who: string, resource: string, amount: number) {
    const actor = getActor(this.state, id(who));
    if (!actor) throw new Error(who);
    this.state = withActor(this.state, {
      ...actor,
      inventory: new Map(actor.inventory).set(resource, amount),
    });
  }
  rejected(): string[] {
    return (this.last?.rejected ?? []).map((r) => r.reason);
  }
  petitions() {
    return [...this.state.petitions.values()];
  }
  threads() {
    return [...this.state.threads.values()];
  }
  thread() {
    const found = this.threads().at(-1);
    if (!found) throw new Error("no thread");
    return found;
  }
  ended() {
    return this.log.filter(
      (e): e is Extract<WorldEvent, { kind: "practice-ended" }> =>
        e.kind === "practice-ended",
    );
  }
  progressed() {
    return this.log.filter(
      (e): e is Extract<WorldEvent, { kind: "practice-progressed" }> =>
        e.kind === "practice-progressed",
    );
  }
}

const spoiled = (world: World, who = "farmer") =>
  world.apply({
    kind: "stock-spoiled",
    entityId: who,
    resource: "food",
    amount: 1,
    cause: "director",
  });

/** The farmer's food spoils and, by its own routine, it prays to Hera. */
function prayed(world = new World(), mortal = "farmer", god = "hera") {
  spoiled(world, mortal);
  const relationships = new Map(world.state.relationships);
  relationships.set(relationshipKey(id(mortal), id(god)), {
    from: id(mortal),
    toward: id(god),
    affinity: 5,
    grudge: 0,
    allied: false,
  });
  world.state = { ...world.state, relationships };
  world.until(() => world.petitions().length > 0);
  const [petition] = world.petitions();
  if (!petition) throw new Error("no prayer");
  expect(String(petition.god)).toBe(god);
  return { world, petition };
}

const offering = (
  party = "farmer",
  god = "hera",
  deadlineTicks = 60,
  amount = 1,
): Record<string, unknown> => ({
  kind: "make-offering",
  party,
  to: god,
  resource: "wood",
  amount,
  deadlineTicks,
});

const offer = (
  petition: EventId,
  term: Record<string, unknown> = offering(),
  extra: Record<string, unknown> = {},
  god = "hera",
) => ({
  actor: god,
  kind: "practice",
  move: "offer",
  petition,
  term,
  ...extra,
});

const bless = (petition: EventId, god = "hera") => ({
  actor: god,
  kind: "bless",
  petition,
});

/** The petition prayed, the god standing with the mortal, and the offer made and committed. */
function offered(
  options: {
    balance?: Record<string, number>;
    term?: Record<string, unknown>;
    stake?: string;
    mortal?: string;
    god?: string;
  } = {},
) {
  const mortal = options.mortal ?? "farmer";
  const god = options.god ?? "hera";
  const { world, petition } = prayed(new World(options.balance), mortal, god);
  world.place(god, String(getActor(world.state, id(mortal))?.locationId));
  const ran = world.tick(
    offer(
      petition.id,
      options.term ?? offering(mortal, god),
      options.stake === undefined ? {} : { stake: options.stake },
      god,
    ),
  );
  expect(ran.rejected).toEqual([]);
  return { world, petition, thread: world.thread(), mortal, god };
}

/** The mortal's routine accepts the terms. */
function accepted(options: Parameters<typeof offered>[0] = {}) {
  const set = offered(options);
  set.world.tick();
  expect(set.world.thread().status).toBe("accepted");
  return { ...set, thread: set.world.thread() };
}

// --- Characterization: no terms, no change ----------------------------------------------------

test("a petition nobody offers terms on opens, is blessed, and answers exactly as before: no thread exists at any point", () => {
  const { world, petition } = prayed();
  expect(world.threads()).toEqual([]);
  world.place("hera", String(getActor(world.state, id("farmer"))?.locationId));
  const ran = world.tick(bless(petition.id));
  expect(ran.rejected).toEqual([]);
  expect(world.state.petitions.get(petition.id)?.status).toBe("answered");
  expect(world.threads()).toEqual([]);
  expect(world.log.some((e) => e.kind.startsWith("practice-"))).toBe(false);
});

test("a petition nobody offers terms on lapses as before", () => {
  const { world, petition } = prayed();
  world.until(
    () => world.state.petitions.get(petition.id)?.status === "lapsed",
  );
  expect(world.state.petitions.get(petition.id)?.status).toBe("lapsed");
  expect(world.threads()).toEqual([]);
});

// --- Offering terms --------------------------------------------------------------------------

test("Hera offers the farmer her boon for an offering of wood: a supplication thread opens on its petition, with the farmer as the party to the offering, no counteroffers, and the petition still open", () => {
  const { world, petition, thread } = offered();
  expect(thread).toMatchObject({
    practice: "supplication",
    petition: petition.id,
    demander: "hera",
    obligated: "farmer",
    status: "open",
    offeredBy: "hera",
    counterBudgetLeft: 0,
    term: {
      kind: "make-offering",
      party: "farmer",
      to: "hera",
      resource: "wood",
      amount: 1,
    },
  });
  expect(thread.causes).toEqual([petition.cause]);
  expect(world.state.petitions.get(petition.id)?.status).toBe("open");
  const opening = world.log.find((e) => e.kind === "practice-opened");
  expect(opening).toMatchObject({
    practice: "supplication",
    petition: petition.id,
  });
  // The thread's id resolves through getEntityRevision like any other.
  expect(thread.revision).toBe(0);
});

test("an offer is refused unless it is the petition's own god, on an open petition inside its window, with the mortal as the offering's party and the god the one offered to", () => {
  const cases: [string, (p: EventId) => Record<string, unknown>, string][] = [
    [
      "another god",
      (p) => offer(p, offering("farmer", "zeus"), {}, "zeus"),
      "unauthorized-claim",
    ],
    ["an unknown petition", () => offer("evt-404" as EventId), "malformed"],
    [
      "a party that is not the petitioner",
      (p) => offer(p, offering("woodcutter")),
      "unauthorized-claim",
    ],
    [
      "the god herself as party",
      (p) => offer(p, offering("hera")),
      "unauthorized-claim",
    ],
    [
      "an offering to the other god",
      (p) => offer(p, offering("farmer", "zeus")),
      "unauthorized-claim",
    ],
    [
      "a term that is not an offering",
      (p) =>
        offer(p, {
          kind: "be-at",
          party: "farmer",
          place: "altar",
          deadlineTicks: 30,
        }),
      "unauthorized-claim",
    ],
    [
      "more wood than the farmer can have",
      (p) => offer(p, offering("farmer", "hera", 60, 99)),
      "insufficient-resources",
    ],
    [
      "a deadline below the minimum",
      (p) => offer(p, offering("farmer", "hera", 4)),
      "malformed",
    ],
    [
      "a deadline above the maximum",
      (p) => offer(p, offering("farmer", "hera", 201)),
      "malformed",
    ],
    [
      "a stake nobody authored",
      (p) => offer(p, offering(), { stake: "gorgon" }),
      "malformed",
    ],
  ];
  for (const [label, build, reason] of cases) {
    const { world, petition } = prayed();
    world.place("hera", "square");
    world.place("zeus", "square");
    world.tick(build(petition.id));
    expect([label, ...world.rejected()]).toEqual([label, reason]);
    expect(world.threads()).toEqual([]);
  }
  // Control: the god's own offer on the open petition is taken.
  const { world, petition } = prayed();
  world.tick(offer(petition.id, offering(), { stake: "wolf" }));
  expect(world.rejected()).toEqual([]);
  expect(world.threads()).toHaveLength(1);
});

test("an offer on a petition already answered, or lapsed, or whose petitioner is dead, is refused", () => {
  const answered = prayed();
  answered.world.place("hera", "square");
  answered.world.place("farmer", "square");
  answered.world.tick(bless(answered.petition.id));
  answered.world.tick(offer(answered.petition.id));
  expect(answered.world.rejected()).toEqual(["malformed"]);

  const lapsed = prayed();
  lapsed.world.until(
    () =>
      lapsed.world.state.petitions.get(lapsed.petition.id)?.status === "lapsed",
  );
  lapsed.world.tick(offer(lapsed.petition.id));
  expect(lapsed.world.rejected()).toEqual(["malformed"]);

  const dead = prayed();
  const farmer = getActor(dead.world.state, id("farmer"));
  if (!farmer) throw new Error("farmer");
  dead.world.state = withActor(dead.world.state, { ...farmer, alive: false });
  dead.world.tick(offer(dead.petition.id));
  expect(dead.world.rejected()).toEqual(["dead-actor"]);
});

test("one open supplication per petition: a second offer while the first stands makes no progress; the same terms again after a refusal are the same offer, and changed terms are a new one", () => {
  const { world, petition, thread } = offered();
  // The god's second offer is refused while the first stands; in the same tick the farmer declines (by a fixture), and the thread closes.
  world.tick(offer(petition.id, offering("farmer", "hera", 70)), {
    actor: "farmer",
    kind: "practice",
    move: "refuse",
    thread: thread.id,
    source: "routine",
  });
  expect(world.rejected()).toEqual(["no-progress"]);
  expect(world.threads()).toHaveLength(1);
  expect(world.thread().status).toBe("refused");
  // The same offer again: it was already answered.
  world.tick(offer(petition.id));
  expect(world.rejected()).toEqual(["no-progress"]);
  // Changed terms are a different offer, and the petition is still open to them.
  world.tick(offer(petition.id, offering("farmer", "hera", 90, 2)));
  expect(world.rejected()).toEqual([]);
  expect(world.threads()).toHaveLength(2);
});

test("a thread on a petition changes no other rule of the petition: a second cause about the same subject is still not prayed about while the petition is open", () => {
  const { world, petition } = offered();
  const again = spoiled(world);
  for (let n = 0; n < 60; n += 1) world.tick();
  expect(
    world.petitions().filter((p) => p.petitioner === id("farmer")),
  ).toHaveLength(1);
  expect(world.petitions().find((p) => p.cause === again.id)).toBeUndefined();
  expect(world.state.petitions.get(petition.id)).toBeDefined();
});

// --- The mortal's answer ---------------------------------------------------------------------

test("the mortal's routine accepts terms it is pious enough for and can afford, as an ordinary routine proposal", () => {
  const { world, thread } = offered();
  const decision = decideRoutineProposal(world.state, id("farmer"));
  expect(decision?.proposal).toMatchObject({
    kind: "practice",
    move: "accept",
    thread: thread.id,
    source: "routine",
  });
  expect(decision?.observation.source).toBe("routine");
  world.tick();
  expect(world.thread()).toMatchObject({
    status: "accepted",
    acceptance: { sworn: false },
  });
});

test("the mortal declines when it is not pious enough, and when it can no longer afford the offering", () => {
  const impious = prayed(new World({}, { piety: 0.05 }));
  impious.world.place("hera", "square");
  impious.world.tick(offer(impious.petition.id));
  expect(impious.world.rejected()).toEqual([]);
  impious.world.tick();
  expect(impious.world.thread().status).toBe("refused");

  const { world, thread } = offered();
  // The wood is spent between the offer and the answer.
  world.setInventory("farmer", "wood", 0);
  expect(
    decideRoutineProposal(world.state, id("farmer"))?.proposal,
  ).toMatchObject({
    kind: "practice",
    move: "refuse",
    thread: thread.id,
  });
  world.tick();
  expect(world.thread().status).toBe("refused");
  // A refusal ends it with no consequence: the petition stands, open to a plain bless.
  expect(world.state.petitions.get(thread.petition as EventId)?.status).toBe(
    "open",
  );
});

test("the tunable that sets how pious a mortal must be is the world's: a stricter threshold turns the same mortal away", () => {
  const strict = prayed(new World({ acceptPietyPercent: 80 }));
  strict.world.place("hera", "square");
  strict.world.tick(offer(strict.petition.id));
  strict.world.tick();
  expect(strict.world.thread().status).toBe("refused");
});

test("a mortal with nothing offered to it routines as it always did: no practice proposal appears in an ordinary world", () => {
  const world = new World();
  for (let n = 0; n < 20; n += 1) {
    for (const mortal of ["farmer", "woodcutter"]) {
      const decision = decideRoutineProposal(world.state, id(mortal));
      expect(decision?.proposal.kind).not.toBe("practice");
      expect(decision?.proposal.kind).not.toBe("worship");
    }
    world.tick();
  }
});

// --- Both halves: boon and offering, in either order ------------------------------------------

test("boon first, then the offering (AE9's order): the farmer takes the boon, its routine then offers wood, and the thread ends fulfilled, citing the offering that completed it", () => {
  const { world, petition, thread } = accepted();
  // Not yet urgent: the mortal waits for the boon, and offers nothing.
  for (let n = 0; n < 5; n += 1) world.tick();
  expect(world.log.some((e) => e.kind === "worship-performed")).toBe(false);
  expect(world.thread().status).toBe("accepted");

  const boon = world.tick(bless(petition.id));
  expect(boon.rejected).toEqual([]);
  const blessing = boon.events.find((e) => e.kind === "blessing-granted");
  expect(world.progressed()).toMatchObject([
    { step: "boon", threadId: thread.id, by: blessing?.id },
  ]);
  expect(world.thread()).toMatchObject({
    status: "accepted",
    progress: { boon: blessing?.id },
  });
  expect(world.ended()).toEqual([]);

  const next = world.tick();
  const worship = next.events.find(
    (e) => e.kind === "worship-performed" && e.entityId === id("farmer"),
  );
  expect(worship).toMatchObject({
    deity: "hera",
    offering: { resource: "wood", amount: 1 },
  });
  expect(world.thread().status).toBe("fulfilled");
  expect(world.ended()).toMatchObject([
    {
      outcome: "fulfilled",
      reason: "performed",
      performedBy: worship?.id,
      threadId: thread.id,
    },
  ]);
  expect(getActor(world.state, id("farmer"))?.inventory.get("wood")).toBe(2);
});

test("offering first, then the boon (AE8's order): when the deadline is near the farmer offers on faith, and the god's boon afterwards completes the thread", () => {
  const { world, petition, thread } = accepted({
    balance: { urgentTicks: 60 },
  });
  const next = world.tick();
  const worship = next.events.find((e) => e.kind === "worship-performed");
  expect(worship).toMatchObject({ entityId: "farmer", deity: "hera" });
  expect(world.progressed()).toMatchObject([
    { step: "offering", threadId: thread.id, by: worship?.id },
  ]);
  expect(world.thread()).toMatchObject({
    status: "accepted",
    progress: { offering: worship?.id },
  });
  expect(world.ended()).toEqual([]);

  const boon = world.tick(bless(petition.id));
  const blessing = boon.events.find((e) => e.kind === "blessing-granted");
  expect(world.thread().status).toBe("fulfilled");
  expect(world.ended()).toMatchObject([
    { outcome: "fulfilled", reason: "performed", performedBy: blessing?.id },
  ]);
});

test("both halves in one tick end the thread in that tick, and the ruling cites the later event", () => {
  const { world, petition } = accepted({ balance: { urgentTicks: 60 } });
  // The farmer's routine offers this very tick, with the god's bless in the same one.
  const ran = world.tick(bless(petition.id));
  expect(ran.rejected).toEqual([]);
  expect(world.thread().status).toBe("fulfilled");
  expect(world.progressed()).toEqual([]);
  expect(world.ended()).toHaveLength(1);
});

test("a boon is judged only after acceptance: a bless that comes while the terms are still open answers the petition, but cannot satisfy them, and the thread ends with nothing owed", () => {
  const { world, petition, thread } = offered();
  world.tick(bless(petition.id, "hera"));
  expect(world.state.petitions.get(petition.id)?.status).toBe("answered");
  world.tick();
  expect(world.state.threads.get(thread.id)?.status).toBe("expired");
  expect(world.ended()).toMatchObject([
    { outcome: "expired", reason: "boon-unanswered" },
  ]);
  // The farmer never offers wood for a boon the terms did not buy.
  for (let n = 0; n < 30; n += 1) world.tick();
  expect(
    world.log.some(
      (e) =>
        e.kind === "worship-performed" &&
        e.entityId === id("farmer") &&
        e.offering?.resource === "wood",
    ),
  ).toBe(false);
});

test("an offering made before acceptance does not count, and neither does one to another god, of less, or after the deadline", () => {
  const early = offered();
  const tooEarly = early.world.tick({
    actor: "farmer",
    kind: "worship",
    deity: "hera",
    offering: { resource: "wood", amount: 1 },
    source: "routine",
  });
  expect(tooEarly.rejected).toEqual([]);
  early.world.tick();
  expect(early.world.thread().status).toBe("accepted");
  expect(early.world.thread().progress).toBeUndefined();

  const cases: [string, Record<string, unknown>][] = [
    [
      "to another god",
      {
        actor: "farmer",
        kind: "worship",
        deity: "zeus",
        offering: { resource: "wood", amount: 1 },
      },
    ],
    [
      "of less",
      {
        actor: "farmer",
        kind: "worship",
        deity: "hera",
        offering: { resource: "wood", amount: 0.5 },
      },
    ],
    [
      "of another resource",
      {
        actor: "farmer",
        kind: "worship",
        deity: "hera",
        offering: { resource: "food", amount: 1 },
      },
    ],
    [
      "with nothing offered",
      { actor: "farmer", kind: "worship", deity: "hera" },
    ],
  ];
  for (const [label, worship] of cases) {
    const set = accepted({ balance: { urgentTicks: 1 } });
    set.world.tick({ ...worship, source: "routine" });
    expect([label, set.world.thread().progress]).toEqual([label, undefined]);
  }
  // After the deadline: breached first, never fulfilled by a late offering.
  const late = accepted({ balance: { urgentTicks: 1 } });
  late.world.tick(bless(late.petition.id));
  late.world.setInventory("farmer", "wood", 0);
  late.world.until(() => late.world.thread().status !== "accepted");
  expect(late.world.thread().status).toBe("breached");
});

// --- Breach and its price ---------------------------------------------------------------------

test("the boon is received and no offering comes by the deadline: the thread is breached, the stake applies, and the farmer keeps its memory, relationships, and identity (AE9)", () => {
  const { world, petition, thread } = accepted({
    stake: "wolf",
    mortal: "woodcutter",
    god: "zeus",
  });
  world.tick(bless(petition.id, "zeus"));
  expect(world.thread().progress?.boon).toBeDefined();
  // The wood is gone before it is time to give it.
  world.setInventory("woodcutter", "wood", 0);
  const before = getActor(world.state, id("woodcutter"));
  const memories = getMemories(world.state, id("woodcutter")).length;
  expect(memories).toBeGreaterThan(0);
  world.until(() => world.thread().status !== "accepted");
  const [ended] = world.ended();
  expect(ended).toMatchObject({
    outcome: "breached",
    reason: "obligation-deadline",
    threadId: thread.id,
    tick: thread.term.deadline + 1,
  });
  const change = world.log.find(
    (e) => e.kind === "motif-applied" && e.effect === "transformation",
  );
  expect(change).toMatchObject({
    entityId: "woodcutter",
    motif: "transformation-punishment",
    intent: "punishment",
    form: "wolf",
    capabilitiesGained: ["beast"],
    threadId: thread.id,
    cause: ended?.id,
  });
  const after = getActor(world.state, id("woodcutter"));
  expect(after).toMatchObject({ id: "woodcutter", form: "wolf", alive: true });
  expect(after?.capabilities).toEqual(["beast"]);
  expect(after?.home).toEqual(before?.home);
  // Identity, memory, and what it holds stay.
  expect(
    getMemories(world.state, id("woodcutter")).length,
  ).toBeGreaterThanOrEqual(memories);
});

test("a breach with no stake changes no form: the offer carried none, so the world adds none", () => {
  const { world, petition } = accepted();
  world.tick(bless(petition.id));
  world.setInventory("farmer", "wood", 0);
  world.until(() => world.thread().status !== "accepted");
  expect(world.thread().status).toBe("breached");
  expect(
    world.log.some(
      (e) => e.kind === "motif-applied" && e.effect === "transformation",
    ),
  ).toBe(false);
  expect(getActor(world.state, id("farmer"))?.form).toBeUndefined();
});

test("the boon never comes: the deadline passes and the thread ends expired with nothing owed, and the stake is not applied to a mortal who was never helped", () => {
  const { world, thread } = accepted({ stake: "wolf" });
  world.until(() => world.thread().status !== "accepted");
  expect(world.ended()).toMatchObject([
    {
      outcome: "expired",
      reason: "boon-unanswered",
      tick: thread.term.deadline + 1,
    },
  ]);
  expect(world.log.some((e) => e.kind === "motif-applied")).toBe(false);
  expect(getActor(world.state, id("farmer"))?.form).toBeUndefined();
});

test("the petition lapses with the boon unseen: the thread ends expired when the petition does, and no stake applies", () => {
  const { world, petition } = accepted({
    balance: { negotiationTicks: 400, maxTermTicks: 400 },
    term: offering("farmer", "hera", 300),
    stake: "wolf",
  });
  world.until(
    () => world.state.petitions.get(petition.id)?.status === "lapsed",
  );
  world.tick();
  expect(world.thread().status).toBe("expired");
  expect(world.ended()[0]).toMatchObject({
    outcome: "expired",
    reason: "boon-unanswered",
  });
  expect(world.log.some((e) => e.kind === "motif-applied")).toBe(false);
});

test("a thread nobody answers expires on its negotiation deadline as any other, and leaves the petition open", () => {
  const { world, petition } = prayed();
  world.place("hera", "square");
  world.tick(offer(petition.id));
  // The farmer is dead to it (a mortal that cannot decide): staged by removing its routine's candidate.
  const farmer = getActor(world.state, id("farmer"));
  if (!farmer) throw new Error("farmer");
  world.state = withActor(world.state, { ...farmer, drives: undefined });
  world.until(() => world.thread().status !== "open");
  expect(world.ended()).toMatchObject([
    { outcome: "expired", reason: "negotiation-deadline" },
  ]);
  expect(world.state.petitions.get(petition.id)?.status).toBe("open");
});

test("a party who dies while the terms stand ends the thread withdrawn: no breach, no stake", () => {
  const { world, thread } = accepted({ stake: "wolf" });
  const farmer = getActor(world.state, id("farmer"));
  if (!farmer) throw new Error("farmer");
  world.state = withActor(world.state, { ...farmer, alive: false });
  world.tick();
  expect(world.state.threads.get(thread.id)?.status).toBe("withdrawn");
  expect(world.ended()[0]).toMatchObject({
    outcome: "withdrawn",
    reason: "party-died",
  });
  expect(world.log.some((e) => e.kind === "motif-applied")).toBe(false);
});

test("the god may withdraw its terms before they are taken, and the petition goes on as it was", () => {
  const { world, petition, thread } = offered();
  world.tick({
    actor: "hera",
    kind: "practice",
    move: "withdraw",
    thread: thread.id,
  });
  expect(world.thread().status).toBe("withdrawn");
  expect(world.state.petitions.get(petition.id)?.status).toBe("open");
  world.place("hera", "square");
  world.place("farmer", "square");
  world.tick(bless(petition.id));
  expect(world.state.petitions.get(petition.id)?.status).toBe("answered");
});

test("a counteroffer on a supplication has no budget: the mortal answers with accept or refuse, never a counter", () => {
  const { world, thread } = offered();
  world.tick({
    actor: "farmer",
    kind: "practice",
    move: "counter",
    thread: thread.id,
    term: offering("farmer", "hera", 70),
    source: "routine",
  });
  expect(world.rejected()).toEqual(["malformed"]);
  expect(world.thread().status).toBe("open");
});

test("talk between the god and the mortal around a supplication is free even when its thread names a subject: the anti-loop rule is for settlements", () => {
  const { world, petition } = offered();
  const thread = world.thread();
  // Give the thread a subject (a settlement's marker) by hand: a claim naming it would be refused on a settlement.
  world.state = {
    ...world.state,
    threads: new Map(world.state.threads).set(thread.id, {
      ...thread,
      subject: { agent: id("hera"), target: id("farmer") },
    }),
  };
  world.place("hera", String(getActor(world.state, id("farmer"))?.locationId));
  world.tick({
    actor: "hera",
    kind: "report",
    listener: "farmer",
    content: "I heard you.",
    claim: { effect: "kindness", agent: "hera", target: "farmer" },
  });
  expect(petition.cause).toBeDefined();
  // Control: the same talk around a settlement with that subject is refused (see practices.test.ts); here it is told.
  expect(
    world.log.some(
      (e) => e.kind === "report-told" && e.entityId === id("hera"),
    ),
  ).toBe(true);
  expect(world.rejected()).toEqual([]);
});

// --- A boon only counts by the deadline ----------------------------------------------------------------------

/** An accepted supplication on a 5-tick term with the wolf as stake, the farmer unable to offer unless `canOffer`. */
function staked(canOffer: boolean) {
  const set = accepted({
    stake: "wolf",
    term: offering("farmer", "hera", 5),
  });
  if (!canOffer) set.world.setInventory("farmer", "wood", 0);
  return set;
}

/** Runs the clock to the tick the term is due, with no boon given. */
function toDeadline(set: ReturnType<typeof staked>) {
  set.world.until(() => set.world.state.tick >= set.thread.term.deadline);
  expect(set.world.state.tick).toBe(set.thread.term.deadline);
  expect(set.world.thread().status).toBe("accepted");
}

test("a boon one tick past the deadline, with no offering made, expires the thread with nothing owed: no breach, no transformation, no motif; and the late bless still answers the petition", () => {
  const set = staked(false);
  toDeadline(set);
  const { world, petition } = set;
  const late = world.tick(bless(petition.id));
  expect(late.rejected).toEqual([]);
  expect(world.state.tick).toBe(set.thread.term.deadline + 1);
  // The petition is answered all the same: the bless is the god's to give.
  expect(world.state.petitions.get(petition.id)?.status).toBe("answered");
  expect(late.events.some((e) => e.kind === "blessing-granted")).toBe(true);
  // The bargain is not: the boon came too late to be what the offering was for.
  expect(world.thread().status).toBe("expired");
  expect(world.ended().at(-1)).toMatchObject({
    outcome: "expired",
    reason: "boon-unanswered",
    tick: set.thread.term.deadline + 1,
  });
  expect(world.thread().progress).toBeUndefined();
  expect(world.log.some((e) => e.kind === "practice-progressed")).toBe(false);
  expect(world.log.some((e) => e.kind === "motif-applied")).toBe(false);
  expect(getActor(world.state, id("farmer"))?.form).toBeUndefined();
});

test("a boon one tick past the deadline after an earlier offering expires the thread too: it is not fulfilled", () => {
  const set = staked(true);
  // The farmer's routine offers on faith, ahead of the deadline.
  set.world.tick();
  expect(set.world.thread().progress?.offering).toBeDefined();
  toDeadline(set);
  set.world.tick(bless(set.petition.id));
  expect(set.world.state.petitions.get(set.petition.id)?.status).toBe(
    "answered",
  );
  expect(set.world.thread().status).toBe("expired");
  expect(set.world.ended().at(-1)).toMatchObject({
    outcome: "expired",
    reason: "boon-unanswered",
  });
  expect(set.world.ended().some((e) => e.outcome === "fulfilled")).toBe(false);
  expect(set.world.log.some((e) => e.kind === "motif-applied")).toBe(false);
});

test("a boon exactly on the deadline counts: fulfilled when the offering was made, breached and staked when it was not", () => {
  const made = staked(true);
  made.world.tick();
  made.world.until(
    () => made.world.state.tick >= made.thread.term.deadline - 1,
  );
  expect(made.world.state.tick).toBe(made.thread.term.deadline - 1);
  made.world.tick(bless(made.petition.id));
  expect(made.world.state.tick).toBe(made.thread.term.deadline);
  expect(made.world.thread().status).toBe("fulfilled");

  const missed = staked(false);
  missed.world.until(
    () => missed.world.state.tick >= missed.thread.term.deadline - 1,
  );
  missed.world.tick(bless(missed.petition.id));
  expect(missed.world.state.tick).toBe(missed.thread.term.deadline);
  expect(missed.world.thread().progress?.boon).toBeDefined();
  expect(missed.world.thread().status).toBe("accepted");
  missed.world.tick();
  expect(missed.world.thread().status).toBe("breached");
  expect(
    missed.world.log.find(
      (e) => e.kind === "motif-applied" && e.effect === "transformation",
    ),
  ).toMatchObject({ entityId: "farmer", form: "wolf" });
});

test("the late boon is judged the same in catch-up: the same ruling on the same tick, marked approximate", () => {
  const rulings = (approximate: boolean) => {
    const world = new World();
    if (approximate)
      world.tickOptions = { approximate: true, elapsedMs: 60_000 };
    const { petition } = prayed(world);
    world.place(
      "hera",
      String(getActor(world.state, id("farmer"))?.locationId),
    );
    world.tick(
      offer(petition.id, offering("farmer", "hera", 5), { stake: "wolf" }),
    );
    world.tick();
    const thread = world.thread();
    world.setInventory("farmer", "wood", 0);
    world.until(() => world.state.tick >= thread.term.deadline);
    world.tick(bless(petition.id));
    return world
      .ended()
      .map((e) => [e.outcome, e.reason, e.tick, e.approximate]);
  };
  const live = rulings(false);
  const catchUp = rulings(true);
  expect(live.map((r) => r.slice(0, 3))).toEqual([
    ["expired", "boon-unanswered", expect.any(Number)],
  ]);
  expect(catchUp.map((r) => r.slice(0, 3))).toEqual(
    live.map((r) => r.slice(0, 3)),
  );
  expect(live[0]?.[3]).toBe(false);
  expect(catchUp[0]?.[3]).toBe(true);
});

// --- What a mortal could have by the deadline ----------------------------------------------------------------

test("a gatherer is held only to what it could gather by the deadline: an offering beyond held plus gatherAmount per remaining tick is refused at the offer, and no stake can ever fall on it", () => {
  // The woodcutter holds 3 wood and gathers wood, one a tick (gatherAmount defaults to 1).
  const { world, petition } = prayed(
    new World({}, { gathers: "wood" }),
    "woodcutter",
    "zeus",
  );
  world.place(
    "zeus",
    String(getActor(world.state, id("woodcutter"))?.locationId),
  );
  const attempt = (amount: number, ticks: number) => {
    world.tick(
      offer(
        petition.id,
        offering("woodcutter", "zeus", ticks, amount),
        { stake: "wolf" },
        "zeus",
      ),
    );
    return world.rejected();
  };
  // The exploit: a million units due in 25 ticks.
  expect(attempt(1_000_000, 25)).toEqual(["insufficient-resources"]);
  expect(world.threads()).toEqual([]);
  // 3 held + 20 ticks of gathering is 23: 24 is out of reach, 23 is not.
  expect(attempt(24, 20)).toEqual(["insufficient-resources"]);
  expect(attempt(23, 20)).toEqual([]);
  expect(world.threads()).toHaveLength(1);
  // Nothing was breached, so nothing was transformed.
  expect(world.log.some((e) => e.kind === "motif-applied")).toBe(false);
});

test("a gatherer holding nothing can still be asked for what it can gather in time, and a longer deadline reaches more", () => {
  const { world, petition } = prayed(
    new World({}, { gathers: "wood" }),
    "woodcutter",
    "zeus",
  );
  world.place(
    "zeus",
    String(getActor(world.state, id("woodcutter"))?.locationId),
  );
  world.setInventory("woodcutter", "wood", 0);
  world.tick(
    offer(petition.id, offering("woodcutter", "zeus", 20, 21), {}, "zeus"),
  );
  expect(world.rejected()).toEqual(["insufficient-resources"]);
  world.tick(
    offer(petition.id, offering("woodcutter", "zeus", 20, 20), {}, "zeus"),
  );
  expect(world.rejected()).toEqual([]);
  // The same amount with more time is reachable.
  const slow = prayed(new World({}, { gathers: "wood" }), "woodcutter", "zeus");
  slow.world.place(
    "zeus",
    String(getActor(slow.world.state, id("woodcutter"))?.locationId),
  );
  slow.world.setInventory("woodcutter", "wood", 0);
  slow.world.tick(
    offer(slow.petition.id, offering("woodcutter", "zeus", 60, 50), {}, "zeus"),
  );
  expect(slow.world.rejected()).toEqual([]);
});

test("gatherAmount is the world's: a larger gather reaches more in the same time, and a missing setting is one a tick", () => {
  const big = prayed(new World({}, { gathers: "wood" }), "woodcutter", "zeus");
  big.world.state = {
    ...big.world.state,
    rules: {
      ...big.world.state.rules,
      economyBalance: {
        ...big.world.state.rules.economyBalance,
        gatherAmount: 5,
      },
    },
  };
  big.world.place(
    "zeus",
    String(getActor(big.world.state, id("woodcutter"))?.locationId),
  );
  big.world.setInventory("woodcutter", "wood", 0);
  big.world.tick(
    offer(big.petition.id, offering("woodcutter", "zeus", 20, 100), {}, "zeus"),
  );
  expect(big.world.rejected()).toEqual([]);
  const small = prayed(
    new World({}, { gathers: "wood" }),
    "woodcutter",
    "zeus",
  );
  small.world.place(
    "zeus",
    String(getActor(small.world.state, id("woodcutter"))?.locationId),
  );
  small.world.setInventory("woodcutter", "wood", 0);
  small.world.tick(
    offer(
      small.petition.id,
      offering("woodcutter", "zeus", 20, 100),
      {},
      "zeus",
    ),
  );
  expect(small.world.rejected()).toEqual(["insufficient-resources"]);
});

test("a mortal that does not gather is held to what it holds: the held amount opens, one more does not, and gathering a different resource does not help", () => {
  const plain = prayed();
  plain.world.place(
    "hera",
    String(getActor(plain.world.state, id("farmer"))?.locationId),
  );
  plain.world.tick(offer(plain.petition.id, offering("farmer", "hera", 60, 4)));
  expect(plain.world.rejected()).toEqual(["insufficient-resources"]);
  plain.world.tick(offer(plain.petition.id, offering("farmer", "hera", 60, 3)));
  expect(plain.world.rejected()).toEqual([]);
  // The woodcutter gathers food, not wood: its wood is what it holds.
  const other = prayed(
    new World({}, { gathers: "food" }),
    "woodcutter",
    "zeus",
  );
  other.world.place(
    "zeus",
    String(getActor(other.world.state, id("woodcutter"))?.locationId),
  );
  other.world.tick(
    offer(other.petition.id, offering("woodcutter", "zeus", 60, 4), {}, "zeus"),
  );
  expect(other.world.rejected()).toEqual(["insufficient-resources"]);
});

test("accepting is judged on the time left, not the time offered: once the deadline is too near for what the mortal could gather, it cannot accept", () => {
  const { world, thread } = offeredBy(new World({}, { gathers: "wood" }), 20);
  // Time passes with nothing gathered: too little is left for 20 more wood.
  world.state = { ...world.state, tick: thread.term.deadline - 5 };
  world.setInventory("woodcutter", "wood", 0);
  world.tick({
    actor: "woodcutter",
    kind: "practice",
    move: "accept",
    thread: thread.id,
    source: "routine",
  });
  expect(world.rejected()).toEqual(["insufficient-resources"]);
  expect(world.thread().status).toBe("open");
  // The mortal's own routine declines it rather than promise it.
  expect(
    decideRoutineProposal(world.state, id("woodcutter"))?.proposal,
  ).toMatchObject({
    kind: "practice",
    move: "refuse",
  });
});

test("an accepted obligation the mortal can no longer meet is seen as unperformable, so the god's digest can say so", async () => {
  const { canStillPerform } = await import("./practices");
  const { world } = offeredBy(new World({}, { gathers: "wood" }), 15);
  world.tick();
  expect(world.thread().status).toBe("accepted");
  expect(canStillPerform(world.state, world.thread())).toBe(true);
  // Nothing held and no longer gathering: it cannot meet it.
  const mortal = getActor(world.state, id("woodcutter"));
  if (!mortal) throw new Error("woodcutter");
  world.state = withActor(world.state, {
    ...mortal,
    gathers: undefined,
    inventory: new Map(mortal.inventory).set("wood", 0),
  });
  expect(canStillPerform(world.state, world.thread())).toBe(false);
});

/** Zeus offers the woodcutter 20-ish wood in 20 ticks, terms standing (not yet answered). */
function offeredBy(world: World, amount: number) {
  const { petition } = prayedTo(world);
  world.place(
    "zeus",
    String(getActor(world.state, id("woodcutter"))?.locationId),
  );
  world.setInventory("woodcutter", "wood", 0);
  const ran = world.tick(
    offer(petition.id, offering("woodcutter", "zeus", 20, amount), {}, "zeus"),
  );
  expect(ran.rejected).toEqual([]);
  return { world, petition, thread: world.thread() };
}

function prayedTo(world: World) {
  return prayed(world, "woodcutter", "zeus");
}

// --- Replay, codec ---------------------------------------------------------------------------

test("a supplication, its progress, its stake, and its ending replay from the log and survive a JSON round trip", () => {
  const { world, petition } = accepted({ stake: "wolf" });
  world.tick(bless(petition.id));
  const rebuilt = applyEvents(world.initial, world.log);
  expect(rebuilt.threads).toEqual(world.state.threads);
  const decoded = decode(JSON.parse(JSON.stringify(encode(world.state))));
  expect(decoded.threads).toEqual(world.state.threads);
  expect(encode(decoded)).toEqual(encode(world.state));
  const thread = world.thread();
  expect(thread.petition).toBe(petition.id);
  expect(thread.progress?.boon).toBeDefined();
  expect(thread.stake?.form).toBe("wolf");

  const stored = JSON.parse(JSON.stringify(encode(world.state)));
  const corrupt = (change: (t: Record<string, unknown>) => void) => {
    const copy = JSON.parse(JSON.stringify(stored));
    change(copy.threads[0][1]);
    return copy;
  };
  expect(() =>
    decode(
      corrupt((t) => {
        t.petition = undefined;
      }),
    ),
  ).toThrow();
  expect(() =>
    decode(
      corrupt((t) => {
        t.progress = { boon: 4 };
      }),
    ),
  ).toThrow();
  expect(() =>
    decode(
      corrupt((t) => {
        t.practice = "settlement";
      }),
    ),
  ).toThrow();
});

test("the stakes are the world's rules: an offer's stake is stored on the thread as authored, and decode refuses a world with a malformed one", () => {
  const state = createInitialWorldState(pack());
  const stored = JSON.parse(JSON.stringify(encode(state)));
  expect(decode(stored).rules.practiceStakes).toEqual({ wolf: WOLF } as never);
  stored.rules.practiceStakes = { wolf: { form: "" } };
  expect(() => decode(stored)).toThrow();
});

// --- Admission: the offering comes first when the deadline is near ----------------------------

test("with the deadline near, the mortal's offering outranks every other routine choice, trading included; with time to spare it waits for the boon", () => {
  const { world, petition } = accepted();
  world.tick(bless(petition.id));
  // Give the farmer something it would rather do: a standing want for wood it cannot gather.
  const farmer = getActor(world.state, id("farmer"));
  if (!farmer) throw new Error("farmer");
  world.state = withActor(world.state, {
    ...farmer,
    drives: { thrift: 0, appetite: 0, greed: 1, piety: 0.5 },
    gathers: "food",
  });
  const decision = decideRoutineProposal(world.state, id("farmer"));
  // Boon seen, deadline not near: offering is next, ahead of gathering.
  expect(decision?.proposal).toMatchObject({ kind: "worship", deity: "hera" });
  expect(decision?.urgent).toBeFalsy();
});

test("the offering is flagged urgent exactly when the deadline is within the urgency window, so the queue can put it first", () => {
  const { world, thread } = accepted({ balance: { urgentTicks: 10 } });
  world.state = {
    ...world.state,
    tick: thread.term.deadline - 11,
  };
  const waiting = decideRoutineProposal(world.state, id("farmer"));
  expect(waiting?.proposal.kind).not.toBe("worship");
  expect(waiting?.urgent).toBeFalsy();
  world.state = { ...world.state, tick: thread.term.deadline - 10 };
  const urgent = decideRoutineProposal(world.state, id("farmer"));
  expect(urgent?.proposal).toMatchObject({ kind: "worship", deity: "hera" });
  expect(urgent?.urgent).toBe(true);
  // On the deadline tick itself it is still worth doing.
  world.state = { ...world.state, tick: thread.term.deadline };
  expect(decideRoutineProposal(world.state, id("farmer"))?.urgent).toBe(true);
  // A tick later it is too late: nothing urgent remains.
  world.state = { ...world.state, tick: thread.term.deadline + 1 };
  expect(decideRoutineProposal(world.state, id("farmer"))?.urgent).toBeFalsy();
});

test("a mortal that cannot afford the offering does not try: no worship is proposed, and the breach stands", () => {
  const { world } = accepted({ balance: { urgentTicks: 60 } });
  // Urgent, and the wood is gone: nothing to offer, so nothing is proposed.
  world.setInventory("farmer", "wood", 0);
  const decision = decideRoutineProposal(world.state, id("farmer"));
  expect(decision?.proposal.kind).not.toBe("worship");
  expect(decision?.urgent).toBeFalsy();
  // Control: with the wood back, the same state proposes the offering, urgently.
  world.setInventory("farmer", "wood", 3);
  expect(decideRoutineProposal(world.state, id("farmer"))).toMatchObject({
    proposal: { kind: "worship", deity: "hera" },
    urgent: true,
  });
});

// --- Sanity: the offer type is the flat practice proposal -------------------------------------

test("the offer is one flat practice proposal", () => {
  const submitted = submitProposal({
    schemaVersion: 1,
    actor: "hera",
    targets: [],
    expectedRevisions: [],
    source: "model",
    observationId: "obs-x",
    kind: "practice",
    move: "offer",
    petition: "evt-1",
    term: offering() as unknown as PracticeTermOffer,
    stake: "wolf",
  });
  expect(submitted.ok).toBe(true);
});
