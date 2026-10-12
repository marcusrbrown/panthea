// A frame of a published revision as an edit base. A frame is named by the
// asset, the revision, the slot and the index, and checked against a hash: the
// SHA-256 of the frame's cell as a PNG, with the colour hidden under alpha 0
// zeroed so the hash does not depend on what the atlas happened to hold there.
//
// The cutting is pure over a manifest and its atlas bytes. The reader that
// resolves a reference from the committed registry is the only part that does
// file I/O (through the registry's own verified revision reader), and it runs
// in Node: the webview never reads a frame.

import type {
  AssetManifest,
  AssetVocabulary,
  EditBase,
  Frame,
  Sha256,
} from "@panthea/contracts";
import type { RgbaImage } from "../conformance";
import { sha256Hex } from "../hash";
import { encodeRgbaPng } from "../placeholder";
import { readRevision } from "../registry";
import { decodePng } from "./png/decode";

export type PublishedFrameRef = Extract<EditBase, { kind: "published" }>;

/** Why a published frame could not be used as an edit base. */
export type FrameRefusal =
  | "missing-revision"
  /** The revision is stored but fails the registry's checks (a tampered or corrupt file); the message says how. */
  | "unreadable-revision"
  | "missing-slot"
  | "missing-frame"
  | "frame-hash-mismatch"
  | "unreadable-atlas";

export type FrameRead =
  | {
      readonly ok: true;
      /** The frame's cell at native size, as the PNG whose SHA-256 is the frame hash. */
      readonly png: Uint8Array;
      readonly image: RgbaImage;
    }
  | {
      readonly ok: false;
      readonly reason: FrameRefusal;
      readonly message: string;
      /** For `frame-hash-mismatch`: the hash the frame really has. */
      readonly actual?: Sha256;
    };

type Failed = Extract<FrameRead, { ok: false }>;

/** The cell as a PNG with no colour under alpha 0. */
export function frameCellPng(image: RgbaImage): Uint8Array {
  const rgba = Uint8Array.from(image.rgba);
  for (let at = 0; at < rgba.length; at += 4)
    if (rgba[at + 3] === 0) rgba.fill(0, at, at + 3);
  return encodeRgbaPng(rgba, image.width, image.height);
}

/** The hash a frame ref records for a cell. */
export const frameHashOf = (image: RgbaImage): Sha256 =>
  sha256Hex(frameCellPng(image));

function framesOf(
  manifest: AssetManifest,
  slotKey: string,
): readonly Frame[] | undefined {
  if (manifest.kind === "sprite")
    return manifest.animations.find(
      (a) =>
        `${a.state}/${a.direction}${a.ability === undefined ? "" : `/${a.ability}`}` ===
        slotKey,
    )?.frames;
  if (manifest.kind === "portrait") {
    const found = manifest.expressions.find((e) => e.expression === slotKey);
    return found === undefined ? undefined : [found.frame];
  }
  return undefined;
}

/** One frame of a manifest's atlas, by slot and index, with its canonical hash. */
export function cutFrame(
  manifest: AssetManifest,
  atlas: Uint8Array,
  slotKey: string,
  frameIndex: number,
):
  | {
      readonly ok: true;
      readonly image: RgbaImage;
      readonly png: Uint8Array;
      readonly hash: Sha256;
    }
  | Failed {
  const frames = framesOf(manifest, slotKey);
  if (frames === undefined)
    return {
      ok: false,
      reason: "missing-slot",
      message: `missing-slot: ${manifest.id} has no slot ${slotKey}`,
    };
  const frame = frames[frameIndex];
  if (frame === undefined)
    return {
      ok: false,
      reason: "missing-frame",
      message: `missing-frame: slot ${slotKey} of ${manifest.id} has ${frames.length} frame${frames.length === 1 ? "" : "s"}, not index ${frameIndex}`,
    };
  const decoded = decodePng(atlas);
  if (!decoded.ok)
    return {
      ok: false,
      reason: "unreadable-atlas",
      message: `unreadable-atlas: the atlas of ${manifest.id} cannot be decoded`,
    };
  const { rect } = frame;
  const source = decoded.image;
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.w > source.width ||
    rect.y + rect.h > source.height
  )
    return {
      ok: false,
      reason: "unreadable-atlas",
      message: `unreadable-atlas: frame ${frameIndex} of ${slotKey} lies outside the atlas`,
    };
  const rgba = new Uint8Array(rect.w * rect.h * 4);
  for (let row = 0; row < rect.h; row += 1)
    rgba.set(
      source.rgba.subarray(
        ((rect.y + row) * source.width + rect.x) * 4,
        ((rect.y + row) * source.width + rect.x + rect.w) * 4,
      ),
      row * rect.w * 4,
    );
  const image: RgbaImage = { rgba, width: rect.w, height: rect.h };
  const png = frameCellPng(image);
  return { ok: true, image, png, hash: sha256Hex(png) };
}

/**
 * Resolves a published-frame ref against the committed registry: the revision
 * is read through the registry's verifier (so a tampered blob is refused
 * there), the frame is cut from its atlas, and its hash must be the one the
 * ref names.
 */
export function registryFrameReader(
  registryRoot: string,
  vocabulary: AssetVocabulary,
): (ref: PublishedFrameRef) => FrameRead {
  return (ref) => {
    const read = readRevision(
      registryRoot,
      ref.assetId,
      ref.revision,
      vocabulary,
    );
    if (!read.ok)
      // An absent manifest, or one that belongs to another asset, is "missing" for this reference;
      // anything else is the registry's own finding, kept as it said it.
      return read.message.includes("manifest file is missing") ||
        read.message.includes("manifest is for")
        ? {
            ok: false,
            reason: "missing-revision",
            message: `missing-revision: ${ref.assetId} has no revision ${ref.revision}`,
          }
        : {
            ok: false,
            reason: "unreadable-revision",
            message: `unreadable-revision: ${ref.assetId} ${ref.revision} fails the registry's checks: ${read.message}`,
          };
    const cut = cutFrame(
      read.value.manifest,
      read.value.atlas,
      ref.slotKey,
      ref.frameIndex,
    );
    if (!cut.ok) return cut;
    if (cut.hash !== ref.frameHash)
      return {
        ok: false,
        reason: "frame-hash-mismatch",
        message: `frame-hash-mismatch: frame ${ref.frameIndex} of ${ref.slotKey} in ${ref.assetId} ${ref.revision} has hash ${cut.hash}, not ${ref.frameHash}`,
        actual: cut.hash,
      };
    return { ok: true, png: cut.png, image: cut.image };
  };
}
