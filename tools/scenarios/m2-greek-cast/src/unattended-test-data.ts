// Synthetic unattended-run data for the analysis and report tests: a sixty-minute run inside every threshold, and the
// pieces the positive controls break one at a time.

import type { GodIdentity } from "./episode-analysis";
import type { MemorySample } from "./memory";
import type { ProxyRecord } from "./outage-proxy";
import type { RealInput, RealProposal, RealRequest } from "./real-analysis";
import type { Boundary, PhaseName, UnattendedResult } from "./unattended";
import { phasePlan } from "./unattended";
import type { UnattendedRunData } from "./unattended-analysis";

export const MINUTE = 60_000;
export const T0 = 1_800_000_000_000;
export const GODS = [
  "athena",
  "hades",
  "hephaestus",
  "hera",
  "hermes",
  "poseidon",
  "zeus",
];

export const identities = new Map<string, GodIdentity>(
  GODS.map((id) => [
    id,
    {
      id,
      name: id,
      domains: ["x"],
      drives: { a: 1 },
      abilities: [{ name: "Tale", action: "legend" }],
    },
  ]),
);

// A run of 60 minutes: the outage from tick 900 to 1620, the stop at 2220, the catch-up to 5820, the end at 8400.
export const TICKS = {
  started: 0,
  outage: 900,
  restored: 1620,
  stopped: 2220,
  restarted: 2220,
  catchUp: 5820,
  ended: 8400,
};

export const boundaryAt = (
  phase: PhaseName,
  tick: number,
  runningMin: number,
): Boundary => ({
  phase,
  wallMs:
    T0 +
    tick * 1000 +
    (phase === "restarted" || phase === "catch-up-finished" || phase === "ended"
      ? 90 * MINUTE
      : 0),
  tick,
  runningMs: runningMin * MINUTE,
});

export function baseResult(
  over: Partial<UnattendedResult> = {},
): UnattendedResult {
  const plan = phasePlan(60);
  return {
    status: "completed",
    plan,
    settings: { model: "granite3.3-8b-4k", endpoint: "local" },
    startedWallMs: T0,
    endedWallMs: T0 + 160 * MINUTE,
    elapsedWallMs: 160 * MINUTE,
    runningMs: 60 * MINUTE,
    boundaries: [
      boundaryAt("started", TICKS.started, 0),
      boundaryAt("outage-started", TICKS.outage, 15),
      boundaryAt("proxy-restored", TICKS.restored, 27),
      boundaryAt("stopped", TICKS.stopped, 37),
      boundaryAt("restarted", TICKS.restarted, 37),
      boundaryAt("catch-up-finished", TICKS.catchUp, 37.1),
      boundaryAt("ended", TICKS.ended, 60),
    ],
    checks: [
      { name: "the sidecar stops cleanly", ok: true, detail: "exit code 0" },
      {
        name: "the catch-up is bracketed by its own log lines",
        ok: true,
        detail: "x",
      },
      {
        name: "the catch-up applies the cap and discards the rest",
        ok: true,
        detail: "60 min applied, 30.0 min discarded",
      },
      {
        name: "no provider request is made during the catch-up",
        ok: true,
        detail: "0 requests inside it",
      },
      {
        name: "the catch-up summary persists to the end, or a later catch-up pass replaced it",
        ok: true,
        detail: "same",
      },
    ],
    outage: { trigger: "gods", godsActed: 5 },
    restore: {
      runnerAtRestore: "absent",
      firstRequestAfterRestore: {
        latencyMs: 9000,
        status: 200,
        empty: false,
        afterRestoreMs: 4000,
      },
    },
    baseline: {
      store: { state: "captured", bytes: 5_000_000, walBytes: 0 },
      archive: { state: "captured", bytes: 2_000_000, eventSequence: 9000 },
      rebuild: {
        state: "captured",
        ms: 800,
        events: 9000,
        equal: true,
        liveDigest: "a".repeat(64),
        rebuiltDigest: "a".repeat(64),
        projectionBytes: 100000,
        integrity: "ok",
        process: "separate",
        childPid: 1,
      },
      importProof: {
        state: "captured",
        ok: true,
        events: 9000,
        slotCreated: true,
      },
    },
    ...over,
  };
}

let seq = 0;
const nextId = () => {
  seq += 1;
  return seq;
};

export interface Scene {
  requests: { -readonly [K in keyof RealRequest]: RealRequest[K] }[];
  proposals: { -readonly [K in keyof RealProposal]: RealProposal[K] }[];
  events: Record<string, unknown>[];
}

export const promptAt = (tick: number, extra = ""): string =>
  `You are a god. It is day 1 in the mortal realm, tick ${tick}.\n${extra}`;

/** One answered request by `god` starting at `tick`, with a committed legend that tells a belief. */
export function turn(
  scene: Scene,
  god: string,
  tick: number,
  over: {
    elapsedMs?: number;
    kind?: string;
    recordedAtTick?: number;
    /** The tick the world consumed the proposal in; six ticks after the request began unless given. */
    consumedTick?: number;
  } = {},
): void {
  const n = nextId();
  const proposalId = `p${n}`;
  const observationId = `obs-${n}`;
  // Legends and walks alternate, so no choice repeats; a walk names a place the prompt shows.
  const kind = over.kind ?? (n % 2 === 0 ? "legend" : "travel");
  const recordedAt =
    T0 +
    (over.recordedAtTick ?? tick) * 1000 +
    (tick >= TICKS.catchUp ? 90 * MINUTE : 0) +
    5000;
  scene.requests.push({
    proposalId,
    role: god,
    outcome: "intent",
    elapsedMs: over.elapsedMs ?? 8000,
    promptPayload: promptAt(tick, `place-${n}`),
    steps: [{ mode: "native" }],
    recordedAt,
  });
  scene.proposals.push({
    proposalId,
    actor: god,
    kind,
    observationId,
    proposal: {
      actor: god,
      kind,
      assertion: `A tale ${n}`,
      hearers: [],
      ...(kind === "travel" ? { to: `place-${n}` } : {}),
    },
    outcome: "committed",
    consumedTick: over.consumedTick ?? tick + 6,
  });
  const sourceId = `evt-${tick}-${n}`;
  scene.events.push({
    schemaVersion: 1,
    id: sourceId,
    sequence: n * 10,
    simTime: 0,
    correlationId: observationId,
    causationId: observationId,
    tick: over.consumedTick ?? tick + 6,
    approximate: false,
    kind: kind === "legend" ? "legend-recorded" : "entity-moved",
    entityId: god,
    ...(kind === "legend"
      ? { assertion: `A tale ${n}`, hearers: ["farmer"] }
      : { from: "a", to: "b" }),
  });
  if (kind === "legend") {
    scene.events.push({
      schemaVersion: 1,
      id: `evt-${tick}-${n}-b`,
      sequence: n * 10 + 1,
      simTime: 0,
      correlationId: `tick-${over.consumedTick ?? tick + 6}`,
      causationId: sourceId,
      tick: over.consumedTick ?? tick + 6,
      approximate: false,
      kind: "memory-recorded",
      memoryKind: "told",
      entityId: "farmer",
      sourceEventId: sourceId,
      teller: god,
      content: `A tale ${n}`,
      subjects: [god],
      salience: 4,
    });
  }
}

/** A request the outage proxy refused: it began at `tick`, was answered 503 and exhausted 300 ms later, with no model response. */
export function refusal(scene: Scene, god: string, tick: number): void {
  scene.requests.push({
    proposalId: undefined,
    role: god,
    outcome: "exhausted",
    elapsedMs: 300,
    promptPayload: promptAt(tick, `refused-${nextId()}`),
    steps: [
      {
        mode: "native",
        reason: "http-5xx",
        detail: "503 Service Unavailable: provider unavailable",
        attempts: 2,
      },
    ],
    recordedAt: T0 + tick * 1000 + 300,
  });
}

/** The events the world makes on its own across the run: routines, and the director every 120 ticks. */
export function worldLife(scene: Scene, from: number, to: number): void {
  for (let tick = from; tick <= to; tick += 60) {
    const n = nextId();
    scene.events.push({
      schemaVersion: 1,
      id: `evt-${tick}-w${n}`,
      sequence: n * 10 + 5,
      simTime: 0,
      correlationId: `tick-${tick}`,
      causationId: `tick-${tick}`,
      tick,
      approximate: false,
      kind: "entity-moved",
      entityId: "farmer",
      from: "a",
      to: "b",
    });
  }
  for (let tick = 120; tick <= to; tick += 120) {
    if (tick < from) continue;
    const n = nextId();
    scene.events.push({
      schemaVersion: 1,
      id: `evt-${tick}-d${n}`,
      sequence: n * 10 + 6,
      simTime: 0,
      correlationId: `tick-${tick}`,
      causationId: `tick-${tick}`,
      tick,
      approximate: false,
      kind: "stock-spoiled",
      entityId: "farmer",
      resource: "food",
      amount: 1,
      cause: "director",
    });
  }
}

/** A run inside every threshold: each god takes a turn every 60 service ticks, in service time only. */
export function healthyScene(): Scene {
  const scene: Scene = { requests: [], proposals: [], events: [] };
  worldLife(scene, 0, TICKS.ended);
  GODS.forEach((god, i) => {
    // Before the outage: every request finishes before it starts.
    for (let tick = 10 + i * 8; tick < TICKS.outage - 20; tick += 70)
      turn(scene, god, tick);
    // After the proxy returns, until the stop.
    for (
      let tick = TICKS.restored + 20 + i * 8;
      tick < TICKS.stopped;
      tick += 70
    )
      turn(scene, god, tick);
    // After the catch-up, until the end.
    for (let tick = TICKS.catchUp + 20 + i * 8; tick < TICKS.ended; tick += 70)
      turn(scene, god, tick);
  });
  return scene;
}

export function memorySeries(): MemorySample[] {
  const samples: MemorySample[] = [];
  for (let at = 0; at <= 160 * MINUTE; at += 10_000) {
    samples.push({
      atMs: T0 + at,
      runner: { state: "present", pids: [9], rssBytes: 6_000_000_000 },
      sidecar:
        at > 100 * MINUTE && at < 105 * MINUTE
          ? { state: "absent" }
          : {
              state: "present",
              pid: at < 100 * MINUTE ? 100 : 200,
              rssBytes: 500_000_000,
              footprintBytes: 80_000_000,
            },
      swap: { usedMiB: 1000, totalMiB: 4096 },
    });
  }
  return samples.filter(
    (s) => s.atMs >= T0 + 105 * MINUTE || s.atMs < T0 + 100 * MINUTE,
  );
}

export function proxyRecords(over: Partial<ProxyRecord>[] = []): ProxyRecord[] {
  const records: ProxyRecord[] = [];
  for (let i = 0; i < 40; i += 1) {
    records.push({
      at: T0 + i * 1000,
      status: 200,
      latencyMs: 8000,
      outcome: "forwarded",
      kind: "completion",
      empty: false,
      promptTokens: 2600 + (i % 7) * 20,
    });
  }
  return [
    ...records,
    ...over.map((o, i) => ({
      at: T0 + 100_000 + i,
      status: 200,
      latencyMs: 1,
      outcome: "forwarded" as const,
      kind: "completion" as const,
      empty: false,
      ...o,
    })),
  ];
}

/**
 * The responses the proxy would have recorded for every answered request in `scene`: each ends 6 ms before its trace
 * row was written, took the request's elapsed time, and counts 0.33 tokens a character of the prompt it was shown.
 */
export function responsesFor(scene: Scene): ProxyRecord[] {
  return scene.requests.flatMap((r) =>
    r.outcome === "intent" && r.recordedAt !== undefined
      ? [
          {
            at: r.recordedAt - 6 - r.elapsedMs,
            status: 200,
            latencyMs: r.elapsedMs,
            outcome: "forwarded" as const,
            kind: "completion" as const,
            empty: false,
            promptTokens: Math.round((r.promptPayload?.length ?? 0) * 0.33),
          },
        ]
      : [],
  );
}

export function runData(
  over: {
    scene?: Scene;
    result?: Partial<UnattendedResult>;
    proxy?: ProxyRecord[];
    memory?: MemorySample[];
  } = {},
): UnattendedRunData {
  const scene = over.scene ?? healthyScene();
  const events = [...scene.events].sort(
    (a, b) => Number(a.sequence) - Number(b.sequence),
  ) as unknown as RealInput["events"];
  const input: RealInput = {
    requests: scene.requests,
    proposals: scene.proposals,
    events,
    polls: { total: 100, degraded: 5 },
    timing: { gods: GODS, endedAtMs: T0 + 160 * MINUTE, endTick: TICKS.ended },
  };
  return {
    result: baseResult(over.result),
    input,
    proxy: over.proxy ?? proxyRecords(),
    memory: over.memory ?? memorySeries(),
    identities,
    gods: GODS,
  };
}
