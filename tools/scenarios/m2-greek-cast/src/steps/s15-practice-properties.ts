// S20: over everything the scripted story did, the real-run properties of the
// practice threads hold, and the full cast played: each of the seven gods made a
// practice move and every practice appeared. The run's data is read back from
// the store the way the real run reads its own (requests with their prompts, the
// journaled god proposals, every event), so these are the same checks the gate
// applies to a model. Then each practice control breaks a copy of that same data
// on purpose, in-process: the check for the property it targets must fail. The
// story is not rerun for them; a control is a pure function of the collected data.

import { activeStorePath } from "../../../m1-living-world/src/world-db";
import { readProposals, readRealRequests, readStoredEvents } from "../db";
import {
  analyzePractices,
  describeCast,
  type PracticeAnalysis,
} from "../practice-analysis";
import {
  type PracticeControlRun,
  runPracticeControls,
} from "../practice-controls";
import { GODS } from "../provider";
import type { RealInput } from "../real-analysis";
import type { Recorder, Story } from "./context";
import { check } from "./support";

/** The run's data as the real run reads it, from the store. */
export function collectInput(story: Story): RealInput {
  const path = activeStorePath(story.dataDir);
  return {
    // Zeus and Hera play the long thread arcs (S13 to S16). Hermes, Hephaestus, and Hades take short ones
    // (S18, S19) and Athena and Poseidon a contest (S17), and every god takes idle turns too. The thread
    // properties judge the two gods who had obligations to keep; the properties over the whole cast read
    // the events alone, so they see every god's moves whoever played them.
    requests: readRealRequests(path).filter(
      (request) => request.role === "zeus" || request.role === "hera",
    ),
    proposals: readProposals(path)
      .filter(
        (entry) =>
          entry.source === "model" &&
          (entry.actor === "zeus" || entry.actor === "hera"),
      )
      .map((entry) => ({
        proposalId: entry.proposalId,
        actor: entry.actor,
        kind: entry.kind,
        observationId: String(entry.proposal.observationId),
        proposal: entry.proposal,
        outcome: entry.outcome as "committed" | "rejected" | undefined,
        ...(entry.reason === undefined ? {} : { reason: entry.reason }),
      })),
    events: readStoredEvents(path),
    polls: { total: 1, degraded: 0 },
  };
}

export interface PracticeProperties {
  readonly analysis: PracticeAnalysis;
  /** Each practice control as it failed the property it targets. */
  readonly controls: readonly PracticeControlRun[];
}

export async function stepPracticeProperties(
  recorder: Recorder,
  story: Story,
): Promise<PracticeProperties> {
  return recorder.run(
    "S20",
    "The practice properties hold over the scripted episode, and the full cast played",
    "Over the requests, journaled proposals, and events of the whole scripted run, Zeus and Hera each caused a thread ending that left a persistent consequence; the run held a supplication and a settlement, with a refusal and a breach among them; every thread ended with its parties remembering how, or is open inside its deadline; no thread reopened without a cause learned since it opened; every move judged no progress left a refusal record and advanced nothing; a recorded consequence changed a later choice, with the ending in the prompt behind it; every turn an obligated god took has its recorded classification; every alliance rests on a sealed ending and each sealing allied both gods; each of the seven gods made at least one practice move; and every practice appeared (a settlement, a supplication with terms, a contest, a breach with transformation, a sealed alliance, and travel). The result lists each god's practices and thread endings. Then each of the eleven practice controls is applied in-process to a copy of that data, and the property it targets fails on it.",
    async (step) => {
      const collected = collectInput(story);
      const analysis = analyzePractices(collected, GODS);
      for (const property of analysis.properties) {
        check(property.ok, `${property.name} holds`, property.detail);
      }
      const controls = runPracticeControls(collected, GODS);
      const classes = new Map<string, number>();
      for (const turn of analysis.obligated.turns) {
        classes.set(turn.class, (classes.get(turn.class) ?? 0) + 1);
      }
      step.done(
        `${analysis.threads.length} threads (${analysis.threads.filter((t) => t.ending !== undefined).length} ended, ${analysis.open.length} open), ${analysis.noProgress.length} moves judged no progress, ${analysis.obligated.turns.length} obligated turns (${[...classes].map(([k, n]) => `${n} ${k}`).join(", ") || "none"}); ${analysis.properties.map((p) => p.name).join("; ")} all held. Each god's practices and thread endings: ${describeCast(analysis.cast).join(" | ")}. Applied in-process to a copy of the same data, ${controls.length} practice controls each failed their property (${controls.map((c) => c.control).join(", ")})`,
        [
          { name: "threads", unit: "threads", value: analysis.threads.length },
          {
            name: "gods that practiced",
            unit: "gods",
            value: analysis.cast.filter((god) => god.practices.length > 0)
              .length,
          },
          {
            name: "moves judged no progress",
            unit: "moves",
            value: analysis.noProgress.length,
          },
          {
            name: "obligated turns",
            unit: "turns",
            value: analysis.obligated.turns.length,
          },
          {
            name: "practice controls that tripped their property",
            unit: "controls",
            value: controls.length,
          },
        ],
      );
      return { analysis, controls };
    },
  );
}
