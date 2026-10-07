import { expect, test } from "bun:test";
import type { RealInput, RealProposal, RealRequest } from "./real-analysis";
import {
  percentile,
  renderRequestTimings,
  requestTimings,
} from "./request-timing";

const SEVEN = [
  "athena",
  "hades",
  "hephaestus",
  "hera",
  "hermes",
  "poseidon",
  "zeus",
];

const promptAt = (tick: number, extra = "") =>
  `You are a god.\n${extra}You are at The Square [square] in the mortal realm, tick ${tick}.\nYou hold: nothing.\n`;

let n = 0;
function request(
  god: string,
  tick: number,
  latencyMs: number,
  recordedAt: number,
  overrides: Partial<RealRequest> = {},
): { request: RealRequest; proposal?: RealProposal } {
  n += 1;
  const proposalId = `p${n}`;
  return {
    request: {
      proposalId,
      role: god,
      outcome: "intent",
      elapsedMs: latencyMs,
      promptPayload: promptAt(tick),
      steps: [{ mode: "native" }],
      recordedAt,
      ...overrides,
    },
  };
}

const proposal = (
  id: string | undefined,
  god: string,
  consumedTick: number | undefined,
): RealProposal =>
  ({
    proposalId: id,
    actor: god,
    kind: "practice",
    observationId: `obs-${id}`,
    proposal: {},
    outcome: "committed",
    ...(consumedTick === undefined ? {} : { consumedTick }),
  }) as RealProposal;

/** A run: gods asked one at a time in id order, ~10 s each, a tick a second from wall time 0. */
function run(): RealInput {
  const a = request("athena", 2, 11_000, 13_000);
  const h = request("hades", 13, 8_400, 21_400);
  const x = request("hephaestus", 22, 10_000, 31_400, {
    outcome: "exhausted",
    proposalId: undefined,
    steps: [{ reason: "unreachable", detail: "connection refused" }],
  });
  return {
    requests: [a.request, h.request, x.request],
    proposals: [
      proposal(a.request.proposalId, "athena", 14),
      proposal(h.request.proposalId, "hades", 22),
    ],
    events: [],
    polls: { total: 30, degraded: 0 },
    timing: { gods: SEVEN, endedAtMs: 31_500, endTick: 32 },
  } as RealInput;
}

test("every request is timed from what the trace and journal already hold: the god, the tick it was asked, the tick its answer was applied, its latency, its outcome, and its prompt size", () => {
  const { requests } = requestTimings(run());
  expect(requests.map((r) => r.god)).toEqual(["athena", "hades", "hephaestus"]);
  expect(requests[0]).toMatchObject({
    god: "athena",
    startTick: 2,
    appliedTick: 14,
    latencyMs: 11_000,
    outcome: "answered",
  });
  expect(requests[0]?.promptChars).toBe(promptAt(2).length);
  expect(requests[1]).toMatchObject({
    startTick: 13,
    appliedTick: 22,
    outcome: "answered",
  });
  // An exhausted request has no answer to apply, and says why.
  expect(requests[2]).toMatchObject({
    god: "hephaestus",
    startTick: 22,
    outcome: "exhausted",
    detail: "unreachable: connection refused",
  });
  expect(requests[2]?.appliedTick).toBeUndefined();
});

test("a god that never got a turn is shown with 0 turns and no gaps or latency", () => {
  const { perGod } = requestTimings(run());
  expect(perGod.map((g) => g.god)).toEqual(SEVEN);
  const zeus = perGod.find((g) => g.god === "zeus");
  expect(zeus).toEqual({
    god: "zeus",
    turns: 0,
    medianGapTicks: undefined,
    worstGapTicks: undefined,
    p95GapTicks: undefined,
    medianLatencyMs: undefined,
  });
  expect(perGod.find((g) => g.god === "athena")).toMatchObject({
    turns: 1,
    medianLatencyMs: 11_000,
  });
  // One turn leaves no gap to measure.
  expect(perGod.find((g) => g.god === "athena")?.worstGapTicks).toBeUndefined();
});

test("the gap between a god's turns is the ticks between its request starts: the median and the worst, and its median latency", () => {
  const rows: RealInput = {
    requests: [
      request("zeus", 10, 5_000, 1).request,
      request("hera", 12, 7_000, 2).request,
      request("zeus", 30, 9_000, 3).request,
      request("zeus", 100, 1_000, 4).request,
      request("zeus", 112, 3_000, 5).request,
    ],
    proposals: [],
    events: [],
    polls: { total: 1, degraded: 0 },
    timing: { gods: ["hera", "zeus"], endedAtMs: 5, endTick: 120 },
  } as RealInput;
  const zeus = requestTimings(rows).perGod.find((g) => g.god === "zeus");
  // Starts at 10, 30, 100, 112: gaps 20, 70, 12.
  expect(zeus).toMatchObject({
    turns: 4,
    medianGapTicks: 20,
    worstGapTicks: 70,
    p95GapTicks: 70,
    medianLatencyMs: 4_000,
  });
});

test("the 95th percentile is the nearest rank: the largest of twenty values is the 95th, and one value is its own", () => {
  const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
  expect(percentile(twenty, 0.95)).toBe(19);
  expect(percentile([...twenty, 21], 0.95)).toBe(20);
  expect(percentile([7], 0.95)).toBe(7);
  expect(percentile([], 0.95)).toBeUndefined();
  // Unsorted input, and the share's ends.
  expect(percentile([9, 1, 5], 1)).toBe(9);
  expect(percentile([9, 1, 5], 0.01)).toBe(1);
});

test("a request still in flight when the run ended is shown as such, inferred from the quiet since the last answer, with its god the next in id order and its start estimated", () => {
  const input = run();
  // Run stopped 6 s after the last request was recorded, at tick 38.
  const quiet: RealInput = {
    ...input,
    timing: { gods: SEVEN, endedAtMs: 37_400, endTick: 38 },
  } as RealInput;
  const { requests, perGod } = requestTimings(quiet);
  const last = requests.at(-1);
  expect(last).toMatchObject({
    god: "hera",
    outcome: "in-flight",
    startTickEstimated: true,
  });
  expect(last?.startTick).toBe(32);
  expect(last?.appliedTick).toBeUndefined();
  expect(last?.latencyMs).toBeUndefined();
  // It has not finished, so it is not a turn, and it adds no gap.
  expect(perGod.find((g) => g.god === "hera")?.turns).toBe(0);
  // A god with a proposal still waiting in the journal is skipped, as the service skips it.
  const waiting: RealInput = {
    ...quiet,
    proposals: [...quiet.proposals, proposal("pending", "hera", undefined)],
  } as RealInput;
  expect(requestTimings(waiting).requests.at(-1)?.god).toBe("hermes");
});

test("nothing is in flight when the run ended right after the last answer", () => {
  const { requests } = requestTimings(run());
  expect(requests.some((r) => r.outcome === "in-flight")).toBe(false);
});

test("a run with no timing information times what it has and infers nothing", () => {
  const input = { ...run(), timing: undefined } as unknown as RealInput;
  const { requests, perGod } = requestTimings(input);
  expect(requests).toHaveLength(3);
  expect(requests.some((r) => r.outcome === "in-flight")).toBe(false);
  expect(perGod.map((g) => g.god)).toEqual(["athena", "hades", "hephaestus"]);
});

test("rendering gives one row per request in the order they ran and one row per god, 0 turns for a god never asked, and marks what is inferred", () => {
  const input = {
    ...run(),
    timing: { gods: SEVEN, endedAtMs: 37_400, endTick: 38 },
  } as RealInput;
  const text = renderRequestTimings(requestTimings(input)).join("\n");
  expect(text).toContain("| 1 | athena | 2 | 14 | 11.0 s | answered | ");
  expect(text).toContain(
    "| 3 | hephaestus | 22 | — | 10.0 s | exhausted (unreachable: connection refused) | ",
  );
  expect(text).toContain(
    "| 4 | hera | ≈32 | — | — | in flight at the end (inferred) | ",
  );
  expect(text).toContain("| zeus | 0 | — | — | — | — |");
  expect(text).toContain("| athena | 1 | — | — | — | 11.0 s |");
});
