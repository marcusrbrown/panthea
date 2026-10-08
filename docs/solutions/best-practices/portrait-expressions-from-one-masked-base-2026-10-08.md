---
title: Consistent portrait expressions from one masked base
date: 2026-10-08
category: best-practices
module: assets
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - "Making a six-expression portrait set that must keep one head, hairline and identity"
  - "Independent generations drift in the eyes or the face"
  - "Cleaning up generated portraits without changing an expression"
tags: [portraits, masked-img2img, z-image, expressions, pixel-cleanup, provenance]
---

# Consistent portrait expressions from one masked base

## Context

The art guide asks for six expressions with the same head position and hairline, where only the eyes, brows, mouth and one secondary cue change. Generating each expression independently gave different eyes in every frame, and they looked inhuman from the second frame on. Hand-pixelled mouths, a FLUX.2 Klein reference edit, and two cleanups that pasted in new mouths were all rejected. The owner accepted only expressions made by editing a single neutral base.

## Guidance

1. **Generate one neutral portrait and use it as the identity anchor.** For Zeus: job `zeus-portrait-neutral-u7-r3-0001`, seed 20261019, 768×768.
2. **Make each expression a masked img2img edit of that base.** Use Z-Image Turbo at strength 0.6, with CFG 7 and distilled guidance 1, the studio's edit profile. Use one combined binary mask over the brows and eyelids plus the mouth and beard front. The iris, pupil and hairline stay outside it (mask `3ef08513…`).
3. **Give each expression one strong cue.** For example, angry is "furious scowl, brows drawn hard down"; awed is "astonished, brows high, mouth slightly open", which avoids the round "O" mouth.
4. **Pick seeds per slot.** A portrait working set can take a pick from another request's slot and keep its true source. The accepted seeds were 20261010 for angry, 20261011 for grieving, 20261012 for pleased and scheming, and 20261013 for awed.
5. **Clean up with rules only.** Remove isolated noise, stray flecks and doubled outline pixels. Write a per-pixel change list, and allow zero changes inside the eye rectangles and on mouth lines. Never paint, paste or restore a feature.

```yaml
portrait_edit:
  base_job: zeus-portrait-neutral-u7-r3-0001
  strength: 0.6
  txt_cfg: 7
  distilled_guidance: 1
  mask: brows+eyelids + mouth/beard-front, iris/pupil/hairline excluded
cleanup:
  allowed: [isolated-noise, beard-zone-flecks, doubled-outline]
  forbidden: [eye-rect changes, mouth-line changes, new or pasted features]
```

## Why This Matters

Every frame shares the base's pixels outside the mask, so the eyes and head can't drift. The edit changes only the region that carries the expression. A light cleanup with a guard against touching features keeps what the owner approved. The two cleanups that drew mouths are what turned accepted drafts into rejected ones.

## When to Apply

- Any multi-expression portrait set.
- Any cleanup of generated faces. The cream lip and beard highlights in these frames belong to the expression, not to the noise.

## Examples

- **Settings that failed:** strength 0.75 made awed comical; a brows-only mask left the expressions unreadable at 1×.
- **The Zeus set:** cleanup `…-scripted-fleck-noise-cleanup-u7-r10c` changed 396 pixels across six frames, none in the eye rectangles or on mouth lines. It was published as `zeus-portrait`, manifest `7cbaf7aa…` (`docs/evidence/asset-studio/unit5/README.md`).
- **Script:** `tools/probes/art-edit/portrait_cleanup_r10.py`, with its tests and an explicit list of exceptions.

## Related

- [sd-cli --guidance is not the server's CFG scale](../integration-issues/sdcpp-cli-guidance-is-not-server-cfg-2026-10-08.md): why edits sample at CFG 7.
- [Generated art needs an independent reviewer](../workflow-issues/generated-art-independent-review-roles-2026-10-08.md).
- [Saved pixel previews scaled size but not offset](../logic-errors/saved-pixel-previews-scaled-size-but-not-offset-2026-10-05.md): checks pixels with feature guards; visual review stays a separate step.
- `tools/probes/art-edit/README.md`: rounds 1, 2 and 10.
