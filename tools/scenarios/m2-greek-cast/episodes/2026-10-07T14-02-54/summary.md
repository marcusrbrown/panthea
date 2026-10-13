# M2 experience gate

- Requirements: O08
- Model: qwen3-8b-4k through local Ollama, 4K context, reasoning off (reasoning_effort none)
- 3 episodes of 300 s, each a fresh world from the initial authored Greek state; no fixtures, no seeds
- dispositions: travel 57 × committed, report 28 × committed, legend 18 × committed, practice 6 × committed, bless 3 × committed, report 2 × not-adjacent
- journeys: 57 started: 57 arrived, 0 refused, 0 replaced, 0 still travelling

## Automated checks

| Episode | God | Committed actions | Longest run | Told beliefs and feelings caused | Goals set / ended | Petitions heard / answered | Goal changes refused | Checks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Athena | 4 (4 ability, 0 context) | 4 | 7 | 0 / 0 | 5 / 0 | 0 | FAIL: repetition, minimum activity, petition answered |
| 1 | Hades | 5 (0 ability, 5 context) | 1 | 0 | 0 / 0 | 1 / 0 | 0 | FAIL: influence |
| 1 | Hephaestus | 4 (3 ability, 1 context) | 2 | 25 | 0 / 0 | 0 / 0 | 0 | FAIL: minimum activity, petition heard, petition answered |
| 1 | Hera | 5 (0 ability, 5 context) | 4 | 1 | 0 / 0 | 4 / 0 | 0 | FAIL: repetition, petition answered |
| 1 | Hermes | 5 (0 ability, 5 context) | 1 | 0 | 0 / 0 | 9 / 0 | 0 | FAIL: influence, petition answered |
| 1 | Poseidon | 5 (0 ability, 5 context) | 1 | 3 | 0 / 0 | 10 / 0 | 0 | FAIL: petition answered |
| 1 | Zeus | 6 (0 ability, 6 context) | 1 | 1 | 0 / 0 | 4 / 1 | 0 | pass |
| 2 | Athena | 5 (3 ability, 2 context) | 2 | 13 | 0 / 0 | 5 / 0 | 0 | FAIL: petition answered |
| 2 | Hades | 5 (0 ability, 5 context) | 1 | 0 | 0 / 0 | 1 / 0 | 0 | FAIL: influence |
| 2 | Hephaestus | 5 (3 ability, 2 context) | 3 | 12 | 0 / 0 | 0 / 0 | 0 | FAIL: petition heard, petition answered |
| 2 | Hera | 5 (0 ability, 5 context) | 3 | 3 | 0 / 0 | 3 / 0 | 0 | FAIL: petition answered |
| 2 | Hermes | 7 (2 ability, 5 context) | 2 | 2 | 0 / 0 | 5 / 0 | 0 | FAIL: petition answered |
| 2 | Poseidon | 5 (0 ability, 5 context) | 1 | 2 | 0 / 0 | 10 / 0 | 0 | FAIL: petition answered |
| 2 | Zeus | 5 (0 ability, 5 context) | 2 | 3 | 0 / 0 | 2 / 1 | 0 | pass |
| 3 | Athena | 6 (2 ability, 4 context) | 1 | 8 | 0 / 0 | 8 / 0 | 0 | FAIL: petition answered |
| 3 | Hades | 6 (0 ability, 6 context) | 1 | 0 | 0 / 0 | 1 / 0 | 0 | FAIL: influence |
| 3 | Hephaestus | 6 (3 ability, 3 context) | 3 | 8 | 0 / 0 | 0 / 0 | 0 | FAIL: petition heard, petition answered |
| 3 | Hera | 6 (0 ability, 6 context) | 1 | 2 | 0 / 0 | 4 / 0 | 0 | FAIL: petition answered |
| 3 | Hermes | 6 (3 ability, 3 context) | 2 | 3 | 0 / 0 | 7 / 0 | 0 | FAIL: petition answered |
| 3 | Poseidon | 5 (0 ability, 5 context) | 1 | 1 | 0 / 0 | 12 / 0 | 0 | FAIL: petition answered |
| 3 | Zeus | 6 (0 ability, 6 context) | 1 | 2 | 0 / 0 | 4 / 1 | 0 | pass |

Automated checks failed:

- episode 1: food prayer share (17 of 33 prayers are about food (fewer than half))
- episode 1, Athena: repetition (longest run 4 of legend:legend (cap 3))
- episode 1, Athena: minimum activity (4 committed model actions (at least 5))
- episode 1, Athena: petition answered (5 heard, none answered (at least 1))
- episode 1, Hades: influence (no told belief or relationship change traces to this god's proposals)
- episode 1, Hephaestus: minimum activity (4 committed model actions (at least 5))
- episode 1, Hephaestus: petition heard (no petition was addressed to this god (at least 1))
- episode 1, Hephaestus: petition answered (0 heard, none answered (at least 1))
- episode 1, Hera: repetition (longest run 4 of report:athena (cap 3))
- episode 1, Hera: petition answered (4 heard, none answered (at least 1))
- episode 1, Hermes: influence (no told belief or relationship change traces to this god's proposals)
- episode 1, Hermes: petition answered (9 heard, none answered (at least 1))
- episode 1, Poseidon: petition answered (10 heard, none answered (at least 1))
- episode 1, property god thread endings (athena: no thread ending it caused left a persistent consequence; hades: no thread ending it caused left a persistent consequence; hephaestus: no thread ending it caused left a persistent consequence; hera: no thread ending it caused left a persistent consequence; hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: 1 (fulfilled [evt-54-1017]))
- episode 1, property supplication and settlement (1 supplications, 0 settlements, 0 refused or breached)
- episode 2: food prayer share (15 of 26 prayers are about food (fewer than half))
- episode 2, Athena: petition answered (5 heard, none answered (at least 1))
- episode 2, Hades: influence (no told belief or relationship change traces to this god's proposals)
- episode 2, Hephaestus: petition heard (no petition was addressed to this god (at least 1))
- episode 2, Hephaestus: petition answered (0 heard, none answered (at least 1))
- episode 2, Hera: petition answered (3 heard, none answered (at least 1))
- episode 2, Hermes: petition answered (5 heard, none answered (at least 1))
- episode 2, Poseidon: petition answered (10 heard, none answered (at least 1))
- episode 2, property god thread endings (athena: no thread ending it caused left a persistent consequence; hades: no thread ending it caused left a persistent consequence; hephaestus: no thread ending it caused left a persistent consequence; hera: no thread ending it caused left a persistent consequence; hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: 1 (fulfilled [evt-42-840]))
- episode 2, property supplication and settlement (4 supplications, 0 settlements, 1 refused or breached (refused [evt-84-1644]))
- episode 3: food prayer share (18 of 36 prayers are about food (fewer than half))
- episode 3, Athena: petition answered (8 heard, none answered (at least 1))
- episode 3, Hades: influence (no told belief or relationship change traces to this god's proposals)
- episode 3, Hephaestus: petition heard (no petition was addressed to this god (at least 1))
- episode 3, Hephaestus: petition answered (0 heard, none answered (at least 1))
- episode 3, Hera: petition answered (4 heard, none answered (at least 1))
- episode 3, Hermes: petition answered (7 heard, none answered (at least 1))
- episode 3, Poseidon: petition answered (12 heard, none answered (at least 1))
- episode 3, property god thread endings (athena: no thread ending it caused left a persistent consequence; hades: no thread ending it caused left a persistent consequence; hephaestus: no thread ending it caused left a persistent consequence; hera: no thread ending it caused left a persistent consequence; hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: 1 (fulfilled [evt-42-839]))
- episode 3, property supplication and settlement (1 supplications, 0 settlements, 0 refused or breached)

## Across the episodes

- PASS mortal wrong: 27 wrongs between mortals of different patrons, 16 prayed to the victim's patron, 4 with a consequence (punishment, revenge, or defection; at least 1)
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
| 1 | 68 (at most 250) | 17 / 33 | athena 3, hades 2, hephaestus 2, hera 2, hermes 3, poseidon 2, zeus 2 | 12 | 12 / 2 | 0 | 153 / 177 |
| 2 | 65 (at most 250) | 15 / 26 | athena 3, hades 2, hephaestus 2, hera 2, hermes 2, poseidon 2, zeus 2 | 7 | 6 / 1 | 0 | 153 / 155 |
| 3 | 95 (at most 250) | 18 / 36 | athena 3, hades 2, hephaestus 2, hera 2, hermes 2, poseidon 2, zeus 3 | 10 | 9 / 1 | 0 | 153 / 238 |

## Queue wait per god (p95 of the ticks between a god's requests; ADR-0005 allows 90 s)

| Episode | God | Turns | p95 wait (ticks) | Against the target |
| --- | --- | --- | --- | --- |
| 1 | Athena | 5 | 59 | within |
| 1 | Hades | 5 | 60 | within |
| 1 | Hephaestus | 5 | 60 | within |
| 1 | Hera | 5 | 60 | within |
| 1 | Hermes | 5 | 61 | within |
| 1 | Poseidon | 5 | 62 | within |
| 1 | Zeus | 6 | 61 | within |
| 2 | Athena | 5 | 67 | within |
| 2 | Hades | 5 | 68 | within |
| 2 | Hephaestus | 5 | 68 | within |
| 2 | Hera | 5 | 69 | within |
| 2 | Hermes | 7 | 66 | within |
| 2 | Poseidon | 5 | 73 | within |
| 2 | Zeus | 5 | 63 | within |
| 3 | Athena | 6 | 59 | within |
| 3 | Hades | 6 | 60 | within |
| 3 | Hephaestus | 6 | 62 | within |
| 3 | Hera | 6 | 62 | within |
| 3 | Hermes | 6 | 66 | within |
| 3 | Poseidon | 5 | 60 | within |
| 3 | Zeus | 6 | 61 | within |

## Practices

| Episode | Threads | Ended | Open | Refused or breached | No progress | Obligated turns |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 1 | 0 | 0 | 0 | 1 |
| 2 | 4 | 3 | 1 | 1 | 0 | 3 |
| 3 | 1 | 1 | 0 | 0 | 0 | 1 |

## Model runs

| Episode | Requests | Exhausted | Degraded polls | Latency p50 / p95 | Properties |
| --- | --- | --- | --- | --- | --- |
| 1 | 36 | 0 | 0% | 8307 / 12163 ms | 13 of 15 held |
| 2 | 37 | 0 | 0% | 8305 / 13018 ms | 13 of 15 held |
| 3 | 41 | 0 | 0% | 6318 / 12381 ms | 13 of 15 held |

## Transcripts

- [episode-1.md](episode-1.md)
- [episode-2.md](episode-2.md)
- [episode-3.md](episode-3.md)

## Owner

Scores are in each transcript's rubric. The owner scores; the tool never does.

Decision: continue / tune / replan: 
