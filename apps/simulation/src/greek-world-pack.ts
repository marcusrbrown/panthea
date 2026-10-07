// Statically embeds content/greek/world's four authored JSON files and the
// god profiles under content/greek/gods so the compiled sidecar needs no
// filesystem access to load the Greek world: a static JSON import is
// inlined by `bun build --compile` into the resulting binary, unlike a
// runtime `readFileSync` against a path that does not exist inside a
// compiled binary's virtual module root.
//
// Merges the four world files the same way packages/content's directory
// loader does, then parses the merged shape through the same
// `parseContentPack` -- so an authoring change to
// content/greek/world/*.json only needs updating here if the merge shape
// itself ever changes, never a duplicated parse path. God profiles go
// through the same `parseGodProfiles` the directory loader uses; a new god
// file needs one import and one list entry here.

import {
  type GodProfile,
  type LabeledProfileInput,
  parseGodProfiles,
} from "@panthea/content";
import {
  type ContentPack,
  isRecord,
  type ParseResult,
  parseContentPack,
} from "@panthea/contracts";
import athenaFile from "../../../content/greek/gods/athena.json";
import hadesFile from "../../../content/greek/gods/hades.json";
import hephaestusFile from "../../../content/greek/gods/hephaestus.json";
import heraFile from "../../../content/greek/gods/hera.json";
import hermesFile from "../../../content/greek/gods/hermes.json";
import poseidonFile from "../../../content/greek/gods/poseidon.json";
import zeusFile from "../../../content/greek/gods/zeus.json";
import buildingsFile from "../../../content/greek/world/buildings.json";
import inhabitantsFile from "../../../content/greek/world/inhabitants.json";
import locationsFile from "../../../content/greek/world/locations.json";
import rulesFile from "../../../content/greek/world/rules.json";

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/**
 * `rules` with one balance object overridden by the JSON object in `raw`,
 * merged over what the content authored: a non-JSON or non-object value is
 * passed on as it is, so the strict parser refuses the pack.
 */
function withBalanceOverride(
  rules: Record<string, unknown>,
  key: "petitionBalance" | "practiceBalance",
  raw: string | undefined,
): Record<string, unknown> {
  if (!raw) return rules;
  let overrides: unknown;
  try {
    overrides = JSON.parse(raw);
  } catch {
    return { ...rules, rules: { ...asRecord(rules.rules), [key]: raw } };
  }
  const authored = asRecord(asRecord(rules.rules)[key]);
  return {
    ...rules,
    rules: {
      ...asRecord(rules.rules),
      [key]: isRecord(overrides) ? { ...authored, ...overrides } : overrides,
    },
  };
}

/**
 * `rules` with the temperament odds table replaced by the JSON object in `raw` (a scenario's staged world gives
 * the mortals the odds it needs to see a wrong or a revenge within a few ticks): not merged, since a table is a
 * whole. A non-JSON value is passed on as it is, so the strict parser refuses the pack.
 */
function withOddsOverride(
  rules: Record<string, unknown>,
  raw: string | undefined,
): Record<string, unknown> {
  if (!raw) return rules;
  let table: unknown = raw;
  try {
    table = JSON.parse(raw);
  } catch {
    // Left as text: the parser refuses it.
  }
  return {
    ...rules,
    rules: { ...asRecord(rules.rules), temperamentOdds: table },
  };
}

/**
 * The authored rules, with the petition tunables overridden by
 * `env.PANTHEA_PETITION_BALANCE` and the practice tunables by
 * `env.PANTHEA_PRACTICE_BALANCE` (each a JSON object of tunable names to
 * numbers) and the temperament odds table by `env.PANTHEA_TEMPERAMENT_ODDS`
 * when set. The result goes through the same strict parser as
 * authored content, so an unknown name or an invalid value refuses the pack.
 */
function rulesWithOverrides(
  rules: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  return withOddsOverride(
    withBalanceOverride(
      withBalanceOverride(
        rules,
        "petitionBalance",
        env.PANTHEA_PETITION_BALANCE,
      ),
      "practiceBalance",
      env.PANTHEA_PRACTICE_BALANCE,
    ),
    env.PANTHEA_TEMPERAMENT_ODDS,
  );
}

/** Parses the embedded Greek pack. Never touches the filesystem. */
export function loadEmbeddedGreekWorldPack(
  env: NodeJS.ProcessEnv = process.env,
): ParseResult<ContentPack> {
  const locations = asRecord(locationsFile);
  const buildings = asRecord(buildingsFile);
  const inhabitants = asRecord(inhabitantsFile);
  const rules = rulesWithOverrides(asRecord(rulesFile), env);

  const merged = {
    schemaVersion: locations.schemaVersion,
    realms: locations.realms,
    resources: rules.resources,
    locations: locations.locations,
    buildings: buildings.buildings ?? [],
    inhabitants: inhabitants.inhabitants ?? [],
    rules: rules.rules,
    recipes: rules.recipes ?? {},
  };

  return parseContentPack(merged);
}

export const EMBEDDED_GOD_PROFILE_FILES: readonly LabeledProfileInput[] = [
  { label: "athena.json", value: athenaFile },
  { label: "hades.json", value: hadesFile },
  { label: "hephaestus.json", value: hephaestusFile },
  { label: "hera.json", value: heraFile },
  { label: "hermes.json", value: hermesFile },
  { label: "poseidon.json", value: poseidonFile },
  { label: "zeus.json", value: zeusFile },
];

/**
 * Parses the embedded god profiles (or `files`, so a test can inject a bad
 * one) against `pack`. Never touches the filesystem.
 */
export function loadEmbeddedGreekGodProfiles(
  pack: ContentPack,
  files: readonly LabeledProfileInput[] = EMBEDDED_GOD_PROFILE_FILES,
): ParseResult<readonly GodProfile[]> {
  return parseGodProfiles(files, pack.inhabitants);
}
