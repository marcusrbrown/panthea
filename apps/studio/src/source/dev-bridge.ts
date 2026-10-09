import { join, resolve as resolvePath } from "node:path";
import {
  COALESCE_MS,
  createPreviewSource,
  fsWatcher,
  loadStudioContent,
  type PreviewResolution,
  type PreviewScheduler,
  type PreviewSelection,
  type PreviewVocabulary,
  type PreviewWatcher,
  parsePreviewResolve,
  timerScheduler,
  type WatchFs,
} from "@panthea/assets/studio";
import type { Plugin } from "vite";
import {
  BRIDGE_PREFIX,
  bridgePaths,
  CHANGE_EVENT,
  isSlug,
  isSourceKind,
  type SourceChange,
  type SourceResolution,
} from "./port";

// The Vite dev adapter over the preview-source core: it speaks HTTP paths and
// query strings and leaves validation, version pinning and watching to the core.

export type { WatchFs };
export { COALESCE_MS, fsWatcher, timerScheduler };

export type VocabularyLoad = PreviewVocabulary;
export type Watcher = PreviewWatcher;
export type Scheduler = PreviewScheduler;

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

const SHA256 = /^[0-9a-f]{64}$/;

/** The core's resolution with the dev server's URL for its bytes. */
function withUrl(resolution: PreviewResolution): SourceResolution {
  return resolution.kind === "frames"
    ? {
        ...resolution,
        bytes: {
          ...resolution.bytes,
          url: bridgePaths.atlas(
            resolution.selection,
            resolution.bytes.pixelKey,
          ),
        },
      }
    : {
        ...resolution,
        bytes: {
          ...resolution.bytes,
          url: bridgePaths.placeholder(resolution.bytes.pixelKey),
        },
      };
}

export function createAssetBridge(options: BridgeOptions): AssetBridge {
  const source = createPreviewSource(options);

  const atlas = (rest: string, pixelKey: string | null): BridgeResponse => {
    const [kind, id, ...extra] = rest.split("/");
    if (extra.length > 0 || !isSourceKind(kind) || !isSlug(id))
      return refused(400, "malformed atlas id");
    const selection: PreviewSelection = { source: kind, id };
    const got = source.bytes(selection, pixelKey);
    return got.ok
      ? png(got.bytes)
      : refused(404, "no validated atlas for this selection");
  };

  const placeholderEndpoint = (hash: string): BridgeResponse => {
    if (!SHA256.test(hash)) return refused(400, "malformed placeholder hash");
    const bytes = source.placeholder(hash);
    return bytes === undefined
      ? refused(404, "unknown placeholder")
      : png(bytes);
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
      if (path === bridgePaths.listing) return json(200, source.list());
      if (path === bridgePaths.resolve) {
        // No prototype, so a parameter named __proto__ is a field to refuse, not a setter.
        const query: Record<string, string | null> = Object.create(null);
        for (const name of url.searchParams.keys())
          query[name] = url.searchParams.get(name);
        const request = parsePreviewResolve(query);
        return typeof request === "string"
          ? refused(400, request)
          : json(200, withUrl(source.resolve(request)));
      }
      const atlasPrefix = `${BRIDGE_PREFIX}/atlas/`;
      if (path.startsWith(atlasPrefix))
        return atlas(path.slice(atlasPrefix.length), url.searchParams.get("v"));
      const placeholderPrefix = `${BRIDGE_PREFIX}/placeholder/`;
      if (path.startsWith(placeholderPrefix))
        return placeholderEndpoint(path.slice(placeholderPrefix.length));
      return refused(404, "not found");
    },
    close: () => source.close(),
  };
}

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
