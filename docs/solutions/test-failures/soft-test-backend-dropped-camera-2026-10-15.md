---
title: The soft test backend ignored the camera, so off-centre renders read as game faults
date: 2026-10-15
category: test-failures
module: client-view
problem_type: test_failure
component: testing_framework
symptoms:
  - "A headless render at the game's camera drew one corner of the ground at the top left and every sprite off the canvas"
  - "The inspection fixture, which draws from the origin, rendered correctly through the same backend"
root_cause: incomplete_setup
resolution_type: test_fix
severity: medium
tags: [soft-backend, camera, headless-render, pixel-readback, test-double, client-view]
---

# The soft test backend ignored the camera, so off-centre renders read as game faults

## Problem

`softBackend` in `apps/client/test/soft-backend.ts` accepted the camera in `view()` and never stored it, so it placed sprites at world coordinates as canvas pixels. The GPU backend applies the camera through `cameraBounds` (`packages/renderer/src/view.ts`). Every soft-backend render at the game's off-centre `CAMERA_ORIGIN` was wrong while the game itself was right.

## Symptoms

- The ground showed one corner at the top left of the canvas, and no sprite appeared.
- Inspection renders looked correct, because the inspector draws from camera (0,0).

## What Didn't Work

Reading the broken render as a layout fault in the game. The real backend's `view` and `cameraBounds` placed the scene correctly; only the test double disagreed.

## Solution

The soft backend stores the camera and subtracts it when placing each sprite:

```ts
// apps/client/test/soft-backend.ts
    view(next) {
      zoom = next.zoom;
      camera = { x: next.camera.x, y: next.camera.y };
      painted = undefined;
      views.push({ zoom: next.zoom });
    },
// ...
      const left =
        Math.round(sprite.position.x - camera.x - w / 2) +
        (options.offset?.x ?? 0);
      const top =
        Math.round(-sprite.position.y - camera.y - h / 2) +
        (options.offset?.y ?? 0);
```

`apps/client/src/renderer/view.test.ts` drives `createWorldRenderer` at `CAMERA_ORIGIN` and asserts canvas pixels: the ground diamond lands whole and centred, a building stands on the back half of the ground, and a crowded place shows every actor's own pixels.

## Why This Works

The soft backend now maps world to canvas the way the GPU backend does, and the view test computes its expected pixels from `CAMERA_ORIGIN`, so a backend or renderer that ignores the camera fails on placement.

## Prevention

- A test double must read every field of the contract it implements. A field it accepts and never uses is a bug in every test that relies on it.
- Render at the camera the game uses and assert pixels, not sprite positions. `layout.test.ts` pins `CAMERA_ORIGIN`, so a camera change changes a test on purpose.
- When a headless render looks broken, check it against the real backend's code before changing the game.

## Related Issues

- [Client view presentation against invented fixtures](../logic-errors/client-view-presentation-against-invented-fixtures-2026-09-28.md): the same gap, a test that can't see the bug.
- [Size the render target to its container](../best-practices/size-render-target-to-its-container-2026-10-14.md)
- Fixed in [#241](https://github.com/marcusrbrown/panthea/pull/241).
