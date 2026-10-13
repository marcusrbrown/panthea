// Loads an authored content pack from disk and parses it through
// packages/contracts' `parseContentPack`. Invalid content fails loudly --
// a missing required file, malformed JSON syntax, and a structurally
// invalid pack are each reported distinctly.
//
// Authored packs split geography from balance/economy across two required
// files (`locations.json`, `rules.json`) plus two optional files
// (`buildings.json`, `inhabitants.json`) that default to an empty list
// when absent.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ContentPack,
  fail,
  isRecord,
  ok,
  type ParseResult,
  parseContentPack,
} from "@panthea/contracts";
import {
  type GodProfile,
  type LabeledProfileInput,
  parseGodProfiles,
} from "./god-profile";
import { type MotifCatalogue, parseMotifCatalogue } from "./motifs";

function readJsonFile(path: string, label: string): ParseResult<unknown> {
  if (!existsSync(path)) {
    return fail(label, `required content file is missing: ${path}`);
  }
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return fail(label, `could not read ${path}: ${String(error)}`);
  }
  try {
    return ok(JSON.parse(text));
  } catch (error) {
    return fail(label, `${path} is not valid JSON: ${String(error)}`);
  }
}

function readOptionalJsonFile(
  path: string,
  label: string,
): ParseResult<unknown | undefined> {
  if (!existsSync(path)) {
    return ok(undefined);
  }
  return readJsonFile(path, label);
}

/**
 * Loads and parses the content pack authored under `baseDir` (e.g.
 * `content/greek/world`). `locations.json` and `rules.json` must exist;
 * `buildings.json` and `inhabitants.json` are read if present and default
 * to an empty list otherwise. God profiles load separately through
 * `loadGodProfiles`.
 */
export function loadContentPack(baseDir: string): ParseResult<ContentPack> {
  const locationsResult = readJsonFile(
    join(baseDir, "locations.json"),
    "locations.json",
  );
  if (!locationsResult.ok) return locationsResult;
  const locationsRaw = locationsResult.value;
  if (!isRecord(locationsRaw)) {
    return fail("locations.json", "expected a JSON object at the top level");
  }

  const rulesResult = readJsonFile(join(baseDir, "rules.json"), "rules.json");
  if (!rulesResult.ok) return rulesResult;
  const rulesRaw = rulesResult.value;
  if (!isRecord(rulesRaw)) {
    return fail("rules.json", "expected a JSON object at the top level");
  }

  const buildingsResult = readOptionalJsonFile(
    join(baseDir, "buildings.json"),
    "buildings.json",
  );
  if (!buildingsResult.ok) return buildingsResult;
  const buildingsRaw = buildingsResult.value;
  if (buildingsRaw !== undefined && !isRecord(buildingsRaw)) {
    return fail("buildings.json", "expected a JSON object at the top level");
  }

  const inhabitantsResult = readOptionalJsonFile(
    join(baseDir, "inhabitants.json"),
    "inhabitants.json",
  );
  if (!inhabitantsResult.ok) return inhabitantsResult;
  const inhabitantsRaw = inhabitantsResult.value;
  if (inhabitantsRaw !== undefined && !isRecord(inhabitantsRaw)) {
    return fail("inhabitants.json", "expected a JSON object at the top level");
  }

  const merged = {
    schemaVersion: locationsRaw.schemaVersion,
    realms: locationsRaw.realms,
    resources: rulesRaw.resources,
    locations: locationsRaw.locations,
    buildings: buildingsRaw?.buildings ?? [],
    inhabitants: inhabitantsRaw?.inhabitants ?? [],
    rules: rulesRaw.rules,
    recipes: rulesRaw.recipes ?? {},
  };

  return parseContentPack(merged);
}

/**
 * Loads every `*.json` god profile under `godsDir` (e.g. `content/greek/gods`)
 * in file-name order and checks them against `pack`'s inhabitants. A missing
 * directory means the pack has no god profiles.
 */
export function loadGodProfiles(
  godsDir: string,
  pack: ContentPack,
): ParseResult<readonly GodProfile[]> {
  if (!existsSync(godsDir)) return ok([]);
  const files = readdirSync(godsDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  const inputs: LabeledProfileInput[] = [];
  for (const file of files) {
    const raw = readJsonFile(join(godsDir, file), file);
    if (!raw.ok) return raw;
    inputs.push({ label: file, value: raw.value });
  }
  return parseGodProfiles(inputs, pack.inhabitants, pack.rules);
}

/**
 * `pack` with each deity inhabitant's sprite id set from its god profile's `sprite`: the profile is the only
 * source of a deity's sprite, so pack assembly (the directory loader's callers and the embedded Greek pack)
 * folds it in before genesis. Mortals already carry theirs from `inhabitants.json`. A deity with no profile in
 * `profiles` is refused, since it would otherwise reach genesis with nothing to draw.
 */
export function withGodSprites(
  pack: ContentPack,
  profiles: readonly GodProfile[],
): ParseResult<ContentPack> {
  const spriteByGod = new Map(profiles.map((god) => [god.id, god.sprite]));
  const inhabitants = [];
  for (const [index, inhabitant] of pack.inhabitants.entries()) {
    if (inhabitant.deity !== true) {
      inhabitants.push(inhabitant);
      continue;
    }
    const sprite = spriteByGod.get(inhabitant.id);
    if (sprite === undefined) {
      return fail(
        `inhabitants[${index}].${inhabitant.id}`,
        `deity ${inhabitant.id} has no god profile to take its sprite from`,
      );
    }
    inhabitants.push({ ...inhabitant, sprite });
  }
  return ok({ ...pack, inhabitants });
}

/** Loads and parses the motif catalogue at `file` (e.g. `content/greek/lore/motifs.json`). */
export function loadMotifCatalogue(file: string): ParseResult<MotifCatalogue> {
  const raw = readJsonFile(file, "motifs.json");
  if (!raw.ok) return raw;
  return parseMotifCatalogue(raw.value, "motifs.json");
}
