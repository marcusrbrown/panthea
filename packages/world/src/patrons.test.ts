// Defection: a neglected mortal takes the god that last answered it, the two gods alone remember it, and the
// god lost may contest the mortal's home. Everything runs on world ticks: no clock, no timers.

import { expect, test } from "bun:test";
import type { ContentPack, EventId, WorldEvent } from "@panthea/contracts";
import { applyEvent, applyEvents, runTick, submitProposal } from "./actions";
import { decode, encode } from "./codec";
import { getMemories, getRelationship } from "./memory";
import { petitionBalanceOf } from "./petitions";
import { decideRoutineProposal } from "./routines";
import {
  createInitialWorldState,
  createPrng,
  getActor,
  type PrngState,
  relationshipKey,
  standingOf,
  toEntityId,
  type WorldState,
  withActor,
} from "./state";

const id = toEntityId;

/** A dock and an altar, four gods in a hall that reaches the altar, and mortals at the dock: no rivalries anywhere. */
function content(
  options: {
    affinity?: number;
    petitionBalance?: Record<string, number>;
    contestWindowTicks?: number;
    memoryBalance?: Record<string, number>;
    mortals?: readonly [string, string][];
  } = {},
): ContentPack {
  const god = (name: string) => ({
    id: name,
    sprite: `placeholder-${name}`,
    name,
    locationId: "hall",
    deity: true as const,
    startingInventory: [{ resource: "divinity", amount: 20 }],
  });
  const mortal = (name: string, patron: string) => ({
    id: name,
    sprite: `placeholder-${name}`,
    name,
    locationId: "dock",
    drives: { thrift: 0, appetite: 0, greed: 0, piety: 0 },
    startingInventory: [{ resource: "food", amount: 60 }],
    devotion: { god: patron, affinity: options.affinity ?? 3 },
  });
  return {
    schemaVersion: 1,
    realms: ["mortal", "olympus"],
    resources: [],
    locations: [
      {
        id: "dock",
        realm: "mortal",
        name: "Dock",
        edges: [{ to: "altar", transport: "path", bidirectional: true }],
      },
      { id: "altar", realm: "mortal", name: "Altar", edges: [] },
      {
        id: "hall",
        realm: "olympus",
        name: "Hall",
        edges: [
          { to: "altar", transport: "divine-transport", bidirectional: true },
        ],
      },
    ],
    buildings: [],
    inhabitants: [
      god("poseidon"),
      god("athena"),
      god("hermes"),
      god("zeus"),
      ...(options.mortals ?? [["fisher", "poseidon"]]).map(([name, patron]) =>
        mortal(name, patron),
      ),
      { ...mortal("drifter", "hermes"), drives: undefined },
    ],
    rules: {
      catchUpCapMs: 0,
      catchUpChunkMs: 0,
      checkpointIntervalMs: 0,
      maxProposalsPerTick: 100,
      fireBalance: {},
      economyBalance: { consumeAmount: 1, value_food: 3 },
      petitionBalance: {
        directorIntervalTicks: 100000,
        ...options.petitionBalance,
      },
      practiceBalance: { contestWindowTicks: options.contestWindowTicks ?? 10 },
      ...(options.memoryBalance === undefined
        ? {}
        : { memoryBalance: options.memoryBalance }),
      troubleKinds: { spoilage: "athena" },
    },
    recipes: {},
  } as ContentPack;
}

class Flock {
  state: WorldState;
  prng: PrngState = createPrng(1);
  readonly log: WorldEvent[] = [];
  readonly initial: WorldState;
  constructor(
    options: Parameters<typeof content>[0] = {},
    private readonly routines: readonly string[] = ["fisher"],
  ) {
    this.state = createInitialWorldState(content(options));
    this.initial = this.state;
  }
  tick(...extra: Record<string, unknown>[]) {
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
      ...this.routines.flatMap((mortal) => {
        const decision = decideRoutineProposal(this.state, id(mortal));
        return decision ? [decision.proposal] : [];
      }),
    ];
    const ran = runTick(this.state, this.prng, proposals);
    this.state = ran.state;
    this.prng = ran.prng;
    this.log.push(...ran.events);
    return ran;
  }
  until(done: () => boolean, limit = 400) {
    for (let n = 0; n < limit && !done(); n += 1) this.tick();
    expect(done()).toBe(true);
  }
  /** Commits a fixture event as the world would have, so a cause exists. */
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
  /** A god's proposal alone for one tick (no routine moves). */
  act(raw: Record<string, unknown>) {
    const submitted = submitProposal({
      schemaVersion: 1,
      targets: [],
      expectedRevisions: [],
      source: "model",
      observationId: `obs-god-${this.log.length}`,
      ...raw,
    });
    if (!submitted.ok) throw new Error(submitted.rejection.message);
    const ran = runTick(this.state, this.prng, [submitted.proposal]);
    this.state = ran.state;
    this.prng = ran.prng;
    this.log.push(...ran.events);
    return ran;
  }
  petition(mortal: string, cause: EventId) {
    return [...this.state.petitions.values()].find(
      (p) => p.petitioner === id(mortal) && p.cause === cause,
    );
  }
  /** `mortal` prays about `cause` and the world opens the petition. */
  prayer(mortal: string, cause: WorldEvent) {
    this.until(() => this.petition(mortal, cause.id) !== undefined);
    const petition = this.petition(mortal, cause.id);
    if (petition === undefined) throw new Error("no petition");
    return petition;
  }
  grudge(mortal: string, toward = "drifter") {
    return this.apply({
      kind: "relationship-changed",
      entityId: mortal,
      toward,
      affinityDelta: -1,
      grudgeDelta: 1,
      memoryEventId: "evt-0-fixture-memory",
    });
  }
  spoil(mortal: string) {
    return this.apply({
      kind: "stock-spoiled",
      entityId: mortal,
      resource: "food",
      amount: 1,
      cause: "director",
    });
  }
  /** The god stands with the petitioner and blesses it. */
  bless(god: string, petitionId: EventId) {
    const petition = this.state.petitions.get(petitionId);
    const at = getActor(
      this.state,
      petition?.petitioner ?? id("none"),
    )?.locationId;
    const held = getActor(this.state, id(god));
    if (!petition || !at || !held) throw new Error("fixture");
    this.state = withActor(this.state, { ...held, locationId: at });
    const ran = this.act({ actor: god, kind: "bless", petition: petitionId });
    expect(ran.rejected).toEqual([]);
  }
  /** The patron answers a punish prayer by striking the offender. */
  strike(god: string, target = "drifter") {
    const ran = this.act({ actor: god, kind: "strike", target, power: 1 });
    expect(ran.rejected).toEqual([]);
  }
  refuse(god: string, petitionId: EventId) {
    const ran = this.act({ actor: god, kind: "refuse", petition: petitionId });
    expect(ran.rejected).toEqual([]);
  }
  patron(mortal: string) {
    return String(this.state.patrons.get(id(mortal)));
  }
  changes() {
    return this.log.filter(
      (e): e is Extract<WorldEvent, { kind: "patron-changed" }> =>
        e.kind === "patron-changed",
    );
  }
  affinity(mortal: string, god: string) {
    return getRelationship(this.state, id(mortal), id(god))?.affinity;
  }
}

const memoriesOfDefection = (world: Flock, god: string) =>
  getMemories(world.state, id(god)).filter((m) => m.kind === "patronage");

/** A mortal's patron ignores one prayer (lapse), another god answered a different one, and the lapse is what tips it. */
function neglected(options: Parameters<typeof content>[0] = {}) {
  const world = new Flock(options);
  const ignored = world.grudge("fisher");
  const helped = world.spoil("fisher");
  const asked = world.prayer("fisher", helped);
  world.bless("athena", asked.id);
  const first = world.prayer("fisher", ignored);
  return { world, ignored: first, helped: asked };
}

test("a neglected mortal defects to the god that answered it (AE2): the lapse of its prayer tips it, and the event cites the lapsed prayers and the answer", () => {
  const { world, ignored, helped } = neglected({ affinity: 2 });
  // The prayer to Athena was answered; the one to Poseidon is open and about to be ignored.
  expect(world.state.petitions.get(helped.id)?.status).toBe("answered");
  expect(world.patron("fisher")).toBe("poseidon");
  world.until(() => world.state.petitions.get(ignored.id)?.status === "lapsed");
  const [change] = world.changes();
  expect(change).toMatchObject({
    entityId: "fisher",
    from: "poseidon",
    to: "athena",
    answered: helped.id,
    unanswered: [ignored.id],
  });
  expect(change?.tick).toBe(
    ignored.tick +
      petitionBalanceOf(world.state.rules, "answerWindowTicks") +
      1,
  );
  expect(world.patron("fisher")).toBe("athena");
  expect(world.affinity("fisher", "poseidon")).toBe(0);
});

test("a mortal whose patron is silent keeps it, however many prayers lapse (AE3), until a god answers it: then it defects at once, citing all the lapses", () => {
  const world = new Flock();
  const prayers = [
    world.grudge("fisher"),
    world.grudge("fisher"),
    world.grudge("fisher"),
  ].map((cause) => world.prayer("fisher", cause));
  world.until(() =>
    prayers.every((p) => world.state.petitions.get(p.id)?.status === "lapsed"),
  );
  // Three lapses took it from 3 to -3, far below the threshold, and no other god has answered it.
  expect(world.affinity("fisher", "poseidon")).toBe(-3);
  expect(world.changes()).toEqual([]);
  expect(world.patron("fisher")).toBe("poseidon");

  // Athena answers a prayer it makes about spoiled stock: it becomes hers.
  const spoiled = world.spoil("fisher");
  const asked = world.prayer("fisher", spoiled);
  expect(asked.god).toBe(id("athena"));
  world.bless("athena", asked.id);
  const [change] = world.changes();
  expect(change).toMatchObject({
    from: "poseidon",
    to: "athena",
    answered: asked.id,
  });
  // It cites every ignored prayer (it also prayed about a need of its own, which lapsed with them).
  expect(change?.unanswered).toEqual(
    expect.arrayContaining(prayers.map((p) => p.id)),
  );
  expect(world.patron("fisher")).toBe("athena");
});

test("the last answerer may be the patron itself: the mortal defects to the last other god that answered it", () => {
  const world = new Flock({ petitionBalance: { defectionAffinity: 2 } });
  const helped = world.prayer("fisher", world.spoil("fisher"));
  world.bless("athena", helped.id);
  expect(world.changes()).toEqual([]);
  // Poseidon, its patron, answers last: the affinity it leaves (3 + 1) is not below 2.
  const punished = world.prayer("fisher", world.grudge("fisher"));
  world.strike("poseidon");
  expect(world.state.petitions.get(punished.id)?.status).toBe("answered");
  expect(world.changes()).toEqual([]);
  // A refusal then takes it from 4 to 2, and one more to 0, below 2: the last answerer was Poseidon, so it goes to Athena.
  const refused = [
    world.prayer("fisher", world.grudge("fisher")),
    world.prayer("fisher", world.grudge("fisher")),
  ];
  world.refuse("poseidon", refused[0]?.id as EventId);
  expect(world.changes()).toEqual([]);
  world.refuse("poseidon", refused[1]?.id as EventId);
  expect(world.changes()).toMatchObject([
    { from: "poseidon", to: "athena", answered: helped.id },
  ]);
});

test("a refusal tips it as a lapse does", () => {
  const world = new Flock({ affinity: 2 });
  const helped = world.prayer("fisher", world.spoil("fisher"));
  world.bless("athena", helped.id);
  const ignored = world.prayer("fisher", world.grudge("fisher"));
  world.refuse("poseidon", ignored.id);
  expect(world.changes()).toMatchObject([
    { from: "poseidon", to: "athena", unanswered: [ignored.id] },
  ]);
});

test("the threshold is the affinity below which a mortal defects: at it, it stays; one below, it goes", () => {
  for (const threshold of [1, 2, 3, 10]) {
    for (const [offset, defects] of [
      [0, false],
      [-1, true],
    ] as const) {
      const world = new Flock({
        petitionBalance: { defectionAffinity: threshold },
      });
      const asked = world.prayer("fisher", world.spoil("fisher"));
      // Set the feeling just before the answer so the answer's kindness (+1 toward Athena) cannot matter.
      world.state = {
        ...world.state,
        relationships: new Map(world.state.relationships).set(
          relationshipKey(id("fisher"), id("poseidon")),
          {
            from: id("fisher"),
            toward: id("poseidon"),
            affinity: threshold + offset,
            grudge: 0,
            allied: false,
          },
        ),
      };
      world.bless("athena", asked.id);
      expect([threshold, offset, world.changes().length > 0]).toEqual([
        threshold,
        offset,
        defects,
      ]);
    }
  }
});

test("only the god lost and the god gained remember a defection, each naming the mortal, its home, and the other god; no one else, the mortal included, holds it", () => {
  const { world, ignored } = neglected({ affinity: 2 });
  world.until(() => world.changes().length > 0);
  const [change] = world.changes();
  for (const god of ["poseidon", "athena"]) {
    expect(memoriesOfDefection(world, god)).toMatchObject([
      {
        kind: "patronage",
        sourceEventId: change?.id,
        mortal: "fisher",
        home: "dock",
        from: "poseidon",
        to: "athena",
      },
    ]);
  }
  expect(memoriesOfDefection(world, "poseidon")[0]?.subjects).toEqual([
    id("fisher"),
    id("dock"),
    id("athena"),
  ]);
  expect(memoriesOfDefection(world, "athena")[0]?.subjects).toEqual([
    id("fisher"),
    id("dock"),
    id("poseidon"),
  ]);
  for (const other of ["hermes", "zeus", "fisher", "drifter"]) {
    expect(memoriesOfDefection(world, other)).toEqual([]);
  }
  expect(ignored.status).toBe("open");
});

test("the defection moves standing at the mortal's home: the god lost falls by one, the god gained rises by one", () => {
  const { world } = neglected({ affinity: 2 });
  world.until(() => world.changes().length > 0);
  expect(standingOf(world.state, id("poseidon"), id("dock"))).toBe(-1);
  expect(standingOf(world.state, id("athena"), id("dock"))).toBe(1);
  expect(standingOf(world.state, id("hermes"), id("dock"))).toBe(0);
});

test("there is no cooldown: a mortal that left a patron leaves the next one the same way, and goes back to a god that answered it", () => {
  const world = new Flock({ affinity: 1 });
  // Poseidon answers it once (it stays his); Athena answers it; Poseidon then refuses it, and it becomes Athena's.
  const first = world.prayer("fisher", world.grudge("fisher"));
  world.strike("poseidon");
  expect(world.state.petitions.get(first.id)?.status).toBe("answered");
  const helped = world.prayer("fisher", world.spoil("fisher"));
  world.bless("athena", helped.id);
  world.refuse("poseidon", world.prayer("fisher", world.grudge("fisher")).id);
  expect(world.patron("fisher")).toBe("athena");
  // Athena neglects it in turn: it is below the threshold again, and the last other god to answer it was Poseidon.
  world.refuse("athena", world.prayer("fisher", world.grudge("fisher")).id);
  expect(world.changes().map((c) => [String(c.from), String(c.to)])).toEqual([
    ["poseidon", "athena"],
    ["athena", "poseidon"],
  ]);
  expect(world.patron("fisher")).toBe("poseidon");
});

test("SC6: with the Greek pack's 150-tick answer window, a mortal of any authored devotion (2 to 4) whose patron ignores its prayers defects within a 300-tick episode, on ticks alone", () => {
  const window = 150;
  for (const [affinity, ignoredPrayers] of [
    [2, 1],
    [3, 2],
    [4, 2],
  ] as const) {
    const world = new Flock({
      affinity,
      petitionBalance: { answerWindowTicks: window },
    });
    const helped = world.spoil("fisher");
    const ignored = Array.from({ length: ignoredPrayers }, () =>
      world.grudge("fisher"),
    );
    world.bless("athena", world.prayer("fisher", helped).id);
    const prayed = ignored.map((cause) => world.prayer("fisher", cause));
    // The prayer cooldown is 20 ticks, so the last one opens inside the first 50.
    expect(Math.max(...prayed.map((p) => p.tick))).toBeLessThan(50);
    world.until(() => world.changes().length > 0, 300);
    const [change] = world.changes();
    // A prayer lapses a window and a tick after it opens; the last lapse tips the mortal.
    expect(change?.tick).toBe(
      Math.max(...prayed.map((p) => p.tick)) + window + 1,
    );
    expect(change?.tick).toBeLessThan(300);
    expect(change?.unanswered).toHaveLength(ignoredPrayers);
    expect(world.patron("fisher")).toBe("athena");
  }
});

test("the same inputs defect identically: replaying the log from the start gives the same patrons, memories, and standing, which survive the codec", () => {
  const { world } = neglected({ affinity: 2 });
  world.until(() => world.changes().length > 0);
  const replayed = applyEvents(world.initial, world.log);
  expect(replayed.patrons).toEqual(world.state.patrons);
  expect(replayed.memories).toEqual(world.state.memories);
  expect(replayed.standing).toEqual(world.state.standing);
  const decoded = decode(JSON.parse(JSON.stringify(encode(world.state))));
  expect(decoded).toEqual(world.state);
  expect(decoded.patrons.get(id("fisher"))).toBe(id("athena"));

  // A second run from the same seed does exactly the same.
  const again = neglected({ affinity: 2 });
  again.world.until(() => again.world.changes().length > 0);
  expect(again.world.state).toEqual(world.state);
});

test("the defection memory is only formed when its salience is positive, and a stored world with it decodes: at 0 the mortal still defects but no god remembers", () => {
  const withSalience = (salience: number) => {
    const { world } = neglected({
      affinity: 2,
      memoryBalance: { salience_patronage: salience },
    });
    world.until(() => world.changes().length > 0);
    return world;
  };
  const none = withSalience(0);
  expect(none.patron("fisher")).toBe("athena");
  expect(memoriesOfDefection(none, "poseidon")).toEqual([]);
  expect(decode(JSON.parse(JSON.stringify(encode(none.state))))).toEqual(
    none.state,
  );
  const one = withSalience(1);
  expect(memoriesOfDefection(one, "poseidon")[0]?.salience).toBe(1);
  expect(decode(JSON.parse(JSON.stringify(encode(one.state))))).toEqual(
    one.state,
  );
});

test("a stored world refuses a patronage memory that names an unknown actor, and an event naming the same god twice", () => {
  const { world } = neglected({ affinity: 2 });
  world.until(() => world.changes().length > 0);
  const stored = JSON.parse(JSON.stringify(encode(world.state)));
  expect(() => decode(stored)).not.toThrow();
  const broken = JSON.parse(JSON.stringify(stored));
  const entry = broken.memories.find(([, list]: [string, { kind: string }[]]) =>
    list.some((m) => m.kind === "patronage"),
  );
  entry[1].find((m: { kind: string }) => m.kind === "patronage").mortal = 7;
  expect(() => decode(broken)).toThrow();
});

// --- The contest over a defection --------------------------------------------------------------------

/** Two fishers who both leave Poseidon for Athena, the first and then the second. */
function twoDefections() {
  const world = new Flock(
    {
      affinity: 2,
      contestWindowTicks: 400,
      mortals: [
        ["fisher", "poseidon"],
        ["fisher2", "poseidon"],
      ],
    },
    ["fisher", "fisher2"],
  );
  const leave = (mortal: string) => {
    const helped = world.prayer(mortal, world.spoil(mortal));
    world.bless("athena", helped.id);
    world.refuse("poseidon", world.prayer(mortal, world.grudge(mortal)).id);
  };
  leave("fisher");
  const first = world.changes()[0];
  return { world, leave, first };
}

const contest = (cause: EventId | undefined) => ({
  kind: "practice",
  move: "contest",
  cause,
});

test("the god lost opens a contest for the defector's home, citing the defection, with no rivalry (AE4)", () => {
  const { world, first } = twoDefections();
  expect(world.state.actors.get(id("poseidon"))?.rivals).toBeUndefined();
  const ran = world.act({ actor: "poseidon", ...contest(first?.id) });
  expect(ran.rejected).toEqual([]);
  const opened = ran.events.find((e) => e.kind === "contest-opened");
  expect(opened).toMatchObject({
    kind: "contest-opened",
    entityId: "poseidon",
    rival: "athena",
    place: "dock",
    cause: first?.id,
  });
  expect(world.state.contests.size).toBe(1);
});

test("a god that was not told, the god gained, and a mortal cannot cite a defection; the cause is unknown to them", () => {
  const { world, first } = twoDefections();
  for (const [actor, reason] of [
    ["hermes", "malformed"],
    ["zeus", "malformed"],
    ["athena", "unauthorized-claim"],
    ["fisher", "unauthorized-claim"],
  ] as const) {
    const ran = world.act({ actor, ...contest(first?.id) });
    expect([actor, ran.rejected.map((r) => r.reason)]).toEqual([
      actor,
      [reason],
    ]);
  }
  expect(world.state.contests.size).toBe(0);
  // A made-up cause is refused too.
  expect(
    world.act({ actor: "poseidon", ...contest("evt-9-9" as EventId) }).rejected,
  ).toHaveLength(1);
});

test("a defection at a place with a contest open is recorded and opens nothing; once that closes, it may be contested, and a defection only once", () => {
  const { world, leave, first } = twoDefections();
  world.act({ actor: "poseidon", ...contest(first?.id) });
  const open = [...world.state.contests.values()][0];
  leave("fisher2");
  const second = world.changes()[1];
  expect(second).toMatchObject({ entityId: "fisher2", to: "athena" });
  expect(world.state.patrons.get(id("fisher2"))).toBe(id("athena"));
  // Recorded, remembered, and nothing opened: the place is held.
  expect(memoriesOfDefection(world, "poseidon")).toHaveLength(2);
  const refused = world.act({ actor: "poseidon", ...contest(second?.id) });
  expect(refused.rejected.map((r) => r.reason)).toEqual(["no-progress"]);
  expect(world.state.contests.size).toBe(1);
  // The window passes; the first is spent, and the second may be contested.
  world.until(
    () => world.state.contests.get(open?.id as EventId)?.status !== "open",
  );
  expect(
    world
      .act({ actor: "poseidon", ...contest(first?.id) })
      .rejected.map((r) => r.reason),
  ).toEqual(["no-progress"]);
  const next = world.act({ actor: "poseidon", ...contest(second?.id) });
  expect(next.rejected).toEqual([]);
  expect(world.state.contests.size).toBe(2);
  expect([...world.state.contests.values()][1]?.succeeds).toBe(open?.id);
});

test("a defection contest closes by the same rules: nothing served and no favour expires it with no standing change", () => {
  const { world, first } = twoDefections();
  const standing = world.state.standing;
  world.act({ actor: "poseidon", ...contest(first?.id) });
  const opened = [...world.state.contests.values()][0];
  world.until(
    () => world.state.contests.get(opened?.id as EventId)?.status !== "open",
  );
  expect(world.state.contests.get(opened?.id as EventId)).toMatchObject({
    status: "expired",
    reason: "no-favour",
  });
  expect(world.state.standing).toEqual(standing);
});

test("a contest citing a defection, and the defection itself, replay identically from the log and survive the codec", () => {
  const { world, first } = twoDefections();
  world.act({ actor: "poseidon", ...contest(first?.id) });
  const replayed = applyEvents(world.initial, world.log);
  expect(replayed.contests).toEqual(world.state.contests);
  expect(replayed.patrons).toEqual(world.state.patrons);
  expect(decode(JSON.parse(JSON.stringify(encode(world.state))))).toEqual(
    world.state,
  );
});

test("a defector no one lives beside any longer leaves nothing to contest", () => {
  const { world, first } = twoDefections();
  const fisher = getActor(world.state, id("fisher"));
  if (!fisher) throw new Error("fisher");
  world.state = withActor(world.state, { ...fisher, alive: false });
  for (const name of ["fisher2", "drifter"]) {
    const other = getActor(world.state, id(name));
    if (!other) throw new Error(name);
    world.state = withActor(world.state, { ...other, alive: false });
  }
  const ran = world.act({ actor: "poseidon", ...contest(first?.id) });
  expect(ran.rejected.map((r) => r.reason)).toEqual(["malformed"]);
});
