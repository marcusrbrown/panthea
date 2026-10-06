# M2 experience gate

- Requirements: O08
- Model: qwen3-8b-4k through local Ollama, 4K context, reasoning off (reasoning_effort none)
- 3 episodes of 300 s, each a fresh world from the initial authored Greek state; no fixtures, no seeds
- dispositions: travel 43 × committed, bless 26 × committed, practice 14 × committed, report 2 × committed, bless 1 × not-adjacent, practice 1 × insufficient-resources, bless 1 × malformed
- journeys: 43 started: 43 arrived, 0 refused, 0 replaced, 0 still travelling

## Automated checks

| Episode | God | Committed actions | Longest run | Told beliefs and feelings caused | Goals set / ended | Petitions heard / answered | Goal changes refused | Checks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Zeus | 3 (0 ability, 3 context) | 1 | 0 | 0 / 0 | 4 / 0 | 0 | FAIL: minimum activity, influence, goal set, goal ended, petition answered |
| 1 | Hera | 3 (0 ability, 3 context) | 1 | 0 | 0 / 0 | 4 / 1 | 0 | FAIL: minimum activity, influence, goal set, goal ended |
| 2 | Zeus | 3 (0 ability, 3 context) | 1 | 0 | 0 / 0 | 5 / 0 | 0 | FAIL: minimum activity, influence, goal set, goal ended, petition answered |
| 2 | Hera | 4 (0 ability, 4 context) | 1 | 0 | 0 / 0 | 5 / 1 | 0 | FAIL: minimum activity, influence, goal set, goal ended |
| 3 | Zeus | 4 (0 ability, 4 context) | 1 | 0 | 0 / 0 | 4 / 0 | 0 | FAIL: minimum activity, influence, goal set, goal ended, petition answered |
| 3 | Hera | 4 (0 ability, 4 context) | 1 | 0 | 0 / 0 | 5 / 1 | 0 | FAIL: minimum activity, influence, goal set, goal ended |

Automated checks failed:

- episode 1, Zeus: minimum activity (3 committed model actions (at least 5))
- episode 1, Zeus: influence (no told belief or relationship change traces to this god's proposals)
- episode 1, Zeus: goal set (0 goals set (at least 1))
- episode 1, Zeus: goal ended (no goal ended (at least 1, any outcome))
- episode 1, Zeus: petition answered (4 heard, none answered (at least 1))
- episode 1, Hera: minimum activity (3 committed model actions (at least 5))
- episode 1, Hera: influence (no told belief or relationship change traces to this god's proposals)
- episode 1, Hera: goal set (0 goals set (at least 1))
- episode 1, Hera: goal ended (no goal ended (at least 1, any outcome))
- episode 1, property god thread endings (athena: no thread ending it caused left a persistent consequence; hades: no thread ending it caused left a persistent consequence; hephaestus: 1 (fulfilled [evt-24-614]); hera: no thread ending it caused left a persistent consequence; hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: no thread ending it caused left a persistent consequence)
- episode 1, property supplication and settlement (5 supplications, 0 settlements, 0 refused or breached)
- episode 1, property consequence changes a later choice (hephaestus: bless: before the consequence, bless: after (same); the prompt behind it showed how the thread ended)
- episode 2, Zeus: minimum activity (3 committed model actions (at least 5))
- episode 2, Zeus: influence (no told belief or relationship change traces to this god's proposals)
- episode 2, Zeus: goal set (0 goals set (at least 1))
- episode 2, Zeus: goal ended (no goal ended (at least 1, any outcome))
- episode 2, Zeus: petition answered (5 heard, none answered (at least 1))
- episode 2, Hera: minimum activity (4 committed model actions (at least 5))
- episode 2, Hera: influence (no told belief or relationship change traces to this god's proposals)
- episode 2, Hera: goal set (0 goals set (at least 1))
- episode 2, Hera: goal ended (no goal ended (at least 1, any outcome))
- episode 2, property valid actions (0 not god actions (), 1 rejected as malformed)
- episode 2, property god thread endings (athena: no thread ending it caused left a persistent consequence; hades: 2 (fulfilled [evt-151-3904], fulfilled [evt-222-5652]); hephaestus: 1 (fulfilled [evt-22-567]); hera: no thread ending it caused left a persistent consequence; hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: no thread ending it caused left a persistent consequence)
- episode 2, property supplication and settlement (4 supplications, 0 settlements, 0 refused or breached)
- episode 3, Zeus: minimum activity (4 committed model actions (at least 5))
- episode 3, Zeus: influence (no told belief or relationship change traces to this god's proposals)
- episode 3, Zeus: goal set (0 goals set (at least 1))
- episode 3, Zeus: goal ended (no goal ended (at least 1, any outcome))
- episode 3, Zeus: petition answered (4 heard, none answered (at least 1))
- episode 3, Hera: minimum activity (4 committed model actions (at least 5))
- episode 3, Hera: influence (no told belief or relationship change traces to this god's proposals)
- episode 3, Hera: goal set (0 goals set (at least 1))
- episode 3, Hera: goal ended (no goal ended (at least 1, any outcome))
- episode 3, property god thread endings (athena: no thread ending it caused left a persistent consequence; hades: 2 (fulfilled [evt-91-2393], fulfilled [evt-229-5910]); hephaestus: 1 (fulfilled [evt-28-731]); hera: no thread ending it caused left a persistent consequence; hermes: no thread ending it caused left a persistent consequence; poseidon: 1 (fulfilled [evt-140-3637]); zeus: no thread ending it caused left a persistent consequence)
- episode 3, property supplication and settlement (5 supplications, 0 settlements, 0 refused or breached)

## Practices

| Episode | Threads | Ended | Open | Refused or breached | No progress | Obligated turns |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 5 | 4 | 1 | 0 | 0 | 5 |
| 2 | 4 | 3 | 1 | 0 | 0 | 4 |
| 3 | 5 | 5 | 0 | 0 | 0 | 7 |

## Model runs

| Episode | Requests | Exhausted | Degraded polls | Latency p50 / p95 | Properties |
| --- | --- | --- | --- | --- | --- |
| 1 | 25 | 1 | 2% | 10719 / 18664 ms | 12 of 15 held |
| 2 | 32 | 1 | 1% | 9106 / 11137 ms | 12 of 15 held |
| 3 | 34 | 1 | 2% | 8404 / 11473 ms | 13 of 15 held |

## Transcripts

- [episode-1.md](episode-1.md)
- [episode-2.md](episode-2.md)
- [episode-3.md](episode-3.md)

## Owner

Scores are in each transcript's rubric. The owner scores; the tool never does.

Decision: continue / tune / replan: 
