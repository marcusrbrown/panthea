// Standalone asset validator: checks the committed asset data under a content
// root (default content/greek) without the studio. Layout:
//
//   <root>/gods/*.json                     core god profiles (read only)
//   <root>/world/inhabitants.json          inhabitants' sprite ids (read only)
//   <root>/assets/vocabulary.json          versioned vocabulary
//   <root>/assets/subjects/*.json          visual profiles, joined by god id
//   <root>/assets/registry/                index.json, manifests/, blobs/
//   <root>/palette/                        palette.json, master.gpl, master.hex
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
  type GodProfile,
  type GodVisualProfile,
  parseGodProfile,
  parseGodVisualProfiles,
} from "@panthea/content";
import {
  type AssetVocabulary,
  type ParseFailure,
  parseAssetId,
  parseAssetVocabulary,
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

export function validateAssets(contentRoot: string): AssetValidation {
  const diagnostics: AssetDiagnostic[] = [];
  const report = (file: string, message: string) =>
    diagnostics.push({ file, message });
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
