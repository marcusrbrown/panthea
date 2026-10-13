// The post step: raw 4x frames (colour, part id, depth) to palette-exact cells. Deterministic and
// pure; the same frames, settings, palette and stamps give the same bytes on every run. No
// Blender, no ffmpeg, no Python, no filesystem. A port of the probe's `postprocess_retro.py`;
// `test/render/post.parity.test.ts` holds it to the probe's cells.
//
// For each frame, in this order:
//   1. mode downscale of the colour pass from 4x, each pixel snapped to the asset palette;
//   2. selective overlap lines from the part-id and depth passes (far side, darkest of its ramp);
//   3. authored stamps (face, bolt), occluded by part id and depth;
//   4. one 1 px exterior outline over the combined silhouette, darkest of the local ramp;
//   5. a solid contact shadow of one palette colour on empty pixels, never outlined.
// Alpha is binary and the RGB of an alpha-0 pixel is zero. Height, width, outline, box and the
// envelope are measured on the figure of step 4 (no shadow); colours on the final cell.
//
// `POST_STEP_VERSION` is pinned in the recipe. Bump it with any change to the golden cells.

import type { Sha256 } from "@panthea/contracts";
import type { RgbaImage } from "../conformance";
import { sha256Hex } from "../hash";
import { blockMaps, modeDownscale } from "./downscale";
import { addOutline, measureImage } from "./outline";
import { applyOverlapLines } from "./overlap";
import { depthTable, SUPERSAMPLE } from "./parts";
import type { PostPalette } from "./post-palette";
import { envelopeOf, shadowPixels, withShadow } from "./shadow";
import { applyStamps, StampError } from "./stamp-composite";
import type { LoadedStampSet } from "./stamps";

/** Bumped with any change to the golden cells; the recipe pins it. */
export const POST_STEP_VERSION = 1;

export type Facing = "south" | "east" | "north" | "west";

export interface EyeLocator {
  readonly px: readonly [number, number];
  readonly depth: number;
}

export interface StampLocators {
  readonly bolt?: {
    readonly basePx: readonly [number, number];
    readonly tipPx: readonly [number, number];
    readonly baseDepth: number;
  };
  readonly eyes?: { readonly l?: EyeLocator; readonly r?: EyeLocator };
}

export interface RawFrame {
  readonly name: string;
  readonly facing: Facing;
  readonly colour: RgbaImage | undefined;
  readonly id: RgbaImage | undefined;
  readonly depth: RgbaImage | undefined;
  readonly locators?: StampLocators;
}

export interface PostStepSettings {
  readonly cell: { readonly w: number; readonly h: number };
  readonly originPx: readonly [number, number];
  readonly pivotPx: readonly [number, number];
  readonly depthRange: readonly [number, number];
  readonly overlapThresholdM: number;
  readonly shadow: {
    readonly rx: number;
    readonly ry: number;
    readonly ramp: string;
    readonly shade: number;
  } | null;
}

export interface PostStepInput {
  readonly slot: string;
  readonly settings: PostStepSettings;
  readonly palette: PostPalette;
  readonly stamps?: LoadedStampSet;
  readonly frames: readonly RawFrame[];
}

export interface StampRecord {
  readonly face: {
    readonly planned: number;
    readonly drawn: number;
    readonly skipped: number;
  };
  readonly bolt?: {
    readonly angle: number;
    readonly drawn: number;
    readonly total: number;
    readonly coreDrawn: number;
    readonly coreTotal: number;
    readonly occluded: number;
    readonly protected: number;
    readonly clipped: number;
    readonly outlineOnBody: number;
  };
}

export interface CellFacts {
  readonly height: number;
  readonly width: number;
  readonly bottomRow: number;
  readonly colours: number;
  readonly outsidePalette: number;
  readonly coloursFigure: number;
  readonly outsidePaletteFigure: number;
  readonly outline: boolean;
  readonly binaryAlpha: boolean;
  readonly box: readonly [number, number, number, number];
  readonly clipped: boolean;
  readonly overlapPx: number;
  readonly unknownIdPx: number;
  readonly stamps: StampRecord;
}

export interface PostCell {
  readonly name: string;
  readonly image: RgbaImage;
  readonly figure: RgbaImage;
  readonly facts: CellFacts;
}

export interface Envelope {
  readonly left: number;
  readonly right: number;
  readonly up: number;
  readonly down: number;
  readonly margin: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
  readonly minMargin: number;
  readonly clipped: boolean;
}

export type PostStepFailure = {
  readonly ok: false;
  readonly code:
    | "no-frames"
    | "missing-pass"
    | "frame-size"
    | "empty-frame"
    | "missing-locator"
    | "missing-stamp"
    | "unknown-ramp";
  readonly slot: string;
  readonly frame?: string;
  readonly message: string;
};

export type PostStepResult =
  | {
      readonly ok: true;
      readonly version: number;
      readonly cells: readonly PostCell[];
      readonly envelope: Envelope;
    }
  | PostStepFailure;

class FrameError extends Error {
  constructor(
    readonly code: PostStepFailure["code"],
    message: string,
  ) {
    super(message);
  }
}

const PASSES = ["colour", "id", "depth"] as const;

function checkPasses(
  frame: RawFrame,
  cell: PostStepSettings["cell"],
): { colour: RgbaImage; id: RgbaImage; depth: RgbaImage } {
  const wanted = [cell.w * SUPERSAMPLE, cell.h * SUPERSAMPLE] as const;
  for (const pass of PASSES) {
    const image = frame[pass];
    if (image === undefined) {
      throw new FrameError("missing-pass", `the ${pass} pass is missing`);
    }
    if (
      image.width !== wanted[0] ||
      image.height !== wanted[1] ||
      image.rgba.length !== wanted[0] * wanted[1] * 4
    ) {
      throw new FrameError(
        "frame-size",
        `the ${pass} pass is ${image.width}x${image.height}, expected ${wanted[0]}x${wanted[1]} (${SUPERSAMPLE}x a ${cell.w}x${cell.h} cell)`,
      );
    }
  }
  return frame as { colour: RgbaImage; id: RgbaImage; depth: RgbaImage };
}

/** Decoded-pixel identity of a cell: sha256 of "<w>x<h>:" and the RGBA bytes with the RGB of alpha-0 pixels zeroed. */
export function cellPixelHash(image: RgbaImage): Sha256 {
  const canonical = new Uint8Array(image.rgba);
  for (let at = 0; at < canonical.length; at += 4) {
    if (canonical[at + 3] === 0) canonical.fill(0, at, at + 3);
  }
  const header = new TextEncoder().encode(`${image.width}x${image.height}:`);
  const bytes = new Uint8Array(header.length + canonical.length);
  bytes.set(header, 0);
  bytes.set(canonical, header.length);
  return sha256Hex(bytes);
}

function processFrame(
  frame: RawFrame,
  input: PostStepInput,
  depthByte: readonly number[],
  shadow: readonly number[],
  shadowColour: readonly [number, number, number] | undefined,
): PostCell {
  const { settings, palette, stamps } = input;
  const { colour, id, depth } = checkPasses(frame, settings.cell);
  const { w, h } = settings.cell;

  const maps = blockMaps(id, depth, settings.cell, depthByte);
  const downscaled = modeDownscale(colour, settings.cell, palette);
  const lined = applyOverlapLines(
    downscaled.rgba,
    maps.parts,
    maps.depths,
    w,
    h,
    settings.overlapThresholdM,
    palette,
  );
  let interior: RgbaImage = { width: w, height: h, rgba: lined.rgba };
  let record: StampRecord = { face: { planned: 0, drawn: 0, skipped: 0 } };
  if (stamps !== undefined) {
    const stamped = applyStamps(
      interior,
      frame.facing,
      frame.locators ?? {},
      stamps,
      { parts: maps.parts, depths: maps.depths, width: w, height: h },
    );
    interior = stamped.cell;
    record = stamped.record;
  }
  const figure = addOutline(interior, palette);
  const image =
    shadowColour === undefined
      ? figure
      : withShadow(figure, shadow, shadowColour);

  const onFigure = measureImage(figure, palette);
  if (onFigure === null) {
    throw new FrameError(
      "empty-frame",
      "nothing is drawn: no opaque pixel after the downscale",
    );
  }
  const onCell = measureImage(image, palette) ?? onFigure;
  let binaryAlpha = true;
  for (let at = 3; at < image.rgba.length; at += 4) {
    const a = image.rgba[at];
    if (a !== 0 && a !== 255) binaryAlpha = false;
  }
  const [x0, y0, x1, y1] = onFigure.box;
  return {
    name: frame.name,
    image,
    figure,
    facts: {
      height: y1 - y0,
      width: x1 - x0,
      bottomRow: y1 - 1,
      colours: onCell.colours,
      outsidePalette: onCell.outsidePalette,
      coloursFigure: onFigure.colours,
      outsidePaletteFigure: onFigure.outsidePalette,
      outline: onFigure.outline,
      binaryAlpha,
      box: onFigure.box,
      clipped: x0 === 0 || y0 === 0 || x1 === w || y1 === h,
      overlapPx: lined.drawn.length,
      unknownIdPx: maps.unknown,
      stamps: record,
    },
  };
}

/**
 * Processes every frame of one slot. Refuses, naming the slot and the frame, a slot with no
 * frames, a frame with a missing pass or a pass off the expected size, a frame with nothing drawn,
 * a stamp whose locator or stamp file is absent, and a shadow ramp the palette does not have.
 */
export function postProcessSlot(input: PostStepInput): PostStepResult {
  const { slot, settings, palette } = input;
  const failure = (
    code: PostStepFailure["code"],
    message: string,
    frame?: string,
  ): PostStepFailure => ({
    ok: false,
    code,
    slot,
    ...(frame === undefined ? {} : { frame }),
    message: `${slot}${frame === undefined ? "" : ` (${frame})`}: ${message}`,
  });
  if (input.frames.length === 0)
    return failure("no-frames", "the slot has no frames");

  let shadowColour: readonly [number, number, number] | undefined;
  let shadow: readonly number[] = [];
  if (settings.shadow !== null) {
    const shade = palette.ramps.get(settings.shadow.ramp)?.[
      settings.shadow.shade
    ];
    if (shade === undefined) {
      return failure(
        "unknown-ramp",
        `the shadow colour is shade ${settings.shadow.shade} of ramp "${settings.shadow.ramp}", which palette "${palette.id}" does not have`,
      );
    }
    shadowColour = shade;
    shadow = shadowPixels(
      settings.cell.w,
      settings.cell.h,
      settings.originPx,
      settings.shadow.rx,
      settings.shadow.ry,
    );
  }
  const depthByte = depthTable(settings.depthRange[0], settings.depthRange[1]);

  const cells: PostCell[] = [];
  for (const frame of input.frames) {
    try {
      cells.push(processFrame(frame, input, depthByte, shadow, shadowColour));
    } catch (error) {
      if (error instanceof FrameError || error instanceof StampError) {
        return failure(error.code, error.message, frame.name);
      }
      throw error;
    }
  }
  return {
    ok: true,
    version: POST_STEP_VERSION,
    cells,
    envelope: envelopeOf(
      cells.map((c) => c.facts.box),
      settings.pivotPx,
      settings.cell,
    ),
  };
}
