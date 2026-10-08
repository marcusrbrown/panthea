import { existsSync, watch } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import {
  DEFAULT_PLACEHOLDER,
  type RegistrySnapshot,
  renderPlaceholder,
  resolveAsset,
  type SnapshotEntry,
  sha256Hex,
} from "@panthea/assets";
import {
  checkBlob,
  loadRegistry,
  parseAssetManifest,
  readRevision,
} from "@panthea/assets/registry";
import {
  canonicalFrameHash,
  decodePng,
  loadStudioContent,
  readStudioBlob,
  readStudioStatus,
} from "@panthea/assets/studio";
import type { Plugin } from "vite";
import {
  type AssetProblem,
  type AtlasBytes,
  BRIDGE_PREFIX,
  bridgePaths,
  CHANGE_EVENT,
  isSlug,
  isSourceKind,
  type Listing,
  type ListingEntry,
  type ResolveRequest,
  type Selection,
  SOURCE_KINDS,
  type SourceChange,
  type SourceResolution,
} from "./port";

/** One fixed window per burst of file events; not a tunable. */
export const COALESCE_MS = 150;

type Vocabulary = Parameters<typeof loadRegistry>[1];
type Manifest = SnapshotEntry["manifest"];

export type VocabularyLoad =
  | { readonly ok: true; readonly vocabulary: Vocabulary }
  | { readonly ok: false; readonly message: string };

export type Watcher = (
  root: string,
  onChange: (relative: string) => void,
) => () => void;

/** Runs `run` once after `delayMs`; the returned function cancels it. */
export type Scheduler = (run: () => void, delayMs: number) => () => void;

export interface BridgeOptions {
  readonly registryRoot: string;
  readonly studioRoot: string;
  readonly vocabulary: VocabularyLoad;
  readonly watch: Watcher;
  readonly schedule: Scheduler;
  readonly emit: (change: SourceChange) => void;
}

export interface BridgeResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | Uint8Array;
}

export interface AssetBridge {
  handle(method: string, url: string): BridgeResponse;
  close(): void;
}

interface Held {
  readonly selection: Selection;
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
  readonly listing: Listing;
  readonly tokens: ReadonlyMap<string, { selection: Selection; token: string }>;
  readonly problems: ReadonlyMap<string, readonly AssetProblem[]>;
  readonly canonProblems: readonly AssetProblem[];
}

const keyOf = (selection: Selection) => `${selection.source}:${selection.id}`;
const utf8 = (text: string) => new TextEncoder().encode(text);
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "unreadable";

function hold(
  selection: Selection,
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

const kindOf = (manifest: unknown): ListingEntry["kind"] => {
  const kind = (manifest as { kind?: unknown } | null)?.kind;
  return kind === "sprite" || kind === "portrait" ? kind : "unknown";
};

function scan(options: BridgeOptions): Model {
  const held = new Map<string, Held>();
  const entries: ListingEntry[] = [];
  const problems: AssetProblem[] = [];
  const byKey = new Map<string, AssetProblem[]>();
  const canonProblems: AssetProblem[] = [];
  const tokens = new Map<string, { selection: Selection; token: string }>();

  const finish = (): Model => {
    const order = (entry: ListingEntry) => SOURCE_KINDS.indexOf(entry.source);
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
      const selection: Selection = { source: "canon", id: entry.assetId };
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
      const selection: Selection = { source: state, id: asset.id };
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

function diff(previous: Model, next: Model): SourceChange | undefined {
  const changed: Selection[] = [];
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

const COMMON_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

const json = (status: number, value: unknown): BridgeResponse => ({
  status,
  headers: { ...COMMON_HEADERS, "content-type": "application/json" },
  body: JSON.stringify(value),
});

const refused = (
  status: number,
  error: string,
  extra = {},
): BridgeResponse => ({
  status,
  headers: {
    ...COMMON_HEADERS,
    "content-type": "application/json",
    ...extra,
  },
  body: JSON.stringify({ error }),
});

const png = (bytes: Uint8Array): BridgeResponse => ({
  status: 200,
  headers: { ...COMMON_HEADERS, "content-type": "image/png" },
  body: bytes,
});

const QUERY_FIELDS = [
  "source",
  "id",
  "state",
  "direction",
  "ability",
  "expression",
] as const;
const SHA256 = /^[0-9a-f]{64}$/;

function parseResolveRequest(query: URLSearchParams): ResolveRequest | string {
  for (const name of query.keys()) {
    if (!(QUERY_FIELDS as readonly string[]).includes(name))
      return `unknown parameter "${name}"`;
  }
  const source = query.get("source");
  const id = query.get("id");
  if (!isSourceKind(source)) return "source must be canon, draft or approved";
  if (!isSlug(id)) return "id must be a lowercase hyphenated id";
  const optional: Record<string, string> = {};
  for (const name of ["state", "direction", "ability", "expression"] as const) {
    const value = query.get(name);
    if (value === null) continue;
    if (!isSlug(value)) return `${name} must be a lowercase hyphenated id`;
    optional[name] = value;
  }
  return { source, id, ...optional };
}

export function createAssetBridge(options: BridgeOptions): AssetBridge {
  const placeholder = renderPlaceholder(DEFAULT_PLACEHOLDER);
  const placeholderHash = placeholder.uri.slice(
    placeholder.uri.lastIndexOf("/") + 1,
  );
  const placeholderBytes: AtlasBytes = {
    url: bridgePaths.placeholder(placeholderHash),
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
    if (change !== undefined) options.emit(change);
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

  const resolve = (request: ResolveRequest): SourceResolution => {
    const selection: Selection = { source: request.source, id: request.id };
    const key = keyOf(selection);
    const found = model.held.get(key);
    const problemsFor =
      model.problems.get(key) ??
      (request.source === "canon" ? model.canonProblems : []);
    const missing = (
      reason: "missing-id" | "missing-state" | "wrong-kind",
      problems: readonly AssetProblem[],
    ): SourceResolution => ({
      kind: "placeholder",
      selection,
      reason,
      uri: placeholder.uri,
      problems,
      bytes: placeholderBytes,
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
    if (resolved.source === "placeholder") return missing(resolved.reason, []);
    const { source: _source, ...asset } = resolved;
    return {
      kind: "frames",
      selection,
      manifestKey: found.manifestKey,
      asset,
      bytes: {
        url: bridgePaths.atlas(selection, found.pixelKey),
        width: found.width,
        height: found.height,
        pixelKey: found.pixelKey,
      },
    };
  };

  const atlas = (rest: string, pixelKey: string | null): BridgeResponse => {
    const [source, id, ...extra] = rest.split("/");
    if (extra.length > 0 || !isSourceKind(source) || !isSlug(id))
      return refused(400, "malformed atlas id");
    const found = model.held.get(keyOf({ source, id }));
    return found === undefined || found.pixelKey !== pixelKey
      ? refused(404, "no validated atlas for this selection")
      : png(found.atlas);
  };

  const placeholderEndpoint = (hash: string): BridgeResponse => {
    if (!SHA256.test(hash)) return refused(400, "malformed placeholder hash");
    return hash === placeholderHash
      ? png(placeholder.bytes)
      : refused(404, "unknown placeholder");
  };

  return {
    handle(method, rawUrl) {
      if (method !== "GET") return refused(405, "read-only", { allow: "GET" });
      let url: URL;
      try {
        url = new URL(rawUrl, "http://studio.invalid");
      } catch {
        return refused(400, "malformed url");
      }
      const path = url.pathname;
      if (path === bridgePaths.listing) return json(200, model.listing);
      if (path === bridgePaths.resolve) {
        const request = parseResolveRequest(url.searchParams);
        return typeof request === "string"
          ? refused(400, request)
          : json(200, resolve(request));
      }
      const atlasPrefix = `${BRIDGE_PREFIX}/atlas/`;
      if (path.startsWith(atlasPrefix))
        return atlas(path.slice(atlasPrefix.length), url.searchParams.get("v"));
      const placeholderPrefix = `${BRIDGE_PREFIX}/placeholder/`;
      if (path.startsWith(placeholderPrefix))
        return placeholderEndpoint(path.slice(placeholderPrefix.length));
      return refused(404, "not found");
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

export const fsWatcher: Watcher = (root, onChange) => {
  if (!existsSync(root)) return () => {};
  const watcher = watch(root, { recursive: true }, (_event, name) =>
    onChange(name === null ? "" : String(name)),
  );
  watcher.on("error", () => {});
  return () => watcher.close();
};

export const timerScheduler: Scheduler = (run, delayMs) => {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
};

export interface BridgePluginOptions {
  readonly contentRoot?: string;
  readonly registryRoot?: string;
  readonly studioRoot?: string;
}

/**
 * Serves validated canon, draft and approved assets to the dev page and pushes
 * changes over Vite's HMR channel. Defaults to the repository's committed
 * content and its `.studio` authoring root.
 */
export function assetBridgePlugin(options: BridgePluginOptions = {}): Plugin {
  return {
    name: "panthea-studio-asset-bridge",
    apply: "serve",
    configureServer(server) {
      const repoRoot = resolvePath(server.config.root, "..", "..");
      const contentRoot =
        options.contentRoot ?? join(repoRoot, "content", "greek");
      const loaded = loadStudioContent(contentRoot);
      const bridge = createAssetBridge({
        registryRoot:
          options.registryRoot ?? join(contentRoot, "assets", "registry"),
        studioRoot: options.studioRoot ?? join(repoRoot, ".studio"),
        vocabulary: loaded.ok
          ? { ok: true, vocabulary: loaded.content.vocabulary }
          : {
              ok: false,
              message: loaded.diagnostics
                .map((d) => `${d.file}: ${d.message}`)
                .join("; "),
            },
        watch: fsWatcher,
        schedule: timerScheduler,
        emit: (change) =>
          server.ws.send({ type: "custom", event: CHANGE_EVENT, data: change }),
      });
      server.middlewares.use((req, res, next) => {
        if (req.url === undefined || !req.url.startsWith(BRIDGE_PREFIX))
          return next();
        const response = bridge.handle(req.method ?? "GET", req.url);
        res.statusCode = response.status;
        for (const [name, value] of Object.entries(response.headers))
          res.setHeader(name, value);
        res.end(
          typeof response.body === "string"
            ? response.body
            : Buffer.from(response.body),
        );
      });
      server.httpServer?.once("close", () => bridge.close());
    },
  };
}
