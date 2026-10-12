// Criterion c: peak memory with Blender alone (P1), sd-server loaded and idle
// (P2), and Blender rendering beside the live idle sd-server (P3). Sampling is
// tick-based on the injected clock; the kernel's lifetime peak backs it up.

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SELECTED_PROFILE } from "../../../../packages/assets/src/studio/provider";
import type { RunCommand } from "../../coexistence/src/sample";
import { systemClock } from "../../studio-headroom/src/run";
import { blenderArgv, colourFrames, pickEnv, savedEnvKeys } from "./blender";
import { STAGING, sha256, stage, writeResult } from "./cmd-render";
import { BLENDER, ensureDir, mainCheckout, RUNS } from "./paths";
import {
  isGone,
  launchOwned,
  type OwnedChild,
  signalGroup,
  until,
} from "./proc";
import {
  lifetimeFootprintMiB,
  type PhaseSummary,
  sampleLoop,
  summarise,
  type Tick,
} from "./sampler";

const clock = systemClock;
const INTERVAL_MS = 250;
const PORT = 52611;
const IDLE_MS = 20_000;
const SD_SERVER_SHA =
  "37fa5c1dfa673262abdf8ba0b9294144c7d666dbec40e688a1596d975fe57cae";

const ROLE_FLAGS: Record<string, string> = {
  "diffusion-model": "--diffusion-model",
  "text-encoder": "--llm",
  vae: "--vae",
};

/** The profile's component flags and files, as `openRuntime` builds them (it keeps its own copy of the role table). */
function componentArgs(artifactRoot: string): string[] {
  return SELECTED_PROFILE.components.flatMap((c) => [
    ROLE_FLAGS[c.role] as string,
    join(artifactRoot, c.file),
  ]);
}

const run: RunCommand = (command) => {
  const [exe, ...args] = command;
  if (!exe) return undefined;
  const result = spawnSync(exe, args, { encoding: "utf8" });
  return result.status === 0 && result.stdout.length > 0
    ? result.stdout
    : undefined;
};

function sysctl(name: string): string | undefined {
  return run(["sysctl", "-n", name])?.trim();
}

/** Footprint reader control: a known allocation must show up in both readers. */
export async function memoryControl(): Promise<void> {
  const MiB = 1024 * 1024;
  const before = takeOwn();
  const ffiBefore = await lifetimeFootprintMiB(process.pid);
  const block = new Uint8Array(256 * MiB);
  block.fill(1);
  await clock.sleep(300);
  const after = takeOwn();
  const ffiAfter = await lifetimeFootprintMiB(process.pid);
  writeResult("memory-control", {
    allocatedMiB: 256,
    footprintToolMiB: { before, after, rise: after - before },
    rusageV4: { before: ffiBefore, after: ffiAfter },
    stillHeld: block[block.length - 1],
  });
}

function takeOwn(): number {
  const text = run(["footprint", "-p", String(process.pid)]);
  const match = text ? /Footprint:\s+([\d.]+)\s*(KB|MB|GB)/.exec(text) : null;
  if (!match) return Number.NaN;
  const v = Number(match[1]);
  return match[2] === "KB" ? v / 1024 : match[2] === "GB" ? v * 1024 : v;
}

async function stopGroupAndWait(
  child: OwnedChild,
): Promise<{ termMs: number | null; neededKill: boolean }> {
  const start = clock.now();
  signalGroup(child, "SIGTERM");
  if (await until(() => isGone(child), 2000, clock))
    return { termMs: Math.round(clock.now() - start), neededKill: false };
  signalGroup(child, "SIGKILL");
  await until(() => isGone(child), 10_000, clock);
  return { termMs: null, neededKill: true };
}

interface PhaseOutcome {
  readonly name: string;
  readonly summary: PhaseSummary;
  readonly aborted: boolean;
  readonly ticks: readonly Tick[];
}

/** Render the slot with Blender while sampling `extra` processes too. */
async function blenderPhase(
  name: string,
  extra: () => { label: string; pid: number }[],
  abortAll: () => void,
): Promise<
  PhaseOutcome & {
    exitCode: number | null;
    complete: boolean;
    blenderSelf?: unknown;
  }
> {
  const out = join(RUNS, name);
  rmSync(out, { recursive: true, force: true });
  ensureDir(out);
  const launched = await launchOwned(
    BLENDER,
    blenderArgv("slot", [
      "--models",
      STAGING,
      "--out",
      out,
      "--clip",
      "walk16",
      "--facing",
      "south",
    ]),
    pickEnv(savedEnvKeys()),
    clock,
  );
  if (!launched.ok) throw new Error(launched.reason);
  const child = launched.child;
  let aborted = false;
  const ticks = await sampleLoop({
    run,
    clock,
    intervalMs: INTERVAL_MS,
    targets: () => [{ label: "blender", pid: child.pid }, ...extra()],
    stop: () => child.closed || aborted,
    onTick: (tick) => {
      if (tick.pressureLevel !== undefined && tick.pressureLevel >= 4) {
        aborted = true;
        signalGroup(child, "SIGKILL");
        abortAll();
      }
    },
  });
  await until(() => isGone(child), 15_000, clock);
  let blenderSelf: unknown;
  const metaPath = join(out, "probe-meta.json");
  if (existsSync(metaPath))
    blenderSelf = (
      JSON.parse(await Bun.file(metaPath).text()) as { rusage?: unknown }
    ).rusage;
  return {
    name,
    summary: summarise(ticks),
    aborted,
    ticks,
    exitCode: child.exitCode,
    blenderSelf,
    complete: colourFrames(join(out, "render/zeus-tall/toon")).length === 16,
  };
}

export async function memoryStep(): Promise<void> {
  if (!existsSync(STAGING)) stage(STAGING);
  const main = mainCheckout();
  const art = join(main, "tools/probes/art-local-2");
  const sdBinary = join(art, "bin/release/sd-server");
  const baseline = {
    physicalBytes: Number(sysctl("hw.memsize")),
    pressureLevel: Number(sysctl("kern.memorystatus_vm_pressure_level")),
    swap: run(["sysctl", "vm.swapusage"])?.trim(),
    memoryPressureTool: run(["memory_pressure"])
      ?.split("\n")
      .slice(-3)
      .join(" ")
      .trim(),
  };
  writeResult("memory-baseline", baseline);

  // P1: Blender alone.
  const p1 = await blenderPhase(
    "mem-p1-blender-alone",
    () => [],
    () => {},
  );
  writeResult("memory-p1", p1);
  if (p1.summary.sawCritical) {
    writeResult("memory", { stoppedAtCritical: "P1", baseline, p1 });
    return;
  }

  // P2: sd-server loaded and idle.
  const profileArgs = [
    "--listen-ip",
    "127.0.0.1",
    "--listen-port",
    String(PORT),
    ...componentArgs(art),
    ...SELECTED_PROFILE.serverFlags,
  ];
  const binarySha = sha256(sdBinary);
  const sd = await launchOwned(sdBinary, profileArgs, {}, clock);
  if (!sd.ok) {
    writeResult("memory", { sdServerLaunch: sd.reason, baseline, p1 });
    return;
  }
  const sdChild = sd.child;
  const startedAt = clock.now();
  const abortAll = () => signalGroup(sdChild, "SIGKILL");
  let ready = false;
  const readyDeadline = startedAt + 180_000;
  const startupTicks: Tick[] = [];
  let startupCritical = false;
  const startupLoop = sampleLoop({
    run,
    clock,
    intervalMs: INTERVAL_MS,
    targets: () => [{ label: "sd-server", pid: sdChild.pid }],
    stop: () =>
      ready || sdChild.exited || startupCritical || clock.now() > readyDeadline,
    onTick: (t) => {
      startupTicks.push(t);
      if ((t.pressureLevel ?? 0) >= 4) {
        startupCritical = true;
        signalGroup(sdChild, "SIGKILL");
      }
    },
  });
  while (!sdChild.exited && !startupCritical && clock.now() < readyDeadline) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${PORT}/sdcpp/v1/capabilities`,
        { signal: AbortSignal.timeout(2000) },
      );
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // not listening yet
    }
    await clock.sleep(250);
  }
  ready = ready || sdChild.exited || startupCritical;
  await startupLoop;
  const readyMs = Math.round(clock.now() - startedAt);
  if (sdChild.exited || startupCritical) {
    const gone = await stopGroupAndWait(sdChild);
    writeResult("memory", {
      sdServerNotReady: true,
      startupCritical,
      exitCode: sdChild.exitCode,
      stderrTail: sdChild.stderr.slice(-800),
      gone,
      baseline,
      p1,
    });
    return;
  }
  const idleStart = clock.now();
  let idleAborted = false;
  const idleTicks = await sampleLoop({
    run,
    clock,
    intervalMs: INTERVAL_MS,
    targets: () => [{ label: "sd-server", pid: sdChild.pid }],
    stop: () =>
      clock.now() - idleStart >= IDLE_MS || idleAborted || sdChild.exited,
    onTick: (t) => {
      if ((t.pressureLevel ?? 0) >= 4) {
        idleAborted = true;
        signalGroup(sdChild, "SIGKILL");
      }
    },
  });
  const p2 = {
    summary: summarise(idleTicks),
    startup: summarise(startupTicks),
    readyMs,
    aborted: idleAborted,
  };
  writeResult("memory-p2", p2);

  // P3: Blender renders with sd-server live and idle.
  let p3: Awaited<ReturnType<typeof blenderPhase>> | undefined;
  let lifetime: Awaited<ReturnType<typeof lifetimeFootprintMiB>>;
  let stopInfo: Awaited<ReturnType<typeof stopGroupAndWait>>;
  try {
    p3 = idleAborted
      ? undefined
      : await blenderPhase(
          "mem-p3-blender-with-sd-server",
          () =>
            sdChild.exited ? [] : [{ label: "sd-server", pid: sdChild.pid }],
          abortAll,
        );
    lifetime = sdChild.exited
      ? undefined
      : await lifetimeFootprintMiB(sdChild.pid);
  } finally {
    stopInfo = await stopGroupAndWait(sdChild);
  }
  const result = {
    baseline,
    sdServer: {
      binarySha256: binarySha,
      matchesProfilePin: binarySha === SD_SERVER_SHA,
      args: "SELECTED_PROFILE components and serverFlags (paths omitted)",
      readyMs,
      lifetimePeakFootprintMiBAtEndOfP3: lifetime,
      stop: stopInfo,
    },
    p1: { ...p1, ticks: undefined, tickCount: p1.ticks.length },
    p2,
    p3: p3 ? { ...p3, ticks: undefined, tickCount: p3.ticks.length } : null,
    intervalMs: INTERVAL_MS,
    neverCritical:
      !p1.summary.sawCritical &&
      !(p3?.summary.sawCritical ?? false) &&
      !p2.summary.sawCritical &&
      !p2.startup.sawCritical,
  };
  writeResult("memory", result);
  writeResult("memory-ticks", {
    p1: p1.ticks,
    p2: idleTicks,
    p3: p3?.ticks ?? [],
  });
}

/**
 * Added after the first run showed sd-server holds almost nothing until its first
 * generation (not preregistered; reported as an addition). One real generation at the
 * profile's production size loads the weights; then the server idles, and Blender
 * renders beside it. Stops on critical pressure only. (A first attempt also stopped on
 * low free swap; macOS grows swap on demand, so that guard fired at 3.5 s into the
 * generation without a pressure change, and it was removed.)
 */
export async function memoryLoadedStep(): Promise<void> {
  if (!existsSync(STAGING)) stage(STAGING);
  const art = join(mainCheckout(), "tools/probes/art-local-2");
  const sdBinary = join(art, "bin/release/sd-server");
  const args = [
    "--listen-ip",
    "127.0.0.1",
    "--listen-port",
    String(PORT),
    ...componentArgs(art),
    ...SELECTED_PROFILE.serverFlags,
  ];
  const baseline = {
    pressureLevel: Number(sysctl("kern.memorystatus_vm_pressure_level")),
    swap: run(["sysctl", "vm.swapusage"])?.trim(),
  };
  const sd = await launchOwned(sdBinary, args, {}, clock);
  if (!sd.ok) throw new Error(sd.reason);
  const sdChild = sd.child;
  let abortReason: string | undefined;
  const guard = (t: Tick) => {
    if ((t.pressureLevel ?? 0) >= 4) abortReason = "critical-pressure";
    if (abortReason !== undefined) signalGroup(sdChild, "SIGKILL");
  };
  const phases: Record<string, { summary: PhaseSummary; ticks: Tick[] }> = {};
  const record = (name: string, ticks: Tick[]) => {
    phases[name] = { summary: summarise(ticks), ticks };
  };
  let result: Record<string, unknown> = { baseline };
  try {
    const readyBy = clock.now() + 180_000;
    for (;;) {
      if (sdChild.exited || clock.now() > readyBy)
        throw new Error("sd-server not ready");
      try {
        const response = await fetch(
          `http://127.0.0.1:${PORT}/sdcpp/v1/capabilities`,
          { signal: AbortSignal.timeout(2000) },
        );
        if (response.ok) break;
      } catch {
        // not listening yet
      }
      await clock.sleep(250);
    }
    // L1: one real generation at the production size.
    const body = {
      prompt: "a standing figure in a robe, flat colours",
      negative_prompt: "blurry",
      width: 512,
      height: 640,
      seed: 0,
      batch_count: 1,
      sample_params: {
        sample_method: "euler",
        sample_steps: 8,
        guidance: { txt_cfg: 1 },
      },
      lora: [],
      output_format: "png",
    };
    let generationDone = false;
    let generationStatus = "unknown";
    const generationStart = clock.now();
    const gen = (async () => {
      const submitted = await fetch(
        `http://127.0.0.1:${PORT}/sdcpp/v1/img_gen`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const accepted = (await submitted.json()) as { id?: string };
      for (;;) {
        if (
          abortReason !== undefined ||
          clock.now() - generationStart > 300_000
        )
          break;
        const polled = (await (
          await fetch(`http://127.0.0.1:${PORT}/sdcpp/v1/jobs/${accepted.id}`)
        ).json()) as { status?: string };
        generationStatus = String(polled.status);
        if (
          polled.status === "completed" ||
          polled.status === "failed" ||
          polled.status === "cancelled"
        )
          break;
        await clock.sleep(200);
      }
      generationDone = true;
    })();
    const l1 = await sampleLoop({
      run,
      clock,
      intervalMs: INTERVAL_MS,
      targets: () => [{ label: "sd-server", pid: sdChild.pid }],
      stop: () => generationDone || abortReason !== undefined || sdChild.exited,
      onTick: guard,
    });
    await gen.catch(() => undefined);
    record("L1-generation", l1);
    result = {
      ...result,
      generation: {
        status: generationStatus,
        ms: Math.round(clock.now() - generationStart),
      },
    };
    if (abortReason === undefined && !sdChild.exited) {
      // L2: loaded and idle.
      const idleStart = clock.now();
      const l2 = await sampleLoop({
        run,
        clock,
        intervalMs: INTERVAL_MS,
        targets: () => [{ label: "sd-server", pid: sdChild.pid }],
        stop: () =>
          clock.now() - idleStart >= IDLE_MS ||
          abortReason !== undefined ||
          sdChild.exited,
        onTick: guard,
      });
      record("L2-loaded-idle", l2);
    }
    if (abortReason === undefined && !sdChild.exited) {
      const p3 = await blenderPhase(
        "mem-l3-blender-with-loaded-sd-server",
        () =>
          sdChild.exited ? [] : [{ label: "sd-server", pid: sdChild.pid }],
        () => signalGroup(sdChild, "SIGKILL"),
      );
      record("L3-blender-beside-loaded-sd-server", [...p3.ticks]);
      result = {
        ...result,
        l3: {
          exitCode: p3.exitCode,
          complete: p3.complete,
          blenderSelf: p3.blenderSelf,
        },
      };
    }
    result = {
      ...result,
      sdServerLifetimePeak: sdChild.exited
        ? undefined
        : await lifetimeFootprintMiB(sdChild.pid),
    };
  } finally {
    const stop = await stopGroupAndWait(sdChild);
    result = {
      ...result,
      abortReason,
      stop,
      sdServerStderrTail: sdChild.stderr.slice(-400),
    };
  }
  writeResult("memory-loaded", {
    ...result,
    phases: Object.fromEntries(
      Object.entries(phases).map(([k, v]) => [
        k,
        { ...v.summary, tickCount: v.ticks.length },
      ]),
    ),
    intervalMs: INTERVAL_MS,
  });
  writeResult(
    "memory-loaded-ticks",
    Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, v.ticks])),
  );
}
