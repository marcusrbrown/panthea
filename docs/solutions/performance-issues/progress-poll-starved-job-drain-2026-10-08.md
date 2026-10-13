---
title: A slow progress poll starved the studio job queue
date: 2026-10-08
category: performance-issues
module: assets
problem_type: performance_issue
component: background_job
severity: high
symptoms:
  - "A queued studio job never started while the CLI showed progress"
  - "Each progress tick took longer than its poll period, so the timer was always due again"
root_cause: async_timing
resolution_type: code_fix
tags: [studio, progress-polling, event-loop, set-interval, job-queue, starvation]
---

# A slow progress poll starved the studio job queue

## Problem

`Studio.kick` (`tools/studio/src/host.ts`) reported progress with `setInterval(…, pollMs)`, and each tick called `session.store.status()`, which re-parses every record in the store. On the real U7 store that read took about 110–160 ms, longer than the configured `pollMs: 100`. The timer was always due again, the async drain never got a turn, and a real edit job never started.

## Symptoms

- The job stayed `queued` indefinitely. Profiling showed the process spending its time parsing records inside `status()`.
- The cost grows with the store, so the bug got worse the more the studio was used.

## What Didn't Work

Raising `pollMs` to 1000 in a temporary config let the job run, but only as a workaround. A status read that outlasts any period starves the queue the same way. The regression matrix includes 1000 ms against a 5000 ms status read to prove it.

```ts
// before
const progress = setInterval(() => {
  for (const record of session.store.status().jobs) { /* log changes */ }
}, pollMs);
```

## Solution

- Keep a watch list of the jobs this process queued or is running. Seed it with one `session.queued()` read per `kick`.
- Each tick reads only those jobs, with `store.readJob(id)`, and drops a job from the list once it reaches a terminal state.
- Replace `setInterval` with a `setTimeout` chain that re-arms only after a tick finishes. A slow tick then still leaves a full `pollMs` gap for the drain.
- Report the final transition once more when the drain ends.

```ts
// after
const tick = () => {
  this.reportProgress(session); // readJob per watched id, never the whole store
  if (polling) timer = setTimeout(tick, pollMs);
};
```

## Why This Works

A tick's cost no longer grows with the store, and a tick can never be due again before the drain has had a turn. On a copy of the real store, the job that used to hang ran to completion at `pollMs: 100`.

## Prevention

- Test scheduler shape, not just the happy path. `tools/studio/src/progress.test.ts` runs the real `kick` on a virtual event loop where a repeating timer is due again as soon as it returns and timers run before pending I/O. All four tests failed before the fix, with 4,997 whole-store reads, and pass after.
- Include cases where the callback costs more than the period: `pollMs` 1/100/1000 × status cost 0/150/5000 ms.
- Assert that the expensive aggregate read never runs inside a timer callback.
- Prefer a re-arming `setTimeout` over `setInterval` when a callback's cost depends on data size.

## Related Issues

- [Tick admission starved external proposals](../logic-errors/tick-admission-starved-external-proposals-2026-09-28.md): a different starvation bug with the same lesson, that a low-value repeating task must not starve work that has to progress.
- PR #174.
