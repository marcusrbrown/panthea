// When each god was asked and how long it waited, read from what the run's trace
// and journal already hold: the trace row of every model request (the god, how
// long it took, the prompt it was shown, and when the row was written), and the
// journal's tick for each proposal it consumed. Pure functions over `RealInput`;
// no world state is added, and none of the gate's checks reads any of this.
//
// A request is written to the trace when it finishes, so one still running when
// the service stopped leaves no row. It is inferred here, and marked so: turns
// run one at a time (apps/simulation/src/agents.ts, `dispatch`), so a quiet
// stretch after the last recorded answer is a request in flight, to the next god
// in id order that has no proposal waiting.

import type { RealInput, RealRequest } from "./real-analysis";

export type RequestOutcome = "answered" | "exhausted" | "in-flight";

export interface TimedRequest {
  readonly god: string;
  /** The tick on the prompt the god was shown; estimated from the wall clock for a request in flight. */
  readonly startTick: number | undefined;
  readonly startTickEstimated?: true;
  /** The tick the journal consumed the god's proposal in; absent for a request that produced none, or none yet. */
  readonly appliedTick: number | undefined;
  readonly latencyMs: number | undefined;
  readonly outcome: RequestOutcome;
  /** For an exhausted request, the reason and detail it kept. */
  readonly detail?: string;
  readonly promptChars: number | undefined;
}

export interface GodTiming {
  readonly god: string;
  /** Requests that finished, answered or exhausted. */
  readonly turns: number;
  /** Ticks between this god's consecutive request starts. */
  readonly medianGapTicks: number | undefined;
  readonly worstGapTicks: number | undefined;
  /** The 95th percentile (nearest rank) of the ticks between this god's consecutive request starts: how long it waits its turn on one model (ADR-0005's 105 s target, a tick being a second). */
  readonly p95GapTicks: number | undefined;
  readonly medianLatencyMs: number | undefined;
}

export interface RequestTimings {
  readonly requests: readonly TimedRequest[];
  readonly perGod: readonly GodTiming[];
}

/** How long after the last recorded answer the run must have gone on for a request to be taken as in flight: a tick for the next turn to be dispatched, and a little over. */
export const IN_FLIGHT_QUIET_MS = 1500;

const TICK_LINE = / in the \w+ realm, tick (\d+)\./;

const startTickOf = (request: RealRequest): number | undefined => {
  const found = TICK_LINE.exec(request.promptPayload ?? "");
  return found === null ? undefined : Number(found[1]);
};

const median = (values: readonly number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

/** The nearest-rank percentile of `values`, or undefined with none. */
export const percentile = (
  values: readonly number[],
  share: number,
): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)];
};

const detailOf = (request: RealRequest): string | undefined => {
  const step = request.steps.find((s) => s.reason !== undefined);
  if (step === undefined) return undefined;
  return step.detail === undefined || step.detail === ""
    ? step.reason
    : `${step.reason}: ${step.detail.slice(0, 120)}`;
};

export function requestTimings(input: RealInput): RequestTimings {
  const consumed = new Map<string, number | undefined>(
    input.proposals.map((p) => [p.proposalId, p.consumedTick]),
  );
  const requests: TimedRequest[] = input.requests.map((request) => {
    const detail =
      request.outcome === "exhausted" ? detailOf(request) : undefined;
    return {
      god: request.role,
      startTick: startTickOf(request),
      appliedTick:
        request.proposalId === undefined
          ? undefined
          : consumed.get(request.proposalId),
      latencyMs: request.elapsedMs,
      outcome: request.outcome === "intent" ? "answered" : "exhausted",
      ...(detail === undefined ? {} : { detail }),
      promptChars: request.promptPayload?.length,
    };
  });

  const timing = input.timing;
  const last = input.requests.at(-1);
  if (
    timing !== undefined &&
    last?.recordedAt !== undefined &&
    timing.endedAtMs - last.recordedAt >= IN_FLIGHT_QUIET_MS
  ) {
    const gods = [...timing.gods].sort();
    const waiting = new Set(
      input.proposals
        .filter((p) => p.consumedTick === undefined)
        .map((p) => p.actor),
    );
    const eligible = gods.filter((god) => !waiting.has(god));
    const next =
      eligible.find((god) => god > last.role) ?? eligible[0] ?? undefined;
    if (next !== undefined) {
      const quietS = Math.floor((timing.endedAtMs - last.recordedAt) / 1000);
      requests.push({
        god: next,
        startTick: Math.max(0, timing.endTick - quietS),
        startTickEstimated: true,
        appliedTick: undefined,
        latencyMs: undefined,
        outcome: "in-flight",
        promptChars: undefined,
      });
    }
  }

  const known = new Set(timing?.gods ?? []);
  for (const request of requests) known.add(request.god);
  const perGod = [...known].sort().map((god): GodTiming => {
    const finished = requests.filter(
      (r) => r.god === god && r.outcome !== "in-flight",
    );
    const starts = finished.flatMap((r) =>
      r.startTick === undefined ? [] : [r.startTick],
    );
    const gaps = starts.slice(1).map((tick, i) => tick - (starts[i] as number));
    return {
      god,
      turns: finished.length,
      medianGapTicks: median(gaps),
      worstGapTicks: gaps.length === 0 ? undefined : Math.max(...gaps),
      p95GapTicks: percentile(gaps, 0.95),
      medianLatencyMs: median(
        finished.flatMap((r) =>
          r.latencyMs === undefined ? [] : [r.latencyMs],
        ),
      ),
    };
  });
  return { requests, perGod };
}

const seconds = (ms: number | undefined) =>
  ms === undefined ? "—" : `${(ms / 1000).toFixed(1)} s`;
const ticks = (value: number | undefined) =>
  value === undefined ? "—" : String(value);

/** The two markdown tables: one row per request in the order they ran, and one row per god. */
export function renderRequestTimings(timings: RequestTimings): string[] {
  if (timings.requests.length === 0 && timings.perGod.length === 0) return [];
  const outcome = (r: TimedRequest) =>
    r.outcome === "in-flight"
      ? "in flight at the end (inferred)"
      : r.outcome === "exhausted"
        ? `exhausted${r.detail === undefined ? "" : ` (${r.detail})`}`
        : "answered";
  return [
    "",
    "Requests, in the order they ran (one at a time):",
    "",
    "| # | God | Asked at tick | Applied at tick | Latency | Outcome | Prompt chars |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...timings.requests.map(
      (r, i) =>
        `| ${i + 1} | ${r.god} | ${r.startTickEstimated === true ? "≈" : ""}${ticks(r.startTick)} | ${ticks(r.appliedTick)} | ${seconds(r.latencyMs)} | ${outcome(r)} | ${r.promptChars ?? "—"} |`,
    ),
    "",
    "Each god's turns (finished requests; the gap is the ticks between its request starts):",
    "",
    "| God | Turns | Median gap (ticks) | p95 gap (ticks) | Worst gap (ticks) | Median latency |",
    "| --- | --- | --- | --- | --- | --- |",
    ...timings.perGod.map(
      (g) =>
        `| ${g.god} | ${g.turns} | ${ticks(g.medianGapTicks)} | ${ticks(g.p95GapTicks)} | ${ticks(g.worstGapTicks)} | ${seconds(g.medianLatencyMs)} |`,
    ),
  ];
}

// --- Service time: the gaps with the windows that had no service left out ------------------------

/** A span of ticks in which the model could not be reached or the sidecar was stopped. */
export interface TickWindow {
  readonly fromTick: number;
  readonly toTick: number;
  readonly label: string;
}

/**
 * The ticks between `from` and `to` that are not inside any window: a gap's service time. A window that lies wholly
 * or partly inside the gap takes its overlap off; windows never overlap one another.
 */
export function serviceGap(
  from: number,
  to: number,
  windows: readonly TickWindow[],
): number {
  let gap = Math.max(0, to - from);
  for (const window of windows) {
    const overlap =
      Math.min(to, window.toTick) - Math.max(from, window.fromTick);
    if (overlap > 0) gap -= overlap;
  }
  return Math.max(0, gap);
}

export interface QuietStretch {
  readonly fromTick: number;
  readonly toTick: number;
  readonly serviceTicks: number;
  /** The stretch from the god's last request to the end of the run. */
  readonly toEnd: boolean;
}

export interface GodServiceTiming {
  readonly god: string;
  /** Requests that finished, answered or exhausted, and had a start tick. */
  readonly turns: number;
  /** p95 of the service ticks between consecutive request starts: the gate's queue wait. */
  readonly p95ServiceGapTicks: number | undefined;
  /** p95 of the raw ticks between them, windows included. */
  readonly p95InclusiveGapTicks: number | undefined;
  /** The longest stretch of service time with no request from the god, run start and run end included. */
  readonly longestQuiet: QuietStretch;
  /** Service gaps longer than `longGapTicks`: stretches in which the scheduler gave the god no turn (inferred; skips are not journaled). */
  readonly longGaps: number;
}

/**
 * Each god's queue wait and longest quiet stretch in service time, from the request starts `timings` read. `windows`
 * are left out of both; the inclusive p95 is given beside the service one. A request still in flight at the end is not
 * a start. Nothing here changes what `requestTimings` returns.
 */
export function serviceTimings(
  timings: RequestTimings,
  options: {
    readonly windows: readonly TickWindow[];
    readonly startTick: number;
    readonly endTick: number;
    readonly gods: readonly string[];
    readonly longGapTicks: number;
  },
): GodServiceTiming[] {
  return options.gods.map((god): GodServiceTiming => {
    const starts = timings.requests
      .filter(
        (r) =>
          r.god === god &&
          r.outcome !== "in-flight" &&
          r.startTick !== undefined,
      )
      .map((r) => r.startTick as number)
      .sort((a, b) => a - b);
    const points = [options.startTick, ...starts, options.endTick];
    let longest: QuietStretch = {
      fromTick: options.startTick,
      toTick: options.endTick,
      serviceTicks: 0,
      toEnd: true,
    };
    let first = true;
    for (let i = 1; i < points.length; i += 1) {
      const from = points[i - 1] as number;
      const to = points[i] as number;
      const serviceTicks = serviceGap(from, to, options.windows);
      if (first || serviceTicks > longest.serviceTicks) {
        longest = {
          fromTick: from,
          toTick: to,
          serviceTicks,
          toEnd: i === points.length - 1,
        };
        first = false;
      }
    }
    const gaps = starts.slice(1).map((tick, i) => ({
      service: serviceGap(starts[i] as number, tick, options.windows),
      raw: tick - (starts[i] as number),
    }));
    return {
      god,
      turns: starts.length,
      p95ServiceGapTicks: percentile(
        gaps.map((g) => g.service),
        0.95,
      ),
      p95InclusiveGapTicks: percentile(
        gaps.map((g) => g.raw),
        0.95,
      ),
      longestQuiet: longest,
      longGaps: gaps.filter((g) => g.service > options.longGapTicks).length,
    };
  });
}
