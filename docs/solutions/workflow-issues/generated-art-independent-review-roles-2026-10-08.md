---
title: Generated art needs an independent reviewer from another model family
date: 2026-10-08
category: workflow-issues
module: assets
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - "Generated or edited art is about to be shown to the owner or published"
  - "A cleanup claims it left the eyes, mouth or identity untouched"
  - "Art work is delegated, and the brief also names who will review it"
tags: [art-review, visual-qa, pixel-diff, model-family, delegation, workflow]
---

# Generated art needs an independent reviewer from another model family

## Context

The owner rejected Zeus art twice after it had passed review. The reviewer came from the same model family as the author (both GPT) and passed portraits with inconsistent, inhuman eyes. Later the author, asked to clean up accepted portraits, pasted in new mouths twice. The owner's verdict was that it "adds extra mouths". In both rounds the review, the conformance checks and the orchestrator's inspection all looked fine.

## Guidance

- **Separate the author from the reviewer, and use different model families.** The current roles (owner, 2026-10-08): the author makes pixel cleanups and edits (Claude family), and the reviewer judges them (GPT family). The roles were swapped after the rejections.
- **Review measured pixels, not the author's description.** Every cleanup ships:
  - before and after strips at 1× and 4×;
  - a per-pixel change list;
  - a diff map for each frame;
  - guard rectangles for the eyes and the mouth lines, and the count of changes inside each.
- **The reviewer checks every claim against the stored frames.** In the Zeus cleanup, the review found that a "~40% halo" share was really 26%, that 30 pixels in the mouth region had changed rather than the 3 claimed, and that 4 shading pixels had been changed wrongly. The script was fixed, and the cleanup was redone from the generated frames.
- **The orchestrator re-checks the final diff itself** before the owner sees it, for example by confirming that the revision changed exactly the pixels the reviewer listed.
- **Tell delegates to execute.** Twice, a brief that named the downstream reviewer made the delegate write a dispatch prompt for that reviewer instead of doing the work. State "do this yourself; review is arranged separately".

## Why This Matters

Conformance proves the grid, palette and alpha, not whether the art reads as intended. A reviewer from the author's own model family tends to share the author's blind spots. A claim like "only cleanup" is cheap to make and expensive to discover is false after publication.

## When to Apply

Any generated asset, cleanup, palette snap, repair or hand-finished edit headed for the owner or for canon. Apply it with extra care when the edit touches the face, hands, a signature prop or the silhouette.

## Examples

```yaml
review:
  inputs: [before_1x, before_4x, after_1x, after_4x, per_pixel_changes, diff_maps]
  guards:
    eyes: [[44, 22, 59, 38], [59, 22, 72, 38]]
    mouth_box: [48, 41, 70, 56]
  assertions:
    - changed_eye_pixels == 0
    - changed_mouth_line_pixels == 0
    - no new or pasted features
    - claimed counts equal measured counts
```

The accepted Zeus cleanup, r10c, met every assertion: 396 pixels changed, 0 in the eyes, 0 on mouth lines (`docs/evidence/asset-studio/unit5/README.md`).

## Related

- [Consistent portrait expressions from one masked base](../best-practices/portrait-expressions-from-one-masked-base-2026-10-08.md).
- [End-to-end scenario with positive controls](../best-practices/end-to-end-scenario-with-positive-controls-2026-09-28.md): use an independent check that is able to fail.
- [Saved pixel previews scaled size but not offset](../logic-errors/saved-pixel-previews-scaled-size-but-not-offset-2026-10-05.md): checking pixels is separate from visual review.
