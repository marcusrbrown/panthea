// Arm orchestration against the fake sd-server fixture: real subprocess
// start/stop/restart, real HTTP, real ps-based RSS sampling. Establishes
// harness mechanics only — no model, no real sd-server, no timing claims.

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ArmConfig, type ImageEvent, runArm } from "./arm";
import { fakeServerCmd, freePort, spawnFake } from "./fixtures/util";
import { hashBytes } from "./measure";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function weights(name: string, content = "weights"): string {
  const dir = mkdtempSync(join(tmpdir(), "art-local-2-arm-"));
  tempDirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

async function config(
  env: Record<string, string> = {},
  overrides: Partial<ArmConfig> = {},
  serverOverrides: Partial<ArmConfig["server"]> = {},
): Promise<ArmConfig> {
  const port = await freePort();
  return {
    arm: "fixture-arm",
    server: {
      cmd: fakeServerCmd(),
      baseUrl: `http://127.0.0.1:${port}`,
      env: { FAKE_PORT: String(port), ...env },
      readyTimeoutMs: 10_000,
      maxLifetimeMs: 30_000,
      stopGraceMs: 300,
      ...serverOverrides,
    },
    components: [],
    prompt: "a pixel hero",
    seed: 1234,
    sampleParams: { sample_steps: 4 },
    lora: {
      id: "lora-x",
      path: "/private/models/lora-x.safetensors",
      multiplier: 0.8,
    },
    cells: [
      { id: "512x640", width: 512, height: 640 },
      { id: "768x768", width: 768, height: 768 },
    ],
    warmupCount: 1,
    sampleCount: 2,
    timeoutMs: 5_000,
    pollMs: 10,
    stagingGuidance: "stage components per README",
    rssIntervalMs: 20,
    ...overrides,
  };
}

describe("runArm happy path", () => {
  it("runs each cell with-LoRA and as a no-LoRA control at the same seed, hashing image bytes", async () => {
    const images: ImageEvent[] = [];
    const report = await runArm(await config(), {
      onImage: (e) => images.push(e),
    });
    expect(report.cells.map((c) => `${c.cellId}`)).toEqual([
      "512x640:lora",
      "512x640:control",
      "768x768:lora",
      "768x768:control",
    ]);
    expect(report.cells.every((c) => c.status === "completed")).toBe(true);
    expect(report.cells.every((c) => c.seed === 1234)).toBe(true);
    // 4 runs x (1 warmup + 2 samples)
    expect(images).toHaveLength(12);
    for (const cell of report.cells) {
      if (cell.status !== "completed") throw new Error("expected completed");
      const sampleImages = images.filter(
        (i) =>
          `${i.cellId}:${i.variant}` === cell.cellId && i.kind === "sample",
      );
      expect(cell.outputs.map((o) => o.sha256)).toEqual(
        sampleImages.map((i) => hashBytes(i.bytes)),
      );
      expect(cell.settings).toMatchObject({
        lora: cell.cellId.endsWith(":lora") ? "lora-x" : "none",
      });
    }
    expect(report.pairings).toHaveLength(2);
    for (const pairing of report.pairings) {
      expect(pairing).toMatchObject({ comparable: true, identical: false });
    }
    expect(report.capabilities?.cancelGenerating).toBe(false);
    expect(report.servers).toHaveLength(1);
    expect(report.servers[0]?.startupStatus).toBe("ready");
    expect(report.servers[0]?.readyMs).toBeGreaterThan(0);
    expect(report.host.metalVerified).toBe(false);
  });

  it("records sampled resident evidence with startup and per-cell phases", async () => {
    // The sampler can only see what is still resident when it looks, so the
    // fixture holds its 60 MiB (resident before it listens), waits 500 ms before
    // it listens, and each job runs 400 ms: the startup phase and every cell
    // phase last far longer than a sampling tick (20 ms plus one `ps`, which took
    // up to 40 ms on a loaded ten-core machine), so each phase gets several
    // samples however slow `ps` is. One cell with no warmup keeps the run short;
    // it still has a startup phase and a with-LoRA and a control phase.
    const report = await runArm(
      await config(
        {
          FAKE_ALLOC_MB: "60",
          FAKE_JOB_MS: "400",
          FAKE_READY_DELAY_MS: "500",
        },
        {
          cells: [{ id: "512x640", width: 512, height: 640 }],
          warmupCount: 0,
          sampleCount: 1,
        },
      ),
    );
    expect(report.resident?.semantics).toBe(
      "observed-sampled-peak-not-guaranteed-maximum",
    );
    expect(
      report.resident?.observedSampledPeakKb,
      `resident evidence: ${JSON.stringify(report.resident)}`,
    ).toBeGreaterThan(50 * 1024);
    expect(Object.keys(report.resident?.byPhase ?? {})).toContain("startup");
    expect(
      Object.keys(report.resident?.byPhase ?? {}).some((p) =>
        p.startsWith("cell:"),
      ),
    ).toBe(true);
    const first = report.cells[0];
    expect(first?.peakRssKb).not.toBeNull();
  });
});

describe("runArm blocked arms", () => {
  it("reports every cell unavailable with staging guidance and never starts the server when a component is missing", async () => {
    const report = await runArm(
      await config(
        {},
        {
          components: [
            {
              role: "diffusion-model",
              id: "m",
              path: join(tmpdir(), "art-local-2-nope.gguf"),
            },
          ],
        },
      ),
    );
    expect(report.cells).toHaveLength(4);
    for (const cell of report.cells) {
      expect(cell.status).toBe("unavailable");
      if (cell.status === "unavailable")
        expect(cell.stagingGuidance).toContain("README");
    }
    expect(report.servers).toHaveLength(0);
  });

  it("blocks the arm on a hash mismatch between declared and actual bytes", async () => {
    const path = weights("m.gguf");
    const report = await runArm(
      await config(
        {},
        {
          components: [
            {
              role: "diffusion-model",
              id: "m",
              path,
              declared: { sha256: "0".repeat(64) },
            },
          ],
        },
      ),
    );
    expect(report.cells).toHaveLength(4);
    expect(report.cells.every((c) => c.status === "unavailable")).toBe(true);
    expect(report.servers).toHaveLength(0);
  });

  it("blocks the arm when the server binary hash does not match", async () => {
    const path = weights("sd-server");
    const report = await runArm(
      await config(
        {},
        {},
        {
          binary: {
            role: "binary",
            id: "sd-server",
            path,
            declared: { sha256: "f".repeat(64) },
          },
        },
      ),
    );
    expect(report.cells).toHaveLength(4);
    expect(report.cells.every((c) => c.status === "unavailable")).toBe(true);
    expect(report.servers).toHaveLength(0);
  });
});

describe("runArm server failures", () => {
  it("records failed cells (no timings) when the server never becomes ready, and stops it", async () => {
    const cfg = await config(
      { FAKE_READY_DELAY_MS: "8000" },
      {},
      { readyTimeoutMs: 300 },
    );
    const report = await runArm(cfg);
    expect(report.cells).toHaveLength(4);
    expect(report.cells.every((c) => c.status === "failed")).toBe(true);
    expect(report.servers[0]?.startupStatus).toBe("timed-out");
    expect(report.servers[0]?.exit?.reason).toBe("stopped");
    expect(
      await fetch(`${cfg.server.baseUrl}/sdcpp/v1/capabilities`).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  });

  it("records failed cells when the server exits before ready", async () => {
    const report = await runArm(
      await config(
        {},
        {},
        { cmd: [process.execPath, "-e", "process.exit(7)"] },
      ),
    );
    expect(report.cells).toHaveLength(4);
    expect(report.cells.every((c) => c.status === "failed")).toBe(true);
    expect(report.servers[0]).toMatchObject({
      startupStatus: "exited",
      exit: { exitCode: 7 },
    });
  });
});

describe("runArm timeout stops the server process", () => {
  it("kills the subprocess on timeout, publishes no output, discards late stdout and restarts for the next run", async () => {
    const images: ImageEvent[] = [];
    const cfg = await config(
      { FAKE_JOB_MS: "30000", FAKE_LATE_STDOUT: "1" },
      {
        timeoutMs: 300,
        warmupCount: 0,
        sampleCount: 1,
        cells: [{ id: "c", width: 512, height: 640 }],
      },
    );
    const report = await runArm(cfg, { onImage: (e) => images.push(e) });
    expect(report.cells.map((c) => c.status)).toEqual([
      "timed-out",
      "timed-out",
    ]);
    for (const cell of report.cells) {
      if (cell.status !== "timed-out") throw new Error("expected timed-out");
      expect(cell.serverStop?.escalatedToKill).toBe(false);
      expect(cell.serverStop?.lateOutputBytes).toBeGreaterThanOrEqual(
        "late-result\n".length,
      );
      expect("outputs" in cell).toBe(false);
    }
    expect(images).toHaveLength(0);
    // One server per run: the second run needed a restart.
    expect(report.servers.length).toBe(2);
    expect(
      report.servers.every((s) => !s.logTail.includes("late-result")),
    ).toBe(true);
    expect(
      report.servers.every((s) => s.lateOutputBytes >= "late-result\n".length),
    ).toBe(true);
    // Nothing is left listening.
    expect(
      await fetch(`${cfg.server.baseUrl}/sdcpp/v1/capabilities`).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  });
});

describe("runArm timeout escalation", () => {
  it("escalates to SIGKILL when the server ignores SIGTERM", async () => {
    const cfg = await config(
      { FAKE_JOB_MS: "30000", FAKE_IGNORE_SIGTERM: "1" },
      {
        timeoutMs: 300,
        warmupCount: 0,
        sampleCount: 1,
        lora: null,
        cells: [{ id: "c", width: 512, height: 640 }],
      },
    );
    const report = await runArm(cfg);
    const cell = report.cells[0];
    if (cell?.status !== "timed-out") throw new Error("expected timed-out");
    expect(cell.serverStop).toMatchObject({
      escalatedToKill: true,
      exitSignal: "SIGKILL",
    });
    expect(
      await fetch(`${cfg.server.baseUrl}/sdcpp/v1/capabilities`).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  });
});

describe("runArm cancel probe", () => {
  it("aborts an in-flight job by restarting the server and records abort-to-exit, restart-to-ready and idle evidence", async () => {
    // Every launch waits 500 ms before it listens, the replacement included, so
    // the restart phase (abort to ready) spans many sampler ticks: a tick is
    // 20 ms plus one `ps`, and a phase of 100 ms or so is missed whenever `ps` is
    // slow, which left no "restart" samples for the assertion below.
    const cfg = await config(
      { FAKE_JOB_MS: "30000", FAKE_READY_DELAY_MS: "500" },
      {
        cells: [],
        cancelProbe: {
          afterMs: 150,
          cell: { id: "probe", width: 512, height: 640 },
        },
        idle: { thresholdPercent: 50, timeoutMs: 5_000 },
      },
    );
    const report = await runArm(cfg);
    const probe = report.cancelProbe;
    expect(probe?.status).toBe("cancelled");
    if (probe?.status !== "cancelled") return;
    expect(probe.cancel?.readiness).toBe("ready");
    expect(probe.cancel?.abortToExitMs).not.toBeNull();
    expect(probe.cancel?.restartToReadyMs).not.toBeNull();
    expect(probe.cancel?.idle).not.toBe("not-measured");
    expect(probe.cancel?.idleCpuEvidence.length).toBeGreaterThan(0);
    expect("outputs" in probe).toBe(false);
    expect(Object.keys(report.resident?.byPhase ?? {})).toContain("restart");
    expect(report.servers).toHaveLength(2);
  });
});

describe("runArm unspawnable server", () => {
  it("records failed cells and a failed server run with the spawn error instead of throwing", async () => {
    const missing = join(
      tmpdir(),
      `art-local-2-missing-${process.pid}`,
      "sd-server",
    );
    const report = await runArm(
      await config({}, { cancelProbe: undefined }, { cmd: [missing] }),
    );
    expect(report.cells).toHaveLength(4);
    for (const cell of report.cells) {
      expect(cell).toMatchObject({
        status: "failed",
        reason: "generator server did not become ready",
      });
    }
    expect(report.servers.length).toBeGreaterThan(0);
    for (const server of report.servers) {
      expect(server).toMatchObject({
        startupStatus: "exited",
        exit: { reason: "spawn-failed", exitCode: null, signalCode: null },
      });
      expect(server.logTail).toMatch(/^spawn failed: /);
    }
  });
});

describe("runArm occupied endpoint", () => {
  it("refuses an endpoint something else already serves: no server tracked, nothing generated", async () => {
    const cfg = await config(
      {},
      {},
      { cmd: [process.execPath, "-e", "process.exit(7)"] },
    );
    const port = Number(new URL(cfg.server.baseUrl).port);
    const occupant = spawnFake(port);
    try {
      const up = await occupant.waitReady(
        async () =>
          (await fetch(`${cfg.server.baseUrl}/sdcpp/v1/capabilities`)).ok,
        { timeoutMs: 10_000, pollMs: 20 },
      );
      expect(up.status).toBe("ready");

      const images: ImageEvent[] = [];
      const report = await runArm(cfg, { onImage: (e) => images.push(e) });
      expect(report.cells).toHaveLength(4);
      for (const cell of report.cells) {
        expect(cell).toMatchObject({ status: "failed" });
        if (cell.status === "failed") {
          expect(cell.reason).toMatch(/already (answers|serving|in use)/);
        }
      }
      expect(report.servers).toEqual([]);
      expect(images).toEqual([]);
    } finally {
      await occupant.stop();
    }
  });
});
