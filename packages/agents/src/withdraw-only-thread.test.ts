// A thread the god can only withdraw (its own demand, waiting on the other party)
// is not one it can answer. The prompt then spends neither the "Answer an open
// thread" rule nor a long row on it (W04: what the prompt shows, the schema and
// the parser agree on; O08: an unattended hour does not skip a god's turns for
// prompt text it cannot use). The world is real: the authored Greek pack, real
// ticks, the real validator.

import { describe, expect, test } from "bun:test";
import type { WorldEvent } from "@panthea/contracts";
import { perceive, toEntityId } from "@panthea/world";
import { buildGodContext, godIntentSchema, rememberedBy } from "./context";
import { buildModelProposal } from "./observation";
import { describePracticeInstructions } from "./practices";
import { godProfile, WorldRun } from "./test-fixtures";

const id = toEntityId;

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
