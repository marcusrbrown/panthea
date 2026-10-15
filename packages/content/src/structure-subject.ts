// Structure subjects (content/greek/assets/structures/*.json): a tree or a building the render
// pipeline draws. They are kept apart from the god visual profiles, whose parser needs a god, and
// share the render subject (profile and matrix) with them. A structure has no abilities.

import {
  ASSET_SCHEMA_VERSIONS,
  fail,
  ok,
  type ParseResult,
  parseSchemaVersion,
  parseSlug,
  parseStrictRecord,
  parseString,
} from "@panthea/contracts";
import type { LabeledProfileInput } from "./god-profile";
import { parseRenderSubject, type RenderSubject } from "./god-visual-profile";

export const STRUCTURE_SUBJECT_SCHEMA_VERSIONS = ASSET_SCHEMA_VERSIONS;

export interface StructureSubject {
  readonly schemaVersion: number;
  /** The subject id requests name; it shares its namespace with the gods'. */
  readonly id: string;
  readonly name: string;
  readonly paletteFamily: string;
  readonly render: RenderSubject;
}

export function parseStructureSubject(
  input: unknown,
  path = "structure",
): ParseResult<StructureSubject> {
  return parseStrictRecord(
    input,
    path,
    ["schemaVersion", "id", "name", "paletteFamily", "render"],
    (record) => {
      const schemaVersion = parseSchemaVersion(
        record.schemaVersion,
        STRUCTURE_SUBJECT_SCHEMA_VERSIONS,
        `${path}.schemaVersion`,
      );
      if (!schemaVersion.ok) return schemaVersion;
      const id = parseSlug(record.id, `${path}.id`);
      if (!id.ok) return id;
      const name = parseString(record.name, `${path}.name`);
      if (!name.ok) return name;
      const paletteFamily = parseSlug(
        record.paletteFamily,
        `${path}.paletteFamily`,
      );
      if (!paletteFamily.ok) return paletteFamily;
      const render = parseRenderSubject(record.render, `${path}.render`);
      if (!render.ok) return render;
      for (const group of ["required", "deferred"] as const) {
        for (const [index, slot] of render.value.matrix[group].entries()) {
          if (slot.ability !== undefined)
            return fail(
              `${path}.render.matrix.${group}[${index}].ability`,
              "a structure has no abilities",
            );
        }
      }
      return ok({
        schemaVersion: schemaVersion.value,
        id: id.value,
        name: name.value,
        paletteFamily: paletteFamily.value,
        render: render.value,
      });
    },
  );
}

/**
 * Parses a set of structure subjects: each id is unique, is not a god's (requests name a subject
 * by one id), and each names a known palette family.
 */
export function parseStructureSubjects(
  inputs: readonly LabeledProfileInput[],
  godIds: readonly string[],
  paletteFamilies: readonly string[],
): ParseResult<readonly StructureSubject[]> {
  const seen = new Set<string>();
  const subjects: StructureSubject[] = [];
  for (const { label, value } of inputs) {
    const parsed = parseStructureSubject(value, label);
    if (!parsed.ok) return parsed;
    const subject = parsed.value;
    if (godIds.includes(subject.id))
      return fail(`${label}.id`, `"${subject.id}" is a god, not a structure`);
    if (seen.has(subject.id))
      return fail(`${label}.id`, `duplicate structure "${subject.id}"`);
    seen.add(subject.id);
    if (!paletteFamilies.includes(subject.paletteFamily))
      return fail(
        `${label}.paletteFamily`,
        `unknown palette family "${subject.paletteFamily}"`,
      );
    subjects.push(subject);
  }
  return ok(subjects);
}
