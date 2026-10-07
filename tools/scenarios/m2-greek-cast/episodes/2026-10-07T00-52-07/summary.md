# M2 experience gate

- Requirements: O08
- Model: qwen3-8b-4k through local Ollama, 4K context, reasoning off (reasoning_effort none)
- 3 episodes of 300 s, each a fresh world from the initial authored Greek state; no fixtures, no seeds
- dispositions: travel 63 × committed, practice 6 × committed, bless 1 × committed, strike 1 × committed, bless 1 × malformed
- journeys: 63 started: 63 arrived, 0 refused, 0 replaced, 0 still travelling

## Automated checks

| Episode | God | Committed actions | Longest run | Told beliefs and feelings caused | Goals set / ended | Petitions heard / answered | Goal changes refused | Checks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Athena | 3 (0 ability, 3 context) | 1 | 0 | 0 / 0 | 4 / 0 | 0 | FAIL: minimum activity, influence, petition answered |
| 1 | Hades | 4 (0 ability, 4 context) | 1 | 0 | 0 / 0 | 1 / 0 | 0 | FAIL: minimum activity, influence |
| 1 | Hephaestus | 2 (0 ability, 2 context) | 1 | 0 | 0 / 0 | 0 / 0 | 0 | FAIL: minimum activity, influence, petition heard, petition answered |
| 1 | Hera | 4 (0 ability, 4 context) | 1 | 0 | 0 / 0 | 3 / 0 | 0 | FAIL: minimum activity, influence, petition answered |
| 1 | Hermes | 4 (0 ability, 4 context) | 1 | 0 | 0 / 0 | 9 / 0 | 0 | FAIL: minimum activity, influence, petition answered |
| 1 | Poseidon | 6 (0 ability, 6 context) | 1 | 0 | 0 / 0 | 7 / 0 | 0 | FAIL: influence, petition answered |
| 1 | Zeus | 3 (0 ability, 3 context) | 1 | 0 | 0 / 0 | 2 / 0 | 0 | FAIL: minimum activity, influence, petition answered |
| 2 | Athena | 4 (0 ability, 4 context) | 1 | 0 | 0 / 0 | 6 / 0 | 0 | FAIL: minimum activity, influence, petition answered |
| 2 | Hades | 4 (0 ability, 4 context) | 1 | 0 | 0 / 0 | 1 / 0 | 0 | FAIL: minimum activity, influence |
| 2 | Hephaestus | 1 (0 ability, 1 context) | 1 | 0 | 0 / 0 | 0 / 0 | 0 | FAIL: minimum activity, influence, petition heard, petition answered |
| 2 | Hera | 4 (1 ability, 3 context) | 1 | 1 | 0 / 0 | 4 / 1 | 0 | FAIL: minimum activity |
| 2 | Hermes | 4 (0 ability, 4 context) | 1 | 0 | 0 / 0 | 11 / 0 | 0 | FAIL: minimum activity, influence, petition answered |
| 2 | Poseidon | 3 (0 ability, 3 context) | 1 | 0 | 0 / 0 | 9 / 0 | 0 | FAIL: minimum activity, influence, petition answered |
| 2 | Zeus | 4 (0 ability, 4 context) | 1 | 1 | 0 / 0 | 5 / 1 | 0 | FAIL: minimum activity |
| 3 | Athena | 1 (0 ability, 1 context) | 1 | 0 | 0 / 0 | 10 / 0 | 0 | FAIL: minimum activity, influence, petition answered |
| 3 | Hades | 4 (0 ability, 4 context) | 1 | 0 | 0 / 0 | 0 / 0 | 0 | FAIL: minimum activity, influence, petition heard |
| 3 | Hephaestus | 2 (0 ability, 2 context) | 1 | 0 | 0 / 0 | 2 / 0 | 0 | FAIL: minimum activity, influence, petition answered |
| 3 | Hera | 4 (0 ability, 4 context) | 1 | 0 | 0 / 0 | 6 / 0 | 0 | FAIL: minimum activity, influence, petition answered |
| 3 | Hermes | 3 (0 ability, 3 context) | 1 | 0 | 0 / 0 | 10 / 0 | 0 | FAIL: minimum activity, influence, petition answered |
| 3 | Poseidon | 3 (0 ability, 3 context) | 1 | 0 | 0 / 0 | 10 / 0 | 0 | FAIL: minimum activity, influence, petition answered |
| 3 | Zeus | 4 (0 ability, 4 context) | 1 | 0 | 0 / 0 | 5 / 0 | 0 | FAIL: minimum activity, influence, petition answered |

Automated checks failed:

- episode 1: food prayer share (15 of 26 prayers are about food (fewer than half))
- episode 1, Athena: minimum activity (3 committed model actions (at least 5))
- episode 1, Athena: influence (no told belief or relationship change traces to this god's proposals)
- episode 1, Athena: petition answered (4 heard, none answered (at least 1))
- episode 1, Hades: minimum activity (4 committed model actions (at least 5))
- episode 1, Hades: influence (no told belief or relationship change traces to this god's proposals)
- episode 1, Hephaestus: minimum activity (2 committed model actions (at least 5))
- episode 1, Hephaestus: influence (no told belief or relationship change traces to this god's proposals)
- episode 1, Hephaestus: petition heard (no petition was addressed to this god (at least 1))
- episode 1, Hephaestus: petition answered (0 heard, none answered (at least 1))
- episode 1, Hera: minimum activity (4 committed model actions (at least 5))
- episode 1, Hera: influence (no told belief or relationship change traces to this god's proposals)
- episode 1, Hera: petition answered (3 heard, none answered (at least 1))
- episode 1, Hermes: minimum activity (4 committed model actions (at least 5))
- episode 1, Hermes: influence (no told belief or relationship change traces to this god's proposals)
- episode 1, Hermes: petition answered (9 heard, none answered (at least 1))
- episode 1, Poseidon: influence (no told belief or relationship change traces to this god's proposals)
- episode 1, Poseidon: petition answered (7 heard, none answered (at least 1))
- episode 1, Zeus: minimum activity (3 committed model actions (at least 5))
- episode 1, Zeus: influence (no told belief or relationship change traces to this god's proposals)
- episode 1, Zeus: petition answered (2 heard, none answered (at least 1))
- episode 1, property god thread endings (athena: no thread ending it caused left a persistent consequence; hades: no thread ending it caused left a persistent consequence; hephaestus: no thread ending it caused left a persistent consequence; hera: no thread ending it caused left a persistent consequence; hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: no thread ending it caused left a persistent consequence)
- episode 1, property supplication and settlement (1 supplications, 0 settlements, 0 refused or breached)
- episode 1, property consequence changes a later choice (no thread ending left a consequence on a god)
- episode 2: food prayer share (18 of 36 prayers are about food (fewer than half))
- episode 2, Athena: minimum activity (4 committed model actions (at least 5))
- episode 2, Athena: influence (no told belief or relationship change traces to this god's proposals)
- episode 2, Athena: petition answered (6 heard, none answered (at least 1))
- episode 2, Hades: minimum activity (4 committed model actions (at least 5))
- episode 2, Hades: influence (no told belief or relationship change traces to this god's proposals)
- episode 2, Hephaestus: minimum activity (1 committed model actions (at least 5))
- episode 2, Hephaestus: influence (no told belief or relationship change traces to this god's proposals)
- episode 2, Hephaestus: petition heard (no petition was addressed to this god (at least 1))
- episode 2, Hephaestus: petition answered (0 heard, none answered (at least 1))
- episode 2, Hera: minimum activity (4 committed model actions (at least 5))
- episode 2, Hermes: minimum activity (4 committed model actions (at least 5))
- episode 2, Hermes: influence (no told belief or relationship change traces to this god's proposals)
- episode 2, Hermes: petition answered (11 heard, none answered (at least 1))
- episode 2, Poseidon: minimum activity (3 committed model actions (at least 5))
- episode 2, Poseidon: influence (no told belief or relationship change traces to this god's proposals)
- episode 2, Poseidon: petition answered (9 heard, none answered (at least 1))
- episode 2, Zeus: minimum activity (4 committed model actions (at least 5))
- episode 2, property god thread endings (athena: no thread ending it caused left a persistent consequence; hades: no thread ending it caused left a persistent consequence; hephaestus: no thread ending it caused left a persistent consequence; hera: no thread ending it caused left a persistent consequence; hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: 1 (fulfilled [evt-108-1944]))
- episode 2, property supplication and settlement (3 supplications, 0 settlements, 0 refused or breached)
- episode 3: food prayer share (22 of 43 prayers are about food (fewer than half))
- episode 3, Athena: minimum activity (1 committed model actions (at least 5))
- episode 3, Athena: influence (no told belief or relationship change traces to this god's proposals)
- episode 3, Athena: petition answered (10 heard, none answered (at least 1))
- episode 3, Hades: minimum activity (4 committed model actions (at least 5))
- episode 3, Hades: influence (no told belief or relationship change traces to this god's proposals)
- episode 3, Hades: petition heard (no petition was addressed to this god (at least 1))
- episode 3, Hephaestus: minimum activity (2 committed model actions (at least 5))
- episode 3, Hephaestus: influence (no told belief or relationship change traces to this god's proposals)
- episode 3, Hephaestus: petition answered (2 heard, none answered (at least 1))
- episode 3, Hera: minimum activity (4 committed model actions (at least 5))
- episode 3, Hera: influence (no told belief or relationship change traces to this god's proposals)
- episode 3, Hera: petition answered (6 heard, none answered (at least 1))
- episode 3, Hermes: minimum activity (3 committed model actions (at least 5))
- episode 3, Hermes: influence (no told belief or relationship change traces to this god's proposals)
- episode 3, Hermes: petition answered (10 heard, none answered (at least 1))
- episode 3, Poseidon: minimum activity (3 committed model actions (at least 5))
- episode 3, Poseidon: influence (no told belief or relationship change traces to this god's proposals)
- episode 3, Poseidon: petition answered (10 heard, none answered (at least 1))
- episode 3, Zeus: minimum activity (4 committed model actions (at least 5))
- episode 3, Zeus: influence (no told belief or relationship change traces to this god's proposals)
- episode 3, Zeus: petition answered (5 heard, none answered (at least 1))
- episode 3, property valid actions (0 not god actions (), 1 rejected as malformed)
- episode 3, property changed next action (no god both formed a belief or feeling and acted on either side of it)
- episode 3, property god thread endings (athena: no thread ending it caused left a persistent consequence; hades: no thread ending it caused left a persistent consequence; hephaestus: no thread ending it caused left a persistent consequence; hera: no thread ending it caused left a persistent consequence; hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: no thread ending it caused left a persistent consequence)
- episode 3, property supplication and settlement (2 supplications, 0 settlements, 0 refused or breached)
- episode 3, property consequence changes a later choice (no thread ending left a consequence on a god)

## Across the episodes

- PASS mortal wrong: 27 wrongs between mortals of different patrons, 20 prayed to the victim's patron, 5 with a consequence (punishment, revenge, or defection; at least 1)
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
| 1 | 69 (at most 250) | 15 / 26 | athena 3, hades 2, hephaestus 2, hera 2, hermes 2, poseidon 2, zeus 2 | 11 | 8 / 1 | 0 | 153 / 156 |
| 2 | 59 (at most 250) | 18 / 36 | athena 3, hades 2, hephaestus 2, hera 2, hermes 3, poseidon 2, zeus 2 | 10 | 10 / 2 | 0 | 153 / 156 |
| 3 | 65 (at most 250) | 22 / 43 | athena 3, hades 2, hephaestus 2, hera 2, hermes 2, poseidon 2, zeus 3 | 10 | 9 / 2 | 0 | 153 / 156 |

## Queue wait per god (p95 of the ticks between a god's requests; ADR-0005 allows 90 s)

| Episode | God | Turns | p95 wait (ticks) | Against the target |
| --- | --- | --- | --- | --- |
| 1 | Athena | 4 | 99 | over |
| 1 | Hades | 4 | 107 | over |
| 1 | Hephaestus | 4 | 112 | over |
| 1 | Hera | 4 | 111 | over |
| 1 | Hermes | 4 | 115 | over |
| 1 | Poseidon | 6 | 111 | over |
| 1 | Zeus | 3 | 91 | over |
| 2 | Athena | 5 | 77 | within |
| 2 | Hades | 4 | 76 | within |
| 2 | Hephaestus | 4 | 104 | over |
| 2 | Hera | 4 | 103 | over |
| 2 | Hermes | 4 | 107 | over |
| 2 | Poseidon | 3 | 89 | within |
| 2 | Zeus | 4 | 86 | within |
| 3 | Athena | 4 | 90 | within |
| 3 | Hades | 4 | 100 | over |
| 3 | Hephaestus | 4 | 100 | over |
| 3 | Hera | 4 | 107 | over |
| 3 | Hermes | 3 | 88 | within |
| 3 | Poseidon | 3 | 88 | within |
| 3 | Zeus | 5 | 73 | within |

## Practices

| Episode | Threads | Ended | Open | Refused or breached | No progress | Obligated turns |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 1 | 0 | 0 | 0 | 3 |
| 2 | 3 | 2 | 1 | 0 | 0 | 2 |
| 3 | 2 | 1 | 1 | 0 | 0 | 2 |

## Model runs

| Episode | Requests | Exhausted | Degraded polls | Latency p50 / p95 | Properties |
| --- | --- | --- | --- | --- | --- |
| 1 | 29 | 3 | 6% | 8284 / 18691 ms | 12 of 15 held |
| 2 | 28 | 4 | 12% | 9941 / 16608 ms | 13 of 15 held |
| 3 | 27 | 5 | 15% | 9574 / 15281 ms | 10 of 15 held |

## Transcripts

- [episode-1.md](episode-1.md)
- [episode-2.md](episode-2.md)
- [episode-3.md](episode-3.md)

## Owner

Scores are in each transcript's rubric. The owner scores; the tool never does.

Decision: continue / tune / replan: 
