// What the part-ID and depth passes mean. The render script writes both as 8-bit RGBA: the part
// id in the red channel, in steps of 8 from 16, and the camera distance in the red channel
// through the sRGB transfer curve, between the item's near and far planes. Decoding them here is
// a contract with the script; the probe's `retro_plan.py` holds the original tables.

/** Supersampling of the raw passes: each cell pixel is a FACTOR x FACTOR block. */
export const SUPERSAMPLE = 4;

import { PART_IDS } from "./script-contract";

// One part table, owned by the script contract and pinned to `render.py` by its test.
export { PART_IDS };

export type PartId = (typeof PART_IDS)[number];

export const ID_BASE = 16;
export const ID_STEP = 8;

/** The id byte a part is written with. */
export const idByte = (part: PartId): number =>
  ID_BASE + ID_STEP * PART_IDS.indexOf(part);

/** The part for a rendered id byte, tolerating the +-2 an 8-bit round trip can add; null for anything else. */
export function decodePartId(byte: number): PartId | null {
  const shifted = byte - ID_BASE + ID_STEP / 2;
  const index = Math.floor(shifted / ID_STEP);
  const remainder = shifted - index * ID_STEP;
  if (
    byte < ID_BASE - 2 ||
    index >= PART_IDS.length ||
    Math.abs(remainder - ID_STEP / 2) > 2
  ) {
    return null;
  }
  return PART_IDS[index] ?? null;
}

const fromSrgb = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;

const toSrgb = (v: number): number =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;

/** The depth byte for a camera distance (used by tests and by anything that writes a pass). */
export function encodeDepth(
  distance: number,
  near: number,
  far: number,
): number {
  const unit = Math.min(1, Math.max(0, (distance - near) / (far - near)));
  return Math.round(toSrgb(unit) * 255);
}

/** Camera distance in metres for each of the 256 depth bytes. */
export function depthTable(near: number, far: number): readonly number[] {
  return Array.from(
    { length: 256 },
    (_, byte) => near + fromSrgb(byte / 255) * (far - near),
  );
}
