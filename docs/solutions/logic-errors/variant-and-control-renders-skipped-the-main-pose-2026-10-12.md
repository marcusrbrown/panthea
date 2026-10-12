---
title: Variant and control renders must reuse the main render's pose path
date: 2026-10-12
category: logic-errors
module: assets
problem_type: logic_error
component: tooling
symptoms:
  - "In Zeus, 0 of 32 walk[i] == walk16[2i] pairs matched (7,212 px differ); walk16 lost the carry arm and the west-facing override"
  - "Before the fix, the zero-offset sub-pixel control differed from the main idle south frame 0 in 1,388–3,083 of 81,920 px across rounds 2 and 3"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [pose-policy, sample-variants, control-renders, equivalence-check, animation-state, blender, sprite-probe]
---

# Variant and control renders must reuse the main render's pose path

## Problem

A second render path posed the subject differently from the main render, so its numbers described a different pose. In #213 the sub-pixel control posed the library idle without the bolt-arm aims. In #214 the 16-frame walk sample variant missed the `walk` pose overrides, which hid the bolt in some west-facing cells. The counts are in the probe READMEs, and reproducing them needs Blender.

## Solution

- **One pose function per renderer.** Every Zeus render, the control included, calls `pose_zeus` (`tools/probes/blender-sprite/render_zeus_r3.py`; `render_zeus.py` has the same body). It applies the clip action, offsets, mirroring, aims and placement in one sequence.
- **Pose policy keyed by semantic state.** `Clip.state` in `tools/probes/retro-render/retro_plan.py` defaults to the clip id, and `walk16` declares `state="walk"`. Overrides are looked up by state, not by the output clip name:
  ```python
  def override_keys(state: str, facing: str) -> tuple[str, str]:
      return (state, f"{state}:{facing}")
  ```
- **Equivalence checks.**
  - `render_zeus_r3.py --check-subpixel` renders idle/south/0 and the zero-offset control, and exits 1 on any differing pixel.
  - `tools/probes/retro-render/check_resample.py` checks `walk[i] == walk16[2i]` pixel for pixel.
  - Both report 0 differing pixels.

## Prevention

- Route every variant and control through the main pose function.
- Keep semantic state and sample variant on separate axes, as ADR-0012's Decision requires (**Animation**). `test_r2.py` asserts that `override_keys` for `walk16`'s pose state equals `walk`'s.
- Run the equivalence check before reporting any stability or smoothness number from a variant.
- Known gaps:
  - `pose_zeus` is duplicated across the two blender-sprite renderers.
  - `--check-subpixel` compares the first rendered frame rather than looking up `(idle, south, 0)`.
  - The Blender equivalence runs are recorded results, not CI guards.

## Related Issues

- #213, `tools/probes/blender-sprite/README.md` (Sub-pixel control check)
- #214, `tools/probes/retro-render/README.md` (Round 3: walk resampling)
- #215, [ADR-0012](../../decisions/0012-pre-rendered-retro-art-direction.md)
- [End-to-end scenario with positive controls](../best-practices/end-to-end-scenario-with-positive-controls-2026-09-28.md)
