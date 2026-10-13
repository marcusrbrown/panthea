// Compositing the authored stamps onto the 1x interior. A face stamp pixel is drawn only on a
// pixel the render left as `head`, so hair and beard that cover the face also cover the stamp. A
// bolt stamp is hidden where a body part nearer than the bolt (by more than a tolerance) covers
// the cell pixel, never drawn over the bolt hand, and clipped at the cell edge; its rim pixels
// are drawn only where they land on the figure, as a separation line. Ports of the probe's
// `stamp_plan.face_pixels`, `bake_plan.composite_stamp` and `apply_stamps`.

import type { Rgb, RgbaImage } from "../conformance";
import type { PartId } from "./parts";
import type { Facing, StampLocators, StampRecord } from "./post";
import type {
  LoadedBoltStamp,
  LoadedStamp,
  LoadedStampSet,
  StampPixel,
} from "./stamps";
import { FACE_SLOTS, type FaceFacing } from "./stamps";

/** A bolt pixel is hidden where a part nearer than the bolt by more than this many metres covers it. */
export const BOLT_DEPTH_TOLERANCE_M = 0.06;
/** The bolt is never drawn over these parts: the hand that holds it stays distinct. */
export const BOLT_PROTECTED_PARTS: readonly PartId[] = ["hand_r"];
/** How far beyond the hand's bolt base, toward the tip, the bolt's grip sits. */
const BOLT_PUSH_PX = 2.0;

/** Python's `round`: halves go to the even neighbour. */
export function roundHalfEven(value: number): number {
  if (Math.abs(value % 1) === 0.5) return 2 * Math.round(value / 2);
  return Math.round(value);
}

/** Direction from base to tip in degrees counter-clockwise from screen right (screen y points down). */
export function screenAngleDeg(
  base: readonly [number, number],
  tip: readonly [number, number],
): number {
  const degrees =
    Math.atan2(-(tip[1] - base[1]), tip[0] - base[0]) * (180 / Math.PI);
  return ((degrees % 360) + 360) % 360;
}

/** The orientation (a multiple of 45) nearest an angle. */
export function nearestBoltAngle(angleDeg: number): number {
  return (roundHalfEven((((angleDeg % 360) + 360) % 360) / 45) * 45) % 360;
}

/** Top-left cell position of a bolt stamp whose grip anchor sits `BOLT_PUSH_PX` beyond the hand's bolt base, toward the tip. */
export function boltOrigin(
  base: readonly [number, number],
  tip: readonly [number, number],
  anchor: readonly [number, number],
): readonly [number, number] {
  const dx = tip[0] - base[0];
  const dy = tip[1] - base[1];
  const length = Math.hypot(dx, dy);
  const [ux, uy] = length > 1e-6 ? [dx / length, dy / length] : [0, 0];
  const gx = base[0] + ux * BOLT_PUSH_PX;
  const gy = base[1] + uy * BOLT_PUSH_PX;
  return [roundHalfEven(gx) - anchor[0], roundHalfEven(gy) - anchor[1]];
}

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

interface BoltResult {
  readonly drawn: Map<number, Rgb>;
  readonly occluded: number;
  readonly protectedPx: number;
  readonly clipped: number;
}

function compositeBolt(
  pixels: readonly StampPixel[],
  origin: readonly [number, number],
  stampDepth: number,
  maps: CompositeMaps,
): BoltResult {
  const drawn = new Map<number, Rgb>();
  let occluded = 0;
  let protectedPx = 0;
  let clipped = 0;
  for (const pixel of pixels) {
    const x = origin[0] + pixel.x;
    const y = origin[1] + pixel.y;
    if (x < 0 || x >= maps.width || y < 0 || y >= maps.height) {
      clipped += 1;
      continue;
    }
    const i = y * maps.width + x;
    const part = maps.parts[i] ?? null;
    if (part !== null && BOLT_PROTECTED_PARTS.includes(part)) {
      protectedPx += 1;
      continue;
    }
    if (
      part !== null &&
      (maps.depths[i] as number) < stampDepth - BOLT_DEPTH_TOLERANCE_M
    ) {
      occluded += 1;
      continue;
    }
    drawn.set(i, pixel.rgb);
  }
  return { drawn, occluded, protectedPx, clipped };
}

/**
 * Face then bolt stamps onto the interior. The face is skipped on the north facing and when no
 * eye locator is given; the bolt is skipped when the frame has no bolt locator. Returns the
 * cell and a record of what was drawn.
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
  let bolt: StampRecord["bolt"];
  if (stamps.bolt !== undefined && locators.bolt !== undefined) {
    const b = locators.bolt;
    const angle = nearestBoltAngle(screenAngleDeg(b.basePx, b.tipPx));
    const stamp: LoadedBoltStamp | undefined = stamps.bolt.get(angle);
    if (stamp === undefined) {
      throw new StampError(
        "missing-stamp",
        `the stamp set has no ${angle} degree bolt stamp`,
      );
    }
    const origin = boltOrigin(b.basePx, b.tipPx, stamp.anchor);
    const core = compositeBolt(stamp.core, origin, b.baseDepth, maps);
    cell = paint(cell, core.drawn);
    const rim = compositeBolt(stamp.outline, origin, b.baseDepth, maps);
    // A separation line only where the rim lies on the figure as it now stands.
    const onBody = new Map<number, Rgb>();
    for (const [i, colour] of rim.drawn) {
      if (cell.rgba[i * 4 + 3] !== 0) onBody.set(i, colour);
    }
    cell = paint(cell, onBody);
    bolt = {
      angle,
      drawn: core.drawn.size + onBody.size,
      total: stamp.core.length + stamp.outline.length,
      coreDrawn: core.drawn.size,
      coreTotal: stamp.core.length,
      occluded: core.occluded,
      protected: core.protectedPx,
      clipped: core.clipped,
      outlineOnBody: onBody.size,
    };
  }
  return { cell, record: { face, ...(bolt === undefined ? {} : { bolt }) } };
}
