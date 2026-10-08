// The studio's content loader: one explicit content root, read through the
// production parsers into the joined value request building and packing run
// on. It finds nothing on its own, guesses no defaults and never throws on bad
// content: every problem is a diagnostic naming its file. Diagnostics carry
// the parsers' own field-level messages, never a file's text.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseGodProfile, parseGodVisualProfiles } from "@panthea/content";
import { parseAssetVocabulary } from "@panthea/contracts";
import { parsePalette } from "../palette";
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
const PALETTE_JSON = "palette/palette.json";
const PALETTE_GPL = "palette/master.gpl";
const PALETTE_HEX = "palette/master.hex";
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

/** Loads the vocabulary, god and visual profiles and approved palette under a content root. */
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
  const paletteJson = readJson(contentRoot, PALETTE_JSON);
  if (!paletteJson.ok) diagnostics.push(paletteJson.diagnostic);
  const gpl = readText(contentRoot, PALETTE_GPL);
  if (!gpl.ok) diagnostics.push(gpl.diagnostic);
  const hex = readText(contentRoot, PALETTE_HEX);
  if (!hex.ok) diagnostics.push(hex.diagnostic);

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

  let palette: StudioContent["palette"] | undefined;
  if (paletteJson.ok && gpl.ok && hex.ok) {
    const parsed = parsePalette(
      { json: paletteJson.value, gpl: gpl.value, hex: hex.value },
      families,
    );
    if (parsed.ok) palette = parsed.value;
    else {
      const file = parsed.path.includes("master.gpl")
        ? PALETTE_GPL
        : parsed.path.includes("master.hex")
          ? PALETTE_HEX
          : PALETTE_JSON;
      problem(file, `${parsed.path}: ${parsed.message}`);
    }
  }

  if (diagnostics.length > 0 || palette === undefined)
    return { ok: false, diagnostics };
  return {
    ok: true,
    content: { vocabulary: vocabulary.value, gods, visuals, palette },
  };
}
