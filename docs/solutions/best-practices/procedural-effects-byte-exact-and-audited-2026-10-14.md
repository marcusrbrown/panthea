---
title: Keep procedural effects byte-exact without host trig, and audit them by regeneration
date: 2026-10-14
category: best-practices
module: assets
problem_type: design_pattern
component: tooling
severity: medium
applies_when:
  - "Adding or changing an effect generator under packages/assets/src/effects/"
  - "Changing any effect parameter, or the noise, trig or palette code a generator uses"
  - "Making a generated animation loop"
tags: [effects, procedural, determinism, provenance, audit, seamless-loop, generator-version]
---

# Keep procedural effects byte-exact without host trig, and audit them by regeneration

## Context

The fire and lightning effects are generated from a seeded recipe and a palette. Publish audits an effect by running the generator again, so the generator must give the same bytes on any engine. Tests check same-process repeatability only.

## Guidance

1. **No transcendental or random host math.** `packages/assets/src/effects/random.ts` bans `Math.sin`, `Math.cos`, `Math.pow` and `Math.random` (see its header). IEEE-exact operations such as arithmetic, `Math.floor`, `Math.sqrt` and `Math.imul` are fine. Trig is a Taylor series; `cosSin` reduces its argument to [-0.5, 0.5) turns first, so the series always sees a small value:

   ```ts
   export function cosSin(turns: number): readonly [number, number] {
     const wrapped = turns - Math.floor(turns);
     const x = (wrapped >= 0.5 ? wrapped - 1 : wrapped) * TAU;
     // Taylor series for cos and sin of x
   ```

2. **Close loops by sampling noise on a circle.** `loopNoise` samples value noise on a circle in the noise plane as `turns` runs from 0 to 1. At 1 the sample point is back where it started, so an animation driven by it closes its own loop.
3. **Bump the generator version on any pixel change.** `EFFECT_GENERATOR` is `{ id: "panthea-effects", version: 3 }` in `generate.ts`. Changing pixels without a bump fails publish on a frame-hash mismatch ("frame N is not what the recorded recipe generates"). With a bump, old records fail on the version instead, which names the cause.
4. **Audit by regeneration at publish.** `auditEffect` in `packages/assets/src/studio/effect.ts` regenerates from the recorded recipe and compares the generator, palette, frame hashes, atlas bytes and manifest. Publish refuses on the first mismatch. The record's shape is in ADR-0009.

## Why This Matters

If the generator used the host's trig or random source, the same recipe could give different bytes on another engine, and the audit would refuse a valid effect. The determinism, fire-loop and publish-refusal tests in `packages/assets/src/effects/effects.test.ts` and `packages/assets/src/studio/effect.test.ts` pin these rules.

## Related

- [Recompute derivation steps at publish](recompute-derivation-steps-at-publish-2026-10-11.md): the same publish-time recomputation for derived cells.
- [ADR-0009: asset registry, lifecycle and logical URIs](../../decisions/0009-asset-registry-lifecycle-and-uris.md)
