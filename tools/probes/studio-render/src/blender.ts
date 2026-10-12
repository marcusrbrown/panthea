// Launching the probe's Blender script the way the sidecar will: argv only,
// explicit env object, own process group, no terminal (stdin ignored, stdout and
// stderr piped), the supervisor polling from outside.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type Clock, systemClock } from "../../studio-headroom/src/run";
import { BLENDER, BLENDER_SCRIPT, ensureDir, RESULTS, SCRATCH } from "./paths";
import {
  groupMembers,
  isGone,
  launchOwned,
  type OwnedChild,
  pidsWithArgv,
  signalGroup,
  until,
} from "./proc";

/** The env keys the probe may ever pass (criteria.json launch.envCeiling), with the values it passes. */
export function envValues(): Record<string, string> {
  return {
    HOME: ensureDir(join(SCRATCH, "home")),
    TMPDIR: `${ensureDir(join(SCRATCH, "tmp"))}/`,
    PATH: "/usr/bin:/bin",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
  };
}

export const ENV_ORDER = ["HOME", "TMPDIR", "PATH", "LANG", "LC_ALL"] as const;

export function pickEnv(keys: readonly string[]): Record<string, string> {
  const all = envValues();
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = all[key];
    if (value === undefined)
      throw new Error(`${key} is not in the env ceiling`);
    out[key] = value;
  }
  return out;
}

/** The env keys the minimal-env step settled on (results/env.json), or none when that step has not run. */
export function savedEnvKeys(): string[] {
  const path = join(RESULTS, "env.json");
  if (!existsSync(path)) return [];
  return (JSON.parse(readFileSync(path, "utf8")) as { keys: string[] }).keys;
}

export function blenderArgv(
  mode: string,
  scriptArgs: readonly string[],
  flags: readonly string[] = [],
): string[] {
  return [
    ...flags,
    "--background",
    "--factory-startup",
    "--python-exit-code",
    "1",
    "--python",
    BLENDER_SCRIPT,
    "--",
    "--mode",
    mode,
    ...scriptArgs,
  ];
}

export interface Wrapper {
  readonly binary: string;
  readonly args: readonly string[];
}

export interface RunSpec {
  readonly name: string;
  readonly mode: string;
  readonly scriptArgs: readonly string[];
  readonly outDir: string;
  readonly env: Readonly<Record<string, string>>;
  readonly wrapper?: Wrapper;
  /** Blender command-line flags placed before --background (for example --gpu-backend). */
  readonly flags?: readonly string[];
  readonly timeoutMs?: number;
  /** Where the first colour frame appears, for the cold-start measurement. */
  readonly colourDir?: string;
  readonly clock?: Clock;
}

export interface RunResult {
  readonly name: string;
  readonly ok: boolean;
  readonly launchRefused?: string;
  readonly pid: number;
  readonly pgidIsPid: boolean;
  readonly exitCode: number | null;
  readonly exitSignal: string | null;
  readonly timedOut: boolean;
  readonly spawnEpochMs: number;
  readonly durationMs: number;
  readonly firstPythonMs?: number;
  readonly firstColourFrameMs?: number;
  readonly lastFrameMs?: number;
  readonly pngCount: number;
  readonly groupLeftover: number[];
  readonly stdoutTail: string;
  readonly stderrTail: string;
}

export function countPngs(dir: string): number {
  let total = 0;
  const walk = (path: string) => {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(path, entry.name));
      else if (entry.name.endsWith(".png")) total += 1;
    }
  };
  walk(dir);
  return total;
}

export function colourFrames(colourDir: string): string[] {
  if (!existsSync(colourDir)) return [];
  return readdirSync(colourDir)
    .filter((name) => name.endsWith(".toon.png"))
    .sort();
}

/** Run one Blender job to its end (or the timeout), killing its group if it outlives the timeout. */
export async function runToCompletion(spec: RunSpec): Promise<RunResult> {
  const clock = spec.clock ?? systemClock;
  const binary = spec.wrapper ? spec.wrapper.binary : BLENDER;
  const argv = [
    ...(spec.wrapper ? [...spec.wrapper.args, BLENDER] : []),
    ...blenderArgv(spec.mode, spec.scriptArgs, spec.flags ?? []),
  ];
  const spawnEpochMs = Date.now();
  const launched = await launchOwned(binary, argv, spec.env, clock);
  if (!launched.ok)
    return {
      name: spec.name,
      ok: false,
      launchRefused: launched.reason,
      pid: 0,
      pgidIsPid: false,
      exitCode: null,
      exitSignal: null,
      timedOut: false,
      spawnEpochMs,
      durationMs: 0,
      pngCount: 0,
      groupLeftover: [],
      stdoutTail: "",
      stderrTail: "",
    };
  const child: OwnedChild = launched.child;
  const started = clock.now();
  let firstColourSeenMs: number | undefined;
  const timeoutMs = spec.timeoutMs ?? 300_000;
  let timedOut = false;
  while (!child.closed) {
    if (clock.now() - started > timeoutMs) {
      timedOut = true;
      signalGroup(child, "SIGKILL");
      break;
    }
    if (spec.colourDir && firstColourSeenMs === undefined) {
      if (colourFrames(spec.colourDir).length > 0)
        firstColourSeenMs = clock.now() - started;
    }
    await clock.sleep(20);
  }
  await until(() => isGone(child), 15_000, clock);
  const durationMs = clock.now() - started;
  const leftover = groupMembers(child.pgid);

  let firstPythonMs: number | undefined;
  const startFile = join(spec.outDir, "probe-start.json");
  if (existsSync(startFile)) {
    const t0 = (
      JSON.parse(readFileSync(startFile, "utf8")) as { t_script_start: number }
    ).t_script_start;
    firstPythonMs = Math.round(t0 * 1000 - spawnEpochMs);
  }
  let firstColourFrameMs: number | undefined;
  let lastFrameMs: number | undefined;
  if (spec.colourDir) {
    const frames = colourFrames(spec.colourDir);
    if (frames.length > 0) {
      const mtimes = frames.map(
        (f) => statSync(join(spec.colourDir as string, f)).mtimeMs,
      );
      firstColourFrameMs = Math.round(Math.min(...mtimes) - spawnEpochMs);
      lastFrameMs = Math.round(Math.max(...mtimes) - spawnEpochMs);
    }
  }
  return {
    name: spec.name,
    ok: child.exitCode === 0 && !timedOut,
    pid: child.pid,
    pgidIsPid: true,
    exitCode: child.exitCode,
    exitSignal: child.exitSignal,
    timedOut,
    spawnEpochMs,
    durationMs: Math.round(durationMs),
    ...(firstPythonMs === undefined ? {} : { firstPythonMs }),
    ...(firstColourFrameMs === undefined ? {} : { firstColourFrameMs }),
    ...(lastFrameMs === undefined ? {} : { lastFrameMs }),
    pngCount: countPngs(spec.outDir),
    groupLeftover: leftover,
    stdoutTail: child.stdout.slice(-3000),
    stderrTail: child.stderr.slice(-3000),
  };
}

export { pidsWithArgv };
