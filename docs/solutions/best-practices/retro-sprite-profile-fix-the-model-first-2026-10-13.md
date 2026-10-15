---
title: A retro sprite that regresses is fixed in its model profile, not the post step
date: 2026-10-13
category: best-practices
module: assets
problem_type: design_pattern
component: tooling
severity: medium
applies_when:
  - A rendered retro sprite looks worse than the accepted probe while the post step is unchanged
  - Changing body proportions, materials or garments in a profile under tools/render/profiles
tags: [retro-render, render-profile, blender, toon-shading, skin-through-cloth, zeus-retro]
---

# A retro sprite that regresses is fixed in its model profile, not the post step

## Context

A model profile (`tools/render/profiles/<id>.json`) defines each retro sprite. The sprite is built and posed by `tools/render/blender/render.py`. The TypeScript post step (`packages/assets/src/render/post.ts`) is shared by every sprite, and parity tests pin it to the probe it came from. The first studio render of retro Zeus looked worse than the accepted probe: the lower face was noisy and one foot hid the other. Every fault traced back to the profile.

## Guidance

- **Diagnose before tuning.** Diff the profile against the accepted probe. When the post step is unchanged and its parity tests pass, the defect is in the model. Changing bands or the downscale would only trade one artefact for another.
- **A proportion change shrinks the head.** Standing height is fitted to a fixed pixel count, so longer or thicker legs leave a smaller head. After any proportion change, measure eye spacing on the rendered frame. Zeus uses `body.headScale` 1.75.
- **Give small detail its own mesh and tones.** A kit beard rendered with all five toon bands turns into noise on a face only a few pixels wide. Build hair and beard as dedicated masses (`beard`, `hair` in the profile), and give them two or three tones through `materials.<role>.bandShades`.
- **Separate materials by value, not only by hue.** When the hair, the beard, the neckline and the cloak's highlights share one light range, they read as a single shape. Cap each material's shades so the large masses differ in value.
- **Pin skin-through-cloth in a test.** The `profile.test.ts` test "covers the arm…" fails if a mantle row's fold trough comes within the hand's reach.
- **Scope criteria by facing.** "Two lower legs visible" can't hold for a seated figure seen from behind. Scope it to the facings where it can hold, so the review doesn't fail that view (see the preregistration doc under Related).

## Why This Matters

Every rule above can be checked in the profile or in the rendered frames. Tuning the shared post step to hide a model defect changes every sprite and leaves the defect in place.

## When to Apply

- Any new retro profile, including the other gods.
- Any proportion, material or garment change to an existing profile.
- A regression against an accepted probe while the post step is unchanged.

## Related

- [Preregister art verdict criteria](../workflow-issues/preregister-art-verdict-criteria-2026-10-12.md)
- [Promoting a god's sprite](../integration-issues/promote-sprite-keep-legacy-ids-2026-10-13.md)
- `tools/render/README.md` (profile fields, seated garment and pose policy)
- ADR-0012, dated notes (no props on characters; the retro Zeus matrix)
