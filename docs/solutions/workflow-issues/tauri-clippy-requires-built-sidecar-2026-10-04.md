---
title: Build the Tauri sidecar before clippy
date: 2026-10-04
category: workflow-issues
module: desktop-lifecycle
problem_type: workflow_issue
component: development_workflow
severity: low
applies_when:
  - "Running Rust compilation checks for the desktop shell"
  - "Preparing a clean checkout without generated sidecar binaries"
tags: [tauri, rust, clippy, sidecar, external-bin, build]
---

# Build the Tauri sidecar before clippy

## Context

The desktop shell declares the simulation sidecar in Tauri's `bundle.externalBin`. Tauri resolves that generated binary during Rust compilation.

A clean checkout can therefore fail inside `tauri-build` even when the Rust source is correct. The binary is ignored and must exist for the current target.

## Guidance

From the repository root, build the sidecar before compiling the native crate. Use the same prerequisite as the [Rust CI job](../../../.github/workflows/ci.yaml).

The script derives the target only on macOS. On other platforms, set `PANTHEA_SIDECAR_TRIPLE` and `PANTHEA_SIDECAR_TARGET` before running it.

```sh
bash tools/probes/backend-lifecycle/scripts/build-sidecar.sh &&
  (cd apps/desktop/src-tauri &&
    cargo fmt --check &&
    cargo clippy --locked --all-targets -- -D warnings)
```

Formatting alone does not compile the crate. Clippy does, so it triggers the Tauri build script.

## Why This Matters

Successful dependency installation does not create the generated sidecar. Treating the missing binary as a Rust source failure sends the investigation to the wrong component.

## When to Apply

Apply this prerequisite to fresh checkouts and native CI jobs. Rebuild after changing the simulation source or compilation target.

## Examples

The desktop configuration names the logical sidecar. The generated filename also includes the Rust target, such as `panthea-sim-aarch64-apple-darwin`.

The [build script](../../../tools/probes/backend-lifecycle/scripts/build-sidecar.sh) prepares the target-specific binary. It remains an ignored build artifact, not a committed dependency.

## Related

- [Desktop build script](../../../apps/desktop/src-tauri/build.rs)
- [Tauri configuration](../../../apps/desktop/src-tauri/tauri.conf.json)
