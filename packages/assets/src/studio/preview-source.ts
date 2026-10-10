// The node-side core of the preview's asset source: it reads published canon
// and the studio store's drafts and approved records, validates every atlas
// before anything leaves it, pins bytes to the pixel key they were resolved
// with, and rescans when watched roots change, including roots that do not
// exist yet. It speaks in selections and keys, never in URLs or files: the
// Vite dev bridge and the studio session are both thin adapters over it.

import { existsSync, watch } from "node:fs";
import { dirname } from "node:path";
import { sha256Hex } from "../hash";
import { renderPlaceholder } from "../placeholder";
import {
  checkBlob,
  loadRegistry,
  parseAssetManifest,
  readRevision,
} from "../registry";
import type { RegistrySnapshot, SnapshotEntry } from "../resolve";
import { DEFAULT_PLACEHOLDER, type Resolution, resolveAsset } from "../resolve";
import { canonicalFrameHash } from "./export-import";
import { decodePng } from "./png/decode";
import { readStudioBlob, readStudioStatus } from "./store";

/** One fixed window per burst of file events; not a tunable. */
export const COALESCE_MS = 150;

export const PREVIEW_SOURCE_KINDS = ["canon", "draft", "approved"] as const;
export type PreviewSourceKind = (typeof PREVIEW_SOURCE_KINDS)[number];

/** Canon selections name the asset id; draft and approved selections name the studio record id. */
export interface PreviewSelection {
  readonly source: PreviewSourceKind;
  readonly id: string;
}

export interface PreviewListingEntry extends PreviewSelection {
  readonly assetId: string;
  readonly kind: "sprite" | "portrait" | "unknown";
  readonly state: PreviewSourceKind;
  /** False when the entry failed validation and resolves to the placeholder. */
  readonly ok: boolean;
}

export interface PreviewProblem {
  readonly scope: string;
  readonly message: string;
}

export interface PreviewListing {
  readonly entries: readonly PreviewListingEntry[];
  readonly problems: readonly PreviewProblem[];
}

export interface PreviewResolveRequest extends PreviewSelection {
  readonly state?: string;
  readonly direction?: string;
  readonly ability?: string;
  readonly expression?: string;
}

export interface PreviewAtlas {
  readonly width: number;
  readonly height: number;
  /** Hash of the atlas pixels with RGB under alpha 0 zeroed. Equal keys mean the same visible image. */
  readonly pixelKey: string;
}

type CanonResolution = Extract<Resolution, { source: "canon" }>;
type PlaceholderResolution = Extract<Resolution, { source: "placeholder" }>;

export type PreviewResolution =
  | {
      readonly kind: "frames";
      readonly selection: PreviewSelection;
      /** Hash of the manifest with its atlas blob hash left out: equal keys mean the same geometry and timing. */
      readonly manifestKey: string;
      readonly asset: Omit<CanonResolution, "source">;
      readonly bytes: PreviewAtlas;
    }
  | {
      readonly kind: "placeholder";
      readonly selection: PreviewSelection;
      readonly reason: PlaceholderResolution["reason"];
      readonly uri: string;
      readonly problems: readonly PreviewProblem[];
      readonly bytes: PreviewAtlas;
    };

export interface PreviewChange {
  /** Selections whose resolved content changed, appeared or disappeared. */
  readonly changed: readonly PreviewSelection[];
  /** True when the listing or its problems changed. */
  readonly listing: boolean;
}

/** What a poller needs to see that something changed without fetching it. */
export interface PreviewKeys {
  /** Hash of the listing and its problems. */
  readonly listing: string;
  /** One key per held or refused selection; it changes when that selection's resolved content does. */
  readonly selections: readonly (PreviewSelection & { readonly key: string })[];
}

export type PreviewBytesResult =
  | ({ readonly ok: true; readonly bytes: Uint8Array } & PreviewAtlas)
  | { readonly ok: false; readonly reason: "not-found" | "stale" };

type Vocabulary = Parameters<typeof loadRegistry>[1];
type Manifest = SnapshotEntry["manifest"];

export type PreviewVocabulary =
  | { readonly ok: true; readonly vocabulary: Vocabulary }
  | { readonly ok: false; readonly message: string };

export type PreviewWatcher = (
  root: string,
  onChange: (relative: string) => void,
) => () => void;

/** Runs `run` once after `delayMs`; the returned function cancels it. */
export type PreviewScheduler = (run: () => void, delayMs: number) => () => void;

export interface PreviewSourceOptions {
  readonly registryRoot: string;
  readonly studioRoot: string;
  readonly vocabulary: PreviewVocabulary;
  readonly watch: PreviewWatcher;
  readonly schedule: PreviewScheduler;
  readonly emit?: (change: PreviewChange) => void;
}

export interface PreviewSource {
  list(): PreviewListing;
  resolve(request: PreviewResolveRequest): PreviewResolution;
  /** The validated atlas for a selection, only under the pixel key it was resolved with. */
  bytes(
    selection: PreviewSelection,
    version: string | null,
  ): PreviewBytesResult;
  /** The placeholder's PNG under its own hash, and nothing else. */
  placeholder(hash: string): Uint8Array | undefined;
  keys(): PreviewKeys;
  close(): void;
}

interface Held {
  readonly selection: PreviewSelection;
  readonly assetId: string;
  readonly snapshot: RegistrySnapshot;
  readonly atlas: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly manifestKey: string;
  readonly pixelKey: string;
  readonly token: string;
}

interface Model {
  readonly held: ReadonlyMap<string, Held>;
  readonly listing: PreviewListing;
  readonly tokens: ReadonlyMap<
    string,
    { selection: PreviewSelection; token: string }
  >;
  readonly problems: ReadonlyMap<string, readonly PreviewProblem[]>;
  readonly canonProblems: readonly PreviewProblem[];
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID = 128;

export const isPreviewSlug = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_ID && SLUG.test(value);

export const isPreviewSourceKind = (
  value: unknown,
): value is PreviewSourceKind =>
  typeof value === "string" &&
  (PREVIEW_SOURCE_KINDS as readonly string[]).includes(value);

const RESOLVE_FIELDS = [
  "source",
  "id",
  "state",
  "direction",
  "ability",
  "expression",
] as const;

/** Checks a resolve request that came from outside: known fields only, a source and id, and slugs throughout. Returns the reason when it is refused. */
export function parsePreviewResolve(
  input: Readonly<Record<string, unknown>>,
): PreviewResolveRequest | string {
  for (const name of Object.keys(input)) {
    if (!(RESOLVE_FIELDS as readonly string[]).includes(name))
      return `unknown parameter "${name}"`;
  }
  const { source, id } = input;
  if (!isPreviewSourceKind(source))
    return "source must be canon, draft or approved";
  if (!isPreviewSlug(id)) return "id must be a lowercase hyphenated id";
  const optional: Record<string, string> = {};
  for (const name of ["state", "direction", "ability", "expression"] as const) {
    const value = input[name];
    if (value === undefined || value === null) continue;
    if (!isPreviewSlug(value))
      return `${name} must be a lowercase hyphenated id`;
    optional[name] = value;
  }
  return { source, id, ...optional };
}

const keyOf = (selection: PreviewSelection) =>
  `${selection.source}:${selection.id}`;
const utf8 = (text: string) => new TextEncoder().encode(text);
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "unreadable";

function hold(
  selection: PreviewSelection,
  entry: SnapshotEntry,
  atlas: Uint8Array,
): Held {
  const { manifest } = entry;
  const manifestKey = sha256Hex(
    utf8(
      JSON.stringify({
        ...manifest,
        atlas: { ...manifest.atlas, blob: "" },
      }),
    ),
  );
  const decoded = decodePng(atlas);
  const pixelKey = decoded.ok
    ? canonicalFrameHash(decoded.image)
    : sha256Hex(atlas);
  return {
    selection,
    assetId: entry.assetId,
    snapshot: { entries: new Map([[entry.assetId, entry]]) },
    atlas,
    width: manifest.atlas.width,
    height: manifest.atlas.height,
    manifestKey,
    pixelKey,
    token: sha256Hex(utf8(`${manifestKey}:${pixelKey}`)),
  };
}

const kindOf = (manifest: unknown): PreviewListingEntry["kind"] => {
  const kind = (manifest as { kind?: unknown } | null)?.kind;
  return kind === "sprite" || kind === "portrait" ? kind : "unknown";
};

function scan(options: PreviewSourceOptions): Model {
  const held = new Map<string, Held>();
  const entries: PreviewListingEntry[] = [];
  const problems: PreviewProblem[] = [];
  const byKey = new Map<string, PreviewProblem[]>();
  const canonProblems: PreviewProblem[] = [];
  const tokens = new Map<
    string,
    { selection: PreviewSelection; token: string }
  >();

  const finish = (): Model => {
    const order = (entry: PreviewListingEntry) =>
      PREVIEW_SOURCE_KINDS.indexOf(entry.source);
    entries.sort(
      (a, b) => order(a) - order(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    return {
      held,
      listing: { entries, problems: [...problems, ...canonProblems] },
      tokens,
      problems: byKey,
      canonProblems,
    };
  };

  if (!options.vocabulary.ok) {
    problems.push({ scope: "content", message: options.vocabulary.message });
    return finish();
  }
  const { vocabulary } = options.vocabulary;

  try {
    const loaded = loadRegistry(options.registryRoot, vocabulary);
    for (const problem of loaded.problems) {
      canonProblems.push({
        scope: `canon:${problem.file}`,
        message: problem.message,
      });
    }
    for (const entry of loaded.snapshot.entries.values()) {
      const selection: PreviewSelection = {
        source: "canon",
        id: entry.assetId,
      };
      const revision = readRevision(
        options.registryRoot,
        entry.assetId,
        entry.revision,
        vocabulary,
      );
      if (!revision.ok) {
        canonProblems.push({
          scope: `canon:${entry.assetId}`,
          message: revision.message,
        });
        continue;
      }
      const checked = hold(
        selection,
        { ...entry, manifest: revision.value.manifest },
        revision.value.atlas,
      );
      held.set(keyOf(selection), checked);
      tokens.set(keyOf(selection), { selection, token: checked.token });
      entries.push({
        ...selection,
        assetId: entry.assetId,
        kind: kindOf(revision.value.manifest),
        state: "canon",
        ok: true,
      });
    }
  } catch (error) {
    canonProblems.push({ scope: "canon", message: errorText(error) });
  }

  try {
    if (!existsSync(options.studioRoot)) {
      problems.push({ scope: "store", message: "studio root does not exist" });
    }
    const status = readStudioStatus(options.studioRoot);
    for (const invalid of status.invalid) {
      problems.push({
        scope: `store:${invalid.file}`,
        message: invalid.message,
      });
    }
    for (const asset of status.assets) {
      const state = asset.record.state;
      if (state !== "draft" && state !== "approved") continue;
      const selection: PreviewSelection = { source: state, id: asset.id };
      const key = keyOf(selection);
      const refuse = (message: string) => {
        const problem = { scope: key, message };
        byKey.set(key, [problem]);
        problems.push(problem);
        tokens.set(key, {
          selection,
          token: sha256Hex(utf8(`problem:${message}`)),
        });
        entries.push({
          ...selection,
          assetId: asset.assetId,
          kind: kindOf(asset.record.manifest),
          state,
          ok: false,
        });
      };

      const parsed = parseAssetManifest(asset.record.manifest, vocabulary);
      if (!parsed.ok) {
        refuse(`${parsed.path}: ${parsed.message}`);
        continue;
      }
      const manifest: Manifest = parsed.value;
      if (manifest.id !== asset.assetId) {
        refuse(`manifest is for "${manifest.id}", not "${asset.assetId}"`);
        continue;
      }
      const hash = manifest.atlas.blob;
      const file = `blobs/${hash}.png`;
      let bytes: Uint8Array | undefined;
      try {
        bytes = readStudioBlob(options.studioRoot, hash);
      } catch (error) {
        refuse(`${file}: ${errorText(error)}`);
        continue;
      }
      if (bytes === undefined) {
        refuse(`${file}: atlas blob is missing`);
        continue;
      }
      const checked = checkBlob(bytes, hash, manifest.atlas, file);
      if (!checked.ok) {
        refuse(`${checked.file}: ${checked.message}`);
        continue;
      }
      const entry: SnapshotEntry = {
        assetId: asset.assetId,
        revision: asset.manifestRevision,
        manifest,
      };
      const complete = hold(selection, entry, bytes);
      held.set(key, complete);
      tokens.set(key, { selection, token: complete.token });
      entries.push({
        ...selection,
        assetId: asset.assetId,
        kind: kindOf(manifest),
        state,
        ok: true,
      });
    }
  } catch (error) {
    problems.push({ scope: "store", message: errorText(error) });
  }

  return finish();
}

function diff(previous: Model, next: Model): PreviewChange | undefined {
  const changed: PreviewSelection[] = [];
  for (const [key, now] of next.tokens) {
    if (previous.tokens.get(key)?.token !== now.token)
      changed.push(now.selection);
  }
  for (const [key, before] of previous.tokens) {
    if (!next.tokens.has(key)) changed.push(before.selection);
  }
  const listing =
    JSON.stringify(previous.listing) !== JSON.stringify(next.listing);
  return changed.length === 0 && !listing ? undefined : { changed, listing };
}

export function createPreviewSource(
  options: PreviewSourceOptions,
): PreviewSource {
  const placeholder = renderPlaceholder(DEFAULT_PLACEHOLDER);
  const placeholderHash = placeholder.uri.slice(
    placeholder.uri.lastIndexOf("/") + 1,
  );
  const placeholderAtlas: PreviewAtlas = {
    width: placeholder.width,
    height: placeholder.height,
    pixelKey: placeholderHash,
  };

  let model = scan(options);
  let closed = false;
  let cancel: (() => void) | undefined;

  const refresh = () => {
    if (closed) return;
    const next = scan(options);
    const change = diff(model, next);
    model = next;
    if (change !== undefined) options.emit?.(change);
  };

  const onEvent = (root: "registry" | "store", relative: string) => {
    if (closed || cancel !== undefined) return;
    if (root === "store") {
      const first = relative.split(/[\\/]/)[0] ?? "";
      if (first !== "" && first !== "assets" && first !== "blobs") return;
    }
    cancel = options.schedule(() => {
      cancel = undefined;
      refresh();
    }, COALESCE_MS);
  };

  const closers = [
    options.watch(options.registryRoot, (relative) =>
      onEvent("registry", relative),
    ),
    options.watch(options.studioRoot, (relative) => onEvent("store", relative)),
  ];

  return {
    list: () => model.listing,

    resolve(request) {
      const selection: PreviewSelection = {
        source: request.source,
        id: request.id,
      };
      const key = keyOf(selection);
      const found = model.held.get(key);
      const problemsFor =
        model.problems.get(key) ??
        (request.source === "canon" ? model.canonProblems : []);
      const missing = (
        reason: "missing-id" | "missing-state" | "wrong-kind",
        problems: readonly PreviewProblem[],
      ): PreviewResolution => ({
        kind: "placeholder",
        selection,
        reason,
        uri: placeholder.uri,
        problems,
        bytes: placeholderAtlas,
      });
      if (found === undefined) return missing("missing-id", problemsFor);

      const resolved = resolveAsset(found.snapshot, {
        spriteId: found.assetId,
        ...(request.state === undefined ? {} : { state: request.state }),
        ...(request.direction === undefined
          ? {}
          : { direction: request.direction }),
        ...(request.ability === undefined ? {} : { ability: request.ability }),
        ...(request.expression === undefined
          ? {}
          : { expression: request.expression }),
      });
      if (resolved.source === "placeholder")
        return missing(resolved.reason, []);
      const { source: _source, ...asset } = resolved;
      return {
        kind: "frames",
        selection,
        manifestKey: found.manifestKey,
        asset,
        bytes: {
          width: found.width,
          height: found.height,
          pixelKey: found.pixelKey,
        },
      };
    },

    bytes(selection, version) {
      const found = model.held.get(keyOf(selection));
      if (found === undefined) return { ok: false, reason: "not-found" };
      if (found.pixelKey !== version) return { ok: false, reason: "stale" };
      return {
        ok: true,
        bytes: found.atlas,
        width: found.width,
        height: found.height,
        pixelKey: found.pixelKey,
      };
    },

    placeholder: (hash) =>
      hash === placeholderHash ? placeholder.bytes : undefined,

    keys() {
      const order = (s: PreviewSelection) =>
        PREVIEW_SOURCE_KINDS.indexOf(s.source);
      return {
        listing: sha256Hex(utf8(JSON.stringify(model.listing))),
        selections: [...model.tokens.values()]
          .map(({ selection, token }) => ({ ...selection, key: token }))
          .sort(
            (a, b) =>
              order(a) - order(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
          ),
      };
    },

    close() {
      if (closed) return;
      closed = true;
      cancel?.();
      cancel = undefined;
      for (const close of closers) close();
    },
  };
}

export interface WatchFs {
  exists(path: string): boolean;
  watch(
    path: string,
    options: { readonly recursive: boolean },
    onEvent: (name: string | null) => void,
  ): { close(): void };
}

const nodeWatchFs: WatchFs = {
  exists: existsSync,
  watch(path, options, onEvent) {
    try {
      const watcher = watch(path, options, (_event, name) =>
        onEvent(name === null ? null : String(name)),
      );
      watcher.on("error", () => {});
      return watcher;
    } catch {
      return { close() {} };
    }
  },
};

/**
 * Watches `root` recursively. While it does not exist, watches its nearest
 * existing ancestor and moves down as each level appears; when the root itself
 * appears it reports an empty path so the caller rescans.
 */
export function fsWatcher(
  root: string,
  onChange: (relative: string) => void,
  fs: WatchFs = nodeWatchFs,
): () => void {
  let current: { close(): void } | undefined;
  let closed = false;

  const nearestExisting = () => {
    let at = root;
    while (!fs.exists(at) && dirname(at) !== at) at = dirname(at);
    return at;
  };

  const arm = (): void => {
    current?.close();
    current = undefined;
    if (closed) return;
    const target = fs.exists(root) ? root : nearestExisting();
    current = fs.watch(target, { recursive: target === root }, (name) => {
      if (closed) return;
      if (target === root) return onChange(name ?? "");
      const now = fs.exists(root) ? root : nearestExisting();
      if (now === target) return;
      arm();
      if (now === root) onChange("");
    });
    if (target !== root && fs.exists(root)) {
      arm();
      onChange("");
    }
  };

  arm();
  return () => {
    closed = true;
    current?.close();
    current = undefined;
  };
}

export const timerScheduler: PreviewScheduler = (run, delayMs) => {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
};
