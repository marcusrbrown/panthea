# God request cost: after-cold

24 requests on qwen3-8b-4k, 3 repetitions, ticks 300, 400, 500.

| Protocol | Requests | Prompt tokens (median) | Prefill median | Prefill p95 | Decode median | Reply tokens (median) | Load (max) | Wall median | Wall p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| first | 3 | 2499 | 17597 ms | 18467 ms | 1464 ms | 20 | 4415 ms | 23462 ms | 24402 ms |
| cold | 21 | 2206 | 14465 ms | 17417 ms | 3338 ms | 58 | 86 ms | 20621 ms | 31370 ms |

Characters every god's system text shares at its start, by tick (300, 400, 500): 1279, 1279, 1279, of system texts of about 5041, 5041, 5041. Characters the whole request (system and user) shares across all seven gods: 1279, 1279, 1279, of requests of about 8046, 8078, 8078 (Zeus's, for scale).
