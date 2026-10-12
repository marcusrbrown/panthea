# Derivation and repair: evidence

**Scope: derivation from a published revision (mirror, palette swap, idle bob), the `derive` op through pack and publish, realm variants, and a masked-edit repair route, shown by in-process session tests and by the packaged `panthea-studio.app` on one host.** It is not an art or quality verdict. It does not show a derived asset in the packaged game, and no repair job has run on a GPU. What was not verified is listed at the end.

Plan unit: [derivation and repair plan](../../../plans/2026-10-11-001-feat-studio-derivation-repair-plan.md) U9 (parent: [foundation plan](../../../plans/2026-10-03-001-feat-asset-studio-foundation-plan.md) Unit 9). Requirements: R2, R13 (partial), R14 (partial), R15, R20 (partial), AE4; product rows U06 and U07.

## What is claimed, and where it is shown

| Claim | Shown by |
| --- | --- |
| A real in-process derive → pack → approve → publish on a symmetric fixture, into an isolated registry | `packages/assets/src/studio/derivation.test.ts`, "a mirrored west packs, approves and publishes with steps[], and deriving again returns the same working set" |
| Running a derivation twice gives identical bytes (AE4) | `derive.golden.test.ts` (committed PNG and result hashes, byte-identical on a second run; a symmetric figure mirrors to its own bytes) and the first test above |
| Recipe-only regeneration is byte-identical (R15) | `derivation.test.ts`, "R15: with the derived blobs deleted, every step regenerates from the manifest and its published source to the same bytes" |
| A mirror of Zeus is refused, naming the declared feature | `derivation.test.ts`, "a mirror of Zeus is refused: the subject declares a bolt hand", the CLI, and the window (below) |
| A mirror approved before a subject declared an asymmetry is refused at the next publish | `derivation.test.ts`, "a mirror approved before the subject declared an asymmetry is refused at publish, naming the step" |
| A realm variant is regenerated from the new source atlas on a later revision, and a tampered variant is refused | `derivation.test.ts`, "a palette swap becomes a realm variant with its own atlas in the registry; a later revision regenerates it from the new atlas" and "a tampered variant atlas is refused at publish, whether forged to match its hash or overwritten" |
| A derived slot that fails conformance blocks plain approve; a hand-edited derived slot becomes a hand step | `derivation.test.ts` (two cases of those names) |
| A set that mixes a derived slot with a generated one is refused at pack | `derivation.test.ts` |
| Pack writes the subject's declared asymmetry, and does not carry the prior revision's | `derivation.test.ts` |
| Canon is untouched: the three published `zeus-sprite` manifests and the portrait still parse byte for byte, and `validate:assets` passes | `packages/contracts/src/assets-manifest.test.ts`, `tools/content` `validate:assets` |

Every publish in these tests goes into a temporary registry root. None of them touches the committed registry.

## Derivation on the canon idle cell

The bob recipe was run first against the published `zeus-sprite` idle/south cell (four frames at 333, 167, 333 and 167 ms) with conformance at report-only (`derive.test.ts`, "bob on the canon zeus-sprite idle cell"). Parameters: a shifted region of 39 × 16 pixels at (25, 30), one excluded box of 26 × 37 at (38, 43), `dy` of 0, 0, −1, 0, and the seam rule `fill-from-fixed`.

- **A pure translation plus the seam rule passes.** The sprite conformance report passes on all four frames, silhouette included, so no repair list is needed for conformance.
- **It differs from the accepted canon only where the art-edit probe recoloured by hand.** Frame 0 matches exactly. Frame 1 differs at (29, 46) and (26, 49); frame 2 at (25, 39), (25, 40), (25, 45), (29, 46) and (26, 49); frame 3 at (28, 47). Conformance cannot see these.
- **With the recorded repair list the recipe reproduces the canon idle pixel for pixel** (eight recolours over frames 1 to 3) and still passes conformance. The repair list is part of the step's recorded parameters, so it is reproducible.
- **Limits:** the idle bounds come from the vocabulary (four frames of 166 to 334 ms, a 1000 ms loop). Mirror is allowed only for idle, seated, hurt and down; walk and act, and bob on anything but idle, are refused as `non-derivable`.

## Masked repair on a published frame

A frame that cannot be derived (a walk or act pose, or a west cell of a subject with a declared asymmetry) is redrawn through a masked edit whose base is one frame of a published revision.

- The frame is read from the registry in Node, never by the webview, and must match a recorded hash. A wrong hash, a missing revision, a missing slot and a missing frame are each refused with a named reason (`packages/assets/src/studio/repair.test.ts`; the flags and refusals on the command line in `tools/studio/src/repair.test.ts`).
- The generation records the base frame ref with the mask, strength and cue. Pack requires the base to be a frame of the revision now published for that asset, lists it in `sourceAssets` and carries its licences.
- The output is an ordinary generated candidate in its own working set. It packs on its own, approves and publishes like drawn art, and is refused when mixed with a derived slot (`repair.test.ts`).
- Mask and base files stay on the command line (`tools/studio/README.md`, "Repair"); the app does not take them.

## Reference conditioning: NO-GO

The probe of reference-conditioned facing and pose on the pinned runtime came back NO-GO ([`tools/probes/art-reference/README.md`](../../../../tools/probes/art-reference/README.md), "Verdict"): facing failed with one or two references, and the seated pose missed its preregistered ceiling (0.404 against 0.40). Reference conditioning is therefore not wired. A request that asks for it (`generate --reference`) returns `unavailable`, naming that README, before the writer lock is taken (`tools/studio/src/repair.test.ts`). R14's generated route is partial.

## Packaged studio window

The packaged `panthea-studio.app` (release bundle, built from the tree this unit sits on, with its own bundled sidecar) was run on an Apple M1 Pro, macOS 15.7.9, against a scratch store. No image runtime and no Aseprite was configured or started.

- **Store.** A copy of the committed content in which one god is made a symmetric fixture subject (a sprite id of its own, no declared asymmetry); a copy of the canon registry; and, published into that copy only, a four-frame idle/east and idle/south for the fixture sprite and an idle/east added to the canon Zeus cells. The figures are painted fixtures in the real palette, not art. The licence records of the fixture engine were assessed in the scratch store only. The app's settings file was pointed at the scratch config for the sitting and restored afterwards (byte for byte).
- **Driving.** The window was driven with the macOS accessibility API (press a named button, focus a named field and type, choose a menu item); the app was not modified or instrumented.
- **Capture.** `tools/scenarios/studio-zeus-scene/capture.sh`, which hands one window id to `screencapture -l` and never captures the desktop. The captures are 2× backing-store images reduced to 1× and cropped to the area that shows the state; none is edited.
- **After the sitting** no studio, sidecar, image-server or Aseprite process remained.

| File | Shows |
| --- | --- |
| `derive-panel-mirror.png` | The Derive panel on the published fixture sprite with "Mirror idle/east to idle/west" selected |
| `derived-draft-side-by-side.png` | The draft packed from that derivation (the report is `pass`), with the published source (idle, east) beside the derived draft (idle, west) |
| `zeus-mirror-refused.png` | The same action on the Zeus record: the message reads `the subject declares an asymmetry ("bolt hand"), so west is drawn, not mirrored` |
| `palette-swap-choice.png` | "Palette swap to underworld" selected on the fixture sprite |
| `palette-swap-derived.png` | The result of that Derive: `Derived underworld into working set …. Pack it to review the result.` |

Image sizes (bytes): `derive-panel-mirror` 45,245; `derived-draft-side-by-side` 62,264; `zeus-mirror-refused` 60,276; `palette-swap-choice` 50,090; `palette-swap-derived` 60,826. Total 278,701.

What the window showed that the tests do not say:

- The Derive panel offers mirror only for an east slot with no west, bob only for idle, and a palette swap to each realm but the asset's own. It was seen with a fixture sprite and a Zeus record.
- A refusal appears in the page's notice strip at the top of the window, not beside the Derive button. After pressing Derive on a record low in the page the owner has to scroll up to read it.
- The preview scene is small. The east-to-west flip of the fixture figure cannot be read at that size; the flip is proven by the byte-level tests above, not by the screenshot.
- Before a derived working set is packed, "Open editor" is disabled ("Pick a candidate before opening this set in the editor") because a derived slot is neither a pick nor an authored frame.

## Not verified

- **No real repair job ran on a GPU.** The masked-edit route is covered by session, command and pack tests and a fake runtime. No `init_image` request was sent to a real server, and no repair candidate was generated or reviewed.
- **The derive-to-publish path was not run through the packaged game.** In the packaged studio only Derive and Pack were driven (and a Zeus refusal). Approve and publish of a derived draft, realm-variant publishing and the recompute at publish were exercised by in-process session tests only, into a temporary registry. Nothing was published to the real registry.
- **Reference conditioning has no studio wiring** (NO-GO).
- **R13 is partial:** damage and fire overlays move to Unit 10. **R20 is partial:** Zeus's north, east and west idle art is deferred, because the bolt hand blocks mirroring.
- **PNG bytes depend on the local zlib.** The goldens pin them on this host; `ENCODER_IDENTITY` is where a changed encoder is recorded.
- **One host, one sitting.** Nothing here speaks to WebGPU, another operating system or another display.
