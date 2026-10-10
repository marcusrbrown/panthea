// AE9 at fixture level: the comparison the real parity run uses, and the same
// request and seed through the one-shot CLI path and the session path the
// packaged app's sidecar runs, against the staged fake runtime.
//
// The fake runtime ignores the seed in the image it serves, so the different-seed
// control here swaps the served image instead; the real different-seed control is
// the scripted run recorded in docs/evidence/asset-studio/unit7/README.md.

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeRgbaPng } from "../../../packages/assets/src/placeholder";
import { PROVISIONAL_TEST_PARAMS } from "../../../packages/assets/src/studio/_test-fixtures";
import { testImage } from "../../../packages/assets/src/studio/_test-runtime";
import {
  capture,
  depsFor,
  type RuntimeRig,
  removeTempRoots,
  runtimeRig,
} from "./_testkit";
import { execute } from "./commands";
import type { StudioConfig } from "./config";
import { Studio } from "./host";
import {
  type CandidateEvidence,
  compareEvidence,
  type PixelImage,
  readCandidateEvidence,
} from "./parity";

afterEach(removeTempRoots);

const image = (
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number, number],
): PixelImage => {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      rgba.set(paint(x, y), (y * width + x) * 4);
  return { width, height, rgba };
};

const evidence = (
  over: Partial<CandidateEvidence> = {},
): CandidateEvidence => ({
  candidateId: "c",
  seed: 7,
  generated: image(4, 4, (x, y) => [x * 40, y * 40, 9, 255]),
  conformed: image(2, 2, (x, y) => [x * 100, y * 100, 3, 255]),
  report: {
    status: "pass",
    checks: [
      { check: "grid", status: "pass" },
      { check: "palette", status: "pass" },
    ],
  },
  metrics: { resizeFactor: 2, coloursMerged: 1, pixelsChanged: 3 },
  ...over,
});

describe("comparing two candidates", () => {
  test("identical pixels, report and metrics match; the seeds are shown, not compared", () => {
    const result = compareEvidence(evidence(), evidence({ candidateId: "d" }));

    expect(result).toEqual({ identical: true, differences: [] });
  });

  test("one changed conformed pixel is a difference that names the pixel", () => {
    const changed = evidence();
    const rgba = new Uint8Array(changed.conformed.rgba);
    rgba[(1 * 2 + 1) * 4] = 99;

    const result = compareEvidence(evidence(), {
      ...changed,
      conformed: { ...changed.conformed, rgba },
    });

    expect(result.identical).toBe(false);
    expect(result.differences).toEqual([
      "conformed pixels differ: 1 of 4 pixels, first at x=1 y=1",
    ]);
  });

  test("one changed pixel of the generated original is a difference too", () => {
    const changed = evidence();
    const rgba = new Uint8Array(changed.generated.rgba);
    rgba[3 * 4 * 4] = 1;

    const result = compareEvidence(evidence(), {
      ...changed,
      generated: { ...changed.generated, rgba },
    });

    expect(result.differences).toEqual([
      "generated pixels differ: 1 of 16 pixels, first at x=0 y=3",
    ]);
  });

  test("a different size is a difference and the pixels are not compared", () => {
    const result = compareEvidence(
      evidence(),
      evidence({ conformed: image(3, 2, () => [0, 0, 0, 255]) }),
    );

    expect(result.differences).toEqual([
      "conformed size differs: 2x2 against 3x2",
    ]);
  });

  test("a different report status, a different check outcome and a different set of checks each differ", () => {
    const failing = evidence({
      report: {
        status: "fail",
        checks: [
          { check: "grid", status: "pass" },
          { check: "palette", status: "fail" },
        ],
      },
    });
    const other = evidence({
      report: { status: "pass", checks: [{ check: "grid", status: "pass" }] },
    });

    expect(compareEvidence(evidence(), failing).differences).toEqual([
      "report status differs: pass against fail",
      "report check palette differs: pass against fail",
    ]);
    expect(compareEvidence(evidence(), other).differences).toEqual([
      "report checks differ: grid, palette against grid",
    ]);
  });

  test("metrics that differ are reported with both values", () => {
    const result = compareEvidence(
      evidence(),
      evidence({
        metrics: { resizeFactor: 2, coloursMerged: 5, pixelsChanged: 3 },
      }),
    );

    expect(result.differences).toEqual([
      "metric coloursMerged differs: 1 against 5",
    ]);
  });

  test("a comparison is symmetric: it differs in both directions", () => {
    const changed = evidence({ report: { status: "fail", checks: [] } });

    expect(compareEvidence(evidence(), changed).identical).toBe(false);
    expect(compareEvidence(changed, evidence()).identical).toBe(false);
  });
});

/** Generates and conforms one sprite slot, and returns the candidate id (= its job id). */
async function generateAndConform(
  rig: RuntimeRig,
  mode: "oneshot" | "session",
  seed: number,
): Promise<string> {
  const config: StudioConfig = {
    ...rig.config,
    conform: { parity: { ...PROVISIONAL_TEST_PARAMS, scale: 8 } },
  };
  const studio = new Studio(config, depsFor(capture(), rig.deps), mode);
  try {
    const generated = await execute(studio, "generate", {
      id: "zeus-idle",
      subject: "zeus",
      kind: "sprite",
      slots: [{ state: "idle", direction: "south" }],
      batch: 1,
      seed,
    });
    expect(generated.ok).toBe(true);
    await studio.idle();
    const jobId = "zeus-idle-0000";
    const conformed = await execute(studio, "conform", {
      jobId,
      set: "parity",
    });
    expect(conformed).toMatchObject({ ok: true, result: { id: jobId } });
    return jobId;
  } finally {
    await studio.teardown();
  }
}

describe("one request and seed, through the CLI path and the app's session path", () => {
  test("the decoded pixels, report and metrics are identical", async () => {
    const cli = await runtimeRig();
    const app = await runtimeRig();

    const cliCandidate = await generateAndConform(cli, "oneshot", 20261031);
    const appCandidate = await generateAndConform(app, "session", 20261031);

    const a = readCandidateEvidence(cli.root, cliCandidate);
    const b = readCandidateEvidence(app.root, appCandidate);
    if (!a.ok || !b.ok) throw new Error(JSON.stringify([a, b]));
    expect(a.evidence.seed).toBe(20261031);
    expect(b.evidence.seed).toBe(20261031);
    expect(a.evidence.generated.width).toBe(512);
    expect(a.evidence.conformed).toMatchObject({ width: 64, height: 80 });
    expect(compareEvidence(a.evidence, b.evidence)).toEqual({
      identical: true,
      differences: [],
    });
  });

  test("control: a run whose generated image differs fails the comparison, in both directions", async () => {
    const cli = await runtimeRig();
    const base = testImage(512, 640);
    const rgba = new Uint8Array(base.rgba);
    for (let at = 0; at < rgba.length; at += 4 * 67)
      rgba[at] = (rgba[at] as number) ^ 0x55;
    const altered = join(cli.dir, "altered.png");
    writeFileSync(altered, encodeRgbaPng(rgba, 512, 640));
    const other = await runtimeRig({ image: altered });

    const cliCandidate = await generateAndConform(cli, "oneshot", 20261031);
    const otherCandidate = await generateAndConform(other, "session", 20261032);

    const a = readCandidateEvidence(cli.root, cliCandidate);
    const b = readCandidateEvidence(other.root, otherCandidate);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.evidence.seed).not.toBe(b.evidence.seed);
    const forward = compareEvidence(a.evidence, b.evidence);
    expect(forward.identical).toBe(false);
    expect(forward.differences.join("\n")).toContain("generated pixels differ");
    expect(compareEvidence(b.evidence, a.evidence).identical).toBe(false);
  });
});

describe("reading a candidate's evidence", () => {
  test("a candidate that is not in the root is refused with its id", () => {
    const missing = readCandidateEvidence("/nonexistent/root", "nope");

    expect(missing).toMatchObject({ ok: false });
    expect(missing.ok ? "" : missing.message).toContain("nope");
  });

  test("a candidate that needs a scale has no conformed image and is refused", async () => {
    const rig = await runtimeRig();
    const studio = new Studio(
      rig.config,
      depsFor(capture(), rig.deps),
      "oneshot",
    );
    try {
      await execute(studio, "generate", {
        id: "zeus-idle",
        subject: "zeus",
        kind: "sprite",
        slots: [{ state: "idle", direction: "south" }],
        batch: 1,
        seed: 5,
      });
      await execute(studio, "conform", {
        jobId: "zeus-idle-0000",
        params: {
          background: { type: "alpha" },
          alphaCutoff: 128,
          grid: { edgeTolerance: 8, minConfidence: 0.99, minEdges: 20 },
        },
      });
    } finally {
      await studio.teardown();
    }

    const read = readCandidateEvidence(rig.root, "zeus-idle-0000");

    expect(read.ok).toBe(false);
    expect(read.ok ? "" : read.message).toContain("needs a scale");
  });
});
