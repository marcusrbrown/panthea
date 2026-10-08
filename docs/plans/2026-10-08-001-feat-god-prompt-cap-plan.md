---
title: "feat: a runtime cap on each god's whole prompt"
type: feat
status: active
date: 2026-10-08
---

# feat: a runtime cap on each god's whole prompt

## Overview

Each god's whole prompt (instructions and prompt together) is held under about 3,000 tokens when the turn is built, not only in tests. The cap counts tokens with a measured characters-per-token figure for each model. It sheds sections in a fixed order:
1. recent events, oldest first;
2. own actions, oldest first;
3. memories and feelings, lowest salience or affinity first;
4. unprotected prayers, oldest and least urgent first.

The standing instructions, the persona and the god's answer choices for the prayers it shows are never cut. A move's rules appear only when that move is offered. A prompt still over the cap after every allowed shed is not sent. The turn is recorded as exhausted for a new reason.

## Problem Frame

The first unattended hour on granite3.3-8b-4k failed. The evidence is in `tools/scenarios/m2-greek-cast/unattended/2026-10-08T10-35-26/`.

- **Truncation.** Ollama silently cut nine prompts, from 11,962–12,371 characters down to exactly 2,050 tokens. A cut drops the start of the prompt, which is the standing instructions.
- **Guards exceeded.** 84 of 214 prompts exceeded the 10,500-character whole-prompt guard. That guard is a test on a synthetic world, not a runtime bound.
- **Token density.** It was set at qwen3's 3.3+ characters per token. granite3.3 measures 2.85–3.35.
- **Latency.** Request time grew with prompt size: about 8.5 s under 3,000 tokens and 16.4 s above 3,500. Seven gods then miss the 90 s queue-wait target: the real-turn p95 was 124–134 ticks.

A runtime cap near 3,000 tokens stops the cuts and brings latency down (owner, 2026-10-08).

## Requirements Trace

- R1. No request the router sends for a god exceeds the cap as estimated with the most conservative ratio on its route. That includes a retry carrying refusal feedback and the plain-text fallback carrying the schema. No request reaches Ollama's truncation point (O08).
- R2. Shedding never leaves the prompt, schema or proposal builder naming something the god can no longer see, such as an event, memory, prayer, contest act or thread (W04).
- R3. These are never shed: the standing instructions, persona, goal and journey state, the god's own obligations, and protected prayers. A protected prayer is one named by a live practice or by an owed boon.
- R4. The cap uses the smallest ratio across every model the role's planned route can reach, offline-filtered when offline (P07).
- R5. Each request records its estimated tokens, the ratio used and what each tier shed. An over-cap turn records the reason `prompt-over-cap` and sends nothing (O04, O08).
- R6. The rerun of the hour shows no cut prompts, records the shed counts and counts `prompt-over-cap` turns per god. A god held back by repeated over-cap turns fails the longest-quiet-stretch row (O08).

## Scope Boundaries

- No change to the scheduler, the 90 s target or any gate threshold.
- No change to which model runs or to the number of gods.
- Shedding is prompt-only. The world keeps every petition, memory and event.
- No settings-screen or launch-config change. Ratios live in code (owner, 2026-10-08).
- Hosted endpoints are not measured here. Every ratio and the cap are recorded as measured on local Ollama.

### Deferred to Separate Tasks

- The gate-check fixes (queue wait excluding outage refusals, cut-prompt detection, footprint memory row, two-pass catch-up row): #172.
- Pruning the never-pruned petition, credit, wrong and noticed maps: the eight-hour endurance trial, not M2.

## Context & Research

### Relevant Code and Patterns

- `packages/agents/src/turn.ts:91-123` is the turn pipeline: perceive → `rememberedBy` → `buildGodContext` → `godIntentSchema` → `router.route` → `buildModelProposal`. The prompt is built before the router plans the route.
- `packages/agents/src/context.ts`:
  - `rememberedBy` (600-693) already sheds prayers through `choosePrayers` (1788-1842). It then reruns `practiceBy` over the shown prayers (668-680), so schema, openings and parser never name a hidden prayer. That is the seam to extend.
  - `offerFor` (890) and `godIntentSchema` (1309) derive every citable id from `(snapshot, remembered)`.
  - `buildGodContext` (1964-2091) assembles the instructions (a shared start, then the persona, then an offer-dependent tail) and the prompt (remembered, self, scene, destinations, prayers, contests, digest).
  - The travel line (1989) is unconditional, although travel is offered only when destinations exist.
- `packages/agents/src/practices.ts:48-77` holds the per-section budgets: `DIGEST_BUDGET_CHARS` 1,600, `PRAYERS_BUDGET_CHARS` 3,000 and `CONTESTS_BUDGET_CHARS` 600.
- `packages/agents/src/config.ts` holds `Endpoint`, `RouteStep` and the route planner (396-447, which drops non-local steps offline).
- `packages/telemetry/src/trace.ts:96-111` is the `trace_model_requests` table.
- `apps/simulation/src/agents.ts:263-296` records requests.
- `tools/probes/god-latency` captures real god contexts and measures Ollama's `prompt_eval_count` against request characters.

### Institutional Learnings

- `docs/solutions/best-practices/ollama-4k-prompts-truncate-silently-2026-10-03.md` is the predecessor this plan extends. It keeps four rules:
  - never cut what binds the actor;
  - shed in the prompt only;
  - derive the schema and parser from the survivors;
  - record the measurement in `defaults.md`.
- `prompt-commanding-old-action-hides-new-option-2026-10-03.md` and `move-realm-transition-destination-pairing-2026-10-02.md` apply together:
  - an instruction and the option it commands are shed together;
  - a move's rules appear only when it is offered;
  - the schema stays at least as strict as the parser, and on Ollama the schema costs no prompt tokens.
- `knowledge-leaks-through-perception-timing-and-citations-2026-09-29.md`: the prompt and the allowed-id enums come from one surviving set.
- `tick-admission-starved-external-proposals-2026-09-28.md`: the shed order is policy, tested with a cap that binds.
- `accepted-memory-tunable-made-world-unreloadable-2026-09-29.md`: boundary tests for the cap and the ratios.
- `provider-settings-routing-key-boundary-bugs-2026-10-02.md`: key ratios by the router's model id.
- `end-to-end-scenario-with-positive-controls-2026-09-28.md`: the guard needs a positive control. The real-run evidence is the composition proof.

## Prior-Art Survey

```json
{
  "schema_version": 2,
  "verdict": "extend",
  "scope": "packages/agents, apps/simulation, packages/telemetry, tools/probes/god-latency",
  "freshness": {
    "vcs_reference": "67b09bc"
  },
  "budget": {
    "max_search_passes": 3,
    "max_candidate_inspections": 10,
    "exhausted": false
  },
  "candidates": [
    {
      "path_or_symbol": "packages/agents/src/context.ts buildGodContext",
      "description": "Assembles the god's instructions and prompt sections; has no runtime whole-prompt budget.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "packages/agents/src/context.ts choosePrayers and rememberedBy",
      "description": "Sheds prayers within a character budget, keeps live-practice prayers, and re-runs practiceBy over the shown prayers so schema, openings and parser name only visible prayers.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "packages/agents/src/practices.ts DIGEST_BUDGET_CHARS, PRAYERS_BUDGET_CHARS, CONTESTS_BUDGET_CHARS",
      "description": "Per-section character budgets with compression for practice digest, prayers and contests.",
      "disposition": "reuse"
    },
    {
      "path_or_symbol": "packages/agents/src/config.ts route planning",
      "description": "Plans the role's route as primary then fallback steps, dropping non-local steps offline.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "packages/agents/src/prayer-budget.test.ts, contests-context.test.ts, prompt-order.test.ts whole-prompt guards",
      "description": "Synthetic-world character guards (10,500 and 11,000) plus section agreement tests.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "tools/probes/god-latency",
      "description": "Captures real god requests and measures Ollama prompt_eval_count and prefill against request characters.",
      "disposition": "reuse"
    }
  ],
  "excluded_scopes": [
    {
      "scope": "apps/client, apps/desktop",
      "reason": "Ratios live in code; the settings screen and launch config do not change (owner, 2026-10-08)."
    }
  ]
}
```

## Key Technical Decisions

- **The cap transforms `(snapshot, remembered)`, not the prompt string.** A new step after `rememberedBy` sheds units from the snapshot and remembered state. The prompt, schema and proposal builder are then all built from the reduced pair, so no shed id survives in an enum (R2).
- **A bounded loop that re-measures after each shed.** Shedding a memory or prayer reruns `practiceBy`, which can change other sections, so one pass isn't safe.
  - The loop works tier by tier: drop one unit, re-derive, rebuild, estimate.
  - It stops when the prompt is under the cap or nothing sheddable is left.
  - Every "and N more" line is reserved before the loop, so sizes never grow.
  - It ends after at most one rebuild per sheddable unit, with no model call.
- **The shed tiers, in order (owner, 2026-10-08):**
  1. recent events, oldest first;
  2. own actions, oldest first;
  3. memories and feelings, lowest salience or affinity first;
   4. unprotected prayers, oldest and least urgent first.
- **Linked rows shed with the unit behind them.** When a memory is shed, three things go with it: goal history rows that point to it, demand causes derived from it, and witnessed citations derived from it. When an own action is shed, goal history rows for that action go with it. Goal state stays.
- **Contests and the practice digest keep their own character budgets.** They are not in the shed order. They shrink only through the prayers or memories behind them.
- **The protected floor.** It covers:
  - the standing instructions and persona;
  - goal and journey state;
  - the god's own obligation rows;
  - protected prayers, with their answer choices.

  `choosePrayers`' "keep at least one prayer" rule applies only to protected prayers.
- **Over the cap at the floor means the turn isn't sent (owner, 2026-10-08).**
  - The turn ends exhausted with the reason `prompt-over-cap`, and no request reaches the model. The route plan is still read, because the estimate needs it.
  - The god tries again on its next turn.
  - The result is a top-level exhausted turn with that reason and no route steps. The trace row stores the reason.
  - It does not set model-degraded or change an endpoint's status, since no provider failed.
  - The gate counts these turns per god and doesn't treat them as answered requests. A god held back by them shows as a long quiet stretch.
- **Ratios are a code table keyed by model id, with a default of 2.8 (owner, 2026-10-08).** granite3.3-8b-4k is 2.85 and qwen3-8b-4k is 3.34, both measured on local Ollama. A model not in the table gets 2.8. The cap's estimate is the whole request's characters divided by the smallest ratio of every model the role's planned route can reach, using the offline-filtered plan when offline.
- **The router exposes its plan.** `Router` gains a read-only `plan(role)`. `createRouter` implements it with the same routing config and offline flag it routes with, so there is one planner. `runGodTurn` calls it before applying the cap.
- **The cap is a code constant beside the section budgets.** `PROMPT_TOKEN_CAP` is 3,000 tokens, chosen for latency (owner, 2026-10-08). That leaves about 1,090 tokens under Ollama's cut point for the reply. The schema costs no prompt tokens on Ollama.
- **The estimate reserves room for a retry's feedback.** After an invalid reply, the router appends a refusal note to the prompt, of at most `FEEDBACK_LIMIT` plus its fixed wording (`router.ts`, `feedbackFor`). The capped request's estimate includes that maximum, so a retry fits too.
- **The router enforces the cap on every request it sends.**
  - The turn passes the router a character limit: the cap times the ratio it used.
  - Before each send, the router compares the request's real text with that limit. That covers the first attempt, a retry with feedback, and the plain-text fallback after a structured-output 400 or 422, which appends the whole serialized schema (`router.ts`).
  - A request over the limit is not sent. That step fails with the reason `prompt-over-cap`, and the route moves on or exhausts as it does for any failed step.
  - The schema fallback is not reserved in the cap, because the schema is large and the fallback is rare on Ollama. A god whose fallback would not fit gets an exhausted step, not a cut prompt.
- **Move rules only when offered.** The travel line moves out of the shared instruction start and appears only when destinations exist. This costs the cross-god prompt-cache hit on that line, which is accepted.
- **Observability goes on the request record and the trace row.** The request record and `trace_model_requests` gain the estimated tokens, the ratio, and the per-tier shed counts. The columns are added to the table definition directly; per project rule there is no migration for unshipped stores.

## Open Questions

### Resolved During Planning

- **Where ratios live, the default, and the over-cap behaviour:** owner decisions, 2026-10-08.
- **Which ratio applies across a route:** the most conservative step of the planned route, offline-filtered.
- **Goal history:** a row sheds with the memory or own action behind it; goal state never sheds.
- **How the turn gets the route plan:** a read-only `Router.plan(role)` built on the same config and offline flag.
- **Contests and digest:** they keep their own budgets and are not added to the shed order.

### Deferred to Implementation

- **The unit granularity inside each tier.** For example, whether a memory and its feeling shed as a pair. Settle it when the code shows what's coupled.
- **How the shed counts are encoded in the trace row.** Separate integer columns, or one JSON column with a `CHECK`.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
remembered = rememberedBy(...)                      # existing; prayers already within their char budget
ratio      = min(ratio(model) for step in router.plan(role))   # offline-filtered; default 2.8
(s, r)     = (snapshot, remembered)
estimate   = (chars(buildGodContext(s, r)) + MAX_RETRY_FEEDBACK) / ratio
for tier in [recentEvents, ownActions, memoriesAndFeelings, unprotectedPrayers]:
    while estimate > PROMPT_TOKEN_CAP and tier(s, r) has a unit:
        (s, r) = drop(oldest-or-least unit of tier)  # memory/prayer drop reruns practiceBy; linked goal-history rows go too
        estimate = (chars(buildGodContext(s, r)) + MAX_RETRY_FEEDBACK) / ratio
if estimate > PROMPT_TOKEN_CAP: exhausted("prompt-over-cap"), route() never called
route(context, schema, maxChars = PROMPT_TOKEN_CAP * ratio)   # router refuses any send over maxChars
context, schema, proposal-builder all use (s, r); record estimate, ratio, shed counts
```

## Implementation Units

- [ ] **Unit 1: Route ratio and token estimate**

**Goal:** a function that gives the most conservative ratio for a role's planned route, plus an estimator for a built request.

**Requirements:** R1, R4

**Dependencies:** none

**Files:**
- Create: `packages/agents/src/prompt-cap.ts`
- Modify: `packages/agents/src/config.ts` (expose the route plan if needed), `packages/agents/src/index.ts`
- Test: `packages/agents/src/prompt-cap.test.ts`

**Approach:**
- `MODEL_RATIOS` is keyed by the router's model id, plus `DEFAULT_RATIO` 2.8 and `PROMPT_TOKEN_CAP` 3,000.
- The route ratio is the smallest over every step of the planned route for the current offline mode.
- An empty plan gives the default, not a throw.

**Execution note:** test-first.

**Test scenarios:**
- Happy path: a role on granite3.3 alone gives 2.85; a role with a qwen3 primary and a granite3.3 fallback gives 2.85.
- Edge case: an unknown model gives 2.8; an empty plan gives 2.8.
- Integration: offline drops a hosted fallback with a lower ratio, so the local ratio applies; online, the lower ratio applies.
- Boundary: the estimate lands exactly at the cap, and one character over crosses it.
- Happy path: the estimate includes the maximum retry feedback. A request that fits only without the feedback counts as over.
- Integration: `Router.plan(role)` returns the same steps `route` would try, online and offline.

**Verification:** ratio selection and the estimate are pinned by tests, and the table is keyed by the same id the router resolves.

- [ ] **Unit 2: The shedding transform**

**Goal:** reduce `(snapshot, remembered)` to fit the cap in the owner's order, keeping the protected floor and re-deriving everything that depends on a shed unit.

**Requirements:** R1, R2, R3

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/agents/src/prompt-cap.ts`, `packages/agents/src/context.ts` (`rememberedBy`/`choosePrayers` seam, goal-history derivation)
- Test: `packages/agents/src/prompt-cap.test.ts`, `packages/agents/src/prayer-budget.test.ts`

**Approach:**
- Use the bounded loop from the design, with the tiers and floor from the key decisions.
- Memory and prayer sheds go back through `practiceBy`, the same way `rememberedBy` already re-filters prayers.
- "And N more" counts update and are reserved before the loop.

**Execution note:** test-first. Build a busy world that is forced over the cap.

**Test scenarios:**
- Happy path: a world just over the cap sheds only recent events, oldest first, and lands under it.
- Happy path: a world far over the cap sheds whole tiers in order (events, own actions, memories and feelings, then unprotected prayers), and the test asserts the exact survivors.
- Edge case: a god with no prayers and no events sheds own actions and memories. There is no "and 0 more" line.
- Edge case: protected prayers (one named by a live practice, one by an owed boon) survive when every other prayer is shed.
- Integration, W04:
  - after an event is shed, no schema enum, citation or contest act names it;
  - after a memory is shed, its witnessed citation, demand cause and goal-history row are gone from the prompt, the schema and the parser;
  - after an own action is shed, it is gone from both the recent-actions section and the goal history;
  - after a prayer is shed, no bless, refuse, practice or opening names it.
- Positive control: with shedding disabled, the over-cap world fails the cap assertion.
- Boundary: at the cap exactly, nothing is shed; one character over, exactly one unit is shed.

**Verification:** every shed kind keeps the prompt, schema and parser in agreement, and the over-cap world lands under the cap with the survivors the policy predicts.

**Status (2026-10-08):** built, with a refill pass the owner added after the story run: once the request fits, each shed unit is tried once, most valuable first (memories by salience, feelings by strength, own actions newest first, events newest first), through the same re-derive path and kept only if the rebuilt request with the feedback reserve still fits. A shed prayer is never re-added. The shed counts are the net.

- [ ] **Unit 3: Wire the cap into the turn, and record it**

**Goal:** `runGodTurn` applies the cap before building the context, schema and proposal; refuses to send an over-cap prompt; and records the cap figures.

**Requirements:** R1, R5

**Dependencies:** Unit 2

**Files:**
- Modify: `packages/agents/src/turn.ts`, `packages/agents/src/router.ts` (`plan(role)`, the per-send character limit, `prompt-over-cap` as a step failure reason), `apps/simulation/src/agents.ts`, `packages/telemetry/src/trace.ts`, `tools/scenarios/m2-greek-cast/src/unattended-analysis.ts` (count `prompt-over-cap` per god, outside answered requests)
- Test: `packages/agents/src/turn.test.ts`, `packages/agents/src/router.test.ts`, `apps/simulation/src/agents.test.ts`, `packages/telemetry/src/trace.test.ts`, `tools/scenarios/m2-greek-cast/src/unattended-analysis.test.ts`

**Approach:**
- The cap runs between `rememberedBy` and `buildGodContext`.
- An over-cap result reads the route plan and then returns an exhausted turn with the reason `prompt-over-cap`. It never calls `route`.
- An under-cap turn calls `route` with the character limit. The router refuses any send over it.
- The request record and trace row carry the estimated tokens, the ratio and the per-tier shed counts.

**Execution note:** test-first.

**Test scenarios:**
- Happy path: an under-cap turn sends the reduced prompt, and the trace row shows the estimate, the ratio and zero sheds.
- Error path: in a world where the protected content alone is over the cap:
  - `route` is never called;
  - the exhausted reason is `prompt-over-cap`, recorded in the trace;
  - model-degraded is not set;
  - no endpoint's status changes.
- Error path: a near-cap context gets a structured-output 400, then a 422. The plain-text fallback with the schema would exceed the limit, so it is not sent, and the step fails `prompt-over-cap`. The same context with a small schema sends its fallback.
- Error path: a near-cap context gets an invalid reply. The retry with feedback is sent and stays within the limit.
- Integration: a shedding turn records its shed counts, and the proposal builder rejects an id that was shed.
- Integration: the simulation records the new fields through its existing request path, and the store reopens. Archives don't copy trace tables, so export is not tested here.
- Integration: the unattended report counts `prompt-over-cap` turns per god and leaves them out of answered requests.

**Verification:** the trace shows the cap figures for every god turn, and no request over the limit leaves the router.

- [ ] **Unit 4: Move rules only when offered, and replace the synthetic guards**

**Goal:** the travel line appears only with destinations, and the character guards give way to cap tests.

**Requirements:** R1, R2

**Dependencies:** Unit 3

**Files:**
- Modify: `packages/agents/src/context.ts`, `packages/agents/src/prompt-order.test.ts`, `packages/agents/src/prayer-budget.test.ts`, `packages/agents/src/contests-context.test.ts`, `packages/agents/src/legend-copyable.test.ts`

**Approach:**
- Make the travel line conditional on `offer.destinations`.
- Re-pin the shared prefix so it no longer carries travel.
- Remove the 10,500 and 11,000 character guards. Keep their section agreement tests.

**Test scenarios:**
- Happy path: a god with destinations sees the travel line and `travel` in the enum. A god with none sees neither.
- Integration: the prompt-order tests pin the new shared start and the order after it.
- Happy path: the busiest synthetic world from the old guards now passes through the cap and lands at or under 3,000 tokens at the granite3.3 ratio.

**Verification:** no prompt names travel without destinations, and no test still asserts a fixed character guard.

- [ ] **Unit 5: Measure the estimate against the model, and record it**

**Goal:** confirm on local Ollama that the capped prompts' real `prompt_eval_count` sits under the cap and far below the cut point, then record the ratios and the cap.

**Requirements:** R1, R6

**Dependencies:** Unit 4

**Files:**
- Modify: `docs/product/defaults.md` (a "Prompt cap" row: the cap, the ratio table, the default, the measurement), `docs/product/traceability.md` (O08, W04, P07, O04), `docs/solutions/best-practices/ollama-4k-prompts-truncate-silently-2026-10-03.md` (a dated note that a runtime cap now enforces it)
- Use: `tools/probes/god-latency` (capture and measure; no probe change unless it needs the cap)

**Approach:**
- Capture the busiest capped contexts of the seven-god town on granite3.3.
- Measure each one cold, with no prompt cache, so `prompt_eval_count` is the whole request: unload the model or vary the start between requests.
- Measure warm latency separately.
- Report the worst estimate error against the ratio.

**Test expectation:** none. This unit is a measurement plus docs.

**Verification:**
- The pass line is fixed before measuring. Every measured capped request's cold `prompt_eval_count` is at or under `PROMPT_TOKEN_CAP`.
- If any is over, the unit stops and reports a feasibility conflict with the measured numbers. It does not raise the cap or adjust the ratio without the owner.
- The `defaults.md` row cites the measurement.

- [ ] **Unit 6: Rerun the unattended hour**

**Goal:** the M2 gate run on granite3.3 with the cap and the corrected gate checks.

**Requirements:** R6

**Dependencies:** Units 1–5 merged; #172 merged

**Files:**
- Create: the evidence folder under `tools/scenarios/m2-greek-cast/unattended/<timestamp>/`
- Modify: `docs/plans/2026-10-07-002-feat-m2-unattended-run-plan.md` (Unit 6 status), `docs/product/traceability.md` (O08)

**Approach:** prepare a quiet machine, with owner confirmation, then run once. Commit the evidence whatever the verdict.

**Test expectation:** none. This unit produces evidence.

**Verification:**
- The report shows no cut prompts.
- Every god's requests are under the cap, with shed counts and `prompt-over-cap` turns recorded.
- Queue wait, the longest quiet stretch and every other threshold are judged by the corrected checks (#172).

## System-Wide Impact

- **Interaction graph:** god turns only. Mortal routines, the director and the world validator are untouched. The world still re-judges every proposal.
- **Error propagation:** `prompt-over-cap` is a new top-level exhausted reason with no route steps. The god waits, as with any exhausted turn. Model-degraded and endpoint status are untouched.
- **State lifecycle risks:** none in the world. The cap reads state and builds a reduced copy for the prompt.
- **API surface parity:** the scripted provider and the scenario harness see smaller prompts. Tests that pin prompt text may need re-pinning.
- **Unchanged invariants:**
  - per-section budgets;
  - the world's petitions;
  - the offline rule;
  - no credentials in prompts;
  - schema at least as strict as the parser.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| A god loses context it needs and plays worse | Shedding starts with recent events and history and touches prayers last. Bound prayers never shed. The hour's rating sheet judges the effect. |
| The estimate undercounts for a new model | Any model not in the table gets the 2.8 default. The cap leaves about 1,090 tokens under the cut point. Unit 5 measures the error. |
| Prompt-cache hits fall | Shedding mostly touches the end of the prompt. Only the travel line and offer-dependent instruction tails move. Unit 5 measures latency. |
| Seven gods still miss 90 s at about 3,000 tokens | The rerun measures it. Any change to the scheduler or to the number of gods is a separate decision. |

## Sources & References

- Evidence: `tools/scenarios/m2-greek-cast/unattended/2026-10-08T10-35-26/` and #170
- Related: `docs/plans/2026-10-07-002-feat-m2-unattended-run-plan.md`, `docs/decisions/0005-model-providers.md`, `docs/product/defaults.md` (prompt caps and measure rows)
- Related PRs: #165 (granite3.3 baseline), #168 (unattended mode), #170 (first hour)
