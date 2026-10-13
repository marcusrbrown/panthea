// The local engine runtime for one studio session: it verifies the configured
// artifacts, owns at most one engine child (sd-server or Blender) in its own
// process group, drains the session's queue one job at a time (a consecutive run
// of render jobs shares one Blender process), and records every transition
// through the session's single ledger.
//
// Ownership rules: the child is spawned detached so its process group is its
// own, and a group is only ever signalled after that ownership was checked, so
// the whole family (including grandchildren that hold its pipes) is torn down
// without touching anything else. A job's cancellation never relies on the
// engine's own API: aborting kills the child and a fresh one starts before the
// next job, and nothing a stopped child produces afterwards is stored.
//
// Only one engine is live at a time (16 GiB: sd-server and Blender were never
// measured loaded together), and at critical memory pressure no engine is
// launched. An unavailable engine fails only the jobs of its own provider.
//
// Process groups are POSIX: this module reports the runtime unavailable on
// other platforms. Groups, signals and `ps` were verified on macOS only.

import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import type { GenerationEdit, ImageOutput, Sha256 } from "@panthea/contracts";
import type { RgbaImage } from "../conformance";
import { createRenderEngine, type RenderEngineConfig } from "../render/engine";
import { editSettings, imgGenBody, resolveEdit } from "./edit";
import {
  type Attempt,
  type Engine,
  type Ready,
  type Running,
  unsettled,
} from "./engine";
import { registryFrameReader } from "./frame-ref";
import { matchesPin } from "./hash-file";
import { decodePng } from "./png/decode";
import {
  launch,
  type OwnedChild,
  stopGroup,
  type TeardownResult,
  tailOf,
} from "./process";
import { PROVIDER, SELECTED_PROFILE, type SelectedProfile } from "./provider";
import { adapterInput, buildSpec, type StudioContent } from "./request";
import type { StudioSession } from "./session";
import type { JobRecord } from "./store";
import { parseEngineFacts } from "./workspace";

export type { TeardownResult } from "./process";

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
  /** The committed registry a masked edit's published frame is read from; without it such an edit cannot run. */
  readonly registryRoot?: string;
  readonly deadlines: RuntimeDeadlines;
  readonly pollMs: number;
  readonly profile?: SelectedProfile;
  /** The child's whole environment; the parent's is never inherited. */
  readonly env?: Readonly<Record<string, string>>;
  /** The render engine; absent means render jobs are not runnable here. */
  readonly render?: RenderEngineConfig;
  /** Reads the system memory pressure level; at 4 (critical) no engine is launched. Absent means no guard. */
  readonly pressure?: () => number | undefined;
}

export type JobResult =
  | {
      readonly jobId: string;
      readonly outcome: "succeeded";
      readonly output: ImageOutput;
      readonly image: RgbaImage;
    }
  | {
      /** A render job: every frame post-processed and stored, with the role manifest. */
      readonly jobId: string;
      readonly outcome: "rendered";
      readonly outputs: readonly ImageOutput[];
      readonly manifest: Sha256;
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
  | "session-closed"
  /** Memory pressure is critical: nothing was launched and the head job is still queued. */
  | "deferred";

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
      /** What to do about a drain that stopped with work left (deferred). */
      readonly guidance?: string;
    }
  | RuntimeRefusal;

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
  | { readonly ok: false; readonly reason: string }
  | { readonly ok: false; readonly aborted: true };

/** The size is checked first, every time; the hash is cached (see hash-file.ts). */
async function verifyArtifacts(
  root: string,
  profile: SelectedProfile,
  signal?: AbortSignal,
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
    const pin = await matchesPin(check.path, check.sha256, signal);
    if (pin.kind === "aborted") return { ok: false, aborted: true };
    if (pin.kind === "mismatch")
      problems.push(
        `${check.label} sha256 ${pin.actual} does not match the pinned ${check.sha256}`,
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

/** Undefined when the server answered; a message when it did not. An aborted wait returns whatever it had: the caller checks the signal first. */
async function waitReady(
  child: OwnedChild,
  port: number,
  config: RuntimeConfig,
  signal: AbortSignal,
): Promise<string | undefined> {
  const end = Date.now() + config.deadlines.startupMs;
  const died = () =>
    `the server exited before it was ready (${child.error ? child.error.message : child.exit}).${tailOf(child)}`;
  while (Date.now() < end && !signal.aborted) {
    if (child.exited) return died();
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/sdcpp/v1/capabilities`,
        {
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(
              Math.max(1, Math.min(config.deadlines.httpMs, end - Date.now())),
            ),
          ]),
        },
      );
      if (child.exited) return died();
      if (response.ok && isRecord(await response.json())) {
        return child.exited ? died() : undefined;
      }
    } catch {
      // not listening yet
    }
    await sleepUnlessAborted(config.pollMs, signal);
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

const ENGINE_ROLES: Record<string, "model" | "encoder" | "vae"> = {
  "diffusion-model": "model",
  "text-encoder": "encoder",
  vae: "vae",
};

/** The scalar settings the server was actually sent; the seed lives on the request. */
interface SentBody {
  readonly prompt: string;
  readonly negative_prompt: string;
  readonly width: number;
  readonly height: number;
  readonly batch_count: number;
  readonly sample_params: {
    readonly sample_method: string;
    readonly sample_steps: number;
    readonly guidance: {
      readonly txt_cfg: number;
      readonly distilled_guidance?: number;
    };
  };
  readonly output_format: string;
}

/** Facts about the engine this runtime launched, whose artifacts it hash-verified before the launch. */
export function engineFor(
  profile: SelectedProfile,
  body: SentBody,
  edit: GenerationEdit | undefined,
) {
  const ref = (role: string) => {
    const component = profile.components.find((c) => c.role === role);
    return component === undefined
      ? null
      : { id: component.id, sha256: component.sha256 };
  };
  return parseEngineFacts(
    {
      runtime: { name: profile.runtime.id, version: profile.runtime.commit },
      runtimeBinarySha256: profile.runtime.binary.sha256,
      model: ref("diffusion-model"),
      loras: [],
      encoder: ref("text-encoder"),
      vae: ref("vae"),
      licences: [
        {
          subject: profile.runtime.id,
          role: "runtime",
          licence: profile.runtime.license,
        },
        ...profile.components.map((c) => ({
          subject: c.id,
          role: ENGINE_ROLES[c.role],
          licence: c.license,
        })),
      ],
      settings: {
        prompt: body.prompt,
        negative_prompt: body.negative_prompt,
        width: body.width,
        height: body.height,
        batch_count: body.batch_count,
        sample_method: body.sample_params.sample_method,
        sample_steps: body.sample_params.sample_steps,
        txt_cfg: body.sample_params.guidance.txt_cfg,
        ...(body.sample_params.guidance.distilled_guidance === undefined
          ? {}
          : {
              distilled_guidance:
                body.sample_params.guidance.distilled_guidance,
            }),
        output_format: body.output_format,
        ...(edit === undefined ? {} : editSettings(edit)),
      },
    },
    "engine",
  );
}

/** macOS memory pressure level (1 normal, 2 warning, 4 critical); undefined where it cannot be read. */
export function systemMemoryPressure(): number | undefined {
  if (process.platform !== "darwin") return undefined;
  const read = spawnSync(
    "sysctl",
    ["-n", "kern.memorystatus_vm_pressure_level"],
    { encoding: "utf8" },
  );
  const level = Number(read.stdout?.trim());
  return Number.isInteger(level) ? level : undefined;
}

/** The pressure level at which no engine is launched. */
export const CRITICAL_PRESSURE = 4;

const PRESSURE_GUIDANCE =
  "System memory pressure is critical: no engine is launched and the job stays queued. Free memory (quit other apps); the queue resumes by itself.";

/** The image engine: one sd-server child, kept across jobs, driven through its native async API. */
function createImageEngine(
  session: StudioSession,
  config: RuntimeConfig,
  profile: SelectedProfile,
): Engine {
  let child: OwnedChild | undefined;
  let verified: Extract<Verified, { ok: true }> | undefined;
  let stopPending: Promise<TeardownResult> | undefined;
  let teardownFailed = false;

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

  async function ensureReady(running: Running): Promise<Ready> {
    const signal = running.controller.signal;
    const aborted: Ready = { ok: false, kind: "aborted" };
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
      const checked = await verifyArtifacts(
        config.artifactRoot,
        profile,
        signal,
      );
      if (!checked.ok) {
        if ("aborted" in checked) return aborted;
        return { ok: false, kind: "unavailable", reason: checked.reason };
      }
      verified = checked;
    }
    if (signal.aborted) return aborted;
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
    if (signal.aborted) {
      await stopChild();
      return aborted;
    }
    const problem = await waitReady(
      launched.child,
      config.port,
      config,
      signal,
    );
    if (signal.aborted) {
      await stopChild();
      return aborted;
    }
    if (problem !== undefined) {
      await stopChild();
      return { ok: false, kind: "failed", error: problem };
    }
    return { ok: true };
  }

  async function runJob(record: JobRecord, mine: Running): Promise<Attempt> {
    const { source, job } = record;
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

    let resolved: ReturnType<typeof resolveEdit> | undefined;
    if (spec.value.edit !== undefined) {
      resolved = resolveEdit(spec.value.edit, spec.value.generated, {
        readJob: session.store.readJob,
        readBlob: session.store.readBlob,
        ...(config.registryRoot === undefined
          ? {}
          : {
              readFrame: registryFrameReader(
                config.registryRoot,
                config.content.vocabulary,
              ),
            }),
      });
      if (!resolved.ok)
        return fail(`the edit cannot run: ${JSON.stringify(resolved.error)}`);
    }
    const body = imgGenBody(
      input.value,
      resolved?.ok ? resolved.value : undefined,
    );
    const generated = await generate(
      config.port,
      body,
      config,
      mine.controller.signal,
    );

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
    const engine = engineFor(profile, body, spec.value.edit);
    if (!engine.ok)
      return fail(`the engine facts cannot be recorded: ${engine.message}`);
    const done = session.succeed(job.id, [output], engine.value);
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

  return {
    provider: PROVIDER.id,
    guidance: staging(config.artifactRoot),
    batchOf: (queue) => queue.slice(0, 1),
    ready: ensureReady,
    async run(batch, running) {
      return [await runJob(batch[0] as JobRecord, running)];
    },
    live: () => child !== undefined && !child.exited,
    stop: stopChild,
  };
}

export function openRuntime(
  session: StudioSession,
  config: RuntimeConfig,
): StudioRuntime {
  const profile = config.profile ?? SELECTED_PROFILE;
  let closed = false;
  let closing = false;
  let running: Promise<DrainResult> | undefined;
  let current: Running | undefined;
  let active: Engine | undefined;
  // The phases before a job runs (hashing, launch, version check) are covered by the job's own
  // controller: the drain starts the job first, so an abort addresses it from the first moment.
  const engines: readonly Engine[] = [
    createImageEngine(session, config, profile),
    ...(config.render === undefined
      ? []
      : [createRenderEngine(session, config, config.render)]),
  ];
  const track = (id: string): Running => {
    current = { id, controller: new AbortController(), aborted: false };
    return current;
  };

  async function run(): Promise<DrainResult> {
    const results: JobResult[] = [];
    let unavailableSeen = false;
    const stop = (stopped: DrainStop, guidance?: string): DrainResult => ({
      ok: true,
      results,
      stopped,
      ...(guidance === undefined ? {} : { guidance }),
    });
    const refusedWrite = (message: string): DrainResult => ({
      ok: false,
      reason: "write-failed",
      message,
    });

    /** Marks the running job (if given) and every queued job of the provider unavailable. Undefined when the drain goes on. */
    const markUnavailable = (
      provider: string,
      reason: string,
      guidance: string,
      runningId?: string,
    ): DrainResult | undefined => {
      unavailableSeen = true;
      const fresh = session.queued();
      if (!fresh.ok) return stop("session-closed");
      const ids = [
        ...(runningId === undefined ? [] : [runningId]),
        ...fresh.jobs
          .filter(({ job }) => job.provider.id === provider)
          .map(({ job }) => job.id),
      ];
      for (const id of ids) {
        const recorded = session.unavailable(id, reason, guidance);
        if (!recorded.ok) {
          const refusal = unsettled(recorded);
          if (refusal.kind === "session-closed") return stop("session-closed");
          if (refusal.kind === "refused") return refusedWrite(refusal.message);
          continue;
        }
        results.push({
          jobId: id,
          outcome: "unavailable",
          reason,
          staging: guidance,
        });
      }
      return undefined;
    };

    for (let first = true; ; first = false) {
      if (closing) return stop("closing");
      const queue = session.queued();
      if (!queue.ok)
        return first
          ? { ok: false, reason: "closed", message: queue.message }
          : stop("session-closed");
      const head = queue.jobs[0];
      if (head === undefined)
        return stop(unavailableSeen ? "unavailable" : "empty");

      const engine = engines.find((e) => e.provider === head.job.provider.id);
      if (engine === undefined) {
        // No engine is configured for this provider: its jobs are unavailable, nothing else is.
        const ended = markUnavailable(
          head.job.provider.id,
          `no engine is configured for provider ${head.job.provider.id}`,
          `Configure the engine for provider ${head.job.provider.id} (the studio config's render section runs blender-eevee); nothing is downloaded and no other engine is tried.`,
        );
        if (ended) return ended;
        continue;
      }

      // Only one engine is ever live: the other stops before this one launches.
      for (const other of engines) {
        if (other === engine || !other.live()) continue;
        const stopped = await other.stop();
        if (!stopped.ok) {
          const started = session.start(head.job.id);
          if (started.ok) {
            session.fail(head.job.id, stopped.message);
            results.push({
              jobId: head.job.id,
              outcome: "failed",
              error: stopped.message,
            });
          }
          return stop("start-failed");
        }
      }
      if (closing) return stop("closing");

      // The memory guard: at critical pressure nothing is launched and the job stays queued.
      if (!engine.live() && (config.pressure?.() ?? 0) >= CRITICAL_PRESSURE)
        return stop("deferred", PRESSURE_GUIDANCE);

      const batch = engine.batchOf(queue.jobs);
      const started = session.start(head.job.id);
      if (!started.ok) {
        const refusal = unsettled(started);
        if (refusal.kind === "session-closed") return stop("session-closed");
        if (refusal.kind === "refused") return refusedWrite(refusal.message);
        continue;
      }
      const running_ = track(head.job.id);
      active = engine;
      const ready = await engine.ready(running_);
      if (!ready.ok) {
        current = undefined;
        active = undefined;
        if (ready.kind === "aborted") {
          results.push({ jobId: head.job.id, outcome: "aborted" });
          continue;
        }
        if (ready.kind === "unavailable") {
          const ended = markUnavailable(
            engine.provider,
            ready.reason,
            engine.guidance,
            head.job.id,
          );
          if (ended) return ended;
          continue;
        }
        const recorded = session.fail(head.job.id, ready.error);
        if (!recorded.ok) {
          const refusal = unsettled(recorded);
          if (refusal.kind === "session-closed") return stop("session-closed");
          if (refusal.kind === "refused") return refusedWrite(refusal.message);
        } else {
          results.push({
            jobId: head.job.id,
            outcome: "failed",
            error: ready.error,
          });
        }
        return stop("start-failed");
      }

      const attempts = await engine.run(batch, running_, track);
      current = undefined;
      active = undefined;
      for (const attempt of attempts) {
        if (attempt.kind === "session-closed") return stop("session-closed");
        if (attempt.kind === "refused") return refusedWrite(attempt.message);
        if (attempt.kind === "result") results.push(attempt.result);
        if (attempt.kind === "unavailable") {
          const ended = markUnavailable(
            engine.provider,
            attempt.reason,
            engine.guidance,
            attempt.jobId,
          );
          if (ended) return ended;
        }
      }
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
      return (await active?.stop()) ?? { ok: true };
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
      // The live engine's process group goes first, so a drain that is hashing, launching or
      // rendering ends inside the stop bound; only then is the drain awaited.
      await Promise.all(engines.map((e) => e.stop()));
      if (running) await running.catch(() => undefined);
      for (const engine of engines) {
        const stopped = await engine.stop();
        if (!stopped.ok) return stopped;
      }
      return { ok: true };
    },

    async shutdown() {
      const result = await this.close();
      if (result.ok) session.close();
      return result;
    },
  };
}
