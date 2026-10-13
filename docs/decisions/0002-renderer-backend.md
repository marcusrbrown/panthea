# 0002: Renderer backend

## Status

Accepted (owner decision, 2026-09-26).

## Context

D19 fixes Tauri, Three.js, Three Flatland, and a Bun workspace, requesting a WebGPU renderer. The M0 renderer probe in [tools/probes/webgpu-wkwebview](../../tools/probes/webgpu-wkwebview/README.md) found that the macOS 15.7.9 WKWebView (Tauri's macOS renderer) does not expose `navigator.gpu`, even after force-enabling the private `WebGPUEnabled` WebKit feature flag. WebKit gates WebGPU behind macOS 26. This conflicts with the literal reading of P02 ("renders Three Flatland through Three.js/WebGPU on the M1 Pro"), since the M1 Pro baseline runs macOS 15.

## Decision

Keep Three.js `WebGPURenderer` and Three Flatland. Use the WebGL2 backend where `navigator.gpu` is absent (macOS 15 WKWebView, the baseline) and the WebGPU backend where it is present (macOS 26+, and Windows WebView2 where the runtime supports it). Detect backend availability at startup rather than hardcoding a platform check.

Pin `three@0.185.1` (the published `three-flatland@0.1.0-alpha.10` peer range is `^0.185.1`) and `three-flatland@0.1.0-alpha.10`. M0 must verify that Flatland alpha.10 features (layer/zIndex ordering, `AnimatedSprite2D`, tilemaps, TSL effects, hit testing) work correctly on the WebGL2 code path, not only WebGPU, and separately verify WebGPU on Windows WebView2. Linux (WebKitGTK) support is not gated on `navigator.gpu` specifically: under D25, Linux is supported once a packaged-app probe demonstrates a working renderer on either backend, and a working WebGL2 path on WebKitGTK satisfies that gate the same way it does on macOS 15. Linux remains unsupported only until that packaged probe runs.

This amends the literal wording of P02 from "WebGPU on the M1 Pro" to "WebGPU where the webview supports it, WebGL2 otherwise," per D25.

## Consequences

macOS 15 stays the supported baseline without waiting for macOS 26. Every effect and shader must have a working WebGL2 path, which may constrain which TSL/WebGPU-only features Flatland exposes. Version/backend must be recorded per platform in the acceptance report per P02. Windows and Linux support remain conditional pending their own packaged-app probes.

The macOS 15 probe itself ran as an unsigned `swift probe.swift` process, not a signed `.app` bundle. If WebKit's WebGPU gating depends on code-signing/entitlements rather than the feature flag alone, a signed packaged Tauri app could behave differently on macOS 15. Re-run the probe (or its packaged-app equivalent) inside a signed `.app` before treating the macOS 15 WebGL2-only conclusion as final, and re-check `navigator.gpu` availability again after upgrading the test machine to macOS 26. **Kept for history**: the packaged-bundle WebGL2 probe below confirms the WebGL2 fallback path itself; it does not re-test whether signing changes WebGPU's own availability, so that specific open item is still unresolved (see the four re-checks in [m0-exit.md](../product/m0-exit.md)).

**Confirmed by the packaged-bundle probe** ([tools/probes/renderer-webgl2/README.md](../../tools/probes/renderer-webgl2/README.md), ad-hoc-signed `panthea-probe-renderer.app`, M1 Pro, macOS 15.7.9): three-flatland's full primitive set (64×64 `TileMap2D`, 230 sprites with `sortLayer`/`zIndex` isometric ordering, `AnimatedSprite2D`, a `createMaterialEffect` TSL flicker, a hand-rolled `PixelPerfectCamera`) renders correctly on the WebGL2 backend at a stable **~59 fps (17 ms frame p50/p95, n=600)** across a 60 s steady-state run and a 30 s effect-burst run, zero effect failures. Real click-to-visible input latency, driven by 14/14 genuine `cliclick`-driven clicks directly against the packaged binary, measured **p50 = 28 ms / p95 = 31 ms** — comfortably inside the 100 ms provisional target. `three-flatland`'s `koota` (ECS) dependency generates its struct-of-arrays accessors via `new Function(...)` at store-creation time, which Tauri's packaged-bundle CSP blocks by default; **`'unsafe-eval'` in `script-src` is a hard requirement for any Panthea surface that imports `three-flatland`**, carried forward to `apps/client`/`apps/desktop`, conditional on U05 holding (the generated-behavior runtime must stay isolated in the simulation service and never load into the renderer's WKWebView realm).

One real limit was found and is not yet fixed: with `three@0.185.1`'s `WebGPURenderer`, a `WEBGL_lose_context` loss both fires and can be restored at the WebGL level, but the existing renderer instance stays latched (`_isDeviceLost` is set and never cleared; `init()`'s promise memoization means a second call does not re-initialize). Automatic same-instance recovery is unavailable in this build (reported upstream as
[mrdoob/three.js#34682](https://github.com/mrdoob/three.js/issues/34682)). A recovery pattern is documented in the probe README (detach handlers, dispose the old renderer, build a *fresh* canvas and renderer, rebuild the scene from app-retained state, verify a frame actually presented, bound retries, explicit failure UI) but **application-managed renderer/canvas reconstruction has not been tested**, and neither has sleep/wake (`pmset displaysleepnow`) — both are follow-up work, not resolved here. Linux (WebKitGTK) remains gated on its own packaged-app probe, not yet run.

**2026-09-28:** application-managed reconstruction is now implemented in `apps/client` (fresh `SceneHost` canvas and renderer per loss, view rebuilt from the retained store) and was verified in the packaged debug build by forcing a WebGL context loss ([m1-packaged-shell View gate](../../tools/scenarios/m1-packaged-shell/README.md#view-gate)). The verified-frame gate and bounded retries are not implemented, and sleep/wake is still untested. See [the device-loss learning](../solutions/integration-issues/three-webgpurenderer-device-loss-latch-2026-09-27.md).

**2026-09-28, desktop CSP:** the packaged app carries the koota requirement forward. Both [apps/desktop/src-tauri/tauri.conf.json](../../apps/desktop/src-tauri/tauri.conf.json) and [apps/desktop/src-tauri/tauri.dev.conf.json](../../apps/desktop/src-tauri/tauri.dev.conf.json) set `script-src 'self' 'unsafe-eval'`, not `'wasm-unsafe-eval'`, because `three-flatland`'s `koota` dependency builds its accessors with `new Function()` ([the koota CSP learning](../solutions/integration-issues/koota-new-function-tauri-csp-2026-09-27.md)). Owner-approved. The blast radius is bounded: the webview holds no credentials, the production `connect-src` is IPC-only (`ipc: http://ipc.localhost`; the dev config adds loopback and the Vite dev server), and its one capability set relays frame subscription and presentation receipts through the shell ([ADR-0008](0008-world-state-and-client-transport.md)). The exception stays conditional on U05. Revisit if `koota` stops using `new Function()`.

**2026-09-28, probe app removed:** `apps/probe-renderer`, the app behind the packaged-bundle evidence above, was deleted after M0 so the repository has one Tauri app (`apps/desktop`, rendering through `apps/client`). The evidence does not move: method and results stay in [tools/probes/renderer-webgl2/README.md](../../tools/probes/renderer-webgl2/README.md), and the app source is at commit `ce9e5a4` (`git show ce9e5a4:apps/probe-renderer/...`). The remaining Windows and Linux packaged renderer runs (P05) will use the desktop app with a measurement harness rather than a new probe app.

**2026-10-08, isometric ordering:** the probe's "isometric ordering" came from the probe's own placement, not from three-flatland. In alpha.10, `TileMap2D` declares an `isometric` orientation but places tiles on an orthogonal grid, and `Sprite2D.zIndex` sorts only within one batch, so it cannot order sprites across textures. The studio preview therefore owns projection and depth: a depth key written to sprite z, with alpha-cutout depth testing. `apps/studio/src/renderer/iso.test.ts` records the `TileMap2D` behaviour by running it. See [the isometric projection learning](../solutions/best-practices/studio-owned-isometric-projection-depth-2026-10-08.md).

## Evidence/links

[tools/probes/webgpu-wkwebview/README.md](../../tools/probes/webgpu-wkwebview/README.md); [tools/probes/renderer-webgl2/README.md](../../tools/probes/renderer-webgl2/README.md); [stack-2026-09-26.md](../research/stack-2026-09-26.md); [decisions.md D25](../product/decisions.md); [m0-exit.md](../product/m0-exit.md).

## Requirement IDs

P02, P05.
