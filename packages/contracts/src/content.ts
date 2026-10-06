// Authored world content (content/greek/world/*.json): realms, locations
// and edges, buildings, inhabitants, the resource graph, and numeric
// rules. Content ids are plain strings (authoring-time keys), not branded
// EntityId values -- packages/world mints live EntityIds when it
// instantiates a pack. Invalid content fails loudly at load, so every
// field here is parsed, never assumed.

import { WITNESSED_EVENT_KINDS } from "./event";
import {
  fail,
  isRecord,
  ok,
  type ParseResult,
  parseArray,
  parseBoolean,
  parseEnum,
  parseFiniteNumber,
  parseNonNegativeInteger,
  parseNonNegativeNumber,
  parseOptionalBoolean,
  parseOptionalString,
  parseResourceAmount,
  parseSchemaVersion,
  parseString,
  type ResourceAmount,
} from "./ids";
import { parseTransformation, type Transformation } from "./practice";

export const CONTENT_SCHEMA_VERSIONS = [1] as const;

export const REALMS = ["mortal", "olympus", "underworld"] as const;
export type Realm = (typeof REALMS)[number];

export const TRANSPORT_KINDS = ["path", "portal", "divine-transport"] as const;
export type TransportKind = (typeof TRANSPORT_KINDS)[number];

export interface LocationEdge {
  readonly to: string;
  readonly transport: TransportKind;
  readonly bidirectional: boolean;
}

export interface Location {
  readonly id: string;
  readonly realm: Realm;
  readonly name: string;
  readonly edges: readonly LocationEdge[];
  /**
   * Capability an actor must hold to enter this location, optional and
   * additive: gates both `move` and `realm-transition` proposals whose
   * destination names this location, so a restricted destination (e.g. a
   * divine-only sanctum) rejects entry with reason `restricted-realm`
   * distinctly from a plain adjacency failure. Absent means unrestricted.
   */
  readonly requiredCapability?: string;
}

export interface Building {
  readonly id: string;
  readonly locationId: string;
  readonly name: string;
  readonly material: string;
  /** Whether fire can spread to and ignite this building; a non-combustible building (e.g. stone) never catches fire. */
  readonly combustible: boolean;
  readonly services: readonly string[];
  readonly inventory: readonly ResourceAmount[];
  readonly owner?: string;
}

export interface InhabitantDrives {
  readonly thrift: number;
  readonly appetite: number;
  readonly greed: number;
  readonly piety: number;
}

export interface Inhabitant {
  readonly id: string;
  readonly name: string;
  readonly locationId: string;
  /** Drive weights that make this inhabitant's routine choices deterministic. Absent means it never runs a routine -- a fixture-only actor (e.g. a deity), never `packages/world/src/routines.ts`. */
  readonly drives?: InhabitantDrives;
  /** The resource this inhabitant gathers when no more pressing action is eligible. Absent means it never gathers. */
  readonly gathers?: string;
  /** A resource this inhabitant seeks to buy when it lacks some and can afford it. Absent means it wants nothing in particular. */
  readonly wants?: string;
  /** Whether this inhabitant is a deity, authorized to be worshipped and to strike. Absent means it is not. */
  readonly deity?: boolean;
  /** Inventory this inhabitant holds at genesis. Absent means it starts with nothing. */
  readonly startingInventory?: readonly ResourceAmount[];
  /**
   * The god a mortal belongs to: its patron. It starts with `affinity` toward
   * `god`, and every prayer about a wrong, a harm, or a need goes to the patron;
   * only a recorded defection changes it. Every mortal has one, and a god prays
   * to no one, so a god has none.
   */
  readonly devotion?: Devotion;
  /**
   * The gods this god contests with for a place's people (ids of other deities in the pack). A rivalry
   * holds both ways: either god naming the other lets a contest open between them. Only a god has rivals.
   * Absent means none, so the god contests no one.
   */
  readonly rivals?: readonly string[];
}

/** A mortal's starting reverence for one god. */
export interface Devotion {
  readonly god: string;
  /** Whole number from 1 to the pack's affinity limit: the affinity the mortal starts with toward the god. */
  readonly affinity: number;
}

export interface Recipe {
  readonly inputs: readonly ResourceAmount[];
  readonly outputs: readonly ResourceAmount[];
}

export interface WorldRules {
  readonly catchUpCapMs: number;
  readonly catchUpChunkMs: number;
  readonly checkpointIntervalMs: number;
  /** Proposals beyond this count in a single tick's queue are rejected as over-limit before they ever reach the world engine. */
  readonly maxProposalsPerTick: number;
  readonly fireBalance: Readonly<Record<string, number>>;
  readonly economyBalance: Readonly<Record<string, number>>;
  /** Memory and relationship tunables (capacity, salience per event kind, affinity effects). Absent means every default in packages/world's memory rules. */
  readonly memoryBalance?: Readonly<Record<string, number>>;
  /** Petition, bless, director, and goal-lock tunables. Absent means every default in packages/world's petition rules. */
  readonly petitionBalance?: Readonly<Record<string, number>>;
  /** Practice thread tunables (negotiation window, counteroffer budget, term deadline bounds). Absent means every default in packages/world's practice rules. */
  readonly practiceBalance?: Readonly<Record<string, number>>;
  /** The stakes a god may set on the terms it offers a supplicant, by id: what the mortal becomes if it takes the boon and breaks the term. Absent means no stake can be set. */
  readonly practiceStakes?: Readonly<Record<string, Transformation>>;
  /** The god each trouble kind is prayed about, by god id: a trouble with no mortal doer goes to the god of its domain, not to the mortal's patron. Absent, or a kind it lacks, means the patron. */
  readonly troubleKinds?: Readonly<Record<string, string>>;
}

export interface ContentPack {
  readonly schemaVersion: number;
  readonly realms: readonly Realm[];
  readonly resources: readonly ResourceAmount[];
  readonly locations: readonly Location[];
  readonly buildings: readonly Building[];
  readonly inhabitants: readonly Inhabitant[];
  readonly rules: WorldRules;
  readonly recipes: Readonly<Record<string, Recipe>>;
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

function parseLocation(value: unknown, path: string): ParseResult<Location> {
  if (!isRecord(value)) return fail(path, "expected a location entry");
  const id = parseString(value.id, `${path}.id`);
  if (!id.ok) return id;
  const realm = parseEnum(value.realm, `${path}.realm`, REALMS);
  if (!realm.ok) return realm;
  const name = parseString(value.name, `${path}.name`);
  if (!name.ok) return name;
  const edges = parseArray(value.edges, `${path}.edges`, parseLocationEdge);
  if (!edges.ok) return edges;
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
    ...(requiredCapability.value === undefined
      ? {}
      : { requiredCapability: requiredCapability.value }),
  });
}

function parseBuilding(value: unknown, path: string): ParseResult<Building> {
  if (!isRecord(value)) return fail(path, "expected a building entry");
  const id = parseString(value.id, `${path}.id`);
  if (!id.ok) return id;
  const locationId = parseString(value.locationId, `${path}.locationId`);
  if (!locationId.ok) return locationId;
  const name = parseString(value.name, `${path}.name`);
  if (!name.ok) return name;
  const material = parseString(value.material, `${path}.material`);
  if (!material.ok) return material;
  const combustible = parseBoolean(value.combustible, `${path}.combustible`);
  if (!combustible.ok) return combustible;
  const services = parseArray(value.services, `${path}.services`, parseString);
  if (!services.ok) return services;
  const inventory = parseArray(
    value.inventory,
    `${path}.inventory`,
    parseResourceAmount,
  );
  if (!inventory.ok) return inventory;
  const owner = parseOptionalString(value.owner, `${path}.owner`);
  if (!owner.ok) return owner;
  return ok({
    id: id.value,
    locationId: locationId.value,
    name: name.value,
    material: material.value,
    combustible: combustible.value,
    services: services.value,
    inventory: inventory.value,
    ...(owner.value === undefined ? {} : { owner: owner.value }),
  });
}

function parseOptionalInhabitantDrives(
  value: unknown,
  path: string,
): ParseResult<InhabitantDrives | undefined> {
  if (value === undefined) return ok(undefined);
  return parseInhabitantDrives(value, path);
}

function parseInhabitantDrives(
  value: unknown,
  path: string,
): ParseResult<InhabitantDrives> {
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

/**
 * Affinity never goes beyond plus or minus this unless the pack's own `memoryBalance.affinityLimit` says
 * otherwise. The world's memory rules take their default from here, so the pack parser and the world's
 * codec enforce one limit.
 */
export const DEFAULT_AFFINITY_LIMIT = 10;

/** The affinity limit a pack's world will hold: its own `memoryBalance.affinityLimit`, else the default. */
export function affinityLimitOf(
  rules: Pick<WorldRules, "memoryBalance">,
): number {
  return rules.memoryBalance?.affinityLimit ?? DEFAULT_AFFINITY_LIMIT;
}

function parseDevotion(value: unknown, path: string): ParseResult<Devotion> {
  if (!isRecord(value)) return fail(path, "expected a devotion object");
  const god = parseString(value.god, `${path}.god`);
  if (!god.ok) return god;
  const affinity = parseNonNegativeInteger(value.affinity, `${path}.affinity`);
  if (!affinity.ok) return affinity;
  // The upper bound is the pack's own affinity limit, known only once its rules are parsed: see parseContentPack's checks.
  if (affinity.value < 1) {
    return fail(`${path}.affinity`, "expected a whole number of at least 1");
  }
  return ok({ god: god.value, affinity: affinity.value });
}

function parseInhabitant(
  value: unknown,
  path: string,
): ParseResult<Inhabitant> {
  if (!isRecord(value)) return fail(path, "expected an inhabitant entry");
  const id = parseString(value.id, `${path}.id`);
  if (!id.ok) return id;
  const name = parseString(value.name, `${path}.name`);
  if (!name.ok) return name;
  const locationId = parseString(value.locationId, `${path}.locationId`);
  if (!locationId.ok) return locationId;
  const drives = parseOptionalInhabitantDrives(value.drives, `${path}.drives`);
  if (!drives.ok) return drives;
  const gathers = parseOptionalString(value.gathers, `${path}.gathers`);
  if (!gathers.ok) return gathers;
  const wants = parseOptionalString(value.wants, `${path}.wants`);
  if (!wants.ok) return wants;
  const deity = parseOptionalBoolean(value.deity, `${path}.deity`);
  if (!deity.ok) return deity;
  const startingInventory =
    value.startingInventory === undefined
      ? ok<readonly ResourceAmount[] | undefined>(undefined)
      : parseArray(
          value.startingInventory,
          `${path}.startingInventory`,
          parseResourceAmount,
        );
  if (!startingInventory.ok) return startingInventory;
  const devotion =
    value.devotion === undefined
      ? ok<Devotion | undefined>(undefined)
      : parseDevotion(value.devotion, `${path}.devotion`);
  if (!devotion.ok) return devotion;
  const rivals =
    value.rivals === undefined
      ? ok<readonly string[] | undefined>(undefined)
      : parseArray(value.rivals, `${path}.rivals`, parseString);
  if (!rivals.ok) return rivals;
  return ok({
    id: id.value,
    name: name.value,
    locationId: locationId.value,
    ...(drives.value === undefined ? {} : { drives: drives.value }),
    ...(gathers.value === undefined ? {} : { gathers: gathers.value }),
    ...(wants.value === undefined ? {} : { wants: wants.value }),
    ...(deity.value === undefined ? {} : { deity: deity.value }),
    ...(startingInventory.value === undefined
      ? {}
      : { startingInventory: startingInventory.value }),
    ...(devotion.value === undefined ? {} : { devotion: devotion.value }),
    ...(rivals.value === undefined || rivals.value.length === 0
      ? {}
      : { rivals: rivals.value }),
  });
}

export function parseRecipe(value: unknown, path: string): ParseResult<Recipe> {
  if (!isRecord(value)) return fail(path, "expected a recipe entry");
  const inputs = parseArray(
    value.inputs,
    `${path}.inputs`,
    parseResourceAmount,
  );
  if (!inputs.ok) return inputs;
  const outputs = parseArray(
    value.outputs,
    `${path}.outputs`,
    parseResourceAmount,
  );
  if (!outputs.ok) return outputs;
  return ok({ inputs: inputs.value, outputs: outputs.value });
}

export function parseRecipes(
  value: unknown,
  path: string,
): ParseResult<Readonly<Record<string, Recipe>>> {
  if (!isRecord(value)) return fail(path, "expected a recipes object");
  const recipes: Record<string, Recipe> = {};
  for (const [key, entry] of Object.entries(value)) {
    const parsed = parseRecipe(entry, `${path}.${key}`);
    if (!parsed.ok) return parsed;
    recipes[key] = parsed.value;
  }
  return ok(recipes);
}

/** The keys of `rules.memoryBalance` whose value is a count (a whole number, never negative). */
const MEMORY_COUNT_KEYS: ReadonlySet<string> = new Set([
  "capacity",
  "harmAffinity",
  "kindnessAffinity",
  "affinityLimit",
  "grudgeLimit",
  // Retired: affinity no longer makes an alliance, so this changes nothing. Kept so a stored world's rules and an older pack still parse.
  "allianceAffinity",
  "refusalAffinity",
  "salience_practice-ended",
  "salience_told",
  "salience_sign",
  "salience_noticed",
  "salience_patronage",
  ...WITNESSED_EVENT_KINDS.map((kind) => `salience_${kind}`),
]);

/** The one fractional memory tunable: what share of a witnessed effect a belief carries. */
const MEMORY_FRACTION_KEY = "toldShare";

/**
 * `rules.memoryBalance`, checked key by key: a count is a non-negative whole
 * number (capacity 0 is legal), `toldShare` a non-negative finite number, and
 * any other key is refused, since a typo would silently leave the default in
 * force. A salience exists only for a kind an actor can witness. Used for
 * authored content and again when a stored world's rules are decoded.
 */
export function parseMemoryBalance(
  value: unknown,
  path: string,
): ParseResult<Readonly<Record<string, number>>> {
  if (!isRecord(value)) return fail(path, "expected a balance object");
  const balance: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    const at = `${path}.${key}`;
    let parsed: ParseResult<number>;
    if (MEMORY_COUNT_KEYS.has(key)) {
      parsed = parseNonNegativeInteger(entry, at);
    } else if (key === MEMORY_FRACTION_KEY) {
      parsed = parseNonNegativeNumber(entry, at);
    } else {
      return fail(at, "not a memory tunable");
    }
    if (!parsed.ok) return parsed;
    balance[key] = parsed.value;
  }
  return ok(balance);
}

/** The keys of `rules.petitionBalance`: every one a positive whole number of ticks or units. */
export const PETITION_BALANCE_KEYS = [
  "answerWindowTicks",
  "causePrayableTicks",
  "prayerCooldownTicks",
  "blessDivinityCost",
  "blessPlanks",
  "blessResourceAmount",
  "blessResourceCap",
  "directorQuietTicks",
  "goalLockTicks",
  "strikeGoodsCap",
  "defectionAffinity",
] as const;

/**
 * `rules.petitionBalance`, checked key by key: each is a positive whole
 * number, and any other key is refused, since a typo would silently leave the
 * default in force. Used for authored content and when a stored world's rules
 * are decoded.
 */
export function parsePetitionBalance(
  value: unknown,
  path: string,
): ParseResult<Readonly<Record<string, number>>> {
  if (!isRecord(value)) return fail(path, "expected a balance object");
  const balance: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    const at = `${path}.${key}`;
    if (!(PETITION_BALANCE_KEYS as readonly string[]).includes(key)) {
      return fail(at, "not a petition tunable");
    }
    const parsed = parseNonNegativeInteger(entry, at);
    if (!parsed.ok) return parsed;
    if (parsed.value < 1) return fail(at, "expected a positive integer");
    balance[key] = parsed.value;
  }
  return ok(balance);
}

/** The keys of `rules.practiceBalance`: every one a positive whole number of ticks or units. */
export const PRACTICE_BALANCE_KEYS = [
  "negotiationTicks",
  "counterBudget",
  "minTermTicks",
  "maxTermTicks",
  "oathDivinityLoss",
  "oathAccessTicks",
  "standingDelta",
  /** How pious a mortal's drive must be, as a percent, to accept the terms a god offers it. */
  "acceptPietyPercent",
  /** How many ticks before an accepted term's deadline performing it outranks the mortal's other choices. */
  "urgentTicks",
  /** Ticks a contest runs: acts after it opens and by this many ticks later count. */
  "contestWindowTicks",
  /** Ticks a rival's act can still be contested after it was done. */
  "contestActTicks",
  /** Most recent acts the world remembers as contestable. */
  "contestLedgerMax",
  /** What a closed contest moves each god's standing at the place by. */
  "contestStanding",
] as const;

/**
 * `rules.practiceBalance`, checked like `parsePetitionBalance`: each key a
 * positive whole number, any other key refused so a typo cannot silently leave
 * a default in force. Used for authored content and when a stored world's rules
 * are decoded.
 */
export function parsePracticeBalance(
  value: unknown,
  path: string,
): ParseResult<Readonly<Record<string, number>>> {
  if (!isRecord(value)) return fail(path, "expected a balance object");
  const balance: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    const at = `${path}.${key}`;
    if (!(PRACTICE_BALANCE_KEYS as readonly string[]).includes(key)) {
      return fail(at, "not a practice tunable");
    }
    const parsed = parseNonNegativeInteger(entry, at);
    if (!parsed.ok) return parsed;
    if (parsed.value < 1) return fail(at, "expected a positive integer");
    balance[key] = parsed.value;
  }
  return ok(balance);
}

/**
 * `rules.practiceStakes`: an id for each stake and the change of form it is,
 * checked field by field. An unknown field is refused, so a typo cannot leave a
 * stake with no effect.
 */
export function parsePracticeStakes(
  value: unknown,
  path: string,
): ParseResult<Readonly<Record<string, Transformation>>> {
  if (!isRecord(value)) return fail(path, "expected an object of stakes by id");
  const stakes: Record<string, Transformation> = {};
  for (const [id, entry] of Object.entries(value)) {
    const at = `${path}.${id}`;
    if (id.length === 0) return fail(path, "a stake needs an id");
    if (!isRecord(entry)) return fail(at, "expected a stake object");
    for (const key of Object.keys(entry)) {
      if (!["form", "capabilitiesGained", "capabilitiesLost"].includes(key)) {
        return fail(`${at}.${key}`, "not a stake field");
      }
    }
    const transformation = parseTransformation(entry, at);
    if (!transformation.ok) return transformation;
    stakes[id] = transformation.value;
  }
  return ok(stakes);
}

/** The kinds of trouble that have a domain god. */
export const TROUBLE_KINDS = ["fire", "spoilage", "theft"] as const;
export type TroubleKind = (typeof TROUBLE_KINDS)[number];

/**
 * `rules.troubleKinds`: a god id for each trouble kind, an unknown kind refused
 * so a typo cannot silently send a prayer to the patron. That each god exists is
 * checked against the pack (content) or the actors (a stored world).
 */
export function parseTroubleKinds(
  value: unknown,
  path: string,
): ParseResult<Readonly<Record<string, string>>> {
  if (!isRecord(value))
    return fail(path, "expected an object of gods by trouble");
  const table: Record<string, string> = {};
  for (const [kind, entry] of Object.entries(value)) {
    const at = `${path}.${kind}`;
    if (!(TROUBLE_KINDS as readonly string[]).includes(kind)) {
      return fail(at, "not a trouble kind");
    }
    const god = parseString(entry, at);
    if (!god.ok) return god;
    table[kind] = god.value;
  }
  return ok(table);
}

function parseBalanceRecord(
  value: unknown,
  path: string,
): ParseResult<Readonly<Record<string, number>>> {
  if (!isRecord(value)) return fail(path, "expected a balance object");
  const balance: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    const parsed = parseFiniteNumber(entry, `${path}.${key}`);
    if (!parsed.ok) return parsed;
    balance[key] = parsed.value;
  }
  return ok(balance);
}

function parseWorldRules(
  value: unknown,
  path: string,
): ParseResult<WorldRules> {
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
  const fireBalance = parseBalanceRecord(
    value.fireBalance,
    `${path}.fireBalance`,
  );
  if (!fireBalance.ok) return fireBalance;
  const economyBalance = parseBalanceRecord(
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
  });
}

/**
 * Referential integrity, run after every field has already shape-parsed
 * successfully. Shape parsing alone lets a syntactically valid pack
 * reference geography that does not exist -- an edge to a phantom
 * location, a building or inhabitant planted in a location that was never
 * declared, a location realm the pack never lists, or two locations
 * fighting over one id. Each of those loads as "valid" content right up
 * until packages/world tries to use it, so this fails loudly at the same
 * parse boundary as every other content error instead of surfacing later
 * as a confusing runtime lookup miss.
 */
function checkReferentialIntegrity(
  pack: ContentPack,
): ParseResult<ContentPack> {
  const declaredRealms = new Set<Realm>(pack.realms);
  const locationIds = new Set<string>();

  for (const [index, location] of pack.locations.entries()) {
    if (locationIds.has(location.id)) {
      return fail(
        `locations[${index}].id`,
        `duplicate location id: ${location.id}`,
      );
    }
    locationIds.add(location.id);
  }

  for (const [index, location] of pack.locations.entries()) {
    if (!declaredRealms.has(location.realm)) {
      return fail(
        `locations[${index}].realm`,
        `location "${location.id}" declares realm "${location.realm}", which is not listed in the pack's realms`,
      );
    }
    for (const [edgeIndex, edge] of location.edges.entries()) {
      if (!locationIds.has(edge.to)) {
        return fail(
          `locations[${index}].edges[${edgeIndex}].to`,
          `edge from "${location.id}" targets unknown location: ${edge.to}`,
        );
      }
    }
  }

  for (const [index, building] of pack.buildings.entries()) {
    if (!locationIds.has(building.locationId)) {
      return fail(
        `buildings[${index}].locationId`,
        `building "${building.id}" references unknown location: ${building.locationId}`,
      );
    }
  }

  const inhabitantIds = new Set<string>();
  for (const [index, inhabitant] of pack.inhabitants.entries()) {
    if (!locationIds.has(inhabitant.locationId)) {
      return fail(
        `inhabitants[${index}].locationId`,
        `inhabitant "${inhabitant.id}" references unknown location: ${inhabitant.locationId}`,
      );
    }
    inhabitantIds.add(inhabitant.id);
  }

  const deityIds = new Set(
    pack.inhabitants.filter((i) => i.deity === true).map((i) => i.id),
  );
  for (const [index, inhabitant] of pack.inhabitants.entries()) {
    const rivals = inhabitant.rivals ?? [];
    if (rivals.length > 0 && inhabitant.deity !== true) {
      return fail(
        `inhabitants[${index}].rivals`,
        `"${inhabitant.id}" is a mortal, and only a god has rivals`,
      );
    }
    const seenRivals = new Set<string>();
    for (const [at, rival] of rivals.entries()) {
      const path = `inhabitants[${index}].rivals[${at}]`;
      if (rival === inhabitant.id) {
        return fail(path, `"${inhabitant.id}" cannot be its own rival`);
      }
      if (!deityIds.has(rival)) {
        return fail(
          path,
          `"${inhabitant.id}" contests "${rival}", who is not a god in the pack`,
        );
      }
      if (seenRivals.has(rival)) {
        return fail(path, `"${rival}" is named twice`);
      }
      seenRivals.add(rival);
    }
    if (inhabitant.devotion === undefined) {
      // A mortal's devotion is its patron: every mortal has one, authored.
      if (inhabitant.deity !== true) {
        return fail(
          `inhabitants[${index}].devotion`,
          `"${inhabitant.id}" is a mortal and needs an authored devotion: its patron god`,
        );
      }
      continue;
    }
    if (inhabitant.deity === true) {
      return fail(
        `inhabitants[${index}].devotion`,
        `"${inhabitant.id}" is a god, and a god prays to no one`,
      );
    }
    if (!deityIds.has(inhabitant.devotion.god)) {
      return fail(
        `inhabitants[${index}].devotion.god`,
        `"${inhabitant.id}" reveres "${inhabitant.devotion.god}", who is not a god in the pack`,
      );
    }
    // Held to what the world will hold: a devotion over the pack's own limit would parse, and then its initial world would not decode.
    const limit = affinityLimitOf(pack.rules);
    if (inhabitant.devotion.affinity > limit) {
      return fail(
        `inhabitants[${index}].devotion.affinity`,
        `"${inhabitant.id}" starts with affinity ${inhabitant.devotion.affinity} toward "${inhabitant.devotion.god}", beyond the pack's affinity limit of ${limit}`,
      );
    }
  }

  for (const [kind, god] of Object.entries(pack.rules.troubleKinds ?? {})) {
    if (!deityIds.has(god)) {
      return fail(
        `rules.troubleKinds.${kind}`,
        `trouble "${kind}" belongs to "${god}", who is not a god in the pack`,
      );
    }
  }

  for (const [index, building] of pack.buildings.entries()) {
    if (building.owner !== undefined && !inhabitantIds.has(building.owner)) {
      return fail(
        `buildings[${index}].owner`,
        `building "${building.id}" references unknown inhabitant: ${building.owner}`,
      );
    }
  }

  return ok(pack);
}

export function parseContentPack(input: unknown): ParseResult<ContentPack> {
  if (!isRecord(input)) {
    return fail("", "expected a content pack object");
  }
  const schemaVersion = parseSchemaVersion(
    input.schemaVersion,
    CONTENT_SCHEMA_VERSIONS,
  );
  if (!schemaVersion.ok) return schemaVersion;
  const realms = parseArray(input.realms, "realms", (item, path) =>
    parseEnum(item, path, REALMS),
  );
  if (!realms.ok) return realms;
  const resources = parseArray(
    input.resources,
    "resources",
    parseResourceAmount,
  );
  if (!resources.ok) return resources;
  const locations = parseArray(input.locations, "locations", parseLocation);
  if (!locations.ok) return locations;
  const buildings = parseArray(input.buildings, "buildings", parseBuilding);
  if (!buildings.ok) return buildings;
  const inhabitants = parseArray(
    input.inhabitants,
    "inhabitants",
    parseInhabitant,
  );
  if (!inhabitants.ok) return inhabitants;
  const rules = parseWorldRules(input.rules, "rules");
  if (!rules.ok) return rules;
  const recipes =
    input.recipes === undefined
      ? ok<Readonly<Record<string, Recipe>>>({})
      : parseRecipes(input.recipes, "recipes");
  if (!recipes.ok) return recipes;
  return checkReferentialIntegrity({
    schemaVersion: schemaVersion.value,
    realms: realms.value,
    resources: resources.value,
    locations: locations.value,
    buildings: buildings.value,
    inhabitants: inhabitants.value,
    rules: rules.value,
    recipes: recipes.value,
  });
}
