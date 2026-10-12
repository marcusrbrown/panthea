# 0001: Workspace and tooling

## Status

Accepted.

## Context

Owner decision D19/D21 fixes a Bun-managed workspace and MIT licensing; the workspace layout, build tooling, and CI shape are delegated under D23. [architecture-options.md](../product/architecture-options.md) proposes the `apps/`, `packages/`, `tools/`, `content/` layout used here.

## Decision

Use Bun 1.4.2 workspaces across `apps/*`, `packages/*`, `tools/*`. Tauri 2.12.0 is the desktop shell: Rust crate `tauri`, `@tauri-apps/cli`, and `@tauri-apps/api` are pinned to the same version. The client uses Vite 7 with React 19 (precedent: Mothership uses the same Tauri/Vite/React shape; `three-flatland/react` exists for the renderer integration; no evidence contradicts this pairing). Biome 2 is the formatter/linter. TypeScript runs in strict mode across the workspace.

`bun run check` is the single local gate: typecheck, lint, test. CI runs `bun run check` plus `cargo fmt --check` and `cargo clippy -- -D warnings` for the Tauri Rust side. GitHub Actions are SHA-pinned. Renovate manages dependency updates. No release pipeline exists until M7 (release hardening). Rust crate and JS API minor versions must match unless a tested exception is recorded here.

## Consequences

A fresh checkout has one Bun entry command set and one lockfile (P03). Rust and JS/TS tooling stay separate but both gate CI. Adding a release pipeline before M7 is out of scope and should be reverted if introduced early.

**2026-09-28:** the M0 renderer probe app (`apps/probe-renderer`) was removed, so `apps/desktop` is the only Tauri app: one Rust crate, one `Cargo.lock` (`apps/desktop/src-tauri`), and one Rust CI target. The probe's source is at commit `ce9e5a4`; its evidence stays in [tools/probes/renderer-webgl2/README.md](../../tools/probes/renderer-webgl2/README.md).

**2026-10-02, Tauri versions:** the Decision above records the 2.12.0 pin at adoption. The Rust crate `tauri` is now `=2.12.1` in `apps/desktop/src-tauri/Cargo.toml` (#70, 2026-09-30; `Cargo.lock` has `tauri`, `tauri-runtime`, and `tauri-runtime-wry` at 2.12.1), while `@tauri-apps/api` and `@tauri-apps/cli` stay at exactly 2.12.0. The minor versions still match, as the rule above requires; the patch versions differ by one.

**2026-10-11, CI commands:** there are now two Tauri crates, `apps/desktop/src-tauri` and `apps/studio/src-tauri`. CI runs `cargo fmt --check`, `cargo clippy --locked --all-targets -- -D warnings` and `cargo test --locked` in each. `--all-targets` also lints test code, so running clippy locally without it can pass code that CI fails.

## Evidence/links

[architecture-options.md](../product/architecture-options.md) workspace layout; [stack-2026-09-26.md](../research/stack-2026-09-26.md) Bun/Tauri version research.

## Requirement IDs

P03, P08.
