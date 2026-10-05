// Arm orchestration: verify components (hash from bytes; a missing or
// mismatching component blocks the arm), launch the generator server under
// ./process bounds, sample its process tree, run every cell with-LoRA and
// as a same-seed no-LoRA control, stop the server on timeout, and measure a
// restart-based cancellation. The server argv is supplied by the operator;
// nothing about the real sd-server's flags is assumed here.

import { createHash } from "node:crypto";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { basename } from "node:path";
import {
  type CellRecord,
  type ComponentProvenance,
  type ComponentRole,
  type DeclaredComponentMetadata,
  describeComponent,
  pairSeedOutputs,
  type ResidentEvidence,
  type SeedPairing,
  type SettingValue,
} from "./measure";
import { type ManagedProcess, restartToReady, spawnManaged } from "./process";
import { createTreeSampler, type UsageReader } from "./rss";
import { runCell } from "./run";
import {
  type BodyShape,
  buildImgGenBody,
  createSdServerDriver,
  fetchCapabilities,
  type LoraSpec,
} from "./sdserver";

export interface ComponentSpec {
  readonly role: ComponentRole;
  readonly id: string;
  readonly path: string;
  readonly declared?: DeclaredComponentMetadata;
}

export interface CellSpec {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

export interface ArmConfig {
  readonly arm: string;
  readonly server: {
    /** Full argv including the binary; flags are the operator's, not guessed here. */
    readonly cmd: readonly string[];
    readonly baseUrl: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly readyTimeoutMs: number;
    /** Ready bound for the cancel probe's replacement; defaults to `readyTimeoutMs`. */
    readonly restartReadyTimeoutMs?: number;
    readonly maxLifetimeMs: number;
    readonly stopGraceMs?: number;
    /** Hash-checked like any component; mismatch blocks the arm. */
    readonly binary?: ComponentSpec;
  };
  readonly components: readonly ComponentSpec[];
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly seed: number;
  readonly sampleParams: Readonly<Record<string, unknown>>;
  readonly bodyShape?: BodyShape;
  /** null runs a single no-LoRA cell per size (the fallback arm). */
  readonly lora: (LoraSpec & { readonly id: string }) | null;
  readonly cells: readonly CellSpec[];
  readonly warmupCount: number;
  readonly sampleCount: number;
  readonly timeoutMs: number;
  readonly pollMs?: number;
  readonly stagingGuidance: string;
  readonly cancelProbe?: {
    readonly afterMs: number;
    readonly cell: CellSpec;
  } | null;
  readonly idle?: {
    readonly thresholdPercent?: number;
    readonly timeoutMs: number;
  };
  readonly rssIntervalMs?: number;
}

export type RunVariant = "lora" | "control" | "none" | "cancel-probe";

export interface ImageEvent {
  readonly cellId: string;
  readonly variant: RunVariant;
  readonly kind: "warmup" | "sample";
  readonly index: number;
  readonly bytes: Uint8Array;
}

export interface ServerRun {
  readonly startupStatus: "ready" | "timed-out" | "exited";
  readonly readyMs: number | null;
  readonly exit: {
    readonly reason: string;
    readonly signalCode: string | null;
    readonly exitCode: number | null;
  } | null;
  /**
   * Bounded summary: the last LOG_TAIL_CHARS of retained output. The full
   * retained output goes to `hooks.onServerLog`; anything written after a
   * stop was requested is excluded from both.
   */
  readonly logTail: string;
  /** True when output beyond SERVER_LOG_MAX_BYTES was dropped from the retained log. */
  readonly logTruncated: boolean;
  readonly metalLines: readonly string[];
  readonly lateOutputBytes: number;
}

export interface ArmReport {
  readonly schemaVersion: 1;
  readonly arm: string;
  readonly host: {
    readonly platform: string;
    readonly arch: string;
    readonly osRelease: string;
    readonly cpuModel: string;
    readonly totalMemBytes: number;
    /** Never asserted by this harness; see servers[].metalLines. */
    readonly metalVerified: false;
  };
  readonly capabilities: {
    readonly raw: unknown;
    readonly cancelGenerating: boolean | null;
  } | null;
  readonly servers: readonly ServerRun[];
  readonly cells: readonly CellRecord[];
  readonly pairings: readonly (SeedPairing & { readonly cellId: string })[];
  readonly cancelProbe: CellRecord | null;
  readonly resident: ResidentEvidence | null;
  readonly notes: readonly string[];
}

interface PlannedRun {
  readonly spec: CellSpec;
  readonly variant: RunVariant;
  readonly cellId: string;
  readonly lora: LoraSpec | null;
}

interface TrackedServer {
  readonly proc: ManagedProcess;
  startupStatus: ServerRun["startupStatus"];
  readyMs: number | null;
}

const LOG_TAIL_CHARS = 4_000;
/** Retained server output cap (process default of 64 KiB is too small for a verbose run). */
const SERVER_LOG_MAX_BYTES = 8 * 1024 * 1024;

export interface ServerLogEvent {
  /** Zero-based index into `ArmReport.servers`. */
  readonly serverIndex: number;
  /** Full retained stdout then stderr, unredacted. */
  readonly text: string;
}
const sha256Text = (text: string) =>
  createHash("sha256").update(text).digest("hex");

function planRuns(config: ArmConfig): PlannedRun[] {
  return config.cells.flatMap((spec): PlannedRun[] =>
    config.lora
      ? [
          {
            spec,
            variant: "lora",
            cellId: `${spec.id}:lora`,
            lora: config.lora,
          },
          {
            spec,
            variant: "control",
            cellId: `${spec.id}:control`,
            lora: null,
          },
        ]
      : [{ spec, variant: "none", cellId: `${spec.id}:none`, lora: null }],
  );
}

function settingsFor(
  config: ArmConfig,
  spec: CellSpec,
  lora: LoraSpec | null,
): Record<string, SettingValue> {
  return {
    width: spec.width,
    height: spec.height,
    prompt: config.prompt,
    promptSha256: sha256Text(config.prompt),
    negativePrompt: config.negativePrompt ?? null,
    lora: lora && config.lora ? config.lora.id : "none",
    loraFile: lora ? basename(lora.path) : null,
    loraMultiplier: lora?.multiplier ?? null,
    loraIsHighNoise: lora ? (lora.isHighNoise ?? false) : null,
    sampleParams: JSON.stringify(config.sampleParams),
    warmupCount: config.warmupCount,
    sampleCount: config.sampleCount,
    timeoutMs: config.timeoutMs,
  };
}

export async function runArm(
  config: ArmConfig,
  hooks: {
    readonly onImage?: (event: ImageEvent) => void;
    readonly onServerLog?: (event: ServerLogEvent) => void;
    /** RSS/CPU reader for the sampler and idle wait; defaults to `ps`. */
    readonly readUsage?: UsageReader;
  } = {},
): Promise<ArmReport> {
  const components: ComponentProvenance[] = await Promise.all(
    [
      ...(config.server.binary ? [config.server.binary] : []),
      ...config.components,
    ].map((spec) => describeComponent(spec)),
  );
  const blocked = components.some(
    (c) => !c.available || c.declaredHashMatches === false,
  );

  const plan = planRuns(config);
  const records: CellRecord[] = [];
  const tracked: TrackedServer[] = [];
  let capabilities: ArmReport["capabilities"] = null;
  let current: ManagedProcess | null = null;
  let everStarted = false;
  let cancelProbe: CellRecord | null = null;
  let resident: ResidentEvidence | null = null;
  const sampler = createTreeSampler({
    intervalMs: config.rssIntervalMs ?? 250,
    phase: "startup",
    read: hooks.readUsage,
  });

  const spawn = (): ManagedProcess =>
    spawnManaged({
      cmd: config.server.cmd,
      env: config.server.env,
      maxLifetimeMs: config.server.maxLifetimeMs,
      stopGraceMs: config.server.stopGraceMs,
      maxOutputBytes: SERVER_LOG_MAX_BYTES,
    });
  const isReady = async () =>
    (await fetchCapabilities(config.server.baseUrl, 500)) !== null;

  /**
   * Starts the server if none is running. Fails, with the reason, when the
   * endpoint already answers before anything was spawned (the measurements
   * would be of a server this run did not start) or when the new server never
   * became ready.
   */
  async function ensureServer(): Promise<
    { readonly ok: true } | { readonly ok: false; readonly reason: string }
  > {
    if (current?.state() === "running") {
      return { ok: true };
    }
    if (await isReady()) {
      return {
        ok: false,
        reason: `endpoint ${config.server.baseUrl} already answers the capabilities probe; refusing to measure a server this run did not start`,
      };
    }
    sampler.setPhase(everStarted ? "restart" : "startup");
    everStarted = true;
    const proc = spawn();
    current = proc;
    sampler.setRoot(proc.pid);
    const entry: TrackedServer = {
      proc,
      startupStatus: "timed-out",
      readyMs: null,
    };
    tracked.push(entry);
    const ready = await proc.waitReady(isReady, {
      timeoutMs: config.server.readyTimeoutMs,
      pollMs: 50,
    });
    entry.startupStatus = ready.status;
    if (ready.status !== "ready") {
      await proc.stop();
      return { ok: false, reason: "generator server did not become ready" };
    }
    entry.readyMs = ready.ms;
    capabilities ??= await fetchCapabilities(config.server.baseUrl, 2_000);
    return { ok: true };
  }

  const driverFor = (run: PlannedRun, phase: string) => ({
    ...createSdServerDriver({
      baseUrl: config.server.baseUrl,
      pollMs: config.pollMs,
      makeBody: (request) =>
        buildImgGenBody(
          {
            prompt: config.prompt,
            negativePrompt: config.negativePrompt,
            width: run.spec.width,
            height: run.spec.height,
            seed: request.seed,
            lora: run.lora,
            sampleParams: config.sampleParams,
          },
          config.bodyShape,
        ),
    }),
    readPeakRssKb: () =>
      sampler.snapshot().byPhase[phase]?.observedSampledPeakKb ?? null,
    readResident: (): ResidentEvidence => {
      const snap = sampler.snapshot();
      const entry = snap.byPhase[phase];
      return {
        ...snap,
        sampleCount: entry?.sampleCount ?? 0,
        observedSampledPeakKb: entry?.observedSampledPeakKb ?? null,
        byPhase: entry ? { [phase]: entry } : {},
      };
    },
  });

  const cellInput = (run: PlannedRun, cellId: string) => ({
    arm: config.arm,
    cellId,
    seed: config.seed,
    settings: settingsFor(config, run.spec, run.lora),
    components,
    stagingGuidance: config.stagingGuidance,
    warmupCount: config.warmupCount,
    sampleCount: config.sampleCount,
    timeoutMs: config.timeoutMs,
  });

  const onOutput =
    (run: PlannedRun) =>
    (bytes: Uint8Array, meta: { kind: "warmup" | "sample"; index: number }) =>
      hooks.onImage?.({
        cellId: run.spec.id,
        variant: run.variant,
        kind: meta.kind,
        index: meta.index,
        bytes,
      });

  try {
    for (const run of plan) {
      const phase = `cell:${run.cellId}`;
      if (blocked) {
        records.push(
          await runCell({
            ...cellInput(run, run.cellId),
            driver: {
              generate: () => Promise.reject(new Error("arm blocked")),
            },
          }),
        );
        continue;
      }
      const started = await ensureServer();
      if (!started.ok) {
        records.push({
          schemaVersion: 1,
          arm: config.arm,
          cellId: run.cellId,
          seed: config.seed,
          settings: settingsFor(config, run.spec, run.lora),
          components,
          peakRssKb: null,
          status: "failed",
          reason: started.reason,
          completedSamples: [],
        });
        continue;
      }
      sampler.setPhase(phase);
      records.push(
        await runCell({
          ...cellInput(run, run.cellId),
          driver: driverFor(run, phase),
          onOutput: onOutput(run),
          onTimeout: async () => {
            const stopped = await (current as ManagedProcess).stop();
            return {
              stoppedAfterMs: stopped.exitedAfterMs,
              escalatedToKill: stopped.escalatedToKill,
              lateOutputBytes: stopped.lateOutputBytes,
              exitSignal: stopped.exit.signalCode,
            };
          },
        }),
      );
    }

    if (config.cancelProbe && !blocked && (await ensureServer()).ok) {
      const probe = config.cancelProbe;
      const run: PlannedRun = {
        spec: probe.cell,
        variant: "cancel-probe",
        cellId: `${probe.cell.id}:cancel-probe`,
        lora: config.lora,
      };
      const phase = `cell:${run.cellId}`;
      sampler.setPhase(phase);
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), probe.afterMs);
      cancelProbe = await runCell({
        ...cellInput(run, run.cellId),
        warmupCount: 0,
        sampleCount: 1,
        driver: driverFor(run, phase),
        signal: abort.signal,
        onOutput: onOutput(run),
        onCancel: async () => {
          sampler.setPhase("restart");
          let entry: TrackedServer | undefined;
          const restarted = await restartToReady({
            current: current as ManagedProcess,
            respawn: () => {
              const proc = spawn();
              entry = { proc, startupStatus: "timed-out", readyMs: null };
              tracked.push(entry);
              current = proc;
              sampler.setRoot(proc.pid);
              return proc;
            },
            isReady,
            readyTimeoutMs:
              config.server.restartReadyTimeoutMs ??
              config.server.readyTimeoutMs,
            pollMs: 50,
            idle: config.idle && { ...config.idle, read: hooks.readUsage },
          });
          if (entry) {
            entry.startupStatus =
              restarted.cancel.readiness === "ready"
                ? "ready"
                : restarted.cancel.readiness === "exited"
                  ? "exited"
                  : "timed-out";
            entry.readyMs = restarted.cancel.restartToReadyMs;
          }
          return restarted.cancel;
        },
      });
      clearTimeout(timer);
    }
  } finally {
    if (current) {
      await (current as ManagedProcess).stop();
    }
    resident = sampler.stop();
  }

  const servers: ServerRun[] = [];
  for (const [serverIndex, entry] of tracked.entries()) {
    const exit = await entry.proc.exited;
    const out = entry.proc.output();
    const combined = `${out.stdout}${out.stderr}`;
    hooks.onServerLog?.({ serverIndex, text: combined });
    servers.push({
      startupStatus: entry.startupStatus,
      readyMs: entry.readyMs,
      exit: {
        reason: exit.reason,
        signalCode: exit.signalCode,
        exitCode: exit.exitCode,
      },
      logTail: combined.slice(-LOG_TAIL_CHARS),
      logTruncated: out.truncated,
      metalLines: combined
        .split("\n")
        .filter((line) => /metal/i.test(line))
        .slice(0, 20),
      lateOutputBytes: out.lateBytes,
    });
  }

  const pairings: (SeedPairing & { cellId: string })[] = [];
  for (const run of plan) {
    if (run.variant !== "lora") continue;
    const withLora = records.find((r) => r.cellId === run.cellId);
    const control = records.find((r) => r.cellId === `${run.spec.id}:control`);
    if (withLora && control) {
      pairings.push({
        cellId: run.spec.id,
        ...pairSeedOutputs(withLora, control),
      });
    }
  }

  return {
    schemaVersion: 1,
    arm: config.arm,
    host: {
      platform: platform(),
      arch: arch(),
      osRelease: release(),
      cpuModel: cpus()[0]?.model ?? "unknown",
      totalMemBytes: totalmem(),
      metalVerified: false,
    },
    capabilities,
    servers,
    cells: records,
    pairings,
    cancelProbe,
    resident,
    notes: [
      "Metal use is not verified by this harness; inspect servers[].metalLines and the server's own log.",
      `Resident peaks are sampled every ${resident.intervalMs}ms (process tree via ps): lower bounds, not guaranteed maxima.`,
      "Cancellation is restart-based; capabilities.cancelGenerating records what the server advertises.",
      "Output hash differences between with-LoRA and control show LoRA application, not visual quality.",
    ],
  };
}
