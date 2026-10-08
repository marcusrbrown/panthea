import type { Resolution } from "@panthea/assets";

export const SOURCE_KINDS = ["canon", "draft", "approved"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Canon selections name the asset id; draft and approved selections name the studio record id. */
export interface Selection {
  readonly source: SourceKind;
  readonly id: string;
}

export interface ListingEntry extends Selection {
  readonly assetId: string;
  readonly kind: "sprite" | "portrait" | "unknown";
  readonly state: SourceKind;
  /** False when the entry failed validation and resolves to the placeholder. */
  readonly ok: boolean;
}

export interface AssetProblem {
  readonly scope: string;
  readonly message: string;
}

export interface Listing {
  readonly entries: readonly ListingEntry[];
  readonly problems: readonly AssetProblem[];
}

export interface ResolveRequest extends Selection {
  readonly state?: string;
  readonly direction?: string;
  readonly ability?: string;
  readonly expression?: string;
}

export interface AtlasBytes {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  /** Hash of the atlas pixels with RGB under alpha 0 zeroed. Equal keys mean the same visible image. */
  readonly pixelKey: string;
}

type CanonResolution = Extract<Resolution, { source: "canon" }>;
type PlaceholderResolution = Extract<Resolution, { source: "placeholder" }>;

export type SourceResolution =
  | {
      readonly kind: "frames";
      readonly selection: Selection;
      /** Hash of the manifest with its atlas blob hash left out: equal keys mean the same geometry and timing. */
      readonly manifestKey: string;
      readonly asset: Omit<CanonResolution, "source">;
      readonly bytes: AtlasBytes;
    }
  | {
      readonly kind: "placeholder";
      readonly selection: Selection;
      readonly reason: PlaceholderResolution["reason"];
      readonly uri: string;
      readonly problems: readonly AssetProblem[];
      readonly bytes: AtlasBytes;
    };

export interface SourceChange {
  /** Selections whose resolved content changed, appeared or disappeared. */
  readonly changed: readonly Selection[];
  /** True when the listing or its problems changed. */
  readonly listing: boolean;
}

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
