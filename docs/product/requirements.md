# Product requirements

Status: Implementation planning baseline.
Every MVP requirement below is required unless it explicitly states a conditional platform target.
R1–R9 refer to [interview records](../discovery/interview.md).
D23 authorizes the detailed defaults in [defaults.md](defaults.md).

## Product and platform

| ID | Requirement and user value | Source | Acceptance evidence |
| --- | --- | --- | --- |
| P01 | Run the complete core experience offline after setup | Opening, R8–R9 | Disconnect external networking; load a world, converse, generate behavior and local art, save, inspect, and replay without a hosted dependency |
| P02 | Deliver the desktop app with the selected rendering stack | R8–R9 | Packaged Tauri app renders Three Flatland through Three.js on the M1 Pro using WebGL2, and through WebGPU where the webview exposes it; record exact versions and backend per platform (D25) |
| P03 | Keep tools, backend, and frontend in a Bun-managed workspace | Opening | Fresh checkout has documented Bun entry commands and a shared lockfile; packaging includes required non-Bun toolchains |
| P04 | Scale from M1 Pro 16 GB to M4 Pro 48 GB | R1, R9 | Publish baseline and larger-machine profiles with population, models, memory, and response measurements |
| P05 | Target Linux and Windows when supported | R8 | Record packaged-app probe results and supported OS/GPU versions; do not advertise untested platforms |
| P06 | Provide guided model setup and configurable role assignments | R4, R8 | Connect an existing local server or complete a first-run download; assign different models to character/world roles |
| P07 | Support optional hosted and mixed inference with fallback | R4, R8–R9 | Exercise supported provider adapters and a configured outage sequence; no network fallback in offline mode |
| P08 | Preserve research and implementation context under MIT project licensing | Opening, R8 | Repository includes reading order, decisions, work plan, source/asset provenance, and project license |

## World and characters

| ID | Requirement and user value | Source | Acceptance evidence |
| --- | --- | --- | --- |
| W01 | Ship the seven-god Greek roster grounded in documented myths | R5, R9 | All seven have core drives, abilities, sourced profiles, variant notes, portraits, and world sprites |
| W02 | Provide town/wilderness, Olympus, and playable Underworld | R3, R9 | Traverse mortal landscape continuously; use an in-world transition to another map; observer switching leaves character location unchanged |
| W03 | Evolve offscreen areas and support unattended operation | R3–R4, R9 | Leave the camera and close its window; committed actions continue; return shows changes and a summary |
| W04 | Bound knowledge and preserve individual memory and relationships | R2–R4 | A character cannot use an unseen private event without a perception/power/report path; remembered outcomes influence later behavior |
| W05 | Keep game rules authoritative over intentions and speech | R4 | False claims, malformed model actions, stale targets, and insufficient power fail without corrupting state |
| W06 | Let ordinary inhabitants affect production, trade, and resources | R3, R7 | NPC actions change goods and money; character drives produce different decisions; background scheduling preserves action capabilities |
| W07 | Model money, worship, legends, and favor | R7 | Inspect balances, worship events, attributed legends, and an applied favor effect; distinguish rumor from verified event |
| W08 | Make destruction and recovery consequential | R2, R4, R7 | A strike damages a tree and burns a building; its service/inventory/income change; rebuilding consumes resources |
| W09 | Support transformation, grudges, alliances, and persistent consequences | R2, R7, R9 | An explicit effect changes form or relationship and records its provenance; unrelated identity/memory survives |
| W10 | Let a director create events without undoing consequences | R2, R4 | A configured quiet-world trigger proposes a valid event; history attributes the intervention; no automatic restoration erases catastrophe |
| W11 | Support realm-specific access, power, and reskinning rules | R2–R3, R7 | A realm modifier changes cost/access; a test realm pack adapts a creation without hardcoded Greek assumptions |

## Mortal participation and conflict

| ID | Requirement and user value | Source | Acceptance evidence |
| --- | --- | --- | --- |
| M01 | Create a mortal and enter or leave an existing world | R1–R3 | Name/design a mortal, choose an allowed spawn, enter play, leave to observe, and resume the same identity |
| M02 | Offer movement, contextual actions, and free-form conversation | R5, R9 | Core actions work through keyboard, controller, and pointer; typed dialogue reaches the target and history |
| M03 | Keep conversations interruptible | R3 | A fire, attack, travel, or character arrival interrupts or redirects dialogue without freezing the world |
| M04 | Enable buying, selling, artifacts, and changeable patronage | R2–R3 | Transfers conserve inventory/money; equipment or ingestion applies an effect; gods perceive a patron change through defined rules |
| M05 | Implement asynchronous turn-based conflict | R7 | Fight, flee, persuade, and call/summon have valid resolution paths; costs/cooldowns and cast/recovery times apply |
| M06 | Make death a playable transition | R2–R3, R9 | Mortal death reaches the Underworld, records fate influences, permits interaction, and offers a reachable return condition |
| M07 | Apply mortal rules during absence and offer retirement | R3–R4, R9 | An absent mortal follows routines and can die; voluntary permanent death retires that identity while keeping its history |
| M08 | Defeat gods through banishment or recovery initially | R7 | A defeated god enters its configured state and returns only through valid conditions; core drives remain identifiable |

## Universe and generated creation

| ID | Requirement and user value | Source | Acceptance evidence |
| --- | --- | --- | --- |
| U01 | Give the local owner a separate operator role | R2, R6 | Open Universe without spawning a world character; inspect and alter authorized state |
| U02 | Combine direct, command, and natural-language operations | R6 | Relocate a character and edit an imperative through controls/commands; preview and apply an equivalent language request |
| U03 | Schedule world interventions and retain operator history | R1, R6 | Schedule a regional earthquake or beast appearance; cancel before execution; execution and affected entities appear in history |
| U04 | Generate and autonomously activate executable game behavior | R7–R8 | A generated behavior passes validation, registers a version, executes through world APIs, and can be reused by Universe |
| U05 | Enforce the generated-runtime boundary | R8 | Attempts to access files, shell, credentials, network, unbounded loops, or invalid mutations fail within measured limits |
| U06 | Create new visuals locally and optionally through hosted models | R8–R9 | Procedural composition and a local image adapter produce assets offline; a hosted adapter works when explicitly configured |
| U07 | Keep creation asynchronous and realm-aware | R7, R9 | Temporary coherent art is visible while a job runs; simulation continues; completed art and realm variants enter the versioned registry |
| U08 | Support documented file/code content packs | R6, R9 | A contributor adds a test artifact, behavior, lore entry, and realm modifier using documented contracts and validation |

## Presentation and accessibility

| ID | Requirement and user value | Source | Acceptance evidence |
| --- | --- | --- | --- |
| X01 | Open with a live attract loop and short orientation | R1 | A prepared world runs beneath the title; a user can observe or enter and complete core orientation within ten minutes |
| X02 | Provide polished isometric pixel art and expressive portraits | R5 | Art review confirms a consistent original visual system, sprite scale, lighting, portrait states, and readable dialogue; for retro assets the standard is [ADR-0012](../decisions/0012-pre-rendered-retro-art-direction.md) (2026-10-12), and the art guide's hand-pixel rules stay for legacy assets |
| X03 | Show effects and skippable cutscenes without stopping simulation | Opening, R5 | Skip a strike scene; committed consequences still occur once; reduced-effects mode communicates the same event |
| X04 | Support unobtrusive observation and deeper inspection | R1, R5 | Follow/switch gods, read speech, open recent activity and imperatives; inspection does not inform characters by default |
| X05 | Provide sound effects and selective ambient music | R5 | Event sounds correspond to committed events; separate volume/mute controls work; music is not forced continuously |
| X06 | Make core interaction accessible and responsive | R5, D23 | Keyboard focus, readable text scaling, remapping, contrast, reduced motion/flashes, and controller focus pass the UX checks |

## Persistence and research

| ID | Requirement and user value | Source | Acceptance evidence |
| --- | --- | --- | --- |
| O01 | Autosave, snapshot, import, export, and restore worlds | R6, R9 | Export and restore a populated world with assets and behaviors; preserve IDs/state and reject incompatible or corrupt imports clearly |
| O02 | Replay recorded events without fresh inference | R6, R9 | Play a saved interval with providers disabled; outcomes, character positions, effects, and art versions match the record |
| O03 | Support pause, background operation, and capped catch-up | R4, R9 | Pause survives restart; missed-time cap and summary work; time is not advanced twice after a crash |
| O04 | Provide local telemetry and inspectable causal history | R6, R8 | Follow an event from observation through model request, validated action, outcome, relationship change, and presentation |
| O05 | Export telemetry with configurable privacy and retention | R8 | Disable exports for offline play; reconnect and export buffered records; payload filters and retention settings take effect |
| O06 | Integrate Langfuse and OpenTelemetry tooling | R6, R8 | Correlated model and simulation traces appear at a configured compatible endpoint; local play survives endpoint failure |
| O07 | Support manual simulation experiments | R1, R6, D23 | Copy a snapshot, vary a prompt/model/resource setting, run each world, and compare relationship/story summaries and raw exports |
| O08 | Remain lively and stable under baseline load | R1, R9 | Pass the baseline trials in the acceptance plan, with measured latency, memory, recovery, and unattended activity |

## Scope interpretation

All listed capabilities belong to the accepted MVP.
They can ship in successive internal milestones, but an intermediate milestone is not the full MVP.
Conditional platform support does not excuse omitting the packaged M1 Pro baseline.
Exact models and numerical performance thresholds are probe-dependent.

Video export, direct publishing, batch runners, additional pantheons, hosted multiplayer, voices, player-facing in-game editors, and spending enforcement are deferred.
The owner-facing asset studio (D26) is authoring tooling, not an in-game editor, and is in scope; it has no requirement ID of its own yet.
See [the roadmap](mvp-roadmap.md) and [acceptance plan](acceptance.md) for delivery order and evidence.
