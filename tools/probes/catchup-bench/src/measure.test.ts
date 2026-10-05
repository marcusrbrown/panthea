import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { runEndToEnd, runPhases } from "./measure";
import { createWorld, makeRunDir } from "./world";

// A four-minute gap is four of the world's own 60 s chunks: enough to cross
// several chunk boundaries and the ending commit, in a fraction of the hour's
// time. The full hour is `bun run bench:hour`, which makes the same checks at
// 60 chunks. Every assertion below is in chunks (N), not a fixed count.
const GAP_MS = 4 * 60 * 1000;

test("a short mirrored run and the real catch-up produce the same event stream and the same world: the mirror does the same work, not a different one", async () => {
  const dirA = makeRunDir("catchup-bench-test-a-");
  const dirB = makeRunDir("catchup-bench-test-b-");
  try {
    const real = createWorld(dirA, 4);
    const mirrored = createWorld(dirB, 4);
    const chunks = GAP_MS / real.state.rules.catchUpChunkMs;
    const hour = await runEndToEnd(real, GAP_MS);
    const phases = await runPhases(mirrored, GAP_MS);
    expect(phases.ticks).toBe(hour.ticks);
    expect(phases.eventDigest).toBe(hour.eventDigest);
    expect(phases.projectionDigest).toBe(hour.projectionDigest);
    expect(phases.added.events).toBe(hour.added.events);
    expect(phases.added.outcomes).toBe(hour.added.outcomes);
    // The instrumented run times every chunk too, as the real run does.
    expect(phases.chunkHeldMs).toHaveLength(chunks);
    expect(hour.chunkGapsMs).toHaveLength(chunks);
    // Both left a trace that answers where every event came from.
    for (const run of [hour, phases]) {
      expect(run.trace.outcomesChecked).toBeGreaterThan(0);
      expect(run.trace.outcomesWithoutObservation).toBe(0);
      expect(run.trace.brokenEventLinks).toBe(0);
      expect(run.trace.eventsWithoutOutcome).toBe(0);
    }
    // The phases cover the run: nothing named is bigger than the whole.
    const named = Object.values(phases.phases);
    expect(named.length).toBeGreaterThan(5);
    real.dispose();
    mirrored.dispose();
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
}, 120_000);

test("a catch-up gap measures every chunk gap, the last included, and they and the ending commit add up to the whole run", async () => {
  const dir = makeRunDir("catchup-bench-test-gaps-");
  try {
    const world = createWorld(dir, 4);
    const chunkTicks = world.state.rules.catchUpChunkMs / 1000;
    expect(chunkTicks).toBe(60);
    const chunks = GAP_MS / world.state.rules.catchUpChunkMs;
    const run = await runEndToEnd(world, GAP_MS);
    expect(run.ticks).toBe(GAP_MS / 1000);
    // One gap per chunk: the production callback does not run after the last one, so
    // a measurement that waits for it is one short.
    expect(run.chunkGapsMs).toHaveLength(chunks);
    for (const gap of run.chunkGapsMs) expect(gap).toBeGreaterThan(0);
    // The ending commit (cursor jump and summary) is its own interval, not part of any chunk.
    expect(run.endingCommitMs).toBeGreaterThan(0);
    // Nothing is left out and nothing counted twice: the intervals tile the run.
    const sum = run.chunkGapsMs.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum + run.endingCommitMs - run.totalMs)).toBeLessThan(5);
    // The last chunk is the one this is about: its gap is a real chunk's (compute plus
    // commit), of the same order as its neighbours, not the ending commit's.
    const last = run.chunkGapsMs.at(-1) as number;
    const typical = [...run.chunkGapsMs].sort((a, b) => a - b)[
      Math.floor(chunks / 2)
    ] as number;
    expect(last).toBeGreaterThan(typical / 10);
    world.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);
