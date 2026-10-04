# God request cost: before-clean

62 requests on qwen3-8b-4k, 2 repetitions, ticks 300, 400, 500.

| Protocol | Requests | Prompt tokens (median) | Prefill median | Prefill p95 | Decode median | Reply tokens (median) | Load (max) | Wall median | Wall p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| resend-1 | 3 | 2439 | 10784 ms | 12565 ms | 4591 ms | 59 | 16 ms | 16328 ms | 24385 ms |
| resend-2 | 3 | 2439 | 67 ms | 74 ms | 3206 ms | 47 | 41 ms | 4452 ms | 9970 ms |
| rotation | 42 | 2162 | 9032 ms | 11318 ms | 3505 ms | 59 | 66 ms | 13033 ms | 16260 ms |
| samegod-1 | 7 | 2144 | 5422 ms | 10150 ms | 3791 ms | 59 | 5 ms | 10492 ms | 14991 ms |
| samegod-2 | 7 | 2170 | 9430 ms | 13457 ms | 3629 ms | 59 | 41 ms | 14323 ms | 16818 ms |

Characters every god's system text shares at its start, by tick (300, 400, 500): 8, 8, 8, of system texts of about 5041, 5041, 5041. Characters the whole request (system and user) shares across all seven gods: 8, 8, 8, of requests of about 8046, 8078, 8078 (Zeus's, for scale).
