---
title: Releasing the writer lock when idle needs its own path, not teardown
date: 2026-10-11
category: logic-errors
module: studio-app
problem_type: logic_error
component: tooling
severity: high
symptoms:
  - "An idle release built on teardown() would leave tearingDown set for the life of the process"
  - "owner() would then refuse every later write with shutting-down"
  - "teardown() unwatches open edits, so saves made after an idle release would never be imported"
root_cause: scope_issue
resolution_type: code_fix
tags: [writer-lock, teardown, idle-release, edit-watcher, sidecar, state-latch]
---

# Releasing the writer lock when idle needs its own path, not teardown

## Problem

The studio app gives the store writer lock back when idle, so CLI steps run while it stays open (#209). `teardown()` already closes the editor, runtime and session in order, but it is the wrong thing to reuse.

## Symptoms

- `teardown()` sets `tearingDown` with `??=` and never clears it. With it set, `owner()` and `previewSource()` refuse with `shutting-down` and `kick()` stops draining, so the app could never write again.
- `teardown()` unwatches every open edit, so a save made after the release is never imported.
- A watcher poll with only `try/finally` lets a throw from `owner()`, or a workspace file that vanished, escape the timer as an unhandled rejection.

## Solution

`release()` in `tools/studio/src/host.ts` is a separate path. It never sets `tearingDown` and never unwatches edits. ADR-0010's 2026-10-11 note records the idle rules, the step order and the watcher contract.

The release attempt is bounded like quit, but its steps can outlast the bound, so they are tracked with their own promise. Nothing is handed out while they run:

```ts
// Tracks the steps themselves, not the race: it stays set while they run.
const open = steps.then(() => {
  if (this.releaseSteps === open) this.releaseSteps = undefined;
});
```

## Prevention

- Don't gate a reversible path on a terminal latch. If an operation must reopen, give it its own state.
- When a time bound races work that keeps running, track the work with its own promise rather than clearing the in-progress marker when the bound fires.
- Long-lived watchers reach shared resources through an accessor (`owner()`), catch everything inside the timer, and advance their baseline only after the work succeeds or is refused for good.
- `tools/studio/src/host.test.ts` (fake deps, injected scheduler): "release is its own path" and "a release that does not finish". `tools/studio/src/lifecycle.test.ts` still pins teardown's retry loop.

## Related

- `docs/decisions/0010-studio-app-host.md`, the 2026-10-11 note.
- `tools/probes/studio-release/README.md`: the measured costs behind the 15 s grace.
- `docs/solutions/integration-issues/studio-quit-drained-queue-and-orphaned-image-server-2026-10-09.md`: the quit side of the same host.
