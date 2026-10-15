# 0009: Asset registry, lifecycle and logical URIs

## Status

Accepted (2026-10-04) for the Unit 2 foundation of the asset studio plan. Later units build on it; the boundaries below say what it does not do.

## Context

A delegated implementation decision under D26 and the approved [asset studio plan](../plans/2026-10-03-001-feat-asset-studio-foundation-plan.md), Unit 2. Requirements: R1–R5, R7, R12, R18, R24; U06–U08, X02. Every unit after it (conformance, palette gate, CLI pipeline, studio, packaged client) reads and writes these shapes, so they are fixed first, in shared-additive packages.

## Decision

**Identity.** Asset ids are lowercase hyphenated (`placeholder-zeus`). Hashes are lowercase 64-hex sha256. `panthea-asset://asset/<id>` and `panthea-asset://placeholder/<sha256>` are logical identifiers resolved through the registry; they are not a webview protocol and cannot collide with Tauri's `asset:` scheme. A god's stable sprite id stays `GodProfile.sprite`.

**Contracts** (`@panthea/contracts`, pure: no filesystem, no hashing).

- Manifests are versioned (`schemaVersion` 1), kind-discriminated and strict: unknown keys, versions, kinds or vocabulary terms fail with a field path. `sprite`, `portrait`, `effect` and `tile` follow [the art guide](../product/art-guide.md). A `tile` manifest is a dual-grid terrain set: `terrain` (`{base, over}`, two different slugs), `period` N (a positive integer) and the 64×32 tile cell. Its atlas is 16 columns (one per corner mask) by N² rows (one per offset in the N×N period), so 1024 px wide and N²·32 px tall; the cell for a mask and offset is frame `offset·16 + mask`, found by `tileAtlasRect`. `sound` is a reserved kind; its manifest arrives with the unit that defines synth semantics, and until then it is rejected as an unknown kind.
- States, directions, expressions, palette families, cell classes, frame counts and frame rates are versioned content data (`content/greek/assets/vocabulary.json`), not closed types. Manifests are checked against it: cell class per kind, states allowed per cell class, per-ability states, frame counts, per-frame durations within the state's frame rate, frames inside the atlas and the cell, pivot inside the cell, and an effect's glow colours as lowercase `#rrggbb`, each once.
- Provenance is discriminated `generated`, `hand`, `derived`, `rendered` or, for effects only, `procedural`. A rendered record belongs to a sprite or a tile. Its revision recipe is shared by every slot of the revision. A sprite slot names a state, clip and facing; a tile slot names its role, `base` or `over`, which is also its slot key, and a tile manifest needs one slot per role. Every slot records its recipe hash, seed 0, frame count and the blob hashes of its raw colour, id and depth frames. It records licences, related jobs (cancelled ones included, with no outputs), hand-edit steps, source assets and an optional owner exception with a reason. A generated record also carries request, runtime, model and LoRA hashes, seed, scalar settings and result hashes. A procedural record carries the generator id and version, the seed, integer parameters, the palette id and digest, and per-animation frame hashes; publish runs the generator again and refuses on any byte difference. A rendered record is audited the same way at publish, offline and without Blender: the revision recipe hash is recomputed from the committed profile, camera, kit, stamp set, script, post-step version, Blender pin and palette digest, and each slot's recipe hash from the revision hash and its own parameters; each slot must be backed by a succeeded job in the ledger whose raw frames are in the store and hash to their names. A sprite then has its post step run again from the raw frames, and each cell must be the one in the atlas. A tile re-posts each patch from its raw frames, uncropped and without an outline, and runs the patch gate (the patch repeats every N lattice steps along both lattice axes, byte for byte). It then crops the centre period and compares it with the cell hash its job recorded, stamps the set from the two patches, and compares every atlas cell, then the atlas hash, with the stored atlas. Any difference refuses publish. A published manifest is self-contained: the source job must be in its job refs, succeeded, and match the result hashes; every model and LoRA has a licence record; settings never carry credential-like keys or endpoint-like values.
- Generation jobs are records apart from assets: `queued`, `running`, `succeeded`, `failed`, `unavailable` (with a staging step) and `cancelled` (removed or aborted, with no outputs). Image and sound providers are separate interfaces with kind-appropriate outputs (image width and height; sound sample rate, channels and duration). A hosted provider's job can only be `unavailable`. No provider, queue or credential exists here.
- Lifecycle is a pure transition function over `candidate`, `draft`, `approved`, `canon` and `rejected`. A record owns the manifest it covers, so an approval is for exactly those contents. Editing is a draft substate: start and discard leave the manifest alone, and finishing swaps in the edited manifest, which must be the old one plus one appended hand-edit step in its provenance; it drops the draft's now-stale report. Approval needs a passing report or an owner exception with a reason, which lands in provenance. Rejection keeps provenance. Illegal transitions return an asset error result (`AssetResult`), not the world's rejection codes.

**Registry** (`@panthea/assets/registry`, the only module with `node:fs`; single writer, no locks).

- Layout under `content/greek/assets/registry/`: `blobs/<sha256>.png`, `manifests/<revision>.json` and `index.json`. A manifest is stored as its canonical JSON plus a newline; its revision is the sha256 of exactly those bytes. The index is `{ schemaVersion, entries: [{ assetId, revision }] }` sorted by id.
- Publishing is two phases. `writeRevision` validates the manifest and its blob, then writes the blob and manifest through temp files and renames; existing identical content is reused, and an existing file with different bytes is a corruption error that is never overwritten. `selectRevision` re-verifies the revision and replaces the one index atomically. `publishAsset` takes an approved record and an approved palette whose digest matches its id, colours and ramps. The manifest and its realm variants must reference that palette. These checks run before any writes; publication then uses exactly the manifest the record owns, runs both phases, and returns the canon record. A crash between the phases leaves the old index in use. Republishing selects a new revision and leaves the old bytes in place.
- `loadRegistry` returns a snapshot plus problems. An entry that fails any check is left out, so lookups for it fall back; temp files and unreferenced revisions are ignored.

**Lookup** (`@panthea/assets`, no filesystem). `resolveAsset` takes a snapshot and a sprite id with optional state, direction, ability or expression (defaults: idle, south), or, for a tile set, a `{mask, offset}` cell. It returns canon frames, or the deterministic placeholder with a reason: missing id, missing state (including a mask or offset outside the set), or wrong kind. A tile lookup returns the one atlas cell as a still frame.

**Placeholder.** The M0 renderer moved from `tools/probes/art-local` to `@panthea/assets`. Its PNG bytes, dimensions and hashes are unchanged (characterized before the move); only the URI scheme changed to `panthea-asset://placeholder/<sha256>`. The PNG encoder uses `node:zlib` and the hash helper `node:crypto`: the package is for Node and Bun, not the browser.

**Visual profiles.** `GodVisualProfile` (`content/greek/assets/subjects/<god>.json`) holds palette family, iconography and an optional portrait id, joined to the god profile by god id. Iconography lists only what the god carries or wears, never scenery: studio prompts add it to every portrait and sprite, which use a flat background. `GodProfile` and the god JSON files are unchanged.

**Validator.** `bun run --cwd tools/content validate:assets` checks the vocabulary, matching GPL/HEX palette entries, realm ramps, approval digest, god sprite ids, visual profiles and the registry (index, canonical manifests and revisions, blob hashes and PNG sizes, ability references against the owning god, kind and character references, provenance consistency). Canon entries must reference the approved palette; this metadata check does not verify atlas pixel colours. Exit 0 is valid, 1 invalid with `<file>: <message>` lines, 64 usage. A partial canon is valid, and an empty registry may use a draft palette.

## Boundaries

Not in this decision: sound manifest fields; job queue, scheduling, abort and restart; provider implementations; pixel conformance and its reports; Aseprite editing; derivation; storing authoring records (candidates, drafts, request ledgers); packaged-client loading and the desktop capability; the studio UI. The committed registry holds only published revisions; palette and asset approvals remain explicit owner actions.

## Consequences

- Later units add fields or kinds by bumping `schemaVersion` and the vocabulary version; no compatibility layer exists for the unshipped format.
- Consumers read plain files and call a pure lookup; the studio is not needed to read canon.
- Authoring-record storage is Unit 5's to define; this unit validates the published manifest from plain files alone.

## Evidence/links

[Plan Unit 2](../plans/2026-10-03-001-feat-asset-studio-foundation-plan.md), [terrain tiles plan](../plans/2026-10-14-001-feat-terrain-tiles-plan.md), [requirements](../brainstorms/2026-10-03-asset-studio-requirements.md), [art guide](../product/art-guide.md), [ADR-0007](0007-local-image-generation.md) (placeholder contract), [content/greek/assets/README.md](../../content/greek/assets/README.md).

## Requirement IDs

U06, U07, U08, X02.
