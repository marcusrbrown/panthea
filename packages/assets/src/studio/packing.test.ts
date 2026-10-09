import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalManifestText,
  type GenerationEdit,
  parseProvenance,
  type Sha256,
} from "@panthea/contracts";
import { sha256Hex } from "../hash";
import {
  type AssetRig,
  assetRig,
  finishSheet,
  PROVISIONAL_TEST_PARAMS,
  paintFigure,
  pngOf,
  queuedJob,
  removeTempRoots,
  runSlots,
  spriteSet,
  succeedWithImage,
  upscale,
  withHiddenRgb,
} from "./_test-fixtures";
import { editSettings } from "./edit";
import {
  type PackInput,
  type PackSources,
  type PriorRevision,
  packAsset,
} from "./packing";
import { decodePng } from "./png/decode";
import { newRequestRecord } from "./request";
import { readStudioStatus } from "./store";

afterEach(() => {
  removeTempRoots();
});

const cell = { w: 64, h: 80 };
const input = (over: Partial<PackInput> = {}): PackInput => ({
  id: "zeus-pack",
  workingSetId: "w",
  assetId: "placeholder-zeus",
  styleTag: "draft",
  footprint: { w: 1, h: 1 },
  originalWork: { licence: "MIT", attribution: "the owner" },
  ...over,
});

function sources(
  rig: AssetRig,
  setId: string,
  prior?: PriorRevision,
): PackSources {
  const status = readStudioStatus(rig.root);
  const set = status.workingSets.find((s) => s.id === setId);
  if (set === undefined) throw new Error(`no working set ${setId}`);
  return {
    set,
    edits: new Map(status.edits.map((e) => [e.id, e])),
    jobs: new Map(status.jobs.map((j) => [j.job.id, j])),
    requests: new Map(status.requests.map((r) => [r.id, r])),
    commands: status.commands,
    readBlob: (hash) => rig.session.store.readBlob(hash),
    content: rig.content,
    palette: rig.palette,
    ...(prior === undefined ? {} : { prior }),
  };
}

const pack = (
  rig: AssetRig,
  over: Partial<PackInput> = {},
  setId = "w",
  prior?: PriorRevision,
) => packAsset(input(over), sources(rig, setId, prior));

function packed(
  rig: AssetRig,
  over: Partial<PackInput> = {},
  setId = "w",
  prior?: PriorRevision,
) {
  const result = pack(rig, over, setId, prior);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

const atlasImage = (bytes: Uint8Array) => {
  const result = decodePng(bytes);
  if (!result.ok) throw new Error("atlas does not decode");
  return result.image;
};
const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  expect(Array.from(a)).toEqual(Array.from(b));
const cellOf = (atlas: Uint8Array, index: number, w = 64, h = 80) => {
  const image = atlasImage(atlas);
  const out = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row += 1)
    out.set(
      image.rgba.subarray(
        (row * image.width + index * w) * 4,
        (row * image.width + (index + 1) * w) * 4,
      ),
      row * w * 4,
    );
  return out;
};

describe("packing a sprite", () => {
  test("four hand-finished frames become one untrimmed row of native cells with the frames' own pixels and durations", () => {
    const rig = assetRig();
    const { frames } = spriteSet(rig);

    const result = packed(rig);

    const manifest = result.manifest;
    expect(manifest.kind).toBe("sprite");
    expect(manifest.cell).toEqual(cell);
    expect(manifest.pixelScale).toBe(1);
    expect<string>(manifest.id).toBe("placeholder-zeus");
    expect(manifest.paletteId).toBe(rig.palette.id);
    expect(manifest.paletteFamily).toBe("olympus");
    expect(manifest.atlas).toEqual({
      blob: sha256Hex(result.atlas),
      width: 256,
      height: 80,
    });
    if (manifest.kind !== "sprite") throw new Error("expected a sprite");
    expect(manifest.animations).toHaveLength(1);
    expect(manifest.animations[0]).toMatchObject({
      state: "idle",
      direction: "south",
    });
    expect(manifest.animations[0]?.frames).toEqual(
      [0, 1, 2, 3].map((i) => ({
        rect: { x: i * 64, y: 0, w: 64, h: 80 },
        durationMs: 167,
      })),
    );
    expect(manifest.directions).toEqual(["south"]);
    expect(manifest.realmVariants).toEqual([]);
    expect(manifest.pivot).toEqual({ x: 32, y: 80 });
    expect(manifest.footprint).toEqual({ w: 1, h: 1 });
    for (const [index, frame] of frames.entries())
      sameBytes(cellOf(result.atlas, index), frame.rgba);
    expect(parseText(manifest)).toBe(canonicalManifestText(manifest));
  });

  test("hidden RGB under transparent pixels is copied into the atlas exactly", () => {
    const rig = assetRig();
    const { jobId } = (() => {
      const [id] = runSlots(rig, "zeus-idle", "sprite", [
        { state: "idle", direction: "south" },
      ]);
      rig.session.openWorkingSet("w", "zeus-idle", rig.content);
      rig.session.pick("w", id as string);
      return { jobId: id };
    })();
    void jobId;
    const frames = [0, 1, 2, 3].map((i) =>
      withHiddenRgb(paintFigure(rig.content, cell, i), i + 3),
    );
    finishSheet(rig, "e1", "w", cell, [{ slot: "idle/south", frames }]);

    const result = packed(rig);

    for (const [index, frame] of frames.entries())
      sameBytes(cellOf(result.atlas, index), frame.rgba);
  });

  test("packing the same set twice gives the same atlas bytes and manifest text", () => {
    const rig = assetRig();
    spriteSet(rig);

    const a = packed(rig);
    const b = packed(rig);

    sameBytes(a.atlas, b.atlas);
    expect(canonicalManifestText(a.manifest)).toBe(
      canonicalManifestText(b.manifest),
    );
  });

  test("a hand-finished pivot is the sprite's pivot, and disagreeing pivots are a structural refusal", () => {
    const rig = assetRig();
    spriteSet(rig, { x: 30, y: 78 });
    const result = packed(rig);
    expect(result.manifest.kind === "sprite" && result.manifest.pivot).toEqual({
      x: 30,
      y: 78,
    });

    const split = assetRig();
    const [a, b] = runSlots(split, "zeus-two", "sprite", [
      { state: "idle", direction: "south" },
      { state: "idle", direction: "north" },
    ]);
    split.session.openWorkingSet("w", "zeus-two", split.content);
    split.session.pick("w", a as string);
    split.session.pick("w", b as string);
    const frames = (n: number) =>
      [0, 1, 2, 3].map((i) => paintFigure(split.content, cell, i + n));
    finishSheet(split, "e1", "w", cell, [
      { slot: "idle/south", frames: frames(0), pivot: { x: 32, y: 80 } },
      { slot: "idle/north", frames: frames(1), pivot: { x: 31, y: 80 } },
    ]);

    const refused = pack(split);

    expect(refused).toMatchObject({ ok: false });
    expect(!refused.ok && refused.message).toMatch(/pivot/);
  });

  test("an incomplete working set is refused and nothing is padded or made", () => {
    const rig = assetRig();
    const [jobId] = runSlots(rig, "zeus-idle", "sprite", [
      { state: "idle", direction: "south" },
    ]);
    rig.session.openWorkingSet("w", "zeus-idle", rig.content);
    rig.session.pick("w", jobId as string);

    expect(pack(rig)).toMatchObject({ ok: false });
    expect(() =>
      finishSheet(rig, "e1", "w", cell, [
        {
          slot: "idle/south",
          frames: [0, 1, 2].map((i) => paintFigure(rig.content, cell, i)),
        },
      ]),
    ).toThrow(/at least 4/);
    expect(pack(rig)).toMatchObject({ ok: false });
  });

  test("a sprite needs its footprint", () => {
    const rig = assetRig();
    spriteSet(rig);

    const refused = pack(rig, { footprint: undefined });

    expect(!refused.ok && refused.message).toMatch(/footprint/);
  });

  test("identical authored hold frames are accepted and packed as they are", () => {
    const rig = assetRig();
    const [id] = runSlots(rig, "zeus-idle", "sprite", [
      { state: "idle", direction: "south" },
    ]);
    rig.session.openWorkingSet("w", "zeus-idle", rig.content);
    rig.session.pick("w", id as string);
    const same = paintFigure(rig.content, cell, 2);
    finishSheet(rig, "e1", "w", cell, [
      {
        slot: "idle/south",
        frames: [same, same, same, paintFigure(rig.content, cell, 5)],
      },
    ]);

    const result = packed(rig);

    sameBytes(cellOf(result.atlas, 0), cellOf(result.atlas, 1));
    sameBytes(cellOf(result.atlas, 0), same.rgba);
  });
});

const parseText = (manifest: ReturnType<typeof packed>["manifest"]) =>
  canonicalManifestText(manifest);

describe("the report of a packed asset", () => {
  test("a passing set has a passing aggregate report with one named check per cell and check", () => {
    const rig = assetRig();
    spriteSet(rig);

    const { report } = packed(rig);

    expect(report.status).toBe("pass");
    const names = report.checks.map((c) => c.check);
    for (const frame of [0, 1, 2, 3]) {
      expect(names).toContain(`idle/south#${frame}:grid`);
      expect(names).toContain(`idle/south#${frame}:palette`);
    }
    expect(report.checks.every((c) => c.status === "pass")).toBe(true);
  });

  test("an off-palette hand pixel is reported fresh against the approved palette and kept in the atlas, never repaired", () => {
    const rig = assetRig();
    const [id] = runSlots(rig, "zeus-idle", "sprite", [
      { state: "idle", direction: "south" },
    ]);
    rig.session.openWorkingSet("w", "zeus-idle", rig.content);
    rig.session.pick("w", id as string);
    const frames = [0, 1, 2, 3].map((i) => paintFigure(rig.content, cell, i));
    frames[1]?.rgba.set([255, 0, 255, 255], (20 * 64 + 20) * 4);
    finishSheet(rig, "e1", "w", cell, [{ slot: "idle/south", frames }]);

    const result = packed(rig);

    expect(result.report.status).toBe("fail");
    const failed = result.report.checks
      .filter((c) => c.status === "fail")
      .map((c) => c.check);
    expect(failed).toContain("idle/south#1:palette");
    expect(failed.some((name) => name.startsWith("idle/south#0:"))).toBe(false);
    expect(
      Array.from(
        cellOf(result.atlas, 1).slice(
          (20 * 64 + 20) * 4,
          (20 * 64 + 20) * 4 + 4,
        ),
      ),
    ).toEqual([255, 0, 255, 255]);
    sameBytes(cellOf(result.atlas, 1), frames[1]?.rgba as Uint8Array);
  });
});

describe("packing portraits", () => {
  function portraitSet(rig: AssetRig) {
    const expressions = [...rig.content.vocabulary.expressions];
    const jobs = runSlots(
      rig,
      "zeus-faces",
      "portrait",
      expressions.map((expression) => ({ expression })),
    );
    rig.session.openWorkingSet("wp", "zeus-faces", rig.content);
    for (const id of jobs) rig.session.pick("wp", id);
    return { expressions, jobs };
  }
  const face = { w: 96, h: 96 };
  const portraitInput = (over: Partial<PackInput> = {}) =>
    ({
      id: "zeus-face-pack",
      workingSetId: "wp",
      assetId: "zeus-portrait",
      styleTag: "draft",
      stillFrameMs: 1000,
      originalWork: { licence: "MIT" },
      ...over,
    }) as PackInput;
  const pp = (
    rig: AssetRig,
    over: Partial<PackInput> = {},
    prior?: PriorRevision,
  ) => packAsset(portraitInput(over), sources(rig, "wp", prior));

  test("six expressions picked from one neutral candidate pack with provenance that names that candidate's job", () => {
    const rig = assetRig();
    const expressions = [...rig.content.vocabulary.expressions];
    runSlots(
      rig,
      "zeus-faces",
      "portrait",
      expressions.map((expression) => ({ expression })),
    );
    const [neutralJob] = runSlots(
      rig,
      "zeus-neutral",
      "portrait",
      [{ expression: "neutral" }],
      200,
    ) as [string];
    rig.session.openWorkingSet("wp", "zeus-faces", rig.content);
    expect(rig.session.replaceSheet("wp", "zeus-neutral")).toEqual({
      ok: true,
    });
    for (const expression of expressions)
      expect(rig.session.pick("wp", neutralJob, expression)).toEqual({
        ok: true,
      });

    const status = readStudioStatus(rig.root);
    const set = status.workingSets.find((s) => s.id === "wp");
    for (const expression of expressions)
      expect(set?.picks[expression]).toMatchObject({
        candidateId: neutralJob,
        source: { requestId: "zeus-neutral", slotKey: "neutral" },
      });
    expect(set?.status).toBe("complete");

    const result = pp(rig);

    if (!result.ok) throw new Error(result.message);
    const { manifest } = result.value;
    if (manifest.kind !== "portrait") throw new Error("expected a portrait");
    expect(manifest.expressions.map((e) => e.expression)).toEqual(expressions);
    const provenance = manifest.provenance;
    if (provenance.method !== "generated")
      throw new Error("expected generated");
    expect(provenance.generations.map((g) => g.jobId)).toEqual([neutralJob]);
    expect<unknown>(provenance.generations[0]?.used).toEqual([
      set?.picks.neutral?.inputHash,
    ]);
    expect(provenance.relatedJobs.map((j) => j.jobId)).toEqual([neutralJob]);
  });

  test("six picked expressions pack in vocabulary expression order, one still frame each", () => {
    const rig = assetRig();
    const { expressions } = portraitSet(rig);

    const result = pp(rig);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const manifest = result.value.manifest;
    if (manifest.kind !== "portrait") throw new Error("expected a portrait");
    expect(manifest.characterId).toBe("zeus");
    expect(manifest.expressions.map((e) => e.expression)).toEqual(expressions);
    expect(manifest.expressions.map((e) => e.frame)).toEqual(
      expressions.map((_, i) => ({
        rect: { x: i * 96, y: 0, w: 96, h: 96 },
        durationMs: 1000,
      })),
    );
    expect(manifest.atlas).toMatchObject({ width: 576, height: 96 });
    expect(result.value.report.checks.map((c) => c.check)).toContain(
      "portrait/neutral:palette",
    );
    expect(
      manifest.provenance.method === "generated" &&
        manifest.provenance.handEdits,
    ).toEqual([]);
  });

  test("a picked expression needs the still frame time to be given", () => {
    const rig = assetRig();
    portraitSet(rig);

    const refused = pp(rig, { stillFrameMs: undefined });

    expect(!refused.ok && refused.message).toMatch(/still frame/);
  });

  test("a portrait id must be the id its visual profile maps, when it maps one", () => {
    const rig = assetRig();
    portraitSet(rig);
    const mapped = {
      ...rig.content,
      visuals: rig.content.visuals.map((v) => ({
        ...v,
        portrait: "zeus-portrait",
      })),
    };

    const refused = packAsset(portraitInput({ assetId: "other-face" }), {
      ...sources(rig, "wp"),
      content: mapped,
    });

    expect(!refused.ok && refused.message).toMatch(/zeus-portrait/);
  });

  test("picks mix with a hand-finished expression; one sheet edit over several slots is one hand step", () => {
    const rig = assetRig();
    const { expressions } = portraitSet(rig);
    const edited = [expressions[0] as string, expressions[1] as string];
    finishSheet(
      rig,
      "e1",
      "wp",
      face,
      edited.map((slot, i) => ({
        slot,
        frames: [paintFigure(rig.content, face, i + 20)],
        durations: [800],
      })),
    );

    const result = pp(rig);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const provenance = result.value.manifest.provenance;
    expect(provenance.handEdits).toHaveLength(1);
    expect(provenance.handEdits[0]?.description).toBe("hand edit e1");
    const manifest = result.value.manifest;
    if (manifest.kind !== "portrait") throw new Error("expected a portrait");
    expect(manifest.expressions[0]?.frame.durationMs).toBe(800);
    expect(manifest.expressions[2]?.frame.durationMs).toBe(1000);
    expect(
      provenance.licences.some(
        (l) => l.role === "original-work" && l.licence === "MIT",
      ),
    ).toBe(true);
  });

  test("a scripted finish packs a script step with its own description and no hand-edit label; a plain finish still packs hand edit e1 without a method", () => {
    const description =
      "scripted idle loop (tools/probes/art-edit/sprite_idle_c2.py)";
    const scripted = assetRig();
    const { expressions } = portraitSet(scripted);
    finishSheet(
      scripted,
      "e1",
      "wp",
      face,
      [
        {
          slot: expressions[0] as string,
          frames: [paintFigure(scripted.content, face, 20)],
        },
      ],
      { method: "script", description },
    );

    const packed = pp(scripted);

    expect(packed.ok).toBe(true);
    if (!packed.ok) return;
    const steps = packed.value.manifest.provenance.handEdits;
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ description, method: "script" });
    expect(steps[0]?.description).not.toMatch(/^hand edit/);
    expect(parseProvenance(packed.value.manifest.provenance).ok).toBe(true);

    const plain = assetRig();
    const set = portraitSet(plain);
    finishSheet(plain, "e1", "wp", face, [
      {
        slot: set.expressions[0] as string,
        frames: [paintFigure(plain.content, face, 20)],
      },
    ]);
    const hand = pp(plain);
    expect(hand.ok).toBe(true);
    if (!hand.ok) return;
    const handStep = hand.value.manifest.provenance.handEdits[0];
    expect(handStep?.description).toBe("hand edit e1");
    expect(handStep && "method" in handStep).toBe(false);
  });

  test("a hand step and a script step of two edits keep their own methods in edit order", () => {
    const rig = assetRig();
    const { expressions } = portraitSet(rig);
    finishSheet(rig, "e1", "wp", face, [
      {
        slot: expressions[0] as string,
        frames: [paintFigure(rig.content, face, 20)],
      },
    ]);
    finishSheet(
      rig,
      "e2",
      "wp",
      face,
      [
        {
          slot: expressions[1] as string,
          frames: [paintFigure(rig.content, face, 21)],
        },
      ],
      { method: "script", description: "scripted recolour of the second" },
    );

    const packed = pp(rig);

    expect(packed.ok).toBe(true);
    if (!packed.ok) return;
    expect(
      packed.value.manifest.provenance.handEdits.map((s) => [
        s.description,
        s.method,
      ]),
    ).toEqual([
      ["hand edit e1", undefined],
      ["scripted recolour of the second", "script"],
    ]);
  });

  test("hand edits need the owner's original-work licence to be given", () => {
    const rig = assetRig();
    const { expressions } = portraitSet(rig);
    finishSheet(rig, "e1", "wp", face, [
      {
        slot: expressions[0] as string,
        frames: [paintFigure(rig.content, face, 9)],
      },
    ]);

    expect(pp(rig, { originalWork: undefined })).toMatchObject({ ok: false });
  });
});

describe("provenance of a packed asset", () => {
  test("generations carry the job's exact request, engine facts and used output", () => {
    const rig = assetRig();
    const { jobId } = spriteSet(rig);
    const record = readStudioStatus(rig.root).jobs.find(
      (j) => j.job.id === jobId,
    );
    const pick = readStudioStatus(rig.root).workingSets[0]?.picks["idle/south"];

    const { manifest } = packed(rig);

    const provenance = manifest.provenance;
    if (provenance.method !== "generated")
      throw new Error("expected generated");
    expect(provenance.generations).toHaveLength(1);
    expect<unknown>(provenance.generations[0]).toEqual({
      jobId,
      request: record?.job.request,
      runtime: record?.engine?.runtime,
      model: record?.engine?.model,
      loras: [],
      encoder: record?.engine?.encoder,
      vae: record?.engine?.vae,
      seed: record?.job.request.seed,
      settings: record?.engine?.settings,
      used: [pick?.inputHash],
    });
    expect(provenance.licences).toEqual(
      expect.arrayContaining(record?.engine?.licences ?? []),
    );
    expect(provenance.sourceAssets).toEqual([]);
  });

  test("related jobs are every terminal job of the source request with full outputs, and not the queued or running ones", () => {
    const rig = assetRig();
    spriteSet(rig);
    const { session } = rig;
    const source = (ordinal: number) => ({
      requestId: "zeus-idle",
      slotKey: "idle/south",
      ordinal,
    });
    session.enqueue(source(5), queuedJob("extra-failed"));
    session.start("extra-failed");
    session.fail("extra-failed", "x");
    session.enqueue(source(6), queuedJob("extra-removed"));
    session.remove("extra-removed");
    session.enqueue(source(7), queuedJob("extra-queued"));
    session.enqueue(source(8), queuedJob("extra-running"));
    session.start("extra-running");
    session.enqueue(source(9), queuedJob("extra-unavailable"));
    session.unavailable("extra-unavailable", "no runtime", "stage it");
    const unrelated = runSlots(rig, "other-request", "sprite", [
      { state: "idle", direction: "north" },
    ]);

    const { manifest } = packed(rig);

    const jobs = manifest.provenance.relatedJobs;
    expect(jobs.map((j) => [j.jobId, j.status]).sort()).toEqual(
      [
        ["extra-failed", "failed"],
        ["extra-removed", "cancelled"],
        ["extra-unavailable", "unavailable"],
        ["zeus-idle-0000", "succeeded"],
      ].sort(),
    );
    expect(
      jobs.find((j) => j.jobId === "zeus-idle-0000")?.outputs,
    ).toHaveLength(1);
    expect(jobs.find((j) => j.jobId === "extra-failed")).not.toHaveProperty(
      "outputs",
    );
    expect(jobs.map((j) => j.jobId)).not.toContain(unrelated[0] as string);
  });

  test("a job with several outputs is related with all of them and used for only the picked one", () => {
    const rig = assetRig();
    const { jobId } = spriteSet(rig);
    const status = readStudioStatus(rig.root);
    const record = status.jobs.find((j) => j.job.id === jobId);
    if (record?.job.status !== "succeeded")
      throw new Error("expected a succeeded job");
    const extra = rig.session.store.putBlob(
      pngOf(paintFigure(rig.content, { w: 512, h: 640 }, 3)),
    );
    rig.session.store.putJob({
      ...record,
      job: {
        ...record.job,
        outputs: [
          ...record.job.outputs,
          { medium: "image", hash: extra, width: 512, height: 640 },
        ],
      },
    });

    const { manifest } = packed(rig);

    const provenance = manifest.provenance;
    if (provenance.method !== "generated")
      throw new Error("expected generated");
    expect(
      provenance.relatedJobs.find((j) => j.jobId === jobId)?.outputs,
    ).toHaveLength(2);
    expect(provenance.generations[0]?.used).toHaveLength(1);
  });

  test("two edits with the same sheet hash stay two hand steps, in finish order", () => {
    const rig = assetRig();
    spriteSet(rig);
    const frames = [0, 1, 2, 3].map((i) => paintFigure(rig.content, cell, i));
    finishSheet(rig, "e2", "w", cell, [
      { slot: "idle/south", frames, durations: [167, 167, 166, 167] },
    ]);
    const { manifest } = packed(rig);

    const steps = manifest.provenance.handEdits;
    expect(steps.map((s) => s.description)).toEqual([
      "hand edit e1",
      "hand edit e2",
    ]);
    const edits = readStudioStatus(rig.root).edits;
    expect(steps.map((s) => s.hash)).toEqual(
      edits.map((e) => e.preview?.sheetHash),
    );
  });

  test("a sheet edit over two slots made later than an edit over one is ordered by when each was finished", () => {
    const rig = assetRig();
    const [a, b] = runSlots(rig, "zeus-two", "sprite", [
      { state: "idle", direction: "south" },
      { state: "idle", direction: "north" },
    ]);
    rig.session.openWorkingSet("w", "zeus-two", rig.content);
    rig.session.pick("w", a as string);
    rig.session.pick("w", b as string);
    const four = (n: number) =>
      [0, 1, 2, 3].map((i) => paintFigure(rig.content, cell, i + n));
    finishSheet(rig, "late-name", "w", cell, [
      { slot: "idle/south", frames: four(0) },
    ]);
    finishSheet(rig, "a-first-name", "w", cell, [
      { slot: "idle/south", frames: four(1) },
      { slot: "idle/north", frames: four(2) },
    ]);

    const { manifest } = packed(rig);

    expect(manifest.provenance.handEdits.map((s) => s.description)).toEqual([
      "hand edit late-name",
      "hand edit a-first-name",
    ]);
  });
});

describe("a source that cannot be traced is refused", () => {
  const tamper = (rig: AssetRig, change: (root: string) => void) => {
    change(rig.root);
    return pack(rig);
  };
  const edit = (root: string, id = "e1") => join(root, "edits", `${id}.json`);

  test("an unfinished edit, a missing edit and an edit without its ledger entry", () => {
    const unfinished = assetRig();
    spriteSet(unfinished);
    expect(
      tamper(unfinished, (root) => {
        const record = JSON.parse(readFileSync(edit(root), "utf8"));
        record.status = "open";
        writeFileSync(edit(root), JSON.stringify(record));
      }),
    ).toMatchObject({ ok: false });

    const missing = assetRig();
    spriteSet(missing);
    expect(
      tamper(missing, (root) => writeFileSync(edit(root), "{}")),
    ).toMatchObject({ ok: false });

    const noLedger = assetRig();
    spriteSet(noLedger);
    const status = readStudioStatus(noLedger.root);
    const without = {
      ...sources(noLedger, "w"),
      commands: status.commands.filter((c) => c.type !== "finish-edit"),
    };
    expect(packAsset(input(), without)).toMatchObject({ ok: false });
  });

  test("a source job that is not succeeded, has no engine facts, or never output the picked image", () => {
    const failedJob = assetRig();
    const { jobId } = spriteSet(failedJob);
    const record = readStudioStatus(failedJob.root).jobs.find(
      (j) => j.job.id === jobId,
    );
    if (record === undefined) throw new Error("no job");
    failedJob.session.store.putJob({
      schemaVersion: 1,
      source: record.source,
      job: { ...record.job, status: "failed", error: "x" } as never,
    });
    expect(pack(failedJob)).toMatchObject({ ok: false });

    const other = assetRig();
    spriteSet(other);
    const set = readStudioStatus(other.root).workingSets[0];
    if (set === undefined) throw new Error("no set");
    other.session.store.putWorkingSet({
      ...set,
      picks: {
        "idle/south": {
          ...(set.picks["idle/south"] as NonNullable<
            (typeof set.picks)[string]
          >),
          inputHash: sha256Hex(new Uint8Array([9])),
        },
      },
    });
    expect(pack(other)).toMatchObject({ ok: false });
  });

  test("an authored slot whose recorded hand history is not its edit chain", () => {
    const rig = assetRig();
    spriteSet(rig);
    const set = readStudioStatus(rig.root).workingSets[0];
    if (set === undefined) throw new Error("no set");
    const authored = set.frames["idle/south"];
    if (authored === undefined) throw new Error("no frames");
    rig.session.store.putWorkingSet({
      ...set,
      frames: {
        "idle/south": {
          ...authored,
          handEdits: [
            { description: "hand edit made-up", hash: authored.sheetHash },
          ],
        },
      },
    });

    expect(pack(rig)).toMatchObject({ ok: false });
  });

  test("a stored frame that is missing, altered or the wrong size", () => {
    const missing = assetRig();
    spriteSet(missing);
    const frame = readStudioStatus(missing.root).workingSets[0]?.frames[
      "idle/south"
    ]?.frames[2]?.hash as Sha256;
    const blob = join(missing.root, "blobs", `${frame}.png`);
    const good = readFileSync(blob);
    writeFileSync(blob, "no longer a png");
    expect(pack(missing)).toMatchObject({ ok: false });
    mkdirSync(join(missing.root, "blobs"), { recursive: true });
    writeFileSync(blob, good);
    expect(pack(missing).ok).toBe(true);

    const wrongSize = assetRig();
    spriteSet(wrongSize);
    const set = readStudioStatus(wrongSize.root).workingSets[0];
    const authored = set?.frames["idle/south"];
    if (set === undefined || authored === undefined) throw new Error("no set");
    const small = wrongSize.session.store.putBlob(
      pngOf(paintFigure(wrongSize.content, { w: 32, h: 40 }, 1)),
    );
    wrongSize.session.store.putWorkingSet({
      ...set,
      frames: {
        "idle/south": {
          ...authored,
          frames: authored.frames.map((f, i) =>
            i === 1 ? { ...f, hash: small } : f,
          ),
        },
      },
    });
    const refused = pack(wrongSize);
    expect(!refused.ok && refused.message).toMatch(/32x40/);
  });
});

describe("carrying cells from the published revision", () => {
  function twoStates(rig: AssetRig) {
    spriteSet(rig);
    const first = packed(rig);
    const prior: PriorRevision = {
      revision: sha256Hex(
        new TextEncoder().encode(canonicalManifestText(first.manifest)),
      ),
      manifest: first.manifest,
      atlas: first.atlas,
    };
    const [id] = runSlots(
      rig,
      "zeus-north",
      "sprite",
      [{ state: "idle", direction: "north" }],
      500,
    );
    rig.session.openWorkingSet("w2", "zeus-north", rig.content);
    rig.session.pick("w2", id as string);
    finishSheet(rig, "e9", "w2", cell, [
      {
        slot: "idle/north",
        frames: [0, 1, 2, 3].map((i) => paintFigure(rig.content, cell, i + 3)),
      },
    ]);
    return { first, prior };
  }
  const params = {
    background: PROVISIONAL_TEST_PARAMS.background,
    alphaCutoff: PROVISIONAL_TEST_PARAMS.alphaCutoff,
    grid: PROVISIONAL_TEST_PARAMS.grid,
  };

  test("a new state packs beside the carried one, whose cells and durations are byte-identical, and names its real source revision", () => {
    const rig = assetRig();
    const { first, prior } = twoStates(rig);

    const result = packAsset(
      input({ workingSetId: "w2", carriedParams: params }),
      sources(rig, "w2", prior),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const manifest = result.value.manifest;
    if (manifest.kind !== "sprite") throw new Error("expected a sprite");
    expect(manifest.animations.map((a) => `${a.state}/${a.direction}`)).toEqual(
      ["idle/south", "idle/north"],
    );
    expect(manifest.directions).toEqual(["south", "north"]);
    expect(manifest.atlas.width).toBe(512);
    for (const index of [0, 1, 2, 3])
      sameBytes(cellOf(result.value.atlas, index), cellOf(first.atlas, index));
    expect(manifest.animations[0]?.frames.map((f) => f.durationMs)).toEqual(
      first.manifest.kind === "sprite"
        ? first.manifest.animations[0]?.frames.map((f) => f.durationMs)
        : [],
    );
    expect<unknown>(manifest.provenance.sourceAssets).toEqual([
      { assetId: "placeholder-zeus", revision: prior.revision },
    ]);
    expect(result.value.carried).toEqual(["idle/south"]);
    expect(result.value.report.checks.map((c) => c.check)).toContain(
      "idle/south#0:grid",
    );
    expect(result.value.report.checks.map((c) => c.check)).toContain(
      "idle/north#3:grid",
    );
  });

  test("carrying needs the conformance settings to be given", () => {
    const rig = assetRig();
    const { prior } = twoStates(rig);

    const refused = packAsset(
      input({ workingSetId: "w2" }),
      sources(rig, "w2", prior),
    );

    expect(!refused.ok && refused.message).toMatch(
      /idle\/south.*conformance settings/s,
    );
  });

  test("replacing the same state carries nothing and names no source revision", () => {
    const rig = assetRig();
    const { prior } = twoStates(rig);

    const result = packAsset(
      input({ carriedParams: params }),
      sources(rig, "w", prior),
    );

    expect(result.ok && result.value.manifest.provenance.sourceAssets).toEqual(
      [],
    );
    expect(result.ok && result.value.carried).toEqual([]);
  });

  test("a published revision of another kind, cell size, pivot or footprint is refused", () => {
    const rig = assetRig();
    const { prior } = twoStates(rig);
    const mod = (change: (m: Record<string, unknown>) => void) => {
      const m = JSON.parse(JSON.stringify(prior.manifest));
      change(m);
      return { ...prior, manifest: m };
    };
    const tryPrior = (p: PriorRevision) =>
      packAsset(
        input({ workingSetId: "w2", carriedParams: params }),
        sources(rig, "w2", p),
      );

    expect(
      tryPrior(
        mod((m) => {
          m.kind = "portrait";
        }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      tryPrior(
        mod((m) => {
          m.cell = { w: 32, h: 40 };
        }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      tryPrior(
        mod((m) => {
          m.pivot = { x: 1, y: 1 };
        }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      tryPrior(
        mod((m) => {
          m.footprint = { w: 2, h: 2 };
        }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      tryPrior(
        mod((m) => {
          m.paletteFamily = "town";
        }),
      ),
    ).toMatchObject({ ok: false });
  });
});

describe("packing an edited portrait", () => {
  const FACE = { w: 96, h: 96 };

  /** A neutral job, an edit request of `base`, its succeeded job (recording the edit as the runtime does) and a set picking it for every expression. */
  function editedSet(
    rig: AssetRig,
    makeBase: (
      neutralJobId: string,
      neutralOutput: Sha256,
    ) => GenerationEdit["base"],
  ) {
    const { session, content } = rig;
    const expressions = [...content.vocabulary.expressions];
    runSlots(
      rig,
      "zeus-faces",
      "portrait",
      expressions.map((expression) => ({ expression })),
    );
    const [neutral] = runSlots(
      rig,
      "zeus-neutral",
      "portrait",
      [{ expression: "neutral" }],
      200,
    ) as [string];
    const neutralJob = session.store.readJob(neutral);
    if (
      neutralJob.kind !== "found" ||
      neutralJob.value.job.status !== "succeeded"
    )
      throw new Error("no neutral output");
    const mask = new Uint8Array(768 * 768 * 4);
    for (let at = 0; at < mask.length; at += 4) mask[at + 3] = 255;
    mask.fill(255, (225 * 768 + 371) * 4, (225 * 768 + 371) * 4 + 3);
    const maskHash = session.store.putBlob(
      pngOf({ rgba: mask, width: 768, height: 768 }),
    );
    const edit: GenerationEdit = {
      base: makeBase(
        neutral,
        (neutralJob.value.job.outputs[0] as { hash: Sha256 }).hash,
      ),
      mask: maskHash,
      strength: 0.6,
      cue: "furious scowl, brows drawn hard down",
    };
    const built = newRequestRecord(
      content,
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
    if (!built.ok) throw new Error(JSON.stringify(built.error));
    const submitted = session.submitRequest(built.value.record);
    if (!submitted.ok) throw new Error(submitted.message);
    const [editJob] = submitted.jobIds as [string];
    succeedWithImage(
      session,
      editJob,
      pngOf(upscale(paintFigure(content, FACE, 3), 8)),
      { w: 768, h: 768 },
      {
        ...rig.engine,
        settings: { ...rig.engine.settings, ...editSettings(edit) },
      },
    );
    if (!session.conform(editJob, content, PROVISIONAL_TEST_PARAMS).ok)
      throw new Error("conform");
    session.openWorkingSet("wp", "zeus-faces", content);
    session.replaceSheet("wp", "zeus-angry");
    for (const expression of expressions)
      if (!session.pick("wp", editJob, expression).ok)
        throw new Error(`pick ${expression}`);
    return { neutral, neutralOutput: edit.base, editJob, edit };
  }

  const portraitInput = (over: Partial<PackInput> = {}) =>
    ({
      id: "zeus-face-pack",
      workingSetId: "wp",
      assetId: "zeus-portrait",
      styleTag: "draft",
      stillFrameMs: 1000,
      originalWork: { licence: "MIT" },
      ...over,
    }) as PackInput;
  const provenanceOf = (result: ReturnType<typeof packAsset>) => {
    if (!result.ok) throw new Error(result.message);
    const { provenance } = result.value.manifest;
    if (provenance.method !== "generated")
      throw new Error("expected generated");
    return provenance;
  };

  test("an edit of a job's output names the base job as a related job and records the edit in the generation", () => {
    const rig = assetRig();
    const { neutral, editJob, edit } = editedSet(rig, (jobId, output) => ({
      kind: "job",
      jobId,
      output,
    }));

    const provenance = provenanceOf(
      packAsset(portraitInput(), sources(rig, "wp")),
    );

    expect(provenance.generations.map((g) => g.jobId)).toEqual([editJob]);
    expect(provenance.generations[0]?.request.edit).toEqual(edit);
    expect(provenance.generations[0]?.settings).toMatchObject({
      edit_strength: 0.6,
      edit_base_kind: "job",
      edit_base_job: neutral,
      edit_base_sha256: edit.base.kind === "job" ? edit.base.output : "",
      edit_mask_sha256: edit.mask,
    });
    expect(provenance.relatedJobs.map((j) => j.jobId).sort()).toEqual(
      [editJob, neutral].sort(),
    );
    expect(provenance.handEdits).toEqual([]);
  });

  test("the manifest validator rejects an edit whose base job is not among the related jobs", () => {
    const rig = assetRig();
    editedSet(rig, (jobId, output) => ({ kind: "job", jobId, output }));
    const provenance = provenanceOf(
      packAsset(portraitInput(), sources(rig, "wp")),
    );
    const base = (provenance.generations[0]?.request.edit?.base ?? {}) as {
      jobId?: string;
    };

    const without = parseProvenance({
      ...provenance,
      relatedJobs: provenance.relatedJobs.filter((j) => j.jobId !== base.jobId),
    });

    expect(parseProvenance(provenance).ok).toBe(true);
    expect(without).toMatchObject({ ok: false });
    expect(!without.ok && without.path).toContain("request.edit.base.jobId");
  });

  test("packing refuses when the base job is not a recorded succeeded job", () => {
    const rig = assetRig();
    const { neutral } = editedSet(rig, (jobId, output) => ({
      kind: "job",
      jobId,
      output,
    }));
    const all = sources(rig, "wp");

    const result = packAsset(portraitInput(), {
      ...all,
      jobs: new Map([...all.jobs].filter(([id]) => id !== neutral)),
    });

    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.message).toContain(neutral);
  });

  test("an edit of a hand-authored image records that image as a hand edit with its hash, and the owner's hand-work licence", () => {
    const rig = assetRig();
    const image = rig.session.store.putBlob(
      pngOf(upscale(paintFigure(rig.content, FACE, 5), 8)),
    );
    const { editJob, edit } = editedSet(rig, () => ({
      kind: "hand",
      image,
      description: "blocked in by hand",
    }));

    const result = packAsset(portraitInput(), sources(rig, "wp"));
    const provenance = provenanceOf(result);

    expect(provenance.generations.map((g) => g.jobId)).toEqual([editJob]);
    expect(provenance.generations[0]?.request.edit).toEqual(edit);
    expect(provenance.generations[0]?.settings).toMatchObject({
      edit_base_kind: "hand-authored",
      edit_base_sha256: image,
    });
    expect(provenance.handEdits).toEqual([
      {
        description: "hand-authored edit base: blocked in by hand",
        hash: image,
      },
    ]);
    expect(provenance.relatedJobs.map((j) => j.jobId)).toEqual([editJob]);
    expect(provenance.licences).toContainEqual({
      subject: "zeus-portrait",
      role: "original-work",
      licence: "MIT",
    });
  });

  test("a hand-authored base needs the hand-work licence, a stored image and its handEdits record", () => {
    const rig = assetRig();
    const image = rig.session.store.putBlob(
      pngOf(upscale(paintFigure(rig.content, FACE, 5), 8)),
    );
    editedSet(rig, () => ({ kind: "hand", image, description: "by hand" }));
    const all = sources(rig, "wp");
    const provenance = provenanceOf(
      packAsset(portraitInput(), sources(rig, "wp")),
    );

    expect(
      packAsset(portraitInput({ originalWork: undefined }), all),
    ).toMatchObject({ ok: false });
    expect(
      packAsset(portraitInput(), { ...all, readBlob: () => undefined }),
    ).toMatchObject({ ok: false });
    const unrecorded = parseProvenance({ ...provenance, handEdits: [] });
    expect(unrecorded).toMatchObject({ ok: false });
    expect(!unrecorded.ok && unrecorded.path).toContain(
      "request.edit.base.image",
    );
  });
});
