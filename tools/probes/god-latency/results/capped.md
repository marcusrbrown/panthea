# Capped god requests on granite3.3-8b-4k (Ollama 0.34.4, thinking off, the god's schema as `format`)

Cold requests: 21; at or under 3000 real tokens: 21; over: 0. Real/estimated tokens: worst 0.94, median 0.91, best 0.85.

| Request | Chars | Estimated | Real (cold) | Real / estimated | Repeat (cold) | Wall (cold) |
| --- | --- | --- | --- | --- | --- | --- |
| aged/athena | 8539 | 2997 | 2687 | 0.90 |  | 18.3 s |
| aged/hades | 5546 | 1946 | 1678 | 0.86 |  | 14.6 s |
| aged/hephaestus | 7279 | 2555 | 2364 | 0.93 |  | 15.4 s |
| aged/hera | 8362 | 2935 | 2598 | 0.89 |  | 16.4 s |
| aged/hermes | 7051 | 2475 | 2281 | 0.92 |  | 14.8 s |
| aged/poseidon | 8546 | 2999 | 2747 | 0.92 |  | 19.9 s |
| aged/zeus | 6991 | 2453 | 2087 | 0.85 |  | 15.3 s |
| crowded/athena | 8548 | 3000 | 2722 | 0.91 | 2722 | 18.8 s |
| crowded/hades | 8498 | 2982 | 2768 | 0.93 |  | 21.0 s |
| crowded/hephaestus | 8547 | 2999 | 2693 | 0.90 | 2693 | 21.2 s |
| crowded/hera | 8525 | 2992 | 2728 | 0.91 | 2728 | 20.3 s |
| crowded/hermes | 8525 | 2992 | 2760 | 0.92 | 2760 | 21.2 s |
| crowded/poseidon | 8541 | 2997 | 2791 | 0.93 |  | 22.6 s |
| crowded/zeus | 8517 | 2989 | 2652 | 0.89 |  | 20.5 s |
| heavy/athena | 8514 | 2988 | 2712 | 0.91 |  | 23.0 s |
| heavy/hades | 8548 | 3000 | 2808 | 0.94 | 2808 | 25.3 s |
| heavy/hephaestus | 8511 | 2987 | 2654 | 0.89 |  | 20.8 s |
| heavy/hera | 8514 | 2988 | 2751 | 0.92 |  | 21.3 s |
| heavy/hermes | 8507 | 2985 | 2783 | 0.93 |  | 24.5 s |
| heavy/poseidon | 8550 | 3000 | 2816 | 0.94 | 2816 | 22.7 s |
| heavy/zeus | 8533 | 2995 | 2646 | 0.88 | 2646 | 22.6 s |

Cache check (busiest request per god, cold then resent with the model loaded):

| God | Cold count | Resent count |
| --- | --- | --- |
| athena | 2722 | 2722 |
| hades | 2808 | 2808 |
| hephaestus | 2693 | 2693 |
| hera | 2728 | 2728 |
| hermes | 2760 | 2760 |
| poseidon | 2816 | 2816 |
| zeus | 2646 | 2646 |

Native `/api/chat` count 2722; `/v1/chat/completions` `usage.prompt_tokens` 2722 for the same request.

Identical-repeat rotation (63 requests, 3 rounds per world, each god's request resent unchanged, sequential in the service's god order; an upper bound on what a cache saves): wall median 5.1 s, p95 20.4 s; prefill median 0.1 s, p95 18.8 s; prompt tokens the server read median 2712, max 2816.

Live rotation (the tick moves on every round; sequential in the service's god order):

| Requests | n | Wall p50 / p95 | Prefill p50 / p95 | Tokens p50 | Tokens max |
| --- | --- | --- | --- | --- | --- |
| round 0 (after a wipe) | 21 | 15.2 s / 18.9 s | 11.9 s / 13.4 s | 2712 | 2816 |
| steady (rounds 1 on) | 63 | 11.0 s / 14.8 s | 6.9 s / 9.6 s | 2712 | 2816 |
| all | 84 | 12.1 s / 16.7 s | 7.5 s / 12.4 s | 2712 | 2816 |
