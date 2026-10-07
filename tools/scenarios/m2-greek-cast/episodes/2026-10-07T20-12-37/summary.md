# M2 experience gate

- Requirements: O08
- Model: granite3.3-8b-4k through local Ollama, 4K context, reasoning off (reasoning_effort none)
- 3 episodes of 300 s, each a fresh world from the initial authored Greek state; no fixtures, no seeds
- dispositions: bless 64 × committed, legend 9 × committed, practice 9 × committed, report 7 × committed, strike 7 × committed, travel 2 × committed, strike 2 × stale-target, refuse 1 × committed, practice 1 × insufficient-resources
- journeys: 2 started: 2 arrived, 0 refused, 0 replaced, 0 still travelling

## Automated checks

| Episode | God | Committed actions | Longest run | Told beliefs and feelings caused | Goals set / ended | Petitions heard / answered | Goal changes refused | Checks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Athena | 5 (5 ability, 0 context) | 1 | 8 | 0 / 0 | 21 / 4 | 0 | pass |
| 1 | Hades | 5 (2 ability, 3 context) | 1 | 2 | 0 / 0 | 3 / 2 | 0 | pass |
| 1 | Hephaestus | 4 (3 ability, 1 context) | 1 | 7 | 0 / 0 | 5 / 2 | 0 | FAIL: minimum activity |
| 1 | Hera | 6 (1 ability, 5 context) | 1 | 4 | 0 / 0 | 7 / 4 | 0 | pass |
| 1 | Hermes | 4 (4 ability, 0 context) | 1 | 4 | 0 / 0 | 10 / 4 | 0 | FAIL: minimum activity |
| 1 | Poseidon | 4 (0 ability, 4 context) | 1 | 4 | 0 / 0 | 20 / 4 | 0 | FAIL: minimum activity |
| 1 | Zeus | 4 (0 ability, 4 context) | 1 | 4 | 0 / 0 | 6 / 3 | 0 | FAIL: minimum activity |
| 2 | Athena | 5 (5 ability, 0 context) | 1 | 8 | 0 / 0 | 16 / 4 | 0 | pass |
| 2 | Hades | 5 (0 ability, 5 context) | 1 | 4 | 0 / 0 | 3 / 3 | 0 | pass |
| 2 | Hephaestus | 5 (5 ability, 0 context) | 3 | 12 | 0 / 0 | 3 / 2 | 0 | pass |
| 2 | Hera | 5 (0 ability, 5 context) | 1 | 3 | 0 / 0 | 7 / 2 | 0 | pass |
| 2 | Hermes | 4 (4 ability, 0 context) | 1 | 4 | 0 / 0 | 16 / 4 | 0 | FAIL: minimum activity |
| 2 | Poseidon | 5 (0 ability, 5 context) | 1 | 4 | 0 / 0 | 16 / 4 | 0 | pass |
| 2 | Zeus | 5 (1 ability, 4 context) | 1 | 3 | 0 / 0 | 4 / 2 | 0 | pass |
| 3 | Athena | 5 (5 ability, 0 context) | 1 | 8 | 0 / 0 | 17 / 4 | 0 | pass |
| 3 | Hades | 3 (0 ability, 3 context) | 1 | 2 | 0 / 0 | 4 / 2 | 0 | FAIL: minimum activity |
| 3 | Hephaestus | 5 (4 ability, 1 context) | 1 | 4 | 0 / 0 | 3 / 3 | 0 | pass |
| 3 | Hera | 7 (2 ability, 5 context) | 1 | 5 | 0 / 0 | 5 / 4 | 0 | pass |
| 3 | Hermes | 5 (5 ability, 0 context) | 1 | 5 | 0 / 0 | 11 / 5 | 0 | pass |
| 3 | Poseidon | 4 (1 ability, 3 context) | 1 | 4 | 0 / 0 | 15 / 4 | 0 | FAIL: minimum activity |
| 3 | Zeus | 4 (1 ability, 3 context) | 1 | 4 | 0 / 0 | 5 / 4 | 0 | FAIL: minimum activity |

Automated checks failed:

- episode 1, Hephaestus: minimum activity (4 committed model actions (at least 5))
- episode 1, Hermes: minimum activity (4 committed model actions (at least 5))
- episode 1, Poseidon: minimum activity (4 committed model actions (at least 5))
- episode 1, Zeus: minimum activity (4 committed model actions (at least 5))
- episode 1, property god thread endings (athena: no thread ending it caused left a persistent consequence; hades: 1 (fulfilled [evt-224-5673]); hephaestus: no thread ending it caused left a persistent consequence; hera: 2 (fulfilled [evt-41-928], fulfilled [evt-170-4289]); hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: no thread ending it caused left a persistent consequence)
- episode 1, property supplication and settlement (3 supplications, 0 settlements, 0 refused or breached)
- episode 1, property consequence changes a later choice (hades: a consequence at 6217, but no committed action on both sides of it; hera: bless: before the consequence, bless: after (same); the prompt behind it showed how the thread ended)
- episode 2, Hermes: minimum activity (4 committed model actions (at least 5))
- episode 2, property god thread endings (athena: no thread ending it caused left a persistent consequence; hades: no thread ending it caused left a persistent consequence; hephaestus: no thread ending it caused left a persistent consequence; hera: 1 (fulfilled [evt-22-509]); hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: 1 (fulfilled [evt-173-4514]))
- episode 2, property supplication and settlement (4 supplications, 0 settlements, 0 refused or breached)
- episode 2, property consequence changes a later choice (hera: bless: before the consequence, bless: after (same); the prompt behind it showed how the thread ended; zeus: a consequence at 6894, but no committed action on both sides of it)
- episode 3, Hades: minimum activity (3 committed model actions (at least 5))
- episode 3, Poseidon: minimum activity (4 committed model actions (at least 5))
- episode 3, Zeus: minimum activity (4 committed model actions (at least 5))
- episode 3, property god thread endings (athena: no thread ending it caused left a persistent consequence; hades: no thread ending it caused left a persistent consequence; hephaestus: no thread ending it caused left a persistent consequence; hera: 2 (fulfilled [evt-20-473], fulfilled [evt-209-5501]); hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: no thread ending it caused left a persistent consequence)
- episode 3, property supplication and settlement (2 supplications, 0 settlements, 0 refused or breached)

## Across the episodes

- PASS mortal wrong: 33 wrongs between mortals of different patrons, 28 prayed to the victim's patron, 9 with a consequence (punishment, revenge, or defection; at least 1)
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
| 1 | 86 (at most 250) | 22 / 72 | athena 3, hades 3, hephaestus 2, hera 2, hermes 2, poseidon 2, zeus 3 | 14 | 12 / 2 | 2 | 72 / 159 |
| 2 | 103 (at most 250) | 22 / 65 | athena 3, hades 3, hephaestus 2, hera 2, hermes 2, poseidon 2, zeus 2 | 13 | 12 / 3 | 1 | 109 / 167 |
| 3 | 85 (at most 250) | 21 / 60 | athena 3, hades 3, hephaestus 2, hera 2, hermes 2, poseidon 2, zeus 2 | 12 | 9 / 4 | 3 | 81 / 153 |

## Queue wait per god (p95 of the ticks between a god's requests; ADR-0005 allows 90 s)

| Episode | God | Turns | p95 wait (ticks) | Against the target |
| --- | --- | --- | --- | --- |
| 1 | Athena | 5 | 79 | within |
| 1 | Hades | 5 | 75 | within |
| 1 | Hephaestus | 4 | 76 | within |
| 1 | Hera | 6 | 74 | within |
| 1 | Hermes | 4 | 71 | within |
| 1 | Poseidon | 4 | 76 | within |
| 1 | Zeus | 4 | 78 | within |
| 2 | Athena | 5 | 73 | within |
| 2 | Hades | 5 | 73 | within |
| 2 | Hephaestus | 5 | 73 | within |
| 2 | Hera | 6 | 74 | within |
| 2 | Hermes | 4 | 78 | within |
| 2 | Poseidon | 5 | 78 | within |
| 2 | Zeus | 6 | 63 | within |
| 3 | Athena | 5 | 75 | within |
| 3 | Hades | 5 | 74 | within |
| 3 | Hephaestus | 5 | 76 | within |
| 3 | Hera | 7 | 71 | within |
| 3 | Hermes | 5 | 74 | within |
| 3 | Poseidon | 4 | 79 | within |
| 3 | Zeus | 4 | 77 | within |

## Practices

| Episode | Threads | Ended | Open | Refused or breached | No progress | Obligated turns |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 3 | 3 | 0 | 0 | 0 | 3 |
| 2 | 4 | 3 | 1 | 0 | 0 | 7 |
| 3 | 2 | 2 | 0 | 0 | 0 | 2 |

## Model runs

| Episode | Requests | Exhausted | Degraded polls | Latency p50 / p95 | Properties |
| --- | --- | --- | --- | --- | --- |
| 1 | 32 | 0 | 0% | 8090 / 12804 ms | 12 of 15 held |
| 2 | 36 | 0 | 0% | 7147 / 11806 ms | 12 of 15 held |
| 3 | 35 | 1 | 3% | 7364 / 12534 ms | 13 of 15 held |

## Transcripts

- [episode-1.md](episode-1.md)
- [episode-2.md](episode-2.md)
- [episode-3.md](episode-3.md)

## Owner

Scores are in each transcript's rubric. The owner scores; the tool never does.

Decision: continue / tune / replan: 
