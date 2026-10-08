/// <reference types="vite/client" />
import {
  type AssetSource,
  type AtlasBytes,
  bridgePaths,
  CHANGE_EVENT,
  type Listing,
  parseSelection,
  type ResolveRequest,
  type Selection,
  type SourceChange,
  type SourceResolution,
} from "./port";

export interface HotChannel {
  on(event: string, listener: (data: unknown) => void): void;
  off?(event: string, listener: (data: unknown) => void): void;
  dispose(callback: () => void): void;
}

export interface DevBridgeClientOptions {
  readonly fetch?: (url: string) => Promise<Response>;
  readonly hot?: HotChannel | undefined;
}

export function parseChange(data: unknown): SourceChange | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const { changed, listing } = data as Record<string, unknown>;
  if (!Array.isArray(changed) || typeof listing !== "boolean") return undefined;
  const selections: Selection[] = [];
  for (const item of changed) {
    const selection = parseSelection(item);
    if (selection === undefined) return undefined;
    selections.push(selection);
  }
  return { changed: selections, listing };
}

async function getJson(
  fetcher: (url: string) => Promise<Response>,
  url: string,
): Promise<unknown> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function parseListing(value: unknown): Listing {
  if (
    !isRecord(value) ||
    !Array.isArray(value.entries) ||
    !Array.isArray(value.problems)
  )
    throw new Error("the listing is not a listing");
  return value as unknown as Listing;
}

export function parseResolution(value: unknown): SourceResolution {
  if (
    !isRecord(value) ||
    (value.kind !== "frames" && value.kind !== "placeholder") ||
    parseSelection(value.selection) === undefined ||
    !isRecord(value.bytes) ||
    typeof value.bytes.url !== "string"
  )
    throw new Error("the resolution is not a resolution");
  return value as unknown as SourceResolution;
}

/**
 * The browser side of the dev bridge. Changes arrive on Vite's HMR channel;
 * everything else is a read-only fetch of ids the node side validated.
 */
export function createDevBridgeSource(
  options: DevBridgeClientOptions = {},
): AssetSource {
  const fetcher = options.fetch ?? ((url: string) => fetch(url));
  const hot = "hot" in options ? options.hot : import.meta.hot;
  const unsubscribers = new Set<() => void>();
  let disposed = false;

  hot?.dispose(() => {
    disposed = true;
    for (const unsubscribe of [...unsubscribers]) unsubscribe();
  });

  return {
    async list() {
      return parseListing(await getJson(fetcher, bridgePaths.listing));
    },
    async resolve(request: ResolveRequest) {
      const query = new URLSearchParams();
      for (const [name, value] of Object.entries(request)) {
        if (value !== undefined) query.set(name, value);
      }
      return parseResolution(
        await getJson(fetcher, `${bridgePaths.resolve}?${query}`),
      );
    },
    async fetchBytes(bytes: AtlasBytes) {
      const response = await fetcher(bytes.url);
      if (!response.ok) throw new Error(`${bytes.url}: ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
    subscribe(listener) {
      if (hot === undefined || disposed) return () => {};
      let active = true;
      const handler = (data: unknown) => {
        if (!active) return;
        const change = parseChange(data);
        if (change !== undefined) listener(change);
      };
      hot.on(CHANGE_EVENT, handler);
      const unsubscribe = () => {
        active = false;
        unsubscribers.delete(unsubscribe);
        hot.off?.(CHANGE_EVENT, handler);
      };
      unsubscribers.add(unsubscribe);
      return unsubscribe;
    },
  };
}
