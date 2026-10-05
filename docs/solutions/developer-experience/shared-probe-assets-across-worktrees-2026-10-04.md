---
title: Keep shared probe assets outside disposable worktrees
date: 2026-10-04
category: developer-experience
module: workspace
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - "Large ignored probe assets serve multiple worktrees"
  - "A new probe's ignore rules exist only on its feature branch"
tags: [git, worktree, gitignore, symlink, models, probe-assets]
---

# Keep shared probe assets outside disposable worktrees

## Context

Probe binaries and models are large, ignored files. A linked worktree's ignore rules do not apply to physical files in another checkout.

The image probe kept real `bin` and `models` directories in the main checkout. The studio worktree linked to those directories. Main lacked the new probe's tracked ignore file, so Git listed the downloaded assets.

## Guidance

Keep real probe assets under `tools/probes/<name>/{bin,models}` in the main checkout. Use links from worktrees that need them. Keep source, configuration, and evidence tracked.

If main lacks the feature branch's ignore rules, use anchored entries in the repository's shared `.git/info/exclude`:

```gitignore
/tools/probes/art-local-2/bin
/tools/probes/art-local-2/models
```

The probe's tracked ignore patterns omit the trailing slash so that they also match directory links. Entries in `.git/info/exclude` apply to main and every linked worktree of this repository. They do not change tracked ignore rules or other clones.

Before removing a worktree, make sure that it does not own the only copy of the assets. Move real assets to main before removal. Do not replace or delete the shared target through a worktree link.

## Why This Matters

Ignored assets do not survive worktree removal when their only copy lives there. A link preserves access without creating another multi-gigabyte download.

## When to Apply

Use this layout for parallel probe work with shared binaries or weights. A single write lane does not require a new worktree.

## Examples

Run this command from the main checkout to make sure that its physical asset paths are ignored:

```sh
git check-ignore -v tools/probes/art-local-2/bin tools/probes/art-local-2/models
```

Also inspect the links. In the checked layout, main owns both real directories, and both studio links resolve to those directories.

## Related

- [Tracked probe exclusions](../../../tools/probes/art-local-2/.gitignore)
- [Artifact staging](../best-practices/staging-verified-generator-artifacts-2026-10-04.md)
