// What a god is shown of its practice threads, and what it may answer with:
// the digest that leads the prompt, the one flat `practice` intent, and the
// proposal the service builds from it. The world is real (the authored Greek
// pack, real ticks, the real validator); nothing here mocks the rules.

import { expect, test } from "bun:test";
import type { EventId, WorldEvent } from "@panthea/contracts";
import {
  applyEvent,
  createPrng,
  getActor,
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
  rememberedBy,
} from "./context";
import { buildModelProposal } from "./observation";
import { NO_PRACTICE, PRACTICES_HEADING } from "./practices";
import {
  actorAt,
  godProfile,
  greekState,
  withOnlyZeusAndHera,
  withoutFireSpread,
} from "./test-fixtures";

const id = toEntityId;

/** The authored Greek world, with a way to stage causes and to commit real practice moves. */
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
        observationId: `obs-px-${this.n}`,
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
  /** `who` was told by the farmer of something Zeus did: a told memory of a report. Returns the cause `who` may cite. */
  hears(who = "hera", content = "Zeus visited a nymph"): EventId {
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
    return report.id;
  }
  /** A real demand, committed through the tick; returns the thread it opened. */
  demand(
    cause: EventId,
    options: {
      from?: string;
      to?: string;
      term?: Record<string, unknown>;
    } = {},
  ) {
    const from = options.from ?? "hera";
    const to = options.to ?? "zeus";
    const ran = this.tick({
      actor: from,
      kind: "practice",
      move: "demand",
      counterparty: to,
      cause,
      term: options.term ?? tell(to),
    });
    expect(ran.rejected).toEqual([]);
    return this.latest();
  }
  latest() {
    const thread = [...this.state.threads.values()].at(-1);
    if (!thread) throw new Error("no thread");
    return thread;
  }
  move(actor: string, move: string, threadId: EventId, extra = {}) {
    const thread = this.state.threads.get(threadId);
    if (!thread) throw new Error("no thread");
    const ran = this.tick({
      actor,
      kind: "practice",
      move,
      thread: threadId,
      expectedRevisions: [{ entityId: threadId, revision: thread.revision }],
      ...extra,
    });
    expect(ran.rejected).toEqual([]);
    return this.state.threads.get(threadId);
  }
  /** What a god sees now: its snapshot, memory, prompt, schema. */
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
}

const tell = (party: string, ticks = 100): Record<string, unknown> => ({
  kind: "tell-legend",
  party,
  place: "altar",
  deadlineTicks: ticks,
});

/** The digest: its heading and the dashed and indented lines under it. Empty when the prompt has none. */
function digestOf(prompt: string): string[] {
  const lines = prompt.split("\n");
  const start = lines.indexOf(PRACTICES_HEADING);
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => !l.startsWith("- ") && !l.startsWith("  "));
  return [PRACTICES_HEADING, ...rest.slice(0, end < 0 ? rest.length : end)];
}

/** The rows of a digest: each dashed line with its indented continuations, as one string. */
function rowsOf(digest: readonly string[]): string[] {
  const rows: string[] = [];
  for (const line of digest.slice(1)) {
    if (line.startsWith("- ")) rows.push(line);
    else rows[rows.length - 1] += `\n${line}`;
  }
  return rows;
}

/** The thread ids a digest's rows open with, in order (not the cause ids inside them). */
const threadIdsIn = (text: string) =>
  [...text.matchAll(/^- \[(evt-[^\]]+)\]/gm)].map((m) => m[1]);

/** Zeus has accepted Hera's demand: an obligation of his. */
function obligation(run = new Run()) {
  const cause = run.hears();
  const thread = run.demand(cause);
  run.move("zeus", "accept", thread.id);
  return { run, cause, thread: run.latest() };
}

// --- The digest ------------------------------------------------------------------------------

test("with an accepted obligation, the digest is the last section before the question and its first row is that obligation with its deadline", () => {
  const { run, thread } = obligation();
  const { context } = run.view("zeus");
  const lines = context.prompt.split("\n");
  // Per-tick state last (the order of a request runs from what never changes to what changes every tick): after where the god is and what it holds, and just before the question.
  expect(lines.indexOf(PRACTICES_HEADING)).toBeGreaterThan(
    lines.findIndex((l) => l.startsWith("You are at ")),
  );
  expect(lines.at(-1)).toBe("What do you do?");
  const rest = lines.slice(lines.indexOf(PRACTICES_HEADING) + 1);
  expect(rest.find((l) => !l.startsWith("- ") && !l.startsWith("  "))).toBe(
    "What do you do?",
  );
  const digest = digestOf(context.prompt);
  const [first] = rowsOf(digest);
  expect(first).toContain(`[${thread.id}]`);
  expect(first).toContain("YOU OWE hera");
  expect(first).toContain(`by tick ${thread.term.deadline}`);
  expect(first).toContain("tell a legend");
  // Accepted: nothing to answer, so no move is offered on it.
  expect(first).not.toContain("accept");
  expect(first).not.toContain("refuse");
});

test("the digest shows a thread's cause as this god knows it, the last answered move, and its legal responses; a god with no threads gets no digest", () => {
  const run = new Run();
  const cause = run.hears("hera", "Zeus visited a nymph");
  expect(digestOf(run.view("hera").context.prompt)).toEqual([]);
  expect(run.view("hera").context.prompt).not.toContain(PRACTICES_HEADING);

  const thread = run.demand(cause);
  // Hera made the demand: she knows the cause, it is hers, and she can only withdraw it.
  const hera = rowsOf(digestOf(run.view("hera").context.prompt))[0] as string;
  expect(hera).toContain(`farmer told you of it [${cause}]`);
  expect(hera).toContain("you demanded");
  expect(hera).toContain('"withdraw"');
  expect(hera).not.toContain('"accept"');

  // Zeus is asked: the cause is not his, so he is told only that she cites one he holds no account of.
  const zeus = rowsOf(digestOf(run.view("zeus").context.prompt))[0] as string;
  expect(zeus).toContain("AWAITING YOUR ANSWER");
  expect(zeus).toContain("hera demanded");
  expect(zeus).toContain("you hold no account of it");
  for (const move of ["accept", "counter", "refuse", "withdraw"]) {
    expect(zeus).toContain(`"${move}"`);
  }
  expect(zeus).toContain(`"thread":"${thread.id}"`);
});

test("after a counter, the answer is the other god's: the countering god may only withdraw, and the one who made the demand may accept the counter", () => {
  const run = new Run();
  const thread = run.demand(run.hears());
  run.move("zeus", "counter", thread.id, { term: tell("zeus", 150) });
  const zeus = rowsOf(digestOf(run.view("zeus").context.prompt))[0] as string;
  expect(zeus).toContain("you countered");
  expect(zeus).not.toContain('"accept"');
  expect(zeus).toContain('"withdraw"');
  const hera = rowsOf(digestOf(run.view("hera").context.prompt))[0] as string;
  expect(hera).toContain("AWAITING YOUR ANSWER");
  expect(hera).toContain("zeus countered");
  expect(hera).toContain('"accept"');
});

test("an obligation the god can no longer perform is marked unperformable; one it still can is not", () => {
  const run = new Run();
  const cause = run.hears();
  const thread = run.demand(cause, {
    term: {
      kind: "give-resource",
      party: "zeus",
      to: "hera",
      resource: "divinity",
      amount: 5,
      deadlineTicks: 100,
    },
  });
  run.move("zeus", "accept", thread.id);
  const row = () =>
    rowsOf(digestOf(run.view("zeus").context.prompt))[0] as string;
  expect(row()).toContain("YOU OWE hera");
  expect(row()).not.toContain("UNPERFORMABLE");
  // Zeus spends what he would have given.
  const zeus = getActor(run.state, id("zeus"));
  if (!zeus) throw new Error("zeus");
  run.state = withActor(run.state, {
    ...zeus,
    inventory: new Map(zeus.inventory).set("divinity", 0),
  });
  expect(row()).toContain("UNPERFORMABLE");
  // Hera, who is owed it, is not told his holdings.
  const hera = rowsOf(digestOf(run.view("hera").context.prompt))[0] as string;
  expect(hera).not.toContain("UNPERFORMABLE");
});

test("a no-progress reason on a thread is shown in the digest row (Unit 3 fills it)", () => {
  const run = new Run();
  run.demand(run.hears());
  const { snapshot, remembered } = run.view("zeus");
  const [view] = remembered.threads;
  if (!view) throw new Error("no thread view");
  const withReason = {
    ...remembered,
    threads: [{ ...view, noProgress: "that was already answered" }],
  };
  const text = buildGodContext(godProfile("zeus"), snapshot, withReason).prompt;
  expect(rowsOf(digestOf(text))[0]).toContain("that was already answered");
});

test("with an obligation and two other threads, the digest orders them by urgency: the obligation, the thread awaiting the god, then the rest", () => {
  const run = new Run();
  const owed = run.demand(run.hears("hera", "a"));
  run.move("zeus", "accept", owed.id);
  // Awaiting Zeus: Hera demands again. Other: Zeus's own demand of Hera, which only she can answer.
  const asked = run.demand(run.hears("hera", "b"));
  const mine = run.demand(run.hears("zeus", "c"), {
    from: "zeus",
    to: "hera",
    term: tell("hera"),
  });
  const ids = threadIdsIn(digestOf(run.view("zeus").context.prompt).join("\n"));
  expect([...new Set(ids)]).toEqual([owed.id, asked.id, mine.id]);
});

test("two threads awaiting the god are ordered by how soon their negotiation closes", () => {
  const run = new Run();
  const first = run.demand(run.hears("hera", "a"));
  run.tick();
  run.tick();
  const second = run.demand(run.hears("hera", "b"));
  expect(first.negotiationDeadline).toBeLessThan(second.negotiationDeadline);
  const ids = threadIdsIn(digestOf(run.view("zeus").context.prompt).join("\n"));
  expect([...new Set(ids)]).toEqual([first.id, second.id]);
});

test("with more threads than fit, every obligation and every thread awaiting the god still appears, and only the other threads are cut", () => {
  const run = new Run();
  const owed: EventId[] = [];
  const asked: EventId[] = [];
  const mine: EventId[] = [];
  for (let n = 0; n < 3; n += 1) {
    const thread = run.demand(run.hears("hera", `owed ${n}`));
    run.move("zeus", "accept", thread.id);
    owed.push(thread.id);
  }
  for (let n = 0; n < 3; n += 1) {
    asked.push(run.demand(run.hears("hera", `asked ${n}`)).id);
  }
  for (let n = 0; n < 6; n += 1) {
    mine.push(
      run.demand(run.hears("zeus", `mine ${n}`), {
        from: "zeus",
        to: "hera",
        term: tell("hera"),
      }).id,
    );
  }
  const digest = digestOf(run.view("zeus").context.prompt);
  const text = digest.join("\n");
  for (const required of [...owed, ...asked]) {
    expect(text).toContain(`[${required}]`);
  }
  const shownOthers = mine.filter((threadId) => text.includes(`[${threadId}]`));
  expect(shownOthers.length).toBeLessThan(mine.length);
  expect(text).toMatch(/\d+ more open threads? not shown/);
  // The rows that are shown keep their ids and the answer to give, even compressed.
  for (const required of asked) {
    const row = rowsOf(digest).find((r) => r.includes(`[${required}]`)) ?? "";
    expect(row).toContain(`"${required}"`);
  }
  // And the whole stays bounded: the mandatory rows are compressed, not the budget raised without limit.
  expect(text.length).toBeLessThan(2400);
});

test("three open threads fit the digest budget with every row in full", () => {
  const run = new Run();
  const owed = run.demand(run.hears("hera", "a"));
  run.move("zeus", "accept", owed.id);
  run.demand(run.hears("hera", "b"));
  run.demand(run.hears("zeus", "c"), {
    from: "zeus",
    to: "hera",
    term: tell("hera"),
  });
  const digest = digestOf(run.view("zeus").context.prompt);
  expect(rowsOf(digest)).toHaveLength(3);
  expect(digest.join("\n")).not.toContain("more open thread");
  expect(digest.join("\n").length).toBeLessThan(1600);
});

test("the order is by role first, then by deadline, whatever order the threads were opened in", () => {
  const run = new Run();
  // Opened first: one that only Hera can answer. Then two awaiting Zeus. Then two obligations, the later with the nearer deadline.
  const mine = run.demand(run.hears("zeus", "m"), {
    from: "zeus",
    to: "hera",
    term: tell("hera"),
  });
  const askedLate = run.demand(run.hears("hera", "a1"));
  const owedFar = run.demand(run.hears("hera", "o1"), {
    term: tell("zeus", 400),
  });
  const owedNear = run.demand(run.hears("hera", "o2"), {
    term: tell("zeus", 50),
  });
  run.move("zeus", "accept", owedFar.id);
  run.move("zeus", "accept", owedNear.id);
  const ids = threadIdsIn(digestOf(run.view("zeus").context.prompt).join("\n"));
  expect(ids).toEqual([owedNear.id, owedFar.id, askedLate.id, mine.id]);
});

test("a thread with no counteroffers left offers no counter, and one that cannot be performed offers no accept", () => {
  const run = new Run();
  const thread = run.demand(run.hears());
  const spent = {
    ...run.state,
    threads: new Map(run.state.threads).set(thread.id, {
      ...thread,
      counterBudgetLeft: 0,
    }),
  };
  const view = rememberedBy(spent, id("zeus")).threads[0];
  expect(view?.moves).toEqual(["accept", "refuse", "withdraw"]);
  expect(view?.moves).not.toContain("counter");
  // Control: with the budget, a counter is on offer.
  expect(rememberedBy(run.state, id("zeus")).threads[0]?.moves).toContain(
    "counter",
  );
  // A term Zeus cannot perform by its deadline cannot be accepted by him.
  const broke = new Run();
  const owed = broke.demand(broke.hears(), {
    term: {
      kind: "give-resource",
      party: "zeus",
      to: "hera",
      resource: "divinity",
      amount: 5,
      deadlineTicks: 100,
    },
  });
  const zeus = getActor(broke.state, id("zeus"));
  if (!zeus) throw new Error("zeus");
  broke.state = withActor(broke.state, {
    ...zeus,
    inventory: new Map(zeus.inventory).set("divinity", 0),
  });
  const moves = rememberedBy(broke.state, id("zeus")).threads.find(
    (v) => v.id === owed.id,
  )?.moves;
  expect(moves).toEqual(["counter", "refuse", "withdraw"]);
});

// --- Privacy ---------------------------------------------------------------------------------

test("the other god's private goal and unobserved evidence never appear in this god's prompt; the demanding god's own prompt does carry its evidence (positive control)", () => {
  const run = new Run();
  const secret = "SECRET-NYMPH-GROVE";
  const cause = run.hears("hera", secret);
  run.state = {
    ...run.state,
    goals: new Map(run.state.goals).set(id("hera"), {
      text: "SECRET-GOAL humble Zeus",
      target: id("zeus"),
      eventId: "evt-0-1" as EventId,
      sequence: 1,
      tick: 0,
    }),
  };
  run.demand(cause);
  const zeus = run.view("zeus");
  const text = `${zeus.context.instructions}\n${zeus.context.prompt}\n${JSON.stringify(zeus.schema.jsonSchema)}`;
  expect(text).not.toContain(secret);
  expect(text).not.toContain("SECRET-GOAL");
  expect(text).not.toContain(cause);
  // Control: Hera holds the evidence, and her own prompt shows it.
  const hera = run.view("hera");
  expect(hera.context.prompt).toContain(`farmer told you: "${secret}"`);
  expect(hera.context.prompt).toContain(`[${cause}]`);
});

test("a cause the god does know, told or seen, is shown to it in its own terms even when the other party made the demand", () => {
  const run = new Run();
  const cause = run.hears("hera", "Zeus visited a nymph");
  // Zeus heard of the same report himself.
  run.apply({
    kind: "memory-recorded",
    memoryKind: "told",
    entityId: "zeus",
    sourceEventId: cause,
    teller: "farmer",
    content: "Zeus visited a nymph",
    subjects: ["farmer"],
    salience: 4,
  });
  run.demand(cause);
  const row = rowsOf(digestOf(run.view("zeus").context.prompt))[0] as string;
  expect(row).toContain("farmer told you");
  expect(row).not.toContain("no account");
});

// --- The intent ------------------------------------------------------------------------------

test("practice is offered only when a thread has a move to make or a known cause could open a demand", () => {
  const run = new Run();
  expect(run.view("hera").actions).not.toContain("practice");
  expect(
    (run.view("hera").schema.jsonSchema as { properties: object }).properties,
  ).not.toHaveProperty("move");
  const cause = run.hears("hera");
  const demandable = run.view("hera");
  expect(demandable.actions).toContain("practice");
  expect(demandable.actions.at(-1)).toBe("wait");
  const properties = (
    demandable.schema.jsonSchema as {
      properties: Record<string, { enum?: string[] }>;
    }
  ).properties;
  expect(properties.move?.enum).toEqual(["demand"]);
  expect(properties.cause?.enum).toEqual([cause]);
  // Control: a god with nothing remembered and no thread (Zeus) is not offered it.
  expect(run.view("zeus").actions).not.toContain("practice");
  // And a god who must answer a thread is, with no cause of its own.
  run.demand(cause);
  expect(run.view("zeus").actions).toContain("practice");
});

test("the schema stays flat: one practice object with move, thread, cause, and one term, never a per-kind anyOf", () => {
  const run = new Run();
  const cause = run.hears();
  run.demand(cause);
  const schema = run.view("zeus").schema.jsonSchema as {
    properties: Record<string, Record<string, unknown>>;
  };
  expect(JSON.stringify(schema)).not.toContain("anyOf");
  expect(JSON.stringify(schema)).not.toContain("oneOf");
  expect(schema.properties.move).toBeDefined();
  expect(schema.properties.thread?.enum).toEqual([run.latest().id]);
  const term = schema.properties.term as {
    properties: Record<string, { enum?: string[] }>;
  };
  expect(term.properties.kind?.enum).toEqual([
    "tell-legend",
    "be-at",
    "stay-away",
    "give-resource",
    "bless-mortal",
    "make-offering",
    "ally",
  ]);
  expect(term.properties.party?.enum).toContain("hera");
  expect(term.properties.place?.enum).toContain("altar");
});

test("a valid accept parses and builds a proposal pinned only to the thread's revision, which the world then commits", () => {
  const run = new Run();
  const thread = run.demand(run.hears());
  const { snapshot, remembered, schema } = run.view("zeus");
  const parsed = schema.parse({
    action: "practice",
    move: "accept",
    thread: thread.id,
    swear: true,
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const built = buildModelProposal(
    id("zeus"),
    snapshot,
    parsed.value,
    remembered,
  );
  if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
  expect(built.proposal).toMatchObject({
    kind: "practice",
    move: "accept",
    thread: thread.id,
    swear: true,
    source: "model",
    expectedRevisions: [{ entityId: thread.id, revision: thread.revision }],
  });
  expect(built.proposal.expectedRevisions).toHaveLength(1);
  expect(built.observation.factsRead).toContain(`thread:${thread.id}`);
  const ran = runTick(run.state, createPrng(1), [built.proposal]);
  expect(ran.rejected).toEqual([]);
  expect(ran.state.threads.get(thread.id)?.status).toBe("accepted");
  expect(ran.state.threads.get(thread.id)?.acceptance?.sworn).toBe(true);
});

test("the pin is real: the thread moved while the god thought, so its answer is refused stale-target", () => {
  const run = new Run();
  const thread = run.demand(run.hears());
  const { snapshot, remembered, schema } = run.view("zeus");
  const parsed = schema.parse({
    action: "practice",
    move: "refuse",
    thread: thread.id,
  });
  if (!parsed.ok) throw new Error("did not parse");
  const built = buildModelProposal(
    id("zeus"),
    snapshot,
    parsed.value,
    remembered,
  );
  if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
  // Hera withdraws while Zeus thinks.
  run.move("hera", "withdraw", thread.id);
  const ran = runTick(run.state, createPrng(1), [built.proposal]);
  expect(ran.rejected.map((r) => r.reason)).toEqual(["stale-target"]);
});

test("an unrelated change to the world does not stale a practice move: it pins only its thread", () => {
  const run = new Run();
  const thread = run.demand(run.hears());
  const { snapshot, remembered, schema } = run.view("zeus");
  const parsed = schema.parse({
    action: "practice",
    move: "refuse",
    thread: thread.id,
  });
  if (!parsed.ok) throw new Error("did not parse");
  const built = buildModelProposal(
    id("zeus"),
    snapshot,
    parsed.value,
    remembered,
  );
  if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
  // Zeus's own location and goods change, and so does the world around him.
  const zeus = getActor(run.state, id("zeus"));
  if (!zeus) throw new Error("zeus");
  run.state = withActor(run.state, {
    ...zeus,
    revision: zeus.revision + 5,
    inventory: new Map(zeus.inventory).set("divinity", 3),
  });
  run.tick();
  const ran = runTick(run.state, createPrng(1), [built.proposal]);
  expect(ran.rejected).toEqual([]);
  expect(ran.state.threads.get(thread.id)?.status).toBe("refused");
});

test("each move parses only against the threads it is legal on: the exact (move, thread) pairs the digest lists", () => {
  const run = new Run();
  const asked = run.demand(run.hears("hera", "a"));
  const mine = run.demand(run.hears("zeus", "b"), {
    from: "zeus",
    to: "hera",
    term: tell("hera"),
  });
  const owed = run.demand(run.hears("hera", "c"));
  run.move("zeus", "accept", owed.id);
  const { schema } = run.view("zeus");
  const ok = (move: string, thread: EventId, extra = {}) =>
    schema.parse({ action: "practice", move, thread, ...extra }).ok;
  // Awaiting Zeus: all four.
  expect(ok("accept", asked.id)).toBe(true);
  expect(ok("refuse", asked.id)).toBe(true);
  expect(ok("withdraw", asked.id)).toBe(true);
  expect(ok("counter", asked.id, { term: tell("zeus", 120) })).toBe(true);
  // His own offer: only withdraw.
  expect(ok("withdraw", mine.id)).toBe(true);
  for (const move of ["accept", "refuse"])
    expect(ok(move, mine.id)).toBe(false);
  expect(ok("counter", mine.id, { term: tell("hera", 120) })).toBe(false);
  // An accepted obligation: no move at all.
  for (const move of ["accept", "refuse", "withdraw"]) {
    expect(ok(move, owed.id)).toBe(false);
  }
  expect(ok("counter", owed.id, { term: tell("zeus", 120) })).toBe(false);
  // Not a thread he is party to, or not a thread at all.
  expect(ok("accept", "evt-404" as EventId)).toBe(false);
});

test("an accept for a thread this god is not party to is refused at parse", () => {
  const run = new Run();
  // A third god, and a thread between Hera and her.
  run.state = withActor(run.state, {
    id: id("athena"),
    locationId: id("great-hall"),
    alive: true,
    isDeity: true,
    capabilities: ["divine"],
    inventory: new Map([["divinity", 10]]),
    revision: 0,
  });
  const cause = run.hears("hera");
  const stranger = run.demand(cause, {
    from: "hera",
    to: "athena",
    term: tell("athena"),
  });
  const zeus = run.view("zeus");
  expect(
    zeus.schema.parse({
      action: "practice",
      move: "accept",
      thread: stranger.id,
    }).ok,
  ).toBe(false);
  expect(JSON.stringify(zeus.context)).not.toContain(stranger.id);
  // A gift goes to the other god of a thread, never to a third: with Athena in the world, Zeus still cannot counter a gift to her.
  const own = run.demand(cause, {
    from: "hera",
    to: "zeus",
    term: tell("zeus"),
  });
  const toAthena = run.view("zeus").schema.parse({
    action: "practice",
    move: "counter",
    thread: own.id,
    term: {
      kind: "give-resource",
      party: "zeus",
      to: "athena",
      resource: "divinity",
      amount: 1,
      deadlineTicks: 50,
    },
  });
  expect(toAthena.ok).toBe(false);
  expect(
    run.view("zeus").schema.parse({
      action: "practice",
      move: "counter",
      thread: own.id,
      term: {
        kind: "give-resource",
        party: "zeus",
        to: "hera",
        resource: "divinity",
        amount: 1,
        deadlineTicks: 50,
      },
    }).ok,
  ).toBe(true);
  // Control: Athena can answer the first.
  expect(
    run
      .view("athena", { ...godProfile("hera"), id: id("athena") } as never)
      .schema.parse({ action: "practice", move: "accept", thread: stranger.id })
      .ok,
  ).toBe(true);
});

test("a term outside the checkable set, or with a missing or unlisted field, is refused at parse; the well-formed terms parse", () => {
  const run = new Run();
  const cause = run.hears();
  const thread = run.demand(cause);
  const { schema } = run.view("zeus");
  const counter = (term: unknown) =>
    schema.parse({
      action: "practice",
      move: "counter",
      thread: thread.id,
      term,
    }).ok;
  expect(counter(tell("zeus", 120))).toBe(true);
  expect(counter(tell("hera", 120))).toBe(true);
  expect(
    counter({
      kind: "be-at",
      party: "zeus",
      place: "altar",
      deadlineTicks: 50,
    }),
  ).toBe(true);
  expect(
    counter({
      kind: "stay-away",
      party: "hera",
      place: "tavern",
      deadlineTicks: 50,
    }),
  ).toBe(true);
  expect(
    counter({
      kind: "give-resource",
      party: "zeus",
      to: "hera",
      resource: "divinity",
      amount: 2,
      deadlineTicks: 50,
    }),
  ).toBe(true);
  expect(
    counter({
      kind: "make-offering",
      party: "zeus",
      to: "hera",
      resource: "food",
      amount: 1,
      deadlineTicks: 50,
    }),
  ).toBe(true);
  // Not in the closed set, or malformed.
  for (const bad of [
    { kind: "swear-fealty", party: "zeus", deadlineTicks: 50 },
    // A counter of the standing term's own kind keeps the place that stands (see practice-legality.test.ts); another kind has none to keep.
    { kind: "be-at", party: "zeus", deadlineTicks: 50 },
    { kind: "tell-legend", party: "zeus", place: "nowhere", deadlineTicks: 50 },
    { kind: "tell-legend", party: "athena", place: "altar", deadlineTicks: 50 },
    { kind: "tell-legend", party: "zeus", place: "altar" },
    { kind: "tell-legend", party: "zeus", place: "altar", deadlineTicks: 0 },
    {
      kind: "tell-legend",
      party: "zeus",
      place: "altar",
      deadlineTicks: 100000,
    },
    { kind: "tell-legend", party: "zeus", place: "altar", deadlineTicks: 50.5 },
    {
      kind: "give-resource",
      party: "zeus",
      to: "hera",
      resource: "divinity",
      deadlineTicks: 50,
    },
    {
      kind: "give-resource",
      party: "zeus",
      to: "zeus",
      resource: "divinity",
      amount: 1,
      deadlineTicks: 50,
    },
    {
      kind: "make-offering",
      party: "zeus",
      to: "farmer",
      resource: "food",
      amount: 1,
      deadlineTicks: 50,
    },
    { kind: "bless-mortal", party: "zeus", mortal: "hera", deadlineTicks: 50 },
    "tell a legend",
    null,
  ]) {
    expect([JSON.stringify(bad), counter(bad)]).toEqual([
      JSON.stringify(bad),
      false,
    ]);
  }
  // A counter with no term is not a counter.
  expect(
    schema.parse({ action: "practice", move: "counter", thread: thread.id }).ok,
  ).toBe(false);
  expect(
    schema.parse({ action: "practice", move: "dance", thread: thread.id }).ok,
  ).toBe(false);
  expect(schema.parse({ action: "practice", thread: thread.id }).ok).toBe(
    false,
  );
});

test("a demand rests on a cause this god knows: the shown ids parse, an invented or another's does not, and the proposal opens a thread with no pin", () => {
  const run = new Run();
  const cause = run.hears("hera", "Zeus visited a nymph");
  const { snapshot, remembered, schema } = run.view("hera");
  const demand = (c: string, term: unknown = tell("zeus")) =>
    schema.parse({ action: "practice", move: "demand", cause: c, term });
  for (const bad of ["evt-404", "", "hera"]) {
    expect(demand(bad).ok).toBe(false);
  }
  // A demand binds the god it is made of: no other party, and not herself.
  expect(demand(cause, tell("hera")).ok).toBe(false);
  expect(demand(cause, tell("athena")).ok).toBe(false);
  expect(
    schema.parse({ action: "practice", move: "demand", term: tell("zeus") }).ok,
  ).toBe(false);

  const parsed = demand(cause);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const built = buildModelProposal(
    id("hera"),
    snapshot,
    parsed.value,
    remembered,
  );
  if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
  expect(built.proposal).toMatchObject({
    kind: "practice",
    move: "demand",
    counterparty: "zeus",
    cause,
    term: {
      kind: "tell-legend",
      party: "zeus",
      place: "altar",
      deadlineTicks: 100,
    },
    expectedRevisions: [],
  });
  expect(built.observation.factsRead.some((f) => f.startsWith("memory:"))).toBe(
    true,
  );
  const ran = runTick(run.state, createPrng(1), [built.proposal]);
  expect(ran.rejected).toEqual([]);
  expect(ran.state.threads.size).toBe(1);
});

test("the prompt lists the causes a god may open a demand on, and only those it is shown", () => {
  const run = new Run();
  const cause = run.hears("hera", "Zeus visited a nymph");
  const { context } = run.view("hera");
  expect(context.instructions).toContain("demand");
  expect(context.instructions).toContain(`[${cause}] farmer told you of it`);
  // Zeus knows of nothing: he is told nothing of demands.
  const zeus = run.view("zeus").context;
  expect(zeus.instructions).not.toContain('action "practice"');
});

// --- Size ------------------------------------------------------------------------------------

test("prompt size on Zeus after the tavern strike: nothing, one awaiting thread, and an obligation with two others stay within the 4K budget", () => {
  const sizes: Record<string, number> = {};
  const measure = (label: string, run: Run, god = "zeus") => {
    const { context, schema, snapshot, remembered } = run.view(god);
    const text = `${context.instructions}\n\n${context.prompt}`;
    sizes[label] = text.length;
    sizes[`${label} schema`] = JSON.stringify(schema.jsonSchema).length;
    // The same turn as the code before practices drew it: no digest, no practice paragraph, no practice properties.
    const before = buildGodContext(godProfile(god), snapshot, {
      ...remembered,
      threads: [],
      practice: NO_PRACTICE,
    });
    sizes[`${label} before`] =
      `${before.instructions}\n\n${before.prompt}`.length;
    sizes[`${label} schema before`] = JSON.stringify(
      godIntentSchema(godProfile(god), snapshot, {
        ...remembered,
        threads: [],
        practice: NO_PRACTICE,
      }).jsonSchema,
    ).length;
    return text;
  };
  const struckWorld = () => {
    const run = new Run();
    run.state = withoutFireSpread(
      actorAt(
        actorAt(actorAt(run.state, "zeus", "tavern"), "hera", "town-square"),
        "farmer",
        "tavern",
      ),
    );
    const struck = run.tick({
      actor: "zeus",
      kind: "strike",
      target: "the-tavern",
      power: 3,
    });
    expect(struck.rejected).toEqual([]);
    return run;
  };

  const none = struckWorld();
  const base = measure("no thread", none);

  const one = struckWorld();
  one.demand(one.hears("hera", "Zeus burned the tavern"));
  const awaiting = measure("one awaiting thread", one);

  const three = struckWorld();
  const owed = three.demand(three.hears("hera", "Zeus burned the tavern"));
  three.move("zeus", "accept", owed.id);
  three.demand(three.hears("hera", "Zeus was seen again"));
  three.demand(three.hears("zeus", "Hera is angry"), {
    from: "zeus",
    to: "hera",
    term: tell("hera"),
  });
  const busy = measure("obligation + 2 others", three);
  // The same, with the last move refused: the one line the refusal adds.
  const refusal = {
    kind: "practice-refused",
    entityId: "zeus",
    attempted: "demand",
    reason: "no-progress",
    why: "that was already answered: hera refused it (evt-1-3); a demand on the same matter needs a cause you learned since it closed",
  } as unknown as WorldEvent;
  const refused = withRefusal(three, "zeus", refusal);
  sizes["obligation + 2 others + refusal"] =
    `${refused.context.instructions}\n\n${refused.context.prompt}`.length;

  // The digest leads, the instructions grow by one short paragraph, and each stays under the 4K-token context (about 16K characters).
  expect(awaiting.length).toBeGreaterThan(base.length);
  expect(busy.length).toBeLessThan(16_000);
  console.log(`PROMPT_SIZE_PRACTICES ${JSON.stringify(sizes)}`);
});

// --- Events the god sees ---------------------------------------------------------------------

test("the event stream a god's turn reads is unaffected: practice events are private and never perceived", () => {
  const run = new Run();
  const thread = run.demand(run.hears());
  run.move("zeus", "refuse", thread.id);
  const seen = perceive(run.state, id("zeus"), run.events)?.events ?? [];
  expect(
    seen.map((e) => e.kind).filter((k) => k.startsWith("practice")),
  ).toEqual([]);
});

// --- Alliances, and swearing only to what one owes ---------------------------------------------

const ally = (
  party: string,
  to: string,
  ticks = 100,
): Record<string, unknown> => ({
  kind: "ally",
  party,
  to,
  deadlineTicks: ticks,
});

test("an alliance is a term a god may offer: it is in the schema, parses in a demand and a counter, and binds only the two gods of the thread", () => {
  const run = new Run();
  const cause = run.hears("hera");
  const hera = run.view("hera");
  const term = (
    hera.schema.jsonSchema as {
      properties: { term: { properties: { kind: { enum: string[] } } } };
    }
  ).properties.term.properties.kind.enum;
  expect(term).toContain("ally");
  const demand = (t: unknown) =>
    hera.schema.parse({ action: "practice", move: "demand", cause, term: t })
      .ok;
  // Hera asks Zeus to ally with her: he is the party, she the other.
  expect(demand(ally("zeus", "hera"))).toBe(true);
  expect(demand(ally("zeus", "zeus"))).toBe(false);
  expect(demand(ally("zeus", "athena"))).toBe(false);
  expect(demand(ally("hera", "zeus"))).toBe(false);
  // The recipient of an alliance is fixed by who is making it, so leaving it out is not a reason to refuse.
  expect(demand({ kind: "ally", party: "zeus", deadlineTicks: 100 })).toBe(
    true,
  );

  const thread = run.demand(cause, { term: ally("zeus", "hera") });
  const zeus = run.view("zeus");
  const counter = (t: unknown) =>
    zeus.schema.parse({
      action: "practice",
      move: "counter",
      thread: thread.id,
      term: t,
    }).ok;
  expect(counter(ally("hera", "zeus"))).toBe(true);
  expect(counter(ally("zeus", "hera"))).toBe(true);
  expect(counter(ally("zeus", "zeus"))).toBe(false);
});

test("the digest and the prompt say an alliance in words, and the instructions name it among the terms", () => {
  const run = new Run();
  const cause = run.hears("hera");
  const thread = run.demand(cause, { term: ally("zeus", "hera") });
  const row = rowsOf(digestOf(run.view("zeus").context.prompt))[0] as string;
  expect(row).toContain("you must ally with hera");
  const heraRow = rowsOf(
    digestOf(run.view("hera").context.prompt),
  )[0] as string;
  expect(heraRow).toContain("zeus must ally with you");
  expect(run.view("hera").context.instructions).toContain("ally");
  expect(thread.term.kind).toBe("ally");
});

test("an alliance offered by a model is built, committed, and sealed by the world: accepting it makes the two gods allies", () => {
  const run = new Run();
  const cause = run.hears("hera");
  const { snapshot, remembered, schema } = run.view("hera");
  const parsed = schema.parse({
    action: "practice",
    move: "demand",
    cause,
    term: ally("zeus", "hera"),
  });
  if (!parsed.ok) throw new Error(parsed.message);
  const built = buildModelProposal(
    id("hera"),
    snapshot,
    parsed.value,
    remembered,
  );
  if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
  expect(built.proposal).toMatchObject({
    kind: "practice",
    move: "demand",
    term: { kind: "ally", party: "zeus", to: "hera", deadlineTicks: 100 },
  });
  const ran = runTick(run.state, createPrng(1), [built.proposal]);
  expect(ran.rejected).toEqual([]);
  run.state = ran.state;
  const thread = run.latest();
  const after = run.move("zeus", "accept", thread.id);
  expect(after?.status).toBe("fulfilled");
  expect(run.state.relationships.get("hera>zeus" as never)?.allied).toBe(true);
});

test("a god is offered swear only on a thread whose term it must perform: the schema carries it then, the row says so, and a swear anywhere else is refused at parse", () => {
  const run = new Run();
  // Zeus owes: Hera demanded of him. He may swear it.
  const owedToHera = run.demand(run.hears("hera", "a"));
  const zeus = run.view("zeus");
  const zeusProps = (
    zeus.schema.jsonSchema as { properties: Record<string, unknown> }
  ).properties;
  expect(zeusProps.swear).toBeDefined();
  expect(
    zeus.schema.parse({
      action: "practice",
      move: "accept",
      thread: owedToHera.id,
      swear: true,
    }).ok,
  ).toBe(true);
  const zeusRow = rowsOf(digestOf(zeus.context.prompt))[0] as string;
  expect(zeusRow).toContain('"swear":true');

  // Hera answers Zeus's counter, which binds Zeus: she does not owe it, so she may not swear it.
  run.move("zeus", "counter", owedToHera.id, { term: tell("zeus", 150) });
  const hera = run.view("hera");
  expect(
    hera.schema.parse({
      action: "practice",
      move: "accept",
      thread: owedToHera.id,
    }).ok,
  ).toBe(true);
  expect(
    hera.schema.parse({
      action: "practice",
      move: "accept",
      thread: owedToHera.id,
      swear: true,
    }).ok,
  ).toBe(false);
  expect(
    (hera.schema.jsonSchema as { properties: Record<string, unknown> })
      .properties.swear,
  ).toBeUndefined();
  const heraRow = rowsOf(digestOf(hera.context.prompt))[0] as string;
  expect(heraRow).not.toContain("swear");
  // A swear of false is no swear, and is fine anywhere.
  expect(
    hera.schema.parse({
      action: "practice",
      move: "accept",
      thread: owedToHera.id,
      swear: false,
    }).ok,
  ).toBe(true);
});

test("the world agrees with the parser: a swear the god may not make would have been refused, and one it may make commits sworn", () => {
  const run = new Run();
  const thread = run.demand(run.hears());
  run.move("zeus", "counter", thread.id, { term: tell("zeus", 150) });
  const refused = run.tick({
    actor: "hera",
    kind: "practice",
    move: "accept",
    thread: thread.id,
    swear: true,
  });
  expect(refused.rejected.map((r) => r.reason)).toEqual(["unauthorized-claim"]);
  const sworn = new Run();
  const owed = sworn.demand(sworn.hears());
  expect(
    sworn.move("zeus", "accept", owed.id, { swear: true })?.acceptance?.sworn,
  ).toBe(true);
});

// --- What a god remembers of an ending ---------------------------------------------------------

test("a god who took part in a thread that ended remembers it in readable words, never as a raw event kind", () => {
  const run = new Run();
  const thread = run.demand(run.hears());
  run.move("zeus", "refuse", thread.id);
  for (const god of ["zeus", "hera"]) {
    const { context, remembered } = run.view(god);
    expect(
      remembered.memories.some(
        (m) => m.kind === "witnessed" && m.eventKind === "practice-moved",
      ),
    ).toBe(true);
    expect(context.prompt).not.toContain("practice-moved");
    expect(context.prompt).not.toContain("practice-ended");
    expect(context.prompt).toContain(
      god === "zeus"
        ? "- you refused hera's offer ["
        : "- zeus refused your offer [",
    );
  }
});

test("an ending, a motif, and a restored access in a god's own memory never crash the prompt or the schema, and an ending can be the cause of a later demand", () => {
  const run = new Run();
  const thread = run.demand(run.hears("hera", "Zeus visited a nymph"));
  run.move("zeus", "refuse", thread.id);
  // The ending memory is a shown memory: Hera may demand over how it ended.
  const view = run.view("hera");
  const ending = view.remembered.memories.find(
    (m) => m.kind === "witnessed" && m.eventKind === "practice-moved",
  );
  if (!ending) throw new Error("no ending memory");
  expect(view.remembered.practice.causes.map((c) => c.id)).toContain(
    ending.sourceEventId,
  );
  expect(view.context.instructions).toContain(
    `[${ending.sourceEventId}] zeus refused your offer`,
  );
  expect(
    view.schema.parse({
      action: "practice",
      move: "demand",
      cause: ending.sourceEventId,
      term: tell("zeus"),
    }).ok,
  ).toBe(true);
  // The private motif events are in no one's perception and in no prompt.
  run.apply({
    kind: "access-restored",
    entityId: "zeus",
    capability: "divine",
    motifEventId: "evt-0-1",
  });
  const text =
    JSON.stringify(run.view("zeus").context) +
    JSON.stringify(run.view("zeus").schema.jsonSchema);
  expect(text).not.toContain("access-restored");
  expect(text).not.toContain("motif-applied");
});

test("a sworn breach is lived through: the oath-breaker's prompt and schema still build, the penalty events appear nowhere in them, and both gods remember the ending in words", () => {
  const run = new Run();
  const thread = run.demand(run.hears());
  run.move("zeus", "accept", thread.id, { swear: true });
  while (run.state.threads.get(thread.id)?.status === "accepted") run.tick();
  expect(run.state.threads.get(thread.id)?.status).toBe("breached");
  const kinds = new Set(run.events.map((e) => e.kind));
  expect(kinds.has("motif-applied")).toBe(true);
  for (const god of ["zeus", "hera"]) {
    const { context, schema, actions } = run.view(god);
    expect(actions.at(-1)).toBe("wait");
    const text = `${context.instructions}\n${context.prompt}\n${JSON.stringify(schema.jsonSchema)}`;
    for (const raw of [
      "practice-ended",
      "practice-moved",
      "motif-applied",
      "access-restored",
    ]) {
      expect(text).not.toContain(raw);
    }
    expect(context.prompt).toContain(
      god === "zeus"
        ? "- you breached the sworn term to hera ["
        : "- zeus breached the sworn term to you [",
    );
  }
});

// --- How things ended, in the god's own words --------------------------------------------------

/** The line `who` holds about the ending of its thread, from the "You remember" section. */
const endingLine = (run: Run, who: string) =>
  run
    .view(who)
    .context.prompt.split("\n")
    .filter(
      (l) =>
        l.startsWith("- ") &&
        /\[evt-[^\]]+\]$/.test(l) &&
        !l.includes("told you"),
    )
    .at(-1);

test("each way a thread can end is remembered as what it was and who decided it: a refusal, a sworn breach, a kept term, a sealed alliance, a lapse, a withdrawal, and a death", () => {
  const refused = new Run();
  refused.move("zeus", "refuse", refused.demand(refused.hears()).id);
  expect(endingLine(refused, "zeus")).toContain("you refused hera's offer");
  expect(endingLine(refused, "hera")).toContain("zeus refused your offer");

  const sworn = new Run();
  const owed = sworn.demand(sworn.hears(), { term: tell("zeus", 30) });
  sworn.move("zeus", "accept", owed.id, { swear: true });
  while (sworn.state.threads.get(owed.id)?.status === "accepted") sworn.tick();
  expect(endingLine(sworn, "zeus")).toContain(
    "you breached the sworn term to hera",
  );
  expect(endingLine(sworn, "hera")).toContain(
    "zeus breached the sworn term to you",
  );

  const unsworn = new Run();
  const plain = unsworn.demand(unsworn.hears(), { term: tell("zeus", 30) });
  unsworn.move("zeus", "accept", plain.id);
  while (unsworn.state.threads.get(plain.id)?.status === "accepted")
    unsworn.tick();
  expect(endingLine(unsworn, "hera")).toContain(
    "zeus breached the term to you",
  );
  expect(endingLine(unsworn, "hera")).not.toContain("sworn");

  const kept = new Run();
  const keep = kept.demand(kept.hears(), {
    term: {
      kind: "be-at",
      party: "zeus",
      place: "olympus-gate",
      deadlineTicks: 30,
    },
  });
  kept.move("zeus", "accept", keep.id);
  // Keeping it is arriving: he walks to the gate.
  kept.tick({ actor: "zeus", kind: "move", to: "olympus-gate" });
  expect(endingLine(kept, "zeus")).toContain("you fulfilled the term to hera");
  expect(endingLine(kept, "hera")).toContain("zeus fulfilled the term to you");

  const allied = new Run();
  const bond = allied.demand(allied.hears(), {
    term: { kind: "ally", party: "zeus", to: "hera", deadlineTicks: 100 },
  });
  allied.move("zeus", "accept", bond.id);
  expect(endingLine(allied, "zeus")).toContain(
    "you and hera sealed an alliance",
  );
  expect(endingLine(allied, "hera")).toContain(
    "you and zeus sealed an alliance",
  );

  const lapsed = new Run();
  const idle = lapsed.demand(lapsed.hears());
  while (lapsed.state.threads.get(idle.id)?.status === "open") lapsed.tick();
  expect(endingLine(lapsed, "hera")).toContain(
    "your practice with zeus expired unanswered",
  );

  const withdrawn = new Run();
  withdrawn.move("hera", "withdraw", withdrawn.demand(withdrawn.hears()).id);
  expect(endingLine(withdrawn, "hera")).toContain(
    "you withdrew from the practice with zeus",
  );
  expect(endingLine(withdrawn, "zeus")).toContain(
    "hera withdrew from the practice with you",
  );
});

test("a memory of an ending the god holds without an outcome (one from before outcomes were kept) still reads as an ending, and never as a raw event kind", () => {
  const run = new Run();
  run.move("zeus", "refuse", run.demand(run.hears()).id);
  const { snapshot, remembered } = run.view("hera");
  const bare = remembered.memories.map((m) => {
    if (m.kind !== "witnessed") return m;
    const { ending: _gone, ...rest } = m as typeof m & { ending?: unknown };
    return rest as typeof m;
  });
  const text = buildGodContext(godProfile("hera"), snapshot, {
    ...remembered,
    memories: bare,
  }).prompt;
  expect(text).toMatch(
    /- A practice between (hera and zeus|zeus and hera) ended \[evt-/,
  );
  expect(text).not.toContain("practice-moved");
});

// --- Why the last practice move was refused ----------------------------------------------------

function refusedRun() {
  const run = new Run();
  const cause = run.hears();
  const thread = run.demand(cause);
  run.move("zeus", "refuse", thread.id);
  const again = run.tick({
    actor: "hera",
    kind: "practice",
    move: "demand",
    counterparty: "zeus",
    cause,
    term: tell("zeus"),
  });
  expect(again.rejected.map((r) => r.reason)).toEqual(["no-progress"]);
  const refusal = run.events
    .filter((e) => e.kind === "practice-refused")
    .at(-1);
  if (refusal?.kind !== "practice-refused") throw new Error("no refusal event");
  return { run, cause, thread, refusal };
}

const withRefusal = (run: Run, god: string, refusal: WorldEvent) => {
  const snapshot = perceive(run.state, id(god), run.events);
  if (!snapshot) throw new Error("no snapshot");
  const remembered = rememberedBy(
    run.state,
    id(god),
    [],
    undefined,
    refusal as never,
  );
  return {
    remembered,
    snapshot,
    context: buildGodContext(godProfile(god), snapshot, remembered),
    schema: godIntentSchema(godProfile(god), snapshot, remembered),
  };
};

test("a repeated demand the world refused is told to the god in its next digest: it was already answered, and by whom", () => {
  const { run, refusal } = refusedRun();
  const { context } = withRefusal(run, "hera", refusal);
  const digest = digestOf(context.prompt);
  // Hera has no open thread, yet the digest exists, is the last section before the question, and says why.
  expect(context.prompt.split("\n").at(-1)).toBe("What do you do?");
  expect(context.prompt.split("\n")).toContain(PRACTICES_HEADING);
  expect(digest.join("\n")).toContain("Your last demand was refused");
  expect(digest.join("\n")).toContain(
    "that was already answered: zeus refused it",
  );
  // Control: Zeus, who was not refused, is shown none of it.
  expect(digestOf(withRefusal(run, "zeus", refusal).context.prompt)).toEqual(
    [],
  );
  // And the god that is shown nothing of the sort (no refusal passed) gets no digest.
  expect(digestOf(run.view("hera").context.prompt)).toEqual([]);
});

test("a refused move on an open thread is told on that thread's own row", () => {
  const run = new Run();
  run.demand(run.hears());
  const thread = run.latest();
  run.move("zeus", "counter", thread.id, { term: tell("zeus", 150) });
  const stuck = run.tick({
    actor: "hera",
    kind: "practice",
    move: "counter",
    thread: thread.id,
    term: tell("zeus", 150),
  });
  expect(stuck.rejected.map((r) => r.reason)).toEqual(["no-progress"]);
  const refusal = run.events
    .filter((e) => e.kind === "practice-refused")
    .at(-1);
  if (!refusal) throw new Error("no refusal");
  const { context, remembered } = withRefusal(run, "hera", refusal);
  const row = rowsOf(digestOf(context.prompt))[0] as string;
  expect(row).toContain(`[${thread.id}]`);
  expect(row).toContain("Not accepted: that is the offer already on the table");
  expect(remembered.threads[0]?.noProgress).toContain("already on the table");
  // Said once: on the row, not again as a line of its own.
  expect(
    digestOf(context.prompt)
      .join("\n")
      .match(/already on the table/g),
  ).toHaveLength(1);
});

test("talk the world refused for circling a thread, and moves refused for other reasons, are told in the god's words and never in the world's: no hidden facts, and a reason it can act on", () => {
  const cases: [string, string, string][] = [
    ["stale-target", "accept", "the thread changed while you were deciding"],
    ["malformed", "demand", "the world would not take that move now"],
    ["unauthorized-claim", "counter", "you may not make that move"],
    ["insufficient-resources", "demand", "you cannot afford that term"],
    ["not-adjacent", "demand", "you cannot reach that by its deadline"],
    ["dead-actor", "accept", "someone in it is no longer living"],
    ["busy-actor", "refuse", "you had already acted this tick"],
  ];
  const run = new Run();
  run.demand(run.hears());
  for (const [reason, attempted, words] of cases) {
    const event = {
      kind: "practice-refused",
      entityId: "zeus",
      attempted,
      reason,
      // A world message must never be shown for these: it might name another's petitions or holdings.
      why: "SECRET-PETITION-OF-FARMER",
    } as unknown as WorldEvent;
    const { context } = withRefusal(run, "zeus", event);
    const text = digestOf(context.prompt).join("\n");
    expect([reason, text.includes(words)]).toEqual([reason, true]);
    expect(text).not.toContain("SECRET-PETITION");
  }
  const talk = {
    kind: "practice-refused",
    entityId: "zeus",
    attempted: "report",
    reason: "no-progress",
    why: "talk about this does not move evt-1-3 forward; answer it with a practice move",
  } as unknown as WorldEvent;
  expect(
    digestOf(withRefusal(run, "zeus", talk).context.prompt).join("\n"),
  ).toContain(
    "Your last report was refused: talk about this does not move evt-1-3 forward",
  );
});

test("the refusal line counts against the digest and stays small: an obligation, two threads, and a refusal still fit", () => {
  const { run, refusal } = refusedRun();
  const owed = run.demand(run.hears("hera", "o"), { term: tell("zeus", 90) });
  run.move("zeus", "accept", owed.id);
  run.demand(run.hears("hera", "p"), { term: tell("zeus", 95) });
  const digest = digestOf(withRefusal(run, "hera", refusal).context.prompt);
  expect(rowsOf(digest).length).toBeGreaterThanOrEqual(3);
  expect(digest.join("\n")).toContain("Your last demand was refused");
  expect(digest.join("\n").length).toBeLessThan(1900);
});

test("a refusal never displaces what leads the digest: the obligation is still its first row, and the refusal comes after every row", () => {
  const run = new Run();
  const owed = run.demand(run.hears("hera", "o"), { term: tell("zeus", 90) });
  run.move("zeus", "accept", owed.id);
  run.demand(run.hears("hera", "p"), { term: tell("zeus", 95) });
  const refusal = {
    kind: "practice-refused",
    entityId: "zeus",
    attempted: "demand",
    reason: "stale-target",
  } as unknown as WorldEvent;
  const digest = digestOf(withRefusal(run, "zeus", refusal).context.prompt);
  const rows = rowsOf(digest);
  expect(rows[0]).toContain("YOU OWE hera");
  expect(rows.at(-1)).toContain("Your last demand was refused");
});
