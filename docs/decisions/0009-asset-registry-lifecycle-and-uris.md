# 0009: Asset registry, lifecycle and logical URIs

## Status

Accepted (2026-10-04) for the Unit 2 foundation of the asset studio plan. Later units build on it; the boundaries below say what it does not do.

## Context

A delegated implementation decision under D26 and the approved [asset studio plan](../plans/2026-10-03-001-feat-asset-studio-foundation-plan.md), Unit 2. Requirements: R1–R5, R7, R12, R18, R24; U06–U08, X02. Every unit after it (conformance, palette gate, CLI pipeline, studio, packaged client) reads and writes these shapes, so they are fixed first, in shared-additive packages.

## Decision

**Identity.** Asset ids are lowercase hyphenated (`placeholder-zeus`). Hashes are lowercase 64-hex sha256. `panthea-asset://asset/<id>` and `panthea-asset://placeholder/<sha256>` are logical identifiers resolved through the registry; they are not a webview protocol and cannot collide with Tauri's `asset:` scheme. A god's stable sprite id stays `GodProfile.sprite`.

**Contracts** (`@panthea/contracts`, pure: no filesystem, no hashing).

- Manifests are versioned (`schemaVersion` 1), kind-discriminated and strict: unknown keys, versions, kinds or vocabulary terms fail with a field path. `sprite`, `portrait` and `effect` follow [the art guide](../product/art-guide.md). `tile` and `sound` are reserved kinds; their manifests arrive with the units that define occlusion and synth semantics, and until then they are rejected as unknown kinds.
- States, directions, expressions, palette families, cell classes, tier range, frame counts and frame rates are versioned content data (`content/greek/assets/vocabulary.json`), not closed types. Manifests are checked against it: cell class per kind, states allowed per cell class, per-ability states, frame counts, per-frame durations within the state's frame rate, frames inside the atlas and the cell, pivot inside the cell, effect tier and at most four emissive accents, tier-one effects under 300 ms.
- Provenance is discriminated `generated`, `hand` or `derived`. It records licences, related jobs (cancelled ones included, with no outputs), hand-edit steps, source assets and an optional owner exception with a reason. A generated record also carries request, runtime, model and LoRA hashes, seed, scalar settings and result hashes. A published manifest is self-contained: the source job must be in its job refs, succeeded, and match the result hashes; every model and LoRA has a licence record; settings never carry credential-like keys or endpoint-like values.
- Generation jobs are records apart from assets: `queued`, `running`, `succeeded`, `failed`, `unavailable` (with a staging step) and `cancelled` (removed or aborted, with no outputs). Image and sound providers are separate interfaces with kind-appropriate outputs (image width and height; sound sample rate, channels and duration). A hosted provider's job can only be `unavailable`. No provider, queue or credential exists here.
- Lifecycle is a pure transition function over `candidate`, `draft`, `approved`, `canon` and `rejected`. A record owns the manifest it covers, so an approval is for exactly those contents. Editing is a draft substate: start and discard leave the manifest alone, and finishing swaps in the edited manifest, which must be the old one plus one appended hand-edit step in its provenance; it drops the draft's now-stale report. Approval needs a passing report or an owner exception with a reason, which lands in provenance. Rejection keeps provenance. Illegal transitions return an asset error result (`AssetResult`), not the world's rejection codes.

**Registry** (`@panthea/assets/registry`, the only module with `node:fs`; single writer, no locks).

- Layout under `content/greek/assets/registry/`: `blobs/<sha256>.png`, `manifests/<revision>.json` and `index.json`. A manifest is stored as its canonical JSON plus a newline; its revision is the sha256 of exactly those bytes. The index is `{ schemaVersion, entries: [{ assetId, revision }] }` sorted by id.
- Publishing is two phases. `writeRevision` validates the manifest and its blob, then writes the blob and manifest through temp files and renames; existing identical content is reused, and an existing file with different bytes is a corruption error that is never overwritten. `selectRevision` re-verifies the revision and replaces the one index atomically. `publishAsset` takes an approved record and publishes exactly the manifest that record owns, runs both phases, and only then returns the canon record. A crash between the phases leaves the old index in use. Republishing selects a new revision and leaves the old bytes in place.
- `loadRegistry` returns a snapshot plus problems. An entry that fails any check is left out, so lookups for it fall back; temp files and unreferenced revisions are ignored.

**Lookup** (`@panthea/assets`, no filesystem). `resolveAsset` takes a snapshot and a sprite id with optional state, direction, ability or expression (defaults: idle, south). It returns canon frames, or the deterministic placeholder with a reason: missing id, missing state, or wrong kind.

**Placeholder.** The M0 renderer moved from `tools/probes/art-local` to `@panthea/assets`. Its PNG bytes, dimensions and hashes are unchanged (characterized before the move); only the URI scheme changed to `panthea-asset://placeholder/<sha256>`. The PNG encoder uses `node:zlib` and the hash helper `node:crypto`: the package is for Node and Bun, not the browser.

**Visual profiles.** `GodVisualProfile` (`content/greek/assets/subjects/<god>.json`) holds palette family, iconography and an optional portrait id, joined to the god profile by god id. `GodProfile` and the god JSON files are unchanged.

**Validator.** `bun run --cwd tools/content validate:assets` checks the vocabulary, god sprite ids, visual profiles and the registry (index, canonical manifests and revisions, blob hashes and PNG sizes, ability references against the owning god, kind and character references, provenance consistency). Exit 0 is valid, 1 invalid with `<file>: <message>` lines, 64 usage. A partial or empty canon is valid.

## Unit 2 boundaries

Not in this decision: tile and sound manifest fields; job queue, scheduling, abort and restart; provider implementations; conformance and its reports; the master palette and its approval; Aseprite editing; derivation; storing authoring records (candidates, drafts, request ledgers); packaged-client loading and the desktop capability; the studio UI. No canon asset, palette or licence has been approved, and the committed registry is empty.

## Consequences

- Later units add fields or kinds by bumping `schemaVersion` and the vocabulary version; no compatibility layer exists for the unshipped format.
- Consumers read plain files and call a pure lookup; the studio is not needed to read canon.
- Authoring-record storage is Unit 5's to define; this unit validates the published manifest from plain files alone.

## Evidence/links

[Plan Unit 2](../plans/2026-10-03-001-feat-asset-studio-foundation-plan.md), [requirements](../brainstorms/2026-10-03-asset-studio-requirements.md), [art guide](../product/art-guide.md), [ADR-0007](0007-local-image-generation.md) (placeholder contract), [content/greek/assets/README.md](../../content/greek/assets/README.md).

## Requirement IDs

U06, U07, U08, X02.
