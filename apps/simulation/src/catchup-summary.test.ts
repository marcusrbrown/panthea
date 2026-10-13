// The catch-up summary row: when a backlog closes, what it records, and when
// a new summary keeps or replaces the previous one's identity. These run on a
// real store with progress rows written directly; the end-to-end behavior
// (chunks, restarts, kills) is in catchup.test.ts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeStore,
  exportArchive,
  importArchive,
  openStore,
  readCatchUpProgress,
  readCatchUpSummary,
  writeCatchUpProgress,
  writeCatchUpSummary,
} from "@panthea/persistence";
import { DEFAULT_TICK_ELAPSED_MS } from "@panthea/world";
import {
  closeCatchUpBacklog,
  isNonEmptyAccount,
  recordPartialSummary,
} from "./catchup-summary";
import {
  createWorldProjectionReducers,
  loadGreekWorldState,
  worldImportReducers,
} from "./world-store";

let dir: string;
let store: ReturnType<typeof openStore>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "panthea-sim-catchup-summary-"));
  store = openStore(
    join(dir, "world.sqlite"),
    createWorldProjectionReducers(loadGreekWorldState()),
  );
});

afterEach(() => {
  closeStore(store);
  rmSync(dir, { recursive: true, force: true });
});

const TICK = DEFAULT_TICK_ELAPSED_MS;

const backlog = (
  overrides: Partial<Parameters<typeof writeCatchUpProgress>[1]> = {},
) => ({
  appliedMs: 120 * TICK,
  discardedMs: 0,
  startSequence: 0,
  ...overrides,
});

describe("isNonEmptyAccount", () => {
  test("less than one tick applied and skipped, with no outcomes, is nothing that happened", () => {
    expect(
      isNonEmptyAccount({
        appliedMs: TICK - 1,
        skippedMs: TICK - 1,
        majorOutcomes: [],
      }),
    ).toBe(false);
    expect(
      isNonEmptyAccount({ appliedMs: 0, skippedMs: 0, majorOutcomes: [] }),
    ).toBe(false);
  });

  test("a tick applied, a tick skipped, or an outcome is something", () => {
    expect(
      isNonEmptyAccount({ appliedMs: TICK, skippedMs: 0, majorOutcomes: [] }),
    ).toBe(true);
    expect(
      isNonEmptyAccount({ appliedMs: 0, skippedMs: TICK, majorOutcomes: [] }),
    ).toBe(true);
    expect(
      isNonEmptyAccount({
        appliedMs: 0,
        skippedMs: 0,
        majorOutcomes: ["building-ignited:x"],
      }),
    ).toBe(true);
  });
});

describe("closeCatchUpBacklog", () => {
  test("with no open backlog it does nothing and leaves the previous summary alone", () => {
    const previous = {
      id: "previous",
      atSequence: 0,
      appliedMs: TICK,
      skippedMs: 0,
      majorOutcomes: [],
    };
    writeCatchUpSummary(store.db, previous);

    expect(closeCatchUpBacklog(store.db)).toBeUndefined();

    expect(readCatchUpSummary(store.db)).toEqual(previous);
  });

  test("an open non-empty backlog becomes a persisted summary with a service-minted id, and its progress is cleared, in one step", () => {
    writeCatchUpProgress(store.db, backlog({ discardedMs: 7_200_000 }));

    const closed = closeCatchUpBacklog(store.db);

    const persisted = readCatchUpSummary(store.db);
    expect(persisted).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      atSequence: 0,
      appliedMs: 120 * TICK,
      skippedMs: 7_200_000,
      majorOutcomes: [],
    });
    expect(closed?.delivered).toEqual(persisted);
    expect(readCatchUpProgress(store.db)).toBeUndefined();
  });

  test("an open backlog that amounts to nothing is closed without replacing the previous summary", () => {
    const previous = {
      id: "previous",
      atSequence: 0,
      appliedMs: 60 * TICK,
      skippedMs: 0,
      majorOutcomes: [],
    };
    writeCatchUpSummary(store.db, previous);
    writeCatchUpProgress(
      store.db,
      backlog({ appliedMs: 0, discardedMs: TICK - 1 }),
    );

    const closed = closeCatchUpBacklog(store.db);

    expect(closed?.delivered).toBeUndefined();
    expect(readCatchUpSummary(store.db)).toEqual(previous);
    expect(readCatchUpProgress(store.db)).toBeUndefined();
  });

  test("a different backlog gets a new id even when it ends at the same sequence as the previous summary did", () => {
    writeCatchUpProgress(store.db, backlog());
    const first = closeCatchUpBacklog(store.db)?.delivered;

    // An eventless second backlog: same ending sequence, different amounts.
    writeCatchUpProgress(store.db, backlog({ appliedMs: 30 * TICK }));
    const second = closeCatchUpBacklog(store.db)?.delivered;

    expect(first?.atSequence).toBe(second?.atSequence);
    expect(second?.id).not.toBe(first?.id);
    expect(readCatchUpSummary(store.db)).toEqual(second);
  });

  test("a new backlog gets a new id even when its account is identical to the closed previous one: the id names the backlog, not its content", () => {
    writeCatchUpProgress(store.db, backlog());
    const first = closeCatchUpBacklog(store.db)?.delivered;

    // An eventless second backlog with the same amounts, ending at the same
    // sequence: content-identical, but a different backlog.
    writeCatchUpProgress(store.db, backlog());
    const second = closeCatchUpBacklog(store.db)?.delivered;

    expect(second).toMatchObject({
      atSequence: first?.atSequence,
      appliedMs: first?.appliedMs,
      skippedMs: first?.skippedMs,
    });
    expect(second?.id).not.toBe(first?.id);
    expect(readCatchUpSummary(store.db)?.id).toBe(second?.id);
  });
});

describe("closeCatchUpBacklog: a follow-up pass of the same absence", () => {
  /** A closed first backlog (60 ticks applied, 30 skipped) and an open follow-up that starts where it ended. */
  function afterMainPass() {
    writeCatchUpProgress(
      store.db,
      backlog({ appliedMs: 60 * TICK, discardedMs: 30 * TICK }),
    );
    const main = closeCatchUpBacklog(store.db)?.delivered;
    writeCatchUpProgress(
      store.db,
      backlog({ appliedMs: 5 * TICK, startSequence: main?.atSequence ?? 0 }),
    );
    return main;
  }

  test("a follow-up pass that continues the one before it adds to that summary instead of replacing it: the totals are the whole absence, under a new id", () => {
    const main = afterMainPass();

    const closed = closeCatchUpBacklog(store.db, { continuesPrevious: true });

    expect(closed?.delivered).toMatchObject({
      appliedMs: 65 * TICK,
      skippedMs: 30 * TICK,
      atSequence: main?.atSequence,
    });
    // The content changed, so a client that dismissed the first is shown this one.
    expect(closed?.delivered?.id).not.toBe(main?.id);
    expect(readCatchUpSummary(store.db)).toEqual(closed?.delivered);
    // What the pass itself did is still its own account.
    expect(closed?.account).toMatchObject({
      appliedMs: 5 * TICK,
      skippedMs: 0,
    });
    expect(readCatchUpProgress(store.db)).toBeUndefined();
  });

  test("control: the same follow-up pass that does not say it continues replaces the summary, as every later backlog does", () => {
    const main = afterMainPass();

    const closed = closeCatchUpBacklog(store.db);

    expect(closed?.delivered).toMatchObject({
      appliedMs: 5 * TICK,
      skippedMs: 0,
    });
    expect(closed?.delivered?.id).not.toBe(main?.id);
  });

  test("a pass that says it continues but does not start where the summary ended is a backlog of its own", () => {
    const main = afterMainPass();
    writeCatchUpProgress(
      store.db,
      backlog({
        appliedMs: 5 * TICK,
        startSequence: (main?.atSequence ?? 0) + 7,
      }),
    );

    const closed = closeCatchUpBacklog(store.db, { continuesPrevious: true });

    expect(closed?.delivered).toMatchObject({
      appliedMs: 5 * TICK,
      skippedMs: 0,
    });
  });

  test("a continuing pass that amounts to nothing leaves the summary, and its id, alone", () => {
    const main = afterMainPass();
    writeCatchUpProgress(
      store.db,
      backlog({
        appliedMs: 0,
        discardedMs: 0,
        startSequence: main?.atSequence ?? 0,
      }),
    );

    const closed = closeCatchUpBacklog(store.db, { continuesPrevious: true });

    expect(closed?.delivered).toBeUndefined();
    expect(readCatchUpSummary(store.db)).toEqual(main);
  });

  test("a continuing pass with no summary before it is just its own summary", () => {
    writeCatchUpProgress(store.db, backlog({ appliedMs: 5 * TICK }));

    const closed = closeCatchUpBacklog(store.db, { continuesPrevious: true });

    expect(closed?.delivered).toMatchObject({
      appliedMs: 5 * TICK,
      skippedMs: 0,
    });
  });
});

describe("recordPartialSummary: a degraded catch-up keeps its backlog open", () => {
  test("it persists what the backlog committed and keeps the progress", () => {
    writeCatchUpProgress(store.db, backlog({ appliedMs: 60 * TICK }));

    const partial = recordPartialSummary(store.db);

    expect(partial).toMatchObject({ appliedMs: 60 * TICK, skippedMs: 0 });
    expect(readCatchUpSummary(store.db)).toEqual(partial);
    expect(readCatchUpProgress(store.db)?.appliedMs).toBe(60 * TICK);
  });

  test("a retry with no new committed progress reuses the id", () => {
    writeCatchUpProgress(store.db, backlog({ appliedMs: 60 * TICK }));
    const first = recordPartialSummary(store.db);

    const retry = recordPartialSummary(store.db);

    expect(retry?.id).toBe(first?.id);
  });

  test("a retry that changes the summary mints a new id", () => {
    writeCatchUpProgress(store.db, backlog({ appliedMs: 60 * TICK }));
    const first = recordPartialSummary(store.db);
    writeCatchUpProgress(store.db, backlog({ appliedMs: 120 * TICK }));

    const changed = recordPartialSummary(store.db);

    expect(changed?.id).not.toBe(first?.id);
    expect(changed?.appliedMs).toBe(120 * TICK);
  });

  test("closing the backlog with nothing new since the partial summary keeps its id, so a client that dismissed it is not shown it again", () => {
    writeCatchUpProgress(store.db, backlog({ appliedMs: 60 * TICK }));
    const partial = recordPartialSummary(store.db);

    const closed = closeCatchUpBacklog(store.db);

    expect(closed?.delivered?.id).toBe(partial?.id);
    expect(readCatchUpProgress(store.db)).toBeUndefined();
  });

  test("a new backlog's partial summary is not the closed previous backlog's, even with an identical account, and closing it keeps its own id", () => {
    writeCatchUpProgress(store.db, backlog({ appliedMs: 60 * TICK }));
    const first = recordPartialSummary(store.db);
    closeCatchUpBacklog(store.db);

    writeCatchUpProgress(store.db, backlog({ appliedMs: 60 * TICK }));
    const secondPartial = recordPartialSummary(store.db);
    const secondClosed = closeCatchUpBacklog(store.db)?.delivered;

    expect(secondPartial?.id).not.toBe(first?.id);
    expect(secondClosed?.id).toBe(secondPartial?.id);
  });

  test("closing after more progress mints a new id", () => {
    writeCatchUpProgress(store.db, backlog({ appliedMs: 60 * TICK }));
    const partial = recordPartialSummary(store.db);
    writeCatchUpProgress(store.db, backlog({ appliedMs: 180 * TICK }));

    const closed = closeCatchUpBacklog(store.db);

    expect(closed?.delivered?.id).not.toBe(partial?.id);
    expect(closed?.delivered?.appliedMs).toBe(180 * TICK);
  });

  test("a partial summary and its binding commit or roll back together: a failing binding update leaves both as they were, and the retry, an unchanged retry after it, and an archive round trip all hold up", () => {
    writeCatchUpProgress(store.db, backlog({ appliedMs: 60 * TICK }));
    const first = recordPartialSummary(store.db);
    writeCatchUpProgress(store.db, backlog({ appliedMs: 120 * TICK }));
    // The store refuses the binding update, after the summary upsert has run.
    store.db.exec(
      "CREATE TRIGGER refuse_binding BEFORE UPDATE OF summary_id ON catch_up_progress BEGIN SELECT RAISE(ABORT, 'SQLITE_FULL: simulated'); END",
    );

    expect(() => recordPartialSummary(store.db)).toThrow();

    // Neither half committed: the summary is still the first, and the
    // progress still points at it.
    expect(readCatchUpSummary(store.db)).toEqual(first);
    expect(readCatchUpProgress(store.db)).toMatchObject({
      appliedMs: 120 * TICK,
      summaryId: first?.id,
    });

    store.db.exec("DROP TRIGGER refuse_binding");
    const retried = recordPartialSummary(store.db);
    expect(retried?.appliedMs).toBe(120 * TICK);
    expect(retried?.id).not.toBe(first?.id);
    expect(readCatchUpProgress(store.db)?.summaryId).toBe(retried?.id);

    // Nothing changed since: the published id is kept.
    expect(recordPartialSummary(store.db)?.id).toBe(retried?.id);

    // The state is exportable and importable: the binding check accepts it.
    const archivePath = join(dir, "archive.sqlite");
    exportArchive(store, archivePath);
    const slot = importArchive(
      archivePath,
      join(dir, "slots"),
      worldImportReducers,
    );
    const imported = openStore(
      join(slot.slotPath, "world.sqlite"),
      createWorldProjectionReducers(loadGreekWorldState()),
    );
    try {
      expect(readCatchUpSummary(imported.db)).toEqual(retried);
      expect(readCatchUpProgress(imported.db)?.summaryId).toBe(retried?.id);
    } finally {
      closeStore(imported);
    }
  });

  test("inside a caller's transaction the summary and binding nest as a savepoint and roll back with it", () => {
    writeCatchUpProgress(store.db, backlog({ appliedMs: 60 * TICK }));
    const first = recordPartialSummary(store.db);
    writeCatchUpProgress(store.db, backlog({ appliedMs: 120 * TICK }));

    expect(() =>
      store.db.transaction(() => {
        recordPartialSummary(store.db);
        throw new Error("the outer commit fails");
      })(),
    ).toThrow("the outer commit fails");

    expect(readCatchUpSummary(store.db)).toEqual(first);
    expect(readCatchUpProgress(store.db)?.summaryId).toBe(first?.id);
  });

  test("with no open backlog it persists nothing", () => {
    expect(recordPartialSummary(store.db)).toBeUndefined();
    expect(readCatchUpSummary(store.db)).toBeUndefined();
  });

  test("an empty backlog persists nothing and keeps the previous summary", () => {
    const previous = {
      id: "previous",
      atSequence: 0,
      appliedMs: 60 * TICK,
      skippedMs: 0,
      majorOutcomes: [],
    };
    writeCatchUpSummary(store.db, previous);
    writeCatchUpProgress(store.db, backlog({ appliedMs: 0, discardedMs: 1 }));

    expect(recordPartialSummary(store.db)).toBeUndefined();

    expect(readCatchUpSummary(store.db)).toEqual(previous);
    expect(readCatchUpProgress(store.db)).toBeDefined();
  });
});
