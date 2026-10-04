// Behavior tests for the model-agnostic measurement records: timing
// summary (warmup vs sample, nearest-rank p50/p95), byte-derived hashes,
// component provenance, and the per-cell status invariants (a cancelled,
// failed, timed-out or unavailable cell never carries timings or outputs
// that look like a completed result).

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CellRecord,
  describeComponent,
  hashBytes,
  pairSeedOutputs,
  summarizeTimings,
} from "./measure";

describe("summarizeTimings", () => {
  it("excludes warmup timings from sample count and percentiles", () => {
    const summary = summarizeTimings({
      warmup: [900],
      samples: [10, 20, 30, 40],
    });
    expect(summary.warmupMs).toEqual([900]);
    expect(summary.sampleCount).toBe(4);
    // Nearest-rank: rank = ceil(p/100 * n) over sorted samples.
    expect(summary.p50Ms).toBe(20);
    expect(summary.p95Ms).toBe(40);
    expect(summary.percentileRule).toBe("nearest-rank");
  });

  it("flags p95 as the sample maximum when fewer than 20 samples exist", () => {
    expect(
      summarizeTimings({ warmup: [], samples: [5, 1, 9] }).p95IsSampleMax,
    ).toBe(true);
    const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
    const summary = summarizeTimings({ warmup: [], samples: twenty });
    expect(summary.p95Ms).toBe(19);
    expect(summary.p95IsSampleMax).toBe(false);
  });

  it("reports null percentiles (never 0 or NaN) with no samples", () => {
    const summary = summarizeTimings({ warmup: [500], samples: [] });
    expect(summary.sampleCount).toBe(0);
    expect(summary.p50Ms).toBeNull();
    expect(summary.p95Ms).toBeNull();
  });

  it("does not mutate its input", () => {
    const samples = [3, 1, 2];
    summarizeTimings({ warmup: [], samples });
    expect(samples).toEqual([3, 1, 2]);
  });
});

describe("hashBytes / describeComponent", () => {
  it("hashes bytes with sha256", () => {
    expect(hashBytes(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("derives the component hash from file bytes, not declared metadata", async () => {
    const dir = mkdtempSync(join(tmpdir(), "art-local-2-"));
    try {
      const path = join(dir, "weights.bin");
      writeFileSync(path, "abc");
      const component = await describeComponent({
        role: "lora",
        id: "example-lora",
        path,
        declared: {
          sha256: "0".repeat(64),
          license: "probe-only",
          source: "https://example.invalid/x",
        },
      });
      expect(component.available).toBe(true);
      if (!component.available) return;
      expect(component.sha256).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
      expect(component.sizeBytes).toBe(3);
      expect(component.declaredSha256).toBe("0".repeat(64));
      expect(component.declaredHashMatches).toBe(false);
      expect(component.license).toBe("probe-only");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("marks a missing file unavailable with no invented hash", async () => {
    const component = await describeComponent({
      role: "diffusion-model",
      id: "missing",
      path: join(tmpdir(), "art-local-2-does-not-exist.gguf"),
      declared: { sha256: "a".repeat(64) },
    });
    expect(component.available).toBe(false);
    expect("sha256" in component).toBe(false);
    expect(component.id).toBe("missing");
  });
});

describe("pairSeedOutputs", () => {
  const base = {
    schemaVersion: 1,
    arm: "a",
    settings: { steps: 4 },
    components: [],
    peakRssKb: null,
  } as const;

  const completed = (
    cellId: string,
    seed: number,
    sha256: string,
  ): CellRecord => ({
    ...base,
    cellId,
    seed,
    status: "completed",
    warmup: [],
    samples: [{ index: 0, wallMs: 10 }],
    timing: summarizeTimings({ warmup: [], samples: [10] }),
    outputs: [{ index: 0, sha256, byteLength: 4 }],
  });

  it("reports differing hashes for a completed pair with the same seed", () => {
    const pair = pairSeedOutputs(
      completed("lora", 7, "aa"),
      completed("nolora", 7, "bb"),
    );
    expect(pair).toEqual({
      comparable: true,
      seed: 7,
      identical: false,
      withHash: "aa",
      withoutHash: "bb",
    });
  });

  it("refuses to compare when seeds differ or either cell did not complete", () => {
    expect(
      pairSeedOutputs(completed("a", 1, "aa"), completed("b", 2, "aa")),
    ).toMatchObject({
      comparable: false,
    });
    const failed: CellRecord = {
      ...base,
      cellId: "f",
      seed: 7,
      status: "failed",
      reason: "boom",
      completedSamples: [],
    };
    expect(pairSeedOutputs(completed("a", 7, "aa"), failed)).toMatchObject({
      comparable: false,
    });
  });
});
