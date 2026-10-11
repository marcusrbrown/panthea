import { expect, test } from "bun:test";
import type { RecentEvent } from "@panthea/contracts";
import { fakeClock } from "../test/fake-clock";
import {
  createReceiptEmitter,
  RECEIPT_RATE_PER_SECOND,
  type ReceiptError,
} from "./receipts";
import { receiptDrawnEvents } from "./renderer/presentation";

function harness(options: { readonly failFor?: ReadonlySet<string> } = {}) {
  const sent: string[] = [];
  const errors: ReceiptError[] = [];
  const emitter = createReceiptEmitter({
    presentEvent: async (eventId) => {
      sent.push(eventId);
      if (options.failFor?.has(eventId)) {
        throw new Error("relay failed");
      }
    },
    onError: (error) => errors.push(error),
  });
  return { emitter, sent, errors };
}

test("an event drawn for the first time is receipted once", async () => {
  const { emitter, sent } = harness();

  expect(await emitter.present("session-1", "evt-1-1")).toBe("sent");

  expect(sent).toEqual(["evt-1-1"]);
});

test("the same event in the same session is receipted only once", async () => {
  const { emitter, sent } = harness();

  await emitter.present("session-1", "evt-1-1");
  expect(await emitter.present("session-1", "evt-1-1")).toBe("duplicate");
  expect(await emitter.present("session-1", "evt-1-1")).toBe("duplicate");

  expect(sent).toEqual(["evt-1-1"]);
});

test("different events in one session are each receipted", async () => {
  const { emitter, sent } = harness();

  await emitter.present("session-1", "evt-1-1");
  await emitter.present("session-1", "evt-1-2");

  expect(sent).toEqual(["evt-1-1", "evt-1-2"]);
});

test("a session change resets the dedup set, so the same event id is receipted again", async () => {
  const { emitter, sent } = harness();

  await emitter.present("session-1", "evt-1-1");
  await emitter.present("session-2", "evt-1-1");
  expect(await emitter.present("session-2", "evt-1-1")).toBe("duplicate");

  expect(sent).toEqual(["evt-1-1", "evt-1-1"]);
});

test("two draws of the same event racing in one session send one receipt", async () => {
  const { emitter, sent } = harness();

  const results = await Promise.all([
    emitter.present("session-1", "evt-1-1"),
    emitter.present("session-1", "evt-1-1"),
  ]);

  expect([...results].sort()).toEqual(["duplicate", "sent"]);
  expect(sent).toEqual(["evt-1-1"]);
});

test("a failed receipt is reported once and not retried automatically", async () => {
  const { emitter, sent, errors } = harness({
    failFor: new Set(["evt-1-1"]),
  });

  expect(await emitter.present("session-1", "evt-1-1")).toBe("failed");
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(sent).toEqual(["evt-1-1"]);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatchObject({
    eventId: "evt-1-1",
    sessionId: "session-1",
  });
});

test("after a failure the caller can present the same event again", async () => {
  const failing = new Set(["evt-1-1"]);
  const { emitter, sent } = harness({ failFor: failing });

  await emitter.present("session-1", "evt-1-1");
  failing.delete("evt-1-1");
  expect(await emitter.present("session-1", "evt-1-1")).toBe("sent");

  expect(sent).toEqual(["evt-1-1", "evt-1-1"]);
});

test("a failure from an earlier session does not unmark the current session's receipt", async () => {
  let release: (() => void) | undefined;
  const sent: string[] = [];
  const emitter = createReceiptEmitter({
    presentEvent: (eventId) => {
      sent.push(eventId);
      if (sent.length === 1) {
        return new Promise<void>((_resolve, reject) => {
          release = () => reject(new Error("late failure"));
        });
      }
      return Promise.resolve();
    },
    onError: () => {},
  });

  const first = emitter.present("session-1", "evt-1-1");
  await emitter.present("session-2", "evt-1-1");
  release?.();
  await first;

  expect(await emitter.present("session-2", "evt-1-1")).toBe("duplicate");
  expect(sent).toEqual(["evt-1-1", "evt-1-1"]);
});

function rated(maxPerSecond?: number) {
  const sent: { id: string; at: number }[] = [];
  const errors: ReceiptError[] = [];
  const clock = fakeClock();
  const emitter = createReceiptEmitter({
    presentEvent: async (eventId) => {
      sent.push({ id: eventId, at: clock.now() });
    },
    onError: (error) => errors.push(error),
    now: clock.now,
    schedule: clock.schedule,
    ...(maxPerSecond === undefined ? {} : { maxPerSecond }),
  });
  return {
    emitter,
    sent,
    sentIds: () => sent.map((relay) => relay.id),
    errors,
    clock,
  };
}

const ids = (count: number, from = 0) =>
  Array.from({ length: count }, (_, index) => `evt-1-${from + index}`);

test("a burst past the per-second rate is held, and the emitter drains it on its own as slots free, with no further draw", async () => {
  const { emitter, sentIds, errors, clock } = rated(3);
  const burst = ids(5);

  const first = await Promise.all(
    burst.map((id) => emitter.present("session-1", id)),
  );
  expect(first).toEqual(["sent", "sent", "sent", "deferred", "deferred"]);
  expect(sentIds()).toEqual(burst.slice(0, 3));

  // A slot frees only when a relay is more than a second old.
  await clock.advance(1000);
  expect(sentIds()).toEqual(burst.slice(0, 3));

  await clock.advance(1);
  expect(sentIds()).toEqual(burst);
  expect(clock.pending()).toBe(0);
  expect(errors).toEqual([]);
});

test("a held event presented again is not sent twice, and once drained it is a duplicate", async () => {
  const { emitter, sentIds, clock } = rated(1);

  await emitter.present("session-1", "evt-1-1");
  expect(await emitter.present("session-1", "evt-1-2")).toBe("deferred");
  expect(await emitter.present("session-1", "evt-1-2")).toBe("deferred");

  await clock.advance(1001);
  expect(sentIds()).toEqual(["evt-1-1", "evt-1-2"]);
  expect(await emitter.present("session-1", "evt-1-2")).toBe("duplicate");
  expect(sentIds()).toEqual(["evt-1-1", "evt-1-2"]);
});

test("held events go out in the order they were drawn, and a new one never jumps the queue", async () => {
  const { emitter, sentIds, clock } = rated(1);

  await emitter.present("session-1", "evt-1-1");
  await emitter.present("session-1", "evt-1-2");
  await emitter.present("session-1", "evt-1-3");
  await clock.advance(1001);
  await emitter.present("session-1", "evt-1-4");
  await clock.advance(1001);
  await clock.advance(1001);

  expect(sentIds()).toEqual(["evt-1-1", "evt-1-2", "evt-1-3", "evt-1-4"]);
});

test("a session change drops the held events and their timer, and the new session relays its own", async () => {
  const { emitter, sentIds, clock } = rated(1);

  await emitter.present("session-1", "evt-1-1");
  await emitter.present("session-1", "evt-1-2");
  expect(clock.pending()).toBe(1);

  expect(await emitter.present("session-2", "evt-2-1")).toBe("deferred");
  await clock.advance(1001);

  expect(sentIds()).toEqual(["evt-1-1", "evt-2-1"]);
  expect(clock.pending()).toBe(0);
});

test("disposal drops the held events and cancels the drain, and later presents start afresh", async () => {
  const { emitter, sentIds, clock } = rated(1);

  await emitter.present("session-1", "evt-1-1");
  await emitter.present("session-1", "evt-1-2");
  emitter.dispose();
  expect(clock.pending()).toBe(0);

  await clock.advance(5000);
  expect(sentIds()).toEqual(["evt-1-1"]);

  // The emitter is memoised across a development remount, so it must work after.
  expect(await emitter.present("session-1", "evt-1-3")).toBe("sent");
});

test("a held relay that fails is reported with its event and session, and is not retried until presented again", async () => {
  const errors: ReceiptError[] = [];
  const attempts: string[] = [];
  const failing = new Set(["evt-1-2"]);
  const clock = fakeClock();
  const emitter = createReceiptEmitter({
    presentEvent: async (eventId) => {
      attempts.push(eventId);
      if (failing.has(eventId)) throw new Error("rate limited");
    },
    onError: (error) => errors.push(error),
    now: clock.now,
    schedule: clock.schedule,
    maxPerSecond: 1,
  });

  await emitter.present("session-1", "evt-1-1");
  await emitter.present("session-1", "evt-1-2");
  await clock.advance(1001);
  await clock.advance(5000);

  expect(attempts).toEqual(["evt-1-1", "evt-1-2"]);
  expect(errors).toEqual([
    { sessionId: "session-1", eventId: "evt-1-2", message: "rate limited" },
  ]);

  failing.clear();
  expect(await emitter.present("session-1", "evt-1-2")).toBe("sent");
});

test("a window of drawn events drawn once is delivered in full by the drain alone, never more than the pace in any second", async () => {
  // A realm switched back to presents its whole window at once, and when the
  // world is paused no later frame presents it again.
  const SERVICE_LIMIT = 50;
  const { emitter, sent, sentIds, errors, clock } = rated();
  const window = ids(120);

  await receiptDrawnEvents(
    "session-1",
    window.map((id) => ({ id: id as RecentEvent["id"] })),
    emitter,
  );
  for (let second = 0; second < 4; second += 1) await clock.advance(1001);

  expect(sentIds()).toEqual(window);
  expect(new Set(sentIds()).size).toBe(window.length);
  for (const relay of sent) {
    const inSecond = sent.filter(
      (other) => other.at >= relay.at && other.at <= relay.at + 1000,
    );
    expect(inSecond.length).toBeLessThan(SERVICE_LIMIT);
  }
  expect(errors).toEqual([]);
});

test("the default rate leaves headroom under the service's 50 per second", async () => {
  const { emitter, sentIds } = rated();

  await Promise.all(ids(80).map((id) => emitter.present("session-1", id)));

  expect(sentIds()).toHaveLength(RECEIPT_RATE_PER_SECOND);
  expect(RECEIPT_RATE_PER_SECOND).toBeLessThan(50);
});
