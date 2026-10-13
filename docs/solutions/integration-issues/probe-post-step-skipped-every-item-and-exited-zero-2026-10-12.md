---
title: A probe post step read another tag, skipped every item and still exited 0
date: 2026-10-12
category: integration-issues
module: workspace
problem_type: integration_issue
component: tooling
symptoms:
  - "The documented render wrote scratch/render while the post step read scratch/render-r2, found no input for any item and exited 0"
  - "No cells or report were written, and running the README's documented sequence raised no error"
root_cause: config_error
resolution_type: code_fix
severity: medium
tags: [probe-pipeline, readme-verbatim, exit-status, path-handoff, tag-default, silent-skip]
---

# A probe post step read another tag, skipped every item and still exited 0

## Problem

In the first revision of #214, the retro-render README's render loop wrote to the untagged `scratch/render`. The post step defaulted to `--tag r2` and read `scratch/render-r2`. It skipped every item and exited 0, so the documented sequence produced nothing. The render step and the post step each built their directories from their own default.

## Solution

- **One path rule.** Every CLI builds its directories through `tools/probes/retro-render/retro_paths.py`:
  ```python
  def render_dir(scratch: Path, tag: str) -> Path:
      return Path(scratch) / f"render{suffix(tag)}"
  ```
  `DEFAULT_TAG` is `r3`, and `DEFAULT_ITEMS` is `retro_plan.ITEMS`, in render order.
- **Fail on empty input.** `postprocess_retro.py` exits 1 before doing any work when a requested item has no render, or has a render but no frames for the requested variants. `build_report.py` and `check_resample.py` also exit 1 when their inputs are missing.
- **Test the handoff.** `test_handoff.py` has 18 tests in four groups:
  - a wrong tag exits 1 and writes nothing;
  - each missing item exits 1;
  - the report and resample steps read the same tag;
  - the README's current-round block passes `--tag "$TAG"` to all four steps, and its literal item list equals `DEFAULT_ITEMS`.

## Prevention

- A step that reads a directory exits non-zero when it finds zero inputs.
- Run a probe README's documented sequence as written, in a clean shell, before relying on it.
- `DEFAULT_TAG` is a per-round constant. `test_handoff.py` checks it against the README's `TAG` default, so bump both together.

## Related Issues

- #214, `tools/probes/retro-render/README.md` (Commands)
- [Sidecar launch token EPIPE masked an early exit](../test-failures/sidecar-launch-token-epipe-masked-early-exit-2026-10-02.md): another failure that exited as success
