// Builders for the committed-state frames the client tests feed through
// the same parse and decode path a live frame takes. A small three-realm
// world stands in for the authored pack: two mortal locations, one
// Olympus location, and the Underworld gate.

import {
  type EventId,
  parseSyncFrame,
  type WorldRules,
} from "@panthea/contracts";
import {
  type ActorState,
  type BuildingBase,
  type BuildingIgnition,
  type BuildingState,
  buildingBase,
  decode,
  encode,
  toEntityId,
  type WorldState,
  withActor,
  withBuilding,
} from "@panthea/world";
import { toViewModel, type WorldViewModel } from "./store";

const RULES: WorldRules = {
  catchUpCapMs: 3_600_000,
  catchUpChunkMs: 60_000,
  checkpointIntervalMs: 60_000,
  maxProposalsPerTick: 50,
  fireBalance: { destroyIntensity: 3 },
  economyBalance: { repairCostPlanks: 3 },
};

/** How the fixture tavern's fire started: a strike by Zeus. */
const STRIKE_IGNITION = {
  eventId: "evt-strike" as EventId,
  actor: toEntityId("zeus"),
};

function inventory(
  entries: Readonly<Record<string, number>>,
): ReadonlyMap<string, number> {
  return new Map(Object.entries(entries));
}

type RealmName = "mortal" | "olympus" | "underworld";

function locationOf(
  id: string,
  realm: RealmName,
  name: string,
  edgesTo: readonly string[],
) {
  return {
    id: toEntityId(id),
    realm,
    name,
    edges: edgesTo.map((to) => ({
      to,
      transport: "path" as const,
      bidirectional: true,
    })),
    revision: 0,
  };
}

function actorOf(
  id: string,
  locationId: string,
  stock: Readonly<Record<string, number>>,
  extra: Partial<ActorState> = {},
): ActorState {
  return {
    id: toEntityId(id),
    locationId: toEntityId(locationId),
    alive: true,
    capabilities: [],
    inventory: inventory(stock),
    revision: 0,
    ...extra,
  };
}

/** Where a building is in its lifecycle, with the fields that phase carries. */
type Stage =
  | { readonly status: "operational" | "damaged" | "destroyed" }
  | {
      readonly status: "burning";
      readonly fireIntensity: number;
      readonly ticksBurning: number;
      readonly ignition: BuildingIgnition;
    }
  | { readonly status: "repairing"; readonly repairProgress: number };

function buildingOf(
  id: string,
  locationId: string,
  name: string,
  extra: Partial<BuildingBase> = {},
  stage: Stage = { status: "operational" },
): BuildingState {
  return {
    id: toEntityId(id),
    locationId: toEntityId(locationId),
    name,
    material: "wood",
    combustible: true,
    services: ["drink"],
    inventory: inventory({}),
    revision: 0,
    ...extra,
    ...stage,
  };
}

function worldOf(
  locations: readonly ReturnType<typeof locationOf>[],
  actors: readonly ActorState[],
  buildings: readonly BuildingState[],
  tick: number,
  lastSequence: number,
): WorldState {
  const empty: WorldState = {
    tick,
    simTime: tick * 1_000,
    lastSequence,
    locations: new Map(locations.map((location) => [location.id, location])),
    actors: new Map(),
    buildings: new Map(),
    legends: new Map(),
    memories: new Map(),
    relationships: new Map(),
    goals: new Map(),
    journeys: new Map(),
    needs: new Map(),
    causes: new Map(),
    petitions: new Map(),
    threads: new Map(),
    contests: new Map(),
    services: [],
    standing: new Map(),
    repairGrants: new Map(),
    noticed: new Map(),
    director: { lastConsequentialTick: 0 },
    rules: RULES,
    recipes: {},
  };
  const withActors = actors.reduce<WorldState>(withActor, empty);
  return buildings.reduce<WorldState>(withBuilding, withActors);
}

export function baseState(): WorldState {
  return worldOf(
    [
      locationOf("town-square", "mortal", "Town Square", ["agora"]),
      locationOf("agora", "mortal", "Agora", ["town-square"]),
      locationOf("olympus-hall", "olympus", "Hall of Olympus", ["town-square"]),
      locationOf("underworld-gate", "underworld", "Underworld Gate", ["agora"]),
    ],
    [
      actorOf("woodcutter", "town-square", { wood: 2, currency: 5 }),
      actorOf("farmer", "agora", { food: 3 }),
      actorOf("zeus", "olympus-hall", { divinity: 10 }, { isDeity: true }),
    ],
    [
      buildingOf(
        "the-tavern",
        "town-square",
        "The Tavern",
        {},
        {
          status: "burning",
          fireIntensity: 2,
          ticksBurning: 2,
          ignition: STRIKE_IGNITION,
        },
      ),
      buildingOf("agora-shop", "agora", "Agora Shop", {
        inventory: inventory({ planks: 1 }),
        material: "stone",
        combustible: false,
      }),
    ],
    3,
    9,
  );
}

/** A world of only locations -- no actors or buildings -- for tests that care about the graph alone. */
export function locationsWorld(
  locations: readonly {
    readonly id: string;
    readonly realm: RealmName;
    readonly name: string;
    readonly edgesTo: readonly string[];
  }[],
): WorldState {
  return worldOf(
    locations.map((location) =>
      locationOf(location.id, location.realm, location.name, location.edgesTo),
    ),
    [],
    [],
    1,
    0,
  );
}

export function movedActor(
  state: WorldState,
  actorId: string,
  locationId: string,
): WorldState {
  const actor = state.actors.get(toEntityId(actorId));
  if (!actor) throw new Error(`fixture has no actor ${actorId}`);
  return withActor(state, {
    ...actor,
    locationId: toEntityId(locationId),
    revision: actor.revision + 1,
  });
}

export function deadActor(state: WorldState, actorId: string): WorldState {
  const actor = state.actors.get(toEntityId(actorId));
  if (!actor) throw new Error(`fixture has no actor ${actorId}`);
  return withActor(state, { ...actor, alive: false });
}

export function withoutActor(state: WorldState, actorId: string): WorldState {
  const actors = new Map(state.actors);
  actors.delete(toEntityId(actorId));
  return { ...state, actors };
}

/** The tavern after its fire is out and repair has begun, with `progress` materials committed so far. */
export function repairingTavern(
  state: WorldState,
  progress: number,
): WorldState {
  const tavern = state.buildings.get(toEntityId("the-tavern"));
  if (!tavern) throw new Error("fixture has no tavern");
  return withBuilding(state, {
    ...buildingBase(tavern),
    status: "repairing",
    repairProgress: progress,
  });
}

export function atTick(state: WorldState, tick: number): WorldState {
  return { ...state, tick, simTime: tick * 1000 };
}

/** A recent event as it appears on the wire: plain strings, exactly what the parser receives. */
export interface FixtureEvent {
  readonly id: string;
  readonly sequence: number;
  readonly tick: number;
  readonly kind: string;
  readonly subjects: readonly string[];
}

export interface FrameOptions {
  readonly sequence?: number;
  readonly sessionId?: string;
  readonly status?: "running" | "paused" | "degraded";
  readonly degradedReason?: string;
  readonly catchUpSummary?: {
    readonly id: string;
    readonly appliedMs: number;
    readonly skippedMs: number;
    readonly majorOutcomes: readonly string[];
    readonly atSequence: number;
  };
  readonly recentEvents?: readonly FixtureEvent[];
}

/** The JSON value the sidecar would send for `state`, exactly as it crosses the Channel. */
export function framePayload(
  state: WorldState,
  options: FrameOptions = {},
): unknown {
  const payload = {
    schemaVersion: 1,
    sequence: options.sequence ?? state.lastSequence,
    worldId: "world-1",
    sessionId: options.sessionId ?? "session-1",
    status: options.status ?? "running",
    ...(options.degradedReason === undefined
      ? {}
      : { degradedReason: options.degradedReason }),
    ...(options.catchUpSummary === undefined
      ? {}
      : { catchUpSummary: options.catchUpSummary }),
    recentEvents: options.recentEvents ?? [],
    state: encode(state),
  };
  return JSON.parse(JSON.stringify(payload));
}

/**
 * The world the `?fixture=1` preview shows: a burning tavern, a fallen
 * guard, a wanderer, Zeus on Olympus, a two-hour catch-up summary, and four
 * recent events -- built through the same parse, decode, and view-model
 * path a live frame takes.
 */
export function previewView(): WorldViewModel {
  const state = worldOf(
    [
      locationOf("town-square", "mortal", "Town Square", ["agora"]),
      locationOf("agora", "mortal", "Agora", ["town-square"]),
      locationOf("olympus-hall", "olympus", "Hall of Olympus", []),
      locationOf("underworld-gate", "underworld", "Underworld Gate", []),
    ],
    [
      actorOf("wanderer", "town-square", { wood: 2, currency: 5 }),
      actorOf("fallen-guard", "town-square", {}, { alive: false }),
      actorOf("zeus", "olympus-hall", { divinity: 10 }, { isDeity: true }),
    ],
    [
      buildingOf(
        "the-tavern",
        "town-square",
        "The Tavern",
        {},
        {
          status: "burning",
          fireIntensity: 2,
          ticksBurning: 2,
          ignition: STRIKE_IGNITION,
        },
      ),
      buildingOf("agora-shop", "agora", "Agora Shop", {
        inventory: inventory({ planks: 1 }),
      }),
    ],
    17,
    17,
  );
  const parsed = parseSyncFrame(
    framePayload(state, {
      sessionId: "preview-session",
      catchUpSummary: {
        id: "preview-summary",
        appliedMs: 7_200_000,
        skippedMs: 10_800_000,
        majorOutcomes: [
          "The tavern fire spread",
          "A route through the agora reopened",
        ],
        atSequence: 17,
      },
      recentEvents: [
        {
          id: "evt-strike-14",
          sequence: 14,
          tick: 14,
          kind: "building-damaged",
          subjects: ["the-tavern"],
        },
        {
          id: "evt-fire-15",
          sequence: 15,
          tick: 15,
          kind: "building-ignited",
          subjects: ["the-tavern"],
        },
        {
          id: "evt-trade-16",
          sequence: 16,
          tick: 16,
          kind: "resource-traded",
          subjects: ["wanderer", "fallen-guard"],
        },
        {
          id: "evt-worship-17",
          sequence: 17,
          tick: 17,
          kind: "worship-performed",
          subjects: ["wanderer", "zeus"],
        },
      ],
    }),
  );
  if (!parsed.ok) {
    throw new Error(`preview frame failed to parse: ${parsed.message}`);
  }
  return toViewModel(parsed.value, decode(parsed.value.state));
}
