## Question

Which locally-servable model, quantization, and context size meet the acceptance plan's 10s-first-reply / 30s-p95-completion model-feedback target on the M1 Pro 16GB baseline with the renderer scene running concurrently, and what reasoning-turn cadence does that support for 7 gods + 20 inhabitants?

## How to run

**Staging (prerequisite, not timed):**

```sh
ollama serve &                      # native /api/chat on :11434
ollama pull <model>                  # e.g. qwen3.5:2b-q4_K_M
```

**Production routing model (M2):** the M2 local baseline is granite3.3 8B at a 4K context (owner, 2026-10-07; run it with `reasoning_effort` none), so the gate harness defaults to `granite3.3-8b-4k`. Create it once (it needs `ollama pull granite3.3:8b` first):

```sh
ollama pull granite3.3:8b
ollama create granite3.3-8b-4k -f tools/probes/inference-baseline/Modelfile.granite3.3-8b-4k
```

qwen3 8B at 4K (`Modelfile.qwen3-8b-4k`) was the baseline from 2026-10-02.

The router's live integration test still uses the 4K-context derivative of `llama3.2:3b` that M0 measured, so it stays fast; create it once (it needs `ollama pull llama3.2:3b` first):

```sh
ollama create llama3.2-3b-4k -f tools/probes/inference-baseline/Modelfile.llama3.2-3b-4k
```

llama-server (cross-server check, one GGUF): download the pinned `ggml-org/llama.cpp` release into `tools/probes/inference-baseline/bin/` (gitignored; identifier + sha256 recorded below), find the candidate's GGUF blob via `ollama show <model> --modelfile` (its `FROM` line), then:

```sh
./bin/llama-server --model <blob-path> --port 8090 -c 4096
```

Renderer concurrency: launch the already ad-hoc-signed packaged app directly (not via `open`, so stdout is capturable) and keep it running for every suite/parallel/outage invocation below:

```sh
/tmp/PantheaProbe/panthea-probe-renderer.app/Contents/MacOS/panthea-probe-renderer > /tmp/panthea-probe-renderer.stdout.log 2>&1 &
```

**Suite** (per model × context tier):

```sh
cd tools/probes/inference-baseline
bun run src/run.ts suite --server ollama --base-url http://localhost:11434 \
  --model <model> --tier 1k --max-tokens 150 --timeout-ms 30000 \
  --repair-audit 8 --rss-pid <ollama-serve-pid> --renderer-log /tmp/panthea-probe-renderer.stdout.log \
  --label <model>-1k
```

`--rss-pid` for `--server ollama` is the `ollama serve` supervisor's own pid (`pgrep -f 'ollama serve'`, or whatever your shell already has from starting it) — the sampler auto-resolves and re-resolves its actual `llama-server` runner child every poll tick (a new pid each time a model loads; see servers.ts's doc comment on `findOllamaRunnerPids`/`resolveRssPids`), summing the whole child tree if the runner isn't the only child or is named differently. For `--server llama-server`, pass that process's own pid directly (it holds the weights itself, no child to resolve). Reasoning-capable models (Qwen3.5) default to hidden `<think>` tokens that can consume the whole `--max-tokens` budget before any action JSON is emitted — this probe's Ollama adapter always sends `think: false` (see servers.ts) for that reason.

**Parallel**: `bun run src/run.ts parallel --server ollama --base-url ... --model <best> --tier 4k --concurrency 2 --sample-count 20 --rss-pid <ollama-serve-pid> --label <best>-parallel2` (compare against a `--concurrency 1` run of the same sample).

**Outage**: `bun run src/run.ts outage --server ollama --base-url ... --model <model> --kill-pid <ollama-serve-pid> --kill-after 2 --request-count 5 --label <model>-outage` — sends SIGTERM to the server after 2 completed requests and confirms the remaining requests resolve as a clean timeout/error, not a bench crash.

**Report**: `bun run src/run.ts report` — renders this README from raw `results/*.json` records when present (and regenerates the committed `results/summary.json` published aggregate to match); on a fresh checkout with no raw records, renders from that committed aggregate instead and leaves it untouched; with neither present, exits non-zero and writes nothing. `results/summary.json` publishes already-computed rates/percentiles/counts, not the raw per-prompt samples they were computed from — it lets this README's numbers survive without every gitignored raw record, not independent recomputation from scratch.

## Caveat

Candidate substitutions from the plan's named models: no `qwen3.5` 4B tier exists on the Ollama library (available sizes are 0.8B/2B/27B/35B/122B) — substituted `qwen3.5:2b-q4_K_M`, the nearest smaller tier. Gemma 4 exists on Ollama (`gemma4:e4b`, benched here — an owner correction of this probe's earlier claim that no Gemma 4 family existed); `gemma3n:e4b` was benched first as a substitute under that mistaken assumption and is retained below since it's still valid measured data, not because it's still needed as a stand-in. `ministral-3:8b-instruct-2512-q4_K_M`, `phi4-mini:3.8b`, and `llama3.2:3b` match the plan exactly. Ollama results use its native `/api/chat` endpoint, not `/v1/chat/completions` — the OpenAI-compatible endpoint has no per-request context-size control (Ollama's own docs: changing context size requires a Modelfile-derived model), while the native endpoint accepts `options.num_ctx` per request and the identical JSON Schema object via `format` that `response_format.json_schema.schema` would carry on the OpenAI-compatible endpoint. Only the transport differs; schema comparability with llama-server and Unit 6's future hosted adapters is unaffected. Renderer concurrency: `apps/probe-renderer`'s packaged `.app` (already ad-hoc signed by Unit 2) run directly (not via `open`, so its stdout is capturable), with its frame-time metrics dump (`d` keystroke, sent via `osascript`/System Events) sampled before and after each suite run — not continuously during — because a continuous automated-keystroke sampler would itself compete for the same CPU the renderer's animation loop runs on. This machine was not a clean, dedicated 16GB baseline during this run: a co-resident `qemu-system-aarch64` process held ~7.4GB RSS and overall swap usage measured ~6.9GB/8GB at the start of staging, which is real contention this run's absolute latency/RSS numbers reflect (a conservative, not best-case, reading) but also a confound against a truly idle-machine baseline. RSS sampling bug found mid-run, since fixed: `ollama serve`'s own process never holds model weights — it spawns a separate `llama-server` runner child (a new pid, per loaded model) that actually holds them. The five-candidate matrix below predates the fix and sampled the supervisor's pid, so its recorded 'RSS peak' was the harness's own idle footprint (tens of MB), not the model's; it instead shows on-disk model size (†) as a lower-bound proxy (weights only, no KV cache or activation overhead, so the true resident figure is higher, especially at 4K context). The harness (`resolveRssPids`/`findOllamaRunnerPids` in run.ts) now auto-resolves and re-resolves the actual runner child pid on every poll tick, re-sampling it fresh each time since a model reload spawns a new one; the recommended baseline profile below, and the parallel/outage runs, were re-measured with the fix and carry a real runner RSS figure, not a proxy. The repaired-validity column is an 8-of-40-prompt audit sample of the prompt-only (no `format`/`response_format`) fallback path, not a full second 40-prompt pass per model×context — doubling the matrix to characterize a path this probe's servers don't actually need (both support native JSON Schema) wasn't a proportionate use of this run's time budget. The recommended baseline profile's own renderer frame p95 sample is unavailable: the `d`-keystroke dump (both the `osascript`/System Events path and a `cliclick` fallback were tried) never reached the packaged renderer app during its re-measurement run — `osascript` reported success and the process was visible to System Events, but `count windows` returned 0 and a full-screen capture showed no windows at all, consistent with `renderer-webgl2/README.md`'s documented finding that this machine's screen/window server is shared with other concurrent automated sessions and window visibility isn't reliably controllable here. Citing the other candidate suites' renderer frame p95 instead, since the signal is driven by the renderer app itself and shouldn't materially differ by which local model is running alongside it: the other suites in the matrix measured **17–18ms** (12 suites).

## Environment

| Field | Value |
| --- | --- |
| Hardware | Apple M1 Pro |
| Memory | 17179869184 |
| OS | macOS 15.7.9 (24G830) |
| Bun | 1.4.2 |
| Tauri | 2.12.0 |
| Three.js | 0.185.1 |
| Three Flatland | 0.1.0-alpha.10 |
| ollama | 0.34.4 |
| llama-server release | b11205 (ggml-org/llama.cpp, macos-arm64) |
| llama-server sha256 | 97b06f59ad15e2b4b6044ba7338c4e3f40354c6dc2b9c5cda234e2bd6b9fd65e |

## Results

#### Per-model × context matrix

| Model | Server | Context | Native valid | Kind-acceptable | Repaired valid (audit) | TTFT p50/p95 (ms) | Completion p50/p95 (ms) | tok/s p50 | Server RSS peak | Renderer frame p95 (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| llama3.2-3b.gguf | llama-server | 4k | 100% | 83% | 13% | 151/206 | 721/1363 | 46.6 | 2831 MiB | 17 |
| phi4-mini:3.8b | ollama | 4k | 100% | 68% | 0% | 225/235 | 807/2248 | 39.3 | 2384 MiB (disk size†) | 17 |
| llama3.2:3b | ollama | 1k | 98% | 50% | 13% | 886/1713 | 1815/2920 | 46.2 | 1907 MiB (disk size†) | 17 |
| ministral-3:8b-instruct-2512-q4_K_M | ollama | 4k | 100% | 85% | 13% | 433/594 | 4310/7647 | 17.4 | 5722 MiB (disk size†) | 17 |
| ministral-3:8b-instruct-2512-q4_K_M | ollama | 1k | 100% | 93% | 13% | 333/466 | 3796/5309 | 21.5 | 5722 MiB (disk size†) | 17 |
| phi4-mini:3.8b | ollama | 1k | 38% | 20% | 0% | 2001/2056 | 4875/6575 | 36.9 | 2384 MiB (disk size†) | 17 |
| llama3.2:3b | ollama | 4k | 100% | 83% | 13% | 155/210 | 706/1538 | 46.3 | 2783 MiB | n/a |
| gemma3n:e4b-it-q4_K_M | ollama | 4k | 100% | 43% | 0% | 6318/8272 | 7686/12938 | 23.1 | 7153 MiB (disk size†) | 17 |
| qwen3.5:2b-q4_K_M | ollama | 4k | 100% | 57% | 13% | 597/641 | 1268/1926 | 58.9 | 1812 MiB (disk size†) | 17 |
| gemma3n:e4b-it-q4_K_M | ollama | 1k | 88% | 28% | 0% | 1814/1999 | 5471/7532 | 25.6 | 7153 MiB (disk size†) | 17 |
| qwen3.5:2b-q4_K_M | ollama | 1k | 100% | 65% | 13% | 573/678 | 1216/2001 | 57.6 | 1812 MiB (disk size†) | 17 |
| gemma4:e4b | ollama | 1k | 98% | 93% | 13% | 473/742 | 2268/3600 | 24.6 | 4151 MiB | 18 |
| gemma4:e4b | ollama | 4k | 100% | 93% | 13% | 603/809 | 3202/4760 | 15.7 | 4191 MiB | 18 |

† RSS sampling bug (see Caveat): shows on-disk model size, a lower bound on resident memory, not a measured RSS peak.

#### parallel=1 vs parallel=2 (best model)

| Model | Context | Concurrency | Requests | Wall time (ms) | Throughput (req/s) | RSS peak |
| --- | --- | --- | --- | --- | --- | --- |
| llama3.2:3b | 4k | 1 | 20 | 16074 | 1.24 | 2780 MiB |
| llama3.2:3b | 4k | 2 | 20 | 19047 | 1.05 | 4728 MiB |

#### Outage recovery

| Model | Context | Killed after request # | Requests before kill | Requests after kill | Post-kill outcomes |
| --- | --- | --- | --- | --- | --- |
| llama3.2:3b | 1k | 2 | 2 | 3 | error, error, error |

#### Population schedule estimate

Using `llama3.2:3b` @ 4k (measured p95 completion latency 1538ms) as the baseline profile, a single-model bounded queue (concurrency 1) serving 27 characters (7 gods + 20 inhabitants) supports **39.0 reasoning turns/minute**, i.e. each character's next reasoning turn comes roughly every **41.5s** on average if turns are distributed round-robin. A character whose wait exceeds the 30s acceptance-plan completion target (the starvation threshold used here) is effectively starved under this policy; at 27 characters and this measured p95, that threshold is **already exceeded**.

## Findings

- `gemma3n:e4b-it-q4_K_M` @ 1k (ollama): native schema validity 88%, kind-acceptable 28%, 0% repaired-valid on the prompt-only audit sample, 0 timeout(s), 0 error(s) across 40 prompts.
- `gemma3n:e4b-it-q4_K_M` @ 4k (ollama): native schema validity 100%, kind-acceptable 43%, 0% repaired-valid on the prompt-only audit sample, 0 timeout(s), 0 error(s) across 40 prompts.
- `gemma4:e4b` @ 1k (ollama): native schema validity 98%, kind-acceptable 93%, 13% repaired-valid on the prompt-only audit sample, 1 timeout(s), 0 error(s) across 40 prompts.
- `gemma4:e4b` @ 4k (ollama): native schema validity 100%, kind-acceptable 93%, 13% repaired-valid on the prompt-only audit sample, 0 timeout(s), 0 error(s) across 40 prompts.
- `llama3.2-3b.gguf` @ 4k (llama-server): native schema validity 100%, kind-acceptable 83%, 13% repaired-valid on the prompt-only audit sample, 0 timeout(s), 0 error(s) across 40 prompts.
- `llama3.2:3b` @ 1k (ollama): native schema validity 98%, kind-acceptable 50%, 13% repaired-valid on the prompt-only audit sample, 0 timeout(s), 0 error(s) across 40 prompts.
- `llama3.2:3b` @ 4k (ollama): native schema validity 100%, kind-acceptable 83%, 13% repaired-valid on the prompt-only audit sample, 0 timeout(s), 0 error(s) across 40 prompts.
- `ministral-3:8b-instruct-2512-q4_K_M` @ 1k (ollama): native schema validity 100%, kind-acceptable 93%, 13% repaired-valid on the prompt-only audit sample, 0 timeout(s), 0 error(s) across 40 prompts.
- `ministral-3:8b-instruct-2512-q4_K_M` @ 4k (ollama): native schema validity 100%, kind-acceptable 85%, 13% repaired-valid on the prompt-only audit sample, 0 timeout(s), 0 error(s) across 40 prompts.
- `phi4-mini:3.8b` @ 1k (ollama): native schema validity 38%, kind-acceptable 20%, 0% repaired-valid on the prompt-only audit sample, 0 timeout(s), 0 error(s) across 40 prompts.
- `phi4-mini:3.8b` @ 4k (ollama): native schema validity 100%, kind-acceptable 68%, 0% repaired-valid on the prompt-only audit sample, 0 timeout(s), 0 error(s) across 40 prompts.
- `qwen3.5:2b-q4_K_M` @ 1k (ollama): native schema validity 100%, kind-acceptable 65%, 13% repaired-valid on the prompt-only audit sample, 0 timeout(s), 0 error(s) across 40 prompts.
- `qwen3.5:2b-q4_K_M` @ 4k (ollama): native schema validity 100%, kind-acceptable 57%, 13% repaired-valid on the prompt-only audit sample, 0 timeout(s), 0 error(s) across 40 prompts.
- Qwen3.5 defaults to hidden `<think>` reasoning tokens even under a JSON-schema-constrained call: an early run without `think: false` measured 0% native validity across all 40 prompts at both context tiers because the model's `content` field came back empty (all `--max-tokens` spent on the separate `thinking` field, `done_reason: "length"`) — this probe's Ollama adapter now always sends `think: false` (see the Caveat and servers.ts) specifically because of this measured failure mode; a population-scale scheduler routing to a thinking-capable model without an equivalent control would see the same silent failure.
- `gemma4:e4b` also defaults to hidden reasoning tokens (`ollama show` reports a `thinking` capability with `default: true`, the same profile Qwen3.5 has) — unlike Qwen3.5's early failure above, this probe's `think: false` fix was already in place before this candidate was ever benched, so there was no repeat of the empty-`content`/budget-exhaustion failure: native schema validity measured 98%/100% at 1k/4k, not the 0% Qwen3.5 hit pre-fix.
- `phi4-mini:3.8b`'s grammar-constrained decoding was unreliable at 1k context (38% valid — several completions degenerated into repeated/garbage tokens after the schema's first field key, hitting the `max_tokens` cap without ever closing the JSON object) but fully reliable at 4k context (100% valid) in this run — the opposite of the pattern a naive "shorter context is safer/faster" assumption would predict, and not explained by this probe (recorded as-is, not tuned around).
- Prompt-only + repair (no `format`/`response_format`) audit sample topped out at 13% repaired-valid across every candidate — native JSON-Schema-constrained output (this probe's default path for both servers) is not a marginal improvement over prompt-only + regex-extract-and-parse, it is the difference between a usable and an unusable action-proposal channel for these model sizes.
- Outage test on `llama3.2:3b`: server killed mid-run after request 2; 3/3 subsequent request(s) recorded as a clean timeout/error, no bench crash.
- Parallel comparison on `llama3.2:3b`: concurrency 1 reached 1.24 req/s at RSS peak 2780 MiB; concurrency 2 reached 1.05 req/s at RSS peak 4728 MiB — higher concurrency did *not* improve wall-clock throughput here, while RSS grew substantially (roughly proportional to the doubled context window Ollama allocates per additional parallel slot), a real measured cost with no offsetting benefit on this machine.
- Cross-server parity on the same GGUF (`llama3.2:3b` @ 4k): Ollama measured 83% kind-acceptable, completion p50/p95 706/1538ms; llama-server measured 83% kind-acceptable, completion p50/p95 721/1363ms — close agreement, no evidence either server materially disadvantages this model.

## Bottom line

Baseline model profile recommended for ADR-0005's local section: **llama3.2:3b, ollama, 4k context, parallel=1** — measured native schema validity 100%, kind-acceptable 83%, TTFT p50/p95 155/210ms, completion p50/p95 706/1538ms against the acceptance plan's 10s/30s p95 targets (within the 30s p95 target, no pass/fail declared here per the plan's instruction). `gemma4:e4b` @ 1k scored higher on kind-acceptable rate (93% vs this profile's 83%) but at 3600ms p95 — several times the latency — which is why it is not the recommendation: population-scale cadence (see the schedule estimate) is latency-bound, not accuracy-bound, once a candidate clears the 70% kind-acceptable bar. See the Population schedule estimate above for the reasoning-turns/minute and per-character cadence this profile supports for 7 gods + 20 inhabitants.