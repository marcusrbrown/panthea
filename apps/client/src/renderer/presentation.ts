import type { Realm, RecentEvent } from "@panthea/contracts";
import type { ReceiptEmitter } from "../receipts";
import type { ViewLocation, WorldViewModel } from "../store";

export type EffectTone = "fire" | "worship" | "neutral";

/**
 * The event kinds the scene draws an effect for, and the tone of that
 * effect. A kind absent from the map is not drawn or receipted: per-tick
 * upkeep such as burn ticks, repair progress, income, movement, and
 * resource flow would only add noise.
 */
const EFFECT_TONES: Partial<Record<RecentEvent["kind"], EffectTone>> = {
  "building-damaged": "fire",
  "building-ignited": "fire",
  "building-destroyed": "fire",
  "worship-performed": "worship",
  "resource-traded": "neutral",
  "building-repaired": "neutral",
};

export interface PlacedEvent {
  readonly event: RecentEvent;
  readonly tone: EffectTone;
  /** The location in the viewed realm the effect is drawn at. */
  readonly locationId: string;
  /** The first subject that is a building in the viewed realm; absent when none is. */
  readonly buildingId?: string;
}

function subjectLocations(
  view: WorldViewModel,
  realm: Realm,
): ReadonlyMap<string, string> {
  const subjectLocation = new Map<string, string>();
  for (const location of view.realms[realm]) {
    subjectLocation.set(location.id, location.id);
    for (const actor of location.actors) {
      subjectLocation.set(actor.id, location.id);
    }
    for (const building of location.buildings) {
      subjectLocation.set(building.id, location.id);
    }
  }
  return subjectLocation;
}

function realmBuildings(
  view: WorldViewModel,
  realm: Realm,
): ReadonlySet<string> {
  return new Set(
    view.realms[realm].flatMap((location) =>
      location.buildings.map((building) => building.id),
    ),
  );
}

export function eventsInRealm(
  view: WorldViewModel,
  realm: Realm,
): readonly RecentEvent[] {
  const locationsBySubject = subjectLocations(view, realm);
  return view.recentEvents.filter((event) =>
    event.subjects.some((subject) => locationsBySubject.has(subject)),
  );
}

/**
 * The drawable recent events that concern the viewed realm, each placed at
 * the location of its first subject that resolves there. A subject resolves
 * when it is a location in the realm, or an actor or building standing at
 * one. An event with no resolving subject is not drawn. An event that has a
 * building in the viewed realm among its subjects names it, wherever it is
 * placed.
 */
export function placeEvents(
  view: WorldViewModel,
  realm: Realm,
): readonly PlacedEvent[] {
  const subjectLocation = subjectLocations(view, realm);
  const buildings = realmBuildings(view, realm);

  const placed: PlacedEvent[] = [];
  for (const event of view.recentEvents) {
    const tone = EFFECT_TONES[event.kind];
    if (tone === undefined) continue;
    for (const subject of event.subjects) {
      const locationId = subjectLocation.get(subject);
      if (locationId !== undefined) {
        const buildingId = event.subjects.find((candidate) =>
          buildings.has(candidate),
        );
        placed.push({
          event,
          tone,
          locationId,
          ...(buildingId === undefined ? {} : { buildingId }),
        });
        break;
      }
    }
  }
  return placed;
}

export function drawableEvents(
  view: WorldViewModel,
  realm: Realm,
): readonly RecentEvent[] {
  return placeEvents(view, realm).map((placed) => placed.event);
}

export async function receiptDrawnEvents(
  sessionId: string,
  events: readonly Pick<RecentEvent, "id">[],
  emitter: ReceiptEmitter,
): Promise<void> {
  await Promise.all(
    events.map((event) => emitter.present(sessionId, event.id)),
  );
}

/**
 * Every path between two locations of one realm, exactly once, as an
 * unordered pair (lexically ordered for stability). A path counts however
 * it was declared -- from either end, or both. An edge whose target is not
 * among `locations`, such as one that crosses realms, and an edge from a
 * location to itself are not paths.
 */
export function realmPaths(
  locations: readonly ViewLocation[],
): readonly [string, string][] {
  const inRealm = new Set(locations.map((location) => location.id));
  const seen = new Set<string>();
  const paths: [string, string][] = [];
  for (const location of locations) {
    for (const edge of location.edges) {
      if (edge.to === location.id || !inRealm.has(edge.to)) continue;
      const [a, b] =
        location.id < edge.to ? [location.id, edge.to] : [edge.to, location.id];
      const key = `${a}\u0000${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      paths.push([a, b]);
    }
  }
  return paths;
}
