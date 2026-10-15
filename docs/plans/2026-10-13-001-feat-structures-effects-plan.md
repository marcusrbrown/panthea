---
title: "feat: Structures and effects (asset studio Unit 10)"
type: feat
status: active
date: 2026-10-13
deepened: 2026-10-13
origin: docs/plans/2026-10-03-001-feat-asset-studio-foundation-plan.md
---

# feat: Structures and effects (asset studio Unit 10)

## Overview

This completes the Tier 2 visual reference scene in the retro style of ADR-0012. It adds a tree, a Greek building that can be damaged and ruined, a fire loop and a lightning strike, all in the studio and in the packaged game. A player effects setting swaps in the calm strike without changing anything in the world.

## Owner decisions (2026-10-13)

- The building is one Blender-built model rendered in intact, damaged and ruin states. Burning is the damaged state with a reusable fire loop drawn over it, so any building can burn. There is no overlay derivation op.
- A seeded TypeScript generator makes the fire loop and the lightning strike. Effects don't use Blender.
- The scope covers the studio scene and the packaged game, with a player effects setting.
- The tree comes from the Kenney Nature Kit (CC0), vendored through the existing kit gate. The building is script geometry in the GPL Blender script. No other kits are added.
- Effects have a full and a calm version. The effect schema's `tier` field, tier-one 300 ms limit and four-accent cap are removed. Sizes, frame counts and timings are decided in the build and at the owner's visual gate.
- Rapid full-screen flashing is a photosensitivity risk. Reviewers judge it on the animated preview; there is no counter.

## Requirements Trace

- R20, T2 part: one tree, one building in intact, damaged and burning (plus ruin), and the lightning strike. Zeus's remaining idle directions shipped with `zeus-retro`.
- R21 and AE7, rewritten in place by U2: effects have a full and a calm version. With the effects setting on calm, the strike shows the calm version and the building still ends burning.
- R15: the effects regenerate byte-for-byte from their recipe at publish.
- R13: rewritten in place by U2. Damage is a rendered state, and burning is the fire effect drawn on the damaged state, not a derived overlay asset.
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
3. **Drawing them in the game.** Buildings and flames are procedural meshes that always sort behind actors (`apps/client/src/renderer/decor.ts`). The canon resolver refuses non-sprite manifests (`resolve-core.ts`). Every sprite shares one looping clock, so nothing can play a one-shot over an event. The client can't tell a strike-caused ignition from a director or spread fire, because the server drops the event cause (`server.ts` `readRecentEvents`). The layout was sized for 28×22 stand-ins (`apps/client/src/renderer/layout.ts`).
4. **The effects setting.** Nothing exists. `settings.tsx` holds model settings and offline mode, and saving them restarts the sidecar.

## Prior-Art Survey

```json
{
  "schema_version": 2,
  "verdict": "extend",
  "scope": "packages/assets/src/render; packages/assets/src/studio; packages/contracts/src/assets.ts; packages/renderer/src; apps/client/src/renderer; tools/render; tools/probes/retro-render as a candidate",
  "freshness": {
    "vcs_reference": "32608a8"
  },
  "budget": {
    "max_search_passes": 8,
    "max_candidate_inspections": 14,
    "exhausted": false
  },
  "candidates": [
    {
      "path_or_symbol": "tools/render/blender/render.py fresh_scene, make_camera, MaterialBook, render_pass, render_slot",
      "description": "Pinned headless render route with scene, camera, toon material and pass helpers; main() and render_slot assume a rigged Figure.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "packages/assets/src/render/profile.ts parseProfile; recipe.ts postStepSettings; engine.ts prepare; audit.ts auditRendered",
      "description": "Figure profile, recipe hashes, engine preparation and publish audit for rendered sprites; frame comes from camera.json.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "packages/assets/src/render/post.ts postProcessSlot",
      "description": "Deterministic post step: palette snap, downscale, outline, optional shadow and stamps.",
      "disposition": "reuse"
    },
    {
      "path_or_symbol": "tools/probes/retro-render/wind_plan.py, render_retro.py Tree",
      "description": "Probe wind displacement with a frame-n-equals-frame-0 seam check, and environment items rendered in the probe.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "packages/contracts/src/assets.ts EffectManifest, parseEffectBody, provenance methods",
      "description": "Effect manifest with tier, accents and tier-one duration checks; provenance is generated, hand, derived or rendered.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "packages/assets/src/studio/derive.ts encodeRgbaPng, recipe versioning",
      "description": "Pinned PNG encoder and versioned deterministic recipes recomputed at publish.",
      "disposition": "reuse"
    },
    {
      "path_or_symbol": "packages/assets/src/studio/derivation.ts DERIVE_OPS",
      "description": "Mirror, palette swap and bob over published sprite revisions.",
      "disposition": "insufficient",
      "insufficiency_reason": "Transforms published sprite pixels; it neither generates effects nor renders structures."
    },
    {
      "path_or_symbol": "apps/client/src/renderer/actors.ts planActors, actorInstances",
      "description": "Resolves canon art and builds depth-sorted sprite instances on the actor layer.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "apps/client/src/renderer/decor.ts buildDecor",
      "description": "Procedural meshes for places, buildings, flames, repair bars and rings.",
      "disposition": "insufficient",
      "insufficiency_reason": "Mesh stand-ins that sort behind every actor; building and flame meshes are replaced by sprites."
    },
    {
      "path_or_symbol": "packages/renderer/src/layer.ts frameIndexAt",
      "description": "Looping frame selection on one shared clock.",
      "disposition": "insufficient",
      "insufficiency_reason": "Always loops; a one-shot needs its own frame function beside it."
    },
    {
      "path_or_symbol": "apps/client/src/summary.ts createSummaryDismissal",
      "description": "Injectable local-storage preference with an in-memory fallback.",
      "disposition": "extend"
    }
  ]
}
```

## Units

### U1. Structures: non-character render path, tree and building

- [x] Goal: publish a tree and a Greek building through the studio's rendered path.
- **Approach:**
  - **Content.** Structures live under `content/greek/assets/structures/<id>.json`, loaded into a `structures` field on `StudioContent` (`packages/assets/src/studio/content.ts`, `request.ts`). They stay out of `assets/subjects`, whose parser requires a god. A single `subjectOf(content, id)` in `request.ts` replaces the god lookups in `spriteCellClassOf`, `buildSpec` and `newRequestRecord`. A structure has no abilities.
  - **Profile.** `parseProfile` (`packages/assets/src/render/profile.ts`) dispatches on `kind`. An absent `kind` is a figure, so existing profiles don't change. `kind: "structure"` gets its own parser with these fields:
    - model and kit files
    - materials
    - a cell-class id and pivot
    - clips per state
    - an optional shadow
    - wind parameters for the tree

    Wind lives in the profile so that tuning it changes the hash. The engine's stamp and shadow checks (`engine.ts` `prepare`, `audit.ts`) apply only to figure profiles. Structures use a constant "no stamps" hash, so the contract stays the same.
  - **Frame.** `frameOf(profile, camera)` in `recipe.ts` computes the cell once from the profile's cell class. An effective camera with that cell feeds `render.py`, `postStepSettings`, `prepare` and `auditRendered`, so render and audit read the same frame. A test checks the profile cell matches the vocabulary. Blender has no measured memory limit per size the way sd-server does, so the render engine's accepted cells (`RENDER_ENGINE.measuredCells`, checked in `request.ts`) come from the loaded profiles' frames instead of a fixed list. The tracer render is then the measurement. The outline and overlap settings stay as they are.
  - **Manifest.** The manifest stays `kind: sprite`. "Structure" is a subject and profile property, not an asset kind, so the pack, publish and CLI kind checks need no change. Before PR1, confirm whether pack gives a rendered sprite realm variants (`packing.ts`). If it does, structures don't get them.
  - **Vocabulary.** It gains one `structure` cell class and the states `intact`, `damaged` and `ruin`. Structures publish `south` only, the facing the game and the studio scene draw. The tree's intact and damaged states are wind loops, and the ruin stump is a still.
  - **Script.** `render.py` gains a static-scene branch that reuses its scene, camera, material and pass helpers and skips the figure. `render_slot` currently poses a figure and writes `extentPx` and `locators` per frame. A static slot writes the model's projected extent and empty locators instead, and the engine's ingest accepts empty locators when the profile has no stamps. Its hash changes, but published `zeus-retro` is unaffected: the render audit runs only at publish, and a future Zeus revision renders with the current script.
  - **Building.** Script geometry for a Greek town house or shrine. Damaged keeps the silhouette by changing only materials and decals on the same mesh. Ruin is the same model with walls and roof broken.
  - **Tree.** One Kenney Nature Kit model, vendored alone (raise the kit size cap in `tools/render/kits.json` if it needs the room), with a seamless wind loop ported from the probe's wind math and seam check (`tools/probes/retro-render/wind_plan.py`). Damaged is charred bark with sparse leaves. Ruin is a burnt stump. Both are scripted from the same model, because the Old Oak is a burnable building in the world.
  - **Order.** First the seams, with no behaviour change: subject lookup, profile dispatch, `frameOf` and the no-stamps hash. Zeus revision hashes and goldens stay bit-identical. Then one intact building through request, render, pack, approve, publish and audit on the CLI as a tracer. Then damaged and ruin, then the tree, then exposing it in the app. Structure ids join `renderSubjectsOf` (`tools/studio/src/commands.ts`), which the app already reads.
- **Files:** `docs/product/traceability.md` (R20), `content/greek/assets/vocabulary.json`, `content/greek/assets/structures/`, `packages/assets/src/studio/` (content, request), `packages/assets/src/render/` (profile, load, engine, recipe and audit), `tools/render/blender/render.py`, `tools/render/profiles/`, `tools/render/kits.json` and the kit files, `tools/content/src/assets.ts`, `tools/studio/src/commands.ts`, tests beside each.
- **Tests:**
  - Zeus revision hashes, goldens and parity tests are unchanged after the seams.
  - A structure request renders, packs, approves and publishes, and the audit recomputes it.
  - A profile whose cell differs from `camera.json` passes its audit. Changing only the profile cell fails the revision check.
  - Damaged keeps intact's alpha silhouette.
  - The tree's wind loops are seamless.
  - The kit gate accepts the vendored Kenney files.
- **Verification:** a real headless Blender run through the studio CLI publishes both assets. A cross-family reviewer and then the owner judge the contact sheets and the animated tree.

### U2. Effects: generator, provenance and the tier-rule removal

- [ ] Goal: publish the best fire loop and lightning strike we can make.
- **Approach:**
  - A pure, seeded generator in `packages/assets/src/effects/` produces frames quantised to `greek-retro` plus declared glow colours.
  - **Fire:** hand-shaped flame silhouettes anchored at the roof or the damaged area, with two or three tapering tongues animated by seeded periodic noise. The noise is sampled on a circle in time, so the last frame flows back to the first. It uses the terracotta ramp with soil for smoke, a dark warm outline on the outer silhouette only, and binary alpha. Starting point: about 8 frames at about 110 ms.
  - One effect asset per effect. The lightning asset holds `full` and `calm` animations, and the setting picks the animation name.
  - **Lightning:** one seeded midpoint-displacement bolt from the top of the cell to the roof target, with a narrow bright core and a coloured band. It runs leader, then a single peak, then the impact. Starting point: about 8 frames over about 750 ms. The calm version keeps the leader, the bolt and the impact with lower contrast and fewer frames.
  - First pass is tongues and the bolt only. Embers, smoke, side branches, sparks and afterglow are added only if the visual gate asks for them. Neither version has a full-cell bright frame or repeated pulses.
  - Every number above is a starting point that gets tuned at the visual gate. Reference: Slynyrd Pixelblog 45 (fire), and Medeiros's effect tutorials for motion study.
  - A new effect-only `procedural` provenance method records the generator version, seed, parameters and palette digest.
  - Publish re-runs the generator offline and compares the bytes, which fully meets R15.
  - A studio `effect` op runs the generator into a draft. Approve and publish then take an effect draft: pack's `logicalCells`, the request kinds and publish's kind handling (`packing.ts`, `request.ts`, `publish.ts`) are sprite and portrait only today.
  - Remove the effect `tier` field and the vocabulary's `tiers` range, the tier-one duration check and the accent cap (`packages/contracts/src/assets.ts` effect parser and key lists, `vocabulary.json`, and `MAX_ACCENTS` with its checks in `packages/assets/src/conformance.ts`). Effects keep a declared glow-colour list, so conformance knows which off-palette colours are intended.
  - Rewrite the art guide's Effects section, R13, R21 and AE7, and ADR-0009's effect vocabulary text in place. Update `docs/product/traceability.md` for R13, R15, R21, AE7 and X03 (strikes are not scenes, so there is nothing to skip).
- **Files:** `packages/assets/src/effects/`, `packages/contracts/src/assets.ts`, `content/greek/assets/vocabulary.json`, `packages/assets/src/conformance.ts`, `packages/assets/src/studio/` (op, request, pack and publish), `tools/studio/src/commands.ts`, `docs/product/art-guide.md`, `docs/brainstorms/2026-10-03-asset-studio-requirements.md`, `docs/decisions/0009-asset-registry-lifecycle-and-uris.md`.
- **Tests:**
  - The same seed and parameters give the same bytes.
  - Publish refuses an effect whose bytes don't match its recipe.
  - The schema no longer reads `tier`.
  - Conformance accepts declared glow colours and refuses others.
- **Verification:** a headless HTML preview at integer zoom with nearest-neighbour scaling, plus a contact sheet. It shows each effect alone and composited on the U1 building (or the probe house until U1 lands), with full and calm side by side. The owner is asked before it opens. A cross-family reviewer checks at 1×:
  - The fire reads as a building fire with no loop hitch.
  - The bolt clearly hits the building.
  - The calm version is still unmistakably a strike, with no broad bright change.
  - The effects fit `zeus-retro`.

  Then the owner's visual gate.

### U3. Game: structures, fire, ruin, strike and the effects setting

- [ ] Goal: the packaged game draws the published art for real world events.
- **Approach:**
  - **Shared presentation module.** A new `packages/renderer/src/structures.ts` is exported for both the game and the studio. It holds:
    - `StructureArt` (tree or building) and the published asset ids
    - the full/calm animation choice
    - `oneShotFrameAt(durations, elapsedMs)`
  - **Status mapping**, client only, from the world's `BUILDING_STATUSES`: operational draws intact, damaged draws damaged, burning draws damaged plus fire, repairing draws damaged plus the existing repair bar, and destroyed draws ruin. The studio harness picks its state directly.
  - **Which art.** The client chooses by building id: `old-oak` draws the tree and everything else draws the building. Material can't decide this, because the Old Oak and the Woodshed are both wood.
  - **Structures as sprites.** A new `apps/client/src/renderer/structures.ts` follows `planActors` and `actorInstances` (`actors.ts`). It resolves the art, keys depth on the art's foot (not `buildingCenter`), and places sprites on the `structure` layer, so actors in front of or behind a building sort correctly. Today every building draws behind every actor. Fire is a second structure sprite whose id sorts after its building's. Missing structure art uses the shared placeholder actors already use, and the building and flame mesh builders are deleted. Place and event-ring meshes stay.
  - **Strike cause on the wire.** `RecentEvent` carries only `id, sequence, tick, kind, subjects` (`packages/contracts/src/snapshot.ts`). The server drops `cause` (`apps/simulation/src/server.ts` `readRecentEvents`). A strike on a combustible building emits only `building-ignited`, the same kind that director and spread fires use. So:
    - add a narrow cause field to `RecentEvent`, set by the server;
    - add `buildingId` to `PlacedEvent` (`presentation.ts`).

    A bolt plays for strike-caused `building-ignited` and for every `building-damaged`, which the world emits only from a strike (`packages/contracts/src/event.ts`).
  - **One-shot bolt.** The bolt is an `effect`-layer sprite timed by `oneShotFrameAt` from the draw that first presents its event. The looping `frameIndexAt` is unchanged. `tick` hides a finished bolt, and `frameSignature` includes the bolt frame so the render loop redraws. The resolver gains an effect lookup (`packages/assets/src/resolve-core.ts`, `apps/client/src/assets/canon.ts`).
  - **No replays.** A seen-set of event ids lives in the `createWorldRenderer` closure. The first draw marks the current window seen without playing. Every recent event is marked whatever its realm, and the set is updated only after the `stale()` guard and pruned to the window. Event ids are world-stable, so it isn't reset on session change. Receipts are unchanged: the bolt starts at draw and never waits for a relay.
  - **Effects setting.** `apps/client/src/effects.ts` follows `summary.ts`: injectable storage with an in-memory fallback, and a seed from an injected `matchMedia('(prefers-reduced-motion: reduce)')`. The control sits in the topbar beside Settings (`surface.tsx`), not in the model settings form, which restarts the sidecar.
  - **Layout.** Refit after U1 and U2 publish, from the measured manifests: building cells for all three states, the tree, the fire anchor and the bolt's top. `layout.test.ts` builds its boxes from those. The 624×592 literals in `scene.test.ts` move with the one constant, and the building and flame mesh tests go with the meshes.
  - **Inspection fixture.** Add `structure` and `effect` branches through `inspect/reference.ts`, `selection.ts`, `inspector.ts`, `InspectView.tsx` and `tools/scenarios/studio-zeus-scene/src/reference.ts`, which drops other kinds today. Long loops are keyframed to fit `INSPECT_SIZE`. These checks go in their own test file, and digests are regenerated after U1 and U2 publish.
  - **Order.** Shared module and the cause field first, then the setting, then structures on the placeholder, then the bolt, then the layout refit, then digests.
- **Files:** `packages/renderer/src/structures.ts` and `index.ts`, `packages/contracts/src/snapshot.ts`, `apps/simulation/src/server.ts`, `packages/assets/src/resolve-core.ts`, `apps/client/src/` (`assets/canon.ts`, `effects.ts`, `renderer/` structures, scene, layer use, presentation, layout and decor, `ui/surface.tsx`, `inspect/`), `tools/scenarios/studio-zeus-scene/`, tests.
- **Tests:**
  - Each status draws its art, and an actor below a building draws in front of it.
  - A strike-caused ignition plays the bolt once. A director or spread fire doesn't. A fresh start, a realm switch out and back, and a remount replay nothing.
  - Toggling the setting sends no transport call. The calm setting picks the calm animation, and a seeded world run gives the same state hash in both settings.
  - Missing art draws the placeholder, and the event is still receipted.
  - The fixture digests cover the new frames inside the test budget.
- **Verification:** the inspection fixture at zoom 1–4 in the packaged app, and the owner's look at a live strike on a building in both settings. Both are GUI launches, so ask the owner first.

### U4. Studio reference scene

- [ ] Goal: the preview shows the whole T2 scene and proves AE7.
- **Approach:** the harness swaps its placeholder structure (`apps/studio/src/harness/layout.ts`) for the shared art choice. It composes the tree, the building, `zeus-retro` and the strike, and imports only `@panthea/renderer`'s shared module. `PreviewItem` (`preview.ts`) gains an effect item. A Strike button drives `oneShotFrameAt` from the playback clock, and there is a building-state control and the full/calm toggle. The harness has no world, so a resolved strike sets the building to burning.
- **Files:** `apps/studio/src/harness/`, `apps/studio/src/renderer/preview.ts`, `apps/studio/src/App.tsx`, tests.
- **Tests:** AE7 in both modes against the playback clock (calm shows the calm bolt, and the building ends burning). Also the state control.
- **Verification:** the owner's visual gate in the packaged studio, after asking. Then evidence and the traceability updates (X02, X03, R13, R20, R21).

## Delivery

- **PR1:** U1. **PR2:** U2, in parallel with U1 in its own worktree. PR1 merges first, and PR2 rebases onto it for the shared `vocabulary.json`, `request.ts` and `commands.ts` edits. **PR3:** U3 and U4, after both have merged.
- Each PR runs `bun run check`, `validate:assets` and the cargo gates where Rust changes. It also needs the fresh-off-main guard and owner approval before the first push.
- Any GUI launch (the packaged game, the studio, or `open` on a preview) needs the owner's go-ahead first. Blender, the CLI and tests run headless.

## Out of scope

- Dual-grid tiles and map preview (Unit 11), and sound (Unit 12).
- Other gods and other scenery. Animals.
- Props on characters and Zeus's act/thunderbolt. Per the owner, the bolt is an effect drawn at the target, not something Zeus holds.
- Additive blending.
