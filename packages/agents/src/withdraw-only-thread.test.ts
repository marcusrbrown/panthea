// A thread the god can only withdraw (its own demand, waiting on the other party)
// is not one it can answer. The prompt then spends neither the "Answer an open
// thread" rule nor a long row on it (W04: what the prompt shows, the schema and
// the parser agree on; O08: an unattended hour does not skip a god's turns for
// prompt text it cannot use). The world is real: the authored Greek pack, real
// ticks, the real validator.

import { describe, expect, test } from "bun:test";
import type { EventId, WorldEvent } from "@panthea/contracts";
import { perceive, toEntityId } from "@panthea/world";
import { buildGodContext, godIntentSchema, rememberedBy } from "./context";
import { buildModelProposal } from "./observation";
import { describePracticeInstructions, PRACTICES_HEADING } from "./practices";
import { fitsCap, fitToCap } from "./prompt-cap";
import { requestChars } from "./router";
import { godProfile, WorldRun } from "./test-fixtures";

const id = toEntityId;

/** The granite3.3 ratio the 2026-10-10 unattended hour ran at. */
const RATIO = 2.85;

const ANSWER_RULE = "Answer an open thread";

/** Zeus's own demand to Hephaestus: a `be-at` term he is waiting on. */
function zeusDemands(run: WorldRun) {
  const cause = run.accused("zeus", "hermes", {
    agent: "hephaestus",
    target: "zeus",
  });
  run.tick({
    actor: "zeus",
    kind: "practice",
    move: "demand",
    counterparty: "hephaestus",
    cause,
    term: {
      kind: "be-at",
      party: "hephaestus",
      place: "altar",
      deadlineTicks: 120,
    },
  });
  const thread = [...run.state.threads.values()].at(-1);
  if (!thread) throw new Error("no thread");
  return thread;
}

/** Hera's demand of Zeus: a thread awaiting his answer, with accept and refuse among its moves. */
function heraDemands(run: WorldRun) {
  const cause = run.accused("hera", "zeus", { agent: "hera", target: "zeus" });
  run.tick({
    actor: "hera",
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
  });
  const thread = [...run.state.threads.values()].at(-1);
  if (!thread) throw new Error("no thread");
  return thread;
}

function viewOf(
  run: WorldRun,
  god = "zeus",
  events: readonly WorldEvent[] = [],
) {
  const profile = godProfile(god);
  const snapshot = perceive(run.state, id(god), run.events);
  if (!snapshot) throw new Error("no snapshot");
  const remembered = rememberedBy(run.state, id(god), events);
  return {
    profile,
    state: run.state,
    snapshot,
    remembered,
    context: buildGodContext(profile, snapshot, remembered),
    schema: godIntentSchema(profile, snapshot, remembered),
  };
}

/** The digest rows of one thread: its `- [id]` line and the indented lines beneath it. */
function rowOf(prompt: string, threadId: string): string[] {
  const lines = prompt.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`- [${threadId}]`));
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => !line.startsWith("  "));
  return [
    lines[start] as string,
    ...rest.slice(0, end < 0 ? rest.length : end),
  ];
}

/** Every practice object a text writes out, parsed. */
function practiceObjects(text: string): Record<string, unknown>[] {
  return [
    ...text.matchAll(/\{"action":"practice"[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g),
  ].map((m) => JSON.parse(m[0]));
}

describe("the answer rule: told only when a shown thread offers an answer", () => {
  test("a thread the god can only withdraw does not bring the rule", () => {
    const run = new WorldRun();
    const thread = zeusDemands(run);
    const view = viewOf(run);
    expect(view.remembered.threads.map((t) => t.id)).toEqual([thread.id]);
    expect(view.remembered.threads[0]?.moves).toEqual(["withdraw"]);
    // Zeus can still demand and offer, so there is practice guidance: the rule is what is missing.
    expect(view.context.instructions).toContain("A practice (action");
    expect(view.context.instructions).not.toContain(ANSWER_RULE);
  });

  test("a thread awaiting the god's answer brings the rule", () => {
    const run = new WorldRun();
    heraDemands(run);
    const view = viewOf(run);
    expect(view.remembered.threads[0]?.moves).toContain("accept");
    expect(view.context.instructions).toContain(ANSWER_RULE);
  });

  test("one answerable thread among withdraw-only ones is enough", () => {
    const run = new WorldRun();
    zeusDemands(run);
    const asked = heraDemands(run);
    const view = viewOf(run);
    expect(view.remembered.threads).toHaveLength(2);
    expect(
      view.remembered.threads.find((t) => t.id === asked.id)?.moves,
    ).toContain("refuse");
    expect(view.context.instructions).toContain(ANSWER_RULE);
  });

  test("the schema and the parser still take the withdrawal of a thread the rule is not told for", () => {
    const run = new WorldRun();
    const thread = zeusDemands(run);
    const view = viewOf(run);
    const withdraw = {
      action: "practice",
      move: "withdraw",
      thread: thread.id,
    };
    const parsed = view.schema.parse(withdraw);
    if (!parsed.ok) throw new Error(parsed.message);
    const built = buildModelProposal(
      id("zeus"),
      view.snapshot,
      parsed.value,
      view.remembered,
    );
    expect(built.ok).toBe(true);
  });

  test("describePracticeInstructions reads the same predicate from the views it is given", () => {
    const run = new WorldRun();
    zeusDemands(run);
    const waiting = viewOf(run).remembered;
    const only = describePracticeInstructions(
      waiting.threads,
      waiting.practice,
    );
    expect(only.join("\n")).not.toContain(ANSWER_RULE);
    const other = new WorldRun();
    heraDemands(other);
    const asked = viewOf(other).remembered;
    expect(
      describePracticeInstructions(asked.threads, asked.practice).join("\n"),
    ).toContain(ANSWER_RULE);
  });
});

// --- Zeus at tick 6595 ----------------------------------------------------------------------------

/**
 * Zeus as the unattended hour left him: his own demand to Hephaestus open, waiting, with
 * withdraw as its only move; a punish prayer for his one answer slot; a newest memory;
 * his own persona. `goalChars` is the length of his goal, which is never shed: it stands
 * for the rest of what the measured turn could not shed, and puts the shed-to-floor request
 * just under the cap once the rule and the long row are gone.
 */
function zeusAtTick6595(goalChars: number) {
  const run = new WorldRun();
  run.apply({
    kind: "goal-set",
    entityId: "zeus",
    text: "Keep watch over the farmer.".padEnd(goalChars, "!"),
    target: "farmer",
  });
  // A prayer to punish the woodcutter: the longest answer slot a prayer gives him.
  run.state = { ...run.state, tick: run.state.tick + 1 };
  const theft = run.apply({
    kind: "theft",
    entityId: "woodcutter",
    victim: "farmer",
    resource: "currency",
    amount: 1,
    cause: "director",
  });
  const punish = run.apply({
    kind: "petition-opened",
    entityId: "farmer",
    god: "zeus",
    cause: theft.id,
    request: {
      kind: "punish",
      offender: "woodcutter",
      buildings: ["woodshed"],
    },
  }).id as EventId;
  const thread = zeusDemands(run);
  // Older memories and events to shed, and a newest memory the cap keeps.
  for (let i = 1; i <= 4; i += 1) {
    run.apply({
      id: `evt-m-${i}`,
      kind: "memory-recorded",
      memoryKind: "witnessed",
      entityId: "zeus",
      sourceEventId: `evt-7-1${i}`,
      eventKind: "theft",
      subjects: ["woodcutter", "farmer"],
      salience: i,
      consequence: { effect: "harm", agent: "woodcutter", target: "farmer" },
    });
  }
  run.apply({
    id: "evt-m-newest",
    kind: "memory-recorded",
    memoryKind: "witnessed",
    entityId: "zeus",
    sourceEventId: "evt-7-1n",
    eventKind: "theft",
    subjects: ["woodcutter", "farmer"],
    salience: 5,
    consequence: { effect: "harm", agent: "woodcutter", target: "farmer" },
  });
  const view = viewOf(run);
  return { run, thread, punish, ...view };
}

const floorOf = (w: ReturnType<typeof zeusAtTick6595>) =>
  fitToCap({
    profile: w.profile,
    state: w.state,
    actorId: id("zeus"),
    snapshot: w.snapshot,
    remembered: w.remembered,
    ratio: RATIO,
  });

/** Sized so the floor with the rule and the long row is ~8,880 characters (cap 8,550) and ~8,470 without them. */
const GOAL_CHARS = 613;

describe("Zeus's waiting thread at the floor (W04, O08)", () => {
  test("his withdraw-only thread is the shape under test", () => {
    const w = zeusAtTick6595(GOAL_CHARS);
    expect(w.remembered.threads).toHaveLength(1);
    expect(w.remembered.threads[0]).toMatchObject({
      standing: "other",
      moves: ["withdraw"],
    });
    expect(w.remembered.petitions.map((p) => p.id)).toContain(w.punish);
  });

  test("shed to the floor the prompt fits the cap, and the thread and its withdrawal are still shown and valid", () => {
    const w = zeusAtTick6595(GOAL_CHARS);
    const capped = floorOf(w);
    expect(capped.fits).toBe(true);
    expect(fitsCap(capped.context, RATIO)).toBe(true);
    expect(capped.estimatedTokens).toBeLessThanOrEqual(3000);

    const prompt = capped.context.prompt;
    const row = rowOf(prompt, String(w.thread.id));
    expect(row.length).toBeGreaterThan(0);
    const withdraw = practiceObjects(row.join("\n")).find(
      (intent) => intent.move === "withdraw",
    );
    expect(withdraw).toEqual({
      action: "practice",
      move: "withdraw",
      thread: w.thread.id,
    });
    const schema = godIntentSchema(
      w.profile,
      capped.snapshot,
      capped.remembered,
    );
    expect(JSON.stringify(schema.jsonSchema)).toContain(String(w.thread.id));
    const parsed = schema.parse(withdraw);
    if (!parsed.ok) throw new Error(parsed.message);
    const built = buildModelProposal(
      id("zeus"),
      capped.snapshot,
      parsed.value,
      capped.remembered,
    );
    expect(built.ok).toBe(true);
  });

  test("the waiting thread is one line with its id, the counterparty, the term, its deadline, and a withdrawal to copy", () => {
    const w = zeusAtTick6595(GOAL_CHARS);
    const row = rowOf(w.context.prompt, String(w.thread.id));
    expect(row).toHaveLength(1);
    const [line] = row as [string];
    expect(line).toContain(`[${w.thread.id}]`);
    expect(line).toContain("hephaestus");
    expect(line).toContain("altar");
    expect(line).toContain(`by tick ${w.thread.term.deadline}`);
    expect(line).toContain(
      JSON.stringify({
        action: "practice",
        move: "withdraw",
        thread: w.thread.id,
      }),
    );
    expect(line.length).toBeLessThan(200);
    expect(w.context.prompt).toContain(PRACTICES_HEADING);
  });

  test("the fixture sits just under the cap, so the answer rule or the long row put back would put it over", () => {
    const w = zeusAtTick6595(GOAL_CHARS);
    const size = requestChars(floorOf(w).context);
    const limit = Math.round(3000 * RATIO);
    expect(size).toBeLessThanOrEqual(limit);
    // The long row costs about 160 characters more than the one line; the rule costs 247.
    expect(limit - size).toBeLessThan(150);
  });
});
