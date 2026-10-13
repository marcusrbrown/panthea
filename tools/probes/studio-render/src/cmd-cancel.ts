// Criterion b: SIGINT, SIGTERM and SIGKILL sent to the process group mid-render,
// with a harness control (a group that ignores TERM must be seen surviving it).

import {
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { systemClock } from "../../studio-headroom/src/run";
import { blenderArgv, colourFrames, pickEnv, savedEnvKeys } from "./blender";
import { listFiles, STAGING, stage, writeResult } from "./cmd-render";
import { BLENDER, ensureDir, RUNS } from "./paths";
import { describePng } from "./png";
import {
  groupMembers,
  isGone,
  launchOwned,
  pidsWithArgv,
  signalGroup,
  until,
} from "./proc";

const BOUND_MS = 12_000;
const TERM_GRACE_MS = 2_000;
const clock = systemClock;

type Signal = "SIGINT" | "SIGTERM" | "SIGKILL";

interface Trial {
  readonly signal: Signal;
  readonly trial: number;
  readonly framesAtSignal: number;
  readonly signalledMidRender: boolean;
  readonly latencyToGoneMs: number | null;
  readonly withinBound: boolean;
  readonly exitCode: number | null;
  readonly exitSignal: string | null;
  readonly groupMembersAfterGone: number[];
  readonly processesNamingOutputDir: number[];
  readonly filesLeft: number;
  readonly zeroLengthFiles: string[];
  readonly unparsablePngs: string[];
  readonly tempNamedFiles: string[];
  readonly colourFramesOnDisk: number;
  readonly sentinelPresent: boolean;
  readonly stdoutTail: string;
}

async function oneTrial(signal: Signal, trial: number): Promise<Trial> {
  const out = join(RUNS, `cancel-${signal}-${trial}`);
  rmSync(out, { recursive: true, force: true });
  ensureDir(out);
  const colourDir = join(out, "render/zeus-tall/toon");
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
  const begun = clock.now();
  let framesAtSignal = 0;
  let sentAt: number | undefined;
  let signalledMidRender = false;
  while (!child.closed && clock.now() - begun < 300_000) {
    framesAtSignal = colourFrames(colourDir).length;
    if (framesAtSignal >= 3) {
      sentAt = clock.now();
      signalledMidRender = framesAtSignal < 16 && !child.exited;
      signalGroup(child, signal);
      break;
    }
    await clock.sleep(10);
  }
  let latency: number | null = null;
  if (sentAt !== undefined) {
    const gone = await until(() => isGone(child), 20_000, clock);
    latency = gone ? Math.round(clock.now() - sentAt) : null;
    if (!gone) signalGroup(child, "SIGKILL");
  }
  await until(() => isGone(child), 15_000, clock);
  await clock.sleep(1000);
  const files = listFiles(out);
  const zero = files
    .filter((f) => statSync(f).size === 0)
    .map((f) => f.slice(out.length + 1));
  const temp = files
    .filter((f) => /\.tmp$|\.tmp\.|~$|#/.test(f))
    .map((f) => f.slice(out.length + 1));
  const bad = files
    .filter((f) => f.endsWith(".png"))
    .filter((f) => !describePng(f).structure.ok)
    .map((f) => f.slice(out.length + 1));
  return {
    signal,
    trial,
    framesAtSignal,
    signalledMidRender,
    latencyToGoneMs: latency,
    withinBound: latency !== null && latency <= BOUND_MS,
    exitCode: child.exitCode,
    exitSignal: child.exitSignal,
    groupMembersAfterGone: groupMembers(child.pgid),
    processesNamingOutputDir: pidsWithArgv(out),
    filesLeft: files.length,
    zeroLengthFiles: zero,
    unparsablePngs: bad,
    tempNamedFiles: temp,
    colourFramesOnDisk: colourFrames(colourDir).length,
    sentinelPresent: existsSync(join(out, "probe-done.json")),
    stdoutTail: child.stdout.slice(-600),
  };
}

/** The harness control: a group whose leader ignores TERM. */
async function ignoringControl(): Promise<unknown> {
  const launched = await launchOwned(
    "/bin/sh",
    ["-c", "trap '' TERM INT; while :; do sleep 1; done"],
    {},
    clock,
  );
  if (!launched.ok) throw new Error(launched.reason);
  const child = launched.child;
  await clock.sleep(300);
  const termAt = clock.now();
  signalGroup(child, "SIGTERM");
  const goneAfterTerm = await until(() => isGone(child), TERM_GRACE_MS, clock);
  const membersAfterGrace = groupMembers(child.pgid);
  const killAt = clock.now();
  signalGroup(child, "SIGKILL");
  const goneAfterKill = await until(() => isGone(child), 10_000, clock);
  return {
    goneWithinTermGrace: goneAfterTerm,
    membersAfterTermGrace: membersAfterGrace,
    termToGraceEndMs: Math.round(killAt - termAt),
    goneAfterKill,
    killLatencyMs: Math.round(clock.now() - killAt),
    exitSignal: child.exitSignal,
  };
}

export async function cancelStep(): Promise<void> {
  if (!existsSync(STAGING)) stage(STAGING);
  mkdirSync(RUNS, { recursive: true });
  const control = await ignoringControl();
  writeResult("cancel-control", control);
  const trials: Trial[] = [];
  for (const signal of ["SIGINT", "SIGTERM", "SIGKILL"] as const) {
    for (let n = 1; n <= 3; n += 1) {
      trials.push(await oneTrial(signal, n));
      writeFileSync(join(RUNS, "cancel-progress.txt"), `${trials.length}/9\n`);
    }
  }
  const pass = trials.every(
    (t) =>
      t.signalledMidRender &&
      t.withinBound &&
      t.groupMembersAfterGone.length === 0 &&
      t.processesNamingOutputDir.length === 0 &&
      !t.sentinelPresent,
  );
  writeResult("cancel", {
    boundMs: BOUND_MS,
    termGraceMs: TERM_GRACE_MS,
    pass,
    trials,
    control,
  });
}
