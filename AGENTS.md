# Panthea agent instructions

## Read first

Follow the reading order in [docs/README.md](docs/README.md).
Authority: [decisions.md](docs/product/decisions.md) (D01–D26) for owner choices, [defaults.md](docs/product/defaults.md) (D23 tunables) for delegated parameters, [requirements.md](docs/product/requirements.md) (49 stable IDs) for release obligations, and the ADRs in [docs/decisions](docs/decisions) for architecture choices made during implementation.

## Invariants

- The world/simulation service is authoritative; the renderer never decides outcomes.
- Generated code executes only through validated game APIs; it has no filesystem, shell, credential, or network access.
- Core play, lore, local inference, local visual creation, persistence, replay, and inspection work fully offline after first-run setup.
- Offline mode never silently falls back to a hosted provider.
- No credential-bearing data is passed into content, saves, prompts, telemetry, or logs; credentials live only in platform credential storage.
- Use stable requirement IDs (P/W/M/U/X/O prefixes) in plans, PRs, and evidence.
- Update [traceability.md](docs/product/traceability.md) in every PR that touches a requirement.
- Record superseded decisions; do not erase their context.
- Report core feasibility conflicts with measured evidence and a concrete alternative — never silently reduce scope.
- No purchases, subscriptions, hosted deployments, or publication during implementation.
- The workspace is Bun-managed; Tauri, Three.js, and Three Flatland are fixed (D19), rendering through WebGPU where supported and WebGL2 otherwise (D25).
- Local causal recording and inspection are always on; external telemetry export is opt-in and requires explicit operator configuration.

## Layout

```text
apps/
  desktop/      Tauri shell, native integration, packaging
  client/       Shared views, input, Three Flatland renderer
  simulation/   Local service entry point and lifecycle
packages/
  contracts/    Versioned commands, events, content, save schemas
  world/        Rules, actions, time, economy, conflict, perception
  agents/       Context, memory, planning, model routing, fallback
  behaviors/    Generated-runtime host and validation
  persistence/  Transactions, snapshots, migrations, replay
  content/      Pack loading, lore manifests, realm definitions
  assets/       Generation adapters, provenance, asset registry
  telemetry/    Correlation, local inspection, export adapters
tools/
  content/      Validation and content import tools
  probes/       Hardware, provider, renderer, sandbox probes (one dir per probe, README with results)
  scenarios/    Acceptance fixtures and manual comparison tools
content/
  greek/        Authored characters, maps, abilities, lore sources
docs/
  product/      Brief, decisions, defaults, requirements, traceability, roadmap, acceptance
  decisions/    ADRs for architecture choices made during implementation
  research/     Stack, inference, and reference research
  solutions/    Solved problems and practices by category, YAML frontmatter (module, tags, problem_type); relevant when working in a documented area
  discovery/    Historical interview record (owner evidence, do not edit)
```

## Workflow

Use Systematic in OpenCode: plan (`ce:plan`) → work (`ce:work`) → review (`ce:review`) → capture learnings (`ce:compound` into `docs/solutions/`).
Follow milestones in [mvp-roadmap.md](docs/product/mvp-roadmap.md); each milestone needs one causal scenario, not a disconnected feature demo.
Probes live in `tools/probes/<name>/` with a README recording the method and results.

## Verification

- `bun install --frozen-lockfile`
- `bun run check` (typecheck, lint, test)
- `cargo fmt --check && cargo clippy --locked --all-targets -- -D warnings && cargo test --locked` in `apps/desktop/src-tauri` and `apps/studio/src-tauri` (build each sidecar first; see `docs/solutions/workflow-issues/tauri-clippy-requires-built-sidecar-2026-10-04.md`)
- Acceptance evidence per [acceptance.md](docs/product/acceptance.md)

Mocks, successful dependency installs, and browser-only renderer demos are not proof of the packaged offline MVP.

Test-only support lives outside production source (an app's `test/` directory or `@panthea/testkit` as a devDependency); no source file name starts with an underscore.

## Owner interaction

Use the question tool for decisions that need owner input. Finish commentary and document updates first, ask through the tool, then wait for all answers before continuing.

## Fro Bot

Automation lives in [.github/workflows/fro-bot.yaml](.github/workflows/fro-bot.yaml). It reviews PRs on open/sync/reopen and runs a daily report at 03:30 UTC; it also responds to `@fro-bot` mentions from owner/members/collaborators. The label `skip-agent-review` suppresses automatic PR review. Its PR review verdict (APPROVED or CHANGES_REQUESTED) is the required approval on `main`; PRs it skips (bot authors, forks) need an owner approval. Fro Bot never merges or pushes to `main`; its hard boundaries live in the workflow's prompts and mirror the invariants above.
