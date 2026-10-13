---
title: Quitting the studio by closing stdin drained the queue, and the fixed kill bound left the image server running
date: 2026-10-09
category: integration-issues
module: studio-app
problem_type: integration_issue
component: tooling
severity: high
symptoms:
  - "Quit during a generation waited for the job instead of stopping it"
  - "The fixed 5 s bound then killed the sidecar, and its detached image server kept the model and port"
  - "A sidecar that answered one poll and then crashed restarted without reaching the restart cap"
root_cause: async_timing
resolution_type: code_fix
tags: [tauri, sidecar, quit, sigterm, process-group, sd-server, restart-supervisor]
---

# Quitting the studio by closing stdin drained the queue, and the fixed kill bound left the image server running

## Problem

The packaged studio quit by closing the sidecar's stdin, waiting a fixed 5 s, then killing it. The studio session treats end of input as "finish the queue", which is the CLI's intended behaviour (`tools/studio/src/index.ts:261`). So a quit during a generation waited out the job, and the bound killed the sidecar mid-job. No fixed bound fits a long job. The runtime starts `sd-server` in its own process group (`packages/assets/src/studio/runtime.ts:298`), so killing the sidecar did not stop it.

These are derived from the code. The old quit was not re-run on the real runtime as a control.

## Symptoms

- A quit with a job running did not stop the job.
- A surviving `sd-server` holds the model and port. The runtime refuses a server it did not start, so the next generation is blocked until someone stops it.

## Solution

Quit retires the launch, sends the sidecar `SIGTERM`, and waits. The session's interrupt path aborts the running job and stops the server group it owns, then releases the root lock and exits. Quit follows [ADR-0010, "Quit (2026-10-09, supersedes the paragraph above)"](../../decisions/0010-studio-app-host.md). The wait is the launch's own `termGraceMs + killMs` plus 3 s (`apps/studio/src-tauri/src/teardown.rs:38`), not a constant.

Measured on the packaged app, quitting during a real Z-Image 512×640 job ([evidence](../../evidence/asset-studio/unit7/README.md), "Quit during a generation"):

| | Run 1 | Run 2 |
| --- | --- | --- |
| Quit duration | 0.62 s | 0.57 s |
| `sd-server` at exit, +5 s, +30 s | none | none |
| Job afterwards | `cancelled`, no outputs | same |
| Second session on the same store | opens as writer | same |

A related supervision defect: the restart counter reset on the first applied snapshot, so a sidecar that answered once and then crashed never reached the three-attempt cap. The counter now resets only after `HEALTHY_POLLS` (5) good polls by the current launch (`apps/studio/src-tauri/src/state.rs:28`, `:232-244`).

## Why This Works

`SIGKILL` from outside cannot reach the group the session owns; `SIGTERM` reaches the session's interrupt path, which can.

## Prevention

- When a parent stops a child that owns its own subprocesses, signal the child to tear down. Closing a pipe or killing the child only works if the child has nothing of its own to stop.
- Derive a shutdown bound from the child's own deadlines, not a constant.
- Prove a quit change on the packaged app with a job running: no `sd-server` at exit, +5 s and +30 s, the job record, and a second session opening the store. `tools/studio/src/index.test.ts:714` pins the session half; `teardown.rs` tests pin the order and the bound.

## Related Issues

- [ADR-0010: Studio app host](../../decisions/0010-studio-app-host.md), "Quit (2026-10-09, supersedes the paragraph above)"
- [Lifecycle transitions under one lock](../best-practices/lifecycle-state-one-lock-transitions-2026-09-28.md)
- [Managed generator process boundaries](managed-generator-process-boundaries-2026-10-04.md)
