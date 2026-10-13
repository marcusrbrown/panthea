import { expect, test } from "bun:test";
import type { Realm } from "@panthea/contracts";

import type { WorldViewModel } from "../store";
import {
  drawScene,
  type FrameScheduler,
  startFrameLoop,
  startSceneRenderer,
} from "./lifecycle";
import type { WorldRenderer } from "./scene";

const canvas = {} as HTMLCanvasElement;

const view = { sessionId: "session-1" } as unknown as WorldViewModel;

interface FakeRenderer extends WorldRenderer {
  readonly disposed: () => number;
  readonly triggerDeviceLost: () => void;
  readonly resolveStart: () => void;
  readonly rejectStart: (error: unknown) => void;
}

function fakeRenderer(
  options: {
    readonly drawIds?: readonly string[];
    readonly drawError?: Error;
  } = {},
): FakeRenderer {
  let disposals = 0;
  let onLost: (() => void) | undefined;
  let resolve: () => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const started = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    start(onDeviceLost) {
      onLost = onDeviceLost;
      return started;
    },
    draw(_view: WorldViewModel, _realm: Realm) {
      if (options.drawError) return Promise.reject(options.drawError);
      return Promise.resolve(options.drawIds ?? []);
    },
    tick: () => {},
    dispose() {
      disposals += 1;
    },
    disposed: () => disposals,
    triggerDeviceLost: () => onLost?.(),
    resolveStart: () => resolve(),
    rejectStart: (error) => reject(error),
  };
}

function handlers() {
  const log: string[] = [];
  return {
    log,
    handlers: {
      onStarted: () => log.push("started"),
      onFailure: (message: string) => log.push(`failure:${message}`),
      onDeviceLost: () => log.push("device-lost"),
    },
  };
}

/** Lets every settled promise run its continuation; no timer, no clock. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

test("a renderer that starts reports started once", async () => {
  const renderer = fakeRenderer();
  const seen = handlers();

  const session = startSceneRenderer(canvas, () => renderer, seen.handlers);
  expect(session.renderer).toBe(renderer);
  expect(seen.log).toEqual([]);
  renderer.resolveStart();
  await settle();

  expect(seen.log).toEqual(["started"]);
});

test("a renderer factory that throws reports the failure and leaves no renderer to dispose", () => {
  const seen = handlers();

  const session = startSceneRenderer(
    canvas,
    () => {
      throw new Error("WebGPU unavailable");
    },
    seen.handlers,
  );

  expect(session.renderer).toBeUndefined();
  expect(seen.log).toEqual(["failure:WebGPU unavailable"]);
  expect(() => session.dispose()).not.toThrow();
});

test("a non-Error thrown by the factory is reported as text", () => {
  const seen = handlers();

  startSceneRenderer(
    canvas,
    () => {
      throw "no adapter";
    },
    seen.handlers,
  );

  expect(seen.log).toEqual(["failure:no adapter"]);
});

test("a start that rejects reports the failure and never reports started", async () => {
  const renderer = fakeRenderer();
  const seen = handlers();
  startSceneRenderer(canvas, () => renderer, seen.handlers);

  renderer.rejectStart(new Error("device init failed"));
  await settle();

  expect(seen.log).toEqual(["failure:device init failed"]);
});

test("a start that resolves or rejects after dispose reports nothing", async () => {
  const late = fakeRenderer();
  const lateSeen = handlers();
  const lateSession = startSceneRenderer(canvas, () => late, lateSeen.handlers);
  lateSession.dispose();
  late.resolveStart();
  await settle();

  const failing = fakeRenderer();
  const failingSeen = handlers();
  const failingSession = startSceneRenderer(
    canvas,
    () => failing,
    failingSeen.handlers,
  );
  failingSession.dispose();
  failing.rejectStart(new Error("too late"));
  await settle();

  expect(lateSeen.log).toEqual([]);
  expect(failingSeen.log).toEqual([]);
});

test("device loss is reported once however many times the renderer signals it", () => {
  const renderer = fakeRenderer();
  const seen = handlers();
  startSceneRenderer(canvas, () => renderer, seen.handlers);

  renderer.triggerDeviceLost();
  renderer.triggerDeviceLost();

  expect(seen.log).toEqual(["device-lost"]);
});

test("device loss after dispose is ignored", () => {
  const renderer = fakeRenderer();
  const seen = handlers();
  const session = startSceneRenderer(canvas, () => renderer, seen.handlers);

  session.dispose();
  renderer.triggerDeviceLost();

  expect(seen.log).toEqual([]);
});

test("dispose disposes the renderer it started", () => {
  const renderer = fakeRenderer();
  const session = startSceneRenderer(
    canvas,
    () => renderer,
    handlers().handlers,
  );

  session.dispose();

  expect(renderer.disposed()).toBe(1);
});

test("a start that throws synchronously is reported as a failure", () => {
  const renderer: WorldRenderer = {
    start() {
      throw new Error("start exploded");
    },
    draw: () => Promise.resolve([]),
    tick: () => {},
    dispose: () => {},
  };
  const seen = handlers();

  startSceneRenderer(canvas, () => renderer, seen.handlers);

  expect(seen.log).toEqual(["failure:start exploded"]);
});

test("drawing hands the ids the renderer drew to onDrawn", async () => {
  const renderer = fakeRenderer({ drawIds: ["fire-1", "trade-1"] });
  const drawn: (readonly string[])[] = [];
  const failures: string[] = [];

  await drawScene(renderer, view, "mortal", {
    onDrawn: (ids) => drawn.push(ids),
    onFailure: (message) => failures.push(message),
  });

  expect(drawn).toEqual([["fire-1", "trade-1"]]);
  expect(failures).toEqual([]);
});

test("ids are handed on only once the frame is on screen, not when the draw begins", async () => {
  let finish: (ids: readonly string[]) => void = () => {};
  const renderer: WorldRenderer = {
    ...fakeRenderer(),
    draw: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  };
  const drawn: (readonly string[])[] = [];

  const drawing = drawScene(renderer, view, "mortal", {
    onDrawn: (ids) => drawn.push(ids),
    onFailure: () => {},
  });
  await settle();
  expect(drawn).toEqual([]);

  finish(["fire-1"]);
  await drawing;
  expect(drawn).toEqual([["fire-1"]]);
});

test("a draw error is reported as a failure and nothing is receipted", async () => {
  const renderer = fakeRenderer({ drawError: new Error("render pass failed") });
  const drawn: (readonly string[])[] = [];
  const failures: string[] = [];

  await drawScene(renderer, view, "mortal", {
    onDrawn: (ids) => drawn.push(ids),
    onFailure: (message) => failures.push(message),
  });

  expect(drawn).toEqual([]);
  expect(failures).toEqual(["render pass failed"]);
});

test("drawing with no renderer draws nothing and receipts nothing", async () => {
  const drawn: (readonly string[])[] = [];

  await drawScene(undefined, view, "mortal", {
    onDrawn: (ids) => drawn.push(ids),
    onFailure: () => {},
  });

  expect(drawn).toEqual([[]]);
});

/** A frame scheduler the test drives by hand: no timers, no animation frames. */
function manualScheduler() {
  let next: ((nowMs: number) => void) | undefined;
  let cancelled = 0;
  const scheduler: FrameScheduler = {
    request(callback) {
      next = callback;
      return 1;
    },
    cancel() {
      cancelled += 1;
      next = undefined;
    },
  };
  return {
    scheduler,
    frame(nowMs: number) {
      const callback = next;
      next = undefined;
      callback?.(nowMs);
    },
    pending: () => next !== undefined,
    cancelled: () => cancelled,
  };
}

test("the frame loop ticks the renderer by the delta between frames, starting from zero", () => {
  const deltas: number[] = [];
  const renderer: WorldRenderer = {
    ...fakeRenderer(),
    tick: (deltaMs) => deltas.push(deltaMs),
  };
  const clock = manualScheduler();

  startFrameLoop(renderer, clock.scheduler);
  clock.frame(1000);
  clock.frame(1016);
  clock.frame(1350);

  expect(deltas).toEqual([0, 16, 334]);
  expect(clock.pending()).toBe(true);
});

test("stopping the frame loop cancels the pending frame and ticks no more", () => {
  const deltas: number[] = [];
  const renderer: WorldRenderer = {
    ...fakeRenderer(),
    tick: (deltaMs) => deltas.push(deltaMs),
  };
  const clock = manualScheduler();

  const stop = startFrameLoop(renderer, clock.scheduler);
  clock.frame(10);
  stop();
  clock.frame(20);
  stop();

  expect(deltas).toEqual([0]);
  expect(clock.pending()).toBe(false);
  expect(clock.cancelled()).toBeGreaterThanOrEqual(1);
});

test("a tick that throws does not stop the loop", () => {
  let calls = 0;
  const renderer: WorldRenderer = {
    ...fakeRenderer(),
    tick: () => {
      calls += 1;
      if (calls === 1) throw new Error("tick failed");
    },
  };
  const clock = manualScheduler();

  startFrameLoop(renderer, clock.scheduler);
  clock.frame(0);
  clock.frame(16);

  expect(calls).toBe(2);
});
