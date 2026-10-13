# studio-zeus-scene

Reference digests for the packaged game's canon inspection fixture (`apps/client/src/inspect`). They are the independent expectation that the in-app readback checks compare against.

## What is committed

`reference-digests.json`: for every published asset, selection (sprite state and direction, or portrait expression) and frame, the atlas blob hash, the frame rect and one digest per integer zoom (1 to 4).

## How a digest is made

1. Decode the committed atlas blob in Node (`packages/assets/src/studio/png/decode`). A webview's own decode is never the reference.
2. Cut the frame rect out of the decoded RGBA.
3. Composite it over the inspection background (`INSPECT_BACKGROUND`) by the renderer's alpha cutout: alpha of 128 or more keeps the pixel, anything less shows the background. The result is opaque.
4. Enlarge it by nearest repetition to the zoom.
5. Digest the result: FNV-1a over 32 bits, of width and height as little-endian u32 then the RGBA rows, top first, printed as `fnv1a32:<8 hex>`.

Zoom digests are stored, not derived in the app from a 1x buffer, because the app only has digests: at zoom N it digests the region it reads back from the canvas and compares it with the stored value, which also exercises the integer blit. At 1x it additionally digests the region of the render target. The algorithm lives in `apps/client/src/inspect/digest.ts` (no imports, so the browser and this generator run the same code); `fnv1a32` is not cryptographic and is not meant to be.

## Regenerate

    bun run --cwd tools/scenarios scenario:zeus-scene:digests

`src/reference.test.ts` regenerates in memory from the committed blobs and fails if the file differs, so a changed blob or an edited digest cannot go unnoticed. The file is excluded from the formatter so the generator's output is the file byte for byte.

## Capture a window

    tools/scenarios/studio-zeus-scene/capture.sh <out.png> [process-name-or-pid]

Captures the Panthea window and nothing else. It finds the window of the process (default `panthea-desktop`, the name of the debug binary and of the release bundle's executable) through CoreGraphics' window list and hands its id to `screencapture -l <id> -o`. With no such process or window it exits non-zero and writes nothing; it never falls back to the desktop. macOS only.

## Packaged sitting

1. Build the release bundle: `bun run --cwd apps/desktop tauri build --bundles app`. It is `apps/desktop/src-tauri/target/release/bundle/macos/panthea-desktop.app`; `Contents/Resources/registry` and `Contents/Resources/vocabulary.json` must be inside it.
2. Launch it with a throwaway store, never your own: `PANTHEA_APP_DATA_DIR=$(mktemp -d) apps/desktop/src-tauri/target/release/bundle/macos/panthea-desktop.app/Contents/MacOS/panthea-desktop`. Run it in an unlocked, foreground session: a locked or occluded window gets no animation frames.
3. Live world: capture the Mortal realm, then pick Zeus in the observer's roster (Olympus) and capture again.
4. Inspection fixture: press Alt+Shift+I in the window (it toggles back the same way). Choose `zeus-sprite`, state `idle`, direction `south`, and press `Run all checks`, or `Check this selection` for one selection. Capture: the header gives the registry root (`bundled` expected) and the backend (`webgl2` expected), and the report lists every check with its PASS or FAIL and the overall line.
5. Select each of the six portrait expressions and capture it with its report; select `seated` and the strike or act state and capture the labelled placeholders.
6. Quit the app and delete the temporary store directory.

Capture each step with `capture.sh <name>.png`, from another terminal, while the window is showing it.
