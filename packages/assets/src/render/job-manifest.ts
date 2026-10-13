// The per-job role manifest the render engine writes as a blob (U7): which raw frames (colour, part
// id, depth) and which post-step cell each frame of the slot is, the recipe hashes it ran under,
// and the locators the post step stamped from, so a later audit can run the post step again from
// the stored raw frames alone. Pure module.

import {
  fail,
  isRecord,
  ok,
  type ParseResult,
  parseArray,
  parseBoolean,
  parseFiniteNumber,
  parseNonNegativeInteger,
  parseSha256,
  parseString,
  type Sha256,
} from "@panthea/contracts";
import { parseVec2 } from "./camera";
import type { StampLocators } from "./post";
import type { RevisionFields } from "./recipe";

export interface RenderJobFrame {
  readonly frame: number;
  readonly sourceFrame: number;
  readonly raw: {
    readonly colour: Sha256;
    readonly id: Sha256;
    readonly depth: Sha256;
  };
  /** The post-step cell's blob hash. */
  readonly cell: Sha256;
  /** Decoded-pixel identity of the cell (`cellPixelHash`). */
  readonly cellPixels: Sha256;
  readonly locators: StampLocators;
}

export interface RenderJobManifest {
  readonly schemaVersion: 1;
  readonly jobId: string;
  /** `state/facing[/ability]`, the working set's slot key. */
  readonly slotKey: string;
  readonly slot: {
    readonly state: string;
    readonly clip: string;
    readonly facing: string;
    readonly frames: number;
    readonly seed: number;
    /** The profile's clip loops. */
    readonly loop: boolean;
  };
  readonly revisionRecipeHash: Sha256;
  /** What the revision recipe hash covers, field by field. */
  readonly revision: RevisionFields;
  readonly slotRecipeHash: Sha256;
  readonly postStepVersion: number;
  readonly frames: readonly RenderJobFrame[];
}

function parseLocators(
  value: unknown,
  path: string,
): ParseResult<StampLocators> {
  if (!isRecord(value)) return fail(path, "expected locators");
  let bolt: StampLocators["bolt"];
  if (value.bolt !== undefined) {
    if (!isRecord(value.bolt))
      return fail(`${path}.bolt`, "expected an object");
    const basePx = parseVec2(value.bolt.basePx, `${path}.bolt.basePx`);
    if (!basePx.ok) return basePx;
    const tipPx = parseVec2(value.bolt.tipPx, `${path}.bolt.tipPx`);
    if (!tipPx.ok) return tipPx;
    const baseDepth = parseFiniteNumber(
      value.bolt.baseDepth,
      `${path}.bolt.baseDepth`,
    );
    if (!baseDepth.ok) return baseDepth;
    bolt = {
      basePx: basePx.value,
      tipPx: tipPx.value,
      baseDepth: baseDepth.value,
    };
  }
  let eyes: NonNullable<StampLocators["eyes"]> | undefined;
  if (value.eyes !== undefined) {
    if (!isRecord(value.eyes))
      return fail(`${path}.eyes`, "expected an object");
    const sides: {
      l?: { px: readonly [number, number]; depth: number };
      r?: { px: readonly [number, number]; depth: number };
    } = {};
    for (const side of ["l", "r"] as const) {
      const eye = value.eyes[side];
      if (eye === undefined) continue;
      if (!isRecord(eye))
        return fail(`${path}.eyes.${side}`, "expected an object");
      const px = parseVec2(eye.px, `${path}.eyes.${side}.px`);
      if (!px.ok) return px;
      const depth = parseFiniteNumber(eye.depth, `${path}.eyes.${side}.depth`);
      if (!depth.ok) return depth;
      sides[side] = { px: px.value, depth: depth.value };
    }
    eyes = sides;
  }
  return ok({
    ...(bolt === undefined ? {} : { bolt }),
    ...(eyes === undefined ? {} : { eyes }),
  });
}

function parseFrame(value: unknown, path: string): ParseResult<RenderJobFrame> {
  if (!isRecord(value)) return fail(path, "expected a frame");
  const frame = parseNonNegativeInteger(value.frame, `${path}.frame`);
  if (!frame.ok) return frame;
  const sourceFrame = parseFiniteNumber(
    value.sourceFrame,
    `${path}.sourceFrame`,
  );
  if (!sourceFrame.ok) return sourceFrame;
  if (!isRecord(value.raw)) return fail(`${path}.raw`, "expected an object");
  const colour = parseSha256(value.raw.colour, `${path}.raw.colour`);
  if (!colour.ok) return colour;
  const id = parseSha256(value.raw.id, `${path}.raw.id`);
  if (!id.ok) return id;
  const depth = parseSha256(value.raw.depth, `${path}.raw.depth`);
  if (!depth.ok) return depth;
  const cell = parseSha256(value.cell, `${path}.cell`);
  if (!cell.ok) return cell;
  const cellPixels = parseSha256(value.cellPixels, `${path}.cellPixels`);
  if (!cellPixels.ok) return cellPixels;
  const locators = parseLocators(value.locators, `${path}.locators`);
  if (!locators.ok) return locators;
  return ok({
    frame: frame.value,
    sourceFrame: sourceFrame.value,
    raw: { colour: colour.value, id: id.value, depth: depth.value },
    cell: cell.value,
    cellPixels: cellPixels.value,
    locators: locators.value,
  });
}

/** Parses the manifest blob. The revision fields are carried as written: the audit compares them to a recompute. */
export function parseRenderJobManifest(
  bytes: Uint8Array,
): ParseResult<RenderJobManifest> {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return fail("manifest", "is not valid JSON");
  }
  if (!isRecord(json)) return fail("manifest", "expected an object");
  if (json.schemaVersion !== 1)
    return fail("manifest.schemaVersion", "expected 1");
  const jobId = parseString(json.jobId, "manifest.jobId");
  if (!jobId.ok) return jobId;
  const slotKey = parseString(json.slotKey, "manifest.slotKey");
  if (!slotKey.ok) return slotKey;
  if (!isRecord(json.slot)) return fail("manifest.slot", "expected an object");
  const state = parseString(json.slot.state, "manifest.slot.state");
  if (!state.ok) return state;
  const clip = parseString(json.slot.clip, "manifest.slot.clip");
  if (!clip.ok) return clip;
  const facing = parseString(json.slot.facing, "manifest.slot.facing");
  if (!facing.ok) return facing;
  const frameCount = parseNonNegativeInteger(
    json.slot.frames,
    "manifest.slot.frames",
  );
  if (!frameCount.ok) return frameCount;
  const seed = parseNonNegativeInteger(json.slot.seed, "manifest.slot.seed");
  if (!seed.ok) return seed;
  const loop = parseBoolean(json.slot.loop, "manifest.slot.loop");
  if (!loop.ok) return loop;
  const revisionHash = parseSha256(
    json.revisionRecipeHash,
    "manifest.revisionRecipeHash",
  );
  if (!revisionHash.ok) return revisionHash;
  if (!isRecord(json.revision))
    return fail("manifest.revision", "expected an object");
  const slotHash = parseSha256(json.slotRecipeHash, "manifest.slotRecipeHash");
  if (!slotHash.ok) return slotHash;
  const version = parseNonNegativeInteger(
    json.postStepVersion,
    "manifest.postStepVersion",
  );
  if (!version.ok) return version;
  const frames = parseArray(json.frames, "manifest.frames", parseFrame);
  if (!frames.ok) return frames;
  if (frames.value.length !== frameCount.value)
    return fail(
      "manifest.frames",
      `lists ${frames.value.length} frames for ${frameCount.value}`,
    );
  return ok({
    schemaVersion: 1,
    jobId: jobId.value,
    slotKey: slotKey.value,
    slot: {
      state: state.value,
      clip: clip.value,
      facing: facing.value,
      frames: frameCount.value,
      seed: seed.value,
      loop: loop.value,
    },
    revisionRecipeHash: revisionHash.value,
    revision: json.revision as unknown as RevisionFields,
    slotRecipeHash: slotHash.value,
    postStepVersion: version.value,
    frames: frames.value,
  });
}
