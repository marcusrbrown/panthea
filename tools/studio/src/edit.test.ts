import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openStudioSession,
  readStudioStatus,
  type StudioRuntime,
  type StudioSession,
} from "@panthea/assets/studio";
import {
  type AssetRig,
  pngOf,
  runSlots,
} from "../../../packages/assets/src/studio/_test-fixtures";
import { assetRig, removeTempRoots, run } from "./_testkit";
import type { StudioConfig } from "./config";
import type { Outcome } from "./format";
import { parseArgv } from "./index";

const dirs: string[] = [];
afterEach(() => {
  removeTempRoots();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** A runtime that fails every queued job at once: nothing spawned, nothing timed. */
const fakeRuntime = (session: StudioSession): StudioRuntime => ({
  async drain() {
    const queued = session.queued();
    if (queued.ok)
      for (const { job } of queued.jobs) {
        session.start(job.id);
        session.fail(job.id, "fake runtime");
      }
    return { ok: true, results: [], stopped: "empty" };
  },
  async abort() {
    return { ok: true };
  },
  async close() {
    return { ok: true };
  },
  async shutdown() {
    session.close();
    return { ok: true };
  },
});

/** An opaque `w`x`h` PNG, black except for one white rectangle. */
function image(
  w: number,
  h: number,
  white: readonly [number, number, number, number],
) {
  const rgba = new Uint8Array(w * h * 4);
  for (let at = 0; at < rgba.length; at += 4) rgba[at + 3] = 255;
  const [x0, y0, rw, rh] = white;
  for (let y = y0; y < y0 + rh; y += 1)
    for (let x = x0; x < x0 + rw; x += 1)
      rgba.fill(255, (y * w + x) * 4, (y * w + x) * 4 + 3);
  return pngOf({ rgba, width: w, height: h });
}

function setup() {
  const rig: AssetRig = assetRig();
  const [neutral] = runSlots(rig, "zeus-neutral", "portrait", [
    { expression: "neutral" },
  ]) as [string];
  const found = rig.session.store.readJob(neutral);
  if (found.kind !== "found" || found.value.job.status !== "succeeded")
    throw new Error("no neutral output");
  const output = found.value.job.outputs[0]?.hash as string;
  rig.session.close();
  const dir = mkdtempSync(join(tmpdir(), "studio-edit-"));
  dirs.push(dir);
  const write = (name: string, bytes: Uint8Array) => {
    const path = join(dir, name);
    writeFileSync(path, bytes);
    return path;
  };
  const config: StudioConfig = {
    studioRoot: rig.root,
    contentRoot: "/content",
    registryRoot: rig.registryRoot,
    artifactRoot: "/artifacts",
    runtime: {
      port: 1,
      pollMs: 1,
      deadlines: {
        httpMs: 1,
        startupMs: 1,
        generationMs: 1,
        termGraceMs: 1,
        killMs: 1,
      },
    },
  };
  const generate = (args: Record<string, unknown>): Promise<Outcome> =>
    run(
      config,
      "generate",
      {
        id: "zeus-angry",
        subject: "zeus",
        kind: "portrait",
        slots: [{ expression: "angry" }],
        batch: 1,
        seed: 20261010,
        editStrength: 0.6,
        editCue: "furious scowl, brows drawn hard down",
        ...args,
      },
      {
        loadContent: () => ({ ok: true as const, content: rig.content }),
        openRuntime: (session) => fakeRuntime(session),
      },
    ).then((r) => r.outcome);
  const blob = (hash: string) => {
    const opened = openStudioSession(rig.root);
    if (opened.kind === "busy") throw new Error("busy");
    try {
      return opened.session.store.readBlob(hash as never);
    } finally {
      opened.session.close();
    }
  };
  const maskBytes = image(768, 768, [371, 225, 94, 24]);
  const mask = write("mask.png", maskBytes);
  return { rig, neutral, output, write, generate, blob, mask, maskBytes };
}

const code = (outcome: Outcome) => (outcome.ok ? "ok" : outcome.error.code);
const requests = (rig: AssetRig) =>
  readStudioStatus(rig.root).requests.map((r) => r.id);

describe("edit flags on the command line", () => {
  test("a job base and a hand-authored base parse to named arguments, with the strength as a decimal number", () => {
    const job = parseArgv([
      "generate",
      "--edit-base-job",
      "zeus-neutral-0000",
      "--edit-base-output",
      "a".repeat(64),
      "--edit-mask",
      "/m.png",
      "--edit-strength",
      "0.6",
      "--edit-cue",
      "furious scowl",
    ]);
    const hand = parseArgv([
      "generate",
      "--edit-base-image",
      "/init.png",
      "--edit-base-description",
      "blocked in by hand",
      "--edit-strength",
      "1",
    ]);

    expect(job).toMatchObject({
      op: "generate",
      args: {
        editBaseJob: "zeus-neutral-0000",
        editBaseOutput: "a".repeat(64),
        editMask: "/m.png",
        editStrength: 0.6,
        editCue: "furious scowl",
      },
    });
    expect(hand).toMatchObject({
      args: {
        editBaseImage: "/init.png",
        editBaseDescription: "blocked in by hand",
        editStrength: 1,
      },
    });
  });

  test("a strength that is not a non-negative decimal is a usage error", () => {
    for (const bad of ["fast", "-0.5", "1e3", "0.5.1"])
      expect(
        parseArgv(["generate", "--edit-strength", bad]),
        bad,
      ).toMatchObject({ ok: false });
  });
});

describe("generate with an edit", () => {
  test("an edit of a job's output stores the mask and the request names the base, mask, strength and cue", async () => {
    const t = setup();

    const outcome = await t.generate({
      editBaseJob: t.neutral,
      editBaseOutput: t.output,
      editMask: t.mask,
    });

    expect(code(outcome)).toBe("generation-failed");
    const status = readStudioStatus(t.rig.root);
    const request = status.requests.find((r) => r.id === "zeus-angry");
    expect(request?.request.edit).toEqual({
      base: { kind: "job", jobId: t.neutral, output: t.output } as never,
      mask: sha(t.maskBytes) as never,
      strength: 0.6,
      cue: "furious scowl, brows drawn hard down",
    });
    expect(
      status.jobs.find((j) => j.job.id === "zeus-angry-0000")?.job.request.edit,
    ).toEqual(request?.request.edit);
    expect(t.blob(sha(t.maskBytes))).toEqual(t.maskBytes);
  });

  test("an edit of a hand-authored image stores that image as a blob and the request names it by hash and description", async () => {
    const t = setup();
    const init = image(768, 768, [100, 100, 40, 200]);

    await t.generate({
      editBaseImage: t.write("init.png", init),
      editBaseDescription: "blocked in by hand",
      editMask: t.mask,
    });

    const request = readStudioStatus(t.rig.root).requests.find(
      (r) => r.id === "zeus-angry",
    );
    expect(request?.request.edit?.base).toEqual({
      kind: "hand",
      image: sha(init) as never,
      description: "blocked in by hand",
    });
    expect(t.blob(sha(init))).toEqual(init);
  });

  test("a mask of another size refuses the request and stores neither the request nor the mask", async () => {
    const t = setup();
    const small = image(96, 96, [10, 10, 8, 8]);

    const outcome = await t.generate({
      editBaseJob: t.neutral,
      editBaseOutput: t.output,
      editMask: t.write("small.png", small),
    });

    expect(code(outcome)).toBe("invalid-request");
    expect(JSON.stringify(outcome)).toContain("invalid-edit");
    expect(JSON.stringify(outcome)).toContain('"mask"');
    expect(requests(t.rig)).not.toContain("zeus-angry");
    expect(t.blob(sha(small))).toBeUndefined();
  });

  test("a base that is not a succeeded job output, or a strength outside (0, 1], refuses the request", async () => {
    const t = setup();
    const outcomes: Outcome[] = [];
    for (const args of [
      { editBaseJob: "no-such-job", editBaseOutput: t.output },
      { editBaseJob: t.neutral, editBaseOutput: "0".repeat(64) },
      { editBaseJob: t.neutral, editBaseOutput: t.output, editStrength: 0 },
      { editBaseJob: t.neutral, editBaseOutput: t.output, editStrength: 1.5 },
    ])
      outcomes.push(await t.generate({ ...args, editMask: t.mask }));

    expect(outcomes.map(code)).toEqual(Array(4).fill("invalid-request"));
    expect(requests(t.rig)).not.toContain("zeus-angry");
  });

  test("the edit flags must name the mask, strength, cue and exactly one complete base", async () => {
    const t = setup();
    const init = t.write("init.png", image(768, 768, [100, 100, 40, 200]));
    const cases: Record<string, unknown>[] = [
      { editMask: t.mask },
      { editBaseJob: t.neutral, editMask: t.mask },
      { editBaseImage: init, editMask: t.mask },
      {
        editBaseJob: t.neutral,
        editBaseOutput: t.output,
        editBaseImage: init,
        editBaseDescription: "both",
        editMask: t.mask,
      },
      {
        editBaseJob: t.neutral,
        editBaseOutput: t.output,
        editMask: "/no/such/mask.png",
      },
    ];

    for (const args of cases)
      expect(code(await t.generate(args)), JSON.stringify(args)).toBe(
        "invalid-arguments",
      );
    expect(requests(t.rig)).not.toContain("zeus-angry");
  });
});
