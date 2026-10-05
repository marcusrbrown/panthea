import { expect, test } from "bun:test";
import type { ContentPack } from "@panthea/contracts";
import {
  createInitialWorldState,
  createPrng,
  runTick,
  submitProposal,
} from "@panthea/world";
import { analyzeEpisode } from "./episode-analysis";
import {
  act,
  goalEndedEvent,
  goalRefusedEvent,
  goalSetEvent,
  identities,
  input,
  memoryEvent,
  move,
  petitionAnsweredEvent,
  petitionLapsedEvent,
  petitionOpenedEvent,
} from "./episode-test-data";
import { episodeSettings } from "./episodes";
import { analyzeReal, type RealInput } from "./real-analysis";
import {
  buildActions,
  type EpisodeRecord,
  renderSummary,
  renderTranscript,
} from "./transcript";

function record(
  acts: ReturnType<typeof act>[],
  extraEvents: Record<string, unknown>[] = [],
  index = 1,
): EpisodeRecord {
  const data = input(acts, extraEvents);
  return {
    index,
    total: 3,
    settings: {
      model: "llama3.2-3b-4k",
      seconds: 300,
      ranAt: "2026-09-30T12:00:00.000Z",
      ticks: 300,
      hardware: "Apple M1 Pro",
    },
    identities: ["zeus", "hera"].flatMap((god) => {
      const identity = identities.get(god);
      return identity ? [identity] : [];
    }),
    input: data,
    analysis: analyzeReal(data),
    episode: analyzeEpisode(data, identities, ["zeus", "hera"]),
  };
}

const story = () => {
  const report = act(
    "zeus",
    {
      kind: "report",
      listener: "hera",
      content: "I struck the tavern and I regret nothing.",
      claim: { effect: "harm", agent: "zeus" },
    },
    10,
  );
  const belief = memoryEvent("evt-10-11", 11, {
    memoryKind: "told",
    entityId: "hera",
    sourceEventId: report.event.id,
    teller: "zeus",
    content: "I struck the tavern and I regret nothing.",
    consequence: { effect: "harm", agent: "zeus" },
  });
  const change = {
    schemaVersion: 1,
    id: "evt-10-12",
    sequence: 12,
    simTime: 0,
    correlationId: "tick-10",
    causationId: "x",
    tick: 1,
    approximate: false,
    kind: "relationship-changed",
    entityId: "hera",
    toward: "zeus",
    affinityDelta: -1,
    grudgeDelta: 0,
    memoryEventId: belief.id,
  };
  return record(
    [
      move("zeus", "olympus-gate", 2),
      act("hera", { kind: "legend", assertion: "Hera remembers her vows." }, 5),
      report,
    ],
    [belief, change],
  );
};

test("the transcript opens with the settings and an identity header per god from its profile", () => {
  const text = renderTranscript(story());
  expect(text).toContain("# Episode 1 of 3");
  expect(text).toContain("llama3.2-3b-4k");
  expect(text).toContain("300 s");
  expect(text).toContain("fresh world");
  expect(text).toContain("### Zeus");
  expect(text).toContain("sovereignty 0.9");
  expect(text).toContain("Thunderbolt (strike)");
  expect(text).toContain("### Hera");
  expect(text).toContain("Tale of a Grievance (legend)");
});

test("actions are listed in the order the world applied them, each with tick, god, action and target, backing, and the model's own words", () => {
  const actions = buildActions(story());
  expect(actions.map((a) => `${a.god}:${a.verb}`)).toEqual([
    "zeus:travel → olympus-gate",
    "hera:legend",
    "zeus:report → hera",
  ]);
  expect(actions.map((a) => a.backing)).toEqual([
    "context-backed",
    "ability-backed",
    "context-backed",
  ]);
  expect(actions[2]?.text).toBe("I struck the tavern and I regret nothing.");
  expect(actions[2]?.claim).toBe("harm by zeus");
  expect(actions[1]?.text).toBe("Hera remembers her vows.");
  expect(actions[0]?.tick).toBe(2);

  const text = renderTranscript(story());
  const happened = text.slice(
    text.indexOf("## What happened"),
    text.indexOf("## Repetition"),
  );
  const order = ["travel → olympus-gate", "legend", "report → hera"].map((s) =>
    happened.indexOf(s),
  );
  expect(order.every((i) => i >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(text).toContain("I struck the tavern and I regret nothing.");
  expect(text).toContain("claim: harm by zeus");
});

test("each action lists the events it caused and the beliefs and feelings that followed from them", () => {
  const report = buildActions(story()).find((a) => a.verb === "report → hera");
  expect(report?.caused).toEqual(["report-told (zeus → hera)"]);
  expect(report?.changes).toEqual([
    'hera now believes zeus: "I struck the tavern and I regret nothing."',
    "hera → zeus: affinity -1",
  ]);
  const text = renderTranscript(story());
  expect(text).toContain("hera → zeus: affinity -1");
  // The move caused no belief or feeling: nothing listed under it.
  const move = buildActions(story()).find((a) => a.verb.startsWith("travel"));
  expect(move?.changes).toEqual([]);
});

/** The "## What happened" block split into its numbered action blocks, each with the god named on its first line. */
function actionBlocks(text: string) {
  const happened = text.slice(
    text.indexOf("## What happened"),
    text.indexOf("## Repetition"),
  );
  return happened
    .split(/\n(?=\d+\. \*\*)/)
    .filter((block) => /^\d+\. \*\*/.test(block))
    .map((block) => {
      const head = /^\d+\. \*\*tick (\d+), (\w+):\*\*/.exec(block);
      return { tick: Number(head?.[1]), god: head?.[2], block };
    });
}

const citedStory = () => {
  const zeusMove = move("zeus", "town-square", 10);
  const heraReport = act(
    "hera",
    {
      kind: "report",
      listener: "farmer",
      content: "I saw Zeus arrive.",
      linkedEventId: zeusMove.event.id,
    },
    12,
  );
  const belief = memoryEvent("evt-12-13", 13, {
    memoryKind: "told",
    entityId: "farmer",
    sourceEventId: heraReport.event.id,
    teller: "hera",
    content: "I saw Zeus arrive.",
  });
  const change = {
    schemaVersion: 1,
    id: "evt-12-14",
    sequence: 14,
    simTime: 0,
    correlationId: "tick-12",
    causationId: "x",
    tick: 1,
    approximate: false,
    kind: "relationship-changed",
    entityId: "farmer",
    toward: "zeus",
    affinityDelta: -1,
    grudgeDelta: 0,
    memoryEventId: belief.id,
  };
  return { zeusMove, heraReport, belief, change };
};

test("a belief caused by Hera's report appears under Hera's line, not under Zeus's action she cited", () => {
  const { zeusMove, heraReport, belief, change } = citedStory();
  const text = renderTranscript(
    record([zeusMove, heraReport], [belief, change]),
  );
  const blocks = actionBlocks(text);
  // The right gods, in the order the world applied them.
  expect(blocks.map((b) => [b.tick, b.god])).toEqual([
    [10, "Zeus"],
    [12, "Hera"],
  ]);
  const [zeus, hera] = blocks;
  expect(hera?.block).toContain(
    'then: farmer now believes hera: "I saw Zeus arrive."',
  );
  expect(hera?.block).toContain("then: farmer → zeus: affinity -1");
  expect(zeus?.block).not.toContain("then:");
  expect(zeus?.block).not.toContain("farmer now believes");
  expect(zeus?.block).not.toContain("affinity");
});

test("control: Zeus's own report puts the belief under Zeus's line, and the rule holds for both gods at once", () => {
  const { zeusMove, heraReport, belief, change } = citedStory();
  const zeusReport = act(
    "zeus",
    { kind: "report", listener: "farmer", content: "I arrived." },
    20,
  );
  const zeusBelief = memoryEvent("evt-20-21", 21, {
    memoryKind: "told",
    entityId: "farmer",
    sourceEventId: zeusReport.event.id,
    teller: "zeus",
    content: "I arrived.",
  });
  const text = renderTranscript(
    record([zeusMove, heraReport, zeusReport], [belief, change, zeusBelief]),
  );
  const blocks = actionBlocks(text);
  expect(blocks.map((b) => [b.tick, b.god])).toEqual([
    [10, "Zeus"],
    [12, "Hera"],
    [20, "Zeus"],
  ]);
  expect(blocks[0]?.block).not.toContain("then:");
  expect(blocks[1]?.block).toContain("farmer now believes hera");
  expect(blocks[2]?.block).toContain(
    'then: farmer now believes zeus: "I arrived."',
  );
  expect(blocks[2]?.block).not.toContain("farmer now believes hera");
});

test("a memory of what was witnessed is listed under the action that caused what was seen", () => {
  const strike = act(
    "zeus",
    { kind: "strike", target: "the-tavern", power: 3 },
    20,
  );
  const seen = memoryEvent("evt-20-21", 21, {
    memoryKind: "witnessed",
    entityId: "farmer",
    sourceEventId: strike.event.id,
    eventKind: "entity-moved",
  });
  const actions = buildActions(record([strike], [seen]));
  expect(actions[0]?.changes).toEqual(["farmer remembers entity-moved"]);
});

test("the repetition summary, the automated check table, and a blank rubric follow", () => {
  const text = renderTranscript(story());
  expect(text).toContain("## Repetition");
  expect(text).toContain("longest run");
  expect(text).toContain("| God | Check | Result | Detail |");
  expect(text).toContain("| Zeus | profile trace | pass |");
  expect(text).toContain("| Hera | minimum activity | FAIL |");
  // The rubric: five dimensions, an empty score and notes column, an empty decision.
  for (const dimension of [
    "Novelty",
    "Causality",
    "Recognizable identity",
    "Pacing",
    "Inspectability",
  ]) {
    expect(text).toMatch(new RegExp(`\\| ${dimension} \\| +\\| +\\|`));
  }
  expect(text).toContain(
    "0 = replan pressure, 1 = needs tuning, 2 = good enough to continue",
  );
  expect(text).toContain("Decision: continue / tune / replan:");
  expect(text).toMatch(/Decision: continue \/ tune \/ replan: *$/m);
});

test("the tool never scores: no dimension has a value in the rubric, and no raw prompt is pasted", () => {
  const text = renderTranscript(story());
  const rubric = text.slice(text.indexOf("## Owner rubric"));
  for (const row of rubric
    .split("\n")
    .filter((l) =>
      /^\| (Novelty|Causality|Recognizable|Pacing|Inspectability)/.test(l),
    )) {
    const cells = row.split("|").map((c) => c.trim());
    expect(cells[2]).toBe("");
    expect(cells[3]).toBe("");
  }
  expect(text).not.toContain("You are at");
  expect(text).not.toContain("What do you do?");
});

test("the model run's numbers and properties are in the transcript", () => {
  const text = renderTranscript(story());
  expect(text).toContain("## Model run");
  expect(text).toContain("requests");
  expect(text).toContain("valid actions");
});

test("the model-run section says when each god was asked and how long it waited: a row per request, a row per god, a god never asked at 0 turns, an inferred in-flight request marked", () => {
  const base = story();
  const asked = (god: string, tick: number, at: number, ms: number) => ({
    proposalId: `timing-${god}-${tick}`,
    role: god,
    outcome: "intent" as const,
    elapsedMs: ms,
    promptPayload: `You are ${god}.\nYou are at The Square [square] in the mortal realm, tick ${tick}.\n`,
    steps: [{ mode: "native" }],
    recordedAt: at,
  });
  const requests = [
    ...base.input.requests,
    asked("athena", 3, 12_000, 9_000),
    asked("hades", 12, 22_000, 10_000),
  ];
  const input = {
    ...base.input,
    requests,
    timing: {
      gods: ["athena", "hades", "hera", "poseidon", "zeus"],
      endedAtMs: 31_000,
      endTick: 33,
    },
  };
  const text = renderTranscript({ ...base, input });
  const section = text.slice(text.indexOf("## Model run"));
  expect(section).toContain(
    "| # | God | Asked at tick | Applied at tick | Latency | Outcome | Prompt chars |",
  );
  expect(section).toContain("| athena | 3 |");
  expect(section).toContain("| hades | 12 |");
  expect(section).toContain("in flight at the end (inferred)");
  expect(section).toContain(
    "| God | Turns | Median gap (ticks) | Worst gap (ticks) | Median latency |",
  );
  // Poseidon is a god of the run and was never asked.
  expect(section).toContain("| poseidon | 0 | — | — | — |");
  // The gate's own lines are as they were.
  expect(section).toContain("valid actions");
});

test("the summary covers every episode with each god's numbers and checks, and links the transcripts", () => {
  const good = record(
    ["a", "b", "c", "d", "e"].map((to, i) => move("zeus", to, i + 1)),
    [],
    1,
  );
  const bad = record([move("zeus", "a", 1)], [], 2);
  const text = renderSummary([good, bad], {
    seconds: 300,
    model: "llama3.2-3b-4k",
    files: ["episode-1.md", "episode-2.md"],
  });
  expect(text).toContain("# M2 experience gate");
  expect(text).toContain("[episode-1.md](episode-1.md)");
  expect(text).toContain("[episode-2.md](episode-2.md)");
  expect(text).toMatch(/\| 1 \| Zeus \|/);
  expect(text).toMatch(/\| 2 \| Zeus \|/);
  expect(text).toContain("Automated checks failed");
  expect(text).toContain("Decision: continue / tune / replan:");
  // Control: a set that passes every check says none failed.
  const passing = input(
    [
      act("zeus", { kind: "report", listener: "hera", content: "x" }, 1),
      ...["b", "c", "d", "e"].map((to, i) => move("zeus", to, i + 2)),
    ],
    [
      memoryEvent("evt-9-9", 9, {
        memoryKind: "told",
        entityId: "hera",
        sourceEventId: "evt-1-1",
        teller: "zeus",
        content: "x",
      }),
      goalSetEvent("evt-0-1", 1, "zeus"),
      goalEndedEvent("evt-0-2", 2, "zeus", "evt-0-1"),
      petitionOpenedEvent("evt-0-3", 3, "farmer", "zeus"),
      petitionAnsweredEvent("evt-0-4", 4, "farmer", "zeus", "evt-0-3"),
    ],
  );
  const zeus = identities.get("zeus");
  if (!zeus) throw new Error("no zeus");
  const clean = renderSummary(
    [
      {
        ...good,
        identities: [zeus],
        input: passing,
        analysis: {
          ...analyzeReal(passing),
          properties: analyzeReal(passing).properties.map((p) => ({
            ...p,
            ok: true,
          })),
        },
        episode: analyzeEpisode(passing, identities, ["zeus"]),
      },
    ],
    { seconds: 300, model: "m", files: ["episode-1.md"] },
  );
  expect(clean).toContain("All automated checks and real-run properties held.");
  expect(clean).not.toContain("Automated checks failed");
});

// --- A real tick: a witnessed feeling is shown under the action that caused what was seen ---

/** A small real world: Zeus, the farmer (who owns the tavern), and a bard at the tavern. */
const tavernPack = (): ContentPack => ({
  schemaVersion: 1,
  realms: ["mortal"],
  resources: [],
  locations: [{ id: "tavern", realm: "mortal", name: "The Tavern", edges: [] }],
  buildings: [
    {
      id: "the-tavern",
      locationId: "tavern",
      name: "The Tavern House",
      material: "wood",
      combustible: true,
      services: ["drink"],
      inventory: [],
      owner: "farmer",
    },
  ],
  inhabitants: [
    {
      id: "zeus",
      name: "Zeus",
      locationId: "tavern",
      deity: true,
      startingInventory: [{ resource: "divinity", amount: 100 }],
    },
    { id: "farmer", name: "The Farmer", locationId: "tavern" },
  ],
  rules: {
    catchUpCapMs: 0,
    catchUpChunkMs: 0,
    checkpointIntervalMs: 0,
    maxProposalsPerTick: 100,
    fireBalance: {
      igniteThreshold: 3,
      intensityGrowthPerTick: 1,
      destroyIntensity: 6,
    },
    economyBalance: { worshipCapacityGain: 1, favorDurationTicks: 5 },
  },
  recipes: {},
});

test("a witnessed relationship change from a real tick is rendered under the strike that caused what was seen", () => {
  const submitted = submitProposal({
    schemaVersion: 1,
    actor: "zeus",
    kind: "strike",
    target: "the-tavern",
    power: 3,
    targets: [],
    expectedRevisions: [],
    source: "fixture",
    observationId: "obs-strike",
  });
  if (!submitted.ok) throw new Error(submitted.rejection.message);
  const ticked = runTick(createInitialWorldState(tavernPack()), createPrng(1), [
    submitted.proposal,
  ]);
  // The world itself emitted the feeling: the farmer, whose tavern it was.
  const change = ticked.events.find((e) => e.kind === "relationship-changed");
  expect(change).toMatchObject({
    entityId: "farmer",
    toward: "zeus",
    affinityDelta: -2,
    grudgeDelta: 1,
  });

  const data: RealInput = {
    requests: [
      {
        proposalId: "p1",
        role: "zeus",
        outcome: "intent",
        elapsedMs: 1000,
        promptPayload: "prompt",
        steps: [{ mode: "native" }],
      },
    ],
    proposals: [
      {
        proposalId: "p1",
        actor: "zeus",
        kind: "strike",
        observationId: "obs-strike",
        proposal: { actor: "zeus", kind: "strike", target: "the-tavern" },
        outcome: "committed",
      },
    ],
    events: JSON.parse(JSON.stringify(ticked.events)),
    polls: { total: 1, degraded: 0 },
  };
  const zeus = identities.get("zeus");
  if (!zeus) throw new Error("no zeus");
  const text = renderTranscript({
    index: 1,
    total: 1,
    settings: {
      model: "m",
      seconds: 1,
      ranAt: "2026-09-30T00:00:00.000Z",
      ticks: 1,
      hardware: "h",
    },
    identities: [zeus],
    input: data,
    analysis: analyzeReal(data),
    episode: analyzeEpisode(data, identities, ["zeus"]),
  });
  const [strike] = actionBlocks(text);
  expect(strike?.god).toBe("Zeus");
  expect(strike?.block).toContain("strike → the-tavern");
  expect(strike?.block).toContain("remember building-ignited");
  expect(strike?.block).toContain("farmer → zeus: affinity -2, grudge +1");
});

test("control: a witnessed feeling is listed once, and a belief-only feeling is not rendered as a witnessed one", () => {
  // The Hera-cites-Zeus story has told feelings only: nothing new appears under Zeus's move.
  const { zeusMove, heraReport, belief, change } = citedStory();
  const blocks = actionBlocks(
    renderTranscript(record([zeusMove, heraReport], [belief, change])),
  );
  expect(blocks[0]?.block).not.toContain("affinity");
  expect(blocks[1]?.block.match(/affinity -1/g)).toHaveLength(1);
});

// --- The summary's verdict covers the real-run properties too ------------------------------

test("the summary does not say everything held when a real-run property failed, and names it; when all held it says so", () => {
  const passing = input(
    [
      act("zeus", { kind: "report", listener: "hera", content: "x" }, 1),
      ...["b", "c", "d", "e"].map((to, i) => move("zeus", to, i + 2)),
    ],
    [
      memoryEvent("evt-9-9", 9, {
        memoryKind: "told",
        entityId: "hera",
        sourceEventId: "evt-1-1",
        teller: "zeus",
        content: "x",
      }),
      goalSetEvent("evt-0-1", 1, "zeus"),
      goalEndedEvent("evt-0-2", 2, "zeus", "evt-0-1"),
      petitionOpenedEvent("evt-0-3", 3, "farmer", "zeus"),
      petitionAnsweredEvent("evt-0-4", 4, "farmer", "zeus", "evt-0-3"),
    ],
  );
  const zeus = identities.get("zeus");
  if (!zeus) throw new Error("no zeus");
  const base = record([move("zeus", "a", 1)]);
  const perGodPass = analyzeEpisode(passing, identities, ["zeus"]);
  expect(perGodPass.ok).toBe(true);
  const failing = analyzeReal(passing);
  const failedProperty = failing.properties.find((p) => !p.ok);
  // The data really has a failed property: the per-god checks pass and the run did not.
  expect(failedProperty).toBeDefined();

  const settings = { seconds: 300, model: "m", files: ["episode-1.md"] };
  const one = {
    ...base,
    identities: [zeus],
    input: passing,
    analysis: failing,
    episode: perGodPass,
  };
  const text = renderSummary([one], settings);
  expect(text).not.toContain("All automated checks");
  expect(text).toContain("Automated checks failed");
  expect(text).toContain(`episode 1, property ${failedProperty?.name}`);

  // Control: every check and every property held.
  const held = renderSummary(
    [
      {
        ...one,
        analysis: {
          ...failing,
          properties: failing.properties.map((p) => ({ ...p, ok: true })),
        },
      },
    ],
    settings,
  );
  expect(held).toContain("All automated checks and real-run properties held.");
  expect(held).not.toContain("Automated checks failed");
});

// --- Settings name the model and the reasoning mode; the repetition list is complete ------

test("the settings name the model and say whether reasoning was off", () => {
  const base = story();
  const off = renderTranscript({
    ...base,
    settings: {
      ...base.settings,
      model: "gemma4-e4b-4k",
      reasoningEffort: "none",
    },
  });
  expect(off).toContain("Model: gemma4-e4b-4k");
  expect(off).toContain("reasoning off (reasoning_effort none)");
  // Control: unset says the model's own default, not off.
  const on = renderTranscript(base);
  expect(on).toContain("reasoning at the model's default");
  expect(on).not.toContain("reasoning off");

  const summarySettings = {
    seconds: 60,
    model: "gemma4-e4b-4k",
    files: ["episode-1.md"],
  };
  expect(
    renderSummary([base], { ...summarySettings, reasoningEffort: "none" }),
  ).toContain("reasoning off (reasoning_effort none)");
  expect(renderSummary([base], summarySettings)).toContain(
    "reasoning at the model's default",
  );
});

test("the repetition summary lists every distinct choice a god made, not the top five", () => {
  const targets = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const acts = [
    ...targets.map((to, i) => move("zeus", to, i + 1)),
    // Weight the first choices, so a top-five cut would drop the last ones.
    move("zeus", "a", 20),
    move("zeus", "b", 21),
  ];
  const text = renderTranscript(record(acts));
  const zeus = text
    .slice(text.indexOf("## Repetition"), text.indexOf("## Automated checks"))
    .split("\n")
    .find((line) => line.startsWith("- Zeus:"));
  for (const to of targets) expect(zeus).toContain(`travel:${to}`);
  expect(zeus).toContain("travel:a ×2");
  expect(zeus).toContain("travel:h ×1");
  // Control: a god with one choice lists one.
  const hera = text.split("\n").find((line) => line.startsWith("- Hera:"));
  expect(hera).toContain("Choices: none");
});

// --- Goals and legends --------------------------------------------------------------------------

test("goal-set and goal-ended lines are rendered in order, and each action sits under the goal active when it was chosen", () => {
  const beforeGoal = move("hera", "great-hall", 2);
  const setGoal = act(
    "hera",
    {
      kind: "goal",
      goal: { set: { text: "Win the farmer's devotion.", target: "farmer" } },
    },
    4,
  );
  const duringA = move("hera", "town-square", 6);
  const duringB = act(
    "hera",
    { kind: "report", listener: "farmer", content: "Be at peace." },
    8,
  );
  const afterGoal = move("hera", "tavern", 12);
  const ended = goalEndedEvent(
    "evt-10-10",
    10,
    "hera",
    setGoal.event.id,
    "achieved",
  );
  const text = renderTranscript(
    record([beforeGoal, setGoal, duringA, duringB, afterGoal], [ended]),
  );
  const blocks = actionBlocks(text);

  expect(
    blocks.map((b) =>
      b.block
        .split("\n")[0]
        ?.replace(/^\d+\. \*\*/, "")
        .split(":**")[1]
        ?.trim(),
    ),
  ).toEqual([
    "travel → great-hall (context-backed)",
    "goal set → farmer (declaration)",
    "travel → town-square (context-backed)",
    "report → farmer (context-backed)",
    "goal ended (achieved) (declaration)",
    "travel → tavern (context-backed)",
  ]);
  expect(blocks[1]?.block).toContain('"Win the farmer\'s devotion."');
  expect(blocks[4]?.block).toContain('"Win the farmer\'s devotion."');
  // Before the goal and after its end: no goal. Between: under it.
  expect(blocks[0]?.block).not.toContain("under goal");
  expect(blocks[2]?.block).toContain(
    'under goal: "Win the farmer\'s devotion." (→ farmer)',
  );
  expect(blocks[3]?.block).toContain(
    'under goal: "Win the farmer\'s devotion." (→ farmer)',
  );
  expect(blocks[5]?.block).not.toContain("under goal");
  // The declaration is not an action: the goal-only proposal has no action line of its own.
  expect(blocks.filter((b) => b.block.includes("(declaration)"))).toHaveLength(
    2,
  );
});

test("an action that carries a goal change is chosen under the old goal, and the new goal's line follows it", () => {
  const first = act(
    "zeus",
    { kind: "goal", goal: { set: { text: "Calm the sky.", target: "hera" } } },
    2,
  );
  // One turn: a move, and a replacement goal (the old one ends as abandoned).
  const turn = move("zeus", "olympus-gate", 5);
  const abandoned = goalEndedEvent(
    "evt-5-6",
    6,
    "zeus",
    first.event.id,
    "abandoned",
  );
  const replacement = {
    ...goalSetEvent("evt-5-7", 7, "zeus", "Punish the farmer.", "farmer"),
    correlationId: turn.proposal.observationId,
  };
  const blocks = actionBlocks(
    renderTranscript(
      record(
        [first, turn],
        [
          { ...abandoned, correlationId: turn.proposal.observationId },
          replacement,
        ],
      ),
    ),
  );
  const lines = blocks.map((b) =>
    b.block.split("\n")[0]?.split(":**")[1]?.trim(),
  );
  expect(lines).toEqual([
    "goal set → hera (declaration)",
    "travel → olympus-gate (context-backed)",
    "goal ended (abandoned) (declaration)",
    "goal set → farmer (declaration)",
  ]);
  expect(blocks[1]?.block).toContain('under goal: "Calm the sky." (→ hera)');
  // The goal events do not clutter the move's caused list.
  expect(blocks[1]?.block).not.toContain("goal-set");
});

test("a legend's entry lists who heard it and each hearer's belief and feeling, with the narrator, not the hearer, credited", () => {
  const legend = act(
    "hera",
    {
      kind: "legend",
      assertion: "Zeus has wronged me.",
      hearers: ["farmer", "zeus"],
      claim: { effect: "harm", agent: "zeus", target: "hera" },
    },
    10,
  );
  const farmerBelief = memoryEvent("evt-10-11", 11, {
    memoryKind: "told",
    entityId: "farmer",
    sourceEventId: legend.event.id,
    teller: "hera",
    content: "Zeus has wronged me.",
    consequence: { effect: "harm", agent: "zeus", target: "hera" },
  });
  const farmerFeeling = {
    schemaVersion: 1,
    id: "evt-10-12",
    sequence: 12,
    simTime: 0,
    correlationId: "tick-10",
    causationId: "x",
    tick: 1,
    approximate: false,
    kind: "relationship-changed",
    entityId: "farmer",
    toward: "zeus",
    affinityDelta: -1,
    grudgeDelta: 0,
    memoryEventId: farmerBelief.id,
  };
  const text = renderTranscript(
    record([legend], [farmerBelief, farmerFeeling]),
  );
  const [entry] = actionBlocks(text);
  expect(entry?.god).toBe("Hera");
  expect(entry?.block).toContain("legend (ability-backed)");
  expect(entry?.block).toContain('says: "Zeus has wronged me."');
  expect(entry?.block).toContain("heard by: farmer, zeus");
  expect(entry?.block).toContain(
    'farmer now believes hera: "Zeus has wronged me."',
  );
  expect(entry?.block).toContain("farmer → zeus: affinity -1");
  // Control: a legend with no one present says so.
  const alone = act(
    "hera",
    { kind: "legend", assertion: "To no one.", hearers: [] },
    20,
  );
  expect(actionBlocks(renderTranscript(record([alone])))[0]?.block).toContain(
    "heard by: no one",
  );
});

test("the summary shows each god's goals set and ended", () => {
  const acts = ["a", "b", "c", "d", "e"].map((to, i) =>
    move("zeus", to, i + 1),
  );
  const withGoals = record(acts, [
    goalSetEvent("evt-0-1", 1, "zeus"),
    goalEndedEvent("evt-0-2", 2, "zeus", "evt-0-1"),
    petitionOpenedEvent("evt-0-3", 3, "farmer", "zeus"),
    petitionAnsweredEvent("evt-0-4", 4, "farmer", "zeus", "evt-0-3"),
  ]);
  const text = renderSummary([withGoals], {
    seconds: 60,
    model: "m",
    files: ["episode-1.md"],
  });
  expect(text).toContain("Goals set / ended");
  expect(text).toMatch(/\| 1 \| Zeus \|[^\n]*\| 1 \/ 1 \|/);
  // Control: with none, it says 0 / 0 and names the failed checks.
  const none = renderSummary([record(acts)], {
    seconds: 60,
    model: "m",
    files: ["episode-1.md"],
  });
  expect(none).toMatch(/\| 1 \| Zeus \|[^\n]*\| 0 \/ 0 \|/);
  expect(none).toContain("goal set");
});

test("the model-run block states the prompt size against the 4K budget", () => {
  const data = record([move("zeus", "a", 1)]);
  const withPrompts = {
    ...data,
    analysis: { ...data.analysis, promptChars: { p50: 3900, max: 4800 } },
  };
  const text = renderTranscript(withPrompts);
  expect(text).toContain("prompt p50 3900 / max 4800 characters");
});

// --- Prayers, answers, trouble, needs, and refusals ------------------------------------------------

const worldSection = (text: string) =>
  text.slice(
    text.indexOf("## What the world did"),
    text.indexOf("## Repetition"),
  );

const baseEvent = (id: string, sequence: number, tick: number) => ({
  schemaVersion: 1,
  id,
  sequence,
  simTime: 0,
  tick,
  correlationId: `tick-${tick}`,
  causationId: `tick-${tick}`,
  approximate: false,
});

test("a transcript shows the director's theft, the farmer's prayer, Zeus's strike answering it, the sign, and the affinity rise, in order", () => {
  const theft = {
    ...baseEvent("evt-12-1", 1, 12),
    kind: "theft",
    entityId: "woodcutter",
    victim: "farmer",
    resource: "currency",
    amount: 3,
    cause: "director",
  };
  const prayer = {
    ...petitionOpenedEvent("evt-20-2", 2, "farmer", "zeus", "evt-12-1", 20),
    request: {
      kind: "punish",
      offender: "woodcutter",
      buildings: ["woodshed"],
    },
  };
  const strike = act(
    "zeus",
    { kind: "strike", target: "woodshed", power: 1 },
    30,
  );
  const answered = petitionAnsweredEvent(
    "evt-30-31",
    31,
    "farmer",
    "zeus",
    "evt-20-2",
    strike.event.id,
    30,
  );
  const sign = {
    ...baseEvent("evt-30-32", 32, 30),
    kind: "memory-recorded",
    memoryKind: "sign",
    entityId: "farmer",
    sourceEventId: "evt-30-31",
    god: "zeus",
    outcome: "answered",
    petitionId: "evt-20-2",
    subjects: ["zeus"],
    salience: 6,
    consequence: { effect: "kindness", agent: "zeus", target: "farmer" },
  };
  const feeling = {
    ...baseEvent("evt-30-33", 33, 30),
    kind: "relationship-changed",
    entityId: "farmer",
    toward: "zeus",
    affinityDelta: 1,
    grudgeDelta: 0,
    memoryEventId: "evt-30-32",
  };
  const text = renderTranscript(
    record([strike], [theft, prayer, answered, sign, feeling]),
  );
  const world = worldSection(text);
  const lines = world.split("\n").filter((l) => l.startsWith("- tick"));
  expect(lines[0]).toContain("tick 12");
  expect(lines[0]).toContain(
    "the director made woodcutter take 3 currency from farmer",
  );
  expect(lines[1]).toContain("tick 20: farmer prayed to zeus");
  expect(lines[1]).toContain("punish woodcutter");
  expect(lines[2]).toContain("tick 30: zeus answered farmer's prayer");
  expect(lines[3]).toContain("farmer remembers zeus's answer");
  expect(lines[4]).toContain("farmer → zeus: affinity +1");
  expect(lines).toHaveLength(5);
  // The god's own action is still listed under what it did.
  expect(actionBlocks(text)[0]?.block).toContain("strike → woodshed");
});

test("a lapse, a blessing, spoiled stock, a director fire, an unmet need, and a refused goal change each get a line, and nothing else is listed", () => {
  const events = [
    {
      ...baseEvent("evt-3-1", 1, 3),
      kind: "unmet-need",
      entityId: "farmer",
      resource: "planks",
      reason: "no-seller",
    },
    {
      ...baseEvent("evt-4-2", 2, 4),
      kind: "stock-spoiled",
      entityId: "farmer",
      resource: "food",
      amount: 2,
      cause: "director",
    },
    {
      ...baseEvent("evt-5-3", 3, 5),
      kind: "building-ignited",
      entityId: "the-tavern",
      cause: { kind: "director" },
    },
    {
      ...baseEvent("evt-6-4", 4, 6),
      kind: "blessing-granted",
      entityId: "hera",
      recipient: "farmer",
      petitionId: "evt-2-0",
      resource: "planks",
      amount: 3,
      building: "the-tavern",
    },
    petitionLapsedEvent("evt-250-9", 9, "farmer", "zeus", "evt-1-0", 250),
    goalRefusedEvent("evt-7-6", 6, "hera", 7, 33),
    // Not listed: a strike's ignition, an ordinary move, a resource gathered.
    {
      ...baseEvent("evt-8-7", 7, 8),
      kind: "building-ignited",
      entityId: "woodshed",
      cause: { kind: "strike", actor: "zeus" },
    },
    {
      ...baseEvent("evt-8-8", 8, 8),
      kind: "resource-gathered",
      entityId: "farmer",
      resource: "food",
      amount: 1,
    },
  ];
  const lines = worldSection(
    renderTranscript(record([move("zeus", "a", 9)], events)),
  )
    .split("\n")
    .filter((l) => l.startsWith("- tick"));
  expect(lines.map((l) => l.replace(/^- tick (\d+):.*/, "$1"))).toEqual([
    "3",
    "4",
    "5",
    "6",
    "7",
    "250",
  ]);
  expect(lines[0]).toContain("farmer cannot get planks (no-seller)");
  expect(lines[1]).toContain("the director spoiled 2 food of farmer");
  expect(lines[2]).toContain("the director set the-tavern alight");
  expect(lines[3]).toContain("hera blessed farmer: 3 planks for the-tavern");
  expect(lines[4]).toContain("hera's change to her goal was refused");
  expect(lines[4]).toContain("33 ticks");
  expect(lines[5]).toContain("farmer's prayer to zeus lapsed unanswered");
});

test("a transcript with none of these says so, and the summary shows each god's petitions heard and answered and its refusals", () => {
  const quiet = renderTranscript(record([move("zeus", "a", 1)]));
  expect(worldSection(quiet)).toContain(
    "Nothing happened to the world beyond the gods' own actions.",
  );
  const acts = ["a", "b", "c", "d", "e"].map((to, i) =>
    move("zeus", to, i + 1),
  );
  const withPrayers = record(acts, [
    petitionOpenedEvent("evt-1-6", 6, "farmer", "zeus"),
    petitionAnsweredEvent("evt-2-7", 7, "farmer", "zeus", "evt-1-6"),
    goalRefusedEvent("evt-3-8", 8, "zeus"),
  ]);
  const text = renderSummary([withPrayers], {
    seconds: 60,
    model: "m",
    files: ["episode-1.md"],
  });
  expect(text).toContain("Petitions heard / answered");
  expect(text).toMatch(/\| 1 \| Zeus \|[^\n]*\| 1 \/ 1 \|/);
  expect(text).toContain("Goal changes refused");
});

test("a hosted run's transcript and summary say a hosted OpenAI-compatible endpoint, never the endpoint's host or a key", () => {
  const SECRET_KEY = "sk-sentinel-DO-NOT-LEAK-0123456789";
  const base = record([move("zeus", "olympus-gate", 2)]);
  // The run configuration as the harness is given it, rendered the way the gate renders it.
  const options = {
    binary: "/b",
    durationMs: 300_000,
    ollama: "http://127.0.0.1:11434",
    model: "gpt-x",
    baseUrl: "https://private-host.example/v1",
    keyRef: "private-key-ref",
    keys: { "private-key-ref": SECRET_KEY },
    episodes: 1,
    outDir: "/tmp/out",
  };
  const hosted: EpisodeRecord = {
    ...base,
    settings: episodeSettings(options, {
      ranAt: "2026-10-02T00:00:00.000Z",
      ticks: 300,
      hardware: "Apple M1 Pro",
    }),
  };
  const transcript = renderTranscript(hosted);
  const summary = renderSummary([hosted], {
    seconds: 300,
    model: "gpt-x",
    endpoint: "hosted",
    files: ["episode-1.md"],
  });
  for (const text of [transcript, summary]) {
    expect(text).toContain("through a hosted OpenAI-compatible endpoint");
    expect(text).not.toContain("private-host.example");
    expect(text).not.toContain("private-key-ref");
    expect(text).not.toContain(SECRET_KEY);
    expect(text).not.toContain("local Ollama");
    expect(text).not.toContain("4K context");
  }
  // Control: a local run still says so.
  expect(renderTranscript(base)).toContain("through local Ollama, 4K context");
});

test("an explicit local base URL renders as a local OpenAI-compatible endpoint, not Ollama, with no host or port; the default path still says local Ollama", () => {
  const base = record([move("zeus", "olympus-gate", 2)]);
  const local: EpisodeRecord = {
    ...base,
    settings: episodeSettings(
      {
        binary: "/b",
        durationMs: 300_000,
        ollama: "http://127.0.0.1:11434",
        model: "local-model",
        baseUrl: "http://192.168.1.20:8080/v1",
      },
      {
        ranAt: "2026-10-02T00:00:00.000Z",
        ticks: 300,
        hardware: "Apple M1 Pro",
      },
    ),
  };
  const summary = renderSummary([local], {
    seconds: 300,
    model: "local-model",
    endpoint: "local",
    files: ["episode-1.md"],
  });
  for (const text of [renderTranscript(local), summary]) {
    expect(text).toContain("through a local OpenAI-compatible endpoint");
    expect(text).not.toContain("local Ollama");
    expect(text).not.toContain("4K context");
    expect(text).not.toContain("192.168.1.20");
    expect(text).not.toContain("8080");
  }
  // Control: the default path is unchanged.
  expect(renderTranscript(base)).toContain("through local Ollama, 4K context");
  expect(
    renderSummary([base], { seconds: 300, model: "m", files: [] }),
  ).toContain("through local Ollama, 4K context");
});

// --- What the world did with every god proposal ------------------------------------------

/** An episode whose gods proposed a move, then two blesses the world refused as stale, then a not-adjacent move. */
function dispositionRecord(index = 1): EpisodeRecord {
  const committed = move("zeus", "olympus-gate", 5);
  const refused = [
    act("hera", { kind: "bless", petition: "pet-1" }, 6, {
      outcome: "rejected",
    }),
    act("hera", { kind: "bless", petition: "pet-2" }, 7, {
      outcome: "rejected",
    }),
  ];
  const apart = act("zeus", { kind: "travel", to: "tavern" }, 8, {
    outcome: "rejected",
  });
  const rejections = [...refused, apart];
  const data = input([committed, ...rejections]);
  const reasons = new Map(
    rejections.map((r, i) => [
      r.proposal.proposalId,
      i < 2 ? "stale-target" : "not-adjacent",
    ]),
  );
  const real: RealInput = {
    ...data,
    proposals: data.proposals.map((p) =>
      reasons.has(p.proposalId)
        ? { ...p, reason: reasons.get(p.proposalId) }
        : p,
    ),
    // A rejection commits no event.
    events: data.events.filter(
      (e) =>
        !rejections.some((r) => r.proposal.observationId === e.correlationId),
    ),
  };
  return {
    ...record([committed], [], index),
    input: real,
    analysis: analyzeReal(real),
    episode: analyzeEpisode(real, identities, ["zeus", "hera"]),
  };
}

test("the transcript lists every god proposal with the action and what the world did with it, rejections and their reason codes included", () => {
  const text = renderTranscript(dispositionRecord());
  expect(text).toContain("## What the world did with every proposal");
  expect(text).toMatch(/Zeus: travel → olympus-gate — committed: entity-moved/);
  expect(text).toMatch(/Hera: bless → pet-1 — rejected: stale-target/);
  expect(text).toMatch(/Hera: bless → pet-2 — rejected: stale-target/);
  expect(text).toMatch(/Zeus: travel → tavern — rejected: not-adjacent/);
  expect(text).toContain("- dispositions: bless 2 × stale-target");
  // The committed-actions list still holds only what committed.
  const committedSection = text.split("## What happened")[1]?.split("##")[0];
  expect(committedSection).not.toContain("stale-target");
});

test("an episode with no proposals says so", () => {
  const empty = record([], []);
  expect(renderTranscript(empty)).toContain("No god proposal was journaled.");
});

test("the summary adds one line counting dispositions by action kind and outcome across all episodes", () => {
  const text = renderSummary([dispositionRecord(1), dispositionRecord(2)], {
    seconds: 300,
    model: "m",
    files: ["episode-1.md", "episode-2.md"],
  });
  expect(text).toContain(
    "- dispositions: bless 4 × stale-target, travel 2 × committed, travel 2 × not-adjacent",
  );
});

test("the summary header names the requirement the gate is evidence for, on its own line, before the settings", () => {
  const text = renderSummary([record([move("zeus", "olympus-gate", 2)])], {
    seconds: 300,
    model: "m",
    files: ["episode-1.md"],
  });
  const lines = text.split("\n");
  expect(lines[0]).toBe("# M2 experience gate");
  expect(lines).toContain("- Requirements: O08");
  expect(lines.indexOf("- Requirements: O08")).toBeLessThan(
    lines.findIndex((line) => line.startsWith("- Model:")),
  );
});

test("the world section lists a refused practice move or talk around an open thread, with the reason and what already answered it", () => {
  const events = [
    {
      ...baseEvent("evt-12-3", 3, 12),
      kind: "practice-refused",
      entityId: "hera",
      attempted: "demand",
      reason: "no-progress",
      thread: "evt-5-2",
      why: "that was already answered: zeus refused it",
    },
    {
      ...baseEvent("evt-13-4", 4, 13),
      kind: "practice-refused",
      entityId: "zeus",
      attempted: "accept",
      reason: "stale-target",
      thread: "evt-5-2",
    },
  ];
  const lines = worldSection(
    renderTranscript(record([move("zeus", "a", 9)], events)),
  )
    .split("\n")
    .filter((l) => l.startsWith("- tick"));
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain(
    "hera's demand was refused as no-progress: that was already answered: zeus refused it [evt-5-2]",
  );
  expect(lines[1]).toContain(
    "zeus's accept was refused (stale-target) [evt-5-2]",
  );
});

test("the world section lists each half of a supplication's bargain as the world saw it done, naming the thread", () => {
  const events = [
    {
      ...baseEvent("evt-12-3", 3, 12),
      kind: "practice-progressed",
      entityId: "hera",
      counterparty: "farmer",
      threadId: "evt-5-2",
      step: "boon",
      by: "evt-12-2",
    },
    {
      ...baseEvent("evt-14-4", 4, 14),
      kind: "practice-progressed",
      entityId: "hera",
      counterparty: "farmer",
      threadId: "evt-5-2",
      step: "offering",
      by: "evt-14-3",
    },
  ];
  const lines = worldSection(
    renderTranscript(record([move("zeus", "a", 9)], events)),
  )
    .split("\n")
    .filter((l) => l.startsWith("- tick"));
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain(
    "hera's boon to farmer was seen given [evt-5-2] (evt-12-2)",
  );
  expect(lines[1]).toContain(
    "farmer's offering to hera was seen made [evt-5-2] (evt-14-3)",
  );
});

// --- Journeys: read from the run's own events ---------------------------------------

/** Zeus's journey to the mountain path, as the world's log holds it, and Hera's refused one. */
function journeyEvents(): Record<string, unknown>[] {
  const envelope = (
    id: string,
    sequence: number,
    tick: number,
    correlationId: string,
  ) => ({
    schemaVersion: 1,
    id,
    sequence,
    simTime: tick * 1000,
    tick,
    correlationId,
    causationId: correlationId,
    approximate: false,
  });
  return [
    {
      ...envelope("evt-5-100", 100, 5, "obs-travel"),
      kind: "journey-started",
      entityId: "zeus",
      to: "mountain-path",
    },
    {
      ...envelope("evt-5-101", 101, 5, "evt-5-100"),
      kind: "entity-moved",
      entityId: "zeus",
      to: "olympus-gate",
    },
    {
      ...envelope("evt-6-102", 102, 6, "evt-5-100"),
      kind: "realm-transitioned",
      entityId: "zeus",
      to: "mountain-path",
      via: "olympus-gate",
    },
    {
      ...envelope("evt-6-103", 103, 6, "evt-5-100"),
      kind: "journey-ended",
      entityId: "zeus",
      journeyEventId: "evt-5-100",
      ending: "arrived",
    },
    {
      ...envelope("evt-9-104", 104, 9, "obs-pit"),
      kind: "journey-started",
      entityId: "hera",
      to: "pit",
    },
    {
      ...envelope("evt-9-105", 105, 9, "evt-9-104"),
      kind: "journey-ended",
      entityId: "hera",
      journeyEventId: "evt-9-104",
      ending: "refused",
      reason: "restricted-realm",
    },
  ];
}

function journeyRecord(): EpisodeRecord {
  const base = record([], journeyEvents());
  const input = {
    ...base.input,
    timing: {
      gods: ["zeus", "hera"],
      endedAtMs: 0,
      endTick: 300,
      startLocations: { zeus: "great-hall", hera: "great-hall" },
    },
  };
  return { ...base, input };
}

test("the transcript shows each journey from the run's own events: the god, where it started and went, when, each hop, and how it ended", () => {
  const text = renderTranscript(journeyRecord());
  const section = text.split("## Journeys")[1]?.split("\n## ")[0] ?? "";
  expect(section).toContain(
    "- journeys: 2 started: 1 arrived, 1 refused (restricted-realm), 0 replaced, 0 still travelling",
  );
  expect(section).toContain(
    "1. Zeus: great-hall → mountain-path, set out at tick 5, 2 hops, arrived at tick 6",
  );
  expect(section).toContain("   - tick 5: moved to olympus-gate");
  expect(section).toContain(
    "   - tick 6: crossed from olympus-gate to mountain-path",
  );
  expect(section).toContain(
    "2. Hera: great-hall → pit, set out at tick 9, 0 hops, refused at tick 9 (restricted-realm)",
  );
});

test("an episode in which no god travelled says so, and no check reads journeys", () => {
  const text = renderTranscript(record([move("zeus", "olympus-gate", 2)]));
  expect(text.split("## Journeys")[1]?.split("\n## ")[0]).toContain(
    "No god set out on a journey.",
  );
  // The checks table is unchanged by journeys: a refused journey fails nothing.
  const checks = (r: EpisodeRecord) =>
    r.episode.gods.flatMap((g) => g.checks.map((c) => [c.name, c.ok]));
  const plain = record([], []);
  expect(checks(journeyRecord())).toEqual(checks(plain));
});

test("the summary adds one line counting journeys started and how they ended across all episodes", () => {
  const text = renderSummary([journeyRecord(), journeyRecord()], {
    seconds: 300,
    model: "m",
    files: ["episode-1.md", "episode-2.md"],
  });
  expect(text).toContain(
    "- journeys: 4 started: 2 arrived, 2 refused (restricted-realm ×2), 0 replaced, 0 still travelling",
  );
});
