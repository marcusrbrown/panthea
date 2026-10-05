---
title: Generator probes need explicit process and timing boundaries
date: 2026-10-04
category: integration-issues
module: art-local
problem_type: integration_issue
component: tooling
severity: medium
symptoms:
  - "Cleanup relabels a SIGABRT crash while output pipes drain"
  - "An occupied endpoint counts as readiness for a newly spawned server"
  - "Cancellation records idle time as ready time or exits successfully after a failed restart"
  - "A spawn exception bypasses results and logs"
root_cause: async_timing
resolution_type: code_fix
tags: [bun, subprocess, sigabrt, cancellation, readiness, attribution, probe]
---

# Generator probes need explicit process and timing boundaries

## Problem

The image probe owns a native server process and sends jobs through HTTP. Cleanup, output collection, readiness, and restart timing can describe different events.

## Symptoms

A crash became `stopped` when cleanup ran after termination but before output pipes finished draining. A different server on the configured endpoint could satisfy readiness.

Cancellation included the later idle wait in a ready-time measurement. A failed replacement could still produce exit code 0. An unspawnable executable could bypass the report entirely.

## What Didn't Work

A stop flag set during cleanup does not establish that the stop caused termination. An answering HTTP endpoint does not establish that the probe's child answered it. Quiet CPU usage does not establish readiness.

## Solution

The [managed-process implementation](../../../tools/probes/art-local-2/src/process.ts) records termination as soon as `child.exited` resolves, before the bounded pipe-drain wait. Cleanup does not set the stop flag after that observation.

Only a null signal, `SIGTERM`, or `SIGKILL` can accompany a requested `stopped` exit. An unexpected `SIGABRT` remains `exited`. The implementation retains a bounded prefix of output and counts discarded bytes after a requested stop.

Before spawning, the arm refuses a capabilities endpoint that already answers. Readiness also tests child termination before and after each HTTP probe.

Restart timing separates these events:

- `abortToExitMs`: Stop request to completion of `stop()`, including its pipe-drain wait (bounded at 500 ms).
- `restartToReadyMs`: Replacement readiness polling duration.
- `totalCancelToReadyMs`: Stop request to replacement readiness, recorded before the idle wait.
- `restartToIdleMs`: Respawn to measured idle, when requested.

The CLI fails when required restart or idle evidence is incomplete. Spawn failures become `spawn-failed` records, failed cells, logs, and exit code 1.

## Why This Works

The report uses observed lifecycle events rather than the order of cleanup calls. Ready and idle measurements retain separate meanings. A failed run still produces evidence.

This does not identify every exit that races a stop. An ordinary exit without a signal can still count as `stopped` when a stop was already requested.

## Prevention

Use real child-process regressions for crashes during pipe drain, stop escalation, spawn failure, occupied endpoints, and replacement failure. Keep early output and crash attribution assertions separate.

Fake servers establish harness behavior, not generator speed or memory use. Label historical cancel-to-idle values accurately rather than presenting them as cancel-to-ready.

## Related Issues

- [Process regressions](../../../tools/probes/art-local-2/src/process.test.ts)
- [Arm attribution and cancellation tests](../../../tools/probes/art-local-2/src/arm.test.ts)
- [CLI result and exit-status tests](../../../tools/probes/art-local-2/src/cli.test.ts)
- [Probe measurements and timing caveats](../../../tools/probes/art-local-2/README.md)
- [Earlier stable-diffusion.cpp cancellation probe](sdcpp-cancel-sigint-diffusion-fa-2026-09-27.md)
- [Linux core-dump delays](../test-failures/piped-core-dumps-delay-bun-crash-tests-2026-10-04.md)
