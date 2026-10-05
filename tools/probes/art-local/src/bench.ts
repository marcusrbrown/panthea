// Bench harness shared by both arms: runs the sprite+portrait prompt set
// against a reachable arm, samples the generator process's RSS every
// 250ms, separates first-image warmup from steady-state seconds/image, and
// measures cancel-to-idle timing. Also builds the per-arm contact sheet
// (a small tiled PNG for the owner's review — no automated quality score).

import { inflateSync } from "node:zlib";
import { encodeRgbaPng } from "@panthea/assets";
import * as drawthings from "./drawthings";
import * as sdcpp from "./sdcpp";

export interface PromptFixture {
  readonly id: string;
  readonly kind: "sprite" | "portrait";
  readonly subject: string;
  readonly prompt: string;
  readonly negativePrompt?: string;
}

export type ArmName = "sd.cpp" | "draw-things";

export interface RssSample {
  readonly atMs: number;
  readonly rssKb: number;
}

export interface RssSampler {
  /** Stops sampling and returns the peak RSS observed (undefined if the pid never resolved). */
  stop(): {
    readonly peakKb: number | undefined;
    readonly samples: readonly RssSample[];
  };
}

function readRssKb(pid: number): number | undefined {
  try {
    const result = Bun.spawnSync(["ps", "-o", "rss=", "-p", String(pid)]);
    if (result.exitCode !== 0) {
      return undefined;
    }
    const text = result.stdout.toString().trim();
    const value = Number.parseInt(text, 10);
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function readCpuPercent(pid: number): number | undefined {
  try {
    const result = Bun.spawnSync(["ps", "-o", "%cpu=", "-p", String(pid)]);
    if (result.exitCode !== 0) {
      return undefined;
    }
    const value = Number.parseFloat(result.stdout.toString().trim());
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Polls a pid's RSS every `intervalMs` until `stop()` is called. Never throws. */
export function createRssSampler(pid: number, intervalMs = 250): RssSampler {
  const start = Date.now();
  const samples: RssSample[] = [];
  let peakKb: number | undefined;
  const timer = setInterval(() => {
    const rssKb = readRssKb(pid);
    if (rssKb !== undefined) {
      samples.push({ atMs: Date.now() - start, rssKb });
      peakKb = peakKb === undefined ? rssKb : Math.max(peakKb, rssKb);
    }
  }, intervalMs);
  // Bun/Node timers keep the process alive; unref so a bench run can still
  // exit if something goes wrong upstream and the sampler is never stopped.
  (timer as unknown as { unref?: () => void }).unref?.();
  return {
    stop() {
      clearInterval(timer);
      return { peakKb, samples };
    },
  };
}

/** Polls a pid's CPU% until it drops below `thresholdPercent` (or the pid is gone), bounded by `timeoutMs`. */
export async function waitForIdle(
  pid: number,
  options: {
    readonly thresholdPercent?: number;
    readonly timeoutMs?: number;
    readonly intervalMs?: number;
  } = {},
): Promise<{
  readonly idleAfterMs: number;
  readonly reason: "cpu-below-threshold" | "process-gone" | "timeout";
}> {
  const threshold = options.thresholdPercent ?? 5;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 250;
  const start = Date.now();
  for (;;) {
    const cpu = readCpuPercent(pid);
    if (cpu === undefined) {
      return { idleAfterMs: Date.now() - start, reason: "process-gone" };
    }
    if (cpu < threshold) {
      return { idleAfterMs: Date.now() - start, reason: "cpu-below-threshold" };
    }
    if (Date.now() - start >= timeoutMs) {
      return { idleAfterMs: Date.now() - start, reason: "timeout" };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export interface ImageOutcome {
  readonly promptId: string;
  readonly wallMs: number;
  readonly bytes: Uint8Array;
}

export interface ArmRunResult {
  readonly arm: ArmName;
  readonly model: string;
  readonly n: number;
  readonly warmupSeconds: number | undefined;
  readonly secondsPerImage: readonly number[];
  readonly peakRssMiB: number | undefined;
  readonly images: readonly ImageOutcome[];
  readonly errors: readonly {
    readonly promptId: string;
    readonly message: string;
  }[];
}

export interface SdCppArmOptions {
  readonly config: sdcpp.SdCppConfig;
  readonly model: string;
  readonly width: number;
  readonly height: number;
  readonly steps: number;
  readonly lora?: readonly sdcpp.LoraRef[];
  readonly rssPid?: number;
  readonly timeoutMs?: number;
}

/** Runs the full prompt set against the sd-server native async API. Never throws — per-image failures are recorded in `errors`. */
export async function runSdCppArm(
  prompts: readonly PromptFixture[],
  options: SdCppArmOptions,
): Promise<ArmRunResult> {
  const sampler = options.rssPid ? createRssSampler(options.rssPid) : undefined;
  const images: ImageOutcome[] = [];
  const errors: { promptId: string; message: string }[] = [];
  const seconds: number[] = [];
  let warmupSeconds: number | undefined;

  for (const prompt of prompts) {
    const startedAt = Date.now();
    try {
      const result = await sdcpp.generateImage(
        options.config,
        {
          prompt: prompt.prompt,
          negativePrompt: prompt.negativePrompt,
          width: options.width,
          height: options.height,
          steps: options.steps,
          lora: options.lora,
          timeoutMs: options.timeoutMs ?? 120_000,
        },
        { timeoutMs: options.timeoutMs ?? 120_000 },
      );
      const wallMs = Date.now() - startedAt;
      const firstImage = result.images[0];
      if (firstImage) {
        images.push({ promptId: prompt.id, wallMs, bytes: firstImage.bytes });
      }
      if (warmupSeconds === undefined) {
        warmupSeconds = wallMs / 1000;
      } else {
        seconds.push(wallMs / 1000);
      }
    } catch (error) {
      errors.push({
        promptId: prompt.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const rss = sampler?.stop();
  return {
    arm: "sd.cpp",
    model: options.model,
    n: prompts.length,
    warmupSeconds,
    secondsPerImage: seconds,
    peakRssMiB: rss?.peakKb !== undefined ? rss.peakKb / 1024 : undefined,
    images,
    errors,
  };
}

export interface DrawThingsArmOptions {
  readonly config: drawthings.DrawThingsConfig;
  readonly model: string;
  readonly width: number;
  readonly height: number;
  readonly steps: number;
  readonly rssPid?: number;
  readonly timeoutMs?: number;
}

/** Runs the full prompt set against Draw Things' synchronous txt2img endpoint. Never throws — per-image failures are recorded in `errors`. */
export async function runDrawThingsArm(
  prompts: readonly PromptFixture[],
  options: DrawThingsArmOptions,
): Promise<ArmRunResult> {
  const sampler = options.rssPid ? createRssSampler(options.rssPid) : undefined;
  const images: ImageOutcome[] = [];
  const errors: { promptId: string; message: string }[] = [];
  const seconds: number[] = [];
  let warmupSeconds: number | undefined;

  for (const prompt of prompts) {
    const startedAt = Date.now();
    try {
      const result = await drawthings.txt2img(options.config, {
        prompt: prompt.prompt,
        negativePrompt: prompt.negativePrompt,
        width: options.width,
        height: options.height,
        steps: options.steps,
        timeoutMs: options.timeoutMs ?? 120_000,
      });
      const wallMs = Date.now() - startedAt;
      const firstImage = result.images[0];
      if (firstImage) {
        images.push({ promptId: prompt.id, wallMs, bytes: firstImage });
      }
      if (warmupSeconds === undefined) {
        warmupSeconds = wallMs / 1000;
      } else {
        seconds.push(wallMs / 1000);
      }
    } catch (error) {
      errors.push({
        promptId: prompt.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const rss = sampler?.stop();
  return {
    arm: "draw-things",
    model: options.model,
    n: prompts.length,
    warmupSeconds,
    secondsPerImage: seconds,
    peakRssMiB: rss?.peakKb !== undefined ? rss.peakKb / 1024 : undefined,
    images,
    errors,
  };
}

/**
 * Discriminates how a cancellation attempt actually ended, so a caller (or
 * a test) never has to parse `note` prose to tell them apart:
 *
 * - `http-cancel`: the sd-server build supports `cancel_generating` and
 *   the job was cancelled over HTTP.
 * - `terminated`: the process-signal fallback confirmed the process is
 *   actually gone (`waitForIdle` reason `process-gone`) — the only
 *   outcome that counts as a real process-kill proxy.
 * - `idle-cpu`: the process is still alive but its CPU% dropped below the
 *   threshold — NOT a confirmed kill; SIGTERM may not have terminated it
 *   within the poll window, so this must not be reported as "supported".
 * - `timeout`: neither termination nor an idle CPU reading was observed
 *   within the poll window.
 * - `unsupported`: no cancellation path was available at all (missing
 *   `--rss-pid` for the signal fallback, a failed signal send, or the arm
 *   has no cancel mechanism, e.g. Draw Things).
 */
export type CancellationOutcome =
  | "http-cancel"
  | "terminated"
  | "idle-cpu"
  | "timeout"
  | "unsupported";

export interface CancellationResult {
  readonly supported: boolean;
  readonly outcome: CancellationOutcome;
  readonly cancelToIdleMs: number | undefined;
  readonly note: string;
}

/**
 * Starts a job and aborts it at ~30% of a previously-measured baseline
 * duration, then measures time-to-idle. Two paths, chosen by what this
 * server build actually supports (`GET /sdcpp/v1/capabilities`
 * `features_by_mode.img_gen.cancel_generating`), not assumed:
 *
 * - `cancel_generating: true`: `POST /sdcpp/v1/jobs/{id}/cancel` on the
 *   in-flight job, then poll it to a terminal state (job-level signal —
 *   clean and deterministic).
 * - `cancel_generating: false` (measured true of this probe's build): the
 *   HTTP cancel endpoint only works on a job still queued behind another,
 *   not one already generating, so this falls back to the plan's
 *   documented alternative — SIGINT the `sd-server` process itself
 *   (`options.serverPid` required) — and measures time-to-idle via CPU%,
 *   matching "coexistence-safe": how fast the process actually releases
 *   the GPU/RAM once asked to stop.
 */
export async function runSdCppCancellation(
  config: sdcpp.SdCppConfig,
  prompt: PromptFixture,
  options: {
    readonly width: number;
    readonly height: number;
    readonly steps: number;
    readonly baselineSeconds: number;
    readonly lora?: readonly sdcpp.LoraRef[];
    readonly serverPid?: number;
  },
): Promise<CancellationResult> {
  const features = await sdcpp.getImgGenFeatures(config);

  const submission = await sdcpp.submitImgGen(config, {
    prompt: prompt.prompt,
    negativePrompt: prompt.negativePrompt,
    width: options.width,
    height: options.height,
    steps: options.steps,
    lora: options.lora,
  });

  const abortAtMs = Math.max(200, options.baselineSeconds * 1000 * 0.3);
  await new Promise((resolve) => setTimeout(resolve, abortAtMs));

  if (features?.cancelGenerating) {
    const cancelStartedAt = Date.now();
    await sdcpp.cancelJob(config, submission.id);
    const job = await sdcpp.pollUntilDone(config, submission.id, {
      pollIntervalMs: 100,
      timeoutMs: 30_000,
    });
    const cancelToIdleMs = Date.now() - cancelStartedAt;
    // Only a job that ended in `cancelled` proves the cancel request took
    // effect; `completed` means the server finished before the cancel
    // landed and `failed` is not a cancellation either.
    const cancelled = job.status === "cancelled";
    return {
      supported: cancelled,
      outcome: "http-cancel",
      cancelToIdleMs,
      note: cancelled
        ? `HTTP cancel (cancel_generating supported), aborted at ~30% of baseline (${abortAtMs.toFixed(0)}ms), job reached 'cancelled'`
        : `HTTP cancel requested at ~30% of baseline (${abortAtMs.toFixed(0)}ms) but the job reached '${job.status}', not 'cancelled' — not counted as a successful cancellation`,
    };
  }

  return runSdCppSignalCancel(options.serverPid, abortAtMs, features);
}

/** Injectable seams for {@link runSdCppSignalCancel} so tests can fake the process signal and idle-wait without touching a real process. */
export interface SignalCancelDeps {
  readonly killProcess?: (pid: number, signal: NodeJS.Signals) => void;
  readonly waitForIdleImpl?: typeof waitForIdle;
}

/**
 * Maps a {@link waitForIdle} outcome to a {@link CancellationResult}. Pure
 * and separately exported so the outcome logic — only `process-gone`
 * counts as a confirmed process-kill proxy — is directly testable without
 * spawning or signaling a real process.
 */
export function mapIdleOutcomeToCancellationResult(
  idle: {
    readonly idleAfterMs: number;
    readonly reason: "cpu-below-threshold" | "process-gone" | "timeout";
  },
  cancelToIdleMs: number,
  baseNote: string,
): CancellationResult {
  if (idle.reason === "process-gone") {
    return {
      supported: true,
      outcome: "terminated",
      cancelToIdleMs,
      note: `${baseNote} Confirmed terminated (process gone) after ${cancelToIdleMs}ms — this is the process-kill proxy the cancel-to-idle number reflects.`,
    };
  }
  if (idle.reason === "cpu-below-threshold") {
    return {
      supported: false,
      outcome: "idle-cpu",
      cancelToIdleMs: undefined,
      note: `${baseNote} The process was still alive ${cancelToIdleMs}ms after SIGTERM, with CPU% below the 5% idle threshold — not a confirmed kill (SIGTERM may not have fully terminated it within the poll window), so this is NOT reported as a supported process-kill measurement.`,
    };
  }
  return {
    supported: false,
    outcome: "timeout",
    cancelToIdleMs: undefined,
    note: `${baseNote} The process neither terminated nor dropped below the 5% CPU idle threshold within the 30s poll window — cancellation could not be confirmed.`,
  };
}

export async function runSdCppSignalCancel(
  serverPid: number | undefined,
  abortAtMs: number,
  features: sdcpp.ImgGenFeatures | undefined,
  deps: SignalCancelDeps = {},
): Promise<CancellationResult> {
  if (!serverPid) {
    return {
      supported: false,
      outcome: "unsupported",
      cancelToIdleMs: undefined,
      note: `this sd-server build reports cancel_generating=false (only a still-queued job can be cancelled over HTTP, features: ${JSON.stringify(features)}) and no --rss-pid was given for the process-signal fallback, so cancellation could not be measured.`,
    };
  }
  const kill = deps.killProcess ?? ((pid, signal) => process.kill(pid, signal));
  const waitForIdleFn = deps.waitForIdleImpl ?? waitForIdle;
  const cancelStartedAt = Date.now();
  try {
    // SIGINT was tried first and measured to be silently ignored by this
    // sd-server build — the process kept running and even started its
    // next queued job after receiving it. SIGTERM reliably terminates it
    // (confirmed: process gone within one poll tick), so that is what this
    // probe actually uses for the process-level fallback.
    kill(serverPid, "SIGTERM");
  } catch (error) {
    return {
      supported: false,
      outcome: "unsupported",
      cancelToIdleMs: undefined,
      note: `SIGTERM to sd-server pid ${serverPid} failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const idle = await waitForIdleFn(serverPid, {
    thresholdPercent: 5,
    timeoutMs: 30_000,
  });
  const cancelToIdleMs = Date.now() - cancelStartedAt;
  const baseNote = `this sd-server build reports cancel_generating=false, so the in-flight job could not be cancelled over HTTP; SIGINT was tried first and measured to be silently ignored (the process kept running and started its next queued job), so this fell back to SIGTERM on the sd-server process (pid ${serverPid}) at ~30% of baseline (${abortAtMs.toFixed(0)}ms). SIGTERM ends the whole server, not just the one job — a real, coarser proxy for "how fast can the GPU be reclaimed by force" when the HTTP API cannot cancel an in-flight job.`;
  return mapIdleOutcomeToCancellationResult(idle, cancelToIdleMs, baseNote);
}

/** Draw Things exposes no cancel endpoint over HTTP — recorded, not worked around. */
export function drawThingsCancellationNotSupported(): CancellationResult {
  return {
    supported: false,
    outcome: "unsupported",
    cancelToIdleMs: undefined,
    note: "Draw Things' HTTP API (/sdapi/v1/txt2img) exposes no cancellation endpoint; a started job runs to completion or app-level user cancel only.",
  };
}

// --- Minimal PNG decoder + contact-sheet compositor ---
// Decodes the standard, non-interlaced 8-bit PNGs both arms return (RGB or
// RGBA), for tiling into a small contact sheet. Not a general-purpose PNG
// decoder — anything outside that shape is reported as a decode error for
// that one image rather than aborting the whole contact sheet.

interface DecodedPng {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(bytes: Uint8Array): DecodedPng {
  const signature = "89504e470d0a1a0a";
  if (Buffer.from(bytes.subarray(0, 8)).toString("hex") !== signature) {
    throw new Error("not a PNG (bad signature)");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatParts: Uint8Array[] = [];

  while (offset < bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    const length = view.getUint32(0, false);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = dv.getUint32(0, false);
      height = dv.getUint32(4, false);
      bitDepth = data[8]!;
      colorType = data[9]!;
      const interlace = data[12]!;
      if (bitDepth !== 8) {
        throw new Error(`unsupported PNG bit depth ${bitDepth}`);
      }
      if (interlace !== 0) {
        throw new Error("unsupported interlaced PNG");
      }
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 8 + length + 4; // length + type + data + crc
  }

  const channels =
    colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : undefined;
  if (channels === undefined) {
    throw new Error(`unsupported PNG color type ${colorType}`);
  }

  const totalIdat = new Uint8Array(
    idatParts.reduce((sum, part) => sum + part.length, 0),
  );
  let writeOffset = 0;
  for (const part of idatParts) {
    totalIdat.set(part, writeOffset);
    writeOffset += part.length;
  }
  const raw = inflateSync(totalIdat);

  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  const prevRow = new Uint8Array(stride);
  let rawOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filterType = raw[rawOffset]!;
    rawOffset += 1;
    const row = raw.subarray(rawOffset, rawOffset + stride);
    rawOffset += stride;
    const outRow = new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? outRow[x - channels]! : 0;
      const b = prevRow[x]!;
      const c = x >= channels ? prevRow[x - channels]! : 0;
      const raw8 = row[x]!;
      let value: number;
      switch (filterType) {
        case 0:
          value = raw8;
          break;
        case 1:
          value = (raw8 + a) & 0xff;
          break;
        case 2:
          value = (raw8 + b) & 0xff;
          break;
        case 3:
          value = (raw8 + Math.floor((a + b) / 2)) & 0xff;
          break;
        case 4:
          value = (raw8 + paeth(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`unsupported PNG filter type ${filterType}`);
      }
      outRow[x] = value;
    }
    for (let x = 0; x < width; x += 1) {
      const srcOffset = x * channels;
      const dstOffset = (y * width + x) * 4;
      if (channels === 4) {
        rgba[dstOffset] = outRow[srcOffset]!;
        rgba[dstOffset + 1] = outRow[srcOffset + 1]!;
        rgba[dstOffset + 2] = outRow[srcOffset + 2]!;
        rgba[dstOffset + 3] = outRow[srcOffset + 3]!;
      } else if (channels === 3) {
        rgba[dstOffset] = outRow[srcOffset]!;
        rgba[dstOffset + 1] = outRow[srcOffset + 1]!;
        rgba[dstOffset + 2] = outRow[srcOffset + 2]!;
        rgba[dstOffset + 3] = 255;
      } else {
        rgba[dstOffset] = outRow[srcOffset]!;
        rgba[dstOffset + 1] = outRow[srcOffset]!;
        rgba[dstOffset + 2] = outRow[srcOffset]!;
        rgba[dstOffset + 3] = 255;
      }
    }
    prevRow.set(outRow);
  }

  return { width, height, rgba };
}

/** Nearest-neighbor resize into a `size`x`size` RGBA tile. */
function resizeToTile(decoded: DecodedPng, size: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const srcY = Math.min(
      decoded.height - 1,
      Math.floor((y * decoded.height) / size),
    );
    for (let x = 0; x < size; x += 1) {
      const srcX = Math.min(
        decoded.width - 1,
        Math.floor((x * decoded.width) / size),
      );
      const srcOffset = (srcY * decoded.width + srcX) * 4;
      const dstOffset = (y * size + x) * 4;
      out[dstOffset] = decoded.rgba[srcOffset]!;
      out[dstOffset + 1] = decoded.rgba[srcOffset + 1]!;
      out[dstOffset + 2] = decoded.rgba[srcOffset + 2]!;
      out[dstOffset + 3] = decoded.rgba[srcOffset + 3]!;
    }
  }
  return out;
}

export interface ContactSheetOutcome {
  readonly bytes: Uint8Array;
  readonly decodeErrors: readonly {
    readonly promptId: string;
    readonly message: string;
  }[];
}

/** Tiles a set of generated images into one small contact-sheet PNG (owner review only, no quality scoring). */
export function buildContactSheet(
  images: readonly ImageOutcome[],
  options: { readonly columns?: number; readonly cellSize?: number } = {},
): ContactSheetOutcome {
  const columns = options.columns ?? 5;
  const cellSize = options.cellSize ?? 64;
  const rows = Math.max(1, Math.ceil(images.length / columns));
  const sheetWidth = columns * cellSize;
  const sheetHeight = rows * cellSize;
  const sheet = new Uint8Array(sheetWidth * sheetHeight * 4);
  // Fill with a neutral checkerboard-free gray so empty cells are visibly blank.
  sheet.fill(40);
  for (let i = 3; i < sheet.length; i += 4) {
    sheet[i] = 255;
  }

  const decodeErrors: { promptId: string; message: string }[] = [];
  images.forEach((image, index) => {
    try {
      const decoded = decodePng(image.bytes);
      const tile = resizeToTile(decoded, cellSize);
      const col = index % columns;
      const row = Math.floor(index / columns);
      const originX = col * cellSize;
      const originY = row * cellSize;
      for (let y = 0; y < cellSize; y += 1) {
        for (let x = 0; x < cellSize; x += 1) {
          const srcOffset = (y * cellSize + x) * 4;
          const dstOffset = ((originY + y) * sheetWidth + (originX + x)) * 4;
          sheet[dstOffset] = tile[srcOffset]!;
          sheet[dstOffset + 1] = tile[srcOffset + 1]!;
          sheet[dstOffset + 2] = tile[srcOffset + 2]!;
          sheet[dstOffset + 3] = tile[srcOffset + 3]!;
        }
      }
    } catch (error) {
      decodeErrors.push({
        promptId: image.promptId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return {
    bytes: encodeRgbaPng(sheet, sheetWidth, sheetHeight),
    decodeErrors,
  };
}
