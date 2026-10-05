---
title: Transparent RGB bytes broke conformance grid recovery
date: 2026-10-05
category: logic-errors
module: assets
problem_type: logic_error
component: tooling
severity: medium
symptoms:
  - "Hidden RGB variation under alpha zero produces false grid edges"
  - "A valid enlarged sprite returns needs-scale, or false blended blocks when the scale is supplied"
root_cause: logic_error
resolution_type: code_fix
tags: [alpha-zero, rgba, grid-recovery, conformance, report-only]
---

# Transparent RGB bytes broke conformance grid recovery

## Problem

Grid recovery compared RGB bytes beneath fully transparent pixels as visible differences. Visually identical RGBA inputs could therefore produce different conformance results, breaking the U06/X02 deterministic conformance foundation.

## Symptoms

With grid detection, the enlarged sprite returned `needs-scale`; with scale 8 supplied, it counted 3,072 blocks as blended. An independent before/after comparison showed grid confidence rising from about 0.19 to 1 and off-grid edges falling from 343,975 to zero after the fix.

## What Didn't Work

Comparing all four stored channels directly treated invisible colour as grid evidence. Normalizing the caller's buffer is not an acceptable substitute: report-only imports must preserve the original bytes.

## Solution

In `pixelsDiffer`, compare each pixel's RGB as zero only when its alpha is exactly zero. Compare alpha as stored, using the caller's tolerance:

```ts
const aHidden = a[ai + 3] === 0;
const bHidden = b[bi + 3] === 0;
for (let c = 0; c < 4; c += 1) {
  const av = c < 3 && aHidden ? 0 : (a[ai + c] as number);
  const bv = c < 3 && bHidden ? 0 : (b[bi + c] as number);
  if (Math.abs(av - bv) > tolerance) return true;
}
```

This fixes both grid-edge evidence and blended-block detection. The existing `canonicalAt` comparison already applies the same zero-alpha rule to visual diffs and mirror checks. Neither helper rewrites the source buffer; report-only output remains a copy of the original bytes.

## Why This Works

RGB beneath alpha zero cannot affect visible output. Canonical comparison removes that irrelevant variation from measurements while preserving byte-level editing data. It does not ignore semi-transparent RGB, change alpha cutoffs, or introduce premultiplied-alpha conversion.

## Prevention

- Vary only RGB beneath alpha zero; confidence, proposals, reports and visual diffs must match the zero-filled baseline.
- Check transparent versus opaque pixels and alpha deltas on both sides of the comparison tolerance. With black RGB and tolerance 8, delta 5 produces no edge; delta 20 does.
- Assert input immutability and exact report-only output bytes, not just visual equality.

Eight regression tests failed before the fix and passed afterward. The fixed tree passed `bun run check` with 2,850 tests and zero failures, `bun run --cwd tools/content validate:assets`, and `git diff --check`. CI passed both `check` and `rust` on that head.

## Related Issues

- [Source and regression evidence in PR #128](https://github.com/marcusrbrown/panthea/pull/128).
- [Pixel comparison](../../../packages/assets/src/conformance.ts) and [regression tests](../../../packages/assets/src/conformance.test.ts).
- [PNG integrity checks](../integration-issues/incomplete-pngs-pass-hash-and-header-checks-2026-10-04.md) are separate from pixel conformance and do not decode pixels.
