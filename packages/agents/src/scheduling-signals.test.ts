// What the world says a god is waiting on, read for the scheduler from world
// state alone. The rule is the one the prompt's practice digest sorts its rows
// by (an accepted obligation, a boon owed, a thread awaiting the god's answer),
// kept in one place beside it, so the scheduler and the prompt cannot disagree
// about what counts. These tests hold the two together: every state here is
// read both ways and the answers must match. The world is real (the authored
// Greek pack, real ticks, the real validator).

import { expect, test } from "bun:test";
import type { EventId, WorldEvent } from "@panthea/contracts";
import {
  applyEvent,
  createPrng,
  getActor,
  runTick,
  submitProposal,
  toEntityId,
  type WorldState,
  withActor,
} from "@panthea/world";
import { rememberedBy } from "./context";
import { schedulingSignals } from "./practices";
import { greekState, withoutFireSpread } from "./test-fixtures";

const id = toEntityId;

class Run {
  state: WorldState = withoutFireSpread(greekState());
  readonly events: WorldEvent[] = [];
  private n = 0;
  apply(overrides: Record<string, unknown>): WorldEvent {
    this.n += 1;
    const event = {
      schemaVersion: 1,
      id: `evt-${this.state.tick}-${900 + this.n}`,
      sequence: this.state.lastSequence + 1,
      simTime: 0,
      tick: this.state.tick,
      correlationId: "fixture",
      causationId: "fixture",
      approximate: false,
      ...overrides,
    } as unknown as WorldEvent;
    this.state = applyEvent(this.state, event);
    this.events.push(event);
    return event;
  }
  tick(...raws: Record<string, unknown>[]) {
    const proposals = raws.map((raw) => {
      this.n += 1;
      const submitted = submitProposal({
        schemaVersion: 1,
        targets: [],
        expectedRevisions: [],
        source: "fixture",
        observationId: `obs-ss-${this.n}`,
        ...raw,
      });
      if (!submitted.ok) throw new Error(submitted.rejection.message);
      return submitted.proposal;
    });
    const result = runTick(this.state, createPrng(1), proposals);
    this.state = result.state;
    this.events.push(...result.events);
    return result;
  }
  /** `who` was told by the farmer of something: a told memory of a report, the cause `who` may cite. */
  hears(who: string, content = "Zeus visited a nymph"): EventId {
    const report = this.apply({
      kind: "report-told",
      entityId: "farmer",
      listenerId: who,
      content,
    });
    this.apply({
      kind: "memory-recorded",
      memoryKind: "told",
      entityId: who,
      sourceEventId: report.id,
      teller: "farmer",
      content,
      subjects: ["farmer", who],
      salience: 4,
    });
    return report.id as EventId;
  }
  /** A real demand: `from` asks `to` to tell a legend at the altar. */
  demand(from: string, to: string, deadlineTicks = 100) {
    const cause = this.hears(from, `${from} was wronged`);
    const ran = this.tick({
      actor: from,
      kind: "practice",
      move: "demand",
      counterparty: to,
      cause,
      term: { kind: "tell-legend", party: to, place: "altar", deadlineTicks },
    });
    expect(ran.rejected).toEqual([]);
    return this.latest();
  }
  move(actor: string, move: string, thread: EventId, extra = {}) {
    const held = this.state.threads.get(thread);
    if (!held) throw new Error("no thread");
    const ran = this.tick({
      actor,
      kind: "practice",
      move,
      thread,
      expectedRevisions: [{ entityId: thread, revision: held.revision }],
      ...extra,
    });
    expect(ran.rejected).toEqual([]);
    return this.state.threads.get(thread);
  }
  /** `mortal` prays to `god`: a real petition. */
  prays(mortal = "farmer", god = "zeus"): EventId {
    const cause = this.apply({
      kind: "stock-spoiled",
      entityId: mortal,
      resource: "food",
      amount: 1,
      cause: "director",
    });
    return this.apply({
      kind: "petition-opened",
      entityId: mortal,
      god,
      cause: cause.id,
      request: {
        kind: "help",
        need: { kind: "resource", resource: "food", amount: 1 },
      },
    }).id as EventId;
  }
  /** `god` offers terms on `petition` and `mortal` accepts: the boon is owed. */
  agreed(petition: EventId, god = "zeus", mortal = "farmer", ticks = 80) {
    this.tick({
      actor: god,
      kind: "practice",
      move: "offer",
      petition,
      term: {
        kind: "make-offering",
        party: mortal,
        to: god,
        resource: "currency",
        amount: 1,
        deadlineTicks: ticks,
      },
    });
    const thread = this.latest();
    this.tick({
      actor: mortal,
      kind: "practice",
      move: "accept",
      thread: thread.id,
      source: "routine",
    });
    expect(this.latest().status).toBe("accepted");
    return this.latest();
  }
  latest() {
    const thread = [...this.state.threads.values()].at(-1);
    if (!thread) throw new Error("no thread");
    return thread;
  }
}

const GODS = [
  "athena",
  "hades",
  "hephaestus",
  "hera",
  "hermes",
  "poseidon",
  "zeus",
].map(id);
const signalsOf = (run: Run, god: string) => {
  const found = schedulingSignals(run.state, GODS).get(id(god));
  if (found === undefined) throw new Error(`no signals for ${god}`);
  return found;
};

test("a world with no threads has no god waiting on anything: every god is asked about and none is urgent", () => {
  const run = new Run();
  const all = schedulingSignals(run.state, GODS);
  expect([...all.keys()].sort()).toEqual([...GODS].sort());
  for (const signals of all.values()) {
    expect(signals).toEqual({ obligationDeadline: undefined, awaited: false });
  }
});

// --- Awaited -----------------------------------------------------------------------------------------

test("a god a demand was made of is awaited, and the god who made it is not; after a counter it is the other way round", () => {
  const run = new Run();
  const thread = run.demand("hera", "zeus");
  expect(signalsOf(run, "zeus")).toEqual({
    obligationDeadline: undefined,
    awaited: true,
  });
  expect(signalsOf(run, "hera")).toEqual({
    obligationDeadline: undefined,
    awaited: false,
  });
  run.move("zeus", "counter", thread.id, {
    term: {
      kind: "tell-legend",
      party: "zeus",
      place: "altar",
      deadlineTicks: 150,
    },
  });
  expect(signalsOf(run, "hera").awaited).toBe(true);
  expect(signalsOf(run, "zeus").awaited).toBe(false);
});

test("a thread that has ended waits on no one: refused, withdrawn, and expired threads leave nobody awaited", () => {
  const refused = new Run();
  const t1 = refused.demand("hera", "zeus");
  refused.move("zeus", "refuse", t1.id);
  expect(signalsOf(refused, "zeus")).toEqual({
    obligationDeadline: undefined,
    awaited: false,
  });
  expect(signalsOf(refused, "hera").awaited).toBe(false);

  const withdrawn = new Run();
  const t2 = withdrawn.demand("hera", "zeus");
  withdrawn.move("hera", "withdraw", t2.id);
  expect(signalsOf(withdrawn, "zeus").awaited).toBe(false);

  const expired = new Run();
  const t3 = expired.demand("hera", "zeus");
  while (expired.state.threads.get(t3.id)?.status === "open") expired.tick();
  expect(expired.state.threads.get(t3.id)?.status).toBe("expired");
  expect(signalsOf(expired, "zeus").awaited).toBe(false);
});

// --- Owed ---------------------------------------------------------------------------------------------

test("a god that accepted a term it must perform owes it, with the term's deadline; the god it is owed to does not", () => {
  const run = new Run();
  const thread = run.demand("hera", "zeus", 120);
  run.move("zeus", "accept", thread.id);
  const held = run.latest();
  expect(held.status).toBe("accepted");
  expect(signalsOf(run, "zeus")).toEqual({
    obligationDeadline: held.term.deadline,
    awaited: false,
  });
  expect(signalsOf(run, "hera")).toEqual({
    obligationDeadline: undefined,
    awaited: false,
  });
});

test("a god that set terms on a prayer, once the mortal accepts, owes the boon, whatever its deadline, until the world has seen it given", () => {
  const run = new Run();
  const petition = run.prays();
  const thread = run.agreed(petition, "zeus", "farmer", 200);
  expect(signalsOf(run, "zeus")).toEqual({
    obligationDeadline: thread.term.deadline,
    awaited: false,
  });
  // Before the mortal answers, the god is waiting on the mortal, not owing: nothing urgent.
  const early = new Run();
  const p = early.prays();
  early.tick({
    actor: "zeus",
    kind: "practice",
    move: "offer",
    petition: p,
    term: {
      kind: "make-offering",
      party: "farmer",
      to: "zeus",
      resource: "currency",
      amount: 1,
      deadlineTicks: 80,
    },
  });
  expect(early.latest().status).toBe("open");
  expect(signalsOf(early, "zeus")).toEqual({
    obligationDeadline: undefined,
    awaited: false,
  });

  // Once the boon has been seen the debt is the mortal's offering, and the god owes nothing.
  const zeus = getActor(run.state, id("zeus"));
  const farmer = getActor(run.state, id("farmer"));
  if (!zeus || !farmer) throw new Error("actors");
  run.state = withActor(run.state, { ...zeus, locationId: farmer.locationId });
  run.tick({ actor: "zeus", kind: "bless", petition });
  expect(run.latest().progress?.boon).toBeDefined();
  expect(signalsOf(run, "zeus")).toEqual({
    obligationDeadline: undefined,
    awaited: false,
  });
});

test("the earliest of several obligations is the god's deadline", () => {
  const run = new Run();
  const late = run.demand("hera", "zeus", 400);
  run.move("zeus", "accept", late.id);
  const soon = run.demand("athena", "zeus", 60);
  run.move("zeus", "accept", soon.id);
  const deadlines = [...run.state.threads.values()].map((t) => t.term.deadline);
  expect(signalsOf(run, "zeus").obligationDeadline).toBe(
    Math.min(...deadlines),
  );
});

// --- What does not count ------------------------------------------------------------------------------

test("a prayer addressed to a god, and a contest it is in, raise nothing: the scheduler ignores both", () => {
  const run = new Run();
  run.prays("farmer", "zeus");
  run.prays("woodcutter", "hera");
  expect(signalsOf(run, "zeus")).toEqual({
    obligationDeadline: undefined,
    awaited: false,
  });
  expect(signalsOf(run, "hera")).toEqual({
    obligationDeadline: undefined,
    awaited: false,
  });
  // A prayer the god set no terms on is no debt either, even after the mortal's thread has nothing to do with it.
  expect(run.state.petitions.size).toBe(2);
});

test("wall clock is not an input: the same state read twice, a tick apart in the world's own count only, gives the same signals", () => {
  const run = new Run();
  run.demand("hera", "zeus");
  const a = schedulingSignals(run.state, GODS);
  const b = schedulingSignals({ ...run.state }, GODS);
  expect([...a.entries()]).toEqual([...b.entries()]);
});

// --- The prompt and the scheduler agree -------------------------------------------------------------

/** What the prompt's own rows say each god is waiting on, read from `practiceBy` through `rememberedBy`. */
function fromPrompt(run: Run, god: string) {
  const threads = rememberedBy(run.state, id(god)).threads;
  const owed = threads.filter((view) => view.standing === "obligation");
  return {
    obligationDeadline:
      owed.length === 0
        ? undefined
        : Math.min(...owed.map((view) => view.term.deadline)),
    awaited: threads.some((view) => view.standing === "awaiting"),
  };
}

test("for every god in a world with an accepted obligation, an owed boon, a thread awaiting an answer, and a closed thread, the scheduler's signals are what the prompt's rows say", () => {
  const run = new Run();
  // Zeus owes a boon on a prayer.
  const petition = run.prays("farmer", "zeus");
  run.agreed(petition);
  // Hera is asked for a term by Athena, who then waits on her.
  run.demand("athena", "hera");
  // Hades owes a term to Hermes, accepted.
  const owed = run.demand("hermes", "hades", 300);
  run.move("hades", "accept", owed.id);
  // Poseidon's demand of Hephaestus is refused: closed, so nothing is waiting.
  const closed = run.demand("poseidon", "hephaestus");
  run.move("hephaestus", "refuse", closed.id);

  for (const god of GODS) {
    expect([god, signalsOf(run, god)]).toEqual([god, fromPrompt(run, god)]);
  }
  // The states were all different: the check is not vacuous.
  expect(signalsOf(run, "zeus").obligationDeadline).toBeDefined();
  expect(signalsOf(run, "hades").obligationDeadline).toBeDefined();
  expect(signalsOf(run, "hera").awaited).toBe(true);
  expect(signalsOf(run, "hephaestus")).toEqual({
    obligationDeadline: undefined,
    awaited: false,
  });
});

test("the two agree after every tick of a run in which threads open, are answered, and end", () => {
  const run = new Run();
  const first = run.demand("hera", "zeus", 60);
  const second = run.demand("athena", "hades", 90);
  const check = () => {
    for (const god of GODS) {
      expect([run.state.tick, god, signalsOf(run, god)]).toEqual([
        run.state.tick,
        god,
        fromPrompt(run, god),
      ]);
    }
  };
  check();
  run.move("zeus", "accept", first.id);
  check();
  run.move("hades", "counter", second.id, {
    term: {
      kind: "tell-legend",
      party: "hades",
      place: "altar",
      deadlineTicks: 140,
    },
  });
  check();
  for (let t = 0; t < 130; t += 1) {
    run.tick();
    check();
  }
});
