// Scripted inhabitant routines: given the last committed state and one
// living, drive-bearing actor, decide the single proposal (if any) that
// actor submits this tick, and the observation it made to justify it. Pure
// over `WorldState`; no SQLite, no telemetry, no wall clock. The caller
// persists the returned observation.
//
// The same decision runs whether the world is on screen or not: there is
// no separate, reduced-detail offscreen path.

import {
  createObservationId,
  type EntityId,
  type GoalProposal,
  type ObservationRecord,
  type Proposal,
  type ProposalBase,
  type ResourceAmount,
  type UnmetNeedReason,
  type WorldRules,
} from "@panthea/contracts";
import {
  consumeAmountOf,
  evaluateTradeAcceptance,
  gatherAmountOf,
  getResourceAmount,
  NEUTRAL_DRIVES,
  resourceValue,
} from "./economy";
import { nextHop, routeLengths } from "./geography";
import { prayerStep } from "./petitions";
import { mortalPractice } from "./practices";
import { actorHoldsEnoughToRepair, findRepairableBuilding } from "./repair";
import { type ActorState, getActor, type WorldState } from "./state";

export interface RoutineResult {
  readonly observation: ObservationRecord;
  readonly proposal: Proposal;
  /** Set when this proposal keeps a promise whose deadline is near: the queue puts it ahead of every other routine proposal, so a tight per-tick cap overflows something else. */
  readonly urgent?: boolean;
}

/** The first other living actor at `actorId`'s location satisfying `predicate`, in `state.actors`' deterministic iteration order. */
export function findCounterparty(
  state: WorldState,
  actorId: EntityId,
  actor: ActorState,
  predicate: (candidate: ActorState) => boolean,
): EntityId | undefined {
  for (const [candidateId, candidate] of state.actors) {
    if (candidateId === actorId) continue;
    if (!candidate.alive) continue;
    if (candidate.locationId !== actor.locationId) continue;
    if (predicate(candidate)) return candidateId;
  }
  return undefined;
}

function firstSatisfiedRecipe(
  state: WorldState,
  actor: ActorState,
): string | undefined {
  for (const [output, recipe] of Object.entries(state.recipes)) {
    const satisfied = recipe.inputs.every(
      (input) =>
        getResourceAmount(actor.inventory, input.resource) >= input.amount,
    );
    if (satisfied) return output;
  }
  return undefined;
}

/** A trade a routine could make now. */
export interface Deal {
  readonly counterparty: EntityId;
  readonly give: readonly ResourceAmount[];
  readonly receive: readonly ResourceAmount[];
}

/**
 * Something a mortal's routine wants and what came of looking for it: a deal
 * it can make now, or why it cannot. The routine turns a deal into a
 * candidate; the need scan (needs.ts) turns a shortfall into an unmet-need
 * event. Both read it from here, so they never disagree about what a mortal
 * needs.
 */
export type Want =
  | { readonly resource: string; readonly deal: Deal }
  /** Nothing to trade for here, but a seller is a walk away: the first step. Not an unmet need. */
  | { readonly resource: string; readonly trip: EntityId }
  | { readonly resource: string; readonly unmet: UnmetNeedReason };

/** Ticks between one mortal's meals, from `rules.economyBalance.mealIntervalTicks`; 1 (a meal whenever food is held) when unset. */
export function mealIntervalOf(rules: WorldRules): number {
  return Math.max(1, Math.floor(rules.economyBalance.mealIntervalTicks ?? 1));
}

/**
 * Whether it is this mortal's turn to eat: one tick in every meal interval,
 * offset by the mortal's id so the town does not sit down together. Hunger
 * is occasional, so a mortal that holds food still eats only at mealtime; one
 * that misses it (a prayer, a trade) eats at the next.
 */
export function isMealtime(state: WorldState, actorId: EntityId): boolean {
  const interval = mealIntervalOf(state.rules);
  if (interval === 1) return true;
  let offset = 0;
  for (const char of actorId)
    offset = (offset * 31 + char.charCodeAt(0)) % interval;
  return (state.tick + offset) % interval === 0;
}

/** The food the mortal needs to eat: absent when it already holds enough. */
export function foodWant(
  state: WorldState,
  actorId: EntityId,
  actor: ActorState,
): Want | undefined {
  const consumeAmount = consumeAmountOf(state.rules);
  if (getResourceAmount(actor.inventory, "food") >= consumeAmount) {
    return undefined;
  }
  const askPrice = consumeAmount * resourceValue(state.rules, "food");
  if (getResourceAmount(actor.inventory, "currency") < askPrice) {
    return { resource: "food", unmet: "no-funds" };
  }
  const give = [{ resource: "currency", amount: askPrice }];
  const receive = [{ resource: "food", amount: consumeAmount }];
  const seller = findCounterparty(
    state,
    actorId,
    actor,
    (candidate) =>
      // Only a producer sells food: someone who merely holds a meal keeps it,
      // or two mortals would pass one meal back and forth.
      candidate.gathers === "food" &&
      getResourceAmount(candidate.inventory, "food") >= consumeAmount &&
      evaluateTradeAcceptance(
        state.rules,
        candidate.drives ?? NEUTRAL_DRIVES,
        give,
        receive,
      ),
  );
  if (seller !== undefined) {
    return { resource: "food", deal: { counterparty: seller, give, receive } };
  }
  // Nobody here sells. A producer who works this place restocks or comes
  // back, so the buyer waits for it and stays where its own trade is; with
  // none working here, a hungry mortal walks to the nearest producer's
  // workplace rather than failing in place every tick.
  const trip = hasProducerHere(state, actorId, actor)
    ? undefined
    : tripToFoodSeller(state, actor, give, receive);
  return trip === undefined
    ? { resource: "food", unmet: "no-seller" }
    : { resource: "food", trip };
}

/** Whether a living food producer works where `actor` stands: one standing here, or one whose home this is and who is away only to pray. */
function hasProducerHere(
  state: WorldState,
  actorId: EntityId,
  actor: ActorState,
): boolean {
  for (const [candidateId, candidate] of state.actors) {
    if (candidateId === actorId || !candidate.alive) continue;
    if (candidate.gathers !== "food") continue;
    if (
      candidate.locationId === actor.locationId ||
      candidate.home === actor.locationId
    ) {
      return true;
    }
  }
  return false;
}

/** The first step toward the nearest food producer who would sell `receive` for `give`, or `undefined` when none holds food or none can be reached. */
function tripToFoodSeller(
  state: WorldState,
  actor: ActorState,
  give: readonly ResourceAmount[],
  receive: readonly ResourceAmount[],
): EntityId | undefined {
  const lengths = routeLengths(state, actor.locationId, actor.capabilities);
  let nearest:
    | { readonly place: EntityId; readonly length: number }
    | undefined;
  for (const candidate of state.actors.values()) {
    if (!candidate.alive || candidate.gathers !== "food") continue;
    const length = lengths.get(candidate.locationId);
    if (length === undefined || (nearest && length >= nearest.length)) continue;
    const stocked = receive.every(
      (line) =>
        getResourceAmount(candidate.inventory, line.resource) >= line.amount,
    );
    if (
      stocked &&
      evaluateTradeAcceptance(
        state.rules,
        candidate.drives ?? NEUTRAL_DRIVES,
        give,
        receive,
      )
    ) {
      nearest = { place: candidate.locationId, length };
    }
  }
  return nearest === undefined
    ? undefined
    : nextHop(state, actor.locationId, nearest.place, actor.capabilities);
}

/** The one resource the mortal cannot produce or gather itself, when it holds none. */
export function wantedWant(
  state: WorldState,
  actorId: EntityId,
  actor: ActorState,
): Want | undefined {
  const wanted = actor.wants;
  if (!wanted || getResourceAmount(actor.inventory, wanted) >= 1) {
    return undefined;
  }
  const askPrice = resourceValue(state.rules, wanted);
  if (getResourceAmount(actor.inventory, "currency") < askPrice) {
    return { resource: wanted, unmet: "no-funds" };
  }
  const give = [{ resource: "currency", amount: askPrice }];
  const receive = [{ resource: wanted, amount: 1 }];
  const seller = findCounterparty(
    state,
    actorId,
    actor,
    (candidate) =>
      getResourceAmount(candidate.inventory, wanted) >= 1 &&
      evaluateTradeAcceptance(
        state.rules,
        candidate.drives ?? NEUTRAL_DRIVES,
        give,
        receive,
      ),
  );
  return seller === undefined
    ? { resource: wanted, unmet: "no-seller" }
    : { resource: wanted, deal: { counterparty: seller, give, receive } };
}

/** A gatherer's surplus it would sell: absent when it holds less than a batch. */
export function surplusWant(
  state: WorldState,
  actorId: EntityId,
  actor: ActorState,
): Want | undefined {
  const gatherAmount = gatherAmountOf(state.rules);
  const resource = actor.gathers;
  // A food producer sells to whoever comes hungry (`foodWant`), one meal at a
  // time. Pushing food onto buyers who are not hungry only drains the producer
  // the hungry depend on, and unsold food is its own meals, not a shortfall.
  if (resource === "food") return undefined;
  if (
    !resource ||
    getResourceAmount(actor.inventory, resource) < gatherAmount
  ) {
    return undefined;
  }
  const askPrice = gatherAmount * resourceValue(state.rules, resource);
  const give = [{ resource, amount: gatherAmount }];
  const receive = [{ resource: "currency", amount: askPrice }];
  const buyer = findCounterparty(
    state,
    actorId,
    actor,
    (candidate) =>
      // Someone who gathers the same thing has no use for more of it: two
      // gatherers of one good would pass it back and forth and never gather.
      candidate.gathers !== resource &&
      getResourceAmount(candidate.inventory, "currency") >= askPrice &&
      evaluateTradeAcceptance(
        state.rules,
        candidate.drives ?? NEUTRAL_DRIVES,
        give,
        receive,
      ),
  );
  return buyer === undefined
    ? { resource, unmet: "no-buyer" }
    : { resource, deal: { counterparty: buyer, give, receive } };
}

/** `Omit<T, K>`, applied separately to each member of a union `T`. */
type DistributiveOmit<T, K extends keyof T> = T extends unknown
  ? Omit<T, K>
  : never;

/** The proposal-kind-specific fields a candidate contributes; the shared envelope fields are filled in once the winning candidate is chosen. */
/** What a routine decides: any action. A routine never changes a goal, so the goal-only kind is not among them. */
type ProposalDetails = DistributiveOmit<
  Exclude<Proposal, GoalProposal>,
  keyof ProposalBase
>;

/** Utility of a meal at mealtime in a world with a meal interval: above every ordinary trade and prayer, so a busy market does not starve a mortal who holds food. Repair and answering a god (1 and up) still come first. A world with no interval keeps the older rule: eat whenever food is held, ranked by the mortal's appetite. */
const MEAL_UTILITY = 0.9;
/** Utility of praying and of walking to the altar: above idle gathering (0.1). */
const PRAYER_UTILITY = 0.15;
/** Utility of walking home after praying. */
const HOME_UTILITY = 0.2;

interface Candidate {
  readonly utility: number;
  readonly urgent?: boolean;
  readonly factsRead: readonly string[];
  build(): ProposalDetails;
}

/** The entities a candidate's proposal targets, for `Proposal.targets`. */
function deriveTargets(built: ProposalDetails): readonly EntityId[] {
  switch (built.kind) {
    case "trade":
      return [built.counterparty];
    case "repair":
      return [built.structure];
    default:
      return [];
  }
}

/**
 * Decides the one proposal `actorId` submits this tick, or `undefined` if
 * it is dead, unknown, or not routine-driven (has no authored drives).
 * Candidates are ranked by a drive-weighted utility and the highest
 * *eligible* one wins; ties keep whichever candidate is listed first below.
 */
export function decideRoutineProposal(
  state: WorldState,
  actorId: EntityId,
): RoutineResult | undefined {
  const actor = getActor(state, actorId);
  if (!actor?.alive || !actor.drives) return undefined;

  const drives = actor.drives;
  const gatherAmount = gatherAmountOf(state.rules);
  const consumeAmount = consumeAmountOf(state.rules);
  const candidates: Candidate[] = [];

  const heldFood = getResourceAmount(actor.inventory, "food");
  if (heldFood >= consumeAmount && isMealtime(state, actorId)) {
    candidates.push({
      utility: mealIntervalOf(state.rules) > 1 ? MEAL_UTILITY : drives.appetite,
      factsRead: [`actor:${actorId}.inventory`],
      build: () => ({
        kind: "consume",
        resource: "food",
        amount: consumeAmount,
      }),
    });
  }

  const food = foodWant(state, actorId, actor);
  if (food && "deal" in food) {
    const { counterparty: seller, give, receive } = food.deal;
    candidates.push({
      utility: drives.appetite,
      factsRead: [`actor:${actorId}.inventory`, `actor:${seller}.inventory`],
      build: () => ({ kind: "trade", counterparty: seller, give, receive }),
    });
  }

  if (food && "trip" in food) {
    const step = food.trip;
    candidates.push({
      utility: drives.appetite,
      factsRead: [`actor:${actorId}.location`, `actor:${actorId}.inventory`],
      build: () => ({ kind: "move", to: step }),
    });
  }

  const surplus = surplusWant(state, actorId, actor);
  if (surplus && "deal" in surplus) {
    const { counterparty: buyer, give, receive } = surplus.deal;
    candidates.push({
      utility: drives.greed * 0.6 + drives.thrift * 0.4,
      factsRead: [`actor:${actorId}.inventory`, `actor:${buyer}.inventory`],
      build: () => ({ kind: "trade", counterparty: buyer, give, receive }),
    });
  }

  // Sell surplus of a recipe's output (currently the only produced good is
  // planks): symmetric to selling a gathered surplus, but keyed by what a
  // recipe actually put in this actor's hands rather than what it gathers.
  for (const recipe of Object.values(state.recipes)) {
    // Only someone who works the recipe's inputs sells what it makes; a buyer
    // who merely holds the output keeps it, or two traders would pass it back
    // and forth forever.
    const works = recipe.inputs.some(
      (input) =>
        input.resource === actor.gathers || input.resource === actor.wants,
    );
    if (!works) continue;
    for (const output of recipe.outputs) {
      const held = getResourceAmount(actor.inventory, output.resource);
      if (held < 1) continue;
      const askPrice = resourceValue(state.rules, output.resource);
      const give = [{ resource: output.resource, amount: 1 }];
      const receive = [{ resource: "currency", amount: askPrice }];
      const buyer = findCounterparty(
        state,
        actorId,
        actor,
        (candidate) =>
          getResourceAmount(candidate.inventory, "currency") >= askPrice &&
          evaluateTradeAcceptance(
            state.rules,
            candidate.drives ?? NEUTRAL_DRIVES,
            give,
            receive,
          ),
      );
      if (buyer) {
        candidates.push({
          utility: drives.thrift * 0.5,
          factsRead: [`actor:${actorId}.inventory`, `actor:${buyer}.inventory`],
          build: () => ({ kind: "trade", counterparty: buyer, give, receive }),
        });
      }
    }
  }

  // Buy a wanted resource this actor cannot produce or gather itself.
  const wanted = wantedWant(state, actorId, actor);
  if (wanted && "deal" in wanted) {
    const { counterparty: seller, give, receive } = wanted.deal;
    candidates.push({
      utility: drives.thrift * 0.3,
      factsRead: [`actor:${actorId}.inventory`, `actor:${seller}.inventory`],
      build: () => ({ kind: "trade", counterparty: seller, give, receive }),
    });
  }

  const recipeOutput = firstSatisfiedRecipe(state, actor);
  if (recipeOutput) {
    candidates.push({
      utility: drives.thrift,
      factsRead: [`actor:${actorId}.inventory`, `recipe:${recipeOutput}`],
      build: () => ({ kind: "produce", output: recipeOutput, quantity: 1 }),
    });
  }

  // Repair a destroyed or mid-repair building this actor owns, once it
  // holds enough materials -- urgent enough to outrank any ordinary trade
  // or production choice below.
  const repairable = findRepairableBuilding(state, actorId);
  if (repairable && actorHoldsEnoughToRepair(state, actorId)) {
    const structureId = repairable.id;
    candidates.push({
      utility: 1 + drives.thrift,
      factsRead: [
        `actor:${actorId}.inventory`,
        `building:${structureId}.status`,
      ],
      build: () => ({ kind: "repair", structure: structureId }),
    });
  }

  // The terms a god set on this mortal's prayer. Answering an offer is a
  // one-tick decision that outranks ordinary choices (repair's rank, 1); the
  // offering it promised is done promptly once the boon is in hand, and when its
  // deadline is near it outranks everything and is flagged urgent for the queue.
  const practice = mortalPractice(state, actorId);
  if (practice?.kind === "answer") {
    candidates.push({
      utility: 1,
      factsRead: [`actor:${actorId}.inventory`, `thread:${practice.thread}`],
      build: () => ({
        kind: "practice",
        move: practice.move,
        thread: practice.thread,
      }),
    });
  } else if (practice?.kind === "offer") {
    candidates.push({
      utility: practice.urgent ? 3 : 0.5,
      urgent: practice.urgent,
      factsRead: [`actor:${actorId}.inventory`, `thread:${practice.thread}`],
      build: () => ({
        kind: "worship",
        deity: practice.deity,
        offering: { resource: practice.resource, amount: practice.amount },
      }),
    });
  }

  // Prayer and the walks to and from the altar rank below repair, production,
  // and the usual trades, and above idle gathering: a mortal prays when it has
  // nothing better to do, and walks home once it has.
  const prayer = prayerStep(state, actorId);
  if (prayer?.kind === "pray") {
    candidates.push({
      utility: PRAYER_UTILITY,
      factsRead: [`actor:${actorId}.location`, `event:${prayer.cause}`],
      build: () => ({ kind: "pray", cause: prayer.cause }),
    });
  } else if (prayer?.kind === "walk") {
    candidates.push({
      utility: prayer.purpose === "home" ? HOME_UTILITY : PRAYER_UTILITY,
      factsRead: [`actor:${actorId}.location`],
      build: () => ({ kind: "move", to: prayer.to }),
    });
  }

  if (actor.gathers) {
    const resource = actor.gathers;
    candidates.push({
      utility: 0.1,
      factsRead: [`actor:${actorId}.inventory`],
      build: () => ({ kind: "gather", resource, amount: gatherAmount }),
    });
  }

  if (candidates.length === 0) return undefined;

  const chosen = candidates.reduce((best, candidate) =>
    candidate.utility > best.utility ? candidate : best,
  );

  const observation: ObservationRecord = {
    schemaVersion: 1,
    id: createObservationId(),
    observer: actorId,
    stateRevision: state.lastSequence,
    factsRead: chosen.factsRead,
    source: "routine",
  };

  const built = chosen.build();
  const proposal: Proposal = {
    schemaVersion: 1,
    actor: actorId,
    targets: deriveTargets(built),
    expectedRevisions: [],
    source: "routine",
    observationId: observation.id,
    ...built,
  };

  return {
    observation,
    proposal,
    ...(chosen.urgent === true ? { urgent: true } : {}),
  };
}
