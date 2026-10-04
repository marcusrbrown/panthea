# God request cost: before-cold

24 requests on qwen3-8b-4k, 3 repetitions, ticks 300, 400, 500.

| Protocol | Requests | Prompt tokens (median) | Prefill median | Prefill p95 | Decode median | Reply tokens (median) | Load (max) | Wall median | Wall p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| first | 3 | 2497 | 18189 ms | 19743 ms | 4289 ms | 55 | 4650 ms | 25231 ms | 27960 ms |
| cold | 21 | 2203 | 15340 ms | 18115 ms | 4235 ms | 59 | 17 ms | 19671 ms | 22883 ms |

Characters every god's system text shares at its start, by tick (300, 400, 500): 8, 8, 8, of system texts of about 5041, 5041, 5041. Characters the whole request (system and user) shares across all seven gods: 8, 8, 8, of requests of about 8046, 8078, 8078 (Zeus's, for scale).
