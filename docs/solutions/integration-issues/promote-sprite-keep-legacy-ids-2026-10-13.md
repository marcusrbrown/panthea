---
title: "Promoting a god's sprite: keep the old id in legacySprites"
date: 2026-10-13
category: integration-issues
module: assets
problem_type: integration_issue
component: tooling
severity: medium
symptoms:
  - "After Zeus's sprite was switched to zeus-retro, validate:assets refused the zeus-sprite act/thunderbolt animation: the ability sat on a sprite that was no longer any god's"
  - "Derivation's mirror lookup returned not-found for zeus-sprite instead of refusing it for Zeus's asymmetry"
root_cause: missing_association
resolution_type: code_fix
tags: [sprite-promotion, legacy-sprites, content-validation, derivation]
---

# Promoting a god's sprite: keep the old id in legacySprites

## Problem

Changing a god's `sprite` from one published asset to another broke two lookups that assumed each god owns exactly one sprite. The old sprite stays published so actors created before the promotion still resolve it. But its ability animations and its asymmetry were tied to "the sprite this god owns".

## Solution

In the same commit as the promotion, add the previous id to `legacySprites` in the god's subject file (`content/greek/assets/subjects/<god>.json`):

```json
"legacySprites": ["zeus-sprite"]
```

`content/greek/gods/zeus.json` keeps the current id: `"sprite": "zeus-retro"`.

The parser, the validator and derivation all read `legacySprites`. The parser is `packages/content/src/god-visual-profile.ts`, the validator's `legacyOwners` is in `tools/content/src/assets.ts`, and derivation's `subjectOf` is in `packages/assets/src/studio/derivation.ts`. A legacy sprite's ability is valid only for the god that lists it. The parser refuses:
- an empty list
- duplicates
- the god's current sprite
- an id another god lists

## Why This Works

The god-to-sprite association becomes one current id plus a declared list of earlier ids, and every lookup that needs ownership reads both. Old saves and actors stay valid, and the new sprite doesn't carry the old one's identity.

## Prevention

- Make a sprite promotion one commit: the god profile switch, the subject's `legacySprites`, goldens and inspection digests.
- After the content change, rebuild any packaged app that embeds the content parser before using it as evidence ([build the sidecar first](../workflow-issues/tauri-clippy-requires-built-sidecar-2026-10-04.md)).

## Related

- `content/greek/assets/README.md` (the `legacySprites` field)
- `docs/evidence/asset-studio/retro-zeus/README.md`
