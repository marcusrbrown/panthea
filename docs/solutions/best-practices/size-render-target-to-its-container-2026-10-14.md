---
title: Size a fixed render target against its container, and check device pixel ratio 2
date: 2026-10-14
category: best-practices
module: client-view
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - "Changing LOGICAL_SIZE or the scene layout in apps/client/src/renderer/layout.ts"
  - "Adding art whose cells change the scene's extents"
  - "Changing the rails, topbar or footer that surround the scene"
tags: [canvas, integer-zoom, device-pixels, layout, stylesheet, client-view]
---

# Size a fixed render target against its container, and check device pixel ratio 2

## Context

The client draws the scene into a fixed logical target, `LOGICAL_SIZE` (576×384) in `apps/client/src/renderer/layout.ts`, and `fitView` enlarges it by a whole zoom in device pixels. The canvas lives in the scene area: the window minus the side rails, the topbar and the footer, which is 714×635 at the default 1280×720 window. Layout and camera are in ADR-0011.

## Guidance

1. **Size the target against the container, not the window.** A target checked against 1280×720 can pass while it overflows the 714×635 scene area.
2. **Check device pixel ratio 2 as well as 1.** `fitView` takes the largest whole zoom that fits, floored at 1:

   ```ts
   const zoom = Math.max(
     1,
     Math.floor(
       Math.min(
         deviceWidth / LOGICAL_SIZE.width,
         deviceHeight / LOGICAL_SIZE.height,
       ),
     ),
   );
   ```

   At DPR 2 the scene area is 1428×1270 device pixels. A target wider than 714 or taller than 635 CSS px gets zoom 1 there and draws at half its intended size. At DPR 1 the same target crops.
3. **Read the container from the stylesheet in the test.** `layout.test.ts` derives the scene area from `surface.css` (the `.workspace` rail widths, the `.topbar` height and the `.bottomline` minimum height) and asserts zoom 1 uncropped at DPR 1 and zoom 2 at DPR 2. It fails once the rails or bars leave less than `LOGICAL_SIZE`.

## Why This Matters

On a high-density display an oversized target does not crop; it draws smaller. That is easy to miss by eye and invisible to a test that measures the window.
