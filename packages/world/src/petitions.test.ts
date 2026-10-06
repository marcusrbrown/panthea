import { expect, test } from "bun:test";
import type { ContentPack, EventId, WorldEvent } from "@panthea/contracts";
import { applyEvent, applyEvents, runTick, submitProposal } from "./actions";
import { decode, encode } from "./codec";
import { perceive } from "./perception";
import {
  DEFAULT_PETITION_BALANCE,
  openPetitionsFor,
  patronOf,
  petitionBalanceOf,
  petitionFor,
  planNoticeStep,
  prayableCauses,
  routePetition,
} from "./petitions";
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

/** A square with an altar and a tavern, a farmer who owns the tavern, a woodcutter who owns a woodshed, a drifter who owns nothing, and two gods in a hall nobody else can enter. */
function pack(): ContentPack {
  return {
    schemaVersion: 1,
    realms: ["mortal", "olympus"],
    resources: [],
    locations: [
      {
        id: "square",
        realm: "mortal",
        name: "Square",
        edges: [
          { to: "altar", transport: "path", bidirectional: true },
          { to: "tavern", transport: "path", bidirectional: true },
        ],
      },
      { id: "altar", realm: "mortal", name: "Altar", edges: [] },
      { id: "tavern", realm: "mortal", name: "Tavern", edges: [] },
      { id: "hall", realm: "olympus", name: "Hall", edges: [] },
    ],
    buildings: [
      {
        id: "the-tavern",
        locationId: "tavern",
        name: "The Tavern",
        material: "wood",
        combustible: true,
        services: ["drink"],
        inventory: [],
        owner: "farmer",
      },
      {
        id: "woodshed",
        locationId: "square",
        name: "The Woodshed",
        material: "wood",
        combustible: true,
        services: [],
        inventory: [],
        owner: "woodcutter",
      },
    ],
    inhabitants: [
      calm("farmer", "square", [{ resource: "food", amount: 60 }]),
      calm("woodcutter", "square", [{ resource: "food", amount: 60 }]),
      calm("drifter", "square", [{ resource: "food", amount: 60 }]),
      {
        id: "zeus",
        name: "Zeus",
        locationId: "hall",
        deity: true,
        startingInventory: [{ resource: "divinity", amount: 10 }],
      },
      {
        id: "hera",
        name: "Hera",
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
    },
    recipes: {},
  };
}

/** A mortal whose drives rank nothing above praying and walking home. */
function calm(
  idValue: string,
  locationId: string,
  startingInventory: { resource: string; amount: number }[],
) {
  return {
    id: idValue,
    name: idValue,
    locationId,
    drives: { thrift: 0, appetite: 0, greed: 0, piety: 0 },
    startingInventory,
  };
}

class World {
  state: WorldState;
  prng: PrngState = createPrng(1);
  readonly log: WorldEvent[] = [];
  readonly initial: WorldState;
  constructor(
    state = createInitialWorldState(pack()),
    private readonly mortals: readonly string[] = [
      "farmer",
      "woodcutter",
      "drifter",
    ],
  ) {
    this.state = state;
    this.initial = state;
  }
  /** One tick of fixtures and routines: every mortal's routine proposal plus `extra`. */
  tick(...extra: Record<string, unknown>[]): WorldEvent[] {
    const proposals = [
      ...extra.map((raw, index) => {
        const submitted = submitProposal({
          schemaVersion: 1,
          targets: [],
          expectedRevisions: [],
          source: "fixture",
          observationId: `obs-${this.state.tick}-${index}`,
          ...raw,
        });
        if (!submitted.ok) throw new Error(submitted.rejection.message);
        return submitted.proposal;
      }),
      ...this.mortals.flatMap((mortal) => {
        const decision = decideRoutineProposal(this.state, id(mortal));
        return decision ? [decision.proposal] : [];
      }),
    ];
    const result = runTick(this.state, this.prng, proposals);
    this.state = result.state;
    this.prng = result.prng;
    this.log.push(...result.events);
    return [...result.events];
  }
  /** Runs ticks, with no extra proposals, until `done` or `limit`. */
  until(done: () => boolean, limit = 40): void {
    for (let n = 0; n < limit && !done(); n += 1) this.tick();
  }
  petitions() {
    return [...this.state.petitions.values()];
  }
  /** Commits a fixture event as the world would have, so a cause exists without staging a whole story. */
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
}

const kinds = (events: readonly WorldEvent[]) => events.map((e) => e.kind);
const ofKind = <K extends WorldEvent["kind"]>(
  events: readonly WorldEvent[],
  kind: K,
) =>
  events.filter((e): e is Extract<WorldEvent, { kind: K }> => e.kind === kind);

// --- Praying -------------------------------------------------------------------------------

/** `mortal` holds a witnessed memory of `event`, naming `offender`: what it would hold had it seen it happen. */
function remembers(
  world: World,
  mortal: string,
  event: WorldEvent,
  offender: string,
  eventKind: string,
) {
  return world.apply({
    kind: "memory-recorded",
    memoryKind: "witnessed",
    entityId: mortal,
    sourceEventId: event.id,
    eventKind,
    subjects: [offender, mortal],
    salience: 6,
    consequence: { effect: "harm", agent: offender, target: mortal },
  });
}

test("an offscreen strike on the farmer's tavern yields no petition and no striker; once the farmer stands at the damaged tavern it notices the loss, walks to the altar, prays for help, and walks home", () => {
  const world = new World();
  world.tick({ actor: "zeus", kind: "strike", target: "the-tavern", power: 3 });
  const ignition = ofKind(world.log, "building-ignited")[0];
  expect(ignition).toBeDefined();

  // The farmer is in the square, the tavern is somewhere else: nothing reaches it.
  expect(getActor(world.state, id("farmer"))?.locationId).toBe(id("square"));
  expect(prayableCauses(world.state, id("farmer"))).toEqual([]);
  for (let n = 0; n < 30; n += 1) world.tick();
  expect(ofKind(world.log, "petition-opened")).toEqual([]);
  expect(ofKind(world.log, "loss-noticed")).toEqual([]);
  expect(JSON.stringify(world.log)).not.toContain("punish");

  // It stands at the tavern (a fixture: nothing in its routine takes it there) and sees the damage.
  place(world, "farmer", "tavern");
  world.tick();
  const noticed = ofKind(world.log, "loss-noticed");
  expect(noticed).toHaveLength(1);
  expect(noticed[0]).toMatchObject({
    entityId: "farmer",
    causeEventId: ignition?.id,
    building: "the-tavern",
  });
  // A memory of it, with no offender: not the striker, not anyone.
  const memory = world.state.memories
    .get(id("farmer"))
    ?.find((m) => m.kind === "noticed");
  expect(memory).toMatchObject({ kind: "noticed", causeEventId: ignition?.id });
  expect(memory?.consequence).toBeUndefined();
  expect(memory?.subjects).not.toContain(id("zeus"));
  expect(
    prayableCauses(world.state, id("farmer")).find(
      (c) => c.eventId === ignition?.id,
    )?.offender,
  ).toBeUndefined();

  // It walks away to the altar, prays for help, and goes home: the memory is what keeps the cause.
  world.until(
    () =>
      world.petitions().some((p) => p.petitioner === id("farmer")) &&
      getActor(world.state, id("farmer"))?.locationId === id("square"),
  );
  const petition = world.petitions().find((p) => p.petitioner === id("farmer"));
  expect(petition).toMatchObject({
    cause: ignition?.id,
    request: {
      kind: "help",
      need: { kind: "building", building: "the-tavern" },
    },
  });
  expect(JSON.stringify(world.log)).not.toContain("punish");
  const farmerMoves = world.log.filter(
    (e) =>
      e.kind === "entity-moved" &&
      e.entityId === id("farmer") &&
      world.log.indexOf(e) > world.log.indexOf(ignition as WorldEvent),
  );
  expect(farmerMoves.map((e) => (e as { to: string }).to)).toEqual([
    "square",
    "altar",
    "square",
  ]);
});

test("a loss is noticed once: standing at the building again, or still there, records no second loss-noticed; a second damage is a new loss", () => {
  const world = new World();
  world.tick({ actor: "zeus", kind: "strike", target: "the-tavern", power: 1 });
  place(world, "farmer", "tavern");
  world.tick();
  expect(ofKind(world.log, "loss-noticed")).toHaveLength(1);
  // Still there next tick, then away and back: no second record for the same loss.
  const stay = (n: number) => {
    for (let i = 0; i < n; i += 1) {
      place(world, "farmer", "tavern");
      world.tick();
    }
  };
  stay(3);
  place(world, "farmer", "square");
  world.tick();
  stay(2);
  expect(ofKind(world.log, "loss-noticed")).toHaveLength(1);
  // Control: a new cause, a second strike on the same building, is a new loss.
  const tavern = world.state.buildings.get(id("the-tavern"));
  if (!tavern) throw new Error("tavern");
  world.state = {
    ...world.state,
    buildings: new Map(world.state.buildings).set(id("the-tavern"), {
      ...(tavern as object),
      status: "operational",
      fireIntensity: undefined,
      ticksBurning: undefined,
      ignition: undefined,
    } as never),
  };
  world.tick({ actor: "zeus", kind: "strike", target: "the-tavern", power: 1 });
  // (The farmer's routine would walk it off to pray this tick, so the scan is read directly.)
  place(world, "farmer", "tavern");
  const next = planNoticeStep(world.state);
  expect(next).toHaveLength(1);
  expect(next[0]).toMatchObject({
    kind: "loss-noticed",
    entityId: "farmer",
    building: "the-tavern",
  });
  const second = world.state.causes.get(id("farmer"))?.at(-1);
  expect((next[0] as unknown as { causeEventId: string }).causeEventId).toBe(
    String(second?.eventId),
  );
  expect(ofKind(world.log, "loss-noticed")).toHaveLength(1);
});

test("a stolen or spoiled stock is noticed by its owner, with the resource and amount, once", () => {
  const world = new World();
  const spoiled = world.apply({
    kind: "stock-spoiled",
    entityId: "farmer",
    resource: "food",
    amount: 3,
    cause: "director",
  });
  world.tick();
  world.tick();
  const noticed = ofKind(world.log, "loss-noticed");
  expect(noticed).toHaveLength(1);
  expect(noticed[0]).toMatchObject({
    entityId: "farmer",
    causeEventId: spoiled.id,
    resource: "food",
    amount: 3,
  });
  // Someone else's stock is not the farmer's to notice.
  expect(noticed.some((e) => e.entityId !== id("farmer"))).toBe(false);
});

test("only the owner notices: another mortal at the damaged building, a building that is whole, and a dead owner notice nothing", () => {
  const world = new World();
  world.tick({ actor: "zeus", kind: "strike", target: "the-tavern", power: 3 });
  place(world, "drifter", "tavern");
  world.tick();
  expect(ofKind(world.log, "loss-noticed")).toEqual([]);
  // A dead owner at its building notices nothing.
  const farmer = getActor(world.state, id("farmer"));
  if (!farmer) throw new Error("farmer");
  world.state = withActor(world.state, {
    ...farmer,
    alive: false,
    locationId: id("tavern"),
  });
  world.tick();
  expect(ofKind(world.log, "loss-noticed")).toEqual([]);
  // Control: the living owner there does.
  world.state = withActor(world.state, { ...farmer, locationId: id("tavern") });
  world.tick();
  expect(ofKind(world.log, "loss-noticed")).toHaveLength(1);
});

test("noticed losses rebuild from the log and survive encode and decode, and a noticed record naming a ghost is refused", () => {
  const world = new World();
  world.tick({ actor: "zeus", kind: "strike", target: "the-tavern", power: 3 });
  place(world, "farmer", "tavern");
  world.tick();
  const rebuilt = applyEvents(
    world.initial,
    world.log.map((e, i) => ({ ...e, sequence: i + 1 })) as WorldEvent[],
  );
  expect([...rebuilt.noticed]).toEqual([...world.state.noticed]);
  expect(rebuilt.noticed.size).toBe(1);
  const encoded = JSON.parse(JSON.stringify(encode(world.state)));
  expect([...decode(encoded).noticed]).toEqual([...world.state.noticed]);
  const ghost = JSON.parse(JSON.stringify(encoded));
  ghost.noticed[0][1].owner = "ghost";
  expect(() => decode(ghost)).toThrow(/ghost/);
});

test("a theft is prayed about as lost stock, always known to its victim, with no offender; only a memory of the theft naming the offender, who owns a building, makes it a punish petition", () => {
  const theft = (world: World, offender: string) =>
    world.apply({
      kind: "theft",
      entityId: offender,
      victim: "farmer",
      resource: "food",
      amount: 3,
      cause: "director",
    });

  // Not seen, not told: the victim knows what it lost, not who took it. Help, with the amount.
  const blind = new World();
  const unseen = theft(blind, "woodcutter");
  blind.until(() => blind.petitions().length > 0);
  expect(blind.petitions()[0]).toMatchObject({
    cause: unseen.id,
    request: {
      kind: "help",
      need: { kind: "resource", resource: "food", amount: 3 },
    },
  });

  // It saw it happen: a witnessed memory naming the woodcutter, who owns the woodshed.
  const saw = new World();
  const seen = theft(saw, "woodcutter");
  remembers(saw, "farmer", seen, "woodcutter", "theft");
  saw.until(() => saw.petitions().length > 0);
  expect(saw.petitions()[0]).toMatchObject({
    cause: seen.id,
    request: {
      kind: "punish",
      offender: "woodcutter",
      buildings: ["woodshed"],
    },
  });

  // Told of it: a belief citing the theft and naming the thief also does.
  const told = new World();
  const heard = theft(told, "woodcutter");
  told.apply({
    kind: "memory-recorded",
    memoryKind: "told",
    entityId: "farmer",
    sourceEventId: "evt-0-report",
    teller: "drifter",
    content: "I saw the woodcutter take it.",
    linkedEventId: heard.id,
    subjects: ["drifter", "woodcutter", "farmer"],
    salience: 4,
    consequence: { effect: "harm", agent: "woodcutter", target: "farmer" },
  });
  told.until(() => told.petitions().length > 0);
  expect(told.petitions()[0]?.request).toMatchObject({
    kind: "punish",
    offender: "woodcutter",
  });

  // A memory that does not count: of another event, or that does not name the thief.
  const other = new World();
  const real = theft(other, "woodcutter");
  const decoy = other.apply({
    kind: "stock-spoiled",
    entityId: "farmer",
    resource: "food",
    amount: 1,
    cause: "director",
  });
  remembers(other, "farmer", decoy, "woodcutter", "stock-spoiled");
  other.until(() => other.petitions().some((p) => p.cause === real.id));
  expect(other.petitions().find((p) => p.cause === real.id)?.request.kind).toBe(
    "help",
  );
  const nameless = new World();
  const nameless_ = theft(nameless, "woodcutter");
  nameless.apply({
    kind: "memory-recorded",
    memoryKind: "witnessed",
    entityId: "farmer",
    sourceEventId: nameless_.id,
    eventKind: "theft",
    subjects: ["farmer"],
    salience: 6,
    consequence: { effect: "harm", agent: "drifter", target: "farmer" },
  });
  nameless.until(() => nameless.petitions().length > 0);
  expect(nameless.petitions()[0]?.request.kind).toBe("help");

  // A thief who owns no building cannot be punished, however well known: help.
  const homeless = new World();
  const stolen = theft(homeless, "drifter");
  remembers(homeless, "farmer", stolen, "drifter", "theft");
  homeless.until(() => homeless.petitions().length > 0);
  expect(homeless.petitions()[0]?.request.kind).toBe("help");
});

test("a grudge yields only a punish petition, with the offender's buildings when it owns any and with none when it owns none; a grudge against a god, or against a dead mortal, has nothing to ask for", () => {
  const grudge = (toward: string) => {
    const world = new World();
    world.apply({
      kind: "relationship-changed",
      entityId: "farmer",
      toward,
      affinityDelta: -2,
      grudgeDelta: 1,
      memoryEventId: "evt-0-m",
    });
    return world;
  };
  const owner = grudge("woodcutter");
  owner.until(() => owner.petitions().length > 0);
  expect(owner.petitions()[0]?.request).toMatchObject({
    kind: "punish",
    offender: "woodcutter",
    buildings: ["woodshed"],
  });
  // A mortal who owns nothing can still be asked to be punished: the world strikes its goods.
  const none = grudge("drifter");
  none.until(() => none.petitions().length > 0);
  expect(none.petitions()[0]?.request).toMatchObject({
    kind: "punish",
    offender: "drifter",
    buildings: [],
  });
  // A god cannot be struck, so a grudge against one asks for nothing.
  const divine = grudge("zeus");
  expect(prayableCauses(divine.state, id("farmer"))).toEqual([]);
  for (let n = 0; n < 50; n += 1) divine.tick();
  expect(divine.petitions()).toEqual([]);
  // Nor can a dead one.
  const dead = grudge("drifter");
  const drifter = getActor(dead.state, id("drifter"));
  if (!drifter) throw new Error("drifter");
  dead.state = withActor(dead.state, { ...drifter, alive: false });
  expect(prayableCauses(dead.state, id("farmer"))).toEqual([]);
});

test("an unmet need is prayed about, citing the need event; spoiled stock too", () => {
  const needy = new World();
  needy.apply({
    kind: "stock-spoiled",
    entityId: "farmer",
    resource: "food",
    amount: 1,
    cause: "director",
  });
  needy.until(() => needy.petitions().length > 0);
  expect(needy.petitions()[0]?.request).toEqual({
    kind: "help",
    need: { kind: "resource", resource: "food", amount: 1 },
  });

  // The woodcutter's food runs out: the scan records the need, and the woodcutter prays about it.
  const hungry = new World();
  const woodcutter = getActor(hungry.state, id("woodcutter"));
  if (!woodcutter) throw new Error("woodcutter");
  hungry.state = withActor(hungry.state, {
    ...woodcutter,
    inventory: new Map(),
  });
  hungry.until(() =>
    hungry.petitions().some((p) => p.petitioner === id("woodcutter")),
  );
  const need = ofKind(hungry.log, "unmet-need").find(
    (e) => e.entityId === id("woodcutter"),
  );
  expect(
    hungry.petitions().find((p) => p.petitioner === id("woodcutter"))?.cause,
  ).toBe(need?.id);
});

test("each cause leads to at most one petition, and the cooldown keeps two prayers from back-to-back ticks", () => {
  const world = new World();
  const first = world.apply({
    kind: "stock-spoiled",
    entityId: "farmer",
    resource: "food",
    amount: 1,
    cause: "director",
  });
  // A different resource, so the one-open-petition-per-resource rule does not hold it back:
  // only the cooldown and one-petition-per-cause are under test here.
  const second = world.apply({
    kind: "theft",
    entityId: "drifter",
    victim: "farmer",
    resource: "wood",
    amount: 1,
    cause: "director",
  });
  world.until(() => world.petitions().length >= 1);
  const openedAt = world.state.tick;
  expect(world.petitions()).toHaveLength(1);
  // Within the cooldown nothing more is prayed, however many causes wait.
  const cooldown = petitionBalanceOf(world.state.rules, "prayerCooldownTicks");
  for (let n = 0; n < cooldown - 2; n += 1) world.tick();
  expect(world.petitions()).toHaveLength(1);
  expect(world.state.tick).toBeLessThan(openedAt + cooldown);
  // After it, the other cause is prayed about, once, and the first cause never again.
  world.until(() => world.petitions().length >= 2, cooldown + 10);
  const causes = world.petitions().map((p) => p.cause);
  expect(new Set(causes).size).toBe(2);
  expect(causes).toEqual(expect.arrayContaining([first.id, second.id]));
  for (let n = 0; n < 30; n += 1) world.tick();
  expect(world.petitions()).toHaveLength(2);
});

test("a cause older than the prayable window is not prayed about, and a pray proposal citing one is refused; a fresh cause is accepted", () => {
  const world = new World();
  const old = world.apply({
    kind: "stock-spoiled",
    entityId: "farmer",
    resource: "food",
    amount: 1,
    cause: "director",
  });
  const window = petitionBalanceOf(world.state.rules, "causePrayableTicks");
  world.state = { ...world.state, tick: world.state.tick + window + 1 };
  expect(prayableCauses(world.state, id("farmer"))).toEqual([]);
  const farmer = getActor(world.state, id("farmer"));
  if (!farmer) throw new Error("farmer");
  world.state = withActor(world.state, { ...farmer, locationId: id("altar") });
  const stale = submitProposal({
    schemaVersion: 1,
    actor: "farmer",
    kind: "pray",
    cause: old.id,
    targets: [],
    expectedRevisions: [],
    source: "routine",
    observationId: "obs-p",
  });
  if (!stale.ok) throw new Error("fixture");
  const refused = runTick(world.state, world.prng, [stale.proposal]);
  expect(refused.rejected.map((r) => r.reason)).toEqual(["malformed"]);
  // Control: a cause from this tick is accepted.
  const fresh = world.apply({
    kind: "stock-spoiled",
    entityId: "farmer",
    resource: "food",
    amount: 1,
    cause: "director",
  });
  const accepted = submitProposal({
    schemaVersion: 1,
    actor: "farmer",
    kind: "pray",
    cause: fresh.id,
    targets: [],
    expectedRevisions: [],
    source: "routine",
    observationId: "obs-q",
  });
  if (!accepted.ok) throw new Error("fixture");
  const ran = runTick(world.state, world.prng, [accepted.proposal]);
  expect(ran.rejected).toEqual([]);
  expect(kinds(ran.events)).toContain("petition-opened");
});

test("a mortal with work to do prefers it to prayer: production and repair outrank praying", () => {
  const base = pack();
  const state = createInitialWorldState({
    ...base,
    recipes: {
      planks: {
        inputs: [{ resource: "wood", amount: 2 }],
        outputs: [{ resource: "planks", amount: 1 }],
      },
    },
  });
  const world = new World(state);
  const woodcutter = getActor(world.state, id("woodcutter"));
  if (!woodcutter) throw new Error("woodcutter");
  world.state = withActor(world.state, {
    ...woodcutter,
    drives: { thrift: 0.6, appetite: 0, greed: 0, piety: 0 },
    inventory: new Map([
      ["wood", 2],
      ["food", 1],
    ]),
  });
  world.apply({
    kind: "stock-spoiled",
    entityId: "woodcutter",
    resource: "food",
    amount: 1,
    cause: "director",
  });
  expect(
    decideRoutineProposal(world.state, id("woodcutter"))?.proposal.kind,
  ).toBe("produce");
  // Control: with nothing to produce, the same mortal turns to prayer.
  world.state = withActor(world.state, {
    ...(getActor(world.state, id("woodcutter")) as NonNullable<
      ReturnType<typeof getActor>
    >),
    inventory: new Map([["food", 1]]),
  });
  expect(
    decideRoutineProposal(world.state, id("woodcutter"))?.proposal,
  ).toMatchObject({ kind: "move", to: "altar" });
});

test("a mortal that did not just pray stays where it was put: only the walk back from a prayer takes it home", () => {
  const world = new World();
  // Standing in the tavern with nothing to pray about and no prayer behind it: no pull toward home.
  place(world, "farmer", "tavern");
  expect(
    decideRoutineProposal(world.state, id("farmer"))?.proposal.kind,
  ).not.toBe("move");
  for (let n = 0; n < 5; n += 1) world.tick();
  expect(getActor(world.state, id("farmer"))?.locationId).toBe(id("tavern"));
  // Control: right after praying, the same mortal at the altar walks home.
  const prayed = new World();
  prayer(prayed, "farmer");
  expect(getActor(prayed.state, id("farmer"))?.locationId).toBe(id("altar"));
  expect(
    decideRoutineProposal(prayed.state, id("farmer"))?.proposal,
  ).toMatchObject({ kind: "move", to: "square" });
  // And a long time after the prayer it is not pulled any more.
  const cooldown = petitionBalanceOf(prayed.state.rules, "prayerCooldownTicks");
  prayed.state = { ...prayed.state, tick: prayed.state.tick + cooldown + 1 };
  expect(
    decideRoutineProposal(prayed.state, id("farmer"))?.proposal.kind,
  ).not.toBe("move");
});

// --- Routing --------------------------------------------------------------------------------

/** Has `mortal` pray at the altar about a fresh cause now, and returns the petition's god. */
function prayer(world: World, mortal: string): string {
  const cause = world.apply({
    kind: "stock-spoiled",
    entityId: mortal,
    resource: "food",
    amount: 1,
    cause: "director",
  });
  const actor = getActor(world.state, id(mortal));
  if (!actor) throw new Error(mortal);
  world.state = withActor(world.state, { ...actor, locationId: id("altar") });
  const submitted = submitProposal({
    schemaVersion: 1,
    actor: mortal,
    kind: "pray",
    cause: cause.id,
    targets: [],
    expectedRevisions: [],
    source: "routine",
    observationId: `obs-${mortal}-${world.log.length}`,
  });
  if (!submitted.ok) throw new Error("fixture");
  const ran = runTick(world.state, world.prng, [submitted.proposal]);
  expect(ran.rejected).toEqual([]);
  world.state = ran.state;
  world.log.push(...ran.events);
  const opened = ofKind(ran.events, "petition-opened")[0];
  if (!opened) throw new Error("no petition");
  return String(opened.god);
}

test("a mortal prays to the god it favors most; on a tie, to the god with fewer petitions; on a full tie, by id", () => {
  // Full tie, nothing prayed yet: id order.
  const world = new World();
  expect(prayer(world, "farmer")).toBe("hera");
  // Hera now has one petition: the next mortal's tie goes to Zeus.
  expect(prayer(world, "woodcutter")).toBe("zeus");
  // Both have one: id order again.
  expect(prayer(world, "drifter")).toBe("hera");

  // Affinity outranks the count: a mortal fond of Zeus prays to him though Hera has fewer.
  const fond = new World();
  const relationships = new Map(fond.state.relationships);
  relationships.set(relationshipKey(id("farmer"), id("zeus")), {
    from: id("farmer"),
    toward: id("zeus"),
    affinity: 3,
    grudge: 0,
    allied: false,
  });
  fond.state = { ...fond.state, relationships };
  expect(prayer(fond, "farmer")).toBe("zeus");
  // Control: with no affinity either way the same mortal is routed by the tie rules.
  const none = new World();
  expect(prayer(none, "farmer")).toBe("hera");
});

test("a dead mortal does not pray, and a god cannot: only a living mortal's routine opens a petition", () => {
  const world = new World();
  const cause = world.apply({
    kind: "stock-spoiled",
    entityId: "farmer",
    resource: "food",
    amount: 1,
    cause: "director",
  });
  const farmer = getActor(world.state, id("farmer"));
  if (!farmer) throw new Error("farmer");
  world.state = withActor(world.state, { ...farmer, alive: false });
  expect(decideRoutineProposal(world.state, id("farmer"))).toBeUndefined();
  const zeus = getActor(world.state, id("zeus"));
  if (!zeus) throw new Error("zeus");
  world.state = withActor(world.state, { ...zeus, locationId: id("altar") });
  const godPrays = submitProposal({
    schemaVersion: 1,
    actor: "zeus",
    kind: "pray",
    cause: cause.id,
    targets: [],
    expectedRevisions: [],
    source: "model",
    observationId: "obs-g",
  });
  if (!godPrays.ok) throw new Error("fixture");
  expect(
    runTick(world.state, world.prng, [godPrays.proposal]).rejected.map(
      (r) => r.reason,
    ),
  ).toEqual(["unauthorized-claim"]);
});

// --- Who hears it ------------------------------------------------------------------------------

test("anyone at the altar saw the prayer; the named god hears it wherever it is and no other god does", () => {
  const world = new World();
  const watcher = getActor(world.state, id("drifter"));
  if (!watcher) throw new Error("drifter");
  world.state = withActor(world.state, { ...watcher, locationId: id("altar") });
  const god = prayer(world, "farmer");
  const opened = ofKind(world.log, "petition-opened")[0] as WorldEvent;
  // The drifter stood at the altar and saw it; the woodcutter in the square did not.
  expect(
    perceive(world.state, id("drifter"), [opened])?.events.map((e) => e.kind),
  ).toEqual(["petition-opened"]);
  expect(
    perceive(world.state, id("woodcutter"), [opened])?.events.map(
      (e) => e.kind,
    ),
  ).toEqual([]);
  // The gods are in the hall, perceiving nothing of it; the named one still has it listed.
  expect(perceive(world.state, id(god), [opened])?.events).toEqual([]);
  expect(openPetitionsFor(world.state, id(god)).map((p) => p.id)).toEqual([
    opened.id,
  ]);
  const other = god === "hera" ? "zeus" : "hera";
  expect(openPetitionsFor(world.state, id(other))).toEqual([]);
});

// --- State -----------------------------------------------------------------------------------------

test("petitions and the causes mortals remember rebuild from the log, survive encode and decode, and decode refuses ghosts", () => {
  const world = new World();
  world.apply({
    kind: "theft",
    entityId: "woodcutter",
    victim: "farmer",
    resource: "food",
    amount: 1,
    cause: "director",
  });
  world.until(() => world.petitions().length > 0);
  const rebuilt = applyEvents(
    world.initial,
    world.log.map((e, i) => ({ ...e, sequence: i + 1 })) as WorldEvent[],
  );
  expect([...rebuilt.petitions]).toEqual([...world.state.petitions]);
  expect([...rebuilt.causes]).toEqual([...world.state.causes]);

  const encoded = JSON.parse(JSON.stringify(encode(world.state)));
  const restored = decode(encoded);
  expect([...restored.petitions]).toEqual([...world.state.petitions]);
  expect([...restored.causes]).toEqual([...world.state.causes]);

  const ghostPetitioner = JSON.parse(JSON.stringify(encoded));
  ghostPetitioner.petitions[0][1].petitioner = "ghost";
  expect(() => decode(ghostPetitioner)).toThrow(/ghost/);
  const ghostGod = JSON.parse(JSON.stringify(encoded));
  ghostGod.petitions[0][1].god = "ghost";
  expect(() => decode(ghostGod)).toThrow(/ghost/);
  // A mortal's home is state too: it survives the round trip.
  expect(getActor(restored, id("farmer"))?.home).toBe(id("square"));
});

test("the petition tunables default to the numbers the authored content states, so a retune edits one place", () => {
  for (const key of Object.keys(DEFAULT_PETITION_BALANCE)) {
    expect(petitionBalanceOf(createInitialWorldState(pack()).rules, key)).toBe(
      DEFAULT_PETITION_BALANCE[key],
    );
  }
  expect(
    petitionBalanceOf(
      { ...pack().rules, petitionBalance: { prayerCooldownTicks: 7 } },
      "prayerCooldownTicks",
    ),
  ).toBe(7);
});

void ({} as EventId);

// --- Answers, signs, blessings, and lapses (Unit 4) -------------------------------------------

function relate(world: World, from: string, toward: string, affinity: number) {
  const relationships = new Map(world.state.relationships);
  relationships.set(relationshipKey(id(from), id(toward)), {
    from: id(from),
    toward: id(toward),
    affinity,
    grudge: 0,
    allied: false,
  });
  world.state = { ...world.state, relationships };
}

function place(world: World, actor: string, where: string) {
  const held = getActor(world.state, id(actor));
  if (!held) throw new Error(actor);
  world.state = withActor(world.state, { ...held, locationId: id(where) });
}

/** Opens a petition by `mortal` to `god` about `cause`, by praying at the altar, then sends the mortal back to the square. */
function petition(
  world: World,
  mortal: string,
  god: string,
  cause: Record<string, unknown>,
) {
  const event = world.apply(cause);
  // A mortal who stood there when it happened saw who did it: that memory is what lets it name the
  // offender, and what lets it pray about a building it is not standing at.
  if (cause.kind === "theft") {
    remembers(world, mortal, event, String(cause.entityId), "theft");
  } else if (cause.kind === "building-damaged") {
    remembers(world, mortal, event, String(cause.actor), "building-damaged");
  }
  relate(world, mortal, god, 5);
  place(world, mortal, "altar");
  const submitted = submitProposal({
    schemaVersion: 1,
    actor: mortal,
    kind: "pray",
    cause: event.id,
    targets: [],
    expectedRevisions: [],
    source: "routine",
    observationId: `obs-open-${world.log.length}`,
  });
  if (!submitted.ok) throw new Error("fixture");
  const ran = runTick(world.state, world.prng, [submitted.proposal]);
  expect(ran.rejected).toEqual([]);
  world.state = ran.state;
  world.prng = ran.prng;
  world.log.push(...ran.events);
  relationships_reset(world, mortal, god);
  place(world, mortal, "square");
  const opened = ofKind(ran.events, "petition-opened")[0] as Extract<
    WorldEvent,
    { kind: "petition-opened" }
  >;
  expect(String(opened.god)).toBe(god);
  return opened;
}

/** Zeroes the fondness a fixture used to route a prayer, so what follows is the sign's doing alone. */
function relationships_reset(world: World, mortal: string, god: string) {
  const relationships = new Map(world.state.relationships);
  relationships.delete(relationshipKey(id(mortal), id(god)));
  world.state = { ...world.state, relationships };
}

/** A god acts for one tick: its proposal alone, so routines do not interfere. */
function godActs(world: World, raw: Record<string, unknown>) {
  const submitted = submitProposal({
    schemaVersion: 1,
    targets: [],
    expectedRevisions: [],
    source: "model",
    observationId: `obs-god-${world.log.length}`,
    ...raw,
  });
  if (!submitted.ok) throw new Error(submitted.rejection.message);
  const ran = runTick(world.state, world.prng, [submitted.proposal]);
  world.state = ran.state;
  world.prng = ran.prng;
  world.log.push(...ran.events);
  return ran;
}

const theftBy = (offender: string, victim = "farmer") => ({
  kind: "theft",
  entityId: offender,
  victim,
  resource: "food",
  amount: 1,
  cause: "director",
});

const affinityOf = (world: World, mortal: string, god: string) =>
  world.state.relationships.get(relationshipKey(id(mortal), id(god)))
    ?.affinity ?? 0;

test("Zeus strikes the woodshed within the window: the petition is answered, the farmer gets a sign that raises its affinity toward Zeus, and it worships him", () => {
  const world = new World();
  const opened = petition(world, "farmer", "zeus", theftBy("woodcutter"));
  expect(world.state.petitions.get(opened.id)?.request).toMatchObject({
    kind: "punish",
    offender: "woodcutter",
  });
  const divinityBefore =
    getActor(world.state, id("zeus"))?.inventory.get("divinity") ?? 0;

  const ran = godActs(world, {
    actor: "zeus",
    kind: "strike",
    target: "woodshed",
    power: 1,
  });
  expect(ran.rejected).toEqual([]);
  const answered = ofKind(ran.events, "petition-answered");
  expect(answered).toHaveLength(1);
  expect(answered[0]).toMatchObject({
    entityId: "farmer",
    god: "zeus",
    petitionId: opened.id,
  });
  expect(world.state.petitions.get(opened.id)?.status).toBe("answered");
  // The strike's own event is what answered it.
  const strike = ofKind(ran.events, "building-damaged")[0];
  expect(answered[0]?.answeredBy).toBe(strike?.id);

  // The sign: a kindness by Zeus toward the farmer, remembered, raising its affinity; and the farmer worships.
  const sign = ofKind(ran.events, "memory-recorded").find(
    (m) => m.entityId === id("farmer") && m.memoryKind === "sign",
  );
  expect(sign).toMatchObject({
    outcome: "answered",
    god: "zeus",
    petitionId: opened.id,
    consequence: { effect: "kindness", agent: "zeus", target: "farmer" },
  });
  // The sign's own effect on the farmer's feeling: one kind act by Zeus. (The farmer also
  // saw the strike land on the square's woodshed, which is its own memory and its own change.)
  const fromSign = ofKind(ran.events, "relationship-changed").find(
    (e) => e.memoryEventId === sign?.id,
  );
  expect(fromSign).toMatchObject({
    entityId: "farmer",
    toward: "zeus",
    affinityDelta: 1,
  });
  const worship = ofKind(ran.events, "worship-performed");
  expect(worship).toHaveLength(1);
  expect(worship[0]).toMatchObject({ entityId: "farmer", deity: "zeus" });
  // His divinity: spent one on the strike, credited the worship's gain.
  const gain = world.state.rules.economyBalance.worshipCapacityGain ?? 1;
  expect(getActor(world.state, id("zeus"))?.inventory.get("divinity")).toBe(
    divinityBefore - 1 + gain,
  );

  // The whole story explains itself from the log: theft, prayer, answer, sign, feeling.
  const change = fromSign;
  expect(change).toBeDefined();
  const byId = new Map(world.log.map((e) => [e.id, e]));
  const chain: string[] = [];
  let cursor: WorldEvent | undefined = change;
  while (cursor !== undefined) {
    chain.unshift(cursor.kind);
    const next: string | undefined =
      cursor.kind === "relationship-changed"
        ? cursor.memoryEventId
        : cursor.kind === "memory-recorded"
          ? cursor.sourceEventId
          : cursor.kind === "petition-answered"
            ? cursor.petitionId
            : cursor.kind === "petition-opened"
              ? cursor.cause
              : undefined;
    cursor = next === undefined ? undefined : byId.get(next as EventId);
  }
  expect(chain).toEqual([
    "theft",
    "petition-opened",
    "petition-answered",
    "memory-recorded",
    "relationship-changed",
  ]);
});

test("a strike that does not answer: the other god's, one on a building the offender does not own, and one on a building that is not operational", () => {
  const build = () => {
    const world = new World();
    const opened = petition(world, "farmer", "zeus", theftBy("woodcutter"));
    return { world, opened };
  };
  // The other god.
  const other = build();
  godActs(other.world, {
    actor: "hera",
    kind: "strike",
    target: "woodshed",
    power: 1,
  });
  expect(other.world.state.petitions.get(other.opened.id)?.status).toBe("open");
  // A building the offender does not own.
  const wrong = build();
  godActs(wrong.world, {
    actor: "zeus",
    kind: "strike",
    target: "the-tavern",
    power: 1,
  });
  expect(wrong.world.state.petitions.get(wrong.opened.id)?.status).toBe("open");
  // A building already damaged is not operational: a second strike on the woodshed does not answer.
  const spent = build();
  godActs(spent.world, {
    actor: "zeus",
    kind: "strike",
    target: "woodshed",
    power: 1,
  });
  expect(spent.world.state.petitions.get(spent.opened.id)?.status).toBe(
    "answered",
  );
  const again = build();
  const woodshed = again.world.state.buildings.get(id("woodshed"));
  if (!woodshed) throw new Error("woodshed");
  again.world.state = {
    ...again.world.state,
    buildings: new Map(again.world.state.buildings).set(id("woodshed"), {
      ...woodshed,
      status: "damaged",
    } as typeof woodshed),
  };
  godActs(again.world, {
    actor: "zeus",
    kind: "strike",
    target: "woodshed",
    power: 1,
  });
  expect(again.world.state.petitions.get(again.opened.id)?.status).toBe("open");
});

test("a strike answers every open punish petition against that offender's building, and only those", () => {
  const world = new World();
  const a = petition(world, "farmer", "zeus", theftBy("woodcutter"));
  world.state = { ...world.state, tick: world.state.tick + 25 };
  const b = petition(
    world,
    "drifter",
    "zeus",
    theftBy("woodcutter", "drifter"),
  );
  // A different resource from the farmer's first petition, which is still open.
  const c = petition(world, "farmer", "hera", {
    kind: "theft",
    entityId: "woodcutter",
    victim: "farmer",
    resource: "wood",
    amount: 1,
    cause: "director",
  });
  const ran = godActs(world, {
    actor: "zeus",
    kind: "strike",
    target: "woodshed",
    power: 1,
  });
  expect(
    ofKind(ran.events, "petition-answered")
      .map((e) => e.petitionId)
      .sort(),
  ).toEqual([a.id, b.id].sort());
  expect(world.state.petitions.get(c.id)?.status).toBe("open");
});

test("the window is inclusive: an action on its last tick answers, and one on the tick after does not and the petition lapses then", () => {
  const window = (w: World) =>
    petitionBalanceOf(w.state.rules, "answerWindowTicks");
  const last = new World();
  const first = petition(last, "farmer", "zeus", theftBy("woodcutter"));
  const openedAt = last.state.petitions.get(first.id)?.tick ?? 0;
  last.state = { ...last.state, tick: openedAt + window(last) - 1 };
  const answered = godActs(last, {
    actor: "zeus",
    kind: "strike",
    target: "woodshed",
    power: 1,
  });
  expect(last.state.tick).toBe(openedAt + window(last));
  expect(ofKind(answered.events, "petition-answered")).toHaveLength(1);
  expect(ofKind(answered.events, "petition-lapsed")).toEqual([]);
  expect(last.state.petitions.get(first.id)?.status).toBe("answered");

  const late = new World();
  const second = petition(late, "farmer", "zeus", theftBy("woodcutter"));
  late.state = { ...late.state, tick: openedAt + window(late) };
  const missed = godActs(late, {
    actor: "zeus",
    kind: "strike",
    target: "woodshed",
    power: 1,
  });
  expect(late.state.tick).toBe(openedAt + window(late) + 1);
  expect(ofKind(missed.events, "petition-answered")).toEqual([]);
  expect(ofKind(missed.events, "petition-lapsed")).toHaveLength(1);
  expect(late.state.petitions.get(second.id)?.status).toBe("lapsed");
});

/** The farmer is at the altar with a theft by the woodcutter it saw, fond of Zeus; returns the world after one tick of `pray` and `strike` in the given order. */
function prayerAndStrike(order: "prayer-first" | "strike-first") {
  const world = new World();
  const theft = world.apply(theftBy("woodcutter"));
  remembers(world, "farmer", theft, "woodcutter", "theft");
  relate(world, "farmer", "zeus", 5);
  place(world, "farmer", "altar");
  const propose = (raw: Record<string, unknown>) => {
    const submitted = submitProposal({
      schemaVersion: 1,
      targets: [],
      expectedRevisions: [],
      source: "model",
      observationId: `obs-same-${String(raw.kind)}`,
      ...raw,
    });
    if (!submitted.ok) throw new Error(submitted.rejection.message);
    return submitted.proposal;
  };
  const pray = propose({
    actor: "farmer",
    kind: "pray",
    cause: theft.id,
    source: "routine",
  });
  const strike = propose({
    actor: "zeus",
    kind: "strike",
    target: "woodshed",
    power: 1,
  });
  const ran = runTick(
    world.state,
    world.prng,
    order === "prayer-first" ? [pray, strike] : [strike, pray],
  );
  world.state = ran.state;
  world.log.push(...ran.events);
  return { world, ran };
}

test("an answer counts only for a petition already heard: a strike sequenced before the prayer in the same tick does not answer it, and sends no sign", () => {
  const { world, ran } = prayerAndStrike("strike-first");
  expect(ran.rejected).toEqual([]);
  const kinds = ran.events.map((e) => e.kind);
  expect(kinds.indexOf("building-damaged")).toBeLessThan(
    kinds.indexOf("petition-opened"),
  );
  const opened = ofKind(ran.events, "petition-opened")[0] as Extract<
    WorldEvent,
    { kind: "petition-opened" }
  >;
  expect(String(opened.god)).toBe("zeus");
  expect(world.state.petitions.get(opened.id)?.status).toBe("open");
  expect(ofKind(ran.events, "petition-answered")).toEqual([]);
  expect(ofKind(ran.events, "worship-performed")).toEqual([]);
  expect(
    ofKind(ran.events, "memory-recorded").filter(
      (m) => m.memoryKind === "sign",
    ),
  ).toEqual([]);
});

test("control: the prayer sequenced before the strike in the same tick is answered by it, with a sign", () => {
  const { world, ran } = prayerAndStrike("prayer-first");
  const kinds = ran.events.map((e) => e.kind);
  expect(kinds.indexOf("petition-opened")).toBeLessThan(
    kinds.indexOf("building-damaged"),
  );
  const opened = ofKind(ran.events, "petition-opened")[0] as Extract<
    WorldEvent,
    { kind: "petition-opened" }
  >;
  expect(world.state.petitions.get(opened.id)?.status).toBe("answered");
  expect(ofKind(ran.events, "petition-answered")).toHaveLength(1);
  expect(
    ofKind(ran.events, "memory-recorded").filter(
      (m) => m.memoryKind === "sign",
    ),
  ).toHaveLength(1);
});

test("a petition opened at T with window W is still open after tick T+W unanswered, lapses on tick T+W+1, and an answer on T+W wins", () => {
  const W = (w: World) => petitionBalanceOf(w.state.rules, "answerWindowTicks");
  const build = () => {
    const world = new World();
    const opened = petition(world, "farmer", "zeus", theftBy("woodcutter"));
    return {
      world,
      opened,
      at: world.state.petitions.get(opened.id)?.tick ?? 0,
    };
  };
  // After tick T+W, unanswered: still open.
  const waiting = build();
  waiting.world.state = {
    ...waiting.world.state,
    tick: waiting.at + W(waiting.world) - 1,
  };
  const onLast = waiting.world.tick();
  expect(waiting.world.state.tick).toBe(waiting.at + W(waiting.world));
  expect(ofKind(onLast, "petition-lapsed")).toEqual([]);
  expect(waiting.world.state.petitions.get(waiting.opened.id)?.status).toBe(
    "open",
  );
  // The next tick, T+W+1, lapses it.
  const after = waiting.world.tick();
  expect(waiting.world.state.tick).toBe(waiting.at + W(waiting.world) + 1);
  expect(ofKind(after, "petition-lapsed")).toHaveLength(1);
  expect(waiting.world.state.petitions.get(waiting.opened.id)?.status).toBe(
    "lapsed",
  );
  // An answer on T+W wins, and nothing lapses it after.
  const answered = build();
  answered.world.state = {
    ...answered.world.state,
    tick: answered.at + W(answered.world) - 1,
  };
  const ran = godActs(answered.world, {
    actor: "zeus",
    kind: "strike",
    target: "woodshed",
    power: 1,
  });
  expect(answered.world.state.tick).toBe(answered.at + W(answered.world));
  expect(ofKind(ran.events, "petition-answered")).toHaveLength(1);
  expect(ofKind(ran.events, "petition-lapsed")).toEqual([]);
  expect(ofKind(answered.world.tick(), "petition-lapsed")).toEqual([]);
  expect(answered.world.state.petitions.get(answered.opened.id)?.status).toBe(
    "answered",
  );
});

test("a window that closes unanswered lapses the petition, and the petitioner's affinity toward that god falls, with a grudge", () => {
  const world = new World();
  const opened = petition(world, "farmer", "zeus", theftBy("woodcutter"));
  const openedAt = world.state.petitions.get(opened.id)?.tick ?? 0;
  const window = petitionBalanceOf(world.state.rules, "answerWindowTicks");
  // Nothing happens through the window's last tick, T+W; the tick after it, T+W+1, lapses it.
  world.state = { ...world.state, tick: openedAt + window - 1 };
  expect(ofKind(world.tick(), "petition-lapsed")).toEqual([]);
  expect(world.state.tick).toBe(openedAt + window);
  const lapse = world.tick();
  expect(world.state.tick).toBe(openedAt + window + 1);
  const lapsed = ofKind(lapse, "petition-lapsed");
  expect(lapsed).toHaveLength(1);
  expect(lapsed[0]).toMatchObject({
    entityId: "farmer",
    god: "zeus",
    petitionId: opened.id,
  });
  const sign = ofKind(lapse, "memory-recorded").find(
    (m) => m.memoryKind === "sign",
  );
  expect(sign).toMatchObject({
    outcome: "lapsed",
    god: "zeus",
    consequence: { effect: "harm", agent: "zeus", target: "farmer" },
  });
  expect(affinityOf(world, "farmer", "zeus")).toBe(-2);
  expect(
    world.state.relationships.get(relationshipKey(id("farmer"), id("zeus")))
      ?.grudge,
  ).toBe(1);
  // It lapses once.
  expect(ofKind(world.tick(), "petition-lapsed")).toEqual([]);
  // The god may still act on it afterwards: nothing answers a lapsed petition.
  const late = godActs(world, {
    actor: "zeus",
    kind: "strike",
    target: "woodshed",
    power: 1,
  });
  expect(ofKind(late.events, "petition-answered")).toEqual([]);
});

test("a dead petitioner's petition is marked answered and no sign is sent: no memory, no worship, no feeling", () => {
  const world = new World();
  const opened = petition(world, "farmer", "zeus", theftBy("woodcutter"));
  const farmer = getActor(world.state, id("farmer"));
  if (!farmer) throw new Error("farmer");
  world.state = withActor(world.state, { ...farmer, alive: false });
  const ran = godActs(world, {
    actor: "zeus",
    kind: "strike",
    target: "woodshed",
    power: 1,
  });
  expect(world.state.petitions.get(opened.id)?.status).toBe("answered");
  expect(ofKind(ran.events, "petition-answered")).toHaveLength(1);
  expect(ofKind(ran.events, "worship-performed")).toEqual([]);
  expect(
    ofKind(ran.events, "memory-recorded").filter(
      (m) => m.entityId === id("farmer"),
    ),
  ).toEqual([]);
  expect(affinityOf(world, "farmer", "zeus")).toBe(0);
});

test("the sign carries no knowledge of where or how the god answered", () => {
  const world = new World();
  petition(world, "farmer", "zeus", theftBy("woodcutter"));
  const ran = godActs(world, {
    actor: "zeus",
    kind: "strike",
    target: "woodshed",
    power: 1,
  });
  const sign = ofKind(ran.events, "memory-recorded").find(
    (m) => m.memoryKind === "sign",
  );
  const signEntry = world.state.memories
    .get(id("farmer"))
    ?.find((m) => m.kind === "sign");
  const text = JSON.stringify(signEntry);
  expect(sign).toBeDefined();
  expect(signEntry).toBeDefined();
  for (const secret of [
    "woodshed",
    "building-damaged",
    "strike",
    "square",
    "woodcutter",
  ]) {
    expect(text).not.toContain(secret);
  }
  // Control: the god's own memory of the strike does name it.
  expect(
    JSON.stringify(ran.events.filter((e) => e.kind === "building-damaged")),
  ).toContain("woodshed");
});

// --- Bless ------------------------------------------------------------------------------------

/** A world where the farmer owns a storehouse and the tavern, both damaged, and Hera stands with the farmer. */
function damagedFarm() {
  const base = pack();
  const state = createInitialWorldState({
    ...base,
    buildings: [
      ...base.buildings,
      {
        id: "storehouse",
        locationId: "square",
        name: "Storehouse",
        material: "wood",
        combustible: true,
        services: [],
        inventory: [],
        owner: "farmer",
      },
    ],
  });
  const world = new World(state);
  for (const [name] of [["the-tavern"], ["storehouse"]]) {
    const b = world.state.buildings.get(id(name as string));
    if (!b) throw new Error(name);
    world.state = {
      ...world.state,
      buildings: new Map(world.state.buildings).set(id(name as string), {
        ...b,
        status: "damaged",
      } as typeof b),
    };
  }
  return world;
}

test("Hera blesses the farmer for its storehouse: the farmer gets planks, Hera pays divinity, the petition is answered, and the storehouse stays damaged until the farmer repairs it", () => {
  const world = damagedFarm();
  const cause = {
    kind: "building-damaged",
    entityId: "storehouse",
    amount: 1,
    actor: "zeus",
  };
  const opened = petition(world, "farmer", "hera", cause);
  expect(world.state.petitions.get(opened.id)?.request).toEqual({
    kind: "help",
    need: { kind: "building", building: id("storehouse") },
  });
  place(world, "hera", "square");
  const divinity =
    getActor(world.state, id("hera"))?.inventory.get("divinity") ?? 0;

  const ran = godActs(world, {
    actor: "hera",
    kind: "bless",
    petition: opened.id,
    targets: ["farmer"],
  });
  expect(ran.rejected).toEqual([]);
  const cost = petitionBalanceOf(world.state.rules, "blessDivinityCost");
  const planks = petitionBalanceOf(world.state.rules, "blessPlanks");
  // The cost is paid; the farmer's worship in answer credits one back.
  const gain = world.state.rules.economyBalance.worshipCapacityGain ?? 1;
  expect(getActor(world.state, id("hera"))?.inventory.get("divinity")).toBe(
    divinity - cost + gain,
  );
  expect(getActor(world.state, id("farmer"))?.inventory.get("planks")).toBe(
    planks,
  );
  expect(ofKind(ran.events, "blessing-granted")[0]).toMatchObject({
    entityId: "hera",
    recipient: "farmer",
    petitionId: opened.id,
    resource: "planks",
    amount: planks,
    building: "storehouse",
  });
  expect(world.state.petitions.get(opened.id)?.status).toBe("answered");
  expect(world.state.buildings.get(id("storehouse"))?.status).toBe("damaged");
  expect(affinityOf(world, "farmer", "hera")).toBe(1);
  // The damage stays on record.
  expect(
    world.log.some(
      (e) => e.kind === "building-damaged" && e.entityId === id("storehouse"),
    ),
  ).toBe(true);
});

test("the farmer's repair routine spends blessed planks on the building the bless cited before any other it owns", () => {
  const world = damagedFarm();
  const opened = petition(world, "farmer", "hera", {
    kind: "building-damaged",
    entityId: "storehouse",
    amount: 1,
    actor: "zeus",
  });
  place(world, "hera", "square");
  godActs(world, {
    actor: "hera",
    kind: "bless",
    petition: opened.id,
    targets: ["farmer"],
  });
  // Both buildings are damaged and the tavern comes first in the owner's list; the storehouse was blessed.
  const decision = decideRoutineProposal(world.state, id("farmer"));
  expect(decision?.proposal).toMatchObject({
    kind: "repair",
    structure: "storehouse",
  });
  // Control: with no bless, the first damaged building is repaired first.
  const plain = damagedFarm();
  const farmer = getActor(plain.state, id("farmer"));
  if (!farmer) throw new Error("farmer");
  plain.state = withActor(plain.state, {
    ...farmer,
    inventory: new Map([
      ["planks", 3],
      ["food", 60],
    ]),
  });
  expect(
    decideRoutineProposal(plain.state, id("farmer"))?.proposal,
  ).toMatchObject({ kind: "repair", structure: "the-tavern" });
});

test("with two open help petitions from one mortal, a bless names one: it answers only that one and grants only its need", () => {
  const world = damagedFarm();
  const burn = petition(world, "farmer", "hera", {
    kind: "building-damaged",
    entityId: "storehouse",
    amount: 1,
    actor: "zeus",
  });
  world.state = { ...world.state, tick: world.state.tick + 25 };
  const hunger = petition(world, "farmer", "hera", {
    kind: "stock-spoiled",
    entityId: "farmer",
    resource: "food",
    amount: 1,
    cause: "director",
  });
  place(world, "hera", "square");
  const ran = godActs(world, {
    actor: "hera",
    kind: "bless",
    petition: hunger.id,
    targets: ["farmer"],
  });
  expect(ran.rejected).toEqual([]);
  expect(world.state.petitions.get(hunger.id)?.status).toBe("answered");
  expect(world.state.petitions.get(burn.id)?.status).toBe("open");
  const grant = ofKind(ran.events, "blessing-granted")[0];
  // The lost stock (one unit) is returned, not the standing amount.
  expect(grant).toMatchObject({ resource: "food", amount: 1 });
  expect(grant?.building).toBeUndefined();
  expect(
    getActor(world.state, id("farmer"))?.inventory.get("planks"),
  ).toBeUndefined();
});

test("a bless is refused when the god is not with the mortal, lacks the divinity, names a punish petition, another god's petition, or a dead petitioner's; with all in order it commits", () => {
  const world = damagedFarm();
  const opened = petition(world, "farmer", "hera", {
    kind: "building-damaged",
    entityId: "storehouse",
    amount: 1,
    actor: "zeus",
  });
  const reasons = (raw: Record<string, unknown>, from = world.state) => {
    const submitted = submitProposal({
      schemaVersion: 1,
      targets: [],
      expectedRevisions: [],
      source: "model",
      observationId: `obs-r-${Math.random()}`,
      ...raw,
    });
    if (!submitted.ok) throw new Error("fixture");
    return runTick(from, world.prng, [submitted.proposal]).rejected.map(
      (r) => r.reason,
    );
  };
  const bless = { actor: "hera", kind: "bless", petition: opened.id };
  // Hera is in the hall, the farmer in the square.
  expect(reasons(bless)).toEqual(["not-adjacent"]);
  place(world, "hera", "square");
  expect(reasons(bless)).toEqual([]);
  // Too little divinity.
  const hera = getActor(world.state, id("hera"));
  if (!hera) throw new Error("hera");
  expect(
    reasons(
      bless,
      withActor(world.state, {
        ...hera,
        inventory: new Map([["divinity", 1]]),
      }),
    ),
  ).toEqual(["insufficient-power"]);
  // Another god's petition.
  place(world, "zeus", "square");
  expect(reasons({ ...bless, actor: "zeus" })).toEqual(["malformed"]);
  // A punish petition is answered by a strike, not a bless.
  const punish = petition(
    world,
    "drifter",
    "hera",
    theftBy("woodcutter", "drifter"),
  );
  place(world, "drifter", "square");
  expect(reasons({ ...bless, petition: punish.id })).toEqual(["malformed"]);
  // A petition that does not exist, and one the god answered already.
  expect(reasons({ ...bless, petition: "evt-404" })).toEqual(["malformed"]);
  // A dead petitioner.
  const farmer = getActor(world.state, id("farmer"));
  if (!farmer) throw new Error("farmer");
  expect(
    reasons(bless, withActor(world.state, { ...farmer, alive: false })),
  ).toEqual(["dead-actor"]);
  // Only a god may bless.
  expect(reasons({ ...bless, actor: "farmer" })).toEqual([
    "unauthorized-claim",
  ]);
});

test("petitions, answers, lapses, signs, blessings, and affinity are reproduced by replaying the log from the start", () => {
  const world = damagedFarm();
  const burn = petition(world, "farmer", "hera", {
    kind: "building-damaged",
    entityId: "storehouse",
    amount: 1,
    actor: "zeus",
  });
  place(world, "hera", "square");
  godActs(world, {
    actor: "hera",
    kind: "bless",
    petition: burn.id,
    targets: ["farmer"],
  });
  petition(world, "drifter", "zeus", theftBy("woodcutter", "drifter"));
  const openedAt =
    [...world.state.petitions.values()].find(
      (p) => p.petitioner === id("drifter"),
    )?.tick ?? 0;
  world.state = {
    ...world.state,
    tick: openedAt + petitionBalanceOf(world.state.rules, "answerWindowTicks"),
  };
  world.tick();
  expect(
    [...world.state.petitions.values()].map((p) => p.status).sort(),
  ).toEqual(["answered", "lapsed"]);

  const replayed = applyEvents(
    world.initial,
    world.log.map((e, i) => ({ ...e, sequence: i + 1 })) as WorldEvent[],
  );
  expect([...replayed.petitions]).toEqual([...world.state.petitions]);
  expect([...replayed.memories]).toEqual([...world.state.memories]);
  expect([...replayed.relationships]).toEqual([...world.state.relationships]);
  expect([...replayed.repairGrants]).toEqual([...world.state.repairGrants]);
  const restored = decode(JSON.parse(JSON.stringify(encode(world.state))));
  expect([...restored.repairGrants]).toEqual([...world.state.repairGrants]);
  expect([...restored.memories]).toEqual([...world.state.memories]);
});

test("a bless for lost stock grants what was lost, up to the cap: a large loss is capped, a small one returned whole, and an unmet need gets the standing amount", () => {
  const cap = (w: World) =>
    petitionBalanceOf(w.state.rules, "blessResourceCap");
  const standing = (w: World) =>
    petitionBalanceOf(w.state.rules, "blessResourceAmount");
  const blessed = (lost: number) => {
    const world = new World();
    const opened = petition(world, "farmer", "hera", {
      kind: "stock-spoiled",
      entityId: "farmer",
      resource: "food",
      amount: lost,
      cause: "director",
    });
    expect(world.state.petitions.get(opened.id)?.request).toEqual({
      kind: "help",
      need: { kind: "resource", resource: "food", amount: lost },
    });
    place(world, "hera", "square");
    const before =
      getActor(world.state, id("farmer"))?.inventory.get("food") ?? 0;
    const ran = godActs(world, {
      actor: "hera",
      kind: "bless",
      petition: opened.id,
      targets: ["farmer"],
    });
    expect(ran.rejected).toEqual([]);
    return {
      granted:
        (getActor(world.state, id("farmer"))?.inventory.get("food") ?? 0) -
        before,
      cap: cap(world),
    };
  };
  const big = blessed(cap(new World()) + 7);
  expect(big.granted).toBe(big.cap);
  const small = blessed(1);
  expect(small.granted).toBe(1);

  // An unmet need names no amount: the standing blessing.
  const needy = new World();
  const farmer = getActor(needy.state, id("farmer"));
  if (!farmer) throw new Error("farmer");
  // The farmer wants planks and no one sells them: the scan records a real unmet need.
  needy.state = withActor(needy.state, { ...farmer, wants: "planks" });
  needy.until(() =>
    needy.petitions().some((p) => p.petitioner === id("farmer")),
  );
  const asked = needy.petitions().find((p) => p.petitioner === id("farmer"));
  expect(asked?.request).toEqual({
    kind: "help",
    need: { kind: "resource", resource: "planks" },
  });
  place(needy, "hera", "square");
  place(needy, "farmer", "square");
  const ran = godActs(needy, {
    actor: "hera",
    kind: "bless",
    petition: asked?.id as string,
    targets: ["farmer"],
  });
  expect(ran.rejected).toEqual([]);
  expect(getActor(needy.state, id("farmer"))?.inventory.get("planks")).toBe(
    standing(needy),
  );
});

// --- One open petition per resource or building ---------------------------------------------------

const foodSpoiled = (world: World, amount = 1) =>
  world.apply({
    kind: "stock-spoiled",
    entityId: "farmer",
    resource: "food",
    amount,
    cause: "director",
  });

test("a new food cause while the farmer's food petition is still open is not prayed about: no second prayer, however long it waits", () => {
  const world = new World();
  foodSpoiled(world);
  world.until(() => world.petitions().length > 0);
  const first = world.petitions()[0];
  expect(first?.status).toBe("open");
  // The food need reopens, and stock spoils again, inside the window: new causes, not prayed about.
  const again = foodSpoiled(world, 2);
  expect(
    prayableCauses(world.state, id("farmer")).some(
      (c) => c.eventId === again.id,
    ),
  ).toBe(false);
  const cooldown = petitionBalanceOf(world.state.rules, "prayerCooldownTicks");
  for (let n = 0; n < cooldown * 3; n += 1) world.tick();
  expect(
    world.petitions().filter((p) => p.petitioner === id("farmer")),
  ).toHaveLength(1);
  expect(world.petitions().find((p) => p.cause === again.id)).toBeUndefined();
});

test("once the food petition lapses, the next food cause leads to a prayer; the old cause does not", () => {
  const world = new World();
  const old = foodSpoiled(world);
  world.until(() => world.petitions().length > 0);
  const opened = world.petitions()[0];
  const window = petitionBalanceOf(world.state.rules, "answerWindowTicks");
  // Let it lapse, then a fresh food cause appears.
  world.state = { ...world.state, tick: (opened?.tick ?? 0) + window };
  world.tick();
  expect(world.petitions()[0]?.status).toBe("lapsed");
  const fresh = foodSpoiled(world, 3);
  world.until(() => world.petitions().some((p) => p.cause === fresh.id));
  expect(
    world.petitions().filter((p) => p.petitioner === id("farmer")),
  ).toHaveLength(2);
  expect(world.petitions().find((p) => p.cause === fresh.id)?.status).toBe(
    "open",
  );
  // One cause, one petition: the first cause is never prayed about again.
  expect(world.petitions().filter((p) => p.cause === old.id)).toHaveLength(1);
});

test("an answered food petition frees the next food cause too", () => {
  const world = new World();
  foodSpoiled(world);
  world.until(() => world.petitions().length > 0);
  const opened = world.petitions()[0];
  if (!opened) throw new Error("petition");
  world.state = {
    ...world.state,
    petitions: new Map(world.state.petitions).set(opened.id, {
      ...opened,
      status: "answered",
    }),
  };
  const next = foodSpoiled(world);
  world.state = {
    ...world.state,
    tick:
      world.state.tick +
      petitionBalanceOf(world.state.rules, "prayerCooldownTicks") +
      1,
  };
  expect(
    prayableCauses(world.state, id("farmer")).some(
      (c) => c.eventId === next.id,
    ),
  ).toBe(true);
});

test("a different resource is not blocked: an open food petition does not stop a prayer about stolen wood, nor one about a damaged building", () => {
  const world = new World();
  foodSpoiled(world);
  world.until(() => world.petitions().length > 0);
  const wood = world.apply({
    kind: "stock-spoiled",
    entityId: "farmer",
    resource: "wood",
    amount: 2,
    cause: "director",
  });
  const damaged = world.apply({
    kind: "building-damaged",
    entityId: "the-tavern",
    amount: 1,
    actor: "zeus",
  });
  remembers(world, "farmer", damaged, "zeus", "building-damaged");
  world.state = {
    ...world.state,
    tick:
      world.state.tick +
      petitionBalanceOf(world.state.rules, "prayerCooldownTicks") +
      1,
  };
  const ids = prayableCauses(world.state, id("farmer")).map((c) => c.eventId);
  expect(ids).toContain(wood.id);
  expect(ids).toContain(damaged.id);
});

test("a second damage to a building while a petition about it is open is not prayed about; after it closes, or for another building, it is", () => {
  const damage = (w: World, building = "the-tavern") => {
    const event = w.apply({
      kind: "building-damaged",
      entityId: building,
      amount: 1,
      actor: "zeus",
    });
    remembers(w, "farmer", event, "zeus", "building-damaged");
    return event;
  };
  const world = new World();
  const first = damage(world);
  world.until(() => world.petitions().some((p) => p.cause === first.id));
  const second = damage(world);
  world.state = {
    ...world.state,
    tick:
      world.state.tick +
      petitionBalanceOf(world.state.rules, "prayerCooldownTicks") +
      1,
  };
  expect(
    prayableCauses(world.state, id("farmer")).some(
      (c) => c.eventId === second.id,
    ),
  ).toBe(false);
  for (let n = 0; n < 60; n += 1) world.tick();
  expect(world.petitions().some((p) => p.cause === second.id)).toBe(false);
  // Another of the farmer's buildings is a different subject: the shop is not blocked.
  const other = world.apply({
    kind: "building-damaged",
    entityId: "woodshed",
    amount: 1,
    actor: "zeus",
  });
  expect(other.kind).toBe("building-damaged");
  // Control: once the petition is answered, a new damage to the tavern is prayable again.
  const open = world.petitions().find((p) => p.cause === first.id);
  if (!open) throw new Error("petition");
  world.state = {
    ...world.state,
    petitions: new Map(world.state.petitions).set(open.id, {
      ...open,
      status: "answered",
    }),
  };
  expect(
    prayableCauses(world.state, id("farmer")).some(
      (c) => c.eventId === second.id,
    ),
  ).toBe(true);
});

test("another mortal's open petition about food does not block the farmer's", () => {
  const world = new World();
  world.apply({
    kind: "stock-spoiled",
    entityId: "woodcutter",
    resource: "food",
    amount: 1,
    cause: "director",
  });
  world.until(() =>
    world.petitions().some((p) => p.petitioner === id("woodcutter")),
  );
  const mine = foodSpoiled(world);
  world.state = { ...world.state, tick: world.state.tick + 1 };
  expect(
    prayableCauses(world.state, id("farmer")).some(
      (c) => c.eventId === mine.id,
    ),
  ).toBe(true);
});

test("a forgotten cause still blocks a second petition about the same loss: the open punish petition holds its subject after eight newer causes push its own out of memory", () => {
  const world = new World();
  const first = petition(world, "farmer", "zeus", theftBy("woodcutter"));
  expect(world.state.petitions.get(first.id)?.request.kind).toBe("punish");
  // Eight grudge causes push the theft out of the farmer's bounded cause history.
  for (let n = 0; n < 8; n += 1) {
    world.apply({
      kind: "relationship-changed",
      entityId: "farmer",
      toward: "drifter",
      affinityDelta: -1,
      grudgeDelta: 1,
      memoryEventId: `evt-0-m${n}`,
    });
  }
  expect(
    (world.state.causes.get(id("farmer")) ?? []).some(
      (c) => c.eventId === first.cause,
    ),
  ).toBe(false);
  // The prayer cooldown passes; a second loss of the same resource follows.
  world.state = {
    ...world.state,
    tick:
      (world.state.petitions.get(first.id)?.tick ?? 0) +
      petitionBalanceOf(world.state.rules, "prayerCooldownTicks") +
      1,
  };
  const second = world.apply(theftBy("drifter"));
  const prayable = () =>
    prayableCauses(world.state, id("farmer")).some(
      (c) => c.eventId === second.id,
    );
  expect(world.state.petitions.get(first.id)?.status).toBe("open");
  expect(prayable()).toBe(false);
  // Control: once the first petition closes, the same loss can be prayed about.
  const open = world.state.petitions.get(first.id);
  if (!open) throw new Error("petition");
  world.state = {
    ...world.state,
    petitions: new Map(world.state.petitions).set(first.id, {
      ...open,
      status: "answered",
    }),
  };
  expect(prayable()).toBe(true);
});

// --- Patrons: who a prayer goes to ---------------------------------------------------------------

/** The petition pack with every mortal devoted to Hera (the patron), and a table sending fire and spoilage to Zeus. */
function patronWorld(
  troubleKinds: Record<string, string> | null = {
    fire: "zeus",
    spoilage: "zeus",
  },
) {
  const base = pack();
  return new World(
    createInitialWorldState({
      ...base,
      inhabitants: base.inhabitants.map((inhabitant) =>
        "drives" in inhabitant
          ? { ...inhabitant, devotion: { god: "hera", affinity: 1 } }
          : inhabitant,
      ),
      rules: {
        ...base.rules,
        ...(troubleKinds === null ? {} : { troubleKinds }),
      },
    }),
  );
}

test("a need prayer, hunger included, goes to the patron even when another god has a higher affinity plus standing", () => {
  const world = patronWorld();
  expect(patronOf(world.state, id("farmer"))).toBe(id("hera"));
  // Zeus is felt more (8 to 1) and stands for more at the farmer's home (5).
  const feeling = world.state.relationships;
  world.state = {
    ...world.state,
    relationships: new Map(feeling).set(
      relationshipKey(id("farmer"), id("zeus")),
      {
        from: id("farmer"),
        toward: id("zeus"),
        affinity: 8,
        grudge: 0,
        allied: false,
      },
    ),
    standing: new Map([[id("zeus"), new Map([[id("square"), 5]])]]),
  };
  const hungry = world.apply({
    kind: "unmet-need",
    entityId: "farmer",
    resource: "food",
    reason: "no-seller",
  });
  place(world, "farmer", "altar");
  const asked = petitionFor(world.state, id("farmer"), hungry.id);
  expect(asked?.god).toBe(id("hera"));
  expect(asked?.request).toMatchObject({ kind: "help" });

  // Control: the same world with no patron prays to the god it weighs most, Zeus.
  const unpatroned = { ...world.state, patrons: new Map() };
  expect(petitionFor(unpatroned, id("farmer"), hungry.id)?.god).toBe(
    id("zeus"),
  );
});

test("a trouble in a god's domain goes to the table's god, not the patron; a trouble the table lacks, a harm by a god, a need, and a dead domain god go to the patron", () => {
  const world = patronWorld();
  const cause = (kind: string, extra: Record<string, unknown> = {}) => ({
    eventId: `evt-0-${kind}` as EventId,
    tick: 0,
    kind: kind as never,
    ...extra,
  });
  const to = (c: ReturnType<typeof cause>, state = world.state) =>
    String(routePetition(state, id("farmer"), c));
  // Fire and spoilage are in the table: Zeus's domain here.
  expect(to(cause("fire", { building: "the-tavern" }))).toBe("zeus");
  expect(to(cause("spoilage", { resource: "food", amount: 2 }))).toBe("zeus");
  // The table has no theft, so a director's theft goes to the patron.
  expect(to(cause("theft", { resource: "food", amount: 1 }))).toBe("hera");
  // A fire a god's strike started is a harm by that god: the patron's, even where the table names the god.
  expect(to(cause("fire", { building: "the-tavern", offender: "zeus" }))).toBe(
    "hera",
  );
  // Needs and grudges are the patron's whatever the table says.
  expect(to(cause("need", { resource: "food" }))).toBe("hera");
  expect(to(cause("grudge", { offender: "drifter" }))).toBe("hera");
  // A domain god that is gone leaves the patron to hear it.
  const zeus = getActor(world.state, id("zeus"));
  if (!zeus) throw new Error("zeus");
  const without = withActor(world.state, { ...zeus, alive: false });
  expect(to(cause("fire", { building: "the-tavern" }), without)).toBe("hera");
  // No table at all: everything is the patron's.
  const bare = patronWorld(null);
  expect(
    String(
      routePetition(bare.state, id("farmer"), cause("fire", { building: "x" })),
    ),
  ).toBe("hera");
});

test("end to end: a mortal's spoiled stock is prayed about to the domain god, not its patron, by its own routine", () => {
  const world = patronWorld();
  const spoiled = world.apply({
    kind: "stock-spoiled",
    entityId: "farmer",
    resource: "food",
    amount: 2,
    cause: "director",
  });
  world.until(() => world.petitions().length > 0);
  const [first] = world.petitions();
  expect(first).toMatchObject({
    petitioner: "farmer",
    cause: spoiled.id,
    god: "zeus",
  });
});

test("the patron survives encode and decode and is unchanged by any prayer, answer, or lapse", () => {
  const world = patronWorld();
  world.apply({
    kind: "unmet-need",
    entityId: "farmer",
    resource: "food",
    reason: "no-seller",
  });
  world.until(() => world.petitions().length > 0);
  world.until(() => world.petitions().every((p) => p.status !== "open"), 400);
  expect(world.petitions().every((p) => p.status === "lapsed")).toBe(true);
  expect(world.state.patrons).toEqual(world.initial.patrons);
  const decoded = decode(JSON.parse(JSON.stringify(encode(world.state))));
  expect(decoded.patrons).toEqual(world.initial.patrons);
  expect(decoded).toEqual(world.state);
});

// --- Punishing a mortal, and harm as a cause between gods -----------------------------------------

/**
 * Two gods in a hall that reaches the altar, and mortals at the square, each with a patron:
 * Lykos (a trader with goods, Hermes's), Doris and Ismene (Poseidon's), and Phaon (Hermes's, empty-handed).
 */
function quarrel(
  balance: { strikeGoodsCap?: number } = {},
  lykosGoods: { resource: string; amount: number }[] = [
    { resource: "food", amount: 5 },
    { resource: "currency", amount: 30 },
  ],
) {
  const base = pack();
  const mortal = (name: string, god: string, goods: typeof lykosGoods) => ({
    ...calm(name, "square", goods),
    devotion: { god, affinity: 1 },
  });
  const god = (name: string) => ({
    id: name,
    name,
    locationId: "hall",
    deity: true as const,
    startingInventory: [{ resource: "divinity", amount: 10 }],
  });
  const content: ContentPack = {
    ...base,
    locations: base.locations.map((location) =>
      location.id === "hall"
        ? {
            ...location,
            edges: [
              {
                to: "altar",
                transport: "divine-transport" as const,
                bidirectional: true,
              },
            ],
          }
        : location,
    ),
    buildings: [],
    inhabitants: [
      god("poseidon"),
      god("hermes"),
      god("zeus"),
      mortal("lykos", "hermes", lykosGoods),
      mortal("doris", "poseidon", [{ resource: "food", amount: 9 }]),
      mortal("ismene", "poseidon", [{ resource: "food", amount: 9 }]),
      mortal("phaon", "hermes", []),
    ],
    rules: {
      ...base.rules,
      economyBalance: {
        ...base.rules.economyBalance,
        value_food: 3,
        value_currency: 1,
        value_planks: 2,
      },
      petitionBalance: balance,
    },
  };
  return new World(createInitialWorldState(content), [
    "lykos",
    "doris",
    "ismene",
    "phaon",
  ]);
}

/** `mortal` holds a grudge against `offender`: a cause it can pray about, with the offender named. */
function grudges(world: World, mortal: string, offender: string) {
  return world.apply({
    kind: "relationship-changed",
    entityId: mortal,
    toward: offender,
    affinityDelta: -2,
    grudgeDelta: 1,
    memoryEventId: "evt-0-fixture-memory",
  });
}

const opened = (world: World, petitioner: string) =>
  world.petitions().find((p) => p.petitioner === id(petitioner));

test("the chain: a mortal's patron punishes its wrongdoer with no building, the struck mortal loses goods, remembers the god, prays to its own patron naming it, and that patron's demand against the god citing the prayer validates", () => {
  const world = quarrel();
  const wrong = grudges(world, "doris", "lykos");
  // Lykos owns no building, and Doris can still ask her patron to punish him.
  world.until(() => opened(world, "doris") !== undefined);
  const prayer = opened(world, "doris");
  expect(prayer).toMatchObject({
    god: "poseidon",
    cause: wrong.id,
    request: { kind: "punish", offender: "lykos", buildings: [] },
  });

  // Control: Hermes has no cause yet, so a demand against Poseidon is refused.
  const early = godActs(world, {
    actor: "hermes",
    kind: "practice",
    move: "demand",
    counterparty: "poseidon",
    cause: wrong.id,
    term: {
      kind: "be-at",
      party: "poseidon",
      place: "altar",
      deadlineTicks: 50,
    },
  });
  expect(early.rejected.map((r) => r.reason)).toEqual(["unauthorized-claim"]);

  // Poseidon strikes Lykos: the world takes his most valuable carried good, up to the cap.
  const heldBefore = world.state.actors.get(id("lykos"))?.inventory.get("food");
  const struck = godActs(world, {
    actor: "poseidon",
    kind: "strike",
    target: "lykos",
    power: 1,
  });
  expect(struck.rejected).toEqual([]);
  const harm = ofKind(struck.events, "mortal-struck")[0];
  expect(harm).toMatchObject({
    entityId: "lykos",
    actor: "poseidon",
    resource: "food",
    amount: 2,
  });
  expect(world.state.actors.get(id("lykos"))?.inventory.get("food")).toBe(
    (heldBefore ?? 0) - 2,
  );
  expect(world.state.petitions.get(prayer?.id as EventId)?.status).toBe(
    "answered",
  );
  expect(world.state.memories.get(id("lykos"))).toContainEqual(
    expect.objectContaining({
      kind: "witnessed",
      sourceEventId: harm?.id,
      consequence: { effect: "harm", agent: "poseidon", target: "lykos" },
    }),
  );

  // Lykos prays to his own patron, Hermes, about the harm, and names Poseidon.
  world.until(() => opened(world, "lykos") !== undefined);
  const heard = opened(world, "lykos");
  expect(heard).toMatchObject({
    god: "hermes",
    cause: harm?.id,
    about: { kind: "harm", offender: "poseidon" },
  });

  // Hermes's demand against Poseidon, citing that prayer's cause, validates.
  const demanded = godActs(world, {
    actor: "hermes",
    kind: "practice",
    move: "demand",
    counterparty: "poseidon",
    cause: heard?.cause,
    term: {
      kind: "be-at",
      party: "poseidon",
      place: "altar",
      deadlineTicks: 50,
    },
  });
  expect(demanded.rejected).toEqual([]);
  expect(ofKind(demanded.events, "practice-opened")[0]).toMatchObject({
    entityId: "hermes",
    counterparty: "poseidon",
    causes: [heard?.cause],
  });
});

/** One tick of a god's strike on `target`, returning what it committed. */
function strikes(world: World, god: string, target: string, power = 1) {
  const ran = godActs(world, { actor: god, kind: "strike", target, power });
  expect(ran.rejected).toEqual([]);
  return ofKind(ran.events, "mortal-struck")[0] as Extract<
    WorldEvent,
    { kind: "mortal-struck" }
  >;
}

test("a strike on a mortal takes its most valuable carried good (by value per unit, then how much it holds, then name), up to the cap, and the divinity is spent", () => {
  const taken = (
    goods: { resource: string; amount: number }[],
    cap?: number,
  ) => {
    const world = quarrel(
      cap === undefined ? {} : { strikeGoodsCap: cap },
      goods,
    );
    const strike = strikes(world, "poseidon", "lykos", 2);
    const left = world.state.actors.get(id("lykos"));
    // What it lost is exactly what the event says, and nothing else changed.
    for (const { resource, amount } of goods) {
      expect(left?.inventory.get(resource) ?? 0).toBe(
        amount - (resource === strike.resource ? strike.amount : 0),
      );
    }
    expect(
      world.state.actors.get(id("poseidon"))?.inventory.get("divinity"),
    ).toBe(8);
    return [strike.resource, strike.amount];
  };
  const mixed = [
    { resource: "currency", amount: 30 },
    { resource: "food", amount: 5 },
  ];
  // Food is worth 3 a unit and currency 1: food, though 5 units against 30 coins, up to the cap of 2.
  expect(taken(mixed)).toEqual(["food", 2]);
  // The cap's boundaries: one unit, exactly what it holds, and far more than it holds.
  expect(taken(mixed, 1)).toEqual(["food", 1]);
  expect(taken(mixed, 5)).toEqual(["food", 5]);
  expect(taken(mixed, 99)).toEqual(["food", 5]);
  // Fewer units of a dearer good still win; and holding less than the cap takes what there is.
  expect(
    taken([
      { resource: "currency", amount: 30 },
      { resource: "planks", amount: 1 },
    ]),
  ).toEqual(["planks", 1]);
  // Equal value: the larger holding; equal holding: the name that sorts first.
  expect(
    taken([
      { resource: "currency", amount: 3 },
      { resource: "stone", amount: 7 },
    ]),
  ).toEqual(["stone", 2]);
  expect(
    taken([
      { resource: "stone", amount: 4 },
      { resource: "clay", amount: 4 },
    ]),
  ).toEqual(["clay", 2]);
});

test("a strike on a mortal carrying nothing still lands: a harm credited to the god with nothing taken, which the mortal still prays about, naming the god", () => {
  const world = quarrel();
  const harm = strikes(world, "poseidon", "phaon");
  expect(harm).toMatchObject({
    entityId: "phaon",
    actor: "poseidon",
    amount: 0,
  });
  expect("resource" in harm).toBe(false);
  expect(world.state.actors.get(id("phaon"))?.inventory.size).toBe(0);
  // The cause is the harm, with its agent, and it asks the patron to make the god answer for it.
  const [cause] = prayableCauses(world.state, id("phaon"));
  expect(cause).toMatchObject({
    eventId: harm.id,
    kind: "harm",
    offender: "poseidon",
  });
  world.until(() => opened(world, "phaon") !== undefined);
  expect(opened(world, "phaon")).toMatchObject({
    god: "hermes",
    cause: harm.id,
    about: { kind: "harm", offender: "poseidon" },
    request: { kind: "punish", offender: "poseidon", buildings: [] },
  });
  // It remembers who did it: the memory names the god, with no goods in it.
  expect(world.state.memories.get(id("phaon"))).toContainEqual(
    expect.objectContaining({
      sourceEventId: harm.id,
      consequence: { effect: "harm", agent: "poseidon", target: "phaon" },
    }),
  );
  // The event round-trips through the codec like any other.
  expect(decode(JSON.parse(JSON.stringify(encode(world.state))))).toEqual(
    world.state,
  );
});

test("a strike on a god, on a dead mortal, on no one, or by a mortal is refused, and a struck mortal's own goods are all the world takes", () => {
  const world = quarrel();
  const refused = (raw: Record<string, unknown>) =>
    godActs(world, raw).rejected.map((r) => r.reason);
  expect(
    refused({ actor: "poseidon", kind: "strike", target: "hermes", power: 1 }),
  ).toEqual(["unauthorized-claim"]);
  expect(
    refused({ actor: "poseidon", kind: "strike", target: "nobody", power: 1 }),
  ).toEqual(["malformed"]);
  expect(
    refused({ actor: "doris", kind: "strike", target: "lykos", power: 1 }),
  ).toEqual(["unauthorized-claim"]);
  const lykos = getActor(world.state, id("lykos"));
  if (!lykos) throw new Error("lykos");
  world.state = withActor(world.state, { ...lykos, alive: false });
  expect(
    refused({ actor: "poseidon", kind: "strike", target: "lykos", power: 1 }),
  ).toEqual(["dead-actor"]);
  // Too little divinity is still refused.
  const poor = getActor(world.state, id("poseidon"));
  if (!poor) throw new Error("poseidon");
  world.state = withActor(world.state, {
    ...poor,
    inventory: new Map([["divinity", 0]]),
  });
  expect(
    refused({ actor: "poseidon", kind: "strike", target: "ismene", power: 1 }),
  ).toEqual(["insufficient-power"]);
});

test("a punished mortal with a newer open need prays about the harm first, and a need still leads an older grudge", () => {
  const world = quarrel();
  const harm = strikes(world, "poseidon", "lykos");
  // The need is newer than the harm: newest-first alone would pray about it first.
  world.state = { ...world.state, tick: world.state.tick + 5 };
  const need = world.apply({
    kind: "unmet-need",
    entityId: "lykos",
    resource: "currency",
    reason: "no-funds",
  });
  const order = prayableCauses(world.state, id("lykos"));
  expect(order.map((c) => c.eventId)).toEqual([harm.id, need.id]);
  world.until(() => opened(world, "lykos") !== undefined);
  expect(opened(world, "lykos")).toMatchObject({
    cause: harm.id,
    god: "hermes",
  });

  // Control: an older grudge does not outrank a newer need; only a god's harm does.
  const control = quarrel();
  const grudge = grudges(control, "lykos", "doris");
  control.state = { ...control.state, tick: control.state.tick + 5 };
  const newer = control.apply({
    kind: "unmet-need",
    entityId: "lykos",
    resource: "currency",
    reason: "no-funds",
  });
  expect(
    prayableCauses(control.state, id("lykos")).map((c) => c.eventId),
  ).toEqual([newer.id, grudge.id]);
});

test("when the punished mortal and the one who prayed share a patron, the punishment leaves no cross-god cause: no other god can cite it, and the patron cannot demand against itself", () => {
  const world = quarrel();
  // Ismene, Poseidon's, is struck by Poseidon at the prayer of Doris, also Poseidon's.
  grudges(world, "doris", "ismene");
  world.until(() => opened(world, "doris") !== undefined);
  const harm = strikes(world, "poseidon", "ismene");
  world.until(() => opened(world, "ismene") !== undefined);
  const prayer = opened(world, "ismene");
  expect(prayer).toMatchObject({
    god: "poseidon",
    cause: harm.id,
    about: { kind: "harm", offender: "poseidon" },
  });
  const demand = (actor: string, counterparty: string) =>
    godActs(world, {
      actor,
      kind: "practice",
      move: "demand",
      counterparty,
      cause: harm.id,
      term: {
        kind: "be-at",
        party: counterparty,
        place: "altar",
        deadlineTicks: 50,
      },
    }).rejected;
  // Poseidon knows the cause (it was prayed to him) but may not demand of himself.
  const self = demand("poseidon", "poseidon");
  expect(self.map((r) => r.reason)).toEqual(["malformed"]);
  expect(self[0]?.message).toContain("itself");
  // Neither Hermes nor Zeus was told anything, so neither can cite it.
  for (const other of ["hermes", "zeus"]) {
    expect(demand(other, "poseidon").map((r) => r.reason)).toEqual([
      "unauthorized-claim",
    ]);
    expect(
      world.state.memories
        .get(id(other))
        ?.some((m) => m.sourceEventId === harm.id) ?? false,
    ).toBe(false);
  }
});

test("only the harmed mortal's patron, told by its prayer, can cite a punishment: before the prayer no other god knows it, and a god not addressed never does", () => {
  const world = quarrel();
  const harm = strikes(world, "poseidon", "lykos");
  const cite = (actor: string) =>
    godActs(world, {
      actor,
      kind: "practice",
      move: "demand",
      counterparty: "poseidon",
      cause: harm.id,
      term: {
        kind: "be-at",
        party: "poseidon",
        place: "altar",
        deadlineTicks: 50,
      },
    }).rejected.map((r) => r.reason);
  for (const god of ["hermes", "zeus"]) {
    expect(cite(god)).toEqual(["unauthorized-claim"]);
    expect(world.state.memories.get(id(god)) ?? []).toEqual([]);
  }
  world.until(() => opened(world, "lykos") !== undefined);
  // Hermes was prayed to, and now may; Zeus, never addressed, still may not.
  expect(cite("zeus")).toEqual(["unauthorized-claim"]);
  expect(cite("hermes")).toEqual([]);
});

// --- Refusing a prayer ----------------------------------------------------------------------------

/** The `relationship-changed` events a memory caused. */
const feelingFrom = (
  log: readonly WorldEvent[],
  memory: WorldEvent | undefined,
) =>
  ofKind(log, "relationship-changed").filter(
    (e) => e.memoryEventId === memory?.id,
  );

test("a refused prayer closes it, costs the god the petitioner's affinity by exactly what a lapse costs, and records a sign memory; the petition never lapses", () => {
  const prayed = () => {
    const world = quarrel();
    grudges(world, "doris", "lykos");
    world.until(() => opened(world, "doris") !== undefined);
    return world;
  };
  const refusal = prayed();
  const prayer = opened(refusal, "doris");
  const ran = godActs(refusal, {
    actor: "poseidon",
    kind: "refuse",
    petition: prayer?.id,
  });
  expect(ran.rejected).toEqual([]);
  expect(ofKind(ran.events, "petition-refused")).toMatchObject([
    { entityId: "poseidon", petitioner: "doris", petitionId: prayer?.id },
  ]);
  expect(refusal.state.petitions.get(prayer?.id as EventId)?.status).toBe(
    "refused",
  );
  const sign = ofKind(refusal.log, "memory-recorded").find(
    (m) => m.memoryKind === "sign" && m.petitionId === prayer?.id,
  );
  expect(sign).toMatchObject({
    entityId: "doris",
    god: "poseidon",
    outcome: "refused",
    consequence: { effect: "harm", agent: "poseidon", target: "doris" },
  });
  const refused = feelingFrom(refusal.log, sign);

  // The same prayer left to lapse costs exactly the same.
  const lapse = prayed();
  const lapsed = opened(lapse, "doris");
  lapse.state = {
    ...lapse.state,
    tick:
      (lapsed?.tick ?? 0) +
      petitionBalanceOf(lapse.state.rules, "answerWindowTicks"),
  };
  lapse.tick();
  const lapseSign = ofKind(lapse.log, "memory-recorded").find(
    (m) => m.memoryKind === "sign" && m.petitionId === lapsed?.id,
  );
  expect(lapseSign).toMatchObject({ outcome: "lapsed" });
  const lapsedFeeling = feelingFrom(lapse.log, lapseSign);
  expect(refused).toHaveLength(1);
  expect(refused[0]).toMatchObject({
    entityId: "doris",
    toward: "poseidon",
    affinityDelta: -2,
    grudgeDelta: 1,
  });
  expect(
    lapsedFeeling.map(({ affinityDelta, grudgeDelta }) => [
      affinityDelta,
      grudgeDelta,
    ]),
  ).toEqual(
    refused.map(({ affinityDelta, grudgeDelta }) => [
      affinityDelta,
      grudgeDelta,
    ]),
  );

  // Refused is final: no later lapse, and the window running out changes nothing.
  refusal.state = {
    ...refusal.state,
    tick:
      (prayer?.tick ?? 0) +
      petitionBalanceOf(refusal.state.rules, "answerWindowTicks") +
      5,
  };
  refusal.tick();
  expect(
    ofKind(refusal.log, "petition-lapsed").map((e) => e.petitionId),
  ).not.toContain(prayer?.id);
  // And the event and the closed petition round-trip through the codec.
  expect(decode(JSON.parse(JSON.stringify(encode(refusal.state))))).toEqual(
    refusal.state,
  );
});

test("a refusal is judged like a bless: only a god, only a petition addressed to it that is open and inside its window, and not for a petitioner who has died", () => {
  const world = quarrel();
  grudges(world, "doris", "lykos");
  world.until(() => opened(world, "doris") !== undefined);
  const prayer = opened(world, "doris");
  const refuse = (actor: string) =>
    godActs(world, {
      actor,
      kind: "refuse",
      petition: prayer?.id,
    }).rejected.map((r) => r.reason);
  // A mortal cannot refuse; another god cannot refuse a prayer not made to it.
  expect(refuse("lykos")).toEqual(["unauthorized-claim"]);
  expect(refuse("hermes")).toEqual(["malformed"]);
  // An unknown petition, and a petition no longer open.
  expect(
    godActs(world, {
      actor: "poseidon",
      kind: "refuse",
      petition: "evt-9-9",
    }).rejected.map((r) => r.reason),
  ).toEqual(["malformed"]);
  const doris = getActor(world.state, id("doris"));
  if (!doris) throw new Error("doris");
  world.state = withActor(world.state, { ...doris, alive: false });
  expect(refuse("poseidon")).toEqual(["dead-actor"]);
  world.state = withActor(world.state, doris);
  expect(refuse("poseidon")).toEqual([]);
  expect(refuse("poseidon")).toEqual(["malformed"]);
  // Outside the answer window it is refused too.
  const late = quarrel();
  grudges(late, "doris", "lykos");
  late.until(() => opened(late, "doris") !== undefined);
  const stale = opened(late, "doris");
  late.state = {
    ...late.state,
    tick:
      (stale?.tick ?? 0) +
      petitionBalanceOf(late.state.rules, "answerWindowTicks") +
      1,
  };
  expect(
    godActs(late, {
      actor: "poseidon",
      kind: "refuse",
      petition: stale?.id,
    }).rejected.map((r) => r.reason),
  ).toEqual(["malformed"]);
});

test("the struck mortal always knows who struck it, whatever the strike's salience: at 0 it forms no memory and no feeling but still prays naming the god; at 1 it forms a memory; both survive the codec", () => {
  const withSalience = (salience: number) => {
    const world = quarrel();
    world.state = {
      ...world.state,
      rules: {
        ...world.state.rules,
        memoryBalance: { "salience_mortal-struck": salience },
      },
    };
    const harm = strikes(world, "poseidon", "lykos");
    return { world, harm };
  };
  const forgotten = withSalience(0);
  expect(
    forgotten.world.state.memories
      .get(id("lykos"))
      ?.some((m) => m.sourceEventId === forgotten.harm.id) ?? false,
  ).toBe(false);
  expect(
    forgotten.world.state.relationships.get(
      relationshipKey(id("lykos"), id("poseidon")),
    ),
  ).toBeUndefined();
  forgotten.world.until(() => opened(forgotten.world, "lykos") !== undefined);
  expect(opened(forgotten.world, "lykos")).toMatchObject({
    god: "hermes",
    about: { kind: "harm", offender: "poseidon" },
  });
  expect(
    decode(JSON.parse(JSON.stringify(encode(forgotten.world.state)))),
  ).toEqual(forgotten.world.state);

  // Control: at the smallest positive salience it is remembered, and the memory moves its feeling.
  const remembered = withSalience(1);
  expect(
    remembered.world.state.memories
      .get(id("lykos"))
      ?.find((m) => m.sourceEventId === remembered.harm.id),
  ).toMatchObject({ salience: 1 });
  expect(
    remembered.world.state.relationships.get(
      relationshipKey(id("lykos"), id("poseidon")),
    ),
  ).toMatchObject({ grudge: 1 });
  expect(
    decode(JSON.parse(JSON.stringify(encode(remembered.world.state)))),
  ).toEqual(remembered.world.state);
});
