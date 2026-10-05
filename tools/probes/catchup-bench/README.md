# catchup-bench

## Question

One simulated hour of catch-up took about 17 s with the 20-mortal world and about 2.3 s with 2 mortals. The targets are **at most 5 s per hour (stretch 3 s)** and **every chunk under 250 ms**, so the service can run it on wake without a visible stall. Where does the time go, and which of the suspected causes are real?

**Status (2026-10-03):** answered and fixed. An aged 20-mortal hour went from **22.5 s to 3.8 s** and its worst chunk from 1,466 ms to about 120–150 ms, by two changes (time-ordered trace ids; an index over petitions), with the same events, trace, and projection as before. See [Results after the fixes](#results-after-the-fixes).

## Method

- **World.** The Unit 7 pack (7 gods, 20 mortals) frozen as `fixtures/unit7-pack.json`, cut from main `d566975` by `src/snapshot-pack.ts`. The file's sha256 is checked on every load (`PACK_SHA256`), so a changed fixture is an error, not a different benchmark. Biome ignores the fixture and the results.
- **Run.** One hour is 3,600 ticks, 60 chunks of 60 ticks, which is the world's own `catchUpChunkMs`. It runs through the real `runCatchUp` on an on-disk SQLite store in the system temp directory (WAL, `synchronous=NORMAL`, as production opens it), with the trace tables in the same file. The seed is fixed (`SEED = 20261003`).
- **Configurations.** 4 mortals and 20 mortals (the first N mortals in file order, all 7 gods, the buildings of dropped mortals removed), each from a **fresh** world and from an **aged** one: aged means 6 real one-hour catch-ups first, then the measured hour on a copy of that store. Five repetitions each; every table reports the **median**.
- **Two ways of measuring, so the instrumentation cannot move the headline.**
  - `runEndToEnd` runs the real `runCatchUp` and stamps every commit by wrapping the `commitTick` that `TickDeps` already lets a caller inject (60 chunk commits and the ending commit for a whole hour). Its total and chunk gaps are the headline numbers. It does not use the production `onChunkCommitted` callback for timing, because `runCatchUp` calls that only while ticks remain and so never for the last chunk (see [Correction](#correction-the-last-chunk-was-not-measured)); the callback only samples the WAL.
  - `runPhases` runs the same hour through `src/mirror.ts`, a copy of the chunk loop with a clock around each step, over a store, reducers, and trace database wrapped by `src/instrument.ts` (every SQL statement is timed into a category by its text; the transaction body is timed apart from the whole call; the reducers, the codec, and `JSON.parse`/`stringify` of projection-sized strings are timed). Nothing in `apps/` or `packages/` is edited to be measured, and nothing is imported by production code. `measure.test.ts` (at a four-minute gap, so 4 chunks; `bun run bench:hour` repeats the checks at the full hour) requires the mirror to produce the **same event stream and the same final projection** as the real function, so it does the same work. Its hour is a little longer than the real one (the clock reads); the table shows both.
  - `profile.ts` runs one hour of the real function in a child process under `bun --cpu-prof` and reads the profile back by function and by phase. It sees inside `stepWorldTick` and inside the native SQLite calls, which a timer around the whole call cannot.
- **Counts.** Rows and payload bytes added to the log and the trace, projection size, WAL peak (sampled at each chunk boundary), and database file growth.
- **Identity.** Three digests of what a run leaves in the store, with the ids minted fresh each run (observations, proposals) renamed in order of first appearance and wall-clock `recorded_at` left out: the whole event log, the whole trace (every observation, outcome, and link, in insert order), and the stored projection. `src/fingerprint.ts` records them for three worlds and compares later runs against the recorded ones; `results/fingerprint-baseline.json` is the baseline. Two runs of the same world agree exactly or not at all (checked), so any difference is a real change in what was written.

## How to run

```sh
cd tools/probes/catchup-bench
bun run bench                                    # the full matrix, 5 reps, writes nothing
bun run bench -- --label=after --out=results/after.json   # also writes after.json and after.md
bun run bench -- --reps=3 --mortals=20 --worlds=aged --aged-hours=6
bun run bench:profile -- --mortals=20 --world=aged --aged-hours=6 --out=results/profile-after-aged.md
bun run src/pragmas.ts --mortals=20 --aged-hours=4        # what the commit overhead is
bun run src/index-locality.ts                             # why trace writes were slow: key order, not statements
bun run src/fingerprint.ts --compare=results/fingerprint-baseline.json   # exits 1 if anything differs
bun test                                         # the harness's own tests (a four-minute gap, 4 chunks)
bun run bench:hour                               # the same validity checks at the full hour (60 chunks), outside bun test
```

A full matrix takes about 25 minutes. The 5 s sleep threshold is untouched.

## Environment

Apple M1 Pro, 16 GB, macOS 15.7.9, Bun 1.4.2, internal SSD, run on 2026-10-03 on branch `perf/catchup-bench` at its first commit (code identical to main `d566975`). Per-run noise: one 20-mortal aged repetition took 44 s against a 22 s median (another process was using the disk); medians are reported for that reason.

## Results: baseline (main d566975)

One hour of catch-up, median of 5. "Chunk gap" is the time from the previous commit to this chunk's commit (compute, commit, and the event-loop yield); "held" is compute plus commit for a chunk, from the instrumented run. **The baseline's chunk-gap columns were taken before the correction below and cover 59 of the 60 chunks (the last was not timed); the held columns come from the instrumented run, which times all 60.** The baseline could not be re-measured with the corrected harness without un-fixing the code.

| Mortals | World | Hour | Range | Median chunk gap | Worst chunk gap | Median chunk held | Worst chunk held | Events |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 4 | fresh | 0.91 s | 0.86–1.04 | 12.8 ms | 29.6 ms | 13.6 ms | 33.1 ms | 29,896 |
| 4 | aged (6 h) | 2.88 s | 2.76–3.25 | 46 ms | 432 ms | 46.6 ms | 133 ms | 29,912 |
| 20 | fresh | **4.96 s** | 4.78–5.02 | 81 ms | 122 ms | 85.5 ms | 136 ms | 96,909 |
| 20 | aged (6 h) | **22.5 s** | 22.0–44.2 | **355 ms** | **1,466 ms** | 349 ms | 1,014 ms | 95,457 |

The 17.4 s in the problem statement is a 20-mortal world with some history; a fresh 20-mortal world is already at the 5 s line, and an aged one is four times over it. **The aged 20-mortal world is the case to fix**, and the target is judged on it. Every chunk is under 250 ms only for the fresh worlds.

### Where an hour goes: 20 mortals

Median ms per hour from the instrumented run (`results/baseline.md` has all four configurations). The first block partitions the hour; the second splits the commit.

| Phase | Fresh ms | Fresh share | Aged ms | Aged share | Entries |
| --- | --- | --- | --- | --- | --- |
| routine planning (`buildRoutineQueue`) | 1,044 | 20% | **8,315** | **36%** | 3,660 |
| `stepWorldTick` (validate, apply, needs, memory, perception, practice and petition judging) | 689 | 13% | 1,071 | 5% | 3,600 |
| event-list recopy | 9 | 0.2% | 11 | 0% | 3,600 |
| screen observations | 12 | 0.2% | 33 | 0.1% | 60 |
| read pending external proposals | 5 | 0.1% | 9 | 0% | 60 |
| **chunk commits** | 3,286 | 64% | **13,481** | **58%** | 60 |
| ending commit (cursor, summary) | 106 | 2% | 187 | 0.8% | 1 |
| event-loop yields | 2 | 0% | 75 | 0.3% | 59 |
| *instrumented hour* | 5,158 | | 23,262 | | |
| *inside the commit:* event rows | 362 | 7% | 469 | 2% | 96k |
| projection row (SQL, decode, encode, JSON, and the reducer's 96k `applyEvent` calls) | 161 | 3.1% | 407 | 1.7% | 61 |
| trace writes: the whole `onCommitted` callback | 1,097 | 21% | 4,210 | 18% | 61 |
| of which trace SQL statements (observations, outcomes, links) | 804 | 16% | 3,713 | 16% | 268k |
| **commit overhead: BEGIN, COMMIT, WAL write, checkpoints** | **1,701** | **33%** | **8,691** | **37%** | 61 |

(The rows under "inside the commit" overlap with the commit's total; shares are of the instrumented hour.)

The CPU profile agrees (`results/profile-baseline-aged.md`, `profile-baseline-fresh.md`). Aged: routine planning 36%, transaction control 31%, trace JS and SQL 24%, `runTick` 3%, event rows 2%, projection 1.3%, the summary 0.9%, practice judging 0.8%, needs 0.7%.

### What was written

| Rows added in the hour (20 mortals) | Count | Bytes |
| --- | --- | --- |
| events | 96,909 fresh, 95,457 aged | 27.3 MiB, 28.0 MiB |
| trace observations | 72,000 | 13.7 MiB |
| trace proposal outcomes | 72,000 | 17.5 MiB |
| trace outcome-event links | 50,716 fresh, 53,903 aged | |
| projection row | 1 | 221 KiB fresh, 867 KiB aged |
| WAL peak | 10.4 MiB fresh, 18.7 MiB aged | |
| database file growth | 110 MiB fresh, 112 MiB aged | |

A routine proposal is **one observation, one outcome, and usually one link**, every tick for every mortal, whether or not it changes anything.

## Findings

Each of Oracle's suspects, against the numbers (aged 20-mortal hour unless said otherwise):

| Suspect | Measured | Verdict |
| --- | --- | --- |
| **Trace SQL and event SQL** (about 72k routine proposals an hour, each with an observation, an outcome, and link rows) | event rows 2%; trace writes 18% (4.2 s, of which 3.7 s is 271k SQL statements at 14 µs each). In the CPU profile, **the per-observation `SELECT`** that `recordObservation` runs before every insert (to detect a conflicting id) is about 1.5 s of the 5.6 s it puts in `traceWorldTick`. | **Real, third in size** (after the scans and the checkpoints). Worth doing, but it is not the whole of the trace cost. |
| **Projection reduced twice** (decode, reapply, encode in `commitTick`) | `codec:decode` 100 ms, `reduce:applyEvent` 102 ms (96k calls), `codec:encode` 4 ms, large-JSON parse and stringify 162 ms, projection SQL 39 ms: **407 ms, 1.7% of the hour** | **Not worth doing.** The projection is 0.2–0.9 MiB; it is read and written 61 times an hour. |
| **Routine and need scans** | Routine planning is **36% aged against 20% fresh, and 8.3 s against 1.0 s**. The cost is `prayerStep` → `prayableCauses`, which for every mortal on every tick builds a `Set` of every petition's cause, and scans every petition twice more (`inCooldown`, the open-subject set). Petitions grow by about 325 an hour and are never pruned (1,957 after 6 h; causes and memories are capped at 160 and 480), so the work grows with the age of the world. Needs (0.7%) and practice judging (0.8%) are negligible. | **The largest single cost in an aged world, and the reason age matters.** |
| **Chunk event list recopied every tick** | 9–11 ms an hour | **Not worth doing.** |
| **Summary loads every event before filtering** | 156–202 ms an hour (1%), in the ending commit | **Not worth doing** here. |
| **Hunger churn** (claimed, unverified) | Needs 0.7% of the hour; no phase is dominated by need events | **Not supported by the numbers.** |
| *(not in Oracle's list)* **commit overhead** | **8.7 s aged, 37%.** `pragmas.ts` shows it is **checkpointing**: with `wal_autocheckpoint=0` the same aged hour falls from 17.6 s to 11.9 s and the commit overhead from 7.2 s to 2.1 s (but the WAL then reaches 1 GiB, which is no fix); `wal_autocheckpoint=16384` (64 MiB) gives 13.5 s and 3.8 s with a bounded WAL; a 64 MiB page cache alone changes little. `results/pragmas-baseline.md`. Each chunk dirties pages across the large trace tables (their primary keys are random ids), so each automatic checkpoint writes and syncs scattered pages into a database that is 110 MiB larger every hour. | **The second-largest cost, and the one that makes chunks exceed 250 ms.** `synchronous=OFF` is ruled out and is not what this is. |

So the ranking by the numbers is: **routine planning's scans** (aged, 36%), **checkpointing** (37%), **the trace's writes** (18%), and then nothing else above 2%.

## What this does not show

- Only one machine and one disk; the checkpoint cost in particular depends on the disk and the OS cache. The 44 s outlier shows how much it can move.
- The aged world is 6 hours of this simulation's own catch-up; a world with live play, god turns, or more content will have different counts.
- `runPhases` times SQL statements by wrapping the database object; time spent inside `bun:sqlite`'s native code between statements is in the commit overhead, not the statements.

## Files

| Path | What |
| --- | --- |
| `fixtures/unit7-pack.json` | the immutable pack |
| `src/run.ts` | the matrix |
| `src/measure.ts`, `src/mirror.ts`, `src/instrument.ts`, `src/phases.ts` | the two measurements and their timers |
| `src/profile.ts`, `src/cpuprofile.ts` | the CPU profile run and reader |
| `src/pragmas.ts` | the commit-overhead diagnostic |
| `src/index-locality.ts` | the microbenchmark behind the first fix |
| `src/fingerprint.ts`, `src/world.ts` | the digests and the world helpers |
| `results/` | `baseline.md` and `after.md` (the matrix), `after-ordered-ids.md` and `after-petition-index.md` (each fix on its own, 20 mortals), `profile-baseline-*.md` and `profile-after-aged.md`, `pragmas-baseline.md`, `index-locality.md`, `fingerprint-baseline.json` |

## Results after the fixes

Two changes, in the order the numbers asked for them, each measured on its own (3 repetitions, `results/after-ordered-ids.md`, `results/after-petition-index.md`) and then together (5 repetitions, `results/after.md`).

| Change | Aged 20-mortal hour | Fresh 20-mortal hour |
| --- | --- | --- |
| baseline (main `d566975`) | 22.5 s | 4.96 s |
| **1. time-ordered observation and proposal ids** (`timeOrderedIdFactory`, a UUIDv7 under the same `obs-` and `proposal-` prefixes) | 12.1 s | 3.79 s |
| **2. petition index** (`prayableCauses` and the prayer cooldown read an index kept once per `petitions` Map) | **3.78 s** | **2.99 s** |

### Before and after, every configuration

One hour, median of 5 (`results/after.md`). Same 29,896, 29,912, 96,909, and 95,457 events as the baseline in each row.

| Mortals | World | Hour before → after | Median chunk gap before → after | Worst chunk gap before → after | Worst chunk held before → after |
| --- | --- | --- | --- | --- | --- |
| 4 | fresh | 0.91 s → 0.71 s | 12.8 → 10.3 ms | 29.6 → 23.4 ms | 33.1 → 26.8 ms |
| 4 | aged (6 h) | 2.88 s → 0.82 s | 46.0 → 11.4 ms | 432 → 34.5 ms | 133 → 36.9 ms |
| 20 | fresh | 4.96 s → **2.97 s** | 81.4 → 46.9 ms | 122 → 67.6 ms | 136 → 64.1 ms |
| 20 | aged (6 h) | 22.5 s → **3.81 s** | 355 → 61.4 ms | 1,466 → **122.6 ms** | 1,014 → 124.3 ms |

The "after" columns are all 60 chunks (the "before" gap columns are 59; see the note under the baseline table).

**Targets.** At most 5 s an hour: met in every configuration (the aged 20-mortal world, the one that was four times over, is 3.81 s). Every chunk under 250 ms: met (worst chunk gap 122.6 ms, worst compute-plus-commit 124.3 ms, in the aged 20-mortal world; the worst of any single run in 10 runs of that world was 147.9 ms, see below). The ending commit (the cursor's jump and the backlog's summary, which is not a chunk) runs once after the last chunk and took up to 130 ms. Stretch of 3 s: met for the fresh 20-mortal world (2.97 s, and 2.84 s in an earlier set of runs) and not for the aged one (3.81 s). The work stopped there, as asked.

### Where the aged 20-mortal hour goes now

Median ms per hour, instrumented run (`results/after.md`, `results/profile-after-aged.md`).

| Phase | Before | After |
| --- | --- | --- |
| routine planning | 8,315 | **540** |
| `stepWorldTick` | 1,071 | 818 |
| chunk commits, in total | 13,481 | **2,438** |
| · commit overhead (BEGIN, COMMIT, WAL write, checkpoints) | 8,691 | **644** |
| · trace writes (`onCommitted`) | 4,210 | **974** (SQL statements 3,713 → 667) |
| · event rows | 469 | 404 |
| · projection (SQL, parse, decode, reduce, encode, stringify) | 407 | 442 |
| the ending commit (cursor, summary) | 187 | 112 |
| *instrumented hour* | 23,262 | **3,974** |
| WAL peak | 18.7 MiB | 5.9 MiB |

The profile's order is now trace JS and SQL 19%, transaction control 18%, `runTick` 16%, routine planning 14%, event rows 12%, projection 8%; nothing is above a fifth.

### Why these two, and why they work

**1. Time-ordered ids (`packages/contracts/src/ids.ts`, `packages/telemetry/src/trace.ts`).** The trace keys three indexes by ids that were random UUIDs (`trace_observations.id`, `trace_proposal_outcomes.proposal_id`, `trace_outcome_events.proposal_id`). A random key lands on a random page of an index that gains 72,000 entries an hour and never shrinks, so every 60-second chunk dirtied pages across the whole of three multi-megabyte B-trees; each commit then wrote them, and each automatic checkpoint wrote and synced them again into a 110 MiB-larger file. That was the commit overhead (37%) and most of the trace's SQL time, and it is why age mattered. `index-locality.ts` isolates it: 72,000 inserts into a 500,000-row table take 2.5–2.7 s however the statement is prepared (a cached statement, `ON CONFLICT DO NOTHING`, or a 64 MiB page cache change them by under 6%) and **0.2–0.3 s with time-ordered keys**. A UUIDv7 keeps the shape every consumer already saw, sorts in creation order, and uses a 12-bit counter so ids made in one millisecond still increase; a clock reading that goes backwards is clamped. Only observation and proposal ids changed; every other id is still random.

**2. Petition index (`packages/world/src/petitions.ts`).** `prayableCauses` answered "may this mortal pray, and about what" by walking every petition three times, for every mortal, every tick; petitions are never pruned (about 325 an hour, 1,957 after six hours). The answer is a pure function of the `petitions` Map, so the index (causes already prayed about, each petitioner's newest petition tick, each petitioner's open subjects) is built once per Map object and kept in a `WeakMap` keyed by it. That is sound because a `WorldState` is never changed in place: every reducer that touches a petition copies the Map first, and the old Map and its index are garbage. Nothing is stored on the state, so nothing is persisted, encoded, or compared. The newest-tick rule is equivalent to the old "any petition younger than the cooldown" because the age is monotone in the tick.

### What was proved for each

- **Same events, same trace, same world.** `src/fingerprint.ts` digests the whole event log, the whole trace (every observation, outcome, and link, in insert order), and the stored projection for three worlds, with the ids minted fresh each run renamed in order of first appearance. After each fix and at the end the digests equal `results/fingerprint-baseline.json`. The matrix agrees too: the same event and projection digests as the baseline in all four configurations, and the same observation, outcome, and link counts. The digests are sensitive (`harness.test.ts` changes a field, a link, a reason, or an order and each digest moves).
- **Trace causality.** Every run of the matrix checks that every outcome has its observation and proposal, every link names an event in the log whose correlation matches the outcome's, and every event a proposal produced has an outcome: zero violations in all 40 runs.
- **Archive export/import, replay equals live, a write failure rolls the whole chunk back.** Unchanged code paths with their existing tests, all passing: the archive and import suites, `world-store.test.ts` (live equals reopened equals rebuilt, with threads and supplications), the catch-up commit-failure and trace-failure tests, scenario S14 (export, corrupt copy, import, restore), and `restore-memory` and its control in the second scenario.
- **New tests, red then green.** `ids.test.ts` and `trace.test.ts` (time-ordered ids: shape, strictly increasing in a burst of 10,000, across a clock that steps backwards, distinct across factories, and other ids still random) were red on the missing factory and on random order; `catchup.test.ts` ("catch-up appends to the trace in id order") was red on the old ids and green on the new; `petition-index.test.ts` (equivalence with the plain scan over the cases that decide the answer, a scan-count bound that stays at one however often it is asked, and a change to the petitions being seen at once) was red on the scan count, and five mutations of the index are each caught.

### What was not needed

| Planned fix | Why it was not done |
| --- | --- |
| 1. Prepared, batched event and trace inserts | `index-locality.ts` shows a cached or multi-row statement moves the cost by about 6%, and multi-row is slower. After the two fixes the trace's SQL is 0.65 s and the event rows 0.36 s of 3.9 s, so the most it could return is a few percent. |
| 2. Persist the computed projection | The projection costs about 0.43 s of 3.9 s (11%): it would remove the parse, decode, and re-reduce (about 0.35 s) but not the encode and write. It was 1.7% of the 22.5 s hour and is not needed for the target; it is the next thing to try for the 3 s stretch, with the sequence and base-revision checks the plan describes. |
| 3. Chunk event-list recopy, summary in SQL | 11 ms and 97–110 ms an hour. |
| 4. More indexes or dirty sets | The two above were the indexes the numbers asked for. |
| `wal_autocheckpoint` | Not needed once the pages stopped being scattered: the commit overhead fell from 8.7 s to 0.6 s with the default. |

### Side effects and things to know

- **A second catch-up pass is gone.** The first scenario's S13 used to see a second, short catch-up pass after the cap because an hour took longer than the 5 s sleep threshold. An hour is now under it: a probe of that step saw 0 later ticks and no approximate events after the summary. The step stays tolerant of one.
- **Database growth is unchanged**, 110 MiB an hour with 20 mortals: about 72,000 routine proposals an hour are each written to the trace. That is a retention question, not a speed one, and it is not addressed here.
- **A race in `apps/simulation/src/index.crash.test.ts`.** Once, in a full `bun run check` under whole-workspace load, its cap assertion saw 3,601 ticks, because a live tick ran in the second between the "startup catch-up complete" log line and the test's SIGTERM. It passed 10 of 10 alone and on the rerun. The assertion treats a live tick after catch-up as catch-up; it predates this work and is unchanged.

## Correction: the last chunk was not measured

*Added after review of the first version of this record.* `runEndToEnd` first timed chunks from the production `onChunkCommitted` callback. `runCatchUp` calls that callback only while ticks remain (`ticksDone < totalTicks`), so for a whole hour of 3,600 ticks in 60 chunks it fires 59 times and never for the last chunk. The first version's "worst chunk" figures (124 ms aged) came from 59 of the 60 chunks per run.

**The fix** stamps every commit instead, by wrapping the `commitTick` that `TickDeps` already injects, and times the **ending commit** (the cursor jump and the summary, which follows the last chunk with no yield between) as its own interval. It is the simpler of the two options: it needs no change to production code and cannot miss a boundary. `measure.test.ts` holds it: a real run of a four-minute gap at 60-tick chunks must record 4 gaps (60 for the full hour, which `bun run bench:hour` checks), the last included, which together with the ending commit tile the whole run to within 5 ms; the same assertion failed with 59 on the old measurement, and `runEndToEnd` now throws if the commits it sees are not the 60 chunks and the ending one.

**What the last chunk showed.** It is an ordinary chunk, not a spike. Over the 10 runs of the 20-mortal worlds measured since the fix, the last chunk's gap was 41–52 ms fresh and 61–78 ms aged, against median chunk gaps of 46.9 and 61.4 ms. The first version's worst-chunk figures were therefore not hiding a slow final chunk.

**Why the worst chunk still moved.** The worst chunk is a maximum over 300 chunks per configuration, so it varies between sets of five runs, and it falls on a different chunk each run (in four of five aged runs in one set it was chunk 1, the second). Two complete sets of five runs of the 20-mortal world with the corrected measurement gave:

| 20 mortals | Hour (median) | Worst chunk gap | Worst chunk held (instrumented) |
| --- | --- | --- | --- |
| fresh, first set | 3.09 s | 123 ms | 104.9 ms |
| fresh, second set (the table above) | 2.97 s | 67.6 ms | 64.1 ms |
| aged, first set | 3.78 s | 147.9 ms | 143.2 ms |
| aged, second set (the table above) | 3.81 s | 122.6 ms | 124.3 ms |

So the aged worst chunk is **123–148 ms**, not a single number, and always under the 250 ms target. The record keeps the second set as the table because it also re-measured the 4-mortal worlds in the same session; the first set's results were not kept as files (the second replaced `results/after.json` and `results/after.md`).

**What else used the old measurement.** `results/after-ordered-ids.md` and `results/after-petition-index.md` (each fix measured alone, 3 repetitions) and the baseline's chunk-gap columns were taken with the 59-gap method; their hour totals are not affected (the total was always the whole call), their chunk-gap columns exclude the last chunk, and they are kept as the record of those runs. The instrumented run's per-chunk "held" times (`runPhases`) always included every chunk.
