# god-latency

## Question

In an 8-minute seven-god episode on a local qwen3 8B at a 4K context (Ollama 0.34.4, reasoning off), 20 of 33 god requests ran into the router's 15 s limit and 13 were answered in 5.5–16.6 s. What does one god request cost the model server, how much of that does the server's prompt cache save when the requests are different gods', and what should the router's timeout be?

## Method

- **What is measured.** Ollama's native chat API (`/api/chat`), which reports what the router's `/v1` route hides: `prompt_eval_duration` (reading the prompt: *prefill*), `eval_duration` (writing the reply: *decode*), `load_duration` (loading the model), and the wall time the caller waited. Every request is shaped like the router's: the system text (`instructions`), the user text (`prompt`), the god's intent schema as the output format, thinking off, one at a time. `src/ollama.ts`.
- **What is sent.** Real god requests. `src/capture.ts` runs the authored Greek world forward on its own routines with a fixed seed (no god takes a turn, so the world is the same every time) and builds all seven gods' requests with `buildGodContext` at ticks 0, 150, 300, 400, and 500. A capture is a pure function of the prompt code, so capturing before and after a change gives two sets on the same world. `src/compare-contexts.ts` checks that the two sets show every god the same lines (as a multiset: same lines, same counts, any order); they do, for all 35 requests, and the mean request is 6,724 characters before and after, so the layout added and removed nothing.
- **Protocols** (`src/measure.ts`; `--only=` picks some):
  - `first`: unload the model and send one request: the first after a load.
  - `cold`: each god's request at tick 500 with a one-line random salt in front, so it shares no start with anything the server holds: no cache at all. (A tiny request sent first is not enough; the server kept a god's earlier prompt through it and answered the second round in 60–190 ms. The first measurement used that and its `cold` rows were discarded.)
  - `resend`: the same request twice: the most a cache can save.
  - `rotation`: the seven gods in the service's order (`nextGod` walks them alphabetically), round after round at ticks 300, 400, 500, twice: the production pattern, where each request follows a different god's.
  - `samegod`: a god, then the same god at the next captured tick.
- **Before and after** are taken on the same machine in the same session, back to back (`before-clean`, `after`, then `before-cold`, `after-cold`), 2 repetitions of the warm protocols and 3 of the cold ones. The machine was shared with other work (load average 4–8), which is why the cold numbers are higher than the 9–14 s prefill an idle machine gave in earlier probes; the router's timeout is set from the loaded numbers on purpose.
- **What a prefix is.** Ollama keeps one slot's worth of tokens and reuses the longest start a new request shares with the last one, evaluating the rest. So for two requests what matters is how many leading characters they share; `src/prefix.ts` measures that on the text.
- **Environment.** Apple M1 Pro, 16 GB, macOS 15, Ollama 0.34.4, `qwen3-8b-4k` (qwen3:8b Q4_K_M, `num_ctx` 4096).

## How to run

```sh
cd tools/probes/god-latency
bun run src/capture.ts --ticks=0,150,300,400,500 --out=results/contexts-after.json
bun run src/measure.ts --contexts=results/contexts-after.json --label=after --reps=2 --only=resend,rotation,samegod --out=results/after.json
bun run src/measure.ts --contexts=results/contexts-after.json --label=after-cold --reps=3 --only=first,cold --out=results/after-cold.json
bun run src/compare-contexts.ts results/contexts-before.json results/contexts-after.json   # exits 1 on any difference
bun run src/render.ts results/after.json results/contexts-after.json                       # re-render a table
bun test
```

`results/*.json` and the captured contexts are git-ignored; the tables (`results/*.md`) are kept.

## Results

### What a god request costs the server

Medians; prefill and decode are the server's own accounting, wall is what the caller waited.

| Case | Prompt tokens | Prefill | Decode | Wall p50 / p95 |
| --- | --- | --- | --- | --- |
| first request after a model load | ~2,500 | 17.6–18.2 s (+ 4.4–4.7 s loading) | 1.5–4.3 s | 23–25 s / 24–28 s |
| nothing cached (`cold`, 21 per side) | ~2,200 | 14.5–15.3 s | 3.3–4.2 s | 19.7–20.6 s / 22.9–31.4 s |
| the same request resent | ~2,440 | **58–67 ms** | 3.2 s | 3.3–4.5 s |
| `rotation`, before | ~2,160 | 9.0 s (p95 11.3 s) | 3.5 s | 13.0 s / 16.3 s |
| `rotation`, **after the reorder** | ~2,160 | **7.9 s** (p95 13.9 s) | 2.9 s | **11.3 s** / 19.9 s |

Reading a cold prompt is about three quarters of a request's time and decoding about 3.5 s of it. An identical resend costs 60 ms of prefill. The tokens a prefill reads are about 4 ms each (a 2,160-token request takes about 9 s), so **what a cache saves is proportional to the characters a request shares with the last one**.

### The order of a request (`packages/agents/src/context.ts`)

The request was laid out with the digest and the per-tick scene near the top of the user text and the god's persona first in the system text, so two gods' requests shared **8 characters** (`You are `). It is now ordered from what never changes to what changes every tick:

1. **Every god, every tick** (the system text's first seven lines: how to decide, how to move, how to speak, the length limits, what a goal is, how to wait, how to reply): **1,279 characters, byte-identical in all seven gods' requests**, about 300 tokens of ~2,160. It was 8.
2. **This god, fixed**: the persona line, drives, lore, relationships, powers.
3. What this tick's scene adds to the guidance (report and legend citations, the prayer and practice paragraphs). These are still in the system text, after the god's own, because they name event ids and who is here.
4. **Slow state** (the user text): what the god remembers and feels, what it did, its goal.
5. **Per-tick state, last**: where it is and the tick, what it holds, who is here, buildings, recent events, ways out, then **prayers, contests, and the practice digest with its openings, just before the question**.

Only the order and the split moved. No line was added, dropped, or reworded (35 requests, 0 differences as a multiset of lines), the 4K budget and the section budgets are untouched, `PRAYERS_HEADING` and `prayersSection()` are as they were, and the scripted provider still recognises each god by its `You are Hades,` line. `packages/agents/src/prompt-order.test.ts` holds the order: the shared start is byte-identical across all seven gods in one world, a god's request is unchanged up to the tick line when only the tick moves, slow state comes before the scene and per-tick state last.

**What it saves.** The shared start is about 14% of a request, and the measured prefill fell about 12% (9.0 → 7.9 s median, `rotation`), which is what 1,279 characters at 4 ms a token predicts (about 1.1 s). That is the bound: a cache that holds one slot can reuse only what two *different* gods' requests share, and that is the generic text. The `rotation` p95 got worse in this sample (11.3 → 13.9 s prefill, 16.3 → 19.9 s wall) because one request in the `after` run had to reload the model (5.8 s of `load_duration`), which the `before` run happened not to; the median is the figure to trust.

**What it did not save, and what changed besides.**
- A god's own start between its turns did not get longer in the captured worlds (the common start of one god's request at tick 400 and 500 was 2,993 / 5,274 / 5,459 characters for Athena / Hera / Zeus before and 3,960 / 4,959 / 5,146 after): the scene-dependent guidance lines in the system text change with the tick, and a server holding one slot overwrites it with six other gods in between anyway. Moving those lines into the user text would lengthen a god's own start; it matters only for a server with a slot per god, and it would rewrite what `instructions` holds, so it is left as a follow-up.
- **The model answered differently.** Before the reorder every one of 86 replies in the probe was a `practice` move; after it, of 86 replies in the same protocols, 52 were `practice`, 15 `move`, 17 `bless`, and 2 `realm-transition` (`after.json` and `after-cold.json`). The digest used to lead the user text and now ends it. That also shortens replies (a `move` or `bless` is about 20 tokens, a `practice` offer 59), so part of the lower wall time in `rotation` is the reply mix and not the cache; the prefill column is the cache's effect alone.

### The timeout (`packages/agents/src/router.ts`)

The attempt limit was 15 s (chain limit 30 s). Measured on the loaded machine: the first request after a load took 23–28 s, a request with nothing cached 14.5–23 s with a **p95 of about 30 s** and a worst of 32 s (48 cold and first-after-load requests), and a request that reused a cached start 3–16 s at the median and up to 20 s at the p95 (an identical resend 3.3–4.5 s). A request that times out wastes all of its time, and 15 s sat inside the normal range of the work the model was about to finish.

The default is now **45 s for an attempt (cold p95 and half again) and 60 s for the chain**, which leaves room for a full attempt and a retry's backoff. There was no per-endpoint timeout to use (the limits are one global set passed to `createRouter`), and a measured default is enough, so no config was added. A turn that is stuck now holds the one-at-a-time turn slot for up to 45 s instead of 15, about three times the interval between turns at seven gods; that is the price, and `limits` still overrides it. Retry and backoff are unchanged.

### The 8-minute episode

`scenario:m2 --episodes=1 --episode-seconds=480 --model=qwen3-8b-4k --reasoning-effort=none`, before (`/tmp/smoke7c`, base 6bb3e0f) and after (`/tmp/smoke7d`, this branch). Both are one episode on a loaded machine, a different world each time (no seed), so the rows say what happened, not what would always happen.

| | Before | After |
| --- | --- | --- |
| requests | 33 | **42** |
| answered | 13 | **40** |
| exhausted | 20 (all: no reply within 15 s) | **2** (both: a legend with no assertion, invalid output; no timeouts) |
| latency of answered requests, p50 / p95 | 11.8 s / 16.6 s | 10.2 s / 18.7 s (range 3.7–21.6 s) |
| answered requests over 15 s | 0 (they would have been cut) | 4 of 40 |
| turns per god | 4–5 | 6 |
| median gap between a god's turns | 98.5 ticks | 72 ticks |
| prompt characters p50 / max | 7,333 / 8,405 | 7,901 / 9,936 (the world grew differently; the layout adds none) |
| degraded polls | 57% | 4% |

Most of the gain is not the timeout: only 4 of the 40 answered requests took more than 15 s, so the old limit alone would have lost 4 of 42. The rest is requests that finished faster (a shorter prefill from the shared start, and shorter replies from the more varied actions), and the machine's load differed between the two runs, which this does not control. The attribution of the two changes is therefore not separated; the probe's `rotation` rows are the controlled comparison.

## Capped requests on granite3.3-8b-4k (2026-10-08)

### Question

The runtime prompt cap (`PROMPT_TOKEN_CAP` 3,000 tokens, counted at 2.85 characters a token for granite3.3-8b-4k) sheds a god's prompt until its estimate fits. Does a capped request's real `prompt_eval_count` stay at or under 3,000 on a real model, how far is the estimate from it, and what does a capped request cost warm?

The pass line was fixed before measuring: every measured capped request's **cold** `prompt_eval_count` is at or under 3,000.

### Method

- **Requests.** `src/capture-capped.ts` runs the authored Greek world forward on its own routines to tick 450 (fixed seed) and builds the seven gods' requests the way a turn builds them: `rememberedBy`, `fitToCap` at the granite ratio, `buildGodContext`, and the intent schema from the reduced pair. Three worlds: `aged` (as it stands), `crowded` (every god also holds a dozen prayers, help and punish, six memories including an accusation by another god, five feelings and five reports it told) and `heavy` (twice that load). 21 requests, each capped; the uncapped requests of the crowded and heavy worlds were 8,642–10,788 characters (estimates 3,033–3,786 tokens). The story's own S13 Zeus turn was not reproduced (it needs the compiled service's journal); the crowded and heavy Zeus requests have the same shape (memories, own actions and a prayer shed).
- **Cold.** `src/measure-capped.ts`: the model is unloaded (`keep_alive: 0`, waiting until `/api/ps` is empty) before every request, so each is the first after a load (median load 3.1 s) with an empty cache. All 21 requests once, and each god's busiest by estimate a second time.
- **Cache proof.** In Ollama 0.34.4 `prompt_eval_count` is the whole request whether or not a cache serves it: the same request resent with the model loaded reports the same count (2,722 for Athena) with a prefill of 65–80 ms against 19–22 s cold. So the count does not depend on the cache state, and the cold run shows a full read by its prefill time. The router's own route, `/v1/chat/completions`, reports the same `usage.prompt_tokens` as the native count (2,722 = 2,722). (The older tables in this README say a cached start is not counted; that does not hold for this build.)
- **Warm.** Sequential requests across the seven gods in the service's order, after a one-token wipe. Two protocols: `live`, where the tick line moves on by one every round so a god's request differs from its last the way a service's does (round 0 follows the wipe, later rounds are the steady state; 4 rounds in each of the three worlds, 84 requests), and `rotation`, where each god's request is resent unchanged (63 requests), which is an upper bound on what a cache saves.
- **Environment.** Ollama 0.34.4, `granite3.3-8b-4k` (`num_ctx` 4096), thinking off, one request at a time. The machine was shared with other work: 1-minute load average 2.6–15.5 over the warm runs (median 7.5), against 3.5–4 in the unattended hour. Latency is therefore pessimistic.

### Results

**Pass: all 21 cold requests were at or under 3,000 tokens; the largest was 2,816.**

| God | Busiest (world) | Chars | Estimated | Real (cold) | Real / estimated | Real, repeated cold |
| --- | --- | --- | --- | --- | --- | --- |
| athena | crowded | 8,548 | 3,000 | 2,722 | 0.91 | 2,722 |
| hades | heavy | 8,548 | 3,000 | 2,808 | 0.94 | 2,808 |
| hephaestus | crowded | 8,547 | 2,999 | 2,693 | 0.90 | 2,693 |
| hera | crowded | 8,525 | 2,992 | 2,728 | 0.91 | 2,728 |
| hermes | crowded | 8,525 | 2,992 | 2,760 | 0.92 | 2,760 |
| poseidon | heavy | 8,550 | 3,000 | 2,816 | 0.94 | 2,816 |
| zeus | heavy | 8,533 | 2,995 | 2,646 | 0.88 | 2,646 |

- **Estimate error** (real tokens ÷ estimated, 21 cold requests): worst 0.94, median 0.91, best 0.85. The estimate never undercounted. These requests ran 3.04–3.35 characters a token against the 2.85 the cap assumes, so the estimate runs about 6–15% over the real count here. The 2.85 comes from the unattended hour's densest prompts; a prompt that dense would land at the estimate, not over it.
- **Headroom.** The largest real count, 2,816, is 184 tokens under the cap and 1,274 under the 4,090 tokens past which Ollama silently drops the start of a prompt.
- **Warm latency, live rotation** (tick moving, 1-minute load median 7.5):

  | Requests | n | Wall p50 / p95 | Prefill p50 / p95 |
  | --- | --- | --- | --- |
  | round 0, after a wipe | 21 | 15.2 s / 18.9 s | 11.9 s / 13.4 s |
  | steady, rounds 1 on | 63 | 11.0 s / 14.8 s | 6.9 s / 9.6 s |

  The requests are 2,087–2,816 tokens, the top of the band the hour's 8.5 s figure (under 3,000 tokens) covered, and the machine was busier. The steady median of 11.0 s sits between the hour's 8.5 s and its 16.4 s above 3,500 tokens. With each request resent unchanged the wall median was 5.1 s and the p95 20.4 s (the server held several gods' requests, prefill median 0.1 s), which is the cache's ceiling and not a service's pattern.
- Tables: `results/capped.md`.

### How to run

```sh
cd tools/probes/god-latency
bun run src/capture-capped.ts --out=results/contexts-capped.json
bun run src/measure-capped.ts --contexts=results/contexts-capped.json --only=cold,resend,v1,rotation --out=results/capped-cold.json
bun run src/measure-capped.ts --contexts=results/contexts-capped.json --rounds=3 --only=live --out=results/capped-live.json
```
