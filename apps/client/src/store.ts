// The client's copy of the world: the latest committed frame and its
// decoded state, replaced whole by every frame -- there is no merging and
// no incremental patching. `toViewModel` turns a frame into plain data a
// renderer or panel reads; it never decides anything about the world.

import {
  type CatchUpSummary,
  type DegradedReason,
  REALMS,
  type Realm,
  type RecentEvent,
  type SyncFrame,
  type WorldStatus,
} from "@panthea/contracts";
import type {
  ActorState,
  BuildingState,
  BuildingStatus,
  LocationState,
  WorldState,
} from "@panthea/world";

export interface ViewInventoryLine {
  readonly resource: string;
  readonly amount: number;
}

export interface ViewActor {
  readonly id: string;
  readonly locationId: string;
  readonly alive: boolean;
  /** The sprite id the world set for this actor at genesis; the renderer resolves it to art. */
  readonly sprite: string;
  readonly isDeity: boolean;
  readonly inventory: readonly ViewInventoryLine[];
}

export interface ViewBuilding {
  readonly id: string;
  readonly name: string;
  readonly locationId: string;
  readonly status: BuildingStatus;
  readonly owner?: string;
  readonly inventory: readonly ViewInventoryLine[];
  /** Present only while burning; `destroyAt` is the authored intensity at which it is destroyed, when the rules define one. */
  readonly fire?: {
    readonly intensity: number;
    readonly ticksBurning: number;
    readonly destroyAt?: number;
  };
  /** Present only while repairing; `required` is the authored material cost, when the rules define one. */
  readonly repair?: {
    readonly progress: number;
    readonly required?: number;
  };
}

export interface ViewEdge {
  readonly to: string;
  readonly transport: string;
  readonly bidirectional: boolean;
}

export interface ViewLocation {
  readonly id: string;
  readonly name: string;
  readonly realm: Realm;
  readonly edges: readonly ViewEdge[];
  readonly actors: readonly ViewActor[];
  readonly buildings: readonly ViewBuilding[];
}

export interface WorldViewModel {
  /** The world the frame describes; per-world client state (a dismissed catch-up summary) is keyed on it. */
  readonly worldId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly tick: number;
  readonly status: WorldStatus;
  readonly degradedReason?: DegradedReason;
  readonly catchUpSummary?: CatchUpSummary;
  readonly realms: Readonly<Record<Realm, readonly ViewLocation[]>>;
  readonly recentEvents: readonly RecentEvent[];
}

function byId<T extends { readonly id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function inventoryLines(
  inventory: ReadonlyMap<string, number>,
): readonly ViewInventoryLine[] {
  return [...inventory.entries()]
    .map(([resource, amount]) => ({ resource, amount }))
    .sort((a, b) => (a.resource < b.resource ? -1 : 1));
}

function viewActor(actor: ActorState): ViewActor {
  return {
    id: actor.id,
    locationId: actor.locationId,
    alive: actor.alive,
    sprite: actor.sprite,
    isDeity: actor.isDeity === true,
    inventory: inventoryLines(actor.inventory),
  };
}

function viewBuilding(
  building: BuildingState,
  rules: WorldState["rules"],
): ViewBuilding {
  const destroyAt = rules.fireBalance.destroyIntensity;
  const required = rules.economyBalance.repairCostPlanks;
  return {
    id: building.id,
    name: building.name,
    locationId: building.locationId,
    status: building.status,
    ...(building.owner === undefined ? {} : { owner: building.owner }),
    inventory: inventoryLines(building.inventory),
    ...(building.status === "burning" && building.fireIntensity !== undefined
      ? {
          fire: {
            intensity: building.fireIntensity,
            ticksBurning: building.ticksBurning ?? 0,
            ...(destroyAt === undefined ? {} : { destroyAt }),
          },
        }
      : {}),
    ...(building.status === "repairing" && building.repairProgress !== undefined
      ? {
          repair: {
            progress: building.repairProgress,
            ...(required === undefined ? {} : { required }),
          },
        }
      : {}),
  };
}

function viewLocation(
  location: LocationState,
  actors: readonly ViewActor[],
  buildings: readonly ViewBuilding[],
): ViewLocation {
  return {
    id: location.id,
    name: location.name,
    realm: location.realm,
    edges: location.edges.map((edge) => ({
      to: edge.to,
      transport: edge.transport,
      bidirectional: edge.bidirectional,
    })),
    actors: actors.filter((actor) => actor.locationId === location.id),
    buildings: buildings.filter(
      (building) => building.locationId === location.id,
    ),
  };
}

/** Plain data for one committed frame: realms in the fixed realm order, each with its locations, and each location with its actors and buildings, all sorted by id so equal states give equal view models. */
export function toViewModel(
  frame: SyncFrame,
  state: WorldState,
): WorldViewModel {
  const actors = [...state.actors.values()].map(viewActor).sort(byId);
  const buildings = [...state.buildings.values()]
    .map((building) => viewBuilding(building, state.rules))
    .sort(byId);
  const locations = [...state.locations.values()].sort(byId);

  const realms = Object.fromEntries(
    REALMS.map((realm) => [
      realm,
      locations
        .filter((location) => location.realm === realm)
        .map((location) => viewLocation(location, actors, buildings)),
    ]),
  ) as unknown as Record<Realm, readonly ViewLocation[]>;

  return {
    worldId: frame.worldId,
    sessionId: frame.sessionId,
    sequence: frame.sequence,
    tick: state.tick,
    status: frame.status,
    ...(frame.degradedReason === undefined
      ? {}
      : { degradedReason: frame.degradedReason }),
    ...(frame.catchUpSummary === undefined
      ? {}
      : { catchUpSummary: frame.catchUpSummary }),
    realms,
    recentEvents: frame.recentEvents,
  };
}

export interface StoreSnapshot {
  readonly frame: SyncFrame;
  readonly state: WorldState;
}

export interface WorldStore {
  /** Replaces everything the store holds with this frame and its decoded state. */
  apply(frame: SyncFrame, state: WorldState): void;
  snapshot(): StoreSnapshot | undefined;
  viewModel(): WorldViewModel | undefined;
  /** Calls `listener` with the new view model after every applied frame; returns the function that stops it. */
  onChange(listener: (view: WorldViewModel) => void): () => void;
}

export function createWorldStore(): WorldStore {
  let held: { snapshot: StoreSnapshot; view: WorldViewModel } | undefined;
  const listeners = new Set<(view: WorldViewModel) => void>();

  return {
    apply(frame, state) {
      const view = toViewModel(frame, state);
      held = { snapshot: { frame, state }, view };
      for (const listener of listeners) {
        listener(view);
      }
    },
    snapshot: () => held?.snapshot,
    viewModel: () => held?.view,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
