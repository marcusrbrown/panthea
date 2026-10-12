# 0012: Pre-rendered retro art direction

## Status

Accepted (2026-10-12). The owner accepted the direction and the eight decisions below as written. The [art guide](../product/art-guide.md) keeps every rule it states for hand-pixel assets, which become the legacy class; the retro rules are added beside them (dated notes). The published canon and the `greek-master` palette are unchanged. The code changes under Consequences are build-out work and are not part of this decision's PR.

## Context

An owner decision about presentation, with the owner's agreement of 2026-10-12 recorded here, resting on the D23 and D26 delegations. It touches D14 (original pixel art) and the art guide's size, palette, line and animation defaults. Requirements: X02 (primary), W01, U06; U07 and U08 are touched by the registry changes.

- **Hand-pixel canon is expensive per state.** The published Zeus sprite (`zeus-sprite`: idle, seated and one act, south only) took many generate-and-repair rounds per state, and the idle-south sprite was deferred once as a feasibility conflict with R20 before it shipped. Four directions of every state for seven gods, mortals and animals at that rate is not reachable.
- **A scripted 3D route was tried against the hand-pixel bar and failed it.** The Blender probe ([#213](https://github.com/marcusrbrown/panthea/pull/213), `tools/probes/blender-sprite/README.md`) rendered a CC0 rigged humanoid and a Zeus proxy to the 64×80, at-most-16-colour canon grid. It is NO-GO against that bar: idle silhouette-stable change 6.7–24.7% against a 6% limit (canon 3.0%), a corrected repair estimate of 41–46 px per cell against 15, and a bolt that read only through an authored stamp. The mechanics held: deterministic output, about 50 ms per frame, a fixed anchor, overlap outlines, stamp compositing.
- **The owner wants something else.** An agent-directed pipeline with fluid motion, a good range of movement, more detail and chunkier stylised proportions, in the line of Diablo II, Fallout 1/2, Age of Empires II and Dead Cells, with a Chrono Trigger influence. Influence, not copying: [art-guide.md](../product/art-guide.md) and [content-direction.md](../product/content-direction.md) still forbid copying any existing game's sprites, portraits or palettes.
- **A scene probe tested that look** ([#214](https://github.com/marcusrbrown/panthea/pull/214), `tools/probes/retro-render/README.md`): CC0 kit bodies on shared animation clips, a primitive Greek temple, a tree with a wind loop, ground tiles, a mortal, a bull and a tall Zeus, all through one camera, one palette and one post step. After timed playback the owner accepted the direction on 2026-10-12, with a tall Zeus on a 112×96 pose cell and a 16-frame walk over 800 ms.

## Decision

**Size and pivot.** Every asset has one pivot, fixed across every clip and facing, and it is the projected sole midpoint (the art guide's pivot rule stands). Three numbers are tracked separately and never conflated: standing height, maximum action extent (the whole animation plus its stamps and outline) and safety margin (about 6 px from the extent to the cell edge).

- Gods stand 60–64 px (interior plus outline) on a **112×96** pose cell, pivot **(56, 78)**. A god whose measured envelope fits may use 96×96 with pivot (48, 78).
- Mortals stand 40–48 px on 64×64 (the probe's pivot is (32, 58); the measured value is recorded per asset).
- Animals and scenery use measured envelopes, declared in the manifest. The probe's bull is 80×56 at (34, 37).

**Camera.** One calibrated 2:1 orthographic camera (X 60°, Y 0°, Z 45°) at a shared world scale for every asset, with the scale written to the render recipe. An asset is made bigger by enlarging its model, never by changing the camera scale for it. Tiles stay 64×32, drawn 64×31.

**Palette.** A new palette version, **`greek-retro`**, sits beside `greek-master`. It has at most 64 colours, ramps of up to six shades (for this version only), at most 48 colours in any one sprite, and binary alpha. Its starting content is the probe's 54-colour palette (nine ramps of six shades, `tools/probes/retro-render/palette/scene-palette.json`). `greek-master` is unchanged: its approved digest, its 48 colours and 12 four-shade ramps, and its 16-colour sprite limit stay as they are. `greek-retro` goes through the same digest-bound approval gate as `greek-master` before any asset is promoted against it. Realm variants stay palette swaps within a version.

**Colour limit.** The limit belongs to the palette version, not to a constant: 16 per sprite for `greek-master`, 48 per sprite for `greek-retro` (portraits keep their own limit).

**Cell classes.** A new class **`god-tall`** is 112×96 with the pivot declared per asset, (56, 78) for Zeus. `god` stays 64×80 as the legacy class, `mortal` stays 64×64, and `large` and `portrait` are unchanged. A god whose measured envelope fits may use a 96×96 class added the same way.

**Pivot.** A studio request may carry a declared per-asset pivot, such as (56, 78). The default of the cell's bottom centre applies only when a request declares none. The manifest already carries a per-asset pivot, so the renderer's manifest path needs no change.

**Outline.** One 1 px exterior outline in the darkest shade of the local ramp, applied once to the final combined silhouette after compositing (props and stamps included, so nothing is outlined twice), plus selective overlap lines drawn from part-ID and depth passes. Contact shadows are drawn after the outline, in one palette colour, with no outline.

**Shading.** Five-band toon with a fixed upper-left key light, tuned per material. No routine dithering.

**Animation.**
- Sample counts are set per clip. The default walk is 16 frames over 800 ms.
- Real per-frame durations and event timing are kept in the manifest.
- A semantic animation state (walk, idle, cast) is separate from its sample variants (8 or 16 frames). Pose overrides, facing overrides and stamp policy are keyed by the state, never by the variant, and a check proves that a coarse variant's frames equal the fine variant's frames at identical source times. The probe's fix for exactly this bug is the reference (`tools/probes/retro-render/check_resample.py`).
- Four facings stay. A subject that declares an asymmetry (Zeus's bolt hand) is rendered, not mirrored.

**Stamps.** Small reusable authored pixel stamps are allowed for the face (eyes and brow, none facing north) and for a signature prop (Zeus's bolt, eight orientations), composited by script with correct occlusion from the part and depth passes. They are authored art, recorded as such in provenance, and not rendered. No other frame is hand-edited by default; hand edits remain a recorded exception, as today.

**Blender.** Blender 5.2.2 LTS (hash `d13f752e3b9c`) is approved as a pinned local studio tool. It is an authoring dependency only: players need nothing new, and CI does not need it, because the tests cover the pure post-step helpers and the Blender runs are not unit-tested. A different Blender version is a new approval and a recipe change.

**Sources.** CC0 kits, or kits whose licence the owner has assessed, through a licence gate: import stops when a pack ships no licence file or a licence that is not CC0 or owner-assessed, and the pack is recorded as unused (the probe stopped on the Farm Animals pack for this reason). Each god and notable character gets its own model and proportion profile. The render recipe is pinned: Blender version and hash, scene script hash, palette digest, camera, shading parameters and input file hashes. Every asset carries reproducible provenance beside its manifest.

**Client target.** The client's 576×592 logical target (`apps/client/src/renderer/layout.ts`) is resized for 112×96 cells during build-out, and the change is checked in the packaged app, not only in a browser.

**D14.** D14 is not amended. A dated note records that CC0 kit bodies count as appropriately sourced material under [content-direction.md](../product/content-direction.md).

**Canon transition.** The hand-pixel Zeus and its provenance stay as a legacy revision and as a reference; nothing overwrites or retrofits it. A retro Zeus is a new asset record promoted **as one complete revision covering idle, walk, seated and act**, approved through the existing gates. Until that revision is promoted, hand-pixel Zeus ships unchanged, with its idle, seated and act states as published. Styles and sizes are never mixed within one character: no retro idle beside a hand-pixel seated sprite, and no state of one in the other's cell. The same holds for any later character. A registry republish selects the new revision and leaves the old bytes in place ([ADR-0009](0009-asset-registry-lifecycle-and-uris.md)), so until promotion the game keeps resolving `zeus-sprite` at its current revision and everything that loads it keeps working. Retro assets use the new cell class and palette version beside the existing ones, so old and new coexist in one registry and one scene. The code that assumes the old cell is listed under Consequences.

## Consequences

**Supersedes** (dated notes beside the existing text, never erasure):
- Art guide, **Characters** table: the gods row (48–56 px, 64×80) and the 40–48 px mortal and animal rows keep the old values as the legacy class and gain the retro classes. "Hands as 2–3 px blocks" and "head about one quarter of height" are chunky-proportion defaults that the retro profiles override.
- Art guide, **Palette**: "ramps of 4–5 shades", "world sprites use at most 16 colours including outline" and the 48-colour `greek-master` set are the legacy palette, unchanged; `greek-retro` is the new version beside it.
- Art guide, **Line, light and dithering**: "no automatic dithering" stands for routine use; the exterior outline is now one pass on the final silhouette; the cast shadow stays one flat shade.
- Art guide, **States**: `walk` (6 frames at 10 fps) and the 4-frame idle become defaults for hand-pixel assets; retro walk is 16 frames over 800 ms.
- Art guide, **Do and don't**: "Do read as one hand drew everything" now means one render recipe and one palette. The Chrono Trigger rule stands.
- D14 ("original pixel art") is not amended. A dated note records that CC0 kit bodies are appropriately sourced material under [content-direction.md](../product/content-direction.md); its isometric, portrait, effect and cutscene parts are unchanged.

**Stays:**
- The sole-midpoint pivot rule (placed at the tile's bottom vertex), the 64×32 tile and its 16 px elevation step, depth ordering, four directions, the declared-asymmetry rule, the key light from the upper left.
- The master-palette approval gate and digest, realm families and realm variants as palette swaps, the no-pure-black-or-white rule.
- Binary alpha; portraits (96×96, six expressions; they are not part of this decision and stay as published); effects and their tiers; the interface rules.
- D19 and D25: Tauri, Three.js, Three Flatland, and the pixel-exact shared renderer; nothing here changes the runtime.

**Requirements.**
- **X02** stays `planned`. Its review standard now follows this decision for retro assets (the 16-colour hand-pixel bar stays for legacy assets), and "consistent original visual system" is judged against the one recipe and palette version per character.
- **W01** (world sprites for all seven gods): the route to them changes; no status change.
- **U06**: Blender joins procedural composition as a local, offline generator; no hosted dependency.
- **U07** and **U08**: new cell classes, palette version and pose-cell metadata pass through the registry and content pack contracts.

**Build-out code changes.** None of these are in this PR; each is needed before a retro asset can be promoted. File and line refer to `main` at acceptance.
- `content/greek/assets/vocabulary.json:16-19`: add the `god-tall` class (112×96, kind `sprite`) beside `mortal`, `god`, `large` and `portrait`. `:23` and `:39`: idle is fixed at 4 frames and walk at 6 frames and 10 fps, so the retro 16-frame, 800 ms walk and its sample variants need their own frame and timing ranges for the new class. `:30`: `seated` is limited to the `god` class and needs `god-tall`.
- `packages/assets/src/conformance.ts:628-635`: `SPRITE_COLOURS = 16` and `PORTRAIT_COLOURS = 32` become limits read from the palette version.
- `packages/assets/src/studio/request.ts:35-38`: `MAX_COLOURS` of 16 follows the same change.
- `packages/assets/src/palette.ts:60-61` and `:229-233`: ramps of 4 or 5 shades, so `greek-retro` needs ramps of up to 6 for that version only; the `greek-master` approval digest does not change.
- `packages/assets/src/studio/request.ts:376-380`: the pivot defaults to `(floor(w / 2), h)`; add the declared per-asset pivot.
- `apps/client/src/renderer/layout.ts:15-19` and `:41-46`: `MAX_ACTOR_CELL` is 64×80 with pivot (32, 80), and the 576×592 target is sized from it; resize for 112×96 and check it in the packaged app.
- `packages/renderer/src/scene.ts:206-222`: the same `(w / 2, h)` default when a manifest has no pivot. The manifest pivot path needs no change.
- `packages/contracts/src/assets.ts:1706`: the pivot must lie inside the cell, which (56, 78) satisfies. `packages/assets/src/studio/packing.ts:617-625`: west is held to the mirrored east unless an asymmetry is declared, which matches the render-not-mirror rule.
- The published `zeus-sprite` manifest (cell 64×80, pivot (32, 80), `greek-master`) is correct as legacy and is not edited. Fixtures that hard-code 64×80 and (32, 80) (`tools/studio/src/fixtures/zeus.ts:8`, `packages/contracts/src/assets-manifest.test.ts:139`) stay as legacy fixtures.

**Pipeline.**
- The studio pipeline today targets Z-Image generation and Aseprite hand edits (D26). Blender 5.2.2 LTS (about 907 MB) joins as a pinned local tool for authoring, not for play: only the baked PNG atlases and manifests ship. CI does not install it.
- The probe's scripts are the reference, not the integration. Work to productise them (a render recipe contract, stamp and palette storage, conformance rules for the new classes, an import step) is build-out.
- Offline rule: authoring and rendering run locally, and a missing Blender never falls back to a hosted provider. Players need nothing new.
- Provenance for a retro asset records the pinned recipe (Blender version and hash, script hashes, `greek-retro` digest, camera, shading parameters, input hashes) and each stamp as authored art.

**Open build-out items from the probe**, none a direction question:
- Zeus is squat and bow-legged, with gold-stick legs below the hem.
- The mortal's tunic goes grey in shade, with a skin patch at one hip.
- The tree is a plain cone, the temple has blank planes, and the ground tiles repeat visibly.
- The tall Zeus's cast spans 94 of 112 px, so the margin is 9 px; the standard 96×96 variant has 6.
- The walk still changes about a quarter of pixels per step (27–29% for Zeus at 16 frames, against 42–44% at 8); that is information, not a gate, and no limit for shading boil on moving parts is calibrated yet.

## Alternatives considered

- **Keep hand-pixel canon with Aseprite bases.** Best fidelity to the current guide and zero new tools, but the cost per state, direction and character is what failed to scale. Retained as the legacy path: hand-pixel Zeus ships until the retro revision is promoted, and a character can still be drawn by hand as a whole.
- **Buy asset packs.** Blocked: paid packs' redistribution terms do not permit committing them to an open-source repository, and no purchase is authorized during implementation.
- **The 3D route held to the hand-pixel bar.** Tried in #213 and NO-GO: the rendered motion churns palette indices at 6–7 times canon's blip rate, which a 16-colour hand-pixel grid does not tolerate. The same machinery passes under the relaxed rules here.
- **Image-to-3D generation.** Not evaluated: no licensed local model was tried, and generated meshes would still need rigging and topology cleanup before they could share the animation clips. Not pursued.
- **Paper doll or sprite layering.** Cheap for variants, but it needs hand-drawn parts per direction and animation, so it repeats the hand-pixel cost and gives no new range of motion.

## Evidence/links

[tools/probes/retro-render/README.md](../../tools/probes/retro-render/README.md) (PR #214; three rounds, the owner's acceptance, the resample check, envelope and pivot numbers, provenance), [tools/probes/blender-sprite/README.md](../../tools/probes/blender-sprite/README.md) (PR #213; the NO-GO and the preregistered criteria), [art guide](../product/art-guide.md), [decisions D14, D15, D19, D23, D26](../product/decisions.md), [ADR-0009](0009-asset-registry-lifecycle-and-uris.md) (registry revisions), [ADR-0011](0011-game-canon-art-loading.md) (game canon loading), [content-direction.md](../product/content-direction.md).

Requirement IDs: X02, W01, U06 (U07, U08 noted).
