---
title: Saved pixel previews scaled sizes but not offsets
date: 2026-10-05
category: logic-errors
module: assets
problem_type: logic_error
component: tooling
severity: medium
symptoms:
  - "Enlarged palette study figures overlapped and were unreadable"
  - "Saved zoom panels did not match integer enlargement of their native crops"
root_cause: logic_error
resolution_type: code_fix
tags: [pixel-art, palette, scaling, nearest-neighbor, png, verification]
---

# Saved pixel previews scaled sizes but not offsets

## Problem

The palette study renderer multiplied block sizes but left their offsets at native scale. Enlarged blocks overlapped, making the review images misleading and unreadable.

## Symptoms

An independent check of the original smaller panels found only 12,257 of 24,576 pixels matching in a 4× panel and 4,137 of 9,216 in a 3× panel. Those observations came from the earlier review; the faulty source and images were not retained in the merged change.

The corrected studies use different native dimensions. Their pixel totals are not a like-for-like comparison with those original panels.

## What Didn't Work

Correct pixel scaling alone did not make the illustrations readable. A subsequent visual review found that separated laurel clusters looked like horns, and the Olympus laurel used the same colour as the skin.

## Solution

Build each illustration once as a native `PixelArt` grid. Draw both the native crop and its enlarged version from that same grid, scaling positions and sizes together.

The [renderer](../../evidence/asset-studio/palette/render.swift) groups adjacent native pixels of the same colour. Each run scales both its offset and its dimensions:

```swift
canvas.fill(x + column * scale, y + row * scale,
            (end - column) * scale, scale, color)
```

The [panel manifest](../../evidence/asset-studio/palette/study-panels.json) records the saved PNG rectangles. The [pixel checker](../../evidence/asset-studio/palette/verify_pixels.py) decodes the saved files and compares each zoom pixel with its native source pixel, using integer division by the scale.

Run from the repository root:

```sh
swift docs/evidence/asset-studio/palette/render.swift
python3 docs/evidence/asset-studio/palette/verify_pixels.py
```

Across town, Olympus and Underworld, each current figure check compares 81,920 pixels (64×80 at 4×), and each portrait check compares 82,944 pixels (96×96 at 3×). All six checks reported zero mismatches. A separate decoder-based review also confirmed the saved enlargements.

For the readability issue, connect the laurel into one band and separate its colour from the skin. Olympus uses `#b38b43` for the band and `#ddbf70` for skin. The checker tests one connected crown component and distinct sampled colours; visual review remains a separate step.

## Why This Works

The native grid is the single geometry source. Scaling the destination offset as well as the run size repeats each native pixel into an integer-sized block without shifting features relative to one another.

Checking the saved PNG catches errors after drawing and encoding, rather than trusting drawing instructions alone. It proves that the checked zoom crops reproduce their native crops. It does not prove character identity, production asset conformance, or correct interpolation in an arbitrary viewer.

## Prevention

- Keep native and enlarged previews derived from one pixel grid.
- Compare saved source and zoom crops, not just their dimensions.
- Use an independent visual review before presenting palette studies. Pixel equality does not establish readability.
- Keep approval scopes separate: palette approval does not approve the illustrations, canon assets, licences or generated outputs.
- When embedding review images in a PR, use pinned raw PNG URLs. Check the response is an image and its bytes match the reviewed artifact; GitHub `blob` URLs can serve HTML instead.

The [evidence README](../../evidence/asset-studio/palette/README.md) records the current rerun commands and non-canon scope. The pixel checker does not validate palette membership; the palette parser and publication gate have separate responsibilities described in [ADR 0009](../../decisions/0009-asset-registry-lifecycle-and-uris.md).

## Related Issues

- [Palette foundation, PR #134](https://github.com/marcusrbrown/panthea/pull/134)
- [Transparent RGB bytes and grid recovery](transparent-rgb-bytes-broke-grid-recovery-2026-10-05.md): decoded-pixel comparison semantics, not preview scaling.
- [Incomplete PNG validation](../integration-issues/incomplete-pngs-pass-hash-and-header-checks-2026-10-04.md): encoded-file integrity, not saved pixel geometry.
