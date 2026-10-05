// sd-server native async API driver (capabilities / img_gen / jobs/{id}).
//
// Request-body field names and routes are CONFIGURABLE. The defaults match the
// native API at the pinned release master-929-3f8527a (api.md / main.cpp at
// that commit): POST img_gen answers 202 with {id, poll_url}, the lora entry
// shape is {path, multiplier, is_high_noise}, and the arm smoke runs confirm
// them against the real binary (see results/ evidence and the README).
// Response parsing (id, status, result.images[].b64_json) is the M0-observed
// shape, validated field by field so a schema drift fails loudly.

import type { ArmDriver, GenerateRequest } from "./run";

export interface LoraSpec {
  readonly path: string;
  readonly multiplier: number;
  readonly isHighNoise?: boolean;
}

export interface ImgGenParams {
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly width: number;
  readonly height: number;
  readonly seed: number | null;
  /** null builds the no-LoRA control (empty lora array). */
  readonly lora: LoraSpec | null;
  /** Passed through verbatim under the sample-params field. */
  readonly sampleParams: Readonly<Record<string, unknown>>;
}

export interface BodyShape {
  readonly fields: Readonly<
    Record<
      | "prompt"
      | "negativePrompt"
      | "width"
      | "height"
      | "seed"
      | "sampleParams"
      | "lora",
      string
    >
  >;
  /** Verbatim extra top-level fields. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

export const SD_ROUTES = {
  capabilities: "/sdcpp/v1/capabilities",
  imgGen: "/sdcpp/v1/img_gen",
  job: (id: string) => `/sdcpp/v1/jobs/${encodeURIComponent(id)}`,
} as const;

export const DEFAULT_BODY_SHAPE: BodyShape = {
  fields: {
    prompt: "prompt",
    negativePrompt: "negative_prompt",
    width: "width",
    height: "height",
    seed: "seed",
    sampleParams: "sample_params",
    lora: "lora",
  },
};

export function buildImgGenBody(
  params: ImgGenParams,
  shape: BodyShape = DEFAULT_BODY_SHAPE,
): Record<string, unknown> {
  const f = shape.fields;
  const body: Record<string, unknown> = {
    ...shape.extra,
    [f.prompt]: params.prompt,
    [f.width]: params.width,
    [f.height]: params.height,
    [f.sampleParams]: params.sampleParams,
    [f.lora]: params.lora
      ? [
          {
            path: params.lora.path,
            multiplier: params.lora.multiplier,
            is_high_noise: params.lora.isHighNoise ?? false,
          },
        ]
      : [],
  };
  if (params.negativePrompt !== undefined) {
    body[f.negativePrompt] = params.negativePrompt;
  }
  if (params.seed !== null) {
    body[f.seed] = params.seed;
  }
  return body;
}

export interface SdServerDriverConfig {
  readonly baseUrl: string;
  readonly makeBody: (request: GenerateRequest) => unknown;
  readonly pollMs?: number;
  /** Per-HTTP-request bound (default 10s). */
  readonly requestTimeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

async function requestJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const bound = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: signal ? AbortSignal.any([signal, bound]) : bound,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new Error("request aborted by caller");
    }
    throw new Error(
      `request failed: ${error instanceof Error ? error.message : String(error)} (server not reachable or timed out)`,
    );
  }
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    throw new Error(`response was not valid JSON (status ${response.status})`);
  }
  if (!response.ok) {
    throw new Error(
      `server returned ${response.status}: ${text.slice(0, 200)}`,
    );
  }
  return parsed;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted by caller"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted by caller"));
      },
      { once: true },
    );
  });

function decodeImage(job: Record<string, unknown>): Uint8Array {
  const result = job.result;
  if (!isRecord(result) || !Array.isArray(result.images)) {
    throw new Error(
      "completed job missing result.images array ($.result.images)",
    );
  }
  const first: unknown = result.images[0];
  if (first === undefined) {
    throw new Error("completed job has no images ($.result.images[0])");
  }
  if (!isRecord(first) || typeof first.b64_json !== "string") {
    throw new Error(
      "image missing string b64_json ($.result.images[0].b64_json)",
    );
  }
  const bytes = Uint8Array.from(Buffer.from(first.b64_json, "base64"));
  if (!PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) {
    throw new Error("image bytes are not a PNG");
  }
  return bytes;
}

export function createSdServerDriver(config: SdServerDriverConfig): ArmDriver {
  const pollMs = config.pollMs ?? 100;
  const requestTimeoutMs = config.requestTimeoutMs ?? 10_000;
  return {
    async generate(request) {
      const submission = await requestJson(
        `${config.baseUrl}${SD_ROUTES.imgGen}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(config.makeBody(request)),
        },
        requestTimeoutMs,
        request.signal,
      );
      if (!isRecord(submission) || typeof submission.id !== "string") {
        throw new Error("job submission missing string id ($.id)");
      }
      const jobUrl =
        typeof submission.poll_url === "string" &&
        submission.poll_url.startsWith("/")
          ? `${config.baseUrl}${submission.poll_url}`
          : `${config.baseUrl}${SD_ROUTES.job(submission.id)}`;
      for (;;) {
        const job = await requestJson(
          jobUrl,
          { method: "GET" },
          requestTimeoutMs,
          request.signal,
        );
        if (!isRecord(job)) {
          throw new Error("job record was not an object ($)");
        }
        switch (job.status) {
          case "completed":
            return decodeImage(job);
          case "failed":
          case "cancelled": {
            const message =
              isRecord(job.error) && typeof job.error.message === "string"
                ? job.error.message
                : "no error message";
            throw new Error(`job ${job.status}: ${message}`);
          }
          case "queued":
          case "generating":
            break;
          default:
            throw new Error(
              `unrecognized job status ${JSON.stringify(job.status)} ($.status)`,
            );
        }
        await sleep(pollMs, request.signal);
      }
    },
  };
}

export interface Capabilities {
  readonly raw: unknown;
  /** features_by_mode.img_gen.cancel_generating; null when absent. */
  readonly cancelGenerating: boolean | null;
}

/** Never throws; null when unreachable or not JSON. */
export async function fetchCapabilities(
  baseUrl: string,
  timeoutMs = 3_000,
): Promise<Capabilities | null> {
  try {
    const raw = await requestJson(
      `${baseUrl}${SD_ROUTES.capabilities}`,
      { method: "GET" },
      timeoutMs,
    );
    let cancelGenerating: boolean | null = null;
    if (isRecord(raw) && isRecord(raw.features_by_mode)) {
      const imgGen = raw.features_by_mode.img_gen;
      if (isRecord(imgGen) && typeof imgGen.cancel_generating === "boolean") {
        cancelGenerating = imgGen.cancel_generating;
      }
    }
    return { raw, cancelGenerating };
  } catch {
    return null;
  }
}
