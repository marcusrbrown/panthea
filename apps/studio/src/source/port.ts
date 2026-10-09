import type {
  PreviewAtlas,
  PreviewChange,
  PreviewListing,
  PreviewListingEntry,
  PreviewProblem,
  PreviewResolution,
  PreviewResolveRequest,
  PreviewSelection,
} from "@panthea/assets/studio";

// The data types are the preview-source core's, so the dev bridge, the studio
// session and the webview share one shape. Type-only: the browser bundle takes
// nothing at runtime from the assets package.
export type Selection = PreviewSelection;
export type ListingEntry = PreviewListingEntry;
export type AssetProblem = PreviewProblem;
export type Listing = PreviewListing;
export type ResolveRequest = PreviewResolveRequest;
export type SourceChange = PreviewChange;

// The browser's copies of the core's source kinds and id check; a test pins
// them to the core's so the two cannot drift.
export const SOURCE_KINDS = ["canon", "draft", "approved"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface AtlasBytes extends PreviewAtlas {
  readonly url: string;
}

/** The core's resolution, with a URL on the bytes it names. */
export type SourceResolution = PreviewResolution extends infer R
  ? R extends { readonly bytes: PreviewAtlas }
    ? Omit<R, "bytes"> & { readonly bytes: AtlasBytes }
    : never
  : never;

/** What the preview needs from wherever assets live. Fallback never leaves the selected source. */
export interface AssetSource {
  list(): Promise<Listing>;
  resolve(request: ResolveRequest): Promise<SourceResolution>;
  /** Validated atlas PNG bytes for a resolution's `bytes`. */
  fetchBytes(bytes: AtlasBytes): Promise<Uint8Array>;
  /** Returns the unsubscribe. Changes are coalesced and carry no bytes. */
  subscribe(listener: (change: SourceChange) => void): () => void;
}

export const BRIDGE_PREFIX = "/__panthea-studio/assets";
export const CHANGE_EVENT = "panthea-studio:assets-changed";

export const bridgePaths = {
  listing: `${BRIDGE_PREFIX}/listing`,
  resolve: `${BRIDGE_PREFIX}/resolve`,
  atlas: (selection: Selection, pixelKey: string) =>
    `${BRIDGE_PREFIX}/atlas/${selection.source}/${selection.id}?v=${pixelKey}`,
  placeholder: (hash: string) => `${BRIDGE_PREFIX}/placeholder/${hash}`,
} as const;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID = 128;

export const isSlug = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_ID && SLUG.test(value);

export const isSourceKind = (value: unknown): value is SourceKind =>
  typeof value === "string" &&
  (SOURCE_KINDS as readonly string[]).includes(value);

export function parseSelection(value: unknown): Selection | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { source, id } = value as Record<string, unknown>;
  return isSourceKind(source) && isSlug(id) ? { source, id } : undefined;
}
