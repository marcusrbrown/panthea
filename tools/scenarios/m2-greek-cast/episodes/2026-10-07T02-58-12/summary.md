# M2 experience gate

- Requirements: O08
- Model: qwen3-8b-4k through local Ollama, 4K context, reasoning off (reasoning_effort none)
- 3 episodes of 300 s, each a fresh world from the initial authored Greek state; no fixtures, no seeds
- dispositions: travel 56 × committed, legend 23 × committed, practice 7 × committed, bless 6 × committed, report 4 × committed, bless 3 × malformed, bless 1 × not-adjacent
- journeys: 56 started: 56 arrived, 0 refused, 0 replaced, 0 still travelling

## Automated checks

| Episode | God | Committed actions | Longest run | Told beliefs and feelings caused | Goals set / ended | Petitions heard / answered | Goal changes refused | Checks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Athena | 6 (1 ability, 5 context) | 1 | 4 | 0 / 0 | 4 / 0 | 0 | FAIL: petition answered |
| 1 | Hades | 5 (0 ability, 5 context) | 1 | 0 | 0 / 0 | 2 / 0 | 0 | FAIL: influence |
| 1 | Hephaestus | 5 (4 ability, 1 context) | 3 | 18 | 0 / 0 | 0 / 0 | 0 | FAIL: petition heard, petition answered |
| 1 | Hera | 5 (4 ability, 1 context) | 4 | 23 | 0 / 0 | 3 / 0 | 0 | FAIL: repetition, petition answered |
| 1 | Hermes | 4 (2 ability, 2 context) | 2 | 2 | 0 / 0 | 9 / 0 | 0 | FAIL: minimum activity, petition answered |
| 1 | Poseidon | 4 (0 ability, 4 context) | 1 | 0 | 0 / 0 | 8 / 0 | 0 | FAIL: minimum activity, influence, petition answered |
| 1 | Zeus | 5 (0 ability, 5 context) | 1 | 1 | 0 / 0 | 5 / 1 | 0 | pass |
| 2 | Athena | 6 (3 ability, 3 context) | 1 | 20 | 0 / 0 | 4 / 1 | 0 | pass |
| 2 | Hades | 5 (0 ability, 5 context) | 1 | 0 | 0 / 0 | 0 / 0 | 0 | FAIL: influence, petition heard |
| 2 | Hephaestus | 5 (5 ability, 0 context) | 5 | 6 | 0 / 0 | 0 / 0 | 0 | FAIL: repetition, petition heard, petition answered |
| 2 | Hera | 4 (0 ability, 4 context) | 1 | 0 | 0 / 0 | 4 / 0 | 0 | FAIL: minimum activity, influence, petition answered |
| 2 | Hermes | 3 (1 ability, 2 context) | 1 | 1 | 0 / 0 | 7 / 0 | 0 | FAIL: minimum activity, petition answered |
| 2 | Poseidon | 4 (0 ability, 4 context) | 1 | 1 | 0 / 0 | 5 / 1 | 0 | FAIL: minimum activity |
| 2 | Zeus | 6 (1 ability, 5 context) | 1 | 20 | 0 / 0 | 3 / 1 | 0 | pass |
| 3 | Athena | 4 (3 ability, 1 context) | 1 | 19 | 0 / 0 | 6 / 1 | 0 | FAIL: minimum activity |
| 3 | Hades | 5 (0 ability, 5 context) | 1 | 0 | 0 / 0 | 1 / 0 | 0 | FAIL: influence |
| 3 | Hephaestus | 5 (4 ability, 1 context) | 3 | 22 | 0 / 0 | 0 / 0 | 0 | FAIL: petition heard, petition answered |
| 3 | Hera | 3 (0 ability, 3 context) | 1 | 0 | 0 / 0 | 4 / 0 | 0 | FAIL: minimum activity, influence, petition answered |
| 3 | Hermes | 3 (1 ability, 2 context) | 1 | 1 | 0 / 0 | 9 / 0 | 0 | FAIL: minimum activity, petition answered |
| 3 | Poseidon | 4 (0 ability, 4 context) | 1 | 0 | 0 / 0 | 9 / 0 | 0 | FAIL: minimum activity, influence, petition answered |
| 3 | Zeus | 5 (0 ability, 5 context) | 1 | 1 | 0 / 0 | 3 / 1 | 0 | pass |

Automated checks failed:

- episode 1, Athena: petition answered (4 heard, none answered (at least 1))
- episode 1, Hades: influence (no told belief or relationship change traces to this god's proposals)
- episode 1, Hephaestus: petition heard (no petition was addressed to this god (at least 1))
- episode 1, Hephaestus: petition answered (0 heard, none answered (at least 1))
- episode 1, Hera: repetition (longest run 4 of legend:legend (cap 3))
- episode 1, Hera: petition answered (3 heard, none answered (at least 1))
- episode 1, Hermes: minimum activity (4 committed model actions (at least 5))
- episode 1, Hermes: petition answered (9 heard, none answered (at least 1))
- episode 1, Poseidon: minimum activity (4 committed model actions (at least 5))
- episode 1, Poseidon: influence (no told belief or relationship change traces to this god's proposals)
- episode 1, Poseidon: petition answered (8 heard, none answered (at least 1))
- episode 1, property god thread endings (athena: no thread ending it caused left a persistent consequence; hades: no thread ending it caused left a persistent consequence; hephaestus: no thread ending it caused left a persistent consequence; hera: no thread ending it caused left a persistent consequence; hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: 1 (fulfilled [evt-105-1924]))
- episode 1, property supplication and settlement (3 supplications, 0 settlements, 0 refused or breached)
- episode 2: food prayer share (13 of 23 prayers are about food (fewer than half))
- episode 2, Hades: influence (no told belief or relationship change traces to this god's proposals)
- episode 2, Hades: petition heard (no petition was addressed to this god (at least 1))
- episode 2, Hephaestus: repetition (longest run 5 of legend:legend (cap 3))
- episode 2, Hephaestus: petition heard (no petition was addressed to this god (at least 1))
- episode 2, Hephaestus: petition answered (0 heard, none answered (at least 1))
- episode 2, Hera: minimum activity (4 committed model actions (at least 5))
- episode 2, Hera: influence (no told belief or relationship change traces to this god's proposals)
- episode 2, Hera: petition answered (4 heard, none answered (at least 1))
- episode 2, Hermes: minimum activity (3 committed model actions (at least 5))
- episode 2, Hermes: petition answered (7 heard, none answered (at least 1))
- episode 2, Poseidon: minimum activity (4 committed model actions (at least 5))
- episode 2, property valid actions (0 not god actions (), 1 rejected as malformed)
- episode 2, property god thread endings (athena: 1 (fulfilled [evt-182-3260]); hades: no thread ending it caused left a persistent consequence; hephaestus: no thread ending it caused left a persistent consequence; hera: no thread ending it caused left a persistent consequence; hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: 1 (fulfilled [evt-98-1804]))
- episode 2, property supplication and settlement (3 supplications, 0 settlements, 0 refused or breached)
- episode 3: food prayer share (16 of 32 prayers are about food (fewer than half))
- episode 3, Athena: minimum activity (4 committed model actions (at least 5))
- episode 3, Hades: influence (no told belief or relationship change traces to this god's proposals)
- episode 3, Hephaestus: petition heard (no petition was addressed to this god (at least 1))
- episode 3, Hephaestus: petition answered (0 heard, none answered (at least 1))
- episode 3, Hera: minimum activity (3 committed model actions (at least 5))
- episode 3, Hera: influence (no told belief or relationship change traces to this god's proposals)
- episode 3, Hera: petition answered (4 heard, none answered (at least 1))
- episode 3, Hermes: minimum activity (3 committed model actions (at least 5))
- episode 3, Hermes: petition answered (9 heard, none answered (at least 1))
- episode 3, Poseidon: minimum activity (4 committed model actions (at least 5))
- episode 3, Poseidon: influence (no told belief or relationship change traces to this god's proposals)
- episode 3, Poseidon: petition answered (9 heard, none answered (at least 1))
- episode 3, property valid actions (0 not god actions (), 2 rejected as malformed)
- episode 3, property god thread endings (athena: no thread ending it caused left a persistent consequence; hades: no thread ending it caused left a persistent consequence; hephaestus: no thread ending it caused left a persistent consequence; hera: no thread ending it caused left a persistent consequence; hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: 1 (fulfilled [evt-102-1873]))
- episode 3, property supplication and settlement (1 supplications, 0 settlements, 0 refused or breached)

## Across the episodes

- PASS mortal wrong: 23 wrongs between mortals of different patrons, 15 prayed to the victim's patron, 6 with a consequence (punishment, revenge, or defection; at least 1)
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
| 1 | 66 (at most 250) | 13 / 31 | athena 3, hades 2, hephaestus 2, hera 2, hermes 2, poseidon 2, zeus 2 | 8 | 7 / 2 | 0 | 153 / 156 |
| 2 | 49 (at most 250) | 13 / 23 | athena 3, hades 2, hephaestus 2, hera 2, hermes 2, poseidon 2, zeus 2 | 9 | 9 / 2 | 0 | 153 / 156 |
| 3 | 73 (at most 250) | 16 / 32 | athena 3, hades 2, hephaestus 2, hera 2, hermes 2, poseidon 2, zeus 3 | 7 | 7 / 2 | 0 | 153 / 156 |

## Queue wait per god (p95 of the ticks between a god's requests; ADR-0005 allows 90 s)

| Episode | God | Turns | p95 wait (ticks) | Against the target |
| --- | --- | --- | --- | --- |
| 1 | Athena | 7 | 62 | within |
| 1 | Hades | 5 | 77 | within |
| 1 | Hephaestus | 5 | 78 | within |
| 1 | Hera | 5 | 77 | within |
| 1 | Hermes | 4 | 78 | within |
| 1 | Poseidon | 4 | 73 | within |
| 1 | Zeus | 5 | 82 | within |
| 2 | Athena | 6 | 70 | within |
| 2 | Hades | 5 | 81 | within |
| 2 | Hephaestus | 5 | 79 | within |
| 2 | Hera | 5 | 80 | within |
| 2 | Hermes | 4 | 83 | within |
| 2 | Poseidon | 4 | 77 | within |
| 2 | Zeus | 6 | 75 | within |
| 3 | Athena | 5 | 79 | within |
| 3 | Hades | 5 | 75 | within |
| 3 | Hephaestus | 5 | 79 | within |
| 3 | Hera | 4 | 77 | within |
| 3 | Hermes | 4 | 80 | within |
| 3 | Poseidon | 4 | 76 | within |
| 3 | Zeus | 5 | 78 | within |

## Practices

| Episode | Threads | Ended | Open | Refused or breached | No progress | Obligated turns |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 3 | 3 | 0 | 0 | 0 | 4 |
| 2 | 3 | 2 | 1 | 0 | 0 | 3 |
| 3 | 1 | 1 | 0 | 0 | 0 | 1 |

## Model runs

| Episode | Requests | Exhausted | Degraded polls | Latency p50 / p95 | Properties |
| --- | --- | --- | --- | --- | --- |
| 1 | 35 | 0 | 0% | 8211 / 13192 ms | 13 of 15 held |
| 2 | 35 | 1 | 3% | 7546 / 13927 ms | 12 of 15 held |
| 3 | 32 | 1 | 3% | 8564 / 15902 ms | 12 of 15 held |

## Transcripts

- [episode-1.md](episode-1.md)
- [episode-2.md](episode-2.md)
- [episode-3.md](episode-3.md)

## Owner

Scores are in each transcript's rubric. The owner scores; the tool never does.

Decision: continue / tune / replan: 
