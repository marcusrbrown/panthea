// The positive controls for the practice properties: each takes the run's data
// and breaks one thing a property must catch, the way a bug would. The scripted
// story runs its properties over the data it collected; with a control named,
// they run over the sabotaged data and the run must fail. Pure functions, so
// each has a unit test that the property it targets fails on it.

import { analyzePractices } from "./practice-analysis";
import type { RealInput } from "./real-analysis";

export const PRACTICE_CONTROLS = [
  "thread-reopened",
  "no-progress-advances",
  "thread-no-ending",
  "obligated-turn-unrecorded",
  "ending-no-consequence",
  "practices-missing",
  "consequence-no-effect",
  "contest-no-standing",
  "alliance-unsealed",
  "god-silent",
  "practice-absent",
] as const;
export type PracticeControl = (typeof PRACTICE_CONTROLS)[number];

/** The property each control is meant to trip. */
export const CONTROLLED_PROPERTY: Readonly<Record<PracticeControl, string>> = {
  "thread-reopened": "no reopening without a new cause",
  "no-progress-advances": "no-progress moves advance nothing",
  "thread-no-ending": "thread endings recorded",
  "obligated-turn-unrecorded": "obligated turns recorded",
  "ending-no-consequence": "god thread endings",
  "practices-missing": "supplication and settlement",
  "consequence-no-effect": "consequence changes a later choice",
  "contest-no-standing": "contest endings",
  "alliance-unsealed": "alliances sealed by agreement",
  "god-silent": "every god practiced",
  "practice-absent": "every practice appeared",
};

export const SABOTAGE: Readonly<Record<PracticeControl, string>> = {
  "thread-reopened":
    "The harness rewrites the linked successor's opening so it cites the cause its predecessor consumed, as if the world had reopened a closed thread on an old cause.",
  "no-progress-advances":
    "The harness adds an accept to the thread a repeated demand was rejected no-progress on, caused by that rejected proposal, as if a no-progress move had advanced a thread.",
  "thread-no-ending":
    "The harness deletes the ending of the sworn thread whose deadline passed, as if the world had left a thread open past its deadline.",
  "obligated-turn-unrecorded":
    "The harness deletes from the journal the proposal behind a turn Zeus took while obligated, as if his choice had gone unrecorded.",
  "ending-no-consequence":
    "The harness deletes every motif and every feeling the endings moved, as if no ending had left anything behind.",
  "practices-missing":
    "The harness deletes the supplication threads, as if the run had had no supplication.",
  "consequence-no-effect":
    "The harness removes the endings from every prompt the gods were shown afterwards, as if no consequence had reached a later choice.",
  "contest-no-standing":
    "The harness deletes the standing changes a decided contest left behind, as if the world had closed a contest and changed no one's standing.",
  "alliance-unsealed":
    "The harness rewrites the sealed ending of the alliance as a plain performance, as if two gods had become allied by something other than a settlement's seal.",
  "god-silent":
    "The harness deletes every move, contest, and journey of the god that opened the first thread, as if that god had taken part in no practice.",
  "practice-absent":
    "The harness deletes the contest, as if the run had never played one.",
};

type Loose = Record<string, unknown>;

const withEvents = (
  input: RealInput,
  edit: (events: readonly Loose[]) => Loose[],
): RealInput => ({
  ...input,
  events: edit(input.events) as unknown as RealInput["events"],
});

/** Breaks one thing in `input` for `control`; the input is returned unchanged when there is nothing for the control to break. */
export function sabotage(
  control: PracticeControl,
  input: RealInput,
): RealInput {
  const events = input.events as readonly Loose[];
  switch (control) {
    case "thread-reopened": {
      return withEvents(input, (all) =>
        all.map((event) => {
          if (
            event.kind !== "practice-opened" ||
            event.succeeds === undefined
          ) {
            return event;
          }
          const earlier = all.find((e) => e.id === event.succeeds);
          return earlier === undefined
            ? event
            : { ...event, causes: earlier.causes };
        }),
      );
    }
    case "no-progress-advances": {
      const rejected = input.proposals.find(
        (p) => p.outcome === "rejected" && p.reason === "no-progress",
      );
      const refusal = events.find(
        (e) =>
          e.kind === "practice-refused" &&
          e.correlationId === rejected?.observationId,
      );
      if (rejected === undefined || refusal === undefined) return input;
      return withEvents(input, (all) => [
        ...all,
        {
          schemaVersion: 1,
          id: "evt-control-1",
          sequence: Number(all.at(-1)?.sequence ?? 0) + 1,
          simTime: 0,
          tick: Number(refusal.tick),
          correlationId: rejected.observationId,
          causationId: rejected.observationId,
          approximate: false,
          kind: "practice-moved",
          entityId: refusal.entityId === "hera" ? "zeus" : "hera",
          threadId: refusal.thread,
          move: "accept",
          sworn: false,
        },
      ]);
    }
    case "thread-no-ending": {
      const target = events.find(
        (e) => e.kind === "practice-ended" && e.outcome === "breached",
      );
      return withEvents(input, (all) =>
        all.filter(
          (e) => !(e.kind === "practice-ended" && e.id === target?.id),
        ),
      );
    }
    case "obligated-turn-unrecorded": {
      const turn = analyzePractices(input).obligated.turns.find(
        (t) => t.choice !== "waited",
      );
      const request = input.requests.find(
        (r) =>
          r.role === turn?.god &&
          r.proposalId !== undefined &&
          r.promptPayload?.includes(`[${turn?.thread}] YOU OWE`) &&
          r.promptPayload.includes(`tick ${turn?.tick}.`),
      );
      return {
        ...input,
        proposals: input.proposals.filter(
          (p) => p.proposalId !== request?.proposalId,
        ),
      };
    }
    case "ending-no-consequence":
      return withEvents(input, (all) =>
        all.filter(
          (e) =>
            e.kind !== "motif-applied" && e.kind !== "relationship-changed",
        ),
      );
    case "practices-missing": {
      const supplications = new Set(
        events
          .filter(
            (e) =>
              e.kind === "practice-opened" && e.practice === "supplication",
          )
          .map((e) => e.id),
      );
      return withEvents(input, (all) =>
        all.filter(
          (e) =>
            !(
              typeof e.kind === "string" &&
              e.kind.startsWith("practice-") &&
              (supplications.has(e.id as string) ||
                supplications.has(e.threadId as string))
            ),
        ),
      );
    }
    case "contest-no-standing": {
      const closings = new Set(
        events
          .filter((e) => e.kind === "contest-closed" && e.result === "decided")
          .map((e) => String(e.id)),
      );
      return withEvents(input, (all) =>
        all.filter(
          (e) =>
            !(
              e.kind === "motif-applied" &&
              e.effect === "standing" &&
              closings.has(String(e.cause))
            ),
        ),
      );
    }
    case "alliance-unsealed":
      return withEvents(input, (all) =>
        all.map((e) =>
          e.kind === "practice-ended" && e.reason === "sealed"
            ? { ...e, reason: "performed" }
            : e,
        ),
      );
    case "god-silent": {
      const first = events.find((e) => e.kind === "practice-opened")?.entityId;
      return withEvents(input, (all) =>
        all.filter(
          (e) =>
            !(
              e.entityId === first &&
              (e.kind === "practice-opened" ||
                e.kind === "practice-moved" ||
                e.kind === "contest-opened" ||
                e.kind === "journey-started")
            ),
        ),
      );
    }
    case "practice-absent":
      return withEvents(input, (all) =>
        all.filter((e) => e.kind !== "contest-opened"),
      );
    case "consequence-no-effect": {
      const endings = events
        .filter(
          (e) =>
            e.kind === "practice-ended" ||
            (e.kind === "practice-moved" &&
              (e.move === "refuse" || e.move === "withdraw")),
        )
        .map((e) => String(e.id));
      return {
        ...input,
        requests: input.requests.map((r) => ({
          ...r,
          promptPayload: endings.reduce(
            (text, ending) => text?.replaceAll(`[${ending}]`, ""),
            r.promptPayload,
          ),
        })),
      };
    }
  }
}
