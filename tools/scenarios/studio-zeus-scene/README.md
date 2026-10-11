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
