// Integration test: the full pipeline through real world rules/reducers
// and a real SQLite store, with the authored Greek content pack -- proves
// packages/world and packages/persistence actually compose, not just that
// each package's own unit tests pass in isolation.

import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  causalChain,
  createObservationId,
  type ObservationRecord,
  type Proposal,
  type WorldEvent,
} from "@panthea/contracts";
import {
  closeStore,
  commitTick,
  computeContentHash,
  exportArchive,
  getCurrentSequence,
  getEventRow,
  ImportError,
  importArchive,
  listEvents,
  openStore,
  readClock,
  readLiveProjections,
  readPrngState,
  rebuildProjections,
} from "@panthea/persistence";
import {
  createProposalId,
  ensureTraceSchema,
  followEvent,
  getProposalOutcomeByProposalId,
} from "@panthea/telemetry";
import {
  createPrng,
  DEFAULT_MEMORY_BALANCE,
  decideRoutineProposal,
  effectiveServices,
  getMemories,
  getRelationship,
  getResourceAmount,
  isEventLinked,
  nextHop,
  relationshipKey,
  runTick,
  submitProposal,
  toEntityId,
  type WorldState,
  withActor,
} from "@panthea/world";
import { applyOneTick, type QueuedProposal, stepWorldTick } from "./tick";
import {
  createEventSource,
  createWorldProjectionReducers,
  deserializePrngState,
  loadGreekWorldState,
  restoreWorldTime,
  serializePrngState,
  worldImportReducers,
} from "./world-store";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function moveProposal(
  actor: string,
  to: string,
  observationId: string,
  overrides: Record<string, unknown> = {},
): Proposal {
  const submitted = submitProposal({
    schemaVersion: 1,
    actor,
    targets: [],
    expectedRevisions: [],
    source: "fixture",
    observationId,
    kind: "move",
    to,
    ...overrides,
  });
  if (!submitted.ok) {
    throw new Error(
      `test fixture proposal failed to parse: ${submitted.rejection.message}`,
    );
  }
  return submitted.proposal;
}

test("real world reducers/rules through a real store: tick, restart, and export/import all compose", () => {
  const storeDir = tempDir("panthea-sim-store-");
  const slotsDir = tempDir("panthea-sim-slots-");
  const exportDir = tempDir("panthea-sim-export-");

  try {
    const storePath = join(storeDir, "world.sqlite");

    const seededState = withActor(loadGreekWorldState(), {
      id: toEntityId("wanderer"),
      locationId: toEntityId("wilderness-grove"),
      alive: true,
      capabilities: [],
      inventory: new Map(),
      revision: 0,
    });

    const projectionReducers = createWorldProjectionReducers(seededState);

    let store = openStore(storePath, projectionReducers);

    // --- 1. Two ticks, contiguous sequences across ticks ------------------
    const prng0 = createPrng(1);
    const tick1 = runTick(seededState, prng0, [
      moveProposal("wanderer", "wilderness-path", "obs-1"),
    ]);
    expect(tick1.rejected).toEqual([]);
    // The move commits at sequence 1; the farmer's two operational,
    // service-offering buildings (the shop and the tavern) each earn one
    // income-earned event every tick, right after the proposal queue
    // drains (the woodcutter's woodshed sells nothing, so earns nothing);
    // then the need scan records what the mortals' routines cannot get. How
    // many events the whole town makes is the pack's business, so what is
    // pinned is that the sequence is contiguous from 1 and the move is first.
    const moveEvents1 = tick1.committed.flatMap((record) => record.events);
    expect(moveEvents1.map((event) => event.sequence)).toEqual([1]);
    const count1 = tick1.events.length;
    expect(count1).toBeGreaterThan(1);
    expect(tick1.events.map((event) => event.sequence)).toEqual(
      Array.from({ length: count1 }, (_, index) => index + 1),
    );

    const commit1 = commitTick(store, projectionReducers, {
      events: tick1.events,
      cursorWallMs: 1_000,
      paused: false,
      tick: tick1.state.tick,
      simTimeMs: tick1.state.simTime,
      prngState: serializePrngState(tick1.prng),
    });
    expect(commit1.sequence).toBe(count1);

    const tick2 = runTick(tick1.state, tick1.prng, [
      moveProposal("wanderer", "town-square", "obs-2"),
    ]);
    expect(tick2.rejected).toEqual([]);
    const moveEvents2 = tick2.committed.flatMap((record) => record.events);
    // Contiguous with tick 1's sequence, not reset to 1 again.
    expect(moveEvents2.map((event) => event.sequence)).toEqual([count1 + 1]);

    const commit2 = commitTick(store, projectionReducers, {
      events: tick2.events,
      cursorWallMs: 2_000,
      paused: false,
      tick: tick2.state.tick,
      simTimeMs: tick2.state.simTime,
      prngState: serializePrngState(tick2.prng),
    });
    const count2 = count1 + tick2.events.length;
    expect(commit2.sequence).toBe(count2);
    expect(tick2.state.tick).toBe(2);
    expect(tick2.state.simTime).toBe(2_000);
    expect(tick2.state.lastSequence).toBe(count2);

    // --- 2. Close -> reopen -> live projections restored to the full state
    closeStore(store);
    store = openStore(storePath, projectionReducers);

    const restoredAfterReopen = restoreWorldTime(
      readLiveProjections(store, projectionReducers),
      readClock(store.db),
    );
    expect(restoredAfterReopen).toEqual(tick2.state);
    expect(restoredAfterReopen.actors).toBeInstanceOf(Map);
    expect(restoredAfterReopen.locations).toBeInstanceOf(Map);
    expect(
      restoredAfterReopen.actors.get(toEntityId("wanderer")),
    ).toMatchObject({
      locationId: "town-square",
    });

    const rebuiltAfterReopen = restoreWorldTime(
      rebuildProjections(store, projectionReducers),
      readClock(store.db),
    );
    expect(rebuiltAfterReopen).toEqual(tick2.state);

    // --- 3. Continue ticking from the reopened, restored state ------------
    //        Nothing from tick1/tick2 is held in memory here except what a
    //        real restart would also have: the store itself. Restore the
    //        PRNG from the store too, rather than reusing `tick2.prng`.
    const restoredPrng = deserializePrngState(readPrngState(store.db));
    expect(restoredPrng).toEqual(tick2.prng);
    const tick3 = runTick(restoredAfterReopen, restoredPrng ?? createPrng(1), [
      moveProposal("wanderer", "tavern", "obs-3"),
    ]);
    expect(tick3.rejected).toEqual([]);
    const moveEvents3 = tick3.committed.flatMap((record) => record.events);
    expect(moveEvents3.map((event) => event.sequence)).toEqual([count2 + 1]);

    const commit3 = commitTick(store, projectionReducers, {
      events: tick3.events,
      cursorWallMs: 3_000,
      paused: false,
      tick: tick3.state.tick,
      simTimeMs: tick3.state.simTime,
      prngState: serializePrngState(tick3.prng),
    });
    const count3 = count2 + tick3.events.length;
    expect(commit3.sequence).toBe(count3);

    // --- 4. Export -> importArchive (world codec) -> reopen -> equal ------
    const exportPath = join(exportDir, "archive.sqlite");
    const manifest = exportArchive(store, exportPath);
    expect(manifest.eventSequence).toBe(count3);

    const importResult = importArchive(
      exportPath,
      slotsDir,
      worldImportReducers,
    );

    const importedStore = openStore(
      join(importResult.slotPath, "world.sqlite"),
      projectionReducers,
    );
    const restoredAfterImport = restoreWorldTime(
      readLiveProjections(importedStore, projectionReducers),
      readClock(importedStore.db),
    );
    expect(restoredAfterImport).toEqual(tick3.state);
    expect(importedStore.worldId).toBe(store.worldId);
    closeStore(importedStore);

    // --- 5. A proposal declaring a nonzero cost is rejected before it ever
    //        reaches the queue; nothing beyond the rejection is committed.
    const costlySubmission = submitProposal({
      schemaVersion: 1,
      actor: "wanderer",
      targets: [],
      expectedRevisions: [],
      source: "fixture",
      observationId: "obs-4",
      kind: "move",
      to: "inn",
      costs: [{ resource: "food", amount: 1 }],
    });
    expect(costlySubmission.ok).toBe(false);
    if (!costlySubmission.ok) {
      expect(costlySubmission.rejection.reason).toBe("unauthorized-claim");
    }

    const commit4 = commitTick(store, projectionReducers, {
      events: [],
      cursorWallMs: 4_000,
      paused: false,
      tick: tick3.state.tick,
      simTimeMs: tick3.state.simTime,
      prngState: serializePrngState(tick3.prng),
    });
    // Sequence is unchanged: no events were committed.
    expect(commit4.sequence).toBe(count3);
    const restoredAfterRejection = restoreWorldTime(
      readLiveProjections(store, projectionReducers),
      readClock(store.db),
    );
    expect(restoredAfterRejection).toEqual(tick3.state);

    closeStore(store);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
    rmSync(slotsDir, { recursive: true, force: true });
    rmSync(exportDir, { recursive: true, force: true });
  }
});

test("rebuild restores the seeded actor even from a freshly constructed composition root with no reference to the original seeded state", () => {
  const storeDir = tempDir("panthea-sim-genesis-");
  const exportDir = tempDir("panthea-sim-genesis-export-");
  const slotsDir = tempDir("panthea-sim-genesis-slots-");

  try {
    const storePath = join(storeDir, "world.sqlite");

    const seeded = withActor(loadGreekWorldState(), {
      id: toEntityId("wanderer"),
      locationId: toEntityId("wilderness-grove"),
      alive: true,
      capabilities: [],
      inventory: new Map(),
      revision: 0,
    });
    const seededReducers = createWorldProjectionReducers(seeded);

    let store = openStore(storePath, seededReducers);

    const prng0 = createPrng(1);
    const tick1 = runTick(seeded, prng0, [
      moveProposal("wanderer", "wilderness-path", "obs-1"),
    ]);
    commitTick(store, seededReducers, {
      events: tick1.events,
      cursorWallMs: 1_000,
      paused: false,
      tick: tick1.state.tick,
      simTimeMs: tick1.state.simTime,
      prngState: serializePrngState(tick1.prng),
    });

    const tick2 = runTick(tick1.state, tick1.prng, [
      moveProposal("wanderer", "town-square", "obs-2"),
    ]);
    commitTick(store, seededReducers, {
      events: tick2.events,
      cursorWallMs: 2_000,
      paused: false,
      tick: tick2.state.tick,
      simTimeMs: tick2.state.simTime,
      prngState: serializePrngState(tick2.prng),
    });
    closeStore(store);

    // A freshly constructed composition root: new reducers built from
    // loadGreekWorldState() again, with no reference to the seeded actor.
    const freshReducers = createWorldProjectionReducers(loadGreekWorldState());
    store = openStore(storePath, freshReducers);

    const rebuilt = restoreWorldTime(
      rebuildProjections(store, freshReducers),
      readClock(store.db),
    );
    const live = restoreWorldTime(
      readLiveProjections(store, freshReducers),
      readClock(store.db),
    );

    expect(live).toEqual(tick2.state);
    expect(rebuilt).toEqual(tick2.state);

    // export -> import -> rebuild, still with the fresh (actor-less) reducers
    const exportPath = join(exportDir, "archive.sqlite");
    exportArchive(store, exportPath);
    const importResult = importArchive(
      exportPath,
      slotsDir,
      worldImportReducers,
    );
    const importedStore = openStore(
      join(importResult.slotPath, "world.sqlite"),
      freshReducers,
    );

    const rebuiltAfterImport = restoreWorldTime(
      rebuildProjections(importedStore, freshReducers),
      readClock(importedStore.db),
    );
    expect(rebuiltAfterImport).toEqual(tick2.state);

    closeStore(importedStore);
    closeStore(store);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
    rmSync(exportDir, { recursive: true, force: true });
    rmSync(slotsDir, { recursive: true, force: true });
  }
});

test("an archive whose genesis row contains a malformed actor entry is rejected as corrupt, even after rehashing; no slot is created", () => {
  const storeDir = tempDir("panthea-sim-malformed-genesis-");
  const exportDir = tempDir("panthea-sim-malformed-genesis-export-");
  const slotsDir = tempDir("panthea-sim-malformed-genesis-slots-");

  try {
    const storePath = join(storeDir, "world.sqlite");
    const seeded = withActor(loadGreekWorldState(), {
      id: toEntityId("wanderer"),
      locationId: toEntityId("wilderness-grove"),
      alive: true,
      capabilities: [],
      inventory: new Map(),
      revision: 0,
    });
    const reducers = createWorldProjectionReducers(seeded);

    const store = openStore(storePath, reducers);
    const exportPath = join(exportDir, "archive.sqlite");
    exportArchive(store, exportPath);
    closeStore(store);

    // Insert a malformed actor entry (`["wanderer", null]`) into the
    // archive's genesis row, then recompute the hash so the tamper is
    // self-consistent -- a plain hash check alone cannot catch this.
    const archiveDb = new Database(exportPath);
    const genesisRow = archiveDb
      .query("SELECT data FROM genesis WHERE id = 1")
      .get() as { data: string };
    const encoded = JSON.parse(genesisRow.data) as {
      actors: unknown[];
      [key: string]: unknown;
    };
    const corrupted = {
      ...encoded,
      actors: [...encoded.actors, ["wanderer", null]],
    };
    archiveDb.run("UPDATE genesis SET data = ? WHERE id = 1", [
      JSON.stringify(corrupted),
    ]);
    const manifestRow = archiveDb
      .query("SELECT * FROM manifest WHERE id = 1")
      .get() as {
      format_version: number;
      sqlite_schema_version: number;
      payload_schema_version: number;
      world_id: string;
      event_sequence: number;
    };
    const newHash = computeContentHash(archiveDb, {
      formatVersion: manifestRow.format_version,
      sqliteSchemaVersion: manifestRow.sqlite_schema_version,
      payloadSchemaVersion: manifestRow.payload_schema_version,
      worldId: manifestRow.world_id as never,
      eventSequence: manifestRow.event_sequence,
    });
    archiveDb.run("UPDATE manifest SET content_hash = ?", [newHash]);
    archiveDb.close();

    let caught: unknown;
    try {
      importArchive(exportPath, slotsDir, worldImportReducers);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ImportError);
    expect((caught as ImportError).kind).toBe("corrupt");
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
    rmSync(exportDir, { recursive: true, force: true });
    rmSync(slotsDir, { recursive: true, force: true });
  }
});

function totalAcrossActors(state: WorldState, resource: string): number {
  let total = 0;
  for (const actor of state.actors.values()) {
    total += getResourceAmount(actor.inventory, resource);
  }
  return total;
}

test("an economy run of routine-driven inhabitants through a real store conserves currency and survives reopen and rebuild", () => {
  const storeDir = tempDir("panthea-sim-economy-");

  try {
    const storePath = join(storeDir, "world.sqlite");
    const seededState = loadGreekWorldState();
    const projectionReducers = createWorldProjectionReducers(seededState);
    const store = openStore(storePath, projectionReducers);

    const currencyBefore = totalAcrossActors(seededState, "currency");
    const woodBefore = totalAcrossActors(seededState, "wood");
    const foodBefore = totalAcrossActors(seededState, "food");

    let gatheredWood = 0;
    let gatheredFood = 0;
    let consumedFood = 0;
    let tradedCount = 0;
    let producedEventCount = 0;
    let woodConsumedByRecipe = 0;
    let incomeEarned = 0;
    const producedByResource: Record<string, number> = {};
    // What the gods' domain troubles took: a declared sink, like consumption.
    const troubleLost: Record<string, number> = {};

    let state = seededState;
    let prng = createPrng(7);
    const recipes = seededState.recipes;
    const routineActorIds = [...state.actors.entries()]
      .filter(([, actor]) => actor.drives !== undefined)
      .map(([id]) => id);

    for (let tick = 1; tick <= 15; tick++) {
      const proposals: Proposal[] = [];
      for (const actorId of routineActorIds) {
        const decision = decideRoutineProposal(state, actorId);
        if (decision) proposals.push(decision.proposal);
      }

      const result = runTick(state, prng, proposals);
      for (const event of result.environmentEvents) {
        if (event.kind === "income-earned") {
          incomeEarned += event.amount;
        }
        if (event.kind === "trouble" && event.loss.kind === "resource") {
          troubleLost[event.loss.resource] =
            (troubleLost[event.loss.resource] ?? 0) + event.loss.amount;
        }
      }
      for (const record of result.committed) {
        for (const event of record.events) {
          if (event.kind === "resource-gathered" && event.resource === "wood") {
            gatheredWood += event.amount;
          }
          if (event.kind === "resource-gathered" && event.resource === "food") {
            gatheredFood += event.amount;
          }
          if (event.kind === "resource-consumed" && event.resource === "food") {
            consumedFood += event.amount;
          }
          if (event.kind === "resource-traded") {
            tradedCount += 1;
          }
          if (event.kind === "resource-produced") {
            producedEventCount += 1;
            const recipe = recipes[event.output];
            if (recipe) {
              for (const output of recipe.outputs) {
                producedByResource[output.resource] =
                  (producedByResource[output.resource] ?? 0) +
                  output.amount * event.quantity;
              }
              for (const input of recipe.inputs) {
                if (input.resource === "wood") {
                  woodConsumedByRecipe += input.amount * event.quantity;
                }
              }
            }
          }
        }
      }

      commitTick(store, projectionReducers, {
        events: result.events,
        cursorWallMs: tick * 1_000,
        paused: false,
        tick: result.state.tick,
        simTimeMs: result.state.simTime,
        prngState: serializePrngState(result.prng),
      });

      state = result.state;
      prng = result.prng;
    }

    // Progress happened: routines did not stall degenerately.
    expect(gatheredWood).toBeGreaterThan(0);
    expect(gatheredFood).toBeGreaterThan(0);
    expect(tradedCount).toBeGreaterThan(0);
    // The authored woodcutter actually produces during a normal run.
    expect(producedEventCount).toBeGreaterThan(0);

    // Currency moves between actors via trade (zero-sum, no proposal ever
    // names it) plus one declared source: an operational owned building's
    // per-tick service revenue.
    expect(incomeEarned).toBeGreaterThan(0);
    expect(totalAcrossActors(state, "currency")).toBe(
      currencyBefore + incomeEarned - (troubleLost.currency ?? 0),
    );
    // Wood is conserved except at its declared source (gather) and its
    // declared conversion into planks (the recipe's input side).
    expect(totalAcrossActors(state, "wood")).toBe(
      woodBefore +
        gatheredWood -
        woodConsumedByRecipe -
        (troubleLost.wood ?? 0),
    );
    // Food is conserved except at its declared source (gather) and sink
    // (consume).
    expect(totalAcrossActors(state, "food")).toBe(
      foodBefore + gatheredFood - consumedFood - (troubleLost.food ?? 0),
    );
    // Planks exist only through the declared recipe conversion; trading
    // them between actors never changes the total the world holds.
    expect(totalAcrossActors(state, "planks")).toBe(
      (producedByResource.planks ?? 0) - (troubleLost.planks ?? 0),
    );

    closeStore(store);

    // Fresh composition root: reopen with reducers built from
    // `loadGreekWorldState()` again, holding no reference to `state`.
    const freshReducers = createWorldProjectionReducers(loadGreekWorldState());
    const reopened = openStore(storePath, freshReducers);

    const live = restoreWorldTime(
      readLiveProjections(reopened, freshReducers),
      readClock(reopened.db),
    );
    const rebuilt = restoreWorldTime(
      rebuildProjections(reopened, freshReducers),
      readClock(reopened.db),
    );
    expect(live).toEqual(state);
    expect(rebuilt).toEqual(state);

    // No trade this run ever left an actor holding a negative balance of
    // anything, in the state reopened and decoded from the real store.
    for (const actor of live.actors.values()) {
      for (const amount of actor.inventory.values()) {
        expect(amount).toBeGreaterThanOrEqual(0);
      }
    }

    closeStore(reopened);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

function worshipProposal(actor: string, deity: string): Proposal {
  const submitted = submitProposal({
    schemaVersion: 1,
    actor,
    targets: [deity],
    expectedRevisions: [],
    source: "fixture",
    observationId: "obs-worship",
    kind: "worship",
    deity,
  });
  if (!submitted.ok) {
    throw new Error(
      `test fixture proposal failed to parse: ${submitted.rejection.message}`,
    );
  }
  return submitted.proposal;
}

function gatherProposal(
  actor: string,
  resource: string,
  amount: number,
  observationId: string,
): Proposal {
  const submitted = submitProposal({
    schemaVersion: 1,
    actor,
    targets: [],
    expectedRevisions: [],
    source: "fixture",
    observationId,
    kind: "gather",
    resource,
    amount,
  });
  if (!submitted.ok) {
    throw new Error(
      `test fixture proposal failed to parse: ${submitted.rejection.message}`,
    );
  }
  return submitted.proposal;
}

test("a favor from worship increases gather yield until it expires, and the bonus is conserved", () => {
  const storeDir = tempDir("panthea-sim-favor-");

  try {
    const storePath = join(storeDir, "world.sqlite");
    const seededState = loadGreekWorldState();
    const reducers = createWorldProjectionReducers(seededState);
    const store = openStore(storePath, reducers);

    const woodBefore = totalAcrossActors(seededState, "wood");
    let gatheredWood = 0;
    let prng = createPrng(3);
    let state = seededState;

    function commit(result: ReturnType<typeof runTick>, wallMs: number): void {
      for (const event of result.committed.flatMap((r) => r.events)) {
        if (event.kind === "resource-gathered" && event.resource === "wood") {
          gatheredWood += event.amount;
        }
      }
      commitTick(store, reducers, {
        events: result.events,
        cursorWallMs: wallMs,
        paused: false,
        tick: result.state.tick,
        simTimeMs: result.state.simTime,
        prngState: serializePrngState(result.prng),
      });
      state = result.state;
      prng = result.prng;
    }

    // Tick 1: the woodcutter worships Zeus and is granted a favor.
    let result = runTick(state, prng, [worshipProposal("woodcutter", "zeus")]);
    expect(result.rejected).toEqual([]);
    commit(result, 1_000);
    const favor = state.actors.get(toEntityId("woodcutter"))?.favors?.[0];
    expect(favor).toMatchObject({ source: "zeus", effect: "divine-favor" });
    if (!favor) throw new Error("expected the granted favor");

    // Tick 2: gathering while the favor is active yields the base amount
    // (2, from content) plus its bonus (1).
    result = runTick(state, prng, [
      gatherProposal("woodcutter", "wood", 2, "obs-gather-1"),
    ]);
    expect(result.rejected).toEqual([]);
    const favoredEvent = result.committed[0]?.events[0];
    expect(favoredEvent).toMatchObject({
      kind: "resource-gathered",
      resource: "wood",
      amount: 3,
    });
    commit(result, 2_000);

    // Advance empty ticks until the favor expires.
    while (state.tick < favor.expiresAtTick) {
      result = runTick(state, prng, []);
      commit(result, (state.tick + 1) * 1_000);
    }

    // Gathering after expiry yields the base amount only.
    result = runTick(state, prng, [
      gatherProposal("woodcutter", "wood", 2, "obs-gather-2"),
    ]);
    expect(result.rejected).toEqual([]);
    const unfavoredEvent = result.committed[0]?.events[0];
    expect(unfavoredEvent).toMatchObject({
      kind: "resource-gathered",
      resource: "wood",
      amount: 2,
    });
    commit(result, (state.tick + 1) * 1_000);

    // The favor's bonus is a declared source, summed like any other gather:
    // the total wood held is exactly what every resource-gathered event
    // this test committed says it is.
    expect(totalAcrossActors(state, "wood")).toBe(woodBefore + gatheredWood);

    closeStore(store);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

function strikeProposal(target: string, power: number): Proposal {
  const submitted = submitProposal({
    schemaVersion: 1,
    actor: "zeus",
    targets: [target],
    expectedRevisions: [],
    source: "fixture",
    observationId: "obs-strike",
    kind: "strike",
    target,
    power,
  });
  if (!submitted.ok) {
    throw new Error(
      `test fixture proposal failed to parse: ${submitted.rejection.message}`,
    );
  }
  return submitted.proposal;
}

test("a strike ignites the tavern; it burns, stops services and income, and a motivated repair restores it -- mid-fire reopen/rebuild and export/import agree", () => {
  const storeDir = tempDir("panthea-sim-fire-");
  const exportDir = tempDir("panthea-sim-fire-export-");
  const slotsDir = tempDir("panthea-sim-fire-slots-");

  try {
    const storePath = join(storeDir, "world.sqlite");
    const seededState = loadGreekWorldState();
    const reducers = createWorldProjectionReducers(seededState);
    let store = openStore(storePath, reducers);

    // --- Tick 1: Zeus strikes the tavern with enough power to ignite it.
    const prng = createPrng(11);
    let result = runTick(seededState, prng, [strikeProposal("the-tavern", 3)]);
    expect(result.rejected).toEqual([]);
    const tavernAfterStrike = result.state.buildings.get(
      toEntityId("the-tavern"),
    );
    if (!tavernAfterStrike) throw new Error("expected the tavern building");
    // Ignition and its first burn tick both happen this same tick: the
    // environment step runs right after the proposal that caused it.
    expect(tavernAfterStrike).toMatchObject({
      status: "burning",
      fireIntensity: 1,
      ticksBurning: 1,
    });
    expect(effectiveServices(tavernAfterStrike)).toEqual([]);
    // Income stopped the very tick it started burning; the stone shop,
    // unaffected, still earns its owner income.
    const incomeThisTick = result.environmentEvents.filter(
      (event) => event.kind === "income-earned",
    );
    expect(
      incomeThisTick.some(
        (event) => "buildingId" in event && event.buildingId === "the-tavern",
      ),
    ).toBe(false);
    expect(
      incomeThisTick.some(
        (event) => "buildingId" in event && event.buildingId === "agora-shop",
      ),
    ).toBe(true);

    commitTick(store, reducers, {
      events: result.events,
      cursorWallMs: 1_000,
      paused: false,
      tick: result.state.tick,
      simTimeMs: result.state.simTime,
      prngState: serializePrngState(result.prng),
    });

    // --- Mid-fire reopen/rebuild equality ------------------------------
    closeStore(store);
    store = openStore(storePath, reducers);
    const midFireLive = restoreWorldTime(
      readLiveProjections(store, reducers),
      readClock(store.db),
    );
    const midFireRebuilt = restoreWorldTime(
      rebuildProjections(store, reducers),
      readClock(store.db),
    );
    expect(midFireLive).toEqual(result.state);
    expect(midFireRebuilt).toEqual(result.state);

    // --- Export -> import at this mid-fire point: continuing from either
    //     the original store's state or a freshly imported copy, with the
    //     same PRNG and the same (empty) proposal queue, produces the same
    //     fire outcome.
    const exportPath = join(exportDir, "archive.sqlite");
    exportArchive(store, exportPath);
    const importResult = importArchive(
      exportPath,
      slotsDir,
      worldImportReducers,
    );
    const importedStore = openStore(
      join(importResult.slotPath, "world.sqlite"),
      reducers,
    );
    const importedState = restoreWorldTime(
      readLiveProjections(importedStore, reducers),
      readClock(importedStore.db),
    );
    const importedPrng =
      deserializePrngState(readPrngState(importedStore.db)) ?? createPrng(0);

    const continuedFromOriginal = runTick(result.state, result.prng, []);
    const continuedFromImported = runTick(importedState, importedPrng, []);
    expect(continuedFromImported.state).toEqual(continuedFromOriginal.state);
    expect(continuedFromImported.events).toEqual(continuedFromOriginal.events);
    closeStore(importedStore);

    // --- Continue in the original store: the burn crosses the destroy
    //     threshold, the building is destroyed, its inventory disposed,
    //     and it exposes no services.
    result = continuedFromOriginal;
    commitTick(store, reducers, {
      events: result.events,
      cursorWallMs: 2_000,
      paused: false,
      tick: result.state.tick,
      simTimeMs: result.state.simTime,
      prngState: serializePrngState(result.prng),
    });

    result = runTick(result.state, result.prng, []);
    commitTick(store, reducers, {
      events: result.events,
      cursorWallMs: 3_000,
      paused: false,
      tick: result.state.tick,
      simTimeMs: result.state.simTime,
      prngState: serializePrngState(result.prng),
    });
    const tavernDestroyed = result.state.buildings.get(
      toEntityId("the-tavern"),
    );
    if (!tavernDestroyed) throw new Error("expected the tavern building");
    expect(tavernDestroyed.status).toBe("destroyed");
    expect(tavernDestroyed.inventory.size).toBe(0);
    expect(effectiveServices(tavernDestroyed)).toEqual([]);

    // --- Motivated repair: the real economy (the woodcutter gathering,
    //     producing, and selling planks; the farmer buying them) is the
    //     only source of the farmer's planks. Once it holds enough, its
    //     own routine proposes repair over any other choice.
    let tick = 3;
    let repaired = false;
    while (tick < 100 && !repaired) {
      tick += 1;
      const proposals: Proposal[] = [];
      for (const actorId of ["woodcutter", "farmer"] as const) {
        const decision = decideRoutineProposal(
          result.state,
          toEntityId(actorId),
        );
        if (decision) proposals.push(decision.proposal);
      }
      result = runTick(result.state, result.prng, proposals);
      commitTick(store, reducers, {
        events: result.events,
        cursorWallMs: tick * 1_000,
        paused: false,
        tick: result.state.tick,
        simTimeMs: result.state.simTime,
        prngState: serializePrngState(result.prng),
      });
      repaired =
        result.state.buildings.get(toEntityId("the-tavern"))?.status ===
        "operational";
    }

    expect(repaired).toBe(true);
    const tavernRepaired = result.state.buildings.get(toEntityId("the-tavern"));
    if (!tavernRepaired) throw new Error("expected the tavern building");
    expect(tavernRepaired.repairProgress).toBeUndefined();
    expect(effectiveServices(tavernRepaired)).toEqual(["drink"]);

    // Reopen once more from a fresh composition root: the fully repaired
    // state survives, proposal-free.
    closeStore(store);
    const freshReducers = createWorldProjectionReducers(loadGreekWorldState());
    const reopened = openStore(storePath, freshReducers);
    const finalLive = restoreWorldTime(
      readLiveProjections(reopened, freshReducers),
      readClock(reopened.db),
    );
    expect(finalLive).toEqual(result.state);
    closeStore(reopened);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
    rmSync(exportDir, { recursive: true, force: true });
    rmSync(slotsDir, { recursive: true, force: true });
  }
});

// Exercises `deserializePrngState`'s empty-string seed-row case directly,
// since the happy-path scenario above never opens a truly brand-new store
// without ever having written a PRNG state.
test("deserializePrngState treats the empty seed-row string as undefined", () => {
  expect(deserializePrngState("")).toBeUndefined();
  expect(deserializePrngState(JSON.stringify({ seed: 7 }))).toEqual({
    seed: 7,
  });
});

test("two tellings from one observation, one event-linked and one unlinked, survive a close and reopen with their ids, assertions, and link, and a projection rebuild; neither carries a truth flag", () => {
  const storeDir = tempDir("panthea-sim-legends-reopen-");
  try {
    const storePath = join(storeDir, "world.sqlite");
    const seededState = loadGreekWorldState();
    const reducers = createWorldProjectionReducers(seededState);
    let store = openStore(storePath, reducers);

    const telling = (assertion: string, linkedEventId?: string): Proposal => {
      const submitted = submitProposal({
        schemaVersion: 1,
        actor: "farmer",
        targets: [],
        expectedRevisions: [],
        source: "fixture",
        // Both tellings cite the same, unchanged observation.
        observationId: "obs-one-observation",
        kind: "legend",
        assertion,
        ...(linkedEventId ? { linkedEventId } : {}),
      });
      if (!submitted.ok) throw new Error(submitted.rejection.message);
      return submitted.proposal;
    };

    // Tick 1 commits a real event to cite; tick 2 and 3 tell the two legends.
    let state = seededState;
    let prng = createPrng(5);
    const commit = (proposals: Proposal[], wallMs: number) => {
      const result = runTick(state, prng, proposals);
      commitTick(store, reducers, {
        events: result.events,
        cursorWallMs: wallMs,
        paused: false,
        tick: result.state.tick,
        simTimeMs: result.state.simTime,
        prngState: serializePrngState(result.prng),
      });
      state = result.state;
      prng = result.prng;
      return result;
    };
    const first = commit([moveProposal("farmer", "tavern", "obs-move")], 1_000);
    const citedEventId = first.events[0]?.id;
    if (!citedEventId) throw new Error("expected a committed event to cite");
    commit([telling("the farmer walked to the tavern", citedEventId)], 2_000);
    commit([telling("the gods were angry that night")], 3_000);

    const expectedLegends = [...state.legends.values()];
    expect(expectedLegends).toHaveLength(2);

    closeStore(store);
    store = openStore(storePath, reducers);
    const reopened = restoreWorldTime(
      readLiveProjections(store, reducers),
      readClock(store.db),
    );
    const rebuilt = restoreWorldTime(
      rebuildProjections(store, reducers),
      readClock(store.db),
    );

    for (const world of [reopened, rebuilt]) {
      const legends = [...world.legends.values()];
      expect(legends).toEqual(expectedLegends);
      expect(legends.map((legend) => legend.assertion)).toEqual([
        "the farmer walked to the tavern",
        "the gods were angry that night",
      ]);
      expect(legends.map((legend) => legend.linkedEventId)).toEqual([
        citedEventId,
        undefined,
      ]);
      expect(legends.map(isEventLinked)).toEqual([true, false]);
      expect(new Set(legends.map((legend) => legend.id)).size).toBe(2);
      for (const legend of legends) {
        expect(legend).not.toHaveProperty("verified");
      }
    }
    closeStore(store);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

test("startup fails with a clear diagnostic when an embedded god profile matches no deity inhabitant", () => {
  const orphan = {
    schemaVersion: 1,
    id: "nike",
    name: "Nike",
    domains: ["victory"],
    drives: { order: 0.5 },
    abilities: [
      {
        id: "counsel",
        name: "Counsel",
        action: "legend",
        description: "Speaks counsel.",
      },
    ],
    sources: [
      {
        id: "iliad",
        title: "Iliad",
        author: "Homer",
        edition: "test edition",
      },
    ],
    lore: [
      {
        id: "wise",
        statement: "Athena counsels heroes.",
        cites: [{ source: "iliad", locator: "book 1" }],
      },
    ],
    sprite: "placeholder-nike",
  };
  expect(() =>
    loadGreekWorldState([{ label: "nike.json", value: orphan }]),
  ).toThrow("failed to parse the embedded Greek god profiles");
  expect(() =>
    loadGreekWorldState([{ label: "nike.json", value: orphan }]),
  ).toThrow("nike.json.id");
});

test("startup succeeds with the embedded god profiles by default", () => {
  expect(() => loadGreekWorldState()).not.toThrow();
});

// --- Memory, beliefs, and relationships through the real store ----------------------

const id = toEntityId;

/**
 * The Greek world with the story's cast in place: Zeus and a bard at the
 * tavern (the tavern is the farmer's), Hera in the square. None of them has
 * drives, so nothing acts unless a test queues it.
 */
function socialSeed(memoryBalance?: Record<string, number>): WorldState {
  const greek = loadGreekWorldState();
  const zeus = greek.actors.get(id("zeus"));
  const hera = greek.actors.get(id("hera"));
  if (!zeus || !hera) throw new Error("expected Zeus and Hera in the pack");
  const placed = withActor(
    withActor(greek, { ...zeus, locationId: id("tavern") }),
    { ...hera, locationId: id("town-square") },
  );
  const seeded = withActor(placed, {
    id: id("bard"),
    locationId: id("tavern"),
    alive: true,
    capabilities: [],
    inventory: new Map(),
    revision: 0,
  });
  // These stories are about what gods and reports do; the town's own wrongs are tested apart.
  const { temperamentOdds: _wrongs, ...rules } = seeded.rules;
  const quiet = { ...seeded, rules };
  return memoryBalance === undefined
    ? quiet
    : {
        ...quiet,
        rules: {
          ...quiet.rules,
          memoryBalance: { ...DEFAULT_MEMORY_BALANCE, ...memoryBalance },
        },
      };
}

function queuedProposal(
  actor: string,
  raw: Record<string, unknown>,
): QueuedProposal {
  const observation: ObservationRecord = {
    schemaVersion: 1,
    id: createObservationId(),
    observer: id(actor),
    stateRevision: 0,
    factsRead: [],
    source: "fixture",
  };
  const submitted = submitProposal({
    schemaVersion: 1,
    actor,
    targets: [],
    expectedRevisions: [],
    source: "fixture",
    observationId: observation.id,
    ...raw,
  });
  if (!submitted.ok) {
    throw new Error(`fixture proposal failed: ${submitted.rejection.message}`);
  }
  return { id: createProposalId(), proposal: submitted.proposal, observation };
}

/** A live world over a real store and trace: each `run` is one committed tick. */
function liveWorld(storePath: string, seed: WorldState) {
  const reducers = createWorldProjectionReducers(seed);
  const store = openStore(storePath, reducers);
  ensureTraceSchema(store.db);
  let state = seed;
  let prng = createPrng(1);
  let wallMs = 0;
  return {
    store,
    reducers,
    get state() {
      return state;
    },
    run(...queue: QueuedProposal[]) {
      wallMs += 1_000;
      const step = applyOneTick(
        state,
        prng,
        queue,
        { store, reducers, traceDb: store.db },
        { cursorWallMs: wallMs, paused: false },
      );
      if (step.kind !== "committed") {
        throw new Error(`tick did not commit: ${step.message}`);
      }
      state = step.state;
      prng = step.prng;
      return step;
    },
  };
}

/** Zeus walks to the square and tells Hera, there, that he wronged the farmer: a newer account than the bard's, from another teller. Returns the report's id. */
function zeusAdmits(world: ReturnType<typeof liveWorld>) {
  const square = id("town-square");
  for (let hop = 0; hop < 12; hop += 1) {
    const zeus = world.state.actors.get(id("zeus"));
    if (!zeus || zeus.locationId === square) break;
    const next = nextHop(
      world.state,
      zeus.locationId,
      square,
      zeus.capabilities,
    );
    if (next === undefined) throw new Error("Zeus has no way to the square");
    world.run(queuedProposal("zeus", { kind: "move", to: next }));
  }
  world.run(
    queuedProposal("zeus", {
      kind: "report",
      listener: "hera",
      content: "I wronged him again",
      claim: { effect: "harm", agent: "zeus", target: "farmer" },
    }),
  );
  const told = eventOfKindAll(listEvents(world.store.db), "report-told").at(-1);
  if (!told) throw new Error("expected Zeus's report");
  return told;
}

function eventOfKindAll<K extends WorldEvent["kind"]>(
  events: readonly WorldEvent[],
  kind: K,
): Extract<WorldEvent, { kind: K }>[] {
  return events.filter(
    (event): event is Extract<WorldEvent, { kind: K }> => event.kind === kind,
  );
}

function eventOfKind<K extends WorldEvent["kind"]>(
  events: readonly WorldEvent[],
  kind: K,
  predicate: (event: Extract<WorldEvent, { kind: K }>) => boolean = () => true,
): Extract<WorldEvent, { kind: K }> {
  const found = events.find(
    (event): event is Extract<WorldEvent, { kind: K }> =>
      event.kind === kind &&
      predicate(event as Extract<WorldEvent, { kind: K }>),
  );
  if (!found) throw new Error(`expected a ${kind} event`);
  return found;
}

test("a witnessed strike, a report, and a relationship change survive reopen, rebuild, and archive import; the restored branch explains the change from its events, with no trace rows", () => {
  const storeDir = tempDir("panthea-sim-social-");
  const exportDir = tempDir("panthea-sim-social-export-");
  const slotsDir = tempDir("panthea-sim-social-slots-");
  try {
    const storePath = join(storeDir, "world.sqlite");
    const seed = socialSeed();
    const world = liveWorld(storePath, seed);

    // Zeus strikes the tavern with the bard beside him; the bard walks to the
    // square and tells Hera something that is not what happened.
    const strike = queuedProposal("zeus", {
      kind: "strike",
      target: "the-tavern",
      power: 3,
    });
    world.run(strike);
    const ignition = eventOfKind(
      listEvents(world.store.db),
      "building-ignited",
    );
    world.run(queuedProposal("bard", { kind: "move", to: "town-square" }));
    const told = "Zeus burned down the whole agora";
    const report = queuedProposal("bard", {
      kind: "report",
      listener: "hera",
      content: told,
      linkedEventId: ignition.id,
      claim: { effect: "harm", agent: "zeus", target: "farmer" },
    });
    world.run(report);
    const state = world.state;

    // What the world holds. (The fire also spread to the oak in the square,
    // which the bard and Hera saw, so each remembers more than the tavern.)
    expect(getMemories(state, id("bard"))).toContainEqual(
      expect.objectContaining({
        kind: "witnessed",
        sourceEventId: ignition.id,
      }),
    );
    const belief = getMemories(state, id("hera")).find(
      (memory) => memory.kind === "told",
    );
    expect(belief).toMatchObject({
      kind: "told",
      teller: "bard",
      content: told,
      linkedEventId: ignition.id,
    });
    const changes = eventOfKindAll(
      listEvents(world.store.db),
      "relationship-changed",
    );
    const fromBelief = changes.filter(
      (event) => event.memoryEventId === belief?.id,
    );
    expect(fromBelief).toMatchObject([
      { entityId: "hera", toward: "zeus", affinityDelta: -1, grudgeDelta: 0 },
    ]);
    const heraTowardZeus = changes
      .filter(
        (event) => event.entityId === id("hera") && event.toward === id("zeus"),
      )
      .reduce((sum, event) => sum + event.affinityDelta, 0);
    expect(getRelationship(state, id("hera"), id("zeus"))?.affinity).toBe(
      heraTowardZeus,
    );
    // The woodcutter, in the square all along, saw the oak catch but was told nothing and never saw the tavern.
    expect(
      getMemories(state, id("woodcutter")).map((m) => m.kind),
    ).not.toContain("told");
    expect(
      getMemories(state, id("woodcutter")).some(
        (memory) => memory.sourceEventId === ignition.id,
      ),
    ).toBe(false);

    // Live equals reopened equals rebuilt.
    closeStore(world.store);
    const freshReducers = createWorldProjectionReducers(socialSeed());
    const reopened = openStore(storePath, freshReducers);
    const clock = readClock(reopened.db);
    expect(
      restoreWorldTime(readLiveProjections(reopened, freshReducers), clock),
    ).toEqual(state);
    expect(
      restoreWorldTime(rebuildProjections(reopened, freshReducers), clock),
    ).toEqual(state);

    // Export, import into a new slot: the branch holds the same memories and relationships.
    const exportPath = join(exportDir, "archive.sqlite");
    exportArchive(reopened, exportPath);
    const imported = importArchive(exportPath, slotsDir, worldImportReducers);
    const branch = openStore(
      join(imported.slotPath, "world.sqlite"),
      freshReducers,
    );
    const branchClock = readClock(branch.db);
    const restored = restoreWorldTime(
      readLiveProjections(branch, freshReducers),
      branchClock,
    );
    expect(restored.memories).toEqual(state.memories);
    expect(restored.relationships).toEqual(state.relationships);
    expect(
      restoreWorldTime(rebuildProjections(branch, freshReducers), branchClock),
    ).toEqual(state);

    // The branch has no trace, and still explains why Hera distrusts Zeus.
    ensureTraceSchema(branch.db);
    expect(
      getProposalOutcomeByProposalId(branch.db, report.id),
    ).toBeUndefined();
    expect(
      getProposalOutcomeByProposalId(branch.db, strike.id),
    ).toBeUndefined();
    const events = listEvents(branch.db);
    const change = eventOfKind(
      events,
      "relationship-changed",
      (event) => event.memoryEventId === belief?.id,
    );
    const chain = causalChain(
      (eventId) => getEventRow(branch.db, eventId),
      change.id,
    );
    expect(chain.map((event) => event.kind)).toEqual([
      "building-ignited",
      "report-told",
      "memory-recorded",
      "relationship-changed",
    ]);
    expect(eventOfKind(chain, "report-told")).toMatchObject({
      entityId: "bard",
      listenerId: "hera",
      content: told,
    });
    // The memory the restored state carries names the same events the chain does.
    expect(
      getMemories(restored, id("hera")).find(
        (memory) => memory.id === change.memoryEventId,
      ),
    ).toMatchObject({
      id: change.memoryEventId,
      sourceEventId: eventOfKind(chain, "report-told").id,
      linkedEventId: ignition.id,
    });
    const followed = followEvent(
      branch.db,
      createEventSource(branch),
      change.id,
    );
    expect(followed.found).toBe(true);
    expect(
      followed.steps.every(
        (step) => step.step === "event" || step.step === "projection-change",
      ),
    ).toBe(true);

    // Control: on the live world, where the trace exists, the same chain reaches the strike's proposal.
    const liveTrace = openStore(storePath, freshReducers);
    const liveFollow = followEvent(
      liveTrace.db,
      createEventSource(liveTrace),
      change.id,
    );
    expect(
      liveFollow.steps.filter((step) => step.step === "proposal"),
    ).toHaveLength(2);
    closeStore(liveTrace);

    closeStore(branch);
    closeStore(reopened);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
    rmSync(exportDir, { recursive: true, force: true });
    rmSync(slotsDir, { recursive: true, force: true });
  }
});

test("practice threads survive reopen, rebuild, and archive import: a fulfilled settlement and a countered one are rebuilt exactly, and the thread explains itself from the log", () => {
  const storeDir = tempDir("panthea-sim-practice-");
  const exportDir = tempDir("panthea-sim-practice-export-");
  const slotsDir = tempDir("panthea-sim-practice-slots-");
  try {
    const storePath = join(storeDir, "world.sqlite");
    const world = liveWorld(storePath, socialSeed());

    // Zeus strikes the tavern with the bard beside him; the bard tells Hera in the square.
    world.run(
      queuedProposal("zeus", {
        kind: "strike",
        target: "the-tavern",
        power: 3,
      }),
    );
    const ignition = eventOfKind(
      listEvents(world.store.db),
      "building-ignited",
    );
    world.run(queuedProposal("bard", { kind: "move", to: "town-square" }));
    world.run(
      queuedProposal("bard", {
        kind: "report",
        listener: "hera",
        content: "Zeus burned the tavern",
        linkedEventId: ignition.id,
        claim: { effect: "harm", agent: "zeus", target: "farmer" },
      }),
    );

    // Hera demands a legend in the square; Zeus accepts, walks there, and tells it.
    const tellInSquare = (ticks: number) => ({
      kind: "tell-legend",
      party: "zeus",
      place: "town-square",
      deadlineTicks: ticks,
    });
    world.run(
      queuedProposal("hera", {
        kind: "practice",
        move: "demand",
        counterparty: "zeus",
        cause: ignition.id,
        term: tellInSquare(100),
      }),
    );
    const [first] = [...world.state.threads.values()];
    if (!first) throw new Error("expected a thread");
    world.run(
      queuedProposal("zeus", {
        kind: "practice",
        move: "accept",
        thread: first.id,
        swear: true,
        expectedRevisions: [{ entityId: first.id, revision: first.revision }],
      }),
    );
    const square = id("town-square");
    for (let hop = 0; hop < 12; hop += 1) {
      const zeus = world.state.actors.get(id("zeus"));
      if (!zeus || zeus.locationId === square) break;
      const next = nextHop(
        world.state,
        zeus.locationId,
        square,
        zeus.capabilities,
      );
      if (next === undefined) throw new Error("Zeus has no way to the square");
      world.run(queuedProposal("zeus", { kind: "move", to: next }));
    }
    world.run(
      queuedProposal("zeus", {
        kind: "legend",
        assertion: "Hera is queen of heaven",
      }),
    );
    expect(world.state.threads.get(first.id)?.status).toBe("fulfilled");

    // A new account of the same wrong reaches Hera, from Zeus himself: a newer cause, so she may demand again.
    const newer = zeusAdmits(world);
    // A second demand on the newer cause, and Zeus's counter, left open.
    world.run(
      queuedProposal("hera", {
        kind: "practice",
        move: "demand",
        counterparty: "zeus",
        cause: newer.id,
        term: tellInSquare(120),
      }),
    );
    const second = [...world.state.threads.values()].at(-1);
    if (!second) throw new Error("expected a second thread");
    world.run(
      queuedProposal("zeus", {
        kind: "practice",
        move: "counter",
        thread: second.id,
        term: tellInSquare(150),
      }),
    );
    const state = world.state;
    expect([...state.threads.values()].map((t) => t.status)).toEqual([
      "fulfilled",
      "countered",
    ]);

    // The thread explains itself from the log: its opening rests on the strike Hera was told of.
    const events = listEvents(world.store.db);
    const ended = eventOfKind(events, "practice-ended");
    expect(ended).toMatchObject({ outcome: "fulfilled", threadId: first.id });
    const opening = eventOfKind(events, "practice-opened");
    expect(
      causalChain(
        (eventId) => getEventRow(world.store.db, eventId),
        opening.id,
      ).map((event) => event.kind),
    ).toEqual(["building-ignited", "practice-opened"]);

    // Live equals reopened equals rebuilt.
    closeStore(world.store);
    const freshReducers = createWorldProjectionReducers(socialSeed());
    const reopened = openStore(storePath, freshReducers);
    const clock = readClock(reopened.db);
    expect(
      restoreWorldTime(readLiveProjections(reopened, freshReducers), clock),
    ).toEqual(state);
    expect(
      restoreWorldTime(rebuildProjections(reopened, freshReducers), clock),
    ).toEqual(state);

    // Export, import into a new slot: the branch rebuilds the same threads.
    const exportPath = join(exportDir, "archive.sqlite");
    exportArchive(reopened, exportPath);
    const imported = importArchive(exportPath, slotsDir, worldImportReducers);
    const branch = openStore(
      join(imported.slotPath, "world.sqlite"),
      freshReducers,
    );
    const branchClock = readClock(branch.db);
    const restored = restoreWorldTime(
      readLiveProjections(branch, freshReducers),
      branchClock,
    );
    expect(restored.threads).toEqual(state.threads);
    expect(restored.threads.get(first.id)?.acceptance?.sworn).toBe(true);
    expect(
      restoreWorldTime(rebuildProjections(branch, freshReducers), branchClock),
    ).toEqual(state);
    closeStore(branch);
    closeStore(reopened);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
    rmSync(exportDir, { recursive: true, force: true });
    rmSync(slotsDir, { recursive: true, force: true });
  }
});

test("a supplication survives reopen, rebuild, and archive import: the prayer, the terms on it, the stake, and the half of the bargain already seen are rebuilt exactly", () => {
  const storeDir = tempDir("panthea-sim-supplication-");
  const exportDir = tempDir("panthea-sim-supplication-export-");
  const slotsDir = tempDir("panthea-sim-supplication-slots-");
  try {
    const storePath = join(storeDir, "world.sqlite");
    const seed = (() => {
      const base = socialSeed();
      const farmer = base.actors.get(id("farmer"));
      if (!farmer) throw new Error("expected the farmer");
      return withActor(base, { ...farmer, locationId: id("tavern") });
    })();
    const world = liveWorld(storePath, seed);

    // Zeus strikes the farmer's tavern with the farmer there; the farmer walks to the altar and prays about it.
    world.run(
      queuedProposal("zeus", {
        kind: "strike",
        target: "the-tavern",
        power: 3,
      }),
    );
    const ignition = eventOfKind(
      listEvents(world.store.db),
      "building-ignited",
    );
    const altar = id("altar");
    for (let hop = 0; hop < 12; hop += 1) {
      const farmer = world.state.actors.get(id("farmer"));
      if (!farmer || farmer.locationId === altar) break;
      const next = nextHop(
        world.state,
        farmer.locationId,
        altar,
        farmer.capabilities,
      );
      if (next === undefined)
        throw new Error("the farmer has no way to the altar");
      world.run(queuedProposal("farmer", { kind: "move", to: next }));
    }
    world.run(queuedProposal("farmer", { kind: "pray", cause: ignition.id }));
    const [petition] = [...world.state.petitions.values()];
    if (!petition) throw new Error("expected a petition");

    // The god offers terms with a stake; the farmer accepts and makes its offering first.
    const god = String(petition.god);
    world.run(
      queuedProposal(god, {
        kind: "practice",
        move: "offer",
        petition: petition.id,
        stake: "wolf",
        term: {
          kind: "make-offering",
          party: "farmer",
          to: god,
          resource: "currency",
          amount: 1,
          deadlineTicks: 100,
        },
      }),
    );
    const [thread] = [...world.state.threads.values()];
    if (!thread) throw new Error("expected a supplication thread");
    expect(thread).toMatchObject({
      practice: "supplication",
      petition: petition.id,
    });
    world.run(
      queuedProposal("farmer", {
        kind: "practice",
        move: "accept",
        thread: thread.id,
      }),
    );
    world.run(
      queuedProposal("farmer", {
        kind: "worship",
        deity: god,
        offering: { resource: "currency", amount: 1 },
      }),
    );
    const state = world.state;
    const held = state.threads.get(thread.id);
    expect(held).toMatchObject({
      status: "accepted",
      stake: { form: "wolf" },
      progress: { offering: expect.anything() },
    });
    expect(held?.progress?.boon).toBeUndefined();
    const progressed = eventOfKind(
      listEvents(world.store.db),
      "practice-progressed",
    );
    expect(progressed).toMatchObject({ step: "offering", threadId: thread.id });

    // Live equals reopened equals rebuilt.
    closeStore(world.store);
    const freshReducers = createWorldProjectionReducers(seed);
    const reopened = openStore(storePath, freshReducers);
    const clock = readClock(reopened.db);
    expect(
      restoreWorldTime(readLiveProjections(reopened, freshReducers), clock),
    ).toEqual(state);
    expect(
      restoreWorldTime(rebuildProjections(reopened, freshReducers), clock),
    ).toEqual(state);

    // Export, import into a new slot: the branch rebuilds the same thread.
    const exportPath = join(exportDir, "archive.sqlite");
    exportArchive(reopened, exportPath);
    const imported = importArchive(exportPath, slotsDir, worldImportReducers);
    const branch = openStore(
      join(imported.slotPath, "world.sqlite"),
      freshReducers,
    );
    const branchClock = readClock(branch.db);
    const restored = restoreWorldTime(
      readLiveProjections(branch, freshReducers),
      branchClock,
    );
    expect(restored.threads).toEqual(state.threads);
    expect(restored.threads.get(thread.id)?.petition).toBe(petition.id);
    expect(restored.petitions).toEqual(state.petitions);
    expect(
      restoreWorldTime(rebuildProjections(branch, freshReducers), branchClock),
    ).toEqual(state);
    closeStore(branch);
    closeStore(reopened);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
    rmSync(exportDir, { recursive: true, force: true });
    rmSync(slotsDir, { recursive: true, force: true });
  }
});

test("a sworn breach's penalty, the endings' memories, and a sealed alliance survive reopen, rebuild, and archive import", () => {
  const storeDir = tempDir("panthea-sim-ending-");
  const exportDir = tempDir("panthea-sim-ending-export-");
  const slotsDir = tempDir("panthea-sim-ending-slots-");
  try {
    const storePath = join(storeDir, "world.sqlite");
    const world = liveWorld(storePath, socialSeed());
    world.run(
      queuedProposal("zeus", {
        kind: "strike",
        target: "the-tavern",
        power: 3,
      }),
    );
    const ignition = eventOfKind(
      listEvents(world.store.db),
      "building-ignited",
    );
    world.run(queuedProposal("bard", { kind: "move", to: "town-square" }));
    world.run(
      queuedProposal("bard", {
        kind: "report",
        listener: "hera",
        content: "Zeus burned the tavern",
        linkedEventId: ignition.id,
        claim: { effect: "harm", agent: "zeus", target: "farmer" },
      }),
    );
    // Hera demands a legend in the square; Zeus swears it and never tells it.
    world.run(
      queuedProposal("hera", {
        kind: "practice",
        move: "demand",
        counterparty: "zeus",
        cause: ignition.id,
        term: {
          kind: "tell-legend",
          party: "zeus",
          place: "town-square",
          deadlineTicks: 30,
        },
      }),
    );
    const [oath] = [...world.state.threads.values()];
    if (!oath) throw new Error("expected a thread");
    world.run(
      queuedProposal("zeus", {
        kind: "practice",
        move: "accept",
        thread: oath.id,
        swear: true,
        expectedRevisions: [{ entityId: oath.id, revision: oath.revision }],
      }),
    );
    for (let tick = 0; tick < 40; tick += 1) {
      if (world.state.threads.get(oath.id)?.status === "breached") break;
      world.run();
    }
    expect(world.state.threads.get(oath.id)?.status).toBe("breached");
    const zeus = world.state.actors.get(id("zeus"));
    expect(zeus?.capabilities).not.toContain("divine");
    expect(zeus?.withheld).toHaveLength(1);

    // Later, Zeus and Hera seal an alliance, over a newer account of the same wrong.
    const newer = zeusAdmits(world);
    world.run(
      queuedProposal("hera", {
        kind: "practice",
        move: "demand",
        counterparty: "zeus",
        cause: newer.id,
        term: { kind: "ally", party: "zeus", to: "hera", deadlineTicks: 30 },
      }),
    );
    const seal = [...world.state.threads.values()].at(-1);
    if (!seal) throw new Error("expected a second thread");
    world.run(
      queuedProposal("zeus", {
        kind: "practice",
        move: "accept",
        thread: seal.id,
        expectedRevisions: [{ entityId: seal.id, revision: seal.revision }],
      }),
    );
    expect(world.state.threads.get(seal.id)?.status).toBe("fulfilled");
    const state = world.state;
    expect(getRelationship(state, id("hera"), id("zeus"))?.allied).toBe(true);

    const events = listEvents(world.store.db);
    const penalty = eventOfKind(
      events,
      "motif-applied",
      (event) => event.effect === "oath-penalty",
    );
    const breach = eventOfKind(
      events,
      "practice-ended",
      (event) => event.outcome === "breached",
    );
    expect(penalty).toMatchObject({ entityId: "zeus", cause: breach.id });
    // Both parties' memories of the breach come from events of the breach's own tick.
    const remembered = events.filter(
      (event) =>
        event.kind === "memory-recorded" && event.sourceEventId === breach.id,
    );
    expect(remembered.map((event) => event.tick)).toEqual([
      breach.tick,
      breach.tick,
    ]);

    closeStore(world.store);
    const freshReducers = createWorldProjectionReducers(socialSeed());
    const reopened = openStore(storePath, freshReducers);
    const clock = readClock(reopened.db);
    expect(
      restoreWorldTime(readLiveProjections(reopened, freshReducers), clock),
    ).toEqual(state);
    expect(
      restoreWorldTime(rebuildProjections(reopened, freshReducers), clock),
    ).toEqual(state);

    const exportPath = join(exportDir, "archive.sqlite");
    exportArchive(reopened, exportPath);
    const imported = importArchive(exportPath, slotsDir, worldImportReducers);
    const branch = openStore(
      join(imported.slotPath, "world.sqlite"),
      freshReducers,
    );
    const branchClock = readClock(branch.db);
    const restored = restoreWorldTime(
      readLiveProjections(branch, freshReducers),
      branchClock,
    );
    expect(restored.actors.get(id("zeus"))?.withheld).toEqual(zeus?.withheld);
    expect(restored.relationships).toEqual(state.relationships);
    expect(
      restoreWorldTime(rebuildProjections(branch, freshReducers), branchClock),
    ).toEqual(state);
    closeStore(branch);
    closeStore(reopened);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
    rmSync(exportDir, { recursive: true, force: true });
    rmSync(slotsDir, { recursive: true, force: true });
  }
});

/** Athena beside Poseidon at the ferry dock, where fishers live, and a window of 6 ticks so a contest closes within a test. */
function contestSeed(): WorldState {
  const greek = loadGreekWorldState();
  const athena = greek.actors.get(id("athena"));
  if (!athena) throw new Error("expected Athena in the pack");
  const placed = withActor(greek, { ...athena, locationId: id("ferry-dock") });
  return {
    ...placed,
    rules: {
      ...placed.rules,
      practiceBalance: {
        ...placed.rules.practiceBalance,
        contestWindowTicks: 6,
      },
    },
  };
}

/** Poseidon tells a legend before the fishers at the dock; Athena, who heard it, contests it and out-tells him. Runs on to the contest's close when `toClose`. */
function playContest(storePath: string, toClose: boolean) {
  const world = liveWorld(storePath, contestSeed());
  world.run(
    queuedProposal("poseidon", {
      kind: "legend",
      assertion: "The sea feeds the dock.",
    }),
  );
  const told = eventOfKind(listEvents(world.store.db), "legend-recorded");
  world.run(
    queuedProposal("athena", {
      kind: "practice",
      move: "contest",
      cause: told.id,
    }),
  );
  const contest = [...world.state.contests.values()][0];
  if (!contest) throw new Error("expected a contest");
  world.run(
    queuedProposal("athena", {
      kind: "legend",
      assertion: "The olive feeds the dock better.",
    }),
  );
  if (toClose) {
    for (
      let n = 0;
      n < 12 && world.state.contests.get(contest.id)?.status === "open";
      n += 1
    ) {
      world.run();
    }
  }
  return { world, contest, told };
}

test("a contest, the acts the world kept for it, and the standing it decided survive reopen, rebuild, and archive import, open or closed", () => {
  const storeDir = tempDir("panthea-sim-contest-");
  const exportDir = tempDir("panthea-sim-contest-export-");
  const slotsDir = tempDir("panthea-sim-contest-slots-");
  try {
    for (const toClose of [false, true]) {
      const storePath = join(storeDir, `world-${toClose}.sqlite`);
      const { world, contest, told } = playContest(storePath, toClose);
      const state = world.state;
      const held = state.contests.get(contest.id);
      expect(held?.opener).toBe(id("athena"));
      expect(state.services.map((act) => act.id)).toContain(told.id);
      expect(held?.tallies.length).toBeGreaterThan(0);
      if (toClose) {
        expect(held?.status).toBe("decided");
        expect(held?.winner).toBe(id("athena"));
        expect(state.standing.size).toBe(2);
      } else {
        expect(held?.status).toBe("open");
      }

      closeStore(world.store);
      const freshReducers = createWorldProjectionReducers(contestSeed());
      const reopened = openStore(storePath, freshReducers);
      const clock = readClock(reopened.db);
      expect(
        restoreWorldTime(readLiveProjections(reopened, freshReducers), clock),
      ).toEqual(state);
      expect(
        restoreWorldTime(rebuildProjections(reopened, freshReducers), clock),
      ).toEqual(state);

      const exportPath = join(exportDir, `archive-${toClose}.sqlite`);
      exportArchive(reopened, exportPath);
      const imported = importArchive(exportPath, slotsDir, worldImportReducers);
      const branch = openStore(
        join(imported.slotPath, "world.sqlite"),
        freshReducers,
      );
      const branchClock = readClock(branch.db);
      const restored = restoreWorldTime(
        readLiveProjections(branch, freshReducers),
        branchClock,
      );
      expect(restored.contests).toEqual(state.contests);
      expect(restored.services).toEqual(state.services);
      expect(restored.standing).toEqual(state.standing);
      expect(
        restoreWorldTime(
          rebuildProjections(branch, freshReducers),
          branchClock,
        ),
      ).toEqual(state);
      closeStore(branch);
      closeStore(reopened);
    }
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
    rmSync(exportDir, { recursive: true, force: true });
    rmSync(slotsDir, { recursive: true, force: true });
  }
});

test("live equals rebuild through the store when the world forgets: the same memory is evicted either way", () => {
  const storeDir = tempDir("panthea-sim-evict-");
  try {
    const storePath = join(storeDir, "world.sqlite");
    const world = liveWorld(storePath, socialSeed({ capacity: 1 }));
    world.run(
      queuedProposal("zeus", {
        kind: "strike",
        target: "the-tavern",
        power: 3,
      }),
    );
    for (let index = 0; index < 3; index += 1) world.run();

    const recorded = listEvents(world.store.db).filter(
      (event) => event.kind === "memory-recorded" && event.entityId === "zeus",
    );
    // Zeus saw the tavern ignite and then burn down; with room for one memory he keeps the worse.
    expect(
      recorded.map((event) => (event as { eventKind: string }).eventKind),
    ).toEqual(["building-ignited", "building-destroyed"]);
    expect(getMemories(world.state, id("zeus"))).toMatchObject([
      { kind: "witnessed", eventKind: "building-destroyed" },
    ]);

    const clock = readClock(world.store.db);
    expect(
      restoreWorldTime(readLiveProjections(world.store, world.reducers), clock),
    ).toEqual(world.state);
    expect(
      restoreWorldTime(rebuildProjections(world.store, world.reducers), clock),
    ).toEqual(world.state);
    closeStore(world.store);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

test("a tick's memories and relationship changes commit with the events they cite, or not at all", () => {
  const storeDir = tempDir("panthea-sim-atomic-");
  try {
    const seed = socialSeed();
    const reducers = createWorldProjectionReducers(seed);
    const store = openStore(join(storeDir, "world.sqlite"), reducers);
    // No trace tables yet: the tick's trace write will fail inside its transaction.

    const strike = queuedProposal("zeus", {
      kind: "strike",
      target: "the-tavern",
      power: 3,
    });
    const deps = { store, reducers, traceDb: store.db };

    // The tick does derive memories and feelings, or rolling them back proves nothing.
    const planned = stepWorldTick(seed, createPrng(1), [strike]).result;
    expect(
      planned.derivedEvents.some((e) => e.kind === "memory-recorded"),
    ).toBe(true);
    expect(
      planned.derivedEvents.some((e) => e.kind === "relationship-changed"),
    ).toBe(true);

    const failed = applyOneTick(seed, createPrng(1), [strike], deps, {
      cursorWallMs: 1_000,
      paused: false,
    });
    expect(failed.kind).toBe("store-error");
    expect(listEvents(store.db)).toEqual([]);
    expect(getCurrentSequence(store.db)).toBe(0);
    const afterFailure = readLiveProjections(store, reducers);
    expect(afterFailure.memories.size).toBe(0);
    // Only the starting devotions: the failed tick's feelings were rolled back.
    expect(afterFailure.relationships.size).toBe(seed.relationships.size);
    expect(afterFailure.buildings.get(id("the-tavern"))?.status).toBe(
      "operational",
    );

    // Control: with the trace in place, the same tick commits the strike, its memories, and the changes together.
    ensureTraceSchema(store.db);
    const committed = applyOneTick(seed, createPrng(1), [strike], deps, {
      cursorWallMs: 1_000,
      paused: false,
    });
    expect(committed.kind).toBe("committed");
    const events = listEvents(store.db);
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_, index) => index + 1),
    );
    const kinds = events.map((event) => event.kind);
    expect(kinds.indexOf("building-ignited")).toBeLessThan(
      kinds.indexOf("memory-recorded"),
    );
    expect(kinds.indexOf("memory-recorded")).toBeLessThan(
      kinds.indexOf("relationship-changed"),
    );
    const live = readLiveProjections(store, reducers);
    expect(getMemories(live, id("zeus"))).toHaveLength(1);
    expect(getMemories(live, id("bard"))).toHaveLength(1);
    // Every memory event in the log is in the projection, by the event's own id.
    for (const event of events) {
      if (event.kind !== "memory-recorded") continue;
      expect(
        getMemories(live, event.entityId).some(
          (memory) => memory.id === event.id,
        ),
      ).toBe(true);
    }
    closeStore(store);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

// --- An archive's projection must be what its event log makes ----------------------------

/** Rewrites one archive row and re-hashes, so only the projection-versus-log check can object. */
function rehashArchive(archivePath: string, edit: (db: Database) => void) {
  const db = new Database(archivePath);
  edit(db);
  const manifest = db.query("SELECT * FROM manifest WHERE id = 1").get() as {
    format_version: number;
    sqlite_schema_version: number;
    payload_schema_version: number;
    world_id: string;
    event_sequence: number;
  };
  db.run("UPDATE manifest SET content_hash = ?", [
    computeContentHash(db, {
      formatVersion: manifest.format_version,
      sqliteSchemaVersion: manifest.sqlite_schema_version,
      payloadSchemaVersion: manifest.payload_schema_version,
      worldId: manifest.world_id as never,
      eventSequence: manifest.event_sequence,
    }),
  ]);
  db.close();
}

interface EncodedProjection {
  memories: [string, unknown[]][];
  relationships: unknown[];
  buildings: [string, Record<string, unknown>][];
  rules: Record<string, unknown>;
}

function editProjection(
  db: Database,
  edit: (encoded: EncodedProjection) => void,
) {
  const row = db.query("SELECT data FROM projections WHERE id = 1").get() as {
    data: string;
  };
  const encoded = JSON.parse(row.data) as EncodedProjection;
  edit(encoded);
  db.run("UPDATE projections SET data = ? WHERE id = 1", [
    JSON.stringify(encoded),
  ]);
}

test("import rebuilds the projection from the archive's genesis and log: forged memories, relationships, and fire causes are refused; the honest archive imports with the same state", () => {
  const dir = tempDir("panthea-sim-forged-");
  try {
    const seed = socialSeed();
    const world = liveWorld(join(dir, "world.sqlite"), seed);
    world.run(
      queuedProposal("zeus", {
        kind: "strike",
        target: "the-tavern",
        power: 3,
      }),
    );
    world.run(queuedProposal("bard", { kind: "move", to: "town-square" }));
    const honest = join(dir, "honest.sqlite");
    exportArchive(world.store, honest);

    // Control: untouched, it imports, and the imported world is the live one.
    const control = importArchive(
      honest,
      join(dir, "slots-ok"),
      worldImportReducers,
    );
    const controlStore = openStore(
      join(control.slotPath, "world.sqlite"),
      createWorldProjectionReducers(socialSeed()),
    );
    expect(
      restoreWorldTime(
        readLiveProjections(controlStore, world.reducers),
        readClock(controlStore.db),
      ),
    ).toEqual(world.state);
    closeStore(controlStore);

    type Forge = (encoded: EncodedProjection) => void;
    const forgeries: Record<string, Forge> = {
      "a memory nobody formed": (encoded) => {
        const { memories } = encoded;
        const at = memories.find(([owner]) => owner === "hera");
        const entry = {
          id: "evt-9-9",
          kind: "witnessed",
          sourceEventId: "evt-1-1",
          eventKind: "building-destroyed",
          salience: 9,
          recordedAt: 999,
          subjects: ["zeus"],
          consequence: { effect: "harm", agent: "zeus" },
        };
        if (at) at[1].push(entry);
        else memories.push(["hera", [entry]]);
      },
      "a relationship no event changed": (encoded) => {
        encoded.relationships.push([
          "hera>zeus",
          {
            from: "hera",
            toward: "zeus",
            affinity: -10,
            grudge: 5,
            allied: false,
          },
        ]);
      },
      "a fire cause no strike started": (encoded) => {
        const buildings = encoded.buildings as [
          string,
          Record<string, unknown>,
        ][];
        for (const [buildingId, building] of buildings) {
          if (buildingId === "the-tavern") {
            building.ignition = { eventId: "evt-1-1", actor: "hera" };
          }
        }
      },
    };
    for (const [name, forge] of Object.entries(forgeries)) {
      const forged = join(dir, `forged-${name.replaceAll(" ", "-")}.sqlite`);
      copyFileSync(honest, forged);
      rehashArchive(forged, (db) => editProjection(db, forge));
      const slots = join(dir, `slots-${name.replaceAll(" ", "-")}`);
      let caught: unknown;
      try {
        importArchive(forged, slots, worldImportReducers);
      } catch (error) {
        caught = error;
      }
      expect(caught, name).toBeInstanceOf(ImportError);
      expect((caught as ImportError).kind, name).toBe("corrupt");
      expect(existsSync(slots) ? readdirSync(slots) : [], name).toEqual([]);
    }
    closeStore(world.store);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a rehashed archive that carries hostile memory tunables, or more memories than its capacity allows, is refused before any slot is made", () => {
  const dir = tempDir("panthea-sim-hostile-");
  try {
    const world = liveWorld(join(dir, "world.sqlite"), socialSeed());
    world.run(
      queuedProposal("zeus", {
        kind: "strike",
        target: "the-tavern",
        power: 3,
      }),
    );
    const honest = join(dir, "honest.sqlite");
    exportArchive(world.store, honest);

    const attacks: Record<string, (encoded: EncodedProjection) => void> = {
      "negative capacity": (encoded) => {
        encoded.rules.memoryBalance = {
          capacity: -1,
        };
      },
      "unknown tunable": (encoded) => {
        encoded.rules.memoryBalance = {
          capcity: 1,
        };
      },
      "more memories than capacity": (encoded) => {
        encoded.rules.memoryBalance = {
          capacity: 0,
        };
      },
    };
    for (const [name, attack] of Object.entries(attacks)) {
      const hostile = join(dir, `hostile-${name.replaceAll(" ", "-")}.sqlite`);
      copyFileSync(honest, hostile);
      rehashArchive(hostile, (db) => editProjection(db, attack));
      const slots = join(dir, `slots-${name.replaceAll(" ", "-")}`);
      let caught: unknown;
      try {
        importArchive(hostile, slots, worldImportReducers);
      } catch (error) {
        caught = error;
      }
      expect(caught, name).toBeInstanceOf(ImportError);
      expect((caught as ImportError).kind, name).toBe("corrupt");
      expect(existsSync(slots) ? readdirSync(slots) : [], name).toEqual([]);
    }
    closeStore(world.store);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a report told with zero belief salience commits, and the world survives reopen and export then import", () => {
  const dir = tempDir("panthea-sim-zero-told-");
  try {
    const storePath = join(dir, "world.sqlite");
    const world = liveWorld(storePath, socialSeed({ salience_told: 0 }));
    world.run(
      queuedProposal("bard", {
        kind: "report",
        listener: "zeus",
        content: "The farmer grumbles",
        claim: { effect: "harm", agent: "farmer", target: "bard" },
      }),
    );
    const state = world.state;
    const events = listEvents(world.store.db);
    expect(events.some((event) => event.kind === "report-told")).toBe(true);
    expect(events.some((event) => event.kind === "memory-recorded")).toBe(
      false,
    );
    expect(getMemories(state, id("zeus"))).toEqual([]);

    // Reopen from disk with a fresh composition root.
    closeStore(world.store);
    const fresh = createWorldProjectionReducers(
      socialSeed({ salience_told: 0 }),
    );
    const reopened = openStore(storePath, fresh);
    const clock = readClock(reopened.db);
    expect(
      restoreWorldTime(readLiveProjections(reopened, fresh), clock),
    ).toEqual(state);
    expect(
      restoreWorldTime(rebuildProjections(reopened, fresh), clock),
    ).toEqual(state);

    // Export, then import: the archive parses every event and rebuilds the projection.
    const archive = join(dir, "archive.sqlite");
    exportArchive(reopened, archive);
    const imported = importArchive(
      archive,
      join(dir, "slots"),
      worldImportReducers,
    );
    const branch = openStore(join(imported.slotPath, "world.sqlite"), fresh);
    expect(
      restoreWorldTime(
        readLiveProjections(branch, fresh),
        readClock(branch.db),
      ),
    ).toEqual(state);
    closeStore(branch);
    closeStore(reopened);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("each mortal's patron, from its authored devotion, and the pack's trouble-kind table survive commit, reopen, rebuild, and archive import", () => {
  const storeDir = tempDir("panthea-sim-patrons-");
  const exportDir = tempDir("panthea-sim-patrons-export-");
  const slotsDir = tempDir("panthea-sim-patrons-slots-");
  try {
    const storePath = join(storeDir, "world.sqlite");
    const seed = loadGreekWorldState();
    const world = liveWorld(storePath, seed);
    world.run();
    world.run();
    const state = world.state;

    // Every mortal has the patron its devotion names, and the table names a god for each trouble.
    const mortals = [...state.actors.values()].filter(
      (actor) => actor.isDeity !== true,
    );
    expect(mortals.length).toBe(20);
    expect(state.patrons.size).toBe(20);
    expect(state.patrons.get(id("farmer"))).toBe(id("hera"));
    expect(state.patrons.get(id("fisher-kallias"))).toBe(id("poseidon"));
    expect(state.rules.troubleKinds).toMatchObject({
      fire: "hephaestus",
      spoilage: "hera",
      theft: "hermes",
    });

    closeStore(world.store);
    const freshReducers = createWorldProjectionReducers(loadGreekWorldState());
    const reopened = openStore(storePath, freshReducers);
    const clock = readClock(reopened.db);
    const live = restoreWorldTime(
      readLiveProjections(reopened, freshReducers),
      clock,
    );
    expect(live.patrons).toEqual(state.patrons);
    expect(live).toEqual(state);
    const rebuilt = restoreWorldTime(
      rebuildProjections(reopened, freshReducers),
      clock,
    );
    expect(rebuilt.patrons).toEqual(state.patrons);

    const exportPath = join(exportDir, "archive.sqlite");
    exportArchive(reopened, exportPath);
    const imported = importArchive(exportPath, slotsDir, worldImportReducers);
    const branch = openStore(
      join(imported.slotPath, "world.sqlite"),
      freshReducers,
    );
    const restored = restoreWorldTime(
      readLiveProjections(branch, freshReducers),
      readClock(branch.db),
    );
    expect(restored.patrons).toEqual(state.patrons);
    expect(restored.rules.troubleKinds).toEqual(state.rules.troubleKinds);
    closeStore(branch);
    closeStore(reopened);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
    rmSync(exportDir, { recursive: true, force: true });
    rmSync(slotsDir, { recursive: true, force: true });
  }
});

test("a god's strike on a mortal takes goods up to the strikeGoodsCap and the prayer it answers or refuses survives reopen, rebuild, and archive import, at the cap's boundary values and for a mortal with nothing to take", () => {
  // The ferryman holds 6 food (worth the most per unit), 2 fish, and 30 coins.
  const run = (cap: number) => {
    const storeDir = tempDir("panthea-sim-strike-");
    const exportDir = tempDir("panthea-sim-strike-export-");
    const slotsDir = tempDir("panthea-sim-strike-slots-");
    try {
      const storePath = join(storeDir, "world.sqlite");
      const base = loadGreekWorldState();
      const ferryman = base.actors.get(id("ferryman"));
      if (!ferryman) throw new Error("expected the ferryman");
      const seed = withActor(
        withActor(
          {
            ...base,
            rules: {
              ...base.rules,
              petitionBalance: {
                ...base.rules.petitionBalance,
                strikeGoodsCap: cap,
              },
            },
          },
          { ...ferryman, locationId: id("altar") },
        ),
        {
          id: id("wanderer"),
          locationId: id("town-square"),
          alive: true,
          capabilities: [],
          inventory: new Map(),
          revision: 0,
        },
      );
      const world = liveWorld(storePath, seed);
      const held = getResourceAmount(ferryman.inventory, "food");
      world.run(
        queuedProposal("zeus", {
          kind: "strike",
          target: "ferryman",
          power: 1,
        }),
      );
      world.run(
        queuedProposal("zeus", {
          kind: "strike",
          target: "wanderer",
          power: 1,
        }),
      );
      const [harm, nothing] = eventOfKindAll(
        listEvents(world.store.db),
        "mortal-struck",
      );
      expect(harm).toMatchObject({
        entityId: "ferryman",
        actor: "zeus",
        resource: "food",
        amount: Math.min(held, cap),
      });
      expect(nothing).toMatchObject({ entityId: "wanderer", amount: 0 });
      expect(
        getResourceAmount(
          world.state.actors.get(id("ferryman"))?.inventory ?? new Map(),
          "food",
        ),
      ).toBe(held - Math.min(held, cap));

      // The ferryman prays at the altar about the harm, to its patron Hades, who refuses.
      world.run(
        queuedProposal("ferryman", {
          kind: "pray",
          cause: harm?.id,
          source: "routine",
        }),
      );
      const prayer = eventOfKind(listEvents(world.store.db), "petition-opened");
      expect(prayer).toMatchObject({ god: "hades", cause: harm?.id });
      world.run(
        queuedProposal("hades", { kind: "refuse", petition: prayer.id }),
      );
      const state = world.state;
      expect(state.petitions.get(prayer.id)?.status).toBe("refused");
      expect(
        getMemories(state, id("ferryman")).some(
          (m) => m.kind === "sign" && m.outcome === "refused",
        ),
      ).toBe(true);

      closeStore(world.store);
      const fresh = createWorldProjectionReducers(seed);
      const reopened = openStore(storePath, fresh);
      const clock = readClock(reopened.db);
      expect(
        restoreWorldTime(readLiveProjections(reopened, fresh), clock),
      ).toEqual(state);
      expect(
        restoreWorldTime(rebuildProjections(reopened, fresh), clock),
      ).toEqual(state);
      const exportPath = join(exportDir, "archive.sqlite");
      exportArchive(reopened, exportPath);
      const imported = importArchive(exportPath, slotsDir, worldImportReducers);
      const branch = openStore(join(imported.slotPath, "world.sqlite"), fresh);
      expect(
        restoreWorldTime(
          readLiveProjections(branch, fresh),
          readClock(branch.db),
        ),
      ).toEqual(state);
      closeStore(branch);
      closeStore(reopened);
      return harm?.amount;
    } finally {
      rmSync(storeDir, { recursive: true, force: true });
      rmSync(exportDir, { recursive: true, force: true });
      rmSync(slotsDir, { recursive: true, force: true });
    }
  };
  // Below what it holds, exactly what it holds (6), above it, and far above it.
  expect([run(1), run(5), run(6), run(7), run(100)]).toEqual([1, 5, 6, 6, 6]);
});

test("a defection and the threshold behind it survive commit, reopen, rebuild, and archive import, at the threshold's boundary values: at it a mortal stays, below it it goes, and the god lost and gained alone remember it", () => {
  const run = (affinity: number, threshold: number) => {
    const storeDir = tempDir("panthea-sim-defect-");
    const exportDir = tempDir("panthea-sim-defect-export-");
    const slotsDir = tempDir("panthea-sim-defect-slots-");
    try {
      const storePath = join(storeDir, "world.sqlite");
      const base = loadGreekWorldState();
      const eleni = base.actors.get(id("fisher-eleni"));
      const hera = base.actors.get(id("hera"));
      if (!eleni || !hera) throw new Error("expected eleni and hera");
      // Eleni (Athena's) has already been helped by Hera, as a spoiled-stock prayer to him would have it.
      const seed = withActor(
        withActor(
          {
            ...base,
            rules: {
              ...base.rules,
              petitionBalance: {
                ...base.rules.petitionBalance,
                defectionAffinity: threshold,
              },
            },
            relationships: new Map(base.relationships).set(
              relationshipKey(id("fisher-eleni"), id("athena")),
              {
                from: id("fisher-eleni"),
                toward: id("athena"),
                affinity,
                grudge: 0,
                allied: false,
              },
            ),
            causes: new Map([
              [
                id("fisher-eleni"),
                [
                  {
                    eventId: "evt-0-9001" as never,
                    tick: 0,
                    kind: "spoilage" as const,
                    resource: "food",
                    amount: 1,
                  },
                ],
              ],
            ]),
          },
          { ...eleni, locationId: id("altar") },
        ),
        { ...hera, locationId: id("altar") },
      );
      const world = liveWorld(storePath, seed);
      // Eleni prays about her spoiled stock: the table sends it to Hera, who blesses her.
      world.run(
        queuedProposal("fisher-eleni", {
          kind: "pray",
          cause: "evt-0-9001",
          source: "routine",
        }),
      );
      const asked = eventOfKind(listEvents(world.store.db), "petition-opened");
      expect(asked).toMatchObject({ god: "hera" });
      world.run(queuedProposal("hera", { kind: "bless", petition: asked.id }));
      // Zeus strikes her; she prays about the harm to her patron, who refuses her.
      world.run(
        queuedProposal("zeus", {
          kind: "strike",
          target: "fisher-eleni",
          power: 1,
        }),
      );
      const harm = eventOfKind(listEvents(world.store.db), "mortal-struck");
      // Her patron now: Athena, unless the threshold was high enough for Hera's answer alone to win her.
      const patron = world.state.patrons.get(id("fisher-eleni"));
      // The prayer cooldown (20 ticks) passes before she prays again.
      for (let wait = 0; wait < 20; wait += 1) world.run();
      world.run(
        queuedProposal("fisher-eleni", {
          kind: "pray",
          cause: harm.id,
          source: "routine",
        }),
      );
      const prayer = eventOfKind(
        listEvents(world.store.db),
        "petition-opened",
        (e) => e.cause === harm.id,
      );
      expect(prayer).toMatchObject({ god: patron });
      world.run(
        queuedProposal(String(patron), {
          kind: "refuse",
          petition: prayer.id,
        }),
      );
      const state = world.state;
      const changes = eventOfKindAll(
        listEvents(world.store.db),
        "patron-changed",
      );
      // The refusal takes her from `affinity` to `affinity - 2`: she goes only if that is below the threshold.
      expect(changes.length).toBe(affinity - 2 < threshold ? 1 : 0);
      expect(state.patrons.get(id("fisher-eleni"))).toBe(
        id(changes.length === 1 ? "hera" : "athena"),
      );
      const remembered = (god: string) =>
        getMemories(state, id(god)).filter((m) => m.kind === "patronage");
      expect(remembered("hera")).toHaveLength(changes.length);
      expect(remembered("athena")).toHaveLength(changes.length);
      expect(remembered("zeus")).toEqual([]);

      closeStore(world.store);
      const fresh = createWorldProjectionReducers(seed);
      const reopened = openStore(storePath, fresh);
      const clock = readClock(reopened.db);
      expect(
        restoreWorldTime(readLiveProjections(reopened, fresh), clock),
      ).toEqual(state);
      expect(
        restoreWorldTime(rebuildProjections(reopened, fresh), clock),
      ).toEqual(state);
      const exportPath = join(exportDir, "archive.sqlite");
      exportArchive(reopened, exportPath);
      const imported = importArchive(exportPath, slotsDir, worldImportReducers);
      const branch = openStore(join(imported.slotPath, "world.sqlite"), fresh);
      expect(
        restoreWorldTime(
          readLiveProjections(branch, fresh),
          readClock(branch.db),
        ),
      ).toEqual(state);
      closeStore(branch);
      closeStore(reopened);
      return changes.length;
    } finally {
      rmSync(storeDir, { recursive: true, force: true });
      rmSync(exportDir, { recursive: true, force: true });
      rmSync(slotsDir, { recursive: true, force: true });
    }
  };
  // (affinity, threshold): the feeling after the refusal is affinity - 2, and the threshold is 1 (the default),
  // 2, and 100 (more than any affinity can be).
  expect([
    run(3, 1), // 1 is not below 1: stays
    run(2, 1), // 0 is below 1: goes
    run(4, 2), // 2 is not below 2: stays
    run(3, 2), // 1 is below 2: goes
    run(10, 100), // 8 is below 100: goes
  ]).toEqual([0, 1, 0, 1, 1]);
});

test("the town's wrongs, credit trades, temperaments, and the loss cap survive commit, reopen, rebuild, and archive import, at the cap's boundary values: no wrong takes more than the cap, and every one is rebuilt from the log", () => {
  const run = (cap: number) => {
    const storeDir = tempDir("panthea-sim-wrongs-");
    const exportDir = tempDir("panthea-sim-wrongs-export-");
    const slotsDir = tempDir("panthea-sim-wrongs-slots-");
    try {
      const storePath = join(storeDir, "world.sqlite");
      const base = loadGreekWorldState();
      const seed: WorldState = {
        ...base,
        rules: {
          ...base.rules,
          petitionBalance: { ...base.rules.petitionBalance, wrongLossCap: cap },
        },
      };
      const world = liveWorld(storePath, seed);
      for (let tick = 0; tick < 150; tick += 1) world.run();
      const state = world.state;
      const events = listEvents(world.store.db);
      const wrongs = eventOfKindAll(events, "wrong");
      expect(wrongs.length).toBeGreaterThan(0);
      expect(state.wrongs.size).toBe(wrongs.length);
      // The cap bounds what a theft, a cheat, or a feud takes; a failed credit owes its price, which it does not bound.
      for (const w of wrongs.filter((e) => e.credit === undefined)) {
        expect(w.amount).toBeLessThanOrEqual(cap);
      }
      expect(eventOfKindAll(events, "credit-extended").length).toBe(
        state.credits.size,
      );
      expect(state.actors.get(id("market-trader-iris"))?.temperament).toBe(
        "greedy",
      );

      closeStore(world.store);
      const fresh = createWorldProjectionReducers(seed);
      const reopened = openStore(storePath, fresh);
      const clock = readClock(reopened.db);
      expect(
        restoreWorldTime(readLiveProjections(reopened, fresh), clock),
      ).toEqual(state);
      expect(
        restoreWorldTime(rebuildProjections(reopened, fresh), clock),
      ).toEqual(state);
      const exportPath = join(exportDir, "archive.sqlite");
      exportArchive(reopened, exportPath);
      const imported = importArchive(exportPath, slotsDir, worldImportReducers);
      const branch = openStore(join(imported.slotPath, "world.sqlite"), fresh);
      expect(
        restoreWorldTime(
          readLiveProjections(branch, fresh),
          readClock(branch.db),
        ),
      ).toEqual(state);
      closeStore(branch);
      closeStore(reopened);
      return Math.max(
        ...wrongs.filter((e) => e.credit === undefined).map((e) => e.amount),
      );
    } finally {
      rmSync(storeDir, { recursive: true, force: true });
      rmSync(exportDir, { recursive: true, force: true });
      rmSync(slotsDir, { recursive: true, force: true });
    }
  };
  // A cap of 1 takes one unit at a time; the authored 2 and a cap far above what is held take more.
  const largest = [run(1), run(2), run(1000)];
  expect(largest[0]).toBe(1);
  expect(largest[1]).toBeLessThanOrEqual(2);
  expect(largest[2]).toBeGreaterThan(largest[0] ?? 0);
});

/** Reopen `storePath` from a fresh composition root and check it equals `state` rebuilt, read live, and imported from an export. */
function expectSurvives(
  storePath: string,
  seed: WorldState,
  state: WorldState,
  exportDir: string,
  slotsDir: string,
) {
  const fresh = createWorldProjectionReducers(seed);
  const reopened = openStore(storePath, fresh);
  const clock = readClock(reopened.db);
  expect(restoreWorldTime(readLiveProjections(reopened, fresh), clock)).toEqual(
    state,
  );
  expect(restoreWorldTime(rebuildProjections(reopened, fresh), clock)).toEqual(
    state,
  );
  const exportPath = join(exportDir, "archive.sqlite");
  exportArchive(reopened, exportPath);
  const imported = importArchive(exportPath, slotsDir, worldImportReducers);
  const branch = openStore(join(imported.slotPath, "world.sqlite"), fresh);
  expect(
    restoreWorldTime(readLiveProjections(branch, fresh), readClock(branch.db)),
  ).toEqual(state);
  closeStore(branch);
  closeStore(reopened);
}

test("all the new state replays equal: a patron and a temperament the seed changed, credit trades, wrongs, the season's turns, the director's last fire, and each god's last trouble survive commit, reopen, rebuild, and export then import", () => {
  const storeDir = tempDir("panthea-sim-replay-");
  const exportDir = tempDir("panthea-sim-replay-export-");
  const slotsDir = tempDir("panthea-sim-replay-slots-");
  try {
    const storePath = join(storeDir, "world.sqlite");
    const base = loadGreekWorldState();
    const kallias = base.actors.get(id("fisher-kallias"));
    if (!kallias) throw new Error("expected fisher-kallias");
    // The seed differs from the authored pack where a restart that re-read content would show it: a mortal that
    // defected to Zeus (authored: Poseidon) and one whose temperament is not the authored.
    const seed: WorldState = {
      ...base,
      patrons: new Map(base.patrons).set(id("fisher-kallias"), id("zeus")),
      actors: new Map(base.actors).set(id("fisher-kallias"), {
        ...kallias,
        temperament: "proud",
      }),
    };
    const world = liveWorld(storePath, seed);
    for (let tick = 0; tick < 450; tick += 1) world.run();
    const state = world.state;
    const events = listEvents(world.store.db);

    // Every kind of new state was exercised, not just carried.
    expect(state.patrons.get(id("fisher-kallias"))).toBe(id("zeus"));
    expect(state.actors.get(id("fisher-kallias"))?.temperament).toBe("proud");
    expect(state.credits.size).toBeGreaterThan(0);
    expect(state.wrongs.size).toBeGreaterThan(0);
    expect(
      eventOfKindAll(events, "season-turned").map((e) => [e.tick, e.season]),
    ).toEqual([
      [200, "summer"],
      [400, "autumn"],
    ]);
    expect(state.director.lastFireTick).toBe(360);
    expect([...state.lastTrouble.keys()].map(String).sort()).toEqual([
      "athena",
      "hades",
      "hephaestus",
      "hera",
      "hermes",
      "poseidon",
      "zeus",
    ]);
    expect(eventOfKindAll(events, "trouble").length).toBeGreaterThan(7);

    closeStore(world.store);
    expectSurvives(storePath, seed, state, exportDir, slotsDir);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
    rmSync(exportDir, { recursive: true, force: true });
    rmSync(slotsDir, { recursive: true, force: true });
  }
});

test("the season, floor, loss, and director tunables survive commit, reopen, rebuild, and export at their boundary values: a season of one tick, a floor window of one tick, a loss cap of one unit, and an interval too long to come", () => {
  const runBalance = (balance: Record<string, number>) => {
    const storeDir = tempDir("panthea-sim-seasonbal-");
    const exportDir = tempDir("panthea-sim-seasonbal-export-");
    const slotsDir = tempDir("panthea-sim-seasonbal-slots-");
    try {
      const storePath = join(storeDir, "world.sqlite");
      const base = loadGreekWorldState();
      const seed: WorldState = {
        ...base,
        rules: {
          ...base.rules,
          petitionBalance: { ...base.rules.petitionBalance, ...balance },
        },
      };
      const world = liveWorld(storePath, seed);
      for (let tick = 0; tick < 40; tick += 1) world.run();
      const state = world.state;
      const events = listEvents(world.store.db);
      closeStore(world.store);
      expectSurvives(storePath, seed, state, exportDir, slotsDir);
      return {
        turns: eventOfKindAll(events, "season-turned").length,
        troubles: eventOfKindAll(events, "trouble"),
        director: state.director.lastFireTick,
      };
    } finally {
      rmSync(storeDir, { recursive: true, force: true });
      rmSync(exportDir, { recursive: true, force: true });
      rmSync(slotsDir, { recursive: true, force: true });
    }
  };
  const largestLoss = (run: ReturnType<typeof runBalance>) =>
    Math.max(
      ...run.troubles.flatMap((e) =>
        e.loss.kind === "resource" ? [e.loss.amount] : [],
      ),
    );
  const floorsOf = (run: ReturnType<typeof runBalance>) =>
    run.troubles.filter((e) => e.source === "floor");
  // The four tunables do not interfere across these three round trips, so each trip carries one boundary of each.
  // Every trip has a floor window of one tick: each god gets a trouble in every tick it has one that can happen
  // (every god has them, and a god's building troubles run out as its buildings are damaged).
  // Low: a season of one tick turns every tick; a loss cap of one takes one unit at a time; a director interval of
  // one tick fires it every tick it can.
  const low = runBalance({
    seasonTicks: 1,
    troubleFloorTicks: 1,
    troubleLossCap: 1,
    directorIntervalTicks: 1,
  });
  expect(low.turns).toBe(40);
  expect(largestLoss(low)).toBe(1);
  expect(low.director).toBe(40);
  expect(floorsOf(low).length).toBeGreaterThan(40);
  expect(new Set(floorsOf(low).map((e) => e.god)).size).toBe(7);
  // Authored: a season of 200 turns none in 40 ticks; the authored loss cap of 2 takes two; a director interval too
  // long to come never fires it.
  const authored = runBalance({
    seasonTicks: 200,
    troubleFloorTicks: 1,
    troubleLossCap: 2,
    directorIntervalTicks: 1_000_000,
  });
  expect(authored.turns).toBe(0);
  expect(largestLoss(authored)).toBe(2);
  expect(authored.director).toBe(0);
  expect(floorsOf(authored).length).toBeGreaterThan(40);
  expect(new Set(floorsOf(authored).map((e) => e.god)).size).toBe(7);
  // High: a season of 1,000,000 turns none either; a cap above what is held takes more than the authored two.
  const high = runBalance({
    seasonTicks: 1_000_000,
    troubleFloorTicks: 1,
    troubleLossCap: 1000,
    directorIntervalTicks: 1_000_000,
  });
  expect(high.turns).toBe(0);
  expect(largestLoss(high)).toBeGreaterThan(2);
  expect(high.director).toBe(0);
  expect(floorsOf(high).length).toBeGreaterThan(40);
  expect(new Set(floorsOf(high).map((e) => e.god)).size).toBe(7);
});

// --- The director replays from the journal (M2 Unit 12) ---------------------------------------------------

/** The director's own trouble in `events`, reduced to when, what, to whom, and the attribution it carries. */
const directorEvents = (events: readonly WorldEvent[]) =>
  events.flatMap((event) => {
    if (
      (event.kind === "theft" || event.kind === "stock-spoiled") &&
      event.cause === "director"
    ) {
      return [
        [event.id, event.tick, event.kind, String(event.entityId), "director"],
      ];
    }
    if (event.kind === "building-ignited" && event.cause.kind === "director") {
      return [
        [event.id, event.tick, event.kind, String(event.entityId), "director"],
      ];
    }
    return [];
  });

test("director events replay from the journal without re-deciding: reopen, rebuild, and the read of the live row leave the journal's director events, the director's clock, and the persisted generator untouched, and a resumed world fires when an uninterrupted one would", () => {
  const storeDir = tempDir("panthea-sim-director-replay-");
  try {
    const storePath = join(storeDir, "world.sqlite");
    const authored = loadGreekWorldState();
    const seed: WorldState = {
      ...authored,
      rules: {
        ...authored.rules,
        petitionBalance: {
          ...authored.rules.petitionBalance,
          directorIntervalTicks: 10,
        },
      },
    };
    const world = liveWorld(storePath, seed);
    for (let tick = 0; tick < 55; tick += 1) world.run();
    const journaled = directorEvents(listEvents(world.store.db));
    // Five fires so far, at 10, 20, 30, 40, 50, each carrying its attribution.
    expect(journaled.map((fire) => fire[1])).toEqual([10, 20, 30, 40, 50]);
    expect(world.state.director.lastFireTick).toBe(50);
    const eventCount = getCurrentSequence(world.store.db);
    const persisted = readPrngState(world.store.db);
    closeStore(world.store);

    // Reopen: the live row, and a full rebuild from the journal, give the director's clock the journal holds.
    const reducers = createWorldProjectionReducers(seed);
    const store = openStore(storePath, reducers);
    const live = restoreWorldTime(
      readLiveProjections(store, reducers),
      readClock(store.db),
    );
    const rebuilt = restoreWorldTime(
      rebuildProjections(store, reducers),
      readClock(store.db),
    );
    expect(live.director).toEqual({ lastFireTick: 50 });
    expect(rebuilt.director).toEqual({ lastFireTick: 50 });
    expect(rebuilt).toEqual(live);
    // Neither added an event nor drew from the generator: the journal and the persisted PRNG are as they were.
    expect(getCurrentSequence(store.db)).toBe(eventCount);
    expect(directorEvents(listEvents(store.db))).toEqual(journaled);
    expect(readPrngState(store.db)).toBe(persisted);

    // The resumed world, from the rebuilt state and the persisted generator, fires at 60 and not before: its clock is
    // the journal's, not a fresh one (a fresh one would fire at tick 56) and not a re-decision.
    const restoredPrng = deserializePrngState(persisted) ?? createPrng(1);
    let state = rebuilt;
    let prng = restoredPrng;
    const resumed: WorldEvent[] = [];
    for (let tick = 0; tick < 10; tick += 1) {
      const step = runTick(state, prng, []);
      state = step.state;
      prng = step.prng;
      resumed.push(...step.events);
    }
    expect(directorEvents(resumed).map((fire) => fire[1])).toEqual([60]);

    // And an uninterrupted world fires exactly the same trouble: the restart changed nothing about what happens.
    let straightState: WorldState = seed;
    let straightPrng = createPrng(1);
    const straight: WorldEvent[] = [];
    for (let tick = 0; tick < 65; tick += 1) {
      const step = runTick(straightState, straightPrng, []);
      straightState = step.state;
      straightPrng = step.prng;
      straight.push(...step.events);
    }
    expect(
      directorEvents([...listEvents(store.db), ...resumed]).map((fire) =>
        fire.slice(1),
      ),
    ).toEqual(directorEvents(straight).map((fire) => fire.slice(1)));
    closeStore(store);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});
