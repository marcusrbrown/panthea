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
//   <root>/assets/structures/*.json        trees and buildings, subjects of their own with a render
//                                          matrix; each names a structure profile whose cell and
//                                          clips the vocabulary must honour
//   <root>/assets/registry/                index.json, manifests/, blobs/
//   <root>/palette/                        greek-master: palette.json, master.gpl, master.hex
//   <root>/palette/<id>/                   any other palette (greek-retro), the same three files
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
  checkStamps,
  loadRenderInputs,
  type ModelProfile,
  type ProfileKitRefs,
  profileKitRefs,
} from "@panthea/assets/render";
import {
  type GodProfile,
  type GodVisualProfile,
  parseGodProfile,
  parseGodVisualProfiles,
  parseStructureSubjects,
  type RenderMatrix,
  requiredRenderSlotKeys,
  type StructureSubject,
} from "@panthea/content";
import {
  type AssetVocabulary,
  durationBounds,
  type ParseFailure,
  parseAssetId,
  parseAssetVocabulary,
  slotKeys,
  stateRuleFor,
} from "@panthea/contracts";
import { readPalettes } from "./palette";

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
  /**
   * The kit files each render profile references. Omitted, the profiles under tools/render/profiles
   * are loaded and checked (with the camera) and a subject's render.profile must name one. Given,
   * it stands in for them (fixtures), and neither the camera nor the subject check runs.
   */
  readonly kitProfiles?: readonly ProfileKitRefs[];
}

interface RenderFacts {
  /** The id of every profile file present; undefined when the caller supplied the profile refs itself. */
  readonly profileIds: ReadonlySet<string> | undefined;
  /** The profiles that parsed. */
  readonly profiles: readonly ModelProfile[];
}

/**
 * Camera, model profiles, kit library and licence boundary. Diagnostics name paths relative to
 * the repository root.
 */
function validateRender(
  repoRoot: string,
  suppliedProfiles: readonly ProfileKitRefs[] | undefined,
  report: (file: string, message: string) => void,
): RenderFacts {
  const renderRoot = join(repoRoot, "tools", "render");
  let profiles = suppliedProfiles;
  let profileIds: ReadonlySet<string> | undefined;
  let parsed: readonly ModelProfile[] = [];
  if (profiles === undefined) {
    const inputs = loadRenderInputs(renderRoot);
    for (const problem of inputs.problems) {
      report(`tools/render/${problem.file}`, problem.message);
    }
    profiles = inputs.profiles.map(profileKitRefs);
    profileIds = new Set(inputs.profileIds);
    parsed = inputs.profiles;
  }
  for (const problem of checkKits(renderRoot, profiles).problems) {
    report(`tools/render/${problem.file}`, problem.message);
  }
  for (const problem of checkStamps(join(repoRoot, "tools", "render"))
    .problems) {
    report(`tools/render/${problem.file}`, problem.message);
  }
  for (const violation of checkLicenceBoundary(repoRoot)) {
    report(violation.file, `line ${violation.line}: ${violation.message}`);
  }
  return { profileIds, profiles: parsed };
}

/**
 * A structure's profile is a structure profile on the cell its matrix names, and it renders each
 * state the matrix requires within the vocabulary's frame and timing rules for that cell.
 */
function validateStructureProfile(
  subject: StructureSubject,
  profile: ModelProfile | undefined,
  vocabulary: AssetVocabulary,
  report: (file: string, message: string) => void,
): void {
  const file = `tools/render/profiles/${subject.render.profile}.json`;
  const cell = vocabulary.cells.find(
    (c) => c.id === subject.render.matrix.cellClass,
  );
  if (profile === undefined || cell === undefined) return;
  if (profile.kind !== "structure") {
    report(
      file,
      `profile "${profile.id}" is a figure's, not a structure's, but ${subject.id} names it`,
    );
    return;
  }
  const drawn = profile.cell;
  if (drawn.id !== cell.id || drawn.width !== cell.w || drawn.height !== cell.h)
    report(
      file,
      `cell ${drawn.id} ${drawn.width}x${drawn.height} is not the vocabulary's ${cell.id} ${cell.w}x${cell.h}`,
    );
  for (const { state } of subject.render.matrix.required) {
    const clip = profile.clips[state];
    if (clip === undefined) {
      report(file, `no clip for ${state}, which ${subject.id} requires`);
      continue;
    }
    const rule = stateRuleFor(vocabulary, state, cell.id);
    if (rule === undefined) continue;
    if (clip.frames < rule.frames.min || clip.frames > rule.frames.max)
      report(
        file,
        `${state} renders at ${clip.frames} frames; the ${cell.id} rule allows ${rule.frames.min} to ${rule.frames.max}`,
      );
    if (rule.fps !== undefined) {
      const bounds = durationBounds(rule.fps);
      const bad = clip.frameMs.find((ms) => ms < bounds.min || ms > bounds.max);
      if (bad !== undefined)
        report(
          file,
          `${state} shows a frame for ${bad} ms; the ${cell.id} rule allows ${bounds.min} to ${bounds.max} ms`,
        );
    }
  }
}

export function validateAssets(
  contentRoot: string,
  options: AssetValidationOptions = {},
): AssetValidation {
  const diagnostics: AssetDiagnostic[] = [];
  const report = (file: string, message: string) =>
    diagnostics.push({ file, message });
  const render =
    options.repoRoot === undefined
      ? undefined
      : validateRender(options.repoRoot, options.kitProfiles, report);
  const renderProfileIds = render?.profileIds;
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

  // Palettes: canon needs the palette each manifest names, approved.
  const paletteRead = readPalettes(contentRoot, vocabulary.paletteFamilies);
  if (!paletteRead.ok) diagnostics.push(...paletteRead.diagnostics);
  const palettes = paletteRead.ok ? paletteRead.palettes : undefined;

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

  // Structures: subjects of their own, joined to render profiles and held to the vocabulary.
  const structureInputs: { label: string; value: unknown }[] = [];
  for (const name of jsonFiles(join(contentRoot, "assets", "structures"))) {
    const label = `assets/structures/${name}`;
    const json = readJson(join(contentRoot, label));
    if (json.ok) structureInputs.push({ label, value: json.value });
    else report(label, json.message);
  }
  const structures = parseStructureSubjects(
    structureInputs,
    gods.map((god) => god.id),
    vocabulary.paletteFamilies,
  );
  if (!structures.ok) {
    const label =
      structureInputs.find((input) => structures.path.startsWith(input.label))
        ?.label ?? structures.path;
    diagnostics.push(located(label, structures));
  } else {
    for (const [index, subject] of structures.value.entries()) {
      const label = structureInputs[index]?.label ?? "assets/structures";
      let honoured = true;
      validateRenderMatrix(subject.render.matrix, vocabulary, (message) => {
        honoured = false;
        report(label, message);
      });
      if (renderProfileIds === undefined || render === undefined) continue;
      if (!renderProfileIds.has(subject.render.profile)) {
        report(
          label,
          `render.profile "${subject.render.profile}" names no model profile under tools/render/profiles (${[...renderProfileIds].join(", ") || "none"})`,
        );
        continue;
      }
      if (honoured)
        validateStructureProfile(
          subject,
          render.profiles.find((p) => p.id === subject.render.profile),
          vocabulary,
          report,
        );
    }
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
    if (
      renderProfileIds !== undefined &&
      !renderProfileIds.has(visual.render.profile)
    ) {
      report(
        subjectFile,
        `render.profile "${visual.render.profile}" names no model profile under tools/render/profiles (${[...renderProfileIds].join(", ") || "none"})`,
      );
    }
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
  const legacyOwners = new Map<string, GodProfile>(
    visuals.flatMap((v) => {
      const god = godById.get(v.godId);
      return god === undefined
        ? []
        : (v.legacySprites ?? []).map((id) => [id, god] as const);
    }),
  );
  const portraitOwners = new Map(
    visuals.flatMap((v) =>
      v.portrait === undefined ? [] : [[v.portrait, v.godId] as const],
    ),
  );
  for (const entry of registry.snapshot.entries.values()) {
    const { manifest } = entry;
    const file = `assets/registry/manifests/${entry.revision}.json`;
    const palette = palettes?.get(manifest.paletteId);
    const refusal =
      palettes === undefined
        ? undefined
        : palette === undefined
          ? `the manifest names palette "${manifest.paletteId}", which is not among the palettes (${[...palettes.keys()].join(", ")})`
          : paletteRefusal(manifest, palette);
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
        // A sprite a god has since been promoted past stays published; its subject lists it as legacy.
        const abilityGod = owner?.god ?? legacyOwners.get(entry.assetId);
        if (abilityGod === undefined) {
          report(
            file,
            `ability "${animation.ability}" on "${entry.assetId}", which is no god's stable or legacy sprite id`,
          );
        } else if (
          !abilityGod.abilities.some(
            (ability) => ability.id === animation.ability,
          )
        ) {
          report(
            file,
            `ability "${animation.ability}" is not an ability of ${abilityGod.id}`,
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
