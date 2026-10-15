// A small valid tile asset (rendered provenance, a real PNG atlas): every atlas cell is a full
// diamond on the fixture palette, so the set conforms cell by cell. Built
// through the real manifest parser. Not canon art.

import {
  type AssetVocabulary,
  parseAssetManifest,
  type Sha256,
  type TileManifest,
  tileAtlasRect,
} from "@panthea/contracts";
import { tileDiamondRow } from "../../src/conformance";
import { committedVocabulary, type FixtureAsset } from "../../src/fixtures";
import { PALETTE_20 } from "../../src/fixtures/conformance/images";
import { sha256Hex } from "../../src/hash";
import { encodeRgbaPng } from "../../src/placeholder";

/** The palette id and family the fixture tile names, as `paletteFixture` carries them. */
const PALETTE_ID = "fixture-master";
const PALETTE_FAMILY = "town";

/** The fixture ramps the town family holds: soil (0-3) then olive (4-7). */
const BASE_SHADE = 4;
const OVER_SHADE = 0;

const hashOf = (n: number): Sha256 =>
  n.toString(16).padStart(64, "0") as Sha256;

/**
 * Rendered provenance for a fixture tile: the recipe and the two role slots a tile holds. The hashes are
 * placeholders that parse; nothing in the fixture's tests re-renders them (the audit's tests render for real).
 */
function renderedProvenance() {
  const revisionHash = hashOf(0xa11);
  const slot = (role: "base" | "over", at: number) => ({
    slotKey: role,
    recipeHash: hashOf(0xb00 + at),
    revisionRecipeHash: revisionHash,
    role,
    seed: 0,
    frameCount: 1,
    raw: {
      colour: [hashOf(0x1000 + at)],
      id: [hashOf(0x2000 + at)],
      depth: [hashOf(0x3000 + at)],
    },
  });
  return {
    method: "rendered",
    revisionRecipe: {
      hash: revisionHash,
      profile: { id: "grass-flagstone", hash: hashOf(0x1) },
      camera: hashOf(0x2),
      palette: { id: PALETTE_ID, digest: hashOf(0x3) },
      pivot: { x: 32, y: 16 },
      script: hashOf(0x4),
      postStep: 1,
      blender: { version: "5.2.2", build: "d13f752e3b9c", sha256: hashOf(0xa) },
      kit: hashOf(0x5),
      stamps: hashOf(0x6),
    },
    slots: [slot("base", 0), slot("over", 1)],
    licences: [
      { subject: "blender", role: "runtime", licence: "GPL-3.0-or-later" },
    ],
    relatedJobs: [
      { jobId: "grass-0000", status: "succeeded", outputs: [hashOf(0x7)] },
      { jobId: "grass-0001", status: "succeeded", outputs: [hashOf(0x8)] },
    ],
    handEdits: [],
    sourceAssets: [],
  };
}

export interface TileFixture extends FixtureAsset<TileManifest> {
  /** The decoded atlas, row-major RGBA. */
  readonly rgba: Uint8Array;
}

/**
 * An atlas of `period` squared rows by 16 columns whose cell (mask, offset)
 * shows its diamond in the base shade where the mask's west half is clear and
 * the over shade where it is set, so no two masks look alike. `tag` shifts the
 * base shade, so the pixels and the hash vary.
 */
export function tileFixture(
  id = "grass-flagstone",
  period = 4,
  tag = 0,
  vocabulary: AssetVocabulary = committedVocabulary(),
  terrain: { base: string; over: string } = {
    base: "grass",
    over: "flagstone",
  },
): TileFixture {
  const width = 16 * 64;
  const height = period * period * 32;
  const rgba = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < period * period; offset += 1) {
    for (let mask = 0; mask < 16; mask += 1) {
      const cell = tileAtlasRect(mask, offset, period);
      for (let row = 0; row < 31; row += 1) {
        const span = tileDiamondRow(row);
        if (span === null) continue;
        for (let x = span.x0; x < span.x1; x += 1) {
          const west = x < 32;
          const over = ((mask & 8) !== 0) === west;
          const [r, g, b] = PALETTE_20[
            over ? OVER_SHADE : BASE_SHADE + (tag % 4)
          ] as readonly [number, number, number];
          rgba.set([r, g, b, 255], ((cell.y + row) * width + cell.x + x) * 4);
        }
      }
    }
  }
  const bytes = encodeRgbaPng(rgba, width, height);
  const blob = sha256Hex(bytes) as Sha256;
  const parsed = parseAssetManifest(
    {
      schemaVersion: 1,
      kind: "tile",
      id,
      cell: { w: 64, h: 32 },
      pixelScale: 1,
      paletteFamily: PALETTE_FAMILY,
      paletteId: PALETTE_ID,
      styleTag: "fixture",
      atlas: { blob, width, height },
      terrain,
      period,
      provenance: renderedProvenance(),
    },
    vocabulary,
  );
  if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.message}`);
  return {
    manifest: parsed.value as TileManifest,
    blobs: new Map([[blob, bytes]]),
    rgba,
  };
}
