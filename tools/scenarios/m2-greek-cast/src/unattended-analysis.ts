// What an unattended run shows, computed from what it stored: its boundaries, the model requests and proposals in the
// world's trace and journal, the proxy's response records, the memory samples and the end capture. Pure functions: the
// threshold table's verdict is a function of this data alone, so every row has a positive control on synthetic data.
//
// The per-god checks, the influence attribution, the request timings and the knowledge-boundary properties are the
// existing ones, called and not redefined. The new rules are the ones about time: the windows with no service are left
// out of queue wait and of the longest quiet stretch; the recovery after the proxy returns is judged in ticks.

import type { StoredEvent } from "./checks";
import {
  analyzeEpisode,
  type EpisodeCheck,
  type GodIdentity,
  influencedBy,
  MIN_ACTIONS,
  parseEvents,
  REPETITION_CAP,
} from "./episode-analysis";
import type { MemorySample, MemorySummary } from "./memory";
import { summarizeMemory } from "./memory";
import type { ProxyRecord } from "./outage-proxy";
import {
  analyzeReal,
  committedInOrder,
  type RealInput,
  type RealProposal,
  type RealRequest,
} from "./real-analysis";
import {
  type GodServiceTiming,
  percentile,
  requestTimings,
  serviceTimings,
  type TickWindow,
} from "./request-timing";
import type {
  Boundary,
  GateOutcome,
  GateVerdict,
  PhaseName,
  UnattendedResult,
} from "./unattended";

/** ADR-0005's queue-wait target for a god on one model, in service ticks (a tick is a second). */
export const QUEUE_WAIT_TARGET_TICKS = 90;
/** The longest a god may go with no request, in service ticks: about three times the worst gap measured. */
export const QUIET_LIMIT_TICKS = 300;
/** Ticks after the proxy returns within which reasoning resumes and the gods act again. */
export const RECOVERY_LIMIT_TICKS = 150;
/** The model's context, in tokens; a prompt is cut silently past about this. */
export const CONTEXT_TOKENS = 4096;

// --- The data an analysis reads -----------------------------------------------------------------

export interface UnattendedRunData {
  readonly result: UnattendedResult;
  readonly input: RealInput;
  readonly proxy: readonly ProxyRecord[];
  readonly memory: readonly MemorySample[];
  readonly identities: ReadonlyMap<string, GodIdentity>;
  readonly gods: readonly string[];
}

export type PhaseId =
  | "steady"
  | "outage"
  | "recovery"
  | "catch-up"
  | "after catch-up";

export const PHASES: readonly PhaseId[] = [
  "steady",
  "outage",
  "recovery",
  "catch-up",
  "after catch-up",
];

export type RowGroup =
  | "run"
  | "outage"
  | "recovery"
  | "catch-up"
  | "gods"
  | "queue"
  | "knowledge"
  | "resources"
  | "rebuild";

export interface ThresholdRow {
  readonly id: string;
  readonly group: RowGroup;
  readonly name: string;
  readonly ok: boolean;
  readonly measured: string;
  readonly threshold: string;
}

export type Verdict = GateVerdict;

export interface GodReport {
  readonly god: string;
  /** Committed model actions, goal changes left out. */
  readonly actions: number;
  readonly legends: number;
  readonly longestRun:
    | { readonly length: number; readonly key: string }
    | undefined;
  readonly influence: number;
  readonly influenceByPhase: Readonly<Record<PhaseId, number>>;
  readonly requests: number;
  readonly answered: number;
  readonly exhausted: Readonly<Record<string, number>>;
  readonly rejected: Readonly<Record<string, number>>;
  readonly goalOnly: number;
  readonly service: GodServiceTiming;
  readonly checks: readonly EpisodeCheck[];
}

export interface Moment {
  readonly id: string;
  readonly tick: number;
  readonly phase: PhaseId;
  readonly text: string;
}

export interface UnattendedAnalysis {
  readonly verdict: Verdict;
  /** Whether every row holds; a non-gate run has no verdict but still has this. */
  readonly rowsHold: boolean;
  readonly rows: readonly ThresholdRow[];
  readonly windows: readonly TickWindow[];
  readonly endTick: number;
  readonly gods: readonly GodReport[];
  readonly recovery: {
    readonly proxyRestoredTick: number | undefined;
    readonly reasoningResumed:
      | { readonly tick: number; readonly afterTicks: number }
      | undefined;
    readonly godActed:
      | {
          readonly tick: number;
          readonly afterTicks: number;
          readonly god: string;
        }
      | undefined;
  };
  readonly latency: {
    readonly steadyP50Ms: number | undefined;
    readonly steadyP95Ms: number | undefined;
    readonly firstAfterRecoveryMs: number | undefined;
    readonly runnerAtRestore: string;
  };
  readonly promptTokens: {
    readonly busiest: number | undefined;
    readonly recorded: number;
  };
  readonly empty: { readonly total: number; readonly longestRun: number };
  readonly director: Readonly<
    Record<string, Readonly<Record<PhaseId, number>>>
  >;
  readonly memory: MemorySummary;
  readonly moments: {
    readonly director: readonly Moment[];
    readonly gods: readonly Moment[];
  };
  readonly knowledge: readonly {
    readonly name: string;
    readonly ok: boolean;
    readonly detail: string;
  }[];
}

// --- Windows and phases -------------------------------------------------------------------------

/** The verdict and failed rows the exit code is decided on. */
export function gateOutcomeOf(analysis: UnattendedAnalysis): GateOutcome {
  return {
    verdict: analysis.verdict,
    failedRows: analysis.rows.filter((r) => !r.ok).map((r) => r.id),
  };
}

const boundary = (
  result: UnattendedResult,
  phase: PhaseName,
): Boundary | undefined => result.boundaries.find((b) => b.phase === phase);

/** The last tick the run reached. */
export function endTickOf(data: UnattendedRunData): number {
  return (
    boundary(data.result, "ended")?.tick ??
    data.input.timing?.endTick ??
    Math.max(0, ...data.result.boundaries.map((b) => b.tick))
  );
}

/** The two spans with no service: the model cut off, and the sidecar stopped and catching up. */
export function serviceWindows(
  result: UnattendedResult,
  endTick: number,
): TickWindow[] {
  const windows: TickWindow[] = [];
  const outage = boundary(result, "outage-started");
  if (outage !== undefined) {
    windows.push({
      fromTick: outage.tick,
      toTick: boundary(result, "proxy-restored")?.tick ?? endTick,
      label: "outage start to proxyRestoredAt",
    });
  }
  const stopped = boundary(result, "stopped");
  if (stopped !== undefined) {
    windows.push({
      fromTick: stopped.tick,
      toTick: boundary(result, "catch-up-finished")?.tick ?? endTick,
      label: "stop to the end of the catch-up",
    });
  }
  return windows;
}

/** The phase a tick falls in. */
export function phaseOfTick(result: UnattendedResult, tick: number): PhaseId {
  const at = (phase: PhaseName): number =>
    boundary(result, phase)?.tick ?? Number.POSITIVE_INFINITY;
  if (tick >= at("catch-up-finished")) return "after catch-up";
  if (tick >= at("stopped")) return "catch-up";
  if (tick >= at("proxy-restored")) return "recovery";
  if (tick >= at("outage-started")) return "outage";
  return "steady";
}

const emptyByPhase = (): Record<PhaseId, number> => ({
  steady: 0,
  outage: 0,
  recovery: 0,
  "catch-up": 0,
  "after catch-up": 0,
});

// --- Reading requests ---------------------------------------------------------------------------

/** How an exhausted request failed, from what its steps kept and when it finished. */
export function exhaustionReason(
  request: RealRequest,
  outageWallMs: { readonly from: number; readonly to: number } | undefined,
): string {
  const step = request.steps.find((s) => s.reason !== undefined);
  const reason = step?.reason ?? "";
  const detail = step?.detail ?? "";
  if (
    outageWallMs !== undefined &&
    request.recordedAt !== undefined &&
    request.recordedAt >= outageWallMs.from &&
    request.recordedAt <= outageWallMs.to
  ) {
    return "outage";
  }
  if (reason === "http-5xx" || reason === "network") return "outage";
  if (/Invalid JSON response|empty/i.test(detail)) return "empty-200";
  if (/timeout/i.test(reason)) return "timeout";
  if (reason === "invalid-output") return "invalid output";
  return "other";
}

const TICK_LINE = / in the \w+ realm, tick (\d+)\./;
const startTickOf = (request: RealRequest): number | undefined => {
  const found = TICK_LINE.exec(request.promptPayload ?? "");
  return found === null ? undefined : Number(found[1]);
};

const inWall = (
  at: number | undefined,
  span: { readonly from: number; readonly to: number } | undefined,
): boolean =>
  span !== undefined && at !== undefined && at >= span.from && at <= span.to;

/**
 * Whether the outage proxy refused this request: it failed on a transport error (a 5xx or a dropped connection, the
 * proxy's two ways of failing) and finished inside the outage. No model answered it, so it is not a turn the god waited
 * for: it is left out of queue wait and the quiet stretch. A request that failed on a real model response, or on a
 * transport error with no outage to explain it, is not refused and still counts.
 */
export function refusedByOutage(
  request: RealRequest,
  outageWallMs: { readonly from: number; readonly to: number } | undefined,
): boolean {
  if (request.outcome !== "exhausted") return false;
  if (!inWall(request.recordedAt, outageWallMs)) return false;
  return request.steps.some(
    (step) => step.reason === "http-5xx" || step.reason === "network",
  );
}

// --- The analysis -------------------------------------------------------------------------------

const DIRECTOR_KINDS = new Set(["theft", "stock-spoiled", "building-ignited"]);

/** True for a trouble the director itself caused. */
export function isDirectorEvent(event: StoredEvent): boolean {
  if (!DIRECTOR_KINDS.has(String(event.kind))) return false;
  if (event.kind === "building-ignited") {
    return (event.cause as { kind?: string } | undefined)?.kind === "director";
  }
  return event.cause === "director";
}

const minutes = (ms: number): string => (ms / 60_000).toFixed(1);

function pickSpread<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  return Array.from(
    { length: count },
    (_, i) => items[Math.floor((i * items.length) / count)] as T,
  );
}

export function analyzeUnattended(data: UnattendedRunData): UnattendedAnalysis {
  const { result, input, identities, gods } = data;
  const plan = result.plan;
  const endTick = endTickOf(data);
  const windows = serviceWindows(result, endTick);
  const outage = boundary(result, "outage-started");
  const restored = boundary(result, "proxy-restored");
  const started = boundary(result, "started");
  const outageWall =
    outage === undefined
      ? undefined
      : {
          from: outage.wallMs,
          to: restored?.wallMs ?? Number.POSITIVE_INFINITY,
        };
  const rows: ThresholdRow[] = [];
  const row = (
    id: string,
    group: RowGroup,
    name: string,
    ok: boolean,
    measured: string,
    threshold: string,
  ): void => {
    rows.push({ id, group, name, ok, measured, threshold });
  };

  // The proposals a request produced inside the outage, by request time.
  const requestOf = new Map(
    input.requests.flatMap((r) =>
      r.proposalId === undefined ? [] : [[r.proposalId, r] as const],
    ),
  );
  const godProposals = input.proposals.filter((p) => p.outcome === "committed");

  // --- The run ---------------------------------------------------------------------------------
  row(
    "run.completed",
    "run",
    "the run went through every phase and the sidecar stayed up",
    result.status === "completed",
    result.status === "completed"
      ? "completed"
      : `${result.status}: ${result.reason ?? ""}`,
    "completed",
  );
  row(
    "run.running-time",
    "run",
    "running time reaches the plan's length",
    result.runningMs >= plan.runMs,
    `${minutes(result.runningMs)} min running of ${plan.minutes}; ${minutes(result.elapsedWallMs)} min elapsed`,
    `${plan.minutes} min running`,
  );

  // --- The outage ------------------------------------------------------------------------------
  const outageTicks =
    outage !== undefined && restored !== undefined
      ? { from: outage.tick, to: restored.tick }
      : undefined;
  row(
    "outage.tick-advances",
    "outage",
    "the tick keeps advancing through the outage",
    outageTicks !== undefined && outageTicks.to > outageTicks.from,
    outageTicks === undefined
      ? "the outage did not start or did not end"
      : `tick ${outageTicks.from} to ${outageTicks.to}`,
    "advances",
  );
  const godCaused = new Set(input.proposals.map((p) => p.observationId));
  const routine =
    outageTicks === undefined
      ? 0
      : input.events.filter(
          (e) =>
            Number(e.tick) > outageTicks.from &&
            Number(e.tick) <= outageTicks.to &&
            !godCaused.has(String(e.correlationId)),
        ).length;
  row(
    "outage.routines-continue",
    "outage",
    "mortals' routines and the director keep producing events through the outage",
    routine > 0,
    `${routine} events not caused by a god`,
    "at least 1",
  );
  // When an action commits is the tick the world consumed its proposal in, not when its request finished: a request can
  // finish just before the proxy fails and commit on a later tick, inside the outage. The window is the ticks after the
  // outage's own boundary tick up to and including proxyRestoredAt's tick.
  const committedInOutage = (p: RealProposal): boolean => {
    if (outage === undefined) return false;
    if (p.consumedTick !== undefined) {
      return (
        p.consumedTick > outage.tick &&
        p.consumedTick <= (restored?.tick ?? endTick)
      );
    }
    // A proposal not yet consumed has no tick: it falls back on when its request finished.
    return inWall(requestOf.get(p.proposalId)?.recordedAt, outageWall);
  };
  const duringOutage = godProposals.filter(committedInOutage);
  row(
    "outage.no-god-action",
    "outage",
    "no god action commits during the outage",
    outage !== undefined && duringOutage.length === 0,
    outage === undefined
      ? "the outage did not start"
      : `${duringOutage.length} committed ${duringOutage.length === 1 ? "action" : "actions"}${duringOutage[0] ? ` (${duringOutage[0].actor} ${duringOutage[0].kind})` : ""}`,
    "0",
  );

  // --- The recovery ----------------------------------------------------------------------------
  const afterRestore = (r: RealRequest): boolean =>
    restored !== undefined &&
    r.recordedAt !== undefined &&
    r.recordedAt >= restored.wallMs;
  const answeredAfter = input.requests
    .filter((r) => r.outcome === "intent" && afterRestore(r))
    .sort((a, b) => (a.recordedAt ?? 0) - (b.recordedAt ?? 0));
  let reasoningResumed: { tick: number; afterTicks: number } | undefined;
  const firstAnswer = answeredAfter[0];
  if (restored !== undefined && firstAnswer !== undefined) {
    const start = startTickOf(firstAnswer);
    const tick =
      start === undefined
        ? restored.tick +
          Math.round(((firstAnswer.recordedAt ?? 0) - restored.wallMs) / 1000)
        : start + Math.round(firstAnswer.elapsedMs / 1000);
    reasoningResumed = { tick, afterTicks: Math.max(0, tick - restored.tick) };
  }
  row(
    "recovery.reasoning-resumes",
    "recovery",
    "reasoning resumes: a request is answered with an intent within 150 ticks of proxyRestoredAt",
    reasoningResumed !== undefined &&
      reasoningResumed.afterTicks <= RECOVERY_LIMIT_TICKS,
    reasoningResumed === undefined
      ? "no request was answered after the proxy returned"
      : `answered ${reasoningResumed.afterTicks} ticks after (tick ${reasoningResumed.tick})`,
    `at most ${RECOVERY_LIMIT_TICKS} ticks`,
  );
  const actedAfter = godProposals
    .filter((p) => afterRestore(requestOf.get(p.proposalId) as RealRequest))
    .sort((a, b) => (a.consumedTick ?? 0) - (b.consumedTick ?? 0))[0];
  const godActed =
    restored !== undefined && actedAfter !== undefined
      ? {
          tick: actedAfter.consumedTick ?? restored.tick,
          afterTicks: Math.max(
            0,
            (actedAfter.consumedTick ?? restored.tick) - restored.tick,
          ),
          god: actedAfter.actor,
        }
      : undefined;
  row(
    "recovery.gods-act-again",
    "recovery",
    "gods act again: a god action commits within 150 ticks of proxyRestoredAt",
    godActed !== undefined && godActed.afterTicks <= RECOVERY_LIMIT_TICKS,
    godActed === undefined
      ? "no god action committed after the proxy returned"
      : `${godActed.god} committed ${godActed.afterTicks} ticks after (tick ${godActed.tick})`,
    `at most ${RECOVERY_LIMIT_TICKS} ticks`,
  );

  // --- The catch-up ----------------------------------------------------------------------------
  const catchUpChecks: Record<string, string> = {
    "the sidecar stops cleanly": "catch-up.clean-stop",
    "the catch-up is bracketed by its own log lines": "catch-up.bracketed",
    "the catch-up applies the cap and discards the rest": "catch-up.cap",
    "no provider request is made during the catch-up": "catch-up.no-requests",
    "the catch-up summary persists to the end, or a later catch-up pass replaced it":
      "catch-up.summary-persists",
  };
  for (const [name, id] of Object.entries(catchUpChecks)) {
    const found = result.checks.find((c) => c.name === name);
    row(
      id,
      "catch-up",
      name,
      found?.ok === true,
      found?.detail ?? "not reached",
      "holds",
    );
  }

  // --- The gods --------------------------------------------------------------------------------
  // The outage is left out of every per-god count: nothing a god did inside it can raise or lower a threshold.
  const keptRequests = input.requests.filter(
    (r) => !inWall(r.recordedAt, outageWall),
  );
  // Requests are left out by when they finished, actions by when they commit: the same window the outage row judges.
  const keptInput: RealInput = {
    ...input,
    requests: keptRequests,
    proposals: input.proposals.filter((p) => !committedInOutage(p)),
  };
  const episode = analyzeEpisode(keptInput, identities, gods);
  // Queue wait and the quiet stretch are measured on the requests the model answered: the ones the outage proxy
  // refused, hundreds of them a second apart, would otherwise make a god look as if it were asked far more often.
  const allTimings = requestTimings({
    ...input,
    requests: input.requests.filter((r) => !refusedByOutage(r, outageWall)),
  });
  const service = serviceTimings(allTimings, {
    windows,
    startTick: started?.tick ?? 0,
    endTick,
    gods,
    longGapTicks: QUEUE_WAIT_TARGET_TICKS,
  });
  const parsed = parseEvents(input.events);
  const godReports: GodReport[] = gods.map((god) => {
    const e = episode.gods.find((g) => g.god === god);
    const committed = committedInOrder(god, keptInput.proposals, input.events);
    const influenceByPhase = emptyByPhase();
    for (const action of committed) {
      for (const credited of influencedBy(action.caused, parsed)) {
        influenceByPhase[phaseOfTick(result, Number(credited.tick))] += 1;
      }
    }
    const requests = keptRequests.filter((r) => r.role === god);
    const exhausted: Record<string, number> = {};
    for (const r of requests.filter((x) => x.outcome === "exhausted")) {
      const why = exhaustionReason(r, outageWall);
      exhausted[why] = (exhausted[why] ?? 0) + 1;
    }
    const outageExhausted = input.requests.filter(
      (r) =>
        r.role === god &&
        r.outcome === "exhausted" &&
        inWall(r.recordedAt, outageWall),
    ).length;
    if (outageExhausted > 0)
      exhausted.outage = (exhausted.outage ?? 0) + outageExhausted;
    const rejected: Record<string, number> = {};
    for (const p of keptInput.proposals.filter(
      (x) => x.actor === god && x.outcome === "rejected",
    )) {
      const why = p.reason ?? "unknown";
      rejected[why] = (rejected[why] ?? 0) + 1;
    }
    return {
      god,
      actions: e?.actions ?? 0,
      legends: keptInput.proposals.filter(
        (p) =>
          p.actor === god && p.kind === "legend" && p.outcome === "committed",
      ).length,
      longestRun: e?.longestRun,
      influence: e?.influence ?? 0,
      influenceByPhase,
      requests: requests.length + outageExhausted,
      answered: requests.filter((r) => r.outcome === "intent").length,
      exhausted,
      rejected,
      goalOnly: keptInput.proposals.filter(
        (p) => p.actor === god && p.kind === "goal",
      ).length,
      service: service.find((s) => s.god === god) as GodServiceTiming,
      checks: e?.checks ?? [],
    };
  });

  const perGodRow = (
    id: string,
    check: EpisodeCheck["name"],
    name: string,
    threshold: string,
  ): void => {
    const failing = godReports.filter(
      (g) => g.checks.find((c) => c.name === check)?.ok === false,
    );
    row(
      id,
      "gods",
      name,
      failing.length === 0 && godReports.length > 0,
      failing.length === 0
        ? `all ${godReports.length} gods hold`
        : `fails for ${failing.map((g) => `${g.god} (${g.checks.find((c) => c.name === check)?.detail})`).join("; ")}`,
      threshold,
    );
  };
  perGodRow(
    "gods.profile-trace",
    "profile trace",
    "every committed action traces to the god's profile",
    "every god",
  );
  perGodRow(
    "gods.minimum-activity",
    "minimum activity",
    "every god commits enough actions over the hour, the outage left out",
    `at least ${MIN_ACTIONS} each`,
  );
  perGodRow(
    "gods.repetition",
    "repetition",
    "no god repeats the same choice too often in a row",
    `a run of at most ${REPETITION_CAP}`,
  );
  perGodRow(
    "gods.influence",
    "influence",
    "every god causes at least one told belief or felt change",
    "at least 1 each",
  );

  // --- Queue wait and quiet stretches ----------------------------------------------------------
  const worstWait = [...godReports]
    .filter((g) => g.service.p95ServiceGapTicks !== undefined)
    .sort(
      (a, b) =>
        (b.service.p95ServiceGapTicks as number) -
        (a.service.p95ServiceGapTicks as number),
    )[0];
  const overTarget = godReports.filter(
    (g) => (g.service.p95ServiceGapTicks ?? 0) > QUEUE_WAIT_TARGET_TICKS,
  );
  const worstInclusive = Math.max(
    0,
    ...godReports.map((g) => g.service.p95InclusiveGapTicks ?? 0),
  );
  row(
    "queue.wait",
    "queue",
    "each god's p95 queue wait, the windows with no service left out",
    worstWait !== undefined && overTarget.length === 0,
    worstWait === undefined
      ? "no god made two requests"
      : `worst ${worstWait.service.p95ServiceGapTicks} ticks (${worstWait.god}); including the windows ${worstInclusive}`,
    `at most ${QUEUE_WAIT_TARGET_TICKS} ticks`,
  );
  const tooQuiet = godReports.filter(
    (g) => g.service.longestQuiet.serviceTicks > QUIET_LIMIT_TICKS,
  );
  const quietest = [...godReports].sort(
    (a, b) =>
      b.service.longestQuiet.serviceTicks - a.service.longestQuiet.serviceTicks,
  )[0];
  row(
    "queue.longest-quiet",
    "queue",
    "no god goes too long with no request, its last request to the end of the run included",
    godReports.length > 0 && tooQuiet.length === 0,
    quietest === undefined
      ? "no gods"
      : `longest ${quietest.service.longestQuiet.serviceTicks} service ticks (${quietest.god}${quietest.service.longestQuiet.toEnd ? ", to the end of the run" : ""})`,
    `at most ${QUIET_LIMIT_TICKS} service ticks`,
  );

  // --- The knowledge boundary ------------------------------------------------------------------
  const real = analyzeReal(input);
  const knowledgeNames = [
    "perception compliance",
    "goal privacy",
    "petition privacy",
  ];
  const knowledge = real.properties.filter((p) =>
    knowledgeNames.includes(p.name),
  );
  row(
    "knowledge.boundary",
    "knowledge",
    "no god was shown what it could not know, and no goal or petition leaked",
    knowledge.length === knowledgeNames.length && knowledge.every((p) => p.ok),
    knowledge.length === knowledgeNames.length
      ? knowledge
          .map((p) => `${p.name}: ${p.ok ? "holds" : p.detail}`)
          .join("; ")
      : "a property was not computed",
    "all three hold",
  );

  // --- Resources -------------------------------------------------------------------------------
  const tokens = data.proxy.flatMap((r) =>
    r.kind === "completion" && r.promptTokens !== undefined
      ? [r.promptTokens]
      : [],
  );
  const busiest = tokens.length === 0 ? undefined : Math.max(...tokens);
  row(
    "prompt.tokens",
    "resources",
    "the busiest prompt fits the model's context",
    busiest !== undefined && busiest < CONTEXT_TOKENS,
    busiest === undefined
      ? "no response carried a prompt token count"
      : `${busiest} tokens of ${CONTEXT_TOKENS} (${tokens.length} responses counted)`,
    `under ${CONTEXT_TOKENS}`,
  );
  let longestEmpty = 0;
  let run = 0;
  let emptyTotal = 0;
  for (const record of data.proxy) {
    if (record.kind !== "completion" || record.outcome !== "forwarded")
      continue;
    if (record.empty) {
      run += 1;
      emptyTotal += 1;
      longestEmpty = Math.max(longestEmpty, run);
    } else run = 0;
  }
  row(
    "empty.none",
    "resources",
    "Ollama's empty-200 fault did not recur five times in a row",
    result.status !== "fault" && longestEmpty < 5,
    `${emptyTotal} empty responses, at most ${longestEmpty} in a row`,
    "fewer than 5 in a row",
  );
  const memory = summarizeMemory(data.memory);
  row(
    "memory.sidecar-levels-off",
    "resources",
    "the sidecar's memory levels off over the last 20 minutes",
    memory.sidecarTrend.judgeable && memory.sidecarTrend.levellingOff,
    memory.sidecarTrend.judgeable
      ? `${memory.sidecarTrend.percentPer10Min.toFixed(2)}% per 10 min over ${memory.sidecarTrend.windowSamples} samples`
      : `not judgeable: ${memory.sidecarTrend.reason}`,
    "under 1% of the mean per 10 min",
  );

  // --- Export and rebuild ----------------------------------------------------------------------
  const baseline = result.baseline;
  const rebuild = baseline?.rebuild;
  row(
    "rebuild.equal",
    "rebuild",
    "a rebuild from genesis and the event log equals the live projection",
    rebuild?.state === "captured" && rebuild.equal,
    rebuild === undefined
      ? "no baseline was captured"
      : rebuild.state === "missing"
        ? `missing: ${rebuild.reason}`
        : `${rebuild.equal ? "equal" : `differs at ${rebuild.firstDifference ?? "?"}`}; ${rebuild.events} events in ${rebuild.ms} ms`,
    "equal",
  );
  const imported = baseline?.importProof;
  row(
    "rebuild.import",
    "rebuild",
    "the exported archive imports into a scratch slot",
    imported?.state === "captured" && imported.ok,
    imported === undefined
      ? "no baseline was captured"
      : imported.state === "missing"
        ? `missing: ${imported.reason}`
        : imported.ok
          ? `${imported.events} events`
          : `refused: ${imported.refusal?.reason ?? "unknown"}`,
    "accepted",
  );

  // --- Latency, director events, moments -------------------------------------------------------
  const steady = keptRequests
    .filter(
      (r) =>
        r.outcome === "intent" &&
        r !== firstAnswer &&
        !windows.some((w) => {
          const tick = startTickOf(r);
          return tick !== undefined && tick >= w.fromTick && tick <= w.toTick;
        }),
    )
    .map((r) => r.elapsedMs);
  const director: Record<string, Record<PhaseId, number>> = {};
  const directorEvents = input.events.filter(isDirectorEvent);
  for (const event of directorEvents) {
    const kind = String(event.kind);
    director[kind] ??= emptyByPhase();
    (director[kind] as Record<PhaseId, number>)[
      phaseOfTick(result, Number(event.tick))
    ] += 1;
  }

  const prayersAbout = (id: string): StoredEvent | undefined =>
    input.events.find((e) => e.kind === "petition-opened" && e.cause === id);
  const directorMoments: Moment[] = pickSpread(directorEvents, 5).map((e) => {
    const prayer = prayersAbout(e.id);
    return {
      id: e.id,
      tick: Number(e.tick),
      phase: phaseOfTick(result, Number(e.tick)),
      text:
        `the director's ${String(e.kind)} on ${String(e.entityId)}` +
        (prayer === undefined
          ? ", not yet prayed about"
          : `, prayed about to ${String(prayer.god)} [${prayer.id}]`),
    };
  });
  const godMoments: Moment[] = pickSpread(
    gods
      .flatMap((god) =>
        committedInOrder(god, input.proposals, input.events)
          .filter(
            ({ proposal }) =>
              proposal.kind !== "goal" &&
              proposal.kind !== "travel" &&
              influencedBy(
                committedInOrder(god, [proposal], input.events).flatMap(
                  (a) => a.caused,
                ),
                parsed,
              ).length > 0,
          )
          .map(({ proposal, caused }) => {
            const first = caused[0] as StoredEvent;
            return { god, proposal, first };
          }),
      )
      .sort((a, b) => Number(a.first.sequence) - Number(b.first.sequence)),
    5,
  ).map(({ god, proposal, first }) => ({
    id: first.id,
    tick: Number(first.tick),
    phase: phaseOfTick(result, Number(first.tick)),
    text: `${god}'s ${proposal.kind}, which caused a told belief or a felt change [${first.id}]`,
  }));

  const rowsHold = rows.every((r) => r.ok);
  const verdict: Verdict =
    result.status === "fault"
      ? "INFRASTRUCTURE FAULT"
      : !plan.gate
        ? "not a gate run"
        : rowsHold
          ? "PASS"
          : "FAIL";

  return {
    verdict,
    rowsHold,
    rows,
    windows,
    endTick,
    gods: godReports,
    recovery: {
      proxyRestoredTick: restored?.tick,
      reasoningResumed,
      godActed,
    },
    latency: {
      steadyP50Ms: percentile(steady, 0.5),
      steadyP95Ms: percentile(steady, 0.95),
      firstAfterRecoveryMs: result.restore?.firstRequestAfterRestore?.latencyMs,
      runnerAtRestore: result.restore?.runnerAtRestore ?? "unsampled",
    },
    promptTokens: { busiest, recorded: tokens.length },
    empty: { total: emptyTotal, longestRun: longestEmpty },
    director,
    memory,
    moments: { director: directorMoments, gods: godMoments },
    knowledge,
  };
}

export type { RealProposal };
