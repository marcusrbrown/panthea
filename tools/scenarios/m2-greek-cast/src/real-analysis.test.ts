import { expect, test } from "bun:test";
import {
  goalSetEvent,
  movedEvent,
  petitionOpenedEvent,
} from "./episode-test-data";
import {
  analyzeReal,
  GOD_ACTIONS,
  namedIds,
  type RealInput,
  type RealProposal,
  type RealRequest,
} from "./real-analysis";

const event = (
  id: string,
  sequence: number,
  kind: string,
  extra: Record<string, unknown> = {},
) => ({
  schemaVersion: 1,
  id,
  sequence,
  simTime: 0,
  correlationId: `c-${id}`,
  causationId: `c-${id}`,
  tick: 1,
  approximate: false,
  kind,
  ...extra,
});

const request = (
  proposalId: string | undefined,
  prompt: string,
  extra: Partial<RealRequest> = {},
): RealRequest => ({
  proposalId,
  role: "zeus",
  outcome: "intent",
  elapsedMs: 2000,
  promptPayload: prompt,
  steps: [{ mode: "native" }],
  ...extra,
});

const proposal = (
  proposalId: string,
  actor: string,
  fields: Record<string, unknown>,
  outcome: "committed" | "rejected" = "committed",
  reason?: string,
): RealProposal => ({
  proposalId,
  actor,
  kind: String(fields.kind),
  observationId: `obs-${proposalId}`,
  proposal: { actor, ...fields },
  outcome,
  ...(reason === undefined ? {} : { reason }),
});

const base = (over: Partial<RealInput> = {}): RealInput => ({
  requests: [],
  proposals: [],
  events: [],
  polls: { total: 10, degraded: 0 },
  ...over,
});

const property = (input: RealInput, name: string) =>
  analyzeReal(input).properties.find((p) => p.name === name);

test("namedIds collects every id a proposal names, and none it does not", () => {
  expect(
    namedIds({
      kind: "report",
      listener: "hera",
      content: "words with zeus in them",
      claim: { effect: "harm", agent: "zeus", target: "the-tavern" },
      linkedEventId: "evt-4-2",
    }).sort(),
  ).toEqual(["evt-4-2", "hera", "the-tavern", "zeus"]);
  expect(namedIds({ kind: "travel", to: "town-square" })).toEqual([
    "town-square",
  ]);
  expect(namedIds({ kind: "legend", assertion: "nothing named" })).toEqual([]);
});

test("perception compliance holds when every id a proposal names is in the prompt behind it, and fails when one is not", () => {
  const prompt =
    "Here with you:\n- hera (a god)\nWays out:\n- Town [town-square]";
  const ok = base({
    requests: [request("p1", prompt)],
    proposals: [
      proposal("p1", "zeus", {
        kind: "report",
        listener: "hera",
        content: "x",
      }),
    ],
  });
  expect(property(ok, "perception compliance")?.ok).toBe(true);

  const bad = base({
    requests: [request("p1", prompt)],
    proposals: [
      proposal("p1", "zeus", {
        kind: "report",
        listener: "the-woodcutter",
        content: "x",
      }),
    ],
  });
  const result = property(bad, "perception compliance");
  expect(result?.ok).toBe(false);
  expect(result?.detail).toContain("the-woodcutter");
});

test('perception compliance counts a god\'s own id as present: the prompt says "You are Hera" and never prints the id, and a claim may name the god itself', () => {
  // Hera's prompt names her by name only; the schema still lets her claim name herself.
  const prompt =
    "You are Hera, a Greek god of marriage.\nHere with you:\n- zeus (a god)";
  const selfClaim = base({
    requests: [request("p1", prompt)],
    proposals: [
      proposal("p1", "hera", {
        kind: "report",
        listener: "zeus",
        content: "x",
        claim: { effect: "harm", agent: "zeus", target: "hera" },
      }),
    ],
  });
  expect(property(selfClaim, "perception compliance")?.ok).toBe(true);
  const asAgent = base({
    requests: [request("p1", prompt)],
    proposals: [
      proposal("p1", "hera", {
        kind: "report",
        listener: "zeus",
        content: "x",
        claim: { effect: "kindness", agent: "hera" },
      }),
    ],
  });
  expect(property(asAgent, "perception compliance")?.ok).toBe(true);

  // Control: an id that is neither the actor nor in the prompt still fails.
  const stranger = base({
    requests: [request("p1", prompt)],
    proposals: [
      proposal("p1", "hera", {
        kind: "report",
        listener: "zeus",
        content: "x",
        claim: { effect: "harm", agent: "zeus", target: "the-woodcutter" },
      }),
    ],
  });
  const result = property(stranger, "perception compliance");
  expect(result?.ok).toBe(false);
  expect(result?.detail).toContain("the-woodcutter");
  // Only the actor's own id is exempt: another god's id, absent from the prompt, fails.
  const other = base({
    requests: [request("p1", prompt)],
    proposals: [
      proposal("p1", "zeus", {
        kind: "report",
        listener: "zeus",
        content: "x",
        claim: { effect: "harm", agent: "hera" },
      }),
    ],
  });
  expect(property(other, "perception compliance")?.ok).toBe(false);
});

test("perception compliance fails, naming the proposal, when a committed proposal has no matching request", () => {
  const prompt = "Here with you:\n- hera (a god)";
  const covered = proposal("p1", "zeus", {
    kind: "report",
    listener: "hera",
    content: "x",
  });
  const uncovered = proposal("p2", "zeus", {
    kind: "report",
    listener: "hera",
    content: "y",
  });
  const result = property(
    base({
      // p1 is covered; a request for some other proposal does not cover p2.
      requests: [request("p1", prompt), request("p9", prompt)],
      proposals: [covered, uncovered],
    }),
    "perception compliance",
  );
  expect(result?.ok).toBe(false);
  expect(result?.detail).toContain("p2");
  expect(result?.detail).not.toContain("p1");
});

test("perception compliance fails, naming the proposal, when its matching request carries no prompt", () => {
  const result = property(
    base({
      requests: [
        request("p1", "- hera (a god)"),
        { ...request("p2", ""), promptPayload: undefined },
      ],
      proposals: [
        proposal("p1", "zeus", { kind: "report", listener: "hera" }),
        proposal("p2", "zeus", { kind: "report", listener: "hera" }),
      ],
    }),
    "perception compliance",
  );
  expect(result?.ok).toBe(false);
  expect(result?.detail).toContain("p2");
  expect(result?.detail).not.toContain("p1");
});

test("valid actions: god actions that were not rejected as malformed", () => {
  const good = base({
    proposals: [proposal("p1", "zeus", { kind: "travel", to: "x" })],
  });
  expect(property(good, "valid actions")?.ok).toBe(true);
  // A stale proposal is a race, not an invalid action.
  expect(
    property(
      base({
        proposals: [
          proposal(
            "p1",
            "zeus",
            { kind: "travel", to: "x" },
            "rejected",
            "stale-target",
          ),
        ],
      }),
      "valid actions",
    )?.ok,
  ).toBe(true);
  expect(
    property(
      base({
        proposals: [
          proposal("p1", "zeus", { kind: "gather", resource: "wood" }),
        ],
      }),
      "valid actions",
    )?.ok,
  ).toBe(false);
  expect(
    property(
      base({
        proposals: [
          proposal(
            "p1",
            "zeus",
            { kind: "travel", to: "x" },
            "rejected",
            "malformed",
          ),
        ],
      }),
      "valid actions",
    )?.ok,
  ).toBe(false);
  // Nothing journaled is not a pass.
  expect(property(base(), "valid actions")?.ok).toBe(false);
});

test("a relationship change with provenance needs the memory and report behind it in the log", () => {
  const events = [
    event("evt-1-1", 1, "report-told", {
      entityId: "zeus",
      listenerId: "hera",
      content: "x",
    }),
    event("evt-1-2", 2, "memory-recorded", {
      memoryKind: "told",
      entityId: "hera",
      sourceEventId: "evt-1-1",
      teller: "zeus",
      content: "x",
      subjects: ["zeus"],
      salience: 4,
    }),
    event("evt-1-3", 3, "relationship-changed", {
      entityId: "hera",
      toward: "zeus",
      affinityDelta: -1,
      grudgeDelta: 0,
      memoryEventId: "evt-1-2",
    }),
  ];
  expect(
    property(base({ events }), "relationship change with provenance")?.ok,
  ).toBe(true);
  // Control: with the memory missing from the log the chain does not explain the change.
  expect(
    property(
      base({ events: events.filter((e) => e.id !== "evt-1-2") }),
      "relationship change with provenance",
    )?.ok,
  ).toBe(false);
  expect(property(base(), "relationship change with provenance")?.ok).toBe(
    false,
  );
});

test("a changed next action: a god's first action after forming a belief differs from the one before it", () => {
  const events = [
    event("evt-1-1", 1, "entity-moved", {
      entityId: "hera",
      from: "a",
      to: "b",
    }),
    event("evt-2-1", 5, "memory-recorded", {
      memoryKind: "told",
      entityId: "hera",
      sourceEventId: "evt-2-0",
      teller: "zeus",
      content: "x",
      subjects: [],
      salience: 4,
    }),
    event("evt-3-1", 9, "legend-recorded", { entityId: "hera" }),
  ];
  const withCorrelation = (
    list: ReturnType<typeof event>[],
    ids: [string, string][],
  ) =>
    list.map((e) => {
      const found = ids.find(([eventId]) => eventId === e.id);
      return found ? { ...e, correlationId: found[1] } : e;
    });
  const changed = base({
    events: withCorrelation(events, [
      ["evt-1-1", "obs-p1"],
      ["evt-3-1", "obs-p2"],
    ]),
    proposals: [
      proposal("p1", "hera", { kind: "travel", to: "b" }),
      proposal("p2", "hera", { kind: "legend", assertion: "x" }),
    ].map((p, index) => ({ ...p, observationId: `obs-p${index + 1}` })),
  });
  expect(property(changed, "changed next action")?.ok).toBe(true);

  // Control: the same kind of action before and after is not a change.
  const same = base({
    events: withCorrelation(events, [
      ["evt-1-1", "obs-p1"],
      ["evt-3-1", "obs-p2"],
    ]),
    proposals: [
      proposal("p1", "hera", { kind: "legend", assertion: "a" }),
      proposal("p2", "hera", { kind: "legend", assertion: "a" }),
    ].map((p, index) => ({ ...p, observationId: `obs-p${index + 1}` })),
  });
  expect(property(same, "changed next action")?.ok).toBe(false);
});

test("latency and outcome numbers come from the requests: percentiles, native versus repaired, exhaustion reasons, and time degraded", () => {
  const analysis = analyzeReal(
    base({
      requests: [
        request("p1", "a", { elapsedMs: 1000 }),
        request("p2", "b", { elapsedMs: 3000, steps: [{ mode: "repaired" }] }),
        request(undefined, "c", {
          outcome: "exhausted",
          elapsedMs: 5000,
          steps: [
            {
              reason: "invalid-output",
              detail: "content must be 1 to 280 characters",
            },
          ],
        }),
      ],
      polls: { total: 20, degraded: 5 },
    }),
  );
  expect(analysis.requests).toMatchObject({
    total: 3,
    intent: 2,
    exhausted: 1,
    native: 1,
    repaired: 1,
  });
  expect(analysis.latencyMs.p50).toBe(3000);
  expect(analysis.exhaustion).toEqual([
    {
      reason: "invalid-output",
      detail: "content must be 1 to 280 characters",
      count: 1,
    },
  ]);
  expect(analysis.degradedShare).toBe(0.25);
});

test("every refused reply an exhausted request kept is listed with whose turn it was, why, how many attempts, and what the model sent", () => {
  const analysis = analyzeReal(
    base({
      requests: [
        request("p1", "a"),
        request(undefined, "zeus", {
          outcome: "exhausted",
          steps: [
            {
              reason: "invalid-output",
              detail: "move: move is missing; legal here: ...",
              attempts: 2,
              output: '{"action":"practice","thread":"evt-1-5"}',
              schema: '{"type":"object"}',
            },
          ],
        }),
        // An outage keeps no reply: it is counted, not listed.
        request(undefined, "hera", {
          outcome: "exhausted",
          steps: [{ reason: "http-5xx", detail: "503", attempts: 2 }],
        }),
      ],
    }),
  );
  expect(analysis.refusals).toEqual([
    {
      god: "zeus",
      reason: "invalid-output",
      detail: "move: move is missing; legal here: ...",
      attempts: 2,
      output: '{"action":"practice","thread":"evt-1-5"}',
    },
  ]);
  expect(analysis.requests.exhausted).toBe(2);
  // Control: no exhausted request, no refusals.
  expect(
    analyzeReal(base({ requests: [request("p1", "a")] })).refusals,
  ).toEqual([]);
});

// --- Goals ---------------------------------------------------------------------------------

const HERA_GOAL = "Make Zeus admit his deceit.";

const heraGoal = () => goalSetEvent("evt-1-1", 1, "hera", HERA_GOAL, "zeus");

/** A request made for `role`, shown `prompt`. */
const asked = (role: string, prompt: string): RealRequest => ({
  proposalId: undefined,
  role,
  outcome: "intent",
  elapsedMs: 1000,
  promptPayload: prompt,
  steps: [{ mode: "native" }],
});

test("goal privacy fails when another god's goal text appears in a prompt outside an account it was told; names the god and the goal", () => {
  const leaked = base({
    events: [heraGoal()] as never,
    requests: [
      asked(
        "zeus",
        `You are Zeus.\nYou have heard: ${HERA_GOAL}\nWhat do you do?`,
      ),
    ],
  });
  const result = property(leaked, "goal privacy");
  expect(result?.ok).toBe(false);
  expect(result?.detail).toContain("zeus");
  expect(result?.detail).toContain("hera");
});

test("goal privacy passes when Hera reports her goal and her words appear in Zeus's remembered account of it, and when they appear nowhere", () => {
  const told = base({
    events: [heraGoal()] as never,
    requests: [
      asked(
        "zeus",
        `You remember:\n- hera told you: "${HERA_GOAL}" (claiming hera harmed zeus)\nWhat do you do?`,
      ),
    ],
  });
  expect(property(told, "goal privacy")?.ok).toBe(true);
  const absent = base({
    events: [heraGoal()] as never,
    requests: [asked("zeus", "You are Zeus.\nWhat do you do?")],
  });
  expect(property(absent, "goal privacy")?.ok).toBe(true);
});

test("goal privacy: a god's own prompt may show its own goal; the same text outside a told line in another's prompt is a leak even if one told line also carries it", () => {
  const own = base({
    events: [heraGoal()] as never,
    requests: [asked("hera", `Your goal: "${HERA_GOAL}" (target zeus, here).`)],
  });
  expect(property(own, "goal privacy")?.ok).toBe(true);
  const both = base({
    events: [heraGoal()] as never,
    requests: [
      asked(
        "zeus",
        `You remember:\n- hera told you: "${HERA_GOAL}"\nSomething else: ${HERA_GOAL}`,
      ),
    ],
  });
  expect(property(both, "goal privacy")?.ok).toBe(false);
  // Control: with no goals set there is nothing to leak, and the property still reports.
  expect(
    property(base({ requests: [asked("zeus", "x")] }), "goal privacy")?.ok,
  ).toBe(true);
});

test("a goal-only proposal is a valid god action, and the goal's target must be in the prompt like any named id", () => {
  const prompt = "Here with you:\n- hera (a god)";
  const goalOnly = base({
    requests: [request("p1", prompt)],
    proposals: [
      proposal("p1", "zeus", {
        kind: "goal",
        goal: { set: { text: "Win her.", target: "hera" } },
      }),
    ],
  });
  expect(property(goalOnly, "valid actions")?.ok).toBe(true);
  expect(property(goalOnly, "perception compliance")?.ok).toBe(true);
  expect(
    namedIds({ kind: "goal", goal: { set: { text: "t", target: "hera" } } }),
  ).toEqual(["hera"]);
  // Control: a goal target absent from the prompt is flagged.
  const unseen = base({
    requests: [request("p1", prompt)],
    proposals: [
      proposal("p1", "zeus", {
        kind: "goal",
        goal: { set: { text: "Hunt him.", target: "the-woodcutter" } },
      }),
    ],
  });
  const result = property(unseen, "perception compliance");
  expect(result?.ok).toBe(false);
  expect(result?.detail).toContain("the-woodcutter");
});

test("goal privacy checks something: goals were set but no prompt could be read, so it fails and says so; with no goals set there is nothing to check and it passes", () => {
  const unread = base({
    events: [heraGoal()] as never,
    requests: [
      { ...asked("zeus", "x"), promptPayload: undefined },
      { ...asked("hera", "y"), promptPayload: undefined },
    ],
  });
  const result = property(unread, "goal privacy");
  expect(result?.ok).toBe(false);
  expect(result?.detail).toContain("no prompt");
  // No requests at all is the same: nothing was checked.
  expect(
    property(base({ events: [heraGoal()] as never }), "goal privacy")?.ok,
  ).toBe(false);
  // Controls: no goals set means nothing to leak, and a readable prompt passes as before.
  expect(
    property(
      base({ requests: [{ ...asked("zeus", "x"), promptPayload: undefined }] }),
      "goal privacy",
    )?.ok,
  ).toBe(true);
  expect(
    property(
      base({
        events: [heraGoal()] as never,
        requests: [asked("zeus", "You are Zeus.")],
      }),
      "goal privacy",
    )?.ok,
  ).toBe(true);
});

// --- Petition privacy ---------------------------------------------------------------------

const prayerToHera = () => petitionOpenedEvent("evt-26-7", 7, "farmer", "hera");

test("petition privacy fails when a petition addressed to Hera appears in Zeus's prompt; names the petition and the prompt's god", () => {
  const leaked = base({
    events: [prayerToHera()] as never,
    requests: [
      asked(
        "zeus",
        "You are Zeus.\nPrayers to you:\n- [evt-26-7] farmer asks for help with food (it lacked food).",
      ),
      asked(
        "hera",
        "You are Hera.\nPrayers to you:\n- [evt-26-7] farmer asks for help with food (it lacked food).",
      ),
    ],
  });
  const result = property(leaked, "petition privacy");
  expect(result?.ok).toBe(false);
  expect(result?.detail).toContain("zeus");
  expect(result?.detail).toContain("evt-26-7");
  expect(result?.detail).toContain("hera");
});

test("petition privacy passes when only the named god's prompt lists it, and when no prompt does; with no petitions or no readable prompts it checks nothing and says so", () => {
  const private_ = base({
    events: [prayerToHera()] as never,
    requests: [
      asked("zeus", "You are Zeus.\nWhat do you do?"),
      asked(
        "hera",
        "You are Hera.\nPrayers to you:\n- [evt-26-7] farmer asks for help with food.",
      ),
    ],
  });
  expect(property(private_, "petition privacy")?.ok).toBe(true);
  expect(
    property(
      base({
        events: [prayerToHera()] as never,
        requests: [asked("zeus", "x")],
      }),
      "petition privacy",
    )?.ok,
  ).toBe(true);
  // Petitions exist but no prompt could be read: nothing was checked, so it fails like goal privacy.
  const unread = base({
    events: [prayerToHera()] as never,
    requests: [{ ...asked("zeus", "x"), promptPayload: undefined }],
  });
  const result = property(unread, "petition privacy");
  expect(result?.ok).toBe(false);
  expect(result?.detail).toContain("no prompt");
  // No petitions: nothing to leak.
  expect(
    property(base({ requests: [asked("zeus", "x")] }), "petition privacy")?.ok,
  ).toBe(true);
});

test("a bless is a valid god action, and the petition it names must be in the prompt like any named id", () => {
  const prompt =
    "Prayers to you:\n- [evt-26-7] farmer asks for help with food.";
  const ok = base({
    requests: [request("p1", prompt)],
    proposals: [
      proposal("p1", "hera", { kind: "bless", petition: "evt-26-7" }),
    ],
  });
  expect(property(ok, "valid actions")?.ok).toBe(true);
  expect(property(ok, "perception compliance")?.ok).toBe(true);
  expect(namedIds({ kind: "bless", petition: "evt-26-7" })).toEqual([
    "evt-26-7",
  ]);
  const unseen = base({
    requests: [request("p1", "You are Hera.")],
    proposals: [
      proposal("p1", "hera", { kind: "bless", petition: "evt-26-7" }),
    ],
  });
  expect(property(unseen, "perception compliance")?.ok).toBe(false);
});

test("a refusal and a strike on a mortal are valid god actions, and the prayer a refusal names and the mortal a strike names must be in the prompt like any named id", () => {
  const prompt =
    'Prayers to you:\n- [evt-26-7] farmer (your worshipper) asks you to punish lykos.\n  - refuse it: {"action":"refuse","petition":"evt-26-7"}';
  const refused = base({
    requests: [request("p1", prompt)],
    proposals: [
      proposal("p1", "hera", { kind: "refuse", petition: "evt-26-7" }),
    ],
  });
  expect(GOD_ACTIONS.has("refuse")).toBe(true);
  expect(property(refused, "valid actions")?.ok).toBe(true);
  expect(property(refused, "perception compliance")?.ok).toBe(true);
  expect(namedIds({ kind: "refuse", petition: "evt-26-7" })).toEqual([
    "evt-26-7",
  ]);
  // A refusal of a prayer the prompt never showed fails compliance.
  const unseen = base({
    requests: [request("p1", "You are Hera.")],
    proposals: [
      proposal("p1", "hera", { kind: "refuse", petition: "evt-26-7" }),
    ],
  });
  expect(property(unseen, "perception compliance")?.ok).toBe(false);
  // The mortal a strike names is shown by the prayer that asks for its punishment; one the prompt never named fails.
  const struck = base({
    requests: [request("p1", prompt)],
    proposals: [
      proposal("p1", "hera", { kind: "strike", target: "lykos", power: 1 }),
    ],
  });
  expect(property(struck, "perception compliance")?.ok).toBe(true);
  const stranger = base({
    requests: [request("p1", prompt)],
    proposals: [
      proposal("p1", "hera", { kind: "strike", target: "ismene", power: 1 }),
    ],
  });
  expect(property(stranger, "perception compliance")?.ok).toBe(false);
});

test("petition privacy matches whole ids: evt-26-7 does not match inside evt-26-70, and does match at the end of a line", () => {
  const events = [prayerToHera()] as never;
  const near = base({
    events,
    requests: [
      asked("zeus", "A note about evt-26-70 only."),
      asked("hera", "ok"),
    ],
  });
  expect(property(near, "petition privacy")?.ok).toBe(true);
  const exact = base({
    events,
    requests: [asked("zeus", "A note about evt-26-7"), asked("hera", "ok")],
  });
  expect(property(exact, "petition privacy")?.ok).toBe(false);
});

// A god that stood at the altar when a prayer was made witnessed it, so the prayer's id may reach its prompt through the scene or a citation; what it may never be is a divine delivery: the prayers section is the named god's alone.
const sceneWithPrayer =
  "You are Zeus.\nHere with you:\n- farmer\nRecent events here:\n- [evt-26-7] petition-opened (farmer)\nFor a legend, linkedEventId may be only one of: evt-26-7; omit it to cite nothing.\nWhat do you do?";

test("petition privacy passes a god that stood at the altar when the prayer was made, whose prompt carries the id in its scene and its citation guidance", () => {
  const witnessed = base({
    events: [
      movedEvent("evt-20-3", 3, "zeus", "altar"),
      prayerToHera(),
    ] as never,
    requests: [asked("zeus", sceneWithPrayer), asked("hera", "ok")],
  });
  const result = property(witnessed, "petition privacy");
  expect(result?.ok).toBe(true);
});

test("petition privacy still fails a witnessing god whose prayers section lists the other god's petition: witnessing never excuses divine delivery", () => {
  const delivered = base({
    events: [
      movedEvent("evt-20-3", 3, "zeus", "altar"),
      prayerToHera(),
    ] as never,
    requests: [
      asked(
        "zeus",
        `${sceneWithPrayer}\nPrayers to you:\n- [evt-26-7] farmer asks for help with food.\n  farmer at Altar [altar] (here).\nHere with you:\n- farmer`,
      ),
      asked("hera", "ok"),
    ],
  });
  const result = property(delivered, "petition privacy");
  expect(result?.ok).toBe(false);
  expect(result?.detail).toContain("prayers");
  expect(result?.detail).toContain("evt-26-7");
});

test("petition privacy fails a god that was not at the altar when the prayer was made, wherever its prompt carries the id: never there, left before, or arrived after", () => {
  const prompts = [asked("zeus", sceneWithPrayer), asked("hera", "ok")];
  const histories: Record<string, unknown[]> = {
    "never moved": [],
    "left before the prayer": [
      movedEvent("evt-20-3", 3, "zeus", "altar"),
      movedEvent("evt-21-4", 4, "zeus", "town-square"),
    ],
    "arrived after the prayer": [movedEvent("evt-30-9", 9, "zeus", "altar")],
    "another god was there": [movedEvent("evt-20-3", 3, "hera", "altar")],
  };
  for (const [name, moves] of Object.entries(histories)) {
    const result = property(
      base({ events: [...moves, prayerToHera()] as never, requests: prompts }),
      "petition privacy",
    );
    expect([name, result?.ok]).toEqual([name, false]);
    expect(result?.detail).toContain("not at the altar");
  }
});

test("a practice move names the thread or cause it answers, ids the god must have been shown, and is a god action", () => {
  expect(
    namedIds({ kind: "practice", move: "accept", thread: "evt-9" }),
  ).toEqual(["evt-9"]);
  expect(
    namedIds({
      kind: "practice",
      move: "demand",
      cause: "evt-3",
      term: { kind: "ally" },
    }),
  ).toEqual(["evt-3"]);
  expect(GOD_ACTIONS.has("practice")).toBe(true);
});
