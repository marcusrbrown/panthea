import { expect, test } from "bun:test";
import {
  buildDispositions,
  dispositionCounts,
  renderDispositionCounts,
} from "./dispositions";
import { act, input, move } from "./episode-test-data";
import type { RealInput } from "./real-analysis";

/** A proposal the world rejected: the journal stores the validation reason code. */
function rejected(
  actor: string,
  fields: Record<string, unknown>,
  reason: string,
  sequence: number,
) {
  const made = act(actor, fields, sequence, { outcome: "rejected" });
  return {
    ...made,
    proposal: { ...made.proposal, reason },
    // A rejection commits no event.
    event: undefined,
  };
}

/** The run's data: every proposal's journal row, and only the events committed ones caused. */
function run(
  made: ReturnType<typeof act | typeof rejected>[],
): Pick<RealInput, "proposals" | "events"> {
  return {
    proposals: made.map((m) => m.proposal),
    events: made.flatMap((m) =>
      m.event === undefined ? [] : [m.event],
    ) as RealInput["events"],
  };
}

const bless = (petition: string) => ({ kind: "bless", petition });

test("each proposal gets its action kind and what the world did: the events it caused, the reason it was rejected, or that it is still pending", () => {
  const committed = move("zeus", "olympus-gate", 5);
  const stale = rejected("hera", bless("pet-1"), "stale-target", 6);
  const apart = rejected(
    "zeus",
    { kind: "travel", to: "tavern" },
    "not-adjacent",
    7,
  );
  const pending = act("hera", { kind: "legend", assertion: "x" }, 8);
  const data = run([committed, stale, apart, pending]);
  // The pending proposal has no outcome yet and no event.
  const proposals = data.proposals.map((p) =>
    p.proposalId === pending.proposal.proposalId
      ? { ...p, outcome: undefined }
      : p,
  );
  const events = data.events.filter(
    (e) => e.correlationId !== pending.proposal.observationId,
  );

  const dispositions = buildDispositions({ proposals, events });

  expect(
    dispositions.map((d) => [d.actor, d.kind, d.target, d.outcome, d.events]),
  ).toEqual([
    ["zeus", "travel", "olympus-gate", "committed", ["entity-moved"]],
    ["hera", "bless", "pet-1", "stale-target", []],
    ["zeus", "travel", "tavern", "not-adjacent", []],
    ["hera", "legend", "legend", "pending", []],
  ]);
});

test("a committed proposal that caused no event is its own outcome, not silently counted as an action", () => {
  const made = move("zeus", "olympus-gate", 5);
  const [only] = buildDispositions({ proposals: [made.proposal], events: [] });
  expect(only?.outcome).toBe("committed, no event");
  expect(only?.events).toEqual([]);
});

test("a rejection recorded without a reason says only that it was rejected", () => {
  const made = act("zeus", bless("p"), 5, { outcome: "rejected" });
  const [only] = buildDispositions({ proposals: [made.proposal], events: [] });
  expect(only?.outcome).toBe("rejected");
});

test("counts are by action kind and outcome, biggest first, and read as one line", () => {
  const made = [
    ...[1, 2, 3].map((n) =>
      rejected("hera", bless(`p${n}`), "stale-target", n),
    ),
    rejected("hera", bless("p9"), "not-adjacent", 9),
    move("zeus", "a", 10),
    move("zeus", "b", 11),
  ];
  const dispositions = buildDispositions(run(made));

  expect(dispositionCounts(dispositions)).toEqual([
    { kind: "bless", outcome: "stale-target", count: 3 },
    { kind: "travel", outcome: "committed", count: 2 },
    { kind: "bless", outcome: "not-adjacent", count: 1 },
  ]);
  expect(renderDispositionCounts(dispositions)).toBe(
    "bless 3 × stale-target, travel 2 × committed, bless 1 × not-adjacent",
  );
});

test("no proposals reads as none", () => {
  expect(renderDispositionCounts([])).toBe("none");
  expect(buildDispositions(input([]))).toEqual([]);
});

test("a practice move is told apart by its move and what it names, and a no-progress rejection travels as its reason like any other", () => {
  const demand = {
    kind: "practice",
    move: "demand",
    counterparty: "zeus",
    cause: "evt-3",
  };
  const answer = { kind: "practice", move: "accept", thread: "evt-9" };
  const made = [
    rejected("hera", demand, "no-progress", 5),
    rejected("hera", demand, "no-progress", 6),
    act("zeus", answer, 7),
  ];
  const dispositions = buildDispositions(run(made));
  expect(
    dispositions.map((d) => [d.actor, d.kind, d.target, d.outcome]),
  ).toEqual([
    ["hera", "practice", "demand evt-3", "no-progress"],
    ["hera", "practice", "demand evt-3", "no-progress"],
    ["zeus", "practice", "accept evt-9", "committed"],
  ]);
  expect(renderDispositionCounts(dispositions)).toBe(
    "practice 2 × no-progress, practice 1 × committed",
  );
});

test("an offer on a prayer is told apart by the prayer it names, so two offers on two prayers are two choices and a repeat on one is one", () => {
  const offer = (petition: string) => ({
    kind: "practice",
    move: "offer",
    petition,
    term: { kind: "make-offering" },
    stake: "wolf",
  });
  const dispositions = buildDispositions(
    run([
      rejected("zeus", offer("evt-4"), "no-progress", 5),
      act("zeus", offer("evt-6"), 6),
    ]),
  );
  expect(dispositions.map((d) => [d.kind, d.target, d.outcome])).toEqual([
    ["practice", "offer evt-4", "no-progress"],
    ["practice", "offer evt-6", "committed"],
  ]);
});
