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
  parseUniqueSlugs,
} from "@panthea/contracts";
import type { GodProfile, LabeledProfileInput } from "./god-profile";

export const GOD_VISUAL_PROFILE_SCHEMA_VERSIONS = ASSET_SCHEMA_VERSIONS;

/** One slot a matrix names: a state, and the ability when the state is bound to one. */
export interface RenderMatrixSlot {
  readonly state: string;
  readonly ability?: string;
}

/**
 * The slots a rendered asset of this subject must hold, on one cell class. Every
 * required slot is held in every facing. Slots under `deferred` are named so
 * that leaving them out is a recorded decision, not an omission.
 */
export interface RenderMatrix {
  readonly cellClass: string;
  readonly directions: readonly string[];
  readonly required: readonly RenderMatrixSlot[];
  readonly deferred: readonly RenderMatrixSlot[];
}

/** The render profile a subject names (a file under tools/render/profiles) and the matrix it must fill. */
export interface RenderSubject {
  readonly profile: string;
  readonly matrix: RenderMatrix;
}

export interface GodVisualProfile {
  readonly schemaVersion: number;
  /** The god's profile id. */
  readonly godId: string;
  readonly paletteFamily: string;
  readonly iconography: readonly string[];
  /** Asset id of the god's portrait, when one is mapped. */
  readonly portrait?: string;
  /**
   * Present when the god is drawn, not mirrored, on the west side. The
   * subject is authoritative: derivation refuses to mirror while it is set.
   */
  readonly asymmetry?: { readonly feature: string };
  /** Present when the god is drawn by the render pipeline; absent for a hand-drawn god. */
  readonly render?: RenderSubject;
}

/** The slot keys (`state/direction[/ability]`) a rendered asset must hold: each required slot in each facing. */
export function requiredRenderSlotKeys(matrix: RenderMatrix): string[] {
  return matrix.required.flatMap(({ state, ability }) =>
    matrix.directions.map((direction) =>
      [state, direction, ability]
        .filter((part) => part !== undefined)
        .join("/"),
    ),
  );
}

const slotId = ({ state, ability }: RenderMatrixSlot): string =>
  ability === undefined ? state : `${state}/${ability}`;

function parseMatrixSlots(
  value: unknown,
  path: string,
  options: { readonly nonEmpty: boolean },
): ParseResult<readonly RenderMatrixSlot[]> {
  const slots = parseArray(value, path, (slot, slotPath) =>
    parseStrictRecord(slot, slotPath, ["state", "ability"], (record) => {
      const state = parseSlug(record.state, `${slotPath}.state`);
      if (!state.ok) return state;
      if (record.ability === undefined) return ok({ state: state.value });
      const ability = parseSlug(record.ability, `${slotPath}.ability`);
      if (!ability.ok) return ability;
      return ok({ state: state.value, ability: ability.value });
    }),
  );
  if (!slots.ok) return slots;
  if (options.nonEmpty && slots.value.length === 0)
    return fail(path, "expected at least one slot");
  const seen = new Set<string>();
  for (const [index, slot] of slots.value.entries()) {
    const id = slotId(slot);
    if (seen.has(id)) return fail(`${path}[${index}]`, `duplicate "${id}"`);
    seen.add(id);
  }
  return slots;
}

function parseRenderSubject(
  value: unknown,
  path: string,
): ParseResult<RenderSubject> {
  return parseStrictRecord(value, path, ["profile", "matrix"], (record) => {
    const profile = parseSlug(record.profile, `${path}.profile`);
    if (!profile.ok) return profile;
    const matrix = parseStrictRecord(
      record.matrix,
      `${path}.matrix`,
      ["cellClass", "directions", "required", "deferred"],
      (m): ParseResult<RenderMatrix> => {
        const cellClass = parseSlug(m.cellClass, `${path}.matrix.cellClass`);
        if (!cellClass.ok) return cellClass;
        const directions = parseUniqueSlugs(
          m.directions,
          `${path}.matrix.directions`,
        );
        if (!directions.ok) return directions;
        const required = parseMatrixSlots(
          m.required,
          `${path}.matrix.required`,
          {
            nonEmpty: true,
          },
        );
        if (!required.ok) return required;
        const deferred = parseMatrixSlots(
          m.deferred ?? [],
          `${path}.matrix.deferred`,
          { nonEmpty: false },
        );
        if (!deferred.ok) return deferred;
        const requiredIds = new Set(required.value.map(slotId));
        for (const [index, slot] of deferred.value.entries()) {
          if (requiredIds.has(slotId(slot)))
            return fail(
              `${path}.matrix.deferred[${index}]`,
              `"${slotId(slot)}" is required, so it is not deferred`,
            );
        }
        return ok({
          cellClass: cellClass.value,
          directions: directions.value,
          required: required.value,
          deferred: deferred.value,
        });
      },
    );
    if (!matrix.ok) return matrix;
    return ok({ profile: profile.value, matrix: matrix.value });
  });
}

export function parseGodVisualProfile(
  input: unknown,
  path = "visual",
): ParseResult<GodVisualProfile> {
  return parseStrictRecord(
    input,
    path,
    [
      "schemaVersion",
      "godId",
      "paletteFamily",
      "iconography",
      "portrait",
      "asymmetry",
      "render",
    ],
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
      let portrait: string | undefined;
      if (record.portrait !== undefined) {
        const parsed = parseAssetId(record.portrait, `${path}.portrait`);
        if (!parsed.ok) return parsed;
        portrait = parsed.value;
      }
      let asymmetry: { feature: string } | undefined;
      if (record.asymmetry !== undefined) {
        const parsed = parseStrictRecord(
          record.asymmetry,
          `${path}.asymmetry`,
          ["feature"],
          (a) => {
            const feature = parseString(a.feature, `${path}.asymmetry.feature`);
            return feature.ok ? ok({ feature: feature.value }) : feature;
          },
        );
        if (!parsed.ok) return parsed;
        asymmetry = parsed.value;
      }
      let render: RenderSubject | undefined;
      if (record.render !== undefined) {
        const parsed = parseRenderSubject(record.render, `${path}.render`);
        if (!parsed.ok) return parsed;
        render = parsed.value;
      }
      return ok({
        schemaVersion: schemaVersion.value,
        godId: godId.value,
        paletteFamily: paletteFamily.value,
        iconography: iconography.value,
        ...(portrait === undefined ? {} : { portrait }),
        ...(asymmetry === undefined ? {} : { asymmetry }),
        ...(render === undefined ? {} : { render }),
      });
    },
  );
}

/**
 * Parses a set of visual profiles against the god profiles and the
 * vocabulary's palette families: each belongs to a known god, at most once,
 * names a known family, names only abilities its god has in a render matrix,
 * and no two share a portrait id.
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
    if (profile.render !== undefined) {
      const god = gods.find((g) => g.id === profile.godId);
      const abilities = new Set(god?.abilities.map((a) => a.id));
      for (const group of ["required", "deferred"] as const) {
        for (const [index, slot] of profile.render.matrix[group].entries()) {
          if (slot.ability !== undefined && !abilities.has(slot.ability)) {
            return fail(
              `${label}.render.matrix.${group}[${index}].ability`,
              `"${slot.ability}" is not an ability of ${profile.godId}`,
            );
          }
        }
      }
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
