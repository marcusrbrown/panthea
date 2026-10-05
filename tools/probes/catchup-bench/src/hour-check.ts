// Manual full-hour validity check (`bun run bench:hour`), outside `bun test`.
// It is what `measure.test.ts` asserts at a four-minute gap, run at the whole
// hour: 3,600 ticks, 60 chunks, the mirror and the real catch-up agreeing on
// the event stream and the final projection, and the chunk gaps and the ending
// commit tiling the run. It takes a few seconds; it exits 1 on any mismatch.

import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { runEndToEnd, runPhases } from "./measure";
import { createWorld, HOUR_MS, HOUR_TICKS, makeRunDir } from "./world";

const dirA = makeRunDir("catchup-hour-check-real-");
const dirB = makeRunDir("catchup-hour-check-mirror-");
try {
  const real = createWorld(dirA, 4);
  const mirrored = createWorld(dirB, 4);
  const chunks = HOUR_MS / real.state.rules.catchUpChunkMs;
  const run = await runEndToEnd(real, HOUR_MS);
  const phases = await runPhases(mirrored, HOUR_MS);

  assert.equal(chunks, 60, "an hour is 60 chunks of the world's chunk size");
  assert.equal(run.ticks, HOUR_TICKS);
  assert.equal(phases.ticks, run.ticks);
  assert.equal(phases.eventDigest, run.eventDigest);
  assert.equal(phases.projectionDigest, run.projectionDigest);
  assert.equal(phases.added.events, run.added.events);
  assert.equal(phases.added.outcomes, run.added.outcomes);
  assert.equal(run.chunkGapsMs.length, chunks);
  assert.equal(phases.chunkHeldMs.length, chunks);
  for (const gap of run.chunkGapsMs) assert.ok(gap > 0);
  assert.ok(run.endingCommitMs > 0);
  const sum = run.chunkGapsMs.reduce((a, b) => a + b, 0);
  assert.ok(
    Math.abs(sum + run.endingCommitMs - run.totalMs) < 5,
    "chunk gaps and the ending commit tile the run",
  );
  for (const r of [run, phases]) {
    assert.ok(r.trace.outcomesChecked > 0);
    assert.equal(r.trace.outcomesWithoutObservation, 0);
    assert.equal(r.trace.brokenEventLinks, 0);
    assert.equal(r.trace.eventsWithoutOutcome, 0);
  }
  console.log(
    `hour check ok: ${run.ticks} ticks, ${chunks} chunks, real ${Math.round(run.totalMs)} ms, mirror ${Math.round(phases.totalMs)} ms`,
  );
  real.dispose();
  mirrored.dispose();
} finally {
  rmSync(dirA, { recursive: true, force: true });
  rmSync(dirB, { recursive: true, force: true });
}
