---
title: Studio edit saves reached the window 2.7–7.5 s late, and Finish could import a save nobody reviewed
date: 2026-10-09
category: performance-issues
module: assets
problem_type: performance_issue
component: background_job
severity: high
symptoms:
  - "An edit saved in Aseprite reached the poller's snapshot 2.7 to 7.5 s later (median 5.3 s)"
  - "Finish imported whatever sheet the workspace held at click time, including one saved after the report shown"
root_cause: logic_error
resolution_type: code_fix
tags: [studio, polling, status-diff, edit-save, aseprite, stale-review, finish-gate]
---

# Studio edit saves reached the window 2.7–7.5 s late, and Finish could import a save nobody reviewed

## Problem

The packaged studio's native poller re-reads the six lists only when `status` changes, when the app changed something, or every fifth tick, because each read parses the whole store. An editor save imported by the session's watcher changes no count in `status`, so the window saw it only on the fifth-tick net. `finish` imported the workspace as it was at click time and named no reviewed version, so a save made inside that window was imported without review.

## Symptoms

- Lag from an edit import landing to the snapshot carrying it: 2.72–7.50 s, median 5.32 s, over 14 runs on the 71 MB store ([evidence](../../evidence/asset-studio/unit7/README.md), "Edit-save lag").
- Save v1, review its report, save v2, click Finish before the report refreshes: v2's pixels are kept without review.

## What Didn't Work

The cost-gated poll from the [progress-poll starvation fix](progress-poll-starved-job-drain-2026-10-08.md) was right about cost, but its change signal was counts only. Counts describe jobs and records, not the content of an open edit.

## Solution

`status` carries each open edit's saved-sheet hash (`tools/studio/src/format.ts:263-270`):

```ts
openEdits: status.edits
  .filter((edit) => edit.status === "open")
  .map((edit) => ({
    id: edit.id,
    previewSheetHash: edit.preview?.sheetHash ?? null,
  })),
```

The poller already compares the whole `status` value (`apps/studio/src-tauri/src/poll.rs:110-112`), so a changed hash re-reads the lists on the next tick with no Rust change. `a_saved_sheet_hash_changing_alone_re_reads_the_lists_on_the_next_tick` pins it.

`finish` takes an optional `reviewed` sheet hash. When it is given and the freshly exported sheet differs, the session refuses with `stale-review` before writing anything (`packages/assets/src/studio/edit-session.ts:417-425`). The window sends the hash of the report on screen and, on refusal, re-reads the report and says the workspace changed. Without `reviewed` the CLI behaves as before.

After the change: 1.52–2.58 s, median 1.85 s, 14 runs, from the reproduced tick logic, not through the window. That is still above the plan's ~1 s: one tick's reads (~1.2 s) plus the 1 s gap. Only a cheaper list read in the session cuts it further.

## Why This Works

The saved-sheet hash changes whenever the saved pixels do. The review gate names the exact sheet the owner saw, so a later save cannot be finished in its place.

## Prevention

- When gating an expensive poll on a cheap read, list every state the UI shows and check the cheap read changes for each one.
- Measure lag with the event at a random point in the poll cycle and N ≥ 10. An import fired right after a tick's status read misses that tick and biases the number high.
- An action that commits what the user reviewed carries the reviewed version, the same way approve and publish carry `confirm`.

## Related Issues

- [A slow progress poll starved the studio job queue](progress-poll-starved-job-drain-2026-10-08.md) (same poll cost; this is its freshness gap)
- [ADR-0010: Studio app host](../../decisions/0010-studio-app-host.md), "Snapshots by polling `list`"
