# Unattended run

**Verdict: PASS**

Running time 60.0 min of 60; elapsed wall time 60.2 min (the stopped gap of 90.0 min is not running time).
The model ran at a local OpenAI-compatible endpoint (granite3.3-8b-4k, reasoning none).

## What this run proves

- A14 (export and rebuild): the exported archive and a rebuild from genesis and the event log reproduce the live world, once, on this world. It proves export and rebuild only; it does not prove import into a different build or machine.
- P07 (provider outage): the world kept running through a local outage of the model endpoint, and the gods acted again when it returned. It proves a local outage only, produced by a proxy; it does not prove behaviour under a hosted provider's failure modes.
- It makes no claim for A15 (the eight-hour trial) and no claim beyond one hour of running time.

## Phase timeline

| Phase | Wall time (UTC) | Tick | Running (min) | Note |
| --- | --- | --- | --- | --- |
| started | 2026-10-10T15:16:30Z | 0 | 0.0 |  |
| outage-started | 2026-10-10T15:17:32Z | 62 | 1.0 | 5 of 7 gods had acted |
| proxy-restored | 2026-10-10T15:29:32Z | 780 | 13.0 |  |
| stopped | 2026-10-10T15:39:32Z | 1379 | 23.0 |  |
| restarted | 2026-10-10T15:39:33Z | 1379 | 23.0 |  |
| catch-up-finished | 2026-10-10T15:39:41Z | 4987 | 23.2 |  |
| ended | 2026-10-10T16:16:31Z | 7196 | 60.0 |  |

The outage started when 5 of 7 gods had acted.

## Gods

| God | Actions | Legends | Longest run | Requests | Answered | Exhausted | Over cap | Rejected | Goal-only | Influence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| athena | 36 | 0 | 1 | 140 | 36 | invalid output 1, outage 103 | 1 | 0 | 0 | 25 |
| hades | 36 | 1 | 2 | 140 | 37 | outage 103 | 0 | insufficient-resources 1 | 0 | 28 |
| hephaestus | 35 | 0 | 1 | 142 | 39 | outage 103 | 0 | stale-target 3 | 0 | 23 |
| hera | 36 | 1 | 2 | 140 | 37 | outage 103 | 0 | stale-target 1 | 0 | 21 |
| hermes | 41 | 0 | 2 | 143 | 41 | outage 102 | 0 | 0 | 0 | 30 |
| poseidon | 36 | 0 | 1 | 142 | 39 | invalid output 1, outage 102 | 0 | not-adjacent 2, malformed 1 | 0 | 27 |
| zeus | 41 | 5 | 2 | 144 | 41 | outage 103 | 0 | 0 | 0 | 34 |

Counts leave out the outage window; its requests appear under exhausted as outage.

### Idle reasons

- athena: 1 gap longer than 105 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.
- hades: 1 gap longer than 105 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.
- hephaestus: 1 gap longer than 105 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.
- hermes: 1 gap longer than 105 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.

### Relationship and belief changes by phase

| God | steady | outage | recovery | catch-up | after catch-up |
| --- | --- | --- | --- | --- | --- |
| athena | 0 | 0 | 6 | 0 | 19 |
| hades | 0 | 0 | 6 | 0 | 22 |
| hephaestus | 0 | 0 | 8 | 0 | 15 |
| hera | 1 | 0 | 5 | 0 | 15 |
| hermes | 1 | 0 | 7 | 0 | 22 |
| poseidon | 0 | 1 | 8 | 0 | 18 |
| zeus | 0 | 0 | 8 | 0 | 26 |

## Queue wait and quiet stretches

| God | Turns | p95 queue wait, service time | p95 including the windows | Longest quiet stretch | Where |
| --- | --- | --- | --- | --- | --- |
| athena | 37 | 102 | 820 | 139 | ticks 5206 to 5345 |
| hades | 37 | 96 | 826 | 108 | ticks 14 to 840 |
| hephaestus | 39 | 93 | 832 | 114 | ticks 19 to 851 |
| hera | 37 | 96 | 818 | 100 | ticks 46 to 864 |
| hermes | 41 | 92 | 96 | 118 | ticks 1299 to 5025 |
| poseidon | 40 | 94 | 745 | 105 | ticks 1323 to 5036 |
| zeus | 41 | 96 | 96 | 105 | ticks 1333 to 5046 |

Service time leaves out outage start to proxyRestoredAt (ticks 62 to 780) and stop to the end of the catch-up (ticks 1379 to 4987). Waiting after the proxy returned counts.

## Latency

Steady-state requests took a median of 9.8 s and a p95 of 12.7 s. The first request after the proxy returned took 13.8 s, kept apart because it may include a cold reload (the Ollama runner was absent when the proxy returned).

## Recovery

proxyRestoredAt was tick 780. Reasoning resumed at tick 795, 15 ticks later. The first god action committed at tick 795 (hermes), 15 ticks later.

## Prompt size and the empty-200 fault

The busiest prompt was 2920 tokens of 4096 (279 responses counted). A response matched to its request is taken as cut when it reports far fewer tokens than its prompt's length predicts from this run's median of 0.320 a character. One with no prompt length to read it against is only suspected, when it reports exactly 2050 tokens (what Ollama reports for a cut prompt at this context); a suspected cut does not fail the row. None was cut.
Ollama's empty-200 response occurred 0 times, at most 0 in a row.

## Director events by kind and phase

| Kind | steady | outage | recovery | catch-up | after catch-up |
| --- | --- | --- | --- | --- | --- |
| stock-spoiled | 0 | 3 | 3 | 10 | 8 |
| theft | 0 | 3 | 2 | 20 | 10 |

## Memory

361 samples over 60.0 min. Ollama runner: start 5347 MiB, peak 9052 MiB, end 6570 MiB (349 present, 12 absent); footprint start 704 MiB, peak 5525 MiB, end 5502 MiB. Sidecar: RSS start 60 MiB, peak 357 MiB, end 153 MiB. Sidecar footprint: start 33 MiB, peak 141 MiB, end 125 MiB. Swap used: peak 2325 MiB.

The memory row is judged on the sidecar's physical footprint across the settled span: -1.36% (the mean of the second half over the first half's, over 21.8 min that start after the first 15 minutes (scaled to the run's length) following the last catch-up; 125 MiB then 123 MiB; at most +10% passes). It is not judged on RSS, which counts pages the allocator has freed and the kernel has not taken back and rises under allocation churn, nor on a slope: a window slope of a footprint that swings by ±10 MiB reads differently with where the window sits. For context only, Footprint trend over the last 20 minutes: 0.85% per 10 min over the last 120 samples. Sidecar RSS trend: 3.35% per 10 min over the last 120 samples.

## Export and rebuild

Store 241 MiB (WAL 0 MiB); archive 92 MiB at event 201878. Rebuild from genesis and 201878 events took 479.71 ms in a separate process and equals the live projection. The archive imported into a scratch slot (201878 events).

## Threshold table

| Threshold | Result | Measured | Limit |
| --- | --- | --- | --- |
| the run went through every phase and the sidecar stayed up | pass | completed | completed |
| running time reaches the plan's length | pass | 60.0 min running of 60; 60.2 min elapsed | 60 min running |
| the tick keeps advancing through the outage | pass | tick 62 to 780 | advances |
| mortals' routines and the director keep producing events through the outage | pass | 19283 events not caused by a god | at least 1 |
| no god action commits during the outage | pass | 0 committed actions | 0 |
| reasoning resumes: a request is answered with an intent within 150 ticks of proxyRestoredAt | pass | answered 15 ticks after (tick 795) | at most 150 ticks |
| gods act again: a god action commits within 150 ticks of proxyRestoredAt | pass | hermes committed 15 ticks after (tick 795) | at most 150 ticks |
| the sidecar stops cleanly | pass | exit code 0 | holds |
| the catch-up is bracketed by its own log lines | pass | 2026-10-10T15:39:33.007Z .. 2026-10-10T15:39:38.202Z | holds |
| the catch-up applies the cap and discards the rest | pass | 2 passes; the journal: 60.1 min applied by tick, 30.1 min discarded | holds |
| no provider request is made during the catch-up | pass | 0 requests inside it | holds |
| the catch-up summary persists to the end, or a later catch-up pass replaced it | pass | 6530c45d-ffba-4d26-b038-34b6842f9db8 (sequence 137514) was replaced by 5d58758f-b718-4844-8181-e96cb2dd7be2 (sequence 186864), a later pass's, 1 later pass seen | holds |
| every committed action traces to the god's profile | pass | all 7 gods hold | every god |
| every god commits enough actions over the hour, the outage left out | pass | all 7 gods hold | at least 5 each |
| no god repeats the same choice too often in a row | pass | all 7 gods hold | a run of at most 3 |
| every god causes at least one told belief or felt change | pass | all 7 gods hold | at least 1 each |
| each god's p95 queue wait, the windows with no service left out | pass | worst 102 ticks (athena); including the windows 832 | at most 105 ticks |
| no god goes too long with no request, its last request to the end of the run included | pass | longest 139 service ticks (athena) | at most 300 service ticks |
| no god was shown what it could not know, and no goal or petition leaked | pass | perception compliance: holds; goal privacy: holds; petition privacy: holds | all three hold |
| the busiest prompt fits the model's context, and no prompt was cut | pass | 2920 tokens of 4096 (279 responses counted); 0 cut | under 4096, and no response cut |
| Ollama's empty-200 fault did not recur five times in a row | pass | 0 empty responses, at most 0 in a row | fewer than 5 in a row |
| the sidecar's physical footprint does not grow more than 10% across the settled span, second half over first | pass | -1.36% (125 MiB mean over the first half, 123 MiB over the second; the settled span is 21.8 min from 38.2 min in); for context, the 20-minute slope of the footprint is 0.85% per 10 min and of RSS 3.35% per 10 min | second-half mean at most 10% above the first half's, over a settled span of at least 20 min (15 min after the last catch-up is left out) |
| a rebuild from genesis and the event log equals the live projection | pass | equal; 201878 events in 479.71 ms | equal |
| the exported archive imports into a scratch slot | pass | 201878 events | accepted |

**Verdict: PASS**

## Rating sheet

The verdict above says whether the run held its thresholds; this sheet is where you decide whether the world was worth watching. The rubric is the acceptance rubric (docs/product/acceptance.md), the same one the episode transcripts carry. Score the two kinds of episode separately, each on every dimension.

Score each 0, 1, or 2: 0 = replan pressure, 1 = needs tuning, 2 = good enough to continue. The owner scores; nothing above is a score.

**Episodes the director caused**

- tick 120 (outage): the director's stock-spoiled on fisher-dion, not yet prayed about
- tick 1440 (catch-up): the director's stock-spoiled on olive-grower-leon, prayed about to hera [evt-1566-42214]
- tick 2880 (catch-up): the director's theft on fisher-eleni, prayed about to hermes [evt-2894-77813]
- tick 4320 (catch-up): the director's theft on weaver-zoe, prayed about to hermes [evt-4329-118941]
- tick 5760 (after catch-up): the director's stock-spoiled on fisher-dion, not yet prayed about

| Dimension | Score (0/1/2) | Notes |
| --- | --- | --- |
| Novelty |  |  |
| Causality |  |  |
| Recognizable identity |  |  |
| Pacing |  |  |
| Inspectability |  |  |

**Episodes a god caused**

- tick 46 (steady): hermes's bless, which caused a told belief or a felt change [evt-46-1049]
- tick 1180 (recovery): poseidon's strike, which caused a told belief or a felt change [evt-1180-31868]
- tick 5269 (after catch-up): poseidon's strike, which caused a told belief or a felt change [evt-5269-145282]
- tick 5894 (after catch-up): hephaestus's bless, which caused a told belief or a felt change [evt-5894-163847]
- tick 6517 (after catch-up): hades's bless, which caused a told belief or a felt change [evt-6517-181712]

| Dimension | Score (0/1/2) | Notes |
| --- | --- | --- |
| Novelty |  |  |
| Causality |  |  |
| Recognizable identity |  |  |
| Pacing |  |  |
| Inspectability |  |  |

M2 exits only on a PASS verdict and your approval of these episodes. Decision: ______ (approve / not yet), date ______.
