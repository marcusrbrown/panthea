// Test support shared by the assets and tools/content tests: small valid
// manifests with real PNG atlas blobs, built through the real parsers. Not
// canon art and not exported from the package root.

import {
  type AssetId,
  type AssetManifest,
  type AssetVocabulary,
  type PortraitManifest,
  parseAssetManifest,
  parseAssetVocabulary,
  type Sha256,
  type SpriteManifest,
} from "@panthea/contracts";
import vocabularyJson from "../../../content/greek/assets/vocabulary.json";
import { sha256Hex } from "./hash";
import { encodeRgbaPng } from "./placeholder";

export function committedVocabulary(): AssetVocabulary {
  const parsed = parseAssetVocabulary(vocabularyJson);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

export interface FixtureAsset<M extends AssetManifest = AssetManifest> {
  readonly manifest: M;
  /** Atlas blob bytes by hash. */
  readonly blobs: ReadonlyMap<Sha256, Uint8Array>;
}

function atlas(width: number, height: number, tag: number) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = tag;
    rgba[i + 1] = 80;
    rgba[i + 2] = 160;
    rgba[i + 3] = 255;
  }
  const bytes = encodeRgbaPng(rgba, width, height);
  return { bytes, hash: sha256Hex(bytes) };
}

function frame(index: number, w: number, h: number, durationMs: number) {
  return {
    rect: { x: index * w, y: 0, w, h },
    durationMs,
  };
}

const handProvenance = {
  method: "hand",
  handEdits: [{ description: "drawn by hand for a test fixture" }],
  licences: [
    { subject: "test-fixture", role: "original-work", licence: "MIT" },
  ],
  relatedJobs: [],
  sourceAssets: [],
};

/** A god-sized sprite with an idle-south animation. `tag` varies the pixels, so the hashes. */
export function spriteFixture(
  id = "placeholder-zeus",
  tag = 1,
): FixtureAsset<SpriteManifest> {
  const blob = atlas(256, 80, tag);
  const parsed = parseAssetManifest(
    {
      schemaVersion: 1,
      kind: "sprite",
      id,
      cell: { w: 64, h: 80 },
      pixelScale: 1,
      paletteFamily: "olympus",
      paletteId: "provisional",
      styleTag: "fixture",
      atlas: { blob: blob.hash, width: 256, height: 80 },
      pivot: { x: 32, y: 80 },
      footprint: { w: 1, h: 1 },
      directions: ["south"],
      realmVariants: [],
      animations: [
        {
          state: "idle",
          direction: "south",
          frames: [0, 1, 2, 3].map((i) => frame(i, 64, 80, 167)),
        },
      ],
      provenance: handProvenance,
    },
    committedVocabulary(),
  );
  if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.message}`);
  return {
    manifest: parsed.value as SpriteManifest,
    blobs: new Map([[blob.hash, blob.bytes]]),
  };
}

/** A portrait with `neutral` and `awed` expressions. */
export function portraitFixture(
  id = "zeus-portrait",
  characterId = "zeus",
  tag = 1,
): FixtureAsset<PortraitManifest> {
  const blob = atlas(192, 96, tag);
  const parsed = parseAssetManifest(
    {
      schemaVersion: 1,
      kind: "portrait",
      id,
      cell: { w: 96, h: 96 },
      pixelScale: 1,
      paletteFamily: "olympus",
      paletteId: "provisional",
      styleTag: "fixture",
      atlas: { blob: blob.hash, width: 192, height: 96 },
      characterId,
      expressions: [
        { expression: "neutral", frame: frame(0, 96, 96, 1000) },
        { expression: "awed", frame: frame(1, 96, 96, 1000) },
      ],
      provenance: handProvenance,
    },
    committedVocabulary(),
  );
  if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.message}`);
  return {
    manifest: parsed.value as PortraitManifest,
    blobs: new Map([[blob.hash, blob.bytes]]),
  };
}

export type { AssetId };
