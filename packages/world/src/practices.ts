// Practices: gods settle disputes through threads the world holds and judges.
//
// A demand opens a settlement thread between two gods. It rests on a cause the
// demander knows, and holds one term the world can check: a performance by a
// named party before a deadline. The other god answers (accept, counter,
// refuse), and the thread ends only in a ruling the world makes from committed
// events: fulfilled when the obligated party is seen performing after it
// accepted, breached when the deadline passes unperformed, refused when the
// counteroffer budget runs out, expired when the negotiation window closes,
// withdrawn when a party dies. A god's words never end a thread; only its
// moves bind and only the world rules.
//
// A thread is state changed only by events (`practice-opened`,
// `practice-moved`, `practice-ended`), so a replay rebuilds it. Rulings are
// planned by `judgePractices` at the end of the tick's environment step and
// are primary events of that tick, so memories derived afterwards see them.
// Deadlines are world ticks, judged identically in live play and catch-up.

import type {
  AccessRestoredEvent,
  EntityId,
  EventId,
  MotifAppliedEvent,
  PracticeEndedEvent,
  PracticeEndReason,
  PracticeMovedEvent,
  PracticeOpenedEvent,
  PracticeOutcome,
  PracticeProgressedEvent,
  PracticeProposal,
  PracticeTerm,
  PracticeTermOffer,
  PracticeTermSpec,
  RejectionReasonCode,
  ThreadSubject,
  Transformation,
  WorldEvent,
  WorldRules,
} from "@panthea/contracts";
import { changeStanding, validateContest } from "./contests";
import {
  debitActorInventory,
  gatherAmountOf,
  getResourceAmount,
} from "./economy";
import { routeLength } from "./geography";
import { getMemories } from "./memory";
import {
  blessability,
  inAnswerWindow,
  judgeAnswers,
  petitionBalanceOf,
} from "./petitions";
import {
  type ActorState,
  DIVINE_CAPABILITY,
  getActor,
  getLocation,
  isThreadOpen,
  type MemoryEntry,
  type Petition,
  type PracticeThread,
  type WorldEventDraft,
  type WorldState,
} from "./state";
import { DIVINE_CAPACITY_RESOURCE } from "./worship";

/** Defaults for `rules.practiceBalance`, in world ticks unless a count. */
export const DEFAULT_PRACTICE_BALANCE: Readonly<Record<string, number>> = {
  /** How long a demand stays open to answers: a god decides about once in 25 ticks, so this allows several turns each. */
  negotiationTicks: 200,
  /** Counteroffers a thread allows. The counter that spends the last one ends the thread refused. */
  counterBudget: 3,
  /** Fewest ticks a term may allow. One decision at the slowest god pace measured. */
  minTermTicks: 25,
  /** Most ticks a term may allow. */
  maxTermTicks: 500,
  /** Divinity a sworn breach costs. Hesiod's penalty is a year without nectar and ambrosia, so it is a loss of the god's own substance; bounded by what the god holds. */
  oathDivinityLoss: 3,
  /** Ticks a sworn breacher is shut out of Olympus: four decisions at the slowest god pace measured. Banishment is M3 (M08). */
  oathAccessTicks: 100,
  /** What a recorded gain or loss of standing at a place weighs (a settlement performed or breached there). */
  standingDelta: 1,
  /** How pious a mortal's drive must be, as a percent, to take the terms a god offers it. The authored mortals sit at 10, so by default they take what they can afford. */
  acceptPietyPercent: 10,
  /** Ticks before an accepted term's deadline when performing it outranks every other routine choice. A mortal acts every tick, so this leaves it many chances, and it is under the shortest term a god may set (25). */
  urgentTicks: 20,
  /** Ticks a contest runs: acts after it opens and by this many ticks later count. Five minutes: a god takes a turn about once a minute at seven gods on the local baseline. */
  contestWindowTicks: 300,
  /** Ticks a rival's act can still be contested after it was done: a god sees it on its next turn, which at seven gods and about ten seconds a turn is over a minute away. */
  contestActTicks: 120,
  /** Most recent acts the world remembers as contestable, so the ledger and a prompt about it stay small. */
  contestLedgerMax: 48,
  /** What a closed contest moves each god's standing at the place by, in the units of the affinity a mortal weighs it against. */
  contestStanding: 1,
};

/** A practice tunable from `rules`, or its default. */
export function practiceBalanceOf(rules: WorldRules, key: string): number {
  return rules.practiceBalance?.[key] ?? DEFAULT_PRACTICE_BALANCE[key] ?? 0;
}

// --- Reducers -------------------------------------------------------------------------------

/**
 * What an offer is, as far as repeating it goes: its kind, who must perform,
 * what it names, what and how much, and how long it allows. Never any words,
 * and never the tick it was said on, so the same offer made later is the same
 * offer.
 */
export function termTuple(term: PracticeTermSpec, ticks: number): string {
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
  return `${term.kind}|${term.party}|${subject}|${resource}|${amount}|${ticks}`;
}

/** The tuple of a committed term: its deadline measured from the tick it was offered on. */
const tupleOf = (term: PracticeTerm, offeredAt: number) =>
  termTuple(term, term.deadline - offeredAt);

function withThread(state: WorldState, thread: PracticeThread): WorldState {
  const threads = new Map(state.threads);
  threads.set(thread.id, thread);
  return { ...state, threads };
}

export function applyPracticeOpened(
  state: WorldState,
  event: PracticeOpenedEvent,
): WorldState {
  let next = withThread(state, {
    id: event.id,
    practice: event.practice,
    demander: event.entityId,
    obligated: event.counterparty,
    causes: event.causes,
    term: event.term,
    ...(event.subject === undefined ? {} : { subject: event.subject }),
    ...(event.petition === undefined ? {} : { petition: event.petition }),
    offers: [tupleOf(event.term, event.tick)],
    offeredBy: event.entityId,
    ...(event.stake === undefined ? {} : { stake: event.stake }),
    status: "open",
    openedTick: event.tick,
    openedSequence: event.sequence,
    negotiationDeadline: event.negotiationDeadline,
    counterBudgetLeft: event.counterBudget,
    revision: 0,
  });
  // The thread this one follows from learns its successor, and its revision
  // moves with the link; it stays closed.
  const earlier =
    event.succeeds === undefined
      ? undefined
      : state.threads.get(event.succeeds);
  if (earlier !== undefined && earlier.successor === undefined) {
    next = withThread(next, {
      ...earlier,
      successor: event.id,
      revision: earlier.revision + 1,
    });
  }
  return next;
}

export function applyPracticeMoved(
  state: WorldState,
  event: PracticeMovedEvent,
): WorldState {
  const thread = state.threads.get(event.threadId);
  if (thread === undefined || !isThreadOpen(thread)) return state;
  const revision = thread.revision + 1;
  switch (event.move) {
    case "counter":
      return withThread(state, {
        ...thread,
        term: event.term,
        offers: [...thread.offers, tupleOf(event.term, event.tick)],
        offeredBy: event.entityId,
        status: "countered",
        counterBudgetLeft: Math.max(0, thread.counterBudgetLeft - 1),
        revision,
      });
    case "accept":
      return withThread(state, {
        ...thread,
        status: "accepted",
        acceptance: {
          tick: event.tick,
          sequence: event.sequence,
          sworn: event.sworn,
        },
        revision,
      });
    case "refuse":
      return withThread(state, {
        ...thread,
        status: "refused",
        closedTick: event.tick,
        revision,
      });
    case "withdraw":
      return withThread(state, {
        ...thread,
        status: "withdrawn",
        closedTick: event.tick,
        revision,
      });
  }
}

export function applyPracticeProgressed(
  state: WorldState,
  event: PracticeProgressedEvent,
): WorldState {
  const thread = state.threads.get(event.threadId);
  if (thread === undefined || !isThreadOpen(thread)) return state;
  return withThread(state, {
    ...thread,
    progress: { ...thread.progress, [event.step]: event.by },
    revision: thread.revision + 1,
  });
}

export function applyPracticeEnded(
  state: WorldState,
  event: PracticeEndedEvent,
): WorldState {
  const thread = state.threads.get(event.threadId);
  if (thread === undefined || !isThreadOpen(thread)) return state;
  return withThread(state, {
    ...thread,
    status: event.outcome,
    closedTick: event.tick,
    revision: thread.revision + 1,
  });
}

/**
 * A motif's change, applied. An oath penalty takes divinity (never more than
 * the god holds) and withholds a capability until its period ends; a
 * transformation changes form and capabilities and nothing else, so identity,
 * memory, and relationships stay with the actor. Both bump the actor's
 * revision, so a proposal it made before the change goes stale. A standing
 * record changes the god's standing at the place for good.
 */
export function applyMotifApplied(
  state: WorldState,
  event: MotifAppliedEvent,
): WorldState {
  const actor = getActor(state, event.entityId);
  if (actor === undefined) return state;
  switch (event.effect) {
    case "oath-penalty": {
      const paid = debitActorInventory(
        state,
        event.entityId,
        DIVINE_CAPACITY_RESOURCE,
        Math.min(
          event.divinityLost,
          getResourceAmount(actor.inventory, DIVINE_CAPACITY_RESOURCE),
        ),
      );
      const paidActor = getActor(paid, event.entityId) as typeof actor;
      const withheld = [
        ...(paidActor.withheld ?? []).filter(
          (held) => held.capability !== event.capability,
        ),
        {
          capability: event.capability,
          restoreAt: event.accessRestoredAt,
          eventId: event.id,
        },
      ];
      return withActorState(paid, {
        ...paidActor,
        capabilities: paidActor.capabilities.filter(
          (capability) => capability !== event.capability,
        ),
        withheld,
        revision: paidActor.revision + 1,
      });
    }
    case "transformation": {
      const kept = actor.capabilities.filter(
        (capability) => !event.capabilitiesLost.includes(capability),
      );
      return withActorState(state, {
        ...actor,
        form: event.form,
        capabilities: [
          ...kept,
          ...event.capabilitiesGained.filter(
            (capability) => !kept.includes(capability),
          ),
        ],
        revision: actor.revision + 1,
      });
    }
    case "standing":
      // Standing is a state the world holds: changed for good, by a contest closing or a settlement performed or breached there.
      return changeStanding(state, event.entityId, event.place, event.delta);
  }
}

/** A withheld capability comes back: the penalty's period is over. */
export function applyAccessRestored(
  state: WorldState,
  event: AccessRestoredEvent,
): WorldState {
  const actor = getActor(state, event.entityId);
  if (actor === undefined) return state;
  const { withheld = [], ...rest } = actor;
  const remaining = withheld.filter(
    (held) =>
      !(
        held.capability === event.capability &&
        held.eventId === event.motifEventId
      ),
  );
  return withActorState(state, {
    ...rest,
    capabilities: actor.capabilities.includes(event.capability)
      ? actor.capabilities
      : [...actor.capabilities, event.capability],
    ...(remaining.length === 0 ? {} : { withheld: remaining }),
    revision: actor.revision + 1,
  });
}

function withActorState(state: WorldState, actor: ActorState): WorldState {
  const actors = new Map(state.actors);
  actors.set(actor.id, actor);
  return { ...state, actors };
}

// --- Terms: what can be offered ---------------------------------------------------------------

/** What stands in the way of a term, in the rejection vocabulary the validator uses. */
export interface Obstacle {
  readonly reason: RejectionReasonCode;
  readonly message: string;
  /** The thread the refusal is about, when one is: what a no-progress move repeated or talked around. */
  readonly thread?: EventId;
}

const obstacle = (reason: RejectionReasonCode, message: string): Obstacle => ({
  reason,
  message,
});

/** The ticks `party` needs to perform `term` at best, one action per tick: the moves to get there, and the act itself. `undefined` when no route reaches. */
function ticksNeeded(
  state: WorldState,
  term: PracticeTermSpec,
): number | undefined {
  const party = getActor(state, term.party);
  if (party === undefined) return undefined;
  const hops = (to: EntityId | undefined) => {
    const place = to === undefined ? undefined : getActor(state, to);
    return place === undefined
      ? undefined
      : routeLength(
          state,
          party.locationId,
          place.locationId,
          party.capabilities,
        );
  };
  const hopsToPlace = (place: EntityId) =>
    routeLength(state, party.locationId, place, party.capabilities);
  switch (term.kind) {
    case "tell-legend": {
      const length = hopsToPlace(term.place);
      return length === undefined ? undefined : length + 1;
    }
    case "be-at":
      return hopsToPlace(term.place);
    case "stay-away":
    case "ally":
      return 0;
    case "give-resource": {
      const length = hops(term.to);
      return length === undefined ? undefined : length + 1;
    }
    case "bless-mortal": {
      const length = hops(term.mortal);
      return length === undefined ? undefined : length + 1;
    }
    case "make-offering":
      // Worship needs no place.
      return 1;
  }
}

/**
 * Whether `holder` can have `amount` of `resource` within `remaining` more
 * ticks: it holds that much now, or it holds some and gathers this resource, one
 * `gatherAmount` a tick for each tick left. An upper bound (the ticks it would
 * also spend acting on the term are not taken off), so it refuses only what no
 * run of gathering could reach. A holder that does not gather this resource is
 * held to what it holds: no one is assumed to be given or to earn anything else.
 */
function canHave(
  state: WorldState,
  holder: EntityId,
  resource: string,
  amount: number,
  remaining: number,
): boolean {
  const actor = getActor(state, holder);
  if (actor === undefined) return false;
  const gathered =
    actor.gathers === resource
      ? gatherAmountOf(state.rules) * Math.max(0, remaining)
      : 0;
  return getResourceAmount(actor.inventory, resource) + gathered >= amount;
}

/**
 * What stops `term` from being performed by its party in `remaining` more
 * ticks, or `undefined` when nothing does. One rule for the offer, the
 * acceptance, and the digest of an accepted obligation, so what could be
 * offered and what can still be performed cannot drift apart. It looks at the
 * world as it stands and the time left: what a party holds counts, and so does
 * what it would gather in `remaining` ticks if it gathers that resource; no one
 * is assumed to be given or to earn anything else.
 */
export function termObstacle(
  state: WorldState,
  term: PracticeTermSpec,
  remaining: number,
): Obstacle | undefined {
  const party = getActor(state, term.party);
  if (!party?.alive) {
    return obstacle("dead-actor", `${term.party} is not a living actor`);
  }
  if (
    (term.kind === "tell-legend" ||
      term.kind === "be-at" ||
      term.kind === "stay-away") &&
    getLocation(state, term.place) === undefined
  ) {
    return obstacle("malformed", `unknown place: ${term.place}`);
  }
  if (term.kind === "give-resource") {
    const to = getActor(state, term.to);
    if (!to?.alive) {
      return obstacle("dead-actor", `${term.to} is not a living actor`);
    }
    if (!canHave(state, term.party, term.resource, term.amount, remaining)) {
      return obstacle(
        "insufficient-resources",
        `${term.party} cannot have ${term.amount} ${term.resource} by the deadline (${remaining} ticks)`,
      );
    }
  }
  if (term.kind === "ally") {
    const to = getActor(state, term.to);
    if (!to?.alive) {
      return obstacle("dead-actor", `${term.to} is not a living actor`);
    }
    if (!party.isDeity || !to.isDeity) {
      return obstacle("unauthorized-claim", "only gods ally");
    }
  }
  if (term.kind === "make-offering") {
    if (
      !getActor(state, term.to)?.isDeity ||
      !getActor(state, term.to)?.alive
    ) {
      return obstacle(
        "unauthorized-claim",
        `${term.to} is not a living deity to offer to`,
      );
    }
    if (!canHave(state, term.party, term.resource, term.amount, remaining)) {
      return obstacle(
        "insufficient-resources",
        `${term.party} cannot have ${term.amount} ${term.resource} to offer by the deadline (${remaining} ticks)`,
      );
    }
  }
  if (term.kind === "bless-mortal") {
    const mortal = getActor(state, term.mortal);
    if (!mortal?.alive || mortal.isDeity) {
      return obstacle("dead-actor", `${term.mortal} is not a living mortal`);
    }
    if (!party.isDeity) {
      return obstacle("unauthorized-claim", "only a deity may bless");
    }
    const cost = petitionBalanceOf(state.rules, "blessDivinityCost");
    if (getResourceAmount(party.inventory, DIVINE_CAPACITY_RESOURCE) < cost) {
      return obstacle(
        "insufficient-power",
        `${term.party} lacks the ${cost} divinity a blessing costs`,
      );
    }
    // The prayer a blessing could answer, by the rule a bless is validated by: a punish petition is not one.
    const prayers = [...state.petitions.values()].filter(
      (petition) =>
        petition.god === term.party && petition.petitioner === term.mortal,
    );
    const verdicts = prayers.map((petition) =>
      blessability(state, petition.id, term.party),
    );
    if (!verdicts.some((verdict) => verdict.ok)) {
      const refused = verdicts.find(
        (verdict) =>
          !verdict.ok && verdict.message.startsWith("a punish petition"),
      );
      return obstacle(
        "malformed",
        refused !== undefined && !refused.ok
          ? `${term.mortal}'s prayer before ${term.party} asks for a punishment, and ${refused.message}, so a blessing cannot answer it`
          : `${term.mortal} has no open petition before ${term.party}, so a blessing cannot answer anything`,
      );
    }
  }
  const needed = ticksNeeded(state, term);
  if (needed === undefined) {
    return obstacle("not-adjacent", `${term.party} has no route to do this`);
  }
  if (needed > remaining) {
    return obstacle(
      "not-adjacent",
      `${term.party} needs ${needed} ticks to do this and has ${remaining}`,
    );
  }
  return undefined;
}

/** Whether an open thread's term can still be performed by its party in the time left. False once the thread has ended. */
export function canStillPerform(
  state: WorldState,
  thread: PracticeThread,
): boolean {
  if (!isThreadOpen(thread)) return false;
  return (
    termObstacle(state, thread.term, thread.term.deadline - state.tick) ===
    undefined
  );
}

// --- Opening and moving ------------------------------------------------------------------------

export type PracticeVerdict =
  | { readonly ok: true; readonly events: readonly WorldEventDraft[] }
  | ({ readonly ok: false } & Obstacle);

const deny = (
  reason: RejectionReasonCode,
  message: string,
  thread?: EventId,
): PracticeVerdict => ({
  ok: false,
  reason,
  message,
  ...(thread === undefined ? {} : { thread }),
});

/**
 * Whether `actor` knows the event `cause` happened: it remembers it (witnessed,
 * or told of it, whether the report itself or the event a report cites), it
 * noticed it as a loss, or it is its own open need or recorded loss. Nothing
 * the world's log holds that the actor never learned counts.
 */
export function knowsCause(
  state: WorldState,
  actor: EntityId,
  cause: EventId,
): boolean {
  if (
    getMemories(state, actor).some(
      (memory) =>
        memory.sourceEventId === cause ||
        (memory.kind === "told" && memory.linkedEventId === cause) ||
        (memory.kind === "noticed" && memory.causeEventId === cause),
    )
  ) {
    return true;
  }
  if (
    [...state.needs.values()].some(
      (need) => need.actor === actor && need.eventId === cause,
    )
  ) {
    return true;
  }
  if ((state.causes.get(actor) ?? []).some((c) => c.eventId === cause)) {
    return true;
  }
  // A prayer addressed to a god tells it what the prayer is about: its patron's knowledge of a harm to its worshipper.
  return prayerTo(state, actor, cause) !== undefined;
}

/** The prayer addressed to `god` that is about `cause`, if one is. */
function prayerTo(
  state: WorldState,
  god: EntityId,
  cause: EventId,
): Petition | undefined {
  for (const petition of state.petitions.values()) {
    if (petition.god === god && petition.cause === cause) return petition;
  }
  return undefined;
}

/** An offered term as a committed one: its deadline counted from the tick it commits in. */
function committedTerm(
  state: WorldState,
  offer: PracticeTermOffer,
): PracticeTerm {
  const { deadlineTicks, ...spec } = offer;
  return { ...spec, deadline: state.tick + deadlineTicks } as PracticeTerm;
}

/**
 * A term to be where its party already stands asks nothing and changes nothing.
 * The reason is no-progress: the god is told the world's own message, which says
 * exactly that, where a generic refusal would not.
 */
export function alreadyThere(
  state: WorldState,
  term: PracticeTermSpec,
): Obstacle | undefined {
  if (
    term.kind === "be-at" &&
    getActor(state, term.party)?.locationId === term.place
  ) {
    return obstacle(
      "no-progress",
      `${term.party} already stands at ${term.place}, so a term to be there asks nothing; ask for something that takes doing`,
    );
  }
  return undefined;
}

/** Checks an offered term against the world's bounds and its party's reach; the parties it may name are the caller's to check. */
function offerObstacle(
  state: WorldState,
  offer: PracticeTermOffer,
): Obstacle | undefined {
  const min = practiceBalanceOf(state.rules, "minTermTicks");
  const max = practiceBalanceOf(state.rules, "maxTermTicks");
  if (offer.deadlineTicks < min || offer.deadlineTicks > max) {
    return obstacle(
      "malformed",
      `a term allows between ${min} and ${max} ticks, not ${offer.deadlineTicks}`,
    );
  }
  return (
    alreadyThere(state, offer) ??
    termObstacle(state, offer, offer.deadlineTicks)
  );
}

/** Who a term may bind and benefit: the two gods of the thread, never a third. */
function bindsOutsiders(
  term: PracticeTermSpec,
  participants: readonly EntityId[],
): boolean {
  return (
    !participants.includes(term.party) ||
    ((term.kind === "give-resource" || term.kind === "ally") &&
      (!participants.includes(term.to) || term.to === term.party))
  );
}

// --- The mortal's side of a supplication ------------------------------------------------------

/** What a mortal does about the terms a god set on its prayer, if anything now. */
export type MortalPractice =
  | {
      /** Answer the offer on the table. */
      readonly kind: "answer";
      readonly thread: EventId;
      readonly move: "accept" | "refuse";
    }
  | {
      /** Perform the offering of a term it accepted. `urgent` when the deadline is near enough that nothing else should come first. */
      readonly kind: "offer";
      readonly thread: EventId;
      readonly deity: EntityId;
      readonly resource: string;
      readonly amount: number;
      readonly urgent: boolean;
    };

/**
 * The practice step a mortal's routine would take, or nothing. A mortal answers
 * an offer made to it once, by its drive and its means: it accepts when its
 * piety reaches `acceptPietyPercent` and the term can still be performed (the
 * same check the world makes at acceptance), and refuses otherwise. After
 * accepting it performs the offering when it holds it: promptly once the boon
 * is in hand, and on faith, ahead of everything else, when the deadline is
 * within `urgentTicks`. It never offers what it does not hold.
 */
export function mortalPractice(
  state: WorldState,
  actorId: EntityId,
): MortalPractice | undefined {
  const actor = getActor(state, actorId);
  if (!actor?.alive || actor.isDeity || actor.drives === undefined) {
    return undefined;
  }
  const urgentTicks = practiceBalanceOf(state.rules, "urgentTicks");
  const pietyNeeded = practiceBalanceOf(state.rules, "acceptPietyPercent");
  let offering: MortalPractice | undefined;
  for (const thread of state.threads.values()) {
    if (
      thread.practice !== "supplication" ||
      thread.obligated !== actorId ||
      thread.term.kind !== "make-offering"
    ) {
      continue;
    }
    if (thread.status === "open") {
      if (state.tick > thread.negotiationDeadline) continue;
      const willing =
        Math.round(actor.drives.piety * 100) >= pietyNeeded &&
        termObstacle(state, thread.term, thread.term.deadline - state.tick) ===
          undefined;
      return {
        kind: "answer",
        thread: thread.id,
        move: willing ? "accept" : "refuse",
      };
    }
    if (
      thread.status === "accepted" &&
      thread.progress?.offering === undefined &&
      state.tick <= thread.term.deadline &&
      getResourceAmount(actor.inventory, thread.term.resource) >=
        thread.term.amount
    ) {
      const urgent = thread.term.deadline - state.tick <= urgentTicks;
      if (urgent || thread.progress?.boon !== undefined) {
        const step: MortalPractice = {
          kind: "offer",
          thread: thread.id,
          deity: thread.term.to,
          resource: thread.term.resource,
          amount: thread.term.amount,
          urgent,
        };
        if (urgent) return step;
        offering ??= step;
      }
    }
  }
  return offering;
}

// --- Anti-loop ---------------------------------------------------------------------------------
//
// A thread is a place to make progress, so the world refuses the three ways a
// god can circle it: repeating a demand the world already answered, restating
// an offer that has already been on the table, and talking about the matter
// instead of moving on it. Each is matched on structure (the cause, the
// subject's agent and target, the term's tuple) and never on words.

/**
 * What a demand is about: the agent and target of the consequence the
 * demander itself remembers its cause as having (a claim it was told, or a
 * harm or kindness it saw). Nothing when its memory of the cause names no
 * agent, in which case only the cause itself ties the demand to a thread.
 */
export function subjectFor(
  state: WorldState,
  actor: EntityId,
  cause: EventId,
): ThreadSubject | undefined {
  for (const memory of getMemories(state, actor)) {
    if (!evidences(memory, cause) || memory.consequence === undefined) continue;
    const { agent, target } = memory.consequence;
    return { agent, ...(target === undefined ? {} : { target }) };
  }
  // With no memory of its own, a god's subject is what the prayer addressed to it names: who wronged whom.
  const prayer = prayerTo(state, actor, cause);
  return prayer?.about.offender === undefined
    ? undefined
    : { agent: prayer.about.offender, target: prayer.petitioner };
}

const evidences = (memory: MemoryEntry, cause: EventId) =>
  memory.sourceEventId === cause ||
  (memory.kind === "told" && memory.linkedEventId === cause) ||
  (memory.kind === "noticed" && memory.causeEventId === cause);

const sameSubject = (a?: ThreadSubject, b?: ThreadSubject) =>
  a !== undefined &&
  b !== undefined &&
  a.agent === b.agent &&
  a.target === b.target;

/** Whether `actor` learned of `cause` after the event numbered `sequence`, from a memory or a prayer addressed to it; a cause neither backs (a need, a loss) is as new as the world says. */
function learnedAfter(
  state: WorldState,
  actor: EntityId,
  cause: EventId,
  sequence: number,
): boolean {
  const learned = getMemories(state, actor)
    .filter((memory) => evidences(memory, cause))
    .map((memory) => memory.recordedAt);
  const prayer = prayerTo(state, actor, cause);
  if (prayer !== undefined) learned.push(prayer.sequence);
  return learned.length === 0 || Math.max(...learned) > sequence;
}

/** How a closed thread ended, in a few words, from what the thread itself holds. */
function howItEnded(thread: PracticeThread): string {
  const refuser =
    thread.offeredBy === thread.demander ? thread.obligated : thread.demander;
  switch (thread.status) {
    case "refused":
      return `${refuser} refused it`;
    case "fulfilled":
      return "it was fulfilled";
    case "breached":
      return "it was breached";
    case "expired":
      return "it expired unanswered";
    case "withdrawn":
      return "it was withdrawn";
    default:
      return "it is still open";
  }
}

const NO_PROGRESS_LIMIT = 190;
const briefly = (text: string) =>
  text.length > NO_PROGRESS_LIMIT
    ? `${text.slice(0, NO_PROGRESS_LIMIT - 1)}…`
    : text;

/**
 * The thread a demand continues, or why it may not: the threads between these
 * two gods about the same matter (the cause is one they consumed, or the
 * subject is the same). One still open already holds it. Once they have closed,
 * a new demand needs a cause not consumed and learned since the latest of them
 * opened, and then opens as its successor, linking it.
 */
function successorOf(
  state: WorldState,
  actor: EntityId,
  counterparty: EntityId,
  cause: EventId,
  subject: ThreadSubject | undefined,
): { succeeds?: EventId } | Obstacle {
  const affair = [...state.threads.values()].filter(
    (thread) =>
      ((thread.demander === actor && thread.obligated === counterparty) ||
        (thread.demander === counterparty && thread.obligated === actor)) &&
      (thread.causes.includes(cause) || sameSubject(thread.subject, subject)),
  );
  const open = affair.find(isThreadOpen);
  if (open !== undefined) {
    return {
      reason: "no-progress",
      message: briefly(
        `${open.id} already holds this matter between you and ${counterparty}; answer it, or let it end`,
      ),
      thread: open.id,
    };
  }
  const closed = affair.sort((a, b) => a.openedSequence - b.openedSequence);
  const latest = closed.at(-1);
  if (latest === undefined) return {};
  const consumed = new Set(closed.flatMap((thread) => thread.causes));
  if (
    consumed.has(cause) ||
    !learnedAfter(state, actor, cause, latest.openedSequence)
  ) {
    return {
      reason: "no-progress",
      message: briefly(
        `that was already answered: ${howItEnded(latest)} (${latest.id}); a demand on the same matter needs a cause you learned since it closed`,
      ),
      thread: latest.id,
    };
  }
  return { succeeds: latest.id };
}

/**
 * What stops talk from being told because it circles an open thread: a report
 * or legend from one party of the thread that reaches the other and either
 * cites the thread's cause or makes a claim naming its subject's agent and
 * target. The claim is structure, so rewording changes nothing; a claim naming
 * anyone else, and talk to anyone outside the thread, is free.
 */
export function talkAroundThread(
  state: WorldState,
  speaker: EntityId,
  listeners: readonly EntityId[],
  claim: { readonly agent: EntityId; readonly target?: EntityId } | undefined,
  linkedEventId: EventId | undefined,
): Obstacle | undefined {
  for (const thread of state.threads.values()) {
    // Talk is free around a supplication: only a settlement is a dispute to circle.
    if (!isThreadOpen(thread) || thread.practice !== "settlement") continue;
    const other =
      thread.demander === speaker
        ? thread.obligated
        : thread.obligated === speaker
          ? thread.demander
          : undefined;
    if (other === undefined || !listeners.includes(other)) continue;
    const citesCause =
      linkedEventId !== undefined && thread.causes.includes(linkedEventId);
    const namesSubject =
      claim !== undefined &&
      thread.subject !== undefined &&
      claim.agent === thread.subject.agent &&
      claim.target === thread.subject.target;
    if (citesCause || namesSubject) {
      return {
        reason: "no-progress",
        message: briefly(
          `talk about this does not move ${thread.id} forward; answer it with a practice move`,
        ),
        thread: thread.id,
      };
    }
  }
  return undefined;
}

function openDemand(
  state: WorldState,
  proposal: Extract<PracticeProposal, { move: "demand" }>,
): PracticeVerdict {
  const actor = getActor(state, proposal.actor);
  if (!actor?.isDeity) {
    return deny("unauthorized-claim", "only a god may make a demand");
  }
  if (proposal.counterparty === proposal.actor) {
    return deny("malformed", "a god cannot make a demand of itself");
  }
  const other = getActor(state, proposal.counterparty);
  if (other === undefined) {
    return deny("malformed", `unknown counterparty: ${proposal.counterparty}`);
  }
  if (!other.alive) {
    return deny("dead-actor", `${proposal.counterparty} is no longer living`);
  }
  if (!other.isDeity) {
    return deny(
      "unauthorized-claim",
      "a settlement is between gods; a mortal petitions instead",
    );
  }
  if (!knowsCause(state, proposal.actor, proposal.cause)) {
    return deny(
      "unauthorized-claim",
      `${proposal.actor} knows of no ${proposal.cause}, so cannot demand over it`,
    );
  }
  const { term } = proposal;
  if (
    term.party !== proposal.counterparty ||
    bindsOutsiders(term, [proposal.actor, proposal.counterparty])
  ) {
    return deny(
      "unauthorized-claim",
      "a demand binds the god it is made of, and no one promises a third god's cooperation",
    );
  }
  const subject = subjectFor(state, proposal.actor, proposal.cause);
  const next = successorOf(
    state,
    proposal.actor,
    proposal.counterparty,
    proposal.cause,
    subject,
  );
  if ("reason" in next) return deny(next.reason, next.message, next.thread);
  const stopped = offerObstacle(state, term);
  if (stopped !== undefined) return deny(stopped.reason, stopped.message);
  return {
    ok: true,
    events: [
      {
        kind: "practice-opened",
        entityId: proposal.actor,
        practice: "settlement",
        counterparty: proposal.counterparty,
        causes: [proposal.cause],
        ...(subject === undefined ? {} : { subject }),
        ...(next.succeeds === undefined ? {} : { succeeds: next.succeeds }),
        term: committedTerm(state, term),
        negotiationDeadline:
          state.tick + practiceBalanceOf(state.rules, "negotiationTicks"),
        counterBudget: practiceBalanceOf(state.rules, "counterBudget"),
      },
    ],
  };
}

/**
 * A god answers a prayer with terms: its boon for one offering by the mortal.
 * The petition stays what it was (open, to be answered by a bless or a strike);
 * the thread is the bargain about it. One standing offer per petition, and the
 * same offer is not made twice, so a god cannot circle a mortal that said no.
 */
function openOffer(
  state: WorldState,
  proposal: Extract<PracticeProposal, { move: "offer" }>,
): PracticeVerdict {
  const god = getActor(state, proposal.actor);
  if (!god?.isDeity) {
    return deny("unauthorized-claim", "only a god may offer terms on a prayer");
  }
  const petition = state.petitions.get(proposal.petition);
  if (petition === undefined) {
    return deny("malformed", `${proposal.petition} is not a petition`);
  }
  if (petition.god !== proposal.actor) {
    return deny(
      "unauthorized-claim",
      `${proposal.petition} is not a petition addressed to ${proposal.actor}`,
    );
  }
  if (
    petition.status !== "open" ||
    !inAnswerWindow(state, petition, state.tick)
  ) {
    return deny(
      "malformed",
      `${proposal.petition} is no longer open to an answer`,
    );
  }
  if (getActor(state, petition.petitioner)?.alive !== true) {
    return deny("dead-actor", "the petitioner is no longer living");
  }
  const { term } = proposal;
  if (
    term.kind !== "make-offering" ||
    term.party !== petition.petitioner ||
    term.to !== proposal.actor
  ) {
    return deny(
      "unauthorized-claim",
      "an offer on a prayer asks the one who prayed for an offering to you, and nothing else",
    );
  }
  const earlier = [...state.threads.values()].filter(
    (thread) => thread.petition === petition.id,
  );
  const standing = earlier.find(isThreadOpen);
  if (standing !== undefined) {
    return deny(
      "no-progress",
      `${standing.id} already holds terms on this prayer; let it be answered, or withdraw it`,
      standing.id,
    );
  }
  const tuple = termTuple(term, term.deadlineTicks);
  const repeated = earlier.find((thread) => thread.offers.includes(tuple));
  if (repeated !== undefined) {
    return deny(
      "no-progress",
      `that offer was already made and answered (${repeated.id}); change what it asks`,
      repeated.id,
    );
  }
  let stake: Transformation | undefined;
  if (proposal.stake !== undefined) {
    stake = state.rules.practiceStakes?.[proposal.stake];
    if (stake === undefined) {
      return deny(
        "malformed",
        `${proposal.stake} is not a stake the world knows`,
      );
    }
  }
  const stopped = offerObstacle(state, term);
  if (stopped !== undefined) return deny(stopped.reason, stopped.message);
  return {
    ok: true,
    events: [
      {
        kind: "practice-opened",
        entityId: proposal.actor,
        practice: "supplication",
        counterparty: petition.petitioner,
        causes: [petition.cause],
        petition: petition.id,
        term: committedTerm(state, term),
        negotiationDeadline:
          state.tick + practiceBalanceOf(state.rules, "negotiationTicks"),
        counterBudget: 0,
        ...(stake === undefined ? {} : { stake }),
      },
    ],
  };
}

function answer(
  state: WorldState,
  proposal: Exclude<PracticeProposal, { move: "demand" | "offer" | "contest" }>,
): PracticeVerdict {
  const thread = state.threads.get(proposal.thread);
  if (thread === undefined) {
    return deny("malformed", `${proposal.thread} is not a practice thread`);
  }
  const participants = [thread.demander, thread.obligated];
  if (!participants.includes(proposal.actor)) {
    return deny(
      "unauthorized-claim",
      `${proposal.actor} is not a party to ${thread.id}`,
    );
  }
  if (!isThreadOpen(thread)) {
    return deny("malformed", `${thread.id} has ended: ${thread.status}`);
  }
  if (proposal.move === "withdraw") {
    if (thread.status === "accepted") {
      return deny(
        "malformed",
        "an accepted obligation ends by performance or breach, not by withdrawal",
      );
    }
    return {
      ok: true,
      events: [
        {
          kind: "practice-moved",
          entityId: proposal.actor,
          threadId: thread.id,
          move: "withdraw",
        },
      ],
    };
  }
  // Counter, accept, and refuse answer the offer on the table.
  if (thread.status === "accepted") {
    return deny("malformed", `${thread.id} is already accepted`);
  }
  if (state.tick > thread.negotiationDeadline) {
    return deny(
      "malformed",
      `the negotiation of ${thread.id} closed at tick ${thread.negotiationDeadline}`,
    );
  }
  if (thread.offeredBy === proposal.actor) {
    return deny(
      "unauthorized-claim",
      "the other god answers an offer; its maker may only withdraw",
    );
  }
  const other = participants.find((p) => p !== proposal.actor) as EntityId;
  if (proposal.move !== "refuse" && !getActor(state, other)?.alive) {
    return deny("dead-actor", `${other} is no longer living`);
  }
  switch (proposal.move) {
    case "refuse":
      return {
        ok: true,
        events: [
          {
            kind: "practice-moved",
            entityId: proposal.actor,
            threadId: thread.id,
            move: "refuse",
          },
        ],
      };
    case "accept": {
      if (proposal.swear === true && proposal.actor !== thread.term.party) {
        return deny(
          "unauthorized-claim",
          "only the god who must perform the term may swear it",
        );
      }
      const stopped =
        alreadyThere(state, thread.term) ??
        termObstacle(state, thread.term, thread.term.deadline - state.tick);
      if (stopped !== undefined) return deny(stopped.reason, stopped.message);
      return {
        ok: true,
        events: [
          {
            kind: "practice-moved",
            entityId: proposal.actor,
            threadId: thread.id,
            move: "accept",
            sworn: proposal.swear === true,
          },
        ],
      };
    }
    case "counter": {
      if (thread.counterBudgetLeft < 1) {
        return deny("malformed", `${thread.id} has no counteroffers left`);
      }
      if (bindsOutsiders(proposal.term, participants)) {
        return deny(
          "unauthorized-claim",
          "a term binds only the two gods of the thread, and no one promises a third god's cooperation",
        );
      }
      const tuple = termTuple(proposal.term, proposal.term.deadlineTicks);
      if (thread.offers.includes(tuple)) {
        return deny(
          "no-progress",
          thread.offers.at(-1) === tuple
            ? "that is the offer already on the table; accept it, or change what it asks"
            : "that offer was already made and answered; change what it asks",
          thread.id,
        );
      }
      const stopped = offerObstacle(state, proposal.term);
      if (stopped !== undefined) return deny(stopped.reason, stopped.message);
      return {
        ok: true,
        events: [
          {
            kind: "practice-moved",
            entityId: proposal.actor,
            threadId: thread.id,
            move: "counter",
            term: committedTerm(state, proposal.term),
          },
        ],
      };
    }
  }
}

/** The events a practice proposal would commit, or why the world refuses it. */
export function validatePractice(
  state: WorldState,
  proposal: PracticeProposal,
): PracticeVerdict {
  return proposal.move === "demand"
    ? openDemand(state, proposal)
    : proposal.move === "offer"
      ? openOffer(state, proposal)
      : proposal.move === "contest"
        ? validateContest(state, proposal)
        : answer(state, proposal);
}

// --- Judging ---------------------------------------------------------------------------------

/** One half of a supplication's bargain seen done this tick, to be recorded on its thread. */
interface PracticeProgress {
  readonly thread: PracticeThread;
  readonly step: "boon" | "offering";
  readonly by: EventId;
}

interface Ruling {
  readonly thread: PracticeThread;
  readonly outcome: PracticeOutcome;
  readonly reason: PracticeEndReason;
  readonly performedBy?: EventId;
}

/** What `event`, seen in the world as it stood just before it (`running`), settles of an accepted `term`, or nothing. */
function observe(
  running: WorldState,
  term: PracticeTerm,
  event: WorldEvent,
): { outcome: PracticeOutcome; reason: PracticeEndReason } | undefined {
  if (event.tick > term.deadline) return undefined;
  const performed = { outcome: "fulfilled", reason: "performed" } as const;
  switch (term.kind) {
    case "tell-legend": {
      if (event.kind !== "legend-recorded" || event.entityId !== term.party) {
        return undefined;
      }
      if (running.actors.get(term.party)?.locationId !== term.place) {
        return undefined;
      }
      const toMortals = event.hearers.some((hearer) => {
        const listener = running.actors.get(hearer);
        return listener?.alive === true && listener.isDeity !== true;
      });
      return toMortals ? performed : undefined;
    }
    case "stay-away":
      return (event.kind === "entity-moved" ||
        event.kind === "realm-transitioned") &&
        event.entityId === term.party &&
        event.to === term.place
        ? { outcome: "breached", reason: "entered" }
        : undefined;
    case "give-resource": {
      if (event.kind !== "resource-traded") return undefined;
      const given =
        event.entityId === term.party && event.counterpartyId === term.to
          ? event.give
          : event.counterpartyId === term.party && event.entityId === term.to
            ? event.receive
            : [];
      const total = given
        .filter((line) => line.resource === term.resource)
        .reduce((sum, line) => sum + line.amount, 0);
      return total >= term.amount ? performed : undefined;
    }
    case "make-offering":
      return event.kind === "worship-performed" &&
        event.entityId === term.party &&
        event.deity === term.to &&
        event.offering?.resource === term.resource &&
        event.offering.amount >= term.amount
        ? performed
        : undefined;
    case "bless-mortal":
      return event.kind === "blessing-granted" &&
        event.entityId === term.party &&
        event.recipient === term.mortal
        ? performed
        : undefined;
    case "be-at":
      // Judged from where the party stands once the tick's events are in.
      return undefined;
    case "ally":
      // Sealed by agreement, ruled below.
      return undefined;
  }
}

/**
 * The rulings this tick's primary events and the clock give, in the order the
 * world makes them: performances observed after acceptance, then negotiation
 * deadlines, then spent counteroffer budgets, then obligation deadlines, then
 * the death of a party. A thread gets at most one ruling a tick, the first
 * that applies, so a performance on a deadline's last tick wins over its
 * breach and a breach already due wins over a death. `before` is the world at
 * the start of the tick and each event is judged against it with the events
 * before it applied (`apply`), so a legend is judged at the place its teller
 * stood when it spoke. `after` is the world the threads live in now.
 */
export function judgePractices(
  before: WorldState,
  primary: readonly WorldEvent[],
  after: WorldState,
  apply: (state: WorldState, event: WorldEvent) => WorldState,
): readonly WorldEventDraft[] {
  const live = [...after.threads.values()]
    .filter(isThreadOpen)
    .sort((a, b) => a.openedSequence - b.openedSequence);
  const rulings = new Map<EventId, Ruling>();
  const rule = (
    thread: PracticeThread,
    outcome: PracticeOutcome,
    reason: PracticeEndReason,
    performedBy?: EventId,
  ) => {
    if (rulings.has(thread.id)) return;
    rulings.set(thread.id, {
      thread,
      outcome,
      reason,
      ...(performedBy === undefined ? {} : { performedBy }),
    });
  };
  const acceptedAll = live.filter(
    (thread) => thread.status === "accepted" && thread.acceptance !== undefined,
  );
  // A settlement is judged on its one term; a supplication on both halves of its bargain, below.
  const accepted = acceptedAll.filter(
    (thread) => thread.practice === "settlement",
  );
  const supplications = live.filter(
    (thread) => thread.practice === "supplication",
  );
  const unfinished = (thread: PracticeThread) => !rulings.has(thread.id);
  const isDead = (id: EntityId) => after.actors.get(id)?.alive !== true;
  const progress: PracticeProgress[] = [];

  // 1. Performances seen after acceptance, event by event.
  let running = before;
  for (const event of primary) {
    for (const thread of accepted.filter(unfinished)) {
      if (event.sequence <= (thread.acceptance?.sequence ?? Infinity)) continue;
      const seen = observe(running, thread.term, event);
      if (seen !== undefined) rule(thread, seen.outcome, seen.reason, event.id);
    }
    running = apply(running, event);
  }
  // An alliance is sealed by agreement: accepted, it needs no performance, if both gods live.
  for (const thread of accepted.filter(unfinished)) {
    const { term } = thread;
    if (term.kind === "ally" && !isDead(term.party) && !isDead(term.to)) {
      rule(thread, "fulfilled", "sealed");
    }
  }
  // Being at a place is performed by arriving: a move or a crossing into it after the acceptance. Standing there is not enough, since a party already there (or put there some other way) arrived at nothing.
  for (const thread of accepted.filter(unfinished)) {
    const { term } = thread;
    if (term.kind !== "be-at") continue;
    const arrival = primary.find(
      (event) =>
        (event.kind === "entity-moved" ||
          event.kind === "realm-transitioned") &&
        event.entityId === term.party &&
        event.to === term.place &&
        event.tick <= term.deadline &&
        event.sequence > (thread.acceptance?.sequence ?? Infinity),
    );
    if (arrival !== undefined && after.actors.get(term.party)?.alive === true) {
      rule(thread, "fulfilled", "performed", arrival.id);
    }
  }

  // 1b. A supplication: the boon and the offering, each seen once after acceptance, in either order.
  const boons = judgeAnswers(before, primary, after, apply);
  for (const thread of supplications) {
    const { acceptance } = thread;
    const answered = boons.find((boon) => boon.petition.id === thread.petition);
    // The boon counts toward the bargain only when it came after the acceptance and by the deadline (inclusive). A later bless still answers the petition, which is the god's to answer; it is simply not what the offering was bought with.
    const boonEvent =
      acceptance !== undefined &&
      answered !== undefined &&
      answered.answeredBy.sequence > acceptance.sequence &&
      answered.answeredBy.tick <= thread.term.deadline
        ? answered.answeredBy
        : undefined;
    let offeringEvent: WorldEvent | undefined;
    if (acceptance !== undefined) {
      let seeing = before;
      for (const event of primary) {
        if (
          offeringEvent === undefined &&
          event.sequence > acceptance.sequence &&
          observe(seeing, thread.term, event) !== undefined
        ) {
          offeringEvent = event;
        }
        seeing = apply(seeing, event);
      }
    }
    const newlySeen = [
      ...(thread.progress?.boon === undefined && boonEvent !== undefined
        ? [{ step: "boon" as const, event: boonEvent }]
        : []),
      ...(thread.progress?.offering === undefined && offeringEvent !== undefined
        ? [{ step: "offering" as const, event: offeringEvent }]
        : []),
    ];
    const boonSeen =
      thread.progress?.boon !== undefined || boonEvent !== undefined;
    const offeringSeen =
      thread.progress?.offering !== undefined || offeringEvent !== undefined;
    if (boonSeen && offeringSeen) {
      const last = newlySeen.reduce(
        (later, seen) =>
          later === undefined || seen.event.sequence > later.sequence
            ? seen.event
            : later,
        undefined as WorldEvent | undefined,
      );
      rule(thread, "fulfilled", "performed", last?.id);
      continue;
    }
    // A boon the terms cannot buy: the petition was answered without them
    // (before they were accepted, or after the deadline), or has closed with no answer.
    const petition =
      thread.petition === undefined
        ? undefined
        : after.petitions.get(thread.petition);
    if (
      !boonSeen &&
      (answered !== undefined ||
        petition === undefined ||
        petition.status !== "open")
    ) {
      rule(thread, "expired", "boon-unanswered");
      continue;
    }
    for (const seen of newlySeen) {
      progress.push({ thread, step: seen.step, by: seen.event.id });
    }
  }

  // 2. A negotiation nobody answered in time.
  for (const thread of live) {
    if (
      unfinished(thread) &&
      (thread.status === "open" || thread.status === "countered") &&
      after.tick > thread.negotiationDeadline
    ) {
      rule(thread, "expired", "negotiation-deadline");
    }
  }
  // 3. A negotiation that spent its last counteroffer.
  for (const thread of live) {
    if (
      unfinished(thread) &&
      thread.status === "countered" &&
      thread.counterBudgetLeft === 0
    ) {
      rule(thread, "refused", "budget-exhausted");
    }
  }
  // 4. An obligation whose deadline has passed.
  for (const thread of accepted.filter(unfinished)) {
    const { term } = thread;
    if (after.tick <= term.deadline) continue;
    if (term.kind === "stay-away") {
      // A party that is gone kept nothing; the death below rules it.
      if (isDead(term.party)) continue;
      const there = after.actors.get(term.party)?.locationId === term.place;
      if (there) rule(thread, "breached", "entered");
      else rule(thread, "fulfilled", "kept-away");
    } else {
      rule(thread, "breached", "obligation-deadline");
    }
  }
  // 4b. A supplication whose deadline has passed: breached when the boon was had and the offering was not; expired, with nothing owed, when the boon never came.
  for (const thread of supplications) {
    if (
      !unfinished(thread) ||
      thread.status !== "accepted" ||
      after.tick <= thread.term.deadline
    ) {
      continue;
    }
    const boonHad =
      thread.progress?.boon !== undefined ||
      progress.some((p) => p.thread === thread && p.step === "boon");
    if (boonHad) rule(thread, "breached", "obligation-deadline");
    else rule(thread, "expired", "boon-unanswered");
  }
  // 5. A party who died takes the thread with it, with no consequence.
  for (const thread of live) {
    if (
      unfinished(thread) &&
      (isDead(thread.demander) || isDead(thread.obligated))
    ) {
      rule(thread, "withdrawn", "party-died");
    }
  }

  const progressed: WorldEventDraft[] = progress
    .filter(({ thread }) => unfinished(thread))
    .map(({ thread, step, by }) => ({
      kind: "practice-progressed" as const,
      entityId: thread.demander,
      counterparty: thread.obligated,
      threadId: thread.id,
      step,
      by,
    }));
  const endings = live.flatMap((thread) => {
    const ruling = rulings.get(thread.id);
    if (ruling === undefined) return [];
    const draft: WorldEventDraft = {
      kind: "practice-ended",
      entityId: thread.demander,
      counterparty: thread.obligated,
      threadId: thread.id,
      outcome: ruling.outcome,
      reason: ruling.reason,
      ...(ruling.performedBy === undefined
        ? {}
        : { performedBy: ruling.performedBy }),
    };
    return [draft];
  });
  return [...progressed, ...endings];
}

// --- Consequences ----------------------------------------------------------------------------

/**
 * What the world does to the gods because threads ended, as primary events
 * citing the ending that called for each (`endings`, already committed and
 * applied in `after`). A breach costs the one who breached: the bounded oath
 * penalty when it swore, the transformation the demand staked, and standing at
 * the term's place; a performance at a place earns standing there. Only an
 * accepted thread has a breacher or a performer, so a refusal, a lapse, and a
 * death change no one but through the feelings the memories of them give.
 */
export function planConsequences(
  after: WorldState,
  endings: readonly PracticeEndedEvent[],
): readonly WorldEventDraft[] {
  const drafts: WorldEventDraft[] = [];
  const standing = practiceBalanceOf(after.rules, "standingDelta");
  for (const ending of endings) {
    const thread = after.threads.get(ending.threadId);
    if (thread?.acceptance === undefined) continue;
    const { term } = thread;
    const party = after.actors.get(term.party);
    const about = {
      threadId: thread.id,
      cause: ending.id,
      entityId: term.party,
    };
    const place =
      term.kind === "tell-legend" ||
      term.kind === "be-at" ||
      term.kind === "stay-away"
        ? term.place
        : undefined;
    if (ending.outcome === "breached") {
      if (party?.alive) {
        if (thread.acceptance.sworn && party.isDeity) {
          drafts.push({
            kind: "motif-applied",
            ...about,
            motif: "oath-penalty",
            effect: "oath-penalty",
            divinityLost: Math.min(
              practiceBalanceOf(after.rules, "oathDivinityLoss"),
              getResourceAmount(party.inventory, DIVINE_CAPACITY_RESOURCE),
            ),
            capability: DIVINE_CAPABILITY,
            accessRestoredAt:
              after.tick + practiceBalanceOf(after.rules, "oathAccessTicks"),
          });
        }
        if (thread.stake !== undefined) {
          drafts.push({
            kind: "motif-applied",
            ...about,
            motif: "transformation-punishment",
            effect: "transformation",
            intent: "punishment",
            ...thread.stake,
          });
        }
      }
      if (place !== undefined && standing > 0) {
        drafts.push({
          kind: "motif-applied",
          ...about,
          motif: "standing-lost",
          effect: "standing",
          place,
          delta: -standing,
        });
      }
    } else if (
      ending.outcome === "fulfilled" &&
      place !== undefined &&
      term.kind !== "stay-away" &&
      standing > 0
    ) {
      drafts.push({
        kind: "motif-applied",
        ...about,
        motif: "standing-won",
        effect: "standing",
        place,
        delta: standing,
      });
    }
  }
  return drafts;
}

/** The capabilities whose withheld period is over at `state.tick`, each returning by an event the world records. */
export function planAccessRestorations(
  state: WorldState,
): readonly WorldEventDraft[] {
  const drafts: WorldEventDraft[] = [];
  const actors = [...state.actors.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const actor of actors) {
    for (const held of actor.withheld ?? []) {
      if (state.tick >= held.restoreAt) {
        drafts.push({
          kind: "access-restored",
          entityId: actor.id,
          capability: held.capability,
          motifEventId: held.eventId,
        });
      }
    }
  }
  return drafts;
}
