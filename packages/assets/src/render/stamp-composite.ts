// Compositing the authored stamps onto the 1x interior. A face stamp pixel is drawn only on a
// pixel the render left as `head`, so hair and beard that cover the face also cover the stamp.
// There is no prop stamp. A port of the probe's `stamp_plan.face_pixels` and `apply_stamps`.

import type { Rgb, RgbaImage } from "../conformance";
import type { PartId } from "./parts";
import type { Facing, StampLocators, StampRecord } from "./post";
import type { LoadedStamp, LoadedStampSet } from "./stamps";
import { FACE_SLOTS, type FaceFacing } from "./stamps";

export interface CompositeMaps {
  readonly parts: readonly (PartId | null)[];
  readonly depths: readonly number[];
  readonly width: number;
  readonly height: number;
}

function paint(cell: RgbaImage, drawn: ReadonlyMap<number, Rgb>): RgbaImage {
  const out = new Uint8Array(cell.rgba);
  for (const [i, colour] of drawn)
    out.set([colour[0], colour[1], colour[2], 255], i * 4);
  return { width: cell.width, height: cell.height, rgba: out };
}

interface FaceResult {
  readonly drawn: Map<number, Rgb>;
  readonly planned: number;
  readonly skipped: number;
}

/** Why a stamp could not be placed: a locator or a stamp the set does not have. */
export class StampError extends Error {
  constructor(
    readonly code: "missing-locator" | "missing-stamp",
    message: string,
  ) {
    super(message);
  }
}

function nearEye(eyes: ReadonlyMap<string, { depth: number }>): string {
  let best: string | undefined;
  for (const [key, eye] of eyes) {
    if (
      best === undefined ||
      eye.depth < (eyes.get(best) as { depth: number }).depth
    )
      best = key;
  }
  return best as string;
}

function facePixels(
  facing: FaceFacing,
  locators: StampLocators,
  face: ReadonlyMap<string, LoadedStamp>,
  maps: CompositeMaps,
): FaceResult {
  const eyes = new Map<
    string,
    { px: readonly [number, number]; depth: number }
  >();
  if (locators.eyes?.l !== undefined) eyes.set("l", locators.eyes.l);
  if (locators.eyes?.r !== undefined) eyes.set("r", locators.eyes.r);
  const drawn = new Map<number, Rgb>();
  let planned = 0;
  let skipped = 0;
  for (const slot of FACE_SLOTS[facing]) {
    const key = slot === "near" ? nearEye(eyes) : slot;
    const eye = eyes.get(key);
    if (eye === undefined) {
      throw new StampError(
        "missing-locator",
        `the ${facing} face stamp needs the "${key}" eye locator`,
      );
    }
    const stamp = face.get(`${facing}/${slot}`);
    if (stamp === undefined) {
      throw new StampError(
        "missing-stamp",
        `the stamp set has no ${facing}/${slot} face stamp`,
      );
    }
    const originX = Math.floor(eye.px[0]) - stamp.anchor[0];
    const originY = Math.floor(eye.px[1]) - stamp.anchor[1];
    for (const pixel of stamp.pixels) {
      const x = originX + pixel.x;
      const y = originY + pixel.y;
      planned += 1;
      if (
        x >= 0 &&
        x < maps.width &&
        y >= 0 &&
        y < maps.height &&
        maps.parts[y * maps.width + x] === "head"
      ) {
        drawn.set(y * maps.width + x, pixel.rgb);
      } else {
        skipped += 1;
      }
    }
  }
  return { drawn, planned, skipped };
}

/**
 * Face stamps onto the interior. The face is skipped on the north facing and when no eye locator
 * is given. Returns the cell and a record of what was drawn.
 */
export function applyStamps(
  interior: RgbaImage,
  facing: Facing,
  locators: StampLocators,
  stamps: LoadedStampSet,
  maps: CompositeMaps,
): { readonly cell: RgbaImage; readonly record: StampRecord } {
  let cell = interior;
  let face: StampRecord["face"] = { planned: 0, drawn: 0, skipped: 0 };
  const hasEyes =
    locators.eyes?.l !== undefined || locators.eyes?.r !== undefined;
  if (facing !== "north" && hasEyes && stamps.face !== undefined) {
    const result = facePixels(facing, locators, stamps.face, maps);
    cell = paint(cell, result.drawn);
    face = {
      planned: result.planned,
      drawn: result.drawn.size,
      skipped: result.skipped,
    };
  }
  return { cell, record: { face } };
}
