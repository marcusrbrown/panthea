---
date: 2026-10-03
topic: asset-studio
---

# Asset Studio: Authoring Sprites, Tiles, Effects, and Sound From a Prompt

## Summary

A studio toolchain, built in this repository beside the core game, turns a request such as "Zeus idle and strike sprites" into candidate frames that conform to the project art guide, lets the owner make them canon by hand in Aseprite, derives what derivation can honestly produce (mirrors, palette swaps, overlays, idle bob), and registers every result with provenance so the game client hot-swaps it over its placeholder. It ships as one `@panthea/assets` library hosted by a `tools/studio` CLI and a separate `apps/studio` Tauri app with an in-engine preview. Generation is local-only on the M1 Pro 16 GB baseline; hosted providers exist only as an interface. Work is tiered: Zeus on screen first, the visual reference scene second, world tiles and sound third.

---

## Problem Frame

The world is gaining gods, mortals, practices, and contests faster than it is gaining anything to look at. The client draws every actor as a coloured canvas-texture marker on a radial layout (`apps/client/src/renderer/scene.ts`), buildings as flat boxes, and effects as scaled quads. `packages/assets` and `tools/content` are one-line placeholders (`status.ready: false`). The only art pipeline evidence is the M0 probe (`tools/probes/art-local/`), which settled a base arm and a 16×16 deterministic silhouette composer and then stopped.

The accepted product needs polished original isometric pixel art, expressive portraits, effects, and sound (D14, X02, X03, U06–U08), and content-direction.md asks for a shared art guide that does not exist yet. The Zeus reference scene is the acceptance fixture for art, simulation, audio, and accessibility together; nothing in the repository can produce a single frame of it.

The owner is one person, and the implementing agent is fully occupied with M2 simulation work (`feat/contests`, catch-up performance). Asset work done inside that lane would stall both. The M0 model choice also carries a licence problem: the PixelArtRedmond LoRA is non-commercial-oriented and must be verified before any content-pack use, which blocks shipping anything made with it.

External tooling has moved since M0. stable-diffusion.cpp now runs Apache-licensed models that may fit 16 GB (FLUX.2-klein-4B, Z-Image-Turbo) with pixel-art LoRAs; MIT-licensed pixel-grid recovery exists, though its best detector reports 77% exact recovery and the rest needs a human; tiny procedural sound synths and a 1.6 GB local SFX model exist. None of it is wired to anything here.

---

## Actors

- A1. Owner: writes requests, reviews contact sheets, hand-edits in Aseprite, approves what becomes canon, approves packages and palette, merges PRs.
- A2. Studio agent: the implementing agent for this work, in its own worktree (`panthea-studio`), opening small PRs.
- A3. Core agent: the M2 implementing agent in the main checkout; shares additive packages with A2 but owns world, agents, persistence, and scenarios.
- A4. Studio: the `@panthea/assets` pipeline library, hosted by the `tools/studio` CLI and by `apps/studio` as a Bun sidecar behind a Tauri webview.
- A5. Generation providers: local image and sound generators behind per-kind interfaces, sharing one job and provenance envelope; hosted providers are interface-only.
- A6. Aseprite: owner-installed external editor the studio drives headless for documents, tags, and exports.
- A7. Game client: `apps/client`, which resolves registry URIs and hot-swaps placeholders (D15).

---

## Asset lifecycle

Every asset moves through these states; each flow names the transition it causes.

- `candidate`: a generated or imported frame set with a conformance report; shown on a contact sheet; not yet owned.
- `draft`: a candidate the owner picked; editable in Aseprite; the only state that round-trips through F2.
- `approved`: a draft the owner accepted; input to derivation (F3); visible in the studio preview only.
- `canon`: an approved set the owner published; written to the registry and read by the game client. A partial set may be canon; the placeholder covers missing states.
- `rejected`: a candidate or draft discarded; kept in provenance, not in the registry.

---

## Key Flows

- F1. Request to candidates
  - **Trigger:** A1 fills the request form: subject (picked from the content pack), kind, states, directions, optional style note; free text such as "Zeus idle and strike" is parsed into the same form and shown resolved before queuing. An unresolvable subject blocks with the pack's subject list offered.
  - **Actors:** A1, A4, A5
  - **Steps:** The studio builds a generation spec from the content pack and the art guide; a local provider produces a batch of candidates (default four; owner-set); conformance runs on each; the contact sheet shows per-candidate pass/fail per check, detected scale, colours merged, pixels moved, sorted fewest changes first; a failed job shows its error with retry; a candidate that fails conformance is openable but not approvable unless the owner records an exception. "Reroll" queues the same spec with new seeds and appends to the sheet; editing the request replaces it. A1 picks one or more candidates, which become drafts.
  - **Outcome:** Drafts exist with manifests, provenance, and conformance reports; the request is recorded.
  - **Covered by:** R1, R2, R5, R6, R7, R8, R9, R20

- F2. Hand cleanup round trip
  - **Trigger:** A1 chooses "open in Aseprite" on a draft.
  - **Actors:** A1, A4, A6
  - **Steps:** The studio writes a tagged `.aseprite` (frames, tags, palette, slices for pivot and footprint) via Aseprite's batch scripting and marks the draft "editing externally"; on each save the studio re-imports and shows a pixel diff and a conformance report without changing pixels; A1 ends the edit with "finish" (keep) or "discard"; when Aseprite is absent the action is "export for editing" with an explicit "import edited" step and a visible notice.
  - **Outcome:** The edited frames replace the draft; the manifest records the hand-edit step. Hand-edited pixels are never changed by an automatic step without confirmation.
  - **Covered by:** R10, R11, R12

- F3. Derive from an approved set
  - **Trigger:** A1 approves a draft and asks for mirrored directions, realm variants, overlays, or idle bob.
  - **Actors:** A1, A4, A5
  - **Steps:** The derivation layer produces frames deterministically where the guide allows; frames it cannot derive (new poses, back views) are either hand-drawn via F2 or requested as reference-conditioned generation plus inpaint repair, which returns to F1's contact sheet. Multi-frame results play at manifest timing on the sheet with per-frame scrub; purely deterministic derivations are reviewed as a set, not per frame.
  - **Outcome:** A larger approved set with every frame traceable to an approved source, a hand edit, or a recorded generation.
  - **Covered by:** R13, R14, R15

- F4. Publish to the engine
  - **Trigger:** A1 marks an approved set canon.
  - **Actors:** A1, A4, A7
  - **Steps:** The studio packs an atlas, writes the registry entry (versioned, content-addressed), and writes the subject-to-asset mapping in the studio-owned `content/greek/assets/` files; the studio preview live-reloads; the game client, on next load, resolves the entity's registry URI to the new atlas and plays the states it can drive.
  - **Outcome:** Zeus is drawn from the canon sprite in the studio preview and the game; the placeholder remains the fallback for any missing state.
  - **Covered by:** R3, R4, R16, R17, R18

- F5. Tiles and a map (Tier 3)
  - **Trigger:** A1 asks for a terrain or structure set ("town cobbles with grass edge", "tavern intact/damaged/burning").
  - **Actors:** A1, A4, A5, A6
  - **Steps:** A seamless base texture is generated or chosen; diamond masks stamp a dual-grid autotile set; structures generate at the guide's footprint and derive damage overlays; the set exports as a Tiled tileset with Wang metadata; a map is assembled and previewed in the studio renderer.
  - **Outcome:** A map renders with consistent tile edges and correct depth order in the studio preview.
  - **Covered by:** R19

- F6. Sound for an event (Tier 3)
  - **Trigger:** A1 asks for the `thunder-strike` sound.
  - **Actors:** A1, A4, A5
  - **Steps:** The studio offers synth presets and mutation, an editable parameter panel with re-render on change, and, when a local LLM endpoint is configured and loaded, "propose variations"; optionally a local SFX model produces organic layers; A1 picks; parameters are committed and the compressed render plus loudness metadata are derived.
  - **Outcome:** The event has a sound the client can play, reproducible from committed parameters.
  - **Covered by:** R22, R23

---

## Requirements

Tiers: **T1** Zeus on screen (success criterion 1); **T2** visual reference scene (art only, no sound); **T3** world tiles and sound. Tiers ship independently and in order; T2 is complete without any T3 item.

**Asset contract and registry**
- R1. [T1] Every asset carries the metadata content-direction.md requires: dimensions, pixel scale, origin/pivot, collision footprint, facing, animation states and timing, palette family, and style tag; portraits carry character identity and expression set; tiles carry orientation, layer, and occlusion rules; effects carry tier. The states list is versioned data so M3 can change it.
- R2. [T1] Every asset carries a provenance record: creation method (generated, hand, derived), source assets, generation inputs (request, model, LoRA, seed, settings), runtime version, result hashes, hand-edit steps, cancelled jobs, and licence/attribution for every input including model weights.
- R3. [T1] A versioned, content-addressed registry maps stable asset IDs to atlas files and manifests; the god profile's existing `sprite` field is the stable ID for actors; the client resolves registry URIs through it; the deterministic placeholder is the fallback for any unresolved ID or state. The registry URI scheme must not collide with Tauri's `asset:` protocol.
- R4. [T1] Registry entries, manifests, and subject-to-asset mappings (`content/greek/assets/`) are plain files under version control, readable without the studio, and validated by a validator the studio lane adds to `tools/content` (a placeholder today).

**Generation**
- R5. [T1] Image and sound providers each implement a per-kind interface and share one job queue and provenance envelope; procedural derivation is a library step, not a provider; hosted providers implement their kind's interface but none is wired, keyed, or required; a provider whose binary or weights are missing reports unavailable and the queue surfaces the staging step.
- R6. [T1] The default image chain uses open-weights models and LoRAs whose licences permit redistributing outputs under this repository's MIT licence (no non-commercial or share-alike terms on outputs), measured on the M1 Pro 16 GB baseline; the fallback order is an Apache chain (FLUX.2-klein-4B or Z-Image-Turbo with a pixel LoRA), then SDXL + `pixel-art-xl` (RAIL-M, outputs free), then no-LoRA prompting plus conformance; the M0 PixelArtRedmond chain is excluded from canon.
- R7. [T1] Generation specs are built from the content pack and the art guide, not typed by hand: subject identity, domain motifs, palette family, cell, pivot, and directions come from data; visual fields the god profile lacks are added additively to `packages/content`.
- R8. [T1] Generation runs asynchronously with a visible queue showing per-job progress; queued jobs can be removed; an in-flight job can be aborted by restarting the generator subprocess (ADR-0007: no HTTP cancel), recorded as cancelled, never as a result; the queue runs one heavy model (image chain, LLM, or SFX model) resident at a time and unloads before switching; the studio stays responsive and shows the placeholder for any pending slot.

**Conformance and cleanup**
- R9. [T1] Every candidate passes automatic conformance before approval: pixel grid recovered to the guide's scale, palette locked to the asset's family, canvas and pivot correct, binary alpha, and a report of what changed; a low-confidence grid detection asks the owner for the scale instead of guessing.
- R10. [T1] The studio opens any draft in Aseprite as a tagged document with the asset's palette, frame tags, and pivot/footprint slices, and re-imports the saved file without loss; when Aseprite is absent, `open` fails with a clear message and every other step runs.
- R11. [T1] A re-imported edit re-runs conformance in report-only mode and shows a pixel diff against the previous version.
- R12. [T1] Hand edits are recorded as provenance steps and never changed by an automatic step without the owner's confirmation; the headless CLI fails rather than confirm on the owner's behalf.

**Derivation**
- R13. [T2] From an approved set the studio derives deterministically where the guide allows: mirrored east/west directions, idle bob, realm palette swaps, and damage or fire overlays for structures. Walk and act cycles are not derived.
- R14. [T2] Frames derivation cannot produce are hand-drawn via F2 or requested as reference-conditioned generation plus inpaint repair; such frames enter the same contact-sheet review as F1.
- R15. [T2] A derived batch is reproducible from its manifest alone; regenerating with the same inputs yields byte-identical derived frames; output encoders are pinned for determinism.

**Studio app and preview**
- R16. [T1] `apps/studio` shows the asset in a representative scene at the game's integer zoom levels with nearest-neighbour upscaling, using the deterministic placeholder for context elements (backdrop, neighbouring tiles, scale reference) until authored equivalents exist; drafts and approved sets can be previewed, not only canon.
- R17. [T1] The preview live-reloads a changed asset without restarting the studio.
- R18. [T1] The CLI exposes every pipeline step (`generate`, `conform`, `open`, `derive`, `pack`, `publish`); the app and the CLI call the same `@panthea/assets` functions and neither implements a step itself; `apps/studio` hosts the pipeline as a Bun sidecar following the `panthea-sim` pattern, and its webview holds no shell or filesystem permissions.

**World tiles and effects**
- R19. [T3] Autotile sets are produced by procedural stamping from seamless base textures with isometric diamond masks (dual-grid first), exported as Tiled tilesets with Wang metadata, and render edge-consistent and depth-sorted in the studio preview.
- R20. [T1→T3] The Zeus reference scene asset set is the first target. T1: Zeus `idle` south, `seated` (on a cloud, body partly obscured), one `act` (strike) sequence, and the six-expression portrait. T2: one tree, one building in `intact`, `damaged`, and `burning` states, lightning effect frames at three tiers, and the remaining idle directions. T3: the `thunder-strike` sound (R22), alongside world tiles (R19). Walk cycles and facing-driven states wait for actor position and facing in the contracts, owned by the core lane.
- R21. [T2] Effects ship in three intensity tiers, tier one lowest; reduced-effects mode presents the same event with tier one (X03).

**Sound**
- R22. [T3] Procedural sound effects are authored as synth parameter sets from presets, mutation, and an editable parameter panel; a configured local LLM endpoint may propose variations but is optional; parameters are the committed source and the rendered compressed file is derived.
- R23. [T3, deferred] An optional local SFX model may add organic layers once a sound the synth cannot produce is identified; its weights follow R2's licence recording and R5's on-demand acquisition, with attribution carried into provenance.

**Working alongside the core agent**
- R24. [T1] Studio work lives in its own worktree and branch; `packages/contracts`, `packages/assets`, `packages/content`, and `tools/content` are shared-additive and change in small PRs merged before dependent work; `content/greek/gods/*` is edited only with the core lane's agreement, and the studio writes its mappings in `content/greek/assets/`; `packages/world`, `packages/agents`, `packages/persistence`, `apps/simulation`, and `tools/scenarios/m1-*`, `m2-*` are not edited without agreement; `apps/desktop` capability changes and the renderer extraction (Dependencies) are coordinated PRs.

---

## Acceptance Examples

- AE1. **Covers R3, R16.** Given a registry entry for `zeus` with `idle-south` canon and `seated` missing, when the preview shows Zeus seated, the deterministic placeholder draws that state and the canon sprite draws idle-south; no error is raised.
- AE2. **Covers R9.** Given a 512×640 candidate whose underlying pixel grid is 8× the guide scale with 71 colours, when conformance runs, the output is 64×80 at 1× with at most the palette family's colour count, binary alpha, and the report lists the detected scale, colours merged, and pixels moved.
- AE3. **Covers R11, R12.** Given a hand-edited draft, when the owner changes the palette and reruns conformance, the studio shows the diff and asks before replacing hand-edited pixels; the headless CLI exits non-zero with the diff instead.
- AE4. **Covers R13, R15.** Given an approved east-facing idle frame, when the owner requests west, the studio mirrors it according to the guide's asymmetry rules, and running the derivation twice produces identical bytes.
- AE5. **Covers R5, R6.** Given no API key and no image weights present, when the owner generates any asset, the image provider reports unavailable with the staging step and nothing fails; given weights present, generation completes locally and provenance records model and LoRA licences; hosted providers list as unavailable.
- AE6. **Covers R8.** Given three generation jobs queued, when the owner removes the second and aborts the first, the first is recorded as cancelled, the third starts after the generator restarts, and the UI stayed responsive throughout.
- AE7. **Covers R21.** Given the lightning effect at three tiers, when reduced-effects mode is active in the preview, the strike shows tier one and the building still ends burning.
- AE8. **Covers R22.** Given committed synth parameters for `thunder-strike`, when the rendered file is deleted and the pipeline reruns, the regenerated file is byte-identical.
- AE9. **Covers R18.** Given the same request and seed, when run through the CLI and through the app, the candidate bytes and conformance reports are identical.

---

## Success Criteria

1. The owner can submit one request and, within one sitting, have a canon Zeus idle-south, seated pose, and portrait drawn in the game client over the placeholder, with provenance that would survive a licence audit. (T1) (2026-10-10, owner: the game client path does not wait for this criterion. Seated, strike and the timed sitting are queued studio work, and the game draws placeholders until they are published. See `docs/plans/2026-10-10-002-feat-packaged-game-canon-art-plan.md`.)
2. Every canon asset's bytes are committed with a manifest whose provenance chain is complete; derived and procedural assets regenerate byte-identically; no canon asset depends on a non-commercial or unverifiable licence.
3. The core agent's velocity is unaffected: studio PRs touch shared packages additively and merge without rebasing world or agent code. (2026-10-10, owner: an agreed exception is that the actor sprite id is added to world state for the game client path.)
4. A planner reading this document and the research summary can sequence the work by tier without inventing product behaviour, interaction states, scope, or the art guide's defaults.

---

## Scope Boundaries

### Deferred for later

- Walk cycles and facing-driven states, until actor position and facing exist in the contracts and the world view model (core lane).
- Eight-direction characters; the MVP guide uses four directions with mirrored east/west.
- In-game runtime generation (M4, U06/U07) reuses the provider interfaces and registry but is not built here; the ADR-0005 coexistence gate still governs it.
- Hosted image or sound providers wired and keyed.
- Models that need more than 16 GB (Qwen-Image-Edit angle LoRAs, Wan 2.2 pixel animation); documented in research only.
- The optional SFX model (R23), a 47-tile blob autotiler, and map authoring inside the main app.
- An embedded pixel editor in the studio; Aseprite is the editor for now.
- Spoken voices, video export, and pantheon-agnostic style transfer for future content packs.

### Outside this product's identity

- A general-purpose AI art tool or an asset marketplace; the studio exists to make Panthea's assets conform to Panthea's guide.
- Training or fine-tuning models in this repository.
- Copying or restyling existing commercial game art (content-direction.md).

---

## Key Decisions

- Hybrid pipeline over diffusion-first or rig-first: diffusion makes candidates, the owner makes them canon, derivation covers what it can guarantee (mirror, swap, overlay, bob), and new poses are hand-drawn or generated and repaired. The earlier claim that walk cycles derive from bob rules is withdrawn.
- Tier 1 is idle, seated, strike, and portrait: owner decision 2026-10-03, after review showed the client cannot drive movement and the reference scene never walks.
- Separate `apps/studio` Tauri app hosting the pipeline as a Bun sidecar: owner decision 2026-10-03 for the app; the sidecar follows the repository's `panthea-sim` pattern so the webview keeps no shell or filesystem permissions.
- Aseprite as the human-loop editor: owner decision 2026-10-03; owner-installed, scriptable headless, outside the repository.
- Local-only generation with hosted providers behind the interface: owner decision 2026-10-03, consistent with the no-purchases invariant and offline-first.
- M1 Pro 16 GB is the authoring ceiling: owner decision 2026-10-03; heavier models are documented, not built.
- Studio heavy-work rule: one heavy model resident at a time; the ADR-0005 coexistence problem is avoided by serialising, not by assuming a free budget.
- Procedural stamping for tiles over diffusion-native Wang tiles: no open model produces edge-consistent isometric sets; stamping is deterministic and small.
- Parameters are source for sound; presets and mutation are the baseline and an LLM is optional.
- The art guide is drafted now (`docs/product/art-guide.md`) with defaults the owner can veto; the master palette is an owner gate before the first canon approval.
- Narrows D18 and D24 for assets only: an owner-facing authoring app for art and sound is in scope; player-facing in-game editors remain deferred. Recorded as D26 in `docs/product/decisions.md`.
- ADR-0007 gets a supersession note when the new probe lands; its measurements and placeholder contract stand.

---

## Dependencies / Assumptions

- Assumption: the current stable-diffusion.cpp macOS arm64 release ships Metal (the M0 probe's release binary did); build from source only if the probe finds otherwise. The probe's pass criteria: the LoRA fires (fixed-seed with/without differ) at a quantization whose peak RSS leaves headroom for the studio, at the guide's cell size, with a stated seconds-per-image bound.
- Dependency: a shared renderer. The current client scene (`scene.ts`) is a radial marker layout with antialiasing and device-pixel-ratio scaling; it has no tile layer, isometric placement, or integer-zoom target. The isometric sprite/tile layer is new code the studio lane owns; T1 preview uses it directly through three-flatland; extracting it into a shared package the client adopts is a coordinated unit with the core lane. three-flatland's isometric `TileMap2D` support is unverified.
- Dependency: the packaged client needs a defined runtime location and loading path for registry files (bundled resource or app-data directory, Tauri asset protocol scope or a sidecar command); the `apps/desktop` capability change is a coordinated PR.
- Dependency: the master palette (`.gpl`/`.hex`, at most 64 colours) is committed and owner-approved before any asset is marked canon; drafts conform against a provisional palette and are re-quantised on approval with the owner's confirmation.
- Dependency: model weights, LoRAs, and generator binaries are downloaded on demand with pinned identifiers, sha256, and licence recorded in the repository (the M0 probe pattern); none is vendored.
- Dependency: Aseprite installed and on `PATH` on the owner's machine.
- Dependency: new third-party packages need owner approval; the research doc lists candidates with licences and lighter alternatives, and the quantizer is written in TypeScript rather than imported.
- Assumption: owner review time, not agent time, is the T1 bottleneck; contact sheets and Aseprite passes are sized for one sitting at roughly 90–120 s per candidate until the probe measures otherwise.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R6][Needs research] Which chain in the fallback order passes the probe criteria on the M1 Pro, and at what seconds-per-image and peak RSS?
- [Affects R9][Technical] TypeScript grid detection and k-centroid implementation versus shelling out to the MIT Rust `pixel-art-fixer` when confidence is low.
- [Affects R10][Technical] Confirm the installed Aseprite round-trips slices and tags losslessly via `-b --script`.
- [Affects R19][Needs research] Whether three-flatland renders isometric tilemaps or only declares the type; the depth-sort approach (`x + y − z` to render order).
- [Affects R3][Technical] Registry URI scheme name and resolution to webview-safe URLs; runtime location of registry files for the packaged client.
- [Affects R22][Technical] zzfx versus jsfxr as primary synth; both may ship.
- [Affects R24][Process] The new requirement ID for authoring tooling, to be proposed in the implementation plan. Traceability rows U06, U07, U08, X02, X03, and X05 already link this work and are updated by each studio PR.
- [Affects R16][Process] Whether T1 must land before M2 exit or the studio lane is unconstrained by roadmap gates.

---

## Sources / Research

- `docs/research/asset-generation-2026-10-03.md`: the distilled survey behind the model, cleanup, tile, sound, and editor choices, with licences and candidate packages.
- `docs/product/art-guide.md`: draft visual standards the conformance step enforces.
- `docs/product/content-direction.md`: asset metadata and provenance obligations; the Zeus reference scene (seated on a cloud, strike, portrait expressions).
- `docs/product/decisions.md` D14, D15, D18, D24: presentation, generation priority, and the authoring-UI decisions this work narrows.
- `docs/decisions/0007-local-image-generation.md`, `tools/probes/art-local/README.md`: the M0 base arm, LoRA licence caveat, cancellation limits, deterministic placeholder contract.
- `docs/decisions/0005-model-providers.md`: the coexistence gate governing in-game generation.
- `apps/client/src/renderer/scene.ts`, `markers.ts`, `apps/client/src/store.ts`: the current marker rendering and the view model without positions or facing.
- `apps/simulation/scripts/build-sidecar.sh`, `apps/desktop/src-tauri/capabilities/`: the sidecar and capability patterns the studio app follows.
- `packages/content/src/god-profile.ts`: the `sprite` field that becomes the stable actor asset ID.
- `packages/assets/src/index.ts`, `tools/content/src/index.ts`: the placeholders this work fills.
