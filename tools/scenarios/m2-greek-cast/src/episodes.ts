// The experience gate's runner: several fresh worlds, each with Zeus and Hera
// on the local model for the same wall time, each written out as a transcript
// for the owner before its temporary store is deleted, and a summary across
// them. It runs the automated checks and never scores.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../m1-living-world/src/sidecar";
import { analyzeEpisode, type GodIdentity } from "./episode-analysis";
import { type GateCheck, gateChecks } from "./gate-analysis";
import {
  collectRun,
  endpointKind,
  prepareOllama,
  type RealOptions,
} from "./real";
import { writeSamplePrompt } from "./sample-prompt";
import {
  type EpisodeRecord,
  type EpisodeSettings,
  renderSummary,
  renderTranscript,
} from "./transcript";

/** Every god of the cast: the gate judges each of them (R19), not only the first two. */
export const GODS = [
  "athena",
  "hades",
  "hephaestus",
  "hera",
  "hermes",
  "poseidon",
  "zeus",
] as const;

/** The patron each mortal is authored with, by mortal id: the devotion in the inhabitants file, which a defection later moves. */
export function loadAuthoredPatrons(dir: string): Map<string, string> {
  const raw = JSON.parse(
    readFileSync(join(dir, "inhabitants.json"), "utf8"),
  ) as {
    inhabitants: { id: string; deity?: boolean; devotion?: { god: string } }[];
  };
  return new Map(
    raw.inhabitants.flatMap((i) =>
      i.deity === true || i.devotion === undefined
        ? []
        : [[i.id, i.devotion.god] as const],
    ),
  );
}

/** The checks across a gate's episodes: wrongs, threads over harm, and each god's initiative (R19, SC3 to SC5). */
export function gateOf(
  records: readonly EpisodeRecord[],
  patrons: ReadonlyMap<string, string>,
): GateCheck[] {
  return gateChecks(
    records.map((r) => ({
      index: r.index,
      events: r.input.events,
      proposals: r.input.proposals,
    })),
    GODS,
    patrons,
  );
}

/** Reads each god's identity from its authored profile file. */
export function loadGodIdentities(
  dir: string,
  ids: readonly string[],
): Map<string, GodIdentity> {
  const identities = new Map<string, GodIdentity>();
  for (const id of ids) {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));
    } catch (error) {
      throw new Error(
        `no profile for ${id} in ${dir}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    identities.set(id, {
      id,
      name: String(raw.name),
      domains: raw.domains as string[],
      drives: raw.drives as Record<string, number>,
      abilities: (raw.abilities as { name: string; action: string }[]).map(
        (a) => ({ name: a.name, action: a.action }),
      ),
    });
  }
  return identities;
}

/** `tools/scenarios/m2-greek-cast/episodes/<timestamp>/`, the timestamp safe as a file name. */
export function defaultOutDir(now: Date = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/\.\d+Z$/, "")
    .replaceAll(":", "-");
  return join(REPO_ROOT, "tools/scenarios/m2-greek-cast/episodes", stamp);
}

/** What an episode's transcript records about its run: whether an explicit endpoint was hosted or local, never its host, port, or a key. */
export function episodeSettings(
  options: RealOptions,
  run: { ranAt: string; ticks: number; hardware: string },
): EpisodeSettings {
  return {
    model: options.model,
    ...(options.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: options.reasoningEffort }),
    ...(endpointKind(options) === undefined
      ? {}
      : { endpoint: endpointKind(options) }),
    seconds: options.durationMs / 1000,
    ranAt: run.ranAt,
    ticks: run.ticks,
    hardware: run.hardware,
  };
}

export interface EpisodesOptions extends RealOptions {
  readonly episodes: number;
  readonly outDir: string;
}

/** Runs the episodes and writes `episode-N.md` for each and `summary.md`. */
export async function runEpisodes(
  options: EpisodesOptions,
): Promise<readonly EpisodeRecord[]> {
  await prepareOllama(options);
  const identities = loadGodIdentities(
    join(REPO_ROOT, "content/greek/gods"),
    GODS,
  );
  const patrons = loadAuthoredPatrons(join(REPO_ROOT, "content/greek/world"));
  mkdirSync(options.outDir, { recursive: true });
  const records: EpisodeRecord[] = [];
  for (let index = 1; index <= options.episodes; index += 1) {
    await collectRun(options, (run) => {
      const record: EpisodeRecord = {
        index,
        total: options.episodes,
        settings: episodeSettings(options, run.record),
        identities: GODS.flatMap((god) => {
          const identity = identities.get(god);
          return identity ? [identity] : [];
        }),
        input: run.input,
        analysis: run.record.analysis,
        episode: analyzeEpisode(run.input, identities, GODS),
        patrons,
      };
      writeFileSync(
        join(options.outDir, `episode-${index}.md`),
        renderTranscript(record),
      );
      // One turn as the model saw it, redacted with every key the run held.
      writeSamplePrompt(
        options.outDir,
        run.sample,
        { index, total: options.episodes },
        Object.values(options.keys ?? {}),
      );
      records.push(record);
    });
  }
  writeFileSync(
    join(options.outDir, "summary.md"),
    renderSummary(records, {
      seconds: options.durationMs / 1000,
      model: options.model,
      ...(options.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: options.reasoningEffort }),
      ...(endpointKind(options) === undefined
        ? {}
        : { endpoint: endpointKind(options) }),
      files: records.map((r) => `episode-${r.index}.md`),
      gate: gateOf(records, patrons),
      patrons,
    }),
  );
  return records;
}
