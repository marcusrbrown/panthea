---
title: Stage generator artifacts before publishing their paths
date: 2026-10-04
category: best-practices
module: art-local
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "A probe downloads large models or native runtime archives"
  - "Interrupted downloads need safe resumption"
  - "Arm configuration must fail before network or output side effects"
tags: [staging, download, sha256, partial-download, runtime, configuration]
---

# Stage generator artifacts before publishing their paths

## Context

The image probe downloads large model files and a native runtime archive. A downloaded archive alone does not provide the executable that the arm configuration requires.

## Guidance

Use the [staging implementation](../../../tools/probes/art-local-2/src/stage.ts) as the boundary for these prerequisites:

1. Compare existing files with the expected size and hash before reuse.
2. Download to a `.part` file with a process deadline.
3. Retain partial bytes after a transport failure or deadline for resumption.
4. Discard HTTP error bodies and bytes that fail the size or hash comparison.
5. Rename the file only after those comparisons pass.
6. Extract the runtime into a staging directory and compare the executable with its pinned hash before publication.

Downloads use a four-hour default deadline. HTTP 401 and 403 produce `unavailable`, without acquiring credentials or bypassing access controls.

The runtime path is `bin/release/sd-server`, not the release archive. File publication uses rename. Runtime directory replacement removes the unverified old directory before renaming the staged directory; it does not guarantee uninterrupted reads.

Reject missing `--root` values and malformed `bodyShape` configuration with exit code 64 before downloads or output creation.

## Why This Matters

The next arm receives the exact executable and model bytes that the configuration names. Failed transfers do not become final files, and resumable bytes remain separate from HTTP error responses.

## When to Apply

Apply this boundary when a probe stages external binaries or weights. If staging targets shared assets, stop their users before replacing the runtime directory.

## Examples

```text
download -> model.safetensors.part -> size/hash comparison -> model.safetensors
archive -> bin/release.part/sd-server -> executable hash -> bin/release/sd-server
```

The [staging tests](../../../tools/probes/art-local-2/src/stage.test.ts) cover deadlines, retained partials, authorization refusal, bad hashes, runtime extraction, and invalid arguments. The [CLI tests](../../../tools/probes/art-local-2/src/cli.test.ts) cover early rejection of malformed arm configuration.

## Related

- [Shared probe assets](../developer-experience/shared-probe-assets-across-worktrees-2026-10-04.md)
- [Local image-generation decision](../../decisions/0007-local-image-generation.md)
