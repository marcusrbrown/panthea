# 0011: Game canon art loading

## Status

Accepted (2026-10-10) for the [packaged game canon art plan](../plans/2026-10-10-002-feat-packaged-game-canon-art-plan.md), which is the child plan for foundation Unit 8. It extends [ADR-0009](0009-asset-registry-lifecycle-and-uris.md) and reverses one sentence of it (below). The foundation Unit 8 text it replaces is listed under Supersession.

## Context

A delegated implementation decision under D26 and the approved plan, with owner agreements recorded 2026-10-10: edits to `packages/world`, `apps/simulation` and the client (R24), the native loader with the `sha2` crate, the client keeping its place layout on the shared pixel core, and seated and strike art not gating this work. Requirements: R3, R4, R20 (published subset), R24 and AE1 (asset studio requirements); product rows U07, U08, X02.

The studio could publish canon (`zeus-sprite` idle-south, four frames at 333/167/333/167 ms; the six-expression `zeus-portrait`), but the packaged game could not show it:

- Nothing in world state or the frame said what an actor looked like, and a lookup keyed by actor id could not cover mortals minted at runtime.
- `resolveAsset` and the placeholder imported `node:crypto` and `node:zlib`, so the webview could not use them.
- The desktop app bundled no content and had no command that read assets.
- The client drew 28×36 canvas markers with antialiasing, sRGB textures and a device pixel ratio of up to 2, none of which is pixel-exact.

## Decision

**Native loader** (`apps/desktop/src-tauri/src/canon.rs`). Rust does integrity and containment and nothing else.

- At startup `CanonStore::load_for` reads every file under `registry/manifests` and `registry/blobs`, plus `registry/index.json` and `vocabulary.json`. A manifest or blob is kept only when the sha256 of its bytes equals its `<sha256>.<ext>` file name. Anything else is dropped and listed as a problem whose path is relative to the root, never absolute. The set is immutable after load.
- Every path is joined to the canonical root, canonicalized (resolving `..` and symlinks) and required to stay inside it. A file or directory that resolves outside is refused and nothing outside is read. Entries must be regular files.
- Blob bytes are held in memory, so serving one never touches the disk and a file swapped after verification cannot be served.
- Rust parses no manifest. The schema has one definition, in TypeScript.
- A missing or unreadable registry is an empty set plus a problem, never a failed start.
- The root is the app's resource directory in release builds (`bundled`) and the repo's `content/greek/assets` in debug builds (`repo`), so `tauri dev` works. `rootKind` reports which, as the lowercase strings `"repo"` and `"bundled"`.
- `tauri.conf.json` places the files with the `bundle.resources` map form: `content/greek/assets/registry/` at `registry/` and `content/greek/assets/vocabulary.json` at `vocabulary.json`.
- Measured startup verify time: the loader's own `CanonStore::load` over the committed registry (2 manifests, 2 blobs, 0 problems) took 0.65 ms on its first call and a median of 0.31 ms over 30 loads, in a release build on an M1 Pro. That is a standalone harness that compiled `canon.rs` against the committed files, not a timing taken inside the app, and the later loads ran with the files in the page cache. Canon is two assets today; the cost grows with the file count and bytes, and nothing here bounds it.

**Two named commands**, in `commands.rs`, each with an entry in `capabilities/proxy.json` and in `build.rs`'s app manifest:

- `canon_registry` returns `{ index, manifests, vocabulary, rootKind, problems }`, camelCase. `index` and `vocabulary` are text or null. `manifests` is a list of `{ hash, text }` for the manifests that verified. `hash` is the file stem the bytes were checked against, which is the revision the index names, so the webview matches index revisions to manifests by that hash and hashes nothing itself. `problems` is a list of `{ path, reason }`.
- `canon_atlas(hash)` takes a 64-lowercase-hex hash and returns the bytes as an `ipc::Response` (the studio's `preview_bytes` precedent, [ADR-0010](0010-studio-app-host.md)), only when the hash is in the verified blob set. A malformed hash and a well-formed hash outside the set are both refused before anything is read.
- The webview sends a command name and a hash, never a path. The desktop CI `rust` job also runs `cargo test --locked`, matching the studio's job.

**The webview parses the schema.** `apps/client/src/assets/canon.ts` parses the vocabulary, the index and each manifest with the contract parsers the node loader uses, and builds a `RegistrySnapshot`. A manifest is used only when an index revision matches a returned hash and its parsed id matches the index entry. A file that fails any step is dropped and reported once, and the rest still load. It fetches only blobs named by a parsed, selected manifest, once per hash, and keeps the bytes for the life of the app so a device-loss remount refetches nothing. With no shell (browser dev, fixture mode) the snapshot is empty and every actor is a placeholder. There is no watcher: canon changes reach the game on the next load.

**`ActorState.sprite`.** Each actor carries its sprite id in world state, set at genesis and carried by the codec in the encoded state the frame already ships, so the client never loads content to learn what an actor looks like.

- A deity takes it from `GodProfile.sprite` only. `withGodSprites` (`packages/content/src/load.ts`) folds each deity's profile sprite into the content pack at assembly, so `createInitialWorldState(pack)` keeps its signature. A deity with no god profile is refused, and a deity inhabitant that authors its own `sprite` fails content parsing.
- A non-deity inhabitant carries `sprite` in `content/greek/world/inhabitants.json`, `placeholder-<id>` until art exists. A mortal without one fails parsing.
- The world never reads `sprite` in a rule. It is presentation data the world carries.
- The store version is 7 (`CURRENT_SCHEMA_VERSION`, was 6). A store of any other version is refused at open and nothing is decoded, with no migration (greenfield). M3's own bump becomes 8.

**Browser-safe resolver subpath, which reverses ADR-0009 for that subpath only.** [ADR-0009](0009-asset-registry-lifecycle-and-uris.md) says of the placeholder: "the package is for Node and Bun, not the browser." That no longer holds for `@panthea/assets/browser`. Pure placeholder pixel generation moved to `placeholder-pixels.ts`, canon lookup to `resolve-core.ts`, and `resolveAssetPixels` returns canon or a pixel-only placeholder (width, height, RGBA), with no logical URI and no PNG bytes. `browser-bundle.test.ts` bundles the subpath for a browser target and fails if a `node:` module enters its import graph. The package root and the node resolver are unchanged: they keep `uri` and bytes, so the studio, the CLI and the validator behave as before, and the game's placeholder pixels equal the studio's. The rest of ADR-0009 stands. `panthea-asset://` stays a logical identifier in manifests and is not a webview protocol; the webview fetches atlases by verified content hash.

**Shared renderer package.** `packages/renderer` holds the pixel-exact core that the studio preview and the game both use: `iso`, `textures` (nearest, uncoloured atlas frames and a reference-counted store), `layer` (the depth-keyed sprite layer), `scene` (composition types), `view`, `decode`, and the GPU backend (`createGpuBackend`: a fixed-size nearest-filtered render target, an integer blit, `compileAsync`, readback). The backend takes the logical size as a parameter (the studio passes 480×270) and exposes a `decor` group in the same scene for plain meshes. `boundary.test.ts` fails if anything under `src` imports from `apps/` or `@tauri-apps`. The studio's own preview controller and source port stay in the studio.

The client adopts the core with its current place layout. Zoom is the largest whole number that fits the canvas, with no antialiasing, nearest filtering, and a backing store of exactly logical size times zoom in device pixels; this changes pixels on purpose. U5 chose a logical size of 576×592, derived in `apps/client/src/renderer/layout.ts`, and U6 owns the final size. Isometric place layout stays deferred to foundation Unit 11's tiles. Normal play shows idle-south; the inspection fixture is the only place that selects seated, act or a portrait expression, and a state with no art draws the shared placeholder (AE1).

**The scene presents first and compiles behind** (commit 7e0f7c2). The studio awaits `prepare()` (`compileAsync`) before its first render after a scene change, and the client first did the same. It does not any more. `compileAsync` yields to the main thread once per object, through animation frames where there is no `scheduler.yield` (WKWebView). With a few hundred decor meshes it outlasts the next committed frame, and in a hidden or occluded window it never settles. Gating the frame on it left every draw superseded before it presented, which is a blank stage. The client now renders at once, then runs one compile behind the frame and renders again when it settles; a scene change during a compile queues exactly one more, so a stream of views cannot stack compiles. The cost is that a frame rendered ahead of its compile can omit materials still compiling, and the follow-up render adds them. The studio's scene is a few sprites and keeps its order. This narrows the guidance in `docs/solutions/integration-issues/webgpurenderer-render-target-blit-and-compile-2026-10-08.md` ("compile before the first render after a scene change") for the game client only.

**Exactness is measured, not assumed.** The packaged inspection fixture (`apps/client/src/inspect`, reached with `?inspect=1`, `#inspect` or Alt+Shift+I) reads back the render target and the canvas at 1× to 4× and compares each frame's digest with the committed reference (`tools/scenarios/studio-zeus-scene/reference-digests.json`), which comes from a Node decode of the committed blobs. The digest is FNV-1a over 32 bits, pure TypeScript so the app and the generator run one function. The check fails for an empty or placeholder-only snapshot, for a root kind other than `bundled`, and for a backend other than WebGL2. WKWebView's own decode is never the reference.

## Supersession

The owner agreed each item on 2026-10-10. The same list goes into the foundation plan's dated note.

- "The renderer joins actor IDs to mappings … does not … modify world frames/store" and "no store/observer/settings changes" are replaced: the sprite id lives in world state and the frame, and the store version moves to 7.
- "Native commands resolve only IDs within that root" becomes: the webview addresses atlases by verified content hash, and `canon_registry` returns the whole verified set.
- "Validated actor-to-profile-sprite mappings": Rust does integrity and containment only, the webview parses the schema, and mappings come from the world state set at genesis.
- "Adopt shared isometric layer": the client adopts the shared pixel core, and isometric place layout is deferred.
- The verification "proves placeholder-zeus resolves to canon idle-south, seated-on-cloud, strike and all six portrait expressions" and the timed owner sitting become: canon idle-south in the live world, six portraits in the fixture, and seated and strike as placeholders. The art and the sitting are queued studio work. `placeholder-zeus` is corrected to `zeus-sprite`.
- "Default idle-south and existing committed event presentation drive normal rendering" becomes idle-only until strike art and an ability id on strike events exist.

## Consequences

- The shell reads and holds the whole verified registry in memory. That is cheap for two assets and grows with canon. A registry of many large atlases would want a lazy read by hash, which the hash-only `canon_atlas` already allows without a protocol change.
- The webview trusts the shell for integrity and the parser for shape. A manifest that verified but fails the parser is dropped in the webview, not the shell, so a schema change needs only a TypeScript change.
- A version-6 store, or any store of another version, is refused rather than migrated. Anyone with a world saved before this change moves the file aside to start a new one.
- The browser subpath is a second import surface for `@panthea/assets`. It stays honest only while `browser-bundle.test.ts` runs, and a future import of a node module there breaks that test, not the app.
- One shared renderer means a change to it moves the studio and the game together. The studio's full suite and its packaged build are the guard.
- Present-then-compile can show one frame that lacks materials still compiling. For a pixel scene of flat meshes and sprites that is a brief omission, not a wrong frame, but it is a change from the studio's guarantee.
- The inspection route exists in every packaged build. It reads no world state and sends no data, but it is a second entry point into the bundle.
- The reference digests are per frame and zoom. Adding an asset means regenerating them; the generator's test fails on any drift between the committed blobs and the committed digests.
- Pixel exactness on the packaged WebGL2 path is shown for the committed canon on one host (see the evidence below). WebGPU, other hosts, and the packaged device-loss path are not covered.
- Seated and strike art, the other gods and mortals stay placeholders until the studio publishes them.

## Evidence/links

[Plan](../plans/2026-10-10-002-feat-packaged-game-canon-art-plan.md), [packaged evidence](../evidence/asset-studio/unit8/README.md), [ADR-0008](0008-world-state-and-client-transport.md) (the frame carries the encoded state; the webview gets named commands only), [ADR-0009](0009-asset-registry-lifecycle-and-uris.md) (the registry and logical URIs; the browser sentence reversed above), [ADR-0010](0010-studio-app-host.md) (`ipc::Response` bytes, no custom URI scheme), [ADR-0002](0002-renderer-backend.md) (WebGL2 baseline), `apps/desktop/src-tauri/src/canon.rs`, `apps/client/src/assets/canon.test.ts`, `apps/client/src/inspect/inspector.test.ts`, `tools/scenarios/studio-zeus-scene/src/reference.test.ts`, `packages/assets/src/browser-bundle.test.ts`, [wkwebview WebGPU learning](../solutions/integration-issues/wkwebview-webgpu-unavailable-macos-15-2026-09-26.md), [device-loss learning](../solutions/integration-issues/three-webgpurenderer-device-loss-latch-2026-09-27.md).

Requirement IDs: U07, U08, X02 (W01 noted).
