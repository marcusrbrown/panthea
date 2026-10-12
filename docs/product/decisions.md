# Decision record

Status: Planning baseline after nine rounds.
R1–R9 refer to the corresponding records in [the interview](../discovery/interview.md).
Owner decisions govern scope. Defaults are delegated choices that remain tunable.

| ID | Decision | Source | Consequence |
| --- | --- | --- | --- |
| D01 | Owner first, open-source audience second; personal portfolio, noncommercial | R1 | Optimize for single-person study and participation |
| D02 | Fully offline capability with optional hosted models | Opening, R1, R4 | Local inference, lore, assets, persistence, and inspection cannot require cloud services |
| D03 | Desktop MVP; browser and hosted multiplayer later | R4, R9 | No accounts, matchmaking, or multiplayer synchronization in MVP |
| D04 | Seven named Greek gods; town/wilderness, Olympus, Underworld | R5, R9 | Other traditions are extension targets, not launch content |
| D05 | Researched myths with documented variants | R5 | Separate authored lore from invented simulation history |
| D06 | Authoritative rules; characters have limited knowledge and creative freedom | R4 | Claims cannot directly mutate world facts |
| D07 | Mortal player, optional patron, playable afterlife, return path | R2, R3, R9 | Death is a transition; absent mortals remain vulnerable |
| D08 | Persistent destructive consequences and resource-based recovery | R4, R7 | No automatic reset after spectacles |
| D09 | Asynchronous turn-based conflict, costs/cooldowns, divine banishment or recovery | R7 | Exact timing is a tunable rule, not frame-rate-dependent |
| D10 | Money, worship, legends, autonomous economic activity | R7 | Need causal resource and relationship records |
| D11 | Universe combines controls, commands, and language; owner has full authority | R6 | Operator changes are recorded separately from character actions |
| D12 | Generated game behaviors activate after automatic validation | R7, R8 | Restricted world APIs, execution budgets, versioned behavior registry |
| D13 | Lua is optional; generated code has no host access | R8 | Sandbox mechanism requires adversarial tests |
| D14 | Original pixel art, isometric world, portraits, effects, live skippable cutscenes | R5 | Presentation must follow committed world events |
| D15 | Procedural and image-model visual generation; activity has priority | R8, R9 | Queues and coherent temporary art are acceptable |
| D16 | Full local inspection and configurable hosted telemetry export | R6, R8 | Export failure cannot stop simulation |
| D17 | Autosave, snapshots, backup/restore, event playback | R6, R9 | Store outcomes and required asset/behavior versions |
| D18 | File/code authoring for MVP | R6, R9 | Document content contracts rather than build authoring UI. Narrowed by D26 for assets |
| D19 | Tauri, WebGPU, Three.js, Three Flatland; Bun workspace | Opening, R8 | Probe packaged-app rendering before full construction |
| D20 | macOS baseline, Linux/Windows when supported; first-run downloads allowed | R1, R8 | Publish tested platform/model profiles |
| D21 | MIT; OpenCode and Systematic implementation | R8 | Preserve decisions and engineering lessons in repository docs |
| D22 | Fallback required; spending enforcement deferred | R8, R9 | Configured providers only, then routine-only operation |
| D23 | Tunable product defaults and technical probes authorized | R9 | Implementation can resolve documented parameters without reopening discovery |
| D24 | Video files, YouTube, voice, extra pantheons, editors, and batch experiments deferred | R9 | Do not make these release dependencies. Narrowed by D26 for assets |
| D25 | Renderer uses WebGPU where the webview supports it and WebGL2 otherwise; macOS 15 baseline retained | M0 probe 2026-09-26 | P02 amended; Linux conditional |
| D26 | Owner-facing asset authoring is in scope: a separate `apps/studio` app and a `tools/studio` CLI for sprites, tiles, effects, and sound, with Aseprite as the hand-edit tool. Content stays plain files and code behind the existing pack contracts. Player-facing in-game editors stay deferred | Owner, 2026-10-03 | Narrows D18 and D24 for assets only. Local generation only; hosted providers stay interface-only. Does not change the ADR-0005 coexistence gate for in-game generation |

## Superseded or narrowed ideas

The initial browser-and-desktop direction became desktop-first, with hosted multiplayer deferred.
The initial multi-pantheon ambition became a Greek-first release with extensible content.
Divine death became banishment or recovery for the initial rules.
Possible event undo became snapshot restore.
Video export and YouTube delivery became post-MVP work.
Literal WebGPU-only rendering on the macOS baseline became dual-backend (WebGPU/WebGL2) after the WKWebView probe found no `navigator.gpu` on macOS 15.
File/code-only authoring (D18) and the editors deferral (D24) were narrowed on 2026-10-03: an owner-facing asset studio is in scope; player-facing in-game editors stay deferred (D26).
D14 is not amended (2026-10-12, ADR-0012): CC0 kit bodies, rendered and baked to pixel art, count as appropriately sourced material under content-direction.md, so "original pixel art" covers the pre-rendered retro direction. Its isometric, portrait, effect and cutscene parts are unchanged.

## Boundaries on delegated choices

The owner authorizes tunable defaults, not silent deletion of accepted capabilities.
Probes can select population, model sizes, latency profiles, and minimum OS versions.
A failed probe must produce evidence and a revised proposal when the selected stack or a core capability cannot meet the baseline.
No scope decision authorizes a purchase, subscription, hosted deployment, or publication during implementation.
