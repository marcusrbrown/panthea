---
title: "Client receipt pacing must match the service's fixed window, own its queue and keep each receipt's session"
date: 2026-10-10
module: client-view
problem_type: logic_error
component: tooling
severity: medium
symptoms:
  - "After a realm switch, the client sent a burst of presentation receipts and the service answered 429 past 50 per window"
  - "Held receipts were never sent while the world was paused, because no frame arrived to drain them"
  - "A receipt drawn under one sidecar session could be recorded under the next"
root_cause: logic_error
resolution_type: code_fix
tags: [presentation-receipts, rate-limit, fixed-window, pacing, stale-session, sidecar, drain, receipt-clock]
---

# Client receipt pacing must match the service's fixed window, own its queue and keep each receipt's session

## Problem

Each frame carries the last 10 ticks of committed events (`RECENT_EVENT_WINDOW_TICKS`, `apps/simulation/src/server.ts:294`). Each drawable event gets one presentation receipt per session (O04). When a draw finds that window unreceipted, after switching back to a realm or after a stall, the client sent every receipt at once. The service accepts 50 receipts per fixed window that resets only after more than 1000 ms (`server.ts:364-375`), and refused the rest with 429 (`server.ts:898-899`). The client had no pacing before #201.

## Symptoms

- `POST /receipts` returned 429 once a burst passed 50 receipts in one window.
- The UI showed "Receipt unavailable: …" (`apps/client/src/ui/surface.tsx:460-462`), and the error stayed visible.

## What Didn't Work

Each step fixed the previous one and left a defect that reproduced:

1. **Pacing that only drained on the next frame.** Deferring the surplus and re-presenting it on the next frame stalled whenever frames stopped, for example while the world was paused.
2. **Freeing a slot at exactly 1000 ms.** The service's window resets only after more than 1000 ms, so 40 receipts at T and 40 at T+1000 still landed in one service window.
3. **Detecting a new session only when presenting.** A session change during a realm with nothing drawn left the old session's held receipts draining.
4. **Letting the shell stamp the session.** The shell stamped each relay with the session current at send time, so a held receipt that drained after a sidecar restart was recorded under a session that never drew it.

## Solution

- **Pace under the limit** (`apps/client/src/receipts.ts:22-23`):

  ```ts
  /** Relays allowed in any second; the service's own limit is 50 (`RECEIPT_LIMIT_PER_WINDOW` in the simulation server), kept clear of by a margin for timing jitter. */
  export const RECEIPT_RATE_PER_SECOND = 40;
  ```

- **Own the queue, and free a slot only after more than a second** (`receipts.ts:165-168`). The emitter drains on its own scheduler, with no frame needed:

  ```ts
      if (held.length > 0 && oldest !== undefined) {
        const frees = oldest + RATE_WINDOW_MS + 1;
        cancelDrain = schedule(drain, Math.max(1, frees - at));
      }
  ```

- **Tell the emitter every frame's session.** `App.tsx` calls `observeSession` on each accepted frame (`apps/client/src/App.tsx:148`). A change drops the held queue and its timer, whether or not anything is drawn.
- **Carry the drawn session on every receipt, and refuse a stale one in the shell** (`apps/desktop/src-tauri/src/proxy.rs:277-281`). The client drops a `stale-session` refusal: it is not reported or retried.

  ```rust
      match current_session {
          None => Err("no frame received yet".to_string()),
          Some(current) if current != presented_session => Err(STALE_SESSION.to_string()),
          Some(_) => present_event(port, token, presented_session, event_id).await,
      }
  ```

  The check lives in the shell because the service's `/receipts` doesn't validate the session, and the shell is the app's only relay.

## Why This Works

The limiter counts the way the service counts, so no service window holds more than 40 of the client's receipts. Every receipt names the session it was drawn under, so attribution can't move.

## Prevention

A client-side rate limiter for a server limit has to:
- match the server's window semantics exactly, including whether the boundary is strict;
- own its queue instead of borrowing someone else's cadence;
- bind each item to the identity it was produced under.

Test the client's pace against the real handler with an injected clock, not just against a send counter.

- `apps/simulation/src/server.test.ts:418`: the real limiter accepts 50 at T, refuses the 51st and a receipt at T+1000, and accepts one at T+1001.
- `apps/simulation/src/server.test.ts:446`: the client's pace never draws a 429 from the real handler at T, T+1000 and T+1001, and delivers every receipt.
- `apps/client/src/receipts.test.ts:214`: observing a new session drops held receipts and their timer even when nothing is presented.
- `apps/client/src/receipts.test.ts:304`: a window drawn once is delivered in full by the drain alone.
- `apps/client/src/receipts.test.ts:371`: a held receipt refused as stale is dropped, not reported, and not retried.

## Related

- [Client view presentation logic was written and tested against invented events and maps](client-view-presentation-against-invented-fixtures-2026-09-28.md)
- [ADR-0008: World state and client transport](../../decisions/0008-world-state-and-client-transport.md)
