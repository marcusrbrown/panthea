// A small valid tile asset with a real PNG atlas: every atlas cell is a full
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
      terrain: { base: "grass", over: "flagstone" },
      period,
      provenance: {
        method: "hand",
        handEdits: [{ description: "drawn by hand for a test fixture" }],
        licences: [
          { subject: "test-fixture", role: "original-work", licence: "MIT" },
        ],
        relatedJobs: [],
        sourceAssets: [],
      },
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
