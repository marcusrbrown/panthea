import { describe, expect, test } from "bun:test";
import {
  canonicalJson,
  catchUpIdentity,
  check,
  corruptArchiveBytes,
  createStepRecorder,
  expectedBurnTicks,
  instantiate,
  mapLimit,
  ScenarioFailure,
  waitFor,
} from "./helpers";

describe("instantiate", () => {
  test("replaces exact placeholders at any depth and leaves other values alone", () => {
    const template = {
      observation: { id: "$observationId", stateRevision: "$sequence" },
      proposal: {
        targets: ["the-tavern"],
        expectedRevisions: [{ entityId: "the-tavern", revision: "$revision" }],
        power: 3,
      },
    };
    const result = instantiate(template, {
      $observationId: "obs-1",
      $sequence: 42,
      $revision: 7,
    });
    expect(result).toEqual({
      observation: { id: "obs-1", stateRevision: 42 },
      proposal: {
        targets: ["the-tavern"],
        expectedRevisions: [{ entityId: "the-tavern", revision: 7 }],
        power: 3,
      },
    });
  });

  test("does not mutate the template", () => {
    const template = { id: "$id" };
    instantiate(template, { $id: "x" });
    expect(template).toEqual({ id: "$id" });
  });

  test("a placeholder with no value is an error, not a pass-through", () => {
    expect(() => instantiate({ id: "$missing" }, {})).toThrow("$missing");
  });
});

describe("corruptArchiveBytes", () => {
  test("changes exactly one byte, at the first occurrence of the marker", () => {
    const bytes = new TextEncoder().encode('xx {"kind":"a"} yy {"kind":"a"}');
    const corrupted = corruptArchiveBytes(bytes, '"kind":"a"');
    const differing = [...bytes].flatMap((byte, index) =>
      byte === corrupted[index] ? [] : [index],
    );
    expect(differing).toEqual([Buffer.from(bytes).indexOf('"kind":"a"')]);
  });

  test("leaves the input untouched", () => {
    const bytes = new TextEncoder().encode("abc marker def");
    const before = [...bytes];
    corruptArchiveBytes(bytes, "marker");
    expect([...bytes]).toEqual(before);
  });

  test("a marker that is not in the archive is an error", () => {
    expect(() =>
      corruptArchiveBytes(new TextEncoder().encode("abc"), "nope"),
    ).toThrow("not found");
  });
});

describe("catchUpIdentity", () => {
  const baseline = { tick: 100, backdatedCursorMs: 1_000_000 };

  test("holds when ticks advanced equal whole cursor seconds", () => {
    const result = catchUpIdentity(baseline, {
      tick: 160,
      cursorWallMs: 1_060_400,
    });
    expect(result).toEqual({
      ok: true,
      ticksAdvanced: 60,
      ticksForCursorAdvance: 60,
    });
  });

  test("fails when an interval was applied twice", () => {
    const result = catchUpIdentity(baseline, {
      tick: 220,
      cursorWallMs: 1_060_000,
    });
    expect(result.ok).toBe(false);
    expect(result.ticksAdvanced).toBe(120);
  });

  test("fails when an interval was dropped", () => {
    expect(
      catchUpIdentity(baseline, { tick: 130, cursorWallMs: 1_060_000 }).ok,
    ).toBe(false);
  });
});

describe("expectedBurnTicks", () => {
  test("ignition to destruction at growth 1 and destroy at 3 shows two burn ticks", () => {
    expect(expectedBurnTicks(3, 1)).toBe(2);
  });

  test("a coarser growth rate shortens the burn", () => {
    expect(expectedBurnTicks(3, 2)).toBe(1);
    expect(expectedBurnTicks(4, 2)).toBe(1);
  });
});

describe("check", () => {
  test("throws a ScenarioFailure that names the invariant", () => {
    try {
      check(false, "the tavern burns", "it stayed operational");
      throw new Error("check did not throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ScenarioFailure);
      expect((error as ScenarioFailure).invariant).toBe("the tavern burns");
      expect((error as ScenarioFailure).message).toContain(
        "it stayed operational",
      );
    }
  });

  test("returns quietly when the condition holds", () => {
    expect(() => check(true, "x", "y")).not.toThrow();
  });
});

describe("waitFor", () => {
  test("returns the first defined probe value", async () => {
    let calls = 0;
    const value = await waitFor(
      "eventually",
      () => {
        calls += 1;
        return calls >= 3 ? calls : undefined;
      },
      { timeoutMs: 1000, intervalMs: 1 },
    );
    expect(value).toBe(3);
  });

  test("times out with a failure naming the invariant", async () => {
    await expect(
      waitFor("the fire spreads", () => undefined, {
        timeoutMs: 20,
        intervalMs: 5,
      }),
    ).rejects.toThrow("the fire spreads");
  });
});

describe("createStepRecorder", () => {
  test("records the result and measurements a step reports, with elapsed time", async () => {
    let now = 1000;
    const recorder = createStepRecorder(
      () => {},
      () => now,
    );
    await recorder.run("S1", "Seed", "the world loads", async (step) => {
      now += 250;
      step.done("15 locations", [
        { name: "locations", unit: "count", value: 15 },
      ]);
    });
    expect(recorder.results).toEqual([
      {
        id: "S1",
        title: "Seed",
        invariant: "the world loads",
        result: "15 locations",
        measurements: [{ name: "locations", unit: "count", value: 15 }],
        notes: [],
        elapsedMs: 250,
      },
    ]);
  });

  test("a step that never reports is an error", async () => {
    const recorder = createStepRecorder();
    await expect(
      recorder.run("S1", "Seed", "x", async () => {}),
    ).rejects.toThrow("without recording");
  });

  test("a failing step records nothing and propagates the failure", async () => {
    const recorder = createStepRecorder();
    await expect(
      recorder.run("S1", "Seed", "x", async () => {
        check(false, "x", "broke");
      }),
    ).rejects.toBeInstanceOf(ScenarioFailure);
    expect(recorder.results).toEqual([]);
  });
});

describe("canonicalJson", () => {
  test("gives equal text for objects that differ only in key order, at any depth", () => {
    const a = { id: "e1", payload: { b: 1, a: [{ y: 2, x: 1 }] } };
    const b = { payload: { a: [{ x: 1, y: 2 }], b: 1 }, id: "e1" };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  test("still tells different values apart, including array order", () => {
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });

  test("treats an absent key and an undefined value alike", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });
});

describe("mapLimit", () => {
  test("never runs more than the limit at once, and keeps the items' order whatever order they finish in", async () => {
    let running = 0;
    let peak = 0;
    const items = [40, 5, 30, 1, 20, 10];
    const results = await mapLimit(items, 3, async (ms) => {
      running += 1;
      peak = Math.max(peak, running);
      await Bun.sleep(ms);
      running -= 1;
      return `done-${ms}`;
    });
    expect(results).toEqual(items.map((ms) => `done-${ms}`));
    expect(peak).toBe(3);
  });

  test("a limit of one runs them one after another, and a limit above the item count runs them all", async () => {
    const order: string[] = [];
    await mapLimit(["a", "b", "c"], 1, async (item) => {
      order.push(`start-${item}`);
      await Bun.sleep(5);
      order.push(`end-${item}`);
    });
    expect(order).toEqual([
      "start-a",
      "end-a",
      "start-b",
      "end-b",
      "start-c",
      "end-c",
    ]);
    expect(await mapLimit([1, 2], 10, async (n) => n * 2)).toEqual([2, 4]);
    expect(await mapLimit([], 4, async (n: number) => n)).toEqual([]);
  });

  test("the first failure rejects and no further item starts", async () => {
    const started: number[] = [];
    await expect(
      mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
        started.push(n);
        await Bun.sleep(5);
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
    await Bun.sleep(30);
    expect(started).toEqual([1, 2, 3]);
  });
});
