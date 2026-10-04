import { expect, test } from "bun:test";
import { MAX_GOAL_LENGTH, MAX_REPORT_LENGTH } from "./event";
import { PRACTICE_MOVES } from "./practice";
import {
  PROPOSAL_KINDS,
  parseObservationRecord,
  parseProposal,
} from "./proposal";

function base(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    actor: "npc-1",
    targets: [],
    expectedRevisions: [],
    source: "routine",
    observationId: "obs-1",
    ...overrides,
  };
}

test("observation record parses", () => {
  const result = parseObservationRecord({
    schemaVersion: 1,
    id: "obs-1",
    observer: "npc-1",
    stateRevision: 4,
    factsRead: ["location:agora.occupants"],
    source: "routine",
  });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      schemaVersion: 1,
      id: "obs-1",
      observer: "npc-1",
      stateRevision: 4,
      factsRead: ["location:agora.occupants"],
      source: "routine",
    });
  }
});

test("a valid move proposal parses to its typed variant", () => {
  const result = parseProposal(base({ kind: "move", to: "loc-town" }));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.kind).toBe("move");
    expect(result.value).toMatchObject({
      kind: "move",
      to: "loc-town",
      actor: "npc-1",
    });
  }
});

test("a valid realm-transition proposal parses to its typed variant", () => {
  const result = parseProposal(
    base({
      kind: "realm-transition",
      to: "underworld-gate",
      via: "styx-ferry",
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "realm-transition",
      to: "underworld-gate",
      via: "styx-ferry",
    });
  }
});

test("a valid gather proposal parses to its typed variant", () => {
  const result = parseProposal(
    base({ kind: "gather", resource: "wood", amount: 3 }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "gather",
      resource: "wood",
      amount: 3,
    });
  }
});

test("a valid produce proposal parses to its typed variant", () => {
  const result = parseProposal(
    base({ kind: "produce", output: "bread", quantity: 2 }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "produce",
      output: "bread",
      quantity: 2,
    });
  }
});

test("a valid trade proposal parses to its typed variant, keeping actual trade terms", () => {
  const result = parseProposal(
    base({
      kind: "trade",
      counterparty: "npc-2",
      give: [{ resource: "wheat", amount: 3 }],
      receive: [{ resource: "wine", amount: 1 }],
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "trade",
      counterparty: "npc-2",
      give: [{ resource: "wheat", amount: 3 }],
      receive: [{ resource: "wine", amount: 1 }],
    });
  }
});

test("a valid consume proposal parses to its typed variant", () => {
  const result = parseProposal(
    base({ kind: "consume", resource: "food", amount: 1 }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "consume",
      resource: "food",
      amount: 1,
    });
  }
});

test("a valid strike proposal parses to its typed variant", () => {
  const result = parseProposal(
    base({ source: "fixture", kind: "strike", target: "tavern-1", power: 0.8 }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "strike",
      target: "tavern-1",
      power: 0.8,
    });
  }
});

test("a valid repair proposal parses to its typed variant", () => {
  const result = parseProposal(base({ kind: "repair", structure: "tavern-1" }));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "repair",
      structure: "tavern-1",
    });
  }
});

test("a valid worship proposal parses to its typed variant", () => {
  const result = parseProposal(
    base({
      kind: "worship",
      deity: "zeus",
      offering: { resource: "wine", amount: 1 },
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "worship",
      deity: "zeus",
      offering: { resource: "wine", amount: 1 },
    });
  }
});

test("a valid legend proposal parses to its typed variant, unlinked", () => {
  const result = parseProposal(
    base({ kind: "legend", assertion: "Zeus struck down the old oak" }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "legend",
      assertion: "Zeus struck down the old oak",
    });
    if (result.value.kind === "legend") {
      expect(result.value.linkedEventId).toBeUndefined();
    }
  }
});

test("a valid legend proposal may link a committed event", () => {
  const result = parseProposal(
    base({
      kind: "legend",
      assertion: "Zeus struck down the old oak",
      linkedEventId: "evt-9",
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok && result.value.kind === "legend") {
    expect(String(result.value.linkedEventId)).toBe("evt-9");
  }
});

test("a valid claim proposal parses to its typed variant", () => {
  const result = parseProposal(
    base({ kind: "claim", assertion: "I own the tavern" }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "claim",
      assertion: "I own the tavern",
    });
  }
});

test("missing actor is a structured rejection naming the field", () => {
  const payload = base({ kind: "move", to: "loc-town" });
  delete payload.actor;
  const result = parseProposal(payload);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.path).toBe("actor");
    expect(result.reason).toBe("malformed");
  }
});

test("unknown kind is rejected with reason unknown-kind", () => {
  const result = parseProposal(base({ kind: "fly" }));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.path).toBe("kind");
    expect(result.reason).toBe("unknown-kind");
  }
});

test("a non-numeric gather amount is a structured rejection naming the field", () => {
  const result = parseProposal(
    base({ kind: "gather", resource: "wood", amount: "a lot" }),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.path).toBe("amount");
  }
});

test("a proposal declaring preconditions is rejected as unauthorized-claim", () => {
  const result = parseProposal(
    base({ kind: "move", to: "loc-town", preconditions: ["tavern is open"] }),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("unauthorized-claim");
    expect(result.path).toBe("preconditions");
  }
});

test("a proposal declaring requiredCapabilities is rejected as unauthorized-claim", () => {
  const result = parseProposal(
    base({ kind: "move", to: "loc-town", requiredCapabilities: ["divine"] }),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("unauthorized-claim");
    expect(result.path).toBe("requiredCapabilities");
  }
});

test("a proposal declaring costs is rejected as unauthorized-claim", () => {
  const result = parseProposal(
    base({
      kind: "claim",
      assertion: "I own the tavern's inventory",
      costs: [{ resource: "gold", amount: 100 }],
    }),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("unauthorized-claim");
    expect(result.path).toBe("costs");
  }
});

test("a proposal declaring a modelRequestId is rejected as unauthorized-claim", () => {
  const result = parseProposal(
    base({ kind: "move", to: "loc-town", modelRequestId: "model-req-1" }),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("unauthorized-claim");
    expect(result.path).toBe("modelRequestId");
  }
});

test("a claim proposal asserting expected entity revisions is rejected as unauthorized-claim", () => {
  const result = parseProposal(
    base({
      kind: "claim",
      assertion: "I own the tavern",
      expectedRevisions: [{ entityId: "tavern-1", revision: 2 }],
    }),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("unauthorized-claim");
    expect(result.path).toBe("expectedRevisions");
  }
});

test("an unsupported schema version is rejected distinctly from malformed payloads", () => {
  const result = parseProposal(
    base({ kind: "move", to: "loc-town", schemaVersion: 99 }),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("unsupported-version");
  }

  const malformed = parseProposal({ kind: "move", to: "loc-town" });
  expect(malformed.ok).toBe(false);
  if (!malformed.ok) {
    expect(malformed.reason).toBe("malformed");
  }
});

test("a proposal with an unknown source is rejected", () => {
  const result = parseProposal(
    base({ kind: "move", to: "loc-town", source: "hacker" }),
  );
  expect(result.ok).toBe(false);
});

test("a proposal referencing an observation carries its ID", () => {
  const result = parseProposal(
    base({ kind: "move", to: "loc-town", observationId: "obs-42" }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(String(result.value.observationId)).toBe("obs-42");
  }
});

test.each(["routine", "fixture", "operator", "model", "director"])(
  "a proposal and an observation may declare the %s source",
  (source) => {
    expect(
      parseProposal(
        base({ source, kind: "gather", resource: "wood", amount: 3 }),
      ).ok,
    ).toBe(true);
    expect(
      parseObservationRecord({
        schemaVersion: 1,
        id: "obs-1",
        observer: "npc-1",
        stateRevision: 0,
        factsRead: [],
        source,
      }).ok,
    ).toBe(true);
  },
);

test("an unknown source is still rejected, naming the source", () => {
  const result = parseProposal(
    base({ source: "oracle", kind: "gather", resource: "wood", amount: 3 }),
  );

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.message).toContain("oracle");
  }
});

test("a valid report proposal names its listener and the content told, citing an event or not", () => {
  const bare = parseProposal(
    base({
      kind: "report",
      listener: "hera",
      content: "Zeus burned down the agora",
    }),
  );
  expect(bare.ok).toBe(true);
  if (bare.ok && bare.value.kind === "report") {
    expect(String(bare.value.listener)).toBe("hera");
    expect(bare.value.content).toBe("Zeus burned down the agora");
    expect(bare.value.linkedEventId).toBeUndefined();
  }

  const cited = parseProposal(
    base({
      kind: "report",
      listener: "hera",
      content: "Zeus burned down the agora",
      linkedEventId: "evt-9",
    }),
  );
  expect(cited.ok).toBe(true);
  if (cited.ok && cited.value.kind === "report") {
    expect(String(cited.value.linkedEventId)).toBe("evt-9");
  }
});

test("a report proposal without a listener or content, or with a malformed link, is rejected", () => {
  expect(parseProposal(base({ kind: "report", content: "x" })).ok).toBe(false);
  expect(parseProposal(base({ kind: "report", listener: "hera" })).ok).toBe(
    false,
  );
  expect(
    parseProposal(
      base({
        kind: "report",
        listener: "hera",
        content: "x",
        linkedEventId: 9,
      }),
    ).ok,
  ).toBe(false);
});

test("report is a proposal kind content can name as an ability", () => {
  expect(PROPOSAL_KINDS).toContain("report");
});

test("a report may carry a structured claim about who did what to whom; the claim is the teller's assertion and is parsed for shape only", () => {
  const result = parseProposal(
    base({
      kind: "report",
      listener: "hera",
      content: "Zeus wronged the farmer",
      claim: { effect: "harm", agent: "zeus", target: "farmer" },
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok && result.value.kind === "report") {
    expect(result.value.claim as unknown).toEqual({
      effect: "harm",
      agent: "zeus",
      target: "farmer",
    });
  }
  // A claim needs no target, and a report needs no claim.
  expect(
    parseProposal(
      base({
        kind: "report",
        listener: "hera",
        content: "x",
        claim: { effect: "kindness", agent: "zeus" },
      }),
    ).ok,
  ).toBe(true);
});

test("a report whose claim is malformed is rejected", () => {
  for (const claim of [
    { effect: "worship", agent: "zeus" },
    { effect: "harm" },
    { agent: "zeus" },
    "zeus harmed the farmer",
    { effect: "harm", agent: "zeus", target: 7 },
  ]) {
    expect(
      parseProposal(
        base({ kind: "report", listener: "hera", content: "x", claim }),
      ).ok,
    ).toBe(false);
  }
});

test("report text is bounded: exactly the limit is accepted, one more is rejected", () => {
  const report = (content: string) =>
    parseProposal(base({ kind: "report", listener: "hera", content }));
  expect(report("x".repeat(MAX_REPORT_LENGTH)).ok).toBe(true);
  expect(report("x".repeat(MAX_REPORT_LENGTH + 1)).ok).toBe(false);
  expect(MAX_REPORT_LENGTH).toBe(280);
});

// --- Goals ---------------------------------------------------------------------------------

const GOAL_SET = {
  set: { text: "Win the farmer's devotion.", target: "farmer" },
};

test("a proposal may carry a goal set, alongside its action", () => {
  const result = parseProposal(
    base({ kind: "move", to: "tavern", goal: GOAL_SET }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.goal as unknown).toEqual(GOAL_SET);
  }
  // Without a goal the field is absent: existing proposals are unchanged.
  const plain = parseProposal(base({ kind: "move", to: "tavern" }));
  expect(plain.ok && "goal" in plain.value).toBe(false);
});

test("a proposal may carry a goal end with each outcome, and both an end and a set", () => {
  for (const outcome of ["achieved", "failed", "abandoned"]) {
    const result = parseProposal(
      base({ kind: "move", to: "tavern", goal: { end: { outcome } } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.goal as unknown).toEqual({ end: { outcome } });
    }
  }
  const both = parseProposal(
    base({
      kind: "report",
      listener: "hera",
      content: "x",
      goal: { end: { outcome: "achieved" }, ...GOAL_SET },
    }),
  );
  expect(both.ok).toBe(true);
  if (both.ok) {
    expect(both.value.goal as unknown).toEqual({
      end: { outcome: "achieved" },
      ...GOAL_SET,
    });
  }
});

test("a goal-only proposal parses, and needs its goal", () => {
  const result = parseProposal(base({ kind: "goal", goal: GOAL_SET }));
  expect(result.ok).toBe(true);
  if (result.ok && result.value.kind === "goal") {
    expect(result.value.goal as unknown).toEqual(GOAL_SET);
  }
  expect(parseProposal(base({ kind: "goal" })).ok).toBe(false);
  expect(PROPOSAL_KINDS).toContain("goal");
});

test("a goal change with empty or over-long text, an unknown outcome, no target, or neither an end nor a set is rejected", () => {
  const withGoal = (goal: unknown) =>
    parseProposal(base({ kind: "move", to: "tavern", goal })).ok;
  expect(
    withGoal({ set: { text: "x".repeat(MAX_GOAL_LENGTH), target: "farmer" } }),
  ).toBe(true);
  expect(withGoal({ set: { text: "", target: "farmer" } })).toBe(false);
  expect(withGoal({ set: { text: "   ", target: "farmer" } })).toBe(false);
  expect(
    withGoal({
      set: { text: "x".repeat(MAX_GOAL_LENGTH + 1), target: "farmer" },
    }),
  ).toBe(false);
  expect(withGoal({ set: { text: "ok" } })).toBe(false);
  expect(withGoal({ set: { text: "ok", target: 7 } })).toBe(false);
  expect(withGoal({ end: { outcome: "won" } })).toBe(false);
  expect(withGoal({ end: {} })).toBe(false);
  expect(withGoal({})).toBe(false);
  expect(withGoal("achieved")).toBe(false);
  expect(withGoal(null)).toBe(false);
});

// --- A legend's claim -------------------------------------------------------------------------

test("a legend proposal may carry a claim shaped like a report's, and a malformed claim is rejected", () => {
  const result = parseProposal(
    base({
      kind: "legend",
      assertion: "Zeus cheated me.",
      claim: { effect: "harm", agent: "zeus", target: "hera" },
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok && result.value.kind === "legend") {
    expect(result.value.claim as unknown).toEqual({
      effect: "harm",
      agent: "zeus",
      target: "hera",
    });
  }
  // Without one the field is absent.
  const plain = parseProposal(base({ kind: "legend", assertion: "x" }));
  expect(plain.ok && "claim" in plain.value).toBe(false);
  for (const claim of [
    { effect: "worship", agent: "zeus" },
    { effect: "harm" },
    "zeus harmed hera",
  ]) {
    expect(
      parseProposal(base({ kind: "legend", assertion: "x", claim })).ok,
    ).toBe(false);
  }
});

// --- Praying and blessing ---------------------------------------------------------------------

test("a pray proposal names the cause event it prays about, and a bless proposal names the petition it answers", () => {
  const pray = parseProposal(base({ kind: "pray", cause: "evt-3" }));
  expect(pray.ok).toBe(true);
  if (pray.ok && pray.value.kind === "pray")
    expect(String(pray.value.cause)).toBe("evt-3");
  const bless = parseProposal(
    base({ kind: "bless", petition: "evt-4", targets: ["farmer"] }),
  );
  expect(bless.ok).toBe(true);
  if (bless.ok && bless.value.kind === "bless")
    expect(String(bless.value.petition)).toBe("evt-4");
  expect(PROPOSAL_KINDS).toContain("pray");
  expect(PROPOSAL_KINDS).toContain("bless");
  for (const bad of [
    { kind: "pray" },
    { kind: "pray", cause: 7 },
    { kind: "bless" },
    { kind: "bless", petition: "" },
  ]) {
    expect(parseProposal(base(bad)).ok).toBe(false);
  }
});

// --- Practice moves ---------------------------------------------------------------------------

const TELL_TERM = {
  kind: "tell-legend",
  party: "zeus",
  place: "altar",
  deadlineTicks: 120,
};

test("one flat practice proposal carries a move: a demand names who, the cause it knows, and one term; the others name their thread", () => {
  const demand = parseProposal(
    base({
      kind: "practice",
      move: "demand",
      counterparty: "zeus",
      cause: "evt-3",
      term: TELL_TERM,
    }),
  );
  expect(demand.ok).toBe(true);
  if (demand.ok && demand.value.kind === "practice") {
    expect(demand.value.move).toBe("demand");
    expect(demand.value).toMatchObject({
      counterparty: "zeus",
      cause: "evt-3",
      term: TELL_TERM,
    });
  }
  const counter = parseProposal(
    base({
      kind: "practice",
      move: "counter",
      thread: "evt-9",
      term: TELL_TERM,
    }),
  );
  expect(counter.ok).toBe(true);
  for (const move of ["refuse", "withdraw"]) {
    const parsed = parseProposal(
      base({ kind: "practice", move, thread: "evt-9" }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.value.kind === "practice") {
      expect(String(parsed.value.move)).toBe(move);
      expect(String((parsed.value as { thread: string }).thread)).toBe("evt-9");
    }
  }
  expect(PROPOSAL_KINDS).toContain("practice");
});

test("accepting a practice thread may swear it; the swear flag defaults to absent", () => {
  const plain = parseProposal(
    base({ kind: "practice", move: "accept", thread: "evt-9" }),
  );
  const sworn = parseProposal(
    base({ kind: "practice", move: "accept", thread: "evt-9", swear: true }),
  );
  expect(plain.ok && sworn.ok).toBe(true);
  if (
    plain.ok &&
    plain.value.kind === "practice" &&
    plain.value.move === "accept"
  ) {
    expect(plain.value.swear).toBeUndefined();
  }
  if (
    sworn.ok &&
    sworn.value.kind === "practice" &&
    sworn.value.move === "accept"
  ) {
    expect(sworn.value.swear).toBe(true);
  }
  expect(
    parseProposal(
      base({ kind: "practice", move: "accept", thread: "evt-9", swear: "yes" }),
    ).ok,
  ).toBe(false);
});

test("every checkable term parses with its own fields, and anything outside that closed set is refused", () => {
  const good = [
    TELL_TERM,
    { kind: "be-at", party: "hera", place: "altar", deadlineTicks: 60 },
    { kind: "stay-away", party: "hera", place: "altar", deadlineTicks: 60 },
    {
      kind: "give-resource",
      party: "zeus",
      to: "hera",
      resource: "divinity",
      amount: 2,
      deadlineTicks: 90,
    },
    {
      kind: "bless-mortal",
      party: "zeus",
      mortal: "farmer",
      deadlineTicks: 90,
    },
    {
      kind: "make-offering",
      party: "zeus",
      to: "hera",
      resource: "food",
      amount: 1,
      deadlineTicks: 90,
    },
    { kind: "ally", party: "zeus", to: "hera", deadlineTicks: 90 },
  ];
  for (const term of good) {
    const parsed = parseProposal(
      base({ kind: "practice", move: "counter", thread: "evt-9", term }),
    );
    expect(parsed.ok).toBe(true);
    if (
      parsed.ok &&
      parsed.value.kind === "practice" &&
      parsed.value.move === "counter"
    ) {
      expect(parsed.value.term).toEqual(term as never);
    }
  }
  for (const term of [
    { kind: "swear-fealty", party: "zeus", deadlineTicks: 60 },
    { ...TELL_TERM, place: undefined },
    { ...TELL_TERM, party: undefined },
    { ...TELL_TERM, deadlineTicks: undefined },
    { ...TELL_TERM, deadlineTicks: 0 },
    { ...TELL_TERM, deadlineTicks: 1.5 },
    { ...TELL_TERM, deadlineTicks: -3 },
    {
      kind: "give-resource",
      party: "zeus",
      to: "hera",
      resource: "food",
      amount: 0,
      deadlineTicks: 9,
    },
    {
      kind: "give-resource",
      party: "zeus",
      resource: "food",
      amount: 1,
      deadlineTicks: 9,
    },
    { kind: "bless-mortal", party: "zeus", deadlineTicks: 9 },
    "tell a legend",
    undefined,
  ]) {
    expect(
      parseProposal(
        base({ kind: "practice", move: "counter", thread: "evt-9", term }),
      ).ok,
    ).toBe(false);
  }
});

test("a practice proposal without what its move needs is refused: no move, an unknown move, a demand with no cause, counterparty, or term, a thread move with no thread", () => {
  for (const bad of [
    { kind: "practice" },
    { kind: "practice", move: "swear", thread: "evt-9" },
    { kind: "practice", move: "offer", thread: "evt-9", term: TELL_TERM },
    { kind: "practice", move: "demand", cause: "evt-3", term: TELL_TERM },
    { kind: "practice", move: "demand", counterparty: "zeus", term: TELL_TERM },
    { kind: "practice", move: "demand", counterparty: "zeus", cause: "evt-3" },
    { kind: "practice", move: "counter", term: TELL_TERM },
    { kind: "practice", move: "counter", thread: "evt-9" },
    { kind: "practice", move: "accept" },
    { kind: "practice", move: "refuse" },
    { kind: "practice", move: "withdraw", thread: "" },
  ]) {
    expect(parseProposal(base(bad)).ok).toBe(false);
  }
});

// --- Offering terms to a supplicant -----------------------------------------------------------

const OFFERING = {
  kind: "make-offering",
  party: "farmer",
  to: "hera",
  resource: "wood",
  amount: 1,
  deadlineTicks: 80,
};

test("a god offers a supplicant terms with one flat practice proposal: the petition it answers, one offering term, and optionally a stake by its id", () => {
  const plain = parseProposal(
    base({
      kind: "practice",
      move: "offer",
      petition: "evt-4",
      term: OFFERING,
    }),
  );
  expect(plain.ok).toBe(true);
  if (
    plain.ok &&
    plain.value.kind === "practice" &&
    plain.value.move === "offer"
  ) {
    expect(String(plain.value.petition)).toBe("evt-4");
    expect(plain.value.term).toEqual(OFFERING as never);
    expect(plain.value.stake).toBeUndefined();
  }
  const staked = parseProposal(
    base({
      kind: "practice",
      move: "offer",
      petition: "evt-4",
      term: OFFERING,
      stake: "wolf",
    }),
  );
  expect(staked.ok).toBe(true);
  if (
    staked.ok &&
    staked.value.kind === "practice" &&
    staked.value.move === "offer"
  ) {
    expect(staked.value.stake).toBe("wolf");
  }
  expect(PRACTICE_MOVES as readonly string[]).toContain("offer");
  for (const bad of [
    { kind: "practice", move: "offer", term: OFFERING },
    { kind: "practice", move: "offer", petition: "", term: OFFERING },
    { kind: "practice", move: "offer", petition: "evt-4" },
    {
      kind: "practice",
      move: "offer",
      petition: "evt-4",
      term: OFFERING,
      stake: "",
    },
    {
      kind: "practice",
      move: "offer",
      petition: "evt-4",
      term: OFFERING,
      stake: 3,
    },
    {
      kind: "practice",
      move: "offer",
      petition: "evt-4",
      term: { ...OFFERING, deadlineTicks: 0 },
    },
  ]) {
    expect(parseProposal(base(bad)).ok).toBe(false);
  }
});

test("a stake belongs to an offer to a supplicant and to nothing else: a demand, a counter, an accept, a refusal, and a withdrawal that carry one are refused", () => {
  const term = {
    kind: "tell-legend",
    party: "zeus",
    place: "altar",
    deadlineTicks: 100,
  };
  for (const bad of [
    {
      kind: "practice",
      move: "demand",
      counterparty: "zeus",
      cause: "evt-3",
      term,
      stake: "wolf",
    },
    { kind: "practice", move: "counter", thread: "evt-9", term, stake: "wolf" },
    { kind: "practice", move: "accept", thread: "evt-9", stake: "wolf" },
    { kind: "practice", move: "refuse", thread: "evt-9", stake: "wolf" },
    { kind: "practice", move: "withdraw", thread: "evt-9", stake: "wolf" },
  ]) {
    expect([bad.move, parseProposal(base(bad)).ok]).toEqual([bad.move, false]);
  }
});

test("a contest move names the rival act it rests on and nothing else: the world finds the rival, the place, and the window", () => {
  const ok = parseProposal(
    base({ kind: "practice", move: "contest", cause: "evt-12" }),
  );
  expect(ok.ok).toBe(true);
  if (ok.ok && ok.value.kind === "practice" && ok.value.move === "contest") {
    expect(String(ok.value.cause)).toBe("evt-12");
  }
  expect(PRACTICE_MOVES as readonly string[]).toContain("contest");
  for (const bad of [
    { kind: "practice", move: "contest" },
    { kind: "practice", move: "contest", cause: "" },
    { kind: "practice", move: "contest", cause: 7 },
    // Everything the world decides is not the god's to name.
    {
      kind: "practice",
      move: "contest",
      cause: "evt-12",
      place: "town-square",
    },
    {
      kind: "practice",
      move: "contest",
      cause: "evt-12",
      counterparty: "poseidon",
    },
    { kind: "practice", move: "contest", cause: "evt-12", term: OFFERING },
    { kind: "practice", move: "contest", cause: "evt-12", thread: "evt-9" },
  ]) {
    expect(parseProposal(base(bad)).ok).toBe(false);
  }
});

test("a travel proposal names one destination, and no other field", () => {
  expect(PROPOSAL_KINDS).toContain("travel");
  const result = parseProposal(base({ kind: "travel", to: "tavern" }));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "travel",
      to: "tavern",
      actor: "npc-1",
    });
  }
  for (const to of [undefined, "", 3]) {
    expect(parseProposal(base({ kind: "travel", to })).ok).toBe(false);
  }
});

test("a travel proposal may carry a goal change, like any action", () => {
  const result = parseProposal(
    base({
      kind: "travel",
      to: "tavern",
      goal: { set: { text: "Find the farmer.", target: "farmer" } },
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.goal?.set?.text).toBe("Find the farmer.");
  }
});
