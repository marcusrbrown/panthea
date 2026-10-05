// Model-agnostic measurement records for the art-local-2 generation probe.
//
// Design rules (Unit 1 of the asset-studio foundation plan):
//   - warmup timings are kept apart from sample timings; percentiles only
//     ever see samples;
//   - p50/p95 use the shared nearest-rank rule (rank = ceil(p/100 * n) over
//     the sorted samples) and always travel with the sample count;
//   - hashes are computed from bytes this probe read or received, never
//     copied from declared metadata (a declared hash is kept alongside and
//     compared);
//   - a cell record is a discriminated union: only `completed` carries a
//     timing summary and outputs, so cancelled/failed/timed-out/unavailable
//     cells cannot be mistaken for results, and nothing is invented (RSS,
//     timings and hashes are null/absent when not measured).

import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { percentile } from "../../shared/src/timing";

export interface TimingSummary {
  readonly warmupMs: readonly number[];
  readonly sampleCount: number;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly percentileRule: "nearest-rank";
  /** True when n < 20: nearest-rank p95 is then simply the slowest sample. */
  readonly p95IsSampleMax: boolean;
}

export function summarizeTimings(input: {
  readonly warmup: readonly number[];
  readonly samples: readonly number[];
}): TimingSummary {
  const n = input.samples.length;
  return {
    warmupMs: [...input.warmup],
    sampleCount: n,
    p50Ms: percentile(input.samples, 50) ?? null,
    p95Ms: percentile(input.samples, 95) ?? null,
    percentileRule: "nearest-rank",
    p95IsSampleMax: n < 20,
  };
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Streams a file through sha256 so multi-GB weights are never buffered. */
export function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

export interface DeclaredComponentMetadata {
  readonly sha256?: string;
  readonly license?: string;
  readonly source?: string;
  readonly quantization?: string;
}

export type ComponentRole =
  | "binary"
  | "diffusion-model"
  | "text-encoder"
  | "vae"
  | "lora"
  | "other";

export type ComponentProvenance =
  | {
      readonly available: true;
      readonly role: ComponentRole;
      readonly id: string;
      readonly path: string;
      /** Computed from the file's bytes. */
      readonly sha256: string;
      readonly sizeBytes: number;
      readonly declaredSha256: string | null;
      /** null when nothing was declared to compare against. */
      readonly declaredHashMatches: boolean | null;
      readonly license: string | null;
      readonly source: string | null;
      readonly quantization: string | null;
    }
  | {
      readonly available: false;
      readonly role: ComponentRole;
      readonly id: string;
      readonly path: string;
      readonly declaredSha256: string | null;
      readonly reason: string;
    };

export async function describeComponent(input: {
  readonly role: ComponentRole;
  readonly id: string;
  readonly path: string;
  readonly declared?: DeclaredComponentMetadata;
}): Promise<ComponentProvenance> {
  const declared = input.declared ?? {};
  const declaredSha256 = declared.sha256 ?? null;
  let sizeBytes: number;
  try {
    const stat = statSync(input.path);
    if (!stat.isFile()) {
      return unavailable(input, declaredSha256, "path is not a file");
    }
    sizeBytes = stat.size;
  } catch {
    return unavailable(input, declaredSha256, "file not found");
  }
  let sha256: string;
  try {
    sha256 = await hashFile(input.path);
  } catch (error) {
    return unavailable(
      input,
      declaredSha256,
      `unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    available: true,
    role: input.role,
    id: input.id,
    path: input.path,
    sha256,
    sizeBytes,
    declaredSha256,
    declaredHashMatches:
      declaredSha256 === null ? null : declaredSha256.toLowerCase() === sha256,
    license: declared.license ?? null,
    source: declared.source ?? null,
    quantization: declared.quantization ?? null,
  };
}

function unavailable(
  input: { role: ComponentRole; id: string; path: string },
  declaredSha256: string | null,
  reason: string,
): ComponentProvenance {
  return {
    available: false,
    role: input.role,
    id: input.id,
    path: input.path,
    declaredSha256,
    reason,
  };
}

export interface TimingEntry {
  readonly index: number;
  readonly wallMs: number;
}

export interface OutputRecord {
  readonly index: number;
  /** sha256 of the produced bytes. */
  readonly sha256: string;
  readonly byteLength: number;
}

export type SettingValue = string | number | boolean | null;

/** Restart-to-ready cancellation timing; any phase not observed is null. */
export interface CancelTiming {
  /** Cancel request to old process exit. */
  readonly abortToExitMs: number | null;
  /** Respawn to readiness probe passing. */
  readonly restartToReadyMs: number | null;
  /** Cancel request to ready again. */
  readonly totalCancelToReadyMs: number | null;
  readonly readiness: "ready" | "timed-out" | "exited" | "not-attempted";
  readonly escalatedToKill: boolean;
  /** Respawn to process-tree CPU below threshold; null when not reached/measured. */
  readonly restartToIdleMs: number | null;
  readonly idle:
    | "below-threshold"
    | "timed-out"
    | "process-gone"
    | "not-measured";
  readonly idleThresholdPercent: number | null;
  /** Raw tree CPU readings behind the idle verdict (ps %cpu is a coarse OS-decayed average). */
  readonly idleCpuEvidence: readonly {
    readonly atMs: number;
    readonly cpuPercent: number;
  }[];
}

/** Process-tree resident-memory evidence from periodic sampling. */
export interface ResidentEvidence {
  readonly intervalMs: number;
  readonly sampleCount: number;
  /**
   * Highest tree RSS (KiB) seen at a sample instant. Peaks between samples
   * are invisible, so this is a lower bound on the true maximum.
   */
  readonly observedSampledPeakKb: number | null;
  readonly byPhase: Readonly<
    Record<
      string,
      { readonly sampleCount: number; readonly observedSampledPeakKb: number }
    >
  >;
  readonly semantics: "observed-sampled-peak-not-guaranteed-maximum";
}

/** What stopping the server after a timeout/cancel actually did. */
export interface ServerStopEvidence {
  readonly stoppedAfterMs: number;
  readonly escalatedToKill: boolean;
  readonly lateOutputBytes: number;
  readonly exitSignal: string | null;
}

interface CellBase {
  readonly schemaVersion: 1;
  readonly arm: string;
  readonly cellId: string;
  readonly seed: number | null;
  readonly settings: Readonly<Record<string, SettingValue>>;
  readonly components: readonly ComponentProvenance[];
  /** Observed sampled peak of the generator process tree (KiB); null when not measured. Never estimated. */
  readonly peakRssKb: number | null;
  readonly resident?: ResidentEvidence | null;
}

export type CellRecord =
  | (CellBase & {
      readonly status: "completed";
      readonly warmup: readonly TimingEntry[];
      readonly samples: readonly TimingEntry[];
      readonly timing: TimingSummary;
      readonly outputs: readonly OutputRecord[];
    })
  | (CellBase & {
      readonly status: "unavailable";
      readonly reason: string;
      readonly stagingGuidance: string;
      readonly missing: readonly string[];
      /** Components whose bytes hash differently from their declared sha256. */
      readonly hashMismatches: readonly string[];
    })
  | (CellBase & {
      readonly status: "failed";
      readonly reason: string;
      /** Raw timings that finished before the failure; no summary. */
      readonly completedSamples: readonly TimingEntry[];
    })
  | (CellBase & {
      readonly status: "timed-out";
      readonly reason: string;
      readonly timeoutMs: number;
      readonly elapsedMs: number;
      /** The server stop performed on timeout; null if no stop hook was supplied. */
      readonly serverStop: ServerStopEvidence | null;
      readonly completedSamples: readonly TimingEntry[];
    })
  | (CellBase & {
      readonly status: "cancelled";
      readonly reason: string;
      /** Results that arrived after cancellation and were thrown away. */
      readonly discardedLateOutputs: number;
      readonly cancel: CancelTiming | null;
      readonly completedSamples: readonly TimingEntry[];
    });

export type SeedPairing =
  | {
      readonly comparable: true;
      readonly seed: number;
      readonly identical: boolean;
      readonly withHash: string;
      readonly withoutHash: string;
    }
  | { readonly comparable: false; readonly reason: string };

/**
 * Compares first-output hashes of a with-LoRA and without-LoRA cell at the
 * same seed. A hash difference shows the LoRA was applied; it says nothing
 * about visual quality (owner rates contact sheets).
 */
export function pairSeedOutputs(
  withLora: CellRecord,
  withoutLora: CellRecord,
): SeedPairing {
  if (withLora.status !== "completed" || withoutLora.status !== "completed") {
    return { comparable: false, reason: "both cells must be completed" };
  }
  if (withLora.seed === null || withLora.seed !== withoutLora.seed) {
    return { comparable: false, reason: "cells must share one non-null seed" };
  }
  const withHash = withLora.outputs[0]?.sha256;
  const withoutHash = withoutLora.outputs[0]?.sha256;
  if (withHash === undefined || withoutHash === undefined) {
    return { comparable: false, reason: "a cell has no output hash" };
  }
  return {
    comparable: true,
    seed: withLora.seed,
    identical: withHash === withoutHash,
    withHash,
    withoutHash,
  };
}
