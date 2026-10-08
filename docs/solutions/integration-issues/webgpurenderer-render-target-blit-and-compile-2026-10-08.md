---
title: WebGPURenderer render-target previews need a flipped blit and compiled materials
date: 2026-10-08
category: integration-issues
module: studio-preview
problem_type: integration_issue
component: tooling
severity: high
symptoms:
  - "The canvas showed the scene upside down while the render-target readback was upright"
  - "The first frame after a scene change omitted newly added sprites"
  - "Renderer tests with fake backends passed while the real WebGL2 checks failed"
root_cause: async_timing
resolution_type: code_fix
tags: [studio, webgpurenderer, webgl2, render-target, compileasync, pixel-exact]
---

# WebGPURenderer render-target previews need a flipped blit and compiled materials

## Problem

The studio preview renders at 1× into a 480×270 render target, then draws that target to the canvas at an integer zoom. Two defects appeared only on a real GPU, in the in-page check mode (`?check&backend=webgl`, headless Chrome 148, three r185 `WebGPURenderer` on its WebGL2 backend). Renderer tests with fake backends had passed throughout.

## Symptoms

- The canvas was mirrored vertically, while the render-target readback was upright.
- The first frame after a scene change was missing its new sprites.
  - At 2×, the portrait and the sprite were absent from the render target.
  - At 3× and 4×, the canvas (from a second render) disagreed with the render target (from the first render).

## What Didn't Work

Only the in-page check that reads both the render target and the canvas found these defects (`apps/studio/src/check/run.ts`).

Before the fix, the blit sampled the target without flipping `v`, and a scene change rendered before new materials compiled.

## Solution

1. **Flip the blit's v coordinate** (`apps/studio/src/renderer/gpu.ts`):

   ```ts
   blitMaterial.colorNode = texture(target.texture, vec2(uv().x, uv().y.oneMinus()));
   ```

2. **Compile before the first render after a scene change.** `RenderBackend` has an optional `prepare()`. The GPU backend awaits `compileAsync` for the scene and for the blit:

   ```ts
   async prepare() {
     if (disposed) return;
     scene.updateMatrixWorld(true);
     renderer.setRenderTarget(target);
     await renderer.compileAsync(scene, camera);
     renderer.setRenderTarget(null);
     await renderer.compileAsync(blitScene, blitCamera);
   },
   ```

   The preview calls it after each scene change and after device-loss recovery, never on animation ticks or zoom changes.

The settings that keep output exact:

- **Render target:** nearest filtering on both min and mag (it defaults to linear), no mipmaps, and `NoColorSpace`.
- **Renderer:** antialias off, `setPixelRatio(1)`, and `outputColorSpace = LinearSRGBColorSpace`.
- **Textures:** `NoColorSpace` and no premultiplied alpha. These override three-flatland's `pixel-art` preset, which sets sRGB.
- **Preview decoding (`apps/studio/src/renderer/browser.ts`):** `createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none", imageOrientation: "flipY" })`.
- **Canvas:** the backing store is exactly logical size × zoom in device pixels, and the CSS size is backing ÷ device pixel ratio.

## Why This Works

The render-target readback and the sampled texture use opposite vertical conventions. Sampling at `1 − v` makes the canvas match the upright target pixel for pixel.

`WebGPURenderer` compiles materials lazily. A render issued before new materials finish compiling skips them. Awaiting `compileAsync` makes the first frame complete.

After both fixes, all 21 checks passed at 2×, 3× and 4×, at device pixel ratio 1 and 2 (`docs/evidence/asset-studio/unit6/README.md`).

## Prevention

- **Keep the in-page checks for any change to the renderer:**
  - every canvas pixel equals its render-target pixel at its integer-divided position (`compareEnlargement` in `apps/studio/src/check/pixels.ts`);
  - opaque atlas pixels land at their projected texels;
  - the whole frame equals a composite built from the decoded atlases;
  - occlusion follows the depth key.
- **`apps/studio/src/renderer/preview.test.ts` pins the order:**
  - `prepare` then `render` after a scene change and after recovery;
  - no extra `prepare` on ticks or zoom changes;
  - no render if the preview is disposed while preparing.
- Treat fake-backend tests as ordering tests only. Any claim about pixels needs a real-backend readback.

## Related

- `docs/solutions/logic-errors/saved-pixel-previews-scaled-size-but-not-offset-2026-10-05.md`: the same integer-division pixel check, applied to saved PNGs.
- `docs/solutions/integration-issues/three-webgpurenderer-device-loss-latch-2026-09-27.md`: the same renderer and backend; recovery uses a fresh canvas and renderer.
- `docs/solutions/integration-issues/wkwebview-webgpu-unavailable-macos-15-2026-09-26.md`: why WebGL2 is the evidence baseline.
