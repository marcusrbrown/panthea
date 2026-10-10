---
title: A headless scenario against the compiled binary needs a positive control per negative claim
date: 2026-09-28
last_updated: 2026-10-09
category: best-practices
module: workspace
problem_type: best_practice
component: testing_framework
severity: medium
applies_when:
  - Closing a milestone that claims causal, durable, or crash-safe behavior across process and store boundaries
  - Writing an acceptance check whose claim is that something did not happen
  - Deciding what belongs in the fast check versus the evidence path
tags: [scenario, positive-control, compiled-sidecar, fault-injection, acceptance, sigkill, m1-living-world]
---

# A headless scenario against the compiled binary needs a positive control per negative claim

## Context

`bun run check` was green for every M1 package. The first run of the headless scenario, [tools/scenarios/m1-living-world](../../../tools/scenarios/m1-living-world/README.md), which spawns the compiled sidecar and drives it over HTTP, found four product bugs no package test had:

- **Routine starvation.** Routines were queued ahead of external proposals, so a fixture worship for an actor with a routine was always `busy-actor` ([tick admission](../logic-errors/tick-admission-starved-external-proposals-2026-09-28.md)).
- **Outcomes linked to their first event only.** A strike's first event is the divinity spend, so following the strike's ignition through the trace found nothing. `trace_outcome_events` now records every event a proposal committed (`packages/telemetry/src/trace.ts:73-81`).
- **A fresh world opened a 0 ms catch-up panel.** A sub-tick remainder was reported as skipped time. A summary now needs at least one tick applied or skipped, or an outcome (`apps/simulation/src/catchup.ts:144-157`, `apps/simulation/src/index.ts:100-108`).
- **The catch-up cap applied per run.** A kill and restart re-capped the same sleep ([catch-up cap](catch-up-cap-per-backlog-not-per-run-2026-09-28.md)).

The story shipped with three positive controls (`archive`, `catch-up`, `journal`). Four negative claims had none, so each would pass even if its check never ran: bad proposals cause no event, a false claim grants no owner, a pause holds across a restart, and a client viewing another realm sends no receipts.

## Guidance

1. **Drive the compiled binary through the real API.** Build with `apps/simulation/scripts/build-sidecar.sh`, run the binary with no Tauri, give it a fresh `PANTHEA_APP_DATA_DIR`, write the launch token to its stdin, read `PANTHEA_PORT`, and call it over authenticated loopback HTTP. Composition bugs live at the seams a package test replaces with fakes.
2. **Assert committed state, events, and trace, not wall time.** Read the events table, clock row, journal, and catch-up progress read-only from the store, decode the frame, and use the trace queries. Waits are bounded polls that name the invariant they wait for; a fixed sleep never decides a result.
3. **Give every negative claim one focused fault injection that must make the run exit 1.** A negative claim is true if the thing it guards never happened, and also true if the check never ran. `--positive-control=<name>` breaks exactly one claim, and the run must then fail. The seven, from `tools/scenarios/m1-living-world/src/run.ts:51-66`:

   | Control | Injection |
   | --- | --- |
   | `archive` | The harness skips the byte change, so the "corrupted" copy is a clean export and importing it must be refused. |
   | `catch-up` | After the kill, the harness rewinds the persisted cursor to where the chunks began, so the restart replays time the committed chunks already applied. |
   | `journal` | After the kill, the harness deletes the accepted proposal from the journal, as if the service had kept it only in memory. |
   | `bad-proposals` | The harness adds the tree strike's observation, which did cause events, to the list of bad proposals' observations. |
   | `claim-owner` | The harness checks the tavern, which has an owner, instead of the old oak for the false claim's effect. |
   | `pause` | The harness resumes the world just before stopping it, so it cannot come back paused. |
   | `underworld` | The second client follows the farmer in the mortal realm instead of the underworld, so it sees and receipts mortal events. |

4. **A control that finishes clean is a failure.** If the story completes with a control enabled, the run exits 1 with `positive control <name> did not trip any invariant` (`run.ts:111-117`). Recording evidence runs each control in a child process and accepts only a failure line that starts `FAIL invariant violated`, so a crash or a typo cannot pass as a tripped control (`run.ts:124-130`).
5. **Keep it out of the fast check, in the evidence path.** The scenario builds and spawns a binary and runs for minutes, so only its pure helpers are tested in `bun run check`. Its results, controls included, are written into its README (`--write-readme`) and cited from traceability.

## Why This Matters

Package tests pass against their own fakes; the scenario runs the shipped binary and finds what composition breaks. A negative claim ("bad proposals cause no event") is the cheapest kind to get wrong quietly: a wrong observation id, an empty list, or a harness that resumed the world all leave the check green. The control makes the check prove it can fail. The recorded controls fail for the expected reason:

```text
catch-up: FAIL invariant violated: after the second catch-up, ticks since the discard equal whole seconds of cursor advance (nothing was applied twice) -- {"ok":false,"ticksAdvanced":3720,"ticksForCursorAdvance":3600}
archive:  FAIL invariant violated: importing the corrupted copy is rejected -- status 200: the copy was imported into a new slot
```

## When to Apply

- A milestone or requirement claims behavior across a process boundary, a kill, or a restore.
- A check asserts absence: no event, no owner, no receipt, no double application, no import.
- The fault (a kill, a rewound cursor, a corrupted byte) can be injected from outside the binary.

## Examples

The same principle in another domain: [Proving "offline mode sends nothing" needs a self-owned, falsifiable packet capture](../test-failures/tcpdump-sudo-pid-resolution-offline-proof-2026-09-27.md). A capture with 0 packets means nothing until a live request under the same filter shows the capture can see traffic. Here, a scenario that exits 0 means nothing until each control makes it exit 1.

The same gap in the packaged studio window: helper unit tests passed while the window's real pack arguments failed against the SDK on a fresh store. `apps/studio/src/workflow/pack-session.test.ts` feeds those arguments to an in-process `StudioSession` on the real Greek content, the positive control the unit tests lacked.

## Related

- [World and persistence composed incorrectly despite green package tests](../integration-issues/world-persistence-composition-broken-after-reopen-2026-09-27.md)
- [Tick admission order starved external proposals, and each fix moved the starvation](../logic-errors/tick-admission-starved-external-proposals-2026-09-28.md)
- [A proposal acknowledged before it was durable was lost on a crash, and its retry answer did not survive a restore](../integration-issues/proposal-accepted-then-lost-before-durable-2026-09-28.md)
- [ADR-0008: World state and client transport](../../decisions/0008-world-state-and-client-transport.md)
