// What the real-inference run measures and asserts, as pure functions over
// what the run read back from the store: the trace's model requests, the
// journaled god proposals, and the event log. Properties, not exact facts: a
// real model varies, so each check says what must hold whatever it chose.

import { PRAYERS_HEADING } from "@panthea/agents";
import { p50, p95 } from "@panthea/tools-probes-shared";
import { ALTAR } from "@panthea/world";
import { explainChain, type StoredEvent } from "./checks";
import { analyzePractices } from "./practice-analysis";

export interface RealStep {
  readonly mode?: string;
  readonly reason?: string;
  readonly detail?: string;
  /** Attempts the step made before it gave up or answered. */
  readonly attempts?: number;
  /** For an invalid reply: the last reply refused, as the trace kept it (redacted, bounded). */
  readonly output?: string;
  /** For an invalid reply: the schema the request was made under. */
  readonly schema?: string;
}

export interface RealRequest {
  readonly proposalId: string | undefined;
  readonly role: string;
  readonly outcome: "intent" | "exhausted";
  readonly elapsedMs: number;
  /** What the model was shown (bounded to 16 K characters by the trace). */
  readonly promptPayload: string | undefined;
  readonly steps: readonly RealStep[];
  /** The wall-clock time (ms) the trace row was written, which is when the request finished. */
  readonly recordedAt?: number;
}

export interface RealProposal {
  readonly proposalId: string;
  readonly actor: string;
  readonly kind: string;
  readonly observationId: string;
  readonly proposal: Record<string, unknown>;
  readonly outcome: "committed" | "rejected" | undefined;
  readonly reason?: string;
  /** The tick the journal consumed the proposal in; absent while it waits. */
  readonly consumedTick?: number;
}

export interface RealInput {
  readonly requests: readonly RealRequest[];
  readonly proposals: readonly RealProposal[];
  readonly events: readonly StoredEvent[];
  /** Once-every-few-seconds observations of whether the frame showed model-degraded. */
  readonly polls: { readonly total: number; readonly degraded: number };
  /** What the run knew of its own end, for the request timings only (no check reads it): every god of the world, the wall-clock time it stopped, and the tick it had reached. */
  readonly timing?: {
    readonly gods: readonly string[];
    readonly endedAtMs: number;
    readonly endTick: number;
    /** Where the world first placed each god, read from the run's first frame: the start of a god's first journey. */
    readonly startLocations?: Readonly<Record<string, string>>;
  };
}

export interface Property {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface RealAnalysis {
  readonly requests: {
    readonly total: number;
    readonly intent: number;
    readonly exhausted: number;
    readonly native: number;
    readonly repaired: number;
  };
  readonly latencyMs: {
    readonly p50: number | undefined;
    readonly p95: number | undefined;
  };
  readonly promptChars: {
    readonly p50: number | undefined;
    readonly max: number;
  };
  readonly proposals: Readonly<Record<string, number>>;
  readonly outcomes: Readonly<Record<string, number>>;
  readonly exhaustion: readonly {
    readonly reason: string;
    readonly detail: string;
    readonly count: number;
  }[];
  /** Each refused reply an exhausted request kept, up to `MAX_REFUSALS`: whose turn, why, how many attempts, and what the model sent. */
  readonly refusals: readonly {
    readonly god: string;
    readonly reason: string;
    readonly detail: string;
    readonly attempts: number;
    readonly output: string;
  }[];
  readonly degradedShare: number;
  readonly properties: readonly Property[];
}

/** How many refused replies an analysis lists. */
export const MAX_REFUSALS = 12;

export const GOD_ACTIONS: ReadonlySet<string> = new Set([
  "travel",
  "strike",
  "legend",
  "report",
  "bless",
  "practice",
  "goal",
]);

/** Every entity or event id a god proposal names as a target of something, so it can be looked for in what the god was shown. */
export function namedIds(proposal: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value === "string") ids.push(value);
  };
  add(proposal.target);
  add(proposal.listener);
  add(proposal.to);
  add(proposal.linkedEventId);
  // The petition a bless answers is an id the god was shown.
  add(proposal.petition);
  // A practice move answers a thread or opens a demand on a cause: both ids are ones the digest and the instructions list.
  add(proposal.thread);
  add(proposal.cause);
  const claim = proposal.claim;
  if (typeof claim === "object" && claim !== null) {
    add((claim as Record<string, unknown>).agent);
    add((claim as Record<string, unknown>).target);
  }
  // A goal's target is an id the god was shown, like any other it names.
  const goal = proposal.goal;
  if (typeof goal === "object" && goal !== null) {
    const set = (goal as Record<string, unknown>).set;
    if (typeof set === "object" && set !== null) {
      add((set as Record<string, unknown>).target);
    }
  }
  return ids;
}

const count = (values: readonly string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
};

function validActions(proposals: readonly RealProposal[]): Property {
  const name = "valid actions";
  if (proposals.length === 0) {
    return { name, ok: false, detail: "no god proposal was journaled" };
  }
  const foreign = proposals.filter((p) => !GOD_ACTIONS.has(p.kind));
  const malformed = proposals.filter((p) => p.reason === "malformed");
  return {
    name,
    ok: foreign.length === 0 && malformed.length === 0,
    detail:
      foreign.length + malformed.length === 0
        ? `${proposals.length} proposals, all god actions, none rejected as malformed`
        : `${foreign.length} not god actions (${foreign.map((p) => p.kind).join(", ")}), ${malformed.length} rejected as malformed`,
  };
}

function perceptionCompliance(
  requests: readonly RealRequest[],
  proposals: readonly RealProposal[],
): Property {
  const name = "perception compliance";
  const byProposal = new Map(
    requests.flatMap((r) => (r.proposalId ? [[r.proposalId, r] as const] : [])),
  );
  const missing: string[] = [];
  const uncheckable: string[] = [];
  let checked = 0;
  for (const proposal of proposals) {
    const prompt = byProposal.get(proposal.proposalId)?.promptPayload;
    if (prompt === undefined) {
      // A committed proposal with no prompt behind it cannot be shown to have
      // been grounded in what the god saw, so it fails rather than being skipped.
      if (proposal.outcome === "committed") {
        uncheckable.push(proposal.proposalId);
      }
      continue;
    }
    checked += 1;
    for (const id of namedIds(proposal.proposal)) {
      // The god's own id is always in scope (the schema offers it as a claim's
      // agent and target), but its prompt says "You are <Name>", not the id.
      if (id !== proposal.actor && !prompt.includes(id)) {
        missing.push(`${proposal.actor}'s ${proposal.kind} names ${id}`);
      }
    }
  }
  return {
    name,
    ok: checked > 0 && missing.length === 0 && uncheckable.length === 0,
    detail: [
      checked === 0 ? "no proposal had its prompt to check against" : undefined,
      uncheckable.length > 0
        ? `no request with a prompt for committed proposals: ${uncheckable.join(", ")}`
        : undefined,
      missing.length > 0
        ? `not in the prompt: ${missing.join("; ")}`
        : undefined,
      checked > 0 && uncheckable.length === 0 && missing.length === 0
        ? `every id named by ${checked} proposals was in the prompt behind it`
        : undefined,
    ]
      .filter((part) => part !== undefined)
      .join("; "),
  };
}

/** A prompt line giving an account the god was told: "- <teller> told you: "...". */
const TOLD_LINE = /^- \S+ told you: ".*$/;

/** A perceived legend under "Recent events here": "- [<id>] legend-recorded (...)". A legend is told aloud to everyone present, so its words are public to them. */
const LEGEND_LINE = /^- \[[^\]]+\] legend-recorded \(.*$/;

/**
 * No god's prompt may carry another god's goal text except where the goal was
 * disclosed to it (R5): inside an account it was told by report, or in a legend
 * it perceived, which is told aloud to everyone present. Those lines are set
 * aside and the rest of the prompt is searched for every goal text another god
 * set.
 */
function goalPrivacy(
  requests: readonly RealRequest[],
  events: readonly StoredEvent[],
): Property {
  const name = "goal privacy";
  const goals = events.flatMap((e) =>
    e.kind === "goal-set" &&
    typeof e.entityId === "string" &&
    typeof e.text === "string"
      ? [{ god: e.entityId, text: e.text }]
      : [],
  );
  const leaks: string[] = [];
  let checked = 0;
  for (const request of requests) {
    if (request.promptPayload === undefined) continue;
    checked += 1;
    const outsideTold = request.promptPayload
      .split("\n")
      .filter((line) => !TOLD_LINE.test(line) && !LEGEND_LINE.test(line))
      .join("\n");
    for (const goal of goals) {
      if (goal.god !== request.role && outsideTold.includes(goal.text)) {
        leaks.push(
          `${request.role}'s prompt carries ${goal.god}'s goal "${goal.text}" outside a told account or a perceived legend`,
        );
      }
    }
  }
  // Goals were set but no prompt could be read: nothing was checked, and an
  // empty pass would claim a privacy the run never looked at.
  if (goals.length > 0 && checked === 0) {
    return {
      name,
      ok: false,
      detail: `${goals.length} goals were set but no prompt payload was recorded to check them against`,
    };
  }
  return {
    name,
    ok: leaks.length === 0,
    detail:
      leaks.length === 0
        ? `${checked} prompts checked against ${goals.length} goals: none carried another god's goal outside a told account or a perceived legend`
        : leaks.join("; "),
  };
}

/**
 * The prayers-to-you section of a prompt: each `PRAYERS_HEADING` and the dashed
 * or indented lines under it, up to the next heading. Empty when there is none.
 */
export function prayersSection(prompt: string): string {
  const lines = prompt.split("\n");
  const sections: string[] = [];
  for (let at = 0; at < lines.length; at += 1) {
    if (lines[at] !== PRAYERS_HEADING) continue;
    let end = at + 1;
    while (end < lines.length && /^( {2}|- )/.test(lines[end] ?? "")) end += 1;
    sections.push(lines.slice(at, end).join("\n"));
    at = end - 1;
  }
  return sections.join("\n");
}

/**
 * Whether `god` stood at the altar when the petition event was committed: the
 * place a prayer is made, and so the only place anyone perceives it (the
 * world's own rule, `perceivesEvent`). Its place is the destination of its
 * latest move or crossing before the event in sequence; with none in the log
 * the answer is no, as in the world when a window cannot say where an observer
 * was.
 */
function atAltarWhenPrayed(
  events: readonly StoredEvent[],
  god: string,
  prayerSequence: number,
): boolean {
  let at: unknown;
  let latest = -1;
  for (const e of events) {
    if (
      (e.kind === "entity-moved" || e.kind === "realm-transitioned") &&
      e.entityId === god &&
      typeof e.sequence === "number" &&
      e.sequence < prayerSequence &&
      e.sequence > latest
    ) {
      latest = e.sequence;
      at = e.to;
    }
  }
  return at === ALTAR;
}

/**
 * No god's prayers section may list a petition addressed to another god (R7):
 * the divine sense is the named god's alone. Elsewhere in a prompt (the scene's
 * recent events, a citation's guidance) another god's petition id is allowed
 * only when this god stood at the altar when the prayer was made, since anyone
 * there witnessed it; otherwise it is a leak too.
 */
function petitionPrivacy(
  requests: readonly RealRequest[],
  events: readonly StoredEvent[],
): Property {
  const name = "petition privacy";
  const petitions = events.flatMap((e) =>
    e.kind === "petition-opened" &&
    typeof e.god === "string" &&
    typeof e.id === "string" &&
    typeof e.sequence === "number"
      ? [{ id: e.id, god: e.god, sequence: e.sequence }]
      : [],
  );
  const leaks: string[] = [];
  let checked = 0;
  for (const request of requests) {
    if (request.promptPayload === undefined) continue;
    checked += 1;
    const prayers = prayersSection(request.promptPayload);
    for (const petition of petitions) {
      if (petition.god === request.role) continue;
      const named = new RegExp(`${petition.id}(?![0-9])`);
      if (named.test(prayers)) {
        leaks.push(
          `${request.role}'s prayers section lists ${petition.id}, addressed to ${petition.god}`,
        );
      } else if (
        named.test(request.promptPayload) &&
        !atAltarWhenPrayed(events, request.role, petition.sequence)
      ) {
        leaks.push(
          `${request.role}'s prompt carries ${petition.id}, addressed to ${petition.god}, though ${request.role} was not at the altar when it was prayed`,
        );
      }
    }
  }
  if (petitions.length > 0 && checked === 0) {
    return {
      name,
      ok: false,
      detail: `${petitions.length} petitions were opened but no prompt payload was recorded to check them against`,
    };
  }
  return {
    name,
    ok: leaks.length === 0,
    detail:
      leaks.length === 0
        ? `${checked} prompts checked against ${petitions.length} petitions: none listed a petition addressed to another god, and none carried one the god did not witness`
        : leaks.join("; "),
  };
}

function relationshipProvenance(events: readonly StoredEvent[]): Property {
  const name = "relationship change with provenance";
  const changes = events.filter((e) => e.kind === "relationship-changed");
  const explained = changes
    .map((change) => explainChain(events, change.id))
    .filter((chain) => chain.length >= 3 && chain.includes("memory-recorded"));
  return {
    name,
    ok: explained.length > 0,
    detail:
      changes.length === 0
        ? "no relationship changed"
        : explained.length > 0
          ? `${changes.length} changes, ${explained.length} explained from the log alone, e.g. ${explained[0]?.join(" > ")}`
          : `${changes.length} changes, none explained by a memory in the log`,
  };
}

/** A committed god proposal, the events it caused, and the first of their sequences. */
export interface CommittedAction {
  readonly proposal: RealProposal;
  readonly caused: readonly StoredEvent[];
  readonly sequence: number;
}

/**
 * A god's committed proposals in the order the world applied them: sorted by
 * the sequence of the first event each caused. A proposal that caused no
 * event has no place in that order and is left out.
 */
export function committedInOrder(
  actor: string,
  proposals: readonly RealProposal[],
  events: readonly StoredEvent[],
): CommittedAction[] {
  return proposals
    .filter((p) => p.actor === actor && p.outcome === "committed")
    .flatMap((proposal) => {
      const caused = events.filter(
        (e) => e.correlationId === proposal.observationId,
      );
      const first = caused[0];
      return first
        ? [{ proposal, caused, sequence: Number(first.sequence) }]
        : [];
    })
    .sort((a, b) => a.sequence - b.sequence);
}

/** A god's committed actions in order, each with the first event sequence it caused. */
function actionsOf(
  actor: string,
  proposals: readonly RealProposal[],
  events: readonly StoredEvent[],
) {
  return committedInOrder(actor, proposals, events)
    .filter(({ proposal }) => proposal.kind !== "goal")
    .map(({ proposal, sequence }) => ({
      key: `${proposal.kind}:${namedIds(proposal.proposal).join(",")}`,
      kind: proposal.kind,
      sequence,
    }));
}

function changedNextAction(
  proposals: readonly RealProposal[],
  events: readonly StoredEvent[],
): Property {
  const name = "changed next action";
  const details: string[] = [];
  let changed = false;
  for (const actor of new Set(proposals.map((p) => p.actor))) {
    const formed = events.find(
      (e) =>
        e.entityId === actor &&
        ((e.kind === "memory-recorded" && e.memoryKind === "told") ||
          e.kind === "relationship-changed"),
    );
    if (!formed) continue;
    const at = Number(formed.sequence);
    const actions = actionsOf(actor, proposals, events);
    const before = actions.filter((a) => a.sequence < at).at(-1);
    const after = actions.find((a) => a.sequence > at);
    if (!before || !after) continue;
    const differs = before.key !== after.key;
    changed = changed || differs;
    details.push(
      `${actor}: ${before.key} before its first belief, ${after.key} after (${differs ? "changed" : "same"})`,
    );
  }
  return {
    name,
    ok: changed,
    detail:
      details.length === 0
        ? "no god both formed a belief or feeling and acted on either side of it"
        : details.join("; "),
  };
}

export function analyzeReal(input: RealInput): RealAnalysis {
  const { requests, proposals, events } = input;
  const intent = requests.filter((r) => r.outcome === "intent");
  const exhausted = requests.filter((r) => r.outcome === "exhausted");
  const answering = intent.flatMap((r) => r.steps.at(-1) ?? []);
  const exhaustion = new Map<
    string,
    { reason: string; detail: string; count: number }
  >();
  for (const request of exhausted) {
    for (const step of request.steps) {
      if (step.reason === undefined) continue;
      const detail = (step.detail ?? "").slice(0, 120);
      const key = `${step.reason}|${detail}`;
      const held = exhaustion.get(key);
      exhaustion.set(key, {
        reason: step.reason,
        detail,
        count: (held?.count ?? 0) + 1,
      });
    }
  }
  const prompts = requests.flatMap((r) =>
    r.promptPayload ? [r.promptPayload.length] : [],
  );
  return {
    requests: {
      total: requests.length,
      intent: intent.length,
      exhausted: exhausted.length,
      native: answering.filter((s) => s.mode === "native").length,
      repaired: answering.filter((s) => s.mode === "repaired").length,
    },
    latencyMs: {
      p50: p50(requests.map((r) => r.elapsedMs)),
      p95: p95(requests.map((r) => r.elapsedMs)),
    },
    promptChars: { p50: p50(prompts), max: Math.max(0, ...prompts) },
    proposals: count(proposals.map((p) => p.kind)),
    outcomes: count(
      proposals.map(
        (p) => `${p.outcome ?? "pending"}${p.reason ? `:${p.reason}` : ""}`,
      ),
    ),
    exhaustion: [...exhaustion.values()].sort((a, b) => b.count - a.count),
    refusals: exhausted
      .flatMap((request) =>
        request.steps.flatMap((step) =>
          step.output === undefined
            ? []
            : [
                {
                  god: request.role,
                  reason: step.reason ?? "unknown",
                  detail: (step.detail ?? "").slice(0, 160),
                  attempts: step.attempts ?? 1,
                  output: step.output,
                },
              ],
        ),
      )
      .slice(0, MAX_REFUSALS),
    degradedShare:
      input.polls.total === 0 ? 0 : input.polls.degraded / input.polls.total,
    properties: [
      validActions(proposals),
      perceptionCompliance(requests, proposals),
      relationshipProvenance(events),
      changedNextAction(proposals, events),
      goalPrivacy(requests, events),
      petitionPrivacy(requests, events),
      ...analyzePractices(input).properties,
    ],
  };
}
