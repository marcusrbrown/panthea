---
title: Ops named like inherited properties got no response
date: 2026-10-08
category: logic-errors
module: assets
problem_type: logic_error
component: tooling
severity: high
symptoms:
  - "A studio session request with op toString, constructor or __proto__ got no response"
  - "The next valid request was answered, and the session still exited 0"
root_cause: wrong_api
resolution_type: code_fix
tags: [studio, dispatcher, prototype-chain, own-property, ndjson-session, protocol]
---

# Ops named like inherited properties got no response

## Problem

The studio's stdio session looked up commands in a plain object (`OPS[op]`). For `toString`, `constructor` or `__proto__`, that lookup returned an inherited property instead of `undefined`, so the request skipped the `unknown-op` refusal. `readArgs({}, def.spec)` then threw before `execute` entered its `try`, and `handle()` didn't catch it. A client waiting on that request id never got an answer. The PR review reproduced it by sending `{"id":"bad","op":"toString","args":{}}`, then `status`, then EOF.

## Symptoms

- Only the `status` response came back, and the process exited 0.
- `readArgs` also accepted inherited argument names, such as `{"toString": 1}`.

## What Didn't Work

- **Checking `def === undefined` after `OPS[op]`.** Ordinary indexing sees the prototype chain.
- **Catching only around `def.run`.** Argument parsing ran before the `try`.

```ts
// before
const def = OPS[op];
if (def === undefined) return refuse("unknown-op", …);
const read = readArgs(args ?? {}, def.spec); // can throw outside the try
```

## Solution

- An `own(table, key)` helper returns only own entries. `execute`, `opSpec`, `readArgs` and CLI flag parsing all use it, and required-argument checks use `Object.hasOwn`.
- Everything after the lookup runs inside `execute`'s `try`.
- `handle()` and the initial `open` catch any throw and answer `internal` with the request id.

```ts
export function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}
```

## Why This Works

Inherited JavaScript names are no longer commands or arguments. Any failure after a request id is known now produces exactly one correlated error response.

## Prevention

- Never index a plain object with keys taken from protocol input. Use `Object.hasOwn`, a shared `own()` helper, `Object.create(null)` or a `Map`.
- Keep a standard regression set for dispatchers: `toString`, `constructor`, `__proto__`, `hasOwnProperty` and `valueOf` must each return `unknown-op` (`tools/studio/src/commands.test.ts`).
- Protocol tests should assert response count and id correlation, not just exit codes. `tools/studio/src/index.test.ts` checks that a bad inherited-name op followed by `status` gives exactly two responses, in order.
- Make the request/response boundary catch everything, so every accepted request gets an answer.

## Related Issues

- [Unawaited god-turn store fault](../runtime-errors/unawaited-god-turn-store-fault-2026-09-29.md): the same rule, that a dispatch path handles every failure and always answers.
- PR #174.
