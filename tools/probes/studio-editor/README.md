# studio-editor: the external edit seam against an installed Aseprite

## Question

Does the studio's edit workspace (`packages/assets/src/studio/aseprite.ts`, `edit-session.ts`, `export-import.ts`) round-trip frames, tags, optional pivots, integer-millisecond durations, palette and cell geometry through an installed Aseprite, and does a real hand edit made inside the editor reach the working set exactly while an unedited export does not?

Status: one real run on one host. Fixtures only: no generated art, no canon, no screenshots, no UI.

## Method

- Host: macOS 24.6 arm64, Bun 1.4.2, Aseprite 1.3.18.6-arm64 in `/Applications/Aseprite.app`, batch mode on a logged-in GUI host. This is not a window-server-free run.
- API facts were fixed first with standalone controls (`.context/studio-pipeline/u4-aseprite-controls/`, untracked).
- SDK controls drive `createEditorAdapter` against the real editor through `session.openEdit`, `importEdit` and `finishEdit`. The edit itself is a trusted batch script (`image:drawPixel`, then `saveAs` on the same workspace) that changes one pixel of one frame. The runs are untracked: `.context/studio-pipeline/u4-sdk-edited-roundtrip-fixed/run.ts` writes `results.json`, `commands.jsonl` and the before and after workspaces and sheets. The "installed editor" block of `aseprite.test.ts` repeats the same controls and skips when no editor is found.
- Editor runs use argv only (no shell), an environment of `HOME` alone, scratch space outside the authoring root and a timeout; a run is only ever signalled by its own pid and awaited.
- The workspace is built by `scripts/export.lua` from the Sprite, Image, Palette and Slice APIs only. Export is `--batch <workspace> --sheet-type horizontal --format json-array --list-tags --list-slices --sheet <png> --data <json>`: no trim, crop, padding, packing, merge or empty-frame flags.

## API facts used (verified on this build)

- `Frame.duration` is in seconds in Lua (0.123 reads back as 0.123 and exports as 123); 123 would clamp to 65.535 s. The adapter divides milliseconds by 1000 and the studio keeps whole milliseconds.
- `Tag.repeats = 0` exports with no `repeat` key; `1` exports `"repeat": "1"`. Import accepts an absent key, `"0"` and `"1"` and refuses reverse or ping-pong playback.
- A slice's `pivot` is relative to the slice's own bounds and is absent when never assigned. Import adds the bounds origin before checking the inclusive range `0..cell.w`, `0..cell.h`, so bounds `{10,10,54,70}` with pivot `{22,70}` is the cell position 32,80. `center` is the nine-slice rectangle and is never read as a pivot.
- Lua can only create a slice key at frame 0, so the studio keeps one pivot per slot as a single `pivot:<slot>` slice. Per-frame pivots are not claimed.
- Palette: the slot's family colours are written to a scratch GPL and loaded with `Palette{ fromFile }` in file order.

## What counts as an edit

Finishing an edit, and importing a changed preview, compare the sheet as frames, not as bytes: each frame's pixels (the RGB under a fully transparent pixel compares as zero; the stored bytes are never rewritten), its duration, the frame count and order, and each slot's pivot. The same pixels re-encoded by the editor, or a change to hidden RGB only, are not an edit and finish nothing. A changed pixel, duration, pivot or frame count is an edit. Importing the starting sheet again after a preview clears the preview.

## Results (2026-10-06)

| Control | Result |
| --- | --- |
| Idle: build 4 frames at 64x80 with durations 123/167/250/333 ms, pivot 32,80, tag `idle/south` 1-4 | the editor reads back exactly these; the exported sheet is 256x80, untrimmed, and matches the fixture's visible pixels and alpha |
| Idle: unedited export through `refresh(import)` and `refresh(finish)` | import reports no change, finish is refused, and the ledger, hand steps and working set are unchanged |
| Idle: one pixel of frame 2 changed inside the editor, 118,87,47 to 255,0,255 | exactly one sheet pixel differs (84,20); durations, tags, pivots and geometry are unchanged; the stored sheet blob equals the editor's exported PNG bytes, each frame crop equals the editor output, and finish adds exactly one `hand edit` step after the earlier one |
| Portrait: build 6 expressions at 96x96, one tag each, no pivot | built and exported; the unedited export is refused |
| Portrait: one pixel of the fourth expression changed inside the editor | exactly one sheet pixel differs (318,30); finish completes the set with one `hand edit` step on each of the six slots; the five other expressions are unchanged pixels |
| Off-palette pixel | the frame's conformance report fails and import accepts it; the proposal is a separate blob and the stored hand pixel is untouched |
| Originals | the raw candidate input, the selected keyframe blobs, the candidate records and the picks are byte-identical before and after |
| Hidden RGB under transparent pixels | kept through this build's workspace, edit and export. The studio does not rely on it |
| Missing editor | a clear message pointing at `edits/<id>/sheet.png` and `sheet.json`; the same import path takes hand-exported files |

Timing is a diagnostic only. A frame's duration is recorded against the vocabulary's bounds (floor of 1000 over the fastest rate, ceil of 1000 over the slowest: 166 to 167 ms for idle) and a frame outside them is a warning, never a refusal. The 167 ms idle placeholder and the 100 ms placeholder elsewhere are editable placeholders, not owner defaults. The manifest frame-rate gate is U5.

## Limitations

- One host and one Aseprite build. No Linux or Windows editor run and no window-server-free run.
- One pixel of one frame per sheet was edited in the editor; no other editor tool, layer, tile or animation feature was exercised.
- Nothing here assesses canon, art quality, palette compliance of the owner's art, or approval.
