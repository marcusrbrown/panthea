// Execution-time proposal validation: a pure function over a `WorldState`
// view and a `Proposal`, returning either the draft events a commit would
// append or a typed rejection from packages/contracts' shared
// `RejectionReasonCode` vocabulary. Nothing here mutates `WorldState`;
// packages/world/src/actions.ts applies the returned drafts through
// `applyEvent` after a handler approves them.
//
// Shared, kind-agnostic checks (actor exists and is alive, every
// `expectedRevisions` entry still matches) run once in `validateProposal`
// before dispatching to a kind-specific handler, so every proposal kind
// gets them for free.

import type {
  BlessProposal,
  ClaimProposal,
  Consequence,
  ConsumeProposal,
  EntityId,
  EventId,
  GatherProposal,
  LegendProposal,
  MoveProposal,
  PrayProposal,
  ProduceProposal,
  Proposal,
  RealmTransitionProposal,
  RejectionReasonCode,
  RepairProposal,
  ReportProposal,
  ResourceAmount,
  StrikeProposal,
  TradeProposal,
  TravelProposal,
  WorshipProposal,
} from "@panthea/contracts";
import {
  evaluateTradeAcceptance,
  gatherAmountOf,
  getResourceAmount,
  NEUTRAL_DRIVES,
} from "./economy";
import { igniteThresholdOf } from "./fire";
import {
  ALTAR,
  crossesRealm,
  findEdge,
  isAdjacent,
  routeLength,
} from "./geography";
import { getMemories } from "./memory";
import {
  blessability,
  canPray,
  petitionBalanceOf,
  petitionFor,
} from "./petitions";
import { talkAroundThread, validatePractice } from "./practices";
import { REPAIR_RESOURCE, repairAmountPerTickOf, repairCostOf } from "./repair";
import {
  getActor,
  getBuilding,
  getEntityRevision,
  getLocation,
  hasCapability,
  type WorldEventDraft,
  type WorldState,
} from "./state";
import {
  DIVINE_CAPACITY_RESOURCE,
  FAVOR_EFFECT,
  favorDurationTicksOf,
  favorGatherBonusOf,
  hasActiveGatherFavor,
} from "./worship";

export interface RuleRejection {
  readonly ok: false;
  readonly reason: RejectionReasonCode;
  readonly message: string;
  /** The practice thread the refusal is about, when one is. */
  readonly thread?: EventId;
}

export interface RuleCommit {
  readonly ok: true;
  readonly events: readonly WorldEventDraft[];
}

export type RuleOutcome = RuleCommit | RuleRejection;

export function reject(
  reason: RejectionReasonCode,
  message: string,
  thread?: EventId,
): RuleRejection {
  return {
    ok: false,
    reason,
    message,
    ...(thread === undefined ? {} : { thread }),
  };
}

export function commit(events: readonly WorldEventDraft[]): RuleCommit {
  return { ok: true, events };
}

function actorLocationOf(
  state: WorldState,
  actorId: EntityId,
): EntityId | undefined {
  return getActor(state, actorId)?.locationId;
}

function handleMove(state: WorldState, proposal: MoveProposal): RuleOutcome {
  const from = actorLocationOf(state, proposal.actor);
  const destination = getLocation(state, proposal.to);
  if (from === undefined || !destination) {
    return reject("malformed", `unknown move destination: ${proposal.to}`);
  }
  if (!isAdjacent(state, from, proposal.to)) {
    return reject(
      "not-adjacent",
      `${proposal.to} is not adjacent to the actor's current location`,
    );
  }
  if (crossesRealm(state, from, proposal.to)) {
    return reject(
      "restricted-realm",
      "a plain move cannot cross realms; use a realm-transition proposal via an authored transport element",
    );
  }
  const actor = getActor(state, proposal.actor);
  if (
    !hasCapability(actor?.capabilities ?? [], destination.requiredCapability)
  ) {
    return reject(
      "restricted-realm",
      `${proposal.to} requires capability ${String(destination.requiredCapability)}`,
    );
  }
  return commit([
    { kind: "entity-moved", entityId: proposal.actor, to: proposal.to },
  ]);
}

function handleRealmTransition(
  state: WorldState,
  proposal: RealmTransitionProposal,
): RuleOutcome {
  const from = actorLocationOf(state, proposal.actor);
  if (from === undefined) {
    return reject("malformed", "actor has no known current location");
  }
  if (from !== proposal.via) {
    return reject(
      "not-adjacent",
      `actor must be at the transport element ${proposal.via} to use it`,
    );
  }
  const destination = getLocation(state, proposal.to);
  if (!destination) {
    return reject(
      "malformed",
      `unknown realm-transition destination: ${proposal.to}`,
    );
  }
  const edge = findEdge(state, proposal.via, proposal.to);
  if (!edge) {
    return reject(
      "not-adjacent",
      `no transport edge from ${proposal.via} to ${proposal.to}`,
    );
  }
  if (edge.transport === "path") {
    return reject(
      "restricted-realm",
      `${proposal.via} -> ${proposal.to} is a plain path, not an authored transport element; realm transitions require a non-path transport`,
    );
  }
  const actor = getActor(state, proposal.actor);
  if (
    !hasCapability(actor?.capabilities ?? [], destination.requiredCapability)
  ) {
    return reject(
      "restricted-realm",
      `${proposal.to} requires capability ${String(destination.requiredCapability)}`,
    );
  }
  return commit([
    {
      kind: "realm-transitioned",
      entityId: proposal.actor,
      to: proposal.to,
      via: proposal.via,
    },
  ]);
}

/**
 * A journey is worth declaring only toward a known place the actor is not at
 * and can reach: a route over the map's edges that enters no place whose
 * capability the actor lacks. Whether each hop is then allowed (an authored
 * crossing, a place still open) is judged by the tick as it walks.
 */
function handleTravel(
  state: WorldState,
  proposal: TravelProposal,
): RuleOutcome {
  const actor = getActor(state, proposal.actor);
  if (actor === undefined || !getLocation(state, proposal.to)) {
    return reject("malformed", `unknown travel destination: ${proposal.to}`);
  }
  if (actor.locationId === proposal.to) {
    return reject("malformed", `the actor is already at ${proposal.to}`);
  }
  if (
    routeLength(state, actor.locationId, proposal.to, actor.capabilities) ===
    undefined
  ) {
    return reject(
      "not-adjacent",
      `no route from the actor's place to ${proposal.to}`,
    );
  }
  return commit([
    { kind: "journey-started", entityId: proposal.actor, to: proposal.to },
  ]);
}

/**
 * A claim never commits world state: it is an assertion for the
 * worship/legend system to record as a rumor, optionally later linked to
 * a verified event -- never itself a way to acquire ownership or any
 * other authority, regardless of whether the assertion happens to be
 * true.
 */
function handleClaim(
  _state: WorldState,
  _proposal: ClaimProposal,
): RuleOutcome {
  return reject(
    "unauthorized-claim",
    "a claim is an assertion, not a committable action; record it as a legend instead",
  );
}

/**
 * Commits only when the proposal names the actor's own authored gather
 * resource; an actor with no authored gather resource, or naming a
 * different one, is rejected. The committed amount is always the
 * authoritative rule's yield (`economyBalance.gatherAmount`, plus the
 * favor bonus when active) -- `proposal.amount` is never read.
 */
function handleGather(
  state: WorldState,
  proposal: GatherProposal,
): RuleOutcome {
  const actor = getActor(state, proposal.actor);
  if (!actor) {
    return reject("malformed", "actor has no known inventory");
  }
  if (actor.gathers !== proposal.resource) {
    return reject(
      "malformed",
      `actor is not authored to gather ${proposal.resource}`,
    );
  }
  const bonus = hasActiveGatherFavor(actor, state.tick)
    ? favorGatherBonusOf(state)
    : 0;
  return commit([
    {
      kind: "resource-gathered",
      entityId: proposal.actor,
      resource: proposal.resource,
      amount: gatherAmountOf(state.rules) + bonus,
    },
  ]);
}

function handleProduce(
  state: WorldState,
  proposal: ProduceProposal,
): RuleOutcome {
  const recipe = state.recipes[proposal.output];
  if (!recipe) {
    return reject("malformed", `no recipe produces ${proposal.output}`);
  }
  const actor = getActor(state, proposal.actor);
  if (!actor) {
    return reject("malformed", "actor has no known inventory");
  }
  for (const input of recipe.inputs) {
    const needed = input.amount * proposal.quantity;
    if (getResourceAmount(actor.inventory, input.resource) < needed) {
      return reject(
        "insufficient-resources",
        `actor lacks ${needed} ${input.resource} to produce ${proposal.quantity} ${proposal.output}`,
      );
    }
  }
  return commit([
    {
      kind: "resource-produced",
      entityId: proposal.actor,
      output: proposal.output,
      quantity: proposal.quantity,
    },
  ]);
}

function handleConsume(
  state: WorldState,
  proposal: ConsumeProposal,
): RuleOutcome {
  const actor = getActor(state, proposal.actor);
  if (!actor) {
    return reject("malformed", "actor has no known inventory");
  }
  if (getResourceAmount(actor.inventory, proposal.resource) < proposal.amount) {
    return reject(
      "insufficient-resources",
      `actor lacks ${proposal.amount} ${proposal.resource} to consume`,
    );
  }
  return commit([
    {
      kind: "resource-consumed",
      entityId: proposal.actor,
      resource: proposal.resource,
      amount: proposal.amount,
    },
  ]);
}

/** Sums repeated entries for the same resource into one total per resource. */
function aggregateByResource(
  items: readonly ResourceAmount[],
): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.resource, (totals.get(item.resource) ?? 0) + item.amount);
  }
  return totals;
}

/**
 * Pure NPC-to-NPC trade: both parties must be at the same location and
 * must actually hold the aggregate they give or receive, once repeated
 * lines for the same resource are summed. The counterparty's acceptance
 * is a deterministic rule over its own committed drives and inventory
 * (`evaluateTradeAcceptance`), evaluated fresh here -- never against a
 * proposal-declared value.
 */
function handleTrade(state: WorldState, proposal: TradeProposal): RuleOutcome {
  if (proposal.actor === proposal.counterparty) {
    return reject("malformed", "an actor cannot trade with itself");
  }
  const actor = getActor(state, proposal.actor);
  if (!actor) {
    return reject("malformed", "actor has no known inventory");
  }
  const counterparty = getActor(state, proposal.counterparty);
  if (!counterparty?.alive) {
    return reject(
      "dead-actor",
      `counterparty ${proposal.counterparty} is not a living, known actor`,
    );
  }
  if (actor.locationId !== counterparty.locationId) {
    return reject(
      "not-adjacent",
      "a trade requires both parties to be at the same location",
    );
  }
  for (const [resource, amount] of aggregateByResource(proposal.give)) {
    if (getResourceAmount(actor.inventory, resource) < amount) {
      return reject(
        "insufficient-resources",
        `actor lacks ${amount} ${resource} to give`,
      );
    }
  }
  for (const [resource, amount] of aggregateByResource(proposal.receive)) {
    if (getResourceAmount(counterparty.inventory, resource) < amount) {
      return reject(
        "insufficient-resources",
        `counterparty lacks ${amount} ${resource}`,
      );
    }
  }
  if (
    !evaluateTradeAcceptance(
      state.rules,
      counterparty.drives ?? NEUTRAL_DRIVES,
      proposal.give,
      proposal.receive,
    )
  ) {
    return reject(
      "counterparty-declined",
      "the counterparty declines this trade under its own acceptance rule",
    );
  }
  return commit([
    {
      kind: "resource-traded",
      entityId: proposal.actor,
      counterpartyId: proposal.counterparty,
      give: proposal.give,
      receive: proposal.receive,
    },
  ]);
}

function handleStrike(
  state: WorldState,
  proposal: StrikeProposal,
): RuleOutcome {
  const actor = getActor(state, proposal.actor);
  if (!actor) {
    return reject("malformed", "actor has no known inventory");
  }
  if (!actor.isDeity) {
    return reject("unauthorized-claim", "only a deity may strike");
  }
  const available = getResourceAmount(
    actor.inventory,
    DIVINE_CAPACITY_RESOURCE,
  );
  if (available < proposal.power) {
    return reject(
      "insufficient-power",
      `actor lacks ${proposal.power} divine power to strike`,
    );
  }
  const target = getBuilding(state, proposal.target);
  if (!target) {
    return reject("malformed", `unknown strike target: ${proposal.target}`);
  }
  if (
    target.status === "burning" ||
    target.status === "destroyed" ||
    target.status === "repairing"
  ) {
    return reject(
      "malformed",
      `${target.id} cannot be struck while ${target.status}`,
    );
  }
  const events: WorldEventDraft[] = [
    {
      kind: "resource-consumed",
      entityId: proposal.actor,
      resource: DIVINE_CAPACITY_RESOURCE,
      amount: proposal.power,
    },
  ];
  if (target.combustible && proposal.power >= igniteThresholdOf(state)) {
    events.push({
      kind: "building-ignited",
      entityId: target.id,
      cause: { kind: "strike", actor: proposal.actor },
    });
  } else {
    events.push({
      kind: "building-damaged",
      entityId: target.id,
      amount: proposal.power,
      actor: proposal.actor,
    });
  }
  return commit(events);
}

function handleRepair(
  state: WorldState,
  proposal: RepairProposal,
): RuleOutcome {
  const actor = getActor(state, proposal.actor);
  if (!actor) {
    return reject("malformed", "actor has no known inventory");
  }
  const building = getBuilding(state, proposal.structure);
  if (!building) {
    return reject("malformed", `unknown repair target: ${proposal.structure}`);
  }
  if (
    building.status !== "damaged" &&
    building.status !== "destroyed" &&
    building.status !== "repairing"
  ) {
    return reject(
      "malformed",
      `${proposal.structure} is not in need of repair`,
    );
  }
  const amount = repairAmountPerTickOf(state);
  if (getResourceAmount(actor.inventory, REPAIR_RESOURCE) < amount) {
    return reject(
      "insufficient-resources",
      `actor lacks ${amount} ${REPAIR_RESOURCE} to repair`,
    );
  }
  const events: WorldEventDraft[] = [
    {
      kind: "repair-progressed",
      entityId: proposal.actor,
      structureId: proposal.structure,
      resource: REPAIR_RESOURCE,
      amount,
    },
  ];
  const projectedProgress = (building.repairProgress ?? 0) + amount;
  if (projectedProgress >= repairCostOf(state)) {
    events.push({ kind: "building-repaired", entityId: proposal.structure });
  }
  return commit(events);
}

function handleWorship(
  state: WorldState,
  proposal: WorshipProposal,
): RuleOutcome {
  if (proposal.actor === proposal.deity) {
    return reject("unauthorized-claim", "an actor cannot worship itself");
  }
  const actor = getActor(state, proposal.actor);
  if (!actor) {
    return reject("malformed", "actor has no known inventory");
  }
  const deity = getActor(state, proposal.deity);
  if (!deity?.isDeity) {
    return reject(
      "unauthorized-claim",
      `${proposal.deity} is not an authored deity`,
    );
  }
  if (
    proposal.offering &&
    getResourceAmount(actor.inventory, proposal.offering.resource) <
      proposal.offering.amount
  ) {
    return reject(
      "insufficient-resources",
      `actor lacks the offered ${proposal.offering.resource}`,
    );
  }
  return commit([
    {
      kind: "worship-performed",
      entityId: proposal.actor,
      deity: proposal.deity,
      ...(proposal.offering ? { offering: proposal.offering } : {}),
      favorEffect: FAVOR_EFFECT,
      favorExpiresAtTick: state.tick + favorDurationTicksOf(state),
    },
  ]);
}

/**
 * A legend commits regardless of whether its assertion is true -- it
 * records that someone told the story, never that the story is fact. A cited
 * event is carried along as the narrator's evidence link, not judged: the
 * world does not decide whether it supports the prose. The legend's identity
 * comes from the event that records it (see `applyEvent`), so two tellings
 * from one unchanged observation stay distinct.
 */
function handleLegend(
  state: WorldState,
  proposal: LegendProposal,
): RuleOutcome {
  const claim = proposal.claim;
  if (claim !== undefined && !claimIdsExist(state, claim)) {
    return reject("malformed", CLAIM_IDS_MESSAGE);
  }
  const narrator = getActor(state, proposal.actor);
  // A legend is told aloud to everyone present at the narrator's place when it
  // commits: the living actors there, minus the narrator. The audience is fixed
  // here and recorded on the event, so who arrives later never hears it.
  const hearers = [...state.actors.values()]
    .filter(
      (actor) =>
        actor.alive &&
        actor.id !== proposal.actor &&
        actor.locationId === narrator?.locationId,
    )
    .map((actor) => actor.id)
    .sort();
  const circling = talkAroundThread(
    state,
    proposal.actor,
    hearers,
    claim,
    proposal.linkedEventId,
  );
  if (circling !== undefined) {
    return reject(circling.reason, circling.message, circling.thread);
  }
  return commit([
    {
      kind: "legend-recorded",
      entityId: proposal.actor,
      assertion: proposal.assertion,
      ...(proposal.linkedEventId
        ? { linkedEventId: proposal.linkedEventId }
        : {}),
      ...(claim === undefined ? {} : { claim }),
      hearers,
    },
  ]);
}

/**
 * A report commits when the teller could really say it: the listener is a
 * living actor at the teller's own place, and any event the teller cites is
 * one it witnessed. The content and the claim are never judged, since they may
 * be wrong (a claim's shape and that the ids it names exist are all that is
 * checked); a citation is judged, since it is a claim to have been there. Only first-hand
 * memory backs one, so a rumor stops at one hop: someone who was only told may
 * retell the story, but not cite the event as their own evidence.
 */
const CLAIM_IDS_MESSAGE =
  "a claim must name an actor as its agent and an actor or building as its target";

/** Whether the ids a claim names exist: an actor as its agent, an actor or building as its target. Its truth is never judged. */
function claimIdsExist(state: WorldState, claim: Consequence): boolean {
  return (
    getActor(state, claim.agent) !== undefined &&
    (claim.target === undefined ||
      getActor(state, claim.target) !== undefined ||
      getBuilding(state, claim.target) !== undefined)
  );
}

/**
 * A mortal prays at the altar about a cause it remembers. The rules open the
 * petition: they check the mortal could pray (a living mortal, at the altar,
 * not in its cooldown), that the cause is one it can still pray about and has
 * not, and then choose the request and route the prayer.
 */
function handlePray(state: WorldState, proposal: PrayProposal): RuleOutcome {
  const actor = getActor(state, proposal.actor);
  if (!canPray(actor)) {
    return reject("unauthorized-claim", "only a living mortal may pray");
  }
  if (actor.locationId !== ALTAR) {
    return reject("not-adjacent", "a prayer is made at the altar");
  }
  const petition = petitionFor(state, proposal.actor, proposal.cause);
  if (petition === undefined) {
    return reject(
      "malformed",
      `${proposal.cause} is not a cause this mortal can pray about now`,
    );
  }
  return commit([
    {
      kind: "petition-opened",
      entityId: proposal.actor,
      god: petition.god,
      cause: proposal.cause,
      request: petition.request,
    },
  ]);
}

/**
 * A god blesses the mortal behind one petition addressed to it: it must be a
 * living deity standing with a living petitioner, hold the divinity the bless
 * costs, and name an open help petition inside its window. The grant is what
 * that petition asks for and nothing more.
 */
function handleBless(state: WorldState, proposal: BlessProposal): RuleOutcome {
  const god = getActor(state, proposal.actor);
  if (!god?.isDeity) {
    return reject("unauthorized-claim", "only a deity may bless");
  }
  const blessable = blessability(state, proposal.petition, proposal.actor);
  if (!blessable.ok) return reject("malformed", blessable.message);
  const { petition, blessing } = blessable;
  const petitioner = getActor(state, petition.petitioner);
  if (!petitioner?.alive) {
    return reject("dead-actor", "the petitioner is no longer living");
  }
  if (petitioner.locationId !== god.locationId) {
    return reject("not-adjacent", "a god blesses only a mortal it stands with");
  }
  const cost = petitionBalanceOf(state.rules, "blessDivinityCost");
  if (getResourceAmount(god.inventory, DIVINE_CAPACITY_RESOURCE) < cost) {
    return reject(
      "insufficient-power",
      `actor lacks ${cost} divinity to bless`,
    );
  }
  return commit([
    {
      kind: "resource-consumed",
      entityId: proposal.actor,
      resource: DIVINE_CAPACITY_RESOURCE,
      amount: cost,
    },
    {
      kind: "blessing-granted",
      entityId: proposal.actor,
      recipient: petition.petitioner,
      petitionId: petition.id,
      resource: blessing.resource,
      amount: blessing.amount,
      ...(blessing.building === undefined
        ? {}
        : { building: blessing.building }),
    },
  ]);
}

function handleReport(
  state: WorldState,
  proposal: ReportProposal,
): RuleOutcome {
  if (proposal.actor === proposal.listener) {
    return reject("malformed", "an actor cannot report to itself");
  }
  const teller = getActor(state, proposal.actor);
  if (!teller) {
    return reject("malformed", "actor has no known location");
  }
  const listener = getActor(state, proposal.listener);
  if (!listener?.alive) {
    return reject(
      "dead-actor",
      `listener ${proposal.listener} is not a living, known actor`,
    );
  }
  if (teller.locationId !== listener.locationId) {
    return reject(
      "not-adjacent",
      "a report requires teller and listener to be at the same location",
    );
  }
  if (
    proposal.linkedEventId !== undefined &&
    !getMemories(state, proposal.actor).some(
      (memory) =>
        memory.kind === "witnessed" &&
        memory.sourceEventId === proposal.linkedEventId,
    )
  ) {
    return reject(
      "unauthorized-claim",
      `${proposal.actor} did not witness ${proposal.linkedEventId}, so cannot cite it`,
    );
  }
  const claim = proposal.claim;
  if (claim !== undefined && !claimIdsExist(state, claim)) {
    return reject("malformed", CLAIM_IDS_MESSAGE);
  }
  const circling = talkAroundThread(
    state,
    proposal.actor,
    [proposal.listener],
    claim,
    proposal.linkedEventId,
  );
  if (circling !== undefined) {
    return reject(circling.reason, circling.message, circling.thread);
  }
  return commit([
    {
      kind: "report-told",
      entityId: proposal.actor,
      listenerId: proposal.listener,
      content: proposal.content,
      ...(claim === undefined ? {} : { claim }),
      ...(proposal.linkedEventId === undefined
        ? {}
        : { linkedEventId: proposal.linkedEventId }),
    },
  ]);
}

/**
 * Runs the shared pre-checks (actor alive, expected revisions) and then
 * the kind-specific handler.
 */
export function validateProposal(
  state: WorldState,
  proposal: Proposal,
): RuleOutcome {
  const actor = getActor(state, proposal.actor);
  if (!actor?.alive) {
    return reject(
      "dead-actor",
      `actor ${proposal.actor} is not a living, known actor`,
    );
  }

  for (const expected of proposal.expectedRevisions) {
    const current = getEntityRevision(state, expected.entityId);
    if (current === undefined || current !== expected.revision) {
      return reject(
        "stale-target",
        `expected ${expected.entityId} at revision ${expected.revision}, found ${String(current)}`,
      );
    }
  }

  switch (proposal.kind) {
    case "move":
      return handleMove(state, proposal);
    case "realm-transition":
      return handleRealmTransition(state, proposal);
    case "travel":
      return handleTravel(state, proposal);
    case "claim":
      return handleClaim(state, proposal);
    case "gather":
      return handleGather(state, proposal);
    case "produce":
      return handleProduce(state, proposal);
    case "trade":
      return handleTrade(state, proposal);
    case "consume":
      return handleConsume(state, proposal);
    case "strike":
      return handleStrike(state, proposal);
    case "repair":
      return handleRepair(state, proposal);
    case "worship":
      return handleWorship(state, proposal);
    case "legend":
      return handleLegend(state, proposal);
    case "report":
      return handleReport(state, proposal);
    case "goal":
      // A goal-only proposal has no action; its goal events are recorded by the tick.
      return commit([]);
    case "pray":
      return handlePray(state, proposal);
    case "bless":
      return handleBless(state, proposal);
    case "practice":
      return validatePractice(state, proposal);
    default: {
      const exhaustiveCheck: never = proposal;
      return reject(
        "malformed",
        `no rule for proposal kind: ${(exhaustiveCheck as Proposal).kind}`,
      );
    }
  }
}
