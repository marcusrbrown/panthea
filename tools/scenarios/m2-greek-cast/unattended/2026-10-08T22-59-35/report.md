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
| started | 2026-10-08T22:59:39Z | 0 | 0.0 |  |
| outage-started | 2026-10-08T23:00:23Z | 44 | 0.7 | 5 of 7 gods had acted |
| proxy-restored | 2026-10-08T23:12:23Z | 762 | 12.7 |  |
| stopped | 2026-10-08T23:22:24Z | 1361 | 22.7 |  |
| restarted | 2026-10-08T23:22:24Z | 1361 | 22.7 |  |
| catch-up-finished | 2026-10-08T23:22:32Z | 4969 | 22.9 |  |
| ended | 2026-10-08T23:59:41Z | 7195 | 60.0 |  |

The outage started when 5 of 7 gods had acted.

## Gods

| God | Actions | Legends | Longest run | Requests | Answered | Exhausted | Over cap | Rejected | Goal-only | Influence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| athena | 39 | 5 | 1 | 142 | 39 | outage 103 | 1 | 0 | 0 | 44 |
| hades | 37 | 1 | 1 | 141 | 38 | outage 103 | 0 | insufficient-resources 1 | 0 | 24 |
| hephaestus | 37 | 1 | 1 | 140 | 37 | outage 103 | 0 | 0 | 0 | 33 |
| hera | 32 | 0 | 2 | 135 | 33 | outage 102 | 0 | 0 | 0 | 23 |
| hermes | 36 | 0 | 2 | 139 | 37 | outage 102 | 0 | not-adjacent 1 | 0 | 29 |
| poseidon | 31 | 0 | 1 | 135 | 31 | invalid output 1, outage 103 | 0 | 0 | 0 | 22 |
| zeus | 27 | 0 | 1 | 132 | 29 | outage 103 | 5 | malformed 1 | 0 | 19 |

Counts leave out the outage window; its requests appear under exhausted as outage.

### Idle reasons

- athena: 15 gaps longer than 90 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.
- hades: 14 gaps longer than 90 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.
- hephaestus: 13 gaps longer than 90 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.
- hera: 17 gaps longer than 90 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.
- hermes: 14 gaps longer than 90 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.
- poseidon: 17 gaps longer than 90 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.
- zeus: 13 gaps longer than 90 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.

### Relationship and belief changes by phase

| God | steady | outage | recovery | catch-up | after catch-up |
| --- | --- | --- | --- | --- | --- |
| athena | 0 | 0 | 7 | 0 | 37 |
| hades | 0 | 0 | 3 | 0 | 21 |
| hephaestus | 4 | 0 | 7 | 0 | 22 |
| hera | 1 | 0 | 6 | 0 | 16 |
| hermes | 1 | 0 | 8 | 0 | 20 |
| poseidon | 0 | 0 | 5 | 0 | 17 |
| zeus | 0 | 0 | 5 | 0 | 14 |

## Queue wait and quiet stretches

| God | Turns | p95 queue wait, service time | p95 including the windows | Longest quiet stretch | Where |
| --- | --- | --- | --- | --- | --- |
| athena | 39 | 108 | 824 | 141 | ticks 5190 to 5331 |
| hades | 38 | 102 | 827 | 109 | ticks 11 to 838 |
| hephaestus | 37 | 106 | 838 | 120 | ticks 16 to 854 |
| hera | 33 | 105 | 739 | 109 | ticks 7086 to 7195 (to the end of the run) |
| hermes | 37 | 104 | 743 | 105 | ticks 6104 to 6209 |
| poseidon | 32 | 107 | 107 | 142 | ticks 1281 to 5031 |
| zeus | 29 | 286 | 375 | 375 | ticks 6363 to 6738 |

Service time leaves out outage start to proxyRestoredAt (ticks 44 to 762) and stop to the end of the catch-up (ticks 1361 to 4969). Waiting after the proxy returned counts.

## Latency

Steady-state requests took a median of 11.0 s and a p95 of 14.4 s. The first request after the proxy returned took 13.6 s, kept apart because it may include a cold reload (the Ollama runner was absent when the proxy returned).

## Recovery

proxyRestoredAt was tick 762. Reasoning resumed at tick 777, 15 ticks later. The first god action committed at tick 777 (hera), 15 ticks later.

## Prompt size and the empty-200 fault

The busiest prompt was 3002 tokens of 4096 (256 responses counted). A response matched to its request is taken as cut when it reports far fewer tokens than its prompt's length predicts from this run's median of 0.320 a character. One with no prompt length to read it against is only suspected, when it reports exactly 2050 tokens (what Ollama reports for a cut prompt at this context); a suspected cut does not fail the row. None was cut.
Ollama's empty-200 response occurred 0 times, at most 0 in a row.

## Director events by kind and phase

| Kind | steady | outage | recovery | catch-up | after catch-up |
| --- | --- | --- | --- | --- | --- |
| stock-spoiled | 0 | 3 | 2 | 18 | 6 |
| theft | 0 | 3 | 3 | 12 | 12 |

## Memory

361 samples over 60.0 min. Ollama runner: start 5338 MiB, peak 7668 MiB, end 6996 MiB (349 present, 12 absent); footprint start 705 MiB, peak 4659 MiB, end 4614 MiB. Sidecar: RSS start 60 MiB, peak 329 MiB, end 152 MiB. Sidecar footprint: start 32 MiB, peak 203 MiB, end 131 MiB. Swap used: peak 2066 MiB.

The levelling-off row is judged on the sidecar's physical footprint (2.61% per 10 min over the last 120 samples), not on RSS, which counts pages the allocator has freed and the kernel has not taken back and rises under allocation churn. Sidecar RSS trend, for context: -2.20% per 10 min over the last 120 samples.

## Export and rebuild

Store 242 MiB (WAL 0 MiB); archive 93 MiB at event 203387. Rebuild from genesis and 203387 events took 515.33 ms in a separate process and equals the live projection. The archive imported into a scratch slot (203387 events).

## Threshold table

| Threshold | Result | Measured | Limit |
| --- | --- | --- | --- |
| the run went through every phase and the sidecar stayed up | pass | completed | completed |
| running time reaches the plan's length | pass | 60.1 min running of 60; 60.2 min elapsed | 60 min running |
| the tick keeps advancing through the outage | pass | tick 44 to 762 | advances |
| mortals' routines and the director keep producing events through the outage | pass | 20191 events not caused by a god | at least 1 |
| no god action commits during the outage | pass | 0 committed actions | 0 |
| reasoning resumes: a request is answered with an intent within 150 ticks of proxyRestoredAt | pass | answered 15 ticks after (tick 777) | at most 150 ticks |
| gods act again: a god action commits within 150 ticks of proxyRestoredAt | pass | hera committed 15 ticks after (tick 777) | at most 150 ticks |
| the sidecar stops cleanly | pass | exit code 0 | holds |
| the catch-up is bracketed by its own log lines | pass | 2026-10-08T23:22:24.393Z .. 2026-10-08T23:22:29.594Z | holds |
| the catch-up applies the cap and discards the rest | pass | 2 passes; the journal: 60.1 min applied by tick, 30.1 min discarded | holds |
| no provider request is made during the catch-up | pass | 0 requests inside it | holds |
| the catch-up summary persists to the end, or a later catch-up pass replaced it | pass | e1351768-f9df-4470-8034-eedc061f3bc0 (sequence 138444) was replaced by 8cd68816-6ea2-4752-b45a-887909463c1e (sequence 184342), a later pass's, 1 later pass seen | holds |
| every committed action traces to the god's profile | pass | all 7 gods hold | every god |
| every god commits enough actions over the hour, the outage left out | pass | all 7 gods hold | at least 5 each |
| no god repeats the same choice too often in a row | pass | all 7 gods hold | a run of at most 3 |
| every god causes at least one told belief or felt change | pass | all 7 gods hold | at least 1 each |
| each god's p95 queue wait, the windows with no service left out | **FAIL** | worst 286 ticks (zeus); including the windows 838 | at most 90 ticks |
| no god goes too long with no request, its last request to the end of the run included | **FAIL** | longest 375 service ticks (zeus) | at most 300 service ticks |
| no god was shown what it could not know, and no goal or petition leaked | pass | perception compliance: holds; goal privacy: holds; petition privacy: holds | all three hold |
| the busiest prompt fits the model's context, and no prompt was cut | pass | 3002 tokens of 4096 (256 responses counted); 0 cut | under 4096, and no response cut |
| Ollama's empty-200 fault did not recur five times in a row | pass | 0 empty responses, at most 0 in a row | fewer than 5 in a row |
| the sidecar's physical footprint levels off over the last 20 minutes | **FAIL** | 2.61% per 10 min over 120 samples (RSS -2.20% per 10 min, for context) | under 1% of the mean per 10 min |
| a rebuild from genesis and the event log equals the live projection | pass | equal; 203387 events in 515.33 ms | equal |
| the exported archive imports into a scratch slot | pass | 203387 events | accepted |

**Verdict: FAIL**

## Rating sheet

The verdict above says whether the run held its thresholds; this sheet is where you decide whether the world was worth watching. The rubric is the acceptance rubric (docs/product/acceptance.md), the same one the episode transcripts carry. Score the two kinds of episode separately, each on every dimension.

Score each 0, 1, or 2: 0 = replan pressure, 1 = needs tuning, 2 = good enough to continue. The owner scores; nothing above is a score.

**Episodes the director caused**

- tick 120 (outage): the director's theft on fisher-kallias, prayed about to hermes [evt-195-4871]
- tick 1440 (catch-up): the director's stock-spoiled on weaver-zoe, prayed about to hera [evt-1476-41724]
- tick 2880 (catch-up): the director's stock-spoiled on olive-grower-phoebe, prayed about to hera [evt-2976-82034]
- tick 4320 (catch-up): the director's stock-spoiled on herdsman-damon, prayed about to hera [evt-4325-120099]
- tick 5760 (after catch-up): the director's theft on farmer, prayed about to hermes [evt-5783-162441]

| Dimension | Score (0/1/2) | Notes |
| --- | --- | --- |
| Novelty |  |  |
| Causality |  |  |
| Recognizable identity |  |  |
| Pacing |  |  |
| Inspectability |  |  |

**Episodes a god caused**

- tick 24 (steady): hephaestus's legend, which caused a told belief or a felt change [evt-24-549]
- tick 1211 (recovery): poseidon's bless, which caused a told belief or a felt change [evt-1211-34494]
- tick 5246 (after catch-up): hermes's bless, which caused a told belief or a felt change [evt-5246-146656]
- tick 5809 (after catch-up): poseidon's bless, which caused a told belief or a felt change [evt-5809-163216]
- tick 6463 (after catch-up): athena's report, which caused a told belief or a felt change [evt-6463-182161]

| Dimension | Score (0/1/2) | Notes |
| --- | --- | --- |
| Novelty |  |  |
| Causality |  |  |
| Recognizable identity |  |  |
| Pacing |  |  |
| Inspectability |  |  |

M2 exits only on a PASS verdict and your approval of these episodes. Decision: ______ (approve / not yet), date ______.
