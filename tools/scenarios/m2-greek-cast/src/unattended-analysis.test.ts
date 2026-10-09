// The threshold table on synthetic run data. A run that is inside every threshold passes every row; each positive
// control breaks one thing and must fail exactly its own row.

import { expect, test } from "bun:test";
import type { MemorySample } from "./memory";
import type { ProxyRecord } from "./outage-proxy";
import type { RealInput, RealRequest } from "./real-analysis";
import {
  requestTimings,
  serviceGap,
  serviceTimings,
  type TickWindow,
} from "./request-timing";
import type { UnattendedResult } from "./unattended";
import { exitCodeOf, phasePlan } from "./unattended";
import {
  analyzeUnattended,
  exhaustionReason,
  gateOutcomeOf,
  phaseOfTick,
  QUEUE_WAIT_TARGET_TICKS,
  QUIET_LIMIT_TICKS,
  RECOVERY_LIMIT_TICKS,
  serviceWindows,
  type ThresholdRow,
} from "./unattended-analysis";
import type { Scene } from "./unattended-test-data";
import {
  baseResult,
  GODS,
  healthyScene,
  MINUTE,
  proxyRecords,
  refusal,
  responsesFor,
  runData,
  T0,
  TICKS,
  turn,
} from "./unattended-test-data";

const rowOf = (rows: readonly ThresholdRow[], id: string): ThresholdRow => {
  const found = rows.find((r) => r.id === id);
  if (found === undefined)
    throw new Error(`no row ${id}: ${rows.map((r) => r.id).join(", ")}`);
  return found;
};

const failing = (rows: readonly ThresholdRow[]): string[] =>
  rows.filter((r) => !r.ok).map((r) => r.id);

// --- Service time -----------------------------------------------------------------------------

test("service time takes off only the overlap of each window: a gap wholly inside, straddling, spanning, and clear of a window", () => {
  const windows: TickWindow[] = [
    { fromTick: 100, toTick: 200, label: "a" },
    { fromTick: 500, toTick: 600, label: "b" },
  ];
  expect(serviceGap(0, 50, windows)).toBe(50);
  expect(serviceGap(120, 180, windows)).toBe(0);
  expect(serviceGap(50, 150, windows)).toBe(50);
  expect(serviceGap(150, 250, windows)).toBe(50);
  expect(serviceGap(0, 700, windows)).toBe(500);
  expect(serviceGap(200, 500, windows)).toBe(300);
  expect(serviceGap(10, 10, windows)).toBe(0);
  expect(serviceGap(300, 100, windows)).toBe(0);
});

test("a god's queue wait leaves out the outage and the catch-up, but a slow first request after the proxy returns counts", () => {
  const requests = (starts: readonly number[]) => ({
    requests: starts.map((startTick) => ({
      god: "zeus",
      startTick,
      appliedTick: undefined,
      latencyMs: 1000,
      outcome: "answered" as const,
      promptChars: 1,
    })),
    perGod: [],
  });
  const windows: TickWindow[] = [
    { fromTick: 900, toTick: 1620, label: "outage" },
    { fromTick: 2220, toTick: 5820, label: "catch-up" },
  ];
  const options = {
    windows,
    startTick: 0,
    endTick: 8400,
    gods: ["zeus"],
    longGapTicks: 90,
  };
  // Requests at 100, 850 (before the outage), 1700 (80 ticks after the proxy returned), then 5900 (80 after the catch-up).
  const kept = serviceTimings(requests([100, 850, 1700, 5900]), options)[0];
  // The gaps are 750, 850 and 4200 raw; in service time 750, 130 (850..900 and 1620..1700) and 80.
  expect(kept?.p95ServiceGapTicks).toBe(750);
  expect(kept?.p95InclusiveGapTicks).toBe(4200);
  // Edge: the 3,600-tick catch-up as one gap is the inclusive figure and not the gate's.
  expect(kept?.p95ServiceGapTicks).toBeLessThan(
    kept?.p95InclusiveGapTicks as number,
  );
  // A slow first request after the proxy returned is wait that counts: 1620 -> 1900 is 280 service ticks.
  const slow = serviceTimings(requests([100, 850, 1900]), options)[0];
  expect(slow?.p95ServiceGapTicks).toBe(750);
  const onlySlow = serviceTimings(requests([1000, 1900]), options)[0];
  expect(onlySlow?.p95ServiceGapTicks).toBe(280);
});

test("the longest quiet stretch includes the one from the god's last request to the end, and from the start to its first", () => {
  const timings = {
    requests: [
      {
        god: "zeus",
        startTick: 100,
        appliedTick: undefined,
        latencyMs: 1,
        outcome: "answered" as const,
        promptChars: 1,
      },
    ],
    perGod: [],
  };
  const options = {
    windows: [],
    startTick: 0,
    endTick: 1000,
    gods: ["zeus", "hera"],
    longGapTicks: 90,
  };
  const [zeus, hera] = serviceTimings(timings, options);
  expect(zeus?.longestQuiet).toMatchObject({
    fromTick: 100,
    toTick: 1000,
    serviceTicks: 900,
    toEnd: true,
  });
  // A god with no request at all has the whole run as its quiet stretch.
  expect(hera?.longestQuiet).toMatchObject({
    fromTick: 0,
    toTick: 1000,
    serviceTicks: 1000,
    toEnd: true,
  });
  expect(hera?.turns).toBe(0);
});

test("requestTimings is not changed by the service-time addition: the episode gate's per-god figures are the same", () => {
  const scene = healthyScene();
  const input: RealInput = {
    requests: scene.requests,
    proposals: scene.proposals,
    events: [],
    polls: { total: 1, degraded: 0 },
  };
  const timings = requestTimings(input);
  const zeus = timings.perGod.find((g) => g.god === "zeus");
  expect(zeus?.worstGapTicks).toBeGreaterThan(0);
  expect(zeus?.p95GapTicks).toBeDefined();
  expect(Object.keys(zeus ?? {}).sort()).toEqual(
    [
      "god",
      "turns",
      "medianGapTicks",
      "worstGapTicks",
      "p95GapTicks",
      "medianLatencyMs",
    ].sort(),
  );
});

// --- The table --------------------------------------------------------------------------------

test("a healthy run inside every threshold renders PASS with every row filled", () => {
  const analysis = analyzeUnattended(runData());
  expect(failing(analysis.rows)).toEqual([]);
  expect(analysis.verdict).toBe("PASS");
  expect(analysis.rowsHold).toBe(true);
  for (const r of analysis.rows) {
    expect(r.measured.length).toBeGreaterThan(0);
    expect(r.threshold.length).toBeGreaterThan(0);
  }
  expect(analysis.rows.map((r) => r.id)).toEqual([
    "run.completed",
    "run.running-time",
    "outage.tick-advances",
    "outage.routines-continue",
    "outage.no-god-action",
    "recovery.reasoning-resumes",
    "recovery.gods-act-again",
    "catch-up.clean-stop",
    "catch-up.bracketed",
    "catch-up.cap",
    "catch-up.no-requests",
    "catch-up.summary-persists",
    "gods.profile-trace",
    "gods.minimum-activity",
    "gods.repetition",
    "gods.influence",
    "queue.wait",
    "queue.longest-quiet",
    "knowledge.boundary",
    "prompt.tokens",
    "empty.none",
    "memory.sidecar-levels-off",
    "rebuild.equal",
    "rebuild.import",
  ]);
});

test("a development-length run renders the verdict 'not a gate run' and still shows whether its rows hold", () => {
  const analysis = analyzeUnattended(
    runData({ result: { plan: phasePlan(6) } }),
  );
  expect(analysis.verdict).toBe("not a gate run");
  expect(typeof analysis.rowsHold).toBe("boolean");
});

test("a fault is its own verdict, whatever the rows hold", () => {
  const analysis = analyzeUnattended(
    runData({ result: { status: "fault", reason: "five empty responses" } }),
  );
  expect(analysis.verdict).toBe("INFRASTRUCTURE FAULT");
});

test("positive control: a god action committed from a request that finished inside the outage fails 'no god action during the outage', and only that row", () => {
  const scene = healthyScene();
  turn(scene, "zeus", 1000, { recordedAtTick: 1100 });
  const { rows } = analyzeUnattended(runData({ scene }));
  expect(failing(rows)).toEqual(["outage.no-god-action"]);
  expect(rowOf(rows, "outage.no-god-action").measured).toContain(
    "1 committed action",
  );
});

test("the outage row judges when an action commits, not when its request finished: a request that finished one second before the proxy failed, whose proposal commits at tick 904, fails the row", () => {
  const scene = healthyScene();
  // The request began at tick 890 and finished 1 s before the outage's wall boundary (tick 900); the world consumed its
  // proposal four ticks into the outage.
  turn(scene, "zeus", 890, { recordedAtTick: 894, consumedTick: 904 });
  const { rows } = analyzeUnattended(runData({ scene }));
  const row = rowOf(rows, "outage.no-god-action");
  expect(row.ok).toBe(false);
  expect(row.measured).toContain("1 committed action");
  expect(row.measured).toContain("zeus");
  expect(failing(rows)).toEqual(["outage.no-god-action"]);
});

test("a proposal consumed at the outage's own boundary tick is before it, and the first tick after it is inside", () => {
  const atBoundary = healthyScene();
  turn(atBoundary, "zeus", 890, {
    recordedAtTick: 894,
    consumedTick: TICKS.outage,
  });
  expect(
    rowOf(
      analyzeUnattended(runData({ scene: atBoundary })).rows,
      "outage.no-god-action",
    ).ok,
  ).toBe(true);
  const after = healthyScene();
  turn(after, "zeus", 890, {
    recordedAtTick: 894,
    consumedTick: TICKS.outage + 1,
  });
  expect(
    rowOf(
      analyzeUnattended(runData({ scene: after })).rows,
      "outage.no-god-action",
    ).ok,
  ).toBe(false);
});

test("a proposal that commits after proxyRestoredAt does not count against the outage, even from a request that finished inside it, and one consumed at the restore tick still does", () => {
  const late = healthyScene();
  turn(late, "zeus", 1600, {
    recordedAtTick: 1610,
    consumedTick: TICKS.restored + 5,
  });
  expect(
    rowOf(
      analyzeUnattended(runData({ scene: late })).rows,
      "outage.no-god-action",
    ).ok,
  ).toBe(true);
  const inside = healthyScene();
  turn(inside, "zeus", 1600, {
    recordedAtTick: 1610,
    consumedTick: TICKS.restored,
  });
  expect(
    rowOf(
      analyzeUnattended(runData({ scene: inside })).rows,
      "outage.no-god-action",
    ).ok,
  ).toBe(false);
});

test("the participation counts use the same window: actions that commit inside the outage are left out whatever their request did, and actions that commit after it are counted whatever their request did", () => {
  // Six legends by one god commit inside the outage from requests that finished before it: left out, so no repetition.
  const inside = healthyScene();
  for (let i = 0; i < 6; i += 1) {
    turn(inside, "zeus", 880 + i, {
      recordedAtTick: 890 + i,
      kind: "legend",
      consumedTick: 950 + i,
    });
  }
  const left = analyzeUnattended(runData({ scene: inside })).rows;
  expect(rowOf(left, "gods.repetition").ok).toBe(true);
  expect(rowOf(left, "outage.no-god-action").ok).toBe(false);
  // Six legends whose requests finished inside the outage but which commit after it: counted, so the run of six fails.
  const after = healthyScene();
  for (let i = 0; i < 6; i += 1) {
    turn(after, "zeus", 1000 + i, {
      recordedAtTick: 1100 + i,
      kind: "legend",
      consumedTick: TICKS.restored + 40 + i,
    });
  }
  const counted = analyzeUnattended(runData({ scene: after })).rows;
  expect(rowOf(counted, "gods.repetition").ok).toBe(false);
  expect(rowOf(counted, "outage.no-god-action").ok).toBe(true);
});

test("positive control: a window with no routine or director events fails 'routines continue'", () => {
  const scene = healthyScene();
  scene.events = scene.events.filter(
    (e) =>
      !(
        Number(e.tick) > TICKS.outage &&
        Number(e.tick) <= TICKS.restored &&
        !String(e.correlationId).startsWith("obs-")
      ),
  );
  const { rows } = analyzeUnattended(runData({ scene }));
  expect(failing(rows)).toContain("outage.routines-continue");
  expect(rowOf(rows, "outage.routines-continue").measured).toContain(
    "0 events",
  );
});

test("positive control: a tick that did not advance through the outage fails 'the tick keeps advancing'", () => {
  const result = baseResult();
  const frozen = {
    ...result,
    boundaries: result.boundaries.map((b) =>
      b.phase === "proxy-restored" ? { ...b, tick: TICKS.outage } : b,
    ),
  };
  const { rows } = analyzeUnattended(runData({ result: frozen }));
  expect(failing(rows)).toContain("outage.tick-advances");
});

test("positive control: no answered request within 150 ticks of proxyRestoredAt fails 'reasoning resumes', and the first answer at exactly 150 passes", () => {
  const scene = healthyScene();
  // Drop every post-restore request until 1620 + 400.
  const dropped = new Set(
    scene.requests
      .filter(
        (r) =>
          (r.recordedAt ?? 0) >= T0 + TICKS.restored * 1000 &&
          (r.recordedAt ?? 0) < T0 + (TICKS.restored + 400) * 1000 &&
          (r.recordedAt ?? 0) < T0 + TICKS.stopped * 1000,
      )
      .map((r) => r.proposalId),
  );
  const late: Scene = {
    requests: scene.requests.filter((r) => !dropped.has(r.proposalId)),
    proposals: scene.proposals.filter((p) => !dropped.has(p.proposalId)),
    events: scene.events,
  };
  const { rows } = analyzeUnattended(runData({ scene: late }));
  expect(rowOf(rows, "recovery.reasoning-resumes").ok).toBe(false);
  expect(rowOf(rows, "recovery.gods-act-again").ok).toBe(false);

  // The boundary: one answer whose start tick is the restore tick plus 142 and whose request took 8 s ends at +150.
  const edge: Scene = {
    requests: [],
    proposals: [],
    events: healthyScene().events,
  };
  GODS.forEach((god, i) => {
    turn(edge, god, 10 + i * 8);
    turn(edge, god, TICKS.catchUp + 20 + i * 8);
  });
  turn(edge, "zeus", TICKS.restored + 142);
  expect(RECOVERY_LIMIT_TICKS).toBe(150);
  const atEdge = analyzeUnattended(runData({ scene: edge }));
  expect(rowOf(atEdge.rows, "recovery.reasoning-resumes").ok).toBe(true);
  expect(rowOf(atEdge.rows, "recovery.gods-act-again").ok).toBe(true);
  const past: Scene = {
    requests: [],
    proposals: [],
    events: healthyScene().events,
  };
  GODS.forEach((god, i) => {
    turn(past, god, 10 + i * 8);
    turn(past, god, TICKS.catchUp + 20 + i * 8);
  });
  turn(past, "zeus", TICKS.restored + 143);
  expect(
    rowOf(
      analyzeUnattended(runData({ scene: past })).rows,
      "recovery.reasoning-resumes",
    ).ok,
  ).toBe(false);
});

test("positive control: answered requests whose proposals are all rejected pass 'reasoning resumes' and fail 'gods act again'", () => {
  const scene = healthyScene();
  const afterRestore = new Set(
    scene.requests
      .filter((r) => (r.recordedAt ?? 0) >= T0 + TICKS.restored * 1000)
      .map((r) => r.proposalId),
  );
  scene.proposals = scene.proposals.map((p) =>
    afterRestore.has(p.proposalId)
      ? { ...p, outcome: "rejected" as const, reason: "stale-target" }
      : p,
  );
  const { rows } = analyzeUnattended(runData({ scene }));
  expect(rowOf(rows, "recovery.reasoning-resumes").ok).toBe(true);
  expect(rowOf(rows, "recovery.gods-act-again").ok).toBe(false);
  expect(rowOf(rows, "recovery.gods-act-again").measured).toContain(
    "no god action committed",
  );
});

test("positive control: a god whose last request is 400 service ticks before the end fails the longest-quiet row, and the same gap inside a no-service window does not", () => {
  const scene = healthyScene();
  scene.requests = scene.requests.filter(
    (r) =>
      !(
        r.role === "zeus" &&
        Number(/tick (\d+)/.exec(r.promptPayload ?? "")?.[1]) >
          TICKS.ended - 400
      ),
  );
  const keptIds = new Set(scene.requests.map((r) => r.proposalId));
  scene.proposals = scene.proposals.filter((p) => keptIds.has(p.proposalId));
  const { rows } = analyzeUnattended(runData({ scene }));
  expect(rowOf(rows, "queue.longest-quiet").ok).toBe(false);
  expect(rowOf(rows, "queue.longest-quiet").measured).toContain("zeus");
  expect(rowOf(rows, "queue.longest-quiet").measured).toContain(
    "to the end of the run",
  );
  expect(QUIET_LIMIT_TICKS).toBe(300);

  // The same length of silence entirely inside the catch-up is not quiet: it is not service time.
  const inside = healthyScene();
  inside.requests = inside.requests.filter(
    (r) =>
      !(
        r.role === "zeus" &&
        Number(/tick (\d+)/.exec(r.promptPayload ?? "")?.[1]) >=
          TICKS.outage - 100 &&
        Number(/tick (\d+)/.exec(r.promptPayload ?? "")?.[1]) <=
          TICKS.restored + 60
      ),
  );
  const keptInside = new Set(inside.requests.map((r) => r.proposalId));
  inside.proposals = inside.proposals.filter((p) =>
    keptInside.has(p.proposalId),
  );
  const quiet = analyzeUnattended(runData({ scene: inside }));
  const zeus = quiet.gods.find((g) => g.god === "zeus");
  // 700-plus raw ticks of silence, of which only the part outside the outage is service time.
  expect(zeus?.service.longestQuiet.serviceTicks).toBeLessThan(300);
});

test("positive control: a god whose queue wait exceeds 90 service ticks fails the queue-wait row, and the inclusive figure is shown beside it", () => {
  const scene = healthyScene();
  // Zeus takes no turn for 200 service ticks before the outage.
  scene.requests = scene.requests.filter((r) => {
    const tick = Number(/tick (\d+)/.exec(r.promptPayload ?? "")?.[1]);
    return !(r.role === "zeus" && tick > 100 && tick < 400);
  });
  const keptIds = new Set(scene.requests.map((r) => r.proposalId));
  scene.proposals = scene.proposals.filter((p) => keptIds.has(p.proposalId));
  const { rows } = analyzeUnattended(runData({ scene }));
  const queue = rowOf(rows, "queue.wait");
  expect(QUEUE_WAIT_TARGET_TICKS).toBe(90);
  expect(queue.ok).toBe(false);
  expect(queue.measured).toContain("zeus");
  expect(queue.measured).toContain("including the windows");
});

test("requests the outage proxy refused are not requests the model answered: a run with the outage window crowded with refusals has the same queue wait and quiet stretch as the same run without them", () => {
  const clean = analyzeUnattended(runData({ scene: healthyScene() }));
  const crowded = healthyScene();
  // Every god is refused every second of the outage: 700 refusals a god, 0 to 1 service ticks apart.
  for (const god of GODS) {
    for (let tick = TICKS.outage + 2; tick < TICKS.restored - 2; tick += 1) {
      refusal(crowded, god, tick);
    }
  }
  const withRefusals = analyzeUnattended(runData({ scene: crowded }));
  for (const god of GODS) {
    const before = clean.gods.find((g) => g.god === god)?.service;
    const after = withRefusals.gods.find((g) => g.god === god)?.service;
    expect(after?.p95ServiceGapTicks).toBe(before?.p95ServiceGapTicks);
    expect(after?.p95InclusiveGapTicks).toBe(before?.p95InclusiveGapTicks);
    expect(after?.longestQuiet).toEqual(before?.longestQuiet);
    expect(after?.turns).toBe(before?.turns);
    expect(after?.longGaps).toBe(before?.longGaps);
  }
  expect(rowOf(withRefusals.rows, "queue.wait").measured).toBe(
    rowOf(clean.rows, "queue.wait").measured,
  );
  // The refusals are still counted as what they were, in the god's own request counts.
  expect(
    withRefusals.gods.find((g) => g.god === "zeus")?.exhausted.outage,
  ).toBeGreaterThan(600);
});

test("mutation check: counting the refusals as request starts pulls a god's p95 queue wait to zero, which is what hid the real figure", () => {
  const crowded = healthyScene();
  // Three refusals a second to each god: 97% of its request starts are zero service ticks from the last.
  for (const god of GODS) {
    for (let tick = TICKS.outage + 2; tick < TICKS.restored - 2; tick += 1) {
      for (let n = 0; n < 3; n += 1) refusal(crowded, god, tick);
    }
  }
  const data = runData({ scene: crowded });
  const counted = requestTimings(data.input);
  const windows = serviceWindows(data.result, TICKS.ended);
  const naive = serviceTimings(counted, {
    windows,
    startTick: 0,
    endTick: TICKS.ended,
    gods: GODS,
    longGapTicks: QUEUE_WAIT_TARGET_TICKS,
  });
  const gate = analyzeUnattended(data).gods;
  for (const god of GODS) {
    expect(naive.find((s) => s.god === god)?.p95ServiceGapTicks).toBeLessThan(
      gate.find((g) => g.god === god)?.service.p95ServiceGapTicks as number,
    );
  }
});

test("a request that failed on a real model response inside the outage window, or a transport failure outside it, still counts as a request start", () => {
  const scene = healthyScene();
  // Inside the window but not a refusal: the model answered, and the answer was invalid.
  scene.requests.push({
    proposalId: undefined,
    role: "zeus",
    outcome: "exhausted",
    elapsedMs: 9000,
    promptPayload: `x in the mortal realm, tick ${TICKS.outage + 30}.`,
    steps: [{ reason: "invalid-output", detail: "assertion" }],
    recordedAt: T0 + (TICKS.outage + 39) * 1000,
  });
  // Outside the window: a transport failure with no outage to explain it is a fault the gate keeps counting.
  scene.requests.push({
    proposalId: undefined,
    role: "zeus",
    outcome: "exhausted",
    elapsedMs: 300,
    promptPayload: `x in the mortal realm, tick 5.`,
    steps: [{ reason: "http-5xx", detail: "503" }],
    recordedAt: T0 + 5300,
  });
  const base = analyzeUnattended(runData({ scene: healthyScene() }));
  const withBoth = analyzeUnattended(runData({ scene }));
  expect(withBoth.gods.find((g) => g.god === "zeus")?.service.turns).toBe(
    (base.gods.find((g) => g.god === "zeus")?.service.turns as number) + 2,
  );
});

/** A turn the prompt cap stopped for `god` at `tick`: no request was made, so there are no steps and no elapsed time. */
function overCap(scene: Scene, god: string, tick: number): void {
  scene.requests.push({
    proposalId: undefined,
    role: god,
    outcome: "exhausted",
    elapsedMs: 0,
    promptPayload: `x in the mortal realm, tick ${tick}.`,
    steps: [],
    exhaustedReason: "prompt-over-cap",
    recordedAt: T0 + tick * 1000,
  });
}

test("a turn the prompt cap stopped is labelled prompt-over-cap, whatever the outage window says about when it finished", () => {
  const stopped: RealRequest = {
    proposalId: undefined,
    role: "zeus",
    outcome: "exhausted",
    elapsedMs: 0,
    promptPayload: undefined,
    steps: [],
    exhaustedReason: "prompt-over-cap",
    recordedAt: T0,
  };
  expect(exhaustionReason(stopped, undefined)).toBe("prompt-over-cap");
  expect(exhaustionReason({ ...stopped, steps: [] }, undefined)).not.toBe(
    "other",
  );
});

test("a god's prompt-over-cap turns are counted for it, and are neither requests nor answers nor request starts", () => {
  const base = analyzeUnattended(runData({ scene: healthyScene() }));
  const scene = healthyScene();
  for (const tick of [10, 25, 40, 55]) overCap(scene, "zeus", tick);
  const after = analyzeUnattended(runData({ scene }));

  const before = base.gods.find((g) => g.god === "zeus");
  const zeus = after.gods.find((g) => g.god === "zeus");
  expect(zeus?.overCap).toBe(4);
  expect(before?.overCap).toBe(0);
  expect(zeus?.requests).toBe(before?.requests);
  expect(zeus?.answered).toBe(before?.answered);
  expect(zeus?.exhausted).toEqual(before?.exhausted);
  expect(zeus?.service).toEqual(before?.service);
  for (const g of after.gods.filter((x) => x.god !== "zeus")) {
    expect(g.overCap).toBe(0);
  }
  expect(failing(after.rows)).toEqual(failing(base.rows));
});

test("positive control: a god held back by prompt-over-cap turns for its last 400 service ticks fails the longest-quiet row, though every one of those turns is on record", () => {
  const scene = healthyScene();
  scene.requests = scene.requests.filter(
    (r) =>
      !(
        r.role === "zeus" &&
        Number(/tick (\d+)/.exec(r.promptPayload ?? "")?.[1]) >
          TICKS.ended - 400
      ),
  );
  const keptIds = new Set(scene.requests.map((r) => r.proposalId));
  scene.proposals = scene.proposals.filter((p) => keptIds.has(p.proposalId));
  for (let tick = TICKS.ended - 390; tick < TICKS.ended; tick += 30) {
    overCap(scene, "zeus", tick);
  }
  const { rows, gods } = analyzeUnattended(runData({ scene }));
  expect(rowOf(rows, "queue.longest-quiet").ok).toBe(false);
  expect(rowOf(rows, "queue.longest-quiet").measured).toContain("zeus");
  expect(gods.find((g) => g.god === "zeus")?.overCap).toBe(13);
});

test("positive control: a provider request between catch-up start and finish fails the catch-up row", () => {
  const result = baseResult();
  const broken: Partial<UnattendedResult> = {
    checks: result.checks.map((c) =>
      c.name === "no provider request is made during the catch-up"
        ? { ...c, ok: false, detail: "1 requests inside it" }
        : c,
    ),
    status: "failed",
  };
  const { rows } = analyzeUnattended(runData({ result: broken }));
  expect(rowOf(rows, "catch-up.no-requests").ok).toBe(false);
  expect(rowOf(rows, "catch-up.cap").ok).toBe(true);
});

test("positive control: a perception-compliance violation, a goal-privacy violation and a petition-privacy violation each fail the knowledge-boundary row, naming theirs", () => {
  const perception = healthyScene();
  perception.proposals = perception.proposals.map((p, i) =>
    i === 0
      ? {
          ...p,
          proposal: {
            ...p.proposal,
            kind: "report",
            listener: "someone-never-shown",
          },
        }
      : p,
  );
  const a = analyzeUnattended(runData({ scene: perception }));
  expect(rowOf(a.rows, "knowledge.boundary").ok).toBe(false);
  expect(rowOf(a.rows, "knowledge.boundary").measured).toContain(
    "perception compliance",
  );

  const goal = healthyScene();
  goal.events.push({
    schemaVersion: 1,
    id: "evt-50-g",
    sequence: 1,
    simTime: 0,
    correlationId: "obs-g",
    causationId: "obs-g",
    tick: 50,
    approximate: false,
    kind: "goal-set",
    entityId: "hera",
    text: "Humble Zeus before the court",
    target: "zeus",
  });
  const leaky = goal.requests.find((r) => r.role === "zeus");
  if (leaky === undefined) throw new Error("no request");
  leaky.promptPayload = `${leaky.promptPayload}\nYou think of Humble Zeus before the court.`;
  const b = analyzeUnattended(runData({ scene: goal }));
  expect(rowOf(b.rows, "knowledge.boundary").ok).toBe(false);
  expect(rowOf(b.rows, "knowledge.boundary").measured).toContain(
    "goal privacy",
  );

  const petition = healthyScene();
  petition.events.push({
    schemaVersion: 1,
    id: "evt-60-p",
    sequence: 2,
    simTime: 0,
    correlationId: "tick-60",
    causationId: "x",
    tick: 60,
    approximate: false,
    kind: "petition-opened",
    entityId: "farmer",
    god: "hera",
    cause: "evt-1-1",
    request: { kind: "help", need: { kind: "resource", resource: "food" } },
  });
  const zeusAsk = petition.requests.find((r) => r.role === "zeus");
  if (zeusAsk === undefined) throw new Error("no request");
  zeusAsk.promptPayload = `${zeusAsk.promptPayload}\nPrayers to you:\n- [evt-60-p] farmer asks for food`;
  const c = analyzeUnattended(runData({ scene: petition }));
  expect(rowOf(c.rows, "knowledge.boundary").ok).toBe(false);
  expect(rowOf(c.rows, "knowledge.boundary").measured).toContain(
    "petition privacy",
  );
});

test("positive control: a prompt at the context size fails the prompt-tokens row, and one a token under passes; no counted response is its own failure", () => {
  const at = analyzeUnattended(
    runData({ proxy: proxyRecords([{ promptTokens: 4096 }]) }),
  );
  expect(rowOf(at.rows, "prompt.tokens").ok).toBe(false);
  expect(rowOf(at.rows, "prompt.tokens").measured).toContain(
    "4096 tokens of 4096",
  );
  const under = analyzeUnattended(
    runData({ proxy: proxyRecords([{ promptTokens: 4095 }]) }),
  );
  expect(rowOf(under.rows, "prompt.tokens").ok).toBe(true);
  const none = analyzeUnattended(runData({ proxy: [] }));
  expect(rowOf(none.rows, "prompt.tokens").ok).toBe(false);
  expect(rowOf(none.rows, "prompt.tokens").measured).toContain(
    "no response carried",
  );
});

/** A healthy scene whose first `count` answered requests of `gods` were shown a 12,000-character prompt. */
function longPrompts(
  scene: Scene,
  gods: readonly string[],
): { index: number; request: RealRequest }[] {
  const picked: { index: number; request: RealRequest }[] = [];
  scene.requests.forEach((request, index) => {
    if (gods.length > picked.length && request.role === gods[picked.length]) {
      scene.requests[index] = {
        ...request,
        promptPayload: `${request.promptPayload}${"x".repeat(12_000)}`,
      };
      picked.push({ index, request: scene.requests[index] as RealRequest });
    }
  });
  return picked;
}

test("positive control: the failed hour's shape, nine responses reporting exactly 2,050 for prompts of about 12,000 characters and 4,094 the largest ordinary count, fails the prompt row naming 9 cut and the gods", () => {
  const scene = healthyScene();
  const picked = longPrompts(scene, [
    "athena",
    "athena",
    "athena",
    "athena",
    "athena",
    "athena",
    "athena",
    "athena",
    "hephaestus",
  ]);
  // One ordinary response just under the context, and every other response at the run's usual 0.33 a character.
  const proxy = responsesFor(scene);
  const cutIndexes = new Set(picked.map((p) => p.request.proposalId));
  const records = scene.requests
    .filter((r) => r.outcome === "intent")
    .map((r, i) => ({ r, record: proxy[i] as ProxyRecord }));
  for (const { r, record } of records) {
    if (cutIndexes.has(r.proposalId)) {
      Object.assign(record, { promptTokens: 2050 });
    }
  }
  const largest = records.find(({ r }) => !cutIndexes.has(r.proposalId));
  Object.assign(largest?.record as ProxyRecord, { promptTokens: 4094 });

  const { rows, promptTokens } = analyzeUnattended(runData({ scene, proxy }));
  const row = rowOf(rows, "prompt.tokens");
  expect(promptTokens.busiest).toBe(4094);
  expect(row.ok).toBe(false);
  expect(row.measured).toContain("4094 tokens of 4096");
  expect(row.measured).toContain("9 cut");
  expect(row.measured).toContain("athena 8");
  expect(row.measured).toContain("hephaestus 1");
  expect(promptTokens.cut.cut).toBe(9);
  expect(failing(rows)).toEqual(["prompt.tokens"]);
});

test("a run whose largest prompt is 4,094 tokens, with no response cut, passes the prompt row", () => {
  const scene = healthyScene();
  const proxy = responsesFor(scene);
  Object.assign(proxy[3] as ProxyRecord, { promptTokens: 4094 });
  const { rows } = analyzeUnattended(runData({ scene, proxy }));
  const row = rowOf(rows, "prompt.tokens");
  expect(row.measured).toContain("4094 tokens of 4096");
  expect(row.measured).toContain("0 cut");
  expect(row.ok).toBe(true);
});

test("positive control: a response that reports far fewer tokens than its prompt's length predicts fails the row though it is not 2,050 and the largest count is small", () => {
  const scene = healthyScene();
  const [picked] = longPrompts(scene, ["zeus"]);
  const proxy = responsesFor(scene);
  const at = scene.requests
    .filter((r) => r.outcome === "intent")
    .findIndex((r) => r.proposalId === picked?.request.proposalId);
  Object.assign(proxy[at] as ProxyRecord, { promptTokens: 2400 });
  const { rows, promptTokens } = analyzeUnattended(runData({ scene, proxy }));
  expect(promptTokens.busiest).toBeLessThan(4096);
  expect(rowOf(rows, "prompt.tokens").ok).toBe(false);
  expect(rowOf(rows, "prompt.tokens").measured).toContain("1 cut (zeus 1)");
});

test("a response at exactly 2,050 that no request can be matched to is a suspected cut: the row passes and names it, since only a prompt's length can confirm one", () => {
  // The only response the proxy recorded is one no request answers, so nothing can be read against a prompt length.
  const lone: ProxyRecord = {
    at: T0 + 400 * MINUTE,
    status: 200,
    latencyMs: 8000,
    outcome: "forwarded",
    kind: "completion",
    empty: false,
    promptTokens: 2050,
  };
  const { rows, promptTokens } = analyzeUnattended(runData({ proxy: [lone] }));
  const row = rowOf(rows, "prompt.tokens");
  expect(promptTokens.cut.cut).toBe(0);
  expect(promptTokens.cut.suspected).toBe(1);
  expect(row.ok).toBe(true);
  expect(row.measured).toContain("0 cut");
  expect(row.measured).toContain("1 suspected (god unknown 1;");
  expect(row.measured).toContain("not matched to a request");
  expect(row.measured).toContain("length check not run");
});

test("negative control: an ordinary matched prompt that is exactly 2,050 tokens is not cut, and the row passes", () => {
  const scene = healthyScene();
  // 6,212 characters at 2,050 tokens is 0.330 a character; the run's median is 0.33.
  const index = scene.requests.findIndex((r) => r.role === "zeus");
  const request = scene.requests[index] as RealRequest;
  scene.requests[index] = {
    ...request,
    promptPayload: `${request.promptPayload}${"x".repeat(6212 - (request.promptPayload?.length ?? 0))}`,
  };
  const picked = { request: scene.requests[index] as RealRequest };
  const proxy = responsesFor(scene);
  const at = scene.requests
    .filter((r) => r.outcome === "intent")
    .findIndex((r) => r.proposalId === picked.request.proposalId);
  Object.assign(proxy[at] as ProxyRecord, { promptTokens: 2050 });
  const { rows, promptTokens } = analyzeUnattended(runData({ scene, proxy }));
  expect(promptTokens.cut.cut).toBe(0);
  expect(promptTokens.cut.suspected).toBe(0);
  expect(promptTokens.cut.calibrated).toBe(true);
  const row = rowOf(rows, "prompt.tokens");
  expect(row.measured).toContain("0 cut");
  expect(row.ok).toBe(true);
  expect(failing(rows)).toEqual([]);
});

test("positive control: five empty responses in a row fail the empty-200 row; four with a normal one between do not", () => {
  const empties = (n: number): Partial<ProxyRecord>[] =>
    Array.from({ length: n }, () => ({ empty: true }));
  const five = analyzeUnattended(runData({ proxy: proxyRecords(empties(5)) }));
  expect(rowOf(five.rows, "empty.none").ok).toBe(false);
  const split = analyzeUnattended(
    runData({
      proxy: proxyRecords([...empties(4), { empty: false }, ...empties(4)]),
    }),
  );
  expect(rowOf(split.rows, "empty.none").ok).toBe(true);
  expect(rowOf(split.rows, "empty.none").measured).toContain(
    "8 empty responses",
  );
});

/**
 * Samples across the fixture's wall clock to its end at minute 230, the sidecar's RSS and footprint given by functions
 * of the milliseconds since the start. The fixture's catch-up finishes at minute 187, so the settled span is 202 to 230.
 */
function sidecarMemory(
  rssAt: (at: number) => number,
  footprintAt: (at: number) => number | undefined,
  endMinute = 230,
): MemorySample[] {
  const samples: MemorySample[] = [];
  for (let at = 0; at <= endMinute * MINUTE; at += 10_000) {
    const footprintBytes = footprintAt(at);
    samples.push({
      atMs: T0 + at,
      runner: { state: "present", pids: [9], rssBytes: 1 },
      sidecar: {
        state: "present",
        pid: 100,
        rssBytes: rssAt(at),
        footprintBytes,
      },
      swap: undefined,
    });
  }
  return samples;
}

const MEMORY_ROW = "memory.sidecar-levels-off";

test("positive control: a sidecar whose physical footprint grows over 10% across the settled span fails the memory row, saying the growth", () => {
  // The settled span is minutes 202 to 230, split at 216: 80 MB, then 100 MB, which is 25%.
  const rising = sidecarMemory(
    () => 500_000_000,
    (at) => (at < 216 * MINUTE ? 80_000_000 : 100_000_000),
  );
  const bad = analyzeUnattended(runData({ memory: rising }));
  const row = rowOf(bad.rows, MEMORY_ROW);
  expect(row.ok).toBe(false);
  expect(row.measured).toContain("+25.00%");
  expect(row.name).toContain("physical footprint");
  expect(row.name).toContain("settled span");
  expect(row.threshold).toContain("10%");
  expect(failing(bad.rows)).toEqual([MEMORY_ROW]);
});

test("a settled span under the floor is not judgeable and fails the row, saying so", () => {
  // Cut at minute 215: the settled span is 202 to 215, 13 minutes, under the 20-minute floor.
  const short = analyzeUnattended(
    runData({
      memory: sidecarMemory(
        () => 500_000_000,
        () => 80_000_000,
        215,
      ),
    }),
  );
  const row = rowOf(short.rows, MEMORY_ROW);
  expect(row.ok).toBe(false);
  expect(row.measured).toContain("not judgeable");
  expect(row.measured).toContain("settled span is 13");
});

test("drift with flat halves passes the memory row where the 20-minute slope would fail it", () => {
  // Flat at 118 MiB to minute 210, then up 0.4 MiB a minute to 126 at the end: 3.3% per 10 minutes over the last 20,
  // and under 5% between the halves.
  const MIB = 1_048_576;
  const drifting = sidecarMemory(
    () => 500_000_000,
    (at) =>
      Math.round(
        (at < 210 * MINUTE ? 118 : 118 + (0.4 * (at - 210 * MINUTE)) / MINUTE) *
          MIB,
      ),
  );
  const { rows, memory } = analyzeUnattended(runData({ memory: drifting }));
  expect(memory.footprintTrend).toMatchObject({
    judgeable: true,
    levellingOff: false,
  });
  const row = rowOf(rows, MEMORY_ROW);
  expect(row.ok).toBe(true);
  expect(row.measured).toMatch(/^\+[34]\.\d\d%/);
  expect(row.measured).toContain("20-minute slope");
  expect(failing(rows)).toEqual([]);
});

test("a flat physical footprint with a steadily rising RSS passes the memory row, and the row shows the RSS trend beside it", () => {
  const churn = sidecarMemory(
    (at) => 120_000_000 + at * 400,
    () => 80_000_000,
  );
  const { rows, memory } = analyzeUnattended(runData({ memory: churn }));
  const row = rowOf(rows, MEMORY_ROW);
  expect(row.ok).toBe(true);
  expect(row.measured).toContain("RSS");
  // The RSS alone would have failed the row, as it did in the first hour.
  expect(memory.sidecarTrend).toMatchObject({
    judgeable: true,
    levellingOff: false,
  });
});

test("positive control: a footprint that could not be read inside the settled span makes the memory row not judgeable and fails it, and so do samples that never recorded one", () => {
  const unread = sidecarMemory(
    () => 500_000_000,
    (at) => (at > 220 * MINUTE && at < 221 * MINUTE ? undefined : 80_000_000),
  );
  const gap = analyzeUnattended(runData({ memory: unread }));
  expect(rowOf(gap.rows, MEMORY_ROW).ok).toBe(false);
  expect(rowOf(gap.rows, MEMORY_ROW).measured).toContain("not judgeable");
  expect(rowOf(gap.rows, MEMORY_ROW).measured).toContain(
    "footprint was not read",
  );
  const legacy = analyzeUnattended(
    runData({
      memory: sidecarMemory(
        () => 500_000_000,
        () => undefined,
      ),
    }),
  );
  expect(rowOf(legacy.rows, MEMORY_ROW).ok).toBe(false);
});

test("a run with no catch-up finish recorded has no settled span: the row is not judgeable, not a pass", () => {
  const base = baseResult();
  const { rows } = analyzeUnattended(
    runData({
      result: {
        boundaries: base.boundaries.filter(
          (b) => b.phase !== "catch-up-finished",
        ),
      },
    }),
  );
  const row = rowOf(rows, MEMORY_ROW);
  expect(row.ok).toBe(false);
  expect(row.measured).toContain("not judgeable");
  expect(row.measured).toContain("catch-up");
});

test("the settle drop and the floor scale with the run's length: a six-minute run drops 1.5 minutes and needs 2", () => {
  // The catch-up finishes at minute 187 of the fixture's clock; the six-minute run ends 4.2 minutes later.
  const base = baseResult();
  const scaled = {
    plan: phasePlan(6),
    boundaries: base.boundaries,
  };
  const samples = sidecarMemory(
    () => 500_000_000,
    (at) => (at < (187 + 1.5) * MINUTE ? 300_000_000 : 80_000_000),
    187 + 4.2,
  );
  const row = rowOf(
    analyzeUnattended(runData({ result: scaled, memory: samples })).rows,
    MEMORY_ROW,
  );
  // The burst in the first 1.5 minutes is dropped, and the 2.7 minutes left are judged.
  expect(row.measured).toMatch(/^\+0\.00%/);
  expect(row.ok).toBe(true);
  // The same samples under a sixty-minute plan have a 0-minute span after a 15-minute drop: not judgeable.
  const full = rowOf(
    analyzeUnattended(runData({ memory: samples })).rows,
    MEMORY_ROW,
  );
  expect(full.ok).toBe(false);
  expect(full.measured).toContain("not judgeable");
});

test("positive control: an unequal rebuild fails 'rebuild equals live' and an import refused for the event log fails 'import', each naming why; a missing baseline fails both and says so", () => {
  const base = baseResult().baseline;
  if (base === undefined || base.rebuild.state !== "captured")
    throw new Error("no baseline");
  const unequal = analyzeUnattended(
    runData({
      result: {
        baseline: {
          ...base,
          rebuild: {
            ...base.rebuild,
            equal: false,
            firstDifference: "actors[3].inventory",
          },
        },
      },
    }),
  );
  expect(rowOf(unequal.rows, "rebuild.equal").ok).toBe(false);
  expect(rowOf(unequal.rows, "rebuild.equal").measured).toContain(
    "actors[3].inventory",
  );
  expect(rowOf(unequal.rows, "rebuild.import").ok).toBe(true);

  const refused = analyzeUnattended(
    runData({
      result: {
        baseline: {
          ...base,
          importProof: {
            state: "captured",
            ok: false,
            slotCreated: false,
            refusal: {
              kind: "corrupt",
              reason:
                "its projection is not what its genesis and event log produce",
            },
          },
        },
      },
    }),
  );
  expect(rowOf(refused.rows, "rebuild.import").ok).toBe(false);
  expect(rowOf(refused.rows, "rebuild.import").measured).toContain("event log");
  expect(rowOf(refused.rows, "rebuild.equal").ok).toBe(true);

  const missing = analyzeUnattended(
    runData({ result: { baseline: undefined } }),
  );
  expect(rowOf(missing.rows, "rebuild.equal").measured).toContain(
    "no baseline",
  );
  expect(rowOf(missing.rows, "rebuild.import").ok).toBe(false);
});

test("positive control: a god with too few actions fails minimum activity, one with a run of four fails repetition, and one that influenced nothing fails influence", () => {
  const few = healthyScene();
  few.requests = few.requests.filter((r) => r.role !== "hades");
  const gone = new Set(few.requests.map((r) => r.proposalId));
  few.proposals = few.proposals.filter(
    (p) => p.actor !== "hades" || gone.has(p.proposalId),
  );
  const a = analyzeUnattended(runData({ scene: few }));
  expect(rowOf(a.rows, "gods.minimum-activity").ok).toBe(false);
  expect(rowOf(a.rows, "gods.minimum-activity").measured).toContain("hades");

  const repeating = healthyScene();
  for (const p of repeating.proposals) {
    if (p.actor === "hera") {
      p.kind = "legend";
      p.proposal = {
        actor: "hera",
        kind: "legend",
        assertion: "same",
        hearers: [],
        linkedEventId: "evt-1-1",
      };
    }
  }
  const b = analyzeUnattended(runData({ scene: repeating }));
  expect(rowOf(b.rows, "gods.repetition").ok).toBe(false);
  expect(rowOf(b.rows, "gods.repetition").measured).toContain("hera");

  const silent = healthyScene();
  silent.events = silent.events.filter(
    (e) => !(e.kind === "memory-recorded" && e.teller === "poseidon"),
  );
  const c = analyzeUnattended(runData({ scene: silent }));
  expect(rowOf(c.rows, "gods.influence").ok).toBe(false);
  expect(rowOf(c.rows, "gods.influence").measured).toContain("poseidon");
});

test("the outage window is left out of the per-god counts: a legend repeated only inside the outage does not fail repetition", () => {
  const scene = healthyScene();
  for (let i = 0; i < 6; i += 1) {
    turn(scene, "zeus", 950 + i, { recordedAtTick: 1000 + i, kind: "legend" });
  }
  const { rows } = analyzeUnattended(runData({ scene }));
  expect(rowOf(rows, "gods.repetition").ok).toBe(true);
  // It is still reported: the outage control above is what fails.
  expect(rowOf(rows, "outage.no-god-action").ok).toBe(false);
});

// --- The threshold table reaches the exit code ----------------------------------------------

test("a full-length analysis with a failed row exits 1 and one that holds exits 0: the exit is decided on the table, not on the lifecycle", () => {
  // The reproduction: no proxy record carries a prompt token count, so the prompt-size row fails on a run that completed.
  const failed = runData({ proxy: [] });
  const failedAnalysis = analyzeUnattended(failed);
  expect(failed.result.status).toBe("completed");
  expect(failedAnalysis.verdict).toBe("FAIL");
  expect(rowOf(failedAnalysis.rows, "prompt.tokens").ok).toBe(false);
  const outcome = gateOutcomeOf(failedAnalysis);
  expect(outcome).toEqual({ verdict: "FAIL", failedRows: ["prompt.tokens"] });
  expect(exitCodeOf({ ...failed.result, gate: outcome })).toBe(1);

  const holds = runData();
  const holdsAnalysis = analyzeUnattended(holds);
  expect(holdsAnalysis.verdict).toBe("PASS");
  const passing = gateOutcomeOf(holdsAnalysis);
  expect(passing).toEqual({ verdict: "PASS", failedRows: [] });
  expect(exitCodeOf({ ...holds.result, gate: passing })).toBe(0);
});

test("a development-length analysis with failed rows keeps exit 0, and a fault keeps exit 2, whatever the table holds", () => {
  const development = runData({ proxy: [], result: { plan: phasePlan(6) } });
  const analysis = analyzeUnattended(development);
  expect(analysis.verdict).toBe("not a gate run");
  expect(analysis.rows.some((r) => !r.ok)).toBe(true);
  expect(
    exitCodeOf({ ...development.result, gate: gateOutcomeOf(analysis) }),
  ).toBe(0);

  const fault = runData({
    proxy: [],
    result: { status: "fault", reason: "five empty" },
  });
  const faultAnalysis = analyzeUnattended(fault);
  expect(faultAnalysis.verdict).toBe("INFRASTRUCTURE FAULT");
  expect(
    exitCodeOf({ ...fault.result, gate: gateOutcomeOf(faultAnalysis) }),
  ).toBe(2);
});

// --- Reading the run ---------------------------------------------------------------------------

test("an exhausted request is labelled outage, empty-200, timeout or invalid output from what it kept and when it finished", () => {
  const request = (
    reason: string,
    detail = "",
    recordedAt = T0,
  ): RealRequest => ({
    proposalId: undefined,
    role: "zeus",
    outcome: "exhausted",
    elapsedMs: 1,
    promptPayload: undefined,
    steps: [{ reason, detail }],
    recordedAt,
  });
  const outage = { from: T0 + 10_000, to: T0 + 20_000 };
  expect(exhaustionReason(request("http-5xx"), undefined)).toBe("outage");
  expect(exhaustionReason(request("network"), undefined)).toBe("outage");
  expect(
    exhaustionReason(request("invalid-output", "x", T0 + 15_000), outage),
  ).toBe("outage");
  expect(
    exhaustionReason(
      request("invalid-output", "Invalid JSON response"),
      outage,
    ),
  ).toBe("empty-200");
  expect(exhaustionReason(request("timeout"), undefined)).toBe("timeout");
  expect(exhaustionReason(request("invalid-output", "bad json"), outage)).toBe(
    "invalid output",
  );
  expect(exhaustionReason(request("something"), undefined)).toBe("other");
});

test("ticks fall into the five phases at the boundaries", () => {
  const result = baseResult();
  expect(phaseOfTick(result, 0)).toBe("steady");
  expect(phaseOfTick(result, TICKS.outage - 1)).toBe("steady");
  expect(phaseOfTick(result, TICKS.outage)).toBe("outage");
  expect(phaseOfTick(result, TICKS.restored)).toBe("recovery");
  expect(phaseOfTick(result, TICKS.stopped)).toBe("catch-up");
  expect(phaseOfTick(result, TICKS.catchUp)).toBe("after catch-up");
  expect(phaseOfTick(result, TICKS.ended)).toBe("after catch-up");
  // A run that ended before a phase has no later phase.
  const early: UnattendedResult = {
    ...result,
    boundaries: result.boundaries.slice(0, 2),
  };
  expect(phaseOfTick(early, 5000)).toBe("outage");
});

test("the two windows with no service are the outage to proxyRestoredAt and the stop to the end of catch-up, and a run that ended inside one runs the window to the end", () => {
  const windows = serviceWindows(baseResult(), TICKS.ended);
  expect(windows.map((w) => [w.fromTick, w.toTick])).toEqual([
    [TICKS.outage, TICKS.restored],
    [TICKS.stopped, TICKS.catchUp],
  ]);
  const early: UnattendedResult = {
    ...baseResult(),
    boundaries: baseResult().boundaries.slice(0, 2),
  };
  expect(
    serviceWindows(early, 3000).map((w) => [w.fromTick, w.toTick]),
  ).toEqual([[TICKS.outage, 3000]]);
});

test("director events are counted by kind and phase, and only the director's own", () => {
  const scene = healthyScene();
  scene.events.push({
    schemaVersion: 1,
    id: "evt-70-t",
    sequence: 5,
    simTime: 0,
    correlationId: "tick-70",
    causationId: "tick-70",
    tick: 70,
    approximate: false,
    kind: "stock-spoiled",
    entityId: "farmer",
    resource: "food",
    amount: 1,
    cause: "trouble",
  });
  const analysis = analyzeUnattended(runData({ scene }));
  const spoiled = analysis.director["stock-spoiled"];
  expect(spoiled).toBeDefined();
  expect(Object.values(spoiled ?? {}).reduce((a, b) => a + b, 0)).toBe(
    Math.floor(TICKS.ended / 120),
  );
});
