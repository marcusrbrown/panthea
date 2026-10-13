# M2 experience gate

- Requirements: O08
- Model: granite3.3-8b-4k through local Ollama, 4K context, reasoning off (reasoning_effort none)
- 3 episodes of 300 s, each a fresh world from the initial authored Greek state; no fixtures, no seeds
- dispositions: bless 43 × committed, legend 17 × committed, report 14 × committed, strike 5 × committed, travel 4 × committed, practice 4 × committed, report 1 × not-adjacent, practice 1 × insufficient-resources, bless 1 × pending, goal 1 × committed
- journeys: 4 started: 4 arrived, 0 refused, 0 replaced, 0 still travelling

## Automated checks

| Episode | God | Committed actions | Longest run | Told beliefs and feelings caused | Goals set / ended | Petitions heard / answered | Goal changes refused | Checks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Athena | 5 (5 ability, 0 context) | 1 | 10 | 0 / 0 | 8 / 3 | 0 | pass |
| 1 | Hades | 5 (0 ability, 5 context) | 1 | 3 | 0 / 0 | 1 / 1 | 0 | pass |
| 1 | Hephaestus | 4 (3 ability, 1 context) | 1 | 6 | 0 / 0 | 1 / 1 | 0 | FAIL: minimum activity |
| 1 | Hera | 5 (0 ability, 5 context) | 1 | 5 | 0 / 0 | 4 / 3 | 0 | pass |
| 1 | Hermes | 5 (5 ability, 0 context) | 1 | 5 | 0 / 0 | 11 / 4 | 0 | pass |
| 1 | Poseidon | 4 (1 ability, 3 context) | 1 | 4 | 0 / 0 | 12 / 4 | 0 | FAIL: minimum activity |
| 1 | Zeus | 5 (1 ability, 4 context) | 1 | 4 | 0 / 0 | 3 / 2 | 0 | pass |
| 2 | Athena | 5 (4 ability, 1 context) | 1 | 7 | 0 / 0 | 11 / 3 | 0 | pass |
| 2 | Hades | 4 (1 ability, 3 context) | 1 | 1 | 0 / 0 | 0 / 0 | 0 | FAIL: minimum activity, petition heard |
| 2 | Hephaestus | 5 (5 ability, 0 context) | 1 | 4 | 0 / 0 | 4 / 3 | 0 | pass |
| 2 | Hera | 4 (0 ability, 4 context) | 2 | 4 | 0 / 0 | 3 / 2 | 0 | FAIL: minimum activity |
| 2 | Hermes | 5 (5 ability, 0 context) | 1 | 5 | 0 / 0 | 11 / 5 | 0 | pass |
| 2 | Poseidon | 6 (1 ability, 5 context) | 1 | 5 | 0 / 0 | 14 / 4 | 0 | pass |
| 2 | Zeus | 5 (2 ability, 3 context) | 2 | 4 | 0 / 0 | 3 / 2 | 0 | pass |
| 3 | Athena | 3 (3 ability, 0 context) | 1 | 8 | 0 / 0 | 7 / 1 | 0 | FAIL: minimum activity |
| 3 | Hades | 2 (1 ability, 1 context) | 1 | 0 | 1 / 0 | 1 / 0 | 0 | FAIL: minimum activity, influence |
| 3 | Hephaestus | 3 (3 ability, 0 context) | 3 | 11 | 0 / 0 | 0 / 0 | 0 | FAIL: minimum activity, petition heard, petition answered |
| 3 | Hera | 3 (1 ability, 2 context) | 1 | 3 | 0 / 0 | 4 / 2 | 0 | FAIL: minimum activity |
| 3 | Hermes | 3 (3 ability, 0 context) | 1 | 3 | 0 / 0 | 6 / 2 | 0 | FAIL: minimum activity |
| 3 | Poseidon | 3 (1 ability, 2 context) | 1 | 3 | 0 / 0 | 9 / 3 | 0 | FAIL: minimum activity |
| 3 | Zeus | 3 (1 ability, 2 context) | 1 | 3 | 0 / 0 | 2 / 1 | 0 | FAIL: minimum activity |

Automated checks failed:

- episode 1, Hephaestus: minimum activity (4 committed model actions (at least 5))
- episode 1, Poseidon: minimum activity (4 committed model actions (at least 5))
- episode 1, property god thread endings (athena: no thread ending it caused left a persistent consequence; hades: 1 (fulfilled [evt-252-4544]); hephaestus: no thread ending it caused left a persistent consequence; hera: no thread ending it caused left a persistent consequence; hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: 1 (fulfilled [evt-64-1275]))
- episode 1, property supplication and settlement (2 supplications, 0 settlements, 0 refused or breached)
- episode 2, Hades: minimum activity (4 committed model actions (at least 5))
- episode 2, Hades: petition heard (no petition was addressed to this god (at least 1))
- episode 2, Hera: minimum activity (4 committed model actions (at least 5))
- episode 2, property god thread endings (athena: no thread ending it caused left a persistent consequence; hades: no thread ending it caused left a persistent consequence; hephaestus: no thread ending it caused left a persistent consequence; hera: no thread ending it caused left a persistent consequence; hermes: no thread ending it caused left a persistent consequence; poseidon: 1 (fulfilled [evt-38-716]); zeus: no thread ending it caused left a persistent consequence)
- episode 2, property supplication and settlement (2 supplications, 0 settlements, 0 refused or breached)
- episode 3, Athena: minimum activity (3 committed model actions (at least 5))
- episode 3, Hades: minimum activity (2 committed model actions (at least 5))
- episode 3, Hades: influence (no told belief or relationship change traces to this god's proposals)
- episode 3, Hephaestus: minimum activity (3 committed model actions (at least 5))
- episode 3, Hephaestus: petition heard (no petition was addressed to this god (at least 1))
- episode 3, Hephaestus: petition answered (0 heard, none answered (at least 1))
- episode 3, Hera: minimum activity (3 committed model actions (at least 5))
- episode 3, Hermes: minimum activity (3 committed model actions (at least 5))
- episode 3, Poseidon: minimum activity (3 committed model actions (at least 5))
- episode 3, Zeus: minimum activity (3 committed model actions (at least 5))
- episode 3, property god thread endings (no thread was opened)
- episode 3, property supplication and settlement (0 supplications, 0 settlements, 0 refused or breached)
- episode 3, property consequence changes a later choice (no thread ending left a consequence on a god)

## Across the episodes

- PASS mortal wrong: 22 wrongs between mortals of different patrons, 16 prayed to the victim's patron, 3 with a consequence (punishment, revenge, or defection; at least 1)
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
| 1 | 83 (at most 250) | 18 / 40 | athena 3, hades 2, hephaestus 2, hera 2, hermes 2, poseidon 2, zeus 2 | 7 | 6 / 1 | 0 | 51 / 152 |
| 2 | 79 (at most 250) | 16 / 46 | athena 2, hades 2, hephaestus 2, hera 2, hermes 4, poseidon 2, zeus 2 | 10 | 9 / 1 | 0 | 51 / 155 |
| 3 | 52 (at most 250) | 13 / 29 | athena 3, hades 2, hephaestus 2, hera 2, hermes 2, poseidon 2, zeus 2 | 7 | 7 / 1 | 0 | 35 / 154 |

## Queue wait per god (p95 of the ticks between a god's requests; ADR-0005 allows 90 s)

| Episode | God | Turns | p95 wait (ticks) | Against the target |
| --- | --- | --- | --- | --- |
| 1 | Athena | 5 | 63 | within |
| 1 | Hades | 6 | 65 | within |
| 1 | Hephaestus | 5 | 69 | within |
| 1 | Hera | 5 | 73 | within |
| 1 | Hermes | 5 | 73 | within |
| 1 | Poseidon | 4 | 63 | within |
| 1 | Zeus | 5 | 64 | within |
| 2 | Athena | 6 | 66 | within |
| 2 | Hades | 5 | 70 | within |
| 2 | Hephaestus | 5 | 70 | within |
| 2 | Hera | 5 | 72 | within |
| 2 | Hermes | 5 | 63 | within |
| 2 | Poseidon | 6 | 66 | within |
| 2 | Zeus | 5 | 67 | within |
| 3 | Athena | 21 | 42 | within |
| 3 | Hades | 21 | 44 | within |
| 3 | Hephaestus | 21 | 43 | within |
| 3 | Hera | 21 | 43 | within |
| 3 | Hermes | 21 | 46 | within |
| 3 | Poseidon | 20 | 51 | within |
| 3 | Zeus | 20 | 51 | within |

## Practices

| Episode | Threads | Ended | Open | Refused or breached | No progress | Obligated turns |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 2 | 2 | 0 | 0 | 0 | 2 |
| 2 | 2 | 1 | 1 | 0 | 0 | 1 |
| 3 | 0 | 0 | 0 | 0 | 0 | 0 |

## Model runs

| Episode | Requests | Exhausted | Degraded polls | Latency p50 / p95 | Properties |
| --- | --- | --- | --- | --- | --- |
| 1 | 35 | 1 | 2% | 7704 / 12059 ms | 13 of 15 held |
| 2 | 37 | 0 | 0% | 7251 / 13468 ms | 13 of 15 held |
| 3 | 145 | 124 | 51% | 24 / 7568 ms | 12 of 15 held |

## Transcripts

- [episode-1.md](episode-1.md)
- [episode-2.md](episode-2.md)
- [episode-3.md](episode-3.md)

## Owner

Scores are in each transcript's rubric. The owner scores; the tool never does.

Decision: continue / tune / replan: 
