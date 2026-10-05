// The two ways a one-hour catch-up is run and measured.
//
// `runEndToEnd` runs the real `runCatchUp` with nothing around it but a
// callback that notes the time at each chunk boundary: its total is the
// number the targets are about, and the instrumentation cannot have moved it.
//
// `runPhases` runs the same hour through the mirror loop with the database,
// the reducers, and large JSON handling timed, to say where the time went. Its
// total is a little higher than the real function's (the clock reads), which
// the report states by running both.

import { readClock } from "@panthea/persistence";
import { runCatchUp } from "../../../../apps/simulation/src/catchup";
import { instrumentDb, instrumentReducers, timeLargeJson } from "./instrument";
import { runMirror } from "./mirror";
import { Phases } from "./phases";
import {
  type Counts,
  countRows,
  eventStreamDigest,
  fileBytes,
  HOUR_MS,
  type OpenWorld,
  projectionDigest,
  subtractCounts,
  type TraceIntegrity,
  traceDigest,
  traceIntegrity,
  walBytes,
} from "./world";

export interface RunResult {
  /** Wall time of the whole call, in ms. */
  readonly totalMs: number;
  /**
   * One interval per chunk, in ms: from the previous commit (the start of the
   * call, for the first) to this chunk's commit, so compute, commit, and the
   * event-loop yield before it. Every chunk is here, the last included.
   */
  readonly chunkGapsMs: readonly number[];
  /** The ending commit (the cursor's jump and the backlog's summary), which follows the last chunk with no yield between: its own interval, not part of any chunk's. */
  readonly endingCommitMs: number;
  /** What the hour added to the log and the trace. */
  readonly added: Counts;
  readonly walPeakBytes: number;
  readonly dbBytesBefore: number;
  readonly dbBytesAfter: number;
  readonly eventDigest: string;
  readonly projectionDigest: string;
  readonly traceDigest: string;
  readonly trace: TraceIntegrity;
  readonly ticks: number;
}

/** Everything about the store a run leaves behind, read after the run and before the store closes. */
function afterRun(
  world: OpenWorld,
  before: Counts,
  startSequence: number,
  walPeak: number,
  dbBytesBefore: number,
): Omit<RunResult, "totalMs" | "chunkGapsMs" | "endingCommitMs" | "ticks"> {
  const db = world.store.db;
  const after = countRows(db);
  return {
    added: subtractCounts(after, before),
    walPeakBytes: Math.max(walPeak, walBytes(world.path)),
    dbBytesBefore,
    dbBytesAfter: fileBytes(world.path),
    eventDigest: eventStreamDigest(db, startSequence),
    projectionDigest: projectionDigest(db),
    traceDigest: traceDigest(db),
    trace: traceIntegrity(db),
  };
}

/** One hour of the real `runCatchUp` and nothing else: no row counts, digests, or trace checks, so a profile of it is of the production path alone. */
export async function runBare(world: OpenWorld): Promise<number> {
  const clock = readClock(world.store.db);
  const start = performance.now();
  const result = await runCatchUp(world.state, world.prng, world.deps, {
    nowWallMs: clock.cursorWallMs + HOUR_MS,
  });
  const totalMs = performance.now() - start;
  if (result.degraded) {
    throw new Error(`catch-up degraded: ${result.degraded.message}`);
  }
  world.state = result.state;
  world.prng = result.prng;
  return totalMs;
}

/**
 * One hour of the real `runCatchUp` (or `gapMs`, a whole number of chunks; the
 * tests use a few minutes, the manual `bench:hour` check the full hour).
 *
 * Every commit boundary is stamped, by wrapping the `commitTick` that `TickDeps`
 * already lets a caller inject. The production `onChunkCommitted` callback
 * cannot do this alone: `runCatchUp` calls it only while ticks remain, so it
 * never fires for the last chunk and a measurement built on it is one chunk
 * short. With a stamp after each of the commits (60 chunks and the ending
 * commit for a whole hour), the chunk intervals and the ending commit tile the
 * run exactly. The callback is kept only to sample the WAL between chunks.
 */
export async function runEndToEnd(
  world: OpenWorld,
  gapMs = HOUR_MS,
): Promise<RunResult> {
  const db = world.store.db;
  const before = countRows(db);
  const startSequence = before.events === 0 ? 0 : lastSequence(db);
  const dbBytesBefore = fileBytes(world.path);
  const clock = readClock(db);
  let walPeak = 0;
  const stamps: number[] = [];
  const commit = world.deps.commitTick ?? persistCommit;
  const deps: typeof world.deps = {
    ...world.deps,
    commitTick: ((store, reducers, input) => {
      const committed = commit(store, reducers, input);
      stamps.push(performance.now());
      return committed;
    }) as typeof persistCommit,
  };
  const start = performance.now();
  const result = await runCatchUp(world.state, world.prng, deps, {
    nowWallMs: clock.cursorWallMs + gapMs,
    onChunkCommitted: () => {
      walPeak = Math.max(walPeak, walBytes(world.path));
      return false;
    },
  });
  const end = performance.now();
  if (result.degraded) {
    throw new Error(`catch-up degraded: ${result.degraded.message}`);
  }
  const chunks = gapMs / world.state.rules.catchUpChunkMs;
  if (stamps.length !== chunks + 1) {
    throw new Error(
      `expected ${chunks} chunk commits and the ending commit, saw ${stamps.length} commits`,
    );
  }
  const gaps = stamps
    .slice(0, chunks)
    .map((stamp, i) => stamp - (i === 0 ? start : (stamps[i - 1] as number)));
  world.state = result.state;
  world.prng = result.prng;
  return {
    totalMs: end - start,
    chunkGapsMs: gaps,
    endingCommitMs: end - (stamps[chunks - 1] as number),
    ticks: result.state.tick,
    ...afterRun(world, before, startSequence, walPeak, dbBytesBefore),
  };
}

function lastSequence(db: import("bun:sqlite").Database): number {
  return (
    (
      db.query("SELECT MAX(sequence) AS s FROM events").get() as {
        s: number | null;
      }
    ).s ?? 0
  );
}

export interface PhaseRun extends RunResult {
  readonly phases: ReturnType<Phases["toJSON"]>;
  /** Wall time of each chunk's compute plus commit (the time the event loop is held), in ms. */
  readonly chunkHeldMs: readonly number[];
}

/** One hour (or `gapMs`, a whole number of chunks) through the mirror loop, with the database, reducers, and large JSON timed. */
export async function runPhases(
  world: OpenWorld,
  gapMs = HOUR_MS,
): Promise<PhaseRun> {
  const phases = new Phases();
  const rawDb = world.store.db;
  const before = countRows(rawDb);
  const startSequence = before.events === 0 ? 0 : lastSequence(rawDb);
  const dbBytesBefore = fileBytes(world.path);

  const db = instrumentDb(rawDb, phases);
  const store = { ...world.store, db };
  const reducers = instrumentReducers(world.deps.reducers, phases);
  const deps = {
    store,
    reducers,
    traceDb: db,
    // The commit itself, with the trace callback timed apart from the rest.
    commitTick: ((
      s: typeof store,
      r: typeof reducers,
      input: Parameters<typeof import("@panthea/persistence").commitTick>[2],
    ) =>
      persistCommit(s, r, {
        ...input,
        onCommitted: (d) => {
          phases.time("commit:on-committed", () => input.onCommitted?.(d));
        },
      })) as typeof import("@panthea/persistence").commitTick,
  };

  const restore = timeLargeJson(phases);
  let mirror: Awaited<ReturnType<typeof runMirror>>;
  const start = performance.now();
  try {
    mirror = await runMirror(
      world.state,
      world.prng,
      deps as never,
      gapMs / 1000,
      Math.floor(world.state.rules.catchUpChunkMs / 1000),
      phases,
    );
  } finally {
    restore();
  }
  const totalMs = performance.now() - start;
  return {
    totalMs,
    chunkGapsMs: mirror.chunkMs,
    endingCommitMs: phases.ms("commit:ending-total"),
    chunkHeldMs: mirror.chunkMs,
    ticks: mirror.ticks,
    phases: phases.toJSON(),
    ...afterRun(
      world,
      before,
      startSequence,
      walBytes(world.path),
      dbBytesBefore,
    ),
  };
}

import { commitTick as persistCommit } from "@panthea/persistence";
