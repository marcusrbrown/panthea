// Temporary CI diagnostic: how does this platform report a child that dies of
// SIGABRT? Runs a few controls that need no repository code, each twice (the
// inherited core-dump limit, then `ulimit -c 0` inside the child's own shell),
// and prints one JSON document. Every wait is bounded, only pids this script
// created are signalled, and nothing from the environment is printed.
//
//   bun tools/probes/art-local-2/diagnostics/abort-controls.ts

import { existsSync, readFileSync } from "node:fs";
import { release, type, version } from "node:os";

const WAIT_MS = 4_000;
const KILL_WAIT_MS = 2_000;
const DRAIN_WAIT_MS = 1_500;
const TOTAL_DEADLINE_MS = 80_000;
const KEEP_CHARS = 4_096;

const bun = process.execPath;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const readText = (path: string) =>
  existsSync(path) ? readFileSync(path, "utf8").trim() : null;

const shell = (script: string) =>
  Bun.spawnSync(["sh", "-c", script], { stdout: "pipe", stderr: "ignore" })
    .stdout.toString()
    .trim();

/** Core-dump helpers that could be catching the abort, by command name only. */
function coreHelpers(): string[] {
  const names = shell("ps -eo comm=").split("\n");
  return [...new Set(names.filter((n) => /apport|coredump|abrt/i.test(n)))];
}

interface Control {
  readonly name: string;
  readonly cmd: readonly string[];
  readonly stdio: "pipe" | "ignore";
  /** Wait for this stdout text, while the child is still alive, before acting. */
  readonly readyText?: string;
  readonly act?: (child: Bun.Subprocess) => void;
}

const idle = "setInterval(() => {}, 1000)";

const controls: readonly Control[] = [
  {
    name: "sh-self-sigabrt",
    cmd: ["sh", "-c", "kill -ABRT $$; sleep 10"],
    stdio: "pipe",
  },
  {
    name: "bun-abort-pipe",
    cmd: [bun, "-e", "process.abort()"],
    stdio: "pipe",
  },
  {
    name: "bun-abort-ignore",
    cmd: [bun, "-e", "process.abort()"],
    stdio: "ignore",
  },
  {
    name: "parent-kills-sigabrt",
    cmd: [bun, "-e", `console.log('ready'); ${idle}`],
    stdio: "pipe",
    readyText: "ready",
    act: (child) => child.kill("SIGABRT"),
  },
  {
    name: "bun-self-kill-sigabrt",
    cmd: [bun, "-e", `process.kill(process.pid, 'SIGABRT'); ${idle}`],
    stdio: "pipe",
  },
  {
    name: "sigterm-handler-aborts",
    cmd: [
      bun,
      "-e",
      `process.on('SIGTERM', () => process.abort()); console.log('ready'); ${idle}`,
    ],
    stdio: "pipe",
    readyText: "ready",
    act: (child) => child.kill("SIGTERM"),
  },
  {
    name: "grandchild-holds-stdout-then-abort",
    cmd: [
      bun,
      "-e",
      "const gc = Bun.spawn([process.execPath, '-e', 'setTimeout(() => {}, 1500)'], { stdout: 'inherit', stderr: 'inherit' });" +
        "console.log('spawned ' + gc.pid); setTimeout(() => process.abort(), 50);",
    ],
    stdio: "pipe",
  },
];

const variants = [
  { name: "inherited-core-limit", wrap: (cmd: readonly string[]) => cmd },
  {
    name: "shell-core-limit-0",
    // exec keeps the pid, so signals still reach the control itself.
    wrap: (cmd: readonly string[]) => [
      "sh",
      "-c",
      'ulimit -c 0; exec "$0" "$@"',
      ...cmd,
    ],
  },
];

async function collect(
  stream: ReadableStream<Uint8Array> | undefined,
  sink: { text: string },
): Promise<void> {
  if (stream === undefined) return;
  const decoder = new TextDecoder();
  try {
    for await (const chunk of stream) {
      if (sink.text.length < KEEP_CHARS) {
        sink.text = (sink.text + decoder.decode(chunk, { stream: true })).slice(
          0,
          KEEP_CHARS,
        );
      }
    }
  } catch {
    // A closed pipe ends the stream.
  }
}

async function runControl(
  control: Control,
  variant: (typeof variants)[number],
): Promise<Record<string, unknown>> {
  const stdout = { text: "" };
  const stderr = { text: "" };
  const startedAt = performance.now();
  const child = Bun.spawn([...variant.wrap(control.cmd)], {
    stdin: "ignore",
    stdout: control.stdio,
    stderr: control.stdio,
  });
  let grandchildPid: number | null = null;
  try {
    const draining = Promise.all([
      collect(child.stdout, stdout),
      collect(child.stderr, stderr),
    ]);
    let finished = false;
    void child.exited.then(() => {
      finished = true;
    });

    let actedAfterMs: number | null = null;
    if (control.readyText !== undefined) {
      while (
        !stdout.text.includes(control.readyText) &&
        !finished &&
        performance.now() - startedAt < WAIT_MS
      ) {
        await sleep(10);
      }
      if (stdout.text.includes(control.readyText) && !finished) {
        actedAfterMs = Math.round(performance.now() - startedAt);
        control.act?.(child);
      }
    }

    const exited = await Promise.race([
      child.exited.then(() => true),
      sleep(Math.max(0, WAIT_MS - (performance.now() - startedAt))).then(
        () => false,
      ),
    ]);
    const record: Record<string, unknown> = {
      control: control.name,
      variant: variant.name,
      exitedWithinBound: exited,
      elapsedMs: Math.round(performance.now() - startedAt),
      actedAfterMs,
      exitCode: child.exitCode,
      signalCode: child.signalCode,
    };
    if (!exited) {
      record.aliveAtBound = alive(child.pid);
      record.procState =
        readText(`/proc/${child.pid}/status`)
          ?.split("\n")
          .find((line) => line.startsWith("State:")) ?? null;
      record.coreHelpers = coreHelpers();
    }

    const spawned = /spawned (\d+)/.exec(stdout.text);
    if (spawned?.[1] !== undefined) grandchildPid = Number(spawned[1]);
    record.pipesDrainedWithin1500ms = await Promise.race([
      draining.then(() => true),
      sleep(DRAIN_WAIT_MS).then(() => false),
    ]);
    if (grandchildPid !== null) {
      record.grandchildAliveAfterDrainWait = alive(grandchildPid);
    }
    record.stdoutHead = stdout.text.slice(0, 200);
    record.stderrHead = stderr.text.slice(0, 600);
    return record;
  } finally {
    // Only the child and grandchild this run created.
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await Promise.race([child.exited, sleep(KILL_WAIT_MS)]);
    }
    if (grandchildPid !== null && alive(grandchildPid)) {
      try {
        process.kill(grandchildPid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
}

const started = performance.now();
const results: Record<string, unknown>[] = [];
for (const variant of variants) {
  for (const control of controls) {
    if (performance.now() - started > TOTAL_DEADLINE_MS) {
      results.push({
        control: control.name,
        variant: variant.name,
        skipped: "total deadline reached",
      });
      continue;
    }
    try {
      results.push(await runControl(control, variant));
    } catch (error) {
      results.push({
        control: control.name,
        variant: variant.name,
        error: String(error).slice(0, 300),
      });
    }
  }
}

console.log(
  JSON.stringify(
    {
      env: {
        bunVersion: Bun.version,
        bunRevision: Bun.revision,
        platform: process.platform,
        arch: process.arch,
        os: readText("/etc/os-release")
          ?.split("\n")
          .find((line) => line.startsWith("PRETTY_NAME")),
        kernel: `${type()} ${release()}`,
        kernelBuild: version(),
        corePattern: readText("/proc/sys/kernel/core_pattern"),
        coreUlimit: shell("ulimit -c"),
        coreHelpers: coreHelpers(),
      },
      totalMs: Math.round(performance.now() - started),
      runs: results.length,
      failedRuns: results.filter((r) => "error" in r).length,
      skippedRuns: results.filter((r) => "skipped" in r).length,
      results,
    },
    null,
    2,
  ),
);
