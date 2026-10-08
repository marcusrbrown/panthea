import { afterEach, describe, expect, test } from "bun:test";
import type { StudioRuntime, StudioSession } from "@panthea/assets/studio";
import type { StudioConfig } from "./config";
import { type Deps, defaultDeps, Studio } from "./host";

// The progress poll must never starve the drain it reports on. These tests run
// the real `Studio.kick` on a virtual event loop: no real timers, no processes,
// and a store whose full status read costs virtual time.
//
// The loop models what a real run showed: a repeating timer whose callback
// outlasts its period is due again the moment it returns, and due timers run
// before pending I/O, so such a poll leaves the drain's I/O no turn at all.

type Timer = {
  due: number;
  fn: () => void;
  repeat: number | undefined;
};

class VirtualLoop {
  now = 0;
  /** True while a timer callback is running. */
  inTimer = false;
  private next = 1;
  private readonly timers = new Map<number, Timer>();
  private readonly pending: { due: number; resume: () => void }[] = [];

  setTimeout = (fn: () => void, ms = 0) => this.arm(fn, ms, undefined);
  setInterval = (fn: () => void, ms = 0) => this.arm(fn, ms, ms);
  clear = (id: unknown) => {
    this.timers.delete(id as number);
  };

  /** A promise the loop settles in its I/O phase, `ms` of virtual time from now. */
  io = (ms = 50) =>
    new Promise<void>((resolve) =>
      this.pending.push({ due: this.now + ms, resume: resolve }),
    );

  private arm(fn: () => void, ms: number, repeat: number | undefined) {
    const id = this.next++;
    this.timers.set(id, { due: this.now + ms, fn, repeat });
    return id as unknown as ReturnType<typeof setTimeout>;
  }

  /** Runs turns until `done`, or `maxTurns` turns pass; false means starved or stuck. */
  async run(done: () => boolean, maxTurns = 5000): Promise<boolean> {
    for (let turn = 0; turn < maxTurns; turn += 1) {
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      if (done()) return true;
      const due = [...this.timers.entries()]
        .filter(([, t]) => t.due <= this.now)
        .sort(([, a], [, b]) => a.due - b.due)[0];
      if (due !== undefined) {
        const [id, timer] = due;
        if (timer.repeat === undefined) this.timers.delete(id);
        else timer.due += timer.repeat;
        this.inTimer = true;
        try {
          timer.fn();
        } finally {
          this.inTimer = false;
        }
        continue;
      }
      const ready = this.pending
        .filter((p) => p.due <= this.now)
        .sort((a, b) => a.due - b.due)[0];
      if (ready !== undefined) {
        this.pending.splice(this.pending.indexOf(ready), 1);
        ready.resume();
        continue;
      }
      const soonest = Math.min(
        ...[...this.timers.values()].map((t) => t.due),
        ...this.pending.map((p) => p.due),
      );
      if (!Number.isFinite(soonest)) return done();
      this.now = soonest;
    }
    return false;
  }
}

const real = {
  setTimeout: globalThis.setTimeout,
  setInterval: globalThis.setInterval,
  clearTimeout: globalThis.clearTimeout,
  clearInterval: globalThis.clearInterval,
};
afterEach(() => Object.assign(globalThis, real));

interface Rig {
  readonly loop: VirtualLoop;
  readonly studio: Studio;
  readonly log: string[];
  /** Calls to the store's full status read made while a timer callback ran. */
  readonly pollStatusReads: () => number;
  readonly finished: () => boolean;
}

/** A Studio over a fake session whose full status read costs `statusMs` of virtual time and whose one queued job takes a few I/O turns. */
function rig(opts: { pollMs: number; statusMs: number }): Rig {
  const loop = new VirtualLoop();
  Object.assign(globalThis, {
    setTimeout: loop.setTimeout,
    setInterval: loop.setInterval,
    clearTimeout: loop.clear,
    clearInterval: loop.clear,
  });
  const log: string[] = [];
  let polled = 0;
  const jobs = new Map([
    ["j-0000", { job: { id: "j-0000", status: "queued" } }],
  ]);
  const slow = () => {
    if (loop.inTimer) polled += 1;
    loop.now += opts.statusMs;
  };
  const live = () =>
    [...jobs.values()].filter((r) => r.job.status === "queued");
  const session = {
    recovered: [],
    store: {
      status: () => {
        slow();
        return { jobs: [...jobs.values()] };
      },
      readJob: (id: string) => {
        const value = jobs.get(id);
        return value === undefined
          ? { kind: "missing" }
          : { kind: "found", value };
      },
    },
    queued: () => {
      loop.now += opts.statusMs;
      return { ok: true, jobs: live() };
    },
    close: () => undefined,
  } as unknown as StudioSession;
  const runtime: StudioRuntime = {
    async drain() {
      for (const record of live()) {
        await loop.io();
        record.job.status = "running";
        await loop.io();
        await loop.io();
        record.job.status = "succeeded";
      }
      return { ok: true, results: [], stopped: "empty" };
    },
    abort: async () => ({ ok: true }),
    close: async () => ({ ok: true }),
    shutdown: async () => ({ ok: true }),
  };
  const deps: Deps = {
    ...defaultDeps((line) => log.push(line)),
    openSession: () => ({ kind: "opened", session }),
    openRuntime: () => runtime,
    loadContent: () => ({ ok: true, content: {} as never }),
  };
  const config: StudioConfig = {
    studioRoot: "/studio",
    contentRoot: "/content",
    artifactRoot: "/artifacts",
    runtime: {
      port: 1,
      pollMs: opts.pollMs,
      deadlines: {
        httpMs: 1,
        startupMs: 1,
        generationMs: 1,
        termGraceMs: 1,
        killMs: 1,
      },
    },
  };
  const studio = new Studio(config, deps, "oneshot");
  const opened = studio.owner();
  if ("ok" in opened) throw new Error("no session");
  studio.runtimeFor(opened);
  let idle = false;
  studio.kick();
  void studio.idle().then(() => {
    idle = true;
  });
  return {
    loop,
    studio,
    log,
    pollStatusReads: () => polled,
    finished: () => idle,
  };
}

describe("the progress poll", () => {
  test("a poll whose store read outlasts its period still lets the drain run to completion", async () => {
    const r = rig({ pollMs: 100, statusMs: 150 });

    const done = await r.loop.run(r.finished);

    expect(done).toBe(true);
  });

  test("it makes progress whatever the poll period and the cost of reading the store", async () => {
    for (const pollMs of [1, 100, 1000])
      for (const statusMs of [0, 150, 5000]) {
        const r = rig({ pollMs, statusMs });

        expect(await r.loop.run(r.finished), `${pollMs}/${statusMs}`).toBe(
          true,
        );
        Object.assign(globalThis, real);
      }
  });

  test("a tick never reads the whole store, so its cost does not grow with the store", async () => {
    const r = rig({ pollMs: 100, statusMs: 150 });

    await r.loop.run(r.finished);

    expect(r.pollStatusReads()).toBe(0);
  });

  test("the job's transitions are reported in order, each once, ending in its final status", async () => {
    const r = rig({ pollMs: 100, statusMs: 150 });

    await r.loop.run(r.finished);

    const seen = r.log.filter((line) => line.startsWith("job j-0000 "));
    expect(seen[0]).toBe("job j-0000 queued");
    expect(seen.at(-1)).toBe("job j-0000 succeeded");
    expect(new Set(seen).size).toBe(seen.length);
  });
});
