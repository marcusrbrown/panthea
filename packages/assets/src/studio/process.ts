// Owned child processes: spawn into their own process group, and tear the group down.
// Shared by every engine the runtime drives (sd-server, Blender).
//
// A group is only ever signalled after that ownership was checked, so the whole family
// (including grandchildren that hold its pipes) is torn down without touching anything else.
// Stop is SIGTERM, a bounded wait, then SIGKILL. SIGINT is never sent: Blender swallows it and
// the render completes (U1).
//
// Process groups are POSIX; groups, signals and `ps` were verified on macOS only.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";

export interface StopDeadlines {
  readonly termGraceMs: number;
  readonly killMs: number;
}

export const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

export async function until(cond: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await sleep(20);
  }
  return cond();
}

export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
}

export function processTable(): ProcessRow[] {
  const result = spawnSync("ps", ["-ax", "-o", "pid=,ppid=,pgid="], {
    encoding: "utf8",
  });
  return result.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((cols) => cols.length === 3 && cols.every(Number.isInteger))
    .map(([pid, ppid, pgid]) => ({
      pid: pid as number,
      ppid: ppid as number,
      pgid: pgid as number,
    }));
}

export const groupMembers = (pgid: number) =>
  processTable()
    .filter((row) => row.pgid === pgid)
    .map((row) => row.pid);

export interface OwnedChild {
  readonly proc: ChildProcess;
  readonly pid: number;
  /** The child's own process group: its pid. */
  readonly pgid: number;
  exited: boolean;
  closed: boolean;
  exit: string;
  /** The exit code, once the process exited by itself or was killed (null for a signal). */
  code: number | null;
  /** The signal that ended the process, if one did. */
  signal: string | undefined;
  error: Error | undefined;
  tail: string;
}

export const tailOf = (child: OwnedChild) =>
  child.tail.trim() === "" ? "" : ` Output: ${child.tail.trim()}`;

export type Launch =
  | { readonly ok: true; readonly child: OwnedChild }
  | {
      readonly ok: false;
      readonly kind: "unavailable" | "failed";
      readonly message: string;
    };

export interface LaunchOptions {
  /** Each decoded chunk of stdout, as it arrives. */
  readonly onStdout?: (text: string) => void;
  /** What the failed-spawn message calls the child. */
  readonly label?: string;
  readonly cwd?: string;
}

export async function launch(
  binary: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  options: LaunchOptions = {},
): Promise<Launch> {
  const label = options.label ?? "server";
  const proc = spawn(binary, [...args], {
    detached: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...env },
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });
  const child: OwnedChild = {
    proc,
    pid: proc.pid ?? 0,
    pgid: proc.pid ?? 0,
    exited: false,
    closed: false,
    exit: "",
    code: null,
    signal: undefined,
    error: undefined,
    tail: "",
  };
  const collect = (data: Buffer) => {
    child.tail = (child.tail + data.toString("utf8")).slice(-2000);
  };
  proc.stdout?.on("data", collect);
  proc.stderr?.on("data", collect);
  const onStdout = options.onStdout;
  if (onStdout)
    proc.stdout?.on("data", (data: Buffer) => onStdout(data.toString("utf8")));
  proc.on("error", (error) => {
    child.error = error;
    child.exited = true;
    child.closed = true;
  });
  proc.on("exit", (code, signal) => {
    child.exited = true;
    child.code = code;
    child.signal = signal ?? undefined;
    child.exit = signal ? `signal ${signal}` : `exit code ${code}`;
  });
  proc.on("close", () => {
    child.closed = true;
  });
  await new Promise<void>((resolve) => {
    proc.once("spawn", () => resolve());
    proc.once("error", () => resolve());
  });
  if (child.error || proc.pid === undefined)
    return {
      ok: false,
      kind: "failed",
      message: `could not spawn the ${label}: ${child.error?.message ?? "no pid"}`,
    };
  const owned = await until(() => {
    const rows = processTable();
    const own = rows.find((row) => row.pid === child.pid);
    const supervisor = rows.find((row) => row.pid === process.pid);
    return own?.pgid === child.pid && supervisor?.pgid !== child.pid;
  }, 2000);
  if (!owned) {
    if (!child.exited) process.kill(child.pid, "SIGKILL");
    await until(() => child.closed, 3000);
    return {
      ok: false,
      kind: "unavailable",
      message: `the ${label}'s own process group could not be established; refusing to run it without reliable teardown`,
    };
  }
  return { ok: true, child };
}

export type TeardownResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "teardown-incomplete";
      readonly message: string;
    };

/** TERM, a bounded wait, then KILL, to the child's owned group; true when the group is gone and its pipes are closed. */
export async function stopGroup(
  child: OwnedChild,
  deadlines: StopDeadlines,
): Promise<TeardownResult> {
  const gone = () => child.closed && groupMembers(child.pgid).length === 0;
  if (gone()) return { ok: true };
  const signal = (name: "SIGTERM" | "SIGKILL") => {
    const rows = processTable();
    const supervisor = rows.find((row) => row.pid === process.pid);
    if (supervisor?.pgid === child.pgid) return;
    if (!rows.some((row) => row.pgid === child.pgid)) return;
    try {
      process.kill(-child.pgid, name);
    } catch (error) {
      // Only zombies are left in a group this process owns: nothing to signal.
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ESRCH" && code !== "EPERM") throw error;
    }
  };
  signal("SIGTERM");
  if (await until(gone, deadlines.termGraceMs)) return { ok: true };
  signal("SIGKILL");
  if (await until(gone, deadlines.killMs)) return { ok: true };
  return {
    ok: false,
    reason: "teardown-incomplete",
    message: `processes ${groupMembers(child.pgid).join(", ") || "(none)"} of group ${child.pgid} survived SIGKILL`,
  };
}
