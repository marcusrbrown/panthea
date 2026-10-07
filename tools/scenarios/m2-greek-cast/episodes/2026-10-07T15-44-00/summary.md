# M2 experience gate

- Requirements: O08
- Model: llama3.1-8b-4k through local Ollama, 4K context, reasoning off (reasoning_effort none)
- 3 episodes of 300 s, each a fresh world from the initial authored Greek state; no fixtures, no seeds
- dispositions: travel 21 × committed, report 19 × committed, legend 9 × committed, practice 3 × committed, practice 1 × insufficient-resources, bless 1 × committed, strike 1 × committed
- journeys: 21 started: 21 arrived, 0 refused, 0 replaced, 0 still travelling

## Automated checks

| Episode | God | Committed actions | Longest run | Told beliefs and feelings caused | Goals set / ended | Petitions heard / answered | Goal changes refused | Checks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Athena | 3 (2 ability, 1 context) | 1 | 6 | 0 / 0 | 3 / 1 | 0 | FAIL: minimum activity |
| 1 | Hades | 3 (1 ability, 2 context) | 1 | 0 | 0 / 0 | 0 / 0 | 0 | FAIL: minimum activity, influence, petition heard |
| 1 | Hephaestus | 3 (0 ability, 3 context) | 1 | 2 | 0 / 0 | 0 / 0 | 0 | FAIL: minimum activity, petition heard, petition answered |
| 1 | Hera | 3 (0 ability, 3 context) | 1 | 2 | 0 / 0 | 3 / 0 | 0 | FAIL: minimum activity, petition answered |
| 1 | Hermes | 3 (3 ability, 0 context) | 1 | 7 | 0 / 0 | 11 / 0 | 0 | FAIL: minimum activity, petition answered |
| 1 | Poseidon | 3 (0 ability, 3 context) | 1 | 1 | 0 / 0 | 8 / 0 | 0 | FAIL: minimum activity, petition answered |
| 1 | Zeus | 1 (0 ability, 1 context) | 1 | 0 | 1 / 0 | 4 / 0 | 0 | FAIL: minimum activity, influence, petition answered |
| 2 | Athena | 2 (1 ability, 1 context) | 1 | 4 | 0 / 0 | 7 / 0 | 0 | FAIL: minimum activity, petition answered |
| 2 | Hades | 3 (0 ability, 3 context) | 1 | 0 | 0 / 0 | 2 / 0 | 0 | FAIL: minimum activity, influence |
| 2 | Hephaestus | 3 (0 ability, 3 context) | 3 | 3 | 0 / 0 | 0 / 0 | 0 | FAIL: minimum activity, petition heard, petition answered |
| 2 | Hera | 2 (0 ability, 2 context) | 1 | 1 | 0 / 0 | 5 / 0 | 0 | FAIL: minimum activity, petition answered |
| 2 | Hermes | 3 (1 ability, 2 context) | 1 | 1 | 0 / 0 | 10 / 0 | 0 | FAIL: minimum activity, petition answered |
| 2 | Poseidon | 3 (1 ability, 2 context) | 1 | 3 | 0 / 0 | 8 / 1 | 0 | FAIL: minimum activity |
| 2 | Zeus | 1 (0 ability, 1 context) | 1 | 0 | 0 / 0 | 4 / 0 | 0 | FAIL: minimum activity, influence, petition answered |
| 3 | Athena | 3 (1 ability, 2 context) | 1 | 5 | 0 / 0 | 4 / 0 | 0 | FAIL: minimum activity, petition answered |
| 3 | Hades | 2 (0 ability, 2 context) | 1 | 0 | 0 / 0 | 0 / 0 | 0 | FAIL: minimum activity, influence, petition heard |
| 3 | Hephaestus | 4 (2 ability, 2 context) | 1 | 6 | 0 / 0 | 1 / 0 | 0 | FAIL: minimum activity, petition answered |
| 3 | Hera | 2 (0 ability, 2 context) | 1 | 0 | 0 / 0 | 4 / 0 | 0 | FAIL: minimum activity, influence, petition answered |
| 3 | Hermes | 3 (2 ability, 1 context) | 2 | 2 | 0 / 0 | 7 / 0 | 0 | FAIL: minimum activity, petition answered |
| 3 | Poseidon | 2 (0 ability, 2 context) | 1 | 1 | 0 / 0 | 7 / 0 | 0 | FAIL: minimum activity, petition answered |
| 3 | Zeus | 2 (0 ability, 2 context) | 1 | 1 | 0 / 0 | 5 / 0 | 0 | FAIL: minimum activity, petition answered |

Automated checks failed:

- episode 1, Athena: minimum activity (3 committed model actions (at least 5))
- episode 1, Hades: minimum activity (3 committed model actions (at least 5))
- episode 1, Hades: influence (no told belief or relationship change traces to this god's proposals)
- episode 1, Hades: petition heard (no petition was addressed to this god (at least 1))
- episode 1, Hephaestus: minimum activity (3 committed model actions (at least 5))
- episode 1, Hephaestus: petition heard (no petition was addressed to this god (at least 1))
- episode 1, Hephaestus: petition answered (0 heard, none answered (at least 1))
- episode 1, Hera: minimum activity (3 committed model actions (at least 5))
- episode 1, Hera: petition answered (3 heard, none answered (at least 1))
- episode 1, Hermes: minimum activity (3 committed model actions (at least 5))
- episode 1, Hermes: petition answered (11 heard, none answered (at least 1))
- episode 1, Poseidon: minimum activity (3 committed model actions (at least 5))
- episode 1, Poseidon: petition answered (8 heard, none answered (at least 1))
- episode 1, Zeus: minimum activity (1 committed model actions (at least 5))
- episode 1, Zeus: influence (no told belief or relationship change traces to this god's proposals)
- episode 1, Zeus: petition answered (4 heard, none answered (at least 1))
- episode 1, property god thread endings (no thread was opened)
- episode 1, property supplication and settlement (0 supplications, 0 settlements, 0 refused or breached)
- episode 1, property consequence changes a later choice (no thread ending left a consequence on a god)
- episode 2: food prayer share (20 of 36 prayers are about food (fewer than half))
- episode 2, Athena: minimum activity (2 committed model actions (at least 5))
- episode 2, Athena: petition answered (7 heard, none answered (at least 1))
- episode 2, Hades: minimum activity (3 committed model actions (at least 5))
- episode 2, Hades: influence (no told belief or relationship change traces to this god's proposals)
- episode 2, Hephaestus: minimum activity (3 committed model actions (at least 5))
- episode 2, Hephaestus: petition heard (no petition was addressed to this god (at least 1))
- episode 2, Hephaestus: petition answered (0 heard, none answered (at least 1))
- episode 2, Hera: minimum activity (2 committed model actions (at least 5))
- episode 2, Hera: petition answered (5 heard, none answered (at least 1))
- episode 2, Hermes: minimum activity (3 committed model actions (at least 5))
- episode 2, Hermes: petition answered (10 heard, none answered (at least 1))
- episode 2, Poseidon: minimum activity (3 committed model actions (at least 5))
- episode 2, Zeus: minimum activity (1 committed model actions (at least 5))
- episode 2, Zeus: influence (no told belief or relationship change traces to this god's proposals)
- episode 2, Zeus: petition answered (4 heard, none answered (at least 1))
- episode 2, property changed next action (hephaestus: report:provisioner-nikanor before its first belief, report:provisioner-nikanor after (same))
- episode 2, property god thread endings (no thread was opened)
- episode 2, property supplication and settlement (0 supplications, 0 settlements, 0 refused or breached)
- episode 2, property consequence changes a later choice (no thread ending left a consequence on a god)
- episode 3: food prayer share (17 of 28 prayers are about food (fewer than half))
- episode 3, Athena: minimum activity (3 committed model actions (at least 5))
- episode 3, Athena: petition answered (4 heard, none answered (at least 1))
- episode 3, Hades: minimum activity (2 committed model actions (at least 5))
- episode 3, Hades: influence (no told belief or relationship change traces to this god's proposals)
- episode 3, Hades: petition heard (no petition was addressed to this god (at least 1))
- episode 3, Hephaestus: minimum activity (4 committed model actions (at least 5))
- episode 3, Hephaestus: petition answered (1 heard, none answered (at least 1))
- episode 3, Hera: minimum activity (2 committed model actions (at least 5))
- episode 3, Hera: influence (no told belief or relationship change traces to this god's proposals)
- episode 3, Hera: petition answered (4 heard, none answered (at least 1))
- episode 3, Hermes: minimum activity (3 committed model actions (at least 5))
- episode 3, Hermes: petition answered (7 heard, none answered (at least 1))
- episode 3, Poseidon: minimum activity (2 committed model actions (at least 5))
- episode 3, Poseidon: petition answered (7 heard, none answered (at least 1))
- episode 3, Zeus: minimum activity (2 committed model actions (at least 5))
- episode 3, Zeus: petition answered (5 heard, none answered (at least 1))
- episode 3, property god thread endings (athena: no thread ending it caused left a persistent consequence; hades: no thread ending it caused left a persistent consequence; hephaestus: no thread ending it caused left a persistent consequence; hera: no thread ending it caused left a persistent consequence; hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: no thread ending it caused left a persistent consequence)
- episode 3, property supplication and settlement (3 supplications, 0 settlements, 0 refused or breached)
- episode 3, property consequence changes a later choice (no thread ending left a consequence on a god)

## Across the episodes

- PASS mortal wrong: 29 wrongs between mortals of different patrons, 17 prayed to the victim's patron, 6 with a consequence (punishment, revenge, or defection; at least 1)
- FAIL god thread over harm or defection: 0 demands or contests between gods cite a worshipper's harm or a defection (at least 1)
- FAIL initiative: athena: no demand or contest toward another god in any episode (at least 1); 0 proposed and not committed
- FAIL initiative: hades: no demand or contest toward another god in any episode (at least 1); 0 proposed and not committed
- FAIL initiative: hephaestus: no demand or contest toward another god in any episode (at least 1); 0 proposed and not committed
- FAIL initiative: hera: no demand or contest toward another god in any episode (at least 1); 0 proposed and not committed
- FAIL initiative: hermes: no demand or contest toward another god in any episode (at least 1); 0 proposed and not committed
- FAIL initiative: poseidon: no demand or contest toward another god in any episode (at least 1); 0 proposed and not committed
- FAIL initiative: zeus: no demand or contest toward another god in any episode (at least 1); 0 proposed and not committed

Cross-episode checks failed: god thread over harm or defection, initiative: athena, initiative: hades, initiative: hephaestus, initiative: hera, initiative: hermes, initiative: poseidon, initiative: zeus.

## The episodes' numbers

| Episode | Food failure lines | Food prayers / prayers | Troubles by god | Wrongs | Cross-patron wrongs / with a consequence | Defections | Cause to closing, median / p95 (ticks) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 62 (at most 250) | 14 / 29 | athena 3, hades 2, hephaestus 2, hera 2, hermes 2, poseidon 2, zeus 2 | 11 | 11 / 2 | 1 | 153 / 156 |
| 2 | 52 (at most 250) | 20 / 36 | athena 3, hades 2, hephaestus 2, hera 2, hermes 3, poseidon 2, zeus 2 | 9 | 9 / 2 | 0 | 153 / 156 |
| 3 | 69 (at most 250) | 17 / 28 | athena 3, hades 2, hephaestus 3, hera 2, hermes 2, poseidon 2, zeus 2 | 9 | 9 / 2 | 0 | 153 / 156 |

## Queue wait per god (p95 of the ticks between a god's requests; ADR-0005 allows 90 s)

| Episode | God | Turns | p95 wait (ticks) | Against the target |
| --- | --- | --- | --- | --- |
| 1 | Athena | 3 | 117 | over |
| 1 | Hades | 3 | 114 | over |
| 1 | Hephaestus | 3 | 116 | over |
| 1 | Hera | 3 | 118 | over |
| 1 | Hermes | 3 | 109 | over |
| 1 | Poseidon | 3 | 112 | over |
| 1 | Zeus | 2 | 115 | over |
| 2 | Athena | 3 | 87 | within |
| 2 | Hades | 3 | 104 | over |
| 2 | Hephaestus | 3 | 109 | over |
| 2 | Hera | 3 | 117 | over |
| 2 | Hermes | 3 | 128 | over |
| 2 | Poseidon | 3 | 137 | over |
| 2 | Zeus | 2 | 86 | within |
| 3 | Athena | 3 | 118 | over |
| 3 | Hades | 3 | 118 | over |
| 3 | Hephaestus | 4 | 121 | over |
| 3 | Hera | 3 | 123 | over |
| 3 | Hermes | 3 | 78 | within |
| 3 | Poseidon | 2 | 117 | over |
| 3 | Zeus | 2 | 98 | over |

## Practices

| Episode | Threads | Ended | Open | Refused or breached | No progress | Obligated turns |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| 3 | 3 | 1 | 2 | 0 | 0 | 2 |

## Model runs

| Episode | Requests | Exhausted | Degraded polls | Latency p50 / p95 | Properties |
| --- | --- | --- | --- | --- | --- |
| 1 | 20 | 0 | 0% | 13345 / 23718 ms | 12 of 15 held |
| 2 | 20 | 1 | 3% | 12423 / 25210 ms | 11 of 15 held |
| 3 | 20 | 1 | 5% | 15047 / 19951 ms | 12 of 15 held |

## Transcripts

- [episode-1.md](episode-1.md)
- [episode-2.md](episode-2.md)
- [episode-3.md](episode-3.md)

## Owner

Scores are in each transcript's rubric. The owner scores; the tool never does.

Decision: continue / tune / replan: 
