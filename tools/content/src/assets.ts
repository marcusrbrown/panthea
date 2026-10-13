// Standalone asset validator: checks the committed asset data under a content
// root (default content/greek) without the studio. Layout:
//
//   <root>/gods/*.json                     core god profiles (read only)
//   <root>/world/inhabitants.json          inhabitants' sprite ids (read only)
//   <root>/assets/vocabulary.json          versioned vocabulary
//   <root>/assets/subjects/*.json          visual profiles, joined by god id; a subject's render
//                                          matrix is checked against the vocabulary, and a god whose
//                                          sprite is an asset on the matrix's cell class must hold
//                                          every slot the matrix requires
//   <root>/assets/registry/                index.json, manifests/, blobs/
//   <root>/palette/                        palette.json, master.gpl, master.hex
//
// With a repository root, it also runs the render checks: the curated kit library under
// <repo>/tools/render (kits.json against the kit files and the profiles' references) and the
// GPL/MIT licence boundary over every Python file in the repository.
//
// A published manifest is validated from plain files alone: its provenance
// carries the job refs and licences it needs, so no authoring ledger is read.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadRegistry,
  paletteRefusal,
  readRevision,
} from "@panthea/assets/registry";
import {
  checkKits,
  checkLicenceBoundary,
  type ProfileKitRefs,
} from "@panthea/assets/render";
import {
  type GodProfile,
  type GodVisualProfile,
  parseGodProfile,
  parseGodVisualProfiles,
  type RenderMatrix,
  requiredRenderSlotKeys,
} from "@panthea/content";
import {
  type AssetVocabulary,
  type ParseFailure,
  parseAssetId,
  parseAssetVocabulary,
  slotKeys,
  stateRuleFor,
} from "@panthea/contracts";
import { readPalette } from "./palette";

export interface AssetDiagnostic {
  /** Path relative to the content root. */
  readonly file: string;
  readonly message: string;
}

export interface AssetValidation {
  readonly ok: boolean;
  readonly diagnostics: readonly AssetDiagnostic[];
}

function readJson(
  path: string,
): { ok: true; value: unknown } | { ok: false; message: string } {
  if (!existsSync(path)) return { ok: false, message: "file is missing" };
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return { ok: false, message: "not valid JSON" };
  }
}

function jsonFiles(dir: string): string[] {
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : [];
}

/** A parse failure whose path starts with the file label, split into file and message. */
function located(label: string, failure: ParseFailure): AssetDiagnostic {
  const within = failure.path.startsWith(label)
    ? failure.path.slice(label.length).replace(/^\./, "")
    : failure.path;
  return {
    file: label,
    message: `${within === "" ? "" : `${within}: `}${failure.message}`,
  };
}

/** The prefix of the ids an inhabitant draws as until the studio publishes art for it. */
const PLACEHOLDER_PREFIX = "placeholder-";

/**
 * Each non-deity inhabitant's sprite id, in `world/inhabitants.json`, is a valid asset id that is either
 * `placeholder-*` or a sprite published in the registry. A deity authors none (its god profile's sprite is
 * the only source, checked with the gods above), and the content parser refuses a deity that does.
 */
function validateInhabitantSprites(
  contentRoot: string,
  published: ReadonlyMap<
    string,
    { readonly manifest: { readonly kind: string } }
  >,
  report: (file: string, message: string) => void,
): void {
  const file = "world/inhabitants.json";
  const json = readJson(join(contentRoot, file));
  if (!json.ok) {
    report(file, json.message);
    return;
  }
  const inhabitants = isRecordWithArray(json.value, "inhabitants");
  if (inhabitants === undefined) {
    report(file, "expected an object with an inhabitants array");
    return;
  }
  for (const [index, entry] of inhabitants.entries()) {
    if (typeof entry !== "object" || entry === null) {
      report(file, `inhabitants[${index}]: expected an inhabitant entry`);
      continue;
    }
    const inhabitant = entry as Record<string, unknown>;
    if (inhabitant.deity === true) continue;
    const who = `inhabitants[${index}]${typeof inhabitant.id === "string" ? ` (${inhabitant.id})` : ""}`;
    const sprite = inhabitant.sprite;
    if (typeof sprite !== "string" || sprite === "") {
      report(file, `${who}: sprite must be a non-empty asset id`);
      continue;
    }
    if (!parseAssetId(sprite, "sprite").ok) {
      report(
        file,
        `${who}: sprite "${sprite}" is not a valid asset id (lowercase, hyphenated)`,
      );
      continue;
    }
    if (sprite.startsWith(PLACEHOLDER_PREFIX)) continue;
    const entryInRegistry = published.get(sprite);
    if (entryInRegistry === undefined) {
      report(
        file,
        `${who}: sprite "${sprite}" is neither published in the registry nor a ${PLACEHOLDER_PREFIX}* id`,
      );
    } else if (entryInRegistry.manifest.kind !== "sprite") {
      report(
        file,
        `${who}: sprite "${sprite}" is published as a ${entryInRegistry.manifest.kind}, not a sprite`,
      );
    }
  }
}

function isRecordWithArray(
  value: unknown,
  key: string,
): readonly unknown[] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const found = (value as Record<string, unknown>)[key];
  return Array.isArray(found) ? found : undefined;
}

/** The matrix's cell class, states, abilities and facings are ones the vocabulary honours. */
function validateRenderMatrix(
  matrix: RenderMatrix,
  vocabulary: AssetVocabulary,
  report: (message: string) => void,
): void {
  const cell = vocabulary.cells.find((c) => c.id === matrix.cellClass);
  if (cell === undefined) {
    report(`render.matrix.cellClass: unknown cell class "${matrix.cellClass}"`);
    return;
  }
  if (!cell.kinds.includes("sprite")) {
    report(
      `render.matrix.cellClass: cell class "${cell.id}" does not hold sprites`,
    );
    return;
  }
  for (const direction of matrix.directions) {
    if (!vocabulary.directions.includes(direction))
      report(`render.matrix.directions: unknown direction "${direction}"`);
  }
  for (const group of ["required", "deferred"] as const) {
    for (const slot of matrix[group]) {
      const rule = stateRuleFor(vocabulary, slot.state, cell.id);
      if (rule === undefined) {
        report(
          `render.matrix.${group}: state "${slot.state}" has no rule on cell class "${cell.id}"`,
        );
      } else if (rule.perAbility && slot.ability === undefined) {
        report(
          `render.matrix.${group}: state "${slot.state}" is bound to an ability, and the slot names none`,
        );
      } else if (!rule.perAbility && slot.ability !== undefined) {
        report(
          `render.matrix.${group}: state "${slot.state}" takes no ability, and the slot names "${slot.ability}"`,
        );
      }
    }
  }
}

export interface AssetValidationOptions {
  /** The repository root. When given, the render kit and licence-boundary checks run against it. */
  readonly repoRoot?: string;
  /** The kit files each render profile references; empty until the profiles exist (U6). */
  readonly kitProfiles?: readonly ProfileKitRefs[];
}

/** Kit library and licence boundary. Diagnostics name paths relative to the repository root. */
function validateRender(
  repoRoot: string,
  profiles: readonly ProfileKitRefs[],
  report: (file: string, message: string) => void,
): void {
  for (const problem of checkKits(join(repoRoot, "tools", "render"), profiles)
    .problems) {
    report(`tools/render/${problem.file}`, problem.message);
  }
  for (const violation of checkLicenceBoundary(repoRoot)) {
    report(violation.file, `line ${violation.line}: ${violation.message}`);
  }
}

export function validateAssets(
  contentRoot: string,
  options: AssetValidationOptions = {},
): AssetValidation {
  const diagnostics: AssetDiagnostic[] = [];
  const report = (file: string, message: string) =>
    diagnostics.push({ file, message });
  if (options.repoRoot !== undefined) {
    validateRender(options.repoRoot, options.kitProfiles ?? [], report);
  }
  const done = (): AssetValidation => ({
    ok: diagnostics.length === 0,
    diagnostics,
  });

  // Vocabulary: everything else is checked against it.
  const vocabularyFile = "assets/vocabulary.json";
  const vocabularyJson = readJson(join(contentRoot, vocabularyFile));
  if (!vocabularyJson.ok) {
    report(vocabularyFile, vocabularyJson.message);
    return done();
  }
  const parsedVocabulary = parseAssetVocabulary(vocabularyJson.value);
  if (!parsedVocabulary.ok) {
    diagnostics.push(
      located(vocabularyFile, {
        ...parsedVocabulary,
        path: parsedVocabulary.path.replace(/^vocabulary/, vocabularyFile),
      }),
    );
    return done();
  }
  const vocabulary: AssetVocabulary = parsedVocabulary.value;

  // Master palette: canon needs it approved and named by every manifest.
  const paletteRead = readPalette(contentRoot, vocabulary.paletteFamilies);
  if (!paletteRead.ok) diagnostics.push(...paletteRead.diagnostics);
  const palette = paletteRead.ok ? paletteRead.palette : undefined;

  // Gods: parsed read-only, for stable sprite ids and ability ids.
  const gods: GodProfile[] = [];
  const spriteOwners = new Map<string, { god: GodProfile; file: string }>();
  for (const name of jsonFiles(join(contentRoot, "gods"))) {
    const file = `gods/${name}`;
    const json = readJson(join(contentRoot, file));
    if (!json.ok) {
      report(file, json.message);
      continue;
    }
    const parsed = parseGodProfile(json.value, file);
    if (!parsed.ok) {
      diagnostics.push(located(file, parsed));
      continue;
    }
    const god = parsed.value;
    gods.push(god);
    if (!parseAssetId(god.sprite, "sprite").ok) {
      report(
        file,
        `sprite "${god.sprite}" is not a valid asset id (lowercase, hyphenated)`,
      );
      continue;
    }
    const previous = spriteOwners.get(god.sprite);
    if (previous !== undefined) {
      report(
        file,
        `sprite "${god.sprite}" is already the stable sprite id of ${previous.file}`,
      );
      continue;
    }
    spriteOwners.set(god.sprite, { god, file });
  }

  // Visual profiles: joined to gods by id.
  const subjectInputs: { label: string; value: unknown }[] = [];
  for (const name of jsonFiles(join(contentRoot, "assets", "subjects"))) {
    const label = `assets/subjects/${name}`;
    const json = readJson(join(contentRoot, label));
    if (json.ok) subjectInputs.push({ label, value: json.value });
    else report(label, json.message);
  }
  const profiles = parseGodVisualProfiles(
    subjectInputs,
    gods,
    vocabulary.paletteFamilies,
  );
  const visuals: readonly GodVisualProfile[] = profiles.ok
    ? profiles.value
    : [];
  if (!profiles.ok) {
    const label =
      subjectInputs.find((input) => profiles.path.startsWith(input.label))
        ?.label ?? profiles.path;
    diagnostics.push(located(label, profiles));
  }

  // Registry: every file check lives in loadRegistry; problems become diagnostics.
  const registryDir = join(contentRoot, "assets", "registry");
  const registry = loadRegistry(registryDir, vocabulary);
  for (const problem of registry.problems) {
    report(`assets/registry/${problem.file}`, problem.message);
  }

  validateInhabitantSprites(contentRoot, registry.snapshot.entries, report);

  // Render matrices: honoured by the vocabulary, and filled by the asset a god's profile points at.
  const subjectFiles = new Map(
    subjectInputs.flatMap((input) =>
      typeof input.value === "object" &&
      input.value !== null &&
      typeof (input.value as { godId?: unknown }).godId === "string"
        ? [[(input.value as { godId: string }).godId, input.label] as const]
        : [],
    ),
  );
  for (const visual of visuals) {
    if (visual.render === undefined) continue;
    const { matrix } = visual.render;
    const subjectFile = subjectFiles.get(visual.godId) ?? "assets/subjects";
    let honoured = true;
    validateRenderMatrix(matrix, vocabulary, (message) => {
      honoured = false;
      report(subjectFile, message);
    });
    const god = gods.find((g) => g.id === visual.godId);
    const cell = vocabulary.cells.find((c) => c.id === matrix.cellClass);
    const entry = god && registry.snapshot.entries.get(god.sprite);
    if (!honoured || god === undefined || cell === undefined) continue;
    // The matrix binds the assets on its own cell class; a god's legacy sprite on another class is not under it.
    if (
      entry === undefined ||
      entry.manifest.kind !== "sprite" ||
      entry.manifest.cell.w !== cell.w ||
      entry.manifest.cell.h !== cell.h
    )
      continue;
    const held = new Set(slotKeys(entry.manifest));
    const missing = requiredRenderSlotKeys(matrix).filter(
      (key) => !held.has(key),
    );
    if (missing.length > 0) {
      report(
        spriteOwners.get(god.sprite)?.file ?? `gods/${god.id}.json`,
        `sprite "${god.sprite}" is on the ${cell.id} cell, so it must hold every slot ${visual.godId}'s render matrix requires; missing ${missing.join(", ")}`,
      );
    }
  }

  const godById = new Map(gods.map((god) => [god.id, god]));
  const portraitOwners = new Map(
    visuals.flatMap((v) =>
      v.portrait === undefined ? [] : [[v.portrait, v.godId] as const],
    ),
  );
  for (const entry of registry.snapshot.entries.values()) {
    const { manifest } = entry;
    const file = `assets/registry/manifests/${entry.revision}.json`;
    const refusal =
      palette === undefined ? undefined : paletteRefusal(manifest, palette);
    if (refusal !== undefined) report(file, refusal);
    for (const source of manifest.provenance.sourceAssets) {
      const read = readRevision(
        registryDir,
        source.assetId,
        source.revision,
        vocabulary,
      );
      if (!read.ok)
        report(
          file,
          `source revision ${source.assetId} ${source.revision} cannot be read: ${read.message}`,
        );
    }
    const owner = spriteOwners.get(entry.assetId);
    if (owner !== undefined && manifest.kind !== "sprite") {
      report(
        file,
        `"${entry.assetId}" is ${owner.file}'s stable sprite id but the manifest is a ${manifest.kind}`,
      );
    }
    if (manifest.kind === "sprite" && manifest.asymmetry !== undefined) {
      // The subject is authoritative. A manifest that predates its declaration may
      // carry none; one that carries a feature must carry the subject's.
      const declared =
        owner === undefined
          ? undefined
          : visuals.find((v) => v.godId === owner.god.id)?.asymmetry;
      if (declared === undefined) {
        report(
          file,
          `asymmetry "${manifest.asymmetry.feature}" on "${entry.assetId}", whose subject declares no asymmetry`,
        );
      } else if (declared.feature !== manifest.asymmetry.feature) {
        report(
          file,
          `asymmetry "${manifest.asymmetry.feature}" is not the subject's "${declared.feature}"`,
        );
      }
    }
    if (manifest.kind === "sprite") {
      for (const animation of manifest.animations) {
        if (animation.ability === undefined) continue;
        if (owner === undefined) {
          report(
            file,
            `ability "${animation.ability}" on "${entry.assetId}", which is no god's stable sprite id`,
          );
        } else if (
          !owner.god.abilities.some(
            (ability) => ability.id === animation.ability,
          )
        ) {
          report(
            file,
            `ability "${animation.ability}" is not an ability of ${owner.god.id}`,
          );
        }
      }
    }
    if (manifest.kind === "portrait") {
      if (!godById.has(manifest.characterId)) {
        report(file, `portrait character "${manifest.characterId}" is no god`);
      }
      const mapped = portraitOwners.get(entry.assetId);
      if (mapped !== undefined && mapped !== manifest.characterId) {
        report(
          file,
          `"${entry.assetId}" is mapped to ${mapped}'s portrait but depicts "${manifest.characterId}"`,
        );
      }
    }
  }
  for (const [portrait, godId] of portraitOwners) {
    const entry = registry.snapshot.entries.get(portrait);
    if (entry !== undefined && entry.manifest.kind !== "portrait") {
      report(
        `assets/registry/manifests/${entry.revision}.json`,
        `"${portrait}" is ${godId}'s portrait id but the manifest is a ${entry.manifest.kind}`,
      );
    }
  }
  return done();
}
