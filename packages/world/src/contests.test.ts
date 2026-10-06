// A contest for favour: gods with a rivalry claim a place's people. A god opens
// one only over a rival's bless, strike, or legend it perceived at a place with a
// mortal in it; the world counts each god's services per mortal between the open
// and the close, then changes each god's standing there for good, and the
// mortals' prayers follow. The world is real: real proposals, real ticks, the
// real validator and judge.

import { expect, test } from "bun:test";
import type { ContentPack, EventId, WorldEvent } from "@panthea/contracts";
import {
  applyEvent,
  applyEvents,
  runTick,
  submitProposal,
  type TickOptions,
  type TickResult,
} from "./actions";
import { decode, encode } from "./codec";
import { perceive } from "./perception";
import { routePetition } from "./petitions";
import {
  createInitialWorldState,
  createPrng,
  getActor,
  type PrngState,
  standingOf,
  toEntityId,
  type WorldState,
  withActor,
} from "./state";

// biome-ignore lint/suspicious/noExplicitAny: untyped JSON under edit
type Loose = Record<string, any>;

const id = toEntityId;

/** A value as plain JSON, so branded ids compare with the strings a test writes. */
const plain = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value ?? null));

const MORTALS = ["m1", "m2", "m3", "m4", "m5", "m6", "m7"];

/**
 * The square holds seven mortals who live there, and Athena, Poseidon, and
 * Hera. Athena and Poseidon are rivals (Athena names Poseidon; Hera has no
 * rivals). Zeus is at the altar. A far place holds one more mortal and nobody
 * else. Windows are short so a scenario stays short: a contest runs 10 ticks, an
 * act can be contested for 20, and a closed contest moves standing by 2.
 */
function pack(
  practiceBalance: Record<string, number> = {},
  memoryBalance: Record<string, number> = {},
): ContentPack {
  const deity = (name: string, locationId: string, rivals?: string[]) => ({
    id: name,
    name,
    locationId,
    deity: true,
    ...(rivals === undefined ? {} : { rivals }),
    startingInventory: [
      { resource: "divinity", amount: 100 },
      { resource: "food", amount: 50 },
    ],
  });
  const mortal = (name: string, locationId: string) => ({
    id: name,
    name,
    locationId,
    drives: { thrift: 0, appetite: 0, greed: 0, piety: 0 },
    startingInventory: [{ resource: "food", amount: 50 }],
  });
  return {
    schemaVersion: 1,
    realms: ["mortal"],
    resources: [],
    locations: [
      {
        id: "square",
        realm: "mortal",
        name: "Square",
        edges: [
          { to: "altar", transport: "path", bidirectional: true },
          { to: "far", transport: "path", bidirectional: true },
          { to: "empty", transport: "path", bidirectional: true },
        ],
      },
      { id: "altar", realm: "mortal", name: "Altar", edges: [] },
      { id: "far", realm: "mortal", name: "Far", edges: [] },
      { id: "empty", realm: "mortal", name: "Empty", edges: [] },
    ],
    buildings: [
      {
        id: "shed",
        locationId: "square",
        name: "Shed",
        material: "wood",
        combustible: false,
        services: [],
        inventory: [],
      },
    ],
    inhabitants: [
      deity("athena", "square", ["poseidon"]),
      deity("poseidon", "square"),
      deity("hera", "square"),
      deity("zeus", "altar"),
      ...MORTALS.map((name) => ({
        ...mortal(name, "square"),
        devotion: { god: "hera", affinity: 3 },
      })),
      mortal("far-one", "far"),
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
      memoryBalance: { kindnessAffinity: 2, ...memoryBalance },
      practiceBalance: {
        contestWindowTicks: 10,
        contestActTicks: 20,
        contestStanding: 2,
        ...practiceBalance,
      },
    },
    recipes: {},
  };
}

class Town {
  state: WorldState;
  prng: PrngState = createPrng(1);
  readonly log: WorldEvent[] = [];
  readonly initial: WorldState;
  last: TickResult | undefined;
  private n = 0;
  constructor(
    practiceBalance: Record<string, number> = {},
    private readonly options: TickOptions = {},
    memoryBalance: Record<string, number> = {},
  ) {
    this.state = createInitialWorldState(pack(practiceBalance, memoryBalance));
    this.initial = this.state;
  }
  tick(...extra: Record<string, unknown>[]): TickResult {
    const proposals = extra.map((raw) => {
      this.n += 1;
      const submitted = submitProposal({
        schemaVersion: 1,
        targets: [],
        expectedRevisions: [],
        source: "fixture",
        observationId: `obs-ct-${this.n}`,
        ...raw,
      });
      if (!submitted.ok) throw new Error(submitted.rejection.message);
      return submitted.proposal;
    });
    const result = runTick(this.state, this.prng, proposals, this.options);
    this.state = result.state;
    this.prng = result.prng;
    this.log.push(...result.events);
    this.last = result;
    return result;
  }
  until(done: () => boolean, limit = 400): void {
    for (let n = 0; n < limit && !done(); n += 1) this.tick();
  }
  apply(overrides: Record<string, unknown>): WorldEvent {
    this.n += 1;
    const event = {
      schemaVersion: 1,
      id: `evt-${this.state.tick}-${2000 + this.n}`,
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
  place(who: string, locationId: string): void {
    const actor = getActor(this.state, id(who));
    if (!actor) throw new Error(who);
    this.state = withActor(this.state, {
      ...actor,
      locationId: id(locationId),
    });
  }
  /** `mortal` prays to `god` about food that spoiled, and the god answers with a bless the same tick it proposes. Returns the blessing the world committed. */
  blessing(god: string, mortal: string): WorldEvent {
    const cause = this.apply({
      kind: "stock-spoiled",
      entityId: mortal,
      resource: "food",
      amount: 1,
      cause: "director",
    });
    const petition = this.apply({
      kind: "petition-opened",
      entityId: mortal,
      god,
      cause: cause.id,
      request: {
        kind: "help",
        need: { kind: "resource", resource: "food", amount: 1 },
      },
    });
    const ran = this.tick({ actor: god, kind: "bless", petition: petition.id });
    const granted = ran.events.find((e) => e.kind === "blessing-granted");
    if (!granted) {
      throw new Error(
        `no blessing: ${JSON.stringify(ran.rejected.map((r) => r.message))}`,
      );
    }
    return granted;
  }
  contest(god: string, cause: EventId): Record<string, unknown> {
    return { actor: god, kind: "practice", move: "contest", cause };
  }
  contests() {
    return [...this.state.contests.values()];
  }
  contestLog() {
    return this.log.filter(
      (
        e,
      ): e is Extract<
        WorldEvent,
        { kind: "contest-opened" | "contest-closed" }
      > => e.kind === "contest-opened" || e.kind === "contest-closed",
    );
  }
  rejected(): string[] {
    return (this.last?.rejected ?? []).map((r) => r.reason);
  }
  standing(god: string, place = "square") {
    return standingOf(this.state, id(god), id(place));
  }
}

/** Poseidon's bless of m1 at the square, which Athena perceives: the rival act a contest rests on. */
function rivalAct(town: Town) {
  const blessing = town.blessing("poseidon", "m1");
  return blessing.id as EventId;
}

/** A contest Athena opened over Poseidon's act. */
function opened(town = new Town()) {
  const act = rivalAct(town);
  town.tick(town.contest("athena", act));
  const [contest] = town.contests();
  if (!contest) throw new Error("no contest opened");
  return { town, act, contest };
}

// --- Opening --------------------------------------------------------------------------------

test("a rival's bless a god perceived at a place with a mortal is a service the world remembers, with who experienced it and who perceived it", () => {
  const town = new Town();
  const blessing = town.blessing("poseidon", "m1");
  expect(plain(town.state.services)).toEqual([
    {
      id: blessing.id,
      kind: "bless",
      god: "poseidon",
      place: "square",
      tick: blessing.tick,
      sequence: blessing.sequence,
      reached: ["m1"],
      perceivedBy: ["athena", "hera"],
    },
  ]);
});

test("a god opens a contest over a rival's act it perceived: the world finds the rival, the place, and the window, and records the cause", () => {
  const { town, act, contest } = opened();
  expect(town.rejected()).toEqual([]);
  const event = town.contestLog()[0];
  expect(event).toMatchObject({
    kind: "contest-opened",
    entityId: "athena",
    rival: "poseidon",
    place: "square",
    cause: act,
  });
  expect(contest).toMatchObject({
    opener: "athena",
    rival: "poseidon",
    place: "square",
    cause: act,
    status: "open",
    tallies: [],
  });
  expect(contest.closesAt).toBe(contest.openedTick + 10);
  expect(town.state.contests.get(contest.id)).toBe(contest);
});

test("a strike and a legend are rival acts too, each at the place with mortals in it", () => {
  const strike = new Town();
  strike.tick({ actor: "poseidon", kind: "strike", target: "shed", power: 1 });
  const hit = strike.state.services.at(-1);
  expect(hit).toMatchObject({
    kind: "strike",
    god: "poseidon",
    place: "square",
  });
  expect(plain(hit?.reached)).toEqual(MORTALS);
  strike.tick(strike.contest("athena", hit?.id as EventId));
  expect(strike.rejected()).toEqual([]);
  expect(strike.contests()).toHaveLength(1);

  const legend = new Town();
  legend.tick({
    actor: "poseidon",
    kind: "legend",
    assertion: "The sea gives, and the sea takes.",
  });
  const told = legend.state.services.at(-1);
  expect(told).toMatchObject({
    kind: "legend",
    god: "poseidon",
    place: "square",
  });
  expect(plain(told?.reached)).toEqual(MORTALS);
  legend.tick(legend.contest("athena", told?.id as EventId));
  expect(legend.contests()).toHaveLength(1);
});

test("a contest with no perceived rival act is refused, even between gods whose profiles name a rivalry", () => {
  const town = new Town();
  // No act at all: a cause the world never saw.
  town.tick(town.contest("athena", "evt-404" as EventId));
  expect(town.rejected()).toEqual(["malformed"]);
  // An event that is no service: a petition is a prayer, not a god's act.
  const cause = town.apply({
    kind: "stock-spoiled",
    entityId: "m1",
    resource: "food",
    amount: 1,
    cause: "director",
  });
  const petition = town.apply({
    kind: "petition-opened",
    entityId: "m1",
    god: "poseidon",
    cause: cause.id,
    request: {
      kind: "help",
      need: { kind: "resource", resource: "food", amount: 1 },
    },
  });
  town.tick(town.contest("athena", petition.id as EventId));
  expect(town.rejected()).toEqual(["malformed"]);
  expect(town.contests()).toEqual([]);
  expect(town.contestLog()).toEqual([]);
});

test("only a rival's act is contested, only by a god that perceived it, and never a god's own", () => {
  // A god with no rivalry with the actor.
  const hera = new Town();
  const heraBlessed = hera.blessing("hera", "m1");
  hera.tick(hera.contest("athena", heraBlessed.id as EventId));
  expect(hera.rejected()).toEqual(["unauthorized-claim"]);

  // The rivalry is read both ways: Poseidon names no one, but Athena names him.
  const both = new Town();
  const athenaBlessed = both.blessing("athena", "m1");
  both.tick(both.contest("poseidon", athenaBlessed.id as EventId));
  expect(both.rejected()).toEqual([]);
  expect(both.contests()[0]).toMatchObject({
    opener: "poseidon",
    rival: "athena",
  });

  // A god cannot contest its own act.
  const own = new Town();
  const poseidonBlessed = own.blessing("poseidon", "m1");
  own.tick(own.contest("poseidon", poseidonBlessed.id as EventId));
  expect(own.rejected()).toEqual(["unauthorized-claim"]);

  // A god that was not there did not perceive it.
  const away = new Town();
  away.place("athena", "altar");
  const missed = away.blessing("poseidon", "m1");
  away.tick(away.contest("athena", missed.id as EventId));
  expect(away.rejected()).toEqual(["unauthorized-claim"]);

  // Only a god contests.
  const mortal = new Town();
  const act = mortal.blessing("poseidon", "m1");
  mortal.tick(mortal.contest("m2", act.id as EventId));
  expect(mortal.rejected()).toEqual(["unauthorized-claim"]);
});

test("an act at a place with no mortal in it is no service to contest, and an act too old to contest is refused", () => {
  const town = new Town();
  town.place("poseidon", "empty");
  town.place("athena", "empty");
  town.tick({
    actor: "poseidon",
    kind: "legend",
    assertion: "No one is here to hear it.",
  });
  // A legend no mortal heard reaches no one: nothing the world keeps.
  expect(plain(town.state.services)).toEqual([]);

  const aged = new Town({ contestActTicks: 5 });
  const act = rivalAct(aged);
  for (let n = 0; n < 6; n += 1) aged.tick();
  aged.tick(aged.contest("athena", act));
  expect(aged.rejected()).toEqual(["malformed"]);
  expect(aged.contests()).toEqual([]);
});

test("the ledger holds only the newest acts, so it never grows past its limit", () => {
  const town = new Town({ contestLedgerMax: 3, contestActTicks: 1000 });
  for (const mortal of ["m1", "m2", "m3", "m4", "m5"]) {
    town.blessing("poseidon", mortal);
  }
  expect(plain(town.state.services)).toHaveLength(3);
  expect(plain(town.state.services.map((s) => s.reached[0]))).toEqual([
    "m3",
    "m4",
    "m5",
  ]);
});

// --- Counting, boundaries, closing -------------------------------------------------------------

test("acts count only between the open and the close: the cause before the open does not, one after it does, and so does one on the last tick of the window but not the tick after", () => {
  const town = new Town();
  const before = rivalAct(town);
  town.tick(town.contest("athena", before));
  const contest = town.contests()[0];
  if (!contest) throw new Error("no contest");
  // The act the contest rests on came before it and counts for nothing.
  expect(contest.tallies).toEqual([]);

  town.blessing("athena", "m2");
  town.blessing("athena", "m5");
  expect(plain(town.state.contests.get(contest.id)?.tallies)).toEqual([
    { god: "athena", mortal: "m2", weight: 1 },
    { god: "athena", mortal: "m5", weight: 1 },
  ]);

  // Run to the tick before the last; a blessing on the last tick counts, and the contest closes at the end of it.
  town.until(() => town.state.tick === contest.closesAt - 1);
  town.blessing("poseidon", "m3");
  expect(town.state.tick).toBe(contest.closesAt);
  const closed = town.state.contests.get(contest.id);
  expect(closed?.status).toBe("decided");
  expect(plain(closed?.tallies)).toEqual([
    { god: "athena", mortal: "m2", weight: 1 },
    { god: "athena", mortal: "m5", weight: 1 },
    { god: "poseidon", mortal: "m3", weight: 1 },
  ]);
  // The tick after the close: nothing counts.
  town.blessing("athena", "m4");
  expect(plain(town.state.contests.get(contest.id)?.tallies)).toHaveLength(3);
});

test("an act in the same tick the contest opens counts only if it follows the opening in the queue", () => {
  const prayer = (town: Town, mortal: string, god: string) => {
    const spoiled = town.apply({
      kind: "stock-spoiled",
      entityId: mortal,
      resource: "food",
      amount: 1,
      cause: "director",
    });
    return town.apply({
      kind: "petition-opened",
      entityId: mortal,
      god,
      cause: spoiled.id,
      request: {
        kind: "help",
        need: { kind: "resource", resource: "food", amount: 1 },
      },
    }).id;
  };
  // Poseidon's bless comes first in the queue, Athena's contest after it: his act is no part of the window.
  const first = new Town();
  const cause = rivalAct(first);
  const early = prayer(first, "m2", "poseidon");
  first.tick(
    { actor: "poseidon", kind: "bless", petition: early },
    first.contest("athena", cause),
  );
  expect(first.rejected()).toEqual([]);
  expect(plain(first.contests()[0]?.tallies)).toEqual([]);

  // His bless after the contest in the queue is.
  const second = new Town();
  const cause2 = rivalAct(second);
  const late = prayer(second, "m3", "poseidon");
  second.tick(second.contest("athena", cause2), {
    actor: "poseidon",
    kind: "bless",
    petition: late,
  });
  expect(plain(second.contests()[0]?.tallies)).toEqual([
    { god: "poseidon", mortal: "m3", weight: 1 },
  ]);
});

test("the close judges exactly the window: an act one tick after it is not in the contest", () => {
  const { town, contest } = opened();
  town.until(() => town.state.tick >= contest.closesAt + 1);
  const closing = town.contestLog().find((e) => e.kind === "contest-closed");
  expect(closing?.tick).toBe(contest.closesAt);
  town.blessing("athena", "m5");
  expect(plain(town.state.contests.get(contest.id)?.tallies)).toEqual([]);
});

test("a contest decided for Athena: her services reach five mortals and Poseidon's two, so her standing rises, his falls, and those mortals pray to her (AE10)", () => {
  const town = new Town();
  const act = rivalAct(town); // m1 was blessed by Poseidon before the contest: not counted
  town.tick(town.contest("athena", act));
  const contest = town.contests()[0];
  if (!contest) throw new Error("no contest");
  // Before it, every mortal's own prayers go to Hera, whom they revere.
  for (const mortal of MORTALS) {
    expect(String(routePetition(town.state, id(mortal)))).toBe("hera");
  }
  // A patron holds its mortals whatever the standing; the old route by feeling and standing is what a mortal with no patron follows.
  const unpatroned = () => ({ ...town.state, patrons: new Map() });
  for (const mortal of ["m1", "m2", "m3", "m4", "m5"]) {
    town.blessing("athena", mortal);
  }
  for (const mortal of ["m6", "m7"]) town.blessing("poseidon", mortal);
  town.until(() => town.state.contests.get(contest.id)?.status !== "open");

  const closed = town.state.contests.get(contest.id);
  expect(closed).toMatchObject({
    status: "decided",
    reason: "window",
    winner: "athena",
  });
  const ending = town.contestLog().find((e) => e.kind === "contest-closed");
  expect(ending).toMatchObject({ result: "decided", winner: "athena" });
  if (ending?.kind === "contest-closed" && ending.result === "decided") {
    expect(plain(ending.favoured)).toEqual([
      { mortal: "m1", god: "athena" },
      { mortal: "m2", god: "athena" },
      { mortal: "m3", god: "athena" },
      { mortal: "m4", god: "athena" },
      { mortal: "m5", god: "athena" },
      { mortal: "m6", god: "poseidon" },
      { mortal: "m7", god: "poseidon" },
    ]);
  }
  // Standing changes for good, and is recorded as the sourced motifs.
  expect(town.standing("athena")).toBe(2);
  expect(town.standing("poseidon")).toBe(-2);
  const motifs = town.log.filter((e) => e.kind === "motif-applied");
  expect(motifs).toMatchObject([
    {
      entityId: "athena",
      motif: "standing-won",
      effect: "standing",
      place: "square",
      delta: 2,
      threadId: contest.id,
      cause: ending?.id,
    },
    {
      entityId: "poseidon",
      motif: "standing-lost",
      effect: "standing",
      place: "square",
      delta: -2,
      threadId: contest.id,
      cause: ending?.id,
    },
  ]);
  // Their patron is still Hera: standing alone does not change it.
  for (const mortal of ["m1", "m2", "m3", "m4", "m5", "m6", "m7"]) {
    expect(String(routePetition(town.state, id(mortal)))).toBe("hera");
  }
  // Without a patron, the mortals Athena served pray to her; those Poseidon served keep to Hera, who owes the place nothing.
  for (const mortal of ["m1", "m2", "m3", "m4", "m5"]) {
    expect(String(routePetition(unpatroned(), id(mortal)))).toBe("athena");
  }
  for (const mortal of ["m6", "m7"]) {
    expect(String(routePetition(unpatroned(), id(mortal)))).toBe("hera");
  }
  // Standing is the god's own at that place and nowhere else.
  expect(town.standing("athena", "far")).toBe(0);
});

test("a mortal's weights follow the god that served it more: a strike it suffered counts against the god that did it", () => {
  const { town, contest } = opened();
  town.blessing("athena", "m2");
  town.tick({ actor: "poseidon", kind: "strike", target: "shed", power: 1 });
  const tallies = town.state.contests.get(contest.id)?.tallies ?? [];
  const weight = (god: string, mortal: string) =>
    tallies.find((t) => t.god === god && t.mortal === mortal)?.weight;
  expect(weight("athena", "m2")).toBe(1);
  // Every mortal at the square suffered the strike.
  expect(weight("poseidon", "m1")).toBe(-1);
  expect(weight("poseidon", "m7")).toBe(-1);
  town.until(() => town.state.contests.get(contest.id)?.status !== "open");
  const ending = town.contestLog().find((e) => e.kind === "contest-closed");
  if (ending?.kind !== "contest-closed" || ending.result !== "decided") {
    throw new Error("expected a decision");
  }
  // m2 favours Athena; the others, harmed by Poseidon, favour no one he served.
  expect(plain(ending.favoured)).toEqual([{ mortal: "m2", god: "athena" }]);
  expect(String(ending.winner)).toBe("athena");
});

test("a strike on a mortal is a rival act too: the world keeps it where the mortal stood, with the others there who experienced it and the gods who perceived it, and a god that saw it can contest it", () => {
  const town = new Town();
  const ran = town.tick({
    actor: "poseidon",
    kind: "strike",
    target: "m1",
    power: 1,
  });
  expect(town.rejected()).toEqual([]);
  const harm = ran.events.find((e) => e.kind === "mortal-struck");
  if (harm === undefined) throw new Error("no strike");
  expect(plain(town.state.services)).toEqual([
    {
      id: harm.id,
      kind: "strike",
      god: "poseidon",
      place: "square",
      tick: harm.tick,
      sequence: harm.sequence,
      reached: MORTALS,
      perceivedBy: ["athena", "hera"],
    },
  ]);
  town.tick(town.contest("athena", harm.id as EventId));
  expect(town.rejected()).toEqual([]);
  expect(town.contests()).toHaveLength(1);
});

test("a strike on a mortal during an open contest weighs against the god that struck, for every mortal at the place", () => {
  const { town, contest } = opened();
  town.tick({ actor: "poseidon", kind: "strike", target: "m1", power: 1 });
  expect(town.rejected()).toEqual([]);
  expect(plain(town.state.contests.get(contest.id)?.tallies)).toEqual(
    MORTALS.map((mortal) => ({ god: "poseidon", mortal, weight: -1 })),
  );
  // A strike elsewhere is not at this place and adds nothing to it.
  town.tick({ actor: "poseidon", kind: "strike", target: "far-one", power: 1 });
  expect(town.state.contests.get(contest.id)?.tallies).toHaveLength(
    MORTALS.length,
  );
});

test("a window with no god favoured over the other changes no one's standing: it expires", () => {
  const { town, contest } = opened();
  town.until(() => town.state.contests.get(contest.id)?.status !== "open");
  expect(town.state.contests.get(contest.id)).toMatchObject({
    status: "expired",
    reason: "no-favour",
  });
  expect(town.standing("athena")).toBe(0);
  expect(town.standing("poseidon")).toBe(0);
  expect(town.log.filter((e) => e.kind === "motif-applied")).toEqual([]);

  // Equal favour is a draw as well.
  const draw = opened();
  draw.town.blessing("athena", "m2");
  draw.town.blessing("poseidon", "m3");
  draw.town.until(
    () => draw.town.state.contests.get(draw.contest.id)?.status !== "open",
  );
  expect(draw.town.state.contests.get(draw.contest.id)).toMatchObject({
    status: "expired",
    reason: "no-favour",
  });
  expect(draw.town.standing("athena")).toBe(0);
});

test("the place empties mid-window: the contest expires and no one's standing changes", () => {
  const { town, contest } = opened();
  town.blessing("athena", "m2");
  // Everyone who lived at the square has gone.
  for (const mortal of MORTALS) {
    const actor = getActor(town.state, id(mortal));
    if (!actor) throw new Error(mortal);
    town.state = withActor(town.state, {
      ...actor,
      locationId: id("far"),
      home: id("far"),
    });
  }
  town.tick();
  expect(town.state.contests.get(contest.id)).toMatchObject({
    status: "expired",
    reason: "place-empty",
  });
  expect(town.state.tick).toBeLessThan(contest.closesAt);
  expect(town.standing("athena")).toBe(0);
  expect(town.standing("poseidon")).toBe(0);
  const ending = town.contestLog().find((e) => e.kind === "contest-closed");
  expect(ending).toMatchObject({ result: "expired", reason: "place-empty" });
  expect(town.log.filter((e) => e.kind === "motif-applied")).toEqual([]);
});

test("a place whose people all die is as empty as one they left", () => {
  const { town, contest } = opened();
  for (const mortal of MORTALS) {
    const actor = getActor(town.state, id(mortal));
    if (!actor) throw new Error(mortal);
    town.state = withActor(town.state, { ...actor, alive: false });
  }
  town.tick();
  expect(town.state.contests.get(contest.id)).toMatchObject({
    status: "expired",
    reason: "place-empty",
  });
});

// --- Who votes: only the living who still belong to the place ----------------------------------------

/** `who` dies, or leaves the place for good (home and standing place both elsewhere). */
function remove(town: Town, who: string, how: "die" | "leave") {
  const actor = getActor(town.state, id(who));
  if (!actor) throw new Error(who);
  town.state = withActor(
    town.state,
    how === "die"
      ? { ...actor, alive: false }
      : { ...actor, locationId: id("far"), home: id("far") },
  );
}

test("a mortal who died before the close does not decide the contest: only the living who still belong to the place are counted", () => {
  const { town, contest } = opened();
  town.blessing("athena", "m1");
  town.blessing("poseidon", "m2");
  town.blessing("poseidon", "m3");
  remove(town, "m1", "die");
  // Counted with m1 alive, Athena has 1 and Poseidon 2: Poseidon would win. Make it matter the other way too.
  town.until(() => town.state.contests.get(contest.id)?.status !== "open");
  const ending = town.contestLog().find((e) => e.kind === "contest-closed");
  if (ending?.kind !== "contest-closed" || ending.result !== "decided") {
    throw new Error("expected a decision");
  }
  expect(String(ending.winner)).toBe("poseidon");
  // The dead one's favour is not in the record.
  expect(plain(ending.favoured)).toEqual([
    { mortal: "m2", god: "poseidon" },
    { mortal: "m3", god: "poseidon" },
  ]);

  // With Athena's only favoured mortal dead and none else, nothing decides: it expires, no standing moves.
  const alone = opened();
  alone.town.blessing("athena", "m1");
  remove(alone.town, "m1", "die");
  alone.town.until(
    () => alone.town.state.contests.get(alone.contest.id)?.status !== "open",
  );
  expect(alone.town.state.contests.get(alone.contest.id)).toMatchObject({
    status: "expired",
    reason: "no-favour",
  });
  expect(alone.town.standing("athena")).toBe(0);
  expect(alone.town.standing("poseidon")).toBe(0);
});

test("a mortal who left the place before the close is not counted either, by the same rule that says who lives there", () => {
  const { town, contest } = opened();
  town.blessing("athena", "m1");
  town.blessing("poseidon", "m2");
  town.blessing("poseidon", "m3");
  remove(town, "m1", "leave");
  town.until(() => town.state.contests.get(contest.id)?.status !== "open");
  expect(String(town.state.contests.get(contest.id)?.winner)).toBe("poseidon");
  // A mortal whose home is elsewhere but who stands at the place does not belong to it: home decides.
  const visitor = opened();
  visitor.town.blessing("athena", "m1");
  visitor.town.blessing("athena", "m4");
  visitor.town.blessing("poseidon", "m2");
  visitor.town.blessing("poseidon", "m5");
  const m1 = getActor(visitor.town.state, id("m1"));
  if (!m1) throw new Error("m1");
  visitor.town.state = withActor(visitor.town.state, {
    ...m1,
    home: id("far"),
  });
  visitor.town.until(
    () =>
      visitor.town.state.contests.get(visitor.contest.id)?.status !== "open",
  );
  const ending = visitor.town
    .contestLog()
    .find((e) => e.kind === "contest-closed");
  if (ending?.kind !== "contest-closed" || ending.result !== "decided") {
    throw new Error("expected a decision");
  }
  // With m1 (homed elsewhere) out, Athena has m4 and Poseidon m2 and m5; counting m1 it would have been a draw.
  expect(String(ending.winner)).toBe("poseidon");
  expect(plain(ending.favoured)).toEqual([
    { mortal: "m2", god: "poseidon" },
    { mortal: "m4", god: "athena" },
    { mortal: "m5", god: "poseidon" },
  ]);
});

test("control: the favoured mortal alive and still at the place decides the contest", () => {
  const { town, contest } = opened();
  town.blessing("athena", "m1");
  town.blessing("poseidon", "m2");
  town.blessing("poseidon", "m3");
  // Everyone alive: Poseidon, with two, wins; and if m2 and m3 are the ones who died, Athena's m1 decides.
  town.until(() => town.state.contests.get(contest.id)?.status !== "open");
  expect(String(town.state.contests.get(contest.id)?.winner)).toBe("poseidon");

  const flipped = opened();
  flipped.town.blessing("athena", "m1");
  flipped.town.blessing("poseidon", "m2");
  remove(flipped.town, "m2", "die");
  flipped.town.until(
    () =>
      flipped.town.state.contests.get(flipped.contest.id)?.status !== "open",
  );
  expect(
    String(flipped.town.state.contests.get(flipped.contest.id)?.winner),
  ).toBe("athena");
  const ending = flipped.town
    .contestLog()
    .find((e) => e.kind === "contest-closed");
  if (ending?.kind !== "contest-closed" || ending.result !== "decided") {
    throw new Error("expected a decision");
  }
  expect(plain(ending.favoured)).toEqual([{ mortal: "m1", god: "athena" }]);
});

// --- The loser may not reopen without a new cause ---------------------------------------------------

test("a contest already open at the place holds the matter: neither god opens another until it closes", () => {
  const { town, contest } = opened();
  const fresh = town.blessing("poseidon", "m2");
  town.tick(town.contest("athena", fresh.id as EventId));
  expect(town.rejected()).toEqual(["no-progress"]);
  expect(String(town.last?.rejected[0]?.message)).toContain(contest.id);
  expect(town.contests()).toHaveLength(1);
});

test("the loser cannot open a new contest at the place over what it already contested; a new rival act after the close is a new cause, and the new contest follows the old", () => {
  const { town, contest } = opened();
  const windowAct = town.blessing("athena", "m2");
  for (const mortal of ["m3", "m4"]) town.blessing("athena", mortal);
  town.blessing("poseidon", "m5");
  town.until(() => town.state.contests.get(contest.id)?.status !== "open");
  expect(String(town.state.contests.get(contest.id)?.winner)).toBe("athena");
  expect(town.standing("poseidon")).toBe(-2);

  // What Athena did during the window is spent: the contest it fed is closed.
  town.tick(town.contest("poseidon", windowAct.id as EventId));
  expect(town.rejected()).toEqual(["no-progress"]);
  expect(town.contests()).toHaveLength(1);

  // A rival's act after the close is new.
  const fresh = town.blessing("athena", "m7");
  town.tick(town.contest("poseidon", fresh.id as EventId));
  expect(town.rejected()).toEqual([]);
  expect(town.contests()).toHaveLength(2);
  const reopened = town.contests().at(-1);
  expect(reopened).toMatchObject({
    opener: "poseidon",
    rival: "athena",
    status: "open",
  });
  expect(reopened?.succeeds).toBe(contest.id);
  const event = town
    .contestLog()
    .filter((e) => e.kind === "contest-opened")
    .at(-1);
  expect(event).toMatchObject({ succeeds: contest.id });
});

// --- Persistence and replay -------------------------------------------------------------------------

function played() {
  const town = new Town();
  const act = rivalAct(town);
  town.tick(town.contest("athena", act));
  const contest = town.contests()[0];
  if (!contest) throw new Error("no contest");
  for (const mortal of ["m2", "m3"]) town.blessing("athena", mortal);
  town.blessing("poseidon", "m4");
  return { town, contest };
}

test("replaying the log from the initial state rebuilds exactly the contests, the ledger, and the standing, open or closed", () => {
  const { town, contest } = played();
  expect(town.state.contests.get(contest.id)?.status).toBe("open");
  let rebuilt = applyEvents(town.initial, town.log);
  expect(rebuilt.contests).toEqual(town.state.contests);
  expect(rebuilt.services).toEqual(town.state.services);
  expect(rebuilt.standing).toEqual(town.state.standing);

  town.until(() => town.state.contests.get(contest.id)?.status !== "open");
  expect(town.state.standing.size).toBe(2);
  rebuilt = applyEvents(town.initial, town.log);
  expect(rebuilt.contests).toEqual(town.state.contests);
  expect(rebuilt.services).toEqual(town.state.services);
  expect(rebuilt.standing).toEqual(town.state.standing);
});

test("the codec round-trips an open contest, a closed one, the ledger, the standing, and a god's rivals; decode refuses what disagrees with itself", () => {
  const { town, contest } = played();
  for (const phase of ["open", "closed"]) {
    if (phase === "closed") {
      town.until(() => town.state.contests.get(contest.id)?.status !== "open");
    }
    const stored = JSON.parse(JSON.stringify(encode(town.state)));
    const decoded = decode(stored);
    expect(decoded.contests).toEqual(town.state.contests);
    expect(decoded.services).toEqual(town.state.services);
    expect(decoded.standing).toEqual(town.state.standing);
    expect(plain(getActor(decoded, id("athena"))?.rivals)).toEqual([
      "poseidon",
    ]);
    expect(encode(decoded)).toEqual(encode(town.state));
  }
  const stored = JSON.parse(JSON.stringify(encode(town.state)));
  const corrupt = (change: (copy: Loose) => void) => {
    const copy = JSON.parse(JSON.stringify(stored));
    change(copy);
    return copy;
  };
  for (const change of [
    (c: Loose) => {
      c.contests[0][1].opener = "nobody";
    },
    (c: Loose) => {
      c.contests[0][1].id = "evt-404";
    },
    (c: Loose) => {
      c.contests[0][1].status = "pondering";
    },
    (c: Loose) => {
      c.contests[0][1].place = "nowhere";
    },
    (c: Loose) => {
      c.contests[0][1].rival = c.contests[0][1].opener;
    },
    (c: Loose) => {
      c.contests[0][1].tallies = "m1";
    },
    (c: Loose) => {
      c.contests[0][1].tallies = [{ god: "hera", mortal: "m1", weight: 1 }];
    },
    (c: Loose) => {
      c.contests[0][1].winner = "athena";
      c.contests[0][1].status = "open";
    },
    (c: Loose) => {
      c.standing = [["athena", "square"]];
    },
    (c: Loose) => {
      c.standing = [["athena", "nowhere", 2]];
    },
    (c: Loose) => {
      c.standing = [["athena", "square", 1.5]];
    },
    (c: Loose) => {
      c.standing = [["nobody", "square", 2]];
    },
    (c: Loose) => {
      c.standing = [["athena", "square", 0]];
    },
    (c: Loose) => {
      c.standing = [
        ["athena", "square", 2],
        ["athena", "square", 3],
      ];
    },
    (c: Loose) => {
      c.standing = [["athena@square", 2]];
    },
    (c: Loose) => {
      c.services[0].god = "nobody";
    },
    (c: Loose) => {
      c.services[0].kind = "dance";
    },
    (c: Loose) => {
      c.services[0].reached = "m1";
    },
    (c: Loose) => {
      delete c.contests;
    },
    (c: Loose) => {
      delete c.services;
    },
    (c: Loose) => {
      delete c.standing;
    },
  ]) {
    expect(() => decode(corrupt(change))).toThrow();
  }
});

test("standing is kept by god and place as a structure, so ids containing @ neither collide nor fail to decode: (a@b, c) and (a, b@c) stay distinct and round-trip", () => {
  const base = pack();
  const odd: ContentPack = {
    ...base,
    locations: [
      ...base.locations,
      { id: "c", realm: "mortal", name: "C", edges: [] },
      { id: "b@c", realm: "mortal", name: "B at C", edges: [] },
    ],
    inhabitants: [
      ...base.inhabitants,
      { id: "a@b", name: "A at B", locationId: "c", deity: true },
      { id: "a", name: "A", locationId: "c", deity: true },
    ],
  };
  const town = new Town();
  town.state = createInitialWorldState(odd);
  const motif = (god: string, place: string, delta: number) =>
    town.apply({
      kind: "motif-applied",
      entityId: god,
      motif: delta > 0 ? "standing-won" : "standing-lost",
      effect: "standing",
      place,
      delta,
      threadId: "evt-1-1",
      cause: "evt-1-1",
    });
  motif("a@b", "c", 3);
  motif("a", "b@c", -2);
  expect(town.standing("a@b", "c")).toBe(3);
  expect(town.standing("a", "b@c")).toBe(-2);
  // The crossed pairs hold nothing.
  expect(town.standing("a@b", "b@c")).toBe(0);
  expect(town.standing("a", "c")).toBe(0);
  const decoded = decode(JSON.parse(JSON.stringify(encode(town.state))));
  expect(standingOf(decoded, id("a@b"), id("c"))).toBe(3);
  expect(standingOf(decoded, id("a"), id("b@c"))).toBe(-2);
  expect(standingOf(decoded, id("a@b"), id("b@c"))).toBe(0);
  expect(encode(decoded)).toEqual(encode(town.state));
  expect(applyEvents(createInitialWorldState(odd), town.log).standing).toEqual(
    town.state.standing,
  );
});

// --- Standing is capped like affinity ---------------------------------------------------------------

/** A standing motif for `god` at the square, `delta` up or down. */
function standingMotif(
  town: Town,
  god: string,
  delta: number,
  place = "square",
) {
  return town.apply({
    kind: "motif-applied",
    entityId: god,
    motif: delta > 0 ? "standing-won" : "standing-lost",
    effect: "standing",
    place,
    delta,
    threadId: "evt-1-1",
    cause: "evt-1-1",
  });
}

test("standing stops at the affinity limit in both directions: repeated wins and losses never go past it", () => {
  const town = new Town();
  for (let n = 0; n < 8; n += 1) standingMotif(town, "athena", 3);
  expect(town.standing("athena")).toBe(10);
  for (let n = 0; n < 8; n += 1) standingMotif(town, "poseidon", -3);
  expect(town.standing("poseidon")).toBe(-10);
  // Coming back from the limit moves it off the limit, not off the overshoot.
  standingMotif(town, "athena", -3);
  expect(town.standing("athena")).toBe(7);
  standingMotif(town, "poseidon", 3);
  expect(town.standing("poseidon")).toBe(-7);
  // A closed contest is held to it too: its win at the limit changes nothing more.
  const { town: held, contest } = opened();
  for (let n = 0; n < 8; n += 1) standingMotif(held, "athena", 3);
  held.blessing("athena", "m2");
  held.until(() => held.state.contests.get(contest.id)?.status !== "open");
  expect(held.standing("athena")).toBe(10);
});

test("the cap is the pack's own affinity limit, the one rule affinity keeps", () => {
  const town = new Town({}, {}, { affinityLimit: 3 });
  for (let n = 0; n < 5; n += 1) standingMotif(town, "athena", 2);
  expect(town.standing("athena")).toBe(3);
  for (let n = 0; n < 5; n += 1) standingMotif(town, "athena", -2);
  expect(town.standing("athena")).toBe(-3);
  // A raised limit raises it.
  const wide = new Town({}, {}, { affinityLimit: 20 });
  for (let n = 0; n < 5; n += 1) standingMotif(wide, "athena", 6);
  expect(wide.standing("athena")).toBe(20);
});

test("the codec refuses a stored standing outside the pack's own limit, and holds one at it", () => {
  const town = new Town();
  standingMotif(town, "athena", 10);
  const stored = JSON.parse(JSON.stringify(encode(town.state)));
  expect(decode(stored).standing).toEqual(town.state.standing);
  for (const amount of [11, -11, 1000]) {
    const copy = JSON.parse(JSON.stringify(stored));
    copy.standing = [["athena", "square", amount]];
    expect(() => decode(copy)).toThrow(/limit of 10/);
  }
  // Under a narrower limit of its own, 10 is out of range.
  const narrow = JSON.parse(JSON.stringify(stored));
  narrow.rules.memoryBalance = {
    ...narrow.rules.memoryBalance,
    affinityLimit: 5,
  };
  expect(() => decode(narrow)).toThrow(/limit of 5/);
});

// --- Standing routes a mortal's prayers ----------------------------------------------------------

test("a mortal with no patron and no affinity of its own who lives at the place prays to the god with the most standing there; a patron's mortal keeps to it", () => {
  const base = pack();
  const town = new Town();
  town.state = createInitialWorldState({
    ...base,
    inhabitants: [
      ...base.inhabitants,
      {
        id: "m8",
        name: "m8",
        locationId: "square",
        drives: { thrift: 0, appetite: 0, greed: 0, piety: 0 },
        startingInventory: [{ resource: "food", amount: 50 }],
      },
    ],
  });
  // No standing, no affinity: the old tie-break (the fewest petitions, then the first id) picks Athena, so Poseidon is a choice standing alone could make.
  expect(String(routePetition(town.state, id("m8")))).toBe("athena");
  standingMotif(town, "poseidon", 2);
  expect(String(routePetition(town.state, id("m8")))).toBe("poseidon");
  // Control: m1's patron is Hera, and Poseidon's standing, however great, does not move it.
  expect(String(routePetition(town.state, id("m1")))).toBe("hera");
  standingMotif(town, "poseidon", 2);
  expect(String(routePetition(town.state, id("m1")))).toBe("hera");
  // Without the patron, the feeling for Hera (3) is outweighed by enough standing (4).
  const unpatroned = { ...town.state, patrons: new Map() };
  expect(String(routePetition(unpatroned, id("m1")))).toBe("poseidon");
  // Standing is the place's: a mortal who lives elsewhere is not moved by it.
  expect(String(routePetition(town.state, id("far-one")))).toBe("athena");
});

test("a blessing given where Athena was not is not in her view when the blessed later walks to her: perception places it where it happened (W04)", () => {
  const town = new Town();
  town.place("athena", "altar");
  const act = town.blessing("poseidon", "m1");
  expect(town.state.services.at(-1)?.perceivedBy).not.toContain("athena");
  // Control: while m1 is still at the square, Hera, who stands there, sees the blessing.
  expect(
    (perceive(town.state, id("hera"), town.log)?.events ?? []).map((e) => e.id),
  ).toContain(act.id);
  // m1 walks to the altar, where Athena stands.
  town.tick({ actor: "m1", kind: "move", to: "altar" });
  expect(String(getActor(town.state, id("m1"))?.locationId)).toBe("altar");
  const seen = perceive(town.state, id("athena"), town.log)?.events ?? [];
  expect(seen.map((e) => e.id)).not.toContain(act.id);
  expect(seen.some((e) => e.kind === "entity-moved")).toBe(true);
  // The ledger said at the time who perceived it (Hera, at the square), and the walk adds no one to it.
  expect(town.state.services.find((a) => a.id === act.id)?.perceivedBy).toEqual(
    [id("hera")],
  );
  town.tick(town.contest("athena", act.id as EventId));
  expect(town.rejected()).toEqual(["unauthorized-claim"]);
  expect(town.contests()).toEqual([]);
  // Nor does Athena's own walk to the square, where the blessing was given, add her to those who perceived it.
  town.tick({ actor: "athena", kind: "move", to: "square" });
  expect(String(getActor(town.state, id("athena"))?.locationId)).toBe("square");
  expect(town.state.services.find((a) => a.id === act.id)?.perceivedBy).toEqual(
    [id("hera")],
  );
  town.tick(town.contest("athena", act.id as EventId));
  expect(town.rejected()).toEqual(["unauthorized-claim"]);
});

test("a contest closes at the same tick and with the same result whether the world is live or catching up", () => {
  const run = (options: TickOptions) => {
    const town = new Town({}, options);
    const act = rivalAct(town);
    town.tick(town.contest("athena", act));
    const contest = town.contests()[0];
    if (!contest) throw new Error("no contest");
    for (const mortal of ["m2", "m3"]) town.blessing("athena", mortal);
    town.until(() => town.state.contests.get(contest.id)?.status !== "open");
    return town;
  };
  const live = run({});
  const catchUp = run({ approximate: true, elapsedMs: 60_000 });
  const outline = (town: Town) =>
    town
      .contestLog()
      .map((e) => [
        e.kind,
        e.tick,
        "result" in e ? e.result : "",
        "winner" in e ? e.winner : "",
      ]);
  expect(outline(catchUp)).toEqual(outline(live));
  expect(catchUp.standing("athena")).toBe(live.standing("athena"));
  expect(catchUp.contestLog().every((e) => e.approximate)).toBe(true);
  expect(live.contestLog().every((e) => !e.approximate)).toBe(true);
});

test("a settlement's standing at a place is the same standing: a motif of standing there moves it for good", () => {
  const town = new Town();
  const cause = town.apply({
    kind: "stock-spoiled",
    entityId: "m1",
    resource: "food",
    amount: 1,
    cause: "director",
  });
  town.apply({
    kind: "motif-applied",
    entityId: "zeus",
    motif: "standing-won",
    effect: "standing",
    place: "altar",
    delta: 1,
    threadId: cause.id,
    cause: cause.id,
  });
  expect(town.standing("zeus", "altar")).toBe(1);
  town.apply({
    kind: "motif-applied",
    entityId: "zeus",
    motif: "standing-lost",
    effect: "standing",
    place: "altar",
    delta: -3,
    threadId: cause.id,
    cause: cause.id,
  });
  expect(town.standing("zeus", "altar")).toBe(-2);
});

test("a blessing is seen by everyone at the place it was given, and by no one elsewhere", async () => {
  const { perceivesEvent } = await import("./perception");
  const town = new Town();
  const blessing = town.blessing("poseidon", "m1");
  const perceives = (who: string) =>
    perceivesEvent(
      { ...town.initial },
      getActor(town.initial, id(who)) as never,
      blessing,
      [],
    );
  for (const who of ["athena", "hera", "poseidon", "m1", "m2"]) {
    expect(perceives(who)).toBe(true);
  }
  for (const who of ["zeus", "far-one"]) expect(perceives(who)).toBe(false);
});
