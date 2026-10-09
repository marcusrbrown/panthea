// A god's practice threads as its prompt shows them, and the one flat intent it
// answers them with. Built from world state the way petitions are: the digest
// is the god's own view (its role, the cause as it knows it, the legal
// responses, the deadline), never the other party's private goal or evidence.
//
// The digest is the last section of the prompt, just before the question: it
// changes every tick, and a request is ordered from what never changes to what
// does. Obligations the god owes and threads awaiting
// its answer always appear, compressed when the budget runs short; only the
// other open threads are cut. The intent is one flat object: a move, a thread
// or a cause, and one term picked from the closed checkable set. The parser is
// the source of truth for which (move, thread) pairs are legal.

import {
  createObservationId,
  type EntityId,
  type EventId,
  type PracticeProposal,
  type PracticeRefusedEvent,
  type PracticeTerm,
  type PracticeTermOffer,
  type ServiceKind,
} from "@panthea/contracts";
import {
  type ActorState,
  blessability,
  canStillPerform,
  contestableActs,
  contestableDefections,
  favourOf,
  getActor,
  getMemories,
  inAnswerWindow,
  isThreadOpen,
  type MemoryEntry,
  openPetitionsFor,
  type Petition,
  type PracticeThread,
  petitionBalanceOf,
  practiceBalanceOf,
  termObstacle,
  termTuple,
  validatePractice,
  type WorldState,
} from "@panthea/world";
import type { ParseResult } from "./config";

/** The heading of the practice digest, the last section of a god's prompt before the question: found by it (with the dashed and indented lines under it) wherever a prompt is checked for a thread. */
export const PRACTICES_HEADING = "Your open practices:";

/** Characters of digest shown in full. Rows beyond it are compressed, and only threads that need nothing from this god are cut. */
export const DIGEST_BUDGET_CHARS = 1600;

/**
 * Characters the prayers section may use, heading and the closing "and N more" line included. A
 * crowd of prayers is the one section that grows without bound. Measured on qwen3-8b-4k (Ollama's
 * `prompt_eval_count`, 2026-10-05) at 3.3 to 3.8 characters a token: the busiest routine-town prompt
 * is 8,845 characters and 2,554 tokens, and the busiest crowded one, with the town's wrongs and the gods' troubles in, 10,046 and 2,870.
 * A prayer with its choices (set terms, punish, demand redress, refuse, let it be) is about 700
 * characters, so 3,000 holds four with a live practice's prayers never cut: some 1,200 tokens under
 * the point where Ollama silently drops the start of a prompt (about 4,090). A prayer a live practice names is never cut.
 */
export const PRAYERS_BUDGET_CHARS = 3000;

/**
 * The heading of the contests section: the contests the god is in and the rival acts it may open one over, as
 * choices. Found by it (with the dashed and indented lines under it) wherever a prompt is checked.
 */
export const CONTESTS_HEADING = "Contests for a place's people:";

/**
 * Characters the contests section may use, heading and the closing "and N more" line included. Measured on
 * qwen3-8b-4k at about 3.3 characters a token, the prompt of the busiest god is about 8,500 characters and
 * 2,500 tokens, and Ollama silently drops the start of a prompt past about 4,090 tokens; 600 characters
 * (two held contests and two or three acts, each with its copyable object) adds under 200 tokens.
 */
export const CONTESTS_BUDGET_CHARS = 600;

/**
 * Tokens a god's whole request (instructions and prompt, with room for a retry's feedback) may take. Chosen
 * for latency (owner, 2026-10-08): on granite3.3-8b-4k a request took about 8.5 s under 3,000 tokens and 16.4 s
 * above 3,500. Ollama silently drops the start of a prompt past about 4,090 tokens at a 4K context, so the cap
 * leaves some 1,090 under that point. Counted with the smallest characters-per-token ratio on the role's route
 * (`prompt-cap.ts`), measured on local Ollama. The sections above keep their own budgets; this bounds the sum.
 */
export const PROMPT_TOKEN_CAP = 3000;

/** The answers a thread can take from the god. A demand opens one and is not an answer. */
export type AnswerMove = "accept" | "counter" | "refuse" | "withdraw";

/** Where a thread stands for this god: owed by it, awaiting its answer, or waiting on someone else. */
export type Standing = "obligation" | "awaiting" | "other";

/** The boon a god owes on an accepted supplication, and the next step toward giving it. */
export interface OwedBoon {
  readonly petition: EventId;
  /** The mortal who prayed and agreed to the terms. */
  readonly petitioner: EntityId;
  /** Where the mortal stands now. */
  readonly place: EntityId;
  readonly placeName: string;
  /** Whether the mortal's offering has been made. */
  readonly offeringMade: boolean;
  /**
   * The next concrete step, as the object the god would send: the bless when it is with the mortal and the
   * world would take it, else travel to where the mortal stands. Absent when there is none to show, and then
   * `blocked` says why. Never an object the parser or the world would refuse.
   */
  readonly next?:
    | {
        readonly kind: "bless";
        readonly intent: Readonly<Record<string, unknown>>;
      }
    | {
        readonly kind: "strike";
        readonly intent: Readonly<Record<string, unknown>>;
      };
  readonly blocked?: string;
  /**
   * For a punish prayer, whose boon is a strike: the building the next step strikes and where it stands. Absent when
   * the step strikes the wrongdoer itself (no listed building can be struck). Either is struck from wherever the god
   * stands, so no way there is shown.
   */
  readonly building?: {
    readonly id: EntityId;
    readonly name: string;
    readonly place: EntityId;
    readonly placeName: string;
  };
  /** Whether the boon is a strike (a punish prayer), so a god that cannot strike cannot give it. */
  readonly strikes?: true;
}

/** One open thread the god is a party to, resolved for the prompt and the builder. */
export interface ThreadView {
  readonly id: EventId;
  readonly standing: Standing;
  readonly self: EntityId;
  readonly other: EntityId;
  readonly status: "open" | "countered" | "accepted";
  /** The thread's revision when the view was read: the one thing a move on it pins. */
  readonly revision: number;
  readonly term: PracticeTerm;
  /** The last answered move, from the thread's own fields. */
  readonly lastMove: string;
  /** The cause as this god knows it; a cause it holds no account of is said to be unknown. */
  readonly cause: string;
  readonly negotiationDeadline: number;
  readonly counterBudgetLeft: number;
  /** The tick the view was read at: deadlines are shown as ticks left. */
  readonly tick: number;
  /** The prayer a supplication answers, and which halves of its bargain the world has seen done. Absent on a settlement. */
  readonly supplication?: {
    readonly petition: EventId;
    readonly boonGiven: boolean;
    readonly offeringMade: boolean;
  };
  /**
   * A supplication this god set terms on that the mortal accepted, whose boon the world has not yet seen: the
   * god's own obligation, though the term's party is the mortal paying for it. Its view stands as an
   * `obligation`, so the digest never cuts it and no new bargain is offered while it is owed.
   */
  readonly owedBoon?: OwedBoon;
  /** The answers this god may give now. */
  readonly moves: readonly AnswerMove[];
  /** Each of those answers written out in the intent the god would send, for the answers the world would take as written. A counter is the standing term with a different deadline. */
  readonly intents: Readonly<
    Partial<Record<AnswerMove, Readonly<Record<string, unknown>>>>
  >;
  /** Whether this god may swear its acceptance: only the god who must perform the term may. */
  readonly canSwear: boolean;
  /** Why an obligation of this god's cannot be performed now, when it cannot. */
  readonly unperformable?: string;
  /** Why the world judged the god's last move on this thread to make no progress. Unit 3 fills it. */
  readonly noProgress?: string;
}

/** A refused practice move, as the god's prompt tells it: what it tried and why the world would not take it, in words that name nothing the god was not shown. */
export interface PracticeRefusalView {
  readonly attempted: PracticeRefusedEvent["attempted"];
  readonly reason: PracticeRefusedEvent["reason"];
  readonly thread?: EventId;
  readonly text: string;
}

/** What a refusal other than no-progress says: only what the god can act on. The world's own message is never shown for these, since it may name what the god has no way to know. */
const REFUSAL_WORDS: Readonly<Record<string, string>> = {
  "stale-target": "the thread changed while you were deciding",
  malformed: "the world would not take that move now",
  "unauthorized-claim": "you may not make that move",
  "insufficient-resources": "you cannot afford that term",
  "insufficient-power": "you lack the power that term needs",
  "dead-actor": "someone in it is no longer living",
  "not-adjacent": "you cannot reach that by its deadline",
  "restricted-realm": "you cannot enter where that needs you to be",
  "busy-actor": "you had already acted this tick",
  "counterparty-declined": "the other side declined",
};

/** The refusal as the prompt tells it. A no-progress refusal says what already answered the move, which the world built from the thread itself. */
export function refusalView(event: PracticeRefusedEvent): PracticeRefusalView {
  return {
    attempted: event.attempted,
    reason: event.reason,
    ...(event.thread === undefined ? {} : { thread: event.thread }),
    text:
      event.reason === "no-progress"
        ? (event.why ?? "that made no progress")
        : (REFUSAL_WORDS[event.reason] ?? "the world refused it"),
  };
}

/** A cause the god may open a demand on: an event it remembers, with the memory that says so. */
export interface DemandCause {
  readonly id: EventId;
  readonly memoryId: EventId;
  readonly text: string;
  /** The fact an observation cites for it when it is not a memory: the prayer that told the god of it. */
  readonly fact?: string;
}

/** What a term may name, from the world the god can know of: the other gods, the places on the map, the mortals it was shown, the resources that exist. */
export interface PracticeOptions {
  readonly gods: readonly EntityId[];
  readonly places: readonly EntityId[];
  readonly mortals: readonly EntityId[];
  readonly resources: readonly string[];
  readonly minTicks: number;
  readonly maxTicks: number;
  readonly causes: readonly DemandCause[];
  /** Prayers addressed to this god it may set terms on: open, in their window, with no terms standing, from a petitioner still living. */
  readonly offerable: readonly OfferablePrayer[];
  /** The stakes the world authored, by id: what a mortal becomes if it takes a god's boon and breaks the term. */
  readonly stakes: readonly { readonly id: string; readonly form: string }[];
  /** For each prayer the god may set terms on that the world would take terms on, the offer written out in the intent the god would send. */
  readonly offerTerms: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
  /** For each prayer addressed to the god that tells of harm another god did its worshipper, the demand for redress the world would take, written out in the intent the god would send. The harm is also a cause the god may demand over (`causes`). */
  readonly redress: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** At most two bargains the god could begin, each legal as written; empty while a thread needs the god's answer or performance. */
  readonly openings: readonly Opening[];
  /** The rival acts the god may open a contest over and the prompt shows, newest first, within `CONTESTS_BUDGET_CHARS`: the schema and the parser name these and no others. Empty while a thread needs the god's answer or performance. */
  readonly contests: readonly ContestAct[];
  /** How many such acts the budget left out. */
  readonly moreActs: number;
  /** The open contests the god is in, newest first (at most two). */
  readonly heldContests: readonly HeldContest[];
}

/** One bargain the god could begin, written out in the intent it would send. The world has already said it would take it. */
export interface Opening {
  readonly kind: "demand" | "offer";
  /** What it rests on, in the god's own terms: the account it knows, or whose prayer. */
  readonly label: string;
  readonly intent: Readonly<Record<string, unknown>>;
}

/** A rival's act the god perceived and may open a contest over: the world has already said it would take it. */
export interface ContestAct {
  readonly id: EventId;
  /** The rival that did it: for a defection, the god the mortal went to. */
  readonly god: EntityId;
  readonly place: EntityId;
  readonly placeName: string;
  readonly kind: ServiceKind | "defection";
  /** What it was, in words, for a defection (a rival's act is told by its kind). */
  readonly text?: string;
}

/** A contest the god is in, as it sees it: where, against whom, until when, and how many mortals favour each of you so far. */
export interface HeldContest {
  readonly id: EventId;
  readonly place: EntityId;
  readonly placeName: string;
  readonly rival: EntityId;
  readonly closesAt: number;
  readonly mine: number;
  readonly theirs: number;
}

/** A prayer a god may answer with terms. */
export interface OfferablePrayer {
  readonly id: EventId;
  readonly petitioner: EntityId;
}

export const NO_PRACTICE: PracticeOptions = {
  gods: [],
  places: [],
  mortals: [],
  resources: [],
  minTicks: 1,
  maxTicks: 1,
  causes: [],
  offerable: [],
  stakes: [],
  offerTerms: {},
  redress: {},
  openings: [],
  contests: [],
  moreActs: 0,
  heldContests: [],
};

/** Whether a witnessed memory's event kind is a thread's ending, which its parties remember though no one stood at it. */
export function isEndingKind(kind: string): boolean {
  return kind === "practice-moved" || kind === "practice-ended";
}

/**
 * How a thread ended, as its party remembers it: what happened and who decided
 * it, in the party's own terms ("you", or the other god's id). A memory held
 * from before outcomes were kept says only that a practice ended.
 */
export function describeEnding(
  memory: Extract<MemoryEntry, { kind: "witnessed" }>,
  self: EntityId | undefined,
): string {
  const parties = memory.subjects;
  const other = parties.find((party) => party !== self);
  const { ending } = memory;
  if (ending === undefined || self === undefined || other === undefined) {
    return `A practice between ${parties.join(" and ")} ended`;
  }
  const who = (id: EntityId) => (id === self ? "you" : id);
  const agent = ending.agent;
  const toward = (id: EntityId) => (id === self ? other : "you");
  const term = `${ending.sworn === true ? "sworn " : ""}term`;
  switch (ending.outcome) {
    case "refused":
      return agent === undefined
        ? `the practice with ${other} ended refused: no counteroffers were left`
        : `${who(agent)} refused ${agent === self ? `${other}'s` : "your"} offer`;
    case "withdrawn":
      return agent === undefined
        ? `the practice with ${other} ended: a party died`
        : `${who(agent)} withdrew from the practice with ${toward(agent)}`;
    case "expired":
      return `your practice with ${other} expired unanswered`;
    case "fulfilled":
      if (ending.sealed === true) return `you and ${other} sealed an alliance`;
      return agent === undefined
        ? `the practice with ${other} was fulfilled`
        : `${who(agent)} fulfilled the ${term} to ${toward(agent)}`;
    case "breached":
      return agent === undefined
        ? `the practice with ${other} was breached`
        : `${who(agent)} breached the ${term} to ${toward(agent)}`;
  }
}

/**
 * What one memory says about the event it rests on, in the god's own terms. A
 * told account is named, not quoted: its words are in the memory section of the
 * prompt, and quoting them again here would carry a teller's words into a line
 * the privacy checks do not recognize as a told account.
 */
function describeBasis(memory: MemoryEntry, self: EntityId): string {
  switch (memory.kind) {
    case "witnessed":
      return isEndingKind(memory.eventKind)
        ? describeEnding(memory, self)
        : `you saw ${memory.eventKind} (${memory.subjects.join(", ")})`;
    case "told":
      return `${memory.teller} told you of it`;
    case "noticed":
      return `you noticed a loss (${memory.subjects.join(", ")})`;
    case "sign":
      return `${memory.god} ${memory.outcome === "answered" ? "answered" : "did not answer"} a petition`;
    case "patronage":
      return `${memory.mortal} of ${memory.home} left ${memory.from} for ${memory.to}`;
  }
}

/** The event a memory is evidence of: the one a told memory cites, else the event it rests on. */
function basisOf(memory: MemoryEntry): EventId | undefined {
  switch (memory.kind) {
    case "witnessed":
      return memory.sourceEventId;
    case "told":
      return memory.linkedEventId ?? memory.sourceEventId;
    case "noticed":
      return memory.causeEventId;
    case "sign":
      return undefined;
    case "patronage":
      return memory.sourceEventId;
  }
}

/** Whether `memory` is evidence of `cause`, by the rule the world's `knowsCause` applies. */
const evidences = (memory: MemoryEntry, cause: EventId) =>
  memory.sourceEventId === cause ||
  (memory.kind === "told" && memory.linkedEventId === cause) ||
  (memory.kind === "noticed" && memory.causeEventId === cause);

/** The causes a god may open a demand on: what the memories its prompt shows are evidence of. */
export function demandCauses(
  shown: readonly MemoryEntry[],
  self: EntityId,
): readonly DemandCause[] {
  const causes = new Map<EventId, DemandCause>();
  for (const memory of shown) {
    const id = basisOf(memory);
    if (id === undefined || causes.has(id)) continue;
    causes.set(id, {
      id,
      memoryId: memory.id,
      text: describeBasis(memory, self),
    });
  }
  return [...causes.values()];
}

/** The term in words, from the god's side: "you" for itself. */
export function describeTerm(term: PracticeTerm, self: EntityId): string {
  const who = (id: EntityId) => (id === self ? "you" : id);
  const party = who(term.party);
  switch (term.kind) {
    case "tell-legend":
      return `${party} must tell a legend to the mortals at ${term.place}`;
    case "be-at":
      return `${party} must be at ${term.place}`;
    case "stay-away":
      return `${party} must stay away from ${term.place}`;
    case "give-resource":
      return `${party} must give ${who(term.to)} ${term.amount} ${term.resource}`;
    case "bless-mortal":
      return `${party} must bless ${term.mortal}`;
    case "make-offering":
      return `${party} must offer ${who(term.to)} ${term.amount} ${term.resource}`;
    case "ally":
      return `${party} must ally with ${who(term.to)}`;
  }
}

/** The cause of a thread as `self` knows it: its own memory of it, or that it holds none. */
function causeAsKnown(
  state: WorldState,
  self: EntityId,
  demander: EntityId,
  causes: readonly EventId[],
): string {
  const memories = getMemories(state, self);
  const known = causes.flatMap((cause) => {
    const memory = memories.find((m) => evidences(m, cause));
    return memory === undefined
      ? []
      : [`${describeBasis(memory, self)} [${cause}]`];
  });
  if (known.length > 0) return known.join("; ");
  return `${demander === self ? "you cite" : `${demander} cites`} an event; you hold no account of it`;
}

/**
 * The boon `actorId` owes on `thread`, or `undefined` when it owes none: an open, accepted supplication this
 * god set terms on, still inside its deadline, whose boon the world has not yet seen (a bless to the
 * petitioner after the acceptance and by the deadline is what it counts, and it records it as it comes).
 */
function owedBoonOf(
  state: WorldState,
  actorId: EntityId,
  thread: PracticeThread,
): OwedBoon | undefined {
  if (
    thread.practice !== "supplication" ||
    thread.status !== "accepted" ||
    thread.petition === undefined ||
    thread.demander !== actorId ||
    thread.progress?.boon !== undefined ||
    state.tick > thread.term.deadline
  ) {
    return undefined;
  }
  const god = getActor(state, actorId);
  const petitioner = getActor(state, thread.obligated);
  if (god === undefined || petitioner?.alive !== true) return undefined;
  const place = state.locations.get(petitioner.locationId);
  if (place === undefined) return undefined;
  const base = {
    petition: thread.petition,
    petitioner: petitioner.id,
    place: petitioner.locationId,
    placeName: place.name,
    offeringMade: thread.progress?.offering !== undefined,
  };
  const petition = state.petitions.get(thread.petition);
  if (petition?.request.kind === "punish") {
    return { ...owedStrikeOf(state, god, petition, base), strikes: true };
  }
  if (petition?.request.kind !== "help") {
    return {
      ...base,
      blocked: "its prayer is not one a bless or a strike answers",
    };
  }
  if (!blessability(state, thread.petition, actorId).ok) {
    return { ...base, blocked: "its prayer is no longer open to an answer" };
  }
  // A blessing answers the prayer from wherever the god stands, so it is the step whenever the prayer is open to it and
  // the god can pay; `blessability` is the action's own predicate above.
  const cost = petitionBalanceOf(state.rules, "blessDivinityCost");
  if ((god.inventory.get("divinity") ?? 0) < cost) {
    return {
      ...base,
      blocked: `a bless costs ${cost} divinity and you hold less`,
    };
  }
  return {
    ...base,
    next: {
      kind: "bless",
      intent: { action: "bless", petition: thread.petition },
    },
  };
}

/**
 * `views` as a god that holds `strikeCap` power to strike with may be shown them: a punish boon is a strike, so for
 * a god that cannot strike (no ability, or no divinity to spend) the row names why and shows no object, rather than
 * a strike or a hop toward one the parser would refuse. `strikeCap` is what the prompt's own schema allows.
 */
export function withStrikeLegality(
  views: readonly ThreadView[],
  strikeCap: number,
): readonly ThreadView[] {
  if (strikeCap >= 1) return views;
  return views.map((view) => {
    const owed = view.owedBoon;
    if (owed?.strikes !== true || owed.next === undefined) return view;
    const { next: _next, building: _building, ...rest } = owed;
    return {
      ...view,
      owedBoon: {
        ...rest,
        blocked: "you have no power to strike with",
      },
    };
  });
}

/**
 * The boon owed on a punish prayer, which the world counts as a strike by this god on a building the prayer names, or on
 * the wrongdoer itself (`judgeAnswers`): the strike on the first listed building that can be struck, or, when none can
 * (the prayer lists none, or each is burning or destroyed), on the wrongdoer if it is a living mortal. A strike has no
 * location check, so the god strikes from where it stands. A strike is shown at power 1, the least the world takes;
 * whether the god's own ability allows it is settled where the prompt is built, which holds the profile. Otherwise
 * the reason, and no object.
 */
function owedStrikeOf(
  state: WorldState,
  god: ActorState,
  petition: Petition,
  base: Omit<OwedBoon, "next" | "blocked" | "building">,
): OwedBoon {
  if (
    petition.status !== "open" ||
    !inAnswerWindow(state, petition, state.tick) ||
    petition.request.kind !== "punish"
  ) {
    return { ...base, blocked: "its prayer is no longer open to an answer" };
  }
  const request = petition.request;
  const named = request.buildings.flatMap((buildingId) => {
    const building = state.buildings.get(buildingId);
    return building === undefined ? [] : [building];
  });
  const strikable = named.filter(
    (building) => building.status === "operational",
  );
  const offender = getActor(state, request.offender);
  const strikeOffender = offender?.alive === true && offender.isDeity !== true;
  if (strikable.length === 0 && !strikeOffender) {
    return {
      ...base,
      blocked:
        named.length === 0
          ? "the wrongdoer cannot be struck"
          : `none of the buildings it names (${named.map((b) => b.id).join(", ")}) can be struck now, and the wrongdoer cannot be`,
    };
  }
  if ((god.inventory.get("divinity") ?? 0) < 1) {
    return { ...base, blocked: "a strike costs divinity and you hold none" };
  }
  const first = strikable[0];
  if (first !== undefined) {
    return {
      ...base,
      building: {
        id: first.id,
        name: first.name,
        place: first.locationId,
        placeName:
          state.locations.get(first.locationId)?.name ?? first.locationId,
      },
      next: {
        kind: "strike",
        intent: { action: "strike", target: first.id, power: 1 },
      },
    };
  }
  return {
    ...base,
    next: {
      kind: "strike",
      intent: { action: "strike", target: request.offender, power: 1 },
    },
  };
}

/**
 * Where an open thread stands for `actorId`, the one rule both the prompt and
 * the scheduler read. An accepted thread is the god's to perform when the term
 * is its own, or when it owes the boon on a prayer it set terms on
 * (`owedBoon`, from `owedBoonOf`): an obligation, whatever its deadline. A
 * thread still being bargained over is waiting on the god when the standing
 * offer is the other god's: awaiting its answer. Anything else is the other
 * party's to do, and the god need only know of it.
 */
function standingOf(
  actorId: EntityId,
  thread: PracticeThread,
  owedBoon: OwedBoon | undefined,
): Standing {
  if (thread.status === "accepted") {
    return thread.term.party === actorId || owedBoon !== undefined
      ? "obligation"
      : "other";
  }
  return thread.offeredBy !== actorId ? "awaiting" : "other";
}

/** What the world says a god is waiting on, for deciding whose turn is next. */
export interface SchedulingSignals {
  /** The earliest deadline among the accepted obligations the god must perform (terms of its own, boons it owes), or `undefined` when it owes nothing. */
  readonly obligationDeadline: number | undefined;
  /** A thread being bargained over is waiting on this god's answer. */
  readonly awaited: boolean;
}

/**
 * The scheduling signals of each of `gods`, read from world state alone, in one
 * pass over the threads. It applies `standingOf`, the rule the practice digest
 * sorts its rows by, so a god the scheduler calls owing is one whose prompt
 * leads with a YOU OWE row, and one it calls awaited is one whose prompt shows
 * AWAITING YOUR ANSWER. Prayers, contests, and the clock are not inputs; the
 * deadline is the term's, in world ticks, as the digest orders obligations.
 */
export function schedulingSignals(
  state: WorldState,
  gods: Iterable<EntityId>,
): Map<EntityId, SchedulingSignals> {
  const found = new Map<
    EntityId,
    { obligationDeadline: number | undefined; awaited: boolean }
  >();
  for (const god of gods) {
    found.set(god, { obligationDeadline: undefined, awaited: false });
  }
  for (const thread of state.threads.values()) {
    if (!isThreadOpen(thread)) continue;
    for (const party of [thread.demander, thread.obligated]) {
      const signals = found.get(party);
      if (signals === undefined) continue;
      const standing = standingOf(
        party,
        thread,
        owedBoonOf(state, party, thread),
      );
      if (standing === "awaiting") signals.awaited = true;
      if (standing === "obligation") {
        signals.obligationDeadline = Math.min(
          signals.obligationDeadline ?? Number.POSITIVE_INFINITY,
          thread.term.deadline,
        );
      }
    }
  }
  return found;
}

/** The thread views of `actorId`, most urgent first, and the options its terms and demands draw on. */
export function practiceBy(
  state: WorldState,
  actorId: EntityId,
  shownMemories: readonly MemoryEntry[],
  shownPetitioners: readonly EntityId[],
  refusal?: PracticeRefusalView,
  /** The prayers the prompt shows, when it cannot show them all: only these may be offered terms, so the schema, the parser, and the openings name nothing the god cannot see. Absent means every prayer. */
  shownPrayers?: ReadonlySet<EventId>,
): { threads: readonly ThreadView[]; options: PracticeOptions } {
  const self = getActor(state, actorId);
  if (!self?.isDeity) return { threads: [], options: NO_PRACTICE };

  const threads: ThreadView[] = [];
  for (const thread of state.threads.values()) {
    if (!isThreadOpen(thread)) continue;
    if (thread.demander !== actorId && thread.obligated !== actorId) continue;
    const other =
      thread.demander === actorId ? thread.obligated : thread.demander;
    const otherAlive = getActor(state, other)?.alive === true;
    const who = (id: EntityId) => (id === actorId ? "you" : id);
    const status = thread.status as ThreadView["status"];
    const owedBoon = owedBoonOf(state, actorId, thread);
    const standing = standingOf(actorId, thread, owedBoon);

    const moves: AnswerMove[] = [];
    if (status !== "accepted") {
      if (
        thread.offeredBy !== actorId &&
        state.tick <= thread.negotiationDeadline &&
        otherAlive
      ) {
        if (
          termObstacle(
            state,
            thread.term,
            thread.term.deadline - state.tick,
          ) === undefined
        ) {
          moves.push("accept");
        }
        if (thread.counterBudgetLeft >= 1) moves.push("counter");
        moves.push("refuse");
      }
      moves.push("withdraw");
    }

    const intents: Partial<Record<AnswerMove, Record<string, unknown>>> = {};
    for (const move of moves) {
      if (move === "counter") {
        const term = counterTerm(state, actorId, thread);
        if (term !== undefined) {
          intents.counter = {
            action: "practice",
            move: "counter",
            thread: thread.id,
            term,
          };
        }
      } else {
        intents[move] = { action: "practice", move, thread: thread.id };
      }
    }

    const accepter =
      thread.demander === thread.offeredBy ? thread.obligated : thread.demander;
    const lastMove =
      thread.practice === "supplication" && status !== "accepted"
        ? `${who(thread.demander)} offered terms`
        : status === "accepted"
          ? `${who(accepter)} agreed at tick ${thread.acceptance?.tick ?? "?"}${thread.acceptance?.sworn ? ", sworn by the Styx" : ""}`
          : status === "countered"
            ? `${who(thread.offeredBy)} countered`
            : `${who(thread.demander)} demanded`;

    const obstacle =
      standing === "obligation" &&
      owedBoon === undefined &&
      !canStillPerform(state, thread)
        ? termObstacle(state, thread.term, thread.term.deadline - state.tick)
        : undefined;

    threads.push({
      id: thread.id,
      standing,
      self: actorId,
      other,
      status,
      revision: thread.revision,
      term: thread.term,
      lastMove,
      cause: causeAsKnown(state, actorId, thread.demander, thread.causes),
      negotiationDeadline: thread.negotiationDeadline,
      counterBudgetLeft: thread.counterBudgetLeft,
      tick: state.tick,
      moves,
      intents,
      ...(thread.practice === "supplication" && thread.petition !== undefined
        ? {
            supplication: {
              petition: thread.petition,
              boonGiven: thread.progress?.boon !== undefined,
              offeringMade: thread.progress?.offering !== undefined,
            },
          }
        : {}),
      ...(owedBoon === undefined ? {} : { owedBoon }),
      canSwear: moves.includes("accept") && thread.term.party === actorId,
      ...(refusal?.reason === "no-progress" && refusal.thread === thread.id
        ? { noProgress: refusal.text }
        : {}),
      ...(obstacle === undefined ? {} : { unperformable: obstacle.message }),
    });
  }

  const urgency = (view: ThreadView) =>
    view.standing === "obligation"
      ? view.term.deadline
      : view.standing === "awaiting"
        ? view.negotiationDeadline
        : Number.MAX_SAFE_INTEGER;
  const rank = { obligation: 0, awaiting: 1, other: 2 } as const;
  const opened = (view: ThreadView) =>
    state.threads.get(view.id)?.openedSequence ?? 0;
  threads.sort(
    (a, b) =>
      rank[a.standing] - rank[b.standing] ||
      urgency(a) - urgency(b) ||
      opened(a) - opened(b),
  );

  const named = new Set<EntityId>(shownPetitioners);
  for (const memory of shownMemories) {
    for (const subject of memory.subjects) named.add(subject);
    if (memory.consequence !== undefined) {
      named.add(memory.consequence.agent);
      if (memory.consequence.target !== undefined) {
        named.add(memory.consequence.target);
      }
    }
    if (memory.kind === "told") named.add(memory.teller);
  }
  const resources = new Set<string>();
  for (const actor of state.actors.values()) {
    for (const resource of actor.inventory.keys()) resources.add(resource);
  }
  // The resources the world prices are the ones that exist, held by anyone yet or not.
  for (const key of Object.keys(state.rules.economyBalance)) {
    if (key.startsWith("value_")) resources.add(key.slice("value_".length));
  }
  for (const recipe of Object.values(state.recipes)) {
    for (const line of [...recipe.inputs, ...recipe.outputs]) {
      resources.add(line.resource);
    }
  }
  const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  let options: PracticeOptions = {
    gods: [...state.actors.values()]
      .filter((a) => a.isDeity && a.alive && a.id !== actorId)
      .map((a) => a.id)
      .sort(byId),
    places: [...state.locations.keys()].sort(byId),
    mortals: [...named]
      .filter((id) => {
        const actor = getActor(state, id);
        return actor?.alive === true && actor.isDeity !== true;
      })
      .sort(byId),
    resources: [...resources].sort(byId),
    minTicks: practiceBalanceOf(state.rules, "minTermTicks"),
    maxTicks: practiceBalanceOf(state.rules, "maxTermTicks"),
    causes: [],
    // A prayer to this god that is still open to an answer, with no terms standing on it, from a petitioner still living.
    offerable: openPetitionsFor(state, actorId)
      .filter(
        (petition) =>
          (shownPrayers === undefined || shownPrayers.has(petition.id)) &&
          inAnswerWindow(state, petition, state.tick) &&
          getActor(state, petition.petitioner)?.alive === true &&
          ![...state.threads.values()].some(
            (thread) => thread.petition === petition.id && isThreadOpen(thread),
          ),
      )
      .map((petition) => ({
        id: petition.id,
        petitioner: petition.petitioner,
      })),
    stakes: Object.entries(state.rules.practiceStakes ?? {})
      .map(([id, stake]) => ({ id, form: stake.form }))
      .sort((a, b) => byId(a.id, b.id)),
    offerTerms: {},
    redress: {},
    openings: [],
    contests: [],
    moreActs: 0,
    heldContests: [],
  };
  // The harm a god did a worshipper, which its prayer tells this god of, is a cause to demand redress over, and the
  // demand is written out where the world would take it. The newest few only: the prompt has a budget.
  const redress: Record<string, Record<string, unknown>> = {};
  const prayerCauses: DemandCause[] = [];
  for (const petition of [...openPetitionsFor(state, actorId)].sort(
    (a, b) => b.sequence - a.sequence,
  )) {
    if (prayerCauses.length >= MAX_REDRESS_CAUSES) break;
    if (shownPrayers !== undefined && !shownPrayers.has(petition.id)) continue;
    if (!inAnswerWindow(state, petition, state.tick)) continue;
    const intent = redressDemand(state, actorId, petition, options);
    if (intent === undefined) continue;
    redress[petition.id] = intent;
    prayerCauses.push({
      id: petition.cause,
      memoryId: petition.id,
      fact: `petition:${petition.id}`,
      text: `${petition.petitioner} of your flock prayed that ${petition.about.offender} struck it`,
    });
  }
  const known = demandCauses(shownMemories, actorId);
  options = {
    ...options,
    redress,
    causes: [
      ...known,
      ...prayerCauses.filter((cause) => !known.some((k) => k.id === cause.id)),
    ],
  };
  // A boon owed is a bargain already struck: no new terms are written out beside the prayers while it is.
  const owing = threads.some((view) => view.owedBoon !== undefined);
  const offerTerms = owing ? {} : offerTermsFor(state, actorId, options);
  // A thread that needs this god's answer or performance leads the digest alone.
  const needed = threads.some((view) => view.standing !== "other");
  const demand = needed
    ? undefined
    : demandOpening(state, actorId, shownMemories, options);
  const offer = needed ? undefined : offerOpening(state, options, offerTerms);
  const heldContests = heldContestsOf(state, actorId);
  const { shown, more } = needed
    ? { shown: [], more: 0 }
    : chooseActs(state, actorId, heldContests);
  return {
    threads,
    options: {
      ...options,
      offerTerms,
      contests: shown,
      moreActs: more,
      heldContests,
      openings: [
        ...(demand === undefined ? [] : [demand]),
        ...(offer === undefined ? [] : [offer]),
      ],
    },
  };
}

// --- Contests --------------------------------------------------------------------------------

/** What a rival's act was, in a few words. */
const ACT_WORDS: Readonly<Record<ServiceKind, string>> = {
  bless: "blessed a mortal",
  strike: "struck a building",
  legend: "told a legend",
};

const placeLabel = (name: string, place: EntityId) => `${name} [${place}]`;

const countFavour = (count: number, who: string) =>
  count === 1 ? `1 favours ${who}` : `${count} mortals favour ${who}`;

/** One held contest's line: where, against whom, until when, and how the mortals who have weighed it lean so far. */
function heldLine(held: HeldContest): string {
  return `- [${held.id}] at ${placeLabel(held.placeName, held.place)} against ${held.rival} until tick ${held.closesAt}: so far ${countFavour(held.mine, "you")} and ${countFavour(held.theirs, held.rival)}.`;
}

/** One rival act's line: who did what where, with the object that would open a contest over it. */
function actLine(act: ContestAct): string {
  return `- ${act.god} ${act.text ?? ACT_WORDS[act.kind as ServiceKind]} at ${placeLabel(act.placeName, act.place)} [${act.id}]: ${JSON.stringify(contestIntent(act.id))}`;
}

/** The object a god sends to open a contest over `act`. */
const contestIntent = (act: EventId) => ({
  action: "practice",
  move: "contest",
  act,
});

const CONTEST_CHOICES =
  "You saw rivals act where mortals live. Each of these is a choice (nothing requires it; waiting is always allowed):";

const moreActsLine = (count: number) =>
  `- and ${count} more acts of rivals you saw.`;

/** The open contests `actorId` is in, newest first, at most two, with how many mortals favour each side so far. */
function heldContestsOf(state: WorldState, actorId: EntityId): HeldContest[] {
  return [...state.contests.values()]
    .filter(
      (contest) =>
        contest.status === "open" &&
        (contest.opener === actorId || contest.rival === actorId),
    )
    .sort((a, b) => b.openedSequence - a.openedSequence)
    .slice(0, 2)
    .map((contest) => {
      const rival = contest.opener === actorId ? contest.rival : contest.opener;
      const favoured = favourOf(state, contest);
      const mine = favoured.filter((f) => f.god === actorId).length;
      return {
        id: contest.id,
        place: contest.place,
        placeName: state.locations.get(contest.place)?.name ?? contest.place,
        rival,
        closesAt: contest.closesAt,
        mine,
        theirs: favoured.length - mine,
      };
    });
}

/**
 * The rival acts the prompt offers: those the world would take a contest over (each one validated), newest
 * first, as many as the section's budget holds after the contests the god holds and its framing lines; the
 * first that does not fit ends the list, and the rest are counted.
 */
function chooseActs(
  state: WorldState,
  actorId: EntityId,
  held: readonly HeldContest[],
): { shown: ContestAct[]; more: number } {
  // A worshipper lost to another god comes first: it is the god's own loss, and its home is the place contested.
  const defections = contestableDefections(state, actorId).map(
    (defection): ContestAct => ({
      id: defection.id,
      god: defection.to,
      place: defection.home,
      placeName: state.locations.get(defection.home)?.name ?? defection.home,
      kind: "defection",
      text: `took ${defection.mortal} of ${defection.home} from your flock`,
    }),
  );
  const acts = [
    ...defections,
    ...[...contestableActs(state, actorId)].reverse().map(
      (act): ContestAct => ({
        id: act.id,
        god: act.god,
        place: act.place,
        placeName: state.locations.get(act.place)?.name ?? act.place,
        kind: act.kind,
      }),
    ),
  ];
  if (acts.length === 0) return { shown: [], more: 0 };
  let used =
    sizeOf([CONTESTS_HEADING, ...held.map(heldLine), CONTEST_CHOICES]) +
    moreActsLine(acts.length).length +
    1;
  const shown: ContestAct[] = [];
  for (const act of acts) {
    const cost = actLine(act).length + 1;
    if (shown.length > 0 && used + cost > CONTESTS_BUDGET_CHARS) break;
    shown.push(act);
    used += cost;
  }
  return { shown, more: acts.length - shown.length };
}

/** The contests section: the contests the god is in, and the rival acts it may open one over, as choices. Empty when it has neither. */
export function describeContests(options: PracticeOptions): string[] {
  if (options.heldContests.length === 0 && options.contests.length === 0) {
    return [];
  }
  return [
    CONTESTS_HEADING,
    ...options.heldContests.map(heldLine),
    ...(options.contests.length === 0
      ? []
      : [
          CONTEST_CHOICES,
          ...options.contests.map(actLine),
          ...(options.moreActs > 0 ? [moreActsLine(options.moreActs)] : []),
        ]),
  ];
}

// --- Openings --------------------------------------------------------------------------------

/** A proposal the world would judge, built the way the service builds a god's: nothing here is committed. */
const proposalBase = (actor: EntityId) => ({
  schemaVersion: 1,
  actor,
  targets: [] as EntityId[],
  expectedRevisions: [] as never[],
  source: "model" as const,
  observationId: createObservationId(),
});

/** How many ticks an opening's term allows: long enough to travel and act, inside the world's bounds. */
const OPENING_TICKS = 90;
/** Most harms done to its worshippers a god is shown as causes to demand redress over. */
const MAX_REDRESS_CAUSES = 2;
const termTicks = (options: PracticeOptions) =>
  Math.min(options.maxTicks, Math.max(options.minTicks, OPENING_TICKS));

/**
 * A counter to write out for the god, only where one is grounded: the term on
 * the table cannot be performed in the time left, and a longer deadline is what
 * the world would take instead. A counter that merely changes a deadline of a
 * performable term is not suggested, since a model copies what it is shown until
 * the budget is gone; the move stays on offer, its shape described. `undefined`
 * when nothing stops the term, or when no deadline fixes what does.
 */
function counterTerm(
  state: WorldState,
  actorId: EntityId,
  thread: PracticeThread,
): PracticeTermOffer | undefined {
  const remaining = thread.term.deadline - state.tick;
  if (termObstacle(state, thread.term, remaining) === undefined) {
    return undefined;
  }
  const min = practiceBalanceOf(state.rules, "minTermTicks");
  const max = practiceBalanceOf(state.rules, "maxTermTicks");
  const { deadline: _deadline, ...spec } = thread.term;
  const clamp = (ticks: number) => Math.min(max, Math.max(min, ticks));
  const tries = [remaining + 30, remaining + 60, remaining + 120, max];
  for (const ticks of tries.map(clamp)) {
    if (
      termObstacle(state, spec as PracticeTerm, ticks) !== undefined ||
      thread.offers.includes(termTuple(spec as PracticeTerm, ticks))
    ) {
      continue;
    }
    const term = { ...spec, deadlineTicks: ticks } as PracticeTermOffer;
    const verdict = validatePractice(state, {
      ...proposalBase(actorId),
      kind: "practice",
      move: "counter",
      thread: thread.id,
      term,
    } satisfies PracticeProposal);
    if (verdict.ok) return term;
  }
  return undefined;
}

/**
 * The offering a god could ask of the one who prayed: one unit of the first
 * resource, in order, that the world would take as a term. Nothing about what
 * the mortal holds is shown beyond that it could make it.
 */
function offerTermsFor(
  state: WorldState,
  actorId: EntityId,
  options: PracticeOptions,
): Record<string, Record<string, unknown>> {
  const found: Record<string, Record<string, unknown>> = {};
  for (const prayer of options.offerable) {
    for (const resource of options.resources) {
      const term = {
        kind: "make-offering" as const,
        party: prayer.petitioner,
        to: actorId,
        resource,
        amount: 1,
        deadlineTicks: termTicks(options),
      };
      const verdict = validatePractice(state, {
        ...proposalBase(actorId),
        kind: "practice",
        move: "offer",
        petition: prayer.id,
        term,
      } satisfies PracticeProposal);
      if (verdict.ok) {
        found[prayer.id] = {
          action: "practice",
          move: "offer",
          prayer: prayer.id,
          term,
        };
        break;
      }
    }
  }
  return found;
}

/** The newest prayer the god may set terms on that the world would take them on. */
function offerOpening(
  state: WorldState,
  options: PracticeOptions,
  terms: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Opening | undefined {
  const prayer = options.offerable
    .filter((candidate) => terms[candidate.id] !== undefined)
    .sort(
      (a, b) =>
        (state.petitions.get(b.id)?.sequence ?? 0) -
          (state.petitions.get(a.id)?.sequence ?? 0) || (a.id < b.id ? -1 : 1),
    )[0];
  if (prayer === undefined) return undefined;
  return {
    kind: "offer",
    label: `set terms on ${prayer.petitioner}'s prayer [${prayer.id}]`,
    intent: terms[prayer.id] as Record<string, unknown>,
  };
}

/**
 * The demand `actorId` could open of `god` over `cause` that the world would take, written out in the intent to
 * send: the first of these terms the world accepts: tell a legend where mortals are with it, come to where it
 * stands (when it is not already there), ally with it, or come to where it stands regardless.
 */
function demandOver(
  state: WorldState,
  actorId: EntityId,
  god: EntityId,
  cause: EventId,
  options: PracticeOptions,
): Record<string, unknown> | undefined {
  const self = getActor(state, actorId);
  if (self === undefined) return undefined;
  const ticks = termTicks(options);
  const here = self.locationId;
  const mortalsHere = [...state.actors.values()].some(
    (actor) =>
      actor.alive && actor.isDeity !== true && actor.locationId === here,
  );
  const there = getActor(state, god)?.locationId === here;
  const terms: PracticeTermOffer[] = [
    ...(mortalsHere
      ? [
          {
            kind: "tell-legend" as const,
            party: god,
            place: here,
            deadlineTicks: ticks,
          },
        ]
      : []),
    ...(there
      ? []
      : [
          {
            kind: "be-at" as const,
            party: god,
            place: here,
            deadlineTicks: ticks,
          },
        ]),
    { kind: "ally" as const, party: god, to: actorId, deadlineTicks: ticks },
    { kind: "be-at" as const, party: god, place: here, deadlineTicks: ticks },
  ];
  for (const term of terms) {
    const verdict = validatePractice(state, {
      ...proposalBase(actorId),
      kind: "practice",
      move: "demand",
      counterparty: god,
      cause,
      term,
    } satisfies PracticeProposal);
    if (verdict.ok) {
      return { action: "practice", move: "demand", cause, term };
    }
  }
  return undefined;
}

/** The demand for redress a prayer tells of: harm a god did the one who prayed, which the world would take a demand over. */
function redressDemand(
  state: WorldState,
  actorId: EntityId,
  petition: Petition,
  options: PracticeOptions,
): Record<string, unknown> | undefined {
  const { about } = petition;
  if (about.kind !== "harm" || about.offender === undefined) return undefined;
  if (!options.gods.includes(about.offender)) return undefined;
  return demandOver(state, actorId, about.offender, petition.cause, options);
}

/**
 * A demand over a grievance the god knows: a harm one of its shown memories
 * names, by or against another god, that the world would take a demand over.
 * The most salient such memory comes first, then the most recent. The term is
 * the first of these the world accepts: tell a legend where mortals are with
 * it, come to where it stands (when the other god is not already there), ally
 * with it, or come to where it stands regardless.
 */
function demandOpening(
  state: WorldState,
  actorId: EntityId,
  shown: readonly MemoryEntry[],
  options: PracticeOptions,
): Opening | undefined {
  const causeOf = new Map(
    options.causes.map((cause) => [cause.memoryId, cause]),
  );
  const grievances = shown
    .filter(
      (memory) =>
        memory.consequence?.effect === "harm" && causeOf.has(memory.id),
    )
    .sort(
      (a, b) =>
        b.salience - a.salience ||
        b.recordedAt - a.recordedAt ||
        (a.id < b.id ? -1 : 1),
    );
  for (const memory of grievances) {
    const cause = causeOf.get(memory.id) as DemandCause;
    const consequence = memory.consequence;
    const named = [
      ...(memory.kind === "told" ? [memory.teller] : []),
      ...(consequence === undefined
        ? []
        : [
            consequence.agent,
            ...(consequence.target ? [consequence.target] : []),
          ]),
      ...memory.subjects,
    ];
    for (const god of [...new Set(named)]) {
      if (!options.gods.includes(god)) continue;
      const found = demandOver(state, actorId, god, cause.id, options);
      if (found !== undefined) {
        return {
          kind: "demand",
          label: `demand of ${god} (${cause.text} [${cause.id}])`,
          intent: found,
        };
      }
    }
  }
  return undefined;
}

// --- The digest ------------------------------------------------------------------------------

const ticksLeft = (deadline: number, now: number) =>
  Math.max(0, deadline - now);

const json = (value: unknown) => JSON.stringify(value);

/** The withdrawal of a thread, as the object to send. */
function withdrawLine(view: ThreadView): string {
  return `  You may withdraw it: ${json(view.intents.withdraw ?? { action: "practice", move: "withdraw", thread: view.id })}`;
}

/**
 * The answers a thread awaiting the god allows, each written out as the object
 * to send, the exact legal (move, thread) pairs. A move the world would not
 * take as written (a counter with no legal term) is named without an object.
 */
function answerLines(view: ThreadView): string[] {
  const lines = ["  Answer with exactly one of these:"];
  for (const move of view.moves) {
    const intent = view.intents[move];
    if (move === "counter") {
      lines.push(
        intent === undefined
          ? `  move "counter" on thread "${view.id}" with a term of your own (${view.counterBudgetLeft} left; fields you leave out keep the standing term)`
          : `  ${json(intent)} (you cannot do this in the time left; this gives it longer; ${view.counterBudgetLeft} left)`,
      );
      continue;
    }
    const note =
      move === "accept" && view.canSwear
        ? ' (add "swear":true to swear it by the Styx)'
        : "";
    lines.push(`  ${json(intent)}${note}`);
  }
  return lines;
}

/** The rows of a boon the god owes: who, which prayer, by when, and the next step as an object to copy. */
function owedBoonRows(view: ThreadView, owed: OwedBoon, by: string): string[] {
  const lines = [
    `- [${view.id}] YOU OWE ${view.other}: your boon on its prayer [${owed.petition}], ${by}. ${view.lastMove}; its offering is ${owed.offeringMade ? "made" : "still to come"}. Cause: ${view.cause}.`,
  ];
  const building = owed.building;
  if (owed.next?.kind === "bless") {
    lines.push(
      `  ${owed.petitioner}'s prayer is open to you from where you stand: give it now with ${json(owed.next.intent)}`,
    );
  } else if (owed.next?.kind === "strike" && building !== undefined) {
    lines.push(
      `  ${building.name} [${building.id}] stands at ${building.placeName} [${building.place}]: strike it now, from where you stand, with ${json(owed.next.intent)} (a power from 1 to your limit; 1 is shown).`,
    );
  } else if (owed.next?.kind === "strike") {
    lines.push(
      `  The wrongdoer may be struck wherever it is: give it now, from where you stand, with ${json(owed.next.intent)} (a power from 1 to your limit; 1 is shown).`,
    );
  } else if (owed.blocked !== undefined) {
    lines.push(`  You cannot give it now: ${owed.blocked}.`);
  }
  lines.push(
    "  If the deadline passes without it, the world records the bargain as expired with your boon unanswered.",
  );
  return lines;
}

/** One thread as a full row: its role, term and deadline, last move, cause, and exactly what the god may answer with. */
function fullRow(view: ThreadView): string[] {
  const term = describeTerm(view.term, view.self);
  const by = `by tick ${view.term.deadline} (${ticksLeft(view.term.deadline, view.tick)} ticks left)`;
  const lines: string[] = [];
  const respond = view.moves.length > 0;
  const answerBy = `Answer by tick ${view.negotiationDeadline} (${ticksLeft(view.negotiationDeadline, view.tick)} ticks left).`;
  switch (view.standing) {
    case "obligation":
      if (view.owedBoon !== undefined) {
        lines.push(...owedBoonRows(view, view.owedBoon, by));
        break;
      }
      lines.push(
        `- [${view.id}] YOU OWE ${view.other}: ${term}, ${by}. ${view.lastMove}. Cause: ${view.cause}.`,
        "  Perform it before the deadline; if you do not, the world records a breach.",
      );
      if (view.unperformable !== undefined) {
        lines.push(`  UNPERFORMABLE now: ${view.unperformable}.`);
      }
      break;
    case "awaiting":
      lines.push(
        `- [${view.id}] AWAITING YOUR ANSWER: ${view.lastMove}: ${term}, ${by}. ${answerBy} Cause: ${view.cause}.`,
        ...(respond
          ? answerLines(view)
          : ["  The window to answer has closed; it ends on its own."]),
      );
      break;
    case "other":
      if (view.supplication !== undefined) {
        const { petition, boonGiven, offeringMade } = view.supplication;
        if (view.status === "accepted") {
          lines.push(
            `- [${view.id}] ${view.other} ACCEPTED your terms on its prayer [${petition}]: ${term}, ${by}.`,
            `  Boon: ${boonGiven ? "given" : 'still owed (answer the prayer: action "bless" or "strike", as its entry says)'}. Offering: ${offeringMade ? "made" : "still owed"}.`,
          );
        } else {
          lines.push(
            `- [${view.id}] OPEN, waiting on ${view.other}: you offered terms on its prayer [${petition}]: ${term}, ${by}. Its answer is due by tick ${view.negotiationDeadline}.`,
          );
          if (view.moves.includes("withdraw")) {
            lines.push(withdrawLine(view));
          }
        }
        break;
      }
      lines.push(
        view.status === "accepted"
          ? `- [${view.id}] ${view.other} OWES YOU: ${term}, ${by}. ${view.lastMove}. Cause: ${view.cause}.`
          : `- [${view.id}] OPEN, waiting on ${view.other}: ${view.lastMove}: ${term}, ${by}. Their answer is due by tick ${view.negotiationDeadline}. Cause: ${view.cause}.`,
      );
      if (view.moves.includes("withdraw")) {
        lines.push(withdrawLine(view));
      }
      break;
  }
  if (view.noProgress !== undefined) {
    lines.push(`  Not accepted: ${view.noProgress}.`);
  }
  return lines;
}

/** One thread squeezed to a single line: its id, its term, its deadline, and the answer it needs, nothing else. */
/**
 * What a compacted owed row keeps of its full one: the single step the god would send, as the object to copy, or the
 * reason there is none. The budget may shorten a row; it may not leave the god (or the gate that reads its turn) with
 * a debt and no way to pay it.
 */
function compactOwedStep(owed: OwedBoon): string {
  if (owed.next !== undefined) return ` Step: ${json(owed.next.intent)}`;
  return owed.blocked === undefined ? "" : ` Cannot now: ${owed.blocked}.`;
}

function compactRow(view: ThreadView): string {
  const term = describeTerm(view.term, view.self);
  const by = `by tick ${view.term.deadline}`;
  switch (view.standing) {
    case "obligation":
      return view.owedBoon !== undefined
        ? `- [${view.id}] YOU OWE ${view.other}: your boon on its prayer [${view.owedBoon.petition}], ${by}.${compactOwedStep(view.owedBoon)}`
        : `- [${view.id}] YOU OWE ${view.other}: ${term}, ${by}.${view.unperformable === undefined ? "" : " UNPERFORMABLE now."}`;
    case "awaiting":
      return `- [${view.id}] AWAITING YOUR ANSWER: ${term}, ${by}. Answer by tick ${view.negotiationDeadline} with ${view.moves.map((move) => json(view.intents[move] ?? { action: "practice", move, thread: view.id })).join(" or ")}.`;
    case "other":
      return view.supplication !== undefined
        ? `- [${view.id}] ${view.status === "accepted" ? `${view.other} ACCEPTED your terms` : `OPEN, terms offered to ${view.other}`}: ${term}, ${by}.`
        : `- [${view.id}] OPEN with ${view.other}: ${term}, ${by}.`;
  }
}

const sizeOf = (lines: readonly string[]) =>
  lines.reduce((sum, line) => sum + line.length + 1, 0);

/**
 * The digest that leads a god's prompt: empty when it has no open thread, no
 * refusal to report, and no opening. Rows come most urgent first. A row is shown
 * in full while the budget lasts; after that an obligation or a thread awaiting
 * the god is compressed to one line and always shown, while any other thread is
 * shown compressed if there is room and otherwise counted and cut. The openings
 * (bargains the god could begin, empty while a thread needs it) and the refusal
 * come after every row, so an obligation still leads; their size is reserved.
 */
export function describeDigest(
  threads: readonly ThreadView[],
  refusal?: PracticeRefusalView,
  openings: readonly Opening[] = [],
  budget = DIGEST_BUDGET_CHARS,
  /** The prayers whose own line in the prompt already writes the offer out whole: an offer opening on one points to it instead of repeating the object, so the copyable object appears once. */
  offeredAbove: ReadonlySet<string> = new Set(),
): string[] {
  // A refusal bound to an open thread is said on that thread's row; any other is a line of its own.
  const onRow =
    refusal !== undefined &&
    threads.some((view) => view.noProgress !== undefined);
  const lineOf =
    refusal === undefined || onRow
      ? []
      : [`- Your last ${refusal.attempted} was refused: ${refusal.text}.`];
  const openingLines =
    openings.length === 0
      ? []
      : [
          "- You may begin a bargain if you wish (nothing requires it); each of these is legal as written:",
          ...openings.map((opening) =>
            opening.kind === "offer" &&
            offeredAbove.has(String(opening.intent.prayer))
              ? `  ${opening.label}: the "set terms" choice written out under that prayer`
              : `  ${opening.label}: ${JSON.stringify(opening.intent)}`,
          ),
        ];
  if (
    threads.length === 0 &&
    lineOf.length === 0 &&
    openingLines.length === 0
  ) {
    return [];
  }
  const lines: string[] = [PRACTICES_HEADING];
  let used = sizeOf(lines) + sizeOf(lineOf) + sizeOf(openingLines);
  let cut = 0;
  for (const view of threads) {
    const full = fullRow(view);
    if (used + sizeOf(full) <= budget) {
      lines.push(...full);
      used += sizeOf(full);
      continue;
    }
    const compact = compactRow(view);
    if (view.standing !== "other" || used + compact.length + 1 <= budget) {
      lines.push(compact);
      used += compact.length + 1;
    } else {
      cut += 1;
    }
  }
  if (cut > 0) {
    lines.push(`- (${cut} more open thread${cut === 1 ? "" : "s"} not shown)`);
  }
  lines.push(...openingLines, ...lineOf);
  return lines;
}

// --- The instructions ------------------------------------------------------------------------

/**
 * What a god needs to name in a practice that the rows and openings do not
 * show: that only moves bind, which causes it may demand over, and the stakes it
 * may add to an offer. The terms themselves are shown in full shape where they
 * can be used (an opening, a prayer's terms, a thread's row), never as a list.
 */
export function describePracticeInstructions(
  threads: readonly ThreadView[],
  options: PracticeOptions,
): string[] {
  const canAnswer = threads.some((view) => view.moves.length > 0);
  const canDemand = options.causes.length > 0 && options.gods.length > 0;
  const canOffer = options.offerable.length > 0;
  const canContest = options.contests.length > 0;
  if (!canAnswer && !canDemand && !canOffer && !canContest) return [];
  const lines = [
    'A practice (action "practice") is a bargain the world holds and judges: only moves bind, and words never do. Copy one of the objects the rows and openings below show; each names its move, and only a demand, an offer, and a counter carry a term {kind, party, deadlineTicks, and what the kind needs}.',
  ];
  if (canDemand) {
    lines.push(
      `Causes you may demand over: ${options.causes.map((cause) => `[${cause.id}] ${cause.text}`).join("; ")}.`,
    );
  }
  if (canOffer && options.stakes.length > 0) {
    lines.push(
      `An offer on a prayer (move "offer") may add a stake: what the one who prayed becomes if it takes your boon and breaks the term (${options.stakes.map((stake) => stake.id).join(", ")}). The boon stays yours to give.`,
    );
  }
  if (canContest) {
    lines.push(
      'A contest (move "contest", naming a rival\'s act you saw as "act") claims a place\'s people: over a window the world counts what each of you does for the mortals there (a bless or a legend for them, a strike against them), each mortal favours the god that did more for it, and the god more of them favour gains standing there for good while the other loses it. It is one choice among the others.',
    );
  }
  if (canAnswer) {
    lines.push(
      "Answer an open thread with its id and one of the moves its row lists, named outright; a counter carries a new term, and a counter may leave out what the standing term already fixes (place, resource, amount): omitted fields keep the standing term.",
    );
  }
  return lines;
}

// --- The intent ------------------------------------------------------------------------------

/** The kinds of term a god may offer: the closed checkable set. */
const TERM_KINDS = [
  "tell-legend",
  "be-at",
  "stay-away",
  "give-resource",
  "bless-mortal",
  "make-offering",
  "ally",
] as const;

/** What a god's `practice` action says, once parsed against what it was shown. */
export type PracticeIntent = { readonly action: "practice" } & (
  | {
      readonly move: "offer";
      readonly petition: EventId;
      readonly term: PracticeTermOffer;
      readonly stake?: string;
    }
  | {
      readonly move: "demand";
      readonly cause: EventId;
      readonly term: PracticeTermOffer;
    }
  | {
      readonly move: "counter";
      readonly thread: EventId;
      readonly term: PracticeTermOffer;
    }
  | {
      readonly move: "accept";
      readonly thread: EventId;
      readonly swear?: boolean;
    }
  | { readonly move: "refuse" | "withdraw"; readonly thread: EventId }
  | { readonly move: "contest"; readonly cause: EventId }
);

/** Everything a `practice` action may name: the threads each answer is legal on, the causes, and what a term may hold. */
export interface PracticeOffer {
  readonly self: EntityId;
  readonly options: PracticeOptions;
  /** Legal thread ids, by answer move. */
  readonly answers: Readonly<Record<AnswerMove, readonly EventId[]>>;
  /** Mortals a term may name: those the god was shown, here or remembered. */
  readonly mortals: readonly EntityId[];
  readonly canDemand: boolean;
  /** Prayers this god may offer terms on, by id, with who prayed. */
  readonly offerable: readonly OfferablePrayer[];
  /** Each thread's other party, for the terms a counter may bind. */
  readonly otherOf: ReadonlyMap<EventId, EntityId>;
  /** The threads this god may swear its acceptance of: those whose term it must perform. */
  readonly swearable: readonly EventId[];
  /** The term on the table of each thread, so a counter that changes only what it names can leave the rest as it stands. */
  readonly standing: ReadonlyMap<EventId, PracticeTerm>;
  /** The rival acts this god may open a contest over: the ones the prompt shows. */
  readonly contests: readonly ContestAct[];
}

/** The practice offer, or `undefined` when the god has nothing to say in a practice now. */
export function practiceOffer(
  self: EntityId,
  threads: readonly ThreadView[],
  options: PracticeOptions,
  herePresent: readonly EntityId[],
): PracticeOffer | undefined {
  const by = (move: AnswerMove) =>
    threads.filter((view) => view.moves.includes(move)).map((view) => view.id);
  const answers = {
    accept: by("accept"),
    counter: by("counter"),
    refuse: by("refuse"),
    withdraw: by("withdraw"),
  };
  const canDemand = options.causes.length > 0 && options.gods.length > 0;
  const canAnswer = Object.values(answers).some((ids) => ids.length > 0);
  if (
    !canDemand &&
    !canAnswer &&
    options.offerable.length === 0 &&
    options.contests.length === 0
  ) {
    return undefined;
  }
  return {
    self,
    options,
    answers,
    mortals: [...new Set([...options.mortals, ...herePresent])],
    canDemand,
    offerable: options.offerable,
    otherOf: new Map(threads.map((view) => [view.id, view.other])),
    swearable: threads.filter((view) => view.canSwear).map((view) => view.id),
    standing: new Map(threads.map((view) => [view.id, view.term])),
    contests: options.contests,
  };
}

/** The practice moves on offer, in the order they are listed. */
export function offeredMoves(offer: PracticeOffer): readonly string[] {
  const moves: string[] = [];
  if (offer.canDemand) moves.push("demand");
  if (offer.offerable.length > 0) moves.push("offer");
  if (offer.contests.length > 0) moves.push("contest");
  for (const move of ["accept", "counter", "refuse", "withdraw"] as const) {
    if (offer.answers[move].length > 0) moves.push(move);
  }
  return moves;
}

/** `if` every named property matches, `then` these keys are required: one flat condition, no branches of the schema. */
function when(
  matches: Record<string, { const: string } | { enum: readonly string[] }>,
  required: readonly string[],
) {
  return {
    if: { properties: matches, required: Object.keys(matches) },
    // biome-ignore lint/suspicious/noThenProperty: `then` is JSON Schema's conditional keyword; this is a schema fragment, never awaited.
    then: { required: [...required] },
  };
}

/** A condition that applies only to a practice: stray practice fields on any other action constrain nothing. */
const whenPractice = (
  matches: Record<string, { const: string } | { enum: readonly string[] }>,
  required: readonly string[],
) => when({ action: { const: "practice" }, ...matches }, required);

/**
 * What a practice must carry, as conditions on the one flat schema: a practice
 * names its move, and each move names what it acts on (a thread, a cause, a
 * prayer) and a term where it has one. Only what is on offer this turn is
 * required, so a field that is not a property is never demanded. A decoder
 * that cannot hold conditions ignores them, and the parser still refuses a
 * practice that lacks what its move needs.
 */
export function practiceConditions(offer: PracticeOffer): object[] {
  const conditions: object[] = [whenPractice({}, ["move"])];
  const plain = (["accept", "refuse", "withdraw"] as const).filter(
    (move) => offer.answers[move].length > 0,
  );
  if (plain.length > 0) {
    conditions.push(whenPractice({ move: { enum: plain } }, ["thread"]));
  }
  if (offer.answers.counter.length > 0) {
    conditions.push(
      whenPractice({ move: { const: "counter" } }, ["thread", "term"]),
    );
  }
  if (offer.canDemand) {
    conditions.push(
      whenPractice({ move: { const: "demand" } }, ["cause", "term"]),
    );
  }
  if (offer.offerable.length > 0) {
    conditions.push(
      whenPractice({ move: { const: "offer" } }, ["prayer", "term"]),
    );
  }
  if (offer.contests.length > 0) {
    conditions.push(whenPractice({ move: { const: "contest" } }, ["act"]));
  }
  return conditions;
}

/** What a term of each kind must carry beyond its kind, party, and deadline; the recipient is not asked for, since the parser fills it in. */
const TERM_CONDITIONS = [
  when({ kind: { enum: ["tell-legend", "be-at", "stay-away"] } }, ["place"]),
  when({ kind: { enum: ["give-resource", "make-offering"] } }, [
    "resource",
    "amount",
  ]),
];

/** The schema properties a practice adds: flat, so the 4K budget holds. */
export function practiceProperties(
  offer: PracticeOffer,
): Record<string, unknown> {
  const { options } = offer;
  const properties: Record<string, unknown> = {
    move: { type: "string", enum: [...offeredMoves(offer)] },
  };
  const threadIds = [...new Set(Object.values(offer.answers).flat())];
  if (threadIds.length > 0) {
    properties.thread = { type: "string", enum: threadIds };
  }
  if (offer.canDemand) {
    properties.cause = {
      type: "string",
      enum: options.causes.map((cause) => cause.id),
    };
  }
  if (offer.contests.length > 0) {
    // The rival act a contest rests on. Its own field, not a demand's `cause`: the two name different things, and one list for both would offer each what only the other could take.
    properties.act = {
      type: "string",
      enum: offer.contests.map((act) => act.id),
    };
  }
  if (offer.swearable.length > 0) properties.swear = { type: "boolean" };
  if (offer.offerable.length > 0) {
    // The prayer an offer answers. It is its own field, not the bless action's `petition`: a bless is offered by presence and an offer by an open prayer, and one list for both would change what a god offered only a bless is shown.
    properties.prayer = {
      type: "string",
      enum: offer.offerable.map((prayer) => prayer.id),
    };
    if (options.stakes.length > 0) {
      properties.stake = {
        type: "string",
        enum: options.stakes.map((stake) => stake.id),
        description:
          "Only an offer on a prayer may carry a stake: what the one who prayed becomes if it takes your boon and breaks the term.",
      };
    }
  }
  if (
    offer.canDemand ||
    offer.answers.counter.length > 0 ||
    offer.offerable.length > 0
  ) {
    const everyone = [
      offer.self,
      ...options.gods,
      ...offer.offerable.map((prayer) => prayer.petitioner),
    ];
    properties.term = {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: [...TERM_KINDS],
        },
        party: { type: "string", enum: everyone },
        place: { type: "string", enum: [...options.places] },
        to: { type: "string", enum: [offer.self, ...options.gods] },
        ...(offer.mortals.length > 0
          ? { mortal: { type: "string", enum: [...offer.mortals] } }
          : {}),
        resource: { type: "string", enum: [...options.resources] },
        amount: { type: "integer", minimum: 1 },
        deadlineTicks: {
          type: "integer",
          minimum: options.minTicks,
          maximum: options.maxTicks,
        },
      },
      required: ["kind", "party", "deadlineTicks"],
      allOf: [
        ...TERM_CONDITIONS,
        ...(offer.mortals.length > 0
          ? [when({ kind: { const: "bless-mortal" } }, ["mortal"])]
          : []),
      ],
      additionalProperties: false,
    };
  }
  return properties;
}

function invalid(path: string, message: string): ParseResult<never> {
  return { ok: false, path, message };
}

function member<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
  what: string,
): ParseResult<T> {
  if (
    typeof value !== "string" ||
    !(allowed as readonly string[]).includes(value)
  ) {
    return invalid(
      path,
      `${what} must be one of: ${allowed.join(", ") || "(none)"}`,
    );
  }
  return { ok: true, value: value as T };
}

/**
 * `member`, except that a field the model left out is filled in when the world
 * leaves only one value it could be: a recipient the target already fixes is not
 * something to refuse a whole turn over. A value that is present is still checked.
 */
function memberOrOnly<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
  what: string,
): ParseResult<T> {
  if ((value === undefined || value === null) && allowed.length === 1) {
    return { ok: true, value: allowed[0] as T };
  }
  return member(value, path, allowed, what);
}

/**
 * A term as the god offers it, against what it may name. `participants` are
 * the two gods of the thread: a term binds one of them, and a gift goes to the
 * other. A demand's participants are the god and the one it binds.
 */
function parseTerm(
  offer: PracticeOffer,
  participants: readonly EntityId[],
  raw: unknown,
  demand: boolean,
  standing?: PracticeTerm,
): ParseResult<PracticeTermOffer> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return invalid("term", "term must be an object");
  }
  const sent = raw as Record<string, unknown>;
  // A counter of the standing term's own kind, for the party it binds, that leaves a field out keeps what stands: it changes what it names and nothing else. Anything else is read as sent.
  const keeps =
    standing !== undefined &&
    sent.kind === standing.kind &&
    sent.party === standing.party
      ? (standing as unknown as Record<string, unknown>)
      : undefined;
  const fields =
    keeps === undefined
      ? sent
      : {
          ...Object.fromEntries(
            ["place", "mortal", "resource", "amount", "to"].flatMap((key) =>
              keeps[key] === undefined ? [] : [[key, keeps[key]]],
            ),
          ),
          ...Object.fromEntries(
            Object.entries(sent).filter(
              ([, value]) => value !== undefined && value !== null,
            ),
          ),
        };
  const { options } = offer;
  const kind = member(fields.kind, "term.kind", TERM_KINDS, "kind");
  if (!kind.ok) return kind;
  const party = member(
    fields.party,
    "term.party",
    demand ? participants.filter((p) => p !== offer.self) : participants,
    "party",
  );
  if (!party.ok) return party;
  const ticks = fields.deadlineTicks;
  if (
    typeof ticks !== "number" ||
    !Number.isInteger(ticks) ||
    ticks < options.minTicks ||
    ticks > options.maxTicks
  ) {
    return invalid(
      "term.deadlineTicks",
      `deadlineTicks must be a whole number from ${options.minTicks} to ${options.maxTicks}`,
    );
  }
  const base = { party: party.value as EntityId, deadlineTicks: ticks };
  // A demand is between the god and the one it binds; a counter between the thread's two gods.
  const pair = demand ? [offer.self, base.party] : participants;
  switch (kind.value) {
    case "tell-legend":
    case "be-at":
    case "stay-away": {
      const place = member(fields.place, "term.place", options.places, "place");
      if (!place.ok) return place;
      return {
        ok: true,
        value: { kind: kind.value, ...base, place: place.value as EntityId },
      };
    }
    case "bless-mortal": {
      const mortal = member(
        fields.mortal,
        "term.mortal",
        offer.mortals,
        "mortal",
      );
      if (!mortal.ok) return mortal;
      return {
        ok: true,
        value: {
          kind: "bless-mortal",
          ...base,
          mortal: mortal.value as EntityId,
        },
      };
    }
    case "ally": {
      // An alliance is between the two gods of the thread: the party and the other.
      const to = memberOrOnly(
        fields.to,
        "term.to",
        pair.filter((p) => p !== base.party),
        "to",
      );
      if (!to.ok) return to;
      return {
        ok: true,
        value: { kind: "ally", ...base, to: to.value as EntityId },
      };
    }
    case "give-resource":
    case "make-offering": {
      // A gift goes to the other god of the thread, who must be able to take it; an offering to any god.
      const recipients =
        kind.value === "give-resource"
          ? pair.filter((p) => p !== base.party)
          : [offer.self, ...options.gods].filter((g) => g !== base.party);
      const to = memberOrOnly(fields.to, "term.to", recipients, "to");
      if (!to.ok) return to;
      const resource = member(
        fields.resource,
        "term.resource",
        options.resources,
        "resource",
      );
      if (!resource.ok) return resource;
      const amount = fields.amount;
      if (
        typeof amount !== "number" ||
        !Number.isInteger(amount) ||
        amount < 1
      ) {
        return invalid("term.amount", "amount must be a positive whole number");
      }
      return {
        ok: true,
        value: {
          kind: kind.value,
          ...base,
          to: to.value as EntityId,
          resource: resource.value,
          amount,
        },
      };
    }
  }
}

/**
 * The one term an offer on a prayer may hold: an offering, by the one who
 * prayed, to the god making the offer, of a resource that exists, within the
 * world's bounds on how long a term may run.
 */
function parseOfferTerm(
  offer: PracticeOffer,
  prayer: OfferablePrayer,
  raw: unknown,
): ParseResult<PracticeTermOffer> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return invalid("term", "term must be an object");
  }
  const fields = raw as Record<string, unknown>;
  const { options } = offer;
  const kind = member(fields.kind, "term.kind", ["make-offering"], "kind");
  if (!kind.ok) return kind;
  const party = member(
    fields.party,
    "term.party",
    [prayer.petitioner],
    "party",
  );
  if (!party.ok) return party;
  // The recipient of an offering on a prayer is always the god making the offer: left out, it is filled in; named as anyone else, it is refused.
  const to = memberOrOnly(fields.to, "term.to", [offer.self], "to");
  if (!to.ok) return to;
  const resource = member(
    fields.resource,
    "term.resource",
    options.resources,
    "resource",
  );
  if (!resource.ok) return resource;
  const { amount, deadlineTicks: ticks } = fields;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) {
    return invalid("term.amount", "amount must be a positive whole number");
  }
  if (
    typeof ticks !== "number" ||
    !Number.isInteger(ticks) ||
    ticks < options.minTicks ||
    ticks > options.maxTicks
  ) {
    return invalid(
      "term.deadlineTicks",
      `deadlineTicks must be a whole number from ${options.minTicks} to ${options.maxTicks}`,
    );
  }
  return {
    ok: true,
    value: {
      kind: "make-offering",
      party: party.value as EntityId,
      to: to.value as EntityId,
      resource: resource.value,
      amount,
      deadlineTicks: ticks,
    },
  };
}

/** The answers this god may give on `thread`, in order; none when the thread is not one it may answer. */
function legalOn(offer: PracticeOffer, thread: unknown): AnswerMove[] {
  if (typeof thread !== "string") return [];
  return (["accept", "counter", "refuse", "withdraw"] as const).filter((move) =>
    (offer.answers[move] as readonly string[]).includes(thread),
  );
}

const describeLegal = (moves: readonly AnswerMove[], thread: string) =>
  `${moves.map((move) => `"${move}"`).join(", ")} on thread ${thread}`;

/** Every legal (move, thread or cause or prayer) pair this god has now, for the refusal of a practice that names none. */
function legalPairs(offer: PracticeOffer): string {
  const pairs: string[] = [];
  const threads = [...new Set(Object.values(offer.answers).flat())];
  for (const thread of threads) {
    pairs.push(describeLegal(legalOn(offer, thread), thread));
  }
  if (offer.canDemand) {
    pairs.push(
      `"demand" over a cause (${offer.options.causes.map((cause) => cause.id).join(", ")})`,
    );
  }
  if (offer.offerable.length > 0) {
    pairs.push(
      `"offer" on a prayer (${offer.offerable.map((prayer) => prayer.id).join(", ")})`,
    );
  }
  if (offer.contests.length > 0) {
    pairs.push(
      `"contest" over a rival's act (${offer.contests.map((act) => act.id).join(", ")})`,
    );
  }
  return pairs.join("; ");
}

const named = (value: unknown) =>
  value !== undefined && value !== null && value !== "";

/**
 * The move of a practice. A decision on an existing thread (accept, counter,
 * refuse, withdraw) is never inferred: it names its move, or it is refused with
 * the exact legal pairs, so a reply binds only what the god said. Two shorthands
 * stay, each only while exactly one selector is named and nothing else in the
 * payload contradicts it: a cause alone is a demand, a prayer alone is an offer.
 */
function resolveMove(
  offer: PracticeOffer,
  fields: Record<string, unknown>,
): ParseResult<string> {
  if (named(fields.move)) {
    const found = member(fields.move, "move", offeredMoves(offer), "move");
    return found.ok
      ? found
      : invalid("move", `${found.message}; legal here: ${legalPairs(offer)}`);
  }
  const selectors = (["cause", "prayer", "thread"] as const).filter((key) =>
    named(fields[key]),
  );
  if (selectors.length === 1) {
    if (selectors[0] === "cause" && offer.canDemand) {
      return { ok: true, value: "demand" };
    }
    if (selectors[0] === "prayer" && offer.offerable.length > 0) {
      return { ok: true, value: "offer" };
    }
  }
  return invalid("move", `move is missing; legal here: ${legalPairs(offer)}`);
}

/** What each move takes besides its own name: a payload that carries more contradicts it. */
const MOVE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  demand: ["cause", "term"],
  offer: ["prayer", "term", "stake"],
  counter: ["thread", "term"],
  accept: ["thread", "swear"],
  refuse: ["thread"],
  withdraw: ["thread"],
  contest: ["act"],
};

/** The first field the payload carries that its move does not take (`swear: false` is no swear). */
function contradiction(
  move: string,
  fields: Record<string, unknown>,
): string | undefined {
  const takes = MOVE_FIELDS[move] ?? [];
  return ["cause", "prayer", "thread", "term", "swear", "stake", "act"].find(
    (key) =>
      !takes.includes(key) &&
      named(fields[key]) &&
      !(key === "swear" && fields[key] === false),
  );
}

/** Parses a `practice` action against the offer: the move, the thread, prayer, or cause it names, and its term. */
export function parsePractice(
  offer: PracticeOffer,
  fields: Record<string, unknown>,
): ParseResult<PracticeIntent> {
  const move = resolveMove(offer, fields);
  if (!move.ok) return move;
  const stray = contradiction(move.value, fields);
  if (stray !== undefined) {
    return invalid(
      stray,
      `${stray} does not belong to a "${move.value}": it takes ${(MOVE_FIELDS[move.value] ?? []).join(", ")}`,
    );
  }
  // A stake belongs to an offer on a prayer and to no other move.
  if (
    move.value !== "offer" &&
    fields.stake !== undefined &&
    fields.stake !== null
  ) {
    return invalid("stake", "only an offer on a prayer may carry a stake");
  }
  if (move.value === "offer") {
    const petition = member(
      fields.prayer,
      "prayer",
      offer.offerable.map((prayer) => prayer.id),
      "prayer",
    );
    if (!petition.ok) return petition;
    const prayer = offer.offerable.find(
      (candidate) => candidate.id === petition.value,
    ) as OfferablePrayer;
    const term = parseOfferTerm(offer, prayer, fields.term);
    if (!term.ok) return term;
    const stakes = offer.options.stakes.map((stake) => stake.id);
    let stake: string | undefined;
    if (fields.stake !== undefined && fields.stake !== null) {
      const named = member(fields.stake, "stake", stakes, "stake");
      if (!named.ok) return named;
      stake = named.value;
    }
    return {
      ok: true,
      value: {
        action: "practice",
        move: "offer",
        petition: prayer.id,
        term: term.value,
        ...(stake === undefined ? {} : { stake }),
      },
    };
  }
  if (move.value === "contest") {
    const act = member(
      fields.act,
      "act",
      offer.contests.map((candidate) => candidate.id),
      "act",
    );
    if (!act.ok) return act;
    return {
      ok: true,
      value: {
        action: "practice",
        move: "contest",
        cause: act.value as EventId,
      },
    };
  }
  if (move.value === "demand") {
    const cause = member(
      fields.cause,
      "cause",
      offer.options.causes.map((c) => c.id),
      "cause",
    );
    if (!cause.ok) return cause;
    // The demand binds the god it is made of: its term's party is that god.
    const term = parseTerm(
      offer,
      [offer.self, ...offer.options.gods],
      fields.term,
      true,
    );
    if (!term.ok) return term;
    return {
      ok: true,
      value: {
        action: "practice",
        move: "demand",
        cause: cause.value as EventId,
        term: term.value,
      },
    };
  }
  const answer = move.value as AnswerMove;
  const thread = member(
    fields.thread,
    "thread",
    offer.answers[answer],
    "thread",
  );
  if (!thread.ok) {
    const allowed = legalOn(offer, fields.thread);
    return allowed.length === 0
      ? thread
      : invalid(
          "thread",
          `${describeLegal(allowed, String(fields.thread))} allows only these; "${answer}" is not one of them`,
        );
  }
  const id = thread.value as EventId;
  switch (answer) {
    case "counter": {
      const other = offer.otherOf.get(id) as EntityId;
      const term = parseTerm(
        offer,
        [offer.self, other],
        fields.term,
        false,
        offer.standing.get(id),
      );
      if (!term.ok) return term;
      return {
        ok: true,
        value: {
          action: "practice",
          move: "counter",
          thread: id,
          term: term.value,
        },
      };
    }
    case "accept": {
      const swear = fields.swear;
      if (swear !== undefined && swear !== null && typeof swear !== "boolean") {
        return invalid("swear", "swear must be true or false");
      }
      if (swear === true && !offer.swearable.includes(id)) {
        return invalid(
          "swear",
          "you may swear only a term you must perform yourself",
        );
      }
      return {
        ok: true,
        value: {
          action: "practice",
          move: "accept",
          thread: id,
          ...(typeof swear === "boolean" ? { swear } : {}),
        },
      };
    }
    case "refuse":
    case "withdraw":
      return {
        ok: true,
        value: { action: "practice", move: answer, thread: id },
      };
  }
}
