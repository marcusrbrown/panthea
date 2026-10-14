// Test support: an explicit 112x96 `god-tall` actor, built here and not taken
// from canon, beside Zeus's legacy 64x80 cell. The manifest is validated by the
// contract parser against the committed vocabulary (which carries `god-tall`;
// the client's isolated vocabulary copy predates it), so a fixture the game
// could not load fails loudly here. The atlas bytes are a stand-in and
// `decodeWithTall` hands the renderer blank pixels of the declared size.

import { readFileSync } from "node:fs";
import { parseAssetManifest, parseAssetVocabulary } from "@panthea/contracts";
import { type DecodedImage, rgbaImage } from "@panthea/renderer";

import {
  decodeFixture,
  indexText,
  type RegistryPayload,
  sha256,
  ZEUS_ATLAS_BYTES,
  ZEUS_ATLAS_HASH,
  ZEUS_MANIFEST_TEXT,
  ZEUS_REVISION,
} from "./canon-fixture";

export const TALL_CELL = {
  width: 112,
  height: 96,
  pivotX: 56,
  pivotY: 78,
} as const;

export const TALL_FRAME_COUNT = 4;
export const TALL_SPRITE_ID = "tall-fixture";

const vocabularyText = readFileSync(
  new URL("../../../content/greek/assets/vocabulary.json", import.meta.url),
  "utf8",
);

export const TALL_ATLAS_BYTES = new Uint8Array([0x67, 0x6f, 0x64, 0x74]);
export const TALL_ATLAS_HASH = sha256(TALL_ATLAS_BYTES);

const tallManifest = {
  schemaVersion: 1,
  kind: "sprite",
  id: TALL_SPRITE_ID,
  cell: { w: TALL_CELL.width, h: TALL_CELL.height },
  pixelScale: 1,
  paletteFamily: "olympus",
  paletteId: "greek-retro",
  styleTag: "retro",
  atlas: {
    blob: TALL_ATLAS_HASH,
    width: TALL_CELL.width * TALL_FRAME_COUNT,
    height: TALL_CELL.height,
  },
  pivot: { x: TALL_CELL.pivotX, y: TALL_CELL.pivotY },
  footprint: { w: 1, h: 1 },
  directions: ["south"],
  realmVariants: [],
  animations: [
    {
      state: "idle",
      direction: "south",
      frames: Array.from({ length: TALL_FRAME_COUNT }, (_, index) => ({
        rect: {
          x: index * TALL_CELL.width,
          y: 0,
          w: TALL_CELL.width,
          h: TALL_CELL.height,
        },
        durationMs: 100,
      })),
    },
  ],
  provenance: {
    method: "hand",
    handEdits: [{ description: "drawn in the test" }],
    licences: [{ subject: "test", role: "original-work", licence: "MIT" }],
    relatedJobs: [],
    sourceAssets: [],
  },
};

const tallManifestText = JSON.stringify(tallManifest);
const TALL_REVISION = sha256(tallManifestText);

const vocabulary = (() => {
  const parsed = parseAssetVocabulary(JSON.parse(vocabularyText));
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
})();
for (const [name, text] of [
  ["tall", tallManifestText],
  ["zeus", ZEUS_MANIFEST_TEXT],
] as const) {
  const parsed = parseAssetManifest(JSON.parse(text), vocabulary);
  if (!parsed.ok) {
    throw new Error(
      `the ${name} fixture manifest is invalid: ${parsed.message}`,
    );
  }
}

/** The registry the game would load with Zeus's legacy 64x80 sprite and the 112x96 fixture. */
export function mixedCellPayload(): RegistryPayload {
  return {
    index: indexText([
      { assetId: TALL_SPRITE_ID, revision: TALL_REVISION },
      { assetId: "zeus-sprite", revision: ZEUS_REVISION },
    ]),
    manifests: [
      { hash: TALL_REVISION, text: tallManifestText },
      { hash: ZEUS_REVISION, text: ZEUS_MANIFEST_TEXT },
    ],
    vocabulary: vocabularyText,
    rootKind: "repo",
    problems: [],
  };
}

export const MIXED_CELL_ATLASES: ReadonlyMap<string, Uint8Array> = new Map([
  [TALL_ATLAS_HASH, TALL_ATLAS_BYTES],
  [ZEUS_ATLAS_HASH, ZEUS_ATLAS_BYTES],
]);

/** Blank pixels of the declared size for the fixture atlas; the real PNG decode for Zeus. */
export function decodeWithTall(bytes: Uint8Array): Promise<DecodedImage> {
  if (sha256(bytes) !== TALL_ATLAS_HASH) return decodeFixture(bytes);
  const width = TALL_CELL.width * TALL_FRAME_COUNT;
  return Promise.resolve(
    rgbaImage(
      width,
      TALL_CELL.height,
      new Uint8Array(width * TALL_CELL.height * 4),
    ),
  );
}
