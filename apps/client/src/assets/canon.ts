// The client's registry client: asks the shell for the verified canon
// registry once, parses it with the contract parsers the node loader uses,
// and builds the snapshot the shared resolver reads. The shell checks file
// integrity and containment; the schema is parsed here and nowhere else.
//
// Everything is dropped-and-reported rather than thrown: a bad file, a
// refused atlas, or no shell at all leaves the affected sprites on the
// placeholder, and each distinct problem is reported once. Atlas bytes are
// fetched once per hash and kept, so a renderer rebuilt after device loss
// asks for nothing. Only a blob named by a parsed, selected manifest can be
// fetched. Nothing here watches the registry: canon changes arrive on the
// next load.

import {
  EMPTY_SNAPSHOT,
  type RegistrySnapshot,
  type SnapshotEntry,
} from "@panthea/assets/browser";
import {
  type AssetManifest,
  type AssetVocabulary,
  canonicalManifestText,
  parseAssetManifest,
  parseAssetVocabulary,
  parseRegistryIndex,
} from "@panthea/contracts";
import { invoke } from "@tauri-apps/api/core";

import { sha256Hex } from "./sha256";

export type RootKind = "repo" | "bundled";

/** The two read-only shell commands, behind a seam tests replace. */
export interface CanonSource {
  /** The `canon_registry` payload, unparsed. */
  registry(): Promise<unknown>;
  /** The bytes of a verified atlas blob by its sha256, from `canon_atlas`. */
  atlas(hash: string): Promise<Uint8Array>;
}

export type CommandInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

/** The shell-backed source. The webview names a command and a hash, never a path. */
export function createTauriCanonSource(
  call: CommandInvoke = invoke,
): CanonSource {
  return {
    registry: () => call("canon_registry"),
    async atlas(hash) {
      const bytes = await call("canon_atlas", { hash });
      if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
      if (bytes instanceof Uint8Array) return bytes;
      throw new Error("canon_atlas did not return bytes");
    },
  };
}

export interface CanonProblem {
  /** The file, command or atlas the problem is about. */
  readonly scope: string;
  readonly message: string;
}

export interface CanonLoad {
  readonly snapshot: RegistrySnapshot;
  /** Where the shell read the registry from; absent when there was no shell. */
  readonly rootKind?: RootKind;
}

export interface CanonClient {
  /** Loads the registry once; every later call, and every later renderer, shares the result. Never rejects. */
  load(): Promise<CanonLoad>;
  /**
   * The atlas bytes for a blob a parsed manifest names, fetched once per hash.
   * `undefined` when the blob is unnamed or the shell refused it; that is
   * reported once and not retried.
   */
  atlas(hash: string): Promise<Uint8Array | undefined>;
  /** Reports a problem found outside the client, such as an atlas that would not decode. Once per distinct problem. */
  report(problem: CanonProblem): void;
}

export interface CanonClientOptions {
  /** Absent in browser dev and fixture mode: everything is then a placeholder. */
  readonly source?: CanonSource;
  readonly onProblem?: (problem: CanonProblem) => void;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

interface RegistryPayload {
  readonly index: string | null;
  readonly manifests: readonly string[];
  readonly vocabulary: string | null;
  readonly rootKind: RootKind;
  readonly problems: readonly { path: string; reason: string }[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

function parsePayload(
  value: unknown,
): { ok: true; payload: RegistryPayload } | { ok: false; message: string } {
  const bad = (message: string) => ({ ok: false as const, message });
  if (!isRecord(value)) return bad("the registry payload is not an object");
  const { index, manifests, vocabulary, rootKind, problems } = value;
  if (!textOrNull(index)) return bad("index is neither text nor null");
  if (!textOrNull(vocabulary))
    return bad("vocabulary is neither text nor null");
  if (
    !Array.isArray(manifests) ||
    manifests.some((m) => typeof m !== "string")
  ) {
    return bad("manifests is not a list of text");
  }
  if (rootKind !== "repo" && rootKind !== "bundled") {
    return bad("rootKind is neither repo nor bundled");
  }
  if (
    !Array.isArray(problems) ||
    problems.some(
      (p) =>
        !isRecord(p) ||
        typeof p.path !== "string" ||
        typeof p.reason !== "string",
    )
  ) {
    return bad("problems is not a list of path and reason");
  }
  return {
    ok: true,
    payload: {
      index,
      manifests: manifests as string[],
      vocabulary,
      rootKind,
      problems: problems as { path: string; reason: string }[],
    },
  };
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

const textBytes = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Parses a registry payload into a snapshot, dropping and reporting what fails. */
function buildSnapshot(
  payload: RegistryPayload,
  report: (problem: CanonProblem) => void,
): RegistrySnapshot {
  for (const problem of payload.problems) {
    report({ scope: problem.path, message: problem.reason });
  }

  if (payload.vocabulary === null) {
    report({ scope: "vocabulary.json", message: "vocabulary is missing" });
    return EMPTY_SNAPSHOT;
  }
  const vocabularyJson = parseJson(payload.vocabulary);
  const vocabulary: AssetVocabulary | undefined = (() => {
    if (!vocabularyJson.ok) {
      report({ scope: "vocabulary.json", message: "not JSON" });
      return undefined;
    }
    const parsed = parseAssetVocabulary(vocabularyJson.value);
    if (!parsed.ok) {
      report({
        scope: "vocabulary.json",
        message: `${parsed.path}: ${parsed.message}`,
      });
      return undefined;
    }
    return parsed.value;
  })();
  if (vocabulary === undefined) return EMPTY_SNAPSHOT;

  if (payload.index === null) {
    report({ scope: "index.json", message: "index is missing" });
    return EMPTY_SNAPSHOT;
  }
  const indexJson = parseJson(payload.index);
  if (!indexJson.ok) {
    report({ scope: "index.json", message: "not JSON" });
    return EMPTY_SNAPSHOT;
  }
  const index = parseRegistryIndex(indexJson.value);
  if (!index.ok) {
    report({ scope: "index.json", message: `${index.path}: ${index.message}` });
    return EMPTY_SNAPSHOT;
  }

  // A manifest is named by the hash of its exact text, as in the registry.
  const manifests = new Map<string, AssetManifest>();
  const rejected = new Set<string>();
  for (const text of payload.manifests) {
    const revision = sha256Hex(textBytes(text));
    const scope = `manifests/${revision}.json`;
    const drop = (message: string) => {
      rejected.add(revision);
      report({ scope, message });
    };
    const json = parseJson(text);
    if (!json.ok) {
      drop("not JSON");
      continue;
    }
    const parsed = parseAssetManifest(json.value, vocabulary);
    if (!parsed.ok) {
      drop(`${parsed.path}: ${parsed.message}`);
      continue;
    }
    if (text !== canonicalManifestText(parsed.value)) {
      drop("not stored as canonical manifest text");
      continue;
    }
    manifests.set(revision, parsed.value);
  }

  const entries = new Map<string, SnapshotEntry>();
  for (const { assetId, revision } of index.value.entries) {
    const manifest = manifests.get(revision);
    if (manifest === undefined) {
      if (!rejected.has(revision)) {
        report({
          scope: "index.json",
          message: `${assetId}: no verified manifest has revision ${revision}`,
        });
      }
      continue;
    }
    if (manifest.id !== assetId) {
      report({
        scope: `manifests/${revision}.json`,
        message: `manifest is for "${manifest.id}", not "${assetId}"`,
      });
      continue;
    }
    entries.set(assetId, { assetId, revision, manifest });
  }
  return { entries };
}

export function createCanonClient(
  options: CanonClientOptions = {},
): CanonClient {
  const { source } = options;
  const reported = new Set<string>();
  const atlases = new Map<string, Promise<Uint8Array | undefined>>();
  let loading: Promise<CanonLoad> | undefined;
  let named: ReadonlySet<string> = new Set();

  function report(problem: CanonProblem): void {
    const key = `${problem.scope}\u0000${problem.message}`;
    if (reported.has(key)) return;
    reported.add(key);
    try {
      options.onProblem?.(problem);
    } catch {
      // A failing listener must not break a draw.
    }
  }

  async function fetchRegistry(): Promise<CanonLoad> {
    if (source === undefined) return { snapshot: EMPTY_SNAPSHOT };
    let raw: unknown;
    try {
      raw = await source.registry();
    } catch (error) {
      report({ scope: "canon_registry", message: messageOf(error) });
      return { snapshot: EMPTY_SNAPSHOT };
    }
    const payload = parsePayload(raw);
    if (!payload.ok) {
      report({ scope: "canon_registry", message: payload.message });
      return { snapshot: EMPTY_SNAPSHOT };
    }
    const snapshot = buildSnapshot(payload.payload, report);
    named = new Set(
      [...snapshot.entries.values()].map((entry) => entry.manifest.atlas.blob),
    );
    return { snapshot, rootKind: payload.payload.rootKind };
  }

  async function fetchAtlas(hash: string): Promise<Uint8Array | undefined> {
    if (source === undefined) return undefined;
    if (!named.has(hash)) {
      report({
        scope: `atlas:${hash}`,
        message: "no parsed manifest names this blob",
      });
      return undefined;
    }
    try {
      return await source.atlas(hash);
    } catch (error) {
      report({ scope: `atlas:${hash}`, message: messageOf(error) });
      return undefined;
    }
  }

  function load(): Promise<CanonLoad> {
    loading ??= fetchRegistry();
    return loading;
  }

  return {
    load,
    async atlas(hash) {
      await load();
      let bytes = atlases.get(hash);
      if (bytes === undefined) {
        bytes = fetchAtlas(hash);
        atlases.set(hash, bytes);
      }
      return bytes;
    },
    report,
  };
}
