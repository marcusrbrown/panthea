// The projection codec: `WorldState` keeps its entities in `Map`s for O(1)
// lookup, but `JSON.stringify` silently drops a `Map`'s contents (it
// serializes to `{}`), and packages/persistence stores projections as one
// opaque JSON document. `encode`/`decode` are the one place that boundary
// is crossed, so nothing else in packages/world needs to know or care
// that the stored form isn't a `Map`.
//
// `decode` parses rather than casts: its input comes back out of storage
// (or, via persistence's import path, out of an archive file), so it is
// validated the same way any other untrusted boundary in packages/contracts
// is -- shape, field types, and referential integrity (an actor's or
// building's `locationId` must name a location that actually exists; a
// location's `realm` must be a known realm; a building's `owner` must name
// a known actor).

import {
  CONTEST_END_REASONS,
  CONTEST_RESULTS,
  ENDING_EVENT_KINDS,
  type EntityId,
  type EventId,
  fail,
  type InhabitantDrives,
  isRecord,
  type LegendId,
  type LocationEdge,
  ok,
  type ParseResult,
  PRACTICE_KINDS,
  PRACTICE_STATUSES,
  parseArray,
  parseBoolean,
  parseConsequence,
  parseEntityId,
  parseEnum,
  parseEventId,
  parseGoalText,
  parseLegendId,
  parseMemoryBalance,
  parseMemoryEnding,
  parseNonNegativeInteger,
  parseNonNegativeNumber,
  parseOptionalBoolean,
  parseOptionalString,
  parsePetitionBalance,
  parsePetitionRequest,
  parsePracticeBalance,
  parsePracticeStakes,
  parsePracticeTerm,
  parseRecipes,
  parseReportContent,
  parseSalience,
  parseString,
  parseTemperamentOdds,
  parseThreadSubject,
  parseTransformation,
  parseTroubleKinds,
  REALMS,
  type RejectionReasonCode,
  SERVICE_KINDS,
  TEMPERAMENTS,
  TRANSPORT_KINDS,
  type Transformation,
  UNMET_NEED_REASONS,
  WITNESSED_EVENT_KINDS,
  WRONG_KINDS,
} from "@panthea/contracts";
import { memoryBalanceOf } from "./memory";
import {
  type ActiveGoal,
  type ActiveJourney,
  type ActorState,
  BUILDING_STATUSES,
  type BuildingBase,
  type BuildingIgnition,
  type BuildingState,
  type BuildingStatus,
  type Contest,
  type ContestTally,
  type Credit,
  type FavorState,
  type LegendRecord,
  type LocationState,
  type MemoryEntry,
  type NoticedLoss,
  needKey,
  noticedKey,
  type OpenNeed,
  type Petition,
  type PetitionCause,
  type PracticeThread,
  type RelationshipState,
  relationshipKey,
  type ServiceAct,
  type WithheldCapability,
  type WorldState,
  type WrongRecord,
} from "./state";

/**
 * The JSON-safe encoded form of a `WorldState`: entries arrays instead of
 * `Map`s, everything else unchanged. Round-trips through
 * `JSON.stringify`/`JSON.parse` losslessly.
 */
export interface EncodedWorldState {
  readonly tick: number;
  readonly simTime: number;
  readonly lastSequence: number;
  readonly locations: readonly (readonly [EntityId, EncodedLocationState])[];
  readonly actors: readonly (readonly [EntityId, EncodedActorState])[];
  readonly buildings: readonly (readonly [EntityId, EncodedBuildingState])[];
  readonly legends: readonly (readonly [LegendId, LegendRecord])[];
  readonly memories: readonly (readonly [EntityId, readonly MemoryEntry[]])[];
  readonly relationships: readonly (readonly [string, RelationshipState])[];
  readonly wrongs: readonly (readonly [EventId, WrongRecord])[];
  readonly credits: readonly (readonly [EventId, Credit])[];
  /** `[mortal, patron god]`, one entry per mortal that has a patron. */
  readonly patrons: readonly (readonly [EntityId, EntityId])[];
  readonly goals: readonly (readonly [EntityId, ActiveGoal])[];
  readonly journeys: readonly (readonly [EntityId, ActiveJourney])[];
  readonly needs: readonly (readonly [string, OpenNeed])[];
  readonly causes: readonly (readonly [EntityId, readonly PetitionCause[]])[];
  readonly petitions: readonly (readonly [EventId, Petition])[];
  readonly threads: readonly (readonly [EventId, PracticeThread])[];
  readonly contests: readonly (readonly [EventId, Contest])[];
  readonly services: readonly ServiceAct[];
  /** `[god, place, standing]`, one entry per nonzero standing, in the order the world holds them. */
  readonly standing: readonly (readonly [EntityId, EntityId, number])[];
  readonly repairGrants: readonly (readonly [EntityId, EntityId])[];
  readonly noticed: readonly (readonly [string, NoticedLoss])[];
  readonly director: { readonly lastConsequentialTick: number };
  readonly rules: WorldState["rules"];
  readonly recipes: WorldState["recipes"];
}

type EncodedLocationState = Omit<LocationState, "edges"> & {
  readonly edges: readonly LocationEdge[];
};
type EncodedActorState = Omit<ActorState, "inventory"> & {
  readonly inventory: readonly (readonly [string, number])[];
};
type EncodedBuildingState = Omit<BuildingState, "inventory"> & {
  readonly inventory: readonly (readonly [string, number])[];
};

function encodeInventory(
  inventory: ReadonlyMap<string, number>,
): readonly (readonly [string, number])[] {
  return [...inventory.entries()];
}

/** Encodes `state` into the JSON-safe form persistence stores. */
export function encode(state: WorldState): EncodedWorldState {
  return {
    tick: state.tick,
    simTime: state.simTime,
    lastSequence: state.lastSequence,
    locations: [...state.locations.entries()],
    actors: [...state.actors.entries()].map(
      ([id, actor]) =>
        [
          id,
          { ...actor, inventory: encodeInventory(actor.inventory) },
        ] as const,
    ),
    buildings: [...state.buildings.entries()].map(
      ([id, building]) =>
        [
          id,
          { ...building, inventory: encodeInventory(building.inventory) },
        ] as const,
    ),
    legends: [...state.legends.entries()],
    memories: [...state.memories.entries()],
    relationships: [...state.relationships.entries()],
    wrongs: [...state.wrongs.entries()],
    credits: [...state.credits.entries()],
    patrons: [...state.patrons.entries()],
    goals: [...state.goals.entries()],
    journeys: [...state.journeys.entries()],
    needs: [...state.needs.entries()],
    causes: [...state.causes.entries()],
    petitions: [...state.petitions.entries()],
    threads: [...state.threads.entries()],
    contests: [...state.contests.entries()],
    services: state.services,
    standing: [...state.standing].flatMap(([god, places]) =>
      [...places].map(([place, amount]) => [god, place, amount] as const),
    ),
    repairGrants: [...state.repairGrants.entries()],
    noticed: [...state.noticed.entries()],
    director: state.director,
    rules: state.rules,
    recipes: state.recipes,
  };
}

/** Thrown by `decode` when its input is not a well-formed encoded `WorldState`. */
export class WorldStateDecodeError extends Error {
  constructor(
    readonly path: string,
    readonly reason: RejectionReasonCode,
    message: string,
  ) {
    super(path ? `${path}: ${message}` : message);
    this.name = "WorldStateDecodeError";
  }
}

function parseLocationEdge(
  value: unknown,
  path: string,
): ParseResult<LocationEdge> {
  if (!isRecord(value)) return fail(path, "expected a location edge entry");
  const to = parseString(value.to, `${path}.to`);
  if (!to.ok) return to;
  const transport = parseEnum(
    value.transport,
    `${path}.transport`,
    TRANSPORT_KINDS,
  );
  if (!transport.ok) return transport;
  const bidirectional = parseBoolean(
    value.bidirectional,
    `${path}.bidirectional`,
  );
  if (!bidirectional.ok) return bidirectional;
  return ok({
    to: to.value,
    transport: transport.value,
    bidirectional: bidirectional.value,
  });
}

function parseLocationState(
  value: unknown,
  path: string,
): ParseResult<LocationState> {
  if (!isRecord(value)) return fail(path, "expected a location state object");
  const id = parseEntityId(value.id, `${path}.id`);
  if (!id.ok) return id;
  const realm = parseEnum(value.realm, `${path}.realm`, REALMS);
  if (!realm.ok) return realm;
  const name = parseString(value.name, `${path}.name`);
  if (!name.ok) return name;
  const edges = parseArray(value.edges, `${path}.edges`, parseLocationEdge);
  if (!edges.ok) return edges;
  const revision = parseNonNegativeInteger(value.revision, `${path}.revision`);
  if (!revision.ok) return revision;
  const requiredCapability = parseOptionalString(
    value.requiredCapability,
    `${path}.requiredCapability`,
  );
  if (!requiredCapability.ok) return requiredCapability;
  return ok({
    id: id.value,
    realm: realm.value,
    name: name.value,
    edges: edges.value,
    revision: revision.value,
    ...(requiredCapability.value === undefined
      ? {}
      : { requiredCapability: requiredCapability.value }),
  });
}

function parseLocationEntry(
  value: unknown,
  path: string,
): ParseResult<readonly [EntityId, LocationState]> {
  if (!Array.isArray(value) || value.length !== 2) {
    return fail(path, "expected a [id, location] entry");
  }
  const id = parseEntityId(value[0], `${path}[0]`);
  if (!id.ok) return id;
  const state = parseLocationState(value[1], `${path}[1]`);
  if (!state.ok) return state;
  if (id.value !== state.value.id) {
    return fail(
      `${path}[0]`,
      `entry key "${id.value}" does not match its own id field "${state.value.id}"`,
    );
  }
  return ok([id.value, state.value] as const);
}

function parseInventoryEntry(
  value: unknown,
  path: string,
): ParseResult<readonly [string, number]> {
  if (!Array.isArray(value) || value.length !== 2) {
    return fail(path, "expected a [resource, amount] entry");
  }
  const resource = parseString(value[0], `${path}[0]`);
  if (!resource.ok) return resource;
  const amount = parseNonNegativeNumber(value[1], `${path}[1]`);
  if (!amount.ok) return amount;
  return ok([resource.value, amount.value] as const);
}

function parseInventory(
  value: unknown,
  path: string,
): ParseResult<ReadonlyMap<string, number>> {
  const entries = parseArray(value, path, parseInventoryEntry);
  if (!entries.ok) return entries;
  const seen = new Set<string>();
  for (const [resource] of entries.value) {
    if (seen.has(resource)) {
      return fail(path, `duplicate resource in inventory: ${resource}`);
    }
    seen.add(resource);
  }
  return ok(new Map(entries.value));
}

function parseFavor(value: unknown, path: string): ParseResult<FavorState> {
  if (!isRecord(value)) return fail(path, "expected a favor entry");
  const source = parseEntityId(value.source, `${path}.source`);
  if (!source.ok) return source;
  const effect = parseString(value.effect, `${path}.effect`);
  if (!effect.ok) return effect;
  const expiresAtTick = parseNonNegativeInteger(
    value.expiresAtTick,
    `${path}.expiresAtTick`,
  );
  if (!expiresAtTick.ok) return expiresAtTick;
  return ok({
    source: source.value,
    effect: effect.value,
    expiresAtTick: expiresAtTick.value,
  });
}

function parseFavors(
  value: unknown,
  path: string,
): ParseResult<readonly FavorState[] | undefined> {
  if (value === undefined) return ok(undefined);
  return parseArray(value, path, parseFavor);
}

function parseWithheld(
  value: unknown,
  path: string,
): ParseResult<readonly WithheldCapability[] | undefined> {
  if (value === undefined) return ok(undefined);
  const items = parseArray(value, path, (item, at) => {
    if (!isRecord(item)) return fail(at, "expected a withheld capability");
    const capability = parseString(item.capability, `${at}.capability`);
    if (!capability.ok) return capability;
    const restoreAt = parseNonNegativeInteger(
      item.restoreAt,
      `${at}.restoreAt`,
    );
    if (!restoreAt.ok) return restoreAt;
    const eventId = parseEventId(item.eventId, `${at}.eventId`);
    if (!eventId.ok) return eventId;
    return ok({
      capability: capability.value,
      restoreAt: restoreAt.value,
      eventId: eventId.value,
    });
  });
  if (!items.ok) return items;
  if (items.value.length === 0) {
    return fail(
      path,
      "an empty list of withheld capabilities is absent instead",
    );
  }
  return items;
}

function parseDrives(
  value: unknown,
  path: string,
): ParseResult<InhabitantDrives | undefined> {
  if (value === undefined) return ok(undefined);
  if (!isRecord(value)) return fail(path, "expected a drives object");
  const thrift = parseNonNegativeNumber(value.thrift, `${path}.thrift`);
  if (!thrift.ok) return thrift;
  const appetite = parseNonNegativeNumber(value.appetite, `${path}.appetite`);
  if (!appetite.ok) return appetite;
  const greed = parseNonNegativeNumber(value.greed, `${path}.greed`);
  if (!greed.ok) return greed;
  const piety = parseNonNegativeNumber(value.piety, `${path}.piety`);
  if (!piety.ok) return piety;
  return ok({
    thrift: thrift.value,
    appetite: appetite.value,
    greed: greed.value,
    piety: piety.value,
  });
}

function parseActorState(
  value: unknown,
  path: string,
  knownLocationIds: ReadonlySet<EntityId>,
): ParseResult<ActorState> {
  if (!isRecord(value)) return fail(path, "expected an actor state object");
  const id = parseEntityId(value.id, `${path}.id`);
  if (!id.ok) return id;
  const locationId = parseEntityId(value.locationId, `${path}.locationId`);
  if (!locationId.ok) return locationId;
  if (!knownLocationIds.has(locationId.value)) {
    return fail(
      `${path}.locationId`,
      `actor references unknown location: ${locationId.value}`,
    );
  }
  const alive = parseBoolean(value.alive, `${path}.alive`);
  if (!alive.ok) return alive;
  const isDeity = parseOptionalBoolean(value.isDeity, `${path}.isDeity`);
  if (!isDeity.ok) return isDeity;
  const temperament =
    value.temperament === undefined
      ? ok<(typeof TEMPERAMENTS)[number] | undefined>(undefined)
      : parseEnum(value.temperament, `${path}.temperament`, TEMPERAMENTS);
  if (!temperament.ok) return temperament;
  const capabilities = parseArray(
    value.capabilities,
    `${path}.capabilities`,
    parseString,
  );
  if (!capabilities.ok) return capabilities;
  const inventory = parseInventory(value.inventory, `${path}.inventory`);
  if (!inventory.ok) return inventory;
  const drives = parseDrives(value.drives, `${path}.drives`);
  if (!drives.ok) return drives;
  const home =
    value.home === undefined
      ? ok<EntityId | undefined>(undefined)
      : parseEntityId(value.home, `${path}.home`);
  if (!home.ok) return home;
  const gathers = parseOptionalString(value.gathers, `${path}.gathers`);
  if (!gathers.ok) return gathers;
  const wants = parseOptionalString(value.wants, `${path}.wants`);
  if (!wants.ok) return wants;
  const favors = parseFavors(value.favors, `${path}.favors`);
  if (!favors.ok) return favors;
  const form = parseOptionalString(value.form, `${path}.form`);
  if (!form.ok) return form;
  const rivals =
    value.rivals === undefined
      ? ok<readonly EntityId[] | undefined>(undefined)
      : parseArray(value.rivals, `${path}.rivals`, parseEntityId);
  if (!rivals.ok) return rivals;
  const withheld = parseWithheld(value.withheld, `${path}.withheld`);
  if (!withheld.ok) return withheld;
  const revision = parseNonNegativeInteger(value.revision, `${path}.revision`);
  if (!revision.ok) return revision;
  return ok({
    id: id.value,
    locationId: locationId.value,
    alive: alive.value,
    ...(isDeity.value === undefined ? {} : { isDeity: isDeity.value }),
    ...(temperament.value === undefined
      ? {}
      : { temperament: temperament.value }),
    capabilities: capabilities.value,
    inventory: inventory.value,
    ...(drives.value === undefined ? {} : { drives: drives.value }),
    ...(home.value === undefined ? {} : { home: home.value }),
    ...(gathers.value === undefined ? {} : { gathers: gathers.value }),
    ...(wants.value === undefined ? {} : { wants: wants.value }),
    ...(favors.value === undefined ? {} : { favors: favors.value }),
    ...(form.value === undefined ? {} : { form: form.value }),
    ...(rivals.value === undefined ? {} : { rivals: rivals.value }),
    ...(withheld.value === undefined ? {} : { withheld: withheld.value }),
    revision: revision.value,
  });
}

function parseActorEntry(
  value: unknown,
  path: string,
  knownLocationIds: ReadonlySet<EntityId>,
): ParseResult<readonly [EntityId, ActorState]> {
  if (!Array.isArray(value) || value.length !== 2) {
    return fail(path, "expected a [id, actor] entry");
  }
  const id = parseEntityId(value[0], `${path}[0]`);
  if (!id.ok) return id;
  const state = parseActorState(value[1], `${path}[1]`, knownLocationIds);
  if (!state.ok) return state;
  if (id.value !== state.value.id) {
    return fail(
      `${path}[0]`,
      `entry key "${id.value}" does not match its own id field "${state.value.id}"`,
    );
  }
  return ok([id.value, state.value] as const);
}

function parseBuildingState(
  value: unknown,
  path: string,
  knownLocationIds: ReadonlySet<EntityId>,
  knownActorIds: ReadonlySet<EntityId>,
): ParseResult<BuildingState> {
  if (!isRecord(value)) return fail(path, "expected a building state object");
  const id = parseEntityId(value.id, `${path}.id`);
  if (!id.ok) return id;
  const locationId = parseEntityId(value.locationId, `${path}.locationId`);
  if (!locationId.ok) return locationId;
  if (!knownLocationIds.has(locationId.value)) {
    return fail(
      `${path}.locationId`,
      `building references unknown location: ${locationId.value}`,
    );
  }
  const name = parseString(value.name, `${path}.name`);
  if (!name.ok) return name;
  const material = parseString(value.material, `${path}.material`);
  if (!material.ok) return material;
  const combustible = parseBoolean(value.combustible, `${path}.combustible`);
  if (!combustible.ok) return combustible;
  const services = parseArray(value.services, `${path}.services`, parseString);
  if (!services.ok) return services;
  const inventory = parseInventory(value.inventory, `${path}.inventory`);
  if (!inventory.ok) return inventory;
  const ownerRaw = parseOptionalString(value.owner, `${path}.owner`);
  if (!ownerRaw.ok) return ownerRaw;
  if (ownerRaw.value !== undefined) {
    const owner = parseEntityId(ownerRaw.value, `${path}.owner`);
    if (!owner.ok) return owner;
    if (!knownActorIds.has(owner.value)) {
      return fail(
        `${path}.owner`,
        `building references unknown owner: ${owner.value}`,
      );
    }
  }
  const status = parseEnum(value.status, `${path}.status`, BUILDING_STATUSES);
  if (!status.ok) return status;
  const revision = parseNonNegativeInteger(value.revision, `${path}.revision`);
  if (!revision.ok) return revision;
  const base: BuildingBase = {
    id: id.value,
    locationId: locationId.value,
    name: name.value,
    material: material.value,
    combustible: combustible.value,
    services: services.value,
    inventory: inventory.value,
    ...(ownerRaw.value === undefined
      ? {}
      : { owner: ownerRaw.value as EntityId }),
    revision: revision.value,
  };

  // The fields of a status exist exactly in that status.
  const only = (field: string, allowed: BuildingStatus): ParseResult<null> =>
    value[field] !== undefined && status.value !== allowed
      ? fail(
          `${path}.${field}`,
          `only a ${allowed} building has ${field}, not a ${status.value} one`,
        )
      : ok(null);
  for (const [field, allowed] of [
    ["fireIntensity", "burning"],
    ["ticksBurning", "burning"],
    ["ignition", "burning"],
    ["repairProgress", "repairing"],
  ] as const) {
    const checked = only(field, allowed);
    if (!checked.ok) return checked;
  }

  switch (status.value) {
    case "burning": {
      const fireIntensity = parseNonNegativeNumber(
        value.fireIntensity,
        `${path}.fireIntensity`,
      );
      if (!fireIntensity.ok) return fireIntensity;
      const ticksBurning = parseNonNegativeInteger(
        value.ticksBurning,
        `${path}.ticksBurning`,
      );
      if (!ticksBurning.ok) return ticksBurning;
      const ignition = parseIgnition(value.ignition, `${path}.ignition`);
      if (!ignition.ok) return ignition;
      return ok({
        ...base,
        status: "burning",
        fireIntensity: fireIntensity.value,
        ticksBurning: ticksBurning.value,
        ignition: ignition.value,
      });
    }
    case "repairing": {
      const repairProgress = parseNonNegativeNumber(
        value.repairProgress,
        `${path}.repairProgress`,
      );
      if (!repairProgress.ok) return repairProgress;
      return ok({
        ...base,
        status: "repairing",
        repairProgress: repairProgress.value,
      });
    }
    case "operational":
    case "damaged":
    case "destroyed":
      return ok({ ...base, status: status.value });
  }
}

function parseIgnition(
  value: unknown,
  path: string,
): ParseResult<BuildingIgnition> {
  if (!isRecord(value)) return fail(path, "expected an ignition object");
  const eventId = parseEventId(value.eventId, `${path}.eventId`);
  if (!eventId.ok) return eventId;
  const actor =
    value.actor === undefined
      ? ok<EntityId | undefined>(undefined)
      : parseEntityId(value.actor, `${path}.actor`);
  if (!actor.ok) return actor;
  return ok({
    eventId: eventId.value,
    ...(actor.value === undefined ? {} : { actor: actor.value }),
  });
}

function parseBuildingEntry(
  value: unknown,
  path: string,
  knownLocationIds: ReadonlySet<EntityId>,
  knownActorIds: ReadonlySet<EntityId>,
): ParseResult<readonly [EntityId, BuildingState]> {
  if (!Array.isArray(value) || value.length !== 2) {
    return fail(path, "expected a [id, building] entry");
  }
  const id = parseEntityId(value[0], `${path}[0]`);
  if (!id.ok) return id;
  const state = parseBuildingState(
    value[1],
    `${path}[1]`,
    knownLocationIds,
    knownActorIds,
  );
  if (!state.ok) return state;
  if (id.value !== state.value.id) {
    return fail(
      `${path}[0]`,
      `entry key "${id.value}" does not match its own id field "${state.value.id}"`,
    );
  }
  return ok([id.value, state.value] as const);
}

/** Fails if `entries` contains the same key twice -- `new Map` would otherwise silently keep only the last one. */
function findDuplicateKey<K, T>(
  entries: readonly (readonly [K, T])[],
): K | undefined {
  const seen = new Set<K>();
  for (const [key] of entries) {
    if (seen.has(key)) {
      return key;
    }
    seen.add(key);
  }
  return undefined;
}

function parseWorldRules(
  value: unknown,
  path: string,
): ParseResult<WorldState["rules"]> {
  if (!isRecord(value)) return fail(path, "expected a rules object");
  const catchUpCapMs = parseNonNegativeInteger(
    value.catchUpCapMs,
    `${path}.catchUpCapMs`,
  );
  if (!catchUpCapMs.ok) return catchUpCapMs;
  const catchUpChunkMs = parseNonNegativeInteger(
    value.catchUpChunkMs,
    `${path}.catchUpChunkMs`,
  );
  if (!catchUpChunkMs.ok) return catchUpChunkMs;
  const checkpointIntervalMs = parseNonNegativeInteger(
    value.checkpointIntervalMs,
    `${path}.checkpointIntervalMs`,
  );
  if (!checkpointIntervalMs.ok) return checkpointIntervalMs;
  const maxProposalsPerTick = parseNonNegativeInteger(
    value.maxProposalsPerTick,
    `${path}.maxProposalsPerTick`,
  );
  if (!maxProposalsPerTick.ok) return maxProposalsPerTick;
  const fireBalance = parseNumberRecord(
    value.fireBalance,
    `${path}.fireBalance`,
  );
  if (!fireBalance.ok) return fireBalance;
  const economyBalance = parseNumberRecord(
    value.economyBalance,
    `${path}.economyBalance`,
  );
  if (!economyBalance.ok) return economyBalance;
  const memoryBalance =
    value.memoryBalance === undefined
      ? ok<Readonly<Record<string, number>> | undefined>(undefined)
      : parseMemoryBalance(value.memoryBalance, `${path}.memoryBalance`);
  if (!memoryBalance.ok) return memoryBalance;
  const petitionBalance =
    value.petitionBalance === undefined
      ? ok<Readonly<Record<string, number>> | undefined>(undefined)
      : parsePetitionBalance(value.petitionBalance, `${path}.petitionBalance`);
  if (!petitionBalance.ok) return petitionBalance;
  const practiceBalance =
    value.practiceBalance === undefined
      ? ok<Readonly<Record<string, number>> | undefined>(undefined)
      : parsePracticeBalance(value.practiceBalance, `${path}.practiceBalance`);
  if (!practiceBalance.ok) return practiceBalance;
  const practiceStakes =
    value.practiceStakes === undefined
      ? ok<Readonly<Record<string, Transformation>> | undefined>(undefined)
      : parsePracticeStakes(value.practiceStakes, `${path}.practiceStakes`);
  if (!practiceStakes.ok) return practiceStakes;
  const troubleKinds =
    value.troubleKinds === undefined
      ? ok<Readonly<Record<string, string>> | undefined>(undefined)
      : parseTroubleKinds(value.troubleKinds, `${path}.troubleKinds`);
  if (!troubleKinds.ok) return troubleKinds;
  const temperamentOdds =
    value.temperamentOdds === undefined
      ? ok<WorldState["rules"]["temperamentOdds"]>(undefined)
      : parseTemperamentOdds(value.temperamentOdds, `${path}.temperamentOdds`);
  if (!temperamentOdds.ok) return temperamentOdds;
  return ok({
    catchUpCapMs: catchUpCapMs.value,
    catchUpChunkMs: catchUpChunkMs.value,
    checkpointIntervalMs: checkpointIntervalMs.value,
    maxProposalsPerTick: maxProposalsPerTick.value,
    fireBalance: fireBalance.value,
    economyBalance: economyBalance.value,
    ...(memoryBalance.value === undefined
      ? {}
      : { memoryBalance: memoryBalance.value }),
    ...(petitionBalance.value === undefined
      ? {}
      : { petitionBalance: petitionBalance.value }),
    ...(practiceBalance.value === undefined
      ? {}
      : { practiceBalance: practiceBalance.value }),
    ...(practiceStakes.value === undefined
      ? {}
      : { practiceStakes: practiceStakes.value }),
    ...(troubleKinds.value === undefined
      ? {}
      : { troubleKinds: troubleKinds.value }),
    ...(temperamentOdds.value === undefined
      ? {}
      : { temperamentOdds: temperamentOdds.value }),
  });
}

function parseLegendRecord(
  value: unknown,
  path: string,
): ParseResult<LegendRecord> {
  if (!isRecord(value)) return fail(path, "expected a legend record object");
  const id = parseLegendId(value.id, `${path}.id`);
  if (!id.ok) return id;
  const narrator = parseEntityId(value.narrator, `${path}.narrator`);
  if (!narrator.ok) return narrator;
  const assertion = parseString(value.assertion, `${path}.assertion`);
  if (!assertion.ok) return assertion;
  const linkedEventIdRaw = parseOptionalString(
    value.linkedEventId,
    `${path}.linkedEventId`,
  );
  if (!linkedEventIdRaw.ok) return linkedEventIdRaw;
  return ok({
    id: id.value,
    narrator: narrator.value,
    assertion: assertion.value,
    ...(linkedEventIdRaw.value === undefined
      ? {}
      : { linkedEventId: linkedEventIdRaw.value as EventId }),
  });
}

function parseLegendEntry(
  value: unknown,
  path: string,
): ParseResult<readonly [LegendId, LegendRecord]> {
  if (!Array.isArray(value) || value.length !== 2) {
    return fail(path, "expected a [id, legend] entry");
  }
  const id = parseLegendId(value[0], `${path}[0]`);
  if (!id.ok) return id;
  const record = parseLegendRecord(value[1], `${path}[1]`);
  if (!record.ok) return record;
  if (id.value !== record.value.id) {
    return fail(
      `${path}[0]`,
      `entry key "${id.value}" does not match its own id field "${record.value.id}"`,
    );
  }
  return ok([id.value, record.value] as const);
}

function parseMemoryEntry(
  value: unknown,
  path: string,
): ParseResult<MemoryEntry> {
  if (!isRecord(value)) return fail(path, "expected a memory entry object");
  const id = parseEventId(value.id, `${path}.id`);
  if (!id.ok) return id;
  const sourceEventId = parseEventId(
    value.sourceEventId,
    `${path}.sourceEventId`,
  );
  if (!sourceEventId.ok) return sourceEventId;
  const salience = parseSalience(value.salience, `${path}.salience`);
  if (!salience.ok) return salience;
  const recordedAt = parseNonNegativeInteger(
    value.recordedAt,
    `${path}.recordedAt`,
  );
  if (!recordedAt.ok) return recordedAt;
  const subjects = parseArray(
    value.subjects,
    `${path}.subjects`,
    parseEntityId,
  );
  if (!subjects.ok) return subjects;
  const consequence = parseConsequence(
    value.consequence,
    `${path}.consequence`,
  );
  if (!consequence.ok) return consequence;
  const base = {
    id: id.value,
    sourceEventId: sourceEventId.value,
    salience: salience.value,
    recordedAt: recordedAt.value,
    subjects: subjects.value,
    ...(consequence.value === undefined
      ? {}
      : { consequence: consequence.value }),
  };

  switch (value.kind) {
    case "witnessed": {
      const eventKind = parseEnum(value.eventKind, `${path}.eventKind`, [
        ...WITNESSED_EVENT_KINDS,
        ...ENDING_EVENT_KINDS,
      ] as const);
      if (!eventKind.ok) return eventKind;
      const ending = parseMemoryEnding(value.ending, `${path}.ending`);
      if (!ending.ok) return ending;
      const isEnding = (ENDING_EVENT_KINDS as readonly string[]).includes(
        eventKind.value,
      );
      if (isEnding !== (ending.value !== undefined)) {
        return fail(
          `${path}.ending`,
          "a memory of an ending event says how it ended, and no other does",
        );
      }
      return ok({
        ...base,
        kind: "witnessed",
        eventKind: eventKind.value,
        ...(ending.value === undefined ? {} : { ending: ending.value }),
      });
    }
    case "told": {
      const teller = parseEntityId(value.teller, `${path}.teller`);
      if (!teller.ok) return teller;
      const content = parseReportContent(value.content, `${path}.content`);
      if (!content.ok) return content;
      const linkedEventIdRaw = parseOptionalString(
        value.linkedEventId,
        `${path}.linkedEventId`,
      );
      if (!linkedEventIdRaw.ok) return linkedEventIdRaw;
      return ok({
        ...base,
        kind: "told",
        teller: teller.value,
        content: content.value,
        ...(linkedEventIdRaw.value === undefined
          ? {}
          : { linkedEventId: linkedEventIdRaw.value as EventId }),
      });
    }
    case "noticed": {
      const causeEventId = parseEventId(
        value.causeEventId,
        `${path}.causeEventId`,
      );
      if (!causeEventId.ok) return causeEventId;
      return ok({ ...base, kind: "noticed", causeEventId: causeEventId.value });
    }
    case "sign": {
      const god = parseEntityId(value.god, `${path}.god`);
      if (!god.ok) return god;
      const outcome = parseEnum(value.outcome, `${path}.outcome`, [
        "answered",
        "lapsed",
        "refused",
      ] as const);
      if (!outcome.ok) return outcome;
      const petitionId = parseEventId(value.petitionId, `${path}.petitionId`);
      if (!petitionId.ok) return petitionId;
      return ok({
        ...base,
        kind: "sign",
        god: god.value,
        outcome: outcome.value,
        petitionId: petitionId.value,
      });
    }
    case "patronage": {
      const mortal = parseEntityId(value.mortal, `${path}.mortal`);
      if (!mortal.ok) return mortal;
      const home = parseEntityId(value.home, `${path}.home`);
      if (!home.ok) return home;
      const from = parseEntityId(value.from, `${path}.from`);
      if (!from.ok) return from;
      const to = parseEntityId(value.to, `${path}.to`);
      if (!to.ok) return to;
      return ok({
        ...base,
        kind: "patronage",
        mortal: mortal.value,
        home: home.value,
        from: from.value,
        to: to.value,
      });
    }
    default:
      return fail(
        `${path}.kind`,
        "expected a witnessed, told, sign, noticed, or patronage memory",
      );
  }
}

function parseMemoryEntries(
  value: unknown,
  path: string,
  knownActorIds: ReadonlySet<EntityId>,
): ParseResult<readonly [EntityId, readonly MemoryEntry[]]> {
  if (!Array.isArray(value) || value.length !== 2) {
    return fail(path, "expected an [actor, memories] entry");
  }
  const owner = parseEntityId(value[0], `${path}[0]`);
  if (!owner.ok) return owner;
  if (!knownActorIds.has(owner.value)) {
    return fail(
      `${path}[0]`,
      `memories belong to unknown actor: ${owner.value}`,
    );
  }
  const entries = parseArray(value[1], `${path}[1]`, parseMemoryEntry);
  if (!entries.ok) return entries;
  return ok([owner.value, entries.value] as const);
}

function parseGoalEntry(
  value: unknown,
  path: string,
  knownActorIds: ReadonlySet<EntityId>,
): ParseResult<readonly [EntityId, ActiveGoal]> {
  if (!Array.isArray(value) || value.length !== 2) {
    return fail(path, "expected an [actor, goal] entry");
  }
  const owner = parseEntityId(value[0], `${path}[0]`);
  if (!owner.ok) return owner;
  if (!knownActorIds.has(owner.value)) {
    return fail(`${path}[0]`, `goal belongs to unknown actor: ${owner.value}`);
  }
  const record = value[1];
  if (!isRecord(record)) return fail(`${path}[1]`, "expected a goal");
  const text = parseGoalText(record.text, `${path}[1].text`);
  if (!text.ok) return text;
  const target = parseEntityId(record.target, `${path}[1].target`);
  if (!target.ok) return target;
  const eventId = parseEventId(record.eventId, `${path}[1].eventId`);
  if (!eventId.ok) return eventId;
  const sequence = parseNonNegativeInteger(
    record.sequence,
    `${path}[1].sequence`,
  );
  if (!sequence.ok) return sequence;
  const setTick = parseNonNegativeInteger(record.tick, `${path}[1].tick`);
  if (!setTick.ok) return setTick;
  return ok([
    owner.value,
    {
      text: text.value,
      target: target.value,
      eventId: eventId.value,
      sequence: sequence.value,
      tick: setTick.value,
    },
  ] as const);
}

function parseJourneyEntry(
  value: unknown,
  path: string,
  knownActorIds: ReadonlySet<EntityId>,
  knownLocationIds: ReadonlySet<EntityId>,
): ParseResult<readonly [EntityId, ActiveJourney]> {
  if (!Array.isArray(value) || value.length !== 2) {
    return fail(path, "expected an [actor, journey] entry");
  }
  const owner = parseEntityId(value[0], `${path}[0]`);
  if (!owner.ok) return owner;
  if (!knownActorIds.has(owner.value)) {
    return fail(
      `${path}[0]`,
      `journey belongs to unknown actor: ${owner.value}`,
    );
  }
  const record = value[1];
  if (!isRecord(record)) return fail(`${path}[1]`, "expected a journey");
  const destination = parseEntityId(
    record.destination,
    `${path}[1].destination`,
  );
  if (!destination.ok) return destination;
  if (!knownLocationIds.has(destination.value)) {
    return fail(
      `${path}[1].destination`,
      `journey heads for unknown location: ${destination.value}`,
    );
  }
  const eventId = parseEventId(record.eventId, `${path}[1].eventId`);
  if (!eventId.ok) return eventId;
  return ok([
    owner.value,
    { destination: destination.value, eventId: eventId.value },
  ] as const);
}

const CAUSE_KINDS = [
  "damage",
  "fire",
  "theft",
  "spoilage",
  "need",
  "grudge",
  "harm",
  "wrong",
] as const;

function parseCause(item: unknown, at: string): ParseResult<PetitionCause> {
  if (!isRecord(item)) return fail(at, "expected a cause");
  const eventId = parseEventId(item.eventId, `${at}.eventId`);
  if (!eventId.ok) return eventId;
  const tick = parseNonNegativeInteger(item.tick, `${at}.tick`);
  if (!tick.ok) return tick;
  const kind = parseEnum(item.kind, `${at}.kind`, CAUSE_KINDS);
  if (!kind.ok) return kind;
  const offender =
    item.offender === undefined
      ? ok<EntityId | undefined>(undefined)
      : parseEntityId(item.offender, `${at}.offender`);
  if (!offender.ok) return offender;
  const building =
    item.building === undefined
      ? ok<EntityId | undefined>(undefined)
      : parseEntityId(item.building, `${at}.building`);
  if (!building.ok) return building;
  const resource = parseOptionalString(item.resource, `${at}.resource`);
  if (!resource.ok) return resource;
  const amount =
    item.amount === undefined
      ? ok<number | undefined>(undefined)
      : parseNonNegativeInteger(item.amount, `${at}.amount`);
  if (!amount.ok) return amount;
  const wrong =
    item.wrong === undefined
      ? ok<(typeof WRONG_KINDS)[number] | undefined>(undefined)
      : parseEnum(item.wrong, `${at}.wrong`, WRONG_KINDS);
  if (!wrong.ok) return wrong;
  return ok({
    eventId: eventId.value,
    tick: tick.value,
    kind: kind.value,
    ...(wrong.value === undefined ? {} : { wrong: wrong.value }),
    ...(offender.value === undefined ? {} : { offender: offender.value }),
    ...(building.value === undefined ? {} : { building: building.value }),
    ...(resource.value === undefined ? {} : { resource: resource.value }),
    ...(amount.value === undefined ? {} : { amount: amount.value }),
  });
}

function parseCauseEntry(
  value: unknown,
  path: string,
  knownActorIds: ReadonlySet<EntityId>,
): ParseResult<readonly [EntityId, readonly PetitionCause[]]> {
  if (!Array.isArray(value) || value.length !== 2) {
    return fail(path, "expected an [actor, causes] entry");
  }
  const owner = parseEntityId(value[0], `${path}[0]`);
  if (!owner.ok) return owner;
  if (!knownActorIds.has(owner.value)) {
    return fail(`${path}[0]`, `causes belong to unknown actor: ${owner.value}`);
  }
  const causes = parseArray(value[1], `${path}[1]`, parseCause);
  if (!causes.ok) return causes;
  return ok([owner.value, causes.value] as const);
}

function parsePetitionEntry(
  value: unknown,
  path: string,
  knownActorIds: ReadonlySet<EntityId>,
): ParseResult<readonly [EventId, Petition]> {
  if (!Array.isArray(value) || value.length !== 2) {
    return fail(path, "expected an [id, petition] entry");
  }
  const key = parseEventId(value[0], `${path}[0]`);
  if (!key.ok) return key;
  const record = value[1];
  if (!isRecord(record)) return fail(`${path}[1]`, "expected a petition");
  const id = parseEventId(record.id, `${path}[1].id`);
  if (!id.ok) return id;
  if (id.value !== key.value) {
    return fail(
      `${path}[0]`,
      `entry key "${key.value}" does not match its own id`,
    );
  }
  const petitioner = parseEntityId(record.petitioner, `${path}[1].petitioner`);
  if (!petitioner.ok) return petitioner;
  const god = parseEntityId(record.god, `${path}[1].god`);
  if (!god.ok) return god;
  for (const actor of [petitioner.value, god.value]) {
    if (!knownActorIds.has(actor)) {
      return fail(`${path}[1]`, `petition names unknown actor: ${actor}`);
    }
  }
  const cause = parseEventId(record.cause, `${path}[1].cause`);
  if (!cause.ok) return cause;
  const about = parseCause(record.about, `${path}[1].about`);
  if (!about.ok) return about;
  const request = parsePetitionRequest(record.request, `${path}[1].request`);
  if (!request.ok) return request;
  const tick = parseNonNegativeInteger(record.tick, `${path}[1].tick`);
  if (!tick.ok) return tick;
  const sequence = parseNonNegativeInteger(
    record.sequence,
    `${path}[1].sequence`,
  );
  if (!sequence.ok) return sequence;
  const status = parseEnum(record.status, `${path}[1].status`, [
    "open",
    "answered",
    "lapsed",
    "refused",
  ] as const);
  if (!status.ok) return status;
  return ok([
    key.value,
    {
      id: id.value,
      petitioner: petitioner.value,
      god: god.value,
      cause: cause.value,
      about: about.value,
      request: request.value,
      tick: tick.value,
      sequence: sequence.value,
      status: status.value,
    },
  ] as const);
}

function parseContestTallies(
  value: unknown,
  path: string,
  gods: readonly EntityId[],
  knownActorIds: ReadonlySet<EntityId>,
): ParseResult<readonly ContestTally[]> {
  return parseArray(value, path, (item, at) => {
    if (!isRecord(item)) return fail(at, "expected a tally");
    const god = parseEntityId(item.god, `${at}.god`);
    if (!god.ok) return god;
    if (!gods.includes(god.value)) {
      return fail(`${at}.god`, "a tally weighs one of the contest's two gods");
    }
    const mortal = parseEntityId(item.mortal, `${at}.mortal`);
    if (!mortal.ok) return mortal;
    if (!knownActorIds.has(mortal.value)) {
      return fail(`${at}.mortal`, `tally names unknown actor: ${mortal.value}`);
    }
    if (typeof item.weight !== "number" || !Number.isInteger(item.weight)) {
      return fail(`${at}.weight`, "expected a whole number");
    }
    return ok({ god: god.value, mortal: mortal.value, weight: item.weight });
  });
}

function parseContestEntry(
  value: unknown,
  path: string,
  knownActorIds: ReadonlySet<EntityId>,
  knownLocationIds: ReadonlySet<EntityId>,
): ParseResult<readonly [EventId, Contest]> {
  if (!Array.isArray(value) || value.length !== 2) {
    return fail(path, "expected an [id, contest] entry");
  }
  const key = parseEventId(value[0], `${path}[0]`);
  if (!key.ok) return key;
  const record = value[1];
  if (!isRecord(record)) return fail(`${path}[1]`, "expected a contest");
  const at = `${path}[1]`;
  const id = parseEventId(record.id, `${at}.id`);
  if (!id.ok) return id;
  if (id.value !== key.value) {
    return fail(
      `${path}[0]`,
      `entry key "${key.value}" does not match its own id`,
    );
  }
  const gods: EntityId[] = [];
  for (const field of ["opener", "rival"] as const) {
    const god = parseEntityId(record[field], `${at}.${field}`);
    if (!god.ok) return god;
    if (!knownActorIds.has(god.value)) {
      return fail(
        `${at}.${field}`,
        `contest names unknown actor: ${god.value}`,
      );
    }
    gods.push(god.value);
  }
  const [opener, rival] = gods as [EntityId, EntityId];
  if (opener === rival) {
    return fail(at, "a contest is between two gods, not one");
  }
  const place = parseEntityId(record.place, `${at}.place`);
  if (!place.ok) return place;
  if (!knownLocationIds.has(place.value)) {
    return fail(
      `${at}.place`,
      `contest is held at unknown place: ${place.value}`,
    );
  }
  const cause = parseEventId(record.cause, `${at}.cause`);
  if (!cause.ok) return cause;
  const openedTick = parseNonNegativeInteger(
    record.openedTick,
    `${at}.openedTick`,
  );
  if (!openedTick.ok) return openedTick;
  const openedSequence = parseNonNegativeInteger(
    record.openedSequence,
    `${at}.openedSequence`,
  );
  if (!openedSequence.ok) return openedSequence;
  const closesAt = parseNonNegativeInteger(record.closesAt, `${at}.closesAt`);
  if (!closesAt.ok) return closesAt;
  const succeeds =
    record.succeeds === undefined
      ? ok<EventId | undefined>(undefined)
      : parseEventId(record.succeeds, `${at}.succeeds`);
  if (!succeeds.ok) return succeeds;
  const status = parseEnum(record.status, `${at}.status`, [
    "open",
    ...CONTEST_RESULTS,
  ] as const);
  if (!status.ok) return status;
  const tallies = parseContestTallies(
    record.tallies,
    `${at}.tallies`,
    gods,
    knownActorIds,
  );
  if (!tallies.ok) return tallies;
  const closedTick =
    record.closedTick === undefined
      ? ok<number | undefined>(undefined)
      : parseNonNegativeInteger(record.closedTick, `${at}.closedTick`);
  if (!closedTick.ok) return closedTick;
  const closedSequence =
    record.closedSequence === undefined
      ? ok<number | undefined>(undefined)
      : parseNonNegativeInteger(record.closedSequence, `${at}.closedSequence`);
  if (!closedSequence.ok) return closedSequence;
  const reason =
    record.reason === undefined
      ? ok<(typeof CONTEST_END_REASONS)[number] | undefined>(undefined)
      : parseEnum(record.reason, `${at}.reason`, CONTEST_END_REASONS);
  if (!reason.ok) return reason;
  const winner =
    record.winner === undefined
      ? ok<EntityId | undefined>(undefined)
      : parseEntityId(record.winner, `${at}.winner`);
  if (!winner.ok) return winner;
  // An open contest has no ending; a closed one has when and why, and a decision a winner of the two.
  const open = status.value === "open";
  if (
    open !==
    (closedTick.value === undefined &&
      closedSequence.value === undefined &&
      reason.value === undefined &&
      winner.value === undefined)
  ) {
    return fail(at, "a contest is open exactly when it has no ending recorded");
  }
  if (!open) {
    if (
      closedTick.value === undefined ||
      closedSequence.value === undefined ||
      reason.value === undefined
    ) {
      return fail(at, "a closed contest records when and why it closed");
    }
    if (status.value === "decided") {
      if (winner.value === undefined || !gods.includes(winner.value)) {
        return fail(
          `${at}.winner`,
          "a decided contest has one of its two gods as winner",
        );
      }
    } else if (winner.value !== undefined) {
      return fail(`${at}.winner`, "an expired contest has no winner");
    }
  }
  return ok([
    key.value,
    {
      id: id.value,
      opener,
      rival,
      place: place.value,
      cause: cause.value,
      openedTick: openedTick.value,
      openedSequence: openedSequence.value,
      closesAt: closesAt.value,
      ...(succeeds.value === undefined ? {} : { succeeds: succeeds.value }),
      status: status.value,
      tallies: tallies.value,
      ...(closedTick.value === undefined
        ? {}
        : { closedTick: closedTick.value }),
      ...(closedSequence.value === undefined
        ? {}
        : { closedSequence: closedSequence.value }),
      ...(reason.value === undefined ? {} : { reason: reason.value }),
      ...(winner.value === undefined ? {} : { winner: winner.value }),
    },
  ] as const);
}

function parseServiceAct(
  value: unknown,
  path: string,
  knownActorIds: ReadonlySet<EntityId>,
  knownLocationIds: ReadonlySet<EntityId>,
): ParseResult<ServiceAct> {
  if (!isRecord(value)) return fail(path, "expected a service act");
  const id = parseEventId(value.id, `${path}.id`);
  if (!id.ok) return id;
  const kind = parseEnum(value.kind, `${path}.kind`, SERVICE_KINDS);
  if (!kind.ok) return kind;
  const god = parseEntityId(value.god, `${path}.god`);
  if (!god.ok) return god;
  if (!knownActorIds.has(god.value)) {
    return fail(`${path}.god`, `act names unknown actor: ${god.value}`);
  }
  const place = parseEntityId(value.place, `${path}.place`);
  if (!place.ok) return place;
  if (!knownLocationIds.has(place.value)) {
    return fail(`${path}.place`, `act is at unknown place: ${place.value}`);
  }
  const tick = parseNonNegativeInteger(value.tick, `${path}.tick`);
  if (!tick.ok) return tick;
  const sequence = parseNonNegativeInteger(value.sequence, `${path}.sequence`);
  if (!sequence.ok) return sequence;
  const people = (field: "reached" | "perceivedBy") =>
    parseArray(value[field], `${path}.${field}`, (item, at) => {
      const actor = parseEntityId(item, at);
      if (!actor.ok) return actor;
      if (!knownActorIds.has(actor.value)) {
        return fail(at, `act names unknown actor: ${actor.value}`);
      }
      return actor;
    });
  const reached = people("reached");
  if (!reached.ok) return reached;
  if (reached.value.length === 0) {
    return fail(`${path}.reached`, "an act the world keeps reached someone");
  }
  const perceivedBy = people("perceivedBy");
  if (!perceivedBy.ok) return perceivedBy;
  return ok({
    id: id.value,
    kind: kind.value,
    god: god.value,
    place: place.value,
    tick: tick.value,
    sequence: sequence.value,
    reached: reached.value,
    perceivedBy: perceivedBy.value,
  });
}

function parseStandingEntry(
  value: unknown,
  path: string,
  knownActorIds: ReadonlySet<EntityId>,
  knownLocationIds: ReadonlySet<EntityId>,
): ParseResult<readonly [EntityId, EntityId, number]> {
  if (!Array.isArray(value) || value.length !== 3) {
    return fail(path, "expected a [god, place, standing] entry");
  }
  const god = parseEntityId(value[0], `${path}[0]`);
  if (!god.ok) return god;
  if (!knownActorIds.has(god.value)) {
    return fail(`${path}[0]`, `standing names unknown god: ${god.value}`);
  }
  const place = parseEntityId(value[1], `${path}[1]`);
  if (!place.ok) return place;
  if (!knownLocationIds.has(place.value)) {
    return fail(`${path}[1]`, `standing is at unknown place: ${place.value}`);
  }
  const amount = value[2];
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount === 0) {
    return fail(`${path}[2]`, "expected a nonzero whole number");
  }
  return ok([god.value, place.value, amount] as const);
}

function parseThreadEntry(
  value: unknown,
  path: string,
  knownActorIds: ReadonlySet<EntityId>,
): ParseResult<readonly [EventId, PracticeThread]> {
  if (!Array.isArray(value) || value.length !== 2) {
    return fail(path, "expected an [id, thread] entry");
  }
  const key = parseEventId(value[0], `${path}[0]`);
  if (!key.ok) return key;
  const record = value[1];
  if (!isRecord(record)) return fail(`${path}[1]`, "expected a thread");
  const at = `${path}[1]`;
  const id = parseEventId(record.id, `${at}.id`);
  if (!id.ok) return id;
  if (id.value !== key.value) {
    return fail(
      `${path}[0]`,
      `entry key "${key.value}" does not match its own id`,
    );
  }
  const practice = parseEnum(record.practice, `${at}.practice`, PRACTICE_KINDS);
  if (!practice.ok) return practice;
  const actors: EntityId[] = [];
  for (const field of ["demander", "obligated", "offeredBy"] as const) {
    const actor = parseEntityId(record[field], `${at}.${field}`);
    if (!actor.ok) return actor;
    if (!knownActorIds.has(actor.value)) {
      return fail(
        `${at}.${field}`,
        `thread names unknown actor: ${actor.value}`,
      );
    }
    actors.push(actor.value);
  }
  const [demander, obligated, offeredBy] = actors as [
    EntityId,
    EntityId,
    EntityId,
  ];
  if (demander === obligated) {
    return fail(at, "a thread is between two gods, not one");
  }
  if (offeredBy !== demander && offeredBy !== obligated) {
    return fail(`${at}.offeredBy`, "an offer is made by a party to the thread");
  }
  const causes = parseArray(record.causes, `${at}.causes`, parseEventId);
  if (!causes.ok) return causes;
  if (causes.value.length === 0) {
    return fail(`${at}.causes`, "a thread rests on at least one cause");
  }
  const term = parsePracticeTerm(record.term, `${at}.term`);
  if (!term.ok) return term;
  for (const party of [
    term.value.party,
    ...(term.value.kind === "give-resource" || term.value.kind === "ally"
      ? [term.value.to]
      : []),
  ]) {
    if (!knownActorIds.has(party)) {
      return fail(`${at}.term`, `term names unknown actor: ${party}`);
    }
  }
  const subject = parseThreadSubject(record.subject, `${at}.subject`);
  if (!subject.ok) return subject;
  if (subject.value !== undefined && !knownActorIds.has(subject.value.agent)) {
    return fail(
      `${at}.subject`,
      `subject names unknown actor: ${subject.value.agent}`,
    );
  }
  const offers = parseArray(record.offers, `${at}.offers`, parseString);
  if (!offers.ok) return offers;
  if (offers.value.length === 0) {
    return fail(
      `${at}.offers`,
      "a thread has had at least its demand on the table",
    );
  }
  const petition =
    record.petition === undefined
      ? ok<EventId | undefined>(undefined)
      : parseEventId(record.petition, `${at}.petition`);
  if (!petition.ok) return petition;
  if ((practice.value === "supplication") !== (petition.value !== undefined)) {
    return fail(
      `${at}.petition`,
      "a supplication names the prayer it answers, and a settlement names none",
    );
  }
  let progress: PracticeThread["progress"];
  if (record.progress !== undefined) {
    if (!isRecord(record.progress) || petition.value === undefined) {
      return fail(`${at}.progress`, "only a supplication has progress");
    }
    const boon =
      record.progress.boon === undefined
        ? ok<EventId | undefined>(undefined)
        : parseEventId(record.progress.boon, `${at}.progress.boon`);
    if (!boon.ok) return boon;
    const offering =
      record.progress.offering === undefined
        ? ok<EventId | undefined>(undefined)
        : parseEventId(record.progress.offering, `${at}.progress.offering`);
    if (!offering.ok) return offering;
    progress = {
      ...(boon.value === undefined ? {} : { boon: boon.value }),
      ...(offering.value === undefined ? {} : { offering: offering.value }),
    };
  }
  const status = parseEnum(record.status, `${at}.status`, PRACTICE_STATUSES);
  if (!status.ok) return status;
  const openedTick = parseNonNegativeInteger(
    record.openedTick,
    `${at}.openedTick`,
  );
  if (!openedTick.ok) return openedTick;
  const openedSequence = parseNonNegativeInteger(
    record.openedSequence,
    `${at}.openedSequence`,
  );
  if (!openedSequence.ok) return openedSequence;
  const negotiationDeadline = parseNonNegativeInteger(
    record.negotiationDeadline,
    `${at}.negotiationDeadline`,
  );
  if (!negotiationDeadline.ok) return negotiationDeadline;
  const counterBudgetLeft = parseNonNegativeInteger(
    record.counterBudgetLeft,
    `${at}.counterBudgetLeft`,
  );
  if (!counterBudgetLeft.ok) return counterBudgetLeft;
  const revision = parseNonNegativeInteger(record.revision, `${at}.revision`);
  if (!revision.ok) return revision;

  let acceptance: PracticeThread["acceptance"];
  if (record.acceptance !== undefined) {
    if (!isRecord(record.acceptance)) {
      return fail(`${at}.acceptance`, "expected an acceptance");
    }
    const tick = parseNonNegativeInteger(
      record.acceptance.tick,
      `${at}.acceptance.tick`,
    );
    if (!tick.ok) return tick;
    const sequence = parseNonNegativeInteger(
      record.acceptance.sequence,
      `${at}.acceptance.sequence`,
    );
    if (!sequence.ok) return sequence;
    const sworn = parseBoolean(
      record.acceptance.sworn,
      `${at}.acceptance.sworn`,
    );
    if (!sworn.ok) return sworn;
    acceptance = {
      tick: tick.value,
      sequence: sequence.value,
      sworn: sworn.value,
    };
  }
  const stake =
    record.stake === undefined
      ? ok<Transformation | undefined>(undefined)
      : parseTransformation(record.stake, `${at}.stake`);
  if (!stake.ok) return stake;
  const closedTick =
    record.closedTick === undefined
      ? ok<number | undefined>(undefined)
      : parseNonNegativeInteger(record.closedTick, `${at}.closedTick`);
  if (!closedTick.ok) return closedTick;
  const successor =
    record.successor === undefined
      ? ok<EventId | undefined>(undefined)
      : parseEventId(record.successor, `${at}.successor`);
  if (!successor.ok) return successor;

  // The status says what the thread must hold: an acceptance from the moment it
  // is accepted (and kept to a fulfilment or a breach), a closing tick once it
  // has ended, and neither before.
  const ended = !["open", "countered", "accepted"].includes(status.value);
  const needsAcceptance =
    status.value === "accepted" ||
    status.value === "fulfilled" ||
    status.value === "breached";
  const forbidsAcceptance =
    status.value === "open" || status.value === "countered";
  if (
    (needsAcceptance && acceptance === undefined) ||
    (forbidsAcceptance && acceptance !== undefined) ||
    (ended && closedTick.value === undefined) ||
    (!ended && closedTick.value !== undefined)
  ) {
    return fail(
      at,
      `a ${status.value} thread has the wrong acceptance or closing tick for its status`,
    );
  }
  return ok([
    key.value,
    {
      id: id.value,
      practice: practice.value,
      demander,
      obligated,
      causes: causes.value,
      term: term.value,
      ...(subject.value === undefined ? {} : { subject: subject.value }),
      ...(petition.value === undefined ? {} : { petition: petition.value }),
      ...(progress === undefined ? {} : { progress }),
      offers: offers.value,
      ...(stake.value === undefined ? {} : { stake: stake.value }),
      offeredBy,
      status: status.value,
      openedTick: openedTick.value,
      openedSequence: openedSequence.value,
      negotiationDeadline: negotiationDeadline.value,
      counterBudgetLeft: counterBudgetLeft.value,
      ...(acceptance === undefined ? {} : { acceptance }),
      ...(closedTick.value === undefined
        ? {}
        : { closedTick: closedTick.value }),
      ...(successor.value === undefined ? {} : { successor: successor.value }),
      revision: revision.value,
    },
  ] as const);
}

function parseNeedEntry(
  value: unknown,
  path: string,
  knownActorIds: ReadonlySet<EntityId>,
): ParseResult<readonly [string, OpenNeed]> {
  if (!Array.isArray(value) || value.length !== 2) {
    return fail(path, "expected a [key, need] entry");
  }
  const key = parseString(value[0], `${path}[0]`);
  if (!key.ok) return key;
  const record = value[1];
  if (!isRecord(record)) return fail(`${path}[1]`, "expected a need");
  const actor = parseEntityId(record.actor, `${path}[1].actor`);
  if (!actor.ok) return actor;
  if (!knownActorIds.has(actor.value)) {
    return fail(`${path}[1]`, `need belongs to unknown actor: ${actor.value}`);
  }
  const resource = parseString(record.resource, `${path}[1].resource`);
  if (!resource.ok) return resource;
  if (key.value !== needKey(actor.value, resource.value)) {
    return fail(
      `${path}[0]`,
      `entry key "${key.value}" does not match its own need`,
    );
  }
  const reason = parseEnum(
    record.reason,
    `${path}[1].reason`,
    UNMET_NEED_REASONS,
  );
  if (!reason.ok) return reason;
  const eventId = parseEventId(record.eventId, `${path}[1].eventId`);
  if (!eventId.ok) return eventId;
  const tick = parseNonNegativeInteger(record.tick, `${path}[1].tick`);
  if (!tick.ok) return tick;
  return ok([
    key.value,
    {
      actor: actor.value,
      resource: resource.value,
      reason: reason.value,
      eventId: eventId.value,
      tick: tick.value,
    },
  ] as const);
}

function parseRelationshipEntry(
  value: unknown,
  path: string,
  knownActorIds: ReadonlySet<EntityId>,
): ParseResult<readonly [string, RelationshipState]> {
  if (!Array.isArray(value) || value.length !== 2) {
    return fail(path, "expected a [key, relationship] entry");
  }
  const key = parseString(value[0], `${path}[0]`);
  if (!key.ok) return key;
  const record = value[1];
  if (!isRecord(record)) return fail(`${path}[1]`, "expected a relationship");
  const from = parseEntityId(record.from, `${path}[1].from`);
  if (!from.ok) return from;
  const toward = parseEntityId(record.toward, `${path}[1].toward`);
  if (!toward.ok) return toward;
  for (const actor of [from.value, toward.value]) {
    if (!knownActorIds.has(actor)) {
      return fail(
        `${path}[1]`,
        `relationship references unknown actor: ${actor}`,
      );
    }
  }
  if (key.value !== relationshipKey(from.value, toward.value)) {
    return fail(
      `${path}[0]`,
      `entry key "${key.value}" does not match its own actors`,
    );
  }
  const affinity = record.affinity;
  if (typeof affinity !== "number" || !Number.isInteger(affinity)) {
    return fail(`${path}[1].affinity`, "expected an integer");
  }
  const grudge = parseNonNegativeInteger(record.grudge, `${path}[1].grudge`);
  if (!grudge.ok) return grudge;
  const allied = parseBoolean(record.allied, `${path}[1].allied`);
  if (!allied.ok) return allied;
  return ok([
    key.value,
    {
      from: from.value,
      toward: toward.value,
      affinity,
      grudge: grudge.value,
      allied: allied.value,
    },
  ] as const);
}

function parseWrongEntry(
  value: unknown,
  path: string,
  knownActorIds: ReadonlySet<EntityId>,
): ParseResult<readonly [EventId, WrongRecord]> {
  if (!Array.isArray(value) || value.length !== 2) {
    return fail(path, "expected an [id, wrong] entry");
  }
  const key = parseEventId(value[0], `${path}[0]`);
  if (!key.ok) return key;
  const record = value[1];
  if (!isRecord(record)) return fail(`${path}[1]`, "expected a wrong");
  const id = parseEventId(record.id, `${path}[1].id`);
  if (!id.ok) return id;
  if (id.value !== key.value) {
    return fail(
      `${path}[0]`,
      `entry key "${key.value}" does not match its own id`,
    );
  }
  const wrongdoer = parseEntityId(record.wrongdoer, `${path}[1].wrongdoer`);
  if (!wrongdoer.ok) return wrongdoer;
  const victim = parseEntityId(record.victim, `${path}[1].victim`);
  if (!victim.ok) return victim;
  for (const actor of [wrongdoer.value, victim.value]) {
    if (!knownActorIds.has(actor)) {
      return fail(`${path}[1]`, `wrong names unknown actor: ${actor}`);
    }
  }
  const kind = parseEnum(record.kind, `${path}[1].kind`, WRONG_KINDS);
  if (!kind.ok) return kind;
  const tick = parseNonNegativeInteger(record.tick, `${path}[1].tick`);
  if (!tick.ok) return tick;
  const revenge = parseOptionalEventIdField(
    record.revenge,
    `${path}[1].revenge`,
  );
  if (!revenge.ok) return revenge;
  const avenged = parseOptionalEventIdField(
    record.avenged,
    `${path}[1].avenged`,
  );
  if (!avenged.ok) return avenged;
  return ok([
    key.value,
    {
      id: id.value,
      wrongdoer: wrongdoer.value,
      victim: victim.value,
      kind: kind.value,
      tick: tick.value,
      ...(revenge.value === undefined ? {} : { revenge: revenge.value }),
      ...(avenged.value === undefined ? {} : { avenged: avenged.value }),
    },
  ] as const);
}

function parseOptionalEventIdField(
  value: unknown,
  path: string,
): ParseResult<EventId | undefined> {
  return value === undefined
    ? ok<EventId | undefined>(undefined)
    : parseEventId(value, path);
}

function parseResourceAmountField(
  value: unknown,
  path: string,
): ParseResult<{ readonly resource: string; readonly amount: number }> {
  if (!isRecord(value)) return fail(path, "expected a resource amount");
  const resource = parseString(value.resource, `${path}.resource`);
  if (!resource.ok) return resource;
  const amount = parseNonNegativeInteger(value.amount, `${path}.amount`);
  if (!amount.ok) return amount;
  if (amount.value < 1)
    return fail(`${path}.amount`, "expected a positive integer");
  return ok({ resource: resource.value, amount: amount.value });
}

function parseCreditEntry(
  value: unknown,
  path: string,
  knownActorIds: ReadonlySet<EntityId>,
): ParseResult<readonly [EventId, Credit]> {
  if (!Array.isArray(value) || value.length !== 2) {
    return fail(path, "expected an [id, credit] entry");
  }
  const key = parseEventId(value[0], `${path}[0]`);
  if (!key.ok) return key;
  const record = value[1];
  if (!isRecord(record)) return fail(`${path}[1]`, "expected a credit");
  const id = parseEventId(record.id, `${path}[1].id`);
  if (!id.ok) return id;
  if (id.value !== key.value) {
    return fail(
      `${path}[0]`,
      `entry key "${key.value}" does not match its own id`,
    );
  }
  const seller = parseEntityId(record.seller, `${path}[1].seller`);
  if (!seller.ok) return seller;
  const buyer = parseEntityId(record.buyer, `${path}[1].buyer`);
  if (!buyer.ok) return buyer;
  for (const actor of [seller.value, buyer.value]) {
    if (!knownActorIds.has(actor)) {
      return fail(`${path}[1]`, `credit names unknown actor: ${actor}`);
    }
  }
  const goods = parseResourceAmountField(record.goods, `${path}[1].goods`);
  if (!goods.ok) return goods;
  const price = parseResourceAmountField(record.price, `${path}[1].price`);
  if (!price.ok) return price;
  const deferred = parseEnum(record.deferred, `${path}[1].deferred`, [
    "payment",
    "delivery",
  ] as const);
  if (!deferred.ok) return deferred;
  const deadline = parseNonNegativeInteger(
    record.deadline,
    `${path}[1].deadline`,
  );
  if (!deadline.ok) return deadline;
  const status = parseEnum(record.status, `${path}[1].status`, [
    "open",
    "settled",
    "defaulted",
  ] as const);
  if (!status.ok) return status;
  return ok([
    key.value,
    {
      id: id.value,
      seller: seller.value,
      buyer: buyer.value,
      goods: goods.value,
      price: price.value,
      deferred: deferred.value,
      deadline: deadline.value,
      status: status.value,
    },
  ] as const);
}

function parseNumberRecord(
  value: unknown,
  path: string,
): ParseResult<Readonly<Record<string, number>>> {
  if (!isRecord(value)) return fail(path, "expected a numeric record");
  const record: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      return fail(`${path}.${key}`, "expected a finite number");
    }
    record[key] = entry;
  }
  return ok(record);
}

function parseEncodedWorldState(value: unknown): ParseResult<WorldState> {
  if (!isRecord(value)) {
    return fail("", "expected a world state object");
  }
  const tick = parseNonNegativeInteger(value.tick, "tick");
  if (!tick.ok) return tick;
  const simTime = parseNonNegativeNumber(value.simTime, "simTime");
  if (!simTime.ok) return simTime;
  const lastSequence = parseNonNegativeInteger(
    value.lastSequence,
    "lastSequence",
  );
  if (!lastSequence.ok) return lastSequence;

  const locationEntries = parseArray(
    value.locations,
    "locations",
    parseLocationEntry,
  );
  if (!locationEntries.ok) return locationEntries;
  const duplicateLocationKey = findDuplicateKey(locationEntries.value);
  if (duplicateLocationKey !== undefined) {
    return fail("locations", `duplicate location id: ${duplicateLocationKey}`);
  }
  const locations = new Map(locationEntries.value);

  const knownLocationIds = new Set(locations.keys());
  for (const [index, [, location]] of locationEntries.value.entries()) {
    for (const [edgeIndex, edge] of location.edges.entries()) {
      if (!knownLocationIds.has(edge.to as EntityId)) {
        return fail(
          `locations[${index}].edges[${edgeIndex}].to`,
          `edge targets unknown location: ${edge.to}`,
        );
      }
    }
  }

  const actorEntries = parseArray(value.actors, "actors", (item, path) =>
    parseActorEntry(item, path, knownLocationIds),
  );
  if (!actorEntries.ok) return actorEntries;
  const duplicateActorKey = findDuplicateKey(actorEntries.value);
  if (duplicateActorKey !== undefined) {
    return fail("actors", `duplicate actor id: ${duplicateActorKey}`);
  }
  const actors = new Map(actorEntries.value);
  const knownActorIds = new Set(actors.keys());

  const buildingEntries = parseArray(
    value.buildings,
    "buildings",
    (item, path) =>
      parseBuildingEntry(item, path, knownLocationIds, knownActorIds),
  );
  if (!buildingEntries.ok) return buildingEntries;
  const duplicateBuildingKey = findDuplicateKey(buildingEntries.value);
  if (duplicateBuildingKey !== undefined) {
    return fail("buildings", `duplicate building id: ${duplicateBuildingKey}`);
  }
  const buildings = new Map(buildingEntries.value);

  const legendEntries = parseArray(value.legends, "legends", parseLegendEntry);
  if (!legendEntries.ok) return legendEntries;
  const duplicateLegendKey = findDuplicateKey(legendEntries.value);
  if (duplicateLegendKey !== undefined) {
    return fail("legends", `duplicate legend id: ${duplicateLegendKey}`);
  }
  const legends = new Map(legendEntries.value);

  const memoryEntries = parseArray(value.memories, "memories", (item, path) =>
    parseMemoryEntries(item, path, knownActorIds),
  );
  if (!memoryEntries.ok) return memoryEntries;
  const duplicateMemoryOwner = findDuplicateKey(memoryEntries.value);
  if (duplicateMemoryOwner !== undefined) {
    return fail("memories", `duplicate memory owner: ${duplicateMemoryOwner}`);
  }
  const memories = new Map(memoryEntries.value);

  const relationshipEntries = parseArray(
    value.relationships,
    "relationships",
    (item, path) => parseRelationshipEntry(item, path, knownActorIds),
  );
  if (!relationshipEntries.ok) return relationshipEntries;
  const duplicateRelationship = findDuplicateKey(relationshipEntries.value);
  if (duplicateRelationship !== undefined) {
    return fail(
      "relationships",
      `duplicate relationship: ${duplicateRelationship}`,
    );
  }
  const relationships = new Map(relationshipEntries.value);

  const wrongEntries = parseArray(value.wrongs, "wrongs", (item, path) =>
    parseWrongEntry(item, path, knownActorIds),
  );
  if (!wrongEntries.ok) return wrongEntries;
  const duplicateWrong = findDuplicateKey(wrongEntries.value);
  if (duplicateWrong !== undefined) {
    return fail("wrongs", `duplicate wrong: ${duplicateWrong}`);
  }
  const wrongs = new Map(wrongEntries.value);

  const creditEntries = parseArray(value.credits, "credits", (item, path) =>
    parseCreditEntry(item, path, knownActorIds),
  );
  if (!creditEntries.ok) return creditEntries;
  const duplicateCredit = findDuplicateKey(creditEntries.value);
  if (duplicateCredit !== undefined) {
    return fail("credits", `duplicate credit: ${duplicateCredit}`);
  }
  const credits = new Map(creditEntries.value);

  const patronEntries = parseArray(value.patrons, "patrons", (item, path) => {
    if (!Array.isArray(item) || item.length !== 2) {
      return fail(path, "expected a [mortal, patron] entry");
    }
    const mortal = parseEntityId(item[0], `${path}[0]`);
    if (!mortal.ok) return mortal;
    const patron = parseEntityId(item[1], `${path}[1]`);
    if (!patron.ok) return patron;
    if (!actors.has(mortal.value)) {
      return fail(`${path}[0]`, `patron of unknown actor: ${mortal.value}`);
    }
    if (actors.get(mortal.value)?.isDeity === true) {
      return fail(`${path}[0]`, `${mortal.value} is a god, and has no patron`);
    }
    if (actors.get(patron.value)?.isDeity !== true) {
      return fail(`${path}[1]`, `${patron.value} is not a god`);
    }
    return ok([mortal.value, patron.value] as const);
  });
  if (!patronEntries.ok) return patronEntries;
  const duplicatePatron = findDuplicateKey(patronEntries.value);
  if (duplicatePatron !== undefined) {
    return fail("patrons", `duplicate patron for: ${duplicatePatron}`);
  }
  const patrons = new Map(patronEntries.value);

  const goalEntries = parseArray(value.goals, "goals", (item, path) =>
    parseGoalEntry(item, path, knownActorIds),
  );
  if (!goalEntries.ok) return goalEntries;
  const duplicateGoalOwner = findDuplicateKey(goalEntries.value);
  if (duplicateGoalOwner !== undefined) {
    return fail("goals", `duplicate goal owner: ${duplicateGoalOwner}`);
  }
  const goals = new Map(goalEntries.value);

  const journeyEntries = parseArray(value.journeys, "journeys", (item, path) =>
    parseJourneyEntry(item, path, knownActorIds, knownLocationIds),
  );
  if (!journeyEntries.ok) return journeyEntries;
  const duplicateJourneyOwner = findDuplicateKey(journeyEntries.value);
  if (duplicateJourneyOwner !== undefined) {
    return fail(
      "journeys",
      `duplicate journey owner: ${duplicateJourneyOwner}`,
    );
  }
  const journeys = new Map(journeyEntries.value);

  const needEntries = parseArray(value.needs, "needs", (item, path) =>
    parseNeedEntry(item, path, knownActorIds),
  );
  if (!needEntries.ok) return needEntries;
  const duplicateNeed = findDuplicateKey(needEntries.value);
  if (duplicateNeed !== undefined) {
    return fail("needs", `duplicate need: ${duplicateNeed}`);
  }
  const needs = new Map(needEntries.value);

  const causeEntries = parseArray(value.causes, "causes", (item, path) =>
    parseCauseEntry(item, path, knownActorIds),
  );
  if (!causeEntries.ok) return causeEntries;
  const duplicateCauseOwner = findDuplicateKey(causeEntries.value);
  if (duplicateCauseOwner !== undefined) {
    return fail("causes", `duplicate cause owner: ${duplicateCauseOwner}`);
  }
  const causes = new Map(causeEntries.value);

  const petitionEntries = parseArray(
    value.petitions,
    "petitions",
    (item, path) => parsePetitionEntry(item, path, knownActorIds),
  );
  if (!petitionEntries.ok) return petitionEntries;
  const duplicatePetition = findDuplicateKey(petitionEntries.value);
  if (duplicatePetition !== undefined) {
    return fail("petitions", `duplicate petition: ${duplicatePetition}`);
  }
  const petitions = new Map(petitionEntries.value);

  const threadEntries = parseArray(value.threads, "threads", (item, path) =>
    parseThreadEntry(item, path, knownActorIds),
  );
  if (!threadEntries.ok) return threadEntries;
  const duplicateThread = findDuplicateKey(threadEntries.value);
  if (duplicateThread !== undefined) {
    return fail("threads", `duplicate thread: ${duplicateThread}`);
  }
  const threads = new Map(threadEntries.value);

  const contestEntries = parseArray(value.contests, "contests", (item, path) =>
    parseContestEntry(item, path, knownActorIds, knownLocationIds),
  );
  if (!contestEntries.ok) return contestEntries;
  const duplicateContest = findDuplicateKey(contestEntries.value);
  if (duplicateContest !== undefined) {
    return fail("contests", `duplicate contest: ${duplicateContest}`);
  }
  const contests = new Map(contestEntries.value);

  const services = parseArray(value.services, "services", (item, path) =>
    parseServiceAct(item, path, knownActorIds, knownLocationIds),
  );
  if (!services.ok) return services;

  const standingEntries = parseArray(value.standing, "standing", (item, path) =>
    parseStandingEntry(item, path, knownActorIds, knownLocationIds),
  );
  if (!standingEntries.ok) return standingEntries;
  const standingMap = new Map<EntityId, Map<EntityId, number>>();
  for (const [index, [god, place, amount]] of standingEntries.value.entries()) {
    const places = standingMap.get(god) ?? new Map<EntityId, number>();
    if (places.has(place)) {
      return fail(
        `standing[${index}]`,
        `duplicate standing: ${god} at ${place}`,
      );
    }
    places.set(place, amount);
    standingMap.set(god, places);
  }
  const standing: ReadonlyMap<
    EntityId,
    ReadonlyMap<EntityId, number>
  > = standingMap;

  const grantEntries = parseArray(
    value.repairGrants,
    "repairGrants",
    (item, path) => {
      if (!Array.isArray(item) || item.length !== 2) {
        return fail(path, "expected a [recipient, building] entry");
      }
      const recipient = parseEntityId(item[0], `${path}[0]`);
      if (!recipient.ok) return recipient;
      if (!knownActorIds.has(recipient.value)) {
        return fail(`${path}[0]`, `grant to unknown actor: ${recipient.value}`);
      }
      const building = parseEntityId(item[1], `${path}[1]`);
      if (!building.ok) return building;
      if (!buildings.has(building.value)) {
        return fail(
          `${path}[1]`,
          `grant names unknown building: ${building.value}`,
        );
      }
      return ok([recipient.value, building.value] as const);
    },
  );
  if (!grantEntries.ok) return grantEntries;
  const repairGrants = new Map(grantEntries.value);

  const noticedEntries = parseArray(value.noticed, "noticed", (item, path) => {
    if (!Array.isArray(item) || item.length !== 2) {
      return fail(path, "expected a [key, loss] entry");
    }
    const key = parseString(item[0], `${path}[0]`);
    if (!key.ok) return key;
    const record = item[1];
    if (!isRecord(record)) return fail(`${path}[1]`, "expected a loss");
    const owner = parseEntityId(record.owner, `${path}[1].owner`);
    if (!owner.ok) return owner;
    if (!knownActorIds.has(owner.value)) {
      return fail(
        `${path}[1]`,
        `loss belongs to unknown actor: ${owner.value}`,
      );
    }
    const causeEventId = parseEventId(
      record.causeEventId,
      `${path}[1].causeEventId`,
    );
    if (!causeEventId.ok) return causeEventId;
    const eventId = parseEventId(record.eventId, `${path}[1].eventId`);
    if (!eventId.ok) return eventId;
    if (key.value !== noticedKey(owner.value, causeEventId.value)) {
      return fail(
        `${path}[0]`,
        `entry key "${key.value}" does not match its own loss`,
      );
    }
    return ok([
      key.value,
      {
        owner: owner.value,
        causeEventId: causeEventId.value,
        eventId: eventId.value,
      },
    ] as const);
  });
  if (!noticedEntries.ok) return noticedEntries;
  const noticed = new Map(noticedEntries.value);

  if (!isRecord(value.director)) {
    return fail("director", "expected the director's state");
  }
  const lastConsequentialTick = parseNonNegativeInteger(
    value.director.lastConsequentialTick,
    "director.lastConsequentialTick",
  );
  if (!lastConsequentialTick.ok) return lastConsequentialTick;
  const director = { lastConsequentialTick: lastConsequentialTick.value };

  const rules = parseWorldRules(value.rules, "rules");
  if (!rules.ok) return rules;
  for (const [kind, god] of Object.entries(rules.value.troubleKinds ?? {})) {
    if (actors.get(god as EntityId)?.isDeity !== true) {
      return fail(
        `rules.troubleKinds.${kind}`,
        `trouble "${kind}" belongs to ${god}, who is not a god in this world`,
      );
    }
  }

  // Only events forget and only events feel, so a stored world holds what its
  // own rules allow: no actor remembers more than the capacity, and no
  // relationship is beyond its limits.
  const capacity = memoryBalanceOf(rules.value, "capacity");
  for (const [owner, list] of memories) {
    if (list.length > capacity) {
      return fail(
        "memories",
        `${owner} holds ${list.length} memories, over the world's capacity of ${capacity}`,
      );
    }
  }
  const affinityLimit = memoryBalanceOf(rules.value, "affinityLimit");
  const grudgeLimit = memoryBalanceOf(rules.value, "grudgeLimit");
  for (const [key, relationship] of relationships) {
    if (Math.abs(relationship.affinity) > affinityLimit) {
      return fail(
        "relationships",
        `${key} has affinity ${relationship.affinity}, beyond the world's limit of ${affinityLimit}`,
      );
    }
    if (relationship.grudge > grudgeLimit) {
      return fail(
        "relationships",
        `${key} has grudge ${relationship.grudge}, beyond the world's limit of ${grudgeLimit}`,
      );
    }
  }

  // Standing is held within the same limit: a stored world holds what its own rules allow.
  for (const [god, places] of standing) {
    for (const [place, amount] of places) {
      if (Math.abs(amount) > affinityLimit) {
        return fail(
          "standing",
          `${god} has standing ${amount} at ${place}, beyond the world's limit of ${affinityLimit}`,
        );
      }
    }
  }

  const recipes = parseRecipes(value.recipes, "recipes");
  if (!recipes.ok) return recipes;

  return ok({
    tick: tick.value,
    simTime: simTime.value,
    lastSequence: lastSequence.value,
    locations,
    actors,
    buildings,
    legends,
    memories,
    relationships,
    wrongs,
    credits,
    patrons,
    goals,
    journeys,
    needs,
    causes,
    petitions,
    threads,
    contests,
    services: services.value,
    standing,
    repairGrants,
    noticed,
    director,
    rules: rules.value,
    recipes: recipes.value,
  });
}

/**
 * Decodes a value out of storage back into a live `WorldState`. Parses
 * rather than casts: `value` is untrusted (persistence's own JSON column,
 * or an imported archive's), so every field, entry shape, and cross-entity
 * reference (an actor's or building's `locationId`, a building's `owner`, a
 * location's `realm`) is checked. Throws `WorldStateDecodeError` on the
 * first failure, matching `ProjectionCodec.decode`'s throw-on-failure
 * contract.
 */
export function decode(value: unknown): WorldState {
  const parsed = parseEncodedWorldState(value);
  if (!parsed.ok) {
    throw new WorldStateDecodeError(parsed.path, parsed.reason, parsed.message);
  }
  return parsed.value;
}
