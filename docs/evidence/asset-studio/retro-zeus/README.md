# Retro Zeus (`zeus-retro`): final draft, publication and promotion evidence (plan U10)

**Scope: `zeus-retro`, rendered through the studio CLI with pinned Blender 5.2.2 (build d13f752e3b9c) on one host, then approved at the owner's visual gate, published in the studio app and promoted to Zeus's sprite.** The sections below the measured checks record each step. The packaged game, its inspection fixture and the packaged studio preview were then checked (see Packaged).

## Criteria

`criteria.json` is the owner-approved v2 criteria, byte for byte. SHA-256 `39e7ccf3e02984e806dfdb4fa679882b7d65bb94be6e883dc21a71be3398aeee` (`criteria.sha256`), recorded before the final render.

## What was rendered and how

12 slots (idle, walk, seated × south, east, north, west), 136 frames, 112×96 `god-tall` cells, pivot (56,78), palette `greek-retro`, from the committed `content/greek` and `tools/render/profiles/zeus.json`. Studio config: `contentRoot` is `content/greek`, `render.executable` is the Blender binary, and the studio and registry roots are scratch directories outside the repo.

```sh
studio generate --config <cfg> --id zeus-retro-final --subject zeus --kind sprite \
  --slots '<12 slots>' --palette greek-retro --pivot '{"x":56,"y":78}'
studio conform --config <cfg> --job-id zeus-retro-final-00NN          # NN = 00..11, one per slot
studio set create --config <cfg> --id zeus-retro-set --request-id zeus-retro-final
studio pick --config <cfg> --working-set-id zeus-retro-set --candidate-id zeus-retro-final-00NN
studio pack --config <cfg> --id zeus-retro-draft --working-set-id zeus-retro-set \
  --asset-id zeus-retro --style-tag retro --footprint '{"w":1,"h":1}'
```

All 12 conforms reported `failedChecks: 0`. The draft is `zeus-retro-draft`, state `draft`, method `rendered`.

| Item | Value |
| --- | --- |
| Revision recipe hash | `284c046bb69bd055450e64292a518460f67eb9c17a8ee4fb25232bd65cb67057` |
| Atlas SHA-256 | `fe9fdb0846e8e25042f76ca67ba28650a0cf6141a0c6654e0946e4cb4f5c0cc4` |
| Manifest revision | `f254faa3c1fc6fe0ca2ac2b1f88d9556f9dfdd134b4ad9241f77a5fb37369fa6` |
| Palette digest | `40f059ffae86409cd87d776492fd797f5efc6ad970114810fd97102e83e9c686` (the committed `greek-retro` digest) |
| Post step | version 3 (no prop stamps) |
| Pack report | `pass`: 1122 checks, 1122 pass, 0 fail (per frame: grid, canvas, binary alpha, palette, colour count, pure black/white, pivot, silhouette; plus 34 mirror checks) |

## Measured checks

From the packed draft's atlas cells, which are pixel-identical to the cells of an independent render of the same recipe (136 of 136), and from geometry and the part-ID and depth passes of that render.

| Check | Criterion | Measured | Result |
| --- | --- | --- | --- |
| Standing idle height | 60–64 px, every facing, outline included | 61–64 | pass |
| Walk extent | report only | 59–65 (near-foot perspective) | reported |
| Anchor | sole midpoint at (56,78), every slot | max deviation 0.0 px | pass |
| Grounding, idle | soles level within 0.5 px | 0.25 px | pass |
| Grounding, walk | lowest sole on the ground every frame | gap 0.0 px | pass |
| Grounding, seated | soles on the ground | gap 0.0 px, soles level | pass |
| Edge | no opaque pixel on the cell edge | 0 pixels in 136 frames | pass |
| Margins | report only, below 6 px shown | minimum 11 px; none below 6 | reported |
| Back-view skin through the himation | ≤ 1 px per frame (idle, walk, seated north) | 0.0 px | pass |
| Palette | approved digest, ≤ 48 colours, binary alpha | digest matches; 18 colours; 0 non-binary pixels | pass |
| Walk resample | 8-frame walk equals the 16-frame walk at matching times, 4 facings | 32 of 32 pairs identical | pass |

The resample compares the raw colour, part-ID and depth passes of an 8-frame render (frames 0–7 of the walk, 100 ms) against the 16-frame render at frame 2i. The engine's own check refuses an 8-frame walk (the `god-tall` rule allows 16), so the 8-frame render ran Blender directly on the same recipe with the walk reduced to 8 frames. The post step works on one frame at a time, so identical passes give identical cells; the 8-frame cells themselves were not post-processed.

## Published

The owner approved the full `zeus-retro` revision at the visual gate and published it in the studio app. The published revision is the draft's: manifest `f254faa3c1fc6fe0ca2ac2b1f88d9556f9dfdd134b4ad9241f77a5fb37369fa6` and atlas `fe9fdb0846e8e25042f76ca67ba28650a0cf6141a0c6654e0946e4cb4f5c0cc4`, now in `content/greek/assets/registry` (the index lists `zeus-retro` beside the unchanged `zeus-portrait` and `zeus-sprite`). Checked headless afterwards:

- the blob's SHA-256 equals the draft's atlas hash, and the manifest's atlas, cell (112×96), pivot (56,78), 12 animations and `rendered` provenance (12 slot records, one revision recipe hash) are the draft's;
- publish refuses unless the rendered audit passes (it recomputes the post step from the stored raw frames and every pinned input offline), so a revision in the registry has passed it;
- `bun run --cwd tools/content validate:assets` passes: the completeness rule holds for all 12 required slots, and a test that removes a slot fails (positive control).

## Promoted

`content/greek/gods/zeus.json` now names `zeus-retro` as Zeus's `sprite`. `zeus-sprite` stays published and unchanged, and Zeus's subject lists it under `legacySprites`, so it remains resolvable and its thunderbolt animation stays valid for actors created before promotion. The promotion commit edits Zeus's god profile and simulation goldens, so the owner's approval of that commit is the core-lane agreement (origin R24). Inspection digests (`tools/scenarios/studio-zeus-scene/reference-digests.json`) were regenerated: 3 assets, 153 frames × 4 zooms, of which `zeus-retro` is 12 selections and 136 frames, walk and all four facings included. A 16-frame 112×96 clip fits the 576×432 inspection target.

## Packaged

Release bundles built from this tree (`bun run --cwd apps/desktop tauri build --bundles app`; the studio app after `apps/studio/scripts/build-sidecar.sh`), one sitting on one host, WebGL2. Window-only captures are in [packaged/](packaged/).

- Game, fresh app data directory: retro Zeus draws idle-south on Olympus ([game-live-olympus-zeus.png](packaged/game-live-olympus-zeus.png)).
- Game inspection fixture, "Run all checks": registry root `bundled`, backend `webgl2`, **842 passed, 0 failed**. That covers 828 canon readback checks (every `zeus-retro`, `zeus-sprite` and portrait frame at zoom 1–4) plus 14 non-canon checks ([game-inspect-run-all.png](packaged/game-inspect-run-all.png), [game-inspect-zeus-retro-walk-2x.png](packaged/game-inspect-zeus-retro-walk-2x.png)).
- Studio preview of the published record: idle south at 1×, 2× and 3×, walk south playing and seated east, with the controls below the canvas (`packaged/studio-*.png`).

## The makeover rounds, in brief

r6–r10 are calibration evidence, not acceptance evidence. r6: the first retro Zeus (himation, planted idle, per-state timing, bolt removed). r7: purpose-built beard, seated garment, value separation, tempered walk. r8: styled hair and fillet, hanging beard, seated cloak, idle breath. r9–r10: faceted crown, skin-through-cloak fix measured by a part-ID and depth probe, fillet restored. The owner accepted r10 as the look.

## Review and visual gate

- Cross-family review of all 136 frames: every judged criterion passes except seated/north. From behind, the cloak hides the lower legs and feet.
- Owner visual gate (2026-10-13, timed playback at 1x and 3x): revision approved. Seated/north is accepted as is, because a seated figure seen from behind cannot show its lower legs.

## Not verified
- Skin-through-cloth is measured by a probe that cannot tell a hand resting on the cloth from one poking through. Front and side frames with an arm over the cloak (0.75–3.1 px by the probe) were checked by eye on a few frames only.
- The 8-frame resample compares raw passes, not post-processed cells.
- The live game drives idle only; walk, seated and the other facings are proven through the inspection fixture.
- One host, one Blender build. The animated preview page was syntax-checked but not opened in a browser.
