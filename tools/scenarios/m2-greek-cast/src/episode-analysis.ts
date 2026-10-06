// The automated checks of the M2 experience gate, per god per episode, as pure
// functions over what an episode's run read back from its store. They say
// whether an episode is worth the owner's time; they never score it (the
// owner scores, docs/product/acceptance.md). Thresholds are the owner's
// decisions of 2026-09-30.

import { parseEvent, type WorldEvent } from "@panthea/contracts";
import type { StoredEvent } from "./checks";
import {
  committedInOrder,
  type RealInput,
  type RealProposal,
} from "./real-analysis";

/** A repeated choice fails on the fourth identical one in a row. */
export const REPETITION_CAP = 3;
/** Fewest committed model actions a god must take in an episode. */
export const MIN_ACTIONS = 5;

/** Actions a god's context offers whatever its profile grants. */
export const CONTEXT_ACTIONS: readonly string[] = [
  "travel",
  "report",
  "bless",
  "refuse",
  "practice",
];

/** What the checks and the transcript need of a god's profile. */
export interface GodIdentity {
  readonly id: string;
  readonly name: string;
  readonly domains: readonly string[];
  readonly drives: Readonly<Record<string, number>>;
  readonly abilities: readonly {
    readonly name: string;
    readonly action: string;
  }[];
}

export type CheckName =
  | "profile trace"
  | "repetition"
  | "minimum activity"
  | "influence"
  | "goal set"
  | "goal ended"
  | "petition heard"
  | "petition answered";

export interface EpisodeCheck {
  readonly name: CheckName;
  readonly ok: boolean;
  readonly detail: string;
}

export interface GodEpisode {
  readonly god: string;
  /** Committed model actions. */
  readonly actions: number;
  readonly abilityBacked: number;
  readonly contextBacked: number;
  /** The longest run of the same (kind, primary target), or undefined with no ordered action. */
  readonly longestRun:
    | { readonly length: number; readonly key: string }
    | undefined;
  /** Caused told beliefs and relationship changes. */
  readonly influence: number;
  /** Goals the god set, and goals it ended (by any outcome). */
  readonly goalsSet: number;
  readonly goalsEnded: number;
  /** Ticks each ended goal lasted, from its set to its end. */
  readonly goalLifetimes: readonly number[];
  /** Goal changes the world refused. */
  readonly refusals: number;
  /** Petitions addressed to this god, and how many it answered. */
  readonly petitionsHeard: number;
  readonly petitionsAnswered: number;
  readonly checks: readonly EpisodeCheck[];
}

export interface EpisodeAnalysis {
  readonly gods: readonly GodEpisode[];
  /** Every check of every god held. */
  readonly ok: boolean;
}

/** The target that makes two choices the same choice. */
export function primaryTarget(proposal: Record<string, unknown>): string {
  switch (proposal.kind) {
    case "travel":
      return String(proposal.to);
    case "strike":
      return String(proposal.target);
    case "report":
      return String(proposal.listener);
    case "legend":
      return typeof proposal.linkedEventId === "string"
        ? proposal.linkedEventId
        : "legend";
    case "bless":
    case "refuse":
      return String(proposal.petition);
    case "practice":
      // A demand is told apart by its cause, an offer by its prayer, an answer by its thread: two moves on one thread are two choices.
      return `${String(proposal.move)} ${String(proposal.thread ?? proposal.cause ?? proposal.petition)}`;
    default:
      return "";
  }
}

/** A turn that only changes the god's goal: a declaration, not an action. */
export const isGoalOnly = (proposal: RealProposal): boolean =>
  proposal.kind === "goal";

export const choiceKey = (proposal: RealProposal): string =>
  `${proposal.kind}:${primaryTarget(proposal.proposal)}`;

function profileTrace(
  god: string,
  committed: readonly RealProposal[],
  input: RealInput,
  identity: GodIdentity | undefined,
): { check: EpisodeCheck; ability: number; context: number } {
  const name = "profile trace" as const;
  const requests = new Map(
    input.requests.flatMap((r) =>
      r.proposalId ? [[r.proposalId, r] as const] : [],
    ),
  );
  const abilityActions = new Set(identity?.abilities.map((a) => a.action));
  const problems: string[] = [];
  let ability = 0;
  let context = 0;
  if (identity === undefined) problems.push(`${god} has no profile`);
  for (const proposal of committed) {
    const request = requests.get(proposal.proposalId);
    if (request === undefined) {
      problems.push(
        `${proposal.kind} ${proposal.proposalId} has no model request`,
      );
    } else if (request.role !== god) {
      problems.push(
        `${proposal.kind} ${proposal.proposalId} was requested for role ${request.role}`,
      );
    }
    if (isGoalOnly(proposal)) {
      // Needs its request and role like any proposal, but is neither an
      // ability nor a context action: it is not an action at all.
    } else if (abilityActions.has(proposal.kind)) ability += 1;
    else if (CONTEXT_ACTIONS.includes(proposal.kind)) context += 1;
    else {
      problems.push(
        `${proposal.kind} is neither one of ${god}'s abilities nor a context action`,
      );
    }
  }
  const split = `${ability} ability-backed, ${context} context-backed`;
  return {
    ability,
    context,
    check: {
      name,
      ok: problems.length === 0,
      detail:
        problems.length === 0
          ? `${committed.filter((p) => !isGoalOnly(p)).length} actions: ${split}`
          : `${problems.join("; ")} (${split})`,
    },
  };
}

function longestRun(
  ordered: readonly { readonly proposal: RealProposal }[],
): { length: number; key: string } | undefined {
  let best: { length: number; key: string } | undefined;
  let run: { length: number; key: string } | undefined;
  for (const { proposal } of ordered) {
    const key = choiceKey(proposal);
    run =
      run?.key === key ? { key, length: run.length + 1 } : { key, length: 1 };
    if (best === undefined || run.length > best.length) best = run;
  }
  return best;
}

/** Every event that parses, by id, in the order given. */
export function parseEvents(
  events: readonly StoredEvent[],
): Map<string, WorldEvent> {
  const parsed = new Map<string, WorldEvent>();
  for (const stored of events) {
    const result = parseEvent(stored);
    if (result.ok) parsed.set(stored.id, result.value);
  }
  return parsed;
}

/**
 * The told beliefs and relationship changes the events in `caused` are the
 * immediate cause of, in event order. A told belief belongs to the action whose
 * `report-told` or `legend-recorded` is its `sourceEventId` (a legend gives each
 * hearer one, so it is the narrator's influence, never the hearer's); a
 * relationship change belongs to the action that caused the belief its
 * `memoryEventId` names, or the action whose event answered the petition behind
 * the sign its `memoryEventId` names (`petition-answered.answeredBy`: a bless,
 * or a strike that answered a prayer). A sign is not itself a told belief, and
 * a sign of a lapsed petition belongs to no action. A witnessed memory is not
 * among them, and
 * `report-told.linkedEventId` is never followed, so a report that cites another
 * god's event credits only its own teller.
 */
export function influencedBy(
  caused: readonly StoredEvent[],
  parsed: ReadonlyMap<string, WorldEvent>,
): WorldEvent[] {
  const reportIds = new Set(
    caused
      .filter((e) => e.kind === "report-told" || e.kind === "legend-recorded")
      .map((e) => e.id),
  );
  const isReportedBelief = (event: WorldEvent | undefined): boolean =>
    event?.kind === "memory-recorded" &&
    event.memoryKind === "told" &&
    reportIds.has(event.sourceEventId);
  const causedIds = new Set(caused.map((e) => e.id));
  // A sign rests on a petition-answered event, which names the event of the
  // answering action: the god's own bless or strike, sharing the proposal's
  // correlation. The sign, the answer, and the change are derived, so none of
  // them shares it; the link is `answeredBy`.
  const isSignOfOwnAnswer = (event: WorldEvent | undefined): boolean => {
    if (event?.kind !== "memory-recorded" || event.memoryKind !== "sign") {
      return false;
    }
    const answer = parsed.get(event.sourceEventId);
    return (
      answer?.kind === "petition-answered" && causedIds.has(answer.answeredBy)
    );
  };
  return [...parsed.values()].filter(
    (event) =>
      isReportedBelief(event) ||
      (event.kind === "relationship-changed" &&
        (isReportedBelief(parsed.get(event.memoryEventId)) ||
          isSignOfOwnAnswer(parsed.get(event.memoryEventId)))),
  );
}

function influenceOf(
  ordered: readonly { readonly caused: readonly StoredEvent[] }[],
  events: readonly StoredEvent[],
): { count: number; kinds: string[] } {
  const credited = influencedBy(
    ordered.flatMap((a) => a.caused),
    parseEvents(events),
  );
  const kinds = credited.map((event) =>
    event.kind === "memory-recorded" ? "told belief" : "relationship-changed",
  );
  return { count: kinds.length, kinds };
}

function analyzeGod(
  god: string,
  input: RealInput,
  identity: GodIdentity | undefined,
): GodEpisode {
  const committedAll = input.proposals.filter(
    (p) => p.actor === god && p.outcome === "committed",
  );
  // Goal-only turns are declarations: they are not actions to count or to repeat.
  const committed = committedAll.filter((p) => !isGoalOnly(p));
  const ordered = committedInOrder(god, input.proposals, input.events).filter(
    (action) => !isGoalOnly(action.proposal),
  );
  const trace = profileTrace(god, committedAll, input, identity);
  const goalsSet = input.events.filter(
    (e) => e.kind === "goal-set" && e.entityId === god,
  );
  const goalsEnded = input.events.filter(
    (e) => e.kind === "goal-ended" && e.entityId === god,
  );
  const outcomes = [...new Set(goalsEnded.map((e) => String(e.outcome)))];
  const setTicks = new Map(goalsSet.map((e) => [e.id, Number(e.tick)]));
  const goalLifetimes = goalsEnded.flatMap((e) => {
    const setAt = setTicks.get(String(e.goalEventId));
    return setAt === undefined ? [] : [Number(e.tick) - setAt];
  });
  const refusals = input.events.filter(
    (e) => e.kind === "goal-change-refused" && e.entityId === god,
  ).length;
  const heard = input.events.filter(
    (e) => e.kind === "petition-opened" && e.god === god,
  );
  const answered = input.events.filter(
    (e) => e.kind === "petition-answered" && e.god === god,
  );
  const run = longestRun(ordered);
  const influence = influenceOf(ordered, input.events);
  const kindsSeen = [...new Set(influence.kinds)].join(", ");
  return {
    god,
    actions: committed.length,
    abilityBacked: trace.ability,
    contextBacked: trace.context,
    longestRun: run,
    influence: influence.count,
    goalsSet: goalsSet.length,
    goalsEnded: goalsEnded.length,
    goalLifetimes,
    refusals,
    petitionsHeard: heard.length,
    petitionsAnswered: answered.length,
    checks: [
      trace.check,
      {
        name: "repetition",
        ok: run === undefined || run.length <= REPETITION_CAP,
        detail:
          run === undefined
            ? "no ordered action"
            : `longest run ${run.length} of ${run.key} (cap ${REPETITION_CAP})`,
      },
      {
        name: "minimum activity",
        ok: committed.length >= MIN_ACTIONS,
        detail: `${committed.length} committed model actions (at least ${MIN_ACTIONS})`,
      },
      {
        name: "influence",
        ok: influence.count > 0,
        detail:
          influence.count > 0
            ? `${influence.count} caused (${kindsSeen})`
            : "no told belief or relationship change traces to this god's proposals",
      },
      {
        name: "goal set",
        ok: goalsSet.length > 0,
        detail: `${goalsSet.length} goals set (at least 1)`,
      },
      {
        name: "goal ended",
        ok: goalsEnded.length > 0,
        detail:
          goalsEnded.length > 0
            ? `${goalsEnded.length} goals ended (${outcomes.join(", ")}); at least 1, any outcome`
            : "no goal ended (at least 1, any outcome)",
      },
      {
        name: "petition heard",
        ok: heard.length > 0,
        detail:
          heard.length > 0
            ? `${heard.length} petition${heard.length === 1 ? "" : "s"} addressed to this god (at least 1)`
            : "no petition was addressed to this god (at least 1)",
      },
      {
        name: "petition answered",
        ok: answered.length > 0,
        detail:
          answered.length > 0
            ? `${answered.length} of ${heard.length} answered (at least 1)`
            : `${heard.length} heard, none answered (at least 1)`,
      },
    ],
  };
}

export function analyzeEpisode(
  input: RealInput,
  identities: ReadonlyMap<string, GodIdentity>,
  gods: readonly string[],
): EpisodeAnalysis {
  const analyzed = gods.map((god) =>
    analyzeGod(god, input, identities.get(god)),
  );
  return {
    gods: analyzed,
    ok: analyzed.every((g) => g.checks.every((c) => c.ok)),
  };
}
