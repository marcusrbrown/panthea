// Where a god's practice move is legal, and what the parser may fill in for it:
// each class of rejection the gate rerun showed (a term with no recipient, a
// practice with no move, a move with no destination) reproduced with the model's
// own output as the probe saw it, then the fix that stops it, and the checks
// that the parser still refuses what is genuinely illegal. The world is real
// (the authored Greek pack, real ticks, the real validator).

import { expect, test } from "bun:test";
import type { EventId, WorldEvent } from "@panthea/contracts";
import {
  applyEvent,
  createPrng,
  perceive,
  runTick,
  submitProposal,
  toEntityId,
  type WorldState,
  withActor,
} from "@panthea/world";
import {
  buildGodContext,
  godAvailableActions,
  godIntentSchema,
  PRAYERS_HEADING,
  rememberedBy,
} from "./context";
import { buildModelProposal } from "./observation";
import { PRACTICES_HEADING } from "./practices";
import {
  actorAt,
  godProfile,
  greekState,
  withOnlyZeusAndHera,
  withoutFireSpread,
} from "./test-fixtures";

const id = toEntityId;

class Run {
  state: WorldState = withOnlyZeusAndHera(withoutFireSpread(greekState()));
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
        observationId: `obs-op-${this.n}`,
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
  /** `who` was told by `teller` that `agent` harmed `target`: a told memory with a claim. Returns the report, the cause the god may cite. */
  accused(
    who: string,
    teller: string,
    claim: { agent: string; target?: string },
    salience = 4,
  ): EventId {
    const consequence = { effect: "harm", ...claim };
    const report = this.apply({
      kind: "report-told",
      entityId: teller,
      listenerId: who,
      content: "You wronged me, and you know it.",
      claim: consequence,
    });
    this.apply({
      kind: "memory-recorded",
      memoryKind: "told",
      entityId: who,
      sourceEventId: report.id,
      teller,
      content: "You wronged me, and you know it.",
      subjects: [teller, claim.agent, ...(claim.target ? [claim.target] : [])],
      salience,
      consequence,
    });
    return report.id;
  }
  /** `mortal` prays to `god` about food that spoiled: a real petition. */
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
    }).id;
  }
  view(god: string, profile = godProfile(god)) {
    const snapshot = perceive(this.state, id(god), this.events);
    if (!snapshot) throw new Error("no snapshot");
    const remembered = rememberedBy(this.state, id(god));
    return {
      snapshot,
      remembered,
      context: buildGodContext(profile, snapshot, remembered),
      schema: godIntentSchema(profile, snapshot, remembered),
      actions: godAvailableActions(profile, snapshot, remembered),
    };
  }
  latest() {
    const thread = [...this.state.threads.values()].at(-1);
    if (!thread) throw new Error("no thread");
    return thread;
  }
}

const tell = (party: string, ticks = 100) => ({
  kind: "tell-legend",
  party,
  place: "altar",
  deadlineTicks: ticks,
});

/** A section of a prompt: its heading line and the dashed and indented lines under it. */
function sectionOf(prompt: string, heading: string): string[] {
  const lines = prompt.split("\n");
  const start = lines.indexOf(heading);
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => !l.startsWith("- ") && !l.startsWith("  "));
  return [heading, ...rest.slice(0, end < 0 ? rest.length : end)];
}
const digestOf = (prompt: string) => sectionOf(prompt, PRACTICES_HEADING);
const prayersOf = (prompt: string) => sectionOf(prompt, PRAYERS_HEADING);

/** A fresh god with a demand awaiting its answer from Hera, and a prayer of its own: Zeus, as the gate's awaiting turn shows him. */
function zeusAwaiting() {
  const run = new Run();
  const cause = run.accused("hera", "zeus", { agent: "zeus", target: "hera" });
  run.tick({
    actor: "hera",
    kind: "practice",
    move: "demand",
    counterparty: "zeus",
    cause,
    term: tell("zeus"),
  });
  return { run, thread: run.latest() };
}

/** The offering Zeus may ask of the woodcutter. */
const gift = () => ({
  kind: "make-offering",
  party: "woodcutter",
  to: "zeus",
  resource: "currency",
  amount: 1,
  deadlineTicks: 90,
});

const parses = (run: Run, god: string, intent: unknown) =>
  run.view(god).schema.parse(intent);

// --- Class 1: a term with no recipient ---------------------------------------------------------------

test("an offer on a prayer whose term leaves out `to` (the model's own output) parses: the recipient is the god offering, and the world commits it", () => {
  const run = new Run();
  const petition = run.prays("woodcutter", "zeus");
  // As the probe saw qwen3 send it: everything but `to`.
  const sent = {
    action: "practice",
    move: "offer",
    prayer: petition,
    term: {
      kind: "make-offering",
      party: "woodcutter",
      deadlineTicks: 90,
      resource: "currency",
      amount: 1,
    },
  };
  const parsed = parses(run, "zeus", sent);
  if (!parsed.ok) throw new Error(parsed.message);
  expect(parsed.value).toMatchObject({
    move: "offer",
    term: { kind: "make-offering", party: "woodcutter", to: "zeus" },
  });
  const { snapshot, remembered } = run.view("zeus");
  const built = buildModelProposal(
    id("zeus"),
    snapshot,
    parsed.value,
    remembered,
  );
  if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
  expect(runTick(run.state, createPrng(1), [built.proposal]).rejected).toEqual(
    [],
  );
});

test("an offer to a supplicant is to the god offering: an omitted `to` is filled in, and an explicit one that names anyone else is refused, not turned into something the god did not say", () => {
  const run = new Run();
  const petition = run.prays("woodcutter", "zeus");
  const offer = (over: Record<string, unknown>) => ({
    action: "practice",
    move: "offer",
    prayer: petition,
    term: {
      kind: "make-offering",
      party: "woodcutter",
      to: "zeus",
      resource: "currency",
      amount: 1,
      deadlineTicks: 90,
      ...over,
    },
  });
  // The recipient said or left out: the god offering.
  expect(parses(run, "zeus", offer({}))).toMatchObject({
    ok: true,
    value: { term: { to: "zeus" } },
  });
  const omitted = offer({});
  delete (omitted.term as Record<string, unknown>).to;
  expect(parses(run, "zeus", omitted)).toMatchObject({
    ok: true,
    value: { term: { to: "zeus" } },
  });
  // A recipient that contradicts it is refused.
  for (const to of ["woodcutter", "hera", "nobody", 7]) {
    expect([String(to), parses(run, "zeus", offer({ to })).ok]).toEqual([
      String(to),
      false,
    ]);
  }
  // What the target does not fix stays refused.
  for (const over of [
    { party: "farmer" },
    { party: "zeus" },
    { resource: "gold" },
    { amount: 0 },
    { deadlineTicks: 1 },
    { kind: "be-at" },
  ]) {
    expect([JSON.stringify(over), parses(run, "zeus", offer(over)).ok]).toEqual(
      [JSON.stringify(over), false],
    );
  }
});

test("an alliance demand whose term leaves out `to` parses: the recipient is the god making it; a `to` that is wrong is still refused", () => {
  const run = new Run();
  const cause = run.accused("zeus", "hera", { agent: "zeus", target: "hera" });
  // As the gate's Zeus sent it: the alliance, with no `to`.
  const sent = (term: Record<string, unknown>) => ({
    action: "practice",
    move: "demand",
    cause,
    term: { kind: "ally", party: "hera", deadlineTicks: 90, ...term },
  });
  const parsed = parses(run, "zeus", sent({}));
  if (!parsed.ok) throw new Error(parsed.message);
  expect(parsed.value).toMatchObject({
    move: "demand",
    term: { kind: "ally", party: "hera", to: "zeus" },
  });
  const { snapshot, remembered } = run.view("zeus");
  const built = buildModelProposal(
    id("zeus"),
    snapshot,
    parsed.value,
    remembered,
  );
  if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
  expect(runTick(run.state, createPrng(1), [built.proposal]).rejected).toEqual(
    [],
  );
  // Control: a `to` the term cannot have is refused, not silently corrected.
  for (const to of ["hera", "athena", "farmer"]) {
    expect([to, parses(run, "zeus", sent({ to })).ok]).toEqual([to, false]);
  }
  expect(parses(run, "zeus", sent({ to: "zeus" })).ok).toBe(true);
});

test("Hera's own alliance demand, and a counter, fill in the recipient too; a gift or an offering fills it in only where one god could receive it", () => {
  const run = new Run();
  const cause = run.accused("hera", "zeus", { agent: "hera", target: "zeus" });
  expect(
    parses(run, "hera", {
      action: "practice",
      move: "demand",
      cause,
      term: { kind: "ally", party: "zeus", deadlineTicks: 90 },
    }),
  ).toMatchObject({ ok: true, value: { term: { to: "hera" } } });

  // A counter binding either god of the thread: the recipient is the other of the two.
  const { run: asked, thread } = zeusAwaiting();
  expect(
    parses(asked, "zeus", {
      action: "practice",
      move: "counter",
      thread: thread.id,
      term: { kind: "ally", party: "hera", deadlineTicks: 120 },
    }),
  ).toMatchObject({
    ok: true,
    value: { term: { kind: "ally", party: "hera", to: "zeus" } },
  });

  // A gift in a two-god thread goes to the other god; an offering has one recipient while only two gods exist.
  for (const term of [
    {
      kind: "give-resource",
      party: "hera",
      resource: "divinity",
      amount: 1,
      deadlineTicks: 90,
    },
    {
      kind: "make-offering",
      party: "hera",
      resource: "divinity",
      amount: 1,
      deadlineTicks: 90,
    },
  ]) {
    expect([
      term.kind,
      parses(asked, "zeus", {
        action: "practice",
        move: "counter",
        thread: thread.id,
        term,
      }).ok,
    ]).toEqual([term.kind, true]);
  }
  // With a third god in the world an offering could go to either, so it is not guessed.
  const crowded = new Run();
  crowded.state = withActor(crowded.state, {
    id: id("athena"),
    locationId: id("great-hall"),
    alive: true,
    isDeity: true,
    capabilities: ["divine"],
    inventory: new Map([["divinity", 10]]),
    revision: 0,
  });
  const c = crowded.accused("zeus", "hera", { agent: "zeus", target: "hera" });
  const offering = {
    action: "practice",
    move: "demand",
    cause: c,
    term: {
      kind: "make-offering",
      party: "hera",
      resource: "divinity",
      amount: 1,
      deadlineTicks: 90,
    },
  };
  expect(parses(crowded, "zeus", offering).ok).toBe(false);
  expect(
    parses(crowded, "zeus", {
      ...offering,
      term: { ...offering.term, to: "athena" },
    }).ok,
  ).toBe(true);
});

// --- Class 2: a practice with no move --------------------------------------------------------------------

test("a practice that names its cause or its prayer and leaves out `move` has only one move it can be, and parses as it", () => {
  const run = new Run();
  const cause = run.accused("zeus", "hera", { agent: "zeus", target: "hera" });
  const petition = run.prays("woodcutter", "zeus");
  const demand = parses(run, "zeus", {
    action: "practice",
    cause,
    term: { kind: "ally", party: "hera", to: "zeus", deadlineTicks: 90 },
  });
  expect(demand).toMatchObject({ ok: true, value: { move: "demand", cause } });
  const offer = parses(run, "zeus", {
    action: "practice",
    prayer: petition,
    term: {
      kind: "make-offering",
      party: "woodcutter",
      to: "zeus",
      resource: "currency",
      amount: 1,
      deadlineTicks: 90,
    },
  });
  expect(offer).toMatchObject({ ok: true, value: { move: "offer", petition } });
  // A cause and a prayer together say two things: not guessed.
  expect(
    parses(run, "zeus", {
      action: "practice",
      cause,
      prayer: petition,
      term: { kind: "ally", party: "hera", deadlineTicks: 90 },
    }).ok,
  ).toBe(false);
});

test("no decision on an existing thread is ever inferred: a thread with a term and a swear, a term alone, a swear alone, or nothing, and no move, binds and changes nothing", () => {
  const { run, thread } = zeusAwaiting();
  // A prayer on offer too: a thread alone is still not read as an offer on it.
  run.prays("woodcutter", "zeus");
  const base = { action: "practice", thread: thread.id };
  for (const extra of [
    { term: tell("zeus", 120), swear: true },
    { term: tell("zeus", 120) },
    { swear: true },
    {},
  ]) {
    const refused = parses(run, "zeus", { ...base, ...extra });
    expect([JSON.stringify(extra), refused.ok]).toEqual([
      JSON.stringify(extra),
      false,
    ]);
    if (refused.ok) continue;
    expect(refused.path).toBe("move");
    expect(refused.message).toContain(
      `"accept", "counter", "refuse", "withdraw" on thread ${thread.id}`,
    );
  }
  // Said outright, each is what it says.
  expect(
    parses(run, "zeus", { ...base, move: "counter", term: tell("zeus", 120) }),
  ).toMatchObject({ ok: true, value: { move: "counter" } });
  expect(
    parses(run, "zeus", { ...base, move: "accept", swear: true }),
  ).toMatchObject({ ok: true, value: { move: "accept", swear: true } });
});

test("a payload whose fields contradict its move is refused: a selector or a term the move does not take", () => {
  const { run, thread } = zeusAwaiting();
  const cause = run.accused("zeus", "hera", { agent: "zeus", target: "hera" });
  const petition = run.prays("woodcutter", "zeus");
  const bad: Record<string, unknown>[] = [
    { move: "accept", thread: thread.id, term: tell("zeus") },
    { move: "accept", thread: thread.id, cause },
    { move: "refuse", thread: thread.id, term: tell("zeus") },
    { move: "refuse", thread: thread.id, swear: true },
    { move: "withdraw", thread: thread.id, prayer: petition },
    {
      move: "counter",
      thread: thread.id,
      term: tell("zeus", 120),
      swear: true,
    },
    { move: "counter", thread: thread.id, term: tell("zeus", 120), cause },
    { move: "demand", cause, thread: thread.id, term: tell("hera") },
    { move: "demand", cause, prayer: petition, term: tell("hera") },
    { move: "demand", cause, swear: true, term: tell("hera") },
    { move: "offer", prayer: petition, cause, term: gift() },
    { move: "offer", prayer: petition, thread: thread.id, term: gift() },
  ];
  for (const fields of bad) {
    expect([
      JSON.stringify(fields),
      parses(run, "zeus", { action: "practice", ...fields }).ok,
    ]).toEqual([JSON.stringify(fields), false]);
  }
  // Control: each with only what it takes.
  const good: Record<string, unknown>[] = [
    { move: "accept", thread: thread.id, swear: true },
    { move: "accept", thread: thread.id, swear: false },
    { move: "refuse", thread: thread.id },
    { move: "counter", thread: thread.id, term: tell("zeus", 120) },
  ];
  for (const fields of good) {
    expect([
      JSON.stringify(fields),
      parses(run, "zeus", { action: "practice", ...fields }).ok,
    ]).toEqual([JSON.stringify(fields), true]);
  }
});

test("only a cause or a prayer alone settles a missing move; either with anything that contradicts it, or both together, is refused", () => {
  const run = new Run();
  const cause = run.accused("zeus", "hera", { agent: "zeus", target: "hera" });
  const petition = run.prays("woodcutter", "zeus");
  const ally = { kind: "ally", party: "hera", deadlineTicks: 90 };
  expect(
    parses(run, "zeus", { action: "practice", cause, term: ally }),
  ).toMatchObject({ ok: true, value: { move: "demand" } });
  expect(
    parses(run, "zeus", { action: "practice", prayer: petition, term: gift() }),
  ).toMatchObject({ ok: true, value: { move: "offer" } });
  for (const extra of [
    { prayer: petition },
    { swear: true },
    { stake: "wolf" },
  ]) {
    expect([
      JSON.stringify(extra),
      parses(run, "zeus", { action: "practice", cause, term: ally, ...extra })
        .ok,
    ]).toEqual([JSON.stringify(extra), false]);
  }
  expect(
    parses(run, "zeus", {
      action: "practice",
      prayer: petition,
      term: gift(),
      cause,
    }).ok,
  ).toBe(false);
});

test("a practice that names only a thread, as the gate's Zeus sent it, is not guessed at: it is refused, and the refusal lists the exact legal moves on that thread", () => {
  const { run, thread } = zeusAwaiting();
  // The model's own output: a thread and a goal, no move.
  const sent = {
    action: "practice",
    thread: thread.id,
    goal: {
      set: {
        text: "Ensure Hera's demand is met without conflict",
        target: "hera",
      },
    },
  };
  const refused = parses(run, "zeus", sent);
  expect(refused.ok).toBe(false);
  if (refused.ok) return;
  expect(refused.path).toBe("move");
  expect(refused.message).toContain(
    `"accept", "counter", "refuse", "withdraw" on thread ${thread.id}`,
  );
  // Nothing at all is refused too, and says what is on offer.
  const bare = parses(run, "zeus", { action: "practice" });
  expect(bare.ok).toBe(false);
  if (!bare.ok) expect(bare.message).toContain(thread.id);
});

test("a move that is not legal on the thread it names is refused with what that thread does allow", () => {
  const { run, thread } = zeusAwaiting();
  // Zeus may not withdraw... he may; but he cannot demand over a thread, nor counter one that is another's to answer.
  const waiting = new Run();
  const cause = waiting.accused("hera", "zeus", {
    agent: "hera",
    target: "zeus",
  });
  waiting.tick({
    actor: "hera",
    kind: "practice",
    move: "demand",
    counterparty: "zeus",
    cause,
    term: tell("zeus"),
  });
  const mine = waiting.latest();
  const refused = parses(waiting, "hera", {
    action: "practice",
    move: "accept",
    thread: mine.id,
  });
  expect(refused.ok).toBe(false);
  if (refused.ok) return;
  expect(refused.message).toContain(`"withdraw" on thread ${mine.id}`);
  // A thread that is not the god's at all is not one it may name.
  const stranger = parses(run, "zeus", {
    action: "practice",
    move: "accept",
    thread: "evt-404",
  });
  expect(stranger.ok).toBe(false);
  // Control: the legal pair parses.
  expect(
    parses(run, "zeus", {
      action: "practice",
      move: "accept",
      thread: thread.id,
    }).ok,
  ).toBe(true);
});

// --- Class 2, the cause: guidance that names the exact legal pairs, ready to copy ------------------------------

/** The intent objects a thread's digest row writes out, in order. */
function rowIntents(
  prompt: string,
  threadId: string,
): Record<string, unknown>[] {
  return digestOf(prompt)
    .filter((line) => line.includes(`"thread":"${threadId}"`))
    .flatMap((line) =>
      [
        ...line.matchAll(/\{"action":"practice"[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g),
      ].map((m) => JSON.parse(m[0])),
    );
}

test("a thread awaiting the god lists each legal answer as an object to copy, and every one parses and is what the world would take", () => {
  const { run, thread } = zeusAwaiting();
  const text = run.view("zeus").context.prompt;
  const intents = rowIntents(text, thread.id);
  // The counter is available but not advertised as an object: nothing about this situation calls for one.
  expect(intents.map((i) => i.move)).toEqual(["accept", "refuse", "withdraw"]);
  for (const intent of intents) {
    const { snapshot, remembered, schema } = run.view("zeus");
    const parsed = schema.parse(intent);
    if (!parsed.ok)
      throw new Error(`${JSON.stringify(intent)}: ${parsed.message}`);
    const built = buildModelProposal(
      id("zeus"),
      snapshot,
      parsed.value,
      remembered,
    );
    if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
    const ran = runTick(run.state, createPrng(1), [built.proposal]);
    expect([String(intent.move), ran.rejected.map((r) => r.reason)]).toEqual([
      String(intent.move),
      [],
    ]);
  }
  // Swearing is said where it is allowed: Zeus owes the term, so he may.
  expect(digestOf(text).join("\n")).toContain('"swear":true');
});

test("an unchanged, performable demand advertises no counter example: the counter stays in the move list with its shape described, and the schema still offers it", () => {
  const { run, thread } = zeusAwaiting();
  const view = run.view("zeus");
  expect(view.remembered.threads[0]?.moves).toContain("counter");
  expect(view.remembered.threads[0]?.intents.counter).toBeUndefined();
  const row = digestOf(view.context.prompt).join("\n");
  expect(row).not.toContain('"move":"counter"');
  expect(row).toContain(`"counter" on thread "${thread.id}"`);
  expect(row).toContain("fields you leave out keep the standing term");
  const moves = (
    view.schema.jsonSchema as { properties: { move: { enum: string[] } } }
  ).properties.move.enum;
  expect(moves).toContain("counter");
  // And a counter said outright still parses.
  expect(
    parses(run, "zeus", {
      action: "practice",
      move: "counter",
      thread: thread.id,
      term: tell("zeus", 130),
    }).ok,
  ).toBe(true);
});

/** Zeus has been asked to be at the altar with time on the clock; run the clock until too little is left to get there. */
function tooLate() {
  const { run, thread } = zeusAwaiting();
  const short = new Run();
  const cause = short.accused("hera", "zeus", {
    agent: "zeus",
    target: "hera",
  });
  short.tick({
    actor: "hera",
    kind: "practice",
    move: "demand",
    counterparty: "zeus",
    cause,
    term: { kind: "be-at", party: "zeus", place: "altar", deadlineTicks: 25 },
  });
  const asked = short.latest();
  while (asked.term.deadline - short.state.tick > 2) short.tick();
  void run;
  void thread;
  return { run: short, thread: asked };
}

test("when Zeus can no longer get there in time, the digest shows the counter that fixes it: a longer deadline the world would take, and no accept", () => {
  const { run, thread } = tooLate();
  const view = run.view("zeus");
  const [row] = view.remembered.threads;
  expect(row?.moves).not.toContain("accept");
  expect(row?.moves).toContain("counter");
  const counter = row?.intents.counter as
    | { term: { deadlineTicks: number } }
    | undefined;
  expect(counter).toBeDefined();
  // It gives more time than is left, and it is legal as written.
  expect(counter?.term.deadlineTicks).toBeGreaterThan(
    thread.term.deadline - run.state.tick,
  );
  const parsed = view.schema.parse(counter);
  if (!parsed.ok) throw new Error(parsed.message);
  const built = buildModelProposal(
    id("zeus"),
    view.snapshot,
    parsed.value,
    view.remembered,
  );
  if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
  expect(runTick(run.state, createPrng(1), [built.proposal]).rejected).toEqual(
    [],
  );
  expect(digestOf(view.context.prompt).join("\n")).toContain(
    "you cannot do this in the time left",
  );
});

test("an obstacle no deadline can fix (no way there at all) advertises no counter example either", () => {
  const far = new Run();
  const cause = far.accused("hera", "zeus", { agent: "zeus", target: "hera" });
  far.tick({
    actor: "hera",
    kind: "practice",
    move: "demand",
    counterparty: "zeus",
    cause,
    term: tell("zeus"),
  });
  const square = far.state.locations.get(id("town-square"));
  if (!square) throw new Error("town-square");
  far.state = {
    ...far.state,
    locations: new Map(far.state.locations).set(id("town-square"), {
      ...square,
      edges: square.edges.filter((e) => e.to !== "altar"),
    }),
  };
  const [row] = far.view("zeus").remembered.threads;
  expect(row?.moves).not.toContain("accept");
  expect(row?.moves).toContain("counter");
  expect(row?.intents.counter).toBeUndefined();
});

test("when the god cannot accept (the term cannot be performed) or has no counteroffers left, those answers are not written out", () => {
  const { run, thread } = zeusAwaiting();
  run.state = {
    ...run.state,
    threads: new Map(run.state.threads).set(thread.id, {
      ...thread,
      counterBudgetLeft: 0,
    }),
  };
  expect(
    rowIntents(run.view("zeus").context.prompt, thread.id).map((i) => i.move),
  ).toEqual(["accept", "refuse", "withdraw"]);
  const far = new Run();
  const cause = far.accused("hera", "zeus", { agent: "zeus", target: "hera" });
  far.tick({
    actor: "hera",
    kind: "practice",
    move: "demand",
    counterparty: "zeus",
    cause,
    term: tell("zeus"),
  });
  // The place becomes unreachable for Zeus: he cannot accept it.
  const square = far.state.locations.get(id("town-square"));
  if (!square) throw new Error("town-square");
  far.state = {
    ...far.state,
    locations: new Map(far.state.locations).set(id("town-square"), {
      ...square,
      edges: square.edges.filter((e) => e.to !== "altar"),
    }),
  };
  const moves = rowIntents(
    far.view("zeus").context.prompt,
    far.latest().id,
  ).map((i) => i.move);
  expect(moves).not.toContain("accept");
  expect(moves).toContain("refuse");
});

test("a thread waiting on someone else shows its withdrawal as an object to copy", () => {
  const run = new Run();
  const cause = run.accused("hera", "zeus", { agent: "hera", target: "zeus" });
  run.tick({
    actor: "hera",
    kind: "practice",
    move: "demand",
    counterparty: "zeus",
    cause,
    term: tell("zeus"),
  });
  const mine = run.latest();
  expect(rowIntents(run.view("hera").context.prompt, mine.id)).toEqual([
    { action: "practice", move: "withdraw", thread: mine.id },
  ]);
});

// --- Class 3: a move with no destination ------------------------------------------------------------------

/** Zeus at the square, the woodcutter at the altar, a prayer, an accepted bargain: the gate's repeated turn. */
function boonOwed() {
  const run = new Run();
  run.state = actorAt(
    actorAt(run.state, "zeus", "town-square"),
    "woodcutter",
    "altar",
  );
  const petition = run.prays("woodcutter", "zeus");
  run.tick({
    actor: "zeus",
    kind: "practice",
    move: "offer",
    petition,
    term: {
      kind: "make-offering",
      party: "woodcutter",
      to: "zeus",
      resource: "currency",
      amount: 1,
      deadlineTicks: 90,
    },
  });
  const thread = run.latest();
  run.tick({
    actor: "woodcutter",
    kind: "practice",
    move: "accept",
    thread: thread.id,
    source: "routine",
  });
  return { run, petition };
}

test("a move that names a building and no destination, as the gate's Zeus sent it, is still refused: it is not a place to go, and the refusal names the ways out", () => {
  const { run } = boonOwed();
  for (const target of ["woodshed", "old-oak"]) {
    const refused = parses(run, "zeus", { action: "move", target });
    expect(refused.ok).toBe(false);
    if (refused.ok) continue;
    expect(refused.path).toBe("to");
    expect(refused.message).toContain("altar");
  }
});

test("the way to the petitioner is an object to copy, in the form the parser takes: the owed boon's first hop in the digest, and a bless once the petitioner is here", () => {
  const { run } = boonOwed();
  const owed = digestOf(run.view("zeus").context.prompt).join("\n");
  expect(owed).toContain('{"action":"move","to":"altar"}');
  // Not a bless object until the god is with the mortal: the parser would refuse it.
  expect(owed).not.toContain('"action":"bless"');
  expect(parses(run, "zeus", { action: "move", to: "altar" })).toMatchObject({
    ok: true,
  });
  // With the petitioner here, the bless is the object shown and it parses.
  const here = new Run();
  here.state = actorAt(here.state, "zeus", "altar");
  const p = here.prays("woodcutter", "zeus");
  here.state = actorAt(here.state, "woodcutter", "altar");
  const shown = prayersOf(here.view("zeus").context.prompt).join("\n");
  expect(shown).toContain(`{"action":"bless","petition":"${p}"}`);
  expect(parses(here, "zeus", { action: "bless", petition: p }).ok).toBe(true);
});

test("the crossing a prayer's way names is written with the action that reaches it", () => {
  const run = new Run();
  run.state = actorAt(run.state, "zeus", "olympus-gate");
  run.prays("farmer", "zeus");
  const prayers = prayersOf(run.view("zeus").context.prompt).join("\n");
  expect(prayers).toContain(
    '{"action":"realm-transition","to":"mountain-path"}',
  );
});

test("the schema says what `to` and `target` are for, so a destination is not named in `target`", () => {
  const { run } = boonOwed();
  const props = (
    run.view("zeus").schema.jsonSchema as {
      properties: Record<string, { description?: string }>;
    }
  ).properties;
  expect(props.to?.description).toContain("ways out");
  expect(props.target?.description).toContain("strike");
});

// --- The schema requires what a practice needs, where the decoder can hold it -----------------------------

type Condition = {
  if: {
    properties: Record<string, { const?: string; enum?: string[] }>;
    required: string[];
  };
  then: { required: string[] };
};

/** Whether `value` meets every `if`/`then` in `allOf`: a condition that holds demands its required keys. */
function meets(
  allOf: readonly Condition[],
  value: Record<string, unknown>,
): boolean {
  return allOf.every((c) => {
    const applies =
      c.if.required.every((key) => value[key] !== undefined) &&
      Object.entries(c.if.properties).every(([key, rule]) =>
        rule.const !== undefined
          ? value[key] === rule.const
          : (rule.enum ?? []).includes(value[key] as string),
      );
    return !applies || c.then.required.every((key) => value[key] !== undefined);
  });
}

const allOfOf = (schema: unknown) =>
  ((schema as { allOf?: Condition[] }).allOf ?? []) as Condition[];

test("with a practice on offer the schema requires `move` for a practice, and what each move carries; the model's own move-less outputs fail it", () => {
  const { run, thread } = zeusAwaiting();
  const schema = run.view("zeus").schema.jsonSchema;
  const conditions = allOfOf(schema);
  expect(conditions.length).toBeGreaterThan(0);
  // The outputs the probe saw: a thread and no move; a cause and a term and no move.
  expect(meets(conditions, { action: "practice", thread: thread.id })).toBe(
    false,
  );
  expect(
    meets(conditions, { action: "practice", cause: "evt-1", term: {} }),
  ).toBe(false);
  // Each move carries what it needs.
  expect(meets(conditions, { action: "practice", move: "accept" })).toBe(false);
  expect(
    meets(conditions, {
      action: "practice",
      move: "accept",
      thread: thread.id,
    }),
  ).toBe(true);
  expect(
    meets(conditions, {
      action: "practice",
      move: "counter",
      thread: thread.id,
    }),
  ).toBe(false);
  expect(
    meets(conditions, {
      action: "practice",
      move: "counter",
      thread: thread.id,
      term: {},
    }),
  ).toBe(true);
  expect(
    meets(conditions, {
      action: "practice",
      move: "refuse",
      thread: thread.id,
    }),
  ).toBe(true);
  // Other actions are untouched.
  expect(meets(conditions, { action: "wait" })).toBe(true);
  expect(meets(conditions, { action: "move", to: "altar" })).toBe(true);
});

test("a demand and an offer carry a cause or a prayer and a term; only what is on offer is required", () => {
  const run = new Run();
  const cause = run.accused("zeus", "hera", { agent: "zeus", target: "hera" });
  run.prays("woodcutter", "zeus");
  const conditions = allOfOf(run.view("zeus").schema.jsonSchema);
  expect(
    meets(conditions, { action: "practice", move: "demand", term: {} }),
  ).toBe(false);
  expect(meets(conditions, { action: "practice", move: "demand", cause })).toBe(
    false,
  );
  expect(
    meets(conditions, { action: "practice", move: "demand", cause, term: {} }),
  ).toBe(true);
  expect(
    meets(conditions, { action: "practice", move: "offer", term: {} }),
  ).toBe(false);
  expect(
    meets(conditions, {
      action: "practice",
      move: "offer",
      prayer: "evt-1",
      term: {},
    }),
  ).toBe(true);
  // No thread is on offer, so none is required of any move.
  expect(JSON.stringify(conditions)).not.toContain('"thread"');
});

test("a term carries what its kind needs: a place for the kinds that name one, a resource and an amount for a gift or an offering", () => {
  const run = new Run();
  run.accused("zeus", "hera", { agent: "zeus", target: "hera" });
  const term = (
    run.view("zeus").schema.jsonSchema as {
      properties: { term: { allOf?: Condition[] } };
    }
  ).properties.term;
  const conditions = term.allOf ?? [];
  expect(conditions.length).toBeGreaterThan(0);
  // As the probe saw it: a be-at with no place.
  expect(
    meets(conditions, { kind: "be-at", party: "zeus", deadlineTicks: 90 }),
  ).toBe(false);
  expect(
    meets(conditions, {
      kind: "be-at",
      party: "zeus",
      deadlineTicks: 90,
      place: "altar",
    }),
  ).toBe(true);
  expect(meets(conditions, { kind: "make-offering", party: "zeus" })).toBe(
    false,
  );
  expect(
    meets(conditions, {
      kind: "make-offering",
      party: "zeus",
      resource: "food",
      amount: 1,
    }),
  ).toBe(true);
  // An alliance needs nothing more: its recipient is filled in.
  expect(
    meets(conditions, { kind: "ally", party: "hera", deadlineTicks: 90 }),
  ).toBe(true);
});

test("a turn with no practice on offer has the schema it had: no conditions at all", () => {
  const run = new Run();
  const schema = run.view("zeus").schema.jsonSchema as Record<string, unknown>;
  expect(schema.allOf).toBeUndefined();
  expect(JSON.stringify(schema)).not.toContain('"if"');
});

test("the practice instructions no longer say every practice carries a term: only a demand, an offer, and a counter do", () => {
  const { run } = zeusAwaiting();
  const { instructions } = run.view("zeus").context;
  expect(instructions).not.toContain("Each carries");
  expect(instructions).toContain(
    "only a demand, an offer, and a counter carry a term",
  );
});

// --- A counter that changes only the deadline ------------------------------------------------------------------

test("a counter that names the standing term's kind and leaves out the place it has (the probe's own output) keeps that place; a counter of another kind that leaves it out is refused", () => {
  const { run, thread } = zeusAwaiting();
  const counter = (term: Record<string, unknown>) =>
    parses(run, "zeus", {
      action: "practice",
      move: "counter",
      thread: thread.id,
      term,
    });
  // The standing term is Hera's: Zeus to tell a legend at the altar.
  const same = counter({
    kind: "tell-legend",
    party: "zeus",
    deadlineTicks: 120,
  });
  expect(same).toMatchObject({
    ok: true,
    value: {
      term: {
        kind: "tell-legend",
        party: "zeus",
        place: "altar",
        deadlineTicks: 120,
      },
    },
  });
  // A place that is named is never overridden.
  expect(
    counter({
      kind: "tell-legend",
      party: "zeus",
      place: "tavern",
      deadlineTicks: 120,
    }),
  ).toMatchObject({ ok: true, value: { term: { place: "tavern" } } });
  // Another kind has no standing place to keep.
  expect(counter({ kind: "be-at", party: "zeus", deadlineTicks: 120 }).ok).toBe(
    false,
  );
  // Another party is another term: nothing is carried over.
  expect(
    counter({ kind: "tell-legend", party: "hera", deadlineTicks: 120 }).ok,
  ).toBe(false);
  // The same holds for a gift's resource and amount.
  const gift = new Run();
  const cause = gift.accused("hera", "zeus", { agent: "zeus", target: "hera" });
  gift.tick({
    actor: "hera",
    kind: "practice",
    move: "demand",
    counterparty: "zeus",
    cause,
    term: {
      kind: "give-resource",
      party: "zeus",
      to: "hera",
      resource: "divinity",
      amount: 2,
      deadlineTicks: 90,
    },
  });
  expect(
    parses(gift, "zeus", {
      action: "practice",
      move: "counter",
      thread: gift.latest().id,
      term: { kind: "give-resource", party: "zeus", deadlineTicks: 120 },
    }),
  ).toMatchObject({
    ok: true,
    value: { term: { resource: "divinity", amount: 2, to: "hera" } },
  });
});

test("the practice conditions apply only to a practice: another action carrying stray practice fields still meets the schema", () => {
  const { run, thread } = zeusAwaiting();
  const conditions = allOfOf(run.view("zeus").schema.jsonSchema);
  const stray = {
    move: "accept",
    thread: thread.id,
    term: {},
    cause: "evt-1",
    prayer: "evt-2",
  };
  for (const action of [
    { action: "wait" },
    { action: "move", to: "altar" },
    { action: "report", listener: "hera", content: "x" },
  ]) {
    // `move: "accept"` alone would demand a thread of a practice; here it is a stray field on another action.
    expect([
      action.action,
      meets(conditions, { ...action, move: "accept" }),
    ]).toEqual([action.action, true]);
    expect([action.action, meets(conditions, { ...action, ...stray })]).toEqual(
      [action.action, true],
    );
  }
  // Control: the same stray move on a practice does demand what it needs.
  expect(meets(conditions, { action: "practice", move: "accept" })).toBe(false);
  // Every condition names the action it is for.
  for (const condition of conditions) {
    expect(condition.if.properties.action).toEqual({ const: "practice" });
  }
});

test("the counter guidance says omitted fields keep the standing term", () => {
  const { run } = zeusAwaiting();
  expect(run.view("zeus").context.instructions).toContain(
    "a counter may leave out what the standing term already fixes",
  );
});
