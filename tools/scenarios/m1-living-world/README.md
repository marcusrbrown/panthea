# m1-living-world: headless causal scenario

## Question

Does the compiled sidecar keep a persistent living world causally honest end to end: routines act unattended, a strike becomes fire, lost service, and repair, worship grants a favor that expires, legends stay attributed records, bad proposals are rejected without effect, pause and a kill mid catch-up past the cap never applies time twice, an accepted proposal survives a kill, archives survive corruption and restore into a branch, and the strike's ignition traces from its observation through the headless client's presentation receipt?

## How to run

```sh
bun run --cwd tools/scenarios scenario:m1                                  # build the sidecar, run the story
bun run --cwd tools/scenarios scenario:m1 --skip-build                     # reuse the built sidecar
bun run --cwd tools/scenarios scenario:m1 --positive-control=archive       # must exit non-zero
bun run --cwd tools/scenarios scenario:m1 --positive-control=catch-up      # must exit non-zero
bun run --cwd tools/scenarios scenario:m1 --positive-control=journal       # must exit non-zero
bun run --cwd tools/scenarios scenario:m1 --positive-control=bad-proposals # must exit non-zero
bun run --cwd tools/scenarios scenario:m1 --positive-control=claim-owner   # must exit non-zero
bun run --cwd tools/scenarios scenario:m1 --positive-control=pause         # must exit non-zero
bun run --cwd tools/scenarios scenario:m1 --positive-control=underworld    # must exit non-zero
bun run --cwd tools/scenarios scenario:m1 --write-readme [--jobs=4]        # story, then every control four at a time (--jobs=N), rewrites this file
```

The scenario builds the sidecar with `apps/simulation/scripts/build-sidecar.sh`
and runs the compiled binary directly, with no Tauri. Each run uses a fresh
temporary app-data directory (`PANTHEA_APP_DATA_DIR`), so the authored Greek
world is the seed. The harness writes a launch token to the binary's stdin,
keeps stdin open, reads `PANTHEA_PORT` from stdout, and calls the sidecar
over authenticated loopback HTTP. Every `POST /proposals` carries a
producer-generated `proposalId`; outcomes are read through
`/trace/proposal?id=` and `/trace/event?id=`. The run stops at the first
violated invariant, exits 1, kills every child, and removes its temporary
directory. It is not part of `bun run check`; only the pure helpers in
`src/helpers.test.ts` and `src/report.test.ts` are.

Assertions are about committed world state. Whatever the sidecar serves is
read through its API: the decoded frame (tick, sequence, status, state), the
trace queries (proposal outcomes, event chains, presentation receipts), and a
proposal retry's status. Only facts no endpoint exposes are read from the
store, read-only: event payloads and correlation ids, the wall cursor and paused
flag, observation counts, the proposal journal, catch-up progress, the set of
stored receipts, integrity checks, slot contents, and any state inspected while
the sidecar is stopped or killed. Waits are bounded polls that name the
invariant they wait for, never fixed sleeps that decide a result. The harness
does manipulate wall time and processes; that is the fault injection, described
per step below.

Fault injections, one per negative claim:

- **Machine slept for three hours:** with the sidecar stopped, the harness
  moves the persisted wall cursor back by 10,800,000 ms. The next start sees a
  gap of three times the one-hour cap and runs startup catch-up.
- **Killed during catch-up:** `SIGKILL` once catch-up has committed at least
  two 60-second chunks of the capped backlog.
- **Killed with a proposal accepted and no tick run:** `SIGKILL` right after a
  `202`, then the cursor is moved back two minutes so the restart's catch-up
  is what runs the proposal.
- **Corrupted archive:** one byte inside stored event data is changed in a
  copy of an export.
- **Paused world:** an operator `/pause` holds the world still while a fixture
  repair is chosen and accepted.
- **Malformed, false, and stale proposals:** posted from JSON files in
  `src/fixtures/`.

## Caveat

Not covered:

- **The packaged desktop app and the view.** No Tauri, no rendering. The client
  modules run headlessly against a polling transport. The packaged app is
  covered by [m1-packaged-shell](../m1-packaged-shell/README.md) and the Unit 8
  view gate.
- **The shell's exact forwarding.** The harness polls `GET /frame` every 250 ms
  and forwards a frame when its sequence, status, or session id changes. The
  shell polls once a second.
- **Real OS sleep and wake, and clock jumps.** Both sleeps are a rewritten
  cursor in a stopped store, not a slept machine. Backward clock jumps are not
  driven.
- **Power loss.** `SIGKILL` stops the process; it does not drop unsynced pages.
- **Disk-full and store errors.** No degraded status is provoked.
- **Import staging crashes.** Only a corrupted archive is injected, not a crash
  during import.
- **Trace records in archives.** Archives carry world state and the proposal
  journal with each entry's outcome, but not trace records. The run compares
  journals and event histories across export, import, and restore; it does not
  (and cannot) compare causal trace, so a restored branch has none for history
  before the restore.
- **A kill after the catch-up summary was published.** The service persists
  the summary in the commit that ends the backlog and serves it from the first
  frame after a restart, so the old window is closed. That is covered by the
  subprocess tests in `apps/simulation/src/index.test.ts`, not by this run: S13
  kills mid catch-up, not after the backlog ended. No export is taken while a
  backlog is open, so archives carrying an open backlog's progress are not
  driven here either.
- **Time between a kill and its restart.** The cap bounds the remaining
  backlog, so seconds that pass while the service is down are new gap, applied
  once on top of the capped total. S13 measures that extra (0 s in the recorded
  run) and bounds it by the measured downtime; it does not assert an exact total
  of one cap.
- **M2 and later.** No model proposals, memory, or generated behaviors; the
  causal chain is the M1 part of O04 only.
- **Balance.** Fire spread, economy, and repair numbers are observed, not
  tuned or asserted beyond the rules in the content files.

## Environment

| Field | Value |
| --- | --- |
| Hardware | Apple M1 Pro |
| Memory | 17179869184 |
| OS | macOS 15.7.9 (24G830) |
| Bun | 1.4.2 |
| Tauri | 2.12.0 |
| Three.js | 0.185.1 |
| Three Flatland | 0.1.0-alpha.10 |

## Results

| Metric | Unit | Samples | p50 | p95 |
| --- | --- | --- | --- | --- |
| S1 seed locations | count | 1 | 15 | 15 |
| S1 seed actors | count | 1 | 3 | 3 |
| S1 seed buildings | count | 1 | 3 | 3 |
| S2 unattended events | count | 1 | 30 | 30 |
| S3 divinity spent | divinity | 1 | 1 | 1 |
| S3 oak revision change | revisions | 1 | 1 | 1 |
| S4 divinity spent | divinity | 1 | 3 | 3 |
| S5 ticks from ignition to destruction | ticks | 1 | 3 | 3 |
| S6 tavern income events during the fire | count | 1 | 0 | 0 |
| S6 shop income events during the fire | count | 1 | 3 | 3 |
| S7 planks spent on repair | planks | 1 | 3 | 3 |
| S7 ticks from destruction to repair | ticks | 1 | 4 | 4 |
| S8 divinity gained from worship | divinity | 1 | 1 | 1 |
| S8 favor duration | ticks | 1 | 10 | 10 |
| S8 favored gather yield over base | resource | 1 | 1 | 1 |
| S9 legends held | count | 1 | 3 | 3 |
| S10 bad proposals posted | count | 1 | 5 | 5 |
| S11 ticks advanced after resume | ticks | 1 | 2 | 2 |
| S12 target tick of the killed proposal | tick | 1 | 37 | 37 |
| S13 chunks committed before kill | chunks | 1 | 2 | 2 |
| S13 ticks applied by the whole backlog | ticks | 1 | 3600 | 3600 |
| S13 seconds discarded beyond the cap | s | 1 | 7200 | 7200 |
| S13 ticks over cursor seconds (must be 0) | ticks | 1 | 0 | 0 |
| S14 exported event sequence | events | 1 | 15033 | 15033 |
| S14 slots after import, corrupt import, and restore | slots | 1 | 2 | 2 |
| S15 receipts stored | count | 1 | 38 | 38 |
| S15 receipt relay errors (restarts) | count | 1 | 0 | 0 |
| S16 strike ignition chain hops | hops | 1 | 6 | 6 |
| S16 worship chain hops | hops | 1 | 6 | 6 |
| S16 trade chain hops | hops | 1 | 6 | 6 |

## Findings

- **S1 Seed** (0.0 s). Asserts: A fresh data directory loads the authored Greek world across three realms with nothing committed yet, and its first frame carries no catch-up summary. Measured: 15 locations (mortal 10, underworld 3, olympus 2), 3 actors, 3 buildings, sequence 0; first frame has no catch-up summary.
- **S2 Unattended routines** (8.0 s). Asserts: With no external input, routines commit events every tick, and every observation on record is a routine's. Measured: 8 ticks, 30 events, kinds income-earned, resource-consumed, resource-gathered, resource-produced, resource-traded; observations by source {"routine":16}.
- **S3 Strike a tree** (1.0 s). Asserts: A fixture strike below the ignition threshold damages the old oak, a tree: the committed events are a divinity spend and a building-damaged event on the oak, both caused by the strike's observation and walkable through the trace; the oak's status changes from operational to damaged in world state, and it is not burning. Measured: strike of power 1 (ignition threshold 3) at sequences 31-32: old oak operational -> damaged (revision 0 -> 1); divinity 10 -> 9; trace chain observation -> proposal -> validation -> event -> projection-change.
- **S4 Strike** (1.0 s). Asserts: A deity's fixture strike commits through the validator: divinity is spent and the combustible tavern ignites, both caused by the strike's observation. Measured: strike committed at sequences 37-38; divinity 9 -> 6; tavern burning at intensity 1.
- **S5 Fire** (1.9 s). Asserts: Fire burns on its own after ignition for the authored number of ticks, destroys the tavern, and disposes its goods through a declared sink; a non-combustible building never ignites. Measured: 2 burn ticks then destroyed at sequence 51 (3 ticks after ignition); disposed [{"resource":"wine","amount":4}]; shop operational; old oak burning.
- **S6 Lost service** (0.0 s). Asserts: A burning and then destroyed tavern offers no services and earns no income while the untouched shop keeps earning. The operator pauses the world once the tavern is down. Measured: world paused with the tavern destroyed: services [] of authored ["drink"]; from ignition to destruction tavern income events 0, shop 3.
- **S7 Repair** (5.1 s). Asserts: A fixture repair by an actor holding planks, accepted while the world is paused, stays pending until ticking resumes and then commits, taking the actor's slot from its routine. Repair spends exactly the authored cost in planks; service and income return and the goods lost in the fire stay lost. Measured: 3 repair steps spent 3 planks (cost 3); the fixture repair by farmer was accepted while paused, stayed pending through 1.5 s with no tick (a retry reported pending), and committed once resumed; tavern operational again 4 ticks after destruction.
- **S8 Worship and favor** (11.0 s). Asserts: A fixture worship by a mortal with a routine commits (its routine yields the slot): the deity's divinity rises by the authored gain, the worshiper holds a favor with its source and duration, the favor raises the worshiper's gather yield while it lasts, and the yield returns to normal once it expires. Measured: worship at sequence 69 (tick 17): divinity 6 -> 7; favor from zeus expires at tick 27 (10 ticks); gather 3 at tick 22 inside the window, 2 at tick 27 after it.
- **S9 Legends** (4.0 s). Asserts: A legend that cites a committed event is recorded event-linked, one told with no link is recorded unlinked, and a legend citing an unrelated event is recorded the same way: the world keeps the narrator's assertion and their evidence link, attributed, and certifies none of it (no verified flag exists). A legend linking an unknown event is refused at intake. Measured: event-linked legend by the woodcutter at sequence 112 cites evt-10-38; unlinked legend by the farmer at sequence 113; zeus's legend citing the same event for an unrelated tale at sequence 116 recorded event-linked, uncertified; both mortal tellings committed although both narrators have routines; unknown link refused (400) with no record; legends in world state: 3, all distinct, none with a truth flag.
- **S10 Malformed, false, and stale proposals** (3.0 s). Asserts: Malformed input is refused at intake with no journal entry and no record; a false claim and a stale proposal are journaled and recorded as rejections with a reason code; none of them changes the world. Measured: refused at intake (400): invalid JSON, missing observation, self-declared costs; recorded rejections: claim unauthorized-claim, stale strike stale-target; events caused by all five: 0; old oak owner unchanged.
- **S11 Pause across restart** (10.6 s). Asserts: A paused world commits nothing, stays paused through a clean restart, and the paused wall time never becomes catch-up when it resumes. Measured: paused at tick 34, sequence 140; unchanged through 2.5 s, a clean restart with 4 s down, and 2.5 s after; resumed: +2 ticks; operator observations 2 -> 4.
- **S12 Durable proposal across a kill** (2.1 s). Asserts: A proposal accepted over /proposals and then SIGKILLed before any tick is still in the journal on restart, runs exactly once on a catch-up tick with a recorded outcome, and a retry of its proposalId reports that outcome without running it again. Measured: accepted at clock tick 36, SIGKILLed while pending; after restart it ran on catch-up tick 37 (one approximate legend-recorded event), outcome committed; a retry returned committed, changed content 409.
- **S13 Kill mid catch-up past the cap** (0.8 s). Asserts: After a three hour sleep, catch-up discards the excess over the one-hour cap in its own commit before any chunk. A SIGKILL partway through and a restart then apply the rest of the capped backlog once: the restarted frame's summary reports the whole backlog, and ticks since the discard equal whole seconds of cursor advance. Measured: sleep 3 h, cap 1 h: excess 2.000 h discarded before the chunks; killed after 2 chunks (120 ticks); restarted summary applied 3600 ticks (the cap plus 0 s of downtime), skipped 2.000 h; 14400 approximate events.
- **S14 Export, corrupt copy, import, restore** (3.9 s). Asserts: An export imports into a new slot; a copy with one changed byte is rejected and creates no slot; restoring the snapshot makes a branch slot holding the same history and the same proposal journal (ids, order, terminal outcomes) up to the snapshot while the active world is untouched. Measured: export at sequence 15033; import made 1 slot; corrupted copy rejected (422) with no slot and no staging directory; restore made a second slot; both slots hold 15033 events and 10 journal entries matching the active world; the active world was at sequence 15049 before the restore and 15049 after.
- **S15 Headless client receipts** (3.6 s). Asserts: The client receipts only events it placed in the viewed realm: every stored receipt was sent by the client, none is for an undrawn kind, the tree strike's damage, the tavern strike, the fire, the worship, and a routine trade were receipted in the session they happened in, and a client viewing another realm sends none. Measured: 38 receipts stored by the mortal-realm client ({"building-ignited":2,"resource-traded":31,"building-destroyed":2,"building-repaired":1,"worship-performed":1,"building-damaged":1}); oak damage, ignition, destruction, worship, and trades receipted; underworld client received frames and sent 0; relay errors during restarts 0.
- **S16 Trace** (0.0 s). Asserts: Every chain is walkable from the identifiers the producer used: a rejected proposal ends at its rejection, a routine trade and a worship reach the presentation receipt the client sent, and the strike's own ignition walks observation, proposal, validation, event, projection change, and the client's presentation receipt. Measured: stale chain observation -> proposal -> validation (stale-target); trade chain and worship chain each end at the client's receipt; strike from its proposal: observation -> proposal -> validation -> event -> projection-change -> event -> projection-change -> receipt; strike ignition chain observation -> proposal -> validation -> event -> projection-change -> receipt (event sequence 38, receipt session session-0aade7b1...).
- **Positive control `archive`.** The harness skips the byte change, so the "corrupted" copy is a clean export and importing it must be refused. The run exited 1 with: FAIL invariant violated: importing the corrupted copy is rejected -- status 200: the copy was imported into a new slot
- **Positive control `catch-up`.** After the kill, the harness rewinds the persisted cursor to where the chunks began, so the restart replays time the committed chunks already applied. The run exited 1 with: FAIL invariant violated: after the second catch-up, ticks since the discard equal whole seconds of cursor advance (nothing was applied twice) -- {"ok":false,"ticksAdvanced":3720,"ticksForCursorAdvance":3600}
- **Positive control `journal`.** After the kill, the harness deletes the accepted proposal from the journal, as if the service had kept it only in memory, so nothing consumes it after the restart. The run exited 1 with: FAIL invariant violated: the accepted proposal was consumed after the restart -- not observed within 5000 ms
- **Positive control `bad-proposals`.** The harness adds the tree strike's observation, which did cause events, to the list of bad proposals' observations, so the check that they caused no event sees a change. The run exited 1 with: FAIL invariant violated: no bad proposal caused an event -- obs-97f47a07-b6c3-4618-aa4d-3326b7c0817f
- **Positive control `claim-owner`.** The harness checks the tavern, which has an owner, instead of the old oak for the false claim's effect, so the check that the claim granted no owner sees one. The run exited 1 with: FAIL invariant violated: the false claim did not give the old oak an owner -- farmer
- **Positive control `pause`.** The harness resumes the world just before stopping it, so it is running when it stops and cannot come back paused. The run exited 1 with: FAIL invariant violated: the restarted world is still paused -- running
- **Positive control `underworld`.** The second client follows the farmer in the mortal realm instead of the underworld, so it sees and receipts mortal events. The run exited 1 with: FAIL invariant violated: a client viewing the underworld places and receipts nothing while mortal events happen -- 6 sent

## Bottom line

All 16 steps held on the tree this README was committed with. The story ran in 56 s; the whole evidence run, with every control, took 376 s. All 7 positive controls exited non-zero, so the assertions they target are live. The compiled sidecar binary was 60 MiB.
