// Temporary CI diagnostic: how does this platform report a child that dies of
// SIGABRT? Runs a few controls that need no repository code, each twice: with
// the inherited core-dump limit, then with the core limit set to exactly one
// byte through prlimit(1). Prints one JSON document with a record for every
// control and variant: it ran, was not run (prlimit missing), was skipped by
// the total deadline, or errored. Every wait is bounded, only pids this script
// created are signalled, and nothing from the environment is printed.
//
// One byte, not `ulimit -c 1`: ulimit counts blocks, and a core limit of
// exactly 1 byte is the value the kernel treats as "abort a piped core dump".
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
  return [...new Set(names.filter((n) => /coredum|apport|abrt/i.test(n)))];
}

const STATUS_FIELDS = ["State", "CoreDumping", "VmSize", "VmRSS", "Threads"];

/** A few named lines of /proc/<pid>/status; never the whole file. */
function procStatus(pid: number): Record<string, string> | null {
  const text = readText(`/proc/${pid}/status`);
  if (text === null) return null;
  const fields: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":");
    const key = line.slice(0, colon);
    if (STATUS_FIELDS.includes(key)) fields[key] = line.slice(colon + 1).trim();
  }
  return fields;
}

/** The core-size row of /proc/<pid>/limits (soft, hard, units), or null. */
function coreLimitRow(pid: number | "self"): string | null {
  return (
    readText(`/proc/${pid}/limits`)
      ?.split("\n")
      .find((line) => line.startsWith("Max core file size"))
      ?.replace(/\s+/g, " ") ?? null
  );
}

interface Control {
  readonly name: string;
  readonly cmd: readonly string[];
  readonly stdio: "pipe" | "ignore";
  /** Wait for this stdout text, while the child is still alive, before acting. */
  readonly readyText?: string;
  readonly act?: (child: Bun.Subprocess) => void;
  /** A longer wait for the child to exit, in the inherited-limit variant only. */
  readonly inheritedExitWaitMs?: number;
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
    inheritedExitWaitMs: 30_000,
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

const prlimitPath = shell("command -v prlimit") || null;

interface Variant {
  readonly name: string;
  readonly wrap: (cmd: readonly string[]) => string[];
  /** Why this variant cannot run here, when it cannot. */
  readonly unavailable?: string;
}

const variants: readonly Variant[] = [
  { name: "inherited-core-limit", wrap: (cmd) => [...cmd] },
  {
    name: "core-limit-1-byte",
    // prlimit execs the command, so signals still reach the control itself.
    wrap: (cmd) => ["prlimit", "--core=1:1", "--", ...cmd],
    ...(prlimitPath === null
      ? { unavailable: "prlimit is not available on this platform" }
      : {}),
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
  variant: Variant,
): Promise<Record<string, unknown>> {
  const stdout = { text: "" };
  const stderr = { text: "" };
  const startedAt = performance.now();
  const exitWaitMs =
    variant.name === "inherited-core-limit"
      ? (control.inheritedExitWaitMs ?? WAIT_MS)
      : WAIT_MS;
  const child = Bun.spawn(variant.wrap(control.cmd), {
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
      sleep(Math.max(0, exitWaitMs - (performance.now() - startedAt))).then(
        () => false,
      ),
    ]);
    const record: Record<string, unknown> = {
      control: control.name,
      variant: variant.name,
      status: "ran",
      exitBoundMs: exitWaitMs,
      exitedWithinBound: exited,
      elapsedMs: Math.round(performance.now() - startedAt),
      actedAfterMs,
      exitCode: child.exitCode,
      signalCode: child.signalCode,
    };
    if (!exited) {
      record.aliveAtBound = alive(child.pid);
      record.procStatus = procStatus(child.pid);
      record.childCoreLimit = coreLimitRow(child.pid);
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
    if (variant.name !== "inherited-core-limit") {
      // A prlimit that could not set the limit (for example EPERM) reports it
      // on stderr; that is the wrapper failing, not evidence about the abort.
      record.wrapperReportedFailure = /prlimit/i.test(stderr.text);
    }
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
    const label = { control: control.name, variant: variant.name };
    if (variant.unavailable !== undefined) {
      results.push({
        ...label,
        status: "not-run",
        reason: variant.unavailable,
      });
    } else if (performance.now() - started > TOTAL_DEADLINE_MS) {
      results.push({
        ...label,
        status: "skipped",
        reason: "total deadline reached",
      });
    } else {
      try {
        results.push(await runControl(control, variant));
      } catch (error) {
        results.push({
          ...label,
          status: "error",
          error: String(error).slice(0, 300),
        });
      }
    }
  }
}

const count = (status: string) =>
  results.filter((r) => r.status === status).length;

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
        corePipeLimit: readText("/proc/sys/kernel/core_pipe_limit"),
        coreUlimit: shell("ulimit -c"),
        parentCoreLimit: coreLimitRow("self"),
        prlimit: { available: prlimitPath !== null, path: prlimitPath },
        coreHelpers: coreHelpers(),
      },
      totalMs: Math.round(performance.now() - started),
      deadlineMs: TOTAL_DEADLINE_MS,
      records: results.length,
      ran: count("ran"),
      notRun: count("not-run"),
      skipped: count("skipped"),
      errors: count("error"),
      results,
    },
    null,
    2,
  ),
);
