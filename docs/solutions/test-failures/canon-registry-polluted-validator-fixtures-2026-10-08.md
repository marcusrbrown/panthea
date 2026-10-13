---
title: The first canon publish broke the asset validator tests
date: 2026-10-08
last_updated: 2026-10-08
category: test-failures
module: assets
problem_type: test_failure
component: testing_framework
severity: medium
symptoms:
  - "Seven validator tests failed right after zeus-portrait was published to canon"
  - "Cross-reference tests got 2 diagnostics where they expected 1"
  - "Biome failed lint on the studio-written registry JSON"
root_cause: test_isolation
resolution_type: test_fix
tags: [assets, validator, fixtures, canon-registry, biome, content-addressing, test-isolation]
---

# The first canon publish broke the asset validator tests

## Problem

`contentRoot()` in `tools/content/src/assets.test.ts` built each "isolated" scenario by copying the whole committed `content/greek/assets` tree. That worked only while the canon registry was empty. Once `zeus-portrait` was published and `subjects/zeus.json` gained `"portrait": "zeus-portrait"`, every scenario inherited real canon. `bun run --cwd tools/content validate:assets` on the real content still passed.

In the same change, `bun run check` failed lint because Biome wanted the studio's compact registry JSON pretty-printed.

## Symptoms

- Seven failures. Three palette scenarios picked up the real portrait. A broken-registry scenario saw extra entries. Three cross-reference scenarios got 2 diagnostics where they expected 1.
- Biome reported formatter errors on `registry/index.json` and on the manifest named by its own sha256.

## What Didn't Work

- **Copying the committed tree wholesale.** It is hermetic only while canon is empty.
- **Loosening assertions to `>= 1`.** That would hide the coupling.
- **Reformatting the manifest.** The file name is the sha256 of its exact bytes, so pretty-printing breaks its address. The next publish would write compact JSON again anyway.

```ts
// before
cpSync(join(COMMITTED, "assets"), join(dir, "assets"), { recursive: true });
```

## Solution

- The fixture skips the committed registry, writes its own empty `index.json`, and strips `portrait` from each copied subject.
- The same coupling came back when `zeus-sprite` was published (#188) and `gods/zeus.json` mapped `sprite` to it. The fixture now also gives every god whose sprite is in the committed registry its `placeholder-<id>` back. `apps/studio/src/source/_testkit.ts` copies only the `zeus-portrait` entry its tests expect, not the whole registry.
- Three tests pin the boundary:
  - every mapped portrait in committed content resolves to canon;
  - every published god sprite resolves to canon;
  - the fixture really is empty-canon, with no portrait mappings and placeholder sprites restored, and is still valid.
- `biome.json` excludes `content/greek/assets/registry`. The studio owns those bytes, `canonicalJson` and `canonicalManifestText` write them, and `validate:assets` checks them.

```ts
// after
cpSync(join(COMMITTED, "assets"), join(dir, "assets"), {
  recursive: true,
  filter: (source) => source !== committedRegistry,
});
```

## Why This Works

Committed-content tests assert real canon. Scenario tests start from a canon state they control, however much has been published.

## Prevention

- Every new kind of canon mapping needs the same fixture treatment. Check fixture builders whenever a publish adds one.
- Never let fixtures copy mutable committed data that a scenario's expectations depend on. Build that state explicitly.
- Give fixture builders self-tests for their isolation guarantees.
- Exclude content-addressed or canonical generated files from formatters.
- The validator runs as `bun run --cwd tools/content validate:assets`. The repo root has no `validate:assets` script.

## Related Issues

- [Incomplete PNGs pass hash and header checks](../integration-issues/incomplete-pngs-pass-hash-and-header-checks-2026-10-04.md): the same registry and validator surface.
- [Client view presentation against invented fixtures](../logic-errors/client-view-presentation-against-invented-fixtures-2026-09-28.md): build fixtures deliberately.
- ADR-0009, asset registry lifecycle.
- PR #174.
