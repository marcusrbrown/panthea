// Process-tree RSS/CPU polling: pure ps parsing and tree summing, a real
// parent+grandchild process, the phase-labelled sampler, and idle waiting.

import { afterEach, describe, expect, it } from "bun:test";
import {
  createTreeSampler,
  parsePsOutput,
  readTreeUsage,
  type TreeUsage,
  treeUsage,
  waitForTreeIdle,
} from "./rss";

/** Polls for a condition instead of sleeping; fails at a 10 s bound. */
async function until(condition: () => boolean, what: string): Promise<void> {
  const giveUpAt = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > giveUpAt) throw new Error(`never happened: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

const PS = `
    1     0   9000  1.0
  100     1   2000  3.5
  101   100   4000 10.0
  102   101   8000  0.5
  200     1  50000 99.0
garbage line
  103   100   notnum 1.0
`;

describe("parsePsOutput", () => {
  it("parses pid/ppid/rss/cpu rows and skips malformed lines", () => {
    const rows = parsePsOutput(PS);
    expect(rows).toHaveLength(5);
    expect(rows[1]).toEqual({
      pid: 100,
      ppid: 1,
      rssKb: 2000,
      cpuPercent: 3.5,
    });
  });
});

describe("treeUsage", () => {
  const rows = parsePsOutput(PS);

  it("sums the root and all descendants, excluding unrelated processes", () => {
    expect(treeUsage(rows, 100)).toEqual({
      rssKb: 14_000,
      cpuPercent: 14,
      processCount: 3,
    });
  });

  it("returns null (not zero) when the root is gone", () => {
    expect(treeUsage(rows, 999)).toBeNull();
  });

  it("terminates on a parent cycle", () => {
    const cyclic = [
      { pid: 5, ppid: 6, rssKb: 10, cpuPercent: 0 },
      { pid: 6, ppid: 5, rssKb: 20, cpuPercent: 0 },
    ];
    expect(treeUsage(cyclic, 5)?.rssKb).toBe(30);
  });
});

describe("readTreeUsage (real processes)", () => {
  const spawned: { kill(): void; exited: Promise<number> }[] = [];
  const grandchildren: number[] = [];
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  // Teardown owns both processes: the parent forwards SIGTERM to its child.
  afterEach(async () => {
    for (const p of spawned.splice(0)) {
      p.kill();
      await p.exited;
    }
    for (const pid of grandchildren.splice(0)) {
      await until(() => !alive(pid), `grandchild ${pid} exits`);
    }
  });

  it("includes a grandchild's resident memory in the tree total", async () => {
    const grandchild =
      "const b = Buffer.alloc(120 * 1024 * 1024, 1); console.log('ready'); setInterval(() => b[0]++, 1000);";
    const parent = `let c; process.on('SIGTERM', () => { c?.kill(); process.exit(0); });
      c = Bun.spawn([process.execPath, '-e', ${JSON.stringify(grandchild)}], {stdout: 'pipe'});
      console.log(c.pid);
      const r = c.stdout.getReader(); await r.read(); console.log('ready'); setInterval(() => {}, 1000);`;
    const proc = Bun.spawn([process.execPath, "-e", parent], {
      stdout: "pipe",
      stderr: "ignore",
    });
    spawned.push(proc);
    const reader = proc.stdout.getReader();
    // The parent prints the grandchild's pid, then ready => grandchild is resident.
    let out = "";
    while (!out.includes("ready")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("parent exited before ready");
      out += new TextDecoder().decode(value);
      if (grandchildren.length === 0 && out.includes("\n")) {
        grandchildren.push(Number.parseInt(out, 10));
      }
    }
    const usage = await readTreeUsage(proc.pid);
    expect(usage).not.toBeNull();
    expect(usage?.processCount).toBeGreaterThanOrEqual(2);
    expect(usage?.rssKb).toBeGreaterThan(100 * 1024);
    // Root-only RSS is far smaller than the tree total.
    const rootOnly = Bun.spawnSync([
      "ps",
      "-o",
      "rss=",
      "-p",
      String(proc.pid),
    ]).stdout.toString();
    expect(usage?.rssKb).toBeGreaterThan(
      Number.parseInt(rootOnly.trim(), 10) + 90 * 1024,
    );

    // The one live-process test of the real sampler (default reader).
    const sampler = createTreeSampler({
      intervalMs: 20,
      rootPid: proc.pid,
      phase: "real",
    });
    try {
      await until(() => sampler.snapshot().sampleCount > 0, "a real reading");
    } finally {
      sampler.stop();
    }
    const evidence = sampler.snapshot();
    expect(evidence.byPhase.real?.sampleCount).toBeGreaterThan(0);
    expect(evidence.observedSampledPeakKb).toBeGreaterThan(100 * 1024);
  });

  it("returns null for a pid that does not exist", async () => {
    expect(await readTreeUsage(2_147_483_000)).toBeNull();
  });
});

describe("createTreeSampler", () => {
  it("records phase-labelled samples and an observed sampled peak with its caveat", async () => {
    const scripted: (TreeUsage | null)[] = [
      { rssKb: 100, cpuPercent: 1, processCount: 1 },
      { rssKb: 500, cpuPercent: 1, processCount: 1 },
      { rssKb: 300, cpuPercent: 1, processCount: 1 },
    ];
    let i = 0;
    const sampler = createTreeSampler({
      intervalMs: 5,
      rootPid: 42,
      phase: "startup",
      read: async () => scripted[Math.min(i++, scripted.length - 1)] ?? null,
    });
    await until(
      () => sampler.snapshot().byPhase.startup !== undefined,
      "a startup sample",
    );
    sampler.setPhase("restart");
    await until(
      () => sampler.snapshot().byPhase.restart !== undefined,
      "a restart sample",
    );
    const evidence = sampler.stop();
    expect(evidence.intervalMs).toBe(5);
    expect(evidence.semantics).toBe(
      "observed-sampled-peak-not-guaranteed-maximum",
    );
    expect(evidence.observedSampledPeakKb).toBe(500);
    expect(evidence.byPhase.startup?.sampleCount).toBeGreaterThan(0);
    expect(evidence.byPhase.restart?.sampleCount).toBeGreaterThan(0);
    expect(evidence.byPhase.startup?.observedSampledPeakKb).toBeLessThanOrEqual(
      500,
    );
    expect(evidence.sampleCount).toBe(
      Object.values(evidence.byPhase).reduce((n, p) => n + p.sampleCount, 0),
    );
  });

  it("reports a null peak (not 0) when nothing could be read", async () => {
    const sampler = createTreeSampler({
      intervalMs: 5,
      rootPid: 42,
      read: async () => null,
    });
    await new Promise((r) => setTimeout(r, 25));
    const evidence = sampler.stop();
    expect(evidence.sampleCount).toBe(0);
    expect(evidence.observedSampledPeakKb).toBeNull();
  });

  it("does not sample with no root pid, and stops sampling after stop()", async () => {
    let reads = 0;
    const sampler = createTreeSampler({
      intervalMs: 5,
      rootPid: null,
      read: async () => {
        reads += 1;
        return { rssKb: 1, cpuPercent: 0, processCount: 1 };
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(reads).toBe(0);
    sampler.setRoot(7);
    await until(() => reads > 0, "a reading once the root is set");
    sampler.stop();
    const after = reads;
    await new Promise((r) => setTimeout(r, 30));
    expect(reads).toBe(after);
    expect(after).toBeGreaterThan(0);
  });
});

describe("waitForTreeIdle", () => {
  const usage = (cpuPercent: number): TreeUsage => ({
    rssKb: 1,
    cpuPercent,
    processCount: 1,
  });

  it("returns once tree CPU drops below the threshold, with the readings", async () => {
    const cpus = [80, 60, 2];
    let i = 0;
    const result = await waitForTreeIdle(1, {
      thresholdPercent: 5,
      timeoutMs: 2_000,
      pollMs: 5,
      read: async () => usage(cpus[Math.min(i++, cpus.length - 1)] ?? 0),
    });
    expect(result.reason).toBe("below-threshold");
    expect(result.evidence.map((e) => e.cpuPercent)).toEqual([80, 60, 2]);
  });

  it("times out when CPU stays high", async () => {
    const result = await waitForTreeIdle(1, {
      thresholdPercent: 5,
      timeoutMs: 40,
      pollMs: 5,
      read: async () => usage(90),
    });
    expect(result.reason).toBe("timed-out");
    expect(result.afterMs).toBeGreaterThanOrEqual(35);
  });

  it("reports process-gone rather than idle when the tree disappears", async () => {
    const result = await waitForTreeIdle(1, {
      timeoutMs: 100,
      pollMs: 5,
      read: async () => null,
    });
    expect(result.reason).toBe("process-gone");
  });
});

describe("createTreeSampler snapshot", () => {
  it("returns cumulative evidence without stopping the sampler", async () => {
    const sampler = createTreeSampler({
      intervalMs: 5,
      rootPid: 1,
      phase: "a",
      read: async () => ({ rssKb: 10, cpuPercent: 0, processCount: 1 }),
    });
    await new Promise((r) => setTimeout(r, 30));
    const first = sampler.snapshot();
    expect(first.sampleCount).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 30));
    const second = sampler.snapshot();
    expect(second.sampleCount).toBeGreaterThan(first.sampleCount);
    sampler.stop();
  });
});
