// Pure graph queries over the live location state built by
// `createInitialWorldState` (state.ts). Realm identity lives on each
// location, not on the graph structure: town and wilderness locations share
// one continuous graph distinguished only by their `realm` field, while
// Olympus and the Underworld are graphs an actor can only reach through an
// authored transport edge -- there is no structural notion of "the mortal
// graph" versus "the Olympus graph" here, only edges and the realms their
// endpoints declare.

import type { EntityId, LocationEdge, Realm } from "@panthea/contracts";
import {
  getLocation,
  hasCapability,
  type LocationState,
  toEntityId,
  type WorldState,
} from "./state";

/** Where mortals pray: the altar location of the authored map. A prayer is placed here, so anyone standing here saw it. */
export const ALTAR = toEntityId("altar");

/**
 * Every edge usable from `locationId`, including the synthetic reverse of
 * any neighboring location's `bidirectional: true` edge that points back at
 * it. Authored content only needs to declare a bidirectional edge once, from
 * either endpoint.
 */
export function outgoingEdges(
  state: WorldState,
  locationId: EntityId,
): readonly LocationEdge[] {
  const here = getLocation(state, locationId);
  const declared = here?.edges ?? [];
  const reverse: LocationEdge[] = [];
  for (const [otherId, other] of state.locations) {
    if (otherId === locationId) continue;
    for (const edge of other.edges) {
      if (edge.bidirectional && edge.to === locationId) {
        reverse.push({
          to: otherId,
          transport: edge.transport,
          bidirectional: edge.bidirectional,
        });
      }
    }
  }
  return [...declared, ...reverse];
}

export function findEdge(
  state: WorldState,
  fromId: EntityId,
  toId: EntityId,
): LocationEdge | undefined {
  return outgoingEdges(state, fromId).find((edge) => edge.to === toId);
}

export function isAdjacent(
  state: WorldState,
  fromId: EntityId,
  toId: EntityId,
): boolean {
  return findEdge(state, fromId, toId) !== undefined;
}

/**
 * The first location to step to on a shortest route from `from` to `to` for a
 * traveler with `capabilities`, or `undefined` when it is already there, there
 * is no such route, or either place is unknown. A route may use any edge in
 * either direction, but not enter a place whose required capability the
 * traveler lacks. Map knowledge only: it says nothing of who or what is on the
 * way.
 */
export function nextHop(
  state: WorldState,
  from: EntityId,
  to: EntityId,
  capabilities: readonly string[],
): EntityId | undefined {
  if (from === to || !getLocation(state, from) || !getLocation(state, to)) {
    return undefined;
  }
  const first = new Map<EntityId, EntityId>();
  const queue: EntityId[] = [from];
  const seen = new Set<EntityId>([from]);
  for (let head = 0; head < queue.length; head += 1) {
    const here = queue[head] as EntityId;
    for (const edge of outgoingEdges(state, here)) {
      const next = toEntityId(edge.to);
      const there = getLocation(state, next);
      if (!there || seen.has(next)) continue;
      if (!hasCapability(capabilities, there.requiredCapability)) continue;
      seen.add(next);
      first.set(next, here === from ? next : (first.get(here) as EntityId));
      if (next === to) return first.get(next);
      queue.push(next);
    }
  }
  return undefined;
}

/** How many moves the same route takes: 0 when already there, `undefined` when there is none. */
export function routeLength(
  state: WorldState,
  from: EntityId,
  to: EntityId,
  capabilities: readonly string[],
): number | undefined {
  let length = 0;
  let here = from;
  while (here !== to) {
    const hop = nextHop(state, here, to, capabilities);
    if (hop === undefined) return undefined;
    here = hop;
    length += 1;
  }
  return length;
}

/**
 * The steps from `from` to every place a route reaches for a traveler with
 * `capabilities`, nearest first, in one pass: the same search `nextHop` makes,
 * so each length is what `routeLength` answers. `from` itself is not in it.
 */
export function routeLengths(
  state: WorldState,
  from: EntityId,
  capabilities: readonly string[],
): ReadonlyMap<EntityId, number> {
  const lengths = new Map<EntityId, number>();
  if (!getLocation(state, from)) return lengths;
  const queue: EntityId[] = [from];
  const seen = new Set<EntityId>([from]);
  for (let head = 0; head < queue.length; head += 1) {
    const here = queue[head] as EntityId;
    for (const edge of outgoingEdges(state, here)) {
      const next = toEntityId(edge.to);
      const there = getLocation(state, next);
      if (!there || seen.has(next)) continue;
      if (!hasCapability(capabilities, there.requiredCapability)) continue;
      seen.add(next);
      lengths.set(
        next,
        (here === from ? 0 : (lengths.get(here) as number)) + 1,
      );
      queue.push(next);
    }
  }
  return lengths;
}

/**
 * Why no route reaches `to` from `from` for a traveler with `capabilities`:
 * `restricted-realm` when a route exists for one holding every capability the
 * map asks for (a place on the way is closed to this traveler), otherwise
 * `not-adjacent` (no edges lead there at all).
 */
export function whyNoRoute(
  state: WorldState,
  from: EntityId,
  to: EntityId,
  capabilities: readonly string[],
): "restricted-realm" | "not-adjacent" {
  const asked = [...state.locations.values()].flatMap((place) =>
    place.requiredCapability === undefined ? [] : [place.requiredCapability],
  );
  return routeLength(state, from, to, [...capabilities, ...asked]) === undefined
    ? "not-adjacent"
    : "restricted-realm";
}

export function crossesRealm(
  state: WorldState,
  fromId: EntityId,
  toId: EntityId,
): boolean {
  const from = getLocation(state, fromId);
  const to = getLocation(state, toId);
  if (!from || !to) return false;
  return from.realm !== to.realm;
}

export function locationsInRealm(
  state: WorldState,
  realm: Realm,
): readonly LocationState[] {
  return [...state.locations.values()].filter((loc) => loc.realm === realm);
}
