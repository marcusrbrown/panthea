// The local image runtime for one studio session: it verifies the configured
// artifacts, owns one sd-server child in its own process group, drains the
// session's queue through the server's native async API one job at a time, and
// records every transition through the session's single ledger.
//
// Ownership rules: the child is spawned detached so its process group is its
// own, and a group is only ever signalled after that ownership was checked, so
// the whole family (including grandchildren that hold its pipes) is torn down
// without touching anything else. A job's cancellation never relies on the
// HTTP API: aborting kills the child and a fresh one starts before the next
// job, and nothing a stopped child produces afterwards is stored.
//
// Process groups are POSIX: this module reports the runtime unavailable on
// other platforms. Groups, signals and `ps` were verified on macOS only.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, createReadStream, statSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import type { ImageOutput } from "@panthea/contracts";
import type { RgbaImage } from "../conformance";
import { decodePng } from "./png/decode";
import { SELECTED_PROFILE, type SelectedProfile } from "./provider";
import { adapterInput, buildSpec, type StudioContent } from "./request";
import type { CommandResult, StudioSession } from "./session";
import type { JobRecord } from "./store";

export interface RuntimeDeadlines {
  readonly httpMs: number;
  readonly startupMs: number;
  readonly generationMs: number;
  readonly termGraceMs: number;
  readonly killMs: number;
}

export interface RuntimeConfig {
  /** Directory holding the pinned binary and models at the profile's relative paths. */
  readonly artifactRoot: string;
  /** Loopback port the owned server listens on; it must be free. */
  readonly port: number;
  readonly content: StudioContent;
  readonly deadlines: RuntimeDeadlines;
  readonly pollMs: number;
  readonly profile?: SelectedProfile;
  /** The child's whole environment; the parent's is never inherited. */
  readonly env?: Readonly<Record<string, string>>;
}

export type JobResult =
  | {
      readonly jobId: string;
      readonly outcome: "succeeded";
      readonly output: ImageOutput;
      readonly image: RgbaImage;
    }
  | {
      readonly jobId: string;
      readonly outcome: "failed";
      readonly error: string;
    }
  | {
      readonly jobId: string;
      readonly outcome: "unavailable";
      readonly reason: string;
      readonly staging: string;
    }
  | { readonly jobId: string; readonly outcome: "aborted" };

export type DrainStop =
  | "empty"
  | "unavailable"
  | "start-failed"
  | "closing"
  | "session-closed";

export interface RuntimeRefusal {
  readonly ok: false;
  readonly reason: "closed" | "busy" | "not-running" | "write-failed";
  readonly message: string;
}

export type DrainResult =
  | {
      readonly ok: true;
      readonly results: readonly JobResult[];
      readonly stopped: DrainStop;
    }
  | RuntimeRefusal;

export type TeardownResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "teardown-incomplete";
      readonly message: string;
    };

export type AbortResult = TeardownResult | RuntimeRefusal;

export interface StudioRuntime {
  /** Runs queued jobs in enqueue order until none remain or the runtime cannot continue. */
  drain(): Promise<DrainResult>;
  /** Cancels the running job: ledgered, then the child is killed and awaited. */
  abort(jobId: string): Promise<AbortResult>;
  /** Stops the child and waits until its process group is gone. The session stays open. */
  close(): Promise<TeardownResult>;
  /** `close()`, then the session; ownership is released only after teardown. */
  shutdown(): Promise<TeardownResult>;
}

const ROLE_FLAGS: Record<string, string> = {
  "diffusion-model": "--diffusion-model",
  "text-encoder": "--llm",
  vae: "--vae",
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function until(cond: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await sleep(20);
  }
  return cond();
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const staging = (root: string) =>
  `Stage the pinned runtime and models under the artifact root ${root} at the paths and hashes in SELECTED_PROFILE (packages/assets/src/studio/provider.ts); tools/probes/art-local-2 stages them ('bun run src/stage.ts runtime' and 'bun run src/stage.ts z-image-turbo'). Nothing is downloaded automatically.`;

type Verified =
  | {
      readonly ok: true;
      readonly binary: string;
      readonly components: readonly { role: string; path: string }[];
    }
  | { readonly ok: false; readonly reason: string };

function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

async function verifyArtifacts(
  root: string,
  profile: SelectedProfile,
): Promise<Verified> {
  const checks = [
    {
      label: `runtime binary ${profile.runtime.binary.path}`,
      path: join(root, profile.runtime.binary.path),
      sha256: profile.runtime.binary.sha256,
      size: undefined as number | undefined,
      executable: true,
    },
    ...profile.components.map((c) => ({
      label: `${c.role} ${c.file}`,
      path: join(root, c.file),
      sha256: c.sha256,
      size: c.sizeBytes as number | undefined,
      executable: false,
    })),
  ];
  const problems: string[] = [];
  for (const component of profile.components)
    if (ROLE_FLAGS[component.role] === undefined)
      problems.push(
        `the profile names an unsupported component role ${component.role}`,
      );
  for (const check of checks) {
    let stat: ReturnType<typeof statSync> | undefined;
    try {
      stat = statSync(check.path);
    } catch {
      problems.push(`${check.label} is missing`);
      continue;
    }
    if (!stat.isFile()) problems.push(`${check.label} is not a regular file`);
    else if (check.size !== undefined && stat.size !== check.size)
      problems.push(
        `${check.label} has size ${stat.size}, expected ${check.size}`,
      );
    if (check.executable) {
      try {
        accessSync(check.path, constants.X_OK);
      } catch {
        problems.push(`${check.label} is not executable`);
      }
    }
  }
  if (problems.length > 0) return { ok: false, reason: problems.join("; ") };
  for (const check of checks) {
    const actual = await hashFile(check.path);
    if (actual !== check.sha256)
      problems.push(
        `${check.label} sha256 ${actual} does not match the pinned ${check.sha256}`,
      );
  }
  if (problems.length > 0) return { ok: false, reason: problems.join("; ") };
  return {
    ok: true,
    binary: checks[0]?.path as string,
    components: profile.components.map((c) => ({
      role: c.role,
      path: join(root, c.file),
    })),
  };
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
}

function processTable(): ProcessRow[] {
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

const groupMembers = (pgid: number) =>
  processTable()
    .filter((row) => row.pgid === pgid)
    .map((row) => row.pid);

interface OwnedChild {
  readonly proc: ChildProcess;
  readonly pid: number;
  /** The child's own process group: its pid. */
  readonly pgid: number;
  exited: boolean;
  closed: boolean;
  exit: string;
  error: Error | undefined;
  tail: string;
}

const tailOf = (child: OwnedChild) =>
  child.tail.trim() === "" ? "" : ` Output: ${child.tail.trim()}`;

type Launch =
  | { readonly ok: true; readonly child: OwnedChild }
  | {
      readonly ok: false;
      readonly kind: "unavailable" | "failed";
      readonly message: string;
    };

async function launch(
  binary: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): Promise<Launch> {
  const proc = spawn(binary, [...args], {
    detached: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...env },
  });
  const child: OwnedChild = {
    proc,
    pid: proc.pid ?? 0,
    pgid: proc.pid ?? 0,
    exited: false,
    closed: false,
    exit: "",
    error: undefined,
    tail: "",
  };
  const collect = (data: Buffer) => {
    child.tail = (child.tail + data.toString("utf8")).slice(-2000);
  };
  proc.stdout?.on("data", collect);
  proc.stderr?.on("data", collect);
  proc.on("error", (error) => {
    child.error = error;
    child.exited = true;
    child.closed = true;
  });
  proc.on("exit", (code, signal) => {
    child.exited = true;
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
      message: `could not spawn the server: ${child.error?.message ?? "no pid"}`,
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
      message:
        "the server's own process group could not be established; refusing to run it without reliable teardown",
    };
  }
  return { ok: true, child };
}

/** TERM, a bounded wait, then KILL, to the child's owned group; true when the group is gone and its pipes are closed. */
async function stopGroup(
  child: OwnedChild,
  deadlines: RuntimeDeadlines,
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

async function waitReady(
  child: OwnedChild,
  port: number,
  config: RuntimeConfig,
): Promise<string | undefined> {
  const end = Date.now() + config.deadlines.startupMs;
  const died = () =>
    `the server exited before it was ready (${child.error ? child.error.message : child.exit}).${tailOf(child)}`;
  while (Date.now() < end) {
    if (child.exited) return died();
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/sdcpp/v1/capabilities`,
        {
          signal: AbortSignal.timeout(
            Math.max(1, Math.min(config.deadlines.httpMs, end - Date.now())),
          ),
        },
      );
      if (child.exited) return died();
      if (response.ok && isRecord(await response.json())) {
        return child.exited ? died() : undefined;
      }
    } catch {
      // not listening yet
    }
    await sleep(config.pollMs);
  }
  return `the server was not ready within ${config.deadlines.startupMs} ms.${tailOf(child)}`;
}

type Generated =
  | { readonly kind: "image"; readonly bytes: Uint8Array }
  | { readonly kind: "server-failed"; readonly message: string }
  | { readonly kind: "client-failed"; readonly message: string }
  | { readonly kind: "aborted" };

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function extractImage(job: Record<string, unknown>): Generated {
  const images = isRecord(job.result) ? job.result.images : undefined;
  if (!Array.isArray(images) || images.length !== 1)
    return {
      kind: "server-failed",
      message: `a completed job must carry exactly one image; got ${Array.isArray(images) ? images.length : "none"}`,
    };
  const encoded = isRecord(images[0]) ? images[0].b64_json : undefined;
  if (
    typeof encoded !== "string" ||
    !BASE64.test(encoded) ||
    encoded.length % 4 !== 0
  )
    return { kind: "server-failed", message: "the image is not valid base64" };
  return {
    kind: "image",
    bytes: new Uint8Array(Buffer.from(encoded, "base64")),
  };
}

async function generate(
  port: number,
  body: unknown,
  config: RuntimeConfig,
  signal: AbortSignal,
): Promise<Generated> {
  const base = `http://127.0.0.1:${port}`;
  const http = (path: string, init: RequestInit) =>
    fetch(`${base}${path}`, {
      ...init,
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(config.deadlines.httpMs),
      ]),
    });
  const client = (message: string): Generated => ({
    kind: "client-failed",
    message,
  });
  try {
    const submitted = await http("/sdcpp/v1/img_gen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!submitted.ok) return client(`img_gen returned ${submitted.status}`);
    const accepted: unknown = await submitted.json().catch(() => undefined);
    if (!isRecord(accepted) || typeof accepted.id !== "string")
      return client("the img_gen response has no job id");
    const deadline = Date.now() + config.deadlines.generationMs;
    for (;;) {
      if (signal.aborted) return { kind: "aborted" };
      if (Date.now() > deadline)
        return client(
          `generation deadline of ${config.deadlines.generationMs} ms exceeded`,
        );
      const polled = await http(
        `/sdcpp/v1/jobs/${encodeURIComponent(accepted.id)}`,
        { method: "GET" },
      );
      if (!polled.ok) return client(`the job poll returned ${polled.status}`);
      const job: unknown = await polled.json().catch(() => undefined);
      if (!isRecord(job))
        return client("the job poll response was not valid JSON");
      switch (job.status) {
        case "completed":
          return extractImage(job);
        case "failed":
        case "cancelled": {
          const detail =
            isRecord(job.error) && typeof job.error.message === "string"
              ? job.error.message
              : "no message";
          return {
            kind: "server-failed",
            message: `the server reported ${job.status}: ${detail}`,
          };
        }
        case "queued":
        case "generating":
          break;
        default:
          return client(
            `unrecognized job status ${JSON.stringify(job.status)}`,
          );
      }
      await sleepUnlessAborted(config.pollMs, signal);
    }
  } catch (error) {
    if (signal.aborted) return { kind: "aborted" };
    return client(
      `the request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

type Ready =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly kind: "unavailable";
      readonly reason: string;
    }
  | { readonly ok: false; readonly kind: "failed"; readonly error: string };

type Attempt =
  | { readonly kind: "result"; readonly result: JobResult }
  | { readonly kind: "skipped" }
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "session-closed" };

/** A refused transition: a closed session or an unwritable record ends the drain; any other refusal means the job moved on. */
function unsettled(refusal: Extract<CommandResult, { ok: false }>): Attempt {
  if (refusal.reason === "closed") return { kind: "session-closed" };
  if (refusal.reason === "write-failed")
    return { kind: "refused", message: refusal.message };
  return { kind: "skipped" };
}

export function openRuntime(
  session: StudioSession,
  config: RuntimeConfig,
): StudioRuntime {
  const profile = config.profile ?? SELECTED_PROFILE;
  let closed = false;
  let closing = false;
  let child: OwnedChild | undefined;
  let verified: Extract<Verified, { ok: true }> | undefined;
  let stopPending: Promise<TeardownResult> | undefined;
  let teardownFailed = false;
  let running: Promise<DrainResult> | undefined;
  let current:
    | { id: string; controller: AbortController; aborted: boolean }
    | undefined;

  // The child stays owned until its group is proven gone, so a failed teardown
  // can be retried against the same group.
  const stopChild = (): Promise<TeardownResult> => {
    if (stopPending) return stopPending;
    const owned = child;
    if (!owned) return Promise.resolve({ ok: true });
    stopPending = stopGroup(owned, config.deadlines).then((result) => {
      stopPending = undefined;
      teardownFailed = !result.ok;
      if (result.ok && child === owned) child = undefined;
      return result;
    });
    return stopPending;
  };

  async function ensureReady(): Promise<Ready> {
    if (teardownFailed || stopPending || child?.exited) {
      const stopped = await stopChild();
      if (!stopped.ok)
        return { ok: false, kind: "failed", error: stopped.message };
    }
    if (child && !child.exited) return { ok: true };
    if (process.platform === "win32")
      return {
        ok: false,
        kind: "unavailable",
        reason:
          "process-group teardown is only implemented for POSIX platforms",
      };
    if (!verified) {
      const checked = await verifyArtifacts(config.artifactRoot, profile);
      if (!checked.ok)
        return { ok: false, kind: "unavailable", reason: checked.reason };
      verified = checked;
    }
    if (!(await portFree(config.port)))
      return {
        ok: false,
        kind: "unavailable",
        reason: `endpoint 127.0.0.1:${config.port} is already in use; refusing to use a server this runtime did not start`,
      };
    const args = [
      "--listen-ip",
      "127.0.0.1",
      "--listen-port",
      String(config.port),
      ...verified.components.flatMap((c) => [
        ROLE_FLAGS[c.role] as string,
        c.path,
      ]),
      ...profile.serverFlags,
    ];
    const launched = await launch(verified.binary, args, config.env ?? {});
    if (!launched.ok)
      return launched.kind === "unavailable"
        ? { ok: false, kind: "unavailable", reason: launched.message }
        : { ok: false, kind: "failed", error: launched.message };
    child = launched.child;
    const problem = await waitReady(launched.child, config.port, config);
    if (problem !== undefined) {
      await stopChild();
      return { ok: false, kind: "failed", error: problem };
    }
    return { ok: true };
  }

  async function runJob(record: JobRecord): Promise<Attempt> {
    const { source, job } = record;
    const started = session.start(job.id);
    if (!started.ok) return unsettled(started);
    const fail = (error: string): Attempt => {
      const result = session.fail(job.id, error);
      if (!result.ok) return unsettled(result);
      return {
        kind: "result",
        result: { jobId: job.id, outcome: "failed", error },
      };
    };

    const stored = session.store.readRequest(source.requestId);
    if (stored.kind !== "found")
      return fail(`request record ${source.requestId} is missing or invalid`);
    const spec = buildSpec(config.content, stored.value.request);
    if (!spec.ok)
      return fail(
        `cannot rebuild the generation spec: ${JSON.stringify(spec.error)}`,
      );
    const seed = job.request.seed;
    if (seed === undefined) return fail("the job request has no seed");
    const input = adapterInput(spec.value, source.slotKey, seed);
    if (!input.ok) return fail(JSON.stringify(input.error));

    const mine = {
      id: job.id,
      controller: new AbortController(),
      aborted: false,
    };
    current = mine;
    let generated: Generated;
    try {
      generated = await generate(
        config.port,
        {
          prompt: input.value.prompt,
          negative_prompt: input.value.negativePrompt,
          width: input.value.width,
          height: input.value.height,
          seed: input.value.seed,
          batch_count: 1,
          sample_params: {
            sample_method: input.value.sampleMethod,
            sample_steps: input.value.sampleSteps,
            guidance: { txt_cfg: input.value.txtCfg },
          },
          lora: [],
          output_format: "png",
        },
        config,
        mine.controller.signal,
      );
    } finally {
      current = undefined;
    }

    if (mine.aborted || generated.kind === "aborted")
      return { kind: "result", result: { jobId: job.id, outcome: "aborted" } };
    if (generated.kind === "client-failed") {
      const failed = fail(generated.message);
      await stopChild();
      return failed;
    }
    if (generated.kind === "server-failed") return fail(generated.message);

    const decoded = decodePng(generated.bytes);
    if (!decoded.ok) return fail(`${decoded.code}: ${decoded.message}`);
    const { width, height } = decoded.image;
    if (width !== spec.value.generated.w || height !== spec.value.generated.h)
      return fail(
        `the image is ${width}x${height}, expected ${spec.value.generated.w}x${spec.value.generated.h}`,
      );
    let hash: ImageOutput["hash"];
    try {
      hash = session.store.putBlob(generated.bytes);
    } catch (error) {
      return fail(`could not store the image: ${(error as Error).message}`);
    }
    const output: ImageOutput = { medium: "image", hash, width, height };
    const done = session.succeed(job.id, [output]);
    if (!done.ok) return unsettled(done);
    return {
      kind: "result",
      result: {
        jobId: job.id,
        outcome: "succeeded",
        output,
        image: decoded.image,
      },
    };
  }

  async function run(): Promise<DrainResult> {
    const results: JobResult[] = [];
    const stop = (stopped: DrainStop): DrainResult => ({
      ok: true,
      results,
      stopped,
    });
    for (let first = true; ; first = false) {
      if (closing) return stop("closing");
      const queue = session.queued();
      if (!queue.ok)
        return first
          ? { ok: false, reason: "closed", message: queue.message }
          : stop("session-closed");
      if (queue.jobs.length === 0) return stop("empty");

      const ready = await ensureReady();
      if (!ready.ok) {
        const fresh = session.queued();
        if (!fresh.ok) return stop("session-closed");
        if (ready.kind === "unavailable") {
          const guidance = staging(config.artifactRoot);
          for (const { job } of fresh.jobs) {
            const recorded = session.unavailable(
              job.id,
              ready.reason,
              guidance,
            );
            if (!recorded.ok) {
              const refusal = unsettled(recorded);
              if (refusal.kind === "session-closed")
                return stop("session-closed");
              if (refusal.kind === "refused")
                return {
                  ok: false,
                  reason: "write-failed",
                  message: refusal.message,
                };
              continue;
            }
            results.push({
              jobId: job.id,
              outcome: "unavailable",
              reason: ready.reason,
              staging: guidance,
            });
          }
          return stop("unavailable");
        }
        const next = fresh.jobs[0];
        if (next) {
          const started = session.start(next.job.id);
          const recorded = started.ok
            ? session.fail(next.job.id, ready.error)
            : started;
          if (!recorded.ok) {
            const refusal = unsettled(recorded);
            if (refusal.kind === "session-closed")
              return stop("session-closed");
            if (refusal.kind === "refused")
              return {
                ok: false,
                reason: "write-failed",
                message: refusal.message,
              };
          } else {
            results.push({
              jobId: next.job.id,
              outcome: "failed",
              error: ready.error,
            });
          }
        }
        return stop("start-failed");
      }
      if (closing) return stop("closing");

      const fresh = session.queued();
      if (!fresh.ok) return stop("session-closed");
      const next = fresh.jobs[0];
      if (!next) continue;
      const attempt = await runJob(next);
      if (attempt.kind === "session-closed") return stop("session-closed");
      if (attempt.kind === "refused")
        return { ok: false, reason: "write-failed", message: attempt.message };
      if (attempt.kind === "result") results.push(attempt.result);
    }
  }

  return {
    async drain() {
      if (closed)
        return {
          ok: false,
          reason: "closed",
          message: "the runtime is closed",
        };
      if (running)
        return {
          ok: false,
          reason: "busy",
          message: "a drain is already running",
        };
      running = run();
      try {
        return await running;
      } finally {
        running = undefined;
      }
    },

    async abort(jobId) {
      if (closed)
        return {
          ok: false,
          reason: "closed",
          message: "the runtime is closed",
        };
      const job = current;
      if (!job || job.id !== jobId)
        return {
          ok: false,
          reason: "not-running",
          message: `job ${jobId} is not running here`,
        };
      const cancelled = session.abort(jobId);
      if (!cancelled.ok)
        return {
          ok: false,
          reason:
            cancelled.reason === "closed"
              ? "closed"
              : cancelled.reason === "write-failed"
                ? "write-failed"
                : "not-running",
          message: cancelled.message,
        };
      job.aborted = true;
      job.controller.abort();
      return stopChild();
    },

    async close() {
      closed = true;
      closing = true;
      const job = current;
      if (job) {
        session.abort(job.id);
        job.aborted = true;
        job.controller.abort();
      }
      if (running) await running.catch(() => undefined);
      return stopChild();
    },

    async shutdown() {
      const result = await this.close();
      if (result.ok) session.close();
      return result;
    },
  };
}
