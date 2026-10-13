---
title: A 4K Ollama model silently drops the start of an over-long prompt, so budget every growing section
date: 2026-10-03
category: best-practices
module: simulation-core
problem_type: best_practice
component: assistant
severity: high
applies_when:
  - Building or changing a god prompt that runs on a 4K-context local model
  - A prompt section grows with world state (prayers, threads, memories, events)
  - Estimating prompt size from characters instead of measured tokens
  - Reading `done_reason` or a clean reply as proof the whole prompt was seen
tags: [ollama, qwen3, context-budget, prompt-budget, silent-truncation, json-schema, prayers, o08, r22]
---

# A 4K Ollama model silently drops the start of an over-long prompt, so budget every growing section

## Context

Unit 7 grew the world to seven gods and twenty mortals, and a busy god's prompt grew with it. A character estimate (13.4K characters of prompt plus schema, about 3.3K tokens at 4 characters per token) suggested the R22 gate on qwen3-8b-4k was close to breaking. Measuring with real tokens showed the estimate was wrong in both directions. It also turned up a worse failure: overflow is silent.

Measured on Ollama 0.34.4 with `qwen3-8b-4k` (`num_ctx` 4096), through the router's own path (`createEndpointModel` → `generateText` with `Output.object`, reasoning off):

- **Overflow drops the start.** Above about 4,090 prompt tokens, Ollama keeps the end of the prompt and drops its beginning, which is the system instructions. There is no warning, and `done_reason` stays `stop`. The ceiling applies to the prompt alone.
- **The schema costs nothing.** A JSON schema sent as `response_format: json_schema` is applied as a grammar. `prompt_eval_count` was identical with the schema, without it, and with 6 KB of extra schema text.
- **Tokens ran about 3.3 characters each**, so a characters ÷ 4 estimate understates tokens for this model.
- **One section dominated.** The prayers section had no cap and was about 72% of a busy god's user prompt. About seven more open prayers would have crossed the ceiling.

## Guidance

- **Measure real prompt tokens.** Use `prompt_eval_count` through the production router path, never a character ratio.
- **Don't trust a clean reply.** A finished reply with `done_reason: stop` does not show the whole prompt was read.
- **Give every growing section a character budget.** Put the constant beside the others (`DIGEST_BUDGET_CHARS` = 1600 and `PRAYERS_BUDGET_CHARS` = 2400 in `packages/agents/src/practices.ts`). Choose deterministically what survives, and end with a count of what was left out.
- **Never cut what binds the actor.** Prayers named by a live practice are always shown. After those come the newest, then `- and N more prayers to you.`
- **Narrow what the model may name to what it was shown.** The schema enum, the parser and the openings are rebuilt from the shown prayers, so a hidden id is neither offered nor accepted.
- **Shrink only the prompt.** The world keeps every petition.
- **Guard the whole prompt.** A test builds the busiest realistic world (seven gods, tick 400) and asserts the largest prompt stays under a character guard (8,500), so growth in any other section fails a test before it reaches the model.

## Why This Matters

Silent truncation removes the instructions first, so a god stops following its rules without any error to see. A gate could fail as "the model is bad at this" when the model never saw the rules. Budgeting by section keeps the failure out of reach, and the whole-prompt guard catches the section nobody budgeted.

The schema result changes design choices. On Ollama, a stricter or larger schema does not compete with the prompt for context. That does not carry over to hosted endpoints, which may render the schema differently.

## When to Apply

- Any new prompt section that lists world items: threads, prayers, memories, events, rivals.
- Any change to what a god sees in a crowded world.
- Before reading a gate failure as a model failure on a 4K model.

## Examples

Truncation probe, reusable for any model or context size:

1. Put a code word at the very start of the system message: `Remember this code word: ZEBRA-7741`.
2. Grow the user message with filler, then ask `What is the code word?`
3. Log `prompt_eval_count`, `done_reason` and the answer at each size.

Below the ceiling the answer is the code word. Above it, `prompt_eval_count` drops (here to about 2,050), the answer is something else, and `done_reason` is still `stop`.

Effect of the prayers budget (real tokens, qwen3-8b-4k):

| Case | Characters | Prompt tokens |
|---|---|---|
| Busy Poseidon, tick 400, before | 9,227 | 2,770 |
| Busy Poseidon, tick 400, after | 8,192 | 2,435 |
| Busiest god after (Athena) | 8,472 | 2,463 |

The tests are in `packages/agents/src/prayer-budget.test.ts`. They cover the budget and the "and N more" line, live-practice prayers kept, schema and parser ids equal to the prayers shown, and the seven-god whole-prompt guard. They do not exercise Ollama itself; the truncation threshold comes from the probe above and is recorded in the comment on `PRAYERS_BUDGET_CHARS`.

## Related

- [move-realm-transition-destination-pairing-2026-10-02.md](../logic-errors/move-realm-transition-destination-pairing-2026-10-02.md): its estimate that a per-action schema would crowd the 4K context does not hold on Ollama, where the schema costs no prompt tokens.
- [hosted-endpoint-policy-and-smoke-test-2026-10-02.md](hosted-endpoint-policy-and-smoke-test-2026-10-02.md): hosted endpoints may count schema differently, so measure there separately.
- PR #102; `docs/product/defaults.md` records the prayer budget replacing "every prayer listed".

## Update 2026-10-08: a runtime cap now enforces this

The per-section budgets above did not bound the sum: on `granite3.3-8b-4k` the unattended hour sent 84 of 214 prompts over the old 10,500-character test guard, and Ollama cut nine of them to exactly 2,050 tokens, dropping the instructions. A runtime cap now bounds the whole request of every god turn at `PROMPT_TOKEN_CAP` (3,000 tokens): it counts the request at the smallest characters-per-token ratio on the role's route, sheds recent events, own actions, memories and then unprotected prayers until it fits, and does not send a turn whose protected floor is still over. The router also refuses any send over the limit. The code is `packages/agents/src/prompt-cap.ts` (ratios, estimate, shedding), `packages/agents/src/turn.ts` (the turn's use of it) and `packages/agents/src/router.ts` (the per-send check); the measured ratios and the check against the model are in the Prompt cap row of `docs/product/defaults.md`. Two facts from that measurement: `granite3.3-8b-4k` ran 3.04-3.35 characters a token on capped requests (the hour's densest were 2.85), and in Ollama 0.34.4 `prompt_eval_count` is the whole request even when its cache serves it, so a cold run is shown by prefill time and not by a smaller count.
