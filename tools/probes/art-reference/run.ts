// Reference-conditioning probe driver (plan unit U1).
//
// Builds `ref_images` request bodies for the pinned sd-server (master-929-3f8527a)
// and runs the four probe jobs one at a time. Every side effect (HTTP, clock,
// sleeping, RSS sampling, file output) is injected, so the tests run it with no
// server and no real timers. The CLI at the bottom wires the real ones.
//
//   bun tools/probes/art-reference/run.ts --pid <sd-server pid> \
//     [--base-url http://127.0.0.1:18451] [--out .context/studio-pipeline/art-reference] \
//     [--data-url] [--only <run id>] [--variant <label>]

import { createHash } from "node:crypto";
import {
  access,
  appendFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const SEED = 20261011;
export const WIDTH = 512;
export const HEIGHT = 640;
export const POLL_MS = 1000;
/** Per-job ceiling; the NO-GO bound for two references is 1,800 s, so this never cuts a valid run short. */
export const JOB_TIMEOUT_MS = 2_400_000;

export const ROUTES = {
  capabilities: "/sdcpp/v1/capabilities",
  imgGen: "/sdcpp/v1/img_gen",
  job: (id: string) => `/sdcpp/v1/jobs/${encodeURIComponent(id)}`,
} as const;

export interface Settings {
  readonly steps: number;
  readonly txtCfg: number;
  readonly imgCfg: number;
  readonly sampleMethod: string;
}

/** `docs/flux2.md` at the pin: klein base 4B uses cfg 4.0 and 20 steps. img_cfg 4 matches A2's `--img-cfg-scale 4`. */
export const DEFAULT_SETTINGS: Settings = {
  steps: 20,
  txtCfg: 4,
  imgCfg: 4,
  sampleMethod: "euler",
};

export const NEGATIVE_PROMPT =
  "different person, changed costume, altered face, blurry, antialiasing, smooth gradients, photograph, 3d render, text, watermark";

const STYLE =
  "low-resolution pixel art game sprite, full body, limited colour palette, flat shading, hard pixel edges, plain flat background";
const CHARACTER =
  "Zeus, king of the Greek gods, an aged noble man with swept-back silver hair and a long flowing white beard, a cream-white himation draped over one shoulder with a gold band at the waist, holding a gold thunderbolt in his raised right hand";
const FACING = `${STYLE}: ${CHARACTER}, standing, turned to face left in side view (west)`;
const POSE = `${STYLE}: ${CHARACTER}, seated on a plain stone seat, front view`;
const KEEP_ONE =
  "Keep the same character, costume, colours and pixel art style as the reference image. ";
const KEEP_TWO =
  "Keep the same character, costume, colours and pixel art style as the reference images. ";

export type RefName = "idle" | "seated";

export interface RunSpec {
  readonly id: string;
  readonly prompt: string;
  readonly refs: readonly RefName[];
}

export const RUNS: readonly RunSpec[] = [
  { id: "baseline", prompt: FACING, refs: [] },
  { id: "facing-1ref", prompt: KEEP_ONE + FACING, refs: ["idle"] },
  { id: "pose-1ref", prompt: KEEP_ONE + POSE, refs: ["idle"] },
  { id: "facing-2ref", prompt: KEEP_TWO + FACING, refs: ["idle", "seated"] },
];

export interface ImgGenParams {
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly settings: Settings;
}

export type RefFormat = "base64" | "data-url";

/** Raw base64 or a PNG data URL; both are accepted by the pinned api.md. */
export function encodeRef(png: Uint8Array, format: RefFormat): string {
  const b64 = Buffer.from(png).toString("base64");
  return format === "data-url" ? `data:image/png;base64,${b64}` : b64;
}

/**
 * The `img_gen` body. Key order is fixed and the output depends only on the
 * inputs, so the same PNG bytes always give byte-identical JSON. An empty
 * reference list omits `ref_images` (the no-reference baseline).
 */
export function buildImgGenBody(
  params: ImgGenParams,
  refs: readonly Uint8Array[],
  format: RefFormat = "base64",
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    negative_prompt: params.negativePrompt ?? "",
    width: params.width,
    height: params.height,
    seed: params.seed,
    batch_count: 1,
  };
  if (refs.length > 0) {
    body.ref_images = refs.map((png) => encodeRef(png, format));
  }
  body.lora = [];
  body.sample_params = {
    sample_method: params.settings.sampleMethod,
    sample_steps: params.settings.steps,
    guidance: {
      txt_cfg: params.settings.txtCfg,
      img_cfg: params.settings.imgCfg,
    },
  };
  body.output_format = "png";
  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type CapabilityCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** The server must advertise `ref_images` for img_gen (top-level features and the per-mode table when present). */
export function checkCapabilities(raw: unknown): CapabilityCheck {
  if (!isRecord(raw)) {
    return { ok: false, reason: "capabilities response is not an object" };
  }
  const features = raw.features;
  if (!isRecord(features) || features.ref_images !== true) {
    return {
      ok: false,
      reason: "capabilities.features.ref_images is not true",
    };
  }
  const byMode = raw.features_by_mode;
  if (isRecord(byMode) && isRecord(byMode.img_gen)) {
    if (byMode.img_gen.ref_images !== true) {
      return {
        ok: false,
        reason: "capabilities.features_by_mode.img_gen.ref_images is not true",
      };
    }
  }
  return { ok: true };
}

export interface FetchResult {
  readonly status: number;
  readonly text: string;
}

export interface Deps {
  readonly http: (
    method: "GET" | "POST",
    path: string,
    body?: string,
  ) => Promise<FetchResult>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  /** Server process RSS in KiB, or null when unreadable. */
  readonly readRssKiB: () => Promise<number | null>;
  readonly readRef: (name: RefName) => Promise<Uint8Array>;
  readonly write: (name: string, bytes: Uint8Array) => Promise<void>;
  readonly log: (record: Record<string, unknown>) => Promise<void>;
  /** True when the run's output already exists (resume after a restart). */
  readonly exists: (name: string) => Promise<boolean>;
}

export interface RunRecord {
  readonly id: string;
  readonly refs: readonly RefName[];
  readonly refFormat: RefFormat;
  readonly bodySha256: string;
  readonly refSha256: readonly string[];
  readonly prompt: string;
  readonly settings: Settings;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly latencySeconds: number;
  readonly peakRssKiB: number | null;
  readonly rssSamples: number;
  readonly output: string;
  readonly outputSha256: string;
  readonly jobId: string;
}

export type ProbeResult =
  | {
      readonly status: "stopped";
      readonly reason: string;
      readonly jobsSubmitted: 0;
    }
  | {
      readonly status: "completed";
      readonly records: readonly RunRecord[];
      readonly skipped: readonly string[];
    }
  | {
      readonly status: "failed";
      readonly runId: string;
      readonly reason: string;
      readonly records: readonly RunRecord[];
    };

const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function decodeImage(job: Record<string, unknown>): Uint8Array {
  const result = job.result;
  if (!isRecord(result) || !Array.isArray(result.images)) {
    throw new Error("completed job missing result.images array");
  }
  const first: unknown = result.images[0];
  if (!isRecord(first) || typeof first.b64_json !== "string") {
    throw new Error("image missing string b64_json");
  }
  const bytes = Uint8Array.from(Buffer.from(first.b64_json, "base64"));
  if (!PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) {
    throw new Error("image bytes are not a PNG");
  }
  return bytes;
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what} was not valid JSON`);
  }
}

export interface RunOptions {
  readonly format?: RefFormat;
  readonly settings?: Settings;
  readonly runs?: readonly RunSpec[];
  /** Appended to every output name, for a settings variant (for example `-v2`). */
  readonly variant?: string;
}

/**
 * Checks capabilities first and stops before any job when `ref_images` is
 * missing. Then runs each spec serially: submit, poll once per second sampling
 * RSS, record latency, peak RSS and the output hash.
 */
export async function runProbe(
  deps: Deps,
  options: RunOptions = {},
): Promise<ProbeResult> {
  const format = options.format ?? "base64";
  const settings = options.settings ?? DEFAULT_SETTINGS;
  const runs = options.runs ?? RUNS;
  const variant = options.variant ?? "";

  const caps = await deps.http("GET", ROUTES.capabilities);
  let verdict: CapabilityCheck;
  if (caps.status !== 200) {
    verdict = { ok: false, reason: `capabilities returned ${caps.status}` };
  } else {
    verdict = checkCapabilities(parseJson(caps.text, "capabilities"));
  }
  await deps.log({ event: "capabilities", status: caps.status, ...verdict });
  if (!verdict.ok) {
    return { status: "stopped", reason: verdict.reason, jobsSubmitted: 0 };
  }

  const records: RunRecord[] = [];
  const skipped: string[] = [];
  for (const spec of runs) {
    const outputName = `outputs/${spec.id}${variant}.png`;
    if (await deps.exists(outputName)) {
      skipped.push(spec.id);
      continue;
    }
    try {
      records.push(
        await runOne(deps, spec, format, settings, outputName, variant),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await deps.log({ event: "run-failed", id: spec.id, reason });
      return { status: "failed", runId: spec.id, reason, records };
    }
  }
  return { status: "completed", records, skipped };
}

async function runOne(
  deps: Deps,
  spec: RunSpec,
  format: RefFormat,
  settings: Settings,
  outputName: string,
  variant: string,
): Promise<RunRecord> {
  const refs = await Promise.all(spec.refs.map((name) => deps.readRef(name)));
  const body = JSON.stringify(
    buildImgGenBody(
      {
        prompt: spec.prompt,
        negativePrompt: NEGATIVE_PROMPT,
        seed: SEED,
        width: WIDTH,
        height: HEIGHT,
        settings,
      },
      refs,
      format,
    ),
  );
  const startedAt = deps.now();
  const submitted = await deps.http("POST", ROUTES.imgGen, body);
  const submission = parseJson(submitted.text, "job submission");
  if (
    submitted.status !== 202 ||
    !isRecord(submission) ||
    typeof submission.id !== "string"
  ) {
    throw new Error(
      `job submission rejected: status ${submitted.status}: ${submitted.text.slice(0, 300)}`,
    );
  }
  const jobId = submission.id;
  let peak: number | null = null;
  let samples = 0;
  for (;;) {
    if (deps.now() - startedAt > JOB_TIMEOUT_MS) {
      throw new Error(`job ${jobId} exceeded ${JOB_TIMEOUT_MS} ms`);
    }
    const rss = await deps.readRssKiB();
    if (rss !== null) {
      peak = peak === null ? rss : Math.max(peak, rss);
      samples += 1;
    }
    const polled = await deps.http("GET", ROUTES.job(jobId));
    const job = parseJson(polled.text, "job record");
    if (polled.status !== 200 || !isRecord(job)) {
      throw new Error(`job poll failed: status ${polled.status}`);
    }
    if (job.status === "completed") {
      const png = decodeImage(job);
      const latencySeconds = (deps.now() - startedAt) / 1000;
      await deps.write(outputName, png);
      const record: RunRecord = {
        id: spec.id + variant,
        refs: spec.refs,
        refFormat: format,
        bodySha256: sha256(body),
        refSha256: refs.map(sha256),
        prompt: spec.prompt,
        settings,
        seed: SEED,
        width: WIDTH,
        height: HEIGHT,
        latencySeconds,
        peakRssKiB: peak,
        rssSamples: samples,
        output: outputName,
        outputSha256: sha256(png),
        jobId,
      };
      await deps.log({ event: "run", ...record });
      return record;
    }
    if (job.status === "failed" || job.status === "cancelled") {
      const message =
        isRecord(job.error) && typeof job.error.message === "string"
          ? job.error.message
          : "no error message";
      throw new Error(`job ${job.status}: ${message}`);
    }
    if (job.status !== "queued" && job.status !== "generating") {
      throw new Error(`unrecognised job status ${JSON.stringify(job.status)}`);
    }
    await deps.sleep(POLL_MS);
  }
}

// --- CLI wiring: real HTTP, clock, ps and files -------------------------------------

function argValue(args: readonly string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
}

async function main(args: readonly string[]): Promise<number> {
  const repo = resolve(import.meta.dir, "../../..");
  const out = resolve(
    repo,
    argValue(args, "--out") ?? ".context/studio-pipeline/art-reference",
  );
  const baseUrl = argValue(args, "--base-url") ?? "http://127.0.0.1:18451";
  const pid = Number(argValue(args, "--pid"));
  const only = argValue(args, "--only");
  const variant = argValue(args, "--variant") ?? "";
  const format: RefFormat = args.includes("--data-url") ? "data-url" : "base64";
  const steps = argValue(args, "--steps");
  const cfg = argValue(args, "--cfg");
  const imgCfg = argValue(args, "--img-cfg");
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    steps: steps ? Number(steps) : DEFAULT_SETTINGS.steps,
    txtCfg: cfg ? Number(cfg) : DEFAULT_SETTINGS.txtCfg,
    imgCfg: imgCfg
      ? Number(imgCfg)
      : cfg
        ? Number(cfg)
        : DEFAULT_SETTINGS.imgCfg,
  };
  if (!Number.isInteger(pid) || pid <= 0) {
    console.error("--pid <sd-server pid> is required for the RSS sampler");
    return 2;
  }
  await mkdir(resolve(out, "outputs"), { recursive: true });
  const runLog = resolve(out, "runs.jsonl");
  const deps: Deps = {
    async http(method, path, body) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body,
      });
      return { status: response.status, text: await response.text() };
    },
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    now: () => performance.now(),
    async readRssKiB() {
      const ps = Bun.spawn(["ps", "-o", "rss=", "-p", String(pid)], {
        stdout: "pipe",
        stderr: "ignore",
      });
      const text = await new Response(ps.stdout).text();
      await ps.exited;
      const value = Number.parseInt(text.trim(), 10);
      return Number.isFinite(value) ? value : null;
    },
    async readRef(name) {
      return new Uint8Array(
        await readFile(resolve(out, "refs", `${name}-south-0-x8.png`)),
      );
    },
    async write(name, bytes) {
      const path = resolve(out, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
    async log(record) {
      await appendFile(
        runLog,
        `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`,
      );
    },
    async exists(name) {
      try {
        await access(resolve(out, name));
        return true;
      } catch {
        return false;
      }
    },
  };
  const result = await runProbe(deps, {
    format,
    settings,
    runs: only ? RUNS.filter((run) => run.id === only) : RUNS,
    variant,
  });
  console.log(JSON.stringify(result, null, 2));
  return result.status === "completed" ? 0 : 1;
}

if (import.meta.main) {
  process.exit(await main(Bun.argv.slice(2)));
}
