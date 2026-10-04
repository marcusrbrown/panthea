# God request cost: after

62 requests on qwen3-8b-4k, 2 repetitions, ticks 300, 400, 500.

| Protocol | Requests | Prompt tokens (median) | Prefill median | Prefill p95 | Decode median | Reply tokens (median) | Load (max) | Wall median | Wall p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| resend-1 | 3 | 2439 | 12609 ms | 12750 ms | 2522 ms | 47 | 6 ms | 15165 ms | 15296 ms |
| resend-2 | 3 | 2439 | 58 ms | 60 ms | 3233 ms | 59 | 7 ms | 3316 ms | 3409 ms |
| rotation | 42 | 2162 | 7934 ms | 13902 ms | 2897 ms | 58 | 5779 ms | 11250 ms | 19897 ms |
| samegod-1 | 7 | 2144 | 8190 ms | 9514 ms | 4180 ms | 58 | 15 ms | 12001 ms | 15854 ms |
| samegod-2 | 7 | 2170 | 9070 ms | 11194 ms | 1449 ms | 20 | 14 ms | 11319 ms | 15702 ms |

Characters every god's system text shares at its start, by tick (300, 400, 500): 1279, 1279, 1279, of system texts of about 5041, 5041, 5041. Characters the whole request (system and user) shares across all seven gods: 1279, 1279, 1279, of requests of about 8046, 8078, 8078 (Zeus's, for scale).
