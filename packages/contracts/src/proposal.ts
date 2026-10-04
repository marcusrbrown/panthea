// Proposals are the only way routines, fixtures, and the operator can
// attempt to change committed world state. Every proposal is revalidated
// against expected entity revisions at execution time (packages/world);
// this module only owns the wire shape and its parse-don't-validate
// parser. A proposal never mutates state by existing -- only a validator's
// commit does that. Rules derive required capabilities and costs from
// world and content state, never from a proposal-declared field: a
// proposal that declares `preconditions`, `requiredCapabilities`, `costs`,
// or `modelRequestId` is rejected outright, since nothing evaluates those
// fields against any authority.
//
// Observation records live here too: every proposal cites the observation
// it was made from, so the two shapes are tightly coupled.

import {
  type Consequence,
  GOAL_OUTCOMES,
  type GoalOutcome,
  parseConsequence,
  parseGoalText,
  parseReportContent,
} from "./event";
import {
  type Brand,
  type EntityId,
  type EntityRevision,
  type EventId,
  fail,
  idParser,
  isRecord,
  ok,
  type ParseResult,
  parseArray,
  parseEntityId,
  parseEntityRevision,
  parseEnum,
  parseEventId,
  parseNonNegativeInteger,
  parseNonNegativeNumber,
  parseOptionalBoolean,
  parseResourceAmount,
  parseSchemaVersion,
  parseString,
  type ResourceAmount,
  timeOrderedIdFactory,
} from "./ids";
import {
  PRACTICE_MOVES,
  type PracticeTermOffer,
  parsePracticeTermOffer,
} from "./practice";

// --- Observation records -----------------------------------------------------

export type ObservationId = Brand<string, "ObservationId">;
export const parseObservationId = idParser<"ObservationId">();
export const createObservationId = timeOrderedIdFactory<"ObservationId">("obs");

export const OBSERVATION_SCHEMA_VERSIONS = [1] as const;

export interface ObservationRecord {
  readonly schemaVersion: number;
  readonly id: ObservationId;
  readonly observer: EntityId;
  readonly stateRevision: number;
  readonly factsRead: readonly string[];
  readonly source: ProposalSource;
}

export function parseObservationRecord(
  input: unknown,
): ParseResult<ObservationRecord> {
  if (!isRecord(input)) {
    return fail("", "expected an observation record object");
  }
  const schemaVersion = parseSchemaVersion(
    input.schemaVersion,
    OBSERVATION_SCHEMA_VERSIONS,
  );
  if (!schemaVersion.ok) return schemaVersion;
  const id = parseObservationId(input.id, "id");
  if (!id.ok) return id;
  const observer = parseEntityId(input.observer, "observer");
  if (!observer.ok) return observer;
  const stateRevision = parseNonNegativeInteger(
    input.stateRevision,
    "stateRevision",
  );
  if (!stateRevision.ok) return stateRevision;
  const factsRead = parseArray(input.factsRead, "factsRead", parseString);
  if (!factsRead.ok) return factsRead;
  const source = parseProposalSource(input.source, "source");
  if (!source.ok) return source;
  return ok({
    schemaVersion: schemaVersion.value,
    id: id.value,
    observer: observer.value,
    stateRevision: stateRevision.value,
    factsRead: factsRead.value,
    source: source.value,
  });
}

// --- Proposal source -----------------------------------------------------

export const PROPOSAL_SOURCES = [
  "routine",
  "fixture",
  "operator",
  "model",
  "director",
] as const;
export type ProposalSource = (typeof PROPOSAL_SOURCES)[number];

function parseProposalSource(
  value: unknown,
  path: string,
): ParseResult<ProposalSource> {
  if (
    typeof value !== "string" ||
    !(PROPOSAL_SOURCES as readonly string[]).includes(value)
  ) {
    return fail(path, `unknown proposal source: ${String(value)}`);
  }
  return ok(value as ProposalSource);
}

// --- Proposal envelope and kinds ----------------------------------------------

export const PROPOSAL_SCHEMA_VERSIONS = [1] as const;

/** Fields the current contract does not define; a proposal declaring any of these is rejected outright. */
const REMOVED_AUTHORITY_FIELDS = [
  "preconditions",
  "requiredCapabilities",
  "costs",
  "modelRequestId",
] as const;

/**
 * A god's change to its own goal, riding on a proposal. It may end the active
 * goal (the god's declared outcome), set a new one (its own words and one
 * target), or both; the end applies first. The world records it and never
 * judges it: it commits whatever becomes of the proposal's action.
 */
export interface GoalChange {
  readonly end?: { readonly outcome: GoalOutcome };
  readonly set?: { readonly text: string; readonly target: EntityId };
}

export interface ProposalBase {
  readonly schemaVersion: number;
  readonly actor: EntityId;
  readonly targets: readonly EntityId[];
  readonly expectedRevisions: readonly EntityRevision[];
  readonly source: ProposalSource;
  readonly observationId: ObservationId;
  /** A change to the actor's goal, committed with the proposal whatever its action's outcome. */
  readonly goal?: GoalChange;
}

export interface MoveProposal extends ProposalBase {
  readonly kind: "move";
  readonly to: EntityId;
}

export interface RealmTransitionProposal extends ProposalBase {
  readonly kind: "realm-transition";
  readonly to: EntityId;
  readonly via: EntityId;
}

/**
 * A god declares where it is going. The world stores the journey and walks it
 * one hop a tick: each hop is a validated move or realm-transition, so a god
 * never names a route. Gods travel; mortal routines still move.
 */
export interface TravelProposal extends ProposalBase {
  readonly kind: "travel";
  readonly to: EntityId;
}

export interface GatherProposal extends ProposalBase {
  readonly kind: "gather";
  readonly resource: string;
  readonly amount: number;
}

export interface ProduceProposal extends ProposalBase {
  readonly kind: "produce";
  readonly output: string;
  readonly quantity: number;
}

export interface TradeProposal extends ProposalBase {
  readonly kind: "trade";
  readonly counterparty: EntityId;
  readonly give: readonly ResourceAmount[];
  readonly receive: readonly ResourceAmount[];
}

export interface ConsumeProposal extends ProposalBase {
  readonly kind: "consume";
  readonly resource: string;
  readonly amount: number;
}

export interface StrikeProposal extends ProposalBase {
  readonly kind: "strike";
  readonly target: EntityId;
  readonly power: number;
}

export interface RepairProposal extends ProposalBase {
  readonly kind: "repair";
  readonly structure: EntityId;
}

export interface WorshipProposal extends ProposalBase {
  readonly kind: "worship";
  readonly deity: EntityId;
  readonly offering?: ResourceAmount;
}

/** A legend/claim ("I own the tavern") never grants state by itself: it may not assert expected entity revisions either. */
export interface ClaimProposal extends ProposalBase {
  readonly kind: "claim";
  readonly assertion: string;
}

/**
 * A narrative record, distinct from a claim: it commits regardless of
 * whether the assertion is true, since it records that someone told the
 * story -- never that the story is fact. `linkedEventId` cites an event
 * that exists in the log as the narrator's evidence; the world does not
 * judge whether it supports the story, so it makes the legend event-linked,
 * never certified. A second, disputed telling of the same event is simply
 * another legend, never a replacement for the first.
 */
export interface LegendProposal extends ProposalBase {
  readonly kind: "legend";
  readonly assertion: string;
  readonly linkedEventId?: EventId;
  /** What the narrator asserts happened, in structure: checked for shape and that its ids exist, never for truth. It gives each hearer a consequence. */
  readonly claim?: Consequence;
}

/**
 * A mortal's routine prays at the altar about one cause event. Only a routine
 * makes it: mortals have no model, and their petitions are built from state.
 */
export interface PrayProposal extends ProposalBase {
  readonly kind: "pray";
  readonly cause: EventId;
}

/**
 * A god blesses the petitioner of one open petition, who must be where the god
 * stands, at a cost in divinity. It grants only what that petition needs.
 */
export interface BlessProposal extends ProposalBase {
  readonly kind: "bless";
  readonly petition: EventId;
}

/**
 * One move in a practice thread between gods. A demand opens a settlement: it
 * names the god it is made of, a cause event the demander knows, and one term.
 * Every other move names its thread, and the move pins that thread's revision
 * and nothing else. Only a move binds; words explain it and never perform it.
 */
export type PracticeProposal = ProposalBase & { readonly kind: "practice" } & (
    | {
        /** A god answers a prayer with terms: its boon for one offering by the mortal. `stake` names, by its id in the world's rules, what the mortal becomes if it takes the boon and breaks the term. */
        readonly move: "offer";
        readonly petition: EventId;
        readonly term: PracticeTermOffer;
        readonly stake?: string;
      }
    | {
        readonly move: "demand";
        readonly counterparty: EntityId;
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
        /** Swear the acceptance by the Styx. */
        readonly swear?: boolean;
      }
    | { readonly move: "refuse" | "withdraw"; readonly thread: EventId }
    | {
        /** A god opens a contest for a place's people over a rival's bless, strike, or legend it perceived: `cause` is that act. The world finds the rival, the place, and the window. */
        readonly move: "contest";
        readonly cause: EventId;
      }
  );

/** A turn that does nothing but change the god's goal: what a wait with a goal change becomes. */
export interface GoalProposal extends ProposalBase {
  readonly kind: "goal";
  readonly goal: GoalChange;
}

/**
 * One actor tells another, at the same place, something it says happened.
 * The content is the teller's own account and may be wrong or invented: the
 * world records that it was told, never that it is true. `linkedEventId`
 * cites an event the teller witnessed; the rules refuse a citation the teller
 * has no first-hand memory of.
 */
export interface ReportProposal extends ProposalBase {
  readonly kind: "report";
  readonly listener: EntityId;
  readonly content: string;
  /** What the teller asserts happened, in structure. It may be false: the rules check its shape and that the ids exist, never its truth. It, and only it, gives the listener a consequence. */
  readonly claim?: Consequence;
  /** Provenance only: an event the teller witnessed. Teaches the listener nothing by itself. */
  readonly linkedEventId?: EventId;
}

export type Proposal =
  | MoveProposal
  | RealmTransitionProposal
  | TravelProposal
  | GatherProposal
  | ProduceProposal
  | TradeProposal
  | ConsumeProposal
  | StrikeProposal
  | RepairProposal
  | WorshipProposal
  | ClaimProposal
  | LegendProposal
  | ReportProposal
  | GoalProposal
  | PrayProposal
  | BlessProposal
  | PracticeProposal;

export type ProposalKind = Proposal["kind"];

// `satisfies Record<ProposalKind, true>` makes a new proposal kind fail to
// compile here until it is listed, so content that names a world action
// (god abilities) tracks the proposal contract.
const PROPOSAL_KIND_SET = {
  move: true,
  "realm-transition": true,
  travel: true,
  gather: true,
  produce: true,
  trade: true,
  consume: true,
  strike: true,
  repair: true,
  worship: true,
  claim: true,
  legend: true,
  report: true,
  goal: true,
  pray: true,
  bless: true,
  practice: true,
} as const satisfies Record<ProposalKind, true>;

export const PROPOSAL_KINDS = Object.keys(
  PROPOSAL_KIND_SET,
) as readonly ProposalKind[];

function parseGoalChange(
  value: unknown,
  path: string,
): ParseResult<GoalChange> {
  if (!isRecord(value)) return fail(path, "expected a goal change object");
  let end: GoalChange["end"];
  if (value.end !== undefined) {
    if (!isRecord(value.end)) return fail(`${path}.end`, "expected an object");
    const outcome = parseEnum(
      value.end.outcome,
      `${path}.end.outcome`,
      GOAL_OUTCOMES,
    );
    if (!outcome.ok) return outcome;
    end = { outcome: outcome.value };
  }
  let set: GoalChange["set"];
  if (value.set !== undefined) {
    if (!isRecord(value.set)) return fail(`${path}.set`, "expected an object");
    const text = parseGoalText(value.set.text, `${path}.set.text`);
    if (!text.ok) return text;
    const target = parseEntityId(value.set.target, `${path}.set.target`);
    if (!target.ok) return target;
    set = { text: text.value, target: target.value };
  }
  if (end === undefined && set === undefined) {
    return fail(path, "a goal change needs an end, a set, or both");
  }
  return ok({
    ...(end === undefined ? {} : { end }),
    ...(set === undefined ? {} : { set }),
  });
}

export function parseProposal(input: unknown): ParseResult<Proposal> {
  if (!isRecord(input)) {
    return fail("", "expected a proposal object");
  }

  for (const field of REMOVED_AUTHORITY_FIELDS) {
    if (input[field] !== undefined) {
      return fail(
        field,
        `${field} is not a supported proposal field; rules derive it from world and content state`,
        "unauthorized-claim",
      );
    }
  }

  const schemaVersion = parseSchemaVersion(
    input.schemaVersion,
    PROPOSAL_SCHEMA_VERSIONS,
  );
  if (!schemaVersion.ok) return schemaVersion;

  const actor = parseEntityId(input.actor, "actor");
  if (!actor.ok) return actor;

  const targets = parseArray(input.targets, "targets", parseEntityId);
  if (!targets.ok) return targets;

  const expectedRevisions = parseArray(
    input.expectedRevisions,
    "expectedRevisions",
    parseEntityRevision,
  );
  if (!expectedRevisions.ok) return expectedRevisions;

  const source = parseProposalSource(input.source, "source");
  if (!source.ok) return source;

  const observationId = parseObservationId(
    input.observationId,
    "observationId",
  );
  if (!observationId.ok) return observationId;

  const goal =
    input.goal === undefined
      ? ok<GoalChange | undefined>(undefined)
      : parseGoalChange(input.goal, "goal");
  if (!goal.ok) return goal;

  const base: ProposalBase = {
    schemaVersion: schemaVersion.value,
    actor: actor.value,
    targets: targets.value,
    expectedRevisions: expectedRevisions.value,
    source: source.value,
    observationId: observationId.value,
    ...(goal.value === undefined ? {} : { goal: goal.value }),
  };

  switch (input.kind) {
    case "move": {
      const to = parseEntityId(input.to, "to");
      if (!to.ok) return to;
      return ok({ ...base, kind: "move", to: to.value });
    }
    case "realm-transition": {
      const to = parseEntityId(input.to, "to");
      if (!to.ok) return to;
      const via = parseEntityId(input.via, "via");
      if (!via.ok) return via;
      return ok({
        ...base,
        kind: "realm-transition",
        to: to.value,
        via: via.value,
      });
    }
    case "travel": {
      const to = parseEntityId(input.to, "to");
      if (!to.ok) return to;
      return ok({ ...base, kind: "travel", to: to.value });
    }
    case "gather": {
      const resource = parseString(input.resource, "resource");
      if (!resource.ok) return resource;
      const amount = parseNonNegativeNumber(input.amount, "amount");
      if (!amount.ok) return amount;
      return ok({
        ...base,
        kind: "gather",
        resource: resource.value,
        amount: amount.value,
      });
    }
    case "produce": {
      const output = parseString(input.output, "output");
      if (!output.ok) return output;
      const quantity = parseNonNegativeNumber(input.quantity, "quantity");
      if (!quantity.ok) return quantity;
      return ok({
        ...base,
        kind: "produce",
        output: output.value,
        quantity: quantity.value,
      });
    }
    case "trade": {
      const counterparty = parseEntityId(input.counterparty, "counterparty");
      if (!counterparty.ok) return counterparty;
      const give = parseArray(input.give, "give", parseResourceAmount);
      if (!give.ok) return give;
      const receive = parseArray(input.receive, "receive", parseResourceAmount);
      if (!receive.ok) return receive;
      return ok({
        ...base,
        kind: "trade",
        counterparty: counterparty.value,
        give: give.value,
        receive: receive.value,
      });
    }
    case "consume": {
      const resource = parseString(input.resource, "resource");
      if (!resource.ok) return resource;
      const amount = parseNonNegativeNumber(input.amount, "amount");
      if (!amount.ok) return amount;
      return ok({
        ...base,
        kind: "consume",
        resource: resource.value,
        amount: amount.value,
      });
    }
    case "strike": {
      const target = parseEntityId(input.target, "target");
      if (!target.ok) return target;
      const power = parseNonNegativeNumber(input.power, "power");
      if (!power.ok) return power;
      return ok({
        ...base,
        kind: "strike",
        target: target.value,
        power: power.value,
      });
    }
    case "repair": {
      const structure = parseEntityId(input.structure, "structure");
      if (!structure.ok) return structure;
      return ok({ ...base, kind: "repair", structure: structure.value });
    }
    case "worship": {
      const deity = parseEntityId(input.deity, "deity");
      if (!deity.ok) return deity;
      const offering =
        input.offering === undefined
          ? ok<ResourceAmount | undefined>(undefined)
          : parseResourceAmount(input.offering, "offering");
      if (!offering.ok) return offering;
      return ok({
        ...base,
        kind: "worship",
        deity: deity.value,
        ...(offering.value === undefined ? {} : { offering: offering.value }),
      });
    }
    case "claim": {
      if (base.expectedRevisions.length > 0) {
        return fail(
          "expectedRevisions",
          "a claim may not assert expected entity revisions",
          "unauthorized-claim",
        );
      }
      const assertion = parseString(input.assertion, "assertion");
      if (!assertion.ok) return assertion;
      return ok({ ...base, kind: "claim", assertion: assertion.value });
    }
    case "legend": {
      const assertion = parseReportContent(input.assertion, "assertion");
      if (!assertion.ok) return assertion;
      const linkedEventId =
        input.linkedEventId === undefined
          ? ok<EventId | undefined>(undefined)
          : parseEventId(input.linkedEventId, "linkedEventId");
      if (!linkedEventId.ok) return linkedEventId;
      const claim = parseConsequence(input.claim, "claim");
      if (!claim.ok) return claim;
      return ok({
        ...base,
        kind: "legend",
        assertion: assertion.value,
        ...(linkedEventId.value === undefined
          ? {}
          : { linkedEventId: linkedEventId.value }),
        ...(claim.value === undefined ? {} : { claim: claim.value }),
      });
    }
    case "report": {
      const listener = parseEntityId(input.listener, "listener");
      if (!listener.ok) return listener;
      const content = parseReportContent(input.content, "content");
      if (!content.ok) return content;
      const claim = parseConsequence(input.claim, "claim");
      if (!claim.ok) return claim;
      const linkedEventId =
        input.linkedEventId === undefined
          ? ok<EventId | undefined>(undefined)
          : parseEventId(input.linkedEventId, "linkedEventId");
      if (!linkedEventId.ok) return linkedEventId;
      return ok({
        ...base,
        kind: "report",
        listener: listener.value,
        content: content.value,
        ...(claim.value === undefined ? {} : { claim: claim.value }),
        ...(linkedEventId.value === undefined
          ? {}
          : { linkedEventId: linkedEventId.value }),
      });
    }
    case "pray": {
      const cause = parseEventId(input.cause, "cause");
      if (!cause.ok) return cause;
      return ok({ ...base, kind: "pray", cause: cause.value });
    }
    case "bless": {
      const petition = parseEventId(input.petition, "petition");
      if (!petition.ok) return petition;
      return ok({ ...base, kind: "bless", petition: petition.value });
    }
    case "practice": {
      // A stake belongs to an offer to a supplicant, and to no other move.
      if (input.stake !== undefined && input.move !== "offer") {
        return fail("stake", "only an offer to a supplicant may carry a stake");
      }
      // A contest rests on the rival's act and names nothing more: the world finds the rival, the place, and the window.
      if (input.move === "contest") {
        for (const key of [
          "place",
          "counterparty",
          "term",
          "thread",
          "petition",
          "swear",
        ]) {
          if (input[key] !== undefined) {
            return fail(key, "a contest names only the rival act it rests on");
          }
        }
        const cause = parseEventId(input.cause, "cause");
        if (!cause.ok) return cause;
        return ok({
          ...base,
          kind: "practice",
          move: "contest",
          cause: cause.value,
        });
      }
      switch (input.move) {
        case "offer": {
          const petition = parseEventId(input.petition, "petition");
          if (!petition.ok) return petition;
          const term = parsePracticeTermOffer(input.term, "term");
          if (!term.ok) return term;
          const stake =
            input.stake === undefined
              ? ok<string | undefined>(undefined)
              : parseString(input.stake, "stake");
          if (!stake.ok) return stake;
          return ok({
            ...base,
            kind: "practice",
            move: "offer",
            petition: petition.value,
            term: term.value,
            ...(stake.value === undefined ? {} : { stake: stake.value }),
          });
        }
        case "demand": {
          const counterparty = parseEntityId(
            input.counterparty,
            "counterparty",
          );
          if (!counterparty.ok) return counterparty;
          const cause = parseEventId(input.cause, "cause");
          if (!cause.ok) return cause;
          const term = parsePracticeTermOffer(input.term, "term");
          if (!term.ok) return term;
          return ok({
            ...base,
            kind: "practice",
            move: "demand",
            counterparty: counterparty.value,
            cause: cause.value,
            term: term.value,
          });
        }
        case "counter": {
          const thread = parseEventId(input.thread, "thread");
          if (!thread.ok) return thread;
          const term = parsePracticeTermOffer(input.term, "term");
          if (!term.ok) return term;
          return ok({
            ...base,
            kind: "practice",
            move: "counter",
            thread: thread.value,
            term: term.value,
          });
        }
        case "accept": {
          const thread = parseEventId(input.thread, "thread");
          if (!thread.ok) return thread;
          const swear = parseOptionalBoolean(input.swear, "swear");
          if (!swear.ok) return swear;
          return ok({
            ...base,
            kind: "practice",
            move: "accept",
            thread: thread.value,
            ...(swear.value === undefined ? {} : { swear: swear.value }),
          });
        }
        case "refuse":
        case "withdraw": {
          const thread = parseEventId(input.thread, "thread");
          if (!thread.ok) return thread;
          return ok({
            ...base,
            kind: "practice",
            move: input.move,
            thread: thread.value,
          });
        }
        default:
          return fail("move", `expected one of: ${PRACTICE_MOVES.join(", ")}`);
      }
    }
    case "goal": {
      if (base.goal === undefined) {
        return fail("goal", "a goal proposal needs its goal change");
      }
      return ok({ ...base, kind: "goal", goal: base.goal });
    }
    default:
      return fail(
        "kind",
        `unknown proposal kind: ${String(input.kind)}`,
        "unknown-kind",
      );
  }
}
