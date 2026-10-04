// What an actor can perceive, as a pure function of committed state (plus a
// bounded window of recent committed events the caller already holds).
// Nothing here reads the trace, a frame, or memory; a model-driven actor
// reasons only from this snapshot, so anything absent from it is unknown to
// that actor.
//
// The rule today is co-location: an actor perceives the location it stands
// in, the living actors and the buildings there, and the events that happened
// there while it was there (an event before it arrived is not witnessed). `perceivedLocations` is the one place that rule lives. A sensing
// power (a costed divine sense reaching other locations) widens the set it
// returns; the rest of this module filters by that set and already carries a
// `locationId` on everything it reports.

import {
  type EntityId,
  type EventId,
  eventSubjects,
  type ResourceAmount,
  type WorldEvent,
} from "@panthea/contracts";
import { ALTAR, outgoingEdges } from "./geography";
import {
  type ActorState,
  type BuildingState,
  getActor,
  getBuilding,
  getLocation,
  toEntityId,
  type WorldState,
} from "./state";
import { DIVINE_CAPACITY_RESOURCE } from "./worship";

/** Most events a snapshot carries: the latest perceived ones, so a prompt stays inside the context bound. */
export const MAX_PERCEIVED_EVENTS = 8;

export interface PerceivedSelf {
  readonly id: EntityId;
  readonly revision: number;
  readonly isDeity: boolean;
  /** Everything the actor holds, by resource name. */
  readonly inventory: readonly ResourceAmount[];
  /** The `divinity` held: what a strike spends. */
  readonly divinity: number;
  /** Capabilities the world grants this actor; a restricted exit needs one. */
  readonly capabilities: readonly string[];
}

/** Another actor as seen from outside: identity, place, and revision. Its goods are not seen. */
export interface PerceivedActor {
  readonly id: EntityId;
  readonly locationId: EntityId;
  readonly revision: number;
  readonly isDeity: boolean;
}

export interface PerceivedBuilding {
  readonly id: EntityId;
  readonly locationId: EntityId;
  readonly name: string;
  readonly status: BuildingState["status"];
  readonly combustible: boolean;
  /** The owner, only when the observer perceives the owner too (itself or a co-located actor). */
  readonly owner?: EntityId;
  readonly revision: number;
}

/** A way out of the observer's location. */
export interface PerceivedExit {
  readonly to: EntityId;
  readonly name: string;
  readonly realm: string;
  readonly transport: string;
  /** The capability the destination requires; absent when it is open to all. */
  readonly requiredCapability?: string;
}

/**
 * An event as an observer knows it: what happened and to whom, never the raw
 * payload. `subjects` holds only ids the snapshot itself contains (the
 * observer, co-located actors, buildings there, its location, its exits), so
 * an event at a visible building cannot name an owner or counterparty who is
 * elsewhere. `assertion` is a legend's spoken text; a legend's own link to
 * another event is dropped, since that event may not have been perceived.
 */
export interface PerceivedEvent {
  readonly id: EventId;
  readonly kind: WorldEvent["kind"];
  readonly sequence: number;
  readonly subjects: readonly EntityId[];
  readonly assertion?: string;
}

export interface PerceptionSnapshot {
  readonly observer: EntityId;
  readonly tick: number;
  /** The last committed event sequence the snapshot was taken at; what an observation records as `stateRevision`. */
  readonly stateRevision: number;
  readonly self: PerceivedSelf;
  readonly location: {
    readonly id: EntityId;
    readonly name: string;
    readonly realm: string;
    readonly revision: number;
  };
  readonly exits: readonly PerceivedExit[];
  readonly actors: readonly PerceivedActor[];
  readonly buildings: readonly PerceivedBuilding[];
  /** Perceived events, oldest first. */
  readonly events: readonly PerceivedEvent[];
}

/**
 * The locations `actor` perceives. Co-location only: the one it stands in.
 * A sensing power would add the locations it reaches (and charge for them)
 * here.
 */
export function perceivedLocations(
  _state: WorldState,
  actor: ActorState,
): ReadonlySet<EntityId> {
  return new Set([actor.locationId]);
}

function isMove(
  event: WorldEvent,
): event is Extract<
  WorldEvent,
  { kind: "entity-moved" | "realm-transitioned" }
> {
  return event.kind === "entity-moved" || event.kind === "realm-transitioned";
}

/**
 * Where an actor was when `event` happened, from the window alone: the
 * destination of its latest move before the event; else its current place if
 * it has not moved within the window; else unknown, because the window then
 * holds only a later move and never says where the actor came from. Unknown
 * places are never perceived, so an event is not credited to a location it
 * may not have happened in.
 */
function actorLocationAt(
  state: WorldState,
  actorId: EntityId,
  event: WorldEvent,
  window: readonly WorldEvent[],
): EntityId | undefined {
  let before: EntityId | undefined;
  let beforeSequence = -1;
  let movedLater = false;
  for (const candidate of window) {
    if (!isMove(candidate) || candidate.entityId !== actorId) continue;
    if (candidate.sequence < event.sequence) {
      if (candidate.sequence > beforeSequence) {
        before = candidate.to;
        beforeSequence = candidate.sequence;
      }
    } else if (candidate.sequence > event.sequence) {
      movedLater = true;
    }
  }
  if (before !== undefined) return before;
  if (movedLater) return undefined;
  return getActor(state, actorId)?.locationId;
}

/** The location an event happened in, or `undefined` when the window and state cannot place it. */
function eventLocation(
  state: WorldState,
  event: WorldEvent,
  window: readonly WorldEvent[],
): EntityId | undefined {
  switch (event.kind) {
    // Arrivals happen where the mover arrives.
    case "entity-moved":
    case "realm-transitioned":
      return event.to;
    // Buildings do not move: they place their own events.
    case "building-damaged":
    case "building-ignited":
    case "building-burn-ticked":
    case "building-destroyed":
    case "building-repaired":
      return getBuilding(state, event.entityId)?.locationId;
    case "repair-progressed":
      return getBuilding(state, event.structureId)?.locationId;
    case "income-earned":
      return getBuilding(state, event.buildingId)?.locationId;
    // The rest are an actor doing something where it stood.
    case "resource-gathered":
    case "resource-produced":
    case "resource-consumed":
    case "resource-traded":
    case "worship-performed":
    case "legend-recorded":
    case "theft":
    case "stock-spoiled":
      return actorLocationAt(state, event.entityId, event, window);
    // A blessing is given where the blessed one stood, before whoever was there: a rival may see it. The
    // recipient is placed as any actor is, where it was when this happened; if the window cannot say, no
    // one sees it, rather than seeing it wherever the recipient walked to later.
    case "blessing-granted":
      return actorLocationAt(state, event.recipient, event, window);
    // A prayer is made at the altar, wherever else its named god is.
    case "petition-opened":
      return getLocation(state, ALTAR)?.id;
    // Private: a report is heard only by its listener, and memories and
    // feelings are inside someone's head. None happens "in" a place, so no
    // one perceives them.
    case "report-told":
    case "memory-recorded":
    case "relationship-changed":
    case "goal-set":
    case "goal-ended":
    case "journey-started":
    case "journey-ended":
    case "unmet-need":
    case "petition-answered":
    case "petition-lapsed":
    case "goal-change-refused":
    case "practice-opened":
    case "practice-moved":
    case "practice-ended":
    case "practice-progressed":
    case "motif-applied":
    case "access-restored":
      return undefined;
  }
}

/**
 * Whether `observer` was at `at` when `event` happened, so it witnessed the
 * event rather than merely standing where it once took place. The observer's
 * own arrival counts as witnessed. Otherwise this walks the observer's own
 * moves and realm transitions through the window, exactly as an actor's event
 * is placed; when the window cannot say where the observer was, the answer is
 * no. A later sensing power would exempt the locations it reaches.
 */
function wasPresent(
  state: WorldState,
  observer: EntityId,
  event: WorldEvent,
  at: EntityId,
  window: readonly WorldEvent[],
): boolean {
  if (isMove(event) && event.entityId === observer) return true;
  return actorLocationAt(state, observer, event, window) === at;
}

/**
 * Whether `observer` perceives `event`: it happened at a place the observer
 * perceives, while the observer was there. `window` is the events around it
 * that place actors (see `actorLocationAt`); `state` is the world the
 * observer is judged in. `perceive` judges the committed world against its
 * recent-events window; a tick's memory derivation judges the world just
 * before each event with no window, since it then knows exactly where
 * everyone stood. One rule, so what an actor remembers and what it once
 * perceived cannot drift apart.
 */
export function perceivesEvent(
  state: WorldState,
  observer: ActorState,
  event: WorldEvent,
  window: readonly WorldEvent[],
): boolean {
  const at = eventLocation(state, event, window);
  if (at === undefined || !perceivedLocations(state, observer).has(at)) {
    return false;
  }
  return wasPresent(state, observer.id, event, at, window);
}

function perceivedEvent(
  event: WorldEvent,
  known: ReadonlySet<EntityId>,
): PerceivedEvent {
  return {
    id: event.id,
    kind: event.kind,
    sequence: event.sequence,
    subjects: eventSubjects(event).filter((subject) => known.has(subject)),
    ...(event.kind === "legend-recorded" ? { assertion: event.assertion } : {}),
  };
}

function sortedInventory(
  inventory: ReadonlyMap<string, number>,
): readonly ResourceAmount[] {
  return [...inventory.entries()]
    .filter(([, amount]) => amount > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([resource, amount]) => ({ resource, amount }));
}

function compareIds(a: { readonly id: string }, b: { readonly id: string }) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The snapshot of what `actorId` perceives right now, or `undefined` when it
 * is unknown or dead. `recentEvents` is the bounded window of recently
 * committed events the caller holds (the world keeps no event log); events
 * outside the actor's perceived locations, or that the window cannot place,
 * are left out. Pure: same state and window, same snapshot.
 */
export function perceive(
  state: WorldState,
  actorId: EntityId,
  recentEvents: readonly WorldEvent[] = [],
): PerceptionSnapshot | undefined {
  const actor = getActor(state, actorId);
  if (!actor?.alive) return undefined;
  const here = getLocation(state, actor.locationId);
  if (!here) return undefined;

  const locations = perceivedLocations(state, actor);

  const exits: PerceivedExit[] = [];
  const seenExits = new Set<EntityId>();
  for (const edge of outgoingEdges(state, actor.locationId)) {
    const to = toEntityId(edge.to);
    const destination = getLocation(state, to);
    if (!destination || seenExits.has(to)) continue;
    seenExits.add(to);
    exits.push({
      to: destination.id,
      name: destination.name,
      realm: destination.realm,
      transport: edge.transport,
      ...(destination.requiredCapability === undefined
        ? {}
        : { requiredCapability: destination.requiredCapability }),
    });
  }
  exits.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));

  const actors: PerceivedActor[] = [];
  for (const other of state.actors.values()) {
    if (other.id === actorId || !other.alive) continue;
    if (!locations.has(other.locationId)) continue;
    actors.push({
      id: other.id,
      locationId: other.locationId,
      revision: other.revision,
      isDeity: other.isDeity === true,
    });
  }
  actors.sort(compareIds);

  const seenActors = new Set<EntityId>([
    actorId,
    ...actors.map((other) => other.id),
  ]);
  const buildings: PerceivedBuilding[] = [];
  for (const building of state.buildings.values()) {
    if (!locations.has(building.locationId)) continue;
    const owner =
      building.owner !== undefined && seenActors.has(building.owner)
        ? building.owner
        : undefined;
    buildings.push({
      id: building.id,
      locationId: building.locationId,
      name: building.name,
      status: building.status,
      combustible: building.combustible,
      ...(owner === undefined ? {} : { owner }),
      revision: building.revision,
    });
  }
  buildings.sort(compareIds);

  // Ids the snapshot contains: the only ids an event may name.
  const known = new Set<EntityId>([
    actorId,
    here.id,
    ...exits.map((exit) => exit.to),
    ...actors.map((other) => other.id),
    ...buildings.map((building) => building.id),
  ]);

  // Filter to what is perceived before capping, so remote events never
  // push older local ones out of the window.
  const events = [...recentEvents]
    .sort((a, b) => a.sequence - b.sequence)
    .filter((event) => perceivesEvent(state, actor, event, recentEvents))
    .slice(-MAX_PERCEIVED_EVENTS)
    .map((event) => perceivedEvent(event, known));

  return {
    observer: actorId,
    tick: state.tick,
    stateRevision: state.lastSequence,
    self: {
      id: actorId,
      revision: actor.revision,
      isDeity: actor.isDeity === true,
      inventory: sortedInventory(actor.inventory),
      divinity: actor.inventory.get(DIVINE_CAPACITY_RESOURCE) ?? 0,
      capabilities: actor.capabilities,
    },
    location: {
      id: here.id,
      name: here.name,
      realm: here.realm,
      revision: here.revision,
    },
    exits,
    actors,
    buildings,
    events,
  };
}
