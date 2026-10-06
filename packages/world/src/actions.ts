// The action queue and tick scheduler: proposal intake (parsing untrusted
// fixture/routine payloads), one tick's sequential revalidate-then-commit
// pass over a queue, and `applyEvent`/`applyEvents`, which project
// committed events back onto `WorldState` -- the same functions a rebuild
// routine (packages/persistence) replays the whole log through, and the
// mechanism a rebuild-equals-live test exercises directly.
//
// Each tick revalidates and commits eligible proposals against the state
// as committed so far *within this tick*, so a later proposal in the same
// queue sees an earlier one's effects; same-tick double-spend is
// impossible by construction.
//
// Determinism: `runTick` never reads the wall clock or `Math.random`.
// Event ids, correlation ids, and causation ids are derived
// deterministically from the tick counter, the proposal's sequence
// position, and its `observationId` -- never from `crypto.randomUUID()` --
// so two runs given the same state, PRNG state, and proposal queue
// produce byte-identical output.

import {
  type CausationId,
  type ContestClosedEvent,
  type CorrelationId,
  type EntityId,
  type EventId,
  LATEST_EVENT_SCHEMA_VERSION,
  MAX_REFUSAL_WHY,
  type PracticeEndedEvent,
  type Proposal,
  parseProposal,
  type RejectionReasonCode,
  type WorldEvent,
} from "@panthea/contracts";
import {
  applyContestClosed,
  applyContestOpened,
  judgeContests,
  noteService,
  planContestStanding,
} from "./contests";
import { noteConsequential, planDirectorStep } from "./director";
import {
  applyRecipe,
  creditActorInventory,
  debitActorInventory,
  transferBetweenActors,
} from "./economy";
import {
  applyBuildingBurnTicked,
  applyBuildingDamaged,
  applyBuildingDestroyed,
  applyBuildingIgnited,
  planFireStep,
} from "./fire";
import { applyGoalEnded, applyGoalSet, planGoalEvents } from "./goals";
import {
  applyJourneyEnded,
  applyJourneyStarted,
  planHop,
  planJourneyReplaced,
} from "./journey";
import {
  applyMemoryRecorded,
  applyRelationshipChanged,
  type DerivedDraft,
  endingMemories,
  legendTellings,
  noticedMemory,
  planRelationships,
  reportTelling,
  signMemory,
  toldMemory,
  witnessMemories,
} from "./memory";
import {
  applyNeedMet,
  applyTheft,
  applyUnmetNeed,
  planNeedStep,
} from "./needs";
import {
  answeredDraft,
  applyBlessingGranted,
  applyLossNoticed,
  applyPetitionAnswered,
  applyPetitionLapsed,
  applyPetitionOpened,
  applyPetitionRefused,
  judgeAnswers,
  lapsingPetitions,
  planNoticeStep,
  recordCauses,
} from "./petitions";
import {
  applyAccessRestored,
  applyMotifApplied,
  applyPracticeEnded,
  applyPracticeMoved,
  applyPracticeOpened,
  applyPracticeProgressed,
  judgePractices,
  planAccessRestorations,
  planConsequences,
} from "./practices";
import { applyBuildingRepaired, applyRepairProgressed } from "./repair";
import {
  type PrngState,
  toLegendId,
  type WorldEventDraft,
  type WorldState,
  withLegend,
} from "./state";
import { validateProposal } from "./validate";
import { answeredWorshipDraft, applyWorshipPerformed } from "./worship";

/** Moves an actor to `to`, bumping the actor's and both locations' revisions. */
function moveActor(
  state: WorldState,
  entityId: EntityId,
  to: EntityId,
): WorldState {
  const actor = state.actors.get(entityId);
  if (!actor) return state;

  const actors = new Map(state.actors);
  actors.set(entityId, {
    ...actor,
    locationId: to,
    revision: actor.revision + 1,
  });

  const locations = new Map(state.locations);
  const from = state.locations.get(actor.locationId);
  if (from) {
    locations.set(from.id, { ...from, revision: from.revision + 1 });
  }
  const destination = state.locations.get(to);
  if (destination) {
    locations.set(to, { ...destination, revision: destination.revision + 1 });
  }

  return { ...state, actors, locations };
}

/**
 * Applies one committed event to `state`, advancing the world-global
 * sequence cursor to the event's own `sequence` regardless of kind.
 * Replaying an event log from an initial state through repeated calls
 * (`applyEvents`) reproduces exactly what live tick-by-tick commits
 * produced -- the rebuild-equals-live guarantee persistence relies on.
 */
export function applyEvent(state: WorldState, event: WorldEvent): WorldState {
  let next: WorldState;
  switch (event.kind) {
    case "entity-moved":
      next = moveActor(state, event.entityId, event.to);
      break;
    case "realm-transitioned":
      next = moveActor(state, event.entityId, event.to);
      break;
    case "resource-gathered":
      next = creditActorInventory(
        state,
        event.entityId,
        event.resource,
        event.amount,
      );
      break;
    case "resource-produced": {
      const recipe = state.recipes[event.output];
      next = recipe
        ? applyRecipe(state, event.entityId, recipe, event.quantity)
        : state;
      break;
    }
    case "resource-traded":
      next = transferBetweenActors(
        state,
        event.entityId,
        event.counterpartyId,
        event.give,
        event.receive,
      );
      break;
    case "resource-consumed":
      next = debitActorInventory(
        state,
        event.entityId,
        event.resource,
        event.amount,
      );
      break;
    case "building-damaged":
      next = applyBuildingDamaged(state, event.entityId);
      break;
    case "mortal-struck":
      next =
        event.resource === undefined
          ? state
          : debitActorInventory(
              state,
              event.entityId,
              event.resource,
              event.amount,
            );
      break;
    case "building-ignited":
      next = applyBuildingIgnited(state, event.entityId, {
        eventId: event.id,
        ...(event.cause.kind === "director"
          ? {}
          : event.cause.actor === undefined
            ? {}
            : { actor: event.cause.actor }),
      });
      break;
    case "building-burn-ticked":
      next = applyBuildingBurnTicked(
        state,
        event.entityId,
        event.fireIntensity,
        event.ticksBurning,
      );
      break;
    case "building-destroyed":
      next = applyBuildingDestroyed(state, event.entityId);
      break;
    case "repair-progressed":
      next = applyRepairProgressed(
        state,
        event.entityId,
        event.structureId,
        event.resource,
        event.amount,
      );
      break;
    case "building-repaired":
      next = applyBuildingRepaired(state, event.entityId);
      break;
    case "worship-performed":
      next = applyWorshipPerformed(
        state,
        event.entityId,
        event.deity,
        event.offering,
        event.favorEffect,
        event.favorExpiresAtTick,
      );
      break;
    case "income-earned":
      next = creditActorInventory(
        state,
        event.entityId,
        "currency",
        event.amount,
      );
      break;
    case "legend-recorded":
      next = withLegend(state, {
        // Each telling is its own event, so the event's id is its identity.
        id: toLegendId(`legend-${event.id}`),
        narrator: event.entityId,
        assertion: event.assertion,
        ...(event.linkedEventId ? { linkedEventId: event.linkedEventId } : {}),
      });
      break;
    case "report-told":
      // A report changes nothing by itself: the listener's belief is a
      // separate `memory-recorded` event the same tick derives from it.
      next = state;
      break;
    case "memory-recorded":
      next = applyMemoryRecorded(state, event);
      break;
    case "relationship-changed":
      next = applyRelationshipChanged(state, event);
      break;
    case "goal-set":
      next = applyGoalSet(state, event);
      break;
    case "goal-ended":
      next = applyGoalEnded(state, event);
      break;
    case "journey-started":
      next = applyJourneyStarted(state, event);
      break;
    case "journey-ended":
      next = applyJourneyEnded(state, event);
      break;
    case "loss-noticed":
      next = applyLossNoticed(state, event);
      break;
    case "unmet-need":
      next = applyUnmetNeed(state, event);
      break;
    case "need-met":
      next = applyNeedMet(state, event);
      break;
    case "theft":
      next = applyTheft(state, event);
      break;
    case "stock-spoiled":
      next = debitActorInventory(
        state,
        event.entityId,
        event.resource,
        event.amount,
      );
      break;
    case "petition-opened":
      next = applyPetitionOpened(state, event);
      break;
    case "blessing-granted":
      next = applyBlessingGranted(state, event);
      break;
    case "petition-answered":
      next = applyPetitionAnswered(state, event);
      break;
    case "petition-lapsed":
      next = applyPetitionLapsed(state, event);
      break;
    case "petition-refused":
      next = applyPetitionRefused(state, event);
      break;
    case "practice-opened":
      next = applyPracticeOpened(state, event);
      break;
    case "practice-moved":
      next = applyPracticeMoved(state, event);
      break;
    case "practice-ended":
      next = applyPracticeEnded(state, event);
      break;
    case "practice-progressed":
      next = applyPracticeProgressed(state, event);
      break;
    case "motif-applied":
      next = applyMotifApplied(state, event);
      break;
    case "access-restored":
      next = applyAccessRestored(state, event);
      break;
    case "contest-opened":
      next = applyContestOpened(state, event);
      break;
    case "contest-closed":
      next = applyContestClosed(state, event);
      break;
    case "goal-change-refused":
    case "practice-refused":
      // Private records of a refusal: what the god's next prompt says, and no world state.
      next = state;
      break;
    default: {
      const exhaustiveCheck: never = event;
      throw new Error(
        `no reducer for event kind: ${(exhaustiveCheck as WorldEvent).kind}`,
      );
    }
  }
  // What an event leaves in a mortal's memory of causes, judged against the
  // world it happened in (a building's owner does not change with the event).
  return {
    // An act a rival can contest is noted against the world it found.
    ...noteService(
      state,
      noteConsequential(recordCauses(next, event), event),
      event,
    ),
    lastSequence: event.sequence,
  };
}

/** Applies an ordered event stream to `state`, in order. */
export function applyEvents(
  state: WorldState,
  events: readonly WorldEvent[],
): WorldState {
  return events.reduce(applyEvent, state);
}

// --- Proposal intake ---------------------------------------------------------

export interface ProposalRejection {
  readonly reason: RejectionReasonCode;
  readonly message: string;
}

export type SubmitResult =
  | { readonly ok: true; readonly proposal: Proposal }
  | { readonly ok: false; readonly rejection: ProposalRejection };

/**
 * Parses an untrusted raw payload (a fixture file, a routine's output, an
 * operator request) through packages/contracts' proposal parser. A
 * malformed payload never reaches the queue and never touches
 * `WorldState`: it is rejected here, before `runTick` runs at all.
 */
export function submitProposal(raw: unknown): SubmitResult {
  const result = parseProposal(raw);
  if (!result.ok) {
    return {
      ok: false,
      rejection: {
        reason: result.reason,
        message: result.path
          ? `${result.path}: ${result.message}`
          : result.message,
      },
    };
  }
  return { ok: true, proposal: result.value };
}

// --- Tick scheduling ----------------------------------------------------------

export interface RejectedRecord {
  readonly proposal: Proposal;
  readonly reason: RejectionReasonCode;
  readonly message: string;
  /** The events the rejected proposal still committed: its goal change (the action was refused, the declaration was not), and the private record that a practice move, or talk around an open thread, was refused. */
  readonly goalEvents: readonly WorldEvent[];
}

export interface CommittedRecord {
  readonly proposal: Proposal;
  readonly events: readonly WorldEvent[];
}

export interface TickResult {
  readonly state: WorldState;
  /**
   * The PRNG state to persist and pass into the next tick. The built-in
   * handlers (move, realm-transition, claim) draw no randomness, so this
   * is currently always identical to the `prng` passed in; the pipeline
   * threads it through so a handler that does draw randomness can consume
   * and advance it without a signature change here.
   */
  readonly prng: PrngState;
  readonly committed: readonly CommittedRecord[];
  readonly rejected: readonly RejectedRecord[];
  /** Events from this tick's automatic income and fire steps -- caused by no proposal, so they never appear in `committed`. */
  readonly environmentEvents: readonly WorldEvent[];
  /**
   * The memory and relationship events derived from this tick's primary events
   * (proposal-caused and environmental), in the order derived. They follow
   * those events in `events`, cite them, and belong to no proposal.
   */
  readonly derivedEvents: readonly WorldEvent[];
  /** Every event this tick produced, in commit order: proposal-caused, environmental, then derived -- what a caller persists (e.g. `commitTick`'s `events`). */
  readonly events: readonly WorldEvent[];
}

export interface TickOptions {
  /** Simulated milliseconds this tick advances by. Default 1000 (1 Hz, 1 wall second = 1 sim second). */
  readonly elapsedMs?: number;
  /** Marks every event this tick commits as approximate (catch-up coarse steps). Default false. */
  readonly approximate?: boolean;
}

export const DEFAULT_TICK_ELAPSED_MS = 1000;

/** Brands a deterministically-built id string; the caller already knows it is well-formed. */
function toEventId(raw: string): EventId {
  return raw as EventId;
}

function toCorrelationId(raw: string): CorrelationId {
  return raw as CorrelationId;
}

function toCausationId(raw: string): CausationId {
  return raw as CausationId;
}

function completeEvent(
  draft: WorldEventDraft,
  meta: {
    readonly tick: number;
    readonly sequence: number;
    readonly simTime: number;
    readonly correlationId: string;
    readonly causationId: string;
    readonly approximate: boolean;
  },
): WorldEvent {
  return {
    ...draft,
    schemaVersion: LATEST_EVENT_SCHEMA_VERSION,
    id: toEventId(`evt-${meta.tick}-${meta.sequence}`),
    sequence: meta.sequence,
    simTime: meta.simTime,
    tick: meta.tick,
    correlationId: toCorrelationId(meta.correlationId),
    causationId: toCausationId(meta.causationId),
    approximate: meta.approximate,
  } as WorldEvent;
}

/**
 * The memories this tick's primary events give, in the order the events
 * happened. The world is replayed from `before` (the tick's starting state)
 * one event at a time, so each event is judged against exactly who stood
 * where when it happened; `after` is the world once every primary event has
 * applied, which is where a report finds its teller's memory.
 */
function planMemories(
  before: WorldState,
  primary: readonly WorldEvent[],
  after: WorldState,
): readonly DerivedDraft[] {
  const drafts: DerivedDraft[] = [];
  let running = before;
  for (const event of primary) {
    drafts.push(...witnessMemories(running, event));
    // The parties to a thread remember how it ended, though no one stood at it.
    drafts.push(...endingMemories(running, event));
    // A report gives its listener a belief; a legend gives each hearer one.
    const tellings =
      event.kind === "report-told"
        ? [reportTelling(event)]
        : event.kind === "legend-recorded"
          ? legendTellings(event)
          : [];
    for (const telling of tellings) {
      const belief = toldMemory(after, telling);
      if (belief) drafts.push(belief);
    }
    running = applyEvent(running, event);
  }
  return drafts;
}

/** A building's per-tick service revenue while operational, from `rules.economyBalance.incomePerTick`; 0 when unset, in which case no income event is drafted at all. */
function incomePerTickOf(state: WorldState): number {
  return state.rules.economyBalance.incomePerTick ?? 0;
}

/** Every operational, owned building that offers a service earns its owner one income-earned draft this tick -- a declared currency source, distinct from a trade. Revenue is for services: a woodshed that sells nothing earns nothing. */
function planIncomeStep(state: WorldState): readonly WorldEventDraft[] {
  const amount = incomePerTickOf(state);
  if (amount <= 0) return [];
  const drafts: WorldEventDraft[] = [];
  for (const building of state.buildings.values()) {
    if (
      building.status !== "operational" ||
      building.owner === undefined ||
      building.services.length === 0
    ) {
      continue;
    }
    drafts.push({
      kind: "income-earned",
      entityId: building.owner,
      buildingId: building.id,
      amount,
    });
  }
  return drafts;
}

/**
 * Runs one tick: advances the clock, then revalidates and commits `queue`
 * sequentially against the state as committed so far within this tick, so
 * a later proposal observes an earlier one's effects. A rejection never
 * touches `state`; only a successful commit's events are applied. After
 * the queue drains, two automatic environmental steps run once each --
 * income (every operational, owned building earns its owner revenue) and
 * fire (every burning building advances, and may spread to a combustible
 * neighbor via the persisted PRNG) -- neither proposed by anything, both
 * fully deterministic and replayable through the same event log.
 *
 * An actor that already committed a non-claim proposal earlier in this
 * same tick is rejected as `busy-actor` for any further non-claim proposal
 * in the same tick -- claims never commit and are exempt, since they never
 * hold a resource.
 */
export function runTick(
  state: WorldState,
  prng: PrngState,
  queue: readonly Proposal[],
  options: TickOptions = {},
): TickResult {
  const elapsedMs = options.elapsedMs ?? DEFAULT_TICK_ELAPSED_MS;
  const approximate = options.approximate ?? false;

  let working: WorldState = {
    ...state,
    tick: state.tick + 1,
    simTime: state.simTime + elapsedMs,
  };

  const committed: CommittedRecord[] = [];
  const rejected: RejectedRecord[] = [];
  const committedActorsThisTick = new Set<EntityId>();
  // Sequence numbers are global and contiguous across the whole world's
  // history, not per tick (packages/persistence's `commitTick` requires
  // this). Seed from `working.lastSequence`, which starts this tick equal
  // to whatever the last committed tick (or a restored state) left it at.
  let sequence = working.lastSequence;

  const completePrimary = (draft: WorldEventDraft, observationId: string) => {
    sequence += 1;
    // Correlation and causation both trace back to the observation that
    // caused the proposal: every event this proposal produces shares one
    // correlation id rooted at its cause.
    return completeEvent(draft, {
      tick: working.tick,
      sequence,
      simTime: working.simTime,
      correlationId: observationId,
      causationId: observationId,
      approximate,
    });
  };

  /**
   * The goal events of `proposal`'s goal change, committed whatever becomes of
   * its action: the world records a goal and never judges it, so a target that
   * moved during inference cannot erase a god's intent. They belong to no
   * action slot.
   */
  const commitGoalEvents = (proposal: Proposal): WorldEvent[] => {
    if (proposal.goal === undefined) return [];
    const events = planGoalEvents(working, proposal.actor, proposal.goal).map(
      (draft) => {
        const completed = completePrimary(
          draft,
          String(proposal.observationId),
        );
        working = applyEvent(working, completed);
        return completed;
      },
    );
    return events;
  };

  /**
   * The events a rejected proposal still commits: its goal change, and, for a
   * practice move (or talk the world judged to circle an open thread), a
   * private record that it was refused and why, which the god's next prompt
   * reads. The record belongs to no action slot, like a goal event.
   */
  const commitRefusalEvents = (
    proposal: Proposal,
    reason: RejectionReasonCode,
    message: string,
    thread: EventId | undefined,
  ): WorldEvent[] => {
    const events = commitGoalEvents(proposal);
    const attempted =
      proposal.kind === "practice"
        ? proposal.move
        : reason === "no-progress" &&
            (proposal.kind === "report" || proposal.kind === "legend")
          ? proposal.kind
          : undefined;
    if (attempted === undefined) return events;
    const concerned =
      thread ??
      (proposal.kind === "practice" &&
      proposal.move !== "demand" &&
      proposal.move !== "offer" &&
      proposal.move !== "contest"
        ? proposal.thread
        : undefined);
    const completed = completePrimary(
      {
        kind: "practice-refused",
        entityId: proposal.actor,
        attempted,
        reason,
        ...(concerned === undefined ? {} : { thread: concerned }),
        ...(reason === "no-progress"
          ? { why: message.slice(0, MAX_REFUSAL_WHY) }
          : {}),
      },
      String(proposal.observationId),
    );
    working = applyEvent(working, completed);
    return [...events, completed];
  };

  for (const proposal of queue) {
    // A claim never commits and a goal-only proposal has no action: neither
    // holds the actor's one action slot.
    const takesSlot = proposal.kind !== "claim" && proposal.kind !== "goal";
    if (takesSlot && committedActorsThisTick.has(proposal.actor)) {
      rejected.push({
        proposal,
        reason: "busy-actor",
        message: `${proposal.actor} already committed an action this tick`,
        goalEvents: commitRefusalEvents(
          proposal,
          "busy-actor",
          "already committed an action this tick",
          undefined,
        ),
      });
      continue;
    }

    const outcome = validateProposal(working, proposal);
    if (!outcome.ok) {
      rejected.push({
        proposal,
        reason: outcome.reason,
        message: outcome.message,
        goalEvents: commitRefusalEvents(
          proposal,
          outcome.reason,
          outcome.message,
          outcome.thread,
        ),
      });
      continue;
    }

    // A committed proposal is the god's next decision: a journey it was on ends first, so the log says so before what replaced it.
    const actionEvents = [
      ...planJourneyReplaced(working, proposal.actor),
      ...outcome.events,
    ].map((draft) => completePrimary(draft, String(proposal.observationId)));
    working = applyEvents(working, actionEvents);
    const events = [...actionEvents, ...commitGoalEvents(proposal)];
    committed.push({ proposal, events });
    if (takesSlot) {
      committedActorsThisTick.add(proposal.actor);
    }
  }

  const environmentCause = `tick-${working.tick}`;

  // Every journey advances one hop, after the queue: a journey a proposal just stored takes its first hop this tick, and one whose god just committed something else is already over.
  const journeyEvents: WorldEvent[] = [];
  for (const [actorId, journey] of [...working.journeys]) {
    const record = (draft: WorldEventDraft) => {
      const completed = completePrimary(draft, String(journey.eventId));
      working = applyEvent(working, completed);
      journeyEvents.push(completed);
    };
    const arrived = () =>
      working.actors.get(actorId)?.locationId === journey.destination;
    const end = { entityId: actorId, journeyEventId: journey.eventId } as const;
    if (arrived()) {
      record({ kind: "journey-ended", ...end, ending: "arrived" });
      continue;
    }
    // The hop goes through the same validators as any move; a refusal moves nothing and ends the journey, with no retry.
    const hop = planHop(working, actorId, journey);
    const outcome = hop.ok ? validateProposal(working, hop.proposal) : hop;
    if (!outcome.ok) {
      record({
        kind: "journey-ended",
        ...end,
        ending: "refused",
        reason: outcome.reason,
      });
      continue;
    }
    for (const draft of outcome.events) record(draft);
    if (arrived()) {
      record({ kind: "journey-ended", ...end, ending: "arrived" });
    }
  }

  const incomeEvents = planIncomeStep(working).map((draft) =>
    completePrimary(draft, environmentCause),
  );
  working = applyEvents(working, incomeEvents);

  const fireStep = planFireStep(working, prng);
  const fireEvents = fireStep.events.map((draft) =>
    completePrimary(draft, environmentCause),
  );
  working = applyEvents(working, fireEvents);

  // The need scan: what mortals' routines want and cannot get. It proposes
  // nothing and takes no action slot, so routines keep their one proposal.
  const needEvents = planNeedStep(working).map((draft) =>
    completePrimary(draft, environmentCause),
  );
  working = applyEvents(working, needEvents);

  // The quiet-world director: after a quiet window it causes attributed
  // trouble among mortals. It draws from the persisted PRNG after the fire
  // step's, so replays choose the same trouble.
  const directorStep = planDirectorStep(working, fireStep.prng, working.tick);
  const directorEvents = directorStep.events.map((draft) =>
    completePrimary(draft, environmentCause),
  );
  working = applyEvents(working, directorEvents);
  // The loss scan: owners standing at their own damaged buildings, and owners
  // of stolen or spoiled stock, each noticed once. Like the need scan it takes
  // no action slot, and it follows the director's step so a loss the director
  // caused this tick is noticed this tick.
  const noticeEvents = planNoticeStep(working).map((draft) =>
    completePrimary(draft, environmentCause),
  );
  working = applyEvents(working, noticeEvents);

  // Rejected proposals' goal events were committed in queue order with the
  // rest; `events` lists them with the primary events, in sequence order.
  const proposalEvents = [
    ...committed.flatMap((record) => record.events),
    ...rejected.flatMap((record) => record.goalEvents),
  ].sort((a, b) => a.sequence - b.sequence);

  // The thread judge closes the environment step: with everything this tick
  // did in, the world rules on each practice thread (performances seen,
  // deadlines passed, budgets spent, a party dead). Its rulings are primary
  // events, so the memories and feelings derived below see them this tick.
  const practiceEvents = judgePractices(
    state,
    [
      ...proposalEvents,
      ...journeyEvents,
      ...incomeEvents,
      ...fireEvents,
      ...needEvents,
      ...directorEvents,
      ...noticeEvents,
    ],
    working,
    applyEvent,
  ).map((draft) => completePrimary(draft, environmentCause));
  working = applyEvents(working, practiceEvents);

  // What the rulings do to the gods: penalties, forms, and standing from the
  // endings just recorded, and the access an earlier penalty withheld coming
  // back. Primary events too, so the same tick's memories see them.
  const consequenceEvents = [
    ...planAccessRestorations(working),
    ...planConsequences(
      working,
      practiceEvents.filter(
        (event): event is PracticeEndedEvent => event.kind === "practice-ended",
      ),
    ),
  ].map((draft) => completePrimary(draft, environmentCause));
  working = applyEvents(working, consequenceEvents);

  // The contest judge: a contest closes at the end of its last tick, or at once when its place has emptied.
  // A decision's standing changes follow as the sourced motifs, citing the closing event.
  const contestEvents = judgeContests(working).map((draft) =>
    completePrimary(draft, environmentCause),
  );
  working = applyEvents(working, contestEvents);
  const standingEvents = planContestStanding(
    working,
    contestEvents.filter(
      (event): event is ContestClosedEvent => event.kind === "contest-closed",
    ),
  ).map((draft) => completePrimary(draft, environmentCause));
  working = applyEvents(working, standingEvents);

  const environmentEvents = [
    ...journeyEvents,
    ...incomeEvents,
    ...fireEvents,
    ...needEvents,
    ...directorEvents,
    ...noticeEvents,
    ...practiceEvents,
    ...consequenceEvents,
    ...contestEvents,
    ...standingEvents,
  ];

  // Derivation phase: with the primary events numbered and applied, memories
  // and then the relationship changes they cause are derived and committed in
  // this same tick. A derived event is caused by the event it rests on and
  // shares no proposal's observation; none of them is ever a source of more.
  const derive = (drafts: readonly DerivedDraft[]) =>
    drafts.map(({ draft, cause }) => {
      sequence += 1;
      return completeEvent(draft, {
        tick: working.tick,
        sequence,
        simTime: working.simTime,
        correlationId: environmentCause,
        causationId: String(cause.id),
        approximate,
      });
    });
  // Answers first, then lapses: an answer on a petition's last tick wins over
  // its lapse. A dead petitioner's petition is closed and nothing follows it.
  const primaryEvents = [...proposalEvents, ...environmentEvents];
  const answerEvents = derive(
    judgeAnswers(state, primaryEvents, working, applyEvent).map((answer) => ({
      draft: answeredDraft(answer),
      cause: answer.answeredBy,
    })),
  );
  working = applyEvents(working, answerEvents);
  const lapseEvents = derive(
    lapsingPetitions(working).map((petition) => ({
      cause: { id: petition.id },
      draft: {
        kind: "petition-lapsed" as const,
        entityId: petition.petitioner,
        god: petition.god,
        petitionId: petition.id,
      },
    })),
  );
  working = applyEvents(working, lapseEvents);
  // A living petitioner whose petition was answered worships the god, crediting
  // its divinity and earning the favor; the answer is its cause.
  const worshipEvents = derive(
    answerEvents.flatMap((answer) =>
      answer.kind === "petition-answered" &&
      working.actors.get(answer.entityId)?.alive
        ? [
            {
              cause: answer,
              draft: answeredWorshipDraft(working, answer.entityId, answer.god),
            },
          ]
        : [],
    ),
  );
  working = applyEvents(working, worshipEvents);
  // A refusal is a primary event, the god's own act; its sign follows the answers and the lapses.
  const refusalEvents = primaryEvents.filter(
    (event) => event.kind === "petition-refused",
  );
  const signs = [...answerEvents, ...lapseEvents, ...refusalEvents].flatMap(
    (event) =>
      event.kind === "petition-answered" ||
      event.kind === "petition-lapsed" ||
      event.kind === "petition-refused"
        ? (signMemory(working, event) ?? [])
        : [],
  );
  const noticed = noticeEvents.flatMap((event) =>
    event.kind === "loss-noticed" ? (noticedMemory(working, event) ?? []) : [],
  );
  const memoryEvents = derive([
    ...planMemories(state, primaryEvents, working),
    ...signs,
    ...noticed,
  ]);
  working = applyEvents(working, memoryEvents);
  const relationshipEvents = derive(
    planRelationships(
      working,
      memoryEvents.filter((event) => event.kind === "memory-recorded"),
    ),
  );
  working = applyEvents(working, relationshipEvents);
  const derivedEvents = [
    ...answerEvents,
    ...lapseEvents,
    ...worshipEvents,
    ...memoryEvents,
    ...relationshipEvents,
  ];
  return {
    state: working,
    prng: directorStep.prng,
    committed,
    rejected,
    environmentEvents,
    derivedEvents,
    events: [...proposalEvents, ...environmentEvents, ...derivedEvents],
  };
}
