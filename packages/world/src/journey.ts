// A god's journey: private world state changed only by `journey-started` and
// `journey-ended` events, so replaying the log rebuilds exactly each god's
// active journey. A validated `travel` proposal stores one; every tick the
// world turns each journey's next hop into an ordinary move or
// realm-transition proposal and runs it through the same validators and
// reducers (`runTick`). No model is asked and no cost is paid for a hop, and
// the route is recomputed from where the god stands every tick, never stored.

import type {
  EntityId,
  JourneyEndedEvent,
  JourneyStartedEvent,
  ObservationId,
  Proposal,
  RejectionReasonCode,
} from "@panthea/contracts";
import { crossesRealm, nextHop } from "./geography";
import {
  type ActiveJourney,
  getActor,
  type WorldEventDraft,
  type WorldState,
} from "./state";

/** `actor`'s active journey, if it has one. */
export function getJourney(
  state: WorldState,
  actor: EntityId,
): ActiveJourney | undefined {
  return state.journeys.get(actor);
}

export function applyJourneyStarted(
  state: WorldState,
  event: JourneyStartedEvent,
): WorldState {
  const journeys = new Map(state.journeys);
  journeys.set(event.entityId, { destination: event.to, eventId: event.id });
  return { ...state, journeys };
}

export function applyJourneyEnded(
  state: WorldState,
  event: JourneyEndedEvent,
): WorldState {
  const active = state.journeys.get(event.entityId);
  // An ending names exactly the journey it ends: one for a journey that is no longer active leaves the active one alone.
  if (active === undefined || active.eventId !== event.journeyEventId) {
    return state;
  }
  const journeys = new Map(state.journeys);
  journeys.delete(event.entityId);
  return { ...state, journeys };
}

/** The ending of `actor`'s active journey because it committed another proposal: nothing when it has no journey. */
export function planJourneyReplaced(
  state: WorldState,
  actor: EntityId,
): readonly WorldEventDraft[] {
  const active = state.journeys.get(actor);
  if (active === undefined) return [];
  return [
    {
      kind: "journey-ended",
      entityId: actor,
      journeyEventId: active.eventId,
      ending: "replaced",
    },
  ];
}

/** One hop toward a destination: the proposal that takes it, or why there is none. */
export type Hop =
  | { readonly ok: true; readonly proposal: Proposal }
  | {
      readonly ok: false;
      readonly reason: RejectionReasonCode;
      readonly message: string;
    };

/**
 * The hop a journey takes now, as the move or realm-transition proposal the
 * validators judge like any other: the first step of a shortest route from
 * where the actor stands, a crossing when the step leaves its realm. No route
 * (a place on the way is closed to the actor) is a refusal of the hop, not a
 * thing to retry. The proposal is the world's own: it pins no revisions, since
 * it is made and judged in the same breath.
 */
export function planHop(
  state: WorldState,
  actorId: EntityId,
  journey: ActiveJourney,
): Hop {
  const actor = getActor(state, actorId);
  const from = actor?.locationId;
  const next =
    actor === undefined || from === undefined
      ? undefined
      : nextHop(state, from, journey.destination, actor.capabilities);
  if (from === undefined || next === undefined) {
    return {
      ok: false,
      reason: "not-adjacent",
      message: `no route from ${String(from)} to ${journey.destination}`,
    };
  }
  const base = {
    schemaVersion: 1,
    actor: actorId,
    targets: [],
    expectedRevisions: [],
    source: "routine",
    observationId: String(journey.eventId) as ObservationId,
    to: next,
  } as const;
  return {
    ok: true,
    proposal: crossesRealm(state, from, next)
      ? { ...base, kind: "realm-transition", via: from }
      : { ...base, kind: "move" },
  };
}
