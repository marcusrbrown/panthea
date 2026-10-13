// The studio's content loader: one explicit content root, read through the
// production parsers into the joined value request building and packing run
// on. It finds nothing on its own, guesses no defaults and never throws on bad
// content: every problem is a diagnostic naming its file. Diagnostics carry
// the parsers' own field-level messages, never a file's text.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseGodProfile, parseGodVisualProfiles } from "@panthea/content";
import { parseAssetVocabulary } from "@panthea/contracts";
import { type Palette, type PaletteSet, parsePalette } from "../palette";
import type { StudioContent } from "./request";

export interface ContentDiagnostic {
  /** The path of the file or directory at fault, relative to the content root. */
  readonly file: string;
  readonly message: string;
}

export type LoadedContent =
  | { readonly ok: true; readonly content: StudioContent }
  | { readonly ok: false; readonly diagnostics: readonly ContentDiagnostic[] };

const VOCABULARY = "assets/vocabulary.json";
const GODS = "gods";
const SUBJECTS = "assets/subjects";
const PALETTES = "palette";
const MAX_MESSAGE = 240;

const clip = (message: string) =>
  message.length <= MAX_MESSAGE
    ? message
    : `${message.slice(0, MAX_MESSAGE - 1)}…`;

type Read<T> =
  | { ok: true; value: T }
  | { ok: false; diagnostic: ContentDiagnostic };

function readText(root: string, file: string): Read<string> {
  const path = join(root, file);
  if (!existsSync(path))
    return { ok: false, diagnostic: { file, message: "is missing" } };
  try {
    if (!statSync(path).isFile())
      return { ok: false, diagnostic: { file, message: "is not a file" } };
    return { ok: true, value: readFileSync(path, "utf8") };
  } catch {
    return { ok: false, diagnostic: { file, message: "cannot be read" } };
  }
}

function readJson(root: string, file: string): Read<unknown> {
  const text = readText(root, file);
  if (!text.ok) return text;
  try {
    return { ok: true, value: JSON.parse(text.value) };
  } catch {
    return { ok: false, diagnostic: { file, message: "is not valid JSON" } };
  }
}

function jsonFiles(root: string, dir: string): Read<string[]> {
  const path = join(root, dir);
  try {
    if (!statSync(path).isDirectory())
      return {
        ok: false,
        diagnostic: { file: dir, message: "is not a directory" },
      };
    const names = readdirSync(path)
      .filter((name) => name.endsWith(".json"))
      .sort();
    return names.length === 0
      ? { ok: false, diagnostic: { file: dir, message: "holds no JSON files" } }
      : { ok: true, value: names };
  } catch {
    return {
      ok: false,
      diagnostic: { file: dir, message: "is missing or cannot be read" },
    };
  }
}

interface PaletteFiles {
  /** The subdirectory of the palette root: none for the root palette, else the directory's name (the palette's id). */
  readonly subdirectory: string;
  readonly json: Read<unknown>;
  readonly gpl: Read<string>;
  readonly hex: Read<string>;
}

const paletteFile = (subdirectory: string, name: string) =>
  subdirectory === ""
    ? `${PALETTES}/${name}`
    : `${PALETTES}/${subdirectory}/${name}`;

/** The text of every palette's three files: the palette root's, then each subdirectory's. */
function readPaletteFiles(root: string): PaletteFiles[] {
  let subdirectories: string[] = [];
  try {
    subdirectories = readdirSync(join(root, PALETTES))
      .filter((name) => statSync(join(root, PALETTES, name)).isDirectory())
      .sort();
  } catch {
    // A missing palette root shows up as the root palette's missing files.
  }
  return ["", ...subdirectories].map((subdirectory) => ({
    subdirectory,
    json: readJson(root, paletteFile(subdirectory, "palette.json")),
    gpl: readText(root, paletteFile(subdirectory, "master.gpl")),
    hex: readText(root, paletteFile(subdirectory, "master.hex")),
  }));
}

/** Parses the palettes read from disk into a set by id; every problem names the file that has it. */
function parsePaletteFiles(
  files: readonly PaletteFiles[],
  families: readonly string[],
  problem: (file: string, message: string) => void,
): PaletteSet {
  const palettes = new Map<string, Palette>();
  for (const { subdirectory, json, gpl, hex } of files) {
    if (!json.ok || !gpl.ok || !hex.ok) continue;
    const parsed = parsePalette(
      { json: json.value, gpl: gpl.value, hex: hex.value },
      families,
    );
    if (!parsed.ok) {
      const name = parsed.path.includes("master.gpl")
        ? "master.gpl"
        : parsed.path.includes("master.hex")
          ? "master.hex"
          : "palette.json";
      problem(
        paletteFile(subdirectory, name),
        `${parsed.path}: ${parsed.message}`,
      );
    } else if (subdirectory !== "" && parsed.value.id !== subdirectory) {
      problem(
        paletteFile(subdirectory, "palette.json"),
        `id: the palette in ${PALETTES}/${subdirectory} declares "${parsed.value.id}", not "${subdirectory}"`,
      );
    } else if (palettes.has(parsed.value.id)) {
      problem(
        paletteFile(subdirectory, "palette.json"),
        `id: another palette already has the id "${parsed.value.id}"`,
      );
    } else {
      palettes.set(parsed.value.id, parsed.value);
    }
  }
  return palettes;
}

export type LoadedPalettes =
  | { readonly ok: true; readonly palettes: PaletteSet }
  | { readonly ok: false; readonly diagnostics: readonly ContentDiagnostic[] };

/**
 * Reads and validates every palette under a content root afresh: `greek-master`
 * from the palette root, any other from its subdirectory. Pack, approve and
 * publish call it for each operation, so a palette edited on disk after the
 * content was loaded is what they judge, never a cached copy.
 */
export function loadStudioPalettes(
  contentRoot: string,
  families: readonly string[],
): LoadedPalettes {
  const diagnostics: ContentDiagnostic[] = [];
  const problem = (file: string, message: string) =>
    diagnostics.push({ file, message: clip(message) });
  const files = readPaletteFiles(contentRoot);
  for (const { json, gpl, hex } of files)
    for (const read of [json, gpl, hex])
      if (!read.ok) diagnostics.push(read.diagnostic);
  const palettes = parsePaletteFiles(files, families, problem);
  return diagnostics.length > 0
    ? { ok: false, diagnostics }
    : { ok: true, palettes };
}

/** Loads the vocabulary, god and visual profiles and palettes under a content root. */
export function loadStudioContent(contentRoot: string): LoadedContent {
  if (contentRoot === "")
    return {
      ok: false,
      diagnostics: [{ file: ".", message: "no content root was given" }],
    };
  const diagnostics: ContentDiagnostic[] = [];
  const problem = (file: string, message: string) =>
    diagnostics.push({ file, message: clip(message) });

  const vocabularyJson = readJson(contentRoot, VOCABULARY);
  if (!vocabularyJson.ok) diagnostics.push(vocabularyJson.diagnostic);
  const godNames = jsonFiles(contentRoot, GODS);
  if (!godNames.ok) diagnostics.push(godNames.diagnostic);
  const subjectNames = jsonFiles(contentRoot, SUBJECTS);
  if (!subjectNames.ok) diagnostics.push(subjectNames.diagnostic);
  const paletteFiles = readPaletteFiles(contentRoot);
  for (const { json, gpl, hex } of paletteFiles)
    for (const read of [json, gpl, hex])
      if (!read.ok) diagnostics.push(read.diagnostic);

  const godInputs: { name: string; value: unknown }[] = [];
  for (const name of godNames.ok ? godNames.value : []) {
    const file = `${GODS}/${name}`;
    const json = readJson(contentRoot, file);
    if (json.ok) godInputs.push({ name, value: json.value });
    else diagnostics.push(json.diagnostic);
  }
  const subjectInputs: { name: string; value: unknown }[] = [];
  for (const name of subjectNames.ok ? subjectNames.value : []) {
    const file = `${SUBJECTS}/${name}`;
    const json = readJson(contentRoot, file);
    if (json.ok) subjectInputs.push({ name, value: json.value });
    else diagnostics.push(json.diagnostic);
  }

  const vocabulary = vocabularyJson.ok
    ? parseAssetVocabulary(vocabularyJson.value)
    : undefined;
  if (vocabulary !== undefined && !vocabulary.ok)
    problem(VOCABULARY, `${vocabulary.path}: ${vocabulary.message}`);

  const gods = [];
  for (const { name, value } of godInputs) {
    const parsed = parseGodProfile(value, name);
    if (parsed.ok) gods.push(parsed.value);
    else problem(`${GODS}/${name}`, `${parsed.path}: ${parsed.message}`);
  }

  if (vocabulary === undefined || !vocabulary.ok)
    return { ok: false, diagnostics };
  const families = vocabulary.value.paletteFamilies;

  let visuals: StudioContent["visuals"] = [];
  const brokenGods = godInputs.length !== gods.length || !godNames.ok;
  if (
    !brokenGods &&
    subjectNames.ok &&
    subjectInputs.length === subjectNames.value.length
  ) {
    const parsed = parseGodVisualProfiles(
      subjectInputs.map(({ name, value }) => ({ label: name, value })),
      gods,
      families,
    );
    if (parsed.ok) visuals = parsed.value;
    else {
      const named = subjectInputs.find(({ name }) =>
        parsed.path.includes(name),
      );
      problem(
        named === undefined ? SUBJECTS : `${SUBJECTS}/${named.name}`,
        `${parsed.path}: ${parsed.message}`,
      );
    }
  }

  const palettes = parsePaletteFiles(paletteFiles, families, problem);

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return {
    ok: true,
    content: { vocabulary: vocabulary.value, gods, visuals, palettes },
  };
}
