# Architecture decision records

Status values: **proposed** (candidate, not yet probe-confirmed), **accepted** (probe evidence or owner decision confirms it), **superseded** (replaced by a later ADR, kept for history). Each ADR uses Status, Context, Decision, Consequences, Evidence/links, and Requirement IDs sections. Owner decisions (explicit choices in [decisions.md](../product/decisions.md)) and delegated decisions (tunable under D23) are both recorded here; the ADR's Context section says which kind it is.

Update this index and [traceability.md](../product/traceability.md) whenever an ADR changes status.

| ADR | Title | Status | Requirement IDs |
| --- | --- | --- | --- |
| [0001](0001-workspace-and-tooling.md) | Workspace and tooling | Accepted | P03, P08 |
| [0002](0002-renderer-backend.md) | Renderer backend | Accepted | P02, P05 |
| [0003](0003-simulation-service.md) | Simulation service | Accepted | P01, P03, W03, O03 |
| [0004](0004-generated-behavior-runtime.md) | Generated behavior runtime | Accepted | U04, U05, D12, D13 |
| [0005](0005-model-providers.md) | Model providers | Accepted | P06, P07, D22 |
| [0006](0006-telemetry-export.md) | Telemetry export | Accepted (local trace store); export proposed | O04, O05, O06, D16 |
| [0007](0007-local-image-generation.md) | Local image generation | Accepted | U06, U07, D15 |
| [0008](0008-world-state-and-client-transport.md) | World state and client transport | Accepted | P01, W03, W04, W05, W07, W09, O01, O02, O03, O04, D11, D14 |
| [0009](0009-asset-registry-lifecycle-and-uris.md) | Asset registry, lifecycle and logical URIs | Accepted | U06, U07, U08, X02 |
| [0010](0010-studio-app-host.md) | Studio app host | Accepted | U06, U07, U08, X02 |
| [0011](0011-game-canon-art-loading.md) | Game canon art loading | Accepted | U07, U08, X02 |
