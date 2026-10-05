// Real-subprocess integration tests for the bounded lifecycle: each test
// spawns a tiny `bun -e` child (no network, no models) and exercises stop,
// SIGTERM->SIGKILL escalation, early exit, lifetime bound, output bound,
// late-output disposition and restart-to-ready cancellation timing.

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ManagedProcess,
  restartToReady,
  type SpawnManagedOptions,
  spawnManaged,
} from "./process";

const live: ManagedProcess[] = [];

function child(
  script: string,
  options: Partial<Omit<SpawnManagedOptions, "cmd">> = {},
): ManagedProcess {
  const proc = spawnManaged({
    cmd: [process.execPath, "-e", script],
    maxLifetimeMs: 10_000,
    stopGraceMs: 200,
    ...options,
  });
  live.push(proc);
  return proc;
}

const scratch: string[] = [];

afterEach(async () => {
  await Promise.all(live.splice(0).map((proc) => proc.stop()));
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const READY_SCRIPT = "console.log('ready'); setInterval(() => {}, 1000);";
const readyCheck = (proc: ManagedProcess) => () =>
  proc.output().stdout.includes("ready");

describe("spawnManaged readiness", () => {
  it("reports ready when the probe passes", async () => {
    const proc = child(READY_SCRIPT);
    const ready = await proc.waitReady(readyCheck(proc), {
      timeoutMs: 5_000,
      pollMs: 20,
    });
    expect(ready.status).toBe("ready");
  });

  it("reports timed-out when the probe never passes, without leaving the process unbounded", async () => {
    const proc = child("setInterval(() => {}, 1000);");
    const ready = await proc.waitReady(() => false, {
      timeoutMs: 150,
      pollMs: 20,
    });
    expect(ready.status).toBe("timed-out");
    const stopped = await proc.stop();
    expect(stopped.exit.reason).toBe("stopped");
  });

  it("reports exited (with the exit code) when the child dies before ready", async () => {
    const proc = child("process.exit(3);");
    const ready = await proc.waitReady(() => false, {
      timeoutMs: 5_000,
      pollMs: 20,
    });
    expect(ready).toMatchObject({ status: "exited", exitCode: 3 });
  });
});

describe("spawnManaged readiness after termination", () => {
  it("reports exited, not ready, when the child dies while a probe is in flight", async () => {
    const proc = child("process.exit(7);");
    const ready = await proc.waitReady(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return true;
      },
      { timeoutMs: 5_000, pollMs: 20 },
    );
    expect(ready).toMatchObject({ status: "exited", exitCode: 7 });
  });

  it("reports exited as soon as termination is observed, without waiting out the pipe drain", async () => {
    // A grandchild keeps stdout open, so the drain wait would last its full bound.
    const proc = child(
      "Bun.spawn([process.execPath, '-e', 'setTimeout(() => {}, 1500)'], { stdout: 'inherit', stderr: 'inherit' });" +
        "setTimeout(() => process.exit(7), 100);",
    );
    const ready = await proc.waitReady(() => false, {
      timeoutMs: 5_000,
      pollMs: 10,
    });
    expect(ready).toMatchObject({ status: "exited", exitCode: 7 });
    expect(ready.ms).toBeLessThan(450);
  });
});

describe("spawnManaged stop", () => {
  it("stops a cooperative child with SIGTERM and does not escalate", async () => {
    const proc = child(READY_SCRIPT);
    await proc.waitReady(readyCheck(proc), { timeoutMs: 5_000, pollMs: 20 });
    const stopped = await proc.stop();
    expect(stopped.escalatedToKill).toBe(false);
    expect(stopped.exit.reason).toBe("stopped");
    expect(stopped.exit.signalCode).toBe("SIGTERM");
    expect(stopped.exitedAfterMs).toBeGreaterThanOrEqual(0);
    expect(proc.state()).toBe("exited");
  });

  it("escalates to SIGKILL when SIGTERM is ignored", async () => {
    const proc = child(
      "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);",
      { stopGraceMs: 100 },
    );
    await proc.waitReady(readyCheck(proc), { timeoutMs: 5_000, pollMs: 20 });
    const stopped = await proc.stop();
    expect(stopped.escalatedToKill).toBe(true);
    expect(stopped.exit.reason).toBe("stopped");
    expect(stopped.exit.signalCode).toBe("SIGKILL");
    expect(stopped.exitedAfterMs).toBeGreaterThanOrEqual(90);
  });

  it("still reports stopped when the child exits zero in response to the stop request", async () => {
    const proc = child(
      "process.on('SIGTERM', () => process.exit(0)); console.log('ready'); setInterval(() => {}, 1000);",
    );
    await proc.waitReady(readyCheck(proc), { timeoutMs: 5_000, pollMs: 20 });
    const stopped = await proc.stop();
    expect(stopped.exit).toMatchObject({
      reason: "stopped",
      exitCode: 0,
      signalCode: null,
    });
  });

  it("reports a crash signal that is not one the stop sent as exited, even while a stop was requested", async () => {
    // A SIGTERM handler that aborts is a crash: the stop never sends SIGABRT.
    const proc = child(
      "process.on('SIGTERM', () => process.abort()); console.log('ready'); setInterval(() => {}, 1000);",
    );
    await proc.waitReady(readyCheck(proc), { timeoutMs: 5_000, pollMs: 20 });
    const stopped = await proc.stop();
    expect(stopped.exit).toMatchObject({
      reason: "exited",
      signalCode: "SIGABRT",
    });
  });

  it("keeps lifetime-exceeded ahead of stopped when the bound fires during a requested stop", async () => {
    const proc = child(
      "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);",
      { maxLifetimeMs: 200, stopGraceMs: 5_000 },
    );
    await proc.waitReady(readyCheck(proc), { timeoutMs: 5_000, pollMs: 20 });
    const stopped = await proc.stop();
    expect(stopped.escalatedToKill).toBe(false);
    expect(stopped.exit).toMatchObject({
      reason: "lifetime-exceeded",
      signalCode: "SIGKILL",
    });
  });

  it("keeps a genuine crash as exited when cleanup stop lands while its pipes are still draining", async () => {
    // The child hands its stdout to a grandchild and then aborts, so the
    // crash is real and exit is observed, but the pipes stay open and the
    // drain wait spans the stop request.
    const proc = child(
      "const gc = Bun.spawn([process.execPath, '-e', 'setTimeout(() => {}, 1500)'], { stdout: 'inherit', stderr: 'inherit' });" +
        "console.log('spawned ' + gc.pid); setTimeout(() => process.abort(), 50);",
    );
    await proc.waitReady(() => proc.output().stdout.includes("spawned"), {
      timeoutMs: 5_000,
      pollMs: 20,
    });
    // Reaped child => pid vanishes; exit has been observed or is imminent.
    for (let i = 0; i < 500; i++) {
      try {
        process.kill(proc.pid, 0);
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(proc.state()).not.toBe("exited");
    const stopped = await proc.stop();
    expect(stopped.exit).toMatchObject({
      reason: "exited",
      signalCode: "SIGABRT",
    });
    expect(stopped.escalatedToKill).toBe(false);
  });

  it("is idempotent once the process has exited", async () => {
    const proc = child("process.exit(0);");
    await proc.exited;
    const stopped = await proc.stop();
    expect(stopped.exit.exitCode).toBe(0);
    expect(stopped.escalatedToKill).toBe(false);
  });

  it("kills a child that outlives its maximum lifetime", async () => {
    const proc = child("setInterval(() => {}, 1000);", { maxLifetimeMs: 150 });
    const exit = await proc.exited;
    expect(exit.reason).toBe("lifetime-exceeded");
  });
});

describe("spawnManaged spawn failure", () => {
  const unspawnable = async (kind: "missing" | "not-executable") => {
    if (kind === "missing") {
      return join(tmpdir(), `art-local-2-missing-${process.pid}`, "sd-server");
    }
    const dir = mkdtempSync(join(tmpdir(), "art-local-2-noexec-"));
    scratch.push(dir);
    const path = join(dir, "sd-server");
    writeFileSync(path, "#!/bin/sh\n", { mode: 0o644 });
    return path;
  };

  for (const kind of ["missing", "not-executable"] as const) {
    it(`settles as failed with the error retained when the executable is ${kind}`, async () => {
      const proc = spawnManaged({
        cmd: [await unspawnable(kind)],
        maxLifetimeMs: 1_000,
      });
      live.push(proc);
      expect(proc.state()).toBe("exited");
      const exit = await proc.exited;
      expect(exit).toMatchObject({
        reason: "spawn-failed",
        exitCode: null,
        signalCode: null,
      });
      expect(proc.output().stderr).toMatch(/^spawn failed: \S+/);
      const ready = await proc.waitReady(() => true, { timeoutMs: 100 });
      expect(ready).toMatchObject({ status: "exited", exitCode: null });
      const stopped = await proc.stop();
      expect(stopped.exit.reason).toBe("spawn-failed");
      expect(stopped.escalatedToKill).toBe(false);
    });
  }
});

describe("spawnManaged output disposition", () => {
  it("caps retained output and flags truncation", async () => {
    const proc = child("process.stdout.write('x'.repeat(10000));", {
      maxOutputBytes: 100,
    });
    await proc.exited;
    const out = proc.output();
    expect(out.stdout.length).toBeLessThanOrEqual(100);
    expect(out.truncated).toBe(true);
  });

  it("counts output written after stop was requested as late and discards it", async () => {
    const proc = child(
      "process.on('SIGTERM', () => { process.stdout.write('late-result\\n'); setTimeout(() => process.exit(0), 50); });" +
        "console.log('ready'); setInterval(() => {}, 1000);",
    );
    await proc.waitReady(readyCheck(proc), { timeoutMs: 5_000, pollMs: 20 });
    const stopped = await proc.stop();
    expect(stopped.lateOutputBytes).toBeGreaterThanOrEqual(
      "late-result\n".length,
    );
    expect(proc.output().stdout).not.toContain("late-result");
    expect(proc.output().lateBytes).toBe(stopped.lateOutputBytes);
  });

  it("does not count pre-stop output as late", async () => {
    const proc = child(READY_SCRIPT);
    await proc.waitReady(readyCheck(proc), { timeoutMs: 5_000, pollMs: 20 });
    const stopped = await proc.stop();
    expect(stopped.lateOutputBytes).toBe(0);
    expect(proc.output().stdout).toContain("ready");
  });
});

describe("restartToReady", () => {
  it("measures abort-to-exit and restart-to-ready, and leaves the old process stopped", async () => {
    const first = child(READY_SCRIPT);
    await first.waitReady(readyCheck(first), { timeoutMs: 5_000, pollMs: 20 });
    const result = await restartToReady({
      current: first,
      respawn: () => child(READY_SCRIPT),
      isReady: (proc) => proc.output().stdout.includes("ready"),
      readyTimeoutMs: 5_000,
      pollMs: 20,
    });
    expect(first.state()).toBe("exited");
    expect(result.cancel.readiness).toBe("ready");
    expect(result.cancel.abortToExitMs).not.toBeNull();
    expect(result.cancel.restartToReadyMs).not.toBeNull();
    expect(result.cancel.totalCancelToReadyMs).toBeGreaterThanOrEqual(
      (result.cancel.abortToExitMs ?? 0) +
        (result.cancel.restartToReadyMs ?? 0) -
        5,
    );
    expect(result.cancel.totalCancelToReadyMs).toBeLessThanOrEqual(
      (result.cancel.abortToExitMs ?? 0) +
        (result.cancel.restartToReadyMs ?? 0) +
        50,
    );
    expect(result.process?.state()).toBe("running");
  });

  it("records null ready timing when the replacement never becomes ready", async () => {
    const first = child(READY_SCRIPT);
    await first.waitReady(readyCheck(first), { timeoutMs: 5_000, pollMs: 20 });
    const result = await restartToReady({
      current: first,
      respawn: () => child("setInterval(() => {}, 1000);"),
      isReady: () => false,
      readyTimeoutMs: 150,
      pollMs: 20,
    });
    expect(result.cancel.readiness).toBe("timed-out");
    expect(result.cancel.abortToExitMs).not.toBeNull();
    expect(result.cancel.restartToReadyMs).toBeNull();
    expect(result.cancel.totalCancelToReadyMs).toBeNull();
  });

  it("records exited when the replacement dies before ready", async () => {
    const first = child(READY_SCRIPT);
    await first.waitReady(readyCheck(first), { timeoutMs: 5_000, pollMs: 20 });
    const result = await restartToReady({
      current: first,
      respawn: () => child("process.exit(1);"),
      isReady: () => false,
      readyTimeoutMs: 5_000,
      pollMs: 20,
    });
    expect(result.cancel.readiness).toBe("exited");
    expect(result.cancel.totalCancelToReadyMs).toBeNull();
  });
});

describe("restartToReady idle evidence", () => {
  const idleOptions = (cpus: number[]) => {
    let i = 0;
    return {
      thresholdPercent: 5,
      timeoutMs: 1_000,
      pollMs: 5,
      read: async () => ({
        rssKb: 1,
        cpuPercent: cpus[Math.min(i++, cpus.length - 1)] ?? 0,
        processCount: 1,
      }),
    };
  };

  it("measures restart-to-idle from respawn and keeps the CPU readings", async () => {
    const first = child(READY_SCRIPT);
    await first.waitReady(readyCheck(first), { timeoutMs: 5_000, pollMs: 20 });
    const result = await restartToReady({
      current: first,
      respawn: () => child(READY_SCRIPT),
      isReady: (proc) => proc.output().stdout.includes("ready"),
      readyTimeoutMs: 5_000,
      pollMs: 20,
      idle: idleOptions([70, 40, 1]),
    });
    expect(result.cancel.idle).toBe("below-threshold");
    expect(result.cancel.idleThresholdPercent).toBe(5);
    expect(result.cancel.idleCpuEvidence.map((e) => e.cpuPercent)).toEqual([
      70, 40, 1,
    ]);
    expect(result.cancel.restartToIdleMs).toBeGreaterThanOrEqual(
      result.cancel.restartToReadyMs ?? Number.POSITIVE_INFINITY,
    );
  });

  it("takes the cancel-to-ready total at readiness, before the idle wait", async () => {
    const first = child(READY_SCRIPT);
    await first.waitReady(readyCheck(first), { timeoutMs: 5_000, pollMs: 20 });
    const result = await restartToReady({
      current: first,
      respawn: () => child(READY_SCRIPT),
      isReady: (proc) => proc.output().stdout.includes("ready"),
      readyTimeoutMs: 5_000,
      pollMs: 20,
      idle: {
        thresholdPercent: 5,
        timeoutMs: 2_000,
        pollMs: 5,
        read: async () => {
          await new Promise((resolve) => setTimeout(resolve, 400));
          return { rssKb: 1, cpuPercent: 1, processCount: 1 };
        },
      },
    });
    expect(result.cancel.idle).toBe("below-threshold");
    expect(result.cancel.restartToIdleMs).toBeGreaterThanOrEqual(400);
    expect(result.cancel.totalCancelToReadyMs).toBeLessThanOrEqual(
      (result.cancel.abortToExitMs ?? 0) +
        (result.cancel.restartToReadyMs ?? 0) +
        50,
    );
  });

  it("reports an idle timeout with null restartToIdleMs", async () => {
    const first = child(READY_SCRIPT);
    await first.waitReady(readyCheck(first), { timeoutMs: 5_000, pollMs: 20 });
    const result = await restartToReady({
      current: first,
      respawn: () => child(READY_SCRIPT),
      isReady: (proc) => proc.output().stdout.includes("ready"),
      readyTimeoutMs: 5_000,
      pollMs: 20,
      idle: { ...idleOptions([90]), timeoutMs: 40 },
    });
    expect(result.cancel.idle).toBe("timed-out");
    expect(result.cancel.restartToIdleMs).toBeNull();
  });

  it("does not attempt idle measurement when readiness failed", async () => {
    const first = child(READY_SCRIPT);
    await first.waitReady(readyCheck(first), { timeoutMs: 5_000, pollMs: 20 });
    const result = await restartToReady({
      current: first,
      respawn: () => child("setInterval(() => {}, 1000);"),
      isReady: () => false,
      readyTimeoutMs: 100,
      pollMs: 20,
      idle: idleOptions([1]),
    });
    expect(result.cancel.idle).toBe("not-measured");
  });
});
