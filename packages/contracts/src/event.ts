// Committed world events: the append-only source of truth. Every event
// carries its own schema version, independent of the SQLite schema and
// independent of proposal schema versions.

import {
  type CausationId,
  type CorrelationId,
  type EntityId,
  type EventId,
  fail,
  isRecord,
  ok,
  type ParseResult,
  parseArray,
  parseBoolean,
  parseCausationId,
  parseCorrelationId,
  parseEntityId,
  parseEnum,
  parseEventId,
  parseFiniteNumber,
  parseNonNegativeInteger,
  parseNonNegativeNumber,
  parseOptionalBoolean,
  parseOptionalString,
  parseResourceAmount,
  parseSchemaVersion,
  parseString,
  REJECTION_REASON_CODES,
  type RejectionReasonCode,
  type ResourceAmount,
} from "./ids";
import {
  CONTEST_END_REASONS,
  CONTEST_RESULTS,
  PRACTICE_END_REASONS,
  PRACTICE_KINDS,
  PRACTICE_MOTIF_CHANGES,
  PRACTICE_MOTIFS,
  PRACTICE_OUTCOMES,
  type PracticeEndReason,
  type PracticeKind,
  type PracticeMotif,
  type PracticeOutcome,
  type PracticeTerm,
  parsePracticeTerm,
  parseTransformation,
  type Transformation,
} from "./practice";

export interface EventEnvelope {
  readonly schemaVersion: number;
  readonly id: EventId;
  readonly sequence: number;
  readonly simTime: number;
  /** The world tick it happened in. Windows, cooldowns, and locks count these, never wall time, so a replay reproduces them. */
  readonly tick: number;
  readonly correlationId: CorrelationId;
  readonly causationId: CausationId;
  readonly approximate: boolean;
}

export interface EntityMovedEvent extends EventEnvelope {
  readonly kind: "entity-moved";
  readonly entityId: EntityId;
  readonly to: EntityId;
}

export interface RealmTransitionedEvent extends EventEnvelope {
  readonly kind: "realm-transitioned";
  readonly entityId: EntityId;
  readonly to: EntityId;
  readonly via: EntityId;
}

export interface ResourceGatheredEvent extends EventEnvelope {
  readonly kind: "resource-gathered";
  readonly entityId: EntityId;
  readonly resource: string;
  readonly amount: number;
}

export interface ResourceProducedEvent extends EventEnvelope {
  readonly kind: "resource-produced";
  readonly entityId: EntityId;
  readonly output: string;
  readonly quantity: number;
}

export interface ResourceTradedEvent extends EventEnvelope {
  readonly kind: "resource-traded";
  readonly entityId: EntityId;
  readonly counterpartyId: EntityId;
  readonly give: readonly ResourceAmount[];
  readonly receive: readonly ResourceAmount[];
}

export interface ResourceConsumedEvent extends EventEnvelope {
  readonly kind: "resource-consumed";
  readonly entityId: EntityId;
  readonly resource: string;
  readonly amount: number;
}

/** A deity's strike damaged a building that did not catch fire. `actor` is the deity, so what witnesses remember can name who did it. */
export interface BuildingDamagedEvent extends EventEnvelope {
  readonly kind: "building-damaged";
  readonly entityId: EntityId;
  readonly amount: number;
  readonly actor: EntityId;
}

/**
 * A deity's strike fell on a mortal: the world took `amount` of the mortal's `resource`, its most valuable carried
 * good up to the strike cap, and credited the harm to `actor`. A mortal carrying nothing is still struck, with no
 * `resource` and an `amount` of 0. The loss is taken, never given to anyone.
 */
export interface MortalStruckEvent extends EventEnvelope {
  readonly kind: "mortal-struck";
  /** The mortal struck. */
  readonly entityId: EntityId;
  /** The deity that struck. */
  readonly actor: EntityId;
  readonly resource?: string;
  readonly amount: number;
}

/**
 * What started a fire, stored on the ignition event itself and never worked
 * out later. A strike is a root: the proposal that committed it is its cause.
 * A spread names the source building's own ignition event, and carries the
 * actor forward from it, so a chain of fires still answers who began it.
 */
export type FireCause =
  | { readonly kind: "strike"; readonly actor: EntityId }
  /** The quiet-world director started it: no god's act, so no actor, and nothing for any god to be blamed for. */
  | { readonly kind: "director" }
  | {
      readonly kind: "spread";
      readonly from: EventId;
      /** Who began the fire this one spread from; absent when the director did. */
      readonly actor?: EntityId;
    };

export interface BuildingIgnitedEvent extends EventEnvelope {
  readonly kind: "building-ignited";
  readonly entityId: EntityId;
  readonly cause: FireCause;
}

/** `cause` is the ignition event that started this building's fire. */
export interface BuildingBurnTickedEvent extends EventEnvelope {
  readonly kind: "building-burn-ticked";
  readonly entityId: EntityId;
  readonly fireIntensity: number;
  readonly ticksBurning: number;
  readonly cause: EventId;
}

/** `cause` is the ignition event that started this building's fire. */
export interface BuildingDestroyedEvent extends EventEnvelope {
  readonly kind: "building-destroyed";
  readonly entityId: EntityId;
  readonly disposedInventory: readonly ResourceAmount[];
  readonly cause: EventId;
}

export interface RepairProgressedEvent extends EventEnvelope {
  readonly kind: "repair-progressed";
  readonly entityId: EntityId;
  readonly structureId: EntityId;
  readonly resource: string;
  readonly amount: number;
}

export interface BuildingRepairedEvent extends EventEnvelope {
  readonly kind: "building-repaired";
  readonly entityId: EntityId;
}

export interface WorshipPerformedEvent extends EventEnvelope {
  readonly kind: "worship-performed";
  readonly entityId: EntityId;
  readonly deity: EntityId;
  readonly offering?: ResourceAmount;
  readonly favorEffect: string;
  readonly favorExpiresAtTick: number;
}

export interface IncomeEarnedEvent extends EventEnvelope {
  readonly kind: "income-earned";
  readonly entityId: EntityId;
  readonly buildingId: EntityId;
  readonly amount: number;
}

/**
 * Records that a narrative was told, never that it is true. `entityId` is
 * the narrator; `assertion` is their free-form, possibly false story.
 * `linkedEventId`, when present, is the narrator's cited evidence: an event
 * that exists in the log, and nothing more. The world does not judge whether
 * that event supports the assertion, so a link makes a legend "event-linked",
 * never certified. The legend's own identity is the identity of this event.
 */
export interface LegendRecordedEvent extends EventEnvelope {
  readonly kind: "legend-recorded";
  readonly entityId: EntityId;
  readonly assertion: string;
  readonly linkedEventId?: EventId;
  /** What the narrator asserts happened, in structure; it may be false and is never judged. It gives each hearer a consequence, as a report's claim does. */
  readonly claim?: Consequence;
  /** Who heard it: the living actors at the narrator's place when it committed, fixed by the rules at execution and recorded here, minus the narrator. Empty when no one was present. */
  readonly hearers: readonly EntityId[];
}

/** Most characters of a goal's text, in a proposal and in the event that records it. A goal is a short aim in the god's own words. */
export const MAX_GOAL_LENGTH = 140;

/** How a god ends its goal: the god decides, the world never judges. */
export const GOAL_OUTCOMES = ["achieved", "failed", "abandoned"] as const;
export type GoalOutcome = (typeof GOAL_OUTCOMES)[number];

/** Most characters of report text (and of a legend's assertion, which every hearer's belief holds) a proposal, an event, or a stored belief may hold. A D23 tunable (docs/product/defaults.md); a prompt-sized account, not a document. */
export const MAX_REPORT_LENGTH = 280;

/** What a happening did to someone, as a witness or a listener understands it. `target` is who or what suffered or was served, when someone was. */
export interface Consequence {
  readonly effect: "harm" | "kindness";
  readonly agent: EntityId;
  readonly target?: EntityId;
}

/**
 * One actor told another something, at the same place. The content is the
 * teller's own account: possibly wrong, never certified, and never rewritten
 * by the world. `claim` is what the teller asserts happened, in structure: it
 * may be false, and it is the only thing that gives the listener a consequence.
 * `linkedEventId`, when present, is an event the teller witnessed and cites as
 * provenance; it teaches the listener nothing by itself.
 */
export interface ReportToldEvent extends EventEnvelope {
  readonly kind: "report-told";
  readonly entityId: EntityId;
  readonly listenerId: EntityId;
  readonly content: string;
  readonly claim?: Consequence;
  readonly linkedEventId?: EventId;
}

/** Why a mortal could not get what its routine needs. */
export const UNMET_NEED_REASONS = [
  "no-seller",
  "no-funds",
  "no-buyer",
] as const;
export type UnmetNeedReason = (typeof UNMET_NEED_REASONS)[number];

/**
 * A mortal's routine needs `resource` and cannot get it: a recorded cause a
 * prayer can cite. One stays open per mortal per resource until the need is
 * met. Private to the mortal.
 */
export interface UnmetNeedEvent extends EventEnvelope {
  readonly kind: "unmet-need";
  readonly entityId: EntityId;
  readonly resource: string;
  readonly reason: UnmetNeedReason;
}

/**
 * An owner noticed a loss of its own: it stood at its damaged, burning, or
 * destroyed building, or saw its own stock gone. Private to the mortal, and
 * recorded once per loss. It says what was lost and which event caused it, and
 * nothing of who did it: a loss known only this way has no known offender.
 */
export interface LossNoticedEvent extends EventEnvelope {
  readonly kind: "loss-noticed";
  readonly entityId: EntityId;
  /** The event that caused the loss: the damage, the fire, the theft, the spoilage. */
  readonly causeEventId: EventId;
  readonly building?: EntityId;
  readonly resource?: string;
  readonly amount?: number;
}

/** A mortal's unmet need was met: the scan found the routine can now get what it needed, and the open need is closed. Private to the mortal. */
export interface NeedMetEvent extends EventEnvelope {
  readonly kind: "need-met";
  readonly entityId: EntityId;
  readonly resource: string;
  /** The `unmet-need` event this closes. */
  readonly needEventId: EventId;
}

/** The quiet-world director made `entityId` take `amount` of `resource` from `victim`. Never undone. A prayer can cite it. */
export interface TheftEvent extends EventEnvelope {
  readonly kind: "theft";
  /** The offender. */
  readonly entityId: EntityId;
  readonly victim: EntityId;
  readonly resource: string;
  readonly amount: number;
  readonly cause: "director";
}

/** The quiet-world director spoiled `amount` of `entityId`'s `resource`. Never undone. A prayer can cite it. */
export interface StockSpoiledEvent extends EventEnvelope {
  readonly kind: "stock-spoiled";
  readonly entityId: EntityId;
  readonly resource: string;
  readonly amount: number;
  readonly cause: "director";
}

/** What a petition asks: help with a need, or punishment of an offender (and the buildings it owns, when it owns any). */
export type PetitionRequest =
  | {
      readonly kind: "help";
      readonly need:
        | { readonly kind: "building"; readonly building: EntityId }
        | {
            readonly kind: "resource";
            readonly resource: string;
            /** What was lost, for spoiled stock or a theft; absent for an unmet need. A blessing grants it back up to a cap. */
            readonly amount?: number;
          };
    }
  | {
      readonly kind: "punish";
      readonly offender: EntityId;
      /** The offender's buildings when the prayer was made; empty when it owns none, or is a god. */
      readonly buildings: readonly EntityId[];
    };

/**
 * A mortal prayed at the altar to one god about one recorded cause, asking one
 * thing. Placed at the altar: anyone there saw the mortal pray. The named god
 * hears it wherever it is, through the divine sense, and no other god does.
 */
export interface PetitionOpenedEvent extends EventEnvelope {
  readonly kind: "petition-opened";
  readonly entityId: EntityId;
  readonly god: EntityId;
  /** The committed event that happened to the petitioner, which this prayer is about. */
  readonly cause: EventId;
  readonly request: PetitionRequest;
}

/**
 * `entityId` (a god) blessed `recipient` at the god's own place, granting what
 * the petition `petitionId` needs: planks for a damaged `building`, or an amount
 * of a resource. The cost in divinity is a separate consumption event. The
 * mortal rebuilds through its own routine; the damage stays on record.
 */
export interface BlessingGrantedEvent extends EventEnvelope {
  readonly kind: "blessing-granted";
  readonly entityId: EntityId;
  readonly recipient: EntityId;
  readonly petitionId: EventId;
  readonly resource: string;
  readonly amount: number;
  readonly building?: EntityId;
}

/**
 * The world judged that `god` answered the petition `petitionId`, and sends
 * `entityId` a sign: a recorded, private divine act. It carries no knowledge
 * of where or how the god answered. `answeredBy` is the event of the answering
 * action.
 */
export interface PetitionAnsweredEvent extends EventEnvelope {
  readonly kind: "petition-answered";
  readonly entityId: EntityId;
  readonly god: EntityId;
  readonly petitionId: EventId;
  readonly answeredBy: EventId;
}

/** The answer window closed with the petition unanswered. */
export interface PetitionLapsedEvent extends EventEnvelope {
  readonly kind: "petition-lapsed";
  readonly entityId: EntityId;
  readonly god: EntityId;
  readonly petitionId: EventId;
}

/** `entityId` (a god) refused the petition `petitionId` of `petitioner`: an answer that closes it, and costs the god the petitioner's affinity as a lapse does. Private to the two. */
export interface PetitionRefusedEvent extends EventEnvelope {
  readonly kind: "petition-refused";
  readonly entityId: EntityId;
  readonly petitioner: EntityId;
  readonly petitionId: EventId;
}

/**
 * `entityId` (a mortal) took `to` as its patron in place of `from`: its affinity for `from` fell below the
 * defection threshold and `to` was the last other god to answer it. `unanswered` are the prayers to `from` that
 * lapsed or were refused, newest first; `answered` is the prayer `to` answered. Private to the two gods, who
 * each remember it (`patronage` memory).
 */
export interface PatronChangedEvent extends EventEnvelope {
  readonly kind: "patron-changed";
  readonly entityId: EntityId;
  readonly from: EntityId;
  readonly to: EntityId;
  readonly answered: EventId;
  readonly unanswered: readonly EventId[];
}

/** Why a god's goal change was refused. */
export const GOAL_REFUSAL_REASONS = ["locked"] as const;
export type GoalRefusalReason = (typeof GOAL_REFUSAL_REASONS)[number];

/** A god tried to replace or abandon its goal without a reason the world accepts. Private to the god, and shown in its next prompt. */
export interface GoalChangeRefusedEvent extends EventEnvelope {
  readonly kind: "goal-change-refused";
  readonly entityId: EntityId;
  readonly reason: GoalRefusalReason;
  readonly attempted: "replace" | "abandon";
  /** Ticks until the goal's lock passes on its own. */
  readonly unlocksInTicks: number;
}

/**
 * A god declared a goal: its own words and the one target it knows. A
 * declaration, like a legend: the world never checks that the target is alive
 * or reachable and never ends the goal itself. Private to the god.
 */
export interface GoalSetEvent extends EventEnvelope {
  readonly kind: "goal-set";
  readonly entityId: EntityId;
  readonly text: string;
  readonly target: EntityId;
}

/** A god's goal ended, by the god's own declaration, or because it set a new one (abandoned). `goalEventId` is the `goal-set` event it ends. */
export interface GoalEndedEvent extends EventEnvelope {
  readonly kind: "goal-ended";
  readonly entityId: EntityId;
  readonly outcome: GoalOutcome;
  readonly goalEventId: EventId;
}

/**
 * A god declared where it is going: the world stored the journey and will walk
 * it one hop a tick. Private to the god, like its goal; each hop is an
 * ordinary `entity-moved` or `realm-transitioned` event.
 */
export interface JourneyStartedEvent extends EventEnvelope {
  readonly kind: "journey-started";
  readonly entityId: EntityId;
  /** Where the god is going. */
  readonly to: EntityId;
}

/** How a journey ends: the god arrived, a hop was refused (or found no route), or the god committed another proposal. */
export const JOURNEY_ENDINGS = ["arrived", "refused", "replaced"] as const;
export type JourneyEnding = (typeof JOURNEY_ENDINGS)[number];

interface JourneyEndedBase extends EventEnvelope {
  readonly kind: "journey-ended";
  readonly entityId: EntityId;
  /** The `journey-started` event it ends. */
  readonly journeyEventId: EventId;
}

/** A journey ended without a refusal. */
export interface JourneyCompletedEvent extends JourneyEndedBase {
  readonly ending: "arrived" | "replaced";
}

/** A hop was refused, or no route remained; it moved nothing. `reason` is what the world answered. */
export interface JourneyRefusedEvent extends JourneyEndedBase {
  readonly ending: "refused";
  readonly reason: RejectionReasonCode;
}

export type JourneyEndedEvent = JourneyCompletedEvent | JourneyRefusedEvent;

/** What a practice thread is about: who did it and, when known, to whom or what. */
export interface ThreadSubject {
  readonly agent: EntityId;
  readonly target?: EntityId;
}

/**
 * A god opened a practice thread with another: a demand resting on `causes`,
 * the committed events the opener knows of, which the thread consumes. It holds
 * one term, with an absolute deadline, and stays open to answers until
 * `negotiationDeadline` (a world tick) or until the counteroffer budget is
 * spent. `succeeds` links a closed thread this one follows from.
 */
export interface PracticeOpenedEvent extends EventEnvelope {
  readonly kind: "practice-opened";
  /** The demander. */
  readonly entityId: EntityId;
  readonly practice: PracticeKind;
  /** The god the demand is made of. */
  readonly counterparty: EntityId;
  readonly causes: readonly EventId[];
  readonly term: PracticeTerm;
  readonly negotiationDeadline: number;
  readonly counterBudget: number;
  readonly succeeds?: EventId;
  /** The prayer a supplication answers: present exactly when `practice` is a supplication. A supplication's counterparty is the mortal who prayed, and the thread allows no counteroffers. */
  readonly petition?: EventId;
  /**
   * What the demand is about, in structure: the agent and, when the cause names
   * one, the target, taken from what the demander itself remembers of its
   * cause. Absent when its memory of the cause names no agent. A repeat demand
   * and talk around the thread are matched against it, never against words.
   */
  readonly subject?: ThreadSubject;
  /** What the breacher of the term becomes when it breaches: the transformation stake the demand carries. */
  readonly stake?: Transformation;
}

/**
 * One answer on a thread: a counter replaces the term on the table, an accept
 * binds the term (`sworn` when sworn by the Styx), a refusal or a withdrawal
 * closes the thread. Only moves bind; the thread is `threadId`'s `practice-opened`.
 */
export type PracticeMovedEvent = EventEnvelope & {
  readonly kind: "practice-moved";
  /** The god that moved. */
  readonly entityId: EntityId;
  readonly threadId: EventId;
} & (
    | { readonly move: "counter"; readonly term: PracticeTerm }
    | { readonly move: "accept"; readonly sworn: boolean }
    | { readonly move: "refuse" | "withdraw" }
  );

/**
 * The world ruled on a thread: what it observed, or which limit ran out.
 * `performedBy` is the committed event that showed the performance, when one
 * did. `entityId` is the demander and `counterparty` the other party.
 */
export interface PracticeEndedEvent extends EventEnvelope {
  readonly kind: "practice-ended";
  readonly entityId: EntityId;
  readonly counterparty: EntityId;
  readonly threadId: EventId;
  readonly outcome: PracticeOutcome;
  readonly reason: PracticeEndReason;
  readonly performedBy?: EventId;
}

/** What a motif changed, by kind of change. */
export type MotifEffect =
  /** Divinity lost, and a capability withheld until `accessRestoredAt` (a world tick): the bounded Styx penalty. */
  | {
      readonly effect: "oath-penalty";
      readonly divinityLost: number;
      readonly capability: string;
      readonly accessRestoredAt: number;
    }
  /** A change of form and capabilities that keeps the actor's identity, memory, and relationships. */
  | ({
      readonly effect: "transformation";
      readonly intent: "punishment" | "mercy";
    } & Transformation)
  /** Standing at `place` moved by `delta`: a state the world holds, changed for good (a settlement's performance or breach there, or a contest closing). */
  | {
      readonly effect: "standing";
      readonly place: EntityId;
      readonly delta: number;
    };

/**
 * A motif's change, applied to `entityId` because a thread ended: `threadId` is
 * the thread, `cause` the ending event (the breach, the performance) that
 * called for it. Primary events of the tick that ended the thread.
 */
export type MotifAppliedEvent = EventEnvelope & {
  readonly kind: "motif-applied";
  readonly entityId: EntityId;
  readonly motif: PracticeMotif;
  readonly threadId: EventId;
  readonly cause: EventId;
} & MotifEffect;

/** A capability a penalty withheld came back, when its period ran out. `motifEventId` is the penalty it ends. */
export interface AccessRestoredEvent extends EventEnvelope {
  readonly kind: "access-restored";
  readonly entityId: EntityId;
  readonly capability: string;
  readonly motifEventId: EventId;
}

/** The two halves of a supplication's bargain: the god's boon, and the mortal's offering. */
export const SUPPLICATION_STEPS = ["boon", "offering"] as const;
export type SupplicationStep = (typeof SUPPLICATION_STEPS)[number];

/**
 * One half of a supplication's bargain was seen done, the other still owing:
 * the world records it so the thread remembers it. `by` is the committed event
 * that showed it (the blessing, the worship). `entityId` is the god that opened
 * the thread and `counterparty` the mortal.
 */
export interface PracticeProgressedEvent extends EventEnvelope {
  readonly kind: "practice-progressed";
  readonly entityId: EntityId;
  readonly counterparty: EntityId;
  readonly threadId: EventId;
  readonly step: SupplicationStep;
  readonly by: EventId;
}

/**
 * A god opened a contest for the people of `place` over `cause`, a rival's
 * bless, strike, or legend it perceived there. `entityId` is the god that
 * opened it, `rival` the god whose act it was. Acts after this event and no
 * later than the tick `closesAt` count; the world closes it on its own.
 * `succeeds` is the closed contest between these gods at this place that a new
 * cause lets this one follow.
 */
export interface ContestOpenedEvent extends EventEnvelope {
  readonly kind: "contest-opened";
  readonly entityId: EntityId;
  readonly rival: EntityId;
  readonly place: EntityId;
  readonly cause: EventId;
  readonly closesAt: number;
  readonly succeeds?: EventId;
}

/** A mortal's favour at the close of a contest: the god that served it more over the window. */
export interface ContestFavour {
  readonly mortal: EntityId;
  readonly god: EntityId;
}

/**
 * The world closed a contest. A decided one names the `winner` (the god more
 * mortals favour) and each mortal's favour; the standing changes follow as
 * `motif-applied` events citing this one. An expired one, the place emptied or
 * no god favoured over the other, changes no one's standing.
 */
export type ContestClosedEvent = EventEnvelope & {
  readonly kind: "contest-closed";
  /** The god that opened the contest. */
  readonly entityId: EntityId;
  readonly rival: EntityId;
  readonly place: EntityId;
  readonly contestId: EventId;
} & (
    | {
        readonly result: "decided";
        readonly reason: "window";
        readonly winner: EntityId;
        readonly favoured: readonly ContestFavour[];
      }
    | {
        readonly result: "expired";
        readonly reason: "place-empty" | "no-favour";
      }
  );

/** The moves and talk a refusal can be about: a practice move, or a report or legend that talked around an open thread. */
export const PRACTICE_ATTEMPTS = [
  "demand",
  "offer",
  "counter",
  "accept",
  "refuse",
  "withdraw",
  "contest",
  "report",
  "legend",
] as const;
export type PracticeAttempt = (typeof PRACTICE_ATTEMPTS)[number];

/** Most characters of the reason a refused move is given. */
export const MAX_REFUSAL_WHY = 200;

/**
 * A god's practice move, or talk around its open thread, was refused. The
 * rejection itself travels through the journal and trace; this private event
 * is what lets the god's next prompt say so and why, and what replay
 * reproduces. `thread` is the thread it concerned, when one did; `why` is
 * what already answered the move, for a no-progress refusal.
 */
export interface PracticeRefusedEvent extends EventEnvelope {
  readonly kind: "practice-refused";
  /** The god that was refused. */
  readonly entityId: EntityId;
  readonly attempted: PracticeAttempt;
  readonly reason: RejectionReasonCode;
  readonly thread?: EventId;
  readonly why?: string;
}

/** Kinds that happen at no place: a report is heard only by its listener, a memory and a feeling are inside someone's head, a goal is the god's own, and a practice thread is held between its parties. Nobody perceives them, so nobody witnesses them. */
export const UNPLACED_EVENT_KINDS = [
  "report-told",
  "memory-recorded",
  "relationship-changed",
  "goal-set",
  "goal-ended",
  "journey-started",
  "journey-ended",
  "unmet-need",
  "need-met",
  "loss-noticed",
  "petition-answered",
  "petition-lapsed",
  "petition-refused",
  "patron-changed",
  "goal-change-refused",
  "practice-opened",
  "practice-moved",
  "practice-ended",
  "practice-progressed",
  "practice-refused",
  "motif-applied",
  "access-restored",
  "contest-opened",
  "contest-closed",
] as const;

/** The kinds an actor can witness. */
export type WitnessedEventKind = Exclude<
  WorldEvent["kind"],
  (typeof UNPLACED_EVENT_KINDS)[number]
>;

export interface MemoryRecordedBase extends EventEnvelope {
  readonly kind: "memory-recorded";
  /** Whose memory this is. */
  readonly entityId: EntityId;
  /** The committed event this memory rests on: the event witnessed, or the report heard. */
  readonly sourceEventId: EventId;
  /** How memorable this is; a full memory evicts its least salient entry first. A positive whole number. */
  readonly salience: number;
  readonly subjects: readonly EntityId[];
  readonly consequence?: Consequence;
}

/** The unplaced events that end a thread; their parties remember them though no one stands at them. */
export const ENDING_EVENT_KINDS = ["practice-moved", "practice-ended"] as const;
export type EndingEventKind = (typeof ENDING_EVENT_KINDS)[number];

/** What a participant remembers of how a thread ended: the outcome and, when someone's act decided it, who. */
export interface MemoryEnding {
  readonly outcome: PracticeOutcome;
  /** Who refused, withdrew, performed, or breached; absent when no one's act did (a lapse, a spent budget, a death). */
  readonly agent?: EntityId;
  /** The ending sealed an alliance between the two parties. */
  readonly sealed?: true;
  /** The term had been sworn by the Styx. */
  readonly sworn?: true;
}

/** The actor was there when the event happened, or took part in the thread the event ended (`ending`). */
export interface WitnessedMemoryRecordedEvent extends MemoryRecordedBase {
  readonly memoryKind: "witnessed";
  readonly eventKind: WitnessedEventKind | EndingEventKind;
  /** Present exactly when `eventKind` is an ending event. */
  readonly ending?: MemoryEnding;
}

/** The actor was told, and holds the teller's account as a belief: attributed, possibly false, never resolved to the truth. */
export interface ToldMemoryRecordedEvent extends MemoryRecordedBase {
  readonly memoryKind: "told";
  readonly teller: EntityId;
  readonly content: string;
  readonly linkedEventId?: EventId;
}

/**
 * A mortal remembers a god's answer, or its silence: the sign of an answered
 * petition (a kindness by the god), a lapse (harm by its neglect), or a refusal
 * (the same harm). The consequence is what moves the mortal's affinity toward the god.
 */
export interface SignMemoryRecordedEvent extends MemoryRecordedBase {
  readonly memoryKind: "sign";
  readonly god: EntityId;
  readonly outcome: "answered" | "lapsed" | "refused";
  readonly petitionId: EventId;
  readonly consequence: Consequence;
}

/**
 * A mortal remembers a loss it noticed, with no offender: what lets it pray for
 * help about the loss after it has walked away from it. Carries no consequence,
 * so it blames no one and moves no affinity.
 */
export interface NoticedMemoryRecordedEvent extends MemoryRecordedBase {
  readonly memoryKind: "noticed";
  /** The event that caused the loss: what a prayer about it cites. */
  readonly causeEventId: EventId;
}

/**
 * A god remembers that a mortal changed patron, as the god it left or the god it came to: the mortal, its home,
 * and the other god. `sourceEventId` is the `patron-changed` event, which is what a contest over the defection cites.
 * `subjects` are the mortal, its home, and the other god.
 */
export interface PatronageMemoryRecordedEvent extends MemoryRecordedBase {
  readonly memoryKind: "patronage";
  readonly mortal: EntityId;
  readonly home: EntityId;
  readonly from: EntityId;
  readonly to: EntityId;
}

export type MemoryRecordedEvent =
  | WitnessedMemoryRecordedEvent
  | ToldMemoryRecordedEvent
  | SignMemoryRecordedEvent
  | NoticedMemoryRecordedEvent
  | PatronageMemoryRecordedEvent;

/**
 * A relationship changed because of one memory: `entityId` now feels
 * differently toward `toward`. `memoryEventId` is the `memory-recorded` event
 * that formed the memory, so the change explains itself from the log alone.
 * `allied` is present only when the change flipped the alliance.
 */
export interface RelationshipChangedEvent extends EventEnvelope {
  readonly kind: "relationship-changed";
  readonly entityId: EntityId;
  readonly toward: EntityId;
  readonly affinityDelta: number;
  readonly grudgeDelta: number;
  readonly allied?: boolean;
  readonly memoryEventId: EventId;
}

export type WorldEvent =
  | EntityMovedEvent
  | RealmTransitionedEvent
  | ResourceGatheredEvent
  | ResourceProducedEvent
  | ResourceTradedEvent
  | ResourceConsumedEvent
  | BuildingDamagedEvent
  | MortalStruckEvent
  | BuildingIgnitedEvent
  | BuildingBurnTickedEvent
  | BuildingDestroyedEvent
  | RepairProgressedEvent
  | BuildingRepairedEvent
  | WorshipPerformedEvent
  | IncomeEarnedEvent
  | LegendRecordedEvent
  | ReportToldEvent
  | MemoryRecordedEvent
  | RelationshipChangedEvent
  | GoalSetEvent
  | GoalEndedEvent
  | JourneyStartedEvent
  | JourneyEndedEvent
  | UnmetNeedEvent
  | NeedMetEvent
  | LossNoticedEvent
  | TheftEvent
  | StockSpoiledEvent
  | PetitionOpenedEvent
  | BlessingGrantedEvent
  | PetitionAnsweredEvent
  | PetitionLapsedEvent
  | PetitionRefusedEvent
  | PatronChangedEvent
  | GoalChangeRefusedEvent
  | PracticeOpenedEvent
  | PracticeMovedEvent
  | PracticeEndedEvent
  | PracticeProgressedEvent
  | PracticeRefusedEvent
  | MotifAppliedEvent
  | AccessRestoredEvent
  | ContestOpenedEvent
  | ContestClosedEvent;

const EVENT_KIND_SET: Record<WorldEvent["kind"], true> = {
  "entity-moved": true,
  "realm-transitioned": true,
  "resource-gathered": true,
  "resource-produced": true,
  "resource-traded": true,
  "resource-consumed": true,
  "building-damaged": true,
  "mortal-struck": true,
  "building-ignited": true,
  "building-burn-ticked": true,
  "building-destroyed": true,
  "repair-progressed": true,
  "building-repaired": true,
  "worship-performed": true,
  "income-earned": true,
  "legend-recorded": true,
  "report-told": true,
  "memory-recorded": true,
  "relationship-changed": true,
  "goal-set": true,
  "goal-ended": true,
  "journey-started": true,
  "journey-ended": true,
  "unmet-need": true,
  "need-met": true,
  "loss-noticed": true,
  theft: true,
  "stock-spoiled": true,
  "petition-opened": true,
  "blessing-granted": true,
  "petition-answered": true,
  "petition-lapsed": true,
  "petition-refused": true,
  "patron-changed": true,
  "goal-change-refused": true,
  "practice-opened": true,
  "practice-moved": true,
  "practice-ended": true,
  "practice-progressed": true,
  "practice-refused": true,
  "motif-applied": true,
  "access-restored": true,
  "contest-opened": true,
  "contest-closed": true,
};

/** Every event kind, kept exhaustive by the record above: adding a kind to `WorldEvent` fails typecheck until it is listed here. */
export const WORLD_EVENT_KINDS = Object.keys(
  EVENT_KIND_SET,
) as readonly WorldEvent["kind"][];

/** Every kind an actor can witness: all of them but the unplaced ones. */
export const WITNESSED_EVENT_KINDS = WORLD_EVENT_KINDS.filter(
  (kind): kind is WitnessedEventKind =>
    !(UNPLACED_EVENT_KINDS as readonly string[]).includes(kind),
);

/**
 * The actor, building, location, and deity ids an event touches, in the
 * order its payload names them and without repeats. A client uses these
 * to decide which committed events concern what it is showing.
 */
export function eventSubjects(event: WorldEvent): readonly EntityId[] {
  const ids: readonly EntityId[] = (() => {
    switch (event.kind) {
      case "entity-moved":
        return [event.entityId, event.to];
      case "realm-transitioned":
        return [event.entityId, event.to, event.via];
      case "resource-traded":
        return [event.entityId, event.counterpartyId];
      case "repair-progressed":
        return [event.entityId, event.structureId];
      case "worship-performed":
        return [event.entityId, event.deity];
      case "income-earned":
        return [event.entityId, event.buildingId];
      case "report-told":
        return [event.entityId, event.listenerId];
      case "relationship-changed":
        return [event.entityId, event.toward];
      case "goal-set":
        return [event.entityId, event.target];
      case "journey-started":
        return [event.entityId, event.to];
      case "loss-noticed":
        return [
          event.entityId,
          ...(event.building === undefined ? [] : [event.building]),
        ];
      case "theft":
        return [event.entityId, event.victim];
      case "blessing-granted":
        return [
          event.entityId,
          event.recipient,
          ...(event.building === undefined ? [] : [event.building]),
        ];
      case "petition-opened":
        return [
          event.entityId,
          event.god,
          ...(event.request.kind === "punish"
            ? [event.request.offender, ...event.request.buildings]
            : event.request.need.kind === "building"
              ? [event.request.need.building]
              : []),
        ];
      case "petition-answered":
      case "petition-lapsed":
        return [event.entityId, event.god];
      case "petition-refused":
        return [event.entityId, event.petitioner];
      case "patron-changed":
        return [event.entityId, event.from, event.to];
      case "mortal-struck":
        return [event.entityId, event.actor];
      case "practice-opened":
        return [event.entityId, event.counterparty];
      case "practice-ended":
      case "practice-progressed":
        return [event.entityId, event.counterparty];
      case "contest-opened":
      case "contest-closed":
        return [event.entityId, event.rival, event.place];
      case "practice-moved":
      case "practice-refused":
      case "motif-applied":
      case "access-restored":
      case "unmet-need":
      case "need-met":
      case "stock-spoiled":
      case "goal-change-refused":
      case "goal-ended":
      case "journey-ended":
      case "memory-recorded":
      case "resource-gathered":
      case "resource-produced":
      case "resource-consumed":
      case "building-damaged":
      case "building-ignited":
      case "building-burn-ticked":
      case "building-destroyed":
      case "building-repaired":
      case "legend-recorded":
        return [event.entityId];
    }
  })();
  return [...new Set(ids)];
}

/**
 * The event `event` follows from, when it names one: a burn or destruction
 * follows the ignition that started the fire; a spread follows the source
 * building's ignition; a memory follows the event it rests on; a report
 * follows the event it cites; a relationship change follows the memory that
 * caused it; a goal's end follows the goal it ends. A strike ignition, or any event a proposal committed with nothing
 * cited, is a root: its own proposal is its cause, and the trace holds that.
 */
export function eventCause(event: WorldEvent): EventId | undefined {
  switch (event.kind) {
    case "building-burn-ticked":
    case "building-destroyed":
      return event.cause;
    case "building-ignited":
      return event.cause.kind === "spread" ? event.cause.from : undefined;
    case "memory-recorded":
      return event.sourceEventId;
    case "report-told":
      return event.linkedEventId;
    case "relationship-changed":
      return event.memoryEventId;
    case "goal-ended":
      return event.goalEventId;
    case "journey-ended":
      return event.journeyEventId;
    case "petition-opened":
      return event.cause;
    case "need-met":
      return event.needEventId;
    case "loss-noticed":
      return event.causeEventId;
    case "petition-answered":
    case "petition-lapsed":
    case "petition-refused":
    case "blessing-granted":
      return event.petitionId;
    case "patron-changed":
      return event.answered;
    case "practice-opened":
      return event.causes[0];
    case "practice-moved":
      return event.threadId;
    case "practice-ended":
      return event.performedBy ?? event.threadId;
    case "practice-progressed":
      return event.by;
    case "practice-refused":
      return event.thread;
    case "contest-opened":
      return event.cause;
    case "contest-closed":
      return event.contestId;
    case "motif-applied":
      return event.cause;
    case "access-restored":
      return event.motifEventId;
    default:
      return undefined;
  }
}

/**
 * The chain of events that led to `eventId`, root first and ending at that
 * event, walked from the log alone with `getEvent` (so it needs no trace).
 * The chain ends early where the log has no such event; an unknown
 * `eventId` gives an empty chain.
 */
export function causalChain(
  getEvent: (id: EventId) => WorldEvent | undefined,
  eventId: EventId,
): readonly WorldEvent[] {
  const chain: WorldEvent[] = [];
  const seen = new Set<EventId>();
  let current = getEvent(eventId);
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    const cause = eventCause(current);
    current = cause === undefined ? undefined : getEvent(cause);
  }
  return chain;
}

export const LATEST_EVENT_SCHEMA_VERSION = 1;
const EVENT_SCHEMA_VERSIONS = [LATEST_EVENT_SCHEMA_VERSION] as const;

function parseInteger(value: unknown, path: string): ParseResult<number> {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return fail(path, "expected an integer");
  }
  return ok(value);
}

function parseOptionalEventId(
  value: unknown,
  path: string,
): ParseResult<EventId | undefined> {
  if (value === undefined) return ok(undefined);
  return parseEventId(value, path);
}

function parseFireCause(value: unknown, path: string): ParseResult<FireCause> {
  if (!isRecord(value)) return fail(path, "expected a fire cause object");
  if (value.kind === "director") return ok({ kind: "director" });
  const actor =
    value.actor === undefined
      ? ok<EntityId | undefined>(undefined)
      : parseEntityId(value.actor, `${path}.actor`);
  if (!actor.ok) return actor;
  if (value.kind === "strike") {
    if (actor.value === undefined)
      return fail(`${path}.actor`, "a strike names who struck");
    return ok({ kind: "strike", actor: actor.value });
  }
  if (value.kind === "spread") {
    const from = parseEventId(value.from, `${path}.from`);
    if (!from.ok) return from;
    return ok({
      kind: "spread",
      from: from.value,
      ...(actor.value === undefined ? {} : { actor: actor.value }),
    });
  }
  return fail(path, `unknown fire cause: ${String(value.kind)}`);
}

const CONSEQUENCE_EFFECTS = ["harm", "kindness"] as const;

/** Parses a memory's optional consequence; `undefined` when absent. */
export function parseConsequence(
  value: unknown,
  path: string,
): ParseResult<Consequence | undefined> {
  if (value === undefined) return ok(undefined);
  if (!isRecord(value)) return fail(path, "expected a consequence object");
  const effect = parseEnum(value.effect, `${path}.effect`, CONSEQUENCE_EFFECTS);
  if (!effect.ok) return effect;
  const agent = parseEntityId(value.agent, `${path}.agent`);
  if (!agent.ok) return agent;
  const target =
    value.target === undefined
      ? ok<EntityId | undefined>(undefined)
      : parseEntityId(value.target, `${path}.target`);
  if (!target.ok) return target;
  return ok({
    effect: effect.value,
    agent: agent.value,
    ...(target.value === undefined ? {} : { target: target.value }),
  });
}

/** Report text: non-empty and at most `MAX_REPORT_LENGTH` characters. */
export function parseReportContent(
  value: unknown,
  path: string,
): ParseResult<string> {
  const content = parseString(value, path);
  if (!content.ok) return content;
  if (content.value.length > MAX_REPORT_LENGTH) {
    return fail(path, `expected at most ${MAX_REPORT_LENGTH} characters`);
  }
  return content;
}

/** A positive whole number. */
function parsePositiveInteger(
  value: unknown,
  path: string,
): ParseResult<number> {
  const n = parseNonNegativeInteger(value, path);
  if (!n.ok) return n;
  if (n.value < 1) return fail(path, "expected a positive integer");
  return n;
}

/** A petition's request: help with a building or a resource, or punishment of an offender and the buildings it owns. */
export function parsePetitionRequest(
  value: unknown,
  path: string,
): ParseResult<PetitionRequest> {
  if (!isRecord(value)) return fail(path, "expected a request object");
  if (value.kind === "help") {
    if (!isRecord(value.need))
      return fail(`${path}.need`, "expected a need object");
    if (value.need.kind === "building") {
      const building = parseEntityId(
        value.need.building,
        `${path}.need.building`,
      );
      if (!building.ok) return building;
      return ok({
        kind: "help",
        need: { kind: "building", building: building.value },
      });
    }
    if (value.need.kind === "resource") {
      const resource = parseString(
        value.need.resource,
        `${path}.need.resource`,
      );
      if (!resource.ok) return resource;
      const amount =
        value.need.amount === undefined
          ? ok<number | undefined>(undefined)
          : parsePositiveInteger(value.need.amount, `${path}.need.amount`);
      if (!amount.ok) return amount;
      return ok({
        kind: "help",
        need: {
          kind: "resource",
          resource: resource.value,
          ...(amount.value === undefined ? {} : { amount: amount.value }),
        },
      });
    }
    return fail(`${path}.need.kind`, "expected a building or a resource");
  }
  if (value.kind === "punish") {
    const offender = parseEntityId(value.offender, `${path}.offender`);
    if (!offender.ok) return offender;
    const buildings = parseArray(
      value.buildings,
      `${path}.buildings`,
      parseEntityId,
    );
    if (!buildings.ok) return buildings;
    return ok({
      kind: "punish",
      offender: offender.value,
      buildings: buildings.value,
    });
  }
  return fail(`${path}.kind`, "expected help or punish");
}

/** A goal's text: not blank and at most `MAX_GOAL_LENGTH` characters. */
export function parseGoalText(
  value: unknown,
  path: string,
): ParseResult<string> {
  if (typeof value !== "string" || value.trim() === "") {
    return fail(path, "expected a non-blank string");
  }
  if (value.length > MAX_GOAL_LENGTH) {
    return fail(path, `expected at most ${MAX_GOAL_LENGTH} characters`);
  }
  return ok(value);
}

/** A memory's salience: a positive whole number. */
export function parseSalience(
  value: unknown,
  path: string,
): ParseResult<number> {
  const salience = parseNonNegativeInteger(value, path);
  if (!salience.ok) return salience;
  if (salience.value < 1) return fail(path, "expected a positive integer");
  return salience;
}

function parseMemoryRecorded(
  input: Record<string, unknown>,
  envelope: EventEnvelope,
): ParseResult<MemoryRecordedEvent> {
  const entityId = parseEntityId(input.entityId, "entityId");
  if (!entityId.ok) return entityId;
  const sourceEventId = parseEventId(input.sourceEventId, "sourceEventId");
  if (!sourceEventId.ok) return sourceEventId;
  const salience = parseSalience(input.salience, "salience");
  if (!salience.ok) return salience;
  const subjects = parseArray(input.subjects, "subjects", parseEntityId);
  if (!subjects.ok) return subjects;
  const consequence = parseConsequence(input.consequence, "consequence");
  if (!consequence.ok) return consequence;
  const base = {
    ...envelope,
    kind: "memory-recorded" as const,
    entityId: entityId.value,
    sourceEventId: sourceEventId.value,
    salience: salience.value,
    subjects: subjects.value,
    ...(consequence.value === undefined
      ? {}
      : { consequence: consequence.value }),
  };

  switch (input.memoryKind) {
    case "witnessed": {
      const eventKind = parseEnum(input.eventKind, "eventKind", [
        ...WITNESSED_EVENT_KINDS,
        ...ENDING_EVENT_KINDS,
      ] as const);
      if (!eventKind.ok) return eventKind;
      const isEnding = (ENDING_EVENT_KINDS as readonly string[]).includes(
        eventKind.value,
      );
      const ending = parseMemoryEnding(input.ending, "ending");
      if (!ending.ok) return ending;
      if (isEnding !== (ending.value !== undefined)) {
        return fail(
          "ending",
          "a memory of an ending event says how it ended, and no other does",
        );
      }
      return ok({
        ...base,
        memoryKind: "witnessed",
        eventKind: eventKind.value,
        ...(ending.value === undefined ? {} : { ending: ending.value }),
      });
    }
    case "told": {
      const teller = parseEntityId(input.teller, "teller");
      if (!teller.ok) return teller;
      const content = parseReportContent(input.content, "content");
      if (!content.ok) return content;
      const linkedEventId = parseOptionalEventId(
        input.linkedEventId,
        "linkedEventId",
      );
      if (!linkedEventId.ok) return linkedEventId;
      return ok({
        ...base,
        memoryKind: "told",
        teller: teller.value,
        content: content.value,
        ...(linkedEventId.value === undefined
          ? {}
          : { linkedEventId: linkedEventId.value }),
      });
    }
    case "noticed": {
      const causeEventId = parseEventId(input.causeEventId, "causeEventId");
      if (!causeEventId.ok) return causeEventId;
      if (consequence.value !== undefined) {
        return fail("consequence", "a noticed loss blames no one");
      }
      return ok({
        ...base,
        memoryKind: "noticed",
        causeEventId: causeEventId.value,
      });
    }
    case "sign": {
      const god = parseEntityId(input.god, "god");
      if (!god.ok) return god;
      const outcome = parseEnum(input.outcome, "outcome", [
        "answered",
        "lapsed",
        "refused",
      ] as const);
      if (!outcome.ok) return outcome;
      const petitionId = parseEventId(input.petitionId, "petitionId");
      if (!petitionId.ok) return petitionId;
      if (consequence.value === undefined) {
        return fail("consequence", "a sign leaves a kindness or a harm");
      }
      return ok({
        ...base,
        memoryKind: "sign",
        god: god.value,
        outcome: outcome.value,
        petitionId: petitionId.value,
        consequence: consequence.value,
      });
    }
    case "patronage": {
      const mortal = parseEntityId(input.mortal, "mortal");
      if (!mortal.ok) return mortal;
      const home = parseEntityId(input.home, "home");
      if (!home.ok) return home;
      const from = parseEntityId(input.from, "from");
      if (!from.ok) return from;
      const to = parseEntityId(input.to, "to");
      if (!to.ok) return to;
      if (consequence.value !== undefined) {
        return fail("consequence", "a change of patron blames no one");
      }
      return ok({
        ...base,
        memoryKind: "patronage",
        mortal: mortal.value,
        home: home.value,
        from: from.value,
        to: to.value,
      });
    }
    default:
      return fail(
        "memoryKind",
        `unknown memory kind: ${String(input.memoryKind)}`,
      );
  }
}

export function parseThreadSubject(
  value: unknown,
  path: string,
): ParseResult<ThreadSubject | undefined> {
  if (value === undefined) return ok(undefined);
  if (!isRecord(value)) return fail(path, "expected a subject object");
  const agent = parseEntityId(value.agent, `${path}.agent`);
  if (!agent.ok) return agent;
  const target =
    value.target === undefined
      ? ok<EntityId | undefined>(undefined)
      : parseEntityId(value.target, `${path}.target`);
  if (!target.ok) return target;
  return ok({
    agent: agent.value,
    ...(target.value === undefined ? {} : { target: target.value }),
  });
}

export function parseMemoryEnding(
  value: unknown,
  path: string,
): ParseResult<MemoryEnding | undefined> {
  if (value === undefined) return ok(undefined);
  if (!isRecord(value)) return fail(path, "expected an ending object");
  const outcome = parseEnum(
    value.outcome,
    `${path}.outcome`,
    PRACTICE_OUTCOMES,
  );
  if (!outcome.ok) return outcome;
  const agent =
    value.agent === undefined
      ? ok<EntityId | undefined>(undefined)
      : parseEntityId(value.agent, `${path}.agent`);
  if (!agent.ok) return agent;
  if (value.sealed !== undefined && value.sealed !== true) {
    return fail(`${path}.sealed`, "expected true or nothing");
  }
  if (value.sworn !== undefined && value.sworn !== true) {
    return fail(`${path}.sworn`, "expected true or nothing");
  }
  return ok({
    outcome: outcome.value,
    ...(agent.value === undefined ? {} : { agent: agent.value }),
    ...(value.sealed === true ? { sealed: true as const } : {}),
    ...(value.sworn === true ? { sworn: true as const } : {}),
  });
}

export function parseEvent(input: unknown): ParseResult<WorldEvent> {
  if (!isRecord(input)) {
    return fail("", "expected an event object");
  }

  const schemaVersion = parseSchemaVersion(
    input.schemaVersion,
    EVENT_SCHEMA_VERSIONS,
  );
  if (!schemaVersion.ok) return schemaVersion;

  const id = parseEventId(input.id, "id");
  if (!id.ok) return id;
  const sequence = parseNonNegativeInteger(input.sequence, "sequence");
  if (!sequence.ok) return sequence;
  const simTime = parseFiniteNumber(input.simTime, "simTime");
  if (!simTime.ok) return simTime;
  const tick = parseNonNegativeInteger(input.tick, "tick");
  if (!tick.ok) return tick;
  const correlationId = parseCorrelationId(
    input.correlationId,
    "correlationId",
  );
  if (!correlationId.ok) return correlationId;
  const causationId = parseCausationId(input.causationId, "causationId");
  if (!causationId.ok) return causationId;
  const approximate = parseBoolean(input.approximate, "approximate");
  if (!approximate.ok) return approximate;

  const envelope: EventEnvelope = {
    schemaVersion: schemaVersion.value,
    id: id.value,
    sequence: sequence.value,
    simTime: simTime.value,
    tick: tick.value,
    correlationId: correlationId.value,
    causationId: causationId.value,
    approximate: approximate.value,
  };

  switch (input.kind) {
    case "entity-moved": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const to = parseEntityId(input.to, "to");
      if (!to.ok) return to;
      return ok({
        ...envelope,
        kind: "entity-moved",
        entityId: entityId.value,
        to: to.value,
      });
    }
    case "realm-transitioned": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const to = parseEntityId(input.to, "to");
      if (!to.ok) return to;
      const via = parseEntityId(input.via, "via");
      if (!via.ok) return via;
      return ok({
        ...envelope,
        kind: "realm-transitioned",
        entityId: entityId.value,
        to: to.value,
        via: via.value,
      });
    }
    case "resource-gathered": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const resource = parseString(input.resource, "resource");
      if (!resource.ok) return resource;
      const amount = parseNonNegativeNumber(input.amount, "amount");
      if (!amount.ok) return amount;
      return ok({
        ...envelope,
        kind: "resource-gathered",
        entityId: entityId.value,
        resource: resource.value,
        amount: amount.value,
      });
    }
    case "resource-produced": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const output = parseString(input.output, "output");
      if (!output.ok) return output;
      const quantity = parseNonNegativeNumber(input.quantity, "quantity");
      if (!quantity.ok) return quantity;
      return ok({
        ...envelope,
        kind: "resource-produced",
        entityId: entityId.value,
        output: output.value,
        quantity: quantity.value,
      });
    }
    case "resource-traded": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const counterpartyId = parseEntityId(
        input.counterpartyId,
        "counterpartyId",
      );
      if (!counterpartyId.ok) return counterpartyId;
      const give = parseArray(input.give, "give", parseResourceAmount);
      if (!give.ok) return give;
      const receive = parseArray(input.receive, "receive", parseResourceAmount);
      if (!receive.ok) return receive;
      return ok({
        ...envelope,
        kind: "resource-traded",
        entityId: entityId.value,
        counterpartyId: counterpartyId.value,
        give: give.value,
        receive: receive.value,
      });
    }
    case "resource-consumed": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const resource = parseString(input.resource, "resource");
      if (!resource.ok) return resource;
      const amount = parseNonNegativeNumber(input.amount, "amount");
      if (!amount.ok) return amount;
      return ok({
        ...envelope,
        kind: "resource-consumed",
        entityId: entityId.value,
        resource: resource.value,
        amount: amount.value,
      });
    }
    case "building-damaged": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const amount = parseNonNegativeNumber(input.amount, "amount");
      if (!amount.ok) return amount;
      const actor = parseEntityId(input.actor, "actor");
      if (!actor.ok) return actor;
      return ok({
        ...envelope,
        kind: "building-damaged",
        entityId: entityId.value,
        amount: amount.value,
        actor: actor.value,
      });
    }
    case "mortal-struck": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const actor = parseEntityId(input.actor, "actor");
      if (!actor.ok) return actor;
      const amount = parseNonNegativeInteger(input.amount, "amount");
      if (!amount.ok) return amount;
      const resource =
        input.resource === undefined
          ? ok<string | undefined>(undefined)
          : parseString(input.resource, "resource");
      if (!resource.ok) return resource;
      if ((resource.value === undefined) !== (amount.value === 0)) {
        return fail(
          "resource",
          "a strike took a resource exactly when it took an amount",
        );
      }
      return ok({
        ...envelope,
        kind: "mortal-struck",
        entityId: entityId.value,
        actor: actor.value,
        amount: amount.value,
        ...(resource.value === undefined ? {} : { resource: resource.value }),
      });
    }
    case "building-ignited": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const cause = parseFireCause(input.cause, "cause");
      if (!cause.ok) return cause;
      return ok({
        ...envelope,
        kind: "building-ignited",
        entityId: entityId.value,
        cause: cause.value,
      });
    }
    case "building-burn-ticked": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const fireIntensity = parseNonNegativeNumber(
        input.fireIntensity,
        "fireIntensity",
      );
      if (!fireIntensity.ok) return fireIntensity;
      const ticksBurning = parseNonNegativeInteger(
        input.ticksBurning,
        "ticksBurning",
      );
      if (!ticksBurning.ok) return ticksBurning;
      const cause = parseEventId(input.cause, "cause");
      if (!cause.ok) return cause;
      return ok({
        ...envelope,
        kind: "building-burn-ticked",
        entityId: entityId.value,
        fireIntensity: fireIntensity.value,
        ticksBurning: ticksBurning.value,
        cause: cause.value,
      });
    }
    case "building-destroyed": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const disposedInventory = parseArray(
        input.disposedInventory,
        "disposedInventory",
        parseResourceAmount,
      );
      if (!disposedInventory.ok) return disposedInventory;
      const cause = parseEventId(input.cause, "cause");
      if (!cause.ok) return cause;
      return ok({
        ...envelope,
        kind: "building-destroyed",
        entityId: entityId.value,
        disposedInventory: disposedInventory.value,
        cause: cause.value,
      });
    }
    case "repair-progressed": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const structureId = parseEntityId(input.structureId, "structureId");
      if (!structureId.ok) return structureId;
      const resource = parseString(input.resource, "resource");
      if (!resource.ok) return resource;
      const amount = parseNonNegativeNumber(input.amount, "amount");
      if (!amount.ok) return amount;
      return ok({
        ...envelope,
        kind: "repair-progressed",
        entityId: entityId.value,
        structureId: structureId.value,
        resource: resource.value,
        amount: amount.value,
      });
    }
    case "building-repaired": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      return ok({
        ...envelope,
        kind: "building-repaired",
        entityId: entityId.value,
      });
    }
    case "worship-performed": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const deity = parseEntityId(input.deity, "deity");
      if (!deity.ok) return deity;
      const offering =
        input.offering === undefined
          ? ok<ResourceAmount | undefined>(undefined)
          : parseResourceAmount(input.offering, "offering");
      if (!offering.ok) return offering;
      const favorEffect = parseString(input.favorEffect, "favorEffect");
      if (!favorEffect.ok) return favorEffect;
      const favorExpiresAtTick = parseNonNegativeInteger(
        input.favorExpiresAtTick,
        "favorExpiresAtTick",
      );
      if (!favorExpiresAtTick.ok) return favorExpiresAtTick;
      return ok({
        ...envelope,
        kind: "worship-performed",
        entityId: entityId.value,
        deity: deity.value,
        ...(offering.value === undefined ? {} : { offering: offering.value }),
        favorEffect: favorEffect.value,
        favorExpiresAtTick: favorExpiresAtTick.value,
      });
    }
    case "income-earned": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const buildingId = parseEntityId(input.buildingId, "buildingId");
      if (!buildingId.ok) return buildingId;
      const amount = parseNonNegativeNumber(input.amount, "amount");
      if (!amount.ok) return amount;
      return ok({
        ...envelope,
        kind: "income-earned",
        entityId: entityId.value,
        buildingId: buildingId.value,
        amount: amount.value,
      });
    }
    case "legend-recorded": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const assertion = parseReportContent(input.assertion, "assertion");
      if (!assertion.ok) return assertion;
      const linkedEventIdRaw = parseOptionalString(
        input.linkedEventId,
        "linkedEventId",
      );
      if (!linkedEventIdRaw.ok) return linkedEventIdRaw;
      const claim = parseConsequence(input.claim, "claim");
      if (!claim.ok) return claim;
      const hearers = parseArray(input.hearers, "hearers", parseEntityId);
      if (!hearers.ok) return hearers;
      return ok({
        ...envelope,
        kind: "legend-recorded",
        entityId: entityId.value,
        assertion: assertion.value,
        ...(linkedEventIdRaw.value === undefined
          ? {}
          : { linkedEventId: linkedEventIdRaw.value as EventId }),
        ...(claim.value === undefined ? {} : { claim: claim.value }),
        hearers: hearers.value,
      });
    }
    case "report-told": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const listenerId = parseEntityId(input.listenerId, "listenerId");
      if (!listenerId.ok) return listenerId;
      const content = parseReportContent(input.content, "content");
      if (!content.ok) return content;
      const claim = parseConsequence(input.claim, "claim");
      if (!claim.ok) return claim;
      const linkedEventId = parseOptionalEventId(
        input.linkedEventId,
        "linkedEventId",
      );
      if (!linkedEventId.ok) return linkedEventId;
      return ok({
        ...envelope,
        kind: "report-told",
        entityId: entityId.value,
        listenerId: listenerId.value,
        content: content.value,
        ...(claim.value === undefined ? {} : { claim: claim.value }),
        ...(linkedEventId.value === undefined
          ? {}
          : { linkedEventId: linkedEventId.value }),
      });
    }
    case "memory-recorded":
      return parseMemoryRecorded(input, envelope);
    case "relationship-changed": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const toward = parseEntityId(input.toward, "toward");
      if (!toward.ok) return toward;
      const affinityDelta = parseInteger(input.affinityDelta, "affinityDelta");
      if (!affinityDelta.ok) return affinityDelta;
      const grudgeDelta = parseNonNegativeInteger(
        input.grudgeDelta,
        "grudgeDelta",
      );
      if (!grudgeDelta.ok) return grudgeDelta;
      const allied = parseOptionalBoolean(input.allied, "allied");
      if (!allied.ok) return allied;
      const memoryEventId = parseEventId(input.memoryEventId, "memoryEventId");
      if (!memoryEventId.ok) return memoryEventId;
      return ok({
        ...envelope,
        kind: "relationship-changed",
        entityId: entityId.value,
        toward: toward.value,
        affinityDelta: affinityDelta.value,
        grudgeDelta: grudgeDelta.value,
        ...(allied.value === undefined ? {} : { allied: allied.value }),
        memoryEventId: memoryEventId.value,
      });
    }
    case "goal-set": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const text = parseGoalText(input.text, "text");
      if (!text.ok) return text;
      const target = parseEntityId(input.target, "target");
      if (!target.ok) return target;
      return ok({
        ...envelope,
        kind: "goal-set",
        entityId: entityId.value,
        text: text.value,
        target: target.value,
      });
    }
    case "journey-started": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const to = parseEntityId(input.to, "to");
      if (!to.ok) return to;
      return ok({
        ...envelope,
        kind: "journey-started",
        entityId: entityId.value,
        to: to.value,
      });
    }
    case "journey-ended": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const journeyEventId = parseEventId(
        input.journeyEventId,
        "journeyEventId",
      );
      if (!journeyEventId.ok) return journeyEventId;
      const ending = parseEnum(input.ending, "ending", JOURNEY_ENDINGS);
      if (!ending.ok) return ending;
      const shared = {
        ...envelope,
        kind: "journey-ended" as const,
        entityId: entityId.value,
        journeyEventId: journeyEventId.value,
      };
      // A refusal says why, and no other ending carries a reason.
      if (ending.value === "refused") {
        const reason = parseEnum(
          input.reason,
          "reason",
          REJECTION_REASON_CODES,
        );
        if (!reason.ok) return reason;
        return ok({ ...shared, ending: ending.value, reason: reason.value });
      }
      if (input.reason !== undefined) {
        return fail("reason", "only a refused journey carries a reason");
      }
      return ok({ ...shared, ending: ending.value });
    }
    case "unmet-need": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const resource = parseString(input.resource, "resource");
      if (!resource.ok) return resource;
      const reason = parseEnum(input.reason, "reason", UNMET_NEED_REASONS);
      if (!reason.ok) return reason;
      return ok({
        ...envelope,
        kind: "unmet-need",
        entityId: entityId.value,
        resource: resource.value,
        reason: reason.value,
      });
    }
    case "loss-noticed": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const causeEventId = parseEventId(input.causeEventId, "causeEventId");
      if (!causeEventId.ok) return causeEventId;
      const building =
        input.building === undefined
          ? ok<EntityId | undefined>(undefined)
          : parseEntityId(input.building, "building");
      if (!building.ok) return building;
      const resource = parseOptionalString(input.resource, "resource");
      if (!resource.ok) return resource;
      const amount =
        input.amount === undefined
          ? ok<number | undefined>(undefined)
          : parsePositiveInteger(input.amount, "amount");
      if (!amount.ok) return amount;
      // A building, or a resource and its amount: exactly one of the two.
      const lostStock =
        resource.value !== undefined || amount.value !== undefined;
      if (building.value !== undefined && lostStock) {
        return fail("building", "a loss is a building or stock, not both");
      }
      if (building.value === undefined && !lostStock) {
        return fail("building", "a loss names a building or a resource");
      }
      if (
        lostStock &&
        (resource.value === undefined || amount.value === undefined)
      ) {
        return fail("resource", "lost stock names a resource and an amount");
      }
      return ok({
        ...envelope,
        kind: "loss-noticed",
        entityId: entityId.value,
        causeEventId: causeEventId.value,
        ...(building.value === undefined ? {} : { building: building.value }),
        ...(resource.value === undefined ? {} : { resource: resource.value }),
        ...(amount.value === undefined ? {} : { amount: amount.value }),
      });
    }
    case "need-met": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const resource = parseString(input.resource, "resource");
      if (!resource.ok) return resource;
      const needEventId = parseEventId(input.needEventId, "needEventId");
      if (!needEventId.ok) return needEventId;
      return ok({
        ...envelope,
        kind: "need-met",
        entityId: entityId.value,
        resource: resource.value,
        needEventId: needEventId.value,
      });
    }
    case "theft": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const victim = parseEntityId(input.victim, "victim");
      if (!victim.ok) return victim;
      const resource = parseString(input.resource, "resource");
      if (!resource.ok) return resource;
      const amount = parsePositiveInteger(input.amount, "amount");
      if (!amount.ok) return amount;
      if (input.cause !== "director") {
        return fail("cause", 'expected "director"');
      }
      return ok({
        ...envelope,
        kind: "theft",
        entityId: entityId.value,
        victim: victim.value,
        resource: resource.value,
        amount: amount.value,
        cause: "director",
      });
    }
    case "stock-spoiled": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const resource = parseString(input.resource, "resource");
      if (!resource.ok) return resource;
      const amount = parsePositiveInteger(input.amount, "amount");
      if (!amount.ok) return amount;
      if (input.cause !== "director") {
        return fail("cause", 'expected "director"');
      }
      return ok({
        ...envelope,
        kind: "stock-spoiled",
        entityId: entityId.value,
        resource: resource.value,
        amount: amount.value,
        cause: "director",
      });
    }
    case "blessing-granted": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const recipient = parseEntityId(input.recipient, "recipient");
      if (!recipient.ok) return recipient;
      const petitionId = parseEventId(input.petitionId, "petitionId");
      if (!petitionId.ok) return petitionId;
      const resource = parseString(input.resource, "resource");
      if (!resource.ok) return resource;
      const amount = parsePositiveInteger(input.amount, "amount");
      if (!amount.ok) return amount;
      const building =
        input.building === undefined
          ? ok<EntityId | undefined>(undefined)
          : parseEntityId(input.building, "building");
      if (!building.ok) return building;
      return ok({
        ...envelope,
        kind: "blessing-granted",
        entityId: entityId.value,
        recipient: recipient.value,
        petitionId: petitionId.value,
        resource: resource.value,
        amount: amount.value,
        ...(building.value === undefined ? {} : { building: building.value }),
      });
    }
    case "petition-opened": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const god = parseEntityId(input.god, "god");
      if (!god.ok) return god;
      const cause = parseEventId(input.cause, "cause");
      if (!cause.ok) return cause;
      const request = parsePetitionRequest(input.request, "request");
      if (!request.ok) return request;
      return ok({
        ...envelope,
        kind: "petition-opened",
        entityId: entityId.value,
        god: god.value,
        cause: cause.value,
        request: request.value,
      });
    }
    case "petition-answered": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const god = parseEntityId(input.god, "god");
      if (!god.ok) return god;
      const petitionId = parseEventId(input.petitionId, "petitionId");
      if (!petitionId.ok) return petitionId;
      const answeredBy = parseEventId(input.answeredBy, "answeredBy");
      if (!answeredBy.ok) return answeredBy;
      return ok({
        ...envelope,
        kind: "petition-answered",
        entityId: entityId.value,
        god: god.value,
        petitionId: petitionId.value,
        answeredBy: answeredBy.value,
      });
    }
    case "petition-lapsed": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const god = parseEntityId(input.god, "god");
      if (!god.ok) return god;
      const petitionId = parseEventId(input.petitionId, "petitionId");
      if (!petitionId.ok) return petitionId;
      return ok({
        ...envelope,
        kind: "petition-lapsed",
        entityId: entityId.value,
        god: god.value,
        petitionId: petitionId.value,
      });
    }
    case "patron-changed": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const from = parseEntityId(input.from, "from");
      if (!from.ok) return from;
      const to = parseEntityId(input.to, "to");
      if (!to.ok) return to;
      if (from.value === to.value) {
        return fail("to", "a mortal changes to another god");
      }
      const answered = parseEventId(input.answered, "answered");
      if (!answered.ok) return answered;
      const unanswered = parseArray(
        input.unanswered,
        "unanswered",
        parseEventId,
      );
      if (!unanswered.ok) return unanswered;
      return ok({
        ...envelope,
        kind: "patron-changed",
        entityId: entityId.value,
        from: from.value,
        to: to.value,
        answered: answered.value,
        unanswered: unanswered.value,
      });
    }
    case "petition-refused": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const petitioner = parseEntityId(input.petitioner, "petitioner");
      if (!petitioner.ok) return petitioner;
      const petitionId = parseEventId(input.petitionId, "petitionId");
      if (!petitionId.ok) return petitionId;
      return ok({
        ...envelope,
        kind: "petition-refused",
        entityId: entityId.value,
        petitioner: petitioner.value,
        petitionId: petitionId.value,
      });
    }
    case "goal-change-refused": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const reason = parseEnum(input.reason, "reason", GOAL_REFUSAL_REASONS);
      if (!reason.ok) return reason;
      const attempted = parseEnum(input.attempted, "attempted", [
        "replace",
        "abandon",
      ] as const);
      if (!attempted.ok) return attempted;
      const unlocksInTicks = parseNonNegativeInteger(
        input.unlocksInTicks,
        "unlocksInTicks",
      );
      if (!unlocksInTicks.ok) return unlocksInTicks;
      return ok({
        ...envelope,
        kind: "goal-change-refused",
        entityId: entityId.value,
        reason: reason.value,
        attempted: attempted.value,
        unlocksInTicks: unlocksInTicks.value,
      });
    }
    case "practice-opened": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const practice = parseEnum(input.practice, "practice", PRACTICE_KINDS);
      if (!practice.ok) return practice;
      const counterparty = parseEntityId(input.counterparty, "counterparty");
      if (!counterparty.ok) return counterparty;
      const causes = parseArray(input.causes, "causes", parseEventId);
      if (!causes.ok) return causes;
      if (causes.value.length === 0) {
        return fail("causes", "a practice rests on at least one cause");
      }
      const term = parsePracticeTerm(input.term, "term");
      if (!term.ok) return term;
      const negotiationDeadline = parseNonNegativeInteger(
        input.negotiationDeadline,
        "negotiationDeadline",
      );
      if (!negotiationDeadline.ok) return negotiationDeadline;
      const counterBudget = parseNonNegativeInteger(
        input.counterBudget,
        "counterBudget",
      );
      if (!counterBudget.ok) return counterBudget;
      const succeeds = parseOptionalEventId(input.succeeds, "succeeds");
      if (!succeeds.ok) return succeeds;
      const stake =
        input.stake === undefined
          ? ok<Transformation | undefined>(undefined)
          : parseTransformation(input.stake, "stake");
      if (!stake.ok) return stake;
      const subject = parseThreadSubject(input.subject, "subject");
      if (!subject.ok) return subject;
      const petition = parseOptionalEventId(input.petition, "petition");
      if (!petition.ok) return petition;
      if (
        (practice.value === "supplication") !==
        (petition.value !== undefined)
      ) {
        return fail(
          "petition",
          "a supplication names the prayer it answers, and a settlement names none",
        );
      }
      return ok({
        ...envelope,
        kind: "practice-opened",
        entityId: entityId.value,
        practice: practice.value,
        counterparty: counterparty.value,
        causes: causes.value,
        term: term.value,
        negotiationDeadline: negotiationDeadline.value,
        counterBudget: counterBudget.value,
        ...(succeeds.value === undefined ? {} : { succeeds: succeeds.value }),
        ...(subject.value === undefined ? {} : { subject: subject.value }),
        ...(petition.value === undefined ? {} : { petition: petition.value }),
        ...(stake.value === undefined ? {} : { stake: stake.value }),
      });
    }
    case "practice-progressed": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const counterparty = parseEntityId(input.counterparty, "counterparty");
      if (!counterparty.ok) return counterparty;
      const threadId = parseEventId(input.threadId, "threadId");
      if (!threadId.ok) return threadId;
      const step = parseEnum(input.step, "step", SUPPLICATION_STEPS);
      if (!step.ok) return step;
      const by = parseEventId(input.by, "by");
      if (!by.ok) return by;
      return ok({
        ...envelope,
        kind: "practice-progressed",
        entityId: entityId.value,
        counterparty: counterparty.value,
        threadId: threadId.value,
        step: step.value,
        by: by.value,
      });
    }
    case "practice-refused": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const attempted = parseEnum(
        input.attempted,
        "attempted",
        PRACTICE_ATTEMPTS,
      );
      if (!attempted.ok) return attempted;
      const reason = parseEnum(input.reason, "reason", REJECTION_REASON_CODES);
      if (!reason.ok) return reason;
      const thread = parseOptionalEventId(input.thread, "thread");
      if (!thread.ok) return thread;
      const why = parseOptionalString(input.why, "why");
      if (!why.ok) return why;
      if (why.value !== undefined && why.value.length > MAX_REFUSAL_WHY) {
        return fail("why", `expected at most ${MAX_REFUSAL_WHY} characters`);
      }
      return ok({
        ...envelope,
        kind: "practice-refused",
        entityId: entityId.value,
        attempted: attempted.value,
        reason: reason.value,
        ...(thread.value === undefined ? {} : { thread: thread.value }),
        ...(why.value === undefined ? {} : { why: why.value }),
      });
    }
    case "contest-opened": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const rival = parseEntityId(input.rival, "rival");
      if (!rival.ok) return rival;
      if (rival.value === entityId.value) {
        return fail("rival", "a god cannot contest itself");
      }
      const place = parseEntityId(input.place, "place");
      if (!place.ok) return place;
      const cause = parseEventId(input.cause, "cause");
      if (!cause.ok) return cause;
      const closesAt = parseNonNegativeInteger(input.closesAt, "closesAt");
      if (!closesAt.ok) return closesAt;
      const succeeds = parseOptionalEventId(input.succeeds, "succeeds");
      if (!succeeds.ok) return succeeds;
      return ok({
        ...envelope,
        kind: "contest-opened",
        entityId: entityId.value,
        rival: rival.value,
        place: place.value,
        cause: cause.value,
        closesAt: closesAt.value,
        ...(succeeds.value === undefined ? {} : { succeeds: succeeds.value }),
      });
    }
    case "contest-closed": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const rival = parseEntityId(input.rival, "rival");
      if (!rival.ok) return rival;
      if (rival.value === entityId.value) {
        return fail("rival", "a god cannot contest itself");
      }
      const place = parseEntityId(input.place, "place");
      if (!place.ok) return place;
      const contestId = parseEventId(input.contestId, "contestId");
      if (!contestId.ok) return contestId;
      const result = parseEnum(input.result, "result", CONTEST_RESULTS);
      if (!result.ok) return result;
      const reason = parseEnum(input.reason, "reason", CONTEST_END_REASONS);
      if (!reason.ok) return reason;
      const base = {
        ...envelope,
        kind: "contest-closed" as const,
        entityId: entityId.value,
        rival: rival.value,
        place: place.value,
        contestId: contestId.value,
      };
      const gods = [entityId.value, rival.value];
      if (result.value === "expired") {
        if (reason.value === "window") {
          return fail(
            "reason",
            "an expired contest's window did not decide it",
          );
        }
        if (input.winner !== undefined) {
          return fail("winner", "an expired contest has no winner");
        }
        if (
          input.favoured !== undefined &&
          !(Array.isArray(input.favoured) && input.favoured.length === 0)
        ) {
          return fail("favoured", "an expired contest records no favour");
        }
        return ok({
          ...base,
          result: "expired",
          reason: reason.value,
        });
      }
      if (reason.value !== "window") {
        return fail("reason", "a decided contest was decided by its window");
      }
      const winner = parseEntityId(input.winner, "winner");
      if (!winner.ok) return winner;
      if (!gods.includes(winner.value)) {
        return fail("winner", "the winner is one of the two gods");
      }
      const favoured = parseArray(input.favoured, "favoured", (value, at) => {
        if (!isRecord(value)) return fail(at, "expected a favour object");
        const mortal = parseEntityId(value.mortal, `${at}.mortal`);
        if (!mortal.ok) return mortal;
        const god = parseEntityId(value.god, `${at}.god`);
        if (!god.ok) return god;
        if (!gods.includes(god.value)) {
          return fail(`${at}.god`, "a mortal favours one of the two gods");
        }
        return ok({ mortal: mortal.value, god: god.value });
      });
      if (!favoured.ok) return favoured;
      return ok({
        ...base,
        result: "decided",
        reason: "window",
        winner: winner.value,
        favoured: favoured.value,
      });
    }
    case "practice-moved": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const threadId = parseEventId(input.threadId, "threadId");
      if (!threadId.ok) return threadId;
      const base = {
        ...envelope,
        kind: "practice-moved" as const,
        entityId: entityId.value,
        threadId: threadId.value,
      };
      switch (input.move) {
        case "counter": {
          const term = parsePracticeTerm(input.term, "term");
          if (!term.ok) return term;
          return ok({ ...base, move: "counter", term: term.value });
        }
        case "accept": {
          const sworn = parseBoolean(input.sworn, "sworn");
          if (!sworn.ok) return sworn;
          return ok({ ...base, move: "accept", sworn: sworn.value });
        }
        case "refuse":
        case "withdraw":
          return ok({ ...base, move: input.move });
        default:
          return fail(
            "move",
            "expected one of: counter, accept, refuse, withdraw",
          );
      }
    }
    case "practice-ended": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const counterparty = parseEntityId(input.counterparty, "counterparty");
      if (!counterparty.ok) return counterparty;
      const threadId = parseEventId(input.threadId, "threadId");
      if (!threadId.ok) return threadId;
      const outcome = parseEnum(input.outcome, "outcome", PRACTICE_OUTCOMES);
      if (!outcome.ok) return outcome;
      const reason = parseEnum(input.reason, "reason", PRACTICE_END_REASONS);
      if (!reason.ok) return reason;
      const performedBy = parseOptionalEventId(
        input.performedBy,
        "performedBy",
      );
      if (!performedBy.ok) return performedBy;
      return ok({
        ...envelope,
        kind: "practice-ended",
        entityId: entityId.value,
        counterparty: counterparty.value,
        threadId: threadId.value,
        outcome: outcome.value,
        reason: reason.value,
        ...(performedBy.value === undefined
          ? {}
          : { performedBy: performedBy.value }),
      });
    }
    case "motif-applied": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const motif = parseEnum(input.motif, "motif", PRACTICE_MOTIFS);
      if (!motif.ok) return motif;
      const threadId = parseEventId(input.threadId, "threadId");
      if (!threadId.ok) return threadId;
      const cause = parseEventId(input.cause, "cause");
      if (!cause.ok) return cause;
      const base = {
        ...envelope,
        kind: "motif-applied" as const,
        entityId: entityId.value,
        motif: motif.value,
        threadId: threadId.value,
        cause: cause.value,
      };
      // The effect must be the change its motif names, so a record cannot say a
      // motif did something other than what the catalogue says it does.
      const change = PRACTICE_MOTIF_CHANGES[motif.value];
      switch (input.effect) {
        case "oath-penalty": {
          if (change !== "oath-penalty") {
            return fail(
              "effect",
              `${motif.value} does not apply an oath penalty`,
            );
          }
          const divinityLost = parseNonNegativeInteger(
            input.divinityLost,
            "divinityLost",
          );
          if (!divinityLost.ok) return divinityLost;
          const capability = parseString(input.capability, "capability");
          if (!capability.ok) return capability;
          const accessRestoredAt = parseNonNegativeInteger(
            input.accessRestoredAt,
            "accessRestoredAt",
          );
          if (!accessRestoredAt.ok) return accessRestoredAt;
          return ok({
            ...base,
            effect: "oath-penalty",
            divinityLost: divinityLost.value,
            capability: capability.value,
            accessRestoredAt: accessRestoredAt.value,
          });
        }
        case "transformation": {
          if (change !== "transformation") {
            return fail("effect", `${motif.value} does not transform anyone`);
          }
          const intent = parseEnum(input.intent, "intent", [
            "punishment",
            "mercy",
          ] as const);
          if (!intent.ok) return intent;
          if (motif.value !== `transformation-${intent.value}`) {
            return fail("intent", `${motif.value} is not a ${intent.value}`);
          }
          const form = parseTransformation(input, "effect");
          if (!form.ok) return form;
          return ok({
            ...base,
            effect: "transformation",
            intent: intent.value,
            ...form.value,
          });
        }
        case "standing": {
          if (change !== "standing-record") {
            return fail("effect", `${motif.value} does not record standing`);
          }
          const place = parseEntityId(input.place, "place");
          if (!place.ok) return place;
          const delta = parseInteger(input.delta, "delta");
          if (!delta.ok) return delta;
          // Won standing is a gain and lost standing a loss, never the other way round.
          if (
            delta.value === 0 ||
            delta.value > 0 !== (motif.value === "standing-won")
          ) {
            return fail("delta", `${motif.value} moves standing the other way`);
          }
          return ok({
            ...base,
            effect: "standing",
            place: place.value,
            delta: delta.value,
          });
        }
        default:
          return fail(
            "effect",
            "expected one of: oath-penalty, transformation, standing",
          );
      }
    }
    case "access-restored": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const capability = parseString(input.capability, "capability");
      if (!capability.ok) return capability;
      const motifEventId = parseEventId(input.motifEventId, "motifEventId");
      if (!motifEventId.ok) return motifEventId;
      return ok({
        ...envelope,
        kind: "access-restored",
        entityId: entityId.value,
        capability: capability.value,
        motifEventId: motifEventId.value,
      });
    }
    case "goal-ended": {
      const entityId = parseEntityId(input.entityId, "entityId");
      if (!entityId.ok) return entityId;
      const outcome = parseEnum(input.outcome, "outcome", GOAL_OUTCOMES);
      if (!outcome.ok) return outcome;
      const goalEventId = parseEventId(input.goalEventId, "goalEventId");
      if (!goalEventId.ok) return goalEventId;
      return ok({
        ...envelope,
        kind: "goal-ended",
        entityId: entityId.value,
        outcome: outcome.value,
        goalEventId: goalEventId.value,
      });
    }
    default:
      return fail(
        "kind",
        `unknown event kind: ${String(input.kind)}`,
        "unknown-kind",
      );
  }
}
