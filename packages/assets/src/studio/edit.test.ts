import { afterEach, describe, expect, test } from "bun:test";
import {
  type EditBase,
  type GenerationEdit,
  parseGenerationRequest,
  type Sha256,
} from "@panthea/contracts";
import type { RgbaImage } from "../conformance";
import {
  type AssetRig,
  assetRig,
  pngOf,
  removeTempRoots,
  runSlots,
} from "./_test-fixtures";
import { editSettings, imgGenBody, resolveEdit } from "./edit";
import { SELECTED_PROFILE } from "./provider";
import { adapterInput, buildSpec, newRequestRecord, planJobs } from "./request";
import { engineFor } from "./runtime";

afterEach(removeTempRoots);

const SIZE = { w: 768, h: 768 };

/** A mask of `w`x`h`: white inside the given rectangles, black elsewhere; `paint` can break it on purpose. */
function maskImage(
  w: number,
  h: number,
  rectangles: readonly (readonly [number, number, number, number])[],
  paint: (rgba: Uint8Array) => void = () => {},
): RgbaImage {
  const rgba = new Uint8Array(w * h * 4);
  for (let at = 0; at < rgba.length; at += 4) rgba[at + 3] = 255;
  for (const [x0, y0, rw, rh] of rectangles)
    for (let y = y0; y < y0 + rh; y += 1)
      for (let x = x0; x < x0 + rw; x += 1)
        rgba.fill(255, (y * w + x) * 4, (y * w + x) * 4 + 3);
  paint(rgba);
  return { rgba, width: w, height: h };
}
const goodMask = () => maskImage(768, 768, [[371, 225, 94, 24]]);

function baseJob(rig: AssetRig) {
  const [jobId] = runSlots(rig, "zeus-neutral", "portrait", [
    { expression: "neutral" },
  ]) as [string];
  const found = rig.session.store.readJob(jobId);
  if (found.kind !== "found" || found.value.job.status !== "succeeded")
    throw new Error("the base job did not succeed");
  const output = found.value.job.outputs[0];
  if (output === undefined) throw new Error("no output");
  return { jobId, output: output.hash as Sha256 };
}

const sourcesOf = (rig: AssetRig) => ({
  readJob: rig.session.store.readJob,
  readBlob: rig.session.store.readBlob,
});

type JobBase = Extract<EditBase, { kind: "job" }>;
type JobEdit = GenerationEdit & { readonly base: JobBase };

function editOf(
  rig: AssetRig,
  over: Partial<GenerationEdit> = {},
  mask: RgbaImage = goodMask(),
): JobEdit {
  const base = baseJob(rig);
  const maskHash = rig.session.store.putBlob(pngOf(mask));
  return {
    base: { kind: "job", jobId: base.jobId, output: base.output },
    mask: maskHash,
    strength: 0.6,
    cue: "furious scowl, brows drawn hard down",
    ...over,
  } as JobEdit;
}

const refusal = (result: ReturnType<typeof resolveEdit>) =>
  result.ok
    ? undefined
    : result.error.kind === "invalid-edit"
      ? result.error
      : undefined;

describe("resolving an edit against the store", () => {
  test("a succeeded job's output and a same-size black-and-white mask resolve to the stored bytes", () => {
    const rig = assetRig();
    const edit = editOf(rig);

    const result = resolveEdit(edit, SIZE, sourcesOf(rig));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.base).toEqual(
      rig.session.store.readBlob(edit.base.output) as Uint8Array,
    );
    expect(result.value.mask).toEqual(
      rig.session.store.readBlob(edit.mask) as Uint8Array,
    );
  });

  test("a strength of exactly 1 is allowed and anything outside (0, 1] is refused", () => {
    const rig = assetRig();
    const edit = editOf(rig);

    expect(resolveEdit({ ...edit, strength: 1 }, SIZE, sourcesOf(rig)).ok).toBe(
      true,
    );
    for (const strength of [0, -0.1, 1.01, 2, Number.NaN, Infinity])
      expect(
        refusal(resolveEdit({ ...edit, strength }, SIZE, sourcesOf(rig))),
      ).toMatchObject({ field: "strength" });
  });

  test("a base that is not a job in the store is refused", () => {
    const rig = assetRig();
    const edit = editOf(rig);

    expect(
      refusal(
        resolveEdit(
          { ...edit, base: { ...edit.base, jobId: "no-such-job" } },
          SIZE,
          sourcesOf(rig),
        ),
      ),
    ).toMatchObject({ field: "base" });
  });

  test("a base job that has not succeeded is refused", () => {
    const rig = assetRig();
    const edit = editOf(rig);
    const built = newRequestRecord(
      rig.content,
      {
        id: "zeus-pending",
        subject: "zeus",
        kind: "portrait",
        slots: [{ expression: "neutral" }],
        batch: 1,
        seed: 5,
      },
      () => 0,
    );
    if (!built.ok) throw new Error("bad request");
    const submitted = rig.session.submitRequest(built.value.record);
    if (!submitted.ok) throw new Error(submitted.message);

    const result = resolveEdit(
      { ...edit, base: { ...edit.base, jobId: "zeus-pending-0000" } },
      SIZE,
      sourcesOf(rig),
    );

    expect(refusal(result)).toMatchObject({ field: "base" });
    expect(refusal(result)?.message).toContain("queued");
  });

  test("an output hash the base job did not produce is refused, even if it is a stored blob", () => {
    const rig = assetRig();
    const edit = editOf(rig);

    const result = resolveEdit(
      { ...edit, base: { ...edit.base, output: edit.mask } },
      SIZE,
      sourcesOf(rig),
    );

    expect(refusal(result)).toMatchObject({ field: "base" });
    expect(refusal(result)?.message).toContain("not an output of job");
  });

  test("a stored hand-authored image resolves like a job output, and an unstored, non-PNG or wrong-size one is refused", () => {
    const rig = assetRig();
    const edit = editOf(rig);
    const store = (bytes: Uint8Array) => rig.session.store.putBlob(bytes);
    const hand = (image: Sha256): GenerationEdit => ({
      ...edit,
      base: { kind: "hand", image, description: "blocked in by hand" },
    });
    const drawn = store(pngOf(maskImage(768, 768, [[300, 100, 50, 300]])));

    const resolved = resolveEdit(hand(drawn), SIZE, sourcesOf(rig));

    expect(resolved.ok).toBe(true);
    if (resolved.ok)
      expect(resolved.value.base).toEqual(
        rig.session.store.readBlob(drawn) as Uint8Array,
      );
    for (const [name, image] of [
      ["unstored", "0".repeat(64) as Sha256],
      ["not a png", store(new TextEncoder().encode("not a png"))],
      ["wrong size", store(pngOf(maskImage(96, 96, [[1, 1, 4, 4]])))],
    ] as const)
      expect(
        refusal(resolveEdit(hand(image), SIZE, sourcesOf(rig))),
        name,
      ).toMatchObject({ field: "base" });
  });

  test("a base whose size is not the size the request generates is refused", () => {
    const rig = assetRig();
    const edit = editOf(rig);

    expect(
      refusal(resolveEdit(edit, { w: 512, h: 640 }, sourcesOf(rig)))?.message,
    ).toContain("768x768");
  });

  test("a mask whose size differs from the base is refused", () => {
    const rig = assetRig();
    const edit = editOf(rig, {}, maskImage(96, 96, [[10, 10, 8, 8]]));

    const result = resolveEdit(edit, SIZE, sourcesOf(rig));

    expect(refusal(result)).toMatchObject({ field: "mask" });
    expect(refusal(result)?.message).toContain("96x96");
    expect(refusal(result)?.message).toContain("768x768");
  });

  test("a mask that is not a stored blob, not a PNG, not binary, not opaque or empty is refused", () => {
    const rig = assetRig();
    const edit = editOf(rig);
    const store = (bytes: Uint8Array) => rig.session.store.putBlob(bytes);
    const cases: [string, Sha256][] = [
      ["not stored", "0".repeat(64) as Sha256],
      ["not a png", store(new TextEncoder().encode("not a png"))],
      [
        "grey",
        store(
          pngOf(
            maskImage(768, 768, [[1, 1, 4, 4]], (rgba) => rgba.fill(128, 0, 3)),
          ),
        ),
      ],
      [
        "transparent",
        store(
          pngOf(
            maskImage(768, 768, [[1, 1, 4, 4]], (rgba) => {
              rgba[3] = 0;
            }),
          ),
        ),
      ],
      ["empty", store(pngOf(maskImage(768, 768, [])))],
    ];

    for (const [name, mask] of cases)
      expect(
        refusal(resolveEdit({ ...edit, mask }, SIZE, sourcesOf(rig))),
        name,
      ).toMatchObject({ field: "mask" });
  });
});

describe("an edit request", () => {
  const record = (rig: AssetRig, edit: GenerationEdit, batch = 2) => {
    const built = newRequestRecord(
      rig.content,
      {
        id: "zeus-angry",
        subject: "zeus",
        kind: "portrait",
        slots: [{ expression: "angry" }],
        batch,
        seed: 20261010,
        edit,
      },
      () => 0,
    );
    if (!built.ok) throw new Error(JSON.stringify(built.error));
    return built.value;
  };

  test("the edit is part of the stored request and of every expanded job's narrowed request", () => {
    const rig = assetRig();
    const edit = editOf(rig);
    const { record: stored } = record(rig, edit);

    const plan = planJobs(stored, 2);

    expect(stored.request.edit).toEqual(edit);
    if (!plan.ok) throw new Error("not planned");
    expect(plan.value.jobs.map((j) => j.job.request.edit)).toEqual([
      edit,
      edit,
    ]);
    expect(plan.value.jobs.map((j) => j.job.request.seed)).toEqual([
      20261010, 20261011,
    ]);
    for (const { job } of plan.value.jobs)
      expect(parseGenerationRequest(job.request).ok).toBe(true);
  });

  test("an edit prompts with the probe's preserve-the-head wording and negative prompt; a plain request is unchanged", () => {
    const rig = assetRig();
    const edit = editOf(rig);
    const { record: stored } = record(rig, edit);
    const spec = buildSpec(rig.content, stored.request);
    if (!spec.ok) throw new Error("no spec");

    const input = adapterInput(spec.value, "angry", 20261010);

    if (!input.ok) throw new Error("no input");
    expect(input.value.prompt).toBe(
      "same Greek god Zeus, preserve the same head, hairline, face shape, eyes, beard, skin and composition; furious scowl, brows drawn hard down",
    );
    expect(input.value.negativePrompt).toBe(
      "different person, changed identity, changed hairline, new facial features, altered iris or pupil, photorealistic, blurry, antialiasing, round O mouth",
    );
    const { edit: _drop, ...plain } = stored.request;
    const plainSpec = buildSpec(rig.content, plain);
    if (!plainSpec.ok) throw new Error("no spec");
    const plainInput = adapterInput(plainSpec.value, "angry", 20261010);
    if (!plainInput.ok) throw new Error("no input");
    expect(plainInput.value.prompt).toContain("angry expression");
    expect(plainInput.value.negativePrompt).toBe(
      SELECTED_PROFILE.negativePrompt,
    );
  });

  test("the request parser refuses a strength outside (0, 1], an unknown key and a bad hash", () => {
    const rig = assetRig();
    const edit = editOf(rig);
    const { record: stored } = record(rig, edit);
    const parse = (change: Record<string, unknown>) =>
      parseGenerationRequest({
        ...stored.request,
        edit: { ...edit, ...change },
      });

    expect(parse({}).ok).toBe(true);
    expect(parse({ strength: 0 }).ok).toBe(false);
    expect(parse({ strength: 1.5 }).ok).toBe(false);
    expect(parse({ strength: "0.6" }).ok).toBe(false);
    expect(parse({ mask: "abc" }).ok).toBe(false);
    expect(parse({ base: { ...edit.base, output: "ABC" } }).ok).toBe(false);
    expect(parse({ base: { ...edit.base, jobId: "Not A Slug" } }).ok).toBe(
      false,
    );
    expect(parse({ base: { kind: "job", jobId: "a" } }).ok).toBe(false);
    expect(
      parse({
        base: { kind: "hand", image: edit.mask, description: "by hand" },
      }).ok,
    ).toBe(true);
    expect(
      parse({ base: { kind: "hand", image: edit.mask, description: "" } }).ok,
    ).toBe(false);
    expect(parse({ base: { kind: "other" } }).ok).toBe(false);
    expect(parse({ extra: 1 }).ok).toBe(false);
  });
});

describe("the img_gen body", () => {
  function inputFor(rig: AssetRig, edit: GenerationEdit) {
    const built = newRequestRecord(
      rig.content,
      {
        id: "zeus-angry",
        subject: "zeus",
        kind: "portrait",
        slots: [{ expression: "angry" }],
        batch: 1,
        seed: 20261010,
        edit,
      },
      () => 0,
    );
    if (!built.ok) throw new Error("bad request");
    const input = adapterInput(built.value.spec, "angry", 20261010);
    if (!input.ok) throw new Error("no input");
    return input.value;
  }

  test("an edit sends the base and mask as bare base64 PNGs with the strength; a plain job sends none of them", () => {
    const rig = assetRig();
    const edit = editOf(rig);
    const input = inputFor(rig, edit);
    const resolved = resolveEdit(edit, SIZE, sourcesOf(rig));
    if (!resolved.ok) throw new Error("not resolved");

    const body = imgGenBody(input, resolved.value);
    const plain = imgGenBody(input);

    expect(body).toEqual({
      ...plain,
      strength: 0.6,
      init_image: Buffer.from(resolved.value.base).toString("base64"),
      mask_image: Buffer.from(resolved.value.mask).toString("base64"),
    });
    expect(body.init_image).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(body).toMatchObject({
      prompt: input.prompt,
      negative_prompt: input.negativePrompt,
      width: 768,
      height: 768,
      seed: 20261010,
      batch_count: 1,
      sample_params: {
        sample_method: "euler",
        sample_steps: 8,
        guidance: { txt_cfg: 7, distilled_guidance: 1 },
      },
      output_format: "png",
    });
    expect(Object.keys(plain)).not.toContain("init_image");
    expect(Object.keys(plain)).not.toContain("mask_image");
    expect(Object.keys(plain)).not.toContain("strength");
  });

  test("the job's recorded engine settings name the edit by id, hashes and strength, never the image bytes", () => {
    const rig = assetRig();
    const edit = editOf(rig);
    const input = inputFor(rig, edit);
    const resolved = resolveEdit(edit, SIZE, sourcesOf(rig));
    if (!resolved.ok) throw new Error("not resolved");
    const body = imgGenBody(input, resolved.value);
    const handEdit: GenerationEdit = {
      ...edit,
      base: { kind: "hand", image: edit.mask, description: "by hand" },
    };

    const facts = engineFor(SELECTED_PROFILE, body, edit);
    const byHand = engineFor(SELECTED_PROFILE, body, handEdit);
    const plain = engineFor(SELECTED_PROFILE, imgGenBody(input), undefined);
    if (byHand.ok) {
      expect(byHand.value.settings).toMatchObject({
        edit_base_kind: "hand-authored",
        edit_base_sha256: edit.mask,
      });
      expect(Object.keys(byHand.value.settings)).not.toContain("edit_base_job");
    } else throw new Error("engine facts refused");

    if (!facts.ok || !plain.ok) throw new Error("engine facts refused");
    expect(facts.value.settings).toMatchObject({
      prompt: input.prompt,
      negative_prompt: input.negativePrompt,
      ...editSettings(edit),
      edit_strength: 0.6,
      edit_base_kind: "job",
      edit_base_job: edit.base.jobId,
      edit_base_sha256: edit.base.output,
      edit_mask_sha256: edit.mask,
    });
    expect(JSON.stringify(facts.value.settings)).not.toContain(body.init_image);
    expect(JSON.stringify(facts.value.settings)).not.toContain(body.mask_image);
    expect(
      Object.keys(plain.value.settings).filter((k) => k.startsWith("edit_")),
    ).toEqual([]);
  });

  test("an edit samples with the profile's edit guidance and records it: CFG 7 with distilled guidance 1", () => {
    const rig = assetRig();
    const edit = editOf(rig);
    const input = inputFor(rig, edit);
    const resolved = resolveEdit(edit, SIZE, sourcesOf(rig));
    if (!resolved.ok) throw new Error("not resolved");

    const body = imgGenBody(input, resolved.value);
    const facts = engineFor(SELECTED_PROFILE, body, edit);

    expect(SELECTED_PROFILE.edit).toEqual({ txtCfg: 7, distilledGuidance: 1 });
    expect(input).toMatchObject({ txtCfg: 7, distilledGuidance: 1 });
    expect(body.sample_params.guidance).toEqual({
      txt_cfg: 7,
      distilled_guidance: 1,
    });
    if (!facts.ok) throw new Error("engine facts refused");
    expect(facts.value.settings).toMatchObject({
      txt_cfg: 7,
      distilled_guidance: 1,
    });
  });

  test("a plain request is unchanged: CFG 1, no distilled guidance sent or recorded", () => {
    const rig = assetRig();
    const built = newRequestRecord(
      rig.content,
      {
        id: "zeus-plain",
        subject: "zeus",
        kind: "portrait",
        slots: [{ expression: "angry" }],
        batch: 1,
        seed: 20261010,
      },
      () => 0,
    );
    if (!built.ok) throw new Error("bad request");
    const input = adapterInput(built.value.spec, "angry", 20261010);
    if (!input.ok) throw new Error("no input");

    const body = imgGenBody(input.value);
    const facts = engineFor(SELECTED_PROFILE, body, undefined);

    expect(input.value.txtCfg).toBe(SELECTED_PROFILE.sampling.txtCfg);
    expect(Object.keys(input.value)).not.toContain("distilledGuidance");
    expect(Object.keys(body.sample_params.guidance)).toEqual(["txt_cfg"]);
    expect(body.sample_params.guidance.txt_cfg).toBe(1);
    if (!facts.ok) throw new Error("engine facts refused");
    expect(facts.value.settings.txt_cfg).toBe(1);
    expect(Object.keys(facts.value.settings)).not.toContain(
      "distilled_guidance",
    );
  });
});
