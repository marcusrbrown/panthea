# tools/scenarios

Acceptance fixtures and manual comparison tools for the causal scenarios in [mvp-roadmap.md](../../docs/product/mvp-roadmap.md).

| Scenario | What it proves | Run |
| --- | --- | --- |
| [m1-living-world](m1-living-world/README.md) | The M1 causal story, headless, against the compiled sidecar: unattended routines, strike, fire, lost service, repair, legends, bad proposals, pause across restart, kill mid catch-up, archives, client receipts, causal trace. | `bun run --cwd tools/scenarios scenario:m1` |
| [m1-packaged-shell](m1-packaged-shell/README.md) | The packaged desktop app builds, launches, and survives every tray-driven lifecycle transition. | manual; see its README |
| [studio-zeus-scene](studio-zeus-scene/README.md) | The reference digests the packaged canon inspection fixture checks its readback against, generated from a Node decode of the committed blobs. | `bun run --cwd tools/scenarios scenario:zeus-scene:digests` |

`scenario:m1` builds the sidecar and spawns it, so it is not part of `bun run check`. Only the pure helpers next to it have tests that run there.
