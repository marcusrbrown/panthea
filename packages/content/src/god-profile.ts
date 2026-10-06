// God profiles (content/greek/gods/*.json): the authored identity of a deity
// inhabitant. Lore is prompt material with citations; abilities name world
// actions, which the world's rules enforce (a profile grants nothing by
// itself); inventions are labeled non-canonical additions kept apart from
// lore so nothing unsourced is presented as researched mythology.

import {
  fail,
  type Inhabitant,
  isRecord,
  ok,
  type ParseResult,
  PROPOSAL_KINDS,
  type ProposalKind,
  parseArray,
  parseEnum,
  parseFiniteNumber,
  parseOptionalString,
  parseResourceAmount,
  parseSchemaVersion,
  parseString,
  type ResourceAmount,
  type WorldRules,
} from "@panthea/contracts";

export const GOD_PROFILE_SCHEMA_VERSIONS = [1] as const;

/** Motivations a god weighs when it decides. Distinct from the economic routine drives of ordinary inhabitants. */
export const GOD_DRIVES = [
  "sovereignty",
  "order",
  "desire",
  "fidelity",
  "vengeance",
  "guardianship",
] as const;
export type GodDrive = (typeof GOD_DRIVES)[number];
export type GodDrives = Readonly<Partial<Record<GodDrive, number>>>;

export interface GodSource {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly translator?: string;
  readonly edition: string;
  readonly url?: string;
  /** ISO date someone checked the cited locators against this edition. */
  readonly accessed?: string;
}

export interface Citation {
  readonly source: string;
  readonly locator: string;
}

export interface GodLore {
  readonly id: string;
  readonly statement: string;
  readonly cites: readonly Citation[];
}

export interface GodVariant {
  readonly id: string;
  readonly note: string;
  readonly cites: readonly Citation[];
}

export interface GodInvention {
  readonly id: string;
  readonly statement: string;
  readonly reason: string;
}

/**
 * A trouble the world may bring in this god's domain: `id` is its entry in the pack's trouble table
 * (`rules.troubles`, whose god is this one in `rules.troubleKinds`), `cites` is where the domain is attested, and
 * `invention` names the entry of `inventions` that says the trouble itself is the game's own.
 */
export interface GodTrouble {
  readonly id: string;
  readonly statement: string;
  readonly cites: readonly Citation[];
  readonly invention: string;
}

export interface GodAbility {
  readonly id: string;
  readonly name: string;
  /** The world action this ability performs; the world's rules decide whether a given use succeeds. */
  readonly action: ProposalKind;
  readonly description: string;
  readonly cost?: ResourceAmount;
  readonly parameters?: Readonly<Record<string, number>>;
}

export interface GodRelationship {
  /** Inhabitant id. */
  readonly target: string;
  readonly kind: string;
  /** Starting disposition toward the target: -1 hostile to 1 devoted. */
  readonly disposition: number;
  readonly note?: string;
}

export interface GodProfile {
  readonly schemaVersion: number;
  /** Matches the id of a deity inhabitant in the world pack. */
  readonly id: string;
  readonly name: string;
  readonly domains: readonly string[];
  readonly drives: GodDrives;
  readonly abilities: readonly GodAbility[];
  readonly relationships: readonly GodRelationship[];
  readonly lore: readonly GodLore[];
  readonly sources: readonly GodSource[];
  readonly variants: readonly GodVariant[];
  readonly inventions: readonly GodInvention[];
  /** The domain troubles the world brings, each sourced; absent means the god has none. */
  readonly troubles: readonly GodTrouble[];
  /** Placeholder sprite id; final art is a later milestone. */
  readonly sprite: string;
}

export function parseNonEmptyArray<T>(
  value: unknown,
  path: string,
  parseItem: (item: unknown, itemPath: string) => ParseResult<T>,
): ParseResult<readonly T[]> {
  const items = parseArray(value, path, parseItem);
  if (!items.ok) return items;
  if (items.value.length === 0)
    return fail(path, "expected at least one entry");
  return items;
}

export function parseOptionalArray<T>(
  value: unknown,
  path: string,
  parseItem: (item: unknown, itemPath: string) => ParseResult<T>,
): ParseResult<readonly T[]> {
  if (value === undefined) return ok([]);
  return parseArray(value, path, parseItem);
}

export function checkUniqueIds(
  items: readonly { readonly id: string }[],
  path: string,
  what: string,
): ParseResult<true> {
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (seen.has(item.id)) {
      return fail(`${path}[${index}].id`, `duplicate ${what} id: ${item.id}`);
    }
    seen.add(item.id);
  }
  return ok(true);
}

export function parseSource(
  value: unknown,
  path: string,
): ParseResult<GodSource> {
  if (!isRecord(value)) return fail(path, "expected a source entry");
  const id = parseString(value.id, `${path}.id`);
  if (!id.ok) return id;
  const title = parseString(value.title, `${path}.title`);
  if (!title.ok) return title;
  const author = parseString(value.author, `${path}.author`);
  if (!author.ok) return author;
  const translator = parseOptionalString(
    value.translator,
    `${path}.translator`,
  );
  if (!translator.ok) return translator;
  const edition = parseString(value.edition, `${path}.edition`);
  if (!edition.ok) return edition;
  const url = parseOptionalString(value.url, `${path}.url`);
  if (!url.ok) return url;
  const accessed = parseOptionalString(value.accessed, `${path}.accessed`);
  if (!accessed.ok) return accessed;
  return ok({
    id: id.value,
    title: title.value,
    author: author.value,
    ...(translator.value === undefined ? {} : { translator: translator.value }),
    edition: edition.value,
    ...(url.value === undefined ? {} : { url: url.value }),
    ...(accessed.value === undefined ? {} : { accessed: accessed.value }),
  });
}

export function parseCitations(
  value: unknown,
  path: string,
  sourceIds: ReadonlySet<string>,
): ParseResult<readonly Citation[]> {
  return parseNonEmptyArray(value, path, (item, itemPath) => {
    if (!isRecord(item)) return fail(itemPath, "expected a citation entry");
    const source = parseString(item.source, `${itemPath}.source`);
    if (!source.ok) return source;
    if (!sourceIds.has(source.value)) {
      return fail(
        `${itemPath}.source`,
        `citation names unknown source id: ${source.value}`,
      );
    }
    const locator = parseString(item.locator, `${itemPath}.locator`);
    if (!locator.ok) return locator;
    return ok({ source: source.value, locator: locator.value });
  });
}

function parseLore(
  sourceIds: ReadonlySet<string>,
): (value: unknown, path: string) => ParseResult<GodLore> {
  return (value, path) => {
    if (!isRecord(value)) return fail(path, "expected a lore entry");
    const id = parseString(value.id, `${path}.id`);
    if (!id.ok) return id;
    const statement = parseString(value.statement, `${path}.statement`);
    if (!statement.ok) return statement;
    const cites = parseCitations(value.cites, `${path}.cites`, sourceIds);
    if (!cites.ok) return cites;
    return ok({
      id: id.value,
      statement: statement.value,
      cites: cites.value,
    });
  };
}

export function parseVariant(
  sourceIds: ReadonlySet<string>,
): (value: unknown, path: string) => ParseResult<GodVariant> {
  return (value, path) => {
    if (!isRecord(value)) return fail(path, "expected a variant entry");
    const id = parseString(value.id, `${path}.id`);
    if (!id.ok) return id;
    const note = parseString(value.note, `${path}.note`);
    if (!note.ok) return note;
    const cites = parseCitations(value.cites, `${path}.cites`, sourceIds);
    if (!cites.ok) return cites;
    return ok({ id: id.value, note: note.value, cites: cites.value });
  };
}

export function parseInvention(
  value: unknown,
  path: string,
): ParseResult<GodInvention> {
  if (!isRecord(value)) return fail(path, "expected an invention entry");
  if (value.cites !== undefined) {
    return fail(
      `${path}.cites`,
      "an invention is non-canonical and cannot carry citations; move sourced material to lore",
    );
  }
  const id = parseString(value.id, `${path}.id`);
  if (!id.ok) return id;
  const statement = parseString(value.statement, `${path}.statement`);
  if (!statement.ok) return statement;
  const reason = parseString(value.reason, `${path}.reason`);
  if (!reason.ok) return reason;
  return ok({
    id: id.value,
    statement: statement.value,
    reason: reason.value,
  });
}

function parseTrouble(
  sourceIds: ReadonlySet<string>,
  inventionIds: ReadonlySet<string>,
) {
  return (value: unknown, path: string): ParseResult<GodTrouble> => {
    if (!isRecord(value)) return fail(path, "expected a trouble entry");
    const id = parseString(value.id, `${path}.id`);
    if (!id.ok) return id;
    const statement = parseString(value.statement, `${path}.statement`);
    if (!statement.ok) return statement;
    const cites = parseCitations(value.cites, `${path}.cites`, sourceIds);
    if (!cites.ok) return cites;
    const invention = parseString(value.invention, `${path}.invention`);
    if (!invention.ok) return invention;
    if (!inventionIds.has(invention.value)) {
      return fail(
        `${path}.invention`,
        `trouble "${id.value}" names unknown invention id: ${invention.value}; the trouble is the game's own and says so`,
      );
    }
    return ok({
      id: id.value,
      statement: statement.value,
      cites: cites.value,
      invention: invention.value,
    });
  };
}

function parseParameters(
  value: unknown,
  path: string,
): ParseResult<Readonly<Record<string, number>> | undefined> {
  if (value === undefined) return ok(undefined);
  if (!isRecord(value)) return fail(path, "expected a parameters object");
  const parameters: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    const parsed = parseFiniteNumber(entry, `${path}.${key}`);
    if (!parsed.ok) return parsed;
    parameters[key] = parsed.value;
  }
  return ok(parameters);
}

function parseAbility(value: unknown, path: string): ParseResult<GodAbility> {
  if (!isRecord(value)) return fail(path, "expected an ability entry");
  const id = parseString(value.id, `${path}.id`);
  if (!id.ok) return id;
  const name = parseString(value.name, `${path}.name`);
  if (!name.ok) return name;
  const action = parseEnum(value.action, `${path}.action`, PROPOSAL_KINDS);
  if (!action.ok) return action;
  const description = parseString(value.description, `${path}.description`);
  if (!description.ok) return description;
  const cost =
    value.cost === undefined
      ? ok<ResourceAmount | undefined>(undefined)
      : parseResourceAmount(value.cost, `${path}.cost`);
  if (!cost.ok) return cost;
  const parameters = parseParameters(value.parameters, `${path}.parameters`);
  if (!parameters.ok) return parameters;
  return ok({
    id: id.value,
    name: name.value,
    action: action.value,
    description: description.value,
    ...(cost.value === undefined ? {} : { cost: cost.value }),
    ...(parameters.value === undefined ? {} : { parameters: parameters.value }),
  });
}

function parseRelationship(
  value: unknown,
  path: string,
): ParseResult<GodRelationship> {
  if (!isRecord(value)) return fail(path, "expected a relationship entry");
  const target = parseString(value.target, `${path}.target`);
  if (!target.ok) return target;
  const kind = parseString(value.kind, `${path}.kind`);
  if (!kind.ok) return kind;
  const disposition = parseFiniteNumber(
    value.disposition,
    `${path}.disposition`,
  );
  if (!disposition.ok) return disposition;
  if (disposition.value < -1 || disposition.value > 1) {
    return fail(`${path}.disposition`, "expected a number from -1 to 1");
  }
  const note = parseOptionalString(value.note, `${path}.note`);
  if (!note.ok) return note;
  return ok({
    target: target.value,
    kind: kind.value,
    disposition: disposition.value,
    ...(note.value === undefined ? {} : { note: note.value }),
  });
}

function parseDrives(value: unknown, path: string): ParseResult<GodDrives> {
  if (!isRecord(value)) return fail(path, "expected a drives object");
  const drives: Partial<Record<GodDrive, number>> = {};
  for (const [key, entry] of Object.entries(value)) {
    const drive = parseEnum(key, `${path}.${key}`, GOD_DRIVES);
    if (!drive.ok) return drive;
    const weight = parseFiniteNumber(entry, `${path}.${key}`);
    if (!weight.ok) return weight;
    if (weight.value < 0 || weight.value > 1) {
      return fail(`${path}.${key}`, "expected a weight from 0 to 1");
    }
    drives[drive.value] = weight.value;
  }
  if (Object.keys(drives).length === 0) {
    return fail(path, "expected at least one drive");
  }
  return ok(drives);
}

/** Parses one profile's own shape and its internal references (citations name declared sources, ids are unique). */
export function parseGodProfile(
  input: unknown,
  path = "god",
): ParseResult<GodProfile> {
  if (!isRecord(input)) return fail(path, "expected a god profile object");
  const schemaVersion = parseSchemaVersion(
    input.schemaVersion,
    GOD_PROFILE_SCHEMA_VERSIONS,
    `${path}.schemaVersion`,
  );
  if (!schemaVersion.ok) return schemaVersion;
  const id = parseString(input.id, `${path}.id`);
  if (!id.ok) return id;
  const name = parseString(input.name, `${path}.name`);
  if (!name.ok) return name;
  const domains = parseNonEmptyArray(
    input.domains,
    `${path}.domains`,
    parseString,
  );
  if (!domains.ok) return domains;
  const drives = parseDrives(input.drives, `${path}.drives`);
  if (!drives.ok) return drives;
  const abilities = parseNonEmptyArray(
    input.abilities,
    `${path}.abilities`,
    parseAbility,
  );
  if (!abilities.ok) return abilities;
  const relationships = parseOptionalArray(
    input.relationships,
    `${path}.relationships`,
    parseRelationship,
  );
  if (!relationships.ok) return relationships;
  const sources = parseNonEmptyArray(
    input.sources,
    `${path}.sources`,
    parseSource,
  );
  if (!sources.ok) return sources;
  const sourceIds = new Set(sources.value.map((source) => source.id));
  const lore = parseNonEmptyArray(
    input.lore,
    `${path}.lore`,
    parseLore(sourceIds),
  );
  if (!lore.ok) return lore;
  const variants = parseOptionalArray(
    input.variants,
    `${path}.variants`,
    parseVariant(sourceIds),
  );
  if (!variants.ok) return variants;
  const inventions = parseOptionalArray(
    input.inventions,
    `${path}.inventions`,
    parseInvention,
  );
  if (!inventions.ok) return inventions;
  const troubles = parseOptionalArray(
    input.troubles,
    `${path}.troubles`,
    parseTrouble(
      sourceIds,
      new Set(inventions.value.map((invention) => invention.id)),
    ),
  );
  if (!troubles.ok) return troubles;
  const sprite = parseString(input.sprite, `${path}.sprite`);
  if (!sprite.ok) return sprite;

  for (const [items, key, what] of [
    [sources.value, "sources", "source"],
    [abilities.value, "abilities", "ability"],
    [lore.value, "lore", "lore"],
    [variants.value, "variants", "variant"],
    [inventions.value, "inventions", "invention"],
    [troubles.value, "troubles", "trouble"],
  ] as const) {
    const unique = checkUniqueIds(items, `${path}.${key}`, what);
    if (!unique.ok) return unique;
  }

  return ok({
    schemaVersion: schemaVersion.value,
    id: id.value,
    name: name.value,
    domains: domains.value,
    drives: drives.value,
    abilities: abilities.value,
    relationships: relationships.value,
    lore: lore.value,
    sources: sources.value,
    variants: variants.value,
    inventions: inventions.value,
    troubles: troubles.value,
    sprite: sprite.value,
  });
}

export interface LabeledProfileInput {
  /** Names the profile in failure paths, e.g. its file name. */
  readonly label: string;
  readonly value: unknown;
}

/**
 * Parses a set of profiles against the world pack's inhabitants: each profile
 * must belong to a distinct deity inhabitant, and relationships may only
 * target inhabitants that exist.
 */
export function parseGodProfiles(
  inputs: readonly LabeledProfileInput[],
  inhabitants: readonly Inhabitant[],
  rules?: Pick<WorldRules, "troubles" | "troubleKinds">,
): ParseResult<readonly GodProfile[]> {
  const byId = new Map(
    inhabitants.map((inhabitant) => [inhabitant.id, inhabitant]),
  );
  const profiles: GodProfile[] = [];
  const seen = new Set<string>();
  for (const { label, value } of inputs) {
    const parsed = parseGodProfile(value, label);
    if (!parsed.ok) return parsed;
    const profile = parsed.value;
    const inhabitant = byId.get(profile.id);
    if (inhabitant === undefined) {
      return fail(
        `${label}.id`,
        `profile "${profile.id}" matches no inhabitant in the world pack`,
      );
    }
    if (inhabitant.deity !== true) {
      return fail(
        `${label}.id`,
        `inhabitant "${profile.id}" is not a deity; a god profile needs a deity inhabitant`,
      );
    }
    if (seen.has(profile.id)) {
      return fail(`${label}.id`, `duplicate god profile for "${profile.id}"`);
    }
    seen.add(profile.id);
    for (const [index, relationship] of profile.relationships.entries()) {
      if (relationship.target === profile.id) {
        return fail(
          `${label}.relationships[${index}].target`,
          `relationship targets the profile's own god (${profile.id}); a god has no relationship with itself`,
        );
      }
      if (!byId.has(relationship.target)) {
        return fail(
          `${label}.relationships[${index}].target`,
          `relationship targets unknown inhabitant: ${relationship.target}`,
        );
      }
    }
    if (rules !== undefined) {
      for (const [index, trouble] of profile.troubles.entries()) {
        const at = `${label}.troubles[${index}].id`;
        if (rules.troubles?.[trouble.id] === undefined) {
          return fail(
            at,
            `trouble "${trouble.id}" is not in the pack's trouble table (rules.troubles)`,
          );
        }
        const owner = rules.troubleKinds?.[trouble.id];
        if (owner !== profile.id) {
          return fail(
            at,
            `trouble "${trouble.id}" belongs to ${owner ?? "no god"} in the pack, not to ${profile.id}`,
          );
        }
      }
    }
    profiles.push(profile);
  }
  // Every trouble the pack draws is sourced: the profile of the god it belongs to lists it.
  for (const id of Object.keys(rules?.troubles ?? {})) {
    const owner = rules?.troubleKinds?.[id];
    const profile = profiles.find((held) => held.id === owner);
    if (profile !== undefined && !profile.troubles.some((t) => t.id === id)) {
      return fail(
        `${profile.id}.troubles`,
        `trouble "${id}" is in the pack's trouble table but ${profile.id}'s profile does not source it`,
      );
    }
  }
  return ok(profiles);
}
