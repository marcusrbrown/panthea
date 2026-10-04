// What a run did with practice threads, as pure functions over the event log,
// the journaled god proposals, and the trace's model requests: each thread's
// cause, participants, moves, ending, and recorded changes; the threads still
// open at the end and what each waits on; every move judged no progress; how
// each turn an obligated god took while its obligation was open is classified
// (R12); and the real-run properties built on them (R7-R12, R24).
//
// Nothing here reads a clock, a database, or a process. The prompts a god was
// shown are the one place the digest's obligation rows can be read from, so a
// turn is classified from its prompt and its proposal, never from anything the
// god did not see.

import {
  type EventId,
  type PracticeTerm,
  parseEvent,
  type WorldEvent,
} from "@panthea/contracts";
import type { StoredEvent } from "./checks";
import type { Property, RealInput, RealProposal } from "./real-analysis";

// --- Events --------------------------------------------------------------------------------

/** Every stored event that parses, oldest first. */
export function parseAll(events: readonly StoredEvent[]): WorldEvent[] {
  const parsed: WorldEvent[] = [];
  for (const stored of events) {
    const result = parseEvent(stored);
    if (result.ok) parsed.push(result.value);
  }
  return parsed.sort((a, b) => a.sequence - b.sequence);
}

/** The last tick any event was committed in: the world's clock as the log knows it. */
export function lastTick(events: readonly WorldEvent[]): number {
  return events.reduce((latest, event) => Math.max(latest, event.tick), 0);
}

// --- Words -----------------------------------------------------------------------------------

/** A term in words, from no one's side. */
export function termWords(term: PracticeTerm): string {
  const by = `by tick ${term.deadline}`;
  switch (term.kind) {
    case "tell-legend":
      return `${term.party} tells a legend to the mortals at ${term.place} ${by}`;
    case "be-at":
      return `${term.party} is at ${term.place} ${by}`;
    case "stay-away":
      return `${term.party} stays away from ${term.place} until tick ${term.deadline}`;
    case "give-resource":
      return `${term.party} gives ${term.to} ${term.amount} ${term.resource} ${by}`;
    case "bless-mortal":
      return `${term.party} blesses ${term.mortal} ${by}`;
    case "make-offering":
      return `${term.party} offers ${term.to} ${term.amount} ${term.resource} ${by}`;
    case "ally":
      return `${term.party} allies with ${term.to}`;
  }
}

/** What an offer is as far as repeating it goes: the world's own tuple, never words, never the tick it was said on. */
export function termTuple(term: PracticeTerm, offeredAt: number): string {
  const subject =
    term.kind === "tell-legend" ||
    term.kind === "be-at" ||
    term.kind === "stay-away"
      ? term.place
      : term.kind === "bless-mortal"
        ? term.mortal
        : term.to;
  const [resource, amount] =
    term.kind === "give-resource" || term.kind === "make-offering"
      ? [term.resource, term.amount]
      : ["", 0];
  return `${term.kind}|${term.party}|${subject}|${resource}|${amount}|${term.deadline - offeredAt}`;
}

function describeCause(
  id: string,
  byId: ReadonlyMap<string, WorldEvent>,
): string {
  const event = byId.get(id);
  if (event === undefined) return `an event [${id}]`;
  switch (event.kind) {
    case "report-told":
      return `${event.entityId} told ${event.listenerId} "${event.content}" [${id}]`;
    case "building-ignited":
    case "building-damaged":
      return `${event.kind} ${event.entityId}${event.kind === "building-ignited" && event.cause.kind === "strike" ? ` by ${event.cause.actor}'s strike` : ""} [${id}]`;
    default:
      return `${event.kind}${"entityId" in event ? ` (${String(event.entityId)})` : ""} [${id}]`;
  }
}

// --- Threads ---------------------------------------------------------------------------------

export interface ThreadMove {
  readonly tick: number;
  readonly sequence: number;
  readonly actor: string;
  /** demand, offer, counter, accept, refuse, or withdraw. */
  readonly move: string;
  /** The term the move put on the table, in words. */
  readonly terms: string | undefined;
  readonly sworn: boolean;
}

export interface ThreadChange {
  readonly sequence: number;
  readonly line: string;
  /** Whether it outlasts the thread: a motif's change or a feeling, not the thread's own bookkeeping. */
  readonly persistent: boolean;
  readonly who: string;
}

export interface ThreadEnding {
  readonly eventId: string;
  readonly sequence: number;
  readonly tick: number;
  readonly outcome: string;
  readonly reason: string;
  /** The act that decided it: who refused, withdrew, performed, or breached. Absent for a lapse, a spent budget, a death. */
  readonly by: string | undefined;
  readonly performedBy: string | undefined;
  readonly sworn: boolean;
  readonly sealed: boolean;
}

export type ThreadStatus = "open" | "countered" | "accepted" | "ended";

export interface ThreadRecord {
  readonly id: string;
  readonly practice: "settlement" | "supplication";
  readonly demander: string;
  readonly obligated: string;
  readonly openedTick: number;
  readonly openedSequence: number;
  readonly causes: readonly string[];
  /** The cause, in words as the log shows it. */
  readonly cause: string;
  readonly subject:
    | { readonly agent: string; readonly target?: string }
    | undefined;
  readonly petition: string | undefined;
  readonly succeeds: string | undefined;
  readonly successor: string | undefined;
  readonly stake: string | undefined;
  readonly negotiationDeadline: number;
  readonly moves: readonly ThreadMove[];
  /** The term on the table now: the demand, or the latest counter. */
  readonly term: PracticeTerm;
  readonly status: ThreadStatus;
  readonly offeredBy: string;
  readonly counterBudgetLeft: number;
  readonly acceptedTick: number | undefined;
  readonly acceptedSequence: number | undefined;
  readonly sworn: boolean;
  readonly progress: { readonly boon?: string; readonly offering?: string };
  readonly ending: ThreadEnding | undefined;
  readonly changes: readonly ThreadChange[];
  /** Who remembers how it ended. */
  readonly rememberedBy: readonly string[];
}

function motifWords(event: Extract<WorldEvent, { kind: "motif-applied" }>) {
  switch (event.effect) {
    case "oath-penalty":
      return `${event.entityId} paid the oath penalty: ${event.divinityLost} divinity lost and ${event.capability} withheld until tick ${event.accessRestoredAt}`;
    case "transformation":
      return `${event.entityId} became ${event.form} as ${event.intent} (gained ${event.capabilitiesGained.join(", ") || "nothing"}, lost ${event.capabilitiesLost.join(", ") || "nothing"}); identity, memory, and relationships kept`;
    case "standing":
      return `${event.entityId}'s standing at ${event.place} ${event.delta > 0 ? "rose" : "fell"} by ${Math.abs(event.delta)}`;
  }
}

/** Every thread the log opened, with what the log says became of it. */
export function buildThreads(events: readonly WorldEvent[]): ThreadRecord[] {
  const byId = new Map(events.map((event) => [event.id as string, event]));
  const records = new Map<string, Mutable>();
  type Mutable = {
    -readonly [K in keyof ThreadRecord]: ThreadRecord[K];
  } & { moves: ThreadMove[]; changes: ThreadChange[] };

  for (const event of events) {
    switch (event.kind) {
      case "practice-opened": {
        const record: Mutable = {
          id: event.id,
          practice: event.practice,
          demander: event.entityId,
          obligated: event.counterparty,
          openedTick: event.tick,
          openedSequence: event.sequence,
          causes: event.causes,
          cause: event.causes
            .map((cause) => describeCause(cause, byId))
            .join("; "),
          subject: event.subject,
          petition: event.petition,
          succeeds: event.succeeds,
          successor: undefined,
          stake: event.stake?.form,
          negotiationDeadline: event.negotiationDeadline,
          moves: [
            {
              tick: event.tick,
              sequence: event.sequence,
              actor: event.entityId,
              move: event.practice === "settlement" ? "demand" : "offer",
              terms: termWords(event.term),
              sworn: false,
            },
          ],
          term: event.term,
          status: "open",
          offeredBy: event.entityId,
          counterBudgetLeft: event.counterBudget,
          acceptedTick: undefined,
          acceptedSequence: undefined,
          sworn: false,
          progress: {},
          ending: undefined,
          changes: [],
          rememberedBy: [],
        };
        records.set(event.id, record);
        if (event.succeeds !== undefined) {
          const earlier = records.get(event.succeeds);
          if (earlier !== undefined) earlier.successor = event.id;
        }
        break;
      }
      case "practice-moved": {
        const record = records.get(event.threadId);
        if (record === undefined || record.ending !== undefined) break;
        const base = {
          tick: event.tick,
          sequence: event.sequence,
          actor: event.entityId,
          move: event.move,
        };
        if (event.move === "counter") {
          record.moves.push({
            ...base,
            terms: termWords(event.term),
            sworn: false,
          });
          record.term = event.term;
          record.status = "countered";
          record.offeredBy = event.entityId;
          record.counterBudgetLeft = Math.max(0, record.counterBudgetLeft - 1);
        } else if (event.move === "accept") {
          record.moves.push({
            ...base,
            terms: undefined,
            sworn: event.sworn,
          });
          record.status = "accepted";
          record.acceptedTick = event.tick;
          record.acceptedSequence = event.sequence;
          record.sworn = event.sworn;
        } else {
          record.moves.push({ ...base, terms: undefined, sworn: false });
          record.status = "ended";
          record.ending = {
            eventId: event.id,
            sequence: event.sequence,
            tick: event.tick,
            outcome: event.move === "refuse" ? "refused" : "withdrawn",
            reason: event.move === "refuse" ? "refused" : "withdrawn",
            by: event.entityId,
            performedBy: undefined,
            sworn: false,
            sealed: false,
          };
        }
        break;
      }
      case "practice-progressed": {
        const record = records.get(event.threadId);
        if (record === undefined) break;
        record.progress = { ...record.progress, [event.step]: event.by };
        break;
      }
      case "practice-ended": {
        const record = records.get(event.threadId);
        if (record === undefined || record.ending !== undefined) break;
        record.status = "ended";
        const performer =
          event.outcome === "fulfilled" || event.outcome === "breached"
            ? record.practice === "supplication"
              ? record.term.party
              : record.term.party
            : undefined;
        record.ending = {
          eventId: event.id,
          sequence: event.sequence,
          tick: event.tick,
          outcome: event.outcome,
          reason: event.reason,
          by: event.reason === "sealed" ? record.term.party : performer,
          performedBy: event.performedBy,
          sworn: record.sworn,
          sealed: event.reason === "sealed",
        };
        break;
      }
      default:
        break;
    }
  }

  // What the endings recorded: the parties' memories of them, the changes the
  // world made because of them (motifs), and the feelings those memories moved.
  const endingOf = new Map<string, Mutable>();
  for (const record of records.values()) {
    if (record.ending !== undefined)
      endingOf.set(record.ending.eventId, record);
  }
  const memoryEnding = new Map<string, Mutable>();
  for (const event of events) {
    if (
      event.kind === "memory-recorded" &&
      event.memoryKind === "witnessed" &&
      event.ending !== undefined
    ) {
      const record = endingOf.get(event.sourceEventId);
      if (record === undefined) continue;
      memoryEnding.set(event.id, record);
      record.rememberedBy = [...record.rememberedBy, event.entityId];
    }
  }
  for (const event of events) {
    if (event.kind === "motif-applied") {
      const record = records.get(event.threadId);
      record?.changes.push({
        sequence: event.sequence,
        line: motifWords(event),
        persistent: true,
        who: event.entityId,
      });
    } else if (event.kind === "relationship-changed") {
      const record = memoryEnding.get(event.memoryEventId);
      if (record === undefined) continue;
      const parts = [
        `${event.entityId} → ${event.toward}: affinity ${event.affinityDelta > 0 ? "+" : ""}${event.affinityDelta}`,
        ...(event.grudgeDelta > 0 ? [`grudge +${event.grudgeDelta}`] : []),
        ...(event.allied === true
          ? ["allied"]
          : event.allied === false
            ? ["no longer allied"]
            : []),
      ];
      record.changes.push({
        sequence: event.sequence,
        line: parts.join(", "),
        persistent: true,
        who: event.entityId,
      });
    }
  }
  return [...records.values()].sort(
    (a, b) => a.openedSequence - b.openedSequence,
  );
}

/** The gods an ending is the act of: who refused or withdrew; who performed or breached a settlement; for a supplication, the god whose boon and terms it was. */
export function causedBy(
  thread: ThreadRecord,
  gods: ReadonlySet<string>,
): string[] {
  const ending = thread.ending;
  if (ending === undefined) return [];
  let who: string | undefined;
  if (ending.reason === "refused" || ending.reason === "withdrawn") {
    who = ending.by;
  } else if (ending.outcome === "fulfilled" || ending.outcome === "breached") {
    who = thread.practice === "supplication" ? thread.demander : ending.by;
  }
  return who !== undefined && gods.has(who) ? [who] : [];
}

/** Whether an ending left something that outlasts it: a motif's change or a feeling it moved. */
export const persistentChanges = (thread: ThreadRecord): ThreadChange[] =>
  thread.changes.filter((change) => change.persistent);

// --- Open threads ------------------------------------------------------------------------------

export interface OpenThread {
  readonly thread: ThreadRecord;
  readonly ageTicks: number;
  /** What it waits on, in words. */
  readonly waitsOn: string;
  /** The tick by which it ends if what it waits on does not happen. */
  readonly endsBy: number;
}

/** The threads still open when the log ends, with their age and what each waits on. */
export function openThreads(
  threads: readonly ThreadRecord[],
  now: number,
): OpenThread[] {
  return threads
    .filter((thread) => thread.status !== "ended")
    .map((thread) => {
      const other = (god: string) =>
        god === thread.demander ? thread.obligated : thread.demander;
      let waitsOn: string;
      let endsBy: number;
      if (thread.status === "accepted") {
        const owed = thread.term.party;
        if (thread.practice === "supplication") {
          const { boon, offering } = thread.progress;
          waitsOn = `${boon === undefined ? `${thread.demander}'s boon on [${thread.petition}]` : ""}${boon === undefined && offering === undefined ? " and " : ""}${offering === undefined ? `${owed}'s offering` : ""}`;
          if (boon !== undefined && offering !== undefined)
            waitsOn = "the world's ruling";
        } else {
          waitsOn = `${owed} to perform: ${termWords(thread.term)}`;
        }
        endsBy = thread.term.deadline;
      } else {
        const answerer = other(thread.offeredBy);
        waitsOn = `${answerer} to answer ${thread.offeredBy}'s ${thread.status === "countered" ? "counteroffer" : thread.practice === "supplication" ? "terms" : "demand"}: ${termWords(thread.term)}`;
        endsBy = thread.negotiationDeadline;
      }
      return {
        thread,
        ageTicks: Math.max(0, now - thread.openedTick),
        waitsOn,
        endsBy,
      };
    });
}

// --- Moves judged no progress ----------------------------------------------------------------

export interface NoProgressMove {
  /** The tick the world refused it in, from the record of the refusal. */
  readonly tick: number | undefined;
  readonly actor: string;
  readonly kind: string;
  /** What the god tried: the move of a practice proposal, or the report or legend it made. */
  readonly attempted: string;
  readonly thread: string | undefined;
  /** The reason the world gave, from the record of the refusal. */
  readonly why: string | undefined;
  readonly observationId: string;
  /** Whether the world recorded the refusal for the god's next prompt. */
  readonly recorded: boolean;
}

/** Every proposal the world rejected as no-progress, with the refusal the world recorded for it. */
export function noProgressMoves(
  proposals: readonly RealProposal[],
  events: readonly WorldEvent[],
): NoProgressMove[] {
  const refusals = new Map(
    events.flatMap((event) =>
      event.kind === "practice-refused"
        ? [[event.correlationId as string, event] as const]
        : [],
    ),
  );
  return proposals
    .filter((p) => p.outcome === "rejected" && p.reason === "no-progress")
    .map((p) => {
      const refusal = refusals.get(p.observationId);
      return {
        tick: refusal?.tick,
        actor: p.actor,
        kind: p.kind,
        attempted: p.kind === "practice" ? String(p.proposal.move) : p.kind,
        thread: refusal?.thread,
        why: refusal?.why,
        observationId: p.observationId,
        recorded: refusal !== undefined,
      };
    });
}

// --- Turns an obligated god takes --------------------------------------------------------------

export type TurnClass =
  | "performed"
  | "waited for a named event"
  | "knowingly risked breach";

export interface ObligatedTurn {
  readonly god: string;
  readonly thread: string;
  /** The tick the god's prompt was drawn at. */
  readonly tick: number | undefined;
  readonly deadline: number;
  readonly class: TurnClass;
  /** What the god waited for, when it waited for a named event. */
  readonly named: string | undefined;
  /** What it did, in words. */
  readonly choice: string;
}

export interface UnrecordedTurn {
  readonly god: string;
  readonly thread: string;
  readonly why: string;
}

export interface ObligatedTurns {
  readonly turns: readonly ObligatedTurn[];
  readonly unrecorded: readonly UnrecordedTurn[];
}

/** The obligation rows the digest leads a prompt with: "- [evt] YOU OWE <god>: <term>, by tick N". */
const OBLIGATION_ROW =
  /^- \[(evt-[^\]]+)\] YOU OWE (\S+): (.+?), by tick (\d+)/;
const PROMPT_TICK = / in the \S+ realm, tick (\d+)\./;
const PROMPT_PLACE = /^You are at .+? \[([^\]]+)\] in the /m;

interface ObligationRow {
  readonly thread: string;
  readonly other: string;
  readonly deadline: number;
  /** What the digest says stops it being performed, when it says so. */
  readonly unperformable: string | undefined;
  /** Whether this is a boon the god owes on a supplication its terms set up (the row says "your boon on its prayer"), not a term it must perform. */
  readonly boon: boolean;
  /** The prayer an owed boon answers, as the row names it. */
  readonly petition: string | undefined;
  /** The next step the row showed as an object to copy (a bless, a strike, or a hop), as the god would send it. */
  readonly next: Readonly<Record<string, unknown>> | undefined;
}

/** The obligations a prompt's digest leads with. */
export function obligationRows(prompt: string): ObligationRow[] {
  const lines = prompt.split("\n");
  const rows: ObligationRow[] = [];
  for (const [at, line] of lines.entries()) {
    const match = OBLIGATION_ROW.exec(line);
    if (match === null) continue;
    let unperformable: string | undefined;
    let next: Record<string, unknown> | undefined;
    if (line.includes("UNPERFORMABLE now"))
      unperformable = "the term cannot be performed now";
    // A compacted owed row says its step, or why there is none, on its own line.
    const inlineStep = / Step: (\{"action":"[^}]*\})/.exec(line);
    if (inlineStep !== null) {
      try {
        next = JSON.parse(inlineStep[1] as string) as Record<string, unknown>;
      } catch {
        // Parsed or ignored, never guessed at.
      }
    }
    const inlineObstacle = / Cannot now: (.+?)\.?$/.exec(line);
    if (inlineObstacle !== null) unperformable = inlineObstacle[1];
    for (let following_ = at + 1; following_ < lines.length; following_ += 1) {
      const following = lines[following_] ?? "";
      if (following.startsWith("- ") || !following.startsWith("  ")) break;
      const object = /(\{"action":"[^}]*\})/.exec(following);
      if (next === undefined && object !== null) {
        try {
          next = JSON.parse(object[1] as string) as Record<string, unknown>;
        } catch {
          // A line the row's author wrote is parsed or ignored, never guessed at.
        }
      }
      const found =
        /UNPERFORMABLE now: (.+?)\.?$/.exec(following.trim()) ??
        /You cannot give it now: (.+?)\.?$/.exec(following.trim());
      if (found !== null) unperformable = found[1];
    }
    rows.push({
      thread: match[1] as string,
      other: match[2] as string,
      deadline: Number(match[4]),
      unperformable,
      boon: (match[3] as string).startsWith("your boon on its prayer"),
      petition: /^your boon on its prayer \[(evt-[^\]]+)\]/.exec(
        match[3] as string,
      )?.[1],
      next,
    });
  }
  return rows;
}

/** Who stands here with the god, from the prompt's scene: the mortals, and the gods. */
function sceneOf(prompt: string): {
  mortals: string[];
  at: string | undefined;
} {
  const here =
    prompt.split("Here with you:")[1]?.split("Buildings here:")[0] ?? "";
  const mortals = here.split("\n").flatMap((line) => {
    const match = /^- (\S+)(?: \(a god\))?$/.exec(line);
    return match !== null && !line.includes("(a god)") && match[1] !== "no"
      ? [match[1] as string]
      : [];
  });
  return { mortals, at: PROMPT_PLACE.exec(prompt)?.[1] };
}

/**
 * How a turn an obligated god took is classified, from what its prompt showed
 * and what its proposal did. An acceptance binds (R12, amended 2026-10-03): once
 * a thread is accepted the god performs, waits for a named event, or knowingly
 * risks breach; bargaining is for a thread that is still open, and the world
 * refuses a counter or a withdrawal of an accepted one. The rule, in order:
 *
 * 1. An action the term calls for, committed, is `performed`: telling a
 *    legend or moving toward the place for a legend or a place, a bless for a
 *    blessing, and for a term to stay away from a place any turn that does not
 *    go there.
 * 2. A turn that did something else, or nothing, is `waited for a named event`
 *    when its prompt shows what stops it now, named: the digest's
 *    UNPERFORMABLE obstacle, or, for a legend to be told at the place the god
 *    stands in, no mortal there to hear it (the event is one arriving).
 * 3. Every other turn is `knowingly risked breach`, an attempt to bargain over
 *    the thread included. The obligation led the prompt, so the god saw it.
 */
export function classifyTurn(
  thread: ThreadRecord | undefined,
  row: ObligationRow,
  prompt: string,
  proposal: RealProposal | undefined,
  moved: boolean,
): Pick<ObligatedTurn, "class" | "named" | "choice"> {
  const kind = proposal?.kind;
  const fields = proposal?.proposal ?? {};
  const outcome = proposal?.outcome;
  const choice =
    proposal === undefined || kind === "goal"
      ? "waited"
      : kind === "practice"
        ? `practice ${String(fields.move)}${outcome === "rejected" ? ` (refused: ${proposal.reason})` : ""}`
        : `${kind}${outcome === "rejected" ? ` (refused: ${proposal.reason})` : ""}`;

  const term = thread?.term;
  const committed = outcome === "committed";
  const goes = kind === "move" || kind === "realm-transition";
  // A boon the god owes is performed by the exact step the row showed, and by nothing else that merely looks
  // busy: the bless the row showed, naming the owed prayer; the strike the row showed, on its target; the hop the
  // row gave. A row that showed no step (it named an obstacle) leaves nothing to perform, so no action counts and
  // the digest's own rules apply: a wait the digest names, otherwise a risked breach. The world's own rule that
  // an answer needs an operational building is why a strike on a named building is not enough by itself.
  if (row.boon && committed) {
    const shown = row.next;
    if (
      shown?.action === "bless" &&
      kind === "bless" &&
      fields.petition === shown.petition &&
      fields.petition === row.petition
    ) {
      return { class: "performed", named: undefined, choice };
    }
    if (
      shown?.action === "strike" &&
      kind === "strike" &&
      typeof fields.target === "string" &&
      fields.target === shown.target
    ) {
      return { class: "performed", named: undefined, choice };
    }
    if (
      goes &&
      (shown?.action === "move" || shown?.action === "realm-transition") &&
      fields.to === shown.to
    ) {
      return { class: "performed", named: undefined, choice };
    }
  }
  if (term !== undefined && !row.boon) {
    switch (term.kind) {
      case "tell-legend":
        if (committed && (kind === "legend" || goes)) {
          return { class: "performed", named: undefined, choice };
        }
        break;
      case "be-at":
        if (committed && goes) {
          return { class: "performed", named: undefined, choice };
        }
        break;
      case "bless-mortal":
        if (committed && kind === "bless") {
          return { class: "performed", named: undefined, choice };
        }
        break;
      case "stay-away":
        if (!(goes && fields.to === term.place && committed)) {
          return { class: "performed", named: undefined, choice };
        }
        return { class: "knowingly risked breach", named: undefined, choice };
      default:
        break;
    }
  }

  if (row.unperformable !== undefined) {
    return {
      class: "waited for a named event",
      named: `the obstacle its digest names: ${row.unperformable}`,
      choice,
    };
  }
  if (term?.kind === "tell-legend" && !moved) {
    const scene = sceneOf(prompt);
    if (scene.at === term.place && scene.mortals.length === 0) {
      return {
        class: "waited for a named event",
        named: `a mortal to arrive at ${term.place}`,
        choice,
      };
    }
  }
  return { class: "knowingly risked breach", named: undefined, choice };
}

/** The obligated gods' turns: every request whose prompt led with an obligation, classified, and every one that cannot be. */
export function obligatedTurns(
  input: RealInput,
  threads: readonly ThreadRecord[],
  gods: ReadonlySet<string>,
): ObligatedTurns {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const proposals = new Map(input.proposals.map((p) => [p.proposalId, p]));
  // The tick the world first saw each supplication's boon: from then on the god owes none.
  const boonSeenAt = new Map<string, number>();
  for (const event of input.events) {
    if (event.kind === "practice-progressed" && event.step === "boon") {
      boonSeenAt.set(String(event.threadId), Number(event.tick));
    }
  }
  const turns: ObligatedTurn[] = [];
  const unrecorded: UnrecordedTurn[] = [];
  for (const request of input.requests) {
    if (!gods.has(request.role) || request.promptPayload === undefined)
      continue;
    const prompt = request.promptPayload;
    const tick = Number(PROMPT_TICK.exec(prompt)?.[1]);
    const rows = obligationRows(prompt);

    // The world says which obligations were open to this god at this tick: a
    // prompt that did not lead with one has not recorded what the god chose
    // about it.
    for (const thread of threads) {
      if (
        thread.status === "open" ||
        thread.status === "countered" ||
        thread.acceptedTick === undefined ||
        // The god owes what its term says it performs, and, on a supplication it set terms on, its boon until the world sees it.
        !(
          thread.term.party === request.role ||
          // The prompt owes the row through the deadline tick and not after (`owedBoonOf`), so the gate expects it on the same terms.
          (thread.practice === "supplication" &&
            thread.demander === request.role &&
            tick <= thread.term.deadline &&
            tick <= (boonSeenAt.get(thread.id) ?? Number.POSITIVE_INFINITY) - 1)
        ) ||
        Number.isNaN(tick) ||
        !(thread.acceptedTick < tick) ||
        (thread.ending !== undefined && thread.ending.tick < tick)
      ) {
        continue;
      }
      if (!rows.some((row) => row.thread === thread.id)) {
        unrecorded.push({
          god: request.role,
          thread: thread.id,
          why: `the prompt at tick ${tick} did not lead with the obligation the world held open`,
        });
      }
    }
    if (request.outcome !== "intent") continue;
    for (const row of rows) {
      const thread = byId.get(row.thread);
      const proposal =
        request.proposalId === undefined
          ? undefined
          : proposals.get(request.proposalId);
      if (request.proposalId !== undefined && proposal === undefined) {
        unrecorded.push({
          god: request.role,
          thread: row.thread,
          why: `the proposal ${request.proposalId} behind this turn is not in the journal`,
        });
        continue;
      }
      const scene = sceneOf(prompt);
      const moved =
        scene.at !== undefined &&
        thread?.term.kind === "tell-legend" &&
        scene.at !== thread.term.place;
      const classified = classifyTurn(thread, row, prompt, proposal, moved);
      turns.push({
        god: request.role,
        thread: row.thread,
        tick: Number.isNaN(tick) ? undefined : tick,
        deadline: row.deadline,
        ...classified,
      });
    }
  }
  return { turns, unrecorded };
}

// --- Properties ------------------------------------------------------------------------------

const sameSubject = (
  a: ThreadRecord["subject"],
  b: ThreadRecord["subject"],
): boolean =>
  a !== undefined &&
  b !== undefined &&
  a.agent === b.agent &&
  a.target === b.target;

const pairOf = (thread: ThreadRecord) =>
  [thread.demander, thread.obligated].sort().join("|");

/** Which gods took part in a run: those that were asked for a turn or proposed anything. */
export function godsOf(input: RealInput): Set<string> {
  return new Set([
    ...input.requests.map((request) => request.role),
    ...input.proposals.map((proposal) => proposal.actor),
  ]);
}

function godThreadEndings(
  threads: readonly ThreadRecord[],
  gods: ReadonlySet<string>,
): Property {
  const name = "god thread endings";
  const lines: string[] = [];
  let ok = gods.size > 0;
  for (const god of [...gods].sort()) {
    const caused = threads.filter(
      (thread) =>
        causedBy(thread, gods).includes(god) &&
        persistentChanges(thread).length > 0,
    );
    if (caused.length === 0) ok = false;
    lines.push(
      `${god}: ${caused.length === 0 ? "no thread ending it caused left a persistent consequence" : `${caused.length} (${caused.map((thread) => `${thread.ending?.outcome} [${thread.id}]`).join(", ")})`}`,
    );
  }
  return {
    name,
    ok,
    detail: threads.length === 0 ? "no thread was opened" : lines.join("; "),
  };
}

function threadEndingsRecorded(
  threads: readonly ThreadRecord[],
  now: number,
): Property {
  const name = "thread endings recorded";
  const problems: string[] = [];
  for (const thread of threads) {
    if (thread.ending === undefined) {
      const due =
        thread.status === "accepted"
          ? thread.term.deadline
          : thread.negotiationDeadline;
      if (now > due) {
        problems.push(
          `${thread.id} is still ${thread.status} at tick ${now}, past its deadline ${due}, with no ending recorded`,
        );
      }
    } else if (thread.rememberedBy.length === 0) {
      problems.push(
        `${thread.id} ended ${thread.ending.outcome} and no party remembers how`,
      );
    }
  }
  const ended = threads.filter((thread) => thread.ending !== undefined).length;
  return {
    name,
    ok: problems.length === 0,
    detail:
      problems.length === 0
        ? `${threads.length} threads: ${ended} ended with their parties remembering, ${threads.length - ended} still open and inside their deadlines`
        : problems.join("; "),
  };
}

function practicesRun(threads: readonly ThreadRecord[]): Property {
  const name = "supplication and settlement";
  const supplications = threads.filter((t) => t.practice === "supplication");
  const settlements = threads.filter((t) => t.practice === "settlement");
  const hard = threads.filter(
    (t) => t.ending?.outcome === "refused" || t.ending?.outcome === "breached",
  );
  return {
    name,
    ok: supplications.length > 0 && settlements.length > 0 && hard.length > 0,
    detail: `${supplications.length} supplications, ${settlements.length} settlements, ${hard.length} refused or breached${hard.length === 0 ? "" : ` (${hard.map((t) => `${t.ending?.outcome} [${t.id}]`).join(", ")})`}`,
  };
}

function noReopening(
  threads: readonly ThreadRecord[],
  events: readonly WorldEvent[],
): Property {
  const name = "no reopening without a new cause";
  const problems: string[] = [];
  const settlements = threads.filter((t) => t.practice === "settlement");
  for (const later of settlements) {
    const affair = settlements.filter(
      (earlier) =>
        earlier.openedSequence < later.openedSequence &&
        pairOf(earlier) === pairOf(later) &&
        (earlier.causes.some((cause) => later.causes.includes(cause)) ||
          sameSubject(earlier.subject, later.subject)),
    );
    if (affair.length === 0) {
      if (later.succeeds !== undefined) {
        const linked = threads.find((t) => t.id === later.succeeds);
        if (linked === undefined || pairOf(linked) !== pairOf(later)) {
          problems.push(
            `${later.id} claims to succeed ${later.succeeds}, which is not a thread between the same two gods`,
          );
        }
      }
      continue;
    }
    const openOne = affair.find(
      (earlier) =>
        earlier.ending === undefined ||
        earlier.ending.sequence > later.openedSequence,
    );
    if (openOne !== undefined) {
      problems.push(
        `${later.id} opened on the matter of ${openOne.id} while ${openOne.id} was still open`,
      );
      continue;
    }
    const latest = affair.at(-1) as ThreadRecord;
    const consumed = new Set(affair.flatMap((earlier) => [...earlier.causes]));
    const reused = later.causes.filter((cause) => consumed.has(cause));
    if (reused.length > 0) {
      problems.push(
        `${later.id} reopens ${latest.id} on a cause it already consumed (${reused.join(", ")})`,
      );
      continue;
    }
    // The demander learned the cause after the closed thread opened: a memory
    // of it recorded since. A need or a loss has no such memory and is as new
    // as the world says.
    const learned = events.filter(
      (event) =>
        event.kind === "memory-recorded" &&
        event.entityId === later.demander &&
        later.causes.some(
          (cause) =>
            event.sourceEventId === cause ||
            (event.memoryKind === "told" && event.linkedEventId === cause),
        ),
    );
    if (
      learned.length > 0 &&
      Math.max(...learned.map((event) => event.sequence)) <=
        latest.openedSequence
    ) {
      problems.push(
        `${later.id} reopens ${latest.id} on a cause ${later.demander} had learned before ${latest.id} opened`,
      );
      continue;
    }
    if (later.succeeds !== latest.id) {
      problems.push(
        `${later.id} reopens the matter of ${latest.id} without linking it as its predecessor`,
      );
    }
  }
  const linked = settlements.filter((t) => t.succeeds !== undefined).length;
  return {
    name,
    ok: problems.length === 0,
    detail:
      problems.length === 0
        ? `${settlements.length} settlements, ${linked} opened as linked successors on a newer cause, none reopened a closed matter on an old one`
        : problems.join("; "),
  };
}

const ADVANCING = new Set([
  "practice-opened",
  "practice-moved",
  "practice-ended",
  "practice-progressed",
]);

function noProgressAdvancesNothing(
  moves: readonly NoProgressMove[],
  threads: readonly ThreadRecord[],
  events: readonly WorldEvent[],
): Property {
  const name = "no-progress moves advance nothing";
  const problems: string[] = [];
  for (const move of moves) {
    const advanced = events.filter(
      (event) =>
        ADVANCING.has(event.kind) &&
        (event.correlationId as string) === move.observationId,
    );
    if (advanced.length > 0) {
      problems.push(
        `${move.actor}'s ${move.attempted} was rejected as no-progress and yet ${advanced.map((e) => `${e.kind} [${e.id}]`).join(", ")} followed from it`,
      );
    }
    if (!move.recorded) {
      problems.push(
        `${move.actor}'s ${move.attempted} was rejected as no-progress and no refusal was recorded for the god's next prompt`,
      );
    }
  }
  // A counter that restates an offer already on the table is the same move
  // again: it must never have committed.
  for (const thread of threads) {
    const seen = new Set<string>();
    for (const event of events) {
      if (event.kind === "practice-opened" && event.id === thread.id) {
        seen.add(termTuple(event.term, event.tick));
      } else if (
        event.kind === "practice-moved" &&
        event.threadId === thread.id &&
        event.move === "counter"
      ) {
        const tuple = termTuple(event.term, event.tick);
        if (seen.has(tuple)) {
          problems.push(
            `${thread.id}: ${event.entityId}'s counter [${event.id}] restated an offer already made, and committed`,
          );
        }
        seen.add(tuple);
      }
    }
  }
  return {
    name,
    ok: problems.length === 0,
    detail:
      problems.length === 0
        ? `${moves.length} moves judged no progress, each leaving a refusal record and advancing no thread; no counter restated an earlier offer`
        : problems.join("; "),
  };
}

interface Consequence {
  readonly god: string;
  readonly sequence: number;
  readonly endingId: string;
}

/** The recorded consequences of thread endings, by the god they fell on: a motif's change, or a feeling an ending's memory moved. */
export function consequencesOf(
  threads: readonly ThreadRecord[],
  events: readonly WorldEvent[],
): Consequence[] {
  const endingIds = new Map(
    threads.flatMap((t) =>
      t.ending === undefined ? [] : [[t.id, t.ending.eventId] as const],
    ),
  );
  const memoryEnding = new Map<string, string>();
  for (const event of events) {
    if (
      event.kind === "memory-recorded" &&
      event.memoryKind === "witnessed" &&
      event.ending !== undefined
    ) {
      memoryEnding.set(event.id, event.sourceEventId);
    }
  }
  const found: Consequence[] = [];
  for (const event of events) {
    if (event.kind === "motif-applied") {
      const endingId = endingIds.get(event.threadId);
      if (endingId !== undefined) {
        found.push({ god: event.entityId, sequence: event.sequence, endingId });
      }
    } else if (event.kind === "relationship-changed") {
      const endingId = memoryEnding.get(event.memoryEventId);
      if (endingId !== undefined) {
        found.push({ god: event.entityId, sequence: event.sequence, endingId });
      }
    }
  }
  return found;
}

function committedActions(
  god: string,
  input: RealInput,
  events: readonly WorldEvent[],
) {
  return input.proposals
    .filter(
      (p) => p.actor === god && p.outcome === "committed" && p.kind !== "goal",
    )
    .flatMap((proposal) => {
      const first = events.find(
        (e) => (e.correlationId as string) === proposal.observationId,
      );
      return first === undefined
        ? []
        : [
            {
              proposal,
              sequence: first.sequence,
              key: `${proposal.kind}:${String(proposal.proposal.move ?? proposal.proposal.to ?? proposal.proposal.target ?? proposal.proposal.listener ?? "")}`,
            },
          ];
    })
    .sort((a, b) => a.sequence - b.sequence);
}

function consequenceChangesChoice(
  threads: readonly ThreadRecord[],
  input: RealInput,
  events: readonly WorldEvent[],
  gods: ReadonlySet<string>,
): Property {
  const name = "consequence changes a later choice";
  const requests = new Map(
    input.requests.flatMap((r) =>
      r.proposalId ? [[r.proposalId, r] as const] : [],
    ),
  );
  const consequences = consequencesOf(threads, events);
  const lines: string[] = [];
  let ok = false;
  for (const god of [...gods].sort()) {
    const mine = consequences.filter((c) => c.god === god);
    const first = mine[0];
    if (first === undefined) continue;
    const actions = committedActions(god, input, events);
    const before = actions.filter((a) => a.sequence < first.sequence).at(-1);
    const after = actions.find((a) => a.sequence > first.sequence);
    if (before === undefined || after === undefined) {
      lines.push(
        `${god}: a consequence at ${first.sequence}, but no committed action on both sides of it`,
      );
      continue;
    }
    const prompt = requests.get(after.proposal.proposalId)?.promptPayload ?? "";
    const shown = mine
      .filter((c) => c.sequence < after.sequence)
      .some((c) => prompt.includes(`[${c.endingId}]`));
    const differs = before.key !== after.key;
    if (differs && shown) ok = true;
    lines.push(
      `${god}: ${before.key} before the consequence, ${after.key} after (${differs ? "changed" : "same"}); the prompt behind it ${shown ? "showed how the thread ended" : "did not show how the thread ended"}`,
    );
  }
  return {
    name,
    ok,
    detail:
      lines.length === 0
        ? "no thread ending left a consequence on a god"
        : lines.join("; "),
  };
}

function obligatedTurnsRecorded(turns: ObligatedTurns): Property {
  const name = "obligated turns recorded";
  const counts = new Map<string, number>();
  for (const turn of turns.turns) {
    counts.set(turn.class, (counts.get(turn.class) ?? 0) + 1);
  }
  const summary = [...counts.entries()]
    .map(([klass, n]) => `${n} ${klass}`)
    .join(", ");
  return {
    name,
    ok: turns.unrecorded.length === 0,
    detail:
      turns.unrecorded.length === 0
        ? turns.turns.length === 0
          ? "no obligation led a prompt, so no obligated turn was taken"
          : `${turns.turns.length} obligated turns, each with its recorded choice: ${summary}`
        : turns.unrecorded
            .map((u) => `${u.god}'s turn on ${u.thread}: ${u.why}`)
            .join("; "),
  };
}

/** Everything the practice analysis finds, for the transcript and the properties. */
export interface PracticeAnalysis {
  readonly threads: readonly ThreadRecord[];
  readonly open: readonly OpenThread[];
  readonly noProgress: readonly NoProgressMove[];
  readonly obligated: ObligatedTurns;
  readonly now: number;
  readonly properties: readonly Property[];
}

/**
 * Every contest ends with a standing change or expires (R16). A decided contest changed both gods' standing
 * at its place for good, the winner's up and the other's down, each citing the closing; an expired one
 * changed no one's; one with no ending is only allowed to be inside its window. A run with no contest holds
 * this vacuously: the scripted story is what requires one to have happened.
 */
export function contestEndingsRecorded(
  events: readonly WorldEvent[],
  now: number,
): Property {
  const name = "contest endings";
  const opened = events.filter(
    (e): e is Extract<WorldEvent, { kind: "contest-opened" }> =>
      e.kind === "contest-opened",
  );
  if (opened.length === 0) {
    return { name, ok: true, detail: "no contest was opened" };
  }
  const closings = new Map(
    events
      .filter(
        (e): e is Extract<WorldEvent, { kind: "contest-closed" }> =>
          e.kind === "contest-closed",
      )
      .map((e) => [e.contestId as string, e]),
  );
  const standingAfter = (closing: string) =>
    events.filter(
      (
        e,
      ): e is Extract<
        WorldEvent,
        { kind: "motif-applied"; effect: "standing" }
      > =>
        e.kind === "motif-applied" &&
        e.effect === "standing" &&
        e.cause === closing,
    );
  const problems: string[] = [];
  let decided = 0;
  let expired = 0;
  let open = 0;
  for (const contest of opened) {
    const closing = closings.get(contest.id as string);
    if (closing === undefined) {
      if (now > contest.closesAt) {
        problems.push(
          `${contest.id} is still open at tick ${now}, past its window closing at tick ${contest.closesAt}, with no ending recorded`,
        );
      } else {
        open += 1;
      }
      continue;
    }
    const changes = standingAfter(closing.id as string);
    if (closing.result === "expired") {
      expired += 1;
      if (changes.length > 0) {
        problems.push(
          `${contest.id} expired (${closing.reason}) yet ${closing.id} changed standing`,
        );
      }
      continue;
    }
    decided += 1;
    const loser =
      closing.winner === closing.entityId ? closing.rival : closing.entityId;
    const won = changes.find(
      (c) =>
        c.entityId === closing.winner &&
        c.delta > 0 &&
        c.place === closing.place,
    );
    const lost = changes.find(
      (c) => c.entityId === loser && c.delta < 0 && c.place === closing.place,
    );
    if (changes.length === 0) {
      problems.push(
        `${contest.id} was decided for ${closing.winner} and left no standing change`,
      );
    } else if (
      won === undefined ||
      lost === undefined ||
      changes.length !== 2
    ) {
      problems.push(
        `${contest.id} was decided for ${closing.winner} but its standing changes are not the winner's rise and the other's fall at ${closing.place}`,
      );
    }
  }
  return {
    name,
    ok: problems.length === 0,
    detail:
      problems.length > 0
        ? problems.join("; ")
        : `${opened.length} contest${opened.length === 1 ? "" : "s"}: ${decided} decided, ${expired} expired, ${open} open inside its window`,
  };
}

export function analyzePractices(input: RealInput): PracticeAnalysis {
  const events = parseAll(input.events);
  const gods = godsOf(input);
  const threads = buildThreads(events);
  const now = lastTick(events);
  const noProgress = noProgressMoves(input.proposals, events);
  const obligated = obligatedTurns(input, threads, gods);
  return {
    threads,
    open: openThreads(threads, now),
    noProgress,
    obligated,
    now,
    properties: [
      godThreadEndings(threads, gods),
      practicesRun(threads),
      threadEndingsRecorded(threads, now),
      noReopening(threads, events),
      noProgressAdvancesNothing(noProgress, threads, events),
      consequenceChangesChoice(threads, input, events, gods),
      obligatedTurnsRecorded(obligated),
      contestEndingsRecorded(events, now),
    ],
  };
}

/** The event ids that ended threads: what a thread with no ending is missing. */
export const endingEventIds = (threads: readonly ThreadRecord[]): EventId[] =>
  threads.flatMap((t) =>
    t.ending === undefined ? [] : [t.ending.eventId as EventId],
  );
