// Visual profiles (content/greek/assets/subjects/*.json): what a god looks
// like, kept apart from the core god profile and joined to it by god id.

import {
  ASSET_SCHEMA_VERSIONS,
  fail,
  ok,
  type ParseResult,
  parseArray,
  parseAssetId,
  parseSchemaVersion,
  parseSlug,
  parseStrictRecord,
  parseString,
} from "@panthea/contracts";
import type { GodProfile, LabeledProfileInput } from "./god-profile";

export const GOD_VISUAL_PROFILE_SCHEMA_VERSIONS = ASSET_SCHEMA_VERSIONS;

export interface GodVisualProfile {
  readonly schemaVersion: number;
  /** The god's profile id. */
  readonly godId: string;
  readonly paletteFamily: string;
  readonly iconography: readonly string[];
  /** Asset id of the god's portrait, when one is mapped. */
  readonly portrait?: string;
}

export function parseGodVisualProfile(
  input: unknown,
  path = "visual",
): ParseResult<GodVisualProfile> {
  return parseStrictRecord(
    input,
    path,
    ["schemaVersion", "godId", "paletteFamily", "iconography", "portrait"],
    (record) => {
      const schemaVersion = parseSchemaVersion(
        record.schemaVersion,
        GOD_VISUAL_PROFILE_SCHEMA_VERSIONS,
        `${path}.schemaVersion`,
      );
      if (!schemaVersion.ok) return schemaVersion;
      const godId = parseString(record.godId, `${path}.godId`);
      if (!godId.ok) return godId;
      const paletteFamily = parseSlug(
        record.paletteFamily,
        `${path}.paletteFamily`,
      );
      if (!paletteFamily.ok) return paletteFamily;
      const iconography = parseArray(
        record.iconography,
        `${path}.iconography`,
        parseString,
      );
      if (!iconography.ok) return iconography;
      if (iconography.value.length === 0) {
        return fail(`${path}.iconography`, "expected at least one entry");
      }
      const seen = new Set<string>();
      for (const [index, entry] of iconography.value.entries()) {
        if (seen.has(entry))
          return fail(`${path}.iconography[${index}]`, `duplicate "${entry}"`);
        seen.add(entry);
      }
      if (record.portrait === undefined) {
        return ok({
          schemaVersion: schemaVersion.value,
          godId: godId.value,
          paletteFamily: paletteFamily.value,
          iconography: iconography.value,
        });
      }
      const portrait = parseAssetId(record.portrait, `${path}.portrait`);
      if (!portrait.ok) return portrait;
      return ok({
        schemaVersion: schemaVersion.value,
        godId: godId.value,
        paletteFamily: paletteFamily.value,
        iconography: iconography.value,
        portrait: portrait.value,
      });
    },
  );
}

/**
 * Parses a set of visual profiles against the god profiles and the
 * vocabulary's palette families: each belongs to a known god, at most once,
 * names a known family, and no two share a portrait id.
 */
export function parseGodVisualProfiles(
  inputs: readonly LabeledProfileInput[],
  gods: readonly GodProfile[],
  paletteFamilies: readonly string[],
): ParseResult<readonly GodVisualProfile[]> {
  const godIds = new Set(gods.map((god) => god.id));
  const seenGods = new Set<string>();
  const seenPortraits = new Set<string>();
  const profiles: GodVisualProfile[] = [];
  for (const { label, value } of inputs) {
    const parsed = parseGodVisualProfile(value, label);
    if (!parsed.ok) return parsed;
    const profile = parsed.value;
    if (!godIds.has(profile.godId)) {
      return fail(
        `${label}.godId`,
        `visual profile for unknown god "${profile.godId}"`,
      );
    }
    if (seenGods.has(profile.godId)) {
      return fail(
        `${label}.godId`,
        `duplicate visual profile for "${profile.godId}"`,
      );
    }
    seenGods.add(profile.godId);
    if (!paletteFamilies.includes(profile.paletteFamily)) {
      return fail(
        `${label}.paletteFamily`,
        `unknown palette family "${profile.paletteFamily}"`,
      );
    }
    if (profile.portrait !== undefined) {
      if (seenPortraits.has(profile.portrait)) {
        return fail(
          `${label}.portrait`,
          `portrait "${profile.portrait}" is already mapped to another god`,
        );
      }
      seenPortraits.add(profile.portrait);
    }
    profiles.push(profile);
  }
  return ok(profiles);
}
