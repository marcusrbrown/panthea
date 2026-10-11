// Test support: a clock and scheduler that move only when a test advances them,
// so paced code is exercised with no real timers. It lives outside `src`, so no
// production build reaches it; `src/test-boundary.test.ts` keeps it that way.

export interface FakeClock {
  now(): number;
  schedule(run: () => void, delayMs: number): () => void;
  /** Timers armed and not yet fired or cancelled. */
  pending(): number;
  /** Moves time forward, firing each due timer in order and letting its promises settle. */
  advance(ms: number): Promise<void>;
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

export function fakeClock(start = 0): FakeClock {
  let now = start;
  let next = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => now,
    schedule(run, delayMs) {
      const id = next;
      next += 1;
      timers.set(id, { at: now + delayMs, run });
      return () => {
        timers.delete(id);
      };
    },
    pending: () => timers.size,
    async advance(ms) {
      if (ms < 0) throw new Error("fake-clock: time only moves forward");
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].run();
        await settle();
      }
      now = target;
      await settle();
    },
  };
}
