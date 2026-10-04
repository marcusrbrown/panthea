// What a god is shown and may answer once it has goals: its own goal and the
// target's history, its own recent actions, the legend audience line, and the
// goal change an intent may carry. The world is real (real ticks over the
// authored Greek pack); nothing here is a mock of the rules.

import { expect, test } from "bun:test";
import type { WorldEvent } from "@panthea/contracts";
import { MAX_GOAL_LENGTH, MAX_REPORT_LENGTH } from "@panthea/contracts";
import {
  createPrng,
  type PerceptionSnapshot,
  perceive,
  runTick,
  submitProposal,
  toEntityId,
  type WorldState,
} from "@panthea/world";
import {
  authoredAction,
  buildGodContext,
  godIntentSchema,
  MAX_ASSERTION_LENGTH,
  MAX_GOAL_HISTORY,
  MAX_OWN_ACTIONS,
  MAX_REPEATED_REPORTS,
  rememberedBy,
  shownIds,
} from "./context";
import { buildModelProposal } from "./observation";
import { actorAt, godProfile, greekState } from "./test-fixtures";

const id = toEntityId;

/** A world that keeps every event it commits, so a test can show a god what it did. */
class Run {
  state: WorldState;
  readonly events: WorldEvent[] = [];
  private n = 0;
  constructor(state: WorldState) {
    this.state = state;
  }
  tick(...raws: Record<string, unknown>[]) {
    const proposals = raws.map((raw) => {
      this.n += 1;
      const submitted = submitProposal({
        schemaVersion: 1,
        targets: [],
        expectedRevisions: [],
        source: "fixture",
        observationId: `obs-run-${this.n}`,
        ...raw,
      });
      if (!submitted.ok) throw new Error(submitted.rejection.message);
      return submitted.proposal;
    });
    const result = runTick(this.state, createPrng(1), proposals);
    expect(result.rejected).toEqual([]);
    this.state = result.state;
    this.events.push(...result.events);
    return result;
  }
  /** What `god` authored: the events its own actions committed, oldest first. */
  own(god: string): WorldEvent[] {
    return this.events.filter((e) => authoredAction(e, id(god)));
  }
  remembered(god: string) {
    return rememberedBy(this.state, id(god), this.own(god));
  }
  snapshot(
    god: string,
    window: readonly WorldEvent[] = [],
  ): PerceptionSnapshot {
    const snapshot = perceive(this.state, id(god), window);
    if (!snapshot) throw new Error(`${god} perceives nothing`);
    return snapshot;
  }
  /** The whole prompt a god is shown. */
  text(god: string, window: readonly WorldEvent[] = []): string {
    const context = buildGodContext(
      godProfile(god),
      this.snapshot(god, window),
      this.remembered(god),
    );
    return `${context.instructions}\n${context.prompt}`;
  }
  schema(god: string, window: readonly WorldEvent[] = []) {
    return godIntentSchema(
      godProfile(god),
      this.snapshot(god, window),
      this.remembered(god),
    );
  }
}

/** Zeus and the farmer at the tavern; Hera in the square with the woodcutter. */
const tavernRun = () =>
  new Run(
    actorAt(
      actorAt(actorAt(greekState(), "zeus", "tavern"), "farmer", "tavern"),
      "hera",
      "town-square",
    ),
  );

const GOAL = {
  set: { text: "Punish the farmer for his insolence.", target: "farmer" },
};
const section = (text: string, from: string, to: string) =>
  text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));

// --- The goal section ---------------------------------------------------------------------------

test("a god with an active goal is shown its words, its target, whether the target is here, and what happened with the target since it set the goal", () => {
  const run = tavernRun();
  run.tick({ actor: "zeus", kind: "goal", goal: GOAL });
  // Before the goal Zeus saw nothing of the farmer; after it, he strikes the farmer's tavern.
  run.tick({ actor: "zeus", kind: "strike", target: "the-tavern", power: 3 });

  const text = run.text("zeus");
  const goal = section(text, "Your goal", "You are at");
  expect(goal).toContain('"Punish the farmer for his insolence."');
  expect(goal).toContain("farmer");
  expect(goal).toMatch(/farmer[^\n]*here/);
  // Since the goal: his own strike, and what he saw happen to the farmer's tavern.
  expect(goal).toContain("Since you set it");
  expect(goal).toContain("you struck the-tavern");
  expect(goal).toContain("building-ignited");
});

test("the target's presence is stated either way: here when it is in the scene, not here when it is not", () => {
  const away = tavernRun();
  away.tick({
    actor: "zeus",
    kind: "goal",
    goal: { set: { text: "Find Hera.", target: "hera" } },
  });
  expect(away.text("zeus")).toMatch(/hera[^\n]*not here/);
  // Control: Hera walks in.
  const here = new Run(actorAt(away.state, "hera", "tavern"));
  expect(here.text("zeus")).not.toMatch(/hera[^\n]*not here/);
  expect(here.text("zeus")).toMatch(/hera[^\n]*here/);
});

test("no active goal means no goal section, and the prompt invites setting one; an ended goal leaves none", () => {
  const run = tavernRun();
  expect(run.text("zeus")).not.toContain("Your goal");
  expect(run.text("zeus")).toContain("You have no goal");
  run.tick({ actor: "zeus", kind: "goal", goal: GOAL });
  expect(run.text("zeus")).toContain("Your goal");
  expect(run.text("zeus")).not.toContain("You have no goal");
  run.tick({
    actor: "zeus",
    kind: "goal",
    goal: { end: { outcome: "achieved" } },
  });
  expect(run.text("zeus")).not.toContain("Your goal");
  expect(run.text("zeus")).toContain("You have no goal");
});

test("goal history shows only what the god itself saw, was told, or did, since it set the goal, and at most the cap", () => {
  const run = tavernRun();
  // The farmer's tavern burns before Zeus has any goal: not "since" it.
  run.tick({ actor: "zeus", kind: "strike", target: "the-tavern", power: 3 });
  run.tick({ actor: "zeus", kind: "goal", goal: GOAL });
  const before = section(run.text("zeus"), "Your goal", "You are at");
  expect(before).not.toContain("building-ignited");
  expect(before).not.toContain("you struck");

  // Many reports to the farmer afterward: only the newest few are shown.
  for (let i = 1; i <= MAX_GOAL_HISTORY + 3; i += 1) {
    run.tick({
      actor: "zeus",
      kind: "report",
      listener: "farmer",
      content: `Word number ${i}.`,
    });
  }
  const history = section(run.text("zeus"), "Since you set it", "You are at");
  const lines = history.split("\n").filter((l) => l.startsWith("- "));
  expect(lines).toHaveLength(MAX_GOAL_HISTORY);
  expect(history).toContain(`Word number ${MAX_GOAL_HISTORY + 3}.`);
  expect(history).not.toContain("Word number 1.");
});

test("another god's goal, memories, and feelings never appear: Zeus's prompt carries none of Hera's, and Hera's own prompt does carry hers", () => {
  const run = tavernRun();
  run.tick(
    {
      actor: "hera",
      kind: "goal",
      goal: { set: { text: "Make Zeus admit his deceit.", target: "zeus" } },
    },
    {
      actor: "zeus",
      kind: "goal",
      goal: { set: { text: "Calm the sky.", target: "hera" } },
    },
  );
  expect(run.text("zeus")).not.toContain("Make Zeus admit his deceit.");
  expect(run.text("zeus")).toContain("Calm the sky.");
  expect(run.text("hera")).toContain("Make Zeus admit his deceit.");
  expect(run.text("hera")).not.toContain("Calm the sky.");
});

// --- Own recent actions ---------------------------------------------------------------------------

test("a god is shown its own last report with its words and claim, and its last move, in order", () => {
  const run = new Run(
    actorAt(
      actorAt(greekState(), "zeus", "town-square"),
      "hera",
      "town-square",
    ),
  );
  run.tick({
    actor: "zeus",
    kind: "report",
    listener: "hera",
    content: "You will answer for this.",
    claim: { effect: "harm", agent: "hera", target: "zeus" },
  });
  run.tick({ actor: "zeus", kind: "move", to: "tavern" });
  const recent = section(
    run.text("zeus"),
    "What you did recently",
    "You are at",
  );
  expect(recent).toContain('you told hera: "You will answer for this."');
  expect(recent).toContain("claiming hera harmed zeus");
  expect(recent).toContain("you moved to tavern");
  expect(recent.indexOf("you told hera")).toBeLessThan(
    recent.indexOf("you moved to"),
  );
});

test("own actions over the cap show only the newest, oldest first; with a few, all are shown", () => {
  const run = new Run(actorAt(greekState(), "zeus", "town-square"));
  const places = [
    "tavern",
    "town-square",
    "tavern",
    "town-square",
    "tavern",
    "town-square",
    "tavern",
  ];
  for (const to of places) run.tick({ actor: "zeus", kind: "move", to });
  expect(run.own("zeus")).toHaveLength(places.length);
  expect(run.remembered("zeus").ownActions).toHaveLength(MAX_OWN_ACTIONS);
  const shown = section(run.text("zeus"), "What you did recently", "You are at")
    .split("\n")
    .filter((l) => l.startsWith("- you moved"));
  expect(shown).toHaveLength(MAX_OWN_ACTIONS);
  // The newest five of seven, in the order they happened.
  expect(shown.map((l) => l.replace("- you moved to ", ""))).toEqual(
    places.slice(-MAX_OWN_ACTIONS),
  );

  const few = new Run(actorAt(greekState(), "zeus", "town-square"));
  few.tick({ actor: "zeus", kind: "move", to: "tavern" });
  expect(few.remembered("zeus").ownActions).toHaveLength(1);
});

test("only committed own actions are shown, and costs, goals, and other people's events are not", () => {
  const run = tavernRun();
  run.tick({ actor: "zeus", kind: "strike", target: "the-tavern", power: 3 });
  run.tick({ actor: "zeus", kind: "goal", goal: GOAL });
  const own = run.own("zeus").map((e) => e.kind);
  // The strike (its ignition) is his; the divinity spent, the goal, and others' beliefs are not.
  expect(own).toEqual(["building-ignited"]);
  expect(
    authoredAction(
      run.events.find((e) => e.kind === "resource-consumed") as WorldEvent,
      id("zeus"),
    ),
  ).toBe(false);
  // A fire that spread from his strike is not an action he took.
  const spread = {
    ...(run.events.find((e) => e.kind === "building-ignited") as WorldEvent),
    cause: { kind: "spread", from: "evt-1-1", actor: id("zeus") },
  } as unknown as WorldEvent;
  expect(authoredAction(spread, id("zeus"))).toBe(false);
});

test("after Zeus reports to Hera and she forms a belief and a feeling, his next prompt shows his own words and claim and nothing of hers", () => {
  const run = new Run(
    actorAt(
      actorAt(greekState(), "zeus", "town-square"),
      "hera",
      "town-square",
    ),
  );
  const told = run.tick({
    actor: "zeus",
    kind: "report",
    listener: "hera",
    content: "The farmer cheated me.",
    claim: { effect: "harm", agent: "farmer", target: "zeus" },
  });
  // The world did give Hera a belief and a feeling.
  expect(run.state.memories.get(id("hera"))?.length).toBe(1);
  expect(told.events.some((e) => e.kind === "relationship-changed")).toBe(true);

  const zeus = run.text("zeus");
  expect(zeus).toContain('you told hera: "The farmer cheated me."');
  expect(zeus).toContain("claiming farmer harmed zeus");
  // Nothing of Hera's private memory or feeling: Zeus holds none himself.
  expect(zeus).not.toContain("How you feel now");
  expect(zeus).not.toContain("told you:");
  expect(zeus).not.toContain("affinity");
  // Control: Hera's own prompt does show her belief and her feeling.
  expect(run.text("hera")).toContain('zeus told you: "The farmer cheated me."');
  expect(run.text("hera")).toContain("affinity");
});

// --- Voice and audience --------------------------------------------------------------------------------

test("the instructions ask for first-person words, and the legend line names who is present now", () => {
  const run = tavernRun();
  const text = run.text("zeus");
  expect(text).toMatch(/first person/);
  expect(text).toMatch(
    /without (naming|using) your own name|do not name yourself/i,
  );
  expect(text).toContain("A legend is heard by everyone here now: farmer.");
  // Control: alone, the line says no one would hear.
  const alone = new Run(actorAt(greekState(), "zeus", "tavern"));
  expect(alone.text("zeus")).toContain("No one is here to hear a legend now.");
  expect(alone.text("zeus")).not.toContain("heard by everyone here now");
});

test("a legend stays visible to a co-located god in its recent events", () => {
  const run = new Run(
    actorAt(actorAt(greekState(), "zeus", "tavern"), "hera", "tavern"),
  );
  const told = run.tick({
    actor: "hera",
    kind: "legend",
    assertion: "Zeus has wronged me.",
  });
  const legend = told.events.find((e) => e.kind === "legend-recorded");
  const seen = run.snapshot("zeus", told.events);
  expect(seen.events.map((e) => e.id)).toContain(legend?.id as never);
  expect(run.text("zeus", told.events)).toContain("Zeus has wronged me.");
  // Control: a god elsewhere does not see it.
  const elsewhere = new Run(actorAt(run.state, "zeus", "town-square"));
  // (The woodshed's income earned in the square is a placed event there, so look for the legend itself.)
  expect(
    elsewhere.snapshot("zeus", told.events).events.map((e) => e.id),
  ).not.toContain(legend?.id as never);
});

// --- The goal change an intent may carry ---------------------------------------------------------------

test("an intent may carry a goal set, with text and a target the god was shown; and a goal end only when a goal is active", () => {
  const run = tavernRun();
  const schema = run.schema("zeus");
  const set = schema.parse({
    action: "wait",
    goal: { set: { text: "Win the farmer's devotion.", target: "farmer" } },
  });
  expect(set.ok).toBe(true);
  if (set.ok) {
    expect(set.value as unknown).toEqual({
      action: "wait",
      goal: { set: { text: "Win the farmer's devotion.", target: "farmer" } },
    });
  }
  // No active goal: there is nothing to end.
  const noGoal = schema.parse({
    action: "wait",
    goal: { end: { outcome: "achieved" } },
  });
  expect(noGoal.ok).toBe(false);
  if (!noGoal.ok) expect(noGoal.path).toBe("goal.end");

  // Control: with an active goal, each outcome and both together parse.
  run.tick({ actor: "zeus", kind: "goal", goal: GOAL });
  const withGoal = run.schema("zeus");
  for (const outcome of ["achieved", "failed", "abandoned"]) {
    expect(
      withGoal.parse({ action: "wait", goal: { end: { outcome } } }).ok,
    ).toBe(true);
  }
  expect(
    withGoal.parse({
      action: "move",
      to: "town-square",
      goal: {
        end: { outcome: "failed" },
        set: { text: "Greet the farmer.", target: "farmer" },
      },
    }).ok,
  ).toBe(true);
});

test("a goal target not among the ids the god was shown is an invalid intent; one in the scene or in its memories parses", () => {
  const run = tavernRun();
  const schema = run.schema("zeus");
  const refused = schema.parse({
    action: "wait",
    goal: { set: { text: "Hunt the woodcutter.", target: "woodcutter" } },
  });
  expect(refused.ok).toBe(false);
  if (!refused.ok) expect(refused.path).toBe("goal.set.target");
  expect(
    schema.parse({
      action: "wait",
      goal: { set: { text: "Greet the farmer.", target: "farmer" } },
    }).ok,
  ).toBe(true);
  // An exit and a building are shown too.
  expect(
    schema.parse({
      action: "wait",
      goal: { set: { text: "See the square.", target: "town-square" } },
    }).ok,
  ).toBe(true);
  expect(
    schema.parse({
      action: "wait",
      goal: { set: { text: "Rebuild it.", target: "the-tavern" } },
    }).ok,
  ).toBe(true);

  // After a report, Zeus remembers (is told nothing, but hears Hera's tale) a person who is no longer in the scene.
  const told = new Run(
    actorAt(
      actorAt(greekState(), "zeus", "town-square"),
      "hera",
      "town-square",
    ),
  );
  told.tick({
    actor: "hera",
    kind: "report",
    listener: "zeus",
    content: "The woodcutter robbed me.",
    claim: { effect: "harm", agent: "woodcutter", target: "hera" },
  });
  const moved = new Run(actorAt(told.state, "zeus", "tavern"));
  moved.events.push(...told.events);
  const remembering = godIntentSchema(
    godProfile("zeus"),
    moved.snapshot("zeus"),
    rememberedBy(moved.state, id("zeus"), []),
  );
  // The woodcutter is in the square, not here, but Zeus remembers him.
  expect(moved.snapshot("zeus").actors.map((a) => a.id)).not.toContain(
    id("woodcutter"),
  );
  expect(
    remembering.parse({
      action: "wait",
      goal: { set: { text: "Confront him.", target: "woodcutter" } },
    }).ok,
  ).toBe(true);
  // Control: without that memory it is refused.
  expect(
    godIntentSchema(godProfile("zeus"), moved.snapshot("zeus")).parse({
      action: "wait",
      goal: { set: { text: "Confront him.", target: "woodcutter" } },
    }).ok,
  ).toBe(false);
});

test("goal text is bounded, non-blank, and carries a target; the shown ids exclude the god itself", () => {
  const schema = tavernRun().schema("zeus");
  const set = (text: unknown, target: unknown = "farmer") =>
    schema.parse({ action: "wait", goal: { set: { text, target } } }).ok;
  expect(set("x".repeat(MAX_GOAL_LENGTH))).toBe(true);
  expect(set("x".repeat(MAX_GOAL_LENGTH + 1))).toBe(false);
  expect(set("")).toBe(false);
  expect(set("   ")).toBe(false);
  expect(set("Ok.", null)).toBe(false);
  expect(schema.parse({ action: "wait", goal: {} }).ok).toBe(false);
  expect(schema.parse({ action: "wait", goal: "win" }).ok).toBe(false);
  const run = tavernRun();
  expect(shownIds(run.snapshot("zeus"), run.remembered("zeus"))).not.toContain(
    id("zeus"),
  );
});

test("a legend intent may carry a claim from the ids the god was shown, bounded like a report", () => {
  const schema = tavernRun().schema("zeus");
  const legend = (claim: unknown, assertion = "I did it.") =>
    schema.parse({ action: "legend", assertion, claim }).ok;
  expect(legend({ effect: "harm", agent: "zeus", target: "farmer" })).toBe(
    true,
  );
  expect(legend({ effect: "harm", agent: "woodcutter" })).toBe(false);
  expect(legend({ effect: "worship", agent: "zeus" })).toBe(false);
  expect(legend(undefined, "x".repeat(MAX_ASSERTION_LENGTH + 1))).toBe(false);
  expect(MAX_ASSERTION_LENGTH).toBe(MAX_REPORT_LENGTH);
});

// --- Building the proposal -------------------------------------------------------------------------------

function build(run: Run, raw: Record<string, unknown>, god = "zeus") {
  const snapshot = run.snapshot(god);
  const remembered = run.remembered(god);
  const parsed = godIntentSchema(godProfile(god), snapshot, remembered).parse(
    raw,
  );
  if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.message}`);
  return {
    snapshot,
    remembered,
    built: buildModelProposal(id(god), snapshot, parsed.value, remembered),
  };
}

test("a report intent with a goal set builds one proposal carrying both", () => {
  const { built } = build(tavernRun(), {
    action: "report",
    listener: "farmer",
    content: "I will see you rewarded.",
    goal: { set: { text: "Win the farmer's devotion.", target: "farmer" } },
  });
  if (!built.ok || built.kind !== "proposal")
    throw new Error("expected a proposal");
  expect(built.proposal).toMatchObject({
    kind: "report",
    listener: "farmer",
    goal: { set: { text: "Win the farmer's devotion.", target: "farmer" } },
  });
  expect(submitProposal(built.proposal).ok).toBe(true);
});

test("a wait with a goal end builds a goal-only proposal that pins no revisions; a plain wait builds nothing", () => {
  const run = tavernRun();
  run.tick({ actor: "zeus", kind: "goal", goal: GOAL });
  const { built } = build(run, {
    action: "wait",
    goal: { end: { outcome: "achieved" } },
  });
  if (!built.ok || built.kind !== "proposal")
    throw new Error("expected a proposal");
  expect(built.proposal).toMatchObject({
    kind: "goal",
    actor: "zeus",
    source: "model",
    goal: { end: { outcome: "achieved" } },
    expectedRevisions: [],
  });
  expect(built.observation.source).toBe("model");
  expect(submitProposal(built.proposal).ok).toBe(true);
  // Control: a wait with no goal change is still nothing.
  const plain = build(run, { action: "wait" }).built;
  expect(plain).toEqual({ ok: true, kind: "wait" });
});

test("a goal naming a remembered target who is not in the scene builds a valid proposal; one naming nobody shown is refused at the builder", () => {
  const told = new Run(
    actorAt(
      actorAt(greekState(), "zeus", "town-square"),
      "hera",
      "town-square",
    ),
  );
  told.tick({
    actor: "hera",
    kind: "report",
    listener: "zeus",
    content: "The woodcutter robbed me.",
    claim: { effect: "harm", agent: "woodcutter", target: "hera" },
  });
  const moved = new Run(actorAt(told.state, "zeus", "tavern"));
  const snapshot = moved.snapshot("zeus");
  const remembered = rememberedBy(moved.state, id("zeus"), []);
  const parsed = godIntentSchema(
    godProfile("zeus"),
    snapshot,
    remembered,
  ).parse({
    action: "wait",
    goal: { set: { text: "Confront him.", target: "woodcutter" } },
  });
  if (!parsed.ok) throw new Error("expected a parse");
  const built = buildModelProposal(
    id("zeus"),
    snapshot,
    parsed.value,
    remembered,
  );
  if (!built.ok || built.kind !== "proposal")
    throw new Error(`expected a proposal: ${JSON.stringify(built)}`);
  expect(built.proposal.kind).toBe("goal");
  // The observation names what was read: the memory that named the target, a fact the snapshot cannot hold.
  expect(built.observation.factsRead.some((f) => f.startsWith("memory:"))).toBe(
    true,
  );
  // The same parsed intent against a god that was never shown the woodcutter is refused.
  const refused = buildModelProposal(id("zeus"), snapshot, parsed.value);
  expect(refused.ok).toBe(false);
});

test("a goal target in the scene is read as a snapshot fact", () => {
  const { built, snapshot } = build(tavernRun(), {
    action: "wait",
    goal: { set: { text: "Greet him.", target: "farmer" } },
  });
  if (!built.ok || built.kind !== "proposal")
    throw new Error("expected a proposal");
  expect(built.observation.factsRead).toContain("actor:farmer.location");
  void snapshot;
});

test("a legend intent with a claim builds a legend proposal carrying it", () => {
  const { built } = build(tavernRun(), {
    action: "legend",
    assertion: "I struck the tavern.",
    claim: { effect: "harm", agent: "zeus", target: "farmer" },
  });
  if (!built.ok || built.kind !== "proposal")
    throw new Error("expected a proposal");
  expect(built.proposal).toMatchObject({
    kind: "legend",
    claim: { effect: "harm", agent: "zeus", target: "farmer" },
  });
});

test("repeated reports to the same listener collapse to the newest few in what a god sees of its own actions, and other actions are not crowded out", () => {
  const run = tavernRun();
  run.tick({ actor: "zeus", kind: "move", to: "town-square" });
  for (let i = 1; i <= 6; i += 1) {
    run.tick({
      actor: "zeus",
      kind: "report",
      listener: "hera",
      content: `Word number ${i}.`,
    });
  }
  const shown = run.remembered("zeus").ownActions;
  const toHera = shown.filter((e) => e.kind === "report-told");
  expect(toHera).toHaveLength(MAX_REPEATED_REPORTS);
  // The newest ones are what remain, and the earlier move shows instead of the reports it was pushed out by.
  expect(
    toHera.map((e) => (e.kind === "report-told" ? e.content : "")),
  ).toEqual(["Word number 5.", "Word number 6."]);
  expect(shown.some((e) => e.kind === "entity-moved")).toBe(true);
  // A report to someone else is a different target: not collapsed with them.
  run.tick({
    actor: "zeus",
    kind: "report",
    listener: "woodcutter",
    content: "Word to the woodcutter.",
  });
  const after = run.remembered("zeus").ownActions;
  expect(
    after.filter(
      (e) => e.kind === "report-told" && e.listenerId === id("hera"),
    ),
  ).toHaveLength(MAX_REPEATED_REPORTS);
  expect(
    after.some(
      (e) => e.kind === "report-told" && e.listenerId === id("woodcutter"),
    ),
  ).toBe(true);
});

test("repeated told memories from the same teller collapse to the newest few, so one repeated voice does not fill what the god remembers", () => {
  const run = new Run(
    actorAt(actorAt(greekState(), "zeus", "tavern"), "hera", "tavern"),
  );
  for (let i = 1; i <= 5; i += 1) {
    run.tick({
      actor: "hera",
      kind: "report",
      listener: "zeus",
      content: `Hera's word number ${i}.`,
    });
  }
  const told = run
    .remembered("zeus")
    .memories.filter((m) => m.kind === "told" && m.teller === id("hera"));
  expect(told).toHaveLength(MAX_REPEATED_REPORTS);
  expect(told.map((m) => (m.kind === "told" ? m.content : ""))).toEqual([
    "Hera's word number 4.",
    "Hera's word number 5.",
  ]);
});

// --- Goals a god can finish -----------------------------------------------------------------

test("the goal guidance asks for a goal the god can finish or fail within a few turns, and the schema and parser are unchanged", () => {
  for (const run of [tavernRun(), new Run(greekState())]) {
    const text = run.text("zeus");
    expect(text).toContain("within a few turns");
    // A goal still takes only the shapes it always did.
    const schema = run.schema("zeus");
    const goal = (
      schema.jsonSchema as {
        properties: { goal: { properties: Record<string, unknown> } };
      }
    ).properties.goal;
    expect(Object.keys(goal.properties)).toEqual(["set"]);
  }
});

test("a god with an active goal is told to judge it each turn and end it if achieved or failed; one without is not, and ending is still offered and parsed as before", () => {
  const run = tavernRun();
  const without = section(run.text("zeus"), "You have no goal", "You are at");
  expect(without).not.toContain("achieved or failed");

  run.tick({ actor: "zeus", kind: "goal", goal: GOAL });
  const goal = section(run.text("zeus"), "Your goal", "You are at");
  expect(goal).toContain("achieved or failed");
  expect(goal).toContain("end it");

  // Nothing about ending changed: it is offered, and it parses.
  const schema = run.schema("zeus");
  const end = (
    schema.jsonSchema as {
      properties: {
        goal: {
          properties: {
            end: { properties: { outcome: { enum: string[] } } };
          };
        };
      };
    }
  ).properties.goal.properties.end;
  expect(end.properties.outcome.enum).toEqual([
    "achieved",
    "failed",
    "abandoned",
  ]);
  expect(
    schema.parse({
      action: "wait",
      goal: { end: { outcome: "achieved" } },
    }).ok,
  ).toBe(true);
});
