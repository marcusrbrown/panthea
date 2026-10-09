import { HostError, type StudioHost } from "../host/client";
import type { SourceKeys, StudioSnapshot } from "../host/types";
import {
  type AssetProblem,
  type AssetSource,
  type AtlasBytes,
  type Listing,
  type ListingEntry,
  parseSelection,
  type ResolveRequest,
  type Selection,
  SOURCE_KINDS,
  type SourceChange,
  type SourceResolution,
} from "./port";

// The packaged app's asset source. Reads go through the host's named commands
// (`source-list`, `source-resolve`, then `preview_bytes` for the pixels); changes
// come from the key sets inside the studio snapshots. Nothing here knows a path
// or a URL: a resolution's bytes carry an opaque in-app reference that this
// module made and is the only one to read. Every reply is parsed before use.

export interface TauriSourceOptions {
  /** Where payloads that were refused, listener failures and a refused key section are reported. */
  readonly onProblem?: (problem: AssetProblem) => void;
}

// --- Parsing ----------------------------------------------------------------

type Obj = Readonly<Record<string, unknown>>;

class Refusal extends Error {}

const refuse = (path: string, why: string): never => {
  throw new Refusal(`${path}: ${why}`);
};

const isObject = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const text = (value: unknown, path: string): string =>
  isText(value) && value !== "" ? value : refuse(path, "not text");
const number = (value: unknown, path: string): number =>
  isNumber(value) ? value : refuse(path, "not a number");
const object = (value: unknown, path: string): Obj =>
  isObject(value) ? value : refuse(path, "not an object");
const list = (value: unknown, path: string): readonly unknown[] =>
  Array.isArray(value) ? value : refuse(path, "not a list");

const KEY = /^[0-9A-Za-z_-]{1,128}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const rect = (value: unknown, path: string) => {
  const o = object(value, path);
  return {
    x: number(o.x, `${path}.x`),
    y: number(o.y, `${path}.y`),
    w: number(o.w, `${path}.w`),
    h: number(o.h, `${path}.h`),
  };
};

const size = (value: unknown, path: string) => {
  const o = object(value, path);
  return { w: number(o.w, `${path}.w`), h: number(o.h, `${path}.h`) };
};

const point = (value: unknown, path: string) => {
  const o = object(value, path);
  return { x: number(o.x, `${path}.x`), y: number(o.y, `${path}.y`) };
};

function problems(value: unknown, path: string): AssetProblem[] {
  return list(value, path).map((item, i) => {
    const o = object(item, `${path}[${i}]`);
    return {
      scope: text(o.scope, `${path}[${i}].scope`),
      message: text(o.message, `${path}[${i}].message`),
    };
  });
}

const ENTRY_KINDS = ["sprite", "portrait", "unknown"] as const;

function entry(value: unknown, path: string): ListingEntry {
  const o = object(value, path);
  const selection =
    parseSelection({ source: o.source, id: o.id }) ??
    refuse(path, "not a known source and id");
  const kind =
    ENTRY_KINDS.find((k) => k === o.kind) ?? refuse(`${path}.kind`, "unknown");
  const state =
    SOURCE_KINDS.find((k) => k === o.state) ??
    refuse(`${path}.state`, "unknown");
  if (typeof o.ok !== "boolean") refuse(`${path}.ok`, "not a boolean");
  return {
    ...selection,
    assetId: text(o.assetId, `${path}.assetId`),
    kind,
    state,
    ok: o.ok as boolean,
  };
}

export function readListing(value: unknown): Listing {
  const o = object(value, "listing");
  return {
    entries: list(o.entries, "listing.entries").map((item, i) =>
      entry(item, `listing.entries[${i}]`),
    ),
    problems: problems(o.problems, "listing.problems"),
  };
}

const PLACEHOLDER_REASONS = [
  "missing-id",
  "missing-state",
  "wrong-kind",
] as const;

function asset(value: unknown) {
  const o = object(value, "resolution.asset");
  const kind =
    o.kind === "sprite" || o.kind === "portrait"
      ? o.kind
      : refuse("resolution.asset.kind", "not sprite or portrait");
  const atlas = object(o.atlas, "resolution.asset.atlas");
  const frames = list(o.frames, "resolution.asset.frames").map((item, i) => {
    const f = object(item, `resolution.asset.frames[${i}]`);
    return {
      rect: rect(f.rect, `resolution.asset.frames[${i}].rect`),
      durationMs: number(
        f.durationMs,
        `resolution.asset.frames[${i}].durationMs`,
      ),
    };
  });
  return {
    kind,
    assetId: text(o.assetId, "resolution.asset.assetId"),
    revision: text(o.revision, "resolution.asset.revision"),
    uri: text(o.uri, "resolution.asset.uri"),
    atlas: {
      blob: text(atlas.blob, "resolution.asset.atlas.blob"),
      width: number(atlas.width, "resolution.asset.atlas.width"),
      height: number(atlas.height, "resolution.asset.atlas.height"),
    },
    cell: size(o.cell, "resolution.asset.cell"),
    frames,
    ...(o.loopStart === undefined
      ? {}
      : { loopStart: number(o.loopStart, "resolution.asset.loopStart") }),
    ...(o.pivot === undefined
      ? {}
      : { pivot: point(o.pivot, "resolution.asset.pivot") }),
    ...(o.footprint === undefined
      ? {}
      : { footprint: size(o.footprint, "resolution.asset.footprint") }),
  };
}

// The opaque references this module hands out and takes back.
const ATLAS_REF =
  /^studio-host:atlas\/(canon|draft|approved)\/([^/?#]+)\?v=([0-9A-Za-z_-]{1,128})$/;
const PLACEHOLDER_REF = /^studio-host:placeholder\/([0-9a-f]{64})$/;

const atlasRef = (selection: Selection, key: string) =>
  `studio-host:atlas/${selection.source}/${selection.id}?v=${key}`;
const placeholderRef = (hash: string) => `studio-host:placeholder/${hash}`;

export function readResolution(value: unknown): SourceResolution {
  const o = object(value, "resolution");
  const selection =
    parseSelection(o.selection) ??
    refuse("resolution.selection", "not a known selection");
  const bytes = object(o.bytes, "resolution.bytes");
  const width = number(bytes.width, "resolution.bytes.width");
  const height = number(bytes.height, "resolution.bytes.height");
  const pixelKey = text(bytes.pixelKey, "resolution.bytes.pixelKey");

  if (o.kind === "frames") {
    if (!KEY.test(pixelKey)) refuse("resolution.bytes.pixelKey", "not a key");
    return {
      kind: "frames",
      selection,
      manifestKey: text(o.manifestKey, "resolution.manifestKey"),
      asset: asset(o.asset),
      bytes: { url: atlasRef(selection, pixelKey), width, height, pixelKey },
    } as unknown as SourceResolution;
  }
  if (o.kind === "placeholder") {
    if (!SHA256.test(pixelKey))
      refuse("resolution.bytes.pixelKey", "not a placeholder hash");
    const reason =
      PLACEHOLDER_REASONS.find((r) => r === o.reason) ??
      refuse("resolution.reason", "unknown");
    return {
      kind: "placeholder",
      selection,
      reason,
      uri: text(o.uri, "resolution.uri"),
      problems: problems(o.problems, "resolution.problems"),
      bytes: { url: placeholderRef(pixelKey), width, height, pixelKey },
    } as unknown as SourceResolution;
  }
  return refuse("resolution.kind", "not frames or placeholder");
}

// --- Changes ----------------------------------------------------------------

const keyOf = (selection: Selection) => `${selection.source}:${selection.id}`;

function diff(previous: SourceKeys, next: SourceKeys): SourceChange {
  const before = new Map(previous.selections.map((s) => [keyOf(s), s]));
  const after = new Map(next.selections.map((s) => [keyOf(s), s]));
  const changed = new Map<string, Selection>();
  for (const [key, now] of after) {
    if (before.get(key)?.key !== now.key)
      changed.set(key, { source: now.source, id: now.id });
  }
  for (const [key, was] of before) {
    if (!after.has(key)) changed.set(key, { source: was.source, id: was.id });
  }
  return {
    changed: [...changed.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, selection]) => selection),
    listing: previous.listing !== next.listing,
  };
}

/** Every selection the keys name, and the listing: what a reader that missed a change should refresh. */
function everything(keys: SourceKeys): SourceChange {
  return {
    changed: [...keys.selections]
      .map(({ source, id }) => ({ source, id }))
      .sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0)),
    listing: true,
  };
}

const merge = (a: SourceChange, b: SourceChange): SourceChange => {
  const changed = new Map<string, Selection>();
  for (const selection of [...a.changed, ...b.changed])
    changed.set(keyOf(selection), selection);
  return {
    changed: [...changed.entries()]
      .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
      .map(([, selection]) => selection),
    listing: a.listing || b.listing,
  };
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// --- The source -------------------------------------------------------------

export function createTauriSource(
  host: StudioHost,
  options: TauriSourceOptions = {},
): AssetSource {
  const report = (problem: AssetProblem) => {
    try {
      options.onProblem?.(problem);
    } catch {
      // Reporting is best effort.
    }
  };

  const malformed = (error: unknown): never => {
    throw new HostError({
      code: "malformed-reply",
      message: messageOf(error),
      retryable: false,
    });
  };

  const parse = <T>(value: unknown, read: (value: unknown) => T): T => {
    try {
      return read(value);
    } catch (error) {
      if (error instanceof Refusal) return malformed(error);
      throw error;
    }
  };

  // The keys the listeners have been told about, and whether a read may have
  // missed a change since: one made before the first keys arrived (they may
  // predate it) or one that failed.
  let previous: SourceKeys | undefined;
  let catchUp = false;
  let reportedKeysError: string | undefined;

  async function read<T>(run: () => Promise<T>): Promise<T> {
    if (previous === undefined) catchUp = true;
    try {
      return await run();
    } catch (error) {
      catchUp = true;
      throw error;
    }
  }

  async function resolve(request: ResolveRequest): Promise<SourceResolution> {
    const args: Record<string, string> = {};
    for (const [name, value] of Object.entries(request)) {
      if (value !== undefined) args[name] = value;
    }
    return parse(await host.call("source-resolve", args), readResolution);
  }

  async function fetchFrom(bytes: AtlasBytes): Promise<Uint8Array> {
    const placeholder = PLACEHOLDER_REF.exec(bytes.url);
    if (placeholder?.[1] !== undefined)
      return host.previewBytes({ placeholder: placeholder[1] });

    const atlas = ATLAS_REF.exec(bytes.url);
    const selection = parseSelection({ source: atlas?.[1], id: atlas?.[2] });
    const key = atlas?.[3];
    if (selection === undefined || key === undefined)
      throw new HostError({
        code: "invalid-reference",
        message: "not a reference this source made",
        retryable: false,
      });

    try {
      return await host.previewBytes(selection, key);
    } catch (error) {
      if (!(error instanceof HostError) || error.code !== "stale-version")
        throw error;
      // The pixels moved on since this resolution: resolve once more and take
      // what is held now. A selection that is gone has nothing to take.
      const fresh = await resolve(selection);
      if (fresh.kind !== "frames") throw error;
      return host.previewBytes(selection, fresh.bytes.pixelKey);
    }
  }

  // Listeners, and the one host subscription that feeds them.
  const listeners = new Set<{
    readonly send: (change: SourceChange) => void;
  }>();
  let stopHost: (() => void) | undefined;

  function announce(change: SourceChange): void {
    if (change.changed.length === 0 && !change.listing) return;
    for (const entry of [...listeners]) {
      try {
        entry.send(change);
      } catch (error) {
        report({ scope: "subscriber", message: messageOf(error) });
      }
    }
  }

  function onSnapshot(snapshot: StudioSnapshot): void {
    const refused = snapshot.errors?.keys;
    const refusal =
      refused === undefined
        ? undefined
        : refused.message === undefined || refused.message === ""
          ? refused.code
          : `${refused.code}: ${refused.message}`;
    if (refusal !== reportedKeysError) {
      reportedKeysError = refusal;
      if (refusal !== undefined)
        report({ scope: "source-keys", message: refusal });
    }

    const keys = snapshot.keys;
    // No keys is the sidecar being away or refusing: keep the baseline, so a
    // change made meanwhile is found when they come back.
    if (keys === undefined || keys === null) return;

    let change: SourceChange =
      previous === undefined
        ? { changed: [], listing: false }
        : diff(previous, keys);
    if (catchUp) {
      catchUp = false;
      change = merge(change, everything(keys));
    }
    previous = keys;
    announce(change);
  }

  return {
    list: () =>
      read(async () => parse(await host.call("source-list"), readListing)),
    resolve: (request) => read(() => resolve(request)),
    fetchBytes: (bytes) => read(() => fetchFrom(bytes)),
    subscribe(listener) {
      const entry = { send: listener };
      listeners.add(entry);
      if (stopHost === undefined) {
        stopHost = host.snapshots.subscribe({
          onSnapshot,
          onProblem: (problem) =>
            report({ scope: "studio-channel", message: problem.message }),
        });
        // A listener that left during the replay leaves nothing to feed.
        if (listeners.size === 0) {
          stopHost();
          stopHost = undefined;
        }
      }
      return () => {
        if (!listeners.delete(entry) || listeners.size > 0) return;
        stopHost?.();
        stopHost = undefined;
      };
    },
  };
}
