import { expect, test } from "bun:test";
import {
  analyzeEpisode,
  MIN_ACTIONS,
  REPETITION_CAP,
} from "./episode-analysis";
import {
  act,
  blessAct,
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
  relationshipChangedEvent,
  signMemoryEvent,
} from "./episode-test-data";

const check = (
  episode: ReturnType<typeof analyzeEpisode>,
  god: string,
  name: string,
) =>
  episode.gods.find((g) => g.god === god)?.checks.find((c) => c.name === name);

test("the thresholds are the owner's: a run of more than 3 fails, and 5 actions are the minimum", () => {
  expect(REPETITION_CAP).toBe(3);
  expect(MIN_ACTIONS).toBe(5);
});

// --- Profile trace ---------------------------------------------------------------

test("profile trace: ability-backed and context-backed actions with a matching request pass, and the split is reported per god", () => {
  const acts = [
    act("zeus", { kind: "strike", target: "the-tavern", power: 3 }, 1),
    act("zeus", { kind: "legend", assertion: "x" }, 2),
    move("zeus", "town-square", 3),
    act("zeus", { kind: "report", listener: "hera", content: "hi" }, 4),
    act("hera", { kind: "legend", assertion: "y" }, 5),
    move("hera", "great-hall", 6),
  ];
  const episode = analyzeEpisode(input(acts), identities, ["zeus", "hera"]);
  expect(check(episode, "zeus", "profile trace")?.ok).toBe(true);
  expect(check(episode, "hera", "profile trace")?.ok).toBe(true);
  const zeus = episode.gods.find((g) => g.god === "zeus");
  expect([zeus?.abilityBacked, zeus?.contextBacked]).toEqual([2, 2]);
  const hera = episode.gods.find((g) => g.god === "hera");
  expect([hera?.abilityBacked, hera?.contextBacked]).toEqual([1, 1]);
  expect(check(episode, "zeus", "profile trace")?.detail).toContain(
    "2 ability-backed, 2 context-backed",
  );
});

test("profile trace fails on an action the profile does not grant, one with no request, one whose request is another role's, a god with no profile, and a foreign kind", () => {
  const run = (a: ReturnType<typeof act>, god = "hera") =>
    check(analyzeEpisode(input([a]), identities, [god]), god, "profile trace");
  // Hera has no strike: not an ability, and strike is not a context action.
  const strike = run(act("hera", { kind: "strike", target: "t", power: 1 }, 1));
  expect(strike?.ok).toBe(false);
  expect(strike?.detail).toContain("strike");
  expect(
    run(act("hera", { kind: "travel", to: "x" }, 1, { role: null }))?.ok,
  ).toBe(false);
  expect(
    run(act("hera", { kind: "travel", to: "x" }, 1, { role: "zeus" }))?.ok,
  ).toBe(false);
  expect(run(act("hades", { kind: "travel", to: "x" }, 1), "hades")?.ok).toBe(
    false,
  );
  expect(run(act("hera", { kind: "gather", resource: "wood" }, 1))?.ok).toBe(
    false,
  );
  // Control: the same actor's ability and context actions with a matching request pass.
  expect(run(act("hera", { kind: "legend", assertion: "x" }, 1))?.ok).toBe(
    true,
  );
  expect(run(act("hera", { kind: "travel", to: "x" }, 1))?.ok).toBe(true);
});

test("profile trace judges only committed proposals: a rejected one with no request is not a failure", () => {
  const rejected = act("hera", { kind: "gather", resource: "x" }, 1, {
    role: null,
    outcome: "rejected",
  });
  expect(
    check(
      analyzeEpisode(input([rejected]), identities, ["hera"]),
      "hera",
      "profile trace",
    )?.ok,
  ).toBe(true);
});

// --- Repetition --------------------------------------------------------------------

const repeated = (count: number, to = "olympus-gate") =>
  Array.from({ length: count }, (_, i) => move("zeus", to, i + 1));

test("repetition: three identical choices in a row pass, a fourth fails, and the longest run is reported", () => {
  const three = analyzeEpisode(input(repeated(3)), identities, ["zeus"]);
  expect(check(three, "zeus", "repetition")?.ok).toBe(true);
  expect(three.gods[0]?.longestRun).toEqual({
    length: 3,
    key: "travel:olympus-gate",
  });

  const four = analyzeEpisode(input(repeated(4)), identities, ["zeus"]);
  const failed = check(four, "zeus", "repetition");
  expect(failed?.ok).toBe(false);
  expect(failed?.detail).toContain("4");
  expect(failed?.detail).toContain("travel:olympus-gate");
});

test("repetition: the key is kind and primary target, and a different choice breaks the run", () => {
  // Same kind, different targets: not a repeat.
  const targets = ["a", "b", "c", "d", "e"].map((to, i) =>
    move("zeus", to, i + 1),
  );
  expect(
    check(
      analyzeEpisode(input(targets), identities, ["zeus"]),
      "zeus",
      "repetition",
    )?.ok,
  ).toBe(true);
  // Same target, different kind: not a repeat.
  const kinds = [
    act("zeus", { kind: "travel", to: "x" }, 1),
    act("zeus", { kind: "travel", to: "x" }, 2),
    act("zeus", { kind: "strike", target: "x", power: 1 }, 3),
    act("zeus", { kind: "strike", target: "x", power: 1 }, 4),
  ];
  expect(
    check(
      analyzeEpisode(input(kinds), identities, ["zeus"]),
      "zeus",
      "repetition",
    )?.ok,
  ).toBe(true);
  // Three, a break, three: the run resets.
  const broken = [
    ...repeated(3),
    move("zeus", "other", 4),
    ...[5, 6, 7].map((sequence) => move("zeus", "olympus-gate", sequence)),
  ];
  const result = analyzeEpisode(input(broken), identities, ["zeus"]);
  expect(check(result, "zeus", "repetition")?.ok).toBe(true);
  expect(result.gods[0]?.longestRun?.length).toBe(3);
});

test("repetition: report keys on the listener, strike on the target, and a legend on its linked event or the word legend", () => {
  const reports = [1, 2, 3, 4].map((i) =>
    act("zeus", { kind: "report", listener: "hera", content: `c${i}` }, i),
  );
  const r = analyzeEpisode(input(reports), identities, ["zeus"]);
  expect(check(r, "zeus", "repetition")?.ok).toBe(false);
  expect(r.gods[0]?.longestRun?.key).toBe("report:hera");

  const strikes = [1, 2, 3, 4].map((i) =>
    act("zeus", { kind: "strike", target: "the-tavern", power: i }, i),
  );
  expect(
    analyzeEpisode(input(strikes), identities, ["zeus"]).gods[0]?.longestRun
      ?.key,
  ).toBe("strike:the-tavern");

  const bare = [1, 2, 3, 4].map((i) =>
    act("zeus", { kind: "legend", assertion: `a${i}` }, i),
  );
  const bareRun = analyzeEpisode(input(bare), identities, ["zeus"]);
  expect(bareRun.gods[0]?.longestRun?.key).toBe("legend:legend");
  expect(check(bareRun, "zeus", "repetition")?.ok).toBe(false);
  // Linked to different events they are different choices.
  const linked = [1, 2, 3, 4].map((i) =>
    act(
      "zeus",
      { kind: "legend", assertion: "a", linkedEventId: `evt-${i}` },
      i,
    ),
  );
  expect(
    check(
      analyzeEpisode(input(linked), identities, ["zeus"]),
      "zeus",
      "repetition",
    )?.ok,
  ).toBe(true);
});

test("repetition orders by the first event each proposal caused, not by the order the journal lists them", () => {
  // Listed a, a, b, a, a, but the events say the b came last: a run of four.
  const acts = [
    move("zeus", "a", 1),
    move("zeus", "a", 2),
    move("zeus", "b", 9),
    move("zeus", "a", 3),
    move("zeus", "a", 4),
  ];
  const result = analyzeEpisode(input(acts), identities, ["zeus"]);
  expect(check(result, "zeus", "repetition")?.ok).toBe(false);
  expect(result.gods[0]?.longestRun?.length).toBe(4);
});

// --- Minimum activity -----------------------------------------------------------------

test("minimum activity: five committed model actions pass, four fail, and rejected ones do not count", () => {
  const five = analyzeEpisode(
    input(["a", "b", "c", "d", "e"].map((to, i) => move("zeus", to, i + 1))),
    identities,
    ["zeus"],
  );
  expect(check(five, "zeus", "minimum activity")?.ok).toBe(true);
  const four = analyzeEpisode(
    input(["a", "b", "c", "d"].map((to, i) => move("zeus", to, i + 1))),
    identities,
    ["zeus"],
  );
  expect(check(four, "zeus", "minimum activity")?.ok).toBe(false);
  const rejected = [
    ...["a", "b", "c", "d"].map((to, i) => move("zeus", to, i + 1)),
    act("zeus", { kind: "travel", to: "z" }, 9, { outcome: "rejected" }),
  ];
  expect(
    check(
      analyzeEpisode(input(rejected), identities, ["zeus"]),
      "zeus",
      "minimum activity",
    )?.ok,
  ).toBe(false);
});

// --- Influence -----------------------------------------------------------------------------

test("influence: a told belief caused by the god's own report passes; a belief caused by the other god's report does not count for it", () => {
  const zeusReport = act(
    "zeus",
    { kind: "report", listener: "hera", content: "hi" },
    10,
  );
  const belief = memoryEvent("evt-10-11", 11, {
    memoryKind: "told",
    entityId: "hera",
    sourceEventId: zeusReport.event.id,
    teller: "zeus",
    content: "hi",
  });
  const episode = analyzeEpisode(input([zeusReport], [belief]), identities, [
    "zeus",
    "hera",
  ]);
  expect(check(episode, "zeus", "influence")?.ok).toBe(true);
  // Control: Hera acted (a move) but caused nothing told or felt.
  const heraMove = move("hera", "x", 12);
  const both = analyzeEpisode(
    input([zeusReport, heraMove], [belief]),
    identities,
    ["zeus", "hera"],
  );
  expect(check(both, "zeus", "influence")?.ok).toBe(true);
  expect(check(both, "hera", "influence")?.ok).toBe(false);
});

test("influence is credited to the immediate cause only: Hera reporting a Zeus event she witnessed, citing it, gives Hera the influence and Zeus none", () => {
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
  const episode = analyzeEpisode(
    input([zeusMove, heraReport], [belief, change]),
    identities,
    ["zeus", "hera"],
  );
  // Hera's report caused the belief and, through it, the change.
  expect(check(episode, "hera", "influence")?.ok).toBe(true);
  expect(check(episode, "hera", "influence")?.detail).toContain("2 caused");
  // Zeus's only link is being cited.
  expect(check(episode, "zeus", "influence")?.ok).toBe(false);

  // Control: Zeus's own report causing a belief still counts for him.
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
  const withOwn = analyzeEpisode(
    input([zeusMove, heraReport, zeusReport], [belief, change, zeusBelief]),
    identities,
    ["zeus", "hera"],
  );
  expect(check(withOwn, "zeus", "influence")?.ok).toBe(true);
  expect(check(withOwn, "zeus", "influence")?.detail).toContain("1 caused");
  expect(check(withOwn, "hera", "influence")?.detail).toContain("2 caused");
});

test("influence: a relationship change counts through the told belief it cites; one that rests on a witnessed memory does not", () => {
  const strike = act(
    "zeus",
    { kind: "strike", target: "the-tavern", power: 3 },
    20,
  );
  const witnessed = memoryEvent("evt-20-21", 21, {
    memoryKind: "witnessed",
    entityId: "farmer",
    sourceEventId: strike.event.id,
    eventKind: "entity-moved",
  });
  const change = (id: string, sequence: number, memoryEventId: string) => ({
    schemaVersion: 1,
    id,
    sequence,
    simTime: 0,
    correlationId: "tick-1",
    causationId: "x",
    tick: 1,
    approximate: false,
    kind: "relationship-changed",
    entityId: "farmer",
    toward: "zeus",
    affinityDelta: -2,
    grudgeDelta: 1,
    memoryEventId,
  });
  // A witnessed memory alone, and a change resting on it: not influence.
  const alone = analyzeEpisode(input([strike], [witnessed]), identities, [
    "zeus",
  ]);
  expect(check(alone, "zeus", "influence")?.ok).toBe(false);
  const seen = analyzeEpisode(
    input([strike], [witnessed, change("evt-20-22", 22, witnessed.id)]),
    identities,
    ["zeus"],
  );
  expect(check(seen, "zeus", "influence")?.ok).toBe(false);

  // Control: the same change resting on a belief from his own report counts.
  const report = act(
    "zeus",
    { kind: "report", listener: "farmer", content: "I struck it." },
    30,
  );
  const belief = memoryEvent("evt-30-31", 31, {
    memoryKind: "told",
    entityId: "farmer",
    sourceEventId: report.event.id,
    teller: "zeus",
    content: "I struck it.",
  });
  const told = analyzeEpisode(
    input([report], [belief, change("evt-30-32", 32, belief.id)]),
    identities,
    ["zeus"],
  );
  expect(check(told, "zeus", "influence")?.ok).toBe(true);
  expect(check(told, "zeus", "influence")?.detail).toContain(
    "relationship-changed",
  );
});

test("influence: a bless the petitioner answers with a sign and a changed feeling toward the god counts for that god, and for no other", () => {
  // The world's chain: bless > petition-answered > sign memory > relationship-changed.
  // Only the bless is a proposal's own event; the rest are derived on the tick's correlation.
  const bless = blessAct("hera", "evt-8-169", 225);
  const answered = petitionAnsweredEvent(
    "evt-225-226",
    226,
    "farmer",
    "hera",
    "evt-8-169",
    bless.event.id,
    225,
  );
  const sign = signMemoryEvent(
    "evt-225-227",
    227,
    "farmer",
    "hera",
    answered.id,
    "evt-8-169",
  );
  const change = relationshipChangedEvent(
    "evt-225-228",
    228,
    "farmer",
    "hera",
    sign.id,
  );
  const chain = [answered, sign, change];
  const gods = ["zeus", "hera"];

  const episode = analyzeEpisode(
    input([bless, move("zeus", "a", 230)], chain),
    identities,
    gods,
  );
  expect(check(episode, "hera", "influence")?.ok).toBe(true);
  // The change is counted once, as a feeling: the sign is neither a told belief nor a second change.
  expect(check(episode, "hera", "influence")?.detail).toBe(
    "1 caused (relationship-changed)",
  );
  expect(episode.gods.find((g) => g.god === "hera")?.influence).toBe(1);
  // Zeus acted that tick, but nothing he proposed caused the farmer's feeling.
  expect(check(episode, "zeus", "influence")?.ok).toBe(false);

  // Control: the same chain with the bless not among Hera's proposals credits her with nothing.
  const without = analyzeEpisode(
    input([move("hera", "a", 224)], chain),
    identities,
    ["hera"],
  );
  expect(check(without, "hera", "influence")?.ok).toBe(false);

  // Control: a feeling that rests on another god's answer does not count for Hera, who also blessed.
  const zeusBless = blessAct("zeus", "evt-9-170", 240);
  const zeusAnswered = petitionAnsweredEvent(
    "evt-240-241",
    241,
    "woodcutter",
    "zeus",
    "evt-9-170",
    zeusBless.event.id,
    240,
  );
  const zeusSign = signMemoryEvent(
    "evt-240-242",
    242,
    "woodcutter",
    "zeus",
    zeusAnswered.id,
    "evt-9-170",
  );
  const zeusChange = relationshipChangedEvent(
    "evt-240-243",
    243,
    "woodcutter",
    "zeus",
    zeusSign.id,
  );
  const heraBlessedAlone = blessAct("hera", "evt-8-171", 250);
  const other = analyzeEpisode(
    input([zeusBless, heraBlessedAlone], [zeusAnswered, zeusSign, zeusChange]),
    identities,
    gods,
  );
  expect(check(other, "zeus", "influence")?.ok).toBe(true);
  expect(check(other, "hera", "influence")?.ok).toBe(false);

  // Control: a petition that lapsed unanswered leaves a harm sign, which no god's proposal caused.
  const lapsed = petitionLapsedEvent(
    "evt-260-261",
    261,
    "farmer",
    "hera",
    "evt-8-172",
    260,
  );
  const lapsedSign = signMemoryEvent(
    "evt-260-262",
    262,
    "farmer",
    "hera",
    lapsed.id,
    "evt-8-172",
    "lapsed",
  );
  const lapsedChange = relationshipChangedEvent(
    "evt-260-263",
    263,
    "farmer",
    "hera",
    lapsedSign.id,
    -1,
  );
  const neglect = analyzeEpisode(
    input(
      [blessAct("hera", "evt-8-173", 255)],
      [lapsed, lapsedSign, lapsedChange],
    ),
    identities,
    ["hera"],
  );
  expect(check(neglect, "hera", "influence")?.ok).toBe(false);
});

test("the episode is ok only when every check of every god holds", () => {
  const report = act(
    "zeus",
    { kind: "report", listener: "hera", content: "x" },
    1,
  );
  const good = [
    report,
    ...["b", "c", "d", "e"].map((to, i) => move("zeus", to, i + 2)),
  ];
  const belief = memoryEvent("evt-9-9", 9, {
    memoryKind: "told",
    entityId: "hera",
    sourceEventId: report.event.id,
    teller: "zeus",
    content: "x",
  });
  const goals = [
    goalSetEvent("evt-0-1", 1, "zeus"),
    goalEndedEvent("evt-0-2", 2, "zeus", "evt-0-1"),
    petitionOpenedEvent("evt-0-3", 3, "farmer", "zeus"),
    petitionAnsweredEvent("evt-0-4", 4, "farmer", "zeus", "evt-0-3"),
  ];
  const ok = analyzeEpisode(input(good, [belief, ...goals]), identities, [
    "zeus",
  ]);
  expect(ok.ok).toBe(true);
  const bad = analyzeEpisode(
    input(good.slice(0, 4), [belief, ...goals]),
    identities,
    ["zeus"],
  );
  expect(bad.ok).toBe(false);
});

// --- Goals ---------------------------------------------------------------------------------

const GOAL_NAMES = ["goal set", "goal ended"] as const;
const goalChecks = (episode: ReturnType<typeof analyzeEpisode>, god: string) =>
  Object.fromEntries(
    GOAL_NAMES.map((name) => [name, check(episode, god, name)?.ok]),
  );

test("goal checks: a god that set a goal and ended one, one by replacement, passes both", () => {
  // Hera sets A, then sets B (A ends as abandoned), then ends B as achieved.
  const events = [
    goalSetEvent("evt-1-1", 1, "hera", "Win the farmer.", "farmer"),
    goalEndedEvent("evt-2-2", 2, "hera", "evt-1-1", "abandoned"),
    goalSetEvent("evt-2-3", 3, "hera", "Make Zeus admit it.", "zeus"),
  ];
  const replaced = analyzeEpisode(
    input([move("hera", "a", 10)], events),
    identities,
    ["hera"],
  );
  expect(goalChecks(replaced, "hera")).toEqual({
    "goal set": true,
    "goal ended": true,
  });
  expect(check(replaced, "hera", "goal set")?.detail).toContain("2");
  expect(check(replaced, "hera", "goal ended")?.detail).toContain("abandoned");
});

test("goal checks: a god that sets but never ends fails the end check only; one that never sets fails both; another god's goals do not count", () => {
  const setOnly = analyzeEpisode(
    input([move("hera", "a", 10)], [goalSetEvent("evt-1-1", 1, "hera")]),
    identities,
    ["hera"],
  );
  expect(goalChecks(setOnly, "hera")).toEqual({
    "goal set": true,
    "goal ended": false,
  });

  const none = analyzeEpisode(input([move("hera", "a", 10)]), identities, [
    "hera",
  ]);
  expect(goalChecks(none, "hera")).toEqual({
    "goal set": false,
    "goal ended": false,
  });

  // Zeus's goals are Zeus's: Hera still has none.
  const theirs = analyzeEpisode(
    input(
      [move("hera", "a", 10)],
      [
        goalSetEvent("evt-1-1", 1, "zeus"),
        goalEndedEvent("evt-2-2", 2, "zeus", "evt-1-1"),
      ],
    ),
    identities,
    ["zeus", "hera"],
  );
  expect(goalChecks(theirs, "zeus")).toEqual({
    "goal set": true,
    "goal ended": true,
  });
  expect(goalChecks(theirs, "hera")).toEqual({
    "goal set": false,
    "goal ended": false,
  });
  expect(theirs.ok).toBe(false);
});

test("a goal-only proposal is not an action: it does not count toward activity or repetition, and still needs its model request", () => {
  const moves = ["a", "b", "c", "d"].map((to, i) => move("zeus", to, i + 1));
  const goalOnly = [5, 6, 7].map((n) =>
    act(
      "zeus",
      { kind: "goal", goal: { set: { text: `Goal ${n}.`, target: "hera" } } },
      n,
    ),
  );
  const four = analyzeEpisode(input([...moves, ...goalOnly]), identities, [
    "zeus",
  ]);
  // Four actions and three goal declarations: still four actions.
  expect(four.gods[0]?.actions).toBe(4);
  expect(check(four, "zeus", "minimum activity")?.ok).toBe(false);
  expect(check(four, "zeus", "repetition")?.ok).toBe(true);
  expect(check(four, "zeus", "profile trace")?.ok).toBe(true);
  // Control: a fifth real action reaches the minimum.
  const five = analyzeEpisode(
    input([...moves, move("zeus", "e", 8), ...goalOnly]),
    identities,
    ["zeus"],
  );
  expect(check(five, "zeus", "minimum activity")?.ok).toBe(true);
  // A goal-only proposal with no request fails the trace, as any proposal would.
  const unrequested = act(
    "zeus",
    { kind: "goal", goal: { set: { text: "x", target: "hera" } } },
    9,
    { role: null },
  );
  expect(
    check(
      analyzeEpisode(input([...moves, unrequested]), identities, ["zeus"]),
      "zeus",
      "profile trace",
    )?.ok,
  ).toBe(false);
});

test("influence counts a told belief sourced from the god's own legend, for the narrator and not the hearer", () => {
  const legend = act(
    "hera",
    {
      kind: "legend",
      assertion: "Zeus wronged me.",
      hearers: ["farmer", "zeus"],
    },
    10,
  );
  const belief = memoryEvent("evt-10-11", 11, {
    memoryKind: "told",
    entityId: "zeus",
    sourceEventId: legend.event.id,
    teller: "hera",
    content: "Zeus wronged me.",
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
    entityId: "zeus",
    toward: "hera",
    affinityDelta: -1,
    grudgeDelta: 0,
    memoryEventId: belief.id,
  };
  const episode = analyzeEpisode(
    input([legend, move("zeus", "a", 20)], [belief, change]),
    identities,
    ["hera", "zeus"],
  );
  expect(check(episode, "hera", "influence")?.ok).toBe(true);
  expect(check(episode, "hera", "influence")?.detail).toContain("2 caused");
  // Zeus heard it: his only link is being a hearer.
  expect(check(episode, "zeus", "influence")?.ok).toBe(false);
  // Control: without the legend among Hera's proposals, nothing is credited to her.
  const without = analyzeEpisode(
    input([move("hera", "a", 9)], [belief, change]),
    identities,
    ["hera"],
  );
  expect(check(without, "hera", "influence")?.ok).toBe(false);
});

// --- Petitions ------------------------------------------------------------------------------

test("petition checks: a god that heard none fails the heard check; one that heard a petition passes it, and a petition to the other god does not count", () => {
  const events = [petitionOpenedEvent("evt-1-2", 2, "farmer", "hera")];
  const episode = analyzeEpisode(
    input([move("hera", "a", 10), move("zeus", "a", 11)], events),
    identities,
    ["zeus", "hera"],
  );
  expect(check(episode, "hera", "petition heard")?.ok).toBe(true);
  expect(check(episode, "hera", "petition heard")?.detail).toContain(
    "1 petition",
  );
  const zeus = check(episode, "zeus", "petition heard");
  expect(zeus?.ok).toBe(false);
  expect(zeus?.detail).toContain("no petition");
  expect(episode.gods.find((g) => g.god === "hera")?.petitionsHeard).toBe(1);
});

test("petition checks: a god that heard a petition but answered none fails the answered check; with an answer it passes, and an answer by the other god does not count", () => {
  const heard = [petitionOpenedEvent("evt-1-2", 2, "farmer", "hera")];
  const none = analyzeEpisode(
    input([move("hera", "a", 10)], heard),
    identities,
    ["hera"],
  );
  expect(check(none, "hera", "petition answered")?.ok).toBe(false);
  expect(check(none, "hera", "petition answered")?.detail).toContain("none");

  const answered = [
    ...heard,
    petitionAnsweredEvent("evt-5-3", 3, "farmer", "hera", "evt-1-2"),
  ];
  const ok = analyzeEpisode(
    input([move("hera", "a", 10)], answered),
    identities,
    ["hera"],
  );
  expect(check(ok, "hera", "petition answered")?.ok).toBe(true);
  expect(ok.gods[0]?.petitionsAnswered).toBe(1);

  // Zeus answered a petition addressed to Hera: Hera has answered none.
  const wrong = [
    ...heard,
    petitionAnsweredEvent("evt-5-3", 3, "farmer", "zeus", "evt-1-2"),
  ];
  const mixed = analyzeEpisode(
    input([move("hera", "a", 10), move("zeus", "a", 11)], wrong),
    identities,
    ["zeus", "hera"],
  );
  expect(check(mixed, "hera", "petition answered")?.ok).toBe(false);
  expect(check(mixed, "zeus", "petition answered")?.ok).toBe(true);
});

test("a bless is a valid context action, keyed by the petition it answers", () => {
  const blessings = [1, 2, 3, 4].map((i) =>
    act("hera", { kind: "bless", petition: "evt-1-2" }, i),
  );
  const episode = analyzeEpisode(input(blessings), identities, ["hera"]);
  expect(check(episode, "hera", "profile trace")?.ok).toBe(true);
  expect(episode.gods[0]?.longestRun?.key).toBe("bless:evt-1-2");
  expect(check(episode, "hera", "repetition")?.ok).toBe(false);
  expect(episode.gods[0]?.contextBacked).toBe(4);
});

test("goal lifetimes and refusals are reported per god: how long each ended goal lasted, and how many changes were refused", () => {
  const events = [
    { ...goalSetEvent("evt-3-1", 1, "hera", "A.", "zeus"), tick: 3 },
    {
      ...goalEndedEvent("evt-43-2", 2, "hera", "evt-3-1", "abandoned"),
      tick: 43,
    },
    { ...goalSetEvent("evt-43-3", 3, "hera", "B.", "zeus"), tick: 43 },
    goalRefusedEvent("evt-45-4", 4, "hera", 45),
    goalRefusedEvent("evt-46-5", 5, "hera", 46),
    { ...goalSetEvent("evt-9-9", 9, "zeus", "Z.", "hera"), tick: 9 },
  ];
  const episode = analyzeEpisode(
    input([move("hera", "a", 10), move("zeus", "a", 11)], events),
    identities,
    ["zeus", "hera"],
  );
  const hera = episode.gods.find((g) => g.god === "hera");
  expect(hera?.goalLifetimes).toEqual([40]);
  expect(hera?.refusals).toBe(2);
  // Zeus's goal never ended: no lifetime, no refusal.
  const zeus = episode.gods.find((g) => g.god === "zeus");
  expect(zeus?.goalLifetimes).toEqual([]);
  expect(zeus?.refusals).toBe(0);
});
