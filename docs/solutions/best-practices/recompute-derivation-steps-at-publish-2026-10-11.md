---
title: Recompute derivation steps at publish and tie realm variants to their steps
date: 2026-10-11
category: best-practices
module: assets
problem_type: design_pattern
component: tooling
severity: high
applies_when:
  - "Adding a deterministic image transform that published asset cells depend on"
  - "Carrying derived or realm-variant cells into a later revision"
  - "Accepting a manifest that records how a cell was made"
tags: [derivation, provenance, publish, mirror, palette-swap, realm-variant, canonical-params]
---

# Recompute derivation steps at publish and tie realm variants to their steps

## Context

#210 added deterministic derivation from published sprites: an east→west mirror, a realm palette swap, and an idle bob. A manifest records each derived slot as a step in `provenance.steps`: recipe, version, canonical params, source `(assetId, revision, slotKey, slotHash)`, output slot and result hash.

Review, before merge, found that each check comparing the record with itself could be satisfied by a wrong record:
- A palette-swap draft passed conformance with zero checks. Every main cell was carried, and the variant was never measured.
- A later pack dropped the steps of carried derived cells. That left a stale mirror with no record of what it was.
- A realm variant's colour map was not tied to its swap step, so a forged map entry survived publish.
- A step's source could be missing from `sourceAssets`, and the parser and `validate:assets` both accepted it.
- A `__proto__` key in step params was silently dropped and reparented the params object. The canonical bytes then no longer covered the params.
- Finishing a derived bob by hand lost its params.

## Guidance

1. **Recipes are pure.** `packages/assets/src/studio/derive.ts` takes source frames, params and the subject's declarations. It returns frames plus steps, or a typed refusal.
   - Mirror refuses a declared asymmetry, an off-centre pivot or a non-square footprint.
   - Bob runs on idle only.
   - Walk and act are never derived.
   - Output goes through the pinned encoder after RGB under alpha 0 is zeroed.
2. **Publish recomputes every step from its published source** (`auditDerivation` in `packages/assets/src/studio/derivation.ts`). It doesn't trust the stored bytes or the stored hash:

   ```ts
   const again = recomputeStep(step, { source, content: audit.content, subject: audit.subject });
   if (!again.ok) return `${named}: ${again.message}`;
   const made = again.steps[0];
   if (made === undefined || !sameStep(made, step))
     return `${named}: recomputing it from its published source gives a different step (...)`;
   ```

   Because recompute goes through the recipe, a mirror published before the subject declared an asymmetry is refused at the next publish.
3. **A realm variant's map is its step's map.** Publish refuses a variant whose map differs from the map derived from its palette-swap step. It also checks the variant atlas is the packed atlas recoloured under that map (the realm-variant loop in `auditDerivation`). Pack regenerates variants from the new source atlas and never carries a variant atlas forward.
4. **Measure what the draft will publish.** Pack measures recoloured variant cells against the target realm's palette, so a swap draft can't pass on zero checks.
5. **Steps travel with their cells.** When a pack carries a derived cell or a variant, it copies the cell's step into `provenance.steps`, adds the step's source to `sourceAssets`, and carries its licences. That holds on both derived and generated revisions. The east/west mirror check runs whenever either side of the pair is new in the pack, so a carried mirror that no longer matches its east fails.
6. **The parser holds the record together.** Every step source must appear in `sourceAssets`. Params never carry a `__proto__` key (`parseCanonicalParams` in `packages/contracts/src/assets.ts`).
7. **A hand edit ends a derivation.** Finishing a hand edit on a derived slot turns it into a hand step. Its description keeps the recipe, params, source slot hash and result hash as history, and the slot is no longer recomputed.

## Why This Matters

Derivation is deterministic, so a recorded step can be checked by redoing it. A record that only describes itself can be stale, forged, or empty and still look valid. Recomputing at the publish gate makes the published manifest the one thing that is checked, and asset-studio R15, reproducible from the manifest alone (`docs/brainstorms/2026-10-03-asset-studio-requirements.md`), becomes something a test proves rather than something the record asserts.

## When to Apply

- Any transform whose output is published and whose inputs are already published.
- Any pack that carries cells forward from an earlier revision.
- Any manifest field that claims how pixels were made.

## Examples

Tests that pin each rule:
- `packages/assets/src/studio/derivation.test.ts`:
  - derive → pack → approve → publish on an isolated registry;
  - recipe-only regeneration produces byte-identical output;
  - "a swap draft's report measures the recoloured variant against the target realm's palette, so it is never an empty pass";
  - "a forged extra entry in a realm variant's colour map is refused at publish";
  - the describe block "a generated revision carries the steps of the derived cells it keeps";
  - a stale carried mirror fails the mirror check;
  - a hand-finished bob keeps its full step (params, source slot hash and result hash) in the hand step's history.
- `packages/contracts/src/assets-manifest.test.ts`: a step whose source revision is not among the source assets; a `__proto__` key in a step's params.
- `packages/assets/src/studio/derive.test.ts` and `derive.golden.test.ts`: the recipes' refusals and golden bytes.

Limits stated in `docs/evidence/asset-studio/unit9/README.md`: no repair job has run on a GPU, and nobody has approved and published a derived draft in the packaged window.

## Related

- `docs/solutions/best-practices/scripted-art-edits-record-method-script-provenance-2026-10-08.md`: provenance that says how pixels were made.
- `docs/solutions/logic-errors/transparent-rgb-bytes-broke-grid-recovery-2026-10-05.md`: why RGB under alpha 0 is zeroed before hashing and encoding.
- `docs/evidence/asset-studio/unit9/README.md`.
