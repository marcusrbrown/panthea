---
title: Hash the GO/NO-GO criteria before the first render, and audit the repair counter before trusting it
date: 2026-10-12
category: workflow-issues
module: assets
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "A probe judges an art route GO or NO-GO from metrics a script measures"
  - "A route is re-tried with a new variant or round after a NO-GO"
  - "A repair, blip or flicker counter feeds a pass/fail threshold"
tags: [preregistration, go-no-go, canon-calibration, repair-estimate, sprite-probe, art-verdict]
---

# Hash the GO/NO-GO criteria before the first render, and audit the repair counter before trusting it

## Context

The Blender pre-render probe (#213) hashed round 3's GO conditions (a)–(d) before any render. They are listed in `tools/probes/blender-sprite/README.md` under "Round 3 criteria". The script failed (a) and (d) in both shading variants, so the NO-GO was mechanical. The retro-render probe (#214) is different: its metrics are report-only, and the owner accepted it after watching timed playback. ADR-0012 records that no boil limit for moving parts is calibrated.

## Guidance

1. **Hash the criteria before rendering, and keep the hash in a committed file.** Round 3's criteria file is in gitignored `scratch/`. Its committed record is the README copy and sha256. The hash shows the criteria were not edited after the renders. The repair-count rules were corrected after the round-2 audit, before the criteria were written, and the README says so.
2. **Calibrate each limit against canon.** Run the same detector on canon Zeus idle (per the README: 53 blips over 4 frames, 3.02% silhouette-stable change). Limit (a) is set at twice canon. Limit (d)'s 15 and 30 px have no stated basis, so call them unstated. Only idle was calibrated.
3. **Audit the counter before trusting a count.** `tools/probes/blender-sprite/repairs_r3.py` fixed three overcounts in the round-2 counter:
   - `bolt_shape` counts lost stamp pixels, and only when the stamp fails its shape check (under 60% visible, clipped, or hand pixels lost). The old rule flagged the whole bolt in every cell.
   - `stable_triplet_blips` also requires the same opacity across frames n−1, n and n+1 in each pixel's 3×3 neighbourhood, so motion at the silhouette edge no longer counts.
   - `union_estimate` returns a dict whose `pixels` key is the size of the union of flagged pixels. Its `sum_of_kinds` key is a diagnostic only, because summed per-issue counts overlap.
4. **Know what a "motion" label hides.** `surface_pair` in `tools/probes/retro-render/retro_metrics.py` counts index changes only where the part ID matches and depth moved less than 3 cm. The earlier boil metric called every change on a moving part motion. `surface_pair` is an upper bound, because a rotating surface legitimately relights.
5. **Measure the artifact that ships.** #214 counts colour and palette facts on the final cell with its shadow, and labels each scope in `measured_on`.

A count of changed pixels does not measure perceived smoothness. Leave the judgement on motion to timed playback.

## Why This Matters

A gate protects a decision only if it is written first and can fail. An audited counter gives a repair estimate you can defend.

## When to Apply

- A generated, procedural or rendered asset route is judged against a hand-made bar.
- A metric decides acceptance. Label any report-only metric as report-only.
- A round is repeated after a NO-GO. Keep the original criteria.

## Examples

- Round 3 pre-check (per the README): limit (a) measured 12.5 / 16.5 / 7.9 / 24.7% per facing against 6% in the s3 variant. Limit (d) measured 45.6 px per cell against 15.

## Related

- #213, `tools/probes/blender-sprite/README.md`
- #214, `tools/probes/retro-render/README.md` (Measurement scope)
- #215, [ADR-0012](../../decisions/0012-pre-rendered-retro-art-direction.md)
- [Independent review roles for generated art](generated-art-independent-review-roles-2026-10-08.md): who judges, not what is fixed before judging
