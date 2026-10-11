import { expect, test } from "bun:test";
import type { RecentEvent } from "@panthea/contracts";
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
  const sent: string[] = [];
  const errors: ReceiptError[] = [];
  let clock = 0;
  const emitter = createReceiptEmitter({
    presentEvent: async (eventId) => {
      sent.push(eventId);
    },
    onError: (error) => errors.push(error),
    now: () => clock,
    ...(maxPerSecond === undefined ? {} : { maxPerSecond }),
  });
  return {
    emitter,
    sent,
    errors,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const ids = (count: number, from = 0) =>
  Array.from({ length: count }, (_, index) => `evt-1-${from + index}`);

test("a burst past the per-second rate defers the surplus unsent and unreported, and each goes out once the window moves on", async () => {
  const { emitter, sent, errors, advance } = rated(3);
  const burst = ids(5);

  const first = await Promise.all(
    burst.map((id) => emitter.present("session-1", id)),
  );
  expect(first).toEqual(["sent", "sent", "sent", "deferred", "deferred"]);
  expect(sent).toEqual(burst.slice(0, 3));

  // Still inside the second: nothing more may go out.
  advance(999);
  expect(await emitter.present("session-1", "evt-1-3")).toBe("deferred");
  expect(sent).toHaveLength(3);

  advance(1);
  const later = await Promise.all(
    burst.map((id) => emitter.present("session-1", id)),
  );
  expect(later).toEqual([
    "duplicate",
    "duplicate",
    "duplicate",
    "sent",
    "sent",
  ]);
  expect(sent).toEqual(burst);
  expect(errors).toEqual([]);
});

test("a deferred event is not marked attempted, so presenting it again later sends it", async () => {
  const { emitter, sent, advance } = rated(1);

  await emitter.present("session-1", "evt-1-1");
  expect(await emitter.present("session-1", "evt-1-2")).toBe("deferred");
  advance(1000);

  expect(await emitter.present("session-1", "evt-1-2")).toBe("sent");
  expect(sent).toEqual(["evt-1-1", "evt-1-2"]);
});

test("frames that each re-present a ten-tick window of drawable events never send more than the service accepts in a second, and send every event once", async () => {
  // The service answers 429 past 50 receipts in a second. A realm switch back
  // to a realm that was not drawing receipts, or the first frame after a
  // stall, presents the whole window at once.
  const SERVICE_LIMIT = 50;
  const { emitter, sent, errors, advance } = rated();
  const window = ids(120);

  const frames = [0, 1, 2, 3];
  for (const frame of frames) {
    await receiptDrawnEvents(
      "session-1",
      window.map((id) => ({ id: id as RecentEvent["id"] })),
      emitter,
    );
    expect(sent.length).toBeLessThanOrEqual((frame + 1) * (SERVICE_LIMIT - 1));
    advance(1000);
  }

  expect(sent).toEqual(window);
  expect(new Set(sent).size).toBe(sent.length);
  expect(errors).toEqual([]);
});

test("the default rate leaves headroom under the service's 50 per second", async () => {
  const { emitter, sent } = rated();

  await Promise.all(ids(80).map((id) => emitter.present("session-1", id)));

  expect(sent.length).toBe(RECEIPT_RATE_PER_SECOND);
  expect(RECEIPT_RATE_PER_SECOND).toBeLessThan(50);
});
