// Masked img2img edits: resolves the stored inputs of an edit request (the
// base job output and the mask) against the store, refusing anything the
// server could not truthfully be asked to do, and builds the exact body the
// pinned sd-server receives. Pure over the readers it is given.
//
// Wire format, measured against sd-server master-929-3f8527a: the img_gen body
// takes `init_image` and `mask_image` as bare base64 PNG strings and a numeric
// `strength`; white mask pixels are the ones the model may change.

import type { GenerationEdit, Sha256 } from "@panthea/contracts";
import { decodePng } from "./png/decode";
import type { AdapterInput, RequestResult } from "./request";
import type { JobRecord, Read } from "./store";

export interface EditSources {
  readJob(id: string): Read<JobRecord>;
  readBlob(hash: Sha256): Uint8Array | undefined;
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
  let baseHash: Sha256;
  if (source.kind === "job") {
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

  const baseBytes = sources.readBlob(baseHash);
  if (baseBytes === undefined)
    return refuse("base", `the base image ${baseHash} is missing`);
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
    edit_base_kind: base.kind === "job" ? "job" : "hand-authored",
    ...(base.kind === "job" ? { edit_base_job: base.jobId } : {}),
    edit_base_sha256: base.kind === "job" ? base.output : base.image,
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
