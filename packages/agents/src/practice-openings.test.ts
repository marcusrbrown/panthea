// What a god is shown it could do, not told to do: each prayer it may answer as
// a choice (help freely, set terms, or let it be), and, when no thread needs
// it, at most two concrete openings under the practices heading, each written
// out in full intent shape and checked by the world's own rules. The world is
// real (the authored Greek pack, real ticks, the real validator).

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
  validatePractice,
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
  withoutFireSpread,
} from "./test-fixtures";

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

/** The intent objects written out in a section, in order. */
function intentsIn(lines: readonly string[]): Record<string, unknown>[] {
  return lines.flatMap((line) => {
    const start = line.indexOf('{"action":"practice"');
    if (start < 0) return [];
    // The object is the balanced braces from there; a note may follow it.
    let depth = 0;
    for (let at = start; at < line.length; at += 1) {
      if (line[at] === "{") depth += 1;
      if (line[at] === "}" && --depth === 0) {
        return [JSON.parse(line.slice(start, at + 1))];
      }
    }
    return [];
  });
}

/** An opening is legal as written: it parses against the god's own schema, builds into a proposal, and the world commits it. */
function legalAsWritten(
  run: Run,
  god: string,
  intent: Record<string, unknown>,
): void {
  const { snapshot, remembered, schema } = run.view(god);
  const parsed = schema.parse(intent);
  if (!parsed.ok) {
    throw new Error(
      `does not parse: ${parsed.message} ${JSON.stringify(intent)}`,
    );
  }
  const built = buildModelProposal(id(god), snapshot, parsed.value, remembered);
  if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
  const ran = runTick(run.state, createPrng(1), [built.proposal]);
  expect(ran.rejected).toEqual([]);
  expect(ran.state.threads.size).toBe(run.state.threads.size + 1);
}

// --- Prayers: help, terms, or let it be ----------------------------------------------------------

test("an offerable prayer shows the god its choices: help freely, set terms in full shape, or let it be; nothing commands it to bless", () => {
  const run = new Run();
  run.state = actorAt(run.state, "zeus", "altar");
  const petition = run.prays();
  const { context } = run.view("zeus");
  const prayers = prayersOf(context.prompt).join("\n");
  expect(prayers).toContain(`[${petition}] farmer`);
  expect(prayers).toContain("help freely");
  expect(prayers).toContain(`{"action":"bless","petition":"${petition}"}`);
  expect(prayers).toContain("set terms");
  expect(prayers).toContain("let it be");
  expect(prayers).not.toContain("bless them now");
  expect(prayers).not.toContain("To answer it");
  expect(prayers).not.toContain("keep going each turn");
  // The terms path is one copyable object, and it is legal as written.
  const [terms] = intentsIn(prayersOf(context.prompt));
  expect(terms).toMatchObject({
    action: "practice",
    move: "offer",
    prayer: petition,
    term: { kind: "make-offering", party: "farmer", to: "zeus", amount: 1 },
  });
  legalAsWritten(run, "zeus", terms as Record<string, unknown>);
});

test("from afar the travel hint belongs to the choice of helping, said as a condition; the terms path is the same either way", () => {
  const run = new Run();
  const petition = run.prays();
  const prayers = prayersOf(run.view("zeus").context.prompt).join("\n");
  // The way toward the petitioner is still listed, and the help path says it is for one who chooses to help.
  expect(prayers).toContain("take ");
  expect(prayers).toMatch(/help freely: .*if you choose this/);
  expect(prayers).toContain(
    `then bless them {"action":"bless","petition":"${petition}"}`,
  );
  expect(prayers).not.toContain("bless them now");
  expect(prayers).not.toContain("keep going each turn");
  expect(intentsIn(prayersOf(run.view("zeus").context.prompt))).toHaveLength(1);
});

test("a punish prayer is a choice too: strike freely where the offender's building stands, set terms, or let it be", () => {
  const run = new Run();
  const theft = run.apply({
    kind: "theft",
    entityId: "woodcutter",
    victim: "farmer",
    resource: "currency",
    amount: 1,
    cause: "director",
  });
  run.apply({
    kind: "petition-opened",
    entityId: "farmer",
    god: "zeus",
    cause: theft.id,
    request: {
      kind: "punish",
      offender: "woodcutter",
      buildings: ["woodshed"],
    },
  });
  run.state = actorAt(run.state, "zeus", "town-square");
  const prayers = prayersOf(run.view("zeus").context.prompt).join("\n");
  expect(prayers).toContain("punish freely");
  expect(prayers).toContain(
    'punish freely: woodshed is here: {"action":"strike","target":"woodshed"}',
  );
  expect(prayers).toContain("set terms");
  expect(prayers).not.toContain("to answer it");
});

test("a prayer the god cannot set terms on shows the help path and the choice to let it be, and no terms: a prayer already holding terms, or from a mortal with nothing to offer", () => {
  const run = new Run();
  run.state = actorAt(run.state, "zeus", "altar");
  run.prays();
  // The farmer has nothing to offer: the world would refuse every term.
  const farmer = getActor(run.state, id("farmer"));
  if (!farmer) throw new Error("farmer");
  // Nothing held, and nothing gathered to make it from: the world would take no offering.
  run.state = withActor(run.state, {
    ...farmer,
    inventory: new Map(),
    gathers: undefined,
  });
  const empty = prayersOf(run.view("zeus").context.prompt).join("\n");
  expect(empty).toContain("help freely");
  expect(empty).toContain("let it be");
  expect(empty).not.toContain("set terms");
  expect(empty).not.toContain('"move":"offer"');
  expect(run.view("zeus").remembered.practice.offerable).toHaveLength(1);

  // Control: with something to offer, the terms path is there.
  const rich = new Run();
  rich.state = actorAt(rich.state, "zeus", "altar");
  rich.prays();
  expect(prayersOf(rich.view("zeus").context.prompt).join("\n")).toContain(
    "set terms",
  );

  // Once terms stand on it the prayer offers none again, and the digest shows the bargain.
  const standing = new Run();
  standing.state = actorAt(standing.state, "zeus", "altar");
  const p = standing.prays();
  const [offer] = intentsIn(prayersOf(standing.view("zeus").context.prompt));
  standing.tick({
    actor: "zeus",
    kind: "practice",
    move: "offer",
    petition: p,
    term: (offer as { term: unknown }).term,
  });
  expect(standing.state.threads.size).toBe(1);
  const after = prayersOf(standing.view("zeus").context.prompt).join("\n");
  expect(after).not.toContain("set terms");
  expect(after).toContain("help freely");
});

test("once a bargain is accepted the boon is the god's obligation in the digest, and the prayer reads as agreed, not as a favour to do freely", () => {
  const run = new Run();
  run.state = actorAt(run.state, "zeus", "altar");
  const petition = run.prays();
  const [offer] = intentsIn(prayersOf(run.view("zeus").context.prompt));
  run.tick({
    actor: "zeus",
    kind: "practice",
    move: "offer",
    petition,
    term: (offer as { term: unknown }).term,
  });
  const thread = run.latest();
  run.tick({
    actor: "farmer",
    kind: "practice",
    move: "accept",
    thread: thread.id,
    source: "routine",
  });
  const text = run.view("zeus").context.prompt;
  expect(digestOf(text).join("\n")).toContain("YOU OWE farmer");
  expect(digestOf(text).join("\n")).toContain("your boon on its prayer");
  expect(prayersOf(text).join("\n")).toContain("You agreed terms");
  expect(prayersOf(text).join("\n")).not.toContain("help freely");
});

// --- Openings -------------------------------------------------------------------------------------

test("with Hera's accusation in Zeus's memory, the digest shows a full demand opening that parses against his schema and that the world commits", () => {
  const run = new Run();
  const cause = run.accused("zeus", "hera", { agent: "zeus", target: "hera" });
  const { context } = run.view("zeus");
  const digest = digestOf(context.prompt);
  expect(digest[0]).toBe(PRACTICES_HEADING);
  // The digest is the last section of the user text, just before the question: per-tick state last.
  const promptLines = context.prompt.split("\n");
  expect(promptLines.at(-1)).toBe("What do you do?");
  expect(promptLines.indexOf(PRACTICES_HEADING)).toBeGreaterThan(
    promptLines.findIndex((l) => l.startsWith("You are at ")),
  );
  const text = digest.join("\n");
  expect(text).toContain("You may begin a bargain");
  expect(text).toContain("demand of hera");
  expect(text).toContain(`hera told you of it [${cause}]`);
  const [opening] = intentsIn(digest);
  expect(opening).toMatchObject({
    action: "practice",
    move: "demand",
    cause,
    term: { party: "hera" },
  });
  expect(
    typeof (opening as { term: { deadlineTicks: unknown } }).term.deadlineTicks,
  ).toBe("number");
  legalAsWritten(run, "zeus", opening as Record<string, unknown>);
});

test("a god with no legitimate grievance sees no demand opening: nothing named, a memory that blames no one, one that names no other god, or a mortal's quarrel", () => {
  const nothing = new Run();
  expect(digestOf(nothing.view("zeus").context.prompt)).toEqual([]);

  // A told account with no claim blames no one.
  const idle = new Run();
  idle.apply({
    kind: "memory-recorded",
    memoryKind: "told",
    entityId: "zeus",
    sourceEventId: "evt-0-1",
    teller: "hera",
    content: "The weather is fine.",
    subjects: ["hera"],
    salience: 4,
  });
  expect(digestOf(idle.view("zeus").context.prompt)).toEqual([]);

  // A harm among mortals names no other god.
  const mortals = new Run();
  mortals.accused("zeus", "farmer", { agent: "woodcutter", target: "farmer" });
  expect(digestOf(mortals.view("zeus").context.prompt)).toEqual([]);
  expect(mortals.view("zeus").remembered.practice.openings).toEqual([]);
});

test("openings never name evidence the god does not hold: Hera, who was not told, is shown nothing of Zeus's accusation; the god told sees the cause, and only as it knows it", () => {
  const run = new Run();
  const cause = run.accused("zeus", "hera", { agent: "zeus", target: "hera" });
  const hera = run.view("hera");
  const text = `${hera.context.instructions}\n${hera.context.prompt}\n${JSON.stringify(hera.schema.jsonSchema)}`;
  expect(text).not.toContain(cause);
  expect(text).not.toContain("You wronged me");
  expect(digestOf(hera.context.prompt)).toEqual([]);
  const zeus = run.view("zeus");
  const seen = `${zeus.context.instructions}\n${zeus.context.prompt}`;
  expect(seen).toContain(`[${cause}]`);
  // The memory section holds the words; the digest and the instructions never quote them.
  expect(digestOf(zeus.context.prompt).join("\n")).not.toContain(
    "You wronged me",
  );
  expect(zeus.context.instructions).not.toContain("You wronged me");
});

test("with a thread that needs the god, the openings yield to the digest rows; a thread waiting on someone else does not displace them", () => {
  // Zeus is asked for an answer: no opening.
  const asked = new Run();
  asked.accused("zeus", "hera", { agent: "zeus", target: "hera" });
  const heraCause = asked.accused("hera", "zeus", {
    agent: "hera",
    target: "zeus",
  });
  asked.tick({
    actor: "hera",
    kind: "practice",
    move: "demand",
    counterparty: "zeus",
    cause: heraCause,
    term: tell("zeus"),
  });
  const awaiting = digestOf(asked.view("zeus").context.prompt).join("\n");
  expect(awaiting).toContain("AWAITING YOUR ANSWER");
  expect(awaiting).not.toContain("You may begin a bargain");
  // What is written out are Zeus's answers to the thread, never a demand or an offer to begin.
  expect(
    intentsIn(digestOf(asked.view("zeus").context.prompt)).map((i) => i.move),
  ).toEqual(["accept", "refuse", "withdraw"]);

  // Zeus owes: no opening either.
  const owing = new Run();
  owing.accused("zeus", "hera", { agent: "zeus", target: "hera" });
  const cause = owing.accused("hera", "zeus", {
    agent: "hera",
    target: "zeus",
  });
  owing.tick({
    actor: "hera",
    kind: "practice",
    move: "demand",
    counterparty: "zeus",
    cause,
    term: tell("zeus"),
  });
  const thread = owing.latest();
  owing.tick({
    actor: "zeus",
    kind: "practice",
    move: "accept",
    thread: thread.id,
    expectedRevisions: [{ entityId: thread.id, revision: thread.revision }],
  });
  const owes = digestOf(owing.view("zeus").context.prompt);
  expect(owes[1]).toContain("YOU OWE hera");
  expect(owes.join("\n")).not.toContain("You may begin a bargain");

  // Control: Hera made the demand, so it waits on Zeus; nothing needs her, and her opening is shown beneath the row.
  const waiting = new Run();
  const hCause = waiting.accused("hera", "zeus", {
    agent: "hera",
    target: "zeus",
  });
  const second = waiting.accused("hera", "zeus", {
    agent: "zeus",
    target: "farmer",
  });
  waiting.tick({
    actor: "hera",
    kind: "practice",
    move: "demand",
    counterparty: "zeus",
    cause: hCause,
    term: tell("zeus"),
  });
  const hera = digestOf(waiting.view("hera").context.prompt);
  expect(hera.join("\n")).toContain("OPEN, waiting on zeus");
  expect(hera.join("\n")).toContain("You may begin a bargain");
  expect(second).toBeDefined();
});

test("a demand the world would refuse as already answered is not offered again: after Zeus refuses, Hera is not shown the same cause", () => {
  const run = new Run();
  const cause = run.accused("hera", "zeus", { agent: "hera", target: "zeus" });
  const before = intentsIn(digestOf(run.view("hera").context.prompt));
  expect(before[0]).toMatchObject({ move: "demand", cause });
  run.tick({
    actor: "hera",
    kind: "practice",
    move: "demand",
    counterparty: "zeus",
    cause,
    term: tell("zeus"),
  });
  const thread = run.latest();
  run.tick({
    actor: "zeus",
    kind: "practice",
    move: "refuse",
    thread: thread.id,
    expectedRevisions: [{ entityId: thread.id, revision: thread.revision }],
  });
  const after = intentsIn(digestOf(run.view("hera").context.prompt));
  expect(after.map((o) => o.cause)).not.toContain(cause);
});

test("at most two openings, picked the same way every time: the most salient grievance first (not the most recent), then the most recent among equals; a prayer's terms fill the second place", () => {
  const run = new Run();
  const loud = run.accused(
    "zeus",
    "hera",
    { agent: "hera", target: "zeus" },
    9,
  );
  const quiet = run.accused(
    "zeus",
    "hera",
    { agent: "zeus", target: "hera" },
    3,
  );
  run.state = actorAt(run.state, "zeus", "altar");
  const petition = run.prays("farmer", "zeus");
  const first = run.view("zeus").remembered.practice.openings;
  expect(first).toHaveLength(2);
  expect(first.map((o) => o.kind)).toEqual(["demand", "offer"]);
  expect(first[0]?.intent).toMatchObject({ cause: loud });
  expect(first[1]?.intent).toMatchObject({ prayer: petition });
  expect(JSON.stringify(first)).not.toContain(quiet);
  // The same state gives the same openings.
  expect(run.view("zeus").remembered.practice.openings).toEqual(first);
  // Two grievances and two prayers are still two openings.
  run.prays("woodcutter", "zeus");
  run.accused("zeus", "hera", { agent: "hera", target: "farmer" }, 5);
  expect(run.view("zeus").remembered.practice.openings).toHaveLength(2);

  // Equal salience: the more recent grievance.
  const tied = new Run();
  tied.accused("zeus", "hera", { agent: "hera", target: "zeus" }, 5);
  const newer = tied.accused(
    "zeus",
    "hera",
    { agent: "zeus", target: "hera" },
    5,
  );
  expect(
    tied.view("zeus").remembered.practice.openings[0]?.intent,
  ).toMatchObject({
    cause: newer,
  });
});

test("of two prayers it may set terms on, the opening is the newest; a prayer the world would take no terms on is never the opening", () => {
  const run = new Run();
  run.state = actorAt(run.state, "zeus", "altar");
  run.prays("farmer", "zeus");
  const newer = run.prays("woodcutter", "zeus");
  const [opening] = run.view("zeus").remembered.practice.openings;
  expect(opening).toMatchObject({ kind: "offer", intent: { prayer: newer } });

  // The newer prayer's mortal has nothing to offer, so the opening falls back to the older one.
  const woodcutter = getActor(run.state, id("woodcutter"));
  if (!woodcutter) throw new Error("woodcutter");
  run.state = withActor(run.state, {
    ...woodcutter,
    inventory: new Map(),
    gathers: undefined,
  });
  const [fallback] = run.view("zeus").remembered.practice.openings;
  expect(fallback?.intent).not.toMatchObject({ prayer: newer });
  expect(fallback).toMatchObject({ kind: "offer" });

  // With both unable, there is no offer opening and none is invented.
  const farmer = getActor(run.state, id("farmer"));
  if (!farmer) throw new Error("farmer");
  run.state = withActor(run.state, {
    ...farmer,
    inventory: new Map(),
    gathers: undefined,
  });
  expect(run.view("zeus").remembered.practice.openings).toEqual([]);
  expect(digestOf(run.view("zeus").context.prompt)).toEqual([]);
});

test("where mortals are with the god, the demand asks the other god to tell a legend to them; the term's length is the world's bound when it is longer than the usual", () => {
  const run = new Run();
  run.state = actorAt(run.state, "farmer", "great-hall");
  run.accused("zeus", "hera", { agent: "zeus", target: "hera" });
  const [opening] = intentsIn(digestOf(run.view("zeus").context.prompt));
  expect(opening).toMatchObject({
    move: "demand",
    term: { kind: "tell-legend", party: "hera", place: "great-hall" },
  });
  legalAsWritten(run, "zeus", opening as Record<string, unknown>);

  const long = new Run();
  long.state = {
    ...long.state,
    rules: {
      ...long.state.rules,
      practiceBalance: {
        ...long.state.rules.practiceBalance,
        minTermTicks: 120,
        maxTermTicks: 400,
      },
    },
  };
  long.accused("zeus", "hera", { agent: "zeus", target: "hera" });
  const [bounded] = intentsIn(digestOf(long.view("zeus").context.prompt));
  expect(
    (bounded as { term: { deadlineTicks: number } }).term.deadlineTicks,
  ).toBe(120);
});

test("a prayer's terms are an opening when the god has no grievance, and only the prayers it can hear: Hera is shown none of Zeus's", () => {
  const run = new Run();
  run.state = actorAt(run.state, "zeus", "altar");
  const petition = run.prays("farmer", "zeus");
  const zeus = digestOf(run.view("zeus").context.prompt);
  expect(zeus.join("\n")).toContain(`farmer's prayer [${petition}]`);
  const [opening] = intentsIn(zeus);
  expect(opening).toMatchObject({ move: "offer", prayer: petition });
  legalAsWritten(run, "zeus", opening as Record<string, unknown>);
  const hera = run.view("hera");
  expect(`${hera.context.prompt}${hera.context.instructions}`).not.toContain(
    petition,
  );
  expect(digestOf(hera.context.prompt)).toEqual([]);
});

test("an opening never suggests an amount the mortal could not have by the deadline: what is shown is one the world's own term check accepts, for a gatherer holding nothing and for one with a long way to go", async () => {
  const { termObstacle } = await import("@panthea/world");
  const run = new Run();
  run.state = actorAt(run.state, "zeus", "altar");
  run.prays("farmer", "zeus");
  const farmer = getActor(run.state, id("farmer"));
  if (!farmer) throw new Error("farmer");
  // Nothing held, but gathering food: one unit is within reach in the ticks the term allows.
  run.state = withActor(run.state, {
    ...farmer,
    inventory: new Map(),
    gathers: "food",
  });
  const [opening] = run.view("zeus").remembered.practice.openings;
  expect(opening).toMatchObject({ kind: "offer" });
  if (opening === undefined) throw new Error("no opening");
  const { term } = opening.intent as {
    term: { resource: string; amount: number; deadlineTicks: number } & Record<
      string,
      unknown
    >;
  };
  expect(term).toMatchObject({ resource: "food", amount: 1 });
  const { deadlineTicks, ...spec } = term;
  expect(termObstacle(run.state, spec as never, deadlineTicks)).toBeUndefined();
  // With the bound set so low no gathering reaches it, no offer is shown at all.
  run.state = {
    ...run.state,
    rules: {
      ...run.state.rules,
      practiceBalance: {
        ...run.state.rules.practiceBalance,
        minTermTicks: 1,
        maxTermTicks: 1,
      },
    },
  };
  const gatherer = getActor(run.state, id("farmer"));
  if (!gatherer) throw new Error("farmer");
  run.state = withActor(run.state, { ...gatherer, gathers: undefined });
  expect(run.view("zeus").remembered.practice.openings).toEqual([]);
});

test("with only a punish prayer before him, Zeus is shown no opening that asks a god to bless the one who prayed, and the world refuses such a demand if one is made", () => {
  const run = new Run();
  run.state = actorAt(run.state, "zeus", "altar");
  const cause = run.accused("zeus", "hera", { agent: "zeus", target: "hera" });
  run.apply({
    kind: "petition-opened",
    entityId: "farmer",
    god: "zeus",
    cause,
    request: { kind: "punish", offender: "hera", buildings: ["woodshed"] },
  });
  const view = run.view("zeus");
  expect(JSON.stringify(view.remembered.practice.openings)).not.toContain(
    "bless-mortal",
  );
  // The demand itself, if a god made it, is refused by the world's own check.
  const heraCause = run.accused("hera", "zeus", {
    agent: "hera",
    target: "zeus",
  });
  const refused = validatePractice(run.state, {
    schemaVersion: 1,
    actor: id("hera"),
    targets: [],
    expectedRevisions: [],
    source: "model",
    observationId: "obs-x" as never,
    kind: "practice",
    move: "demand",
    counterparty: id("zeus"),
    cause: heraCause,
    term: {
      kind: "bless-mortal",
      party: id("zeus"),
      mortal: id("farmer"),
      deadlineTicks: 90,
    },
  });
  expect(refused).toMatchObject({ ok: false, reason: "malformed" });
});

test("the schema stays flat and the openings change none of what the god may parse: practice is still one object", () => {
  const run = new Run();
  run.accused("zeus", "hera", { agent: "zeus", target: "hera" });
  const schema = run.view("zeus").schema.jsonSchema;
  expect(JSON.stringify(schema)).not.toContain("anyOf");
  expect(JSON.stringify(schema)).not.toContain("oneOf");
});

// --- The generic text is gone ---------------------------------------------------------------------

test("the default prompt no longer carries the generic list of term kinds: the openings and rows show terms in full shape instead", () => {
  const run = new Run();
  run.accused("zeus", "hera", { agent: "zeus", target: "hera" });
  run.state = actorAt(run.state, "zeus", "altar");
  run.prays("farmer", "zeus");
  const { instructions } = run.view("zeus").context;
  expect(instructions).not.toContain("tell a legend at a place, be at a place");
  expect(instructions).not.toContain(
    "You may bargain with another god through the world",
  );
  expect(instructions).not.toContain("You may answer a prayer on terms");
  // What a god needs to name an offer or a demand is still there: the causes it may demand over, and the stake it may add.
  expect(instructions).toContain("Causes you may demand over:");
  expect(instructions).toContain("stake");
});
