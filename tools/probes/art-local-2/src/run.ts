// Per-cell runner: drives one arm/cell (model chain + settings + seed)
// through warmup then timed samples against an injected `ArmDriver` and
// returns a `CellRecord` with an explicit status. Server-agnostic; the
// sd-server driver is in ./sdserver and the arm orchestration in ./arm.

import {
  type CancelTiming,
  type CellRecord,
  type ComponentProvenance,
  hashBytes,
  type OutputRecord,
  type ResidentEvidence,
  type ServerStopEvidence,
  type SettingValue,
  summarizeTimings,
  type TimingEntry,
} from "./measure";

export interface GenerateRequest {
  readonly kind: "warmup" | "sample";
  /** Index within its own kind (warmup 0.., sample 0..). */
  readonly index: number;
  readonly seed: number | null;
  /** Aborted on timeout or cancellation; drivers should stop work. */
  readonly signal: AbortSignal;
}

export interface ArmDriver {
  /** Resolves with the produced image bytes; rejects on failure. */
  generate(request: GenerateRequest): Promise<Uint8Array>;
  /** Peak RSS of the generator in KiB, or null when it cannot be measured. */
  readPeakRssKb?(): number | null | Promise<number | null>;
  /** Process-tree resident evidence, when sampled. */
  readResident?(): ResidentEvidence | null;
}

export interface RunCellInput {
  readonly arm: string;
  readonly cellId: string;
  readonly seed: number | null;
  readonly settings: Readonly<Record<string, SettingValue>>;
  readonly components: readonly ComponentProvenance[];
  /** Shown to the operator when a component is missing. */
  readonly stagingGuidance: string;
  readonly warmupCount: number;
  readonly sampleCount: number;
  /** Per-generation deadline. */
  readonly timeoutMs: number;
  readonly driver: ArmDriver;
  /** External cancellation (e.g. queue abort). */
  readonly signal?: AbortSignal;
  /** How long to wait for a cancelled/timed-out call to settle so a late result can be counted (default 100). */
  readonly lateOutputGraceMs?: number;
  /** Performs restart-based abort after cancellation and reports its timing. */
  readonly onCancel?: () => Promise<CancelTiming>;
  /** Stops the generator process after a timeout (aborting the request is not enough). */
  readonly onTimeout?: () => Promise<ServerStopEvidence>;
  /** Receives every produced image (warmup included) for contact sheets. */
  readonly onOutput?: (
    bytes: Uint8Array,
    meta: { readonly kind: "warmup" | "sample"; readonly index: number },
  ) => void;
  /** Millisecond clock; injectable for deterministic tests. */
  readonly now?: () => number;
}

type Settled =
  | { readonly kind: "ok"; readonly bytes: Uint8Array }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "timeout" }
  | { readonly kind: "cancel" };

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function assertCount(name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${name} must be an integer >= ${min}, got ${value}`);
  }
}

export async function runCell(input: RunCellInput): Promise<CellRecord> {
  const record = await runCellSteps(input);
  const resident =
    record.status === "unavailable"
      ? null
      : (input.driver.readResident?.() ?? null);
  return { ...record, resident };
}

async function runCellSteps(input: RunCellInput): Promise<CellRecord> {
  assertCount("warmupCount", input.warmupCount, 0);
  assertCount("sampleCount", input.sampleCount, 1);
  const now = input.now ?? (() => performance.now());
  const lateGraceMs = input.lateOutputGraceMs ?? 100;

  const common = {
    schemaVersion: 1,
    arm: input.arm,
    cellId: input.cellId,
    seed: input.seed,
    settings: input.settings,
    components: input.components,
  } as const;

  async function peakRss(): Promise<number | null> {
    try {
      return (await input.driver.readPeakRssKb?.()) ?? null;
    } catch {
      return null;
    }
  }

  const missing = input.components.filter((c) => !c.available).map((c) => c.id);
  const hashMismatches = input.components
    .filter((c) => c.available && c.declaredHashMatches === false)
    .map((c) => c.id);
  if (missing.length > 0 || hashMismatches.length > 0) {
    const parts = [
      missing.length > 0 ? `missing components: ${missing.join(", ")}` : "",
      hashMismatches.length > 0
        ? `hash mismatch: ${hashMismatches.join(", ")}`
        : "",
    ].filter(Boolean);
    return {
      ...common,
      peakRssKb: null,
      status: "unavailable",
      reason: parts.join("; "),
      stagingGuidance: input.stagingGuidance,
      missing,
      hashMismatches,
    };
  }

  const warmup: TimingEntry[] = [];
  const samples: TimingEntry[] = [];
  const outputs: OutputRecord[] = [];

  const plan = [
    ...Array.from({ length: input.warmupCount }, (_, index) => ({
      kind: "warmup" as const,
      index,
    })),
    ...Array.from({ length: input.sampleCount }, (_, index) => ({
      kind: "sample" as const,
      index,
    })),
  ];

  async function cancelled(discarded: number): Promise<CellRecord> {
    let cancel: CancelTiming | null = null;
    if (input.onCancel) {
      try {
        cancel = await input.onCancel();
      } catch {
        cancel = null;
      }
    }
    return {
      ...common,
      peakRssKb: await peakRss(),
      status: "cancelled",
      reason: "cancelled before completion; no result recorded",
      discardedLateOutputs: discarded,
      cancel,
      completedSamples: samples,
    };
  }

  for (const step of plan) {
    if (input.signal?.aborted) {
      return cancelled(0);
    }

    const controller = new AbortController();
    const startedAt = now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;

    const call = input.driver
      .generate({
        kind: step.kind,
        index: step.index,
        seed: input.seed,
        signal: controller.signal,
      })
      .then(
        (bytes): Settled => ({ kind: "ok", bytes }),
        (error): Settled => ({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
      );

    const deadline = new Promise<Settled>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), input.timeoutMs);
    });
    const external = new Promise<Settled>((resolve) => {
      onAbort = () => resolve({ kind: "cancel" });
      input.signal?.addEventListener("abort", onAbort, { once: true });
    });

    const settled = await Promise.race([call, deadline, external]);
    clearTimeout(timer);
    if (onAbort) input.signal?.removeEventListener("abort", onAbort);
    const elapsedMs = now() - startedAt;

    if (settled.kind === "ok") {
      if (settled.bytes.byteLength === 0) {
        return {
          ...common,
          peakRssKb: await peakRss(),
          status: "failed",
          reason: `${step.kind} ${step.index} returned no bytes`,
          completedSamples: samples,
        };
      }
      input.onOutput?.(settled.bytes, step);
      const entry = { index: step.index, wallMs: elapsedMs };
      if (step.kind === "warmup") {
        warmup.push(entry);
      } else {
        samples.push(entry);
        outputs.push({
          index: step.index,
          sha256: hashBytes(settled.bytes),
          byteLength: settled.bytes.byteLength,
        });
      }
      continue;
    }

    if (settled.kind === "error") {
      return {
        ...common,
        peakRssKb: await peakRss(),
        status: "failed",
        reason: `${step.kind} ${step.index} failed: ${settled.message}`,
        completedSamples: samples,
      };
    }

    // Timeout or cancellation: tell the driver to stop, then give the call a
    // bounded chance to settle so a late result is counted, never kept.
    controller.abort();
    const late = await Promise.race([
      call,
      sleep(lateGraceMs).then(() => undefined),
    ]);
    const discarded = late?.kind === "ok" ? 1 : 0;

    if (settled.kind === "timeout") {
      let serverStop: ServerStopEvidence | null = null;
      if (input.onTimeout) {
        try {
          serverStop = await input.onTimeout();
        } catch {
          serverStop = null;
        }
      }
      return {
        ...common,
        peakRssKb: await peakRss(),
        status: "timed-out",
        reason: `${step.kind} ${step.index} exceeded ${input.timeoutMs}ms`,
        timeoutMs: input.timeoutMs,
        elapsedMs,
        serverStop,
        completedSamples: samples,
      };
    }
    return cancelled(discarded);
  }

  return {
    ...common,
    peakRssKb: await peakRss(),
    status: "completed",
    warmup,
    samples,
    timing: summarizeTimings({
      warmup: warmup.map((e) => e.wallMs),
      samples: samples.map((e) => e.wallMs),
    }),
    outputs,
  };
}
