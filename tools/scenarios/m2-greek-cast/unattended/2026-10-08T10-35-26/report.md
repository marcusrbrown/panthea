# Unattended run

**Verdict: FAIL**

The run did not complete: checks failed: the catch-up summary is still the summary at the end.

Running time 60.0 min of 60; elapsed wall time 60.1 min (the stopped gap of 90.0 min is not running time).
The model ran at a local OpenAI-compatible endpoint (granite3.3-8b-4k, reasoning none).

## What this run proves

- A14 (export and rebuild): the exported archive and a rebuild from genesis and the event log reproduce the live world, once, on this world. It proves export and rebuild only; it does not prove import into a different build or machine.
- P07 (provider outage): the world kept running through a local outage of the model endpoint, and the gods acted again when it returned. It proves a local outage only, produced by a proxy; it does not prove behaviour under a hosted provider's failure modes.
- It makes no claim for A15 (the eight-hour trial) and no claim beyond one hour of running time.

## Phase timeline

| Phase | Wall time (UTC) | Tick | Running (min) | Note |
| --- | --- | --- | --- | --- |
| started | 2026-10-08T10:35:30Z | 0 | 0.0 |  |
| outage-started | 2026-10-08T10:36:16Z | 46 | 0.8 | 5 of 7 gods had acted |
| proxy-restored | 2026-10-08T10:48:18Z | 766 | 12.8 |  |
| stopped | 2026-10-08T10:58:18Z | 1365 | 22.8 |  |
| restarted | 2026-10-08T10:58:18Z | 1365 | 22.8 |  |
| catch-up-finished | 2026-10-08T10:58:26Z | 4973 | 22.9 |  |
| ended | 2026-10-08T11:35:31Z | 7196 | 60.0 |  |

The outage started when 5 of 7 gods had acted.

## Gods

| God | Actions | Legends | Longest run | Requests | Answered | Exhausted | Rejected | Goal-only | Influence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| athena | 31 | 3 | 1 | 134 | 32 | outage 102 | stale-target 1 | 0 | 33 |
| hades | 32 | 0 | 1 | 135 | 33 | invalid output 1, outage 101 | 0 | 0 | 16 |
| hephaestus | 28 | 3 | 1 | 133 | 30 | invalid output 2, outage 101 | 0 | 0 | 26 |
| hera | 30 | 0 | 2 | 142 | 30 | outage 112 | 0 | 0 | 28 |
| hermes | 27 | 0 | 2 | 132 | 31 | outage 101 | not-adjacent 2 | 0 | 20 |
| poseidon | 18 | 1 | 1 | 130 | 22 | invalid output 6, outage 102 | malformed 1, not-adjacent 1, stale-target 2 | 0 | 20 |
| zeus | 27 | 1 | 2 | 129 | 27 | outage 102 | 0 | 0 | 30 |

Counts leave out the outage window; its requests appear under exhausted as outage.

### Idle reasons

- athena: 16 gaps longer than 90 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.
- hades: 19 gaps longer than 90 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.
- hephaestus: 16 gaps longer than 90 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.
- hera: 17 gaps longer than 90 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.
- hermes: 16 gaps longer than 90 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.
- poseidon: 18 gaps longer than 90 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.
- zeus: 19 gaps longer than 90 service ticks between requests. Inferred: the scheduler's skips are not journaled, so a god that was never scheduled shows only as the absence of a request.

### Relationship and belief changes by phase

| God | steady | outage | recovery | catch-up | after catch-up |
| --- | --- | --- | --- | --- | --- |
| athena | 4 | 0 | 7 | 0 | 22 |
| hades | 0 | 0 | 7 | 0 | 9 |
| hephaestus | 4 | 0 | 5 | 0 | 17 |
| hera | 0 | 0 | 8 | 0 | 20 |
| hermes | 0 | 1 | 6 | 0 | 13 |
| poseidon | 0 | 0 | 5 | 0 | 15 |
| zeus | 0 | 0 | 7 | 0 | 23 |

## Queue wait and quiet stretches

| God | Turns | p95 queue wait, service time | p95 including the windows | Longest quiet stretch | Where |
| --- | --- | --- | --- | --- | --- |
| athena | 134 | 116 | 116 | 125 | ticks 5401 to 5526 |
| hades | 135 | 113 | 117 | 130 | ticks 6542 to 6672 |
| hephaestus | 133 | 116 | 116 | 130 | ticks 6577 to 6707 |
| hera | 142 | 115 | 115 | 135 | ticks 6482 to 6617 |
| hermes | 132 | 116 | 116 | 132 | ticks 1302 to 5042 |
| poseidon | 130 | 117 | 117 | 134 | ticks 1315 to 5057 |
| zeus | 129 | 117 | 117 | 135 | ticks 1330 to 5073 |

Service time leaves out outage start to proxyRestoredAt (ticks 46 to 766) and stop to the end of the catch-up (ticks 1365 to 4973). Waiting after the proxy returned counts.

## Latency

Steady-state requests took a median of 12.9 s and a p95 of 19.0 s. The first request after the proxy returned took 11.4 s, kept apart because it may include a cold reload (the Ollama runner was absent when the proxy returned).

## Recovery

proxyRestoredAt was tick 766. Reasoning resumed at tick 778, 12 ticks later. The first god action committed at tick 779 (hades), 13 ticks later.

## Prompt size and the empty-200 fault

The busiest prompt was 4094 tokens of 4096 (233 responses counted).
Ollama's empty-200 response occurred 0 times, at most 0 in a row.

## Director events by kind and phase

| Kind | steady | outage | recovery | catch-up | after catch-up |
| --- | --- | --- | --- | --- | --- |
| building-ignited | 0 | 0 | 0 | 1 | 0 |
| stock-spoiled | 0 | 3 | 3 | 18 | 11 |
| theft | 0 | 3 | 2 | 11 | 7 |

## Memory

361 samples over 60.0 min. Ollama runner: start 5343 MiB, peak 8280 MiB, end 5892 MiB (349 present, 12 absent). Sidecar: start 61 MiB, peak 243 MiB, end 135 MiB. Swap used: peak 6467 MiB.

## Export and rebuild

Store 242 MiB (WAL 0 MiB); archive 92 MiB at event 202162. Rebuild from genesis and 202162 events took 496.3 ms in a separate process and equals the live projection. The archive imported into a scratch slot (202162 events).

## Threshold table

| Threshold | Result | Measured | Limit |
| --- | --- | --- | --- |
| the run went through every phase and the sidecar stayed up | **FAIL** | failed: checks failed: the catch-up summary is still the summary at the end | completed |
| running time reaches the plan's length | pass | 60.0 min running of 60; 60.1 min elapsed | 60 min running |
| the tick keeps advancing through the outage | pass | tick 46 to 766 | advances |
| mortals' routines and the director keep producing events through the outage | pass | 19121 events not caused by a god | at least 1 |
| no god action commits during the outage | pass | 0 committed actions | 0 |
| reasoning resumes: a request is answered with an intent within 150 ticks of proxyRestoredAt | pass | answered 12 ticks after (tick 778) | at most 150 ticks |
| gods act again: a god action commits within 150 ticks of proxyRestoredAt | pass | hades committed 13 ticks after (tick 779) | at most 150 ticks |
| the sidecar stops cleanly | pass | exit code 0 | holds |
| the catch-up is bracketed by its own log lines | pass | 2026-10-08T10:58:18.211Z .. 2026-10-08T10:58:23.309Z | holds |
| the catch-up applies the cap and discards the rest | pass | 2 passes; the journal: 60.1 min applied by tick, 30.1 min discarded | holds |
| no provider request is made during the catch-up | pass | 0 requests inside it | holds |
| the catch-up summary is still the summary at the end | **FAIL** | 25c13381-cf4b-4c9b-bd30-cd6304ea55d6 .. 563463af-73df-42b9-b9e9-8251b63d9c7f | holds |
| every committed action traces to the god's profile | pass | all 7 gods hold | every god |
| every god commits enough actions over the hour, the outage left out | pass | all 7 gods hold | at least 5 each |
| no god repeats the same choice too often in a row | pass | all 7 gods hold | a run of at most 3 |
| every god causes at least one told belief or felt change | pass | all 7 gods hold | at least 1 each |
| each god's p95 queue wait, the windows with no service left out | **FAIL** | worst 117 ticks (poseidon); including the windows 117 | at most 90 ticks |
| no god goes too long with no request, its last request to the end of the run included | pass | longest 135 service ticks (hera) | at most 300 service ticks |
| no god was shown what it could not know, and no goal or petition leaked | pass | perception compliance: holds; goal privacy: holds; petition privacy: holds | all three hold |
| the busiest prompt fits the model's context | pass | 4094 tokens of 4096 (233 responses counted) | under 4096 |
| Ollama's empty-200 fault did not recur five times in a row | pass | 0 empty responses, at most 0 in a row | fewer than 5 in a row |
| the sidecar's memory levels off over the last 20 minutes | **FAIL** | 5.82% per 10 min over 120 samples | under 1% of the mean per 10 min |
| a rebuild from genesis and the event log equals the live projection | pass | equal; 202162 events in 496.3 ms | equal |
| the exported archive imports into a scratch slot | pass | 202162 events | accepted |

**Verdict: FAIL**

## Rating sheet

The verdict above says whether the run held its thresholds; this sheet is where you decide whether the world was worth watching. The rubric is the acceptance rubric (docs/product/acceptance.md), the same one the episode transcripts carry. Score the two kinds of episode separately, each on every dimension.

Score each 0, 1, or 2: 0 = replan pressure, 1 = needs tuning, 2 = good enough to continue. The owner scores; nothing above is a score.

**Episodes the director caused**

- tick 120 (outage): the director's theft on smith-ktesias, prayed about to hermes [evt-122-2975]
- tick 1440 (catch-up): the director's stock-spoiled on fisher-melina, prayed about to hera [evt-1482-40811]
- tick 2880 (catch-up): the director's stock-spoiled on herdsman-damon, prayed about to hera [evt-2885-80718]
- tick 4320 (catch-up): the director's stock-spoiled on weaver-xenia, prayed about to hera [evt-4325-121620]
- tick 5760 (after catch-up): the director's theft on smith-brontes, prayed about to hermes [evt-5763-160695]

| Dimension | Score (0/1/2) | Notes |
| --- | --- | --- |
| Novelty |  |  |
| Causality |  |  |
| Recognizable identity |  |  |
| Pacing |  |  |
| Inspectability |  |  |

**Episodes a god caused**

- tick 13 (steady): athena's legend, which caused a told belief or a felt change [evt-13-298]
- tick 1135 (recovery): hera's bless, which caused a told belief or a felt change [evt-1135-30820]
- tick 5175 (after catch-up): poseidon's bless, which caused a told belief or a felt change [evt-5175-144704]
- tick 5735 (after catch-up): poseidon's strike, which caused a told belief or a felt change [evt-5735-159882]
- tick 6450 (after catch-up): athena's bless, which caused a told belief or a felt change [evt-6450-180227]

| Dimension | Score (0/1/2) | Notes |
| --- | --- | --- |
| Novelty |  |  |
| Causality |  |  |
| Recognizable identity |  |  |
| Pacing |  |  |
| Inspectability |  |  |

M2 exits only on a PASS verdict and your approval of these episodes. Decision: ______ (approve / not yet), date ______.
