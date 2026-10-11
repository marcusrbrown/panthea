---
title: "Client scene presents first and compiles behind, so a hidden WKWebView still draws"
date: 2026-10-10
module: client-view
problem_type: integration_issue
component: tooling
severity: high
symptoms:
  - "The packaged game's stage stayed blank, showing only the background colour, with no error"
  - "Scene draws were superseded before any of them presented in a hidden or occluded window"
root_cause: async_timing
resolution_type: code_fix
tags: [wkwebview, webgpurenderer, compileasync, animation-frame, blank-frame, client-scene, occlusion, render-order]
---

# Client scene presents first and compiles behind, so a hidden WKWebView still draws

## Problem

The packaged game client waited for `compileAsync` before the first render after each scene change. In a locked or occluded window the compile gets no animation frames, so no frame presents.

## Symptoms

- The stage shows only the clear colour. That colour is `[238, 233, 220]` (`apps/client/src/renderer/decor.ts:60`), which is the same as the page's `--paper: #eee9dc` (`apps/client/src/ui/surface.css:3`). An unrendered canvas looks like an empty scene, not a failure.

## What Didn't Work

Compiling, then rendering. That order comes from [WebGPURenderer render-target previews need a flipped blit and compiled materials](webgpurenderer-render-target-blit-and-compile-2026-10-08.md), and it fixed missing sprites in the studio preview. `compileAsync` yields to the main thread once per object, through animation frames where there is no `scheduler.yield` (WKWebView). A hidden or occluded window gets no animation frames, so the compile cannot finish.

## Solution

Render at once, then compile behind the frame and render again when the compile settles (`apps/client/src/renderer/scene.ts:316-319`):

```ts
    backend.render();
    ready = true;
    signature = frameSignature();
    compileBehind();
```

Only one compile runs at a time, and a scene change during a compile queues exactly one more (`scene.ts:214-235`):

```ts
  function compileBehind(): void {
    if (backend.prepare === undefined) return;
    if (compiling) {
      recompile = true;
      return;
    }
    compiling = true;
    void (async () => {
      do {
        recompile = false;
        try {
          await backend.prepare?.();
        } catch (error) {
          canon.report({ scope: "compile", message: messageOf(error) });
          break;
        }
        if (disposed) break;
        backend.render();
      } while (recompile);
      compiling = false;
    })();
  }
```

## Why This Works

A frame that doesn't depend on animation frames always presents. The follow-up render adds materials still compiling, so the cost is a brief omission in the first frame, not a missing frame. Because compiles never stack, a stream of views costs at most one extra compile.

## Prevention

- Never gate a presented frame on work that yields through `requestAnimationFrame`. Present first, then finish in the background.
- `apps/client/src/renderer/scene.test.ts:352` holds the backend's compile open indefinitely and asserts that the draw still renders, then renders again when the compile settles.
- A clear colour matching the page background hides this failure. Assert that a render happened, or read back pixels.
- **Still open:** the studio preview awaits `backend.prepare()` before `render()` (`apps/studio/src/renderer/preview.ts:248-255`, pinned by `preview.test.ts:943`), so it has the same hazard when its window is hidden.

## Related

- [ADR-0011: Game canon art loading](../../decisions/0011-game-canon-art-loading.md), "The scene presents first and compiles behind"
- [WebGPURenderer render-target previews need a flipped blit and compiled materials](webgpurenderer-render-target-blit-and-compile-2026-10-08.md)
- [three WebGPURenderer device-loss latch](three-webgpurenderer-device-loss-latch-2026-09-27.md)
