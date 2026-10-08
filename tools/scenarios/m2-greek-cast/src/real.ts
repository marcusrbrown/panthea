// The real-inference run: the compiled sidecar with both gods taking turns
// through local Ollama (llama3.2 3B at a 4K context), unscripted, for a fixed
// wall time. It asserts properties (see real-analysis.ts), not exact facts,
// and records latency and outcomes so the README can quote numbers from a run.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isLocalUrl } from "@panthea/agents/config";
import { captureEnvironment } from "@panthea/tools-probes-shared";
import {
  killAllSidecars,
  startSidecar,
} from "../../m1-living-world/src/sidecar";
import { readFrame } from "../../m1-living-world/src/steps/api";
import { activeStorePath } from "../../m1-living-world/src/world-db";
import { readProposals, readRealRequests, readStoredEvents } from "./db";
import {
  analyzeReal,
  type RealAnalysis,
  type RealInput,
} from "./real-analysis";
import { readSampleSource, type SampleSource } from "./sample-prompt";

export interface RealOptions {
  readonly binary: string;
  readonly durationMs: number;
  readonly ollama: string;
  readonly model: string;
  /** Asks the model not to reason before answering. */
  readonly reasoningEffort?: "none";
  /** The endpoint's OpenAI-compatible base URL; `${ollama}/v1` when unset. */
  readonly baseUrl?: string;
  /** `baseUrl` only passes requests through to the local Ollama at `ollama` (the unattended run's outage proxy): the endpoint is named and recorded as that Ollama. */
  readonly upstreamIsLocal?: true | undefined;
  /** The key reference the endpoint names, whose key is in `keys`. */
  readonly keyRef?: string;
  /** Keys by key reference, read once from the Keychain. Only ever sent on the launch line. */
  readonly keys?: Readonly<Record<string, string>>;
}

export interface RealRecord {
  readonly ranAt: string;
  readonly model: string;
  readonly reasoningEffort?: "none";
  readonly durationMs: number;
  readonly ticks: number;
  readonly analysis: RealAnalysis;
  readonly hardware: string;
}

/**
 * The model config the sidecar reads: every god on one endpoint, local Ollama unless a base URL is
 * given. Zeus and Hera keep roles of their own; the endpoint is also the global fallback, so each other
 * god in the pack (the desktop's global fallback does the same) routes there without a role to keep in
 * step with the cast. Names a key by reference, never carries one.
 */
export function routingConfigFor(options: RealOptions): object {
  const id =
    options.baseUrl === undefined || options.upstreamIsLocal === true
      ? "ollama"
      : "hosted";
  return {
    endpoints: [
      {
        id,
        baseUrl: options.baseUrl ?? `${options.ollama}/v1`,
        model: options.model,
        ...(options.keyRef === undefined ? {} : { keyRef: options.keyRef }),
        ...(options.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: options.reasoningEffort }),
      },
    ],
    roles: { zeus: { endpoint: id }, hera: { endpoint: id } },
    fallback: [id],
  };
}

/** The launch config line the shell would send: the models, online, and the keys. The only place a key travels. */
export function launchConfigFor(options: RealOptions) {
  return {
    models: routingConfigFor(options),
    offline: false,
    keys: options.keys ?? {},
  };
}

export class KeyMissing extends Error {}

/** The macOS Keychain service the shell stores endpoint keys under; the account is the key reference. */
const KEYCHAIN_SERVICE = "ai.panthe.desktop.endpoint-keys";

async function runSecurity(
  argv: readonly string[],
): Promise<{ exitCode: number; stdout: string }> {
  const child = Bun.spawn([...argv], { stdout: "pipe", stderr: "ignore" });
  const [stdout, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  return { exitCode, stdout };
}

/**
 * Reads an endpoint key from the macOS Keychain, once. The key is returned and
 * nothing else: it is not logged, and a failure names only the key reference.
 */
export async function readKeychainKey(
  keyRef: string,
  run: typeof runSecurity = runSecurity,
): Promise<string> {
  const { exitCode, stdout } = await run([
    "security",
    "find-generic-password",
    "-s",
    KEYCHAIN_SERVICE,
    "-a",
    keyRef,
    "-w",
  ]);
  const key = stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
  if (exitCode !== 0 || key === "") {
    throw new KeyMissing(
      `no key for "${keyRef}" in the macOS Keychain (service ${KEYCHAIN_SERVICE}); set it in the app's settings first`,
    );
  }
  return key;
}

/**
 * The endpoint flags as run options: the base URL, the key reference, and the
 * key read once through `read` (the Keychain). `parseArgs` has already refused
 * every combination that would hand a key to the wrong place, so nothing is
 * read for those.
 */
export async function endpointOptions(
  args: {
    readonly baseUrl?: string | undefined;
    readonly keyRef?: string | undefined;
  },
  read: (keyRef: string) => Promise<string> = readKeychainKey,
) {
  return {
    ...(args.baseUrl === undefined ? {} : { baseUrl: args.baseUrl }),
    ...(args.keyRef === undefined
      ? {}
      : {
          keyRef: args.keyRef,
          keys: { [args.keyRef]: await read(args.keyRef) },
        }),
  };
}

/**
 * Which kind of explicit endpoint the run used, for run records: `hosted` or
 * `local` for any `--base-url`, nothing for the default Ollama. Records say only
 * that: never the endpoint's host, port, path, key reference, or a key, since a
 * transcript is committed and a host can be private.
 */
export function endpointKind(
  options: RealOptions,
): "hosted" | "local" | undefined {
  if (options.upstreamIsLocal === true) return "local";
  if (options.baseUrl === undefined) return undefined;
  return isLocalUrl(options.baseUrl) ? "local" : "hosted";
}

export class OllamaUnreachable extends Error {}

/**
 * On the default path (no `--base-url`), confirms Ollama answers and has the
 * model, loads it, and returns; throws with the exact error otherwise. An
 * explicit base URL, local or hosted, names an endpoint that is not necessarily
 * Ollama (a llama-server, a LAN proxy, Ollama on another port), so nothing is
 * checked or warmed and the default Ollama is never contacted.
 */
export async function prepareOllama(options: RealOptions): Promise<void> {
  if (options.baseUrl !== undefined) return;
  const tags = `${options.ollama}/api/tags`;
  let names: string[];
  try {
    const response = await fetch(tags);
    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`);
    }
    names = (
      (await response.json()) as { models: { name: string }[] }
    ).models.map((model) => model.name);
  } catch (error) {
    throw new OllamaUnreachable(
      `Ollama is unreachable at ${tags}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    !names.some(
      (name) => name === options.model || name === `${options.model}:latest`,
    )
  ) {
    throw new OllamaUnreachable(
      `Ollama at ${options.ollama} has no model ${options.model} (has ${names.join(", ")})`,
    );
  }
  // Load it and keep it loaded, so the first turn does not measure a cold start.
  await fetch(`${options.ollama}/api/generate`, {
    method: "POST",
    body: JSON.stringify({
      model: options.model,
      prompt: "",
      keep_alive: "10m",
    }),
  });
}

/** One run's record, and the data it was analyzed from. */
export interface CollectedRun {
  readonly record: RealRecord;
  readonly input: RealInput;
  /** One turn's prompt, output, and schema, read from the store before it is deleted. */
  readonly sample: SampleSource;
}

export async function runReal(options: RealOptions): Promise<RealRecord> {
  await prepareOllama(options);
  return (await collectRun(options)).record;
}

/**
 * One fresh world (a temporary app-data directory, the initial authored
 * state) with both gods on the model for `durationMs`. `beforeCleanup` sees the
 * collected data before the temporary store is deleted.
 */
export async function collectRun(
  options: RealOptions,
  beforeCleanup?: (run: CollectedRun) => void,
): Promise<CollectedRun> {
  const root = mkdtempSync(join(tmpdir(), "panthea-m2-real-"));
  const dataDir = join(root, "app-data");
  try {
    const sidecar = await startSidecar(options.binary, dataDir, {
      launchConfig: launchConfigFor(options),
    });
    const polls = { total: 0, degraded: 0 };
    const deadline = Date.now() + options.durationMs;
    let ticks = 0;
    let gods: string[] = [];
    // Where the world placed each god, before any turn could move one.
    const startLocations: Record<string, string> = {};
    for (const actor of (await readFrame(sidecar)).state.actors.values()) {
      if (actor.isDeity === true) {
        startLocations[String(actor.id)] = String(actor.locationId);
      }
    }
    while (Date.now() < deadline) {
      await Bun.sleep(2000);
      const { frame, state } = await readFrame(sidecar);
      polls.total += 1;
      if (frame.degradedReason === "model-degraded") polls.degraded += 1;
      ticks = state.tick;
      gods = [...state.actors.values()]
        .filter((actor) => actor.isDeity === true)
        .map((actor) => String(actor.id));
    }
    // What the run knew of its own end, taken before the service stops (a turn in flight leaves no trace row).
    const endedAtMs = Date.now();
    const code = await sidecar.stop("SIGTERM");
    if (code !== 0) throw new Error(`the sidecar exited ${code}`);
    const path = activeStorePath(dataDir);
    const proposals = readProposals(path)
      .filter((entry) => entry.source === "model")
      .map((entry) => ({
        proposalId: entry.proposalId,
        actor: entry.actor,
        kind: entry.kind,
        observationId: String(entry.proposal.observationId),
        proposal: entry.proposal,
        outcome: entry.outcome as "committed" | "rejected" | undefined,
        ...(entry.reason === undefined ? {} : { reason: entry.reason }),
        ...(entry.consumedTick === undefined
          ? {}
          : { consumedTick: entry.consumedTick }),
      }));
    const input: RealInput = {
      requests: readRealRequests(path),
      proposals,
      events: readStoredEvents(path),
      polls,
      timing: { gods, endedAtMs, endTick: ticks, startLocations },
    };
    const run: CollectedRun = {
      record: {
        ranAt: new Date().toISOString(),
        model: options.model,
        ...(options.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: options.reasoningEffort }),
        durationMs: options.durationMs,
        ticks,
        analysis: analyzeReal(input),
        hardware: captureEnvironment().hardware.brand,
      },
      input,
      sample: readSampleSource(path),
    };
    beforeCleanup?.(run);
    return run;
  } finally {
    killAllSidecars();
    rmSync(root, { recursive: true, force: true });
  }
}
