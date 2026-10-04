// Behavior tests for the per-cell runner. The generator is an injected
// driver (no model, no network); the cancel-by-restart test uses real
// subprocesses. The sd-server wiring itself is intentionally absent until
// the release/routes research lands (see run.ts).

import { afterEach, describe, expect, it } from "bun:test";
import { type ComponentProvenance, hashBytes } from "./measure";
import { type ManagedProcess, restartToReady, spawnManaged } from "./process";
import { type ArmDriver, type RunCellInput, runCell } from "./run";

const availableComponent: ComponentProvenance = {
  available: true,
  role: "diffusion-model",
  id: "m",
  path: "/tmp/m.gguf",
  sha256: "a".repeat(64),
  sizeBytes: 1,
  declaredSha256: null,
  declaredHashMatches: null,
  license: "apache-2.0",
  source: null,
  quantization: "Q8_0",
};

function baseInput(
  driver: ArmDriver,
  overrides: Partial<RunCellInput> = {},
): RunCellInput {
  return {
    arm: "arm-a",
    cellId: "512x640",
    seed: 42,
    settings: { steps: 4, width: 512, height: 640, loraScale: 0.8 },
    components: [availableComponent],
    stagingGuidance: "stage weights under models/",
    warmupCount: 1,
    sampleCount: 3,
    timeoutMs: 5_000,
    driver,
    ...overrides,
  };
}

/** Driver on a fake clock: each generation advances time by the next duration. */
function fakeClock(durations: readonly number[]) {
  let t = 0;
  let call = 0;
  return {
    now: () => t,
    driver: {
      async generate() {
        t += durations[call] ?? 0;
        call += 1;
        return Uint8Array.from([call, call, call]);
      },
    } satisfies ArmDriver,
  };
}

describe("runCell completed", () => {
  it("keeps warmup apart from samples and summarises samples only", async () => {
    const clock = fakeClock([900, 30, 10, 20]);
    const record = await runCell(baseInput(clock.driver, { now: clock.now }));
    expect(record.status).toBe("completed");
    if (record.status !== "completed") return;
    expect(record.warmup.map((e) => e.wallMs)).toEqual([900]);
    expect(record.samples.map((e) => e.wallMs)).toEqual([30, 10, 20]);
    expect(record.timing.sampleCount).toBe(3);
    expect(record.timing.p50Ms).toBe(20);
    expect(record.timing.p95Ms).toBe(30);
    expect(record.timing.warmupMs).toEqual([900]);
  });

  it("retains seed, settings and components, and hashes output bytes", async () => {
    const clock = fakeClock([1, 1, 1, 1]);
    const received: { kind: string; index: number; bytes: Uint8Array }[] = [];
    const record = await runCell(
      baseInput(clock.driver, {
        now: clock.now,
        onOutput: (bytes, meta) => received.push({ ...meta, bytes }),
      }),
    );
    expect(record).toMatchObject({
      arm: "arm-a",
      cellId: "512x640",
      seed: 42,
      settings: { steps: 4, width: 512, height: 640, loraScale: 0.8 },
    });
    expect(record.components).toEqual([availableComponent]);
    if (record.status !== "completed") throw new Error("expected completed");
    // Call 1 was warmup (bytes [1,1,1]); samples are calls 2..4.
    expect(record.outputs.map((o) => o.sha256)).toEqual([
      hashBytes(Uint8Array.from([2, 2, 2])),
      hashBytes(Uint8Array.from([3, 3, 3])),
      hashBytes(Uint8Array.from([4, 4, 4])),
    ]);
    expect(record.outputs.every((o) => o.byteLength === 3)).toBe(true);
    expect(received.map((r) => r.kind)).toEqual([
      "warmup",
      "sample",
      "sample",
      "sample",
    ]);
  });

  it("reports peak RSS only when the driver measured it", async () => {
    const clock = fakeClock([1, 1, 1, 1]);
    const without = await runCell(baseInput(clock.driver, { now: clock.now }));
    expect(without.peakRssKb).toBeNull();
    const clock2 = fakeClock([1, 1, 1, 1]);
    const withRss = await runCell(
      baseInput(
        { ...clock2.driver, readPeakRssKb: () => 123_456 },
        { now: clock2.now },
      ),
    );
    expect(withRss.peakRssKb).toBe(123_456);
  });

  it("rejects nonsensical counts instead of producing an empty 'completed' record", async () => {
    const clock = fakeClock([]);
    await expect(
      runCell(baseInput(clock.driver, { sampleCount: 0 })),
    ).rejects.toThrow();
    await expect(
      runCell(baseInput(clock.driver, { warmupCount: -1 })),
    ).rejects.toThrow();
  });
});

describe("runCell unavailable", () => {
  it("never calls the driver and returns staging guidance with no timings", async () => {
    let calls = 0;
    const record = await runCell(
      baseInput(
        {
          async generate() {
            calls += 1;
            return Uint8Array.from([1]);
          },
        },
        {
          components: [
            availableComponent,
            {
              available: false,
              role: "lora",
              id: "lora-x",
              path: "/nope",
              declaredSha256: null,
              reason: "file not found",
            },
          ],
        },
      ),
    );
    expect(calls).toBe(0);
    expect(record.status).toBe("unavailable");
    if (record.status !== "unavailable") return;
    expect(record.missing).toEqual(["lora-x"]);
    expect(record.stagingGuidance).toBe("stage weights under models/");
    expect("timing" in record).toBe(false);
    expect("outputs" in record).toBe(false);
  });
});

describe("runCell failure and timeout", () => {
  it("records failure with only the raw samples that finished, and no summary", async () => {
    let call = 0;
    const record = await runCell(
      baseInput({
        async generate() {
          call += 1;
          if (call === 3) throw new Error("server returned 500");
          return Uint8Array.from([call]);
        },
      }),
    );
    expect(record.status).toBe("failed");
    if (record.status !== "failed") return;
    expect(record.reason).toContain("server returned 500");
    expect(record.completedSamples).toHaveLength(1); // warmup excluded, one sample done
    expect("timing" in record).toBe(false);
    expect("outputs" in record).toBe(false);
  });

  it("treats an empty result as a failure, not a completed sample", async () => {
    const record = await runCell(
      baseInput({
        async generate() {
          return new Uint8Array(0);
        },
      }),
    );
    expect(record.status).toBe("failed");
  });

  it("times out a hung generation, aborts the driver, and ignores its late result", async () => {
    let aborted = false;
    let release: (bytes: Uint8Array) => void = () => {};
    const record = await runCell(
      baseInput(
        {
          generate({ signal }) {
            signal.addEventListener("abort", () => {
              aborted = true;
              // The server answers anyway, after the deadline.
              setTimeout(() => release(Uint8Array.from([9, 9])), 5);
            });
            return new Promise<Uint8Array>((resolve) => {
              release = resolve;
            });
          },
        },
        { timeoutMs: 40, warmupCount: 0 },
      ),
    );
    expect(aborted).toBe(true);
    expect(record.status).toBe("timed-out");
    if (record.status !== "timed-out") return;
    expect(record.timeoutMs).toBe(40);
    expect(record.elapsedMs).toBeGreaterThanOrEqual(35);
    expect(record.completedSamples).toHaveLength(0);
    expect("timing" in record).toBe(false);
    expect("outputs" in record).toBe(false);
  });
});

describe("runCell cancellation", () => {
  it("records cancelled (never completed) and discards a late result", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const record = await runCell(
      baseInput(
        {
          generate({ signal }) {
            return new Promise<Uint8Array>((resolve) => {
              signal.addEventListener("abort", () => {
                // The server still answers after the abort.
                setTimeout(() => resolve(Uint8Array.from([7, 7, 7])), 5);
              });
            });
          },
        },
        { signal: controller.signal, warmupCount: 0, lateOutputGraceMs: 200 },
      ),
    );
    expect(record.status).toBe("cancelled");
    if (record.status !== "cancelled") return;
    expect(record.discardedLateOutputs).toBe(1);
    expect("outputs" in record).toBe(false);
    expect("timing" in record).toBe(false);
  });

  it("is cancelled without calling the driver when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const record = await runCell(
      baseInput(
        {
          async generate() {
            calls += 1;
            return Uint8Array.from([1]);
          },
        },
        { signal: controller.signal },
      ),
    );
    expect(calls).toBe(0);
    expect(record.status).toBe("cancelled");
  });
});

describe("runCell cancel-by-restart (real subprocesses)", () => {
  const live: ManagedProcess[] = [];
  afterEach(async () => {
    await Promise.all(live.splice(0).map((p) => p.stop()));
  });

  const spawnServer = () => {
    const proc = spawnManaged({
      cmd: [
        process.execPath,
        "-e",
        "console.log('ready'); setInterval(() => {}, 1000);",
      ],
      maxLifetimeMs: 10_000,
      stopGraceMs: 200,
    });
    live.push(proc);
    return proc;
  };

  it("attaches restart-to-ready timing to the cancelled record", async () => {
    const server = spawnServer();
    await server.waitReady(() => server.output().stdout.includes("ready"), {
      timeoutMs: 5_000,
      pollMs: 20,
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const record = await runCell(
      baseInput(
        { generate: () => new Promise<Uint8Array>(() => {}) },
        {
          signal: controller.signal,
          warmupCount: 0,
          onCancel: async () => {
            const restarted = await restartToReady({
              current: server,
              respawn: spawnServer,
              isReady: (p) => p.output().stdout.includes("ready"),
              readyTimeoutMs: 5_000,
              pollMs: 20,
            });
            return restarted.cancel;
          },
        },
      ),
    );
    expect(record.status).toBe("cancelled");
    if (record.status !== "cancelled") return;
    expect(record.cancel?.readiness).toBe("ready");
    expect(record.cancel?.totalCancelToReadyMs).not.toBeNull();
    expect(server.state()).toBe("exited");
  });
});

describe("runCell hash-mismatch gate", () => {
  it("blocks the arm (driver never called) when a component's bytes do not match its declared hash", async () => {
    let calls = 0;
    const record = await runCell(
      baseInput(
        {
          async generate() {
            calls += 1;
            return Uint8Array.from([1]);
          },
        },
        {
          components: [
            availableComponent,
            {
              ...availableComponent,
              id: "tampered",
              declaredSha256: "0".repeat(64),
              declaredHashMatches: false,
            },
          ],
        },
      ),
    );
    expect(calls).toBe(0);
    expect(record.status).toBe("unavailable");
    if (record.status !== "unavailable") return;
    expect(record.hashMismatches).toEqual(["tampered"]);
    expect(record.reason).toContain("hash mismatch");
    expect(record.reason).toContain("tampered");
  });
});

describe("runCell timeout stops the server, not just the request", () => {
  it("awaits onTimeout before returning and records its stop evidence", async () => {
    const order: string[] = [];
    const evidence = {
      stoppedAfterMs: 12,
      escalatedToKill: true,
      lateOutputBytes: 5,
      exitSignal: "SIGKILL",
    };
    const record = await runCell(
      baseInput(
        { generate: () => new Promise<Uint8Array>(() => {}) },
        {
          warmupCount: 0,
          timeoutMs: 30,
          onTimeout: async () => {
            await new Promise((r) => setTimeout(r, 20));
            order.push("stopped");
            return evidence;
          },
        },
      ),
    );
    order.push("returned");
    expect(order).toEqual(["stopped", "returned"]);
    expect(record.status).toBe("timed-out");
    if (record.status !== "timed-out") return;
    expect(record.serverStop).toEqual(evidence);
  });
});
