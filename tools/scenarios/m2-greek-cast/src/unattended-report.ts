// The report of an unattended run: a document the owner can read and rate without opening the database. It states what
// the run proves and what it does not, shows the phase timeline, each god's part, the recovery, the resources, the
// catch-up and the export and rebuild, then the threshold table and its verdict, and the sheet the owner rates on.
//
// It names no host, port, path, key reference or user: the endpoint is "a local OpenAI-compatible endpoint".

import { type CutPrompts, namesSuspected } from "./prompt-cut";
import { RUBRIC_SCALE, rubricTable } from "./transcript";
import type { Boundary } from "./unattended";
import type { UnattendedRunData } from "./unattended-analysis";
import {
  analyzeUnattended,
  CONTEXT_TOKENS,
  PHASES,
  QUEUE_WAIT_TARGET_TICKS,
  type ThresholdRow,
  type UnattendedAnalysis,
} from "./unattended-analysis";

const MINUTE = 60_000;
const min = (ms: number): string => (ms / MINUTE).toFixed(1);
const sec = (ms: number | undefined): string =>
  ms === undefined ? "—" : `${(ms / 1000).toFixed(1)} s`;
const mib = (bytes: number | undefined): string =>
  bytes === undefined ? "—" : `${(bytes / 1048576).toFixed(0)} MiB`;
const trendText = (
  trend: UnattendedAnalysis["memory"]["footprintTrend"],
): string =>
  trend.judgeable
    ? `${trend.percentPer10Min.toFixed(2)}% per 10 min over the last ${trend.windowSamples} samples`
    : `not judgeable: ${trend.reason}`;
const growthText = (
  growth: UnattendedAnalysis["memory"]["settledGrowth"],
): string =>
  growth.judgeable
    ? `${growth.growthPercent < 0 ? "-" : "+"}${Math.abs(growth.growthPercent).toFixed(2)}% (the mean of the second half over the first half's, over ${min(growth.settledMs)} min that start after the first 15 minutes (scaled to the run's length) following the last catch-up; ${mib(growth.firstHalfMeanBytes)} then ${mib(growth.secondHalfMeanBytes)}; at most +10% passes)`
    : `not judgeable: ${growth.reason}`;
const cell = (text: string): string => text.replaceAll("|", "/");

/** What the run proves, and what it does not. */
export const CLAIMS: readonly string[] = [
  "A14 (export and rebuild): the exported archive and a rebuild from genesis and the event log reproduce the live world, once, on this world. It proves export and rebuild only; it does not prove import into a different build or machine.",
  "P07 (provider outage): the world kept running through a local outage of the model endpoint, and the gods acted again when it returned. It proves a local outage only, produced by a proxy; it does not prove behaviour under a hosted provider's failure modes.",
  "It makes no claim for A15 (the eight-hour trial) and no claim beyond one hour of running time.",
];

function timeline(boundaries: readonly Boundary[]): string[] {
  return [
    "| Phase | Wall time (UTC) | Tick | Running (min) | Note |",
    "| --- | --- | --- | --- | --- |",
    ...boundaries.map(
      (b) =>
        `| ${b.phase} | ${new Date(b.wallMs).toISOString().replace(/\.\d+Z$/, "Z")} | ${b.tick} | ${min(b.runningMs)} | ${cell(b.note ?? "")} |`,
    ),
  ];
}

function godsTable(analysis: UnattendedAnalysis): string[] {
  return [
    "| God | Actions | Legends | Longest run | Requests | Answered | Exhausted | Over cap | Rejected | Goal-only | Influence |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...analysis.gods.map((g) => {
      const list = (counts: Readonly<Record<string, number>>): string => {
        const text = Object.entries(counts)
          .map(([why, n]) => `${why} ${n}`)
          .join(", ");
        return text === "" ? "0" : text;
      };
      return `| ${g.god} | ${g.actions} | ${g.legends} | ${g.longestRun === undefined ? "—" : `${g.longestRun.length}`} | ${g.requests} | ${g.answered} | ${list(g.exhausted)} | ${g.overCap} | ${list(g.rejected)} | ${g.goalOnly} | ${g.influence} |`;
    }),
  ];
}

function idleReasons(analysis: UnattendedAnalysis): string[] {
  const lines: string[] = [];
  for (const g of analysis.gods) {
    const gap = g.service.longGaps;
    if (gap > 0) {
      lines.push(
        `- ${g.god}: ${gap} ${gap === 1 ? "gap" : "gaps"} longer than ${QUEUE_WAIT_TARGET_TICKS} service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.`,
      );
    }
    if (g.requests === 0) {
      lines.push(
        `- ${g.god}: no request at all. Inferred: never scheduled, or in flight at the stop.`,
      );
    }
  }
  return lines.length === 0
    ? [
        `Every god took its turns without a gap over ${QUEUE_WAIT_TARGET_TICKS} service ticks.`,
      ]
    : lines;
}

function queueTable(analysis: UnattendedAnalysis): string[] {
  return [
    "| God | Turns | p95 queue wait, service time | p95 including the windows | Longest quiet stretch | Where |",
    "| --- | --- | --- | --- | --- | --- |",
    ...analysis.gods.map((g) => {
      const s = g.service;
      return `| ${g.god} | ${s.turns} | ${s.p95ServiceGapTicks ?? "—"} | ${s.p95InclusiveGapTicks ?? "—"} | ${s.longestQuiet.serviceTicks} | ticks ${s.longestQuiet.fromTick} to ${s.longestQuiet.toTick}${s.longestQuiet.toEnd ? " (to the end of the run)" : ""} |`;
    }),
    "",
    `Service time leaves out ${analysis.windows.map((w) => `${w.label} (ticks ${w.fromTick} to ${w.toTick})`).join(" and ") || "no window"}. Waiting after the proxy returned counts.`,
  ];
}

function influenceTable(analysis: UnattendedAnalysis): string[] {
  return [
    `| God | ${PHASES.join(" | ")} |`,
    `| --- | ${PHASES.map(() => "---").join(" | ")} |`,
    ...analysis.gods.map(
      (g) =>
        `| ${g.god} | ${PHASES.map((p) => g.influenceByPhase[p]).join(" | ")} |`,
    ),
  ];
}

function directorTable(analysis: UnattendedAnalysis): string[] {
  const kinds = Object.keys(analysis.director).sort();
  if (kinds.length === 0) return ["The director fired no event."];
  return [
    `| Kind | ${PHASES.join(" | ")} |`,
    `| --- | ${PHASES.map(() => "---").join(" | ")} |`,
    ...kinds.map(
      (kind) =>
        `| ${kind} | ${PHASES.map((p) => analysis.director[kind]?.[p] ?? 0).join(" | ")} |`,
    ),
  ];
}

function thresholds(rows: readonly ThresholdRow[]): string[] {
  return [
    "| Threshold | Result | Measured | Limit |",
    "| --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| ${cell(r.name)} | ${r.ok ? "pass" : "**FAIL**"} | ${cell(r.measured)} | ${cell(r.threshold)} |`,
    ),
  ];
}

const ratingSheet = (analysis: UnattendedAnalysis): string[] => {
  const episodes = (
    heading: string,
    moments: UnattendedAnalysis["moments"]["director"],
  ): string[] => [
    `**${heading}**`,
    "",
    ...(moments.length === 0
      ? ["No episode of this kind was found in the run."]
      : moments.map((m) => `- tick ${m.tick} (${m.phase}): ${m.text}`)),
    "",
    ...rubricTable(),
    "",
  ];
  return [
    "The verdict above says whether the run held its thresholds; this sheet is where you decide whether the world was worth watching. The rubric is the acceptance rubric (docs/product/acceptance.md), the same one the episode transcripts carry. Score the two kinds of episode separately, each on every dimension.",
    "",
    RUBRIC_SCALE,
    "",
    ...episodes("Episodes the director caused", analysis.moments.director),
    ...episodes("Episodes a god caused", analysis.moments.gods),
    "M2 exits only on a PASS verdict and your approval of these episodes. Decision: ______ (approve / not yet), date ______.",
  ];
};

/** The whole report. */
/** What the cut-prompt check found, in a sentence: Ollama cuts an over-long prompt and reports what is left, so the busiest count alone cannot show it. */
function cutSentence(cut: CutPrompts): string {
  const gods = Object.entries(cut.byGod)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([god, n]) => `${god} ${n}`);
  const how = `A response matched to its request is taken as cut when it reports far fewer tokens than its prompt's length predicts from this run's median${cut.medianTokensPerChar === undefined ? "" : ` of ${cut.medianTokensPerChar.toFixed(3)} a character`}. One with no prompt length to read it against is only suspected, when it reports exactly ${cut.collapsedAt} tokens (what Ollama reports for a cut prompt at this context); a suspected cut does not fail the row.`;
  const found =
    cut.cut === 0
      ? "None was cut."
      : `${cut.cut} ${cut.cut === 1 ? "was" : "were"} cut${gods.length === 0 ? "" : ` (${gods.join(", ")})`}.`;
  const suspected =
    cut.suspected === 0
      ? ""
      : ` ${cut.suspected} ${cut.suspected === 1 ? "response was" : "responses were"} suspected (${namesSuspected(cut)}; exactly ${cut.collapsedAt} tokens, not read against a prompt length).`;
  return `${how} ${found}${suspected}${cut.calibrated ? "" : ` The length check was not run: only ${cut.matched} responses matched a request.`}`;
}

export function renderUnattendedReport(
  data: UnattendedRunData,
  analysis: UnattendedAnalysis = analyzeUnattended(data),
): string {
  const { result } = data;
  const plan = result.plan;
  const settings = result.settings;
  const baseline = result.baseline;
  const memory = analysis.memory;
  const lines: string[] = [
    "# Unattended run",
    "",
    `**Verdict: ${analysis.verdict}**${analysis.verdict === "not a gate run" ? ` (a ${plan.minutes}-minute development run; thresholds below are shown for reading and give no verdict)` : ""}`,
    "",
    result.status === "completed"
      ? ""
      : `The run did not complete: ${result.reason ?? result.status}.`,
    "",
    `Running time ${min(result.runningMs)} min of ${plan.minutes}; elapsed wall time ${min(result.elapsedWallMs)} min (the stopped gap of ${min(plan.gapMs)} min is not running time).`,
    settings === undefined
      ? ""
      : `The model ran at ${settings.endpoint === "local" ? "a local" : "a hosted"} OpenAI-compatible endpoint (${settings.model}${settings.reasoningEffort === undefined ? "" : `, reasoning ${settings.reasoningEffort}`}).`,
    "",
    "## What this run proves",
    "",
    ...CLAIMS.map((c) => `- ${c}`),
    "",
    "## Phase timeline",
    "",
    ...timeline(result.boundaries),
    "",
    result.outage === undefined
      ? ""
      : result.outage.trigger === "gods"
        ? `The outage started when ${result.outage.godsActed} of ${data.gods.length} gods had acted.`
        : `The outage started at the time bound: only ${result.outage.godsActed} of ${data.gods.length} gods had acted.`,
    "",
    "## Gods",
    "",
    ...godsTable(analysis),
    "",
    "Counts leave out the outage window; its requests appear under exhausted as outage.",
    "",
    "### Idle reasons",
    "",
    ...idleReasons(analysis),
    "",
    "### Relationship and belief changes by phase",
    "",
    ...influenceTable(analysis),
    "",
    "## Queue wait and quiet stretches",
    "",
    ...queueTable(analysis),
    "",
    "## Latency",
    "",
    `Steady-state requests took a median of ${sec(analysis.latency.steadyP50Ms)} and a p95 of ${sec(analysis.latency.steadyP95Ms)}. The first request after the proxy returned took ${sec(analysis.latency.firstAfterRecoveryMs)}, kept apart because it may include a cold reload (the Ollama runner was ${analysis.latency.runnerAtRestore} when the proxy returned).`,
    "",
    "## Recovery",
    "",
    analysis.recovery.proxyRestoredTick === undefined
      ? "The outage did not end, so there is no recovery."
      : `proxyRestoredAt was tick ${analysis.recovery.proxyRestoredTick}. Reasoning resumed ${analysis.recovery.reasoningResumed === undefined ? "never" : `at tick ${analysis.recovery.reasoningResumed.tick}, ${analysis.recovery.reasoningResumed.afterTicks} ticks later`}. The first god action committed ${analysis.recovery.godActed === undefined ? "never" : `at tick ${analysis.recovery.godActed.tick} (${analysis.recovery.godActed.god}), ${analysis.recovery.godActed.afterTicks} ticks later`}.`,
    "",
    "## Prompt size and the empty-200 fault",
    "",
    analysis.promptTokens.busiest === undefined
      ? "No response carried a prompt token count."
      : `The busiest prompt was ${analysis.promptTokens.busiest} tokens of ${CONTEXT_TOKENS} (${analysis.promptTokens.recorded} responses counted). ${cutSentence(analysis.promptTokens.cut)}`,
    `Ollama's empty-200 response occurred ${analysis.empty.total} times, at most ${analysis.empty.longestRun} in a row.`,
    "",
    "## Director events by kind and phase",
    "",
    ...directorTable(analysis),
    "",
    "## Memory",
    "",
    `${memory.samples} samples over ${min(memory.spanMs)} min. Ollama runner: start ${mib(memory.runner.start)}, peak ${mib(memory.runner.peak)}, end ${mib(memory.runner.end)} (${memory.runner.present} present, ${memory.runner.absent} absent); footprint start ${mib(memory.runnerFootprint.start)}, peak ${mib(memory.runnerFootprint.peak)}, end ${mib(memory.runnerFootprint.end)}. Sidecar: RSS start ${mib(memory.sidecar.start)}, peak ${mib(memory.sidecar.peak)}, end ${mib(memory.sidecar.end)}. Sidecar footprint: start ${mib(memory.sidecarFootprint.start)}, peak ${mib(memory.sidecarFootprint.peak)}, end ${mib(memory.sidecarFootprint.end)}. Swap used: peak ${memory.swapUsedMiB.peak === undefined ? "—" : `${memory.swapUsedMiB.peak.toFixed(0)} MiB`}.`,
    "",
    `The memory row is judged on the sidecar's physical footprint across the settled span: ${growthText(memory.settledGrowth)}. It is not judged on RSS, which counts pages the allocator has freed and the kernel has not taken back and rises under allocation churn, nor on a slope: a window slope of a footprint that swings by ±10 MiB reads differently with where the window sits. For context only, Footprint trend over the last 20 minutes: ${trendText(memory.footprintTrend)}. Sidecar RSS trend: ${trendText(memory.sidecarTrend)}.`,
    "",
    "## Export and rebuild",
    "",
    baseline === undefined
      ? "No baseline was captured."
      : [
          `Store ${baseline.store.state === "captured" ? `${mib(baseline.store.bytes)} (WAL ${mib(baseline.store.walBytes)})` : `missing: ${baseline.store.reason}`}; archive ${baseline.archive.state === "captured" ? `${mib(baseline.archive.bytes)} at event ${baseline.archive.eventSequence}` : `missing: ${baseline.archive.reason}`}.`,
          baseline.rebuild.state === "captured"
            ? `Rebuild from genesis and ${baseline.rebuild.events} events took ${baseline.rebuild.ms} ms in a separate process and ${baseline.rebuild.equal ? "equals the live projection" : `differs from the live projection at ${baseline.rebuild.firstDifference ?? "an unknown path"}`}.`
            : `Rebuild missing: ${baseline.rebuild.reason}.`,
          baseline.importProof.state === "captured"
            ? baseline.importProof.ok
              ? `The archive imported into a scratch slot (${baseline.importProof.events} events).`
              : `The archive was refused on import: ${baseline.importProof.refusal?.reason ?? "unknown"}.`
            : `Import missing: ${baseline.importProof.reason}.`,
        ].join(" "),
    "",
    "## Threshold table",
    "",
    ...thresholds(analysis.rows),
    "",
    `**Verdict: ${analysis.verdict}**`,
    "",
    "## Rating sheet",
    "",
    ...ratingSheet(analysis),
    "",
  ];
  return lines
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");
}
