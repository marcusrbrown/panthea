---
title: "feat: Structures and effects (asset studio Unit 10)"
type: feat
status: active
date: 2026-10-13
origin: docs/plans/2026-10-03-001-feat-asset-studio-foundation-plan.md
---

# feat: Structures and effects (asset studio Unit 10)

## Overview

This completes the Tier 2 visual reference scene in the retro style of ADR-0012. It adds a tree, a Greek building that can be damaged and ruined, a fire loop and a lightning strike, all in the studio and in the packaged game. A player effects setting swaps in a calmer strike without changing anything in the world.

## Owner decisions (2026-10-13)

- The building is one Blender-built model rendered in intact, damaged and ruin states. Burning is the damaged state with a reusable fire loop drawn over it, so any building can burn. There is no overlay derivation op.
- A seeded TypeScript generator makes the fire loop and the lightning strike. Effects don't use Blender.
- The scope covers the studio scene and the packaged game, with a player effects setting.
- The tree comes from the Kenney Nature Kit (CC0), vendored through the existing kit gate. The building is script geometry in the GPL Blender script. No other kits are added.
- Effects have a full and a calmer version. The effect schema's `tier` field, tier-one 300 ms limit and four-accent cap are removed. Sizes, frame counts and timings are decided in the build and at the owner's visual gate.
- Rapid full-screen flashing is a photosensitivity risk. Reviewers judge it on the animated preview; there is no counter.

## Requirements Trace

- R20, T2 part: one tree, one building in intact, damaged and burning (plus ruin), and the lightning strike. Zeus's remaining idle directions shipped with `zeus-retro`.
- R21 and AE7, rewritten in place by U2: Effects have a full and a calmer version. In reduced-effects mode the strike shows the calmer version and the building still ends burning.
- R13: rewritten in place by U2 so damage and fire are rendered states plus the fire effect, not overlays.
- X02: the art reads as one consistent retro system next to `zeus-retro`.
- X03: the effects setting changes only presentation. The same committed event is shown either way, and the strike never blocks simulation. "Skip a strike scene" doesn't apply, because strikes are not scenes; this is recorded in traceability.

## What the code can't do today

These four gaps are the work. Everything else is tuning.

1. **Rendering a non-character.**
   - A request needs a god (`packages/assets/src/studio/request.ts`, `gods.find`). The content loader also refuses a visual profile with no god (`packages/content/src/god-visual-profile.ts`, "visual profile for unknown god").
   - The model profile parser is strict and figure-only, requiring body, garment, stamps, shadow, clips and pose (`packages/assets/src/render/profile.ts`). The engine refuses a missing stamp set or shadow ramp (`packages/assets/src/render/engine.ts`, `prepare`).
   - `tools/render/blender/render.py` `main()` always builds a rigged `Figure`.
   - The frame comes only from `tools/render/camera.json` (cell fixed to `god-tall`), through `recipe.ts` `postStepSettings` and the camera passed to `render.py`. The size gate accepts only 112×96 (`RENDER_ENGINE.measuredCells`, checked in `request.ts` as `unmeasured-size`).
   - The vocabulary has no structure cell class and no `intact`, `damaged` or `ruin` states.
2. **Producing and publishing an effect.** No provenance method fits a generated effect (`packages/contracts/src/assets.ts`, methods generated, hand, derived and rendered). The studio has no route for one: pack and request kinds are sprite and portrait only.
3. **Drawing them in the game.** Buildings and flames are procedural meshes (`apps/client/src/renderer/decor.ts`). The canon resolver refuses non-sprite manifests (`resolve-core.ts`). Every sprite shares one looping clock, so nothing can play a one-shot over an event. The layout was sized for 28×22 stand-ins (`apps/client/src/renderer/layout.ts`).
4. **The effects setting.** Nothing exists. `settings.tsx` holds model settings and offline mode, and saving them restarts the sidecar.

## Units

### U1. Structures: non-character render path, tree and building

- [ ] Goal: publish a tree and a Greek building through the studio's rendered path.
- **Approach:**
  - Structures get their own content file (`content/greek/assets/structures/<id>.json`), loaded beside the god subjects. A request for a structure bypasses the god lookup.
  - A second profile type, `kind: "structure"`, gets its own parser. It has no body, garment, stamps or clips, and its shadow is optional. The engine's stamp and shadow checks apply to figure profiles only.
  - The structure profile carries its frame: cell, pivot, shadow, and the outline and overlap choices. The recipe passes that frame to the post step and to `render.py` instead of `camera.json`'s cell. The engine's size gate takes the frame's cell. `camera.json`, the figure profile and `POST_STEP_VERSION` stay as they are.
  - `render.py` gains a static-scene branch that reuses its scene, camera, material and pass helpers and skips the figure. Its hash changes, but `zeus-retro` is unaffected, because the render audit runs only at publish (`publish.ts`). A future Zeus revision just renders with the new script.
  - The building is script geometry: a Greek town house or shrine. Damaged and ruin are versions of the same model, so damage keeps the silhouette and ruin may change it.
  - The tree is a Kenney Nature Kit model with a seamless wind loop, porting the probe's wind math and seam check (`tools/probes/retro-render/wind_plan.py`). It covers the same world statuses as a building (the Old Oak is a burnable building in the world).
  - The vocabulary gains the structure cell classes and states. The studio CLI and app accept a structure subject for a recipe request.
- **Files:** `content/greek/assets/vocabulary.json`, `content/greek/assets/structures/`, `packages/content/src/` (structure loader), `packages/assets/src/render/` (profile, engine, recipe, post and audit as needed), `packages/assets/src/studio/request.ts`, `tools/render/blender/render.py`, `tools/render/profiles/`, `tools/render/kits.json` and the kit files, `tools/studio/src/commands.ts`, `apps/studio` request form, tests beside each.
- **Tests:**
  - A structure request renders, packs, approves and publishes, and the audit recomputes it.
  - Damaged keeps intact's alpha silhouette.
  - The tree's wind loop is seamless.
  - The Zeus goldens and parity tests pass unchanged.
  - The kit gate accepts the vendored Kenney files.
- **Verification:** a real headless Blender run through the studio CLI publishes both assets. A cross-family reviewer and then the owner judge the contact sheets and the animated tree.

### U2. Effects: generator, provenance and the tier-rule removal

- [ ] Goal: publish the best fire loop and lightning strike we can make.
- **Approach:**
  - A pure, seeded generator in `packages/assets/src/effects/` produces frames quantised to `greek-retro` plus declared glow colours.
  - The lightning strike has a full animation and a calmer one. The fire is one loop.
  - A new effect-only `procedural` provenance method records the generator version, seed, parameters and palette digest.
  - Publish re-runs the generator offline and compares the bytes, which fully meets R15.
  - A studio `effect` op runs the generator into a draft. Approve and publish then take an effect draft: pack's `logicalCells`, the request kinds and publish's kind handling (`packing.ts`, `request.ts`, `publish.ts`) are sprite and portrait only today.
  - Remove the effect `tier` field and the vocabulary's `tiers` range, the tier-one duration check and the accent cap (`packages/contracts/src/assets.ts` effect parser and key lists, `vocabulary.json`). Effects keep a declared glow-colour list, so conformance knows which off-palette colours are intended.
  - Rewrite the art guide's Effects section, R13, R21 and AE7, and ADR-0009's effect vocabulary text in place. No dated notes.
- **Files:** `packages/assets/src/effects/`, `packages/contracts/src/assets.ts`, `content/greek/assets/vocabulary.json`, `packages/assets/src/conformance.ts`, `packages/assets/src/studio/` (op, request, pack and publish), `tools/studio/src/commands.ts`, `docs/product/art-guide.md`, `docs/brainstorms/2026-10-03-asset-studio-requirements.md`, `docs/decisions/0009-asset-registry-lifecycle-and-uris.md`.
- **Tests:**
  - The same seed and parameters give the same bytes.
  - Publish refuses an effect whose bytes don't match its recipe.
  - The schema no longer reads `tier`.
  - Conformance accepts declared glow colours and refuses others.
- **Verification:** a headless animated preview (HTML or contact sheet), opened only after asking the owner. Cross-family review, then the owner's visual gate.

### U3. Game: structures, fire, ruin, strike and the effects setting

- [ ] Goal: the packaged game draws the published art for real world events.
- **Approach:**
  - Buildings become sprites on the renderer's `structure` layer.
  - A small presentation table picks the art: the Old Oak draws the tree, and every other building draws the reference building.
  - Status maps to art: intact, damaged, burning (damaged plus the fire loop), repairing (damaged plus the existing repair bar), and destroyed (ruin).
  - A strike-caused `building-damaged` or `building-ignited` event plays the bolt once at the building.
  - Catch-up, replays and remounts show the end state without replaying old bolts.
  - The resolver gains an effect lookup, and the renderer gains a one-shot timeline.
  - The effects setting (full or calm) is an instant control stored in the webview's local storage and seeded from `prefers-reduced-motion`. It never reaches the sidecar or the world.
  - The layout is refitted for the real art sizes. The mesh builders stay as the fallback when art is missing.
  - The client view gains each building's `material`, read-only from the world.
- **Files:** `apps/client/src/renderer/` (decor, layout, scene, presentation, actors or a structures module), `packages/renderer/src/`, `packages/assets/src/resolve-core.ts` (effect lookup), `apps/client/src/assets/canon.ts`, `apps/client/src/store.ts`, `apps/client/src/ui/` settings control, `apps/client/src/inspect/`, `tools/scenarios/studio-zeus-scene/reference-digests.json` and `reference.test.ts`, tests.
- **Tests:**
  - Each status draws its art.
  - A strike event plays the bolt once and a catch-up doesn't replay it.
  - The calm setting picks the calm strike, and a seeded world run gives the same state hash in both settings.
  - Missing art falls back to the meshes, and the event is still receipted.
  - The fixture digests cover the new frames inside the test budget.
- **Verification:** the inspection fixture at zoom 1–4 in the packaged app, and the owner's look at a live strike on a building in both settings. Both are GUI launches, so ask the owner first.

### U4. Studio reference scene

- [ ] Goal: the preview shows the whole T2 scene and proves AE7.
- **Approach:** the preview harness composes the tree, the building, `zeus-retro` and the strike. It has a Strike button, a building-state control and the effects toggle. In calm mode the strike shows the calm version, and the building still ends burning.
- **Files:** `apps/studio/src/harness/`, `apps/studio/src/renderer/preview.ts`, `apps/studio/src/App.tsx`, tests.
- **Tests:** the AE7 case, the state control, and the toggle reusing the game's full/calm choice.
- **Verification:** the owner's visual gate in the packaged studio, after asking. Then evidence and the traceability updates (X02, X03, R13, R20, R21).

## Delivery

- **PR1:** U1. **PR2:** U2, in parallel with U1 in its own worktree. **PR3:** U3 and U4, after both have merged.
- Each PR runs `bun run check`, `validate:assets` and the cargo gates where Rust changes. It also needs the fresh-off-main guard and owner approval before the first push.
- Any GUI launch (the packaged game, the studio, or `open` on a preview) needs the owner's go-ahead first. Blender, the CLI and tests run headless.

## Out of scope

- Dual-grid tiles and map preview (Unit 11), and sound (Unit 12).
- Other gods and other scenery. Animals.
- Props on characters and Zeus's act/thunderbolt. Per the owner, the bolt is an effect drawn at the target, not something Zeus holds.
- Additive blending.
