---
title: Scripted art edits record method script in provenance
date: 2026-10-08
category: best-practices
module: assets
problem_type: convention
component: tooling
severity: medium
applies_when:
  - "Finishing a studio edit whose pixels came from a script, not from work in an editor"
  - "Packing an asset whose frames were downscaled, cleaned or animated by code"
related_components:
  - contracts
tags: [asset-studio, provenance, scripted-edits, hand-edits, registry, studio-cli]
---

# Scripted art edits record method script in provenance

## Context

The studio recorded every `finish` as `hand edit <id>`. The r10c Zeus portrait cleanup was a script, but canon still says `hand edit …`, and only its evidence README tells the truth. The Zeus sprite (#188) was made entirely by scripts, from the downscale to the idle frames. Recording it the same way would have repeated the false label.

## Guidance

- **Finish scripted work with its method and what ran.**

  ```
  studio finish --id <edit> --png <sheet.png> --json <sheet.json> \
    --method script --description "<what ran, naming the scripts>"
  ```

  `--method` is `hand` or `script` and defaults to `hand`. `--description` is required for `script` and must not be empty. Both need `--png` and `--json`, so the Aseprite workspace flow is unchanged (`tools/studio/src/commands.ts`, `readStep`).
- **Contract.** `HandEditStep` has an optional `method: "hand" | "script"`, and a missing `method` means hand (`packages/contracts/src/assets.ts`). The parser accepts the old shape and adds nothing to it. That keeps content-addressed canon manifests, such as `zeus-portrait`, parsing to the same bytes, and nothing gets rewritten.
- **Packing** builds each step with `handStepOf(edit)` (`packages/assets/src/studio/export-import.ts`):
  - a scripted finish gives `{description, method: "script", hash}`;
  - a named hand finish gives its own description with no `method`;
  - a plain finish still gives `hand edit <id>` with no `method`.

  Pack's ancestry check compares the method as well, so a retried finish has to repeat the same step.

## Why This Matters

Provenance is how the project answers "who made these pixels, and how". Calling scripted work "hand edit" credits the owner with work they didn't do, and it hides the scripts that reproduce the asset. The fix keeps the old meaning for everything already recorded, so it needs no migration.

## When to Apply

- Any studio edit whose output a script produced: downscales, palette snaps, cleanups, outline passes, generated animation frames.
- For work done in an editor, omit `--method` for the plain `hand edit <id>` label, or pass `--method hand --description "…"` for a custom one.

## Examples

The Zeus sprite manifest records one step:

```json
{"description":"scripted re-key and palette-mode downscale (tools/probes/art-edit/run_sprite_c2a.py), face, bolt and cloth pixel edits (sprite_cleanup_c2b.py), selective outline recolour (sprite_cleanup_c2c.py), 4-frame idle (sprite_idle_c2.py)","hash":"f86c684a10f8c1825930fa895bee2d9ba6889ce5ba69e692a6fcc118b8ffdad4","method":"script"}
```

`packages/assets/src/studio/packing.test.ts` pins both sides:

```ts
expect(steps[0]).toMatchObject({ description, method: "script" });
expect(steps[0]?.description).not.toMatch(/^hand edit/);
...
expect(handStep?.description).toBe("hand edit e1");
expect(handStep && "method" in handStep).toBe(false);
```

## Related

- [Local 64x80 god sprites: palette downscale at any ratio](god-sprite-local-generation-open-research-2026-10-08.md): the route whose scripts this records.
- [Consistent portrait expressions from one masked base](portrait-expressions-from-one-masked-base-2026-10-08.md): the r10c cleanup, still labelled `hand edit` in canon.
- `docs/evidence/asset-studio/unit5/README.md`: the Zeus sprite section.
- PR #188.
