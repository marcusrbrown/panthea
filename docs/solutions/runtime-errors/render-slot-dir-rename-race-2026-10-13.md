---
title: A slot directory renamed mid-walk could fail the render job
date: 2026-10-13
category: runtime-errors
module: assets
problem_type: runtime_error
component: background_job
severity: medium
symptoms:
  - "rendered.test.ts, case 'refuses a kit file whose bytes changed', failed once on main CI: the rig's setup render settled as failed"
  - "The code was identical to green runs, and the rig's error said only 'failed'"
root_cause: async_timing
resolution_type: code_fix
tags: [render-engine, fs-race, readdir, enoent, rename, polling, job-status]
---

# A slot directory renamed mid-walk could fail the render job

## Problem

The render engine could settle a job as `failed` if the render script renamed a slot directory while the engine was walking it.

## Symptoms

- One main CI `check` failure, in the "refuses a kit file whose bytes changed" case of `packages/assets/src/render/rendered.test.ts`. The setup render in the test rig came back `failed` before the test changed anything.
- The rig printed only `<job>: failed`, with no cause.

## What Didn't Work

Repeating the audit tests under load did not reproduce the failure. The mechanism below is the only one found that fits the CI symptom.

## Solution

`listFiles` (`packages/assets/src/render/list-files.ts`) treats a directory that disappears mid-walk as empty. Its files now live under the new name, which the engine lists separately. Any other read error still throws:

```ts
try {
  entries = entriesOf(join(dir, at));
} catch (error) {
  if (gone(error)) return; // ENOENT or ENOTDIR: renamed away mid-walk
  throw error;
}
```

`entriesOf` is the test seam. `list-files.test.ts` renames the directory in the middle of the walk. It failed with `ENOENT` before the fix and passes after.

`renderCandidates` (`packages/assets/test/render/rig.ts`) now includes the job's recorded error when it throws.

## Likely cause

This is not reproduced and not confirmed as the CI cause. The render script writes a slot into `<outDir>.partial` and renames it to `<outDir>` in one step. The engine polls the partial tree for progress. If the rename lands after the walk has read the partial directory but before it descends into `colour/`, `id/` or `depth/`, `readdirSync` throws `ENOENT` out of the engine's `run()`, and the runtime settles the job as failed. The poll only reports progress. Committed slots are still checked against their `done.json` sentinel and file hashes, so treating the vanished directory as empty loses nothing.

## Prevention

- Any walk over a path another process renames needs a seam like `entriesOf` and a test that renames the directory mid-walk.
- Test helpers that wrap job outcomes should carry the job's error text. A bare `failed` hides the cause.
