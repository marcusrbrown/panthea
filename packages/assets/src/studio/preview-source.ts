// The node-side core of the preview's asset source: it reads published canon
// and the studio store's drafts and approved records, validates every atlas
// before anything leaves it, pins bytes to the pixel key they were resolved
// with, and rescans when watched roots change, including roots that do not
// exist yet. It speaks in selections and keys, never in URLs or files: the
// Vite dev bridge and the studio session are both thin adapters over it.

import { existsSync, watch } from "node:fs";
import { dirname } from "node:path";
import type { Sha256 } from "@panthea/contracts";
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

/**
 * Canon selections name the asset id; draft and approved selections name the studio record id.
 * A `realm` selects that realm palette's variant atlas of the asset instead of its base atlas.
 */
export interface PreviewSelection {
  readonly source: PreviewSourceKind;
  readonly id: string;
  readonly realm?: string;
}

export interface PreviewListingEntry extends PreviewSelection {
  readonly assetId: string;
  readonly kind: "sprite" | "portrait" | "tile" | "unknown";
  readonly state: PreviewSourceKind;
  readonly animations: readonly {
    readonly state: string;
    readonly direction: string;
    readonly ability?: string;
  }[];
  readonly expressions: readonly string[];
  /** The realm palette families the asset publishes a variant atlas for (sprites only). */
  readonly realms: readonly string[];
  /** N: a tile set's offsets repeat every N lattice steps, so it holds N squared of them (tiles only). */
  readonly period?: number;
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
  /** The named animation of an effect (`full`, `calm`, `burn`); an effect has no state or direction. */
  readonly animation?: string;
  /** A tile set's cell: the corner mask (0-15) and the offset in the period, which come together. */
  readonly mask?: number;
  readonly offset?: number;
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
  "realm",
  "state",
  "direction",
  "ability",
  "expression",
  "animation",
  "mask",
  "offset",
] as const;

/** A whole number as plain digits, no sign, no leading zero: what a mask or an offset is on the wire. */
const WHOLE = /^(?:0|[1-9][0-9]{0,3})$/;

function wholeNumber(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isInteger(value) && value >= 0 && value <= 9999
      ? value
      : undefined;
  return typeof value === "string" && WHOLE.test(value)
    ? Number(value)
    : undefined;
}

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
  for (const name of [
    "realm",
    "state",
    "direction",
    "ability",
    "expression",
    "animation",
  ] as const) {
    const value = input[name];
    if (value === undefined || value === null) continue;
    if (!isPreviewSlug(value))
      return `${name} must be a lowercase hyphenated id`;
    optional[name] = value;
  }
  const { mask, offset } = input;
  const tiled = mask !== undefined && mask !== null;
  if (tiled !== (offset !== undefined && offset !== null))
    return "mask and offset come together";
  if (!tiled) return { source, id, ...optional };
  const maskValue = wholeNumber(mask);
  const offsetValue = wholeNumber(offset);
  if (maskValue === undefined) return "mask must be a whole number";
  if (offsetValue === undefined) return "offset must be a whole number";
  return { source, id, ...optional, mask: maskValue, offset: offsetValue };
}

/** `source:id`, or `source:id@realm` for a variant: ids and realms are slugs, so `@` never occurs in either. */
const keyOf = (selection: PreviewSelection) =>
  `${selection.source}:${selection.id}${selection.realm === undefined ? "" : `@${selection.realm}`}`;
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
  return kind === "sprite" || kind === "portrait" || kind === "tile"
    ? kind
    : "unknown";
};

function keysOf(
  manifest: unknown,
): Pick<
  PreviewListingEntry,
  "animations" | "expressions" | "realms" | "period"
> {
  const record = manifest as {
    animations?: unknown;
    expressions?: unknown;
    realmVariants?: unknown;
    period?: unknown;
    kind?: unknown;
  } | null;
  if (record?.kind === "tile" && typeof record.period === "number")
    return {
      animations: [],
      expressions: [],
      realms: [],
      period: record.period,
    };
  if (record?.kind === "sprite" && Array.isArray(record.animations)) {
    const realms = Array.isArray(record.realmVariants)
      ? record.realmVariants.flatMap((item) => {
          const family = (item as Record<string, unknown> | null)
            ?.paletteFamily;
          return typeof family === "string" ? [family] : [];
        })
      : [];
    return {
      realms,
      animations: record.animations.flatMap((item) => {
        if (typeof item !== "object" || item === null) return [];
        const key = item as Record<string, unknown>;
        if (typeof key.state !== "string" || typeof key.direction !== "string")
          return [];
        return [
          {
            state: key.state,
            direction: key.direction,
            ...(typeof key.ability === "string"
              ? { ability: key.ability }
              : {}),
          },
        ];
      }),
      expressions: [],
    };
  }
  if (record?.kind === "portrait" && Array.isArray(record.expressions)) {
    return {
      animations: [],
      realms: [],
      expressions: record.expressions.flatMap((item) => {
        if (typeof item !== "object" || item === null) return [];
        const expression = (item as Record<string, unknown>).expression;
        return typeof expression === "string" ? [expression] : [];
      }),
    };
  }
  return { animations: [], expressions: [], realms: [] };
}

/**
 * Holds a manifest's realm variants: each its own selection with its own atlas,
 * checked like the base. `read` fetches a variant's bytes by blob hash; one that
 * is missing or fails the blob checks is a problem and holds nothing.
 */
function holdVariants(
  selection: PreviewSelection,
  entry: SnapshotEntry,
  read: (hash: string) => Uint8Array | undefined,
  into: {
    held: Map<string, Held>;
    tokens: Map<string, { selection: PreviewSelection; token: string }>;
    problem: (realm: string, message: string) => void;
  },
): void {
  const { manifest } = entry;
  if (manifest.kind !== "sprite") return;
  for (const variant of manifest.realmVariants) {
    const realm = variant.paletteFamily;
    const file = `blobs/${variant.atlas.blob}.png`;
    let bytes: Uint8Array | undefined;
    try {
      bytes = read(variant.atlas.blob);
    } catch (error) {
      into.problem(realm, `${file}: ${errorText(error)}`);
      continue;
    }
    if (bytes === undefined) {
      into.problem(realm, `${file}: realm variant atlas blob is missing`);
      continue;
    }
    const checked = checkBlob(bytes, variant.atlas.blob, variant.atlas, file);
    if (!checked.ok) {
      into.problem(realm, `${checked.file}: ${checked.message}`);
      continue;
    }
    const variantSelection: PreviewSelection = { ...selection, realm };
    const complete = hold(
      variantSelection,
      { ...entry, manifest: { ...manifest, atlas: variant.atlas } },
      bytes,
    );
    into.held.set(keyOf(variantSelection), complete);
    into.tokens.set(keyOf(variantSelection), {
      selection: variantSelection,
      token: complete.token,
    });
  }
}

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
      holdVariants(
        selection,
        { ...entry, manifest: revision.value.manifest },
        (hash) => revision.value.variantAtlases.get(hash as never),
        {
          held,
          tokens,
          problem: (realm, message) =>
            canonProblems.push({
              scope: `canon:${entry.assetId}@${realm}`,
              message,
            }),
        },
      );
      entries.push({
        ...selection,
        assetId: entry.assetId,
        kind: kindOf(revision.value.manifest),
        state: "canon",
        ...keysOf(revision.value.manifest),
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
      const refuse = (message: string, manifest?: unknown) => {
        const keys = keysOf(manifest);
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
          ...keys,
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
        refuse(
          `manifest is for "${manifest.id}", not "${asset.assetId}"`,
          manifest,
        );
        continue;
      }
      const hash = manifest.atlas.blob;
      const file = `blobs/${hash}.png`;
      let bytes: Uint8Array | undefined;
      try {
        bytes = readStudioBlob(options.studioRoot, hash);
      } catch (error) {
        refuse(`${file}: ${errorText(error)}`, manifest);
        continue;
      }
      if (bytes === undefined) {
        refuse(`${file}: atlas blob is missing`, manifest);
        continue;
      }
      const checked = checkBlob(bytes, hash, manifest.atlas, file);
      if (!checked.ok) {
        refuse(`${checked.file}: ${checked.message}`, manifest);
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
      holdVariants(
        selection,
        entry,
        (variantHash) =>
          readStudioBlob(options.studioRoot, variantHash as Sha256),
        {
          held,
          tokens,
          problem: (realm, message) =>
            problems.push({ scope: `${key}@${realm}`, message }),
        },
      );
      entries.push({
        ...selection,
        assetId: asset.assetId,
        kind: kindOf(manifest),
        state,
        ...keysOf(manifest),
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
        ...(request.realm === undefined ? {} : { realm: request.realm }),
      };
      const key = keyOf(selection);
      const found = model.held.get(key);
      const baseKey = keyOf({ source: request.source, id: request.id });
      const problemsFor =
        model.problems.get(baseKey) ??
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
      if (found === undefined) {
        // A realm the asset does not publish is "not in this asset", like a state it lacks.
        return request.realm !== undefined && model.held.has(baseKey)
          ? missing("missing-state", [])
          : missing("missing-id", problemsFor);
      }

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
        ...(request.animation === undefined
          ? {}
          : { animation: request.animation }),
        ...(request.mask === undefined || request.offset === undefined
          ? {}
          : { tile: { mask: request.mask, offset: request.offset } }),
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
