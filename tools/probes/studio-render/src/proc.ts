// Owned child processes for the studio-render probe: the same launch shape as
// `launch` in packages/assets/src/studio/runtime.ts (argv only, no shell, a
// detached child that leads its own process group, an explicit env object),
// and the same "gone" test as `stopGroup` (child closed and no process left in
// its group). This probe owns the copy so it can time every step; the
// production function is private to the runtime.

import { spawn, spawnSync } from "node:child_process";
import type { Clock } from "../../studio-headroom/src/run";

export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
}

/** `ps -ax -o pid=,ppid=,pgid=` rows. */
export function parseProcessTable(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/).map(Number);
    const [pid, ppid, pgid] = parts;
    if (
      parts.length === 3 &&
      Number.isInteger(pid) &&
      Number.isInteger(ppid) &&
      Number.isInteger(pgid)
    )
      rows.push({
        pid: pid as number,
        ppid: ppid as number,
        pgid: pgid as number,
      });
  }
  return rows;
}

export function processTable(): ProcessRow[] {
  const result = spawnSync("ps", ["-ax", "-o", "pid=,ppid=,pgid="], {
    encoding: "utf8",
  });
  return result.status === 0 ? parseProcessTable(result.stdout) : [];
}

/** Pids of processes whose argv text contains `needle` (the probe's marker, a staging or output path). */
export function pidsWithArgv(needle: string): number[] {
  const result = spawnSync("ps", ["-ax", "-o", "pid=,command="], {
    encoding: "utf8",
  });
  if (result.status !== 0) return [];
  const pids: number[] = [];
  for (const line of result.stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match && (match[2] as string).includes(needle))
      pids.push(Number(match[1]));
  }
  return pids.filter((pid) => pid !== process.pid);
}

export const groupMembers = (pgid: number): number[] =>
  processTable()
    .filter((row) => row.pgid === pgid)
    .map((row) => row.pid);

export interface OwnedChild {
  readonly pid: number;
  readonly pgid: number;
  readonly spawnedAtMs: number;
  exited: boolean;
  closed: boolean;
  exitCode: number | null;
  exitSignal: string | null;
  exitedAtMs: number | undefined;
  stdout: string;
  stderr: string;
  readonly stdoutLines: string[];
}

export type Launched =
  | { readonly ok: true; readonly child: OwnedChild }
  | { readonly ok: false; readonly reason: string };

/** Poll `predicate` every `pollMs` until true or `timeoutMs`; true when it held. */
export async function until(
  predicate: () => boolean,
  timeoutMs: number,
  clock: Clock,
  pollMs = 10,
): Promise<boolean> {
  const deadline = clock.now() + timeoutMs;
  for (;;) {
    if (predicate()) return true;
    if (clock.now() >= deadline) return false;
    await clock.sleep(pollMs);
  }
}

export async function launchOwned(
  binary: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  clock: Clock,
): Promise<Launched> {
  const spawnedAtMs = clock.now();
  const proc = spawn(binary, [...args], {
    detached: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...env },
  });
  const child: OwnedChild = {
    pid: proc.pid ?? 0,
    pgid: proc.pid ?? 0,
    spawnedAtMs,
    exited: false,
    closed: false,
    exitCode: null,
    exitSignal: null,
    exitedAtMs: undefined,
    stdout: "",
    stderr: "",
    stdoutLines: [],
  };
  let partial = "";
  proc.stdout?.on("data", (data: Buffer) => {
    const text = data.toString("utf8");
    child.stdout = (child.stdout + text).slice(-20000);
    partial += text;
    const lines = partial.split("\n");
    partial = lines.pop() ?? "";
    child.stdoutLines.push(...lines);
  });
  proc.stderr?.on("data", (data: Buffer) => {
    child.stderr = (child.stderr + data.toString("utf8")).slice(-20000);
  });
  let spawnError: Error | undefined;
  proc.on("error", (error) => {
    spawnError = error;
    child.exited = true;
    child.closed = true;
  });
  proc.on("exit", (code, signal) => {
    child.exited = true;
    child.exitCode = code;
    child.exitSignal = signal;
    child.exitedAtMs = clock.now();
  });
  proc.on("close", () => {
    child.closed = true;
  });
  await new Promise<void>((resolve) => {
    proc.once("spawn", () => resolve());
    proc.once("error", () => resolve());
  });
  if (spawnError || proc.pid === undefined)
    return {
      ok: false,
      reason: `could not spawn: ${spawnError?.message ?? "no pid"}`,
    };
  const owned = await until(
    () => {
      const rows = processTable();
      const own = rows.find((row) => row.pid === child.pid);
      const supervisor = rows.find((row) => row.pid === process.pid);
      return own?.pgid === child.pid && supervisor?.pgid !== child.pid;
    },
    2000,
    clock,
  );
  if (!owned) {
    if (!child.exited) process.kill(child.pid, "SIGKILL");
    return {
      ok: false,
      reason: "the child's own process group could not be established",
    };
  }
  return { ok: true, child };
}

export const isGone = (child: OwnedChild): boolean =>
  child.closed && groupMembers(child.pgid).length === 0;

export function signalGroup(
  child: OwnedChild,
  name: "SIGINT" | "SIGTERM" | "SIGKILL" | "SIGSTOP",
): void {
  const rows = processTable();
  const supervisor = rows.find((row) => row.pid === process.pid);
  if (supervisor?.pgid === child.pgid)
    throw new Error("refusing to signal the supervisor's own group");
  if (!rows.some((row) => row.pgid === child.pgid)) return;
  try {
    process.kill(-child.pgid, name);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH" && code !== "EPERM") throw error;
  }
}
