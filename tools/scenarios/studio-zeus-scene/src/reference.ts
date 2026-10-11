// Reference digests for the packaged inspection checks, generated in Node
// from the committed registry. The pixels come from the Node PNG decode of
// each atlas blob, never from a webview's decode, so a platform that alters
// pixels on decode (WebKit may ignore createImageBitmap's colour options) is
// caught rather than trusted.
//
// For every published asset, selection (sprite state and direction, or
// portrait expression) and frame, the file records the atlas hash, the frame
// rect and one digest per integer zoom. A digest is of the frame cut from the
// decoded atlas, composited over the inspection background by the renderer's
// alpha cutout, enlarged by nearest repetition to that zoom, then run through
// the shared FNV-1a digest. Per-zoom digests are stored (rather than derived
// in the app from a 1x buffer) because the app only has digests: at zoom N it
// digests the canvas region it reads back and compares with the stored value,
// which also exercises the integer blit.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CHECK_ZOOMS,
  crop,
  cutoutOver,
  DIGEST_ALGORITHM,
  digestRgba,
  INSPECT_BACKGROUND,
  type PixelRect,
  type Rgba,
  upscale,
} from "@panthea/client/src/inspect/digest";
import {
  type Reference,
  type ReferenceAsset,
  type ReferenceFrame,
  type ReferenceSelection,
  type SelectionQuery,
  selectionKey,
} from "@panthea/client/src/inspect/reference";
import {
  type AssetManifest,
  type AssetVocabulary,
  parseAssetManifest,
  parseAssetVocabulary,
  parseRegistryIndex,
} from "@panthea/contracts";
import { decodePng } from "../../../../packages/assets/src/studio/png/decode";

export const COMMITTED_REFERENCE = fileURLToPath(
  new URL("../reference-digests.json", import.meta.url),
);

const ASSETS_ROOT = fileURLToPath(
  new URL("../../../../content/greek/assets/", import.meta.url),
);

/** The registry's files as text and bytes, keyed by the hash in their names. */
export interface RegistryFiles {
  readonly vocabulary: string;
  readonly index: string;
  readonly manifests: ReadonlyMap<string, string>;
  readonly blobs: ReadonlyMap<string, Uint8Array>;
}

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

export function readCommittedRegistry(root = ASSETS_ROOT): RegistryFiles {
  const registry = `${root}registry/`;
  const stems = (dir: string, ext: string) =>
    readdirSync(`${registry}${dir}`)
      .filter((name) => name.endsWith(ext))
      .sort();
  return {
    vocabulary: readFileSync(`${root}vocabulary.json`, "utf8"),
    index: readFileSync(`${registry}index.json`, "utf8"),
    manifests: new Map(
      stems("manifests", ".json").map((name) => [
        name.slice(0, -".json".length),
        readFileSync(`${registry}manifests/${name}`, "utf8"),
      ]),
    ),
    blobs: new Map(
      stems("blobs", ".png").map((name) => [
        name.slice(0, -".png".length),
        new Uint8Array(readFileSync(`${registry}blobs/${name}`)),
      ]),
    ),
  };
}

function parsed<T>(
  result: { ok: true; value: T } | { ok: false; path: string; message: string },
  what: string,
): T {
  if (!result.ok) throw new Error(`${what}: ${result.path}: ${result.message}`);
  return result.value;
}

function frameDigests(atlas: Rgba, rect: PixelRect): ReferenceFrame {
  const solid = cutoutOver(crop(atlas, rect), INSPECT_BACKGROUND);
  return {
    rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    digests: Object.fromEntries(
      CHECK_ZOOMS.map((zoom) => [
        String(zoom),
        digestRgba(upscale(solid, zoom)),
      ]),
    ),
  };
}

const byKey = (a: ReferenceSelection, b: ReferenceSelection): number =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

function selectionsOf(
  manifest: AssetManifest,
  atlas: Rgba,
): ReferenceSelection[] {
  const selection = (
    query: SelectionQuery,
    rects: readonly PixelRect[],
  ): ReferenceSelection => ({
    key: selectionKey(query),
    query,
    frames: rects.map((rect) => frameDigests(atlas, rect)),
  });
  if (manifest.kind === "sprite") {
    return manifest.animations
      .map((animation) =>
        selection(
          {
            state: animation.state,
            direction: animation.direction,
            ...(animation.ability === undefined
              ? {}
              : { ability: animation.ability }),
          },
          animation.frames.map((frame) => frame.rect),
        ),
      )
      .sort(byKey);
  }
  if (manifest.kind === "portrait") {
    return manifest.expressions
      .map((entry) =>
        selection({ expression: entry.expression }, [entry.frame.rect]),
      )
      .sort(byKey);
  }
  return [];
}

export function buildReference(files: RegistryFiles): Reference {
  const vocabulary: AssetVocabulary = parsed(
    parseAssetVocabulary(JSON.parse(files.vocabulary)),
    "vocabulary",
  );
  const index = parsed(parseRegistryIndex(JSON.parse(files.index)), "index");
  const assets: ReferenceAsset[] = [];

  for (const { assetId, revision } of [...index.entries].sort((a, b) =>
    a.assetId < b.assetId ? -1 : 1,
  )) {
    const text = files.manifests.get(revision);
    if (text === undefined) {
      throw new Error(`${assetId}: manifest ${revision} is missing`);
    }
    if (sha256(text) !== revision) {
      throw new Error(
        `manifests/${revision}.json: bytes do not hash to the revision`,
      );
    }
    const manifest = parsed(
      parseAssetManifest(JSON.parse(text), vocabulary),
      `manifests/${revision}.json`,
    );
    if (manifest.id !== assetId) {
      throw new Error(
        `manifests/${revision}.json is for "${manifest.id}", not "${assetId}"`,
      );
    }
    const bytes = files.blobs.get(manifest.atlas.blob);
    if (bytes === undefined) {
      throw new Error(`${assetId}: blob ${manifest.atlas.blob} is missing`);
    }
    if (sha256(bytes) !== manifest.atlas.blob) {
      throw new Error(
        `blobs/${manifest.atlas.blob}.png: bytes do not hash to its name`,
      );
    }
    const decoded = decodePng(bytes);
    if (!decoded.ok) {
      throw new Error(`blobs/${manifest.atlas.blob}.png: ${decoded.message}`);
    }
    const { rgba, width, height } = decoded.image;
    if (width !== manifest.atlas.width || height !== manifest.atlas.height) {
      throw new Error(
        `blobs/${manifest.atlas.blob}.png is ${width}x${height}, the manifest declares ${manifest.atlas.width}x${manifest.atlas.height}`,
      );
    }
    if (manifest.kind !== "sprite" && manifest.kind !== "portrait") continue;
    assets.push({
      assetId,
      kind: manifest.kind,
      atlas: { blob: manifest.atlas.blob, width, height },
      selections: selectionsOf(manifest, { width, height, data: rgba }),
    });
  }

  return {
    schemaVersion: 1,
    algorithm: DIGEST_ALGORITHM,
    background: [...INSPECT_BACKGROUND],
    zooms: [...CHECK_ZOOMS],
    assets,
  };
}

export function renderReference(reference: Reference): string {
  return `${JSON.stringify(reference, null, 2)}\n`;
}

/** Every place `committed` differs from `generated`, as `path: expected X, got Y`. Empty when equal. */
export function diffReference(
  generated: unknown,
  committed: unknown,
): string[] {
  const differences: string[] = [];
  const walk = (expected: unknown, actual: unknown, path: string) => {
    if (
      typeof expected === "object" &&
      expected !== null &&
      typeof actual === "object" &&
      actual !== null
    ) {
      const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
      for (const key of keys) {
        walk(
          (expected as Record<string, unknown>)[key],
          (actual as Record<string, unknown>)[key],
          path === ""
            ? key
            : Array.isArray(expected)
              ? `${path}[${key}]`
              : `${path}.${key}`,
        );
      }
      return;
    }
    if (expected !== actual) {
      differences.push(
        `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  };
  walk(generated, committed, "");
  return differences;
}
