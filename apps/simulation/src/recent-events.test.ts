import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  eventSubjects,
  type Proposal,
  parseSyncFrame,
  UNPLACED_EVENT_KINDS,
  type WorldEvent,
} from "@panthea/contracts";
import {
  closeStore,
  commitTick,
  listEvents,
  openStore,
} from "@panthea/persistence";
import {
  createPrng,
  type PrngState,
  runTick,
  submitProposal,
  toEntityId,
  type WorldState,
  withActor,
} from "@panthea/world";
import {
  createServiceStatusRef,
  createSimulationServer,
  RECENT_EVENT_CAP,
  RECENT_EVENT_WINDOW_TICKS,
  readRecentEvents,
  updateServiceStatus,
} from "./server";
import {
  createWorldProjectionReducers,
  loadGreekWorldState,
  serializePrngState,
} from "./world-store";

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

interface Chain {
  readonly state: WorldState;
  readonly eventsByTick: readonly (readonly WorldEvent[])[];
}

/** Commits one tick per entry in `queues` through the real store, returning the events each tick committed. */
function commitTicks(
  store: ReturnType<typeof openStore>,
  reducers: ReturnType<typeof createWorldProjectionReducers>,
  start: WorldState,
  queues: readonly (readonly Proposal[])[],
): Chain {
  let state = start;
  let prng: PrngState = createPrng(11);
  const eventsByTick: (readonly WorldEvent[])[] = [];
  for (const queue of queues) {
    const result = runTick(state, prng, queue);
    expect(result.rejected).toEqual([]);
    commitTick(store, reducers, {
      events: result.events,
      cursorWallMs: (state.tick + 1) * 1_000,
      paused: false,
      tick: result.state.tick,
      simTimeMs: result.state.simTime,
      prngState: serializePrngState(result.prng),
    });
    state = result.state;
    prng = result.prng;
    eventsByTick.push(result.events);
  }
  return { state, eventsByTick };
}

function withStore<T>(
  run: (
    store: ReturnType<typeof openStore>,
    reducers: ReturnType<typeof createWorldProjectionReducers>,
    seeded: WorldState,
  ) => T | Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "panthea-sim-recent-events-"));
  const seeded = loadGreekWorldState();
  const reducers = createWorldProjectionReducers(seeded);
  const store = openStore(join(dir, "world.sqlite"), reducers);
  return Promise.resolve(run(store, reducers, seeded)).finally(() => {
    closeStore(store);
    rmSync(dir, { recursive: true, force: true });
  });
}

/** The kinds the frame window leaves out: they happen at no place, so the client has nothing to draw. */
const UNPLACED: readonly string[] = UNPLACED_EVENT_KINDS;

/** `events` as the window lists them. */
const placed = (events: readonly WorldEvent[]) =>
  events.filter((event) => !UNPLACED.includes(event.kind));

test("the recent-event window defaults to the last 10 ticks, capped at 200 events", () => {
  expect(RECENT_EVENT_WINDOW_TICKS).toBe(10);
  expect(RECENT_EVENT_CAP).toBe(200);
});

test("a frame window after a strike tick lists the strike's events with their ids and sequences, ascending", () =>
  withStore((store, reducers, seeded) => {
    const chain = commitTicks(store, reducers, seeded, [
      [strikeProposal("the-tavern", 3)],
    ]);
    const struck = placed(chain.eventsByTick[0] ?? []);
    expect(struck.some((event) => event.kind === "building-ignited")).toBe(
      true,
    );

    const recent = readRecentEvents(
      store.db,
      chain.state.lastSequence,
      chain.state.tick,
    );

    expect(recent.map((event) => event.id)).toEqual(
      struck.map((event) => event.id),
    );
    expect(recent.map((event) => event.sequence)).toEqual(
      struck.map((event) => event.sequence),
    );
    expect(recent.map((event) => event.kind)).toEqual(
      struck.map((event) => event.kind),
    );
    expect(recent.every((event) => event.tick === 1)).toBe(true);
    const sequences = recent.map((event) => event.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));

    const ignited = recent.find((event) => event.kind === "building-ignited");
    expect(ignited?.subjects as readonly string[] | undefined).toEqual([
      "the-tavern",
    ]);
    for (const [index, event] of recent.entries()) {
      const source = struck[index];
      if (source) {
        expect(event.subjects).toEqual(eventSubjects(source));
      }
    }
  }));

test("the window drops events older than the configured number of ticks", () =>
  withStore((store, reducers, seeded) => {
    const queues: (readonly Proposal[])[] = [[strikeProposal("the-tavern", 3)]];
    for (let index = 1; index < 12; index += 1) {
      queues.push([]);
    }
    const chain = commitTicks(store, reducers, seeded, queues);
    expect(chain.state.tick).toBe(12);

    const recent = readRecentEvents(
      store.db,
      chain.state.lastSequence,
      chain.state.tick,
    );

    const oldest = chain.state.tick - RECENT_EVENT_WINDOW_TICKS;
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.every((event) => event.tick > oldest)).toBe(true);
    expect(recent.some((event) => event.tick === oldest + 1)).toBe(true);

    const struckIds = new Set(
      (chain.eventsByTick[0] ?? []).map((event) => event.id as string),
    );
    expect(recent.some((event) => struckIds.has(event.id))).toBe(false);
  }));

test("the window never returns more than the cap, keeping the newest events", () =>
  withStore((store, reducers, seeded) => {
    const chain = commitTicks(store, reducers, seeded, [
      [strikeProposal("the-tavern", 3)],
      [],
      [],
    ]);

    const capped = readRecentEvents(
      store.db,
      chain.state.lastSequence,
      chain.state.tick,
      { windowTicks: 100, cap: 4 },
    );

    const all = placed(chain.eventsByTick.flat());
    expect(capped.map((event) => event.sequence)).toEqual(
      all.slice(-4).map((event) => event.sequence),
    );
  }));

test("the window never includes events committed after the sequence a frame reports", () =>
  withStore((store, reducers, seeded) => {
    const chain = commitTicks(store, reducers, seeded, [
      [strikeProposal("the-tavern", 3)],
      [],
    ]);
    const firstTickLast =
      placed(chain.eventsByTick[0] ?? []).at(-1)?.sequence ??
      Number.POSITIVE_INFINITY;

    const recent = readRecentEvents(store.db, firstTickLast, 1);

    expect(recent.at(-1)?.sequence).toBe(firstTickLast);
  }));

test("GET /frame carries the strike's events, and the frame parses under the contract", () =>
  withStore(async (store, reducers, seeded) => {
    const chain = commitTicks(store, reducers, seeded, [
      [strikeProposal("the-tavern", 3)],
    ]);
    const token = "the-launch-token";
    const slotsDir = mkdtempSync(join(tmpdir(), "panthea-sim-recent-slots-"));
    const handle = createSimulationServer({
      token,
      store,
      reducers,
      traceDb: store.db,
      slotsDir,
      statusRef: createServiceStatusRef(chain.state),
      port: 0,
    });
    try {
      const response = await fetch(`http://127.0.0.1:${handle.port}/frame`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      const parsed = parseSyncFrame(await response.json());
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const struck = placed(chain.eventsByTick[0] ?? []);
      expect(parsed.value.recentEvents.map((event) => event.id)).toEqual(
        struck.map((event) => event.id),
      );
    } finally {
      handle.stop(true);
      rmSync(slotsDir, { recursive: true, force: true });
    }
  }));

test("a catch-up summary stays on every later frame, stamped with the sequence it finished at, until a new catch-up replaces it", () =>
  withStore(async (store, reducers, seeded) => {
    const first = commitTicks(store, reducers, seeded, [[]]);
    const token = "the-launch-token";
    const slotsDir = mkdtempSync(join(tmpdir(), "panthea-sim-summary-slots-"));
    const statusRef = createServiceStatusRef(first.state);
    const handle = createSimulationServer({
      token,
      store,
      reducers,
      traceDb: store.db,
      slotsDir,
      statusRef,
      port: 0,
    });
    // A persisted summary: it carries its own id and the sequence its backlog
    // ended at, and the frame repeats exactly that, never a value stamped
    // from whichever tick happens to be current.
    const summary = {
      id: "summary-a",
      atSequence: first.state.lastSequence,
      appliedMs: 3_600_000,
      skippedMs: 60_000,
      majorOutcomes: ["tavern fire spread"],
    };
    const fetchSummary = async () => {
      const response = await fetch(`http://127.0.0.1:${handle.port}/frame`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const parsed = parseSyncFrame(await response.json());
      if (!parsed.ok) throw new Error(parsed.message);
      return parsed.value.catchUpSummary;
    };
    try {
      updateServiceStatus(statusRef, first.state, { catchUpSummary: summary });
      expect(await fetchSummary()).toEqual(summary);

      let state = first.state;
      for (let tickIndex = 0; tickIndex < 3; tickIndex += 1) {
        state = commitTicks(store, reducers, state, [[]]).state;
        updateServiceStatus(statusRef, state);
        expect(await fetchSummary()).toEqual(summary);
      }
      expect(state.lastSequence).toBeGreaterThan(first.state.lastSequence);

      const replacement = {
        id: "summary-b",
        atSequence: state.lastSequence,
        appliedMs: 120_000,
        skippedMs: 0,
        majorOutcomes: [],
      };
      updateServiceStatus(statusRef, state, { catchUpSummary: replacement });
      expect(await fetchSummary()).toEqual(replacement);

      state = commitTicks(store, reducers, state, [[]]).state;
      updateServiceStatus(statusRef, state);
      expect(await fetchSummary()).toEqual(replacement);
    } finally {
      handle.stop(true);
      rmSync(slotsDir, { recursive: true, force: true });
    }
  }));

// --- Derived events stay out of the window ---------------------------------------------

/** The Greek world with Zeus and `crowd` bystanders at the tavern, so one strike is witnessed many times over. */
function crowdedSeed(crowd: number): WorldState {
  let state = loadGreekWorldState();
  const zeus = state.actors.get(toEntityId("zeus"));
  if (!zeus) throw new Error("expected Zeus in the pack");
  state = withActor(state, { ...zeus, locationId: toEntityId("tavern") });
  for (let index = 0; index < crowd; index += 1) {
    state = withActor(state, {
      id: toEntityId(`onlooker-${index}`),
      locationId: toEntityId("tavern"),
      alive: true,
      capabilities: [],
      inventory: new Map(),
      revision: 0,
    });
  }
  return state;
}

test("a burst of memories and feelings never displaces the events the client draws and receipts", () => {
  const dir = mkdtempSync(join(tmpdir(), "panthea-sim-recent-burst-"));
  try {
    const seeded = crowdedSeed(70);
    const reducers = createWorldProjectionReducers(seeded);
    const store = openStore(join(dir, "world.sqlite"), reducers);
    // The strike, then the fire burning down with the crowd watching: well over
    // a window's worth of derived events on top of a handful of primary ones.
    const chain = commitTicks(store, reducers, seeded, [
      [strikeProposal("the-tavern", 3)],
      [],
      [],
    ]);
    const all = chain.eventsByTick.flat();
    const derived: readonly WorldEvent[] = all.filter(
      (event) =>
        event.kind === "memory-recorded" ||
        event.kind === "relationship-changed",
    );
    const primary = all.filter((event) => !UNPLACED.includes(event.kind));
    expect(derived.length).toBeGreaterThan(RECENT_EVENT_CAP);
    expect(primary.some((event) => event.kind === "building-ignited")).toBe(
      true,
    );
    expect(primary.some((event) => event.kind === "building-destroyed")).toBe(
      true,
    );

    const recent = readRecentEvents(
      store.db,
      chain.state.lastSequence,
      chain.state.tick,
    );

    // Every primary event is in the window, in order; no derived one is.
    expect(recent.map((event) => event.id)).toEqual(
      primary.map((event) => event.id),
    );
    // They are still in the log, for the trace and follow-event to reach.
    const logged = listEvents(store.db).map((event) => event.id);
    for (const event of derived) {
      expect(logged).toContain(event.id);
    }
    closeStore(store);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("positive control: with fewer derived events the window is the same primary events, and the cap still keeps the newest", () => {
  const dir = mkdtempSync(join(tmpdir(), "panthea-sim-recent-small-"));
  try {
    const seeded = crowdedSeed(1);
    const reducers = createWorldProjectionReducers(seeded);
    const store = openStore(join(dir, "world.sqlite"), reducers);
    const chain = commitTicks(store, reducers, seeded, [
      [strikeProposal("the-tavern", 3)],
      [],
    ]);
    const primary = chain.eventsByTick
      .flat()
      .filter((event) => !UNPLACED.includes(event.kind));
    const recent = readRecentEvents(
      store.db,
      chain.state.lastSequence,
      chain.state.tick,
    );
    expect(recent.map((event) => event.id)).toEqual(
      primary.map((event) => event.id),
    );
    const capped = readRecentEvents(
      store.db,
      chain.state.lastSequence,
      chain.state.tick,
      { windowTicks: 100, cap: 2 },
    );
    expect(capped.map((event) => event.id)).toEqual(
      primary.slice(-2).map((event) => event.id),
    );
    closeStore(store);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
