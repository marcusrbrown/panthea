# MVP roadmap

Status: Accepted scope with an implementation sequence proposed under D23.
There is no calendar deadline or budget commitment.
Each milestone produces a reviewable result and evidence before the next dependent stage.

## Delivery sequence

| Stage | Outcome | Main requirements | Exit evidence |
| --- | --- | --- | --- |
| M0: Feasibility | Validate packaged rendering, local models/art, service lifecycle, and restricted execution | P02–P07, U05–U06 | Probe reports and architecture decisions on baseline hardware |
| M1: Persistent living world | Authoritative rules, movement, time, economy skeleton, events, storage, and local traces | P03, W02–W03, W05–W08, O01, O03–O04 | Headless scenario continues, survives restart, and records inspectable consequences |
| M2: Autonomous Greek cast | Seven sourced character profiles, memory, relationships, models, director, and fallback | W01, W04, W09–W10, P06–P07 | Unattended social/economic interactions with knowledge isolation and model-failure recovery |
| M3: Playable consequences | Mortal entry, dialogue, combat, artifacts, patronage, death/return, repair, and travel | M01–M08, W08–W11 | Play through strike, response, loss, afterlife, return, and recovery |
| M4: Universe and creation | Operator UI/API, schedules, validated generated behavior, procedural/local/hosted art | U01–U08 | Generate and replicate a new behavior/object with provenance while the world continues |
| M5: Complete experience | Polished maps/art, live title, tutorial, inspection, effects, audio, accessibility | X01–X06 | First-ten-minute and Zeus-scene reviews on the baseline device |
| M6: Research and replay | Portable worlds, retained-event playback, metrics, comparison branches, endpoint export | O01–O07 | Restore and replay offline; compare scenarios; view correlated external traces |
| M7: Release hardening | Baseline endurance, recovery, packaging, documentation, and supported platform builds | P01–P08, O08 | Acceptance report, release artifacts, known limits, install and recovery instructions |

Telemetry and persistence begin in M1 and accompany every later stage.
Do not postpone model and generation traces until M6.
Likewise, implement basic input and rendering early enough to expose interaction problems.

### M0 outcome (2026-09-27)

M0 is complete. Eight probes under `tools/probes/` measured packaged-app rendering, service
lifecycle, generated-code isolation, local inference, hosted-provider fallback and offline
behavior, local image generation, and three-way memory coexistence on the M1 Pro 16 GB baseline;
the full probe-to-ADR disposition is indexed in [m0-exit.md](m0-exit.md). The renderer holds at
~59 fps / 28 ms p50 click latency on the WebGL2 fallback (ADR-0002); the Bun sidecar survives
every required lifecycle transition (ADR-0003); QuickJS terminates every adversarial fixture with
zero escapes (ADR-0004); the local-inference baseline (`llama3.2:3b` @ 4K) and the OpenCode Go
hosted fallback chain are both measured, and offline mode is proven silent on the wire against a
positive control (ADR-0005); local image generation on stable-diffusion.cpp settles a base arm,
quantization profile, and cancellation behavior (ADR-0007). The three-way coexistence probe's
heavy-work memory-sharing policy remains **open, not decided**: a re-measurement with success-only
latencies and an evaluability floor found the 3 GiB admission-queue candidate raised LLM p95 by
+148% rather than improving it, reversing the first round's result; the unconstrained and
global-mutex candidates stay rejected, but no candidate policy is currently supported — this is
deferred to M1 with a fixed sampler (see [open-decisions.md](open-decisions.md)) and does not block
M1 from starting. Four independent re-checks also remain open — tracked as their own
follow-up probes, not blockers to M1: packaged Flatland feature completeness on a second
WebGL2 GPU/driver, a signed (not ad-hoc) macOS 15 WebGPU re-check, a macOS 26 WKWebView WebGPU
re-check, and a packaged Windows/Linux renderer run. M1 work may begin without waiting on these.
The M0 renderer probe app (`apps/probe-renderer`) was removed on 2026-09-28 (source at commit
`ce9e5a4`; evidence stays in [the probe README](../../tools/probes/renderer-webgl2/README.md)), so
the repeat runs will use the packaged desktop app with a measurement harness.

2026-10-02 note: the M2 local baseline model is qwen3 8B at 4K (owner, after the M2 experience gate was rated continue; see [ADR-0005](../decisions/0005-model-providers.md)); the `llama3.2:3b` @ 4K figures above are the M0 measurement.

**2026-09-28, memory-policy gate:** M1 closed without the coexistence re-measurement, so the
"deferred to M1" assignment above no longer stands. Only the comparable baseline-versus-3-GiB pair is
evidence (LLM p95 1242 → 3086 ms, 6 images), and it does not support that policy. The unconstrained,
global-mutex, and 5 GiB candidates have no comparable baseline and no verdict, so "stay rejected"
above is not a finding. The next gate: capture the M2 workload baseline at M2 exit, and require
comparable candidate results (errors, successes, queue wait, completed images, responsiveness, and
memory recorded together) before M4 enables concurrent image generation. Until then character
activity comes first and art stays on the temporary/procedural path; offline local image generation
remains in scope ([ADR-0005](../decisions/0005-model-providers.md),
[open-decisions.md](open-decisions.md)).

### M1 outcome (2026-09-28)

M1 is complete. The headless causal scenario passes against the compiled sidecar
([m1-living-world](../../tools/scenarios/m1-living-world/README.md): 16 steps in 54 s, seven
positive controls that each exit non-zero): unattended routines, a strike that damages a tree, a
strike that becomes fire, lost service, and repair, worship with an expiring favor, attributed legends, rejected malformed, false,
and stale proposals, pause across a restart, a proposal that survives a kill, a kill mid catch-up
past the cap that applies no time twice, export, corrupt-copy refusal, import, and restore into a
branch, and the strike's ignition traced from its observation to the client's presentation
receipt. The packaged view gate passed on the release `.app`: observer switching across all three
realms, 143 presentation receipts over a 6.5-minute session, the catch-up panel, and pause/resume
([m1-packaged-shell](../../tools/scenarios/m1-packaged-shell/README.md#view-gate)).

Known limits, each recorded in its [traceability.md](traceability.md) row: O01 archives carry
world state, the proposal journal, and the catch-up summary but no trace records, so a restored branch
has no causal trace before the restore; O04 is partial, with model-request and relationship links left
to M2.

Not covered: a real OS sleep/wake cycle, power loss, disk-full and store-error degradation, a crash
during import staging, code signing and notarization, the release build's web console, and the
Windows and Linux packaged runs. The heavy-work memory-sharing policy remains open as its own
follow-up probe ([open-decisions.md](open-decisions.md)).

### M2 outcome (2026-10-10)

M2 exits on the fourth unattended hour (owner decision, 2026-10-10).

Exit evidence ([report](../../tools/scenarios/m2-greek-cast/unattended/2026-10-10T15-16-26/report.md),
merged in #196, `main` at `f65a1b0`): one hour of seven gods on granite3.3-8b-4k (local Ollama, 4K,
reasoning off), with a provider outage (ticks 62–780) and a stop, then a restart with a 90-minute gap
and catch-up. All 24 threshold rows passed. Queue-wait p95 was 92–102 against ADR-0005's amended 105,
and the longest quiet stretch was 139 ticks. No prompt was cut (the busiest was 2,920 tokens) and there
were 0 empty responses. Recovery took 15 ticks. Perception, goal and petition privacy held. Rebuild
equals live (201,878 events in 480 ms), the archive import passed, and the sidecar footprint changed
−1.36% across the settled span. The owner's rubric scores: novelty 1, causality 1, recognizable
identity 1, pacing 2, inspectability 1. No score is 0.

Workload baseline, for the [memory-policy gate](#m0-outcome-2026-09-27) (2026-09-28 paragraph):
steady request latency median 9.8 s and p95 12.7 s; Ollama runner RSS peak 9,052 MiB and footprint
peak 5,525 MiB; sidecar footprint peak 141 MiB; swap peak 2,325 MiB; store 241 MiB and archive 92 MiB.

Known limits, carried forward as the tuning list:

1. Gods rarely use their own listed powers, and their voices sound alike.
2. Prayers mostly lapse while no god can act, and defections churn: most follow a lapse, and most
   repeat moves reverse within 100 ticks.
3. Strikes and blessings are uniform in size.
4. In 35 supplications the mortal paid and the god's side lapsed.
5. Reports and legends change no relationship. Contests cite defections thousands of ticks stale.
6. Inspectability gaps: a strike carries no prayer id (the link is only via
   `petition-answered.answeredBy`); the report's episode list cites an act's divinity-cost event, not
   the act; the stored catch-up summary holds only the later short pass, so the applied and discarded
   minutes are only in the operator observation and `run.json`; model output is action JSON with no
   reasoning.
   *Closed 2026-10-10:* the first three gaps. A strike now names the prayer it answers on its own
   events, which the world checks (O04). The report's god episodes cite the act's own event, and its
   director episodes cite the director's event too (O04, W10). A follow-up catch-up pass with no live
   tick between adds to the stored summary instead of replacing it (O03, O04). Model output as action
   JSON with no reasoning remains open.
7. The 105 queue-wait target holds only on a quiet machine, per ADR-0005's amendment.
8. World maps that grow without bound (petitions, credits, wrongs, noticed, threads, contests) and the
   unbounded event log and trace tables are left for the eight-hour endurance trial (M7, O08).

## First playable slice

An early slice contains a small town scene, Zeus, one mortal, one damaging power, and a persistent event history.
It proves observation, conversation, a visible strike, one consequence, and save/reload.
This is an internal milestone, not permission to reduce the accepted seven-god MVP.

Develop the full roster and maps incrementally using the same contracts.
Each new system needs one concrete causal scenario rather than a disconnected feature demo.
Reuse those scenarios for later regression and performance checks.

## Suggested initial work items

The implementation agent can translate these into its Systematic task format:

1. Resolve current Three Flatland references and pin compatible versions.
2. Build a packaged Tauri/WebGPU scene and record platform results.
3. Benchmark local language and image providers with the scene running.
4. Compare service lifecycle and storage candidates, then record the backend decision.
5. Define command, event, entity, content, behavior, and save schemas.
6. Build transaction validation, simulation time, event history, and local tracing.
7. Prove isolated generated execution with adversarial fixtures.
8. Implement the first playable consequence slice.
9. Add the roster, memory, relationships, economy, and director.
10. Add mortal combat, patronage, artifacts, afterlife, and return.
11. Build Universe controls and generated creation workflows.
12. Complete art, orientation, accessible input, replay, research views, and release checks.

## MVP completion

All 49 requirements must have evidence or a documented conditional-platform outcome.
A successful rendering demo or lively conversation demo alone does not complete the MVP.
Use [acceptance.md](acceptance.md) for end-to-end and unattended trials.

A failed technical probe can change a delegated parameter.
A failure that removes offline play, generated creation, persistent consequences, or the chosen stack requires a scope decision.
Record the evidence and proposed change rather than silently omit the feature.

## Post-MVP sequence

Future work remains a direction rather than a committed order:

- Expand pantheons and realms, including Norse, Yoruba, Roman, and tentatively Akan content.
- Add browser access and a separately designed hosted multiplayer experience at panthe.ai.
- Add video-file export, direct YouTube publishing, and sharing controls.
- Add in-app map, character, lore, artifact, and behavior authoring.
- Add experiment batches, richer comparison reports, and spending/usage enforcement.
- Consider spoken voices, inspection-detecting powers, permanent divine death, lesser deities, and character-reset events.

Future multiplayer must revisit identity, permissions, privacy, persistence, time controls, and operator authority.
Do not assume the single-person desktop defaults are appropriate for a shared world.
