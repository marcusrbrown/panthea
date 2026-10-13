# M2 experience gate

- Requirements: O08
- Model: gemma4-e4b-4k through local Ollama, 4K context, reasoning off (reasoning_effort none)
- 3 episodes of 300 s, each a fresh world from the initial authored Greek state; no fixtures, no seeds
- dispositions: report 30 × committed, bless 11 × committed, legend 10 × committed, travel 3 × committed, practice 1 × committed, strike 1 × committed
- journeys: 3 started: 3 arrived, 0 refused, 0 replaced, 0 still travelling

## Automated checks

| Episode | God | Committed actions | Longest run | Told beliefs and feelings caused | Goals set / ended | Petitions heard / answered | Goal changes refused | Checks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Athena | 2 (1 ability, 1 context) | 1 | 2 | 1 / 0 | 8 / 1 | 0 | FAIL: minimum activity |
| 1 | Hades | 5 (3 ability, 2 context) | 3 | 1 | 1 / 0 | 2 / 1 | 0 | pass |
| 1 | Hephaestus | 0 (0 ability, 0 context) | 0 | 0 | 0 / 0 | 0 / 0 | 0 | FAIL: minimum activity, influence, petition heard, petition answered |
| 1 | Hera | 5 (0 ability, 5 context) | 5 | 5 | 2 / 1 | 3 / 0 | 0 | FAIL: repetition, petition answered |
| 1 | Hermes | 3 (2 ability, 1 context) | 1 | 2 | 0 / 0 | 6 / 2 | 0 | FAIL: minimum activity |
| 1 | Poseidon | 4 (0 ability, 4 context) | 4 | 4 | 3 / 2 | 12 / 0 | 0 | FAIL: repetition, minimum activity, petition answered |
| 1 | Zeus | 4 (1 ability, 3 context) | 2 | 5 | 0 / 0 | 3 / 1 | 0 | FAIL: minimum activity |
| 2 | Athena | 2 (1 ability, 1 context) | 1 | 2 | 0 / 0 | 5 / 1 | 0 | FAIL: minimum activity |
| 2 | Hades | 4 (1 ability, 3 context) | 2 | 2 | 1 / 0 | 2 / 0 | 0 | FAIL: minimum activity |
| 2 | Hephaestus | 0 (0 ability, 0 context) | 0 | 0 | 0 / 0 | 0 / 0 | 0 | FAIL: minimum activity, influence, petition heard, petition answered |
| 2 | Hera | 4 (0 ability, 4 context) | 4 | 4 | 1 / 0 | 4 / 0 | 0 | FAIL: repetition, minimum activity, petition answered |
| 2 | Hermes | 0 (0 ability, 0 context) | 0 | 0 | 0 / 0 | 8 / 0 | 0 | FAIL: minimum activity, influence, petition answered |
| 2 | Poseidon | 4 (1 ability, 3 context) | 1 | 4 | 2 / 1 | 7 / 2 | 0 | FAIL: minimum activity |
| 2 | Zeus | 4 (0 ability, 4 context) | 1 | 4 | 1 / 0 | 4 / 2 | 0 | FAIL: minimum activity |
| 3 | Athena | 2 (1 ability, 1 context) | 1 | 2 | 1 / 0 | 4 / 1 | 0 | FAIL: minimum activity |
| 3 | Hades | 4 (3 ability, 1 context) | 2 | 0 | 1 / 0 | 1 / 0 | 0 | FAIL: minimum activity, influence |
| 3 | Hephaestus | 0 (0 ability, 0 context) | 0 | 0 | 0 / 0 | 0 / 0 | 0 | FAIL: minimum activity, influence, petition heard, petition answered |
| 3 | Hera | 4 (1 ability, 3 context) | 3 | 5 | 1 / 0 | 3 / 0 | 0 | FAIL: minimum activity, petition answered |
| 3 | Hermes | 0 (0 ability, 0 context) | 0 | 0 | 0 / 0 | 8 / 0 | 0 | FAIL: minimum activity, influence, petition answered |
| 3 | Poseidon | 1 (0 ability, 1 context) | 1 | 1 | 1 / 0 | 6 / 0 | 0 | FAIL: minimum activity, petition answered |
| 3 | Zeus | 4 (1 ability, 3 context) | 2 | 5 | 1 / 0 | 4 / 1 | 0 | FAIL: minimum activity |

Automated checks failed:

- episode 1, Athena: minimum activity (2 committed model actions (at least 5))
- episode 1, Hephaestus: minimum activity (0 committed model actions (at least 5))
- episode 1, Hephaestus: influence (no told belief or relationship change traces to this god's proposals)
- episode 1, Hephaestus: petition heard (no petition was addressed to this god (at least 1))
- episode 1, Hephaestus: petition answered (0 heard, none answered (at least 1))
- episode 1, Hera: repetition (longest run 5 of report:zeus (cap 3))
- episode 1, Hera: petition answered (3 heard, none answered (at least 1))
- episode 1, Hermes: minimum activity (3 committed model actions (at least 5))
- episode 1, Poseidon: repetition (longest run 4 of report:hermes (cap 3))
- episode 1, Poseidon: minimum activity (4 committed model actions (at least 5))
- episode 1, Poseidon: petition answered (12 heard, none answered (at least 1))
- episode 1, Zeus: minimum activity (4 committed model actions (at least 5))
- episode 1, property changed next action (hera: report:zeus,altar before its first belief, report:zeus,altar after (same))
- episode 1, property god thread endings (athena: no thread ending it caused left a persistent consequence; hades: no thread ending it caused left a persistent consequence; hephaestus: no thread ending it caused left a persistent consequence; hera: no thread ending it caused left a persistent consequence; hermes: 1 (fulfilled [evt-211-3717]); poseidon: no thread ending it caused left a persistent consequence; zeus: no thread ending it caused left a persistent consequence)
- episode 1, property supplication and settlement (1 supplications, 0 settlements, 0 refused or breached)
- episode 1, property consequence changes a later choice (hermes: a consequence at 4989, but no committed action on both sides of it)
- episode 2: food prayer share (15 of 30 prayers are about food (fewer than half))
- episode 2, Athena: minimum activity (2 committed model actions (at least 5))
- episode 2, Hades: minimum activity (4 committed model actions (at least 5))
- episode 2, Hephaestus: minimum activity (0 committed model actions (at least 5))
- episode 2, Hephaestus: influence (no told belief or relationship change traces to this god's proposals)
- episode 2, Hephaestus: petition heard (no petition was addressed to this god (at least 1))
- episode 2, Hephaestus: petition answered (0 heard, none answered (at least 1))
- episode 2, Hera: repetition (longest run 4 of report:zeus (cap 3))
- episode 2, Hera: minimum activity (4 committed model actions (at least 5))
- episode 2, Hera: petition answered (4 heard, none answered (at least 1))
- episode 2, Hermes: minimum activity (0 committed model actions (at least 5))
- episode 2, Hermes: influence (no told belief or relationship change traces to this god's proposals)
- episode 2, Hermes: petition answered (8 heard, none answered (at least 1))
- episode 2, Poseidon: minimum activity (4 committed model actions (at least 5))
- episode 2, Zeus: minimum activity (4 committed model actions (at least 5))
- episode 2, property changed next action (hera: report:zeus before its first belief, report:zeus after (same))
- episode 2, property god thread endings (no thread was opened)
- episode 2, property supplication and settlement (0 supplications, 0 settlements, 0 refused or breached)
- episode 2, property consequence changes a later choice (no thread ending left a consequence on a god)
- episode 3: food prayer share (15 of 26 prayers are about food (fewer than half))
- episode 3, Athena: minimum activity (2 committed model actions (at least 5))
- episode 3, Hades: minimum activity (4 committed model actions (at least 5))
- episode 3, Hades: influence (no told belief or relationship change traces to this god's proposals)
- episode 3, Hephaestus: minimum activity (0 committed model actions (at least 5))
- episode 3, Hephaestus: influence (no told belief or relationship change traces to this god's proposals)
- episode 3, Hephaestus: petition heard (no petition was addressed to this god (at least 1))
- episode 3, Hephaestus: petition answered (0 heard, none answered (at least 1))
- episode 3, Hera: minimum activity (4 committed model actions (at least 5))
- episode 3, Hera: petition answered (3 heard, none answered (at least 1))
- episode 3, Hermes: minimum activity (0 committed model actions (at least 5))
- episode 3, Hermes: influence (no told belief or relationship change traces to this god's proposals)
- episode 3, Hermes: petition answered (8 heard, none answered (at least 1))
- episode 3, Poseidon: minimum activity (1 committed model actions (at least 5))
- episode 3, Poseidon: petition answered (6 heard, none answered (at least 1))
- episode 3, Zeus: minimum activity (4 committed model actions (at least 5))
- episode 3, property god thread endings (no thread was opened)
- episode 3, property supplication and settlement (0 supplications, 0 settlements, 0 refused or breached)
- episode 3, property consequence changes a later choice (no thread ending left a consequence on a god)

## Across the episodes

- PASS mortal wrong: 25 wrongs between mortals of different patrons, 15 prayed to the victim's patron, 4 with a consequence (punishment, revenge, or defection; at least 1)
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
| 1 | 65 (at most 250) | 15 / 34 | athena 3, hades 2, hephaestus 2, hera 2, hermes 2, poseidon 2, zeus 2 | 6 | 5 / 0 | 0 | 153 / 156 |
| 2 | 55 (at most 250) | 15 / 30 | athena 3, hades 2, hephaestus 2, hera 2, hermes 2, poseidon 2, zeus 2 | 8 | 8 / 2 | 0 | 152 / 156 |
| 3 | 42 (at most 250) | 15 / 26 | athena 3, hades 2, hephaestus 2, hera 2, hermes 2, poseidon 2, zeus 2 | 13 | 12 / 2 | 0 | 153 / 156 |

## Queue wait per god (p95 of the ticks between a god's requests; ADR-0005 allows 90 s)

| Episode | God | Turns | p95 wait (ticks) | Against the target |
| --- | --- | --- | --- | --- |
| 1 | Athena | 5 | 83 | within |
| 1 | Hades | 5 | 76 | within |
| 1 | Hephaestus | 5 | 80 | within |
| 1 | Hera | 5 | 85 | within |
| 1 | Hermes | 6 | 84 | within |
| 1 | Poseidon | 4 | 82 | within |
| 1 | Zeus | 4 | 83 | within |
| 2 | Athena | 4 | 95 | over |
| 2 | Hades | 4 | 94 | over |
| 2 | Hephaestus | 4 | 96 | over |
| 2 | Hera | 4 | 91 | over |
| 2 | Hermes | 4 | 87 | within |
| 2 | Poseidon | 4 | 86 | within |
| 2 | Zeus | 4 | 95 | over |
| 3 | Athena | 4 | 78 | within |
| 3 | Hades | 4 | 78 | within |
| 3 | Hephaestus | 4 | 83 | within |
| 3 | Hera | 4 | 82 | within |
| 3 | Hermes | 4 | 87 | within |
| 3 | Poseidon | 4 | 84 | within |
| 3 | Zeus | 4 | 77 | within |

## Practices

| Episode | Threads | Ended | Open | Refused or breached | No progress | Obligated turns |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 1 | 0 | 0 | 0 | 1 |
| 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| 3 | 0 | 0 | 0 | 0 | 0 | 0 |

## Model runs

| Episode | Requests | Exhausted | Degraded polls | Latency p50 / p95 | Properties |
| --- | --- | --- | --- | --- | --- |
| 1 | 34 | 11 | 28% | 7908 / 16783 ms | 11 of 15 held |
| 2 | 28 | 10 | 35% | 7913 / 19012 ms | 11 of 15 held |
| 3 | 28 | 13 | 45% | 10002 / 15636 ms | 12 of 15 held |

## Transcripts

- [episode-1.md](episode-1.md)
- [episode-2.md](episode-2.md)
- [episode-3.md](episode-3.md)

## Owner

Scores are in each transcript's rubric. The owner scores; the tool never does.

Decision: continue / tune / replan: 
