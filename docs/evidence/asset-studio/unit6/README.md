# Studio isometric preview: browser evidence

**Scope: browser evidence on the WebGL2 backend. This is not packaged WKWebView proof.** The packaged client, its CSP and the native bridge belong to the Tauri unit. Nothing here approves an asset: the draft sprite below is a rejected draft, shown only because it is a real packed 64×80 sprite.

Plan unit: parent plan Unit 6 (`docs/plans/2026-10-08-002-feat-studio-isometric-preview-plan.md`, U5). Requirements: R16, R17, AE1; product rows U08 and X02.

## Method

- Page: `apps/studio` served by its Vite dev server on `127.0.0.1:1430`, opened as `?check&backend=webgl` for the checks and `?backend=webgl&source=…&zoom=…&animate=0` for the screenshots. `backend=webgl` forces three's `WebGPURenderer` onto its WebGL2 backend; the page logs `[studio] renderer backend: webgl2`, and `window.__studioCheck.backend` reports `webgl2`.
- Browser: headless Chrome 148.0.0.0 on macOS 15.7.9, driven by a command-line browser driver (version 0.38.2). Default device pixel ratio 1. One extra run at device pixel ratio 2.
- Assets, all read through the dev bridge (the bridge validates every manifest and atlas before the page sees them):
  - canon: the committed registry at `content/greek/assets/registry`, holding `zeus-portrait`. Read only.
  - draft: a copy of the owner-run creative pass's studio store, made in a temp directory and pointed at with `PANTHEA_STUDIO_ROOT`. The real store was never opened by the dev server. The sprite under test is `draft-zeus-idle-south-u7-r7`, a packed 64×80 sprite and a **rejected draft (not approved)**.
- Scene (480×270 logical pixels, camera origin −240,−80): a 4×4 ground diamond patch; the subject at tile (2,2); a seated companion at tile (3,1) that asks for the `seated` state the sprite lacks; a placeholder mortal for scale; a placeholder 2×2 structure; and a flat portrait panel at the right. Rendering is 1× into a 480×270 nearest-filtered render target, blitted to a canvas whose backing store is exactly 480×270 × zoom device pixels (CSS size is the backing size over the device pixel ratio).
- Checks run in the page (`?check`) and are judged by pure comparison functions in `apps/studio/src/check/pixels.ts` (unit tested): the page reads back the render target and the canvas, and decodes each atlas PNG independently with the browser's image pipeline.

## Check results

After the last code change, one run at device pixel ratio 1 and one at 2 passed every check; three earlier runs at ratio 1, just before the last layout tweaks, gave the same results. Counts below are per zoom; the render target is 480×270 whatever the zoom, so only the first count changes.

| Check | 2× | 3× | 4× |
| --- | --- | --- | --- |
| Every canvas pixel equals the render-target pixel at its integer-divided position (pixels checked, mismatches) | 518,400, 0 | 1,166,400, 0 | 2,073,600, 0 |
| Canon Zeus portrait panel: each opaque atlas pixel lands, unchanged, at its projected texel (compared, mismatches) | 9,216, 0 | 9,216, 0 | 9,216, 0 |
| Draft idle-south frame 0: each opaque atlas pixel lands at its projected texel (compared, mismatches; 3,801 pixels below the cutout skipped) | 1,319, 0 | 1,319, 0 | 1,319, 0 |
| Whole frame scene equals the composite computed from the decoded atlases (pixels, mismatches) | 129,600, 0 | 129,600, 0 | 129,600, 0 |
| Occlusion, behind by depth: tall sprite in front of a 2×2 placeholder structure (shared pixels all showing the sprite, mismatches) | 109, 0 | 109, 0 | 109, 0 |
| Occlusion, same depth, structure layer before actor layer (as above) | 112, 0 | 112, 0 | 112, 0 |
| Occlusion, same depth, layers swapped so the structure shows (shared pixels all showing the structure, mismatches) | 112, 0 | 112, 0 | 112, 0 |

At device pixel ratio 2 the backing store stayed 960×540, 1440×810 and 1920×1080 (the CSS box halved), and all 21 checks passed. `scene-draft-2x-dpr2.png` is byte-identical to `scene-draft-2x.png`.

The occlusion cases differ from the plan's wording. A sprite's screen y is `16 × depth + 31`, so anything in front by depth sits lower on screen, and a 16 px placeholder structure cannot overlap a taller sprite that is behind it. The reachable overlaps are the tall sprite in front of a structure behind it, and a same-depth tie decided by layer; the checks cover both, with the layers swapped in the third case. The canon registry holds no sprite and no structure asset, so the sprite is the draft and the structure is the placeholder; the depth keys at the overlap are asserted too (for example 240384 against 237056).

## Live reload

With the draft sprite on screen at 2×, a recoloured copy of the packed atlas (red and blue channels swapped, same size, new content hash) was written into the temp store and the draft record repointed at it. The page updated without a reload (a marker set on `window` survived), and `window.__studio.stats()` stayed at 21 sprites and 4 textures. Seven further rewrites, alternating colours, kept the same counts. Because the manifest key is unchanged and the atlas keeps its size, the texture is swapped in place. `live-reload-before-2x.png` and `live-reload-after-2x.png` are the pair.

## Defects the browser run exposed

1. **The canvas was upside down.** The blit sampled the render target with the plane's UVs and showed the scene mirrored vertically, while the render-target readback was upright. Fixed in `apps/studio/src/renderer/gpu.ts` by sampling with `1 − v`. The in-page check "canvas equals render target" pins it, and failed before the fix.
2. **A frame after a scene change drew nothing new.** New sprite materials were compiled lazily, so the first render after a change omitted them: at 2× the portrait and sprite were missing from the render target, and at 3× and 4× the canvas (a second render) disagreed with the render target (a first render). Fixed by an optional `prepare()` on the render backend that awaits `compileAsync` for the scene and the blit, called before each render that follows a scene change, never on animation ticks. `preview.test.ts` pins the order (prepare, then render, after a change and after device-loss recovery; not on ticks or zoom changes; no render if the preview was disposed meanwhile). Before the fix the checks failed at all three zooms; after it, 21 of 21 passed in every run.

No defect was found in the projection, the depth key, the frame UVs, the colour handling or the readback row order.

## Screenshots

All are crops of the page's preview element at device pixel ratio 1 (nothing outside the page). Pixel-art crops are not resampled.

- `portrait-canon-zeus-2x.png`: the canon Zeus portrait panel (source: canon; the canon registry has no sprite, so the subject slots show placeholders).
- `ae1-fallback-draft-4x-crop.png`: AE1. The draft idle-south sprite beside the seated companion, which falls back to the placeholder with no error and no problem listed.
- `occlusion-structure-in-front-4x-crop.png`: the placeholder structure drawn over the subject's legs where the layers are swapped at the same depth.
- `scene-draft-2x.png`, `scene-draft-3x.png`, `scene-draft-4x.png`: the same scene at each integer zoom. With the structure behind the subject, the subject hides it completely.
- `live-reload-before-2x.png`, `live-reload-after-2x.png`: the draft sprite before and after the atlas rewrite.
- `scene-draft-2x-dpr2.png`: the 2× scene at device pixel ratio 2.

## Limits

- Browser only, and only on the WebGL2 backend. The WebGPU backend, WKWebView, the packaged CSP and the native command bridge are not exercised.
- Frame 0 of the idle animation is what the checks compare. Other frames use the same texture and per-frame UVs but are not compared pixel by pixel.
- The draft sprite is a rejected draft and the Zeus idle sprite is not canon; nothing here is an art or approval verdict.
- The temp store copy, the temp directory and the browser session were removed after the run.
