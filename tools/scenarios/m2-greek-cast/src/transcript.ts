// The owner's reading material for the M2 experience gate: one markdown
// transcript per episode and a summary across them. They show what happened
// and what the automated checks found, and leave the rubric and the decision
// blank: the owner scores (docs/product/acceptance.md), the tool never does.

import type {
  GoalEndedEvent,
  GoalSetEvent,
  WorldEvent,
} from "@panthea/contracts";
import type { StoredEvent } from "./checks";
import {
  buildDispositions,
  type Disposition,
  renderDispositionCounts,
} from "./dispositions";
import {
  CONTEXT_ACTIONS,
  choiceKey,
  type EpisodeAnalysis,
  type GodIdentity,
  influencedBy,
  parseEvents,
  primaryTarget,
  REPETITION_CAP,
} from "./episode-analysis";
import { journeysOf, renderJourneyCounts, renderJourneys } from "./journeys";
import { analyzePractices, type ThreadRecord } from "./practice-analysis";
import {
  committedInOrder,
  type RealAnalysis,
  type RealInput,
} from "./real-analysis";
import { renderRequestTimings, requestTimings } from "./request-timing";

export interface EpisodeSettings {
  readonly model: string;
  readonly reasoningEffort?: "none";
  /** The kind of explicit endpoint the model ran on; absent for the default local Ollama. The host and port are never recorded. */
  readonly endpoint?: "hosted" | "local";
  readonly seconds: number;
  readonly ranAt: string;
  readonly ticks: number;
  readonly hardware: string;
}

export interface EpisodeRecord {
  readonly index: number;
  readonly total: number;
  readonly settings: EpisodeSettings;
  /** The gods that took turns, with their profiles, in the order they are shown. */
  readonly identities: readonly GodIdentity[];
  readonly input: RealInput;
  readonly analysis: RealAnalysis;
  readonly episode: EpisodeAnalysis;
}

export interface ActionEntry {
  readonly tick: number;
  readonly sequence: number;
  readonly god: string;
  /** What was done and to what, e.g. `move → olympus-gate`. */
  readonly verb: string;
  readonly backing:
    | "ability-backed"
    | "context-backed"
    | "unbacked"
    /** A goal declared or ended: not an action. */
    | "declaration";
  /** The model's own words: a report's content or a legend's assertion. */
  readonly text: string | undefined;
  readonly claim: string | undefined;
  /** The goal the god had when it chose this action, if any. */
  readonly underGoal: string | undefined;
  /** For a goal declaration, the goal it sets or ends. */
  readonly goalLine: string | undefined;
  /** For a legend, who heard it. */
  readonly hearers: readonly string[] | undefined;
  /** The events the proposal itself caused. */
  readonly caused: readonly string[];
  /** The memories and feelings that followed from them. */
  readonly changes: readonly string[];
}

const tickOf = (eventId: string): number =>
  Number(/^evt-(\d+)-/.exec(eventId)?.[1] ?? 0);

const signed = (value: unknown): string =>
  `${Number(value) > 0 ? "+" : ""}${String(value)}`;

/** Whether the model was asked not to reason, in words for the owner. */
const reasoningText = (effort: "none" | undefined): string =>
  effort === "none"
    ? "reasoning off (reasoning_effort none)"
    : "reasoning at the model's default";

function describeChange(
  event: Extract<WorldEvent, { kind: "relationship-changed" }>,
): string {
  return `${event.entityId} → ${event.toward}: affinity ${signed(event.affinityDelta)}${event.grudgeDelta > 0 ? `, grudge +${event.grudgeDelta}` : ""}${event.allied === true ? ", allied" : event.allied === false ? ", no longer allied" : ""}`;
}

function describeCaused(event: StoredEvent): string {
  if (event.kind === "report-told") {
    return `report-told (${String(event.entityId)} → ${String(event.listenerId)})`;
  }
  return typeof event.entityId === "string"
    ? `${String(event.kind)} (${event.entityId})`
    : String(event.kind);
}

function describeClaim(claim: unknown): string | undefined {
  if (typeof claim !== "object" || claim === null) return undefined;
  const c = claim as Record<string, unknown>;
  return `${String(c.effect)} by ${String(c.agent)}${typeof c.target === "string" ? ` on ${c.target}` : ""}`;
}

/** Every committed model action of the gods, in the order the world applied them. */
/**
 * Every committed model action of the gods, in the order the world applied
 * them. What followed from an action is attributed by immediate cause, as the
 * influence check does (`influencedBy`): a belief goes under the action whose
 * report it rests on, and a feeling under the action behind the belief it
 * cites, never through a report's `linkedEventId`. A witnessed memory goes
 * under the action that caused the event witnessed, since the witness saw
 * that happen.
 */
export function buildActions(record: EpisodeRecord): ActionEntry[] {
  const { events, proposals } = record.input;
  const parsed = parseEvents(events);

  const entries: ActionEntry[] = [];
  for (const identity of record.identities) {
    const abilities = new Set(identity.abilities.map((a) => a.action));

    // The god's goal declarations, in order: what it set and ended.
    const goalEvents = [...parsed.values()]
      .filter(
        (event): event is GoalSetEvent | GoalEndedEvent =>
          (event.kind === "goal-set" || event.kind === "goal-ended") &&
          event.entityId === identity.id,
      )
      .sort((a, b) => a.sequence - b.sequence);
    for (const event of goalEvents) {
      const set =
        event.kind === "goal-ended" ? parsed.get(event.goalEventId) : event;
      const goal = set?.kind === "goal-set" ? set : undefined;
      entries.push({
        tick: tickOf(event.id),
        sequence: event.sequence,
        god: identity.id,
        verb:
          event.kind === "goal-set"
            ? `goal set → ${event.target}`
            : `goal ended (${event.outcome})`,
        backing: "declaration",
        text: undefined,
        claim: undefined,
        underGoal: undefined,
        goalLine: goal === undefined ? undefined : `"${goal.text}"`,
        hearers: undefined,
        caused: [],
        changes: [],
      });
    }
    /** The goal active just before `sequence`: the god chose its action under it. */
    const goalBefore = (sequence: number): string | undefined => {
      let active: { text: string; target: string; id: string } | undefined;
      for (const event of goalEvents) {
        if (event.sequence >= sequence) break;
        if (event.kind === "goal-set") {
          active = { text: event.text, target: event.target, id: event.id };
        } else if (active?.id === event.goalEventId) {
          active = undefined;
        }
      }
      return active === undefined
        ? undefined
        : `"${active.text}" (→ ${active.target})`;
    };

    for (const action of committedInOrder(identity.id, proposals, events)) {
      const { proposal, caused, sequence } = action;
      // A goal-only turn is a declaration (listed above), not an action.
      if (proposal.kind === "goal") continue;
      const changes: string[] = [];
      for (const event of influencedBy(caused, parsed)) {
        if (event.kind === "relationship-changed") {
          changes.push(describeChange(event));
        } else if (
          event.kind === "memory-recorded" &&
          event.memoryKind === "told"
        ) {
          changes.push(
            `${event.entityId} now believes ${event.teller}: "${event.content}"`,
          );
        }
      }
      const causedIds = new Set(caused.map((e) => e.id));
      const witnessed = new Map<string, string[]>();
      for (const event of parsed.values()) {
        if (
          event.kind === "memory-recorded" &&
          event.memoryKind === "witnessed" &&
          causedIds.has(event.sourceEventId)
        ) {
          const owners = witnessed.get(event.eventKind) ?? [];
          owners.push(event.entityId);
          witnessed.set(event.eventKind, owners);
        }
      }
      for (const [kind, owners] of witnessed) {
        changes.push(
          `${owners.join(", ")} ${owners.length === 1 ? "remembers" : "remember"} ${kind}`,
        );
      }
      // A feeling that comes of a witnessed memory goes under the same action
      // as that memory: the witness felt it because of what it saw.
      for (const event of parsed.values()) {
        if (event.kind !== "relationship-changed") continue;
        const memory = parsed.get(event.memoryEventId);
        if (
          memory?.kind === "memory-recorded" &&
          memory.memoryKind === "witnessed" &&
          causedIds.has(memory.sourceEventId)
        ) {
          changes.push(describeChange(event));
        }
      }

      const fields = proposal.proposal;
      const target = primaryTarget(fields);
      entries.push({
        tick: tickOf(caused[0]?.id ?? ""),
        sequence,
        god: identity.id,
        verb:
          proposal.kind === "legend" && target === "legend"
            ? "legend"
            : `${proposal.kind} → ${target}`,
        backing: abilities.has(proposal.kind)
          ? "ability-backed"
          : CONTEXT_ACTIONS.includes(proposal.kind)
            ? "context-backed"
            : "unbacked",
        text:
          typeof fields.content === "string"
            ? fields.content
            : typeof fields.assertion === "string"
              ? fields.assertion
              : undefined,
        claim: describeClaim(fields.claim),
        underGoal: goalBefore(sequence),
        goalLine: undefined,
        hearers: caused.flatMap((event) => {
          const legend = parsed.get(event.id);
          return legend?.kind === "legend-recorded" ? [legend.hearers] : [];
        })[0],
        // The goal events a turn carries have lines of their own.
        caused: caused
          .filter((e) => e.kind !== "goal-set" && e.kind !== "goal-ended")
          .map(describeCaused),
        changes,
      });
    }
  }
  return entries.sort((a, b) => a.sequence - b.sequence);
}

/** What the world did that no god's action caused: the director's trouble, needs, prayers, answers, signs, lapses, blessings, and refused goal changes. */
export interface WorldNote {
  readonly tick: number;
  readonly sequence: number;
  readonly line: string;
}

const REQUEST_WORDS = (request: unknown): string => {
  const r = request as {
    kind: string;
    offender?: string;
    buildings?: string[];
    need?: { kind: string; building?: string; resource?: string };
  };
  if (r.kind === "punish") {
    return `punish ${r.offender}, who owns ${(r.buildings ?? []).join(", ")}`;
  }
  return `help with ${r.need?.kind === "building" ? r.need.building : r.need?.resource}`;
};

/** The world's own notable events, in the order they were committed. Everything a god did is under `buildActions`. */
export function buildWorldNotes(record: EpisodeRecord): WorldNote[] {
  const events = record.input.events;
  const byId = new Map(events.map((e) => [e.id, e]));
  const notes: WorldNote[] = [];
  const note = (e: StoredEvent, line: string) =>
    notes.push({ tick: Number(e.tick), sequence: Number(e.sequence), line });
  for (const e of events) {
    switch (e.kind) {
      case "unmet-need":
        note(e, `${e.entityId} cannot get ${e.resource} (${e.reason})`);
        break;
      case "theft":
        note(
          e,
          `the director made ${e.entityId} take ${e.amount} ${e.resource} from ${e.victim}`,
        );
        break;
      case "stock-spoiled":
        note(
          e,
          `the director spoiled ${e.amount} ${e.resource} of ${e.entityId}`,
        );
        break;
      case "building-ignited":
        if ((e.cause as { kind?: string } | undefined)?.kind === "director") {
          note(e, `the director set ${e.entityId} alight`);
        }
        break;
      case "petition-opened":
        note(
          e,
          `${e.entityId} prayed to ${e.god}: ${REQUEST_WORDS(e.request)} [${e.id}]`,
        );
        break;
      case "petition-answered":
        note(e, `${e.god} answered ${e.entityId}'s prayer [${e.petitionId}]`);
        break;
      case "petition-lapsed":
        note(
          e,
          `${e.entityId}'s prayer to ${e.god} lapsed unanswered [${e.petitionId}]`,
        );
        break;
      case "blessing-granted":
        note(
          e,
          `${e.entityId} blessed ${e.recipient}: ${e.amount} ${e.resource}${e.building === undefined ? "" : ` for ${e.building}`}`,
        );
        break;
      case "goal-change-refused":
        note(
          e,
          `${e.entityId}'s change to ${e.entityId === "hera" ? "her" : "his"} goal was refused (${e.reason}, ${e.unlocksInTicks} ticks left)`,
        );
        break;
      case "practice-progressed":
        note(
          e,
          e.step === "boon"
            ? `${e.entityId}'s boon to ${e.counterparty} was seen given [${e.threadId}] (${e.by})`
            : `${e.counterparty}'s offering to ${e.entityId} was seen made [${e.threadId}] (${e.by})`,
        );
        break;
      case "practice-refused":
        note(
          e,
          `${e.entityId}'s ${e.attempted} was refused ${
            e.reason === "no-progress"
              ? `as no-progress${e.why === undefined ? "" : `: ${e.why}`}`
              : `(${e.reason})`
          }${e.thread === undefined ? "" : ` [${e.thread}]`}`,
        );
        break;
      case "memory-recorded":
        if (e.memoryKind === "sign") {
          note(
            e,
            `${e.entityId} remembers ${e.god}'s ${e.outcome === "answered" ? "answer" : "silence"}`,
          );
        }
        break;
      case "relationship-changed": {
        const memory = byId.get(String(e.memoryEventId));
        if (
          memory?.kind === "memory-recorded" &&
          memory.memoryKind === "sign"
        ) {
          note(
            e,
            `${e.entityId} → ${e.toward}: affinity ${signed(e.affinityDelta)}${Number(e.grudgeDelta) > 0 ? `, grudge +${e.grudgeDelta}` : ""}`,
          );
        }
        break;
      }
      default:
        break;
    }
  }
  return notes.sort((a, b) => a.sequence - b.sequence);
}

const nameOf = (record: EpisodeRecord, god: string): string =>
  record.identities.find((i) => i.id === god)?.name ?? god;

function renderGod(identity: GodIdentity): string {
  const drives = Object.entries(identity.drives)
    .map(([drive, weight]) => `${drive} ${weight}`)
    .join(", ");
  const powers = identity.abilities
    .map((a) => `${a.name} (${a.action})`)
    .join(", ");
  return [
    `### ${identity.name}`,
    "",
    `- Domains: ${identity.domains.join(", ")}`,
    `- Drives: ${drives}`,
    `- Powers: ${powers}; and, for any god, ${CONTEXT_ACTIONS.join(", ")}`,
  ].join("\n");
}

function renderAction(
  entry: ActionEntry,
  index: number,
  record: EpisodeRecord,
) {
  const lines = [
    `${index + 1}. **tick ${entry.tick}, ${nameOf(record, entry.god)}:** ${entry.verb} (${entry.backing})`,
  ];
  if (entry.text !== undefined) lines.push(`   - says: "${entry.text}"`);
  if (entry.claim !== undefined) lines.push(`   - claim: ${entry.claim}`);
  if (entry.goalLine !== undefined) lines.push(`   - goal: ${entry.goalLine}`);
  if (entry.underGoal !== undefined) {
    lines.push(`   - under goal: ${entry.underGoal}`);
  }
  if (entry.hearers !== undefined) {
    lines.push(
      `   - heard by: ${entry.hearers.length === 0 ? "no one" : entry.hearers.join(", ")}`,
    );
  }
  if (entry.caused.length > 0)
    lines.push(`   - caused: ${entry.caused.join("; ")}`);
  for (const change of entry.changes) lines.push(`   - then: ${change}`);
  return lines.join("\n");
}

function renderWorldNotes(record: EpisodeRecord): string {
  const notes = buildWorldNotes(record);
  return notes.length === 0
    ? "Nothing happened to the world beyond the gods' own actions."
    : notes.map((n) => `- tick ${n.tick}: ${n.line}`).join("\n");
}

/** One thread: its cause, who was in it, each move, how it ended, and what the ending changed. */
function renderThread(thread: ThreadRecord, record: EpisodeRecord): string {
  const name = (god: string) => nameOf(record, god);
  const lines = [
    `### ${thread.practice} [${thread.id}]: ${thread.demander} → ${thread.obligated}, ${thread.ending?.outcome ?? "still open"}`,
    "",
    `- Opened at tick ${thread.openedTick}`,
    `- Cause: ${thread.cause}`,
    ...(thread.subject === undefined
      ? []
      : [
          `- About: ${thread.subject.agent}${thread.subject.target === undefined ? "" : ` and ${thread.subject.target}`}`,
        ]),
    ...(thread.petition === undefined
      ? []
      : [`- Answers the prayer [${thread.petition}]`]),
    ...(thread.succeeds === undefined
      ? []
      : [`- Succeeds: [${thread.succeeds}]`]),
    ...(thread.successor === undefined
      ? []
      : [`- Reopened as: [${thread.successor}]`]),
    ...(thread.stake === undefined ? [] : [`- Stake: ${thread.stake}`]),
    "- Moves:",
    ...thread.moves.map(
      (move, index) =>
        `  ${index + 1}. tick ${move.tick}, ${name(move.actor)}: ${move.move}${move.terms === undefined ? "" : ` — ${move.terms}`}${move.sworn ? ", sworn by the Styx" : ""}`,
    ),
  ];
  if (thread.practice === "supplication") {
    lines.push(
      `- Boon: ${thread.progress.boon === undefined ? "not seen" : `seen given (${thread.progress.boon})`}`,
      `- Offering: ${thread.progress.offering === undefined ? "not seen" : `seen made (${thread.progress.offering})`}`,
    );
  }
  const { ending } = thread;
  if (ending !== undefined) {
    lines.push(
      `- Ending: ${ending.outcome} at tick ${ending.tick}${ending.by === undefined ? ` (${ending.reason.replaceAll("-", " ")})` : `, by ${ending.by}${ending.sworn ? " (sworn)" : ""}${ending.sealed ? ", sealing an alliance" : ""}`}; remembered by ${thread.rememberedBy.join(", ") || "no one"}`,
    );
  }
  for (const change of thread.changes) lines.push(`- Changed: ${change.line}`);
  if (ending !== undefined && thread.changes.length === 0) {
    lines.push("- Changed: nothing beyond the memory of it");
  }
  return lines.join("\n");
}

function renderPracticeThreads(record: EpisodeRecord): string {
  const { threads } = analyzePractices(record.input);
  return threads.length === 0
    ? "No practice thread was opened."
    : threads.map((thread) => renderThread(thread, record)).join("\n\n");
}

function renderOpenThreads(record: EpisodeRecord): string {
  const { open } = analyzePractices(record.input);
  return open.length === 0
    ? "No thread was open at the end."
    : open
        .map(
          ({ thread, ageTicks, waitsOn, endsBy }) =>
            `- [${thread.id}] ${thread.practice} ${thread.demander} → ${thread.obligated}, open ${ageTicks} ticks (since tick ${thread.openedTick}): waits on ${waitsOn}; ends by tick ${endsBy}`,
        )
        .join("\n");
}

function renderNoProgress(record: EpisodeRecord): string {
  const { noProgress } = analyzePractices(record.input);
  return noProgress.length === 0
    ? "No move was judged no progress."
    : noProgress
        .map(
          (move) =>
            `- tick ${move.tick ?? "?"}, ${move.actor}: ${move.attempted}${move.thread === undefined ? "" : ` [${move.thread}]`} — ${move.why ?? "(no reason recorded)"}`,
        )
        .join("\n");
}

/** The R12 record: each turn an obligated god took while its obligation was open, what it chose, and how that is classified. */
function renderObligatedTurns(record: EpisodeRecord): string {
  const { obligated } = analyzePractices(record.input);
  const rule =
    "Each turn is classified from the god's prompt and its proposal. An acceptance binds, so the god performs, waits, or risks breach, and bargaining is for a thread still open: the action the term calls for, committed, is performed; a turn that did something else is waited for a named event when its prompt shows what stops it (the digest's UNPERFORMABLE obstacle, or no mortal at the place a legend is to be told); every other turn, an attempt to bargain over the accepted thread included, is knowingly risked breach, since the obligation led the prompt.";
  if (obligated.turns.length === 0 && obligated.unrecorded.length === 0) {
    return `No obligation led a prompt, so no obligated turn was taken.\n\n${rule}`;
  }
  return [
    "A turn is performed, waited for a named event, or knowingly risked breach (R12, amended 2026-10-03: an acceptance binds).",
    "",
    rule,
    "",
    "| God | Tick | Thread | Deadline | Chose | Classified | Waiting for |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...obligated.turns.map(
      (turn) =>
        `| ${turn.god} | ${turn.tick ?? "?"} | ${turn.thread} | ${turn.deadline} | ${turn.choice} | ${turn.class} | ${turn.named ?? ""} |`,
    ),
    ...(obligated.unrecorded.length === 0
      ? []
      : [
          "",
          `Not recorded: ${obligated.unrecorded.map((u) => `${u.god} on ${u.thread} (${u.why})`).join("; ")}`,
        ]),
  ].join("\n");
}

function renderRepetition(record: EpisodeRecord): string {
  return record.episode.gods
    .map((g) => {
      const counts = new Map<string, number>();
      for (const { proposal } of committedInOrder(
        g.god,
        record.input.proposals,
        record.input.events,
      )) {
        const key = choiceKey(proposal);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const top = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([key, n]) => `${key} ×${n}`)
        .join(", ");
      return `- ${nameOf(record, g.god)}: longest run ${g.longestRun ? `${g.longestRun.length} of ${g.longestRun.key}` : "none"} (cap ${REPETITION_CAP}). Choices: ${top || "none"}`;
    })
    .join("\n");
}

/** One line per god proposal: the action, and what the world did with it. */
function renderDispositions(record: EpisodeRecord): string {
  const dispositions = buildDispositions(record.input);
  if (dispositions.length === 0) return "No god proposal was journaled.";
  const words = (d: Disposition): string =>
    d.outcome === "committed"
      ? `committed: ${d.events.join(", ")}`
      : d.outcome === "committed, no event" ||
          d.outcome === "pending" ||
          d.outcome === "rejected"
        ? d.outcome
        : `rejected: ${d.outcome}`;
  return [
    `- dispositions: ${renderDispositionCounts(dispositions)}`,
    "",
    ...dispositions.map(
      (d, i) =>
        `${i + 1}. ${nameOf(record, d.actor)}: ${d.kind}${d.target === "" ? "" : ` → ${d.target}`} — ${words(d)}`,
    ),
  ].join("\n");
}

function journeysIn(record: EpisodeRecord) {
  return journeysOf(record.input.events, record.input.timing?.startLocations);
}

/** Every journey a god made, from the run's own events; no check reads it. */
function renderJourneySection(record: EpisodeRecord): string {
  const journeys = journeysIn(record);
  return journeys.length === 0
    ? renderJourneys(journeys, (god) => nameOf(record, god))
    : [
        `- journeys: ${renderJourneyCounts(journeys)}`,
        "",
        renderJourneys(journeys, (god) => nameOf(record, god)),
      ].join("\n");
}

function renderChecks(record: EpisodeRecord): string {
  const rows = record.episode.gods.flatMap((g) =>
    g.checks.map(
      (c) =>
        `| ${nameOf(record, g.god)} | ${c.name} | ${c.ok ? "pass" : "FAIL"} | ${c.detail.replaceAll("|", "/")} |`,
    ),
  );
  return [
    "| God | Check | Result | Detail |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function renderModelRun(record: EpisodeRecord): string {
  const a = record.analysis;
  return [
    `- ${a.requests.total} requests: ${a.requests.intent} answered (${a.requests.native} native, ${a.requests.repaired} repaired), ${a.requests.exhausted} exhausted; latency p50 ${a.latencyMs.p50} ms, p95 ${a.latencyMs.p95} ms; prompt p50 ${a.promptChars.p50} / max ${a.promptChars.max} characters; frames showed model-degraded in ${(a.degradedShare * 100).toFixed(0)}% of polls`,
    ...(a.exhaustion.length > 0
      ? [
          `- exhaustion: ${a.exhaustion.map((e) => `${e.count} × ${e.detail}`).join("; ")}`,
        ]
      : []),
    ...a.refusals.map(
      (r) =>
        `- ${r.god} was refused after ${r.attempts} attempts (${r.detail}); it sent ${r.output}`,
    ),
    ...a.properties.map(
      (p) => `- ${p.name}: ${p.ok ? "held" : "FAILED"} (${p.detail})`,
    ),
    ...renderRequestTimings(requestTimings(record.input)),
  ].join("\n");
}

const RUBRIC = [
  "Novelty",
  "Causality",
  "Recognizable identity",
  "Pacing",
  "Inspectability",
];

/** Where the model ran: local Ollama at its 4K context, a local or hosted OpenAI-compatible endpoint (never named). */
function modelLine(settings: {
  readonly model: string;
  readonly reasoningEffort?: "none";
  readonly endpoint?: "hosted" | "local";
}): string {
  const where =
    settings.endpoint === "hosted"
      ? "a hosted OpenAI-compatible endpoint"
      : settings.endpoint === "local"
        ? "a local OpenAI-compatible endpoint"
        : "local Ollama, 4K context";
  return `${settings.model} through ${where}, ${reasoningText(settings.reasoningEffort)}`;
}

export function renderTranscript(record: EpisodeRecord): string {
  const { settings } = record;
  const actions = buildActions(record);
  return [
    `# Episode ${record.index} of ${record.total}`,
    "",
    "## Settings",
    "",
    `- Recorded: ${settings.ranAt}`,
    `- Model: ${modelLine(settings)}`,
    `- Length: ${settings.seconds} s (${settings.ticks} ticks)`,
    "- World: a fresh world from the initial authored Greek state; no fixtures, no seeds",
    `- Machine: ${settings.hardware}`,
    "",
    "## Gods",
    "",
    record.identities.map(renderGod).join("\n\n"),
    "",
    "## What happened",
    "",
    actions.length === 0
      ? "No god took a committed action."
      : actions.map((entry, i) => renderAction(entry, i, record)).join("\n"),
    "",
    "## What the world did with every proposal",
    "",
    renderDispositions(record),
    "",
    "## What the world did",
    "",
    renderWorldNotes(record),
    "",
    "## Journeys",
    "",
    renderJourneySection(record),
    "",
    "## Practice threads",
    "",
    renderPracticeThreads(record),
    "",
    "## Open threads at the end",
    "",
    renderOpenThreads(record),
    "",
    "## Moves judged no progress",
    "",
    renderNoProgress(record),
    "",
    "## Turns while an obligation was open",
    "",
    renderObligatedTurns(record),
    "",
    "## Repetition",
    "",
    renderRepetition(record),
    "",
    "## Automated checks",
    "",
    renderChecks(record),
    "",
    "## Model run",
    "",
    renderModelRun(record),
    "",
    "## Owner rubric",
    "",
    "Score each 0, 1, or 2: 0 = replan pressure, 1 = needs tuning, 2 = good enough to continue. The owner scores; nothing above is a score.",
    "",
    "| Dimension | Score (0/1/2) | Notes |",
    "| --- | --- | --- |",
    ...RUBRIC.map((dimension) => `| ${dimension} |  |  |`),
    "",
    "Decision: continue / tune / replan: ",
    "",
  ].join("\n");
}

export interface SummarySettings {
  readonly seconds: number;
  readonly model: string;
  readonly reasoningEffort?: "none";
  /** The kind of explicit endpoint the model ran on; absent for the default local Ollama. The host and port are never recorded. */
  readonly endpoint?: "hosted" | "local";
  /** Transcript file names, in episode order. */
  readonly files: readonly string[];
}

export function renderSummary(
  records: readonly EpisodeRecord[],
  settings: SummarySettings,
): string {
  const checkRows = records.flatMap((record) =>
    record.episode.gods.map((g) => {
      const failed = g.checks.filter((c) => !c.ok).map((c) => c.name);
      return `| ${record.index} | ${nameOf(record, g.god)} | ${g.actions} (${g.abilityBacked} ability, ${g.contextBacked} context) | ${g.longestRun?.length ?? 0} | ${g.influence} | ${g.goalsSet} / ${g.goalsEnded} | ${g.petitionsHeard} / ${g.petitionsAnswered} | ${g.refusals} | ${failed.length === 0 ? "pass" : `FAIL: ${failed.join(", ")}`} |`;
    }),
  );
  const failures = records.flatMap((record) => [
    ...record.episode.gods.flatMap((g) =>
      g.checks
        .filter((c) => !c.ok)
        .map(
          (c) =>
            `episode ${record.index}, ${nameOf(record, g.god)}: ${c.name} (${c.detail})`,
        ),
    ),
    ...record.analysis.properties
      .filter((p) => !p.ok)
      .map((p) => `episode ${record.index}, property ${p.name} (${p.detail})`),
  ]);
  const practiceRows = records.map((record) => {
    const practice = analyzePractices(record.input);
    const ended = practice.threads.filter((t) => t.ending !== undefined);
    const hard = ended.filter(
      (t) =>
        t.ending?.outcome === "refused" || t.ending?.outcome === "breached",
    );
    return `| ${record.index} | ${practice.threads.length} | ${ended.length} | ${practice.open.length} | ${hard.length} | ${practice.noProgress.length} | ${practice.obligated.turns.length} |`;
  });
  const runRows = records.map((record) => {
    const a = record.analysis;
    const held = a.properties.filter((p) => p.ok).length;
    return `| ${record.index} | ${a.requests.total} | ${a.requests.exhausted} | ${(a.degradedShare * 100).toFixed(0)}% | ${a.latencyMs.p50} / ${a.latencyMs.p95} ms | ${held} of ${a.properties.length} held |`;
  });
  return [
    "# M2 experience gate",
    "",
    "- Requirements: O08",
    `- Model: ${modelLine(settings)}`,
    `- ${records.length} episodes of ${settings.seconds} s, each a fresh world from the initial authored Greek state; no fixtures, no seeds`,
    `- dispositions: ${renderDispositionCounts(records.flatMap((record) => buildDispositions(record.input)))}`,
    `- journeys: ${renderJourneyCounts(records.flatMap(journeysIn))}`,
    "",
    "## Automated checks",
    "",
    "| Episode | God | Committed actions | Longest run | Told beliefs and feelings caused | Goals set / ended | Petitions heard / answered | Goal changes refused | Checks |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...checkRows,
    "",
    failures.length === 0
      ? "All automated checks and real-run properties held."
      : `Automated checks failed:\n\n${failures.map((f) => `- ${f}`).join("\n")}`,
    "",
    "## Practices",
    "",
    "| Episode | Threads | Ended | Open | Refused or breached | No progress | Obligated turns |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...practiceRows,
    "",
    "## Model runs",
    "",
    "| Episode | Requests | Exhausted | Degraded polls | Latency p50 / p95 | Properties |",
    "| --- | --- | --- | --- | --- | --- |",
    ...runRows,
    "",
    "## Transcripts",
    "",
    ...settings.files.map((file) => `- [${file}](${file})`),
    "",
    "## Owner",
    "",
    "Scores are in each transcript's rubric. The owner scores; the tool never does.",
    "",
    "Decision: continue / tune / replan: ",
    "",
  ].join("\n");
}
