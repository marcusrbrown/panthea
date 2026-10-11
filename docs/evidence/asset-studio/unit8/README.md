# Game canon art: packaged evidence

**Scope: the packaged release `panthea-desktop.app`, one sitting on one host, WebGL2.** This shows canon idle-south in the live packaged world and the packaged inspection fixture's readback checks: 85 passed, 0 failed. It is not a quality or art verdict, and it says nothing about WebGPU, other hosts, device loss in the packaged app, or the scene's visual design (U6). What was not proven is listed at the end.

Plan unit: [packaged game canon art plan](../../../plans/2026-10-10-002-feat-packaged-game-canon-art-plan.md) U7 (it builds on U1–U6). Requirements: R3, R4, R20 (published subset), AE1; product rows U07, U08, X02. Decisions: [ADR-0011](../../../decisions/0011-game-canon-art-loading.md).

## Method

- Host: Apple M1 Pro, 16 GiB, macOS 15.7.9. The packaged window must be in an unlocked, foreground session (a locked or occluded window gets no animation frames), as the scenario README's procedure requires.
- App: the release bundle, `bun run --cwd apps/desktop tauri build --bundles app`, run from `apps/desktop/src-tauri/target/release/bundle/macos/panthea-desktop.app`. `Contents/Resources/registry` and `Contents/Resources/vocabulary.json` were inside it, so the loader's root kind is `bundled`, not the repo paths a debug build reads.
- Data: a fresh, empty app data directory (`PANTHEA_APP_DATA_DIR`, a temporary directory), never a real store. The living world therefore started from genesis and ran for the length of the sitting; the two live captures show tick 8 and tick 52.
- Driving: the window was driven with `osascript`; the app itself was not modified or instrumented. The fixture was reached with Alt+Shift+I, which toggles it.
- Capture: `tools/scenarios/studio-zeus-scene/capture.sh`, which finds the app's window through CoreGraphics' window list and hands its id to `screencapture -l <id> -o`. It captures that window alone, never the desktop, and exits non-zero with no file if there is no window. Captures were taken at 2560×1440.
- Reference digests: `tools/scenarios/studio-zeus-scene/reference-digests.json`, generated from a Node decode of the committed blobs. A webview's own decode is never the reference. See that directory's README for the algorithm.
- The captures predate the CSS-only fix in `a264e81` (report scrolling and button legibility): their file times are 18:30–18:36 and the commit is 18:38. That commit changed `inspect.css`, a test, the capture helper and a README. It changed no check logic, and the packaged window was not sat again after it.

## Readback results

In-app, from the inspection fixture's `Run all checks`, read from the window:

- **85 passed, 0 failed.**
- **Registry root: `bundled`.** **Backend: `webgl2`.** The backend name is the renderer's own report (three's `isWebGLBackend`, through `GpuBackend.name`), observed in the window. Unit 7's studio evidence could only infer WebGL2 from `navigator.gpu` being undefined.

Every canon check asserts that the source is canon, that the atlas hash equals the expected one, that the frame rects are the expected ones, and that the digest of the read-back region equals the committed reference at each zoom: the 1× render target and the canvas at 1×, 2×, 3× and 4×. A placeholder check asserts that the read-back pixels equal the shared placeholder pixels at the same five reads.

| Selection | Source | Checks | Result |
| --- | --- | --- | --- |
| `zeus-sprite` idle/south | canon, atlas `0fe8067f…515e` (revision `be87747b`), 4 frames | 23 | all pass |
| `zeus-portrait` neutral | canon, atlas `171d42aa…eeea` (revision `7cbaf7aa`), 1 frame | 8 | all pass |
| `zeus-portrait` pleased, angry, grieving, scheming, awed | canon, same atlas | 8 each (40) | all pass |
| `zeus-sprite` seated/south | placeholder (`missing-state`), labelled | 6 | all pass |
| `zeus-sprite` act/south | placeholder (`missing-state`), labelled | 6 | all pass |
| Registry root and backend | | 2 | both pass |
| **Total** | | **85** | **85 passed, 0 failed** |

23 + 6 × 8 + 6 + 6 + 2 = 85. The per-selection counts come from the report text in the captures and from the check structure the unit tests pin; the sprite's 23 are 3 (source, atlas, frame rects) plus 4 frames × 5 reads.

Seated and act draw the shared placeholder, labelled in the window as `PLACEHOLDER (missing-state): zeus-sprite seated/south is not published; the shared placeholder is drawn`. Each of their six rows reads "placeholder pixels at 1× target / 1× / 2× / 3× / 4× canvas — equal to the shared placeholder pixels". AE1 holds: seated draws the placeholder, idle-south still draws canon, and nothing raised an error.

## The live world

The packaged game draws actors as sprites resolved by the sprite id each actor carries in its frame.

- `live-olympus-zeus.png`: the Olympus realm, following Zeus in the observer. Zeus draws as the canon `zeus-sprite` idle-south, animated by the manifest's own frame durations; Hera, standing in the same place, draws the shared placeholder because her god profile's sprite id (`placeholder-hera`) is not published.
- `live-mortal.png`: the Mortal realm. Every inhabitant draws the shared placeholder (Zeus is on Olympus). Places, paths and buildings are the U6 pixel-scale meshes, not canon art.

The first Olympus capture showed the "Current location" label overlapping the "Observed realm" heading, which the U6 overlay change had introduced. `f2131cc` moves the label below the heading. The Olympus capture here is a later release build with that fix, taken at tick 311 after about 3.5 minutes and two realm switches. That build also carried a client receipt-pacing fix, which ships separately because the receipt burst it fixes predates this unit.

## Positive controls

The packaged sitting ran no control. Each is a unit test, driven through the real inspector against a software backend whose pixels come from the same Node decode as the references, so the controls prove the check logic and plumbing, not WKWebView's pixels.

| Control | Test | Result |
| --- | --- | --- |
| A frame drawn one pixel off (offsets (1,0), (0,1) and (-1,-1)) | `apps/client/src/inspect/inspector.test.ts` | all 20 pixel checks fail; the source, atlas and frame-rect checks still pass. An off-by-one placeholder fails its pixel comparison too |
| Registry withheld (the registry call fails) | same file | every one of the 71 canon checks fails; the root-kind check fails too |
| A registry that holds none of the ids (an empty index) | same file | every canon check fails (23 of 23 against the sprite's reference) |
| A refused atlas | same file | the placeholder draws, every canon check fails, and the problem is reported |
| A canon frame with no reference digest | same file | fails with "no reference digest", never skipped |
| A committed digest edited | `tools/scenarios/studio-zeus-scene/src/reference.test.ts` | the regeneration test fails and `diffReference` names the edited path. I also edited the real JSON by hand and watched it fail, then restored it |

The same test file also covers the other failure paths that the sitting did not: a root kind of `repo` fails only the root-kind check, and a backend other than `webgl2` fails only the backend check.

## Bundle contents

`Contents/Resources` of the release bundle, listed from a bundle built after the sitting (the files are the committed ones; their sizes match the repository's):

| Path | Bytes |
| --- | --- |
| `registry/index.json` | 242 |
| `registry/manifests/7cbaf7aa67a604b70b9c721dd0b31123d984c1e3034f10cba70c84e277c09c2d.json` (`zeus-portrait`) | 13,098 |
| `registry/manifests/be87747b727142391a5b48bfb4101a6618bc229797045b464780270fc93b8286.json` (`zeus-sprite`) | 4,238 |
| `registry/blobs/0fe8067fda22c1704ef491513419c412ec77a1a9ffa05907b593346540ac515e.png` | 1,035 |
| `registry/blobs/171d42aa567ba3e06a36b66a5ea9b16b2525a921d85cfa08cc341417e8a7eeea.png` | 4,737 |
| `vocabulary.json` | 1,217 |
| `icon.icns` | 12,673 |

The registry directory is placed by the `bundle.resources` map form (`registry/`, `vocabulary.json`). The whole bundle is 84 MB, almost all of it the sidecar.

## Images

All are window-only captures, reduced from the 2× Retina backing store to 1024×576 and quantized to a 255-colour palette plus transparent, losslessly recompressed. The text is slightly soft and the pixel art is resampled, so these show what each state looks like, not that it is pixel-exact: the readback checks are the proof of that. The six images total 288,885 bytes.

| File | Bytes | Shows |
| --- | --- | --- |
| `live-olympus-zeus.png` | 44,015 | The live Olympus realm with canon Zeus and placeholder Hera |
| `live-mortal.png` | 54,593 | The live Mortal realm, every inhabitant a placeholder |
| `inspect-zeus-sprite-idle-south-report-1.png` | 51,426 | The fixture on `zeus-sprite` idle/south: four canon frames, "CANON", 23 passed, 0 failed |
| `inspect-portrait-neutral-report.png` | 53,510 | The fixture on `zeus-portrait` neutral: the canon portrait, 8 passed, 0 failed |
| `inspect-placeholder-seated-report.png` | 42,744 | The fixture on seated: the labelled placeholder, 6 passed, 0 failed |
| `inspect-run-all-1-top.png` | 53,689 | The top of the run-all result: registry root `bundled`, backend `webgl2`, 85 passed, 0 failed |

The other five portrait expressions and the act placeholder were captured in the same sitting and read the same way (8 and 6 passed, 0 failed); they are not kept here. The U6 scene captures are added separately.

## What was not proven

- **Real foreground-window compile timing.** The scene presents first and compiles behind it ([ADR-0011](../../../decisions/0011-game-canon-art-loading.md)); how long that compile takes in a foreground packaged window, and how many frames show before it settles, was not measured. The captures show settled frames, and nothing here says how long the first frame after a scene change lacked its materials.
- **Device loss in the packaged app.** Not run. The window has no devtools and the fixture has no loss hook. Recovery (a fresh canvas and renderer rebuilt from cached bytes, with no refetch and no leaked textures or groups across three remounts) is covered by `apps/client/src/renderer/scene.test.ts` against a software backend, not by the packaged app.
- **Seated and strike art.** They do not exist; those states draw placeholders. Publishing them, and the timed owner sitting for the origin's success criterion 1, is queued studio work and not a gate here (owner, 2026-10-10).
- **The inspection captures after `a264e81`.** They predate that CSS-only fix to the report's scrolling and button colour.
- **The positive controls in the packaged app.** They are unit tests only.
- **WebGPU and other hosts.** One host, one sitting, the WebGL2 baseline (ADR-0002). A host where WKWebView exposes WebGPU would fail the backend check by design.
- **The scene's visual design.** U6 owns it. The live captures are U5/U6 as built.
- **An event-driven strike act.** Strike events carry no ability id and no strike art exists, so normal play never selects an act.
- **Startup verify time inside the app.** The 0.31 ms median in ADR-0011 is from a standalone harness over the committed registry, not a timing taken in the app.
- No hosted provider, purchase or publication was involved. The living world ran against a throwaway data directory that was deleted afterwards.
