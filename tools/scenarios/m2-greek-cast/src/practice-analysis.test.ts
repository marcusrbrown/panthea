import { expect, test } from "bun:test";
import {
  analyzePractices,
  buildThreads,
  classifyTurn,
  consequencesOf,
  obligationRows,
  openThreads,
  parseAll,
} from "./practice-analysis";
import { episode, prompt } from "./practice-test-data";
import type { RealInput } from "./real-analysis";

const analyze = (input: RealInput) => analyzePractices(input);
const property = (input: RealInput, name: string) => {
  const found = analyze(input).properties.find((p) => p.name === name);
  if (!found) throw new Error(`no property ${name}`);
  return found;
};
// biome-ignore lint/suspicious/noExplicitAny: test events are loose records
type Loose = Record<string, any>;
const without = (input: RealInput, drop: (e: Loose) => boolean): RealInput => ({
  ...input,
  events: input.events.filter((e) => !drop(e)),
});

// --- The threads ----------------------------------------------------------------------------

test("each thread is rebuilt from the log: its cause in words, participants, moves, ending, successor link, and recorded changes", () => {
  const { input, ids } = episode();
  const threads = buildThreads(parseAll(input.events));
  expect(threads.map((t) => [t.id, t.practice, t.ending?.outcome])).toEqual([
    [ids.refused, "settlement", "refused"],
    [ids.successor, "settlement", "breached"],
    [ids.kept, "supplication", "fulfilled"],
    [ids.broken, "supplication", "breached"],
  ]);
  const refused = threads[0];
  expect(refused?.cause).toContain('zeus told hera "I burned the agora"');
  expect(refused?.moves.map((m) => [m.actor, m.move])).toEqual([
    ["hera", "demand"],
    ["zeus", "refuse"],
  ]);
  expect(refused?.ending).toMatchObject({ by: "zeus", outcome: "refused" });
  expect(refused?.successor).toBe(ids.successor);
  expect(refused?.changes.map((c) => c.line)).toEqual([
    "hera → zeus: affinity -1",
  ]);

  const successor = threads[1];
  expect(successor?.succeeds).toBe(ids.refused);
  expect(successor?.sworn).toBe(true);
  expect(successor?.moves.map((m) => [m.actor, m.move, m.sworn])).toEqual([
    ["hera", "demand", false],
    ["zeus", "accept", true],
  ]);
  expect(successor?.changes.map((c) => c.line)).toEqual([
    "zeus paid the oath penalty: 3 divinity lost and divine withheld until tick 151",
    "hera → zeus: affinity -2, grudge +1",
  ]);
  expect([...(successor?.rememberedBy ?? [])].sort()).toEqual(["hera", "zeus"]);

  const kept = threads[2];
  expect(kept?.petition).toBeDefined();
  expect(kept?.progress.boon).toBeDefined();
  expect(kept?.ending).toMatchObject({
    reason: "performed",
    outcome: "fulfilled",
  });

  const broken = threads[3];
  expect(broken?.stake).toBe("wolf");
  expect(broken?.changes.map((c) => c.line)[0]).toContain(
    "woodcutter became wolf as punishment (gained beast, lost nothing); identity, memory, and relationships kept",
  );
});

test("threads still open when the log ends are listed with their age and what each waits on", () => {
  const { input, ids } = episode();
  // Drop the breach: the successor is still accepted and its deadline is ahead of the clock.
  const open = without(input, (e) => e.tick === 51);
  const threads = buildThreads(parseAll(open.events));
  const listed = openThreads(threads, 49);
  const successor = listed.find((o) => o.thread.id === ids.successor);
  expect(successor).toMatchObject({ ageTicks: 29, endsBy: 50 });
  expect(successor?.waitsOn).toBe(
    "zeus to perform: zeus tells a legend to the mortals at altar by tick 50",
  );
  // A thread awaiting an answer names who must answer and what.
  const fresh = without(input, (e) => e.tick > 20);
  const awaiting = openThreads(buildThreads(parseAll(fresh.events)), 25).find(
    (o) => o.thread.id === ids.successor,
  );
  expect(awaiting?.waitsOn).toBe(
    "zeus to answer hera's demand: zeus tells a legend to the mortals at altar by tick 50",
  );
  expect(awaiting?.endsBy).toBe(80);
  // A supplication names the half still owed.
  const half = without(
    input,
    (e) => e.tick >= 68 && e.id !== undefined && e.tick < 100,
  );
  const owing = openThreads(buildThreads(parseAll(half.events)), 90).find(
    (o) => o.thread.id === ids.kept,
  );
  expect(owing?.waitsOn).toContain("farmer's offering");
});

test("every move judged no progress is listed with the god, what it tried, the thread, and the world's reason", () => {
  const { input, ids } = episode();
  const { noProgress } = analyze(input);
  expect(noProgress).toEqual([
    {
      tick: 14,
      actor: "hera",
      kind: "practice",
      attempted: "demand",
      thread: ids.refused,
      why: "that was already answered: zeus refused it",
      observationId: ids.npObservation,
      recorded: true,
    },
  ]);
});

// --- Obligated turns (R12) --------------------------------------------------------------------

test("the digest's obligation rows are read from a prompt, with the obstacle when it names one", () => {
  const text = prompt("zeus", 30, {
    owes: {
      thread: "evt-20-5",
      other: "hera",
      words: "you must be at altar",
      deadline: 50,
      unperformable: "zeus has no route to do this",
    },
  });
  expect(obligationRows(text)).toEqual([
    {
      thread: "evt-20-5",
      other: "hera",
      deadline: 50,
      unperformable: "zeus has no route to do this",
      boon: false,
      petition: undefined,
      next: undefined,
    },
  ]);
  expect(obligationRows(prompt("zeus", 30))).toEqual([]);
});

test("every turn an obligated god takes while its obligation is open is classified from its prompt and its proposal, and the classes are the four R12 names", () => {
  const { input, ids } = episode();
  const { obligated } = analyze(input);
  expect(obligated.unrecorded).toEqual([]);
  expect(
    obligated.turns.map((t) => [t.god, t.thread, t.tick, t.class, t.named]),
  ).toEqual([
    ["zeus", ids.successor, 22, "performed", undefined],
    [
      "zeus",
      ids.successor,
      30,
      "waited for a named event",
      "a mortal to arrive at altar",
    ],
    ["zeus", ids.successor, 40, "knowingly risked breach", undefined],
  ]);
  expect(obligated.turns[0]?.choice).toBe("travel");
  expect(obligated.turns[2]?.choice).toBe("report");
});

test("each class follows its rule: performing is the action the term calls for; a named obstacle or a missing audience is a justified wait; anything else, including an attempt to bargain over an accepted thread, risks breach", () => {
  const { input, ids } = episode();
  const thread = buildThreads(parseAll(input.events)).find(
    (t) => t.id === ids.successor,
  );
  const row: {
    thread: string;
    other: string;
    deadline: number;
    unperformable: string | undefined;
    boon: boolean;
    petition: string | undefined;
    next: Readonly<Record<string, unknown>> | undefined;
  } = {
    thread: ids.successor,
    other: "hera",
    deadline: 50,
    unperformable: undefined,
    boon: false,
    petition: undefined,
    next: undefined,
  };
  const proposal = (
    kind: string,
    fields: Record<string, unknown>,
    outcome: "committed" | "rejected" = "committed",
    reason?: string,
  ) => ({
    proposalId: "p",
    actor: "zeus",
    kind,
    observationId: "o",
    proposal: { actor: "zeus", kind, ...fields },
    outcome,
    ...(reason === undefined ? {} : { reason }),
  });
  const text = prompt("zeus", 30, { at: "altar", here: ["farmer"] });
  const cls = (p: ReturnType<typeof proposal> | undefined, r = row) =>
    classifyTurn(thread, r, text, p, false).class;
  // An acceptance binds (R12, 2026-10-03): a counter or a withdrawal of an accepted thread, or a fresh demand of the other god, is not performing it, and not a justified wait either.
  expect(
    cls(
      proposal(
        "practice",
        { move: "counter", thread: ids.successor },
        "rejected",
        "malformed",
      ),
    ),
  ).toBe("knowingly risked breach");
  expect(
    cls(proposal("practice", { move: "withdraw", thread: ids.successor })),
  ).toBe("knowingly risked breach");
  expect(
    cls(proposal("practice", { move: "demand", counterparty: "hera" })),
  ).toBe("knowingly risked breach");
  // No turn is ever classified as renegotiated.
  for (const p of [
    proposal("practice", { move: "counter", thread: ids.successor }),
    proposal("practice", { move: "demand", counterparty: "hera" }),
    undefined,
  ]) {
    expect(cls(p) as string).not.toBe("renegotiated");
  }
  // A practice move on another thread is no different.
  expect(cls(proposal("practice", { move: "refuse", thread: "evt-9-9" }))).toBe(
    "knowingly risked breach",
  );
  // Performed: the legend itself; going toward the place; and not for a refused attempt.
  expect(cls(proposal("legend", { assertion: "x" }))).toBe("performed");
  expect(cls(proposal("travel", { to: "altar" }))).toBe("performed");
  expect(
    cls(proposal("legend", { assertion: "x" }, "rejected", "malformed")),
  ).toBe("knowingly risked breach");
  // Waited: a digest that names an obstacle.
  expect(cls(undefined, { ...row, unperformable: "no route" })).toBe(
    "waited for a named event",
  );
  expect(
    classifyTurn(
      thread,
      { ...row, unperformable: "no route" },
      text,
      undefined,
      false,
    ).named,
  ).toContain("no route");
  // With a mortal at the place a bare wait is not justified.
  expect(cls(undefined)).toBe("knowingly risked breach");
  // Without one it is: the named event is a mortal arriving.
  const alone = prompt("zeus", 30, { at: "altar", here: [] });
  expect(classifyTurn(thread, row, alone, undefined, false)).toMatchObject({
    class: "waited for a named event",
    named: "a mortal to arrive at altar",
  });
  // A god elsewhere than the place gets no such excuse.
  const elsewhere = prompt("zeus", 30, { at: "town-square", here: [] });
  expect(classifyTurn(thread, row, elsewhere, undefined, true).class).toBe(
    "knowingly risked breach",
  );
  // A term to stay away from a place is kept by every turn that does not go there.
  const stay = {
    ...(thread as NonNullable<typeof thread>),
    term: {
      kind: "stay-away",
      party: "zeus",
      place: "tavern",
      deadline: 50,
    } as never,
  };
  expect(classifyTurn(stay, row, text, undefined, false).class).toBe(
    "performed",
  );
  expect(
    classifyTurn(stay, row, text, proposal("travel", { to: "tavern" }), false)
      .class,
  ).toBe("knowingly risked breach");
});

// --- The properties, each with its positive control ---------------------------------------------

test("god thread endings: each god causes an ending that leaves a persistent consequence; with the consequences removed, the god it fell short for fails", () => {
  const { input } = episode();
  expect(property(input, "god thread endings")).toMatchObject({ ok: true });
  // Control: the oath penalty and every feeling the endings moved are gone: nothing persists.
  const bare = without(
    input,
    (e) => e.kind === "motif-applied" || e.kind === "relationship-changed",
  );
  const failed = property(bare, "god thread endings");
  expect(failed.ok).toBe(false);
  expect(failed.detail).toContain(
    "zeus: no thread ending it caused left a persistent consequence",
  );
  // Control: no thread at all.
  expect(
    property(
      without(input, (e) => String(e.kind).startsWith("practice-")),
      "god thread endings",
    ).ok,
  ).toBe(false);
});

test("supplication and settlement: the run has both, and one refused or breached; without a supplication, or with only fulfilments, it fails", () => {
  const { input, ids } = episode();
  expect(property(input, "supplication and settlement").ok).toBe(true);
  const noSupplication = without(input, (e) =>
    JSON.stringify(e).includes('"supplication"'),
  );
  expect(property(noSupplication, "supplication and settlement").ok).toBe(
    false,
  );
  const noSettlement = without(
    input,
    (e) => e.id === ids.refused || e.id === ids.successor,
  );
  expect(property(noSettlement, "supplication and settlement").ok).toBe(false);
  // Only fulfilments: the breaches and the refusal are made fulfilments.
  const gentle: RealInput = {
    ...input,
    events: input.events.map((e) =>
      e.kind === "practice-ended"
        ? { ...e, outcome: "fulfilled", reason: "performed" }
        : e.kind === "practice-moved" && e.move === "refuse"
          ? { ...e, move: "accept", sworn: false }
          : e,
    ),
  };
  expect(property(gentle, "supplication and settlement").detail).toContain(
    "0 refused or breached",
  );
  expect(property(gentle, "supplication and settlement").ok).toBe(false);
});

test("thread endings recorded: every thread ended with someone remembering, or is open inside its deadline; a thread whose ending is missing fails", () => {
  const { input, ids } = episode();
  expect(property(input, "thread endings recorded").ok).toBe(true);
  // Control: the successor's ending is missing, and the log runs on past its deadline.
  const missing = without(
    input,
    (e) => e.kind === "practice-ended" && e.threadId === ids.successor,
  );
  const failed = property(missing, "thread endings recorded");
  expect(failed.ok).toBe(false);
  expect(failed.detail).toContain(`${ids.successor} is still accepted at tick`);
  expect(failed.detail).toContain("with no ending recorded");
  // Control: an ending nobody remembers.
  const forgotten = without(
    input,
    (e) =>
      e.kind === "memory-recorded" &&
      e.memoryKind === "witnessed" &&
      e.sourceEventId ===
        input.events.find(
          (x) => x.kind === "practice-ended" && x.threadId === ids.broken,
        )?.id,
  );
  expect(property(forgotten, "thread endings recorded").detail).toContain(
    "no party remembers how",
  );
  // A thread open and inside its deadline passes.
  const early = without(input, (e) => e.tick > 30);
  expect(property(early, "thread endings recorded").ok).toBe(true);
});

test("no reopening without a new cause: a successor on a newer cause is fine; a thread reopened on a consumed cause, an old one, unlinked, or while open, fails", () => {
  const { input, ids } = episode();
  expect(property(input, "no reopening without a new cause").ok).toBe(true);
  const reopen = (change: (e: Loose) => Loose): RealInput => ({
    ...input,
    events: input.events.map((e) =>
      e.id === ids.successor ? (change(e) as RealInput["events"][number]) : e,
    ),
  });
  // Control: the successor cites the cause the refused thread consumed.
  const refusedCause = (
    input.events.find((e) => e.id === ids.refused) as unknown as {
      causes: string[];
    }
  ).causes;
  const consumed = property(
    reopen((e) => ({ ...e, causes: refusedCause })),
    "no reopening without a new cause",
  );
  expect(consumed.ok).toBe(false);
  expect(consumed.detail).toContain("already consumed");
  // Control: it does not link its predecessor.
  const unlinked = property(
    reopen(({ succeeds: _s, ...e }) => e),
    "no reopening without a new cause",
  );
  expect(unlinked.ok).toBe(false);
  expect(unlinked.detail).toContain("without linking");
  // Control: the cause was learned before the closed thread opened.
  const early = property(
    {
      ...input,
      events: input.events.map((e) =>
        e.kind === "memory-recorded" &&
        e.memoryKind === "told" &&
        e.content === "I helped them"
          ? { ...e, sequence: 2 }
          : e,
      ),
    },
    "no reopening without a new cause",
  );
  expect(early.ok).toBe(false);
  expect(early.detail).toContain("had learned before");
  // Control: it opened while the first was still open.
  const stillOpen = property(
    {
      ...input,
      events: input.events.filter(
        (e) => !(e.kind === "practice-moved" && e.move === "refuse"),
      ),
    },
    "no reopening without a new cause",
  );
  expect(stillOpen.ok).toBe(false);
  expect(stillOpen.detail).toContain("while");
});

test("no-progress moves advance nothing: each leaves a refusal record; one that advanced a thread, or left no record, or a counter that restated an offer, fails", () => {
  const { input, ids } = episode();
  expect(property(input, "no-progress moves advance nothing").ok).toBe(true);
  // Control: a thread moved on the very observation the world rejected.
  const advanced: RealInput = {
    ...input,
    events: [
      ...input.events,
      {
        schemaVersion: 1,
        id: "evt-15-999",
        sequence: 999,
        simTime: 0,
        tick: 15,
        correlationId: ids.npObservation,
        causationId: ids.npObservation,
        approximate: false,
        kind: "practice-moved",
        entityId: "zeus",
        threadId: ids.refused,
        move: "accept",
        sworn: false,
      },
    ] as RealInput["events"],
  };
  const failed = property(advanced, "no-progress moves advance nothing");
  expect(failed.ok).toBe(false);
  expect(failed.detail).toContain(
    "was rejected as no-progress and yet practice-moved",
  );
  // Control: no record of the refusal.
  const unrecorded = property(
    without(input, (e) => e.kind === "practice-refused"),
    "no-progress moves advance nothing",
  );
  expect(unrecorded.ok).toBe(false);
  expect(unrecorded.detail).toContain("no refusal was recorded");
  // Control: a counter restating the demand committed.
  const restated: RealInput = {
    ...input,
    events: [
      ...input.events,
      {
        schemaVersion: 1,
        id: "evt-16-998",
        sequence: 998,
        simTime: 0,
        tick: 10,
        correlationId: "x",
        causationId: "x",
        approximate: false,
        kind: "practice-moved",
        entityId: "zeus",
        threadId: ids.refused,
        move: "counter",
        term: {
          kind: "be-at",
          party: "zeus",
          place: "town-square",
          deadline: 40,
        },
      },
    ] as RealInput["events"],
  };
  expect(
    property(restated, "no-progress moves advance nothing").detail,
  ).toContain("restated an offer already made");
});

test("a consequence changes a later choice: the god's next action differs and its prompt showed how the thread ended; with the ending hidden from the prompt, or the choice unchanged, it fails", () => {
  const { input, ids } = episode();
  expect(property(input, "consequence changes a later choice")).toMatchObject({
    ok: true,
  });
  expect(
    consequencesOf(
      buildThreads(parseAll(input.events)),
      parseAll(input.events),
    ).map((c) => c.god),
  ).toContain("hera");
  // Control: the prompts no longer show either ending.
  const hidden: RealInput = {
    ...input,
    requests: input.requests.map((r) => ({
      ...r,
      promptPayload: r.promptPayload
        ?.replaceAll(`[${ids.refusedEnding}]`, "")
        .replaceAll(`[${ids.breachEnding}]`, ""),
    })),
  };
  const failed = property(hidden, "consequence changes a later choice");
  expect(failed.ok).toBe(false);
  expect(failed.detail).toContain("did not show how the thread ended");
  // Control: every god keeps doing the one same thing before and after the consequence.
  const samey: RealInput = {
    ...input,
    proposals: input.proposals.map((p) => ({
      ...p,
      kind: "travel",
      proposal: { actor: p.actor, kind: "travel", to: "altar" },
    })),
  };
  expect(
    property(samey, "consequence changes a later choice").detail,
  ).toContain("(same)");
  expect(property(samey, "consequence changes a later choice").ok).toBe(false);
});

test("obligated turns recorded: each turn has its classification; a turn whose proposal is missing from the journal, or whose prompt did not lead with the obligation the world held open, fails", () => {
  const { input } = episode();
  expect(property(input, "obligated turns recorded")).toMatchObject({
    ok: true,
  });
  expect(property(input, "obligated turns recorded").detail).toContain(
    "1 performed, 1 waited for a named event, 1 knowingly risked breach",
  );
  // Control: the journal row behind one obligated turn is gone.
  const lost: RealInput = {
    ...input,
    proposals: input.proposals.filter(
      (p) => !(p.actor === "zeus" && p.kind === "travel"),
    ),
  };
  const failed = property(lost, "obligated turns recorded");
  expect(failed.ok).toBe(false);
  expect(failed.detail).toContain("is not in the journal");
  // Control: one prompt did not lead with the obligation.
  const buried: RealInput = {
    ...input,
    requests: input.requests.map((r) =>
      r.promptPayload?.includes("YOU OWE") &&
      r.promptPayload.includes("tick 40.")
        ? {
            ...r,
            promptPayload: r.promptPayload.replace("YOU OWE", "YOU ONCE OWED"),
          }
        : r,
    ),
  };
  const missing = property(buried, "obligated turns recorded");
  expect(missing.ok).toBe(false);
  expect(missing.detail).toContain(
    "did not lead with the obligation the world held open",
  );
  // No obligation at all is no obligated turn.
  const none = property(
    {
      ...input,
      events: input.events.filter(
        (e) =>
          !(
            e.kind === "practice-moved" &&
            e.move === "accept" &&
            e.sworn === true
          ),
      ),
    },
    "obligated turns recorded",
  );
  expect(none.ok).toBe(true);
});

// --- A god that owes a boon (R12) ----------------------------------------------------------------

/** The digest a god sees while it owes a boon: who, which prayer, by when, and the next step. */
const owedBoonPrompt = (
  god: string,
  tick: number,
  thread: string,
  mortal: string,
  petition: string,
  deadline: number,
  extra: string[] = [],
  here: string[] = [],
) =>
  `You are ${god}.\n${[
    "Your open practices:",
    `- [${thread}] YOU OWE ${mortal}: your boon on its prayer [${petition}], by tick ${deadline} (${deadline - tick} ticks left). ${mortal} agreed at tick 73; its offering is still to come. Cause: unmet-need (${mortal}).`,
    `  ${mortal} is not here (they are at The Altar [altar]): your next step is {"action":"travel","to":"altar"} (The Altar), turn by turn until you are with them, then bless them naming the prayer.`,
    ...extra,
    "  If the deadline passes without it, the world records the bargain as expired with your boon unanswered.",
    `You are at great-hall [great-hall] in the mortal realm, tick ${tick}.`,
    "Here with you:",
    ...(here.length === 0 ? ["- no one else"] : here.map((who) => `- ${who}`)),
    "Buildings here:",
    "- none",
    "What do you do?",
  ].join("\n")}`;

/** The digest while an owed boon's row shows `step` (or nothing, with a reason), the way the world's rows say it. */
const owedStepPrompt = (
  tick: number,
  thread: string,
  petition: string,
  step: Record<string, unknown> | string,
) =>
  `You are zeus.\n${[
    "Your open practices:",
    `- [${thread}] YOU OWE woodcutter: your boon on its prayer [${petition}], by tick 100 (${100 - tick} ticks left). woodcutter agreed at tick 73; its offering is still to come. Cause: unmet-need (woodcutter).`,
    typeof step === "string"
      ? `  You cannot give it now: ${step}.`
      : `  Your next step is ${JSON.stringify(step)}.`,
    "  If the deadline passes without it, the world records the bargain as expired with your boon unanswered.",
    `You are at great-hall [great-hall] in the mortal realm, tick ${tick}.`,
    "What do you do?",
  ].join("\n")}`;

function withOwedTurns(
  turns: {
    tick: number;
    prompt?: string;
    proposal?: {
      kind: string;
      fields: Record<string, unknown>;
      outcome?: "committed" | "rejected";
      reason?: string;
    };
  }[],
) {
  const { input, ids } = episode();
  const thread = buildThreads(parseAll(input.events)).find(
    (t) => t.id === ids.broken,
  );
  if (thread?.petition === undefined) throw new Error("no supplication");
  const requests = [...input.requests];
  const proposals = [...input.proposals];
  turns.forEach((turn, n) => {
    const proposalId = turn.proposal === undefined ? undefined : `owed-p${n}`;
    requests.push({
      proposalId,
      role: "zeus",
      outcome: "intent",
      elapsedMs: 1000,
      // "$THREAD" and "$PETITION" in a prompt stand for the supplication's own ids.
      promptPayload: (
        turn.prompt ??
        owedBoonPrompt(
          "zeus",
          turn.tick,
          ids.broken,
          "woodcutter",
          thread.petition as string,
          100,
        )
      )
        .replaceAll("$THREAD", ids.broken)
        .replaceAll("$PETITION", thread.petition as string),
      steps: [{ mode: "native" }],
    });
    if (turn.proposal !== undefined && proposalId !== undefined) {
      proposals.push({
        proposalId,
        actor: "zeus",
        kind: turn.proposal.kind,
        observationId: `owed-o${n}`,
        proposal: {
          actor: "zeus",
          kind: turn.proposal.kind,
          // "$PETITION" stands for the prayer the thread's boon answers.
          ...Object.fromEntries(
            Object.entries(turn.proposal.fields).map(([key, value]) => [
              key,
              value === "$PETITION" ? thread.petition : value,
            ]),
          ),
        },
        outcome: turn.proposal.outcome ?? "committed",
        ...(turn.proposal.reason === undefined
          ? {}
          : { reason: turn.proposal.reason }),
      });
    }
  });
  return {
    input: { ...input, requests, proposals } as RealInput,
    ids,
    petition: thread.petition,
  };
}

test("the digest's owed-boon row is read as an obligation row: who is owed, and by when", () => {
  const rows = obligationRows(
    owedBoonPrompt("zeus", 74, "evt-72-1", "woodcutter", "evt-71-1", 100),
  );
  expect(rows).toEqual([
    {
      thread: "evt-72-1",
      other: "woodcutter",
      deadline: 100,
      unperformable: undefined,
      boon: true,
      petition: "evt-71-1",
      next: { action: "travel", to: "altar" },
    },
  ]);
  const blocked = obligationRows(
    owedBoonPrompt("zeus", 74, "evt-72-1", "woodcutter", "evt-71-1", 100, [
      "  You cannot give it now: a bless costs 1 divinity and you hold less.",
    ]),
  );
  expect(blocked[0]?.unperformable).toBe(
    "a bless costs 1 divinity and you hold less",
  );
  // A settlement's row is not a boon.
  expect(
    obligationRows(
      prompt("zeus", 22, {
        owes: {
          thread: "evt-20-5",
          other: "hera",
          words: "you must be at altar",
          deadline: 50,
        },
      }),
    )[0]?.boon,
  ).toBe(false);
});

test("a turn a god takes while it owes a boon is classified: performed when it blessed or moved toward the mortal, waited when its digest names what stops it, and knowingly risked breach otherwise", () => {
  const { input } = withOwedTurns([
    { tick: 74, proposal: { kind: "travel", fields: { to: "altar" } } },
    {
      tick: 75,
      prompt: owedStepPrompt(75, "$THREAD", "$PETITION", {
        action: "bless",
        petition: "$PETITION",
      }),
      proposal: { kind: "bless", fields: { petition: "$PETITION" } },
    },
    {
      tick: 75,
      proposal: { kind: "legend", fields: { assertion: "I am Zeus." } },
    },
    {
      tick: 75,
      proposal: {
        kind: "travel",
        fields: { to: "altar" },
        outcome: "rejected",
        reason: "unreachable",
      },
    },
    { tick: 75 },
    {
      tick: 75,
      prompt: owedBoonPrompt(
        "zeus",
        75,
        "evt-72-1",
        "woodcutter",
        "evt-71-1",
        100,
        [
          "  You cannot give it now: a bless costs 1 divinity and you hold less.",
        ],
      ),
    },
  ]);
  const owed = analyze(input).obligated.turns.filter(
    (t) => t.tick !== undefined && t.tick >= 74,
  );
  expect(owed.map((t) => t.class)).toEqual([
    "performed",
    "performed",
    "knowingly risked breach",
    "knowingly risked breach",
    "knowingly risked breach",
    "waited for a named event",
  ]);
  expect(owed[5]?.named).toContain("a bless costs 1 divinity");
});

test("a compacted owed row is read like a whole one: its step or its obstacle is on its own line, and a move along that step is performed", () => {
  const step = obligationRows(
    'Your open practices:\n- [evt-72-1] YOU OWE woodcutter: your boon on its prayer [evt-71-1], by tick 100. Step: {"action":"travel","to":"altar"}\nYou are at great-hall [great-hall] in the mortal realm, tick 80.',
  );
  expect(step).toEqual([
    {
      thread: "evt-72-1",
      other: "woodcutter",
      deadline: 100,
      unperformable: undefined,
      boon: true,
      petition: "evt-71-1",
      next: { action: "travel", to: "altar" },
    },
  ]);
  const stuck = obligationRows(
    "Your open practices:\n- [evt-72-1] YOU OWE woodcutter: your boon on its prayer [evt-71-1], by tick 100. Cannot now: its prayer is no longer open to an answer.\nYou are at great-hall [great-hall] in the mortal realm, tick 80.",
  );
  expect(stuck[0]).toMatchObject({
    boon: true,
    next: undefined,
    unperformable: "its prayer is no longer open to an answer",
  });
  const proposal = (to: string) => ({
    proposalId: "p",
    actor: "zeus",
    kind: "travel",
    observationId: "o",
    proposal: { actor: "zeus", kind: "travel", to },
    outcome: "committed" as const,
  });
  expect(
    classifyTurn(undefined, step[0] as never, "", proposal("altar"), false)
      .class,
  ).toBe("performed");
  expect(
    classifyTurn(undefined, step[0] as never, "", proposal("tavern"), false)
      .class,
  ).toBe("knowingly risked breach");
  expect(
    classifyTurn(undefined, stuck[0] as never, "", proposal("altar"), false)
      .class,
  ).toBe("waited for a named event");
});

test("a turn counts as performing the owed boon only when it is the step the row showed: a bless on a different prayer, a move to a different exit, and an unrelated strike are not performed", () => {
  const classes = (
    turns: Parameters<typeof withOwedTurns>[0],
  ): (string | undefined)[] => {
    const { input } = withOwedTurns(turns);
    return analyze(input)
      .obligated.turns.filter((t) => t.tick !== undefined && t.tick >= 74)
      .map((t) => t.class);
  };
  expect(
    classes([
      // The way the row showed: the exit to altar.
      { tick: 74, proposal: { kind: "travel", fields: { to: "altar" } } },
      // A different exit.
      { tick: 75, proposal: { kind: "travel", fields: { to: "tavern" } } },
      {
        tick: 76,
        proposal: { kind: "travel", fields: { to: "olympus-gate" } },
      },
      // A bless naming the owed prayer, when the row showed a hop and no bless, is not the step the row gave.
      {
        tick: 77,
        proposal: { kind: "bless", fields: { petition: "$PETITION" } },
      },
      {
        tick: 78,
        proposal: { kind: "bless", fields: { petition: "evt-9-203" } },
      },
      // A strike, which the row never asked for.
      {
        tick: 79,
        proposal: { kind: "strike", fields: { target: "woodshed", power: 1 } },
      },
    ]),
  ).toEqual([
    "performed",
    "knowingly risked breach",
    "knowingly risked breach",
    "knowingly risked breach",
    "knowingly risked breach",
    "knowingly risked breach",
  ]);
  // When the row showed the bless, the bless naming the owed prayer is the step, and a bless on another is not.
  const blessRow = (tick: number) =>
    owedStepPrompt(tick, "$THREAD", "$PETITION", {
      action: "bless",
      petition: "$PETITION",
    });
  const blessRun = withOwedTurns([
    {
      tick: 80,
      prompt: blessRow(80),
      proposal: { kind: "bless", fields: { petition: "$PETITION" } },
    },
    {
      tick: 81,
      prompt: blessRow(81),
      proposal: { kind: "bless", fields: { petition: "evt-9-203" } },
    },
  ]);
  const shown = analyze(blessRun.input).obligated.turns.filter(
    (t) => t.tick !== undefined && t.tick >= 80,
  );
  expect(shown.map((t) => t.class)).toEqual([
    "performed",
    "knowingly risked breach",
  ]);
  // A refused step performs nothing, even the right one.
  expect(
    classes([
      {
        tick: 74,
        proposal: {
          kind: "travel",
          fields: { to: "altar" },
          outcome: "rejected",
          reason: "not-adjacent",
        },
      },
    ]),
  ).toEqual(["knowingly risked breach"]);
  // A digest that names what stops the god still reads as a wait, whatever it chose.
  const blocked = withOwedTurns([
    {
      tick: 74,
      prompt: owedBoonPrompt(
        "zeus",
        74,
        "evt-72-1",
        "woodcutter",
        "evt-71-1",
        100,
        [
          "  You cannot give it now: a bless costs 1 divinity and you hold less.",
        ],
      ),
      proposal: { kind: "bless", fields: { petition: "evt-9-203" } },
    },
  ]);
  expect(
    analyze(blocked.input).obligated.turns.find((t) => t.tick === 74)?.class,
  ).toBe("waited for a named event");
});

test("a strike performs an owed punish boon only when the row showed that strike, on the target it showed: a building the prayer names but the row did not show, and a row that showed no step, perform nothing", () => {
  const rowWith = (next: Record<string, unknown> | undefined) => ({
    thread: "evt-72-1",
    other: "farmer",
    deadline: 100,
    unperformable:
      next === undefined
        ? "none of the buildings it names can be struck now"
        : undefined,
    boon: true,
    petition: "evt-71-1",
    next,
  });
  const struck = (
    target: string,
    outcome: "committed" | "rejected" = "committed",
  ) => ({
    proposalId: "p",
    actor: "zeus",
    kind: "strike",
    observationId: "o",
    proposal: { actor: "zeus", kind: "strike", target, power: 1 },
    outcome,
  });
  const shown = rowWith({ action: "strike", target: "woodshed", power: 1 });
  const cls = (
    row: ReturnType<typeof rowWith>,
    target: string,
    outcome?: "committed" | "rejected",
  ) => classifyTurn(undefined, row, "", struck(target, outcome), false).class;
  expect(cls(shown, "woodshed")).toBe("performed");
  expect(cls(shown, "old-oak")).toBe("knowingly risked breach");
  expect(cls(shown, "woodshed", "rejected")).toBe("knowingly risked breach");
  // The row showed no step, only an obstacle: no strike counts, whatever it hit; the digest's own wait rule applies.
  expect(cls(rowWith(undefined), "woodshed")).toBe("waited for a named event");
  // A row that showed a hop is not satisfied by a strike, nor one that showed a strike by a bless.
  expect(
    cls(rowWith({ action: "travel", to: "town-square" }), "woodshed"),
  ).toBe("knowingly risked breach");
});

test("the gate applies the prompt's own deadline rule: the owed row is expected through the deadline tick and not after, so a correct prompt at deadline+1 is not flagged", () => {
  const { input, ids } = episode();
  // The boon was never seen and the thread never ended: only the deadline decides whether a row is owed.
  const unseen: RealInput = {
    ...input,
    events: input.events.filter(
      (e) =>
        !(
          (e.kind === "practice-progressed" && e.threadId === ids.broken) ||
          (e.kind === "practice-ended" && e.threadId === ids.broken)
        ),
    ),
  };
  const silent = (tick: number) =>
    `You are zeus.\nYou are at great-hall [great-hall] in the mortal realm, tick ${tick}.\nWhat do you do?`;
  const at = (tick: number) => withOwedTurns([{ tick, prompt: silent(tick) }]);
  const onlyAt = (tick: number): RealInput => {
    const run = at(tick).input;
    return {
      ...run,
      events: unseen.events,
    };
  };
  // On the deadline tick the prompt still owes the row, so a silent prompt fails.
  const onDeadline = property(onlyAt(100), "obligated turns recorded");
  expect(onDeadline.ok).toBe(false);
  expect(onDeadline.detail).toContain(ids.broken);
  // One tick later the prompt shows none, and the gate expects none.
  const after = property(onlyAt(101), "obligated turns recorded");
  expect(after.detail).not.toContain(ids.broken);
  expect(after.ok).toBe(true);
});

test("the properties join the real run's analysis, and the existing ones are still there", async () => {
  const { analyzeReal } = await import("./real-analysis");
  const { input } = episode();
  const names = analyzeReal(input).properties.map((p) => p.name);
  for (const name of [
    "valid actions",
    "perception compliance",
    "relationship change with provenance",
    "changed next action",
    "goal privacy",
    "petition privacy",
    "god thread endings",
    "supplication and settlement",
    "thread endings recorded",
    "no reopening without a new cause",
    "no-progress moves advance nothing",
    "consequence changes a later choice",
    "obligated turns recorded",
    "contest endings",
  ]) {
    expect(names).toContain(name);
  }
});

// --- Contests: each ends with a standing change, or expires ----------------------------------------

test("contest endings hold on the coherent episode: its contest was decided for Athena and both gods' standing moved, citing the closing", () => {
  const { input } = episode();
  const found = property(input, "contest endings");
  expect(found.ok).toBe(true);
  expect(found.detail).toContain("1 contest");
  expect(found.detail).toContain("1 decided");
});

test("a run with no contest holds the property vacuously: nothing was asked of it", () => {
  const { input } = episode();
  const none = without(
    input,
    (e) =>
      ["contest-opened", "contest-closed"].includes(e.kind) ||
      (e.kind === "motif-applied" && e.effect === "standing"),
  );
  const found = property(none, "contest endings");
  expect(found.ok).toBe(true);
  expect(found.detail).toContain("no contest");
});

test("a decided contest that left no standing change fails, and so does one that changed only one god's", () => {
  const { input } = episode();
  const bare = without(
    input,
    (e) => e.kind === "motif-applied" && e.effect === "standing",
  );
  const none = property(bare, "contest endings");
  expect(none.ok).toBe(false);
  expect(none.detail).toContain("no standing change");
  const half = without(
    input,
    (e) => e.kind === "motif-applied" && e.effect === "standing" && e.delta < 0,
  );
  expect(property(half, "contest endings").ok).toBe(false);
  // Standing that moves the wrong way is no decision either.
  const wrong: RealInput = {
    ...input,
    events: input.events.map((e: Loose) =>
      e.kind === "motif-applied" && e.effect === "standing"
        ? { ...e, delta: -e.delta }
        : e,
    ) as never,
  };
  expect(property(wrong, "contest endings").ok).toBe(false);
});

test("an expired contest that nonetheless changed standing fails: an expiry changes no one's standing", () => {
  const { input } = episode();
  const expired: RealInput = {
    ...input,
    events: input.events.map((e: Loose) =>
      e.kind === "contest-closed"
        ? {
            ...e,
            result: "expired",
            reason: "no-favour",
            winner: undefined,
            favoured: [],
          }
        : e,
    ) as never,
  };
  const found = property(expired, "contest endings");
  expect(found.ok).toBe(false);
  expect(found.detail).toContain("expired");
  // Without the standing change it holds.
  const clean = without(
    expired,
    (e) => e.kind === "motif-applied" && e.effect === "standing",
  );
  const ok = property(clean, "contest endings");
  expect(ok.ok).toBe(true);
  expect(ok.detail).toContain("1 expired");
});

test("a contest still open past its window with no ending fails; one still inside its window does not", () => {
  const { input } = episode();
  const unfinished = without(
    input,
    (e) =>
      e.kind === "contest-closed" ||
      (e.kind === "motif-applied" && e.effect === "standing"),
  );
  // The world went on to tick 150, ten past the window, and the contest never closed.
  const later: RealInput = {
    ...unfinished,
    events: [
      ...unfinished.events,
      {
        schemaVersion: 1,
        id: "evt-150-9999",
        sequence: 9999,
        simTime: 0,
        tick: 150,
        correlationId: "fixture",
        causationId: "fixture",
        approximate: false,
        kind: "legend-recorded",
        entityId: "poseidon",
        assertion: "Still the sea.",
        hearers: [],
      } as never,
    ],
  };
  const found = property(later, "contest endings");
  expect(found.ok).toBe(false);
  expect(found.detail).toContain("no ending");
  // The same log cut inside the window (the world's last tick is 130, the window closes at 140) is fine.
  const early: RealInput = {
    ...input,
    events: unfinished.events.filter((e: Loose) => (e.tick as number) <= 130),
  };
  const inside = property(early, "contest endings");
  expect(inside.ok).toBe(true);
  expect(inside.detail).toContain("1 open");
});

// --- The controls the scripted story runs ------------------------------------------------------

test("each practice control breaks exactly the property it is for: on the coherent episode every property holds, and with the control applied the targeted one fails", async () => {
  const { CONTROLLED_PROPERTY, PRACTICE_CONTROLS, sabotage } = await import(
    "./practice-controls"
  );
  const { input } = episode();
  expect(analyze(input).properties.every((p) => p.ok)).toBe(true);
  for (const control of PRACTICE_CONTROLS) {
    const broken = analyze(sabotage(control, input)).properties;
    const target = broken.find((p) => p.name === CONTROLLED_PROPERTY[control]);
    expect([control, target?.ok]).toEqual([control, false]);
  }
});
