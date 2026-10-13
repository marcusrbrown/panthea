# Unattended run

**Verdict: FAIL**

Running time 60.1 min of 60; elapsed wall time 60.2 min (the stopped gap of 90.0 min is not running time).
The model ran at a local OpenAI-compatible endpoint (granite3.3-8b-4k, reasoning none).

## What this run proves

- A14 (export and rebuild): the exported archive and a rebuild from genesis and the event log reproduce the live world, once, on this world. It proves export and rebuild only; it does not prove import into a different build or machine.
- P07 (provider outage): the world kept running through a local outage of the model endpoint, and the gods acted again when it returned. It proves a local outage only, produced by a proxy; it does not prove behaviour under a hosted provider's failure modes.
- It makes no claim for A15 (the eight-hour trial) and no claim beyond one hour of running time.

## Phase timeline

| Phase | Wall time (UTC) | Tick | Running (min) | Note |
| --- | --- | --- | --- | --- |
| started | 2026-10-10T12:08:02Z | 0 | 0.0 |  |
| outage-started | 2026-10-10T12:09:06Z | 64 | 1.1 | 5 of 7 gods had acted |
| proxy-restored | 2026-10-10T12:21:06Z | 783 | 13.1 |  |
| stopped | 2026-10-10T12:31:06Z | 1381 | 23.1 |  |
| restarted | 2026-10-10T12:31:07Z | 1381 | 23.1 |  |
| catch-up-finished | 2026-10-10T12:31:15Z | 4989 | 23.2 |  |
| ended | 2026-10-10T13:08:03Z | 7196 | 60.0 |  |

The outage started when 5 of 7 gods had acted.

## Gods

| God | Actions | Legends | Longest run | Requests | Answered | Exhausted | Over cap | Rejected | Goal-only | Influence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| athena | 37 | 4 | 1 | 142 | 38 | invalid output 1, outage 103 | 0 | not-adjacent 1 | 0 | 40 |
| hades | 39 | 0 | 1 | 145 | 42 | outage 103 | 0 | insufficient-resources 1, not-adjacent 2 | 0 | 23 |
| hephaestus | 34 | 0 | 1 | 139 | 36 | outage 103 | 0 | stale-target 1 | 0 | 27 |
| hera | 35 | 0 | 1 | 139 | 36 | outage 103 | 0 | malformed 1 | 0 | 29 |
| hermes | 40 | 0 | 3 | 144 | 42 | outage 102 | 0 | not-adjacent 2 | 0 | 29 |
| poseidon | 38 | 1 | 2 | 140 | 38 | outage 102 | 0 | 0 | 0 | 34 |
| zeus | 33 | 2 | 2 | 136 | 33 | outage 103 | 2 | 0 | 0 | 25 |

Counts leave out the outage window; its requests appear under exhausted as outage.

### Idle reasons

- athena: 6 gaps longer than 90 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.
- hades: 6 gaps longer than 90 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.
- hephaestus: 8 gaps longer than 90 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.
- hera: 9 gaps longer than 90 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.
- hermes: 5 gaps longer than 90 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.
- poseidon: 9 gaps longer than 90 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.
- zeus: 8 gaps longer than 90 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.

### Relationship and belief changes by phase

| God | steady | outage | recovery | catch-up | after catch-up |
| --- | --- | --- | --- | --- | --- |
| athena | 0 | 0 | 8 | 0 | 32 |
| hades | 0 | 0 | 7 | 0 | 16 |
| hephaestus | 0 | 0 | 9 | 0 | 18 |
| hera | 1 | 0 | 7 | 0 | 21 |
| hermes | 1 | 0 | 7 | 1 | 20 |
| poseidon | 1 | 0 | 8 | 0 | 25 |
| zeus | 0 | 0 | 7 | 0 | 18 |

## Queue wait and quiet stretches

| God | Turns | p95 queue wait, service time | p95 including the windows | Longest quiet stretch | Where |
| --- | --- | --- | --- | --- | --- |
| athena | 39 | 95 | 823 | 104 | ticks 1 to 824 |
| hades | 42 | 93 | 94 | 111 | ticks 14 to 844 |
| hephaestus | 36 | 95 | 835 | 116 | ticks 19 to 854 |
| hera | 36 | 95 | 820 | 101 | ticks 47 to 867 |
| hermes | 42 | 94 | 97 | 97 | ticks 783 to 880 |
| poseidon | 38 | 98 | 747 | 130 | ticks 1315 to 5053 |
| zeus | 33 | 130 | 257 | 257 | ticks 6420 to 6677 |

Service time leaves out outage start to proxyRestoredAt (ticks 64 to 783) and stop to the end of the catch-up (ticks 1381 to 4989). Waiting after the proxy returned counts.

## Latency

Steady-state requests took a median of 10.1 s and a p95 of 13.0 s. The first request after the proxy returned took 14.2 s, kept apart because it may include a cold reload (the Ollama runner was absent when the proxy returned).

## Recovery

proxyRestoredAt was tick 783. Reasoning resumed at tick 797, 14 ticks later. The first god action committed at tick 798 (hermes), 15 ticks later.

## Prompt size and the empty-200 fault

The busiest prompt was 2943 tokens of 4096 (269 responses counted). A response matched to its request is taken as cut when it reports far fewer tokens than its prompt's length predicts from this run's median of 0.321 a character. One with no prompt length to read it against is only suspected, when it reports exactly 2050 tokens (what Ollama reports for a cut prompt at this context); a suspected cut does not fail the row. None was cut.
Ollama's empty-200 response occurred 0 times, at most 0 in a row.

## Director events by kind and phase

| Kind | steady | outage | recovery | catch-up | after catch-up |
| --- | --- | --- | --- | --- | --- |
| building-ignited | 0 | 0 | 0 | 3 | 0 |
| stock-spoiled | 0 | 3 | 2 | 20 | 11 |
| theft | 0 | 3 | 3 | 7 | 7 |

## Memory

361 samples over 60.0 min. Ollama runner: start 5346 MiB, peak 8461 MiB, end 7042 MiB (349 present, 12 absent); footprint start 704 MiB, peak 6000 MiB, end 5530 MiB. Sidecar: RSS start 59 MiB, peak 364 MiB, end 242 MiB. Sidecar footprint: start 32 MiB, peak 161 MiB, end 134 MiB. Swap used: peak 2109 MiB.

The memory row is judged on the sidecar's physical footprint across the settled span: +4.94% (the mean of the second half over the first half's, over 21.8 min that start after the first 15 minutes (scaled to the run's length) following the last catch-up; 122 MiB then 128 MiB; at most +10% passes). It is not judged on RSS, which counts pages the allocator has freed and the kernel has not taken back and rises under allocation churn, nor on a slope: a window slope of a footprint that swings by ±10 MiB reads differently with where the window sits. For context only, Footprint trend over the last 20 minutes: 4.07% per 10 min over the last 120 samples. Sidecar RSS trend: 3.54% per 10 min over the last 120 samples.

## Export and rebuild

Store 242 MiB (WAL 0 MiB); archive 93 MiB at event 203970. Rebuild from genesis and 203970 events took 533.64 ms in a separate process and equals the live projection. The archive imported into a scratch slot (203970 events).

## Threshold table

| Threshold | Result | Measured | Limit |
| --- | --- | --- | --- |
| the run went through every phase and the sidecar stayed up | pass | completed | completed |
| running time reaches the plan's length | pass | 60.1 min running of 60; 60.2 min elapsed | 60 min running |
| the tick keeps advancing through the outage | pass | tick 64 to 783 | advances |
| mortals' routines and the director keep producing events through the outage | pass | 19325 events not caused by a god | at least 1 |
| no god action commits during the outage | pass | 0 committed actions | 0 |
| reasoning resumes: a request is answered with an intent within 150 ticks of proxyRestoredAt | pass | answered 14 ticks after (tick 797) | at most 150 ticks |
| gods act again: a god action commits within 150 ticks of proxyRestoredAt | pass | hermes committed 15 ticks after (tick 798) | at most 150 ticks |
| the sidecar stops cleanly | pass | exit code 0 | holds |
| the catch-up is bracketed by its own log lines | pass | 2026-10-10T12:31:06.941Z .. 2026-10-10T12:31:12.031Z | holds |
| the catch-up applies the cap and discards the rest | pass | 2 passes; the journal: 60.1 min applied by tick, 30.1 min discarded | holds |
| no provider request is made during the catch-up | pass | 0 requests inside it | holds |
| the catch-up summary persists to the end, or a later catch-up pass replaced it | pass | 7ea3b7e2-d0d2-40ae-a632-1dc5d37f1bec (sequence 140409) was replaced by 884e5516-7c3e-44a4-a204-15d8bc8b8c15 (sequence 186738), a later pass's, 1 later pass seen | holds |
| every committed action traces to the god's profile | pass | all 7 gods hold | every god |
| every god commits enough actions over the hour, the outage left out | pass | all 7 gods hold | at least 5 each |
| no god repeats the same choice too often in a row | pass | all 7 gods hold | a run of at most 3 |
| every god causes at least one told belief or felt change | pass | all 7 gods hold | at least 1 each |
| each god's p95 queue wait, the windows with no service left out | **FAIL** | worst 130 ticks (zeus); including the windows 835 | at most 90 ticks |
| no god goes too long with no request, its last request to the end of the run included | pass | longest 257 service ticks (zeus) | at most 300 service ticks |
| no god was shown what it could not know, and no goal or petition leaked | pass | perception compliance: holds; goal privacy: holds; petition privacy: holds | all three hold |
| the busiest prompt fits the model's context, and no prompt was cut | pass | 2943 tokens of 4096 (269 responses counted); 0 cut | under 4096, and no response cut |
| Ollama's empty-200 fault did not recur five times in a row | pass | 0 empty responses, at most 0 in a row | fewer than 5 in a row |
| the sidecar's physical footprint does not grow more than 10% across the settled span, second half over first | pass | +4.94% (122 MiB mean over the first half, 128 MiB over the second; the settled span is 21.8 min from 38.2 min in); for context, the 20-minute slope of the footprint is 4.07% per 10 min and of RSS 3.54% per 10 min | second-half mean at most 10% above the first half's, over a settled span of at least 20 min (15 min after the last catch-up is left out) |
| a rebuild from genesis and the event log equals the live projection | pass | equal; 203970 events in 533.64 ms | equal |
| the exported archive imports into a scratch slot | pass | 203970 events | accepted |

**Verdict: FAIL**

## Rating sheet

The verdict above says whether the run held its thresholds; this sheet is where you decide whether the world was worth watching. The rubric is the acceptance rubric (docs/product/acceptance.md), the same one the episode transcripts carry. Score the two kinds of episode separately, each on every dimension.

Score each 0, 1, or 2: 0 = replan pressure, 1 = needs tuning, 2 = good enough to continue. The owner scores; nothing above is a score.

**Episodes the director caused**

- tick 120 (outage): the director's stock-spoiled on fisher-dion, not yet prayed about
- tick 1440 (catch-up): the director's stock-spoiled on fisher-stavros, not yet prayed about
- tick 2880 (catch-up): the director's building-ignited on the-tavern, not yet prayed about
- tick 4320 (catch-up): the director's stock-spoiled on fisher-kallias, prayed about to hera [evt-4357-122450]
- tick 5760 (after catch-up): the director's stock-spoiled on farmer, prayed about to hera [evt-5762-162940]

| Dimension | Score (0/1/2) | Notes |
| --- | --- | --- |
| Novelty |  |  |
| Causality |  |  |
| Recognizable identity |  |  |
| Pacing |  |  |
| Inspectability |  |  |

**Episodes a god caused**

- tick 47 (steady): hermes's bless, which caused a told belief or a felt change [evt-47-1072]
- tick 1190 (recovery): poseidon's bless, which caused a told belief or a felt change [evt-1190-32559]
- tick 5227 (after catch-up): zeus's bless, which caused a told belief or a felt change [evt-5227-147642]
- tick 5792 (after catch-up): hera's bless, which caused a told belief or a felt change [evt-5792-163803]
- tick 6453 (after catch-up): poseidon's strike, which caused a told belief or a felt change [evt-6453-182553]

| Dimension | Score (0/1/2) | Notes |
| --- | --- | --- |
| Novelty |  |  |
| Causality |  |  |
| Recognizable identity |  |  |
| Pacing |  |  |
| Inspectability |  |  |

M2 exits only on a PASS verdict and your approval of these episodes. Decision: ______ (approve / not yet), date ______.
