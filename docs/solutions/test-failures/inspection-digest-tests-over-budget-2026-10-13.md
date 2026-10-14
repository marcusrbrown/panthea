---
title: Inspection digest tests went over the test budget as canon grew
date: 2026-10-13
category: test-failures
module: client-view
problem_type: test_failure
component: testing_framework
severity: medium
symptoms:
  - "Four inspection tests timed out at 6–14 s under the full parallel suite once zeus-retro (136 frames) joined the digests"
  - "Two tests in apps/client/src/inspect/inspector.test.ts and two in tools/scenarios/studio-zeus-scene/src/reference.test.ts passed alone and failed under load"
root_cause: logic_error
resolution_type: code_fix
tags: [inspection-digest, fnv1a32, test-budget, bun-test, soft-backend, fixture-growth]
---

# Inspection digest tests went over the test budget as canon grew

## Problem

The inspection fixture compares canvas readback against digests of every canon frame at zoom 1–4. Once `zeus-retro` was published, the digests covered 153 frames × 4 zooms (`zeus-retro` is 136 of them), and four tests went past Bun's default 5 s per-test timeout in the full parallel suite.

## What Didn't Work

Raising the timeout was not used: it hides the cost and leaves the suite slower. The fix had to make the work faster without dropping an assertion.

## Solution

Profiling showed the time going to per-byte hashing, per-pixel fixture clears and regenerating the registry in every test.

1. **Hash loop.** `fnv1a32` (`apps/client/src/inspect/digest.ts`) is now an indexed loop on a signed 32-bit word:

   ```ts
   let hash = seed | 0;
   for (let index = 0; index < bytes.length; index += 1) {
     hash = Math.imul(hash ^ (bytes[index] as number), FNV_PRIME);
   }
   return hash >>> 0;
   ```

   `digest.test.ts` pins it against a plain BigInt reference, including a large buffer and seeded input.

2. **Soft-backend clear.** The test backend (`apps/client/test/soft-backend.ts`) clears with one 32-bit fill instead of a per-pixel `data.set`.

3. **Registry once per file.** `reference.test.ts` builds the reference from the committed registry once and reuses it across tests:

   ```ts
   let regenerated: ReturnType<typeof buildReference> | undefined;
   const generatedFromCommitted = () =>
     (regenerated ??= buildReference(readCommittedRegistry()));
   ```

No assertion was removed and no timeout was raised.

## Why This Works

The test cost scales with canon size, not with the code under test. Hashing every byte through an iterator dominated the run, and the other two fixes remove work repeated per test. The committed digests did not change, and `digest.test.ts` pins the new loop to the reference.

## Prevention

- When a fixture covers all of canon, budget for canon growth: hash and clear in bulk, and build expensive references once per file.
- Pin an optimised hot path against a simple reference in a test, so speed changes can't change results.
- A test that passes alone and times out in the suite is a cost problem. Profile it rather than raising its budget.
