// A scripted fake Blender: a Bun script that obeys the shared script contract
// (src/render/script-contract.ts) and can be told, per launch, to misbehave in each way the runner
// must survive. Test support only; it lives outside src/.
//
// Run as `bun fake-blender.ts <behavior.json> <Blender argv...>` (the staged executable is a
// shell wrapper that does exactly that). The behavior file is read at every launch; the launch
// number counts `start` events in log.jsonl beside it, and `launches[n - 1]` (the last repeats)
// is what that launch does. Every event is appended to log.jsonl so a test can see what the
// process was asked and what it did. The frames are the committed post-step fixture's raw frames
// (cycled), so the real post step can process them.

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { Sha256 } from "@panthea/contracts";
import { sha256Hex } from "../../src/hash";
import {
  type DoneSentinel,
  EXIT_CODES,
  FIRST_LINE_MARKER,
  type FrameLocators,
  RENDER_ROLES,
  renderDoneJson,
  SENTINEL_NAME,
} from "../../src/render/script-contract";

export type SlotMode =
  /** All frames, then the sentinel. */
  | "ok"
  /** A consistent sentinel for fewer frames than the recipe asked for. */
  | "short"
  /** The sentinel lists a file that is not there. */
  | "missing-file"
  /** All frames in place and no sentinel. */
  | "torn"
  /** A sentinel whose sha256 for one file is wrong. */
  | "bad-sha"
  /** Some frames in the partial directory, then nothing, forever. */
  | "stall"
  /** The process kills itself with SIGSEGV in the middle of the slot. */
  | "crash";

export interface LaunchBehavior {
  /** Dies by this signal before the first line (the GPU-denied crash U1 measured). */
  dieBeforeFirstLine?: "SIGSEGV" | "SIGABRT";
  /** Blocks before the first line, as a Blender that is still starting up. */
  holdBeforeFirstLine?: boolean;
  /** The Blender this launch reports being; the recipe's pin is compared against it. */
  installed?: { version: string; buildHash: string };
  /** The EEVEE context cannot be created: exit 10 after the first line. */
  noGpu?: boolean;
  /** An input error after the first line: exit 12. */
  inputError?: boolean;
  /** An uncaught script error after the first line: exit 1. */
  scriptError?: boolean;
  /** An exit code the contract does not know. */
  oddExit?: number;
  /** Logs SIGTERM and keeps running. */
  ignoreTerm?: boolean;
  /** Slot mode by slot id; unlisted slots use `defaultMode`. */
  slotModes?: Record<string, SlotMode>;
  defaultMode?: SlotMode;
  /** Finishes this many slots, then blocks forever. */
  holdAfterSlots?: number;
  /** Exits 0 after the first line without rendering anything. */
  exitEarly?: boolean;
}

export interface Behavior {
  /** Per launch; the last repeats. */
  launches: LaunchBehavior[];
  /** Directory holding the fixture's raw frames; set by the staging helper. */
  fixtureDir: string;
}

export interface LogEvent {
  pid: number;
  event: string;
  [key: string]: unknown;
}

const FIXTURE_FRAMES = join(import.meta.dir, "..", "fixtures", "render");

interface FixtureFrames {
  frames: {
    name: string;
    locators: {
      eyes?: Record<"l" | "r", { px: [number, number]; depth: number }>;
    };
  }[];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const sha = (path: string) => sha256Hex(new Uint8Array(readFileSync(path)));

/** The locators as render.py writes them: eyes and brows among `points`. */
function sentinelLocators(
  frame: FixtureFrames["frames"][number],
): FrameLocators {
  const points: Record<string, { px: [number, number]; depth: number }> = {};
  for (const side of ["l", "r"] as const) {
    const eye = frame.locators.eyes?.[side];
    if (eye === undefined) continue;
    points[`eyes_${side}`] = { px: eye.px, depth: eye.depth };
    points[`eyebrows_${side}`] = {
      px: [eye.px[0], eye.px[1] - 2],
      depth: eye.depth,
    };
  }
  return {
    points,
  };
}

function listFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(join(dir, at), { withFileTypes: true })) {
      const path = at === "" ? entry.name : `${at}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else found.push(path);
    }
  };
  if (existsSync(dir)) walk("");
  return found.sort();
}

const hang = (): never => {
  setInterval(() => {}, 1000);
  // Never returns; the process is ended by a signal.
  return undefined as never;
};

function main(): void {
  const [behaviorPath, ...argv] = process.argv.slice(2) as [
    string,
    ...string[],
  ];
  // A warm-up run only loads the interpreter: no behaviour, no log.
  if (argv.includes("--warm")) process.exit(0);
  const dir = dirname(behaviorPath);
  const logPath = join(dir, "log.jsonl");
  const log = (event: string, extra: Record<string, unknown> = {}) =>
    appendFileSync(
      logPath,
      `${JSON.stringify({ pid: process.pid, event, at: Date.now(), ...extra })}\n`,
    );
  const launchNumber = existsSync(logPath)
    ? readFileSync(logPath, "utf8")
        .split("\n")
        .filter((line) => line.includes('"event":"start"')).length + 1
    : 1;
  const behavior = readJson<Behavior>(behaviorPath);
  const launch =
    behavior.launches[Math.min(launchNumber, behavior.launches.length) - 1] ??
    {};
  const say = (line: string) => process.stdout.write(`${line}\n`);

  process.on("SIGINT", () => log("int"));
  process.on("SIGTERM", () => {
    log("term");
    if (!launch.ignoreTerm) process.exit(0);
  });

  log("start", {
    launch: launchNumber,
    argv,
    envKeys: Object.keys(process.env).sort(),
  });

  if (launch.dieBeforeFirstLine !== undefined) {
    process.kill(process.pid, launch.dieBeforeFirstLine);
    hang();
    return;
  }
  if (launch.holdBeforeFirstLine) {
    log("holding-before-first-line");
    hang();
    return;
  }

  const recipePath = argv[argv.indexOf("--recipe") + 1] as string;
  const scriptPath = argv[argv.indexOf("--python") + 1] as string;
  log("argv-check", {
    scriptReadable: existsSync(scriptPath),
    background: argv.includes("--background"),
    factoryStartup: argv.includes("--factory-startup"),
    pythonExitCode: argv[argv.indexOf("--python-exit-code") + 1],
    afterDashes: argv.slice(argv.indexOf("--") + 1),
  });
  const installed = launch.installed ?? {
    version: "5.2.2",
    buildHash: "d13f752e3b9c",
  };
  say(`${FIRST_LINE_MARKER} ${JSON.stringify(installed)}`);
  log("first-line");

  if (launch.exitEarly) process.exit(EXIT_CODES.ok);
  const recipe = readJson<{
    blender: { version: string; buildHash: string };
    stagingRoot: string;
    slots: { id: string; facing: string; frames: number; outDir: string }[];
  }>(recipePath);
  if (
    recipe.blender.version !== installed.version ||
    recipe.blender.buildHash !== installed.buildHash
  ) {
    say(
      `RENDER version mismatch: got ${installed.version} ${installed.buildHash}`,
    );
    process.exit(EXIT_CODES.versionMismatch);
  }
  if (launch.noGpu) {
    say("RENDER no GPU context: the fake has no GPU");
    process.exit(EXIT_CODES.noGpuContext);
  }
  if (launch.inputError) {
    say("RENDER input error: the fake was told to refuse the recipe");
    process.exit(EXIT_CODES.inputError);
  }
  if (launch.scriptError) {
    console.error("Traceback: the fake was told to raise");
    process.exit(EXIT_CODES.scriptError);
  }
  log("staging", {
    root: recipe.stagingRoot,
    files: listFiles(recipe.stagingRoot),
  });
  say(`RENDER scene ${JSON.stringify({ build_ms: 1 })}`);

  const fixture = readJson<FixtureFrames>(join(FIXTURE_FRAMES, "frames.json"));
  const frameFile = (role: string, index: number) =>
    join(
      FIXTURE_FRAMES,
      "frames",
      `${fixture.frames[index % fixture.frames.length]?.name}.${role}.png`,
    );

  let finished = 0;
  for (const slot of recipe.slots) {
    if (
      launch.holdAfterSlots !== undefined &&
      finished >= launch.holdAfterSlots
    ) {
      log("holding-after-slots", { finished });
      hang();
      return;
    }
    const mode = launch.slotModes?.[slot.id] ?? launch.defaultMode ?? "ok";
    const partial = `${slot.outDir}.partial`;
    if (existsSync(slot.outDir) || existsSync(partial)) {
      say(`RENDER input error: slot directory ${slot.outDir} already exists`);
      process.exit(EXIT_CODES.inputError);
    }
    const frames =
      mode === "short" ? Math.max(1, slot.frames - 2) : slot.frames;
    for (const role of RENDER_ROLES)
      mkdirSync(join(partial, role), { recursive: true });
    const files: Record<string, { name: string; sha256: Sha256 }[]> = {
      colour: [],
      id: [],
      depth: [],
    };
    const written: Record<string, { name: string; sha256: Sha256 }[]> = {
      colour: [],
      id: [],
      depth: [],
    };
    for (let index = 0; index < frames; index += 1) {
      for (const role of RENDER_ROLES) {
        const name = `${role}/${String(index).padStart(2, "0")}.png`;
        if (mode === "stall" && index >= 3) {
          log("stalled", { index });
          hang();
          return;
        }
        if (mode === "crash" && index >= 2) {
          log("crashing", { index });
          process.kill(process.pid, "SIGSEGV");
          hang();
          return;
        }
        copyFileSync(frameFile(role, index), join(partial, name));
        written[role]?.push({ name, sha256: sha(join(partial, name)) });
      }
      log("frame", { slot: slot.id, index });
    }
    renameSync(partial, slot.outDir);
    log("slot-dir", { slot: slot.id, mode });
    if (mode === "torn") {
      say(
        `RENDER slot ${JSON.stringify({ slot: slot.id, frames, torn: true })}`,
      );
      finished += 1;
      continue;
    }
    for (const role of RENDER_ROLES) {
      files[role] = (written[role] ?? []).map((entry, index) => ({
        name: entry.name,
        sha256:
          mode === "bad-sha" && role === "id" && index === 1
            ? sha256Hex(new TextEncoder().encode("not the file"))
            : (entry.sha256 as never),
      }));
    }
    if (mode === "missing-file") {
      // The sentinel lists a file that was never written.
      const depth = files.depth ?? [];
      const last = depth.length - 1;
      files.depth = depth.map((entry, index) =>
        index === last
          ? { ...entry, name: `depth/${String(frames).padStart(2, "0")}.png` }
          : entry,
      );
    }
    const sentinel: DoneSentinel = {
      schemaVersion: 1,
      slot: slot.id,
      blender: installed,
      frames,
      files: files as unknown as DoneSentinel["files"],
      sourceFrames: Array.from({ length: frames }, (_, i) => i),
      extentPx: Array.from({ length: frames }, () => ({
        top: 10,
        bottom: 78,
        left: 40,
        right: 72,
      })),
      locators: Array.from({ length: frames }, (_, i) =>
        sentinelLocators(
          fixture.frames[
            i % fixture.frames.length
          ] as FixtureFrames["frames"][number],
        ),
      ),
    };
    const tmp = join(slot.outDir, `${SENTINEL_NAME}.tmp`);
    writeFileSync(tmp, renderDoneJson(sentinel));
    renameSync(tmp, join(slot.outDir, SENTINEL_NAME));
    log("sentinel", { slot: slot.id });
    say(`RENDER slot ${JSON.stringify({ slot: slot.id, frames })}`);
    finished += 1;
  }
  if (
    launch.holdAfterSlots !== undefined &&
    finished >= launch.holdAfterSlots
  ) {
    log("holding-after-slots", { finished });
    hang();
    return;
  }
  say(`RENDER done ${JSON.stringify({ wall_ms: 1 })}`);
  process.exit(launch.oddExit ?? EXIT_CODES.ok);
}

if (import.meta.main) main();

// --- Helpers for tests -------------------------------------------------------------------------------

export function writeBehavior(dir: string, behavior: Behavior): void {
  writeFileSync(join(dir, "bin", "behavior.json"), JSON.stringify(behavior));
}

export function setLaunches(dir: string, launches: LaunchBehavior[]): void {
  writeBehavior(dir, { launches, fixtureDir: FIXTURE_FRAMES });
}

export function readLog(dir: string): LogEvent[] {
  try {
    return readFileSync(join(dir, "bin", "log.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LogEvent);
  } catch {
    return [];
  }
}

export interface StagedBlender {
  readonly executable: string;
  readonly pin: { version: string; buildHash: string; binarySha256: string };
}

/** Writes a fake Blender executable under `dir/bin`, a wrapper whose bytes are the pinned binary. */
export function stageFakeBlender(
  dir: string,
  launches: LaunchBehavior[],
): StagedBlender {
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeBehavior(dir, { launches, fixtureDir: FIXTURE_FRAMES });
  const wrapper = `#!/bin/sh\nexec '${process.execPath}' '${import.meta.path}' '${join(dir, "bin", "behavior.json")}' "$@"\n`;
  const executable = join(dir, "bin", "Blender");
  writeFileSync(executable, wrapper);
  chmodSync(executable, 0o755);
  // The first exec of a freshly written wrapper can take hundreds of milliseconds; take that
  // cost here, not inside a start-up deadline.
  const warmed = spawnSync(executable, ["--warm"], {
    env: {},
    timeout: 30_000,
    killSignal: "SIGKILL",
    encoding: "utf8",
  });
  if (warmed.error) throw warmed.error;
  // Clear the warm-up's own events so a test counts only the launches it caused.
  writeFileSync(join(dir, "bin", "log.jsonl"), "");
  return {
    executable,
    pin: {
      version: "5.2.2",
      buildHash: "d13f752e3b9c",
      binarySha256: sha256Hex(new TextEncoder().encode(wrapper)),
    },
  };
}
