// Masked img2img edits: resolves the stored inputs of an edit request (the
// base job output and the mask) against the store, refusing anything the
// server could not truthfully be asked to do, and builds the exact body the
// pinned sd-server receives. Pure over the readers it is given.
//
// Wire format, measured against sd-server master-929-3f8527a: the img_gen body
// takes `init_image` and `mask_image` as bare base64 PNG strings and a numeric
// `strength`; white mask pixels are the ones the model may change.

import type { GenerationEdit, Sha256 } from "@panthea/contracts";
import type { RgbaImage } from "../conformance";
import { encodeRgbaPng } from "../placeholder";
import type { FrameRead, PublishedFrameRef } from "./frame-ref";
import { decodePng } from "./png/decode";
import type { AdapterInput, RequestResult } from "./request";
import type { JobRecord, Read } from "./store";

export interface EditSources {
  readJob(id: string): Read<JobRecord>;
  readBlob(hash: Sha256): Uint8Array | undefined;
  /**
   * Resolves a published-frame base from the registry (`registryFrameReader`).
   * Absent where no registry is wired; a published base is then refused.
   */
  readFrame?(ref: PublishedFrameRef): FrameRead;
}

export interface ResolvedEdit {
  readonly edit: GenerationEdit;
  readonly base: Uint8Array;
  readonly mask: Uint8Array;
}

const refuse = (field: string, message: string): RequestResult<never> => ({
  ok: false,
  error: { kind: "invalid-edit", field, message },
});

/** The cell enlarged by a whole factor with nearest pixels, the way a generation is scaled from its native cell. */
function enlarge(image: RgbaImage, factor: number): Uint8Array {
  const width = image.width * factor;
  const height = image.height * factor;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      rgba.set(
        image.rgba.subarray(
          (Math.floor(y / factor) * image.width + Math.floor(x / factor)) * 4,
          (Math.floor(y / factor) * image.width + Math.floor(x / factor)) * 4 +
            4,
        ),
        (y * width + x) * 4,
      );
  return encodeRgbaPng(rgba, width, height);
}

/**
 * Checks an edit against the store: strength in (0, 1], a base (a succeeded
 * job's recorded output, or a stored hand-authored image) at the size the
 * request generates, and an opaque black-and-white mask of the base's size with
 * at least one white pixel.
 */
export function resolveEdit(
  edit: GenerationEdit,
  size: { readonly w: number; readonly h: number },
  sources: EditSources,
): RequestResult<ResolvedEdit> {
  if (
    !Number.isFinite(edit.strength) ||
    edit.strength <= 0 ||
    edit.strength > 1
  )
    return refuse("strength", "strength must be above 0 and at most 1");

  const { base: source } = edit;
  let baseHash: Sha256 | undefined;
  let baseBytes: Uint8Array | undefined;
  if (source.kind === "published") {
    if (sources.readFrame === undefined)
      return refuse(
        "base",
        "a published-frame base cannot be read: no registry is wired to this edit",
      );
    const frame = sources.readFrame(source);
    if (!frame.ok) return refuse("base", frame.message);
    // The generation is the native cell enlarged by a whole factor, the same
    // way a candidate is scaled back down; any other size would resample.
    const factor = size.w / frame.image.width;
    if (
      !Number.isInteger(factor) ||
      factor < 1 ||
      size.h !== frame.image.height * factor
    )
      return refuse(
        "base",
        `the published frame is ${frame.image.width}x${frame.image.height}, which does not scale by a whole factor to the ${size.w}x${size.h} the request generates`,
      );
    baseBytes = enlarge(frame.image, factor);
  } else if (source.kind === "job") {
    const found = sources.readJob(source.jobId);
    if (found.kind !== "found")
      return refuse("base", `there is no readable job ${source.jobId}`);
    const { job } = found.value;
    if (job.status !== "succeeded")
      return refuse(
        "base",
        `job ${source.jobId} is ${job.status}, not succeeded`,
      );
    if (!job.outputs.some((o) => o.hash === source.output))
      return refuse(
        "base",
        `${source.output} is not an output of job ${source.jobId}`,
      );
    baseHash = source.output;
  } else baseHash = source.image;

  if (baseBytes === undefined) {
    baseBytes = sources.readBlob(baseHash as Sha256);
    if (baseBytes === undefined)
      return refuse("base", `the base image ${baseHash} is missing`);
  }
  const base = decodePng(baseBytes);
  if (!base.ok) return refuse("base", base.message);
  if (base.image.width !== size.w || base.image.height !== size.h)
    return refuse(
      "base",
      `the base is ${base.image.width}x${base.image.height}, the request generates ${size.w}x${size.h}`,
    );

  const maskBytes = sources.readBlob(edit.mask);
  if (maskBytes === undefined)
    return refuse("mask", `the mask ${edit.mask} is not a stored blob`);
  const mask = decodePng(maskBytes);
  if (!mask.ok) return refuse("mask", mask.message);
  if (
    mask.image.width !== base.image.width ||
    mask.image.height !== base.image.height
  )
    return refuse(
      "mask",
      `the mask is ${mask.image.width}x${mask.image.height}, the base is ${base.image.width}x${base.image.height}`,
    );
  const { rgba } = mask.image;
  let white = 0;
  for (let at = 0; at < rgba.length; at += 4) {
    const level = rgba[at] as number;
    if (
      (level !== 0 && level !== 255) ||
      rgba[at + 1] !== level ||
      rgba[at + 2] !== level ||
      rgba[at + 3] !== 255
    )
      return refuse(
        "mask",
        "the mask must be opaque and only black (keep) or white (edit)",
      );
    if (level === 255) white += 1;
  }
  if (white === 0) return refuse("mask", "the mask has no white pixel to edit");

  return { ok: true, value: { edit, base: baseBytes, mask: maskBytes } };
}

/** The scalar facts of an edit that a job's recorded settings carry; the images themselves are blobs, never settings. */
export function editSettings(
  edit: GenerationEdit,
): Record<string, string | number> {
  const { base } = edit;
  return {
    edit_strength: edit.strength,
    edit_base_kind:
      base.kind === "job"
        ? "job"
        : base.kind === "hand"
          ? "hand-authored"
          : "published",
    ...(base.kind === "job" ? { edit_base_job: base.jobId } : {}),
    edit_base_sha256:
      base.kind === "job"
        ? base.output
        : base.kind === "hand"
          ? base.image
          : base.frameHash,
    edit_mask_sha256: edit.mask,
  };
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** The img_gen body for one job; an edit adds the init image, mask and strength, and the guidance its input carries. */
export function imgGenBody(input: AdapterInput, edit?: ResolvedEdit) {
  return {
    prompt: input.prompt,
    negative_prompt: input.negativePrompt,
    width: input.width,
    height: input.height,
    seed: input.seed,
    batch_count: 1,
    ...(edit === undefined
      ? {}
      : {
          strength: edit.edit.strength,
          init_image: b64(edit.base),
          mask_image: b64(edit.mask),
        }),
    sample_params: {
      sample_method: input.sampleMethod,
      sample_steps: input.sampleSteps,
      guidance:
        input.distilledGuidance === undefined
          ? { txt_cfg: input.txtCfg }
          : {
              txt_cfg: input.txtCfg,
              distilled_guidance: input.distilledGuidance,
            },
    },
    lora: [] as string[],
    output_format: "png",
  };
}
