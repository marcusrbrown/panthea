// The god turn runner against a real store, journal, trace, and tick loop.
// The only scripted piece is the model provider, a loopback OpenAI-compatible
// endpoint the production router talks to. Service-level tests run the real
// entry point in-process (`test-service.ts`) and drive it over HTTP.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authoredAction,
  createRouter,
  type GodTurnDeps,
  OWN_EVENT_WINDOW,
  parseRoutingConfig,
} from "@panthea/agents";
import { parseSyncFrame, type WorldEvent } from "@panthea/contracts";
import {
  closeStore,
  commitTick,
  listEvents,
  listExternalProposals,
  openStore,
  readCatchUpSummary,
  type Store,
} from "@panthea/persistence";
import {
  ensureTraceSchema,
  followProposal,
  getModelRequestByProposalId,
  getProposalOutcomeByProposalId,
  type ProposalId,
} from "@panthea/telemetry";
import {
  applyEvent,
  createPrng,
  getActor,
  type PrngState,
  planDirectorStep,
  runTick,
  submitProposal,
  toEntityId,
  type WorldState,
  withActor,
} from "@panthea/world";
import {
  createGodTurnRunner,
  type GodTurnRunner,
  type Lifecycle,
  readLatestPracticeRefusal,
  readOwnEvents,
} from "./agents";
import { runCatchUp } from "./catchup";
import {
  loadEmbeddedGreekGodProfiles,
  loadEmbeddedGreekWorldPack,
} from "./greek-world-pack";
import { TICK_TIMER_ENV } from "./index";
import { parseLaunchConfig } from "./launch-config";
import {
  applyLiveTick,
  createServiceStatusRef,
  type ServiceStatusRef,
} from "./server";
import {
  FAST_TICK_MS,
  journalOf,
  readStore,
  startTestService,
  stopAllTestServices,
  type TestService,
  tickOf,
  until,
} from "./test-service";
import { buildRoutineQueue, type TickDeps } from "./tick";
import {
  createEventSource,
  createWorldProjectionReducers,
  loadGreekWorldState,
  serializePrngState,
} from "./world-store";

const id = toEntityId;

// --- The scripted provider ---------------------------------------------------------------

type Reply = string | 500;

interface Provider {
  readonly baseUrl: string;
  /** Every request the provider received, in order: which god asked, and the whole body. */
  readonly requests: {
    readonly god: string;
    readonly body: string;
    /** Wall time the request arrived. */
    readonly at: number;
  }[];
  /** How the provider answers; replaceable mid-test. */
  respond: (god: string, n: number) => Promise<Reply> | Reply;
  stop(): void;
}

const providers: Provider[] = [];

const LEGEND = (god: string) =>
  JSON.stringify({
    action: "legend",
    assertion: `${god} speaks of what was seen.`,
  });

const GOD_NAMES = [
  "Athena",
  "Hades",
  "Hephaestus",
  "Hera",
  "Hermes",
  "Poseidon",
  "Zeus",
];

/** Which god a request is for: the persona line its system text carries. */
function godOf(body: string): string {
  const name = GOD_NAMES.find((candidate) =>
    body.includes(`You are ${candidate},`),
  );
  return name === undefined ? "unknown" : name.toLowerCase();
}

function startProvider(
  respond: Provider["respond"] = (god) => LEGEND(god),
): Provider {
  const requests: Provider["requests"][number][] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = await request.text();
      const god = godOf(body);
      const n = requests.length;
      requests.push({ god, body, at: Date.now() });
      const reply = await provider.respond(god, n);
      if (reply === 500) return new Response("down", { status: 500 });
      return Response.json({
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 1,
        model: "scripted",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: reply },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    },
  });
  const provider: Provider = {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    requests,
    respond,
    stop: () => server.stop(true),
  };
  providers.push(provider);
  return provider;
}

/** A reply the test releases by hand, so a turn stays in flight as long as it likes. */
function held() {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release: () => release() };
}

afterEach(() => {
  for (const provider of providers.splice(0)) provider.stop();
});

function deps(provider: Provider, gods: string[]): GodTurnDeps {
  const config = parseRoutingConfig({
    endpoints: [{ id: "local", baseUrl: provider.baseUrl, model: "scripted" }],
    roles: Object.fromEntries(gods.map((god) => [god, { endpoint: "local" }])),
  });
  if (!config.ok) throw new Error(`${config.path}: ${config.message}`);
  const pack = loadEmbeddedGreekWorldPack();
  if (!pack.ok) throw new Error(pack.message);
  const all = loadEmbeddedGreekGodProfiles(pack.value);
  if (!all.ok) throw new Error(all.message);
  return {
    router: createRouter({
      config: config.value,
      offline: false,
      limits: {
        attemptTimeoutMs: 3_000,
        totalTimeoutMs: 10_000,
        maxAttempts: 1,
        backoffBaseMs: 1,
        backoffMaxMs: 2,
      },
    }),
    profiles: new Map(
      all.value
        .filter((profile) => gods.includes(profile.id))
        .map((profile) => [id(profile.id), profile]),
    ),
  };
}

// --- The world under the runner ------------------------------------------------------------

interface Lifecycles {
  startupCatchUpComplete: boolean;
  catchUpRunning: boolean;
  paused: boolean;
}

interface World {
  readonly dir: string;
  readonly path: string;
  store: Store;
  reducers: ReturnType<typeof createWorldProjectionReducers>;
  deps: TickDeps;
  statusRef: ServiceStatusRef;
  state: WorldState;
  prng: PrngState;
  readonly flags: Lifecycles;
  readonly lifecycle: Lifecycle;
  wallMs: number;
}

const worlds: World[] = [];

/** The Greek world with Zeus placed at `zeusAt`, and, when asked, the director firing every `directorInterval` ticks. */
function newWorld(zeusAt = "great-hall", directorInterval?: number): World {
  const dir = mkdtempSync(join(tmpdir(), "panthea-sim-agents-"));
  const authored = loadGreekWorldState();
  const greek =
    directorInterval === undefined
      ? authored
      : {
          ...authored,
          rules: {
            ...authored.rules,
            petitionBalance: {
              ...authored.rules.petitionBalance,
              directorIntervalTicks: directorInterval,
            },
          },
        };
  const zeus = getActor(greek, id("zeus"));
  if (!zeus) throw new Error("no zeus");
  const state = withActor(greek, { ...zeus, locationId: id(zeusAt) });
  const reducers = createWorldProjectionReducers(state);
  const path = join(dir, "world.sqlite");
  const store = openStore(path, reducers);
  ensureTraceSchema(store.db);
  const flags: Lifecycles = {
    startupCatchUpComplete: true,
    catchUpRunning: false,
    paused: false,
  };
  const world: World = {
    dir,
    path,
    store,
    reducers,
    deps: { store, reducers, traceDb: store.db },
    statusRef: createServiceStatusRef(state),
    state,
    prng: createPrng(1),
    flags,
    lifecycle: {
      startupCatchUpComplete: () => flags.startupCatchUpComplete,
      catchUpRunning: () => flags.catchUpRunning,
      paused: () => flags.paused,
    },
    wallMs: 0,
  };
  worlds.push(world);
  return world;
}

/** Stops the process and starts it again over the same file: what a kill and restart leave. */
function restart(world: World): void {
  closeStore(world.store);
  const store = openStore(world.path, world.reducers);
  ensureTraceSchema(store.db);
  world.store = store;
  world.deps = { store, reducers: world.reducers, traceDb: store.db };
  world.statusRef = createServiceStatusRef(world.state);
}

afterEach(() => {
  for (const world of worlds.splice(0)) {
    try {
      closeStore(world.store);
    } catch {
      // Already closed by a test that restarted it.
    }
    rmSync(world.dir, { recursive: true, force: true });
  }
});

/** One live tick over the routines and whatever the journal holds, as the service's loop runs it. */
function tick(world: World) {
  world.wallMs += 1_000;
  const step = applyLiveTick(
    buildRoutineQueue(world.state),
    world.state,
    world.prng,
    world.deps,
    { cursorWallMs: world.wallMs, paused: false },
  );
  if (step.kind !== "committed")
    throw new Error(`tick failed: ${step.message}`);
  world.state = step.state;
  world.prng = step.prng;
  return step;
}

function runnerFor(
  world: World,
  provider: Provider,
  gods: string[],
  lifecycle: Lifecycle = world.lifecycle,
): GodTurnRunner {
  return createGodTurnRunner({
    ...deps(provider, gods),
    store: world.store,
    getState: () => world.state,
    lifecycle,
    statusRef: world.statusRef,
  });
}

const pendingModelProposals = (world: World) =>
  listExternalProposals(world.store.db).filter(
    (entry) => entry.consumedTick === undefined,
  );

const STRIKE_TAVERN = JSON.stringify({
  action: "strike",
  target: "the-tavern",
  power: 2,
});

// --- Journaling ------------------------------------------------------------------------------

describe("a god's turn", () => {
  test("is journaled in-process as a model proposal, with its request in the trace; it runs on the next tick, and the chain shows observation, model request, proposal, validation, and events", async () => {
    const world = newWorld("tavern");
    const provider = startProvider(() => STRIKE_TAVERN);
    const runner = runnerFor(world, provider, ["zeus"]);

    expect(runner.dispatch()).toBe(true);
    await runner.idle();

    // Inference has happened; no tick has.
    expect(provider.requests).toHaveLength(1);
    expect(world.state.tick).toBe(0);
    const [entry] = pendingModelProposals(world);
    expect(entry).toBeDefined();
    expect(entry?.proposal).toMatchObject({
      kind: "strike",
      actor: "zeus",
      source: "model",
    });
    expect(entry?.observation).toMatchObject({
      observer: "zeus",
      source: "model",
    });
    const proposalId = entry?.proposalId as ProposalId;
    expect(
      getModelRequestByProposalId(world.store.db, proposalId),
    ).toMatchObject({
      role: "zeus",
      outcome: "intent",
    });

    tick(world);
    expect(
      getProposalOutcomeByProposalId(world.store.db, proposalId),
    ).toMatchObject({
      outcome: "committed",
    });
    const chain = followProposal(
      world.store.db,
      createEventSource(world.store),
      proposalId,
    );
    expect(chain.steps.map((step) => step.step).slice(0, 5)).toEqual([
      "observation",
      "model-request",
      "proposal",
      "validation",
      "event",
    ]);
    expect(world.state.buildings.get(id("the-tavern"))?.status).toBe("damaged");
  });

  test("that chooses to wait journals nothing, but its request is in the trace", async () => {
    const world = newWorld();
    const provider = startProvider(() => '{"action":"wait"}');
    const runner = runnerFor(world, provider, ["zeus"]);
    expect(runner.dispatch()).toBe(true);
    await runner.idle();

    expect(listExternalProposals(world.store.db)).toEqual([]);
    const row = world.store.db
      .query("SELECT outcome, proposal_id FROM trace_model_requests")
      .all() as { outcome: string; proposal_id: string | null }[];
    expect(row).toEqual([{ outcome: "intent", proposal_id: null }]);
  });

  test("is revalidated at admission: the world moved while the model was thinking, so the proposal is rejected stale-target", async () => {
    const world = newWorld("tavern");
    const release = held();
    const provider = startProvider(async () => {
      await release.gate;
      return STRIKE_TAVERN;
    });
    const runner = runnerFor(world, provider, ["zeus"]);
    expect(runner.dispatch()).toBe(true);

    // While the model thinks, someone else changes the tavern: a fixture strike ignites it.
    const { insertExternalProposal } = await import("@panthea/persistence");
    insertExternalProposal(world.store.db, {
      proposalId: "fixture-ignite",
      proposal: {
        schemaVersion: 1,
        kind: "strike",
        actor: "hera",
        target: "the-tavern",
        power: 3,
        targets: [],
        expectedRevisions: [],
        source: "fixture",
        observationId: "obs-fixture-ignite",
      },
      observation: {
        schemaVersion: 1,
        id: "obs-fixture-ignite",
        observer: "hera",
        stateRevision: 0,
        factsRead: [],
        source: "fixture",
      },
    });
    tick(world);
    release.release();
    await runner.idle();

    const [entry] = pendingModelProposals(world);
    tick(world);
    expect(
      getProposalOutcomeByProposalId(
        world.store.db,
        entry?.proposalId as ProposalId,
      ),
    ).toMatchObject({ outcome: "rejected", reason: "stale-target" });
  });
});

// --- One pending turn per god ------------------------------------------------------------------

describe("scheduling", () => {
  test("a god with a pending journal entry gets no new turn; the other god is served, and everyone is served again once the tick consumes them", async () => {
    const world = newWorld();
    const provider = startProvider();
    const runner = runnerFor(world, provider, ["zeus", "hera"]);

    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    // Two gods, each with an entry pending: one turn each, no more.
    expect(provider.requests.map((r) => r.god).sort()).toEqual([
      "hera",
      "zeus",
    ]);
    expect(pendingModelProposals(world)).toHaveLength(2);

    expect(runner.dispatch()).toBe(false);
    expect(provider.requests).toHaveLength(2);

    tick(world);
    expect(pendingModelProposals(world)).toEqual([]);
    // Control: consumed, so the same runner takes turns again.
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(provider.requests).toHaveLength(3);
  });

  test("at most one turn is in flight: a second dispatch while the model thinks starts nothing", async () => {
    const world = newWorld();
    const release = held();
    const provider = startProvider(async (god) => {
      await release.gate;
      return LEGEND(god);
    });
    const runner = runnerFor(world, provider, ["zeus", "hera"]);
    expect(runner.dispatch()).toBe(true);
    expect(runner.dispatch()).toBe(false);
    release.release();
    await runner.idle();
    expect(provider.requests).toHaveLength(1);
    // Control: once it finishes, the next god's turn starts.
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(provider.requests).toHaveLength(2);
  });

  test("a turn held open does not stop the tick: routines keep committing while the model thinks", async () => {
    const world = newWorld();
    const release = held();
    const provider = startProvider(async (god) => {
      await release.gate;
      return LEGEND(god);
    });
    const runner = runnerFor(world, provider, ["zeus"]);
    runner.dispatch();
    const before = world.state.tick;
    for (let index = 0; index < 5; index += 1) {
      tick(world);
      await Bun.sleep(20);
    }
    expect(world.state.tick).toBe(before + 5);
    expect(provider.requests).toHaveLength(1);
    expect(runner.inFlight()).toBe(true);
    release.release();
    await runner.idle();
  });

  test("positive control for the check above: a design that waits for the model inside the tick stalls it", async () => {
    const world = newWorld();
    const release = held();
    const provider = startProvider(async (god) => {
      await release.gate;
      return LEGEND(god);
    });
    const runner = runnerFor(world, provider, ["zeus"]);
    runner.dispatch();
    // The wrong design: every tick first waits for the turn to finish.
    const blockingTicks = async () => {
      for (let index = 0; index < 5; index += 1) {
        await runner.idle();
        tick(world);
      }
    };
    const before = world.state.tick;
    const outcome = await Promise.race([
      blockingTicks().then(() => "finished" as const),
      Bun.sleep(300).then(() => "stalled" as const),
    ]);
    expect(outcome).toBe("stalled");
    expect(world.state.tick).toBe(before);
    release.release();
    await runner.idle();
  });
});

// --- Which god takes the turn ----------------------------------------------------------------------

/**
 * Commits one real tick over `fixtures` alone (no routines, no journal), so the
 * threads they open are in the store and in the state the runner reads, and a
 * later `tick(world)` extends the same log.
 */
function stage(world: World, ...fixtures: Record<string, unknown>[]) {
  const proposals = fixtures.map((raw, index) => {
    const submitted = submitProposal({
      schemaVersion: 1,
      targets: [],
      expectedRevisions: [],
      source: "fixture",
      observationId: `obs-stage-${world.state.tick}-${index}`,
      ...raw,
    });
    if (!submitted.ok) throw new Error(submitted.rejection.message);
    return submitted.proposal;
  });
  const result = runTick(world.state, world.prng, proposals);
  expect(result.rejected).toEqual([]);
  world.wallMs += 1_000;
  commitTick(world.store, world.reducers, {
    events: result.events,
    cursorWallMs: world.wallMs,
    paused: false,
    tick: result.state.tick,
    simTimeMs: result.state.simTime,
    prngState: serializePrngState(result.prng),
  });
  world.state = result.state;
  world.prng = result.prng;
  return result;
}

/** Commits hand-built world events (a spoiled stock, a prayer) the way a past tick would have left them. */
function stageEvents(world: World, ...drafts: Record<string, unknown>[]) {
  const events: WorldEvent[] = [];
  let state = world.state;
  for (const [index, draft] of drafts.entries()) {
    const event = {
      schemaVersion: 1,
      id: `evt-${state.tick}-${800 + index + world.state.lastSequence}`,
      sequence: state.lastSequence + 1,
      simTime: state.simTime,
      tick: state.tick,
      correlationId: "fixture",
      causationId: "fixture",
      approximate: false,
      ...draft,
    } as unknown as WorldEvent;
    state = applyEvent({ ...state, lastSequence: event.sequence }, event);
    events.push(event);
  }
  world.wallMs += 1_000;
  commitTick(world.store, world.reducers, {
    events,
    cursorWallMs: world.wallMs,
    paused: false,
    tick: state.tick,
    simTimeMs: state.simTime,
    prngState: serializePrngState(world.prng),
  });
  world.state = state;
  return events;
}

const eventIdOf = (world: World, kind: string): string => {
  const found = listEvents(world.store.db).find((e) => e.kind === kind);
  if (!found) throw new Error(`no ${kind} event`);
  return found.id;
};

/** `from` tells `to` something real; returns the report's id, the cause `to` may cite. */
function tells(world: World, from: string, to: string): string {
  const before = listEvents(world.store.db).length;
  stage(world, {
    actor: from,
    kind: "report",
    listener: to,
    content: `${from} speaks to ${to}.`,
  });
  const report = listEvents(world.store.db)
    .slice(before)
    .find((e) => e.kind === "report-told");
  if (!report) throw new Error("no report");
  return report.id;
}

/** `from` demands a legend at the altar of `to`, over something `from` was told; returns the thread. */
function demands(world: World, from: string, to: string, ticks = 400) {
  const cause = tells(world, to, from);
  stage(world, {
    actor: from,
    kind: "practice",
    move: "demand",
    counterparty: to,
    cause,
    term: {
      kind: "tell-legend",
      party: to,
      place: "altar",
      deadlineTicks: ticks,
    },
  });
  const thread = [...world.state.threads.values()].at(-1);
  if (!thread) throw new Error("no thread");
  return thread;
}

/** `god` owes `other` a term: `other` demanded it and `god` accepted. */
function owes(world: World, god: string, other: string, ticks = 400) {
  const thread = demands(world, other, god, ticks);
  stage(world, {
    actor: god,
    kind: "practice",
    move: "accept",
    thread: thread.id,
  });
  return thread;
}

/** `mortal` prays to `god` about spoiled food, `god` sets terms, and `mortal` accepts: the god owes the boon. */
function owesBoon(world: World, god: string, mortal = "ferryman") {
  const [spoiled] = stageEvents(world, {
    kind: "stock-spoiled",
    entityId: mortal,
    resource: "food",
    amount: 1,
    cause: "director",
  });
  const [prayer] = stageEvents(world, {
    kind: "petition-opened",
    entityId: mortal,
    god,
    cause: spoiled?.id,
    request: {
      kind: "help",
      need: { kind: "resource", resource: "food", amount: 1 },
    },
  });
  stage(world, {
    actor: god,
    kind: "practice",
    move: "offer",
    petition: prayer?.id,
    term: {
      kind: "make-offering",
      party: mortal,
      to: god,
      resource: "currency",
      amount: 1,
      deadlineTicks: 300,
    },
  });
  const thread = [...world.state.threads.values()].at(-1);
  if (!thread) throw new Error("no thread");
  stage(world, {
    actor: mortal,
    kind: "practice",
    move: "accept",
    thread: thread.id,
    source: "routine",
  });
  return thread;
}

/** Runs `turns` journaled turns, one at a time with a tick between so each god's proposal is consumed, and returns who was asked, in order. */
async function turnsTaken(
  runner: GodTurnRunner,
  world: World,
  provider: Provider,
  turns: number,
): Promise<string[]> {
  const first = provider.requests.length;
  for (let turn = 0; turn < turns; turn += 1) {
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    tick(world);
  }
  return provider.requests.slice(first).map((request) => request.god);
}

describe("which god takes the turn", () => {
  test("a god that owes a term goes ahead of an idle god that is earlier in id order; with nothing owed the earlier one goes first", async () => {
    const owing = newWorld();
    owes(owing, "zeus", "hera");
    const provider = startProvider();
    const runner = runnerFor(owing, provider, ["hera", "zeus"]);
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(provider.requests.map((r) => r.god)).toEqual(["zeus"]);

    // Control: the same two gods, with nothing owed, go in id order.
    const quiet = newWorld();
    const calm = startProvider();
    const plain = runnerFor(quiet, calm, ["hera", "zeus"]);
    expect(plain.dispatch()).toBe(true);
    await plain.idle();
    expect(calm.requests.map((r) => r.god)).toEqual(["hera"]);
  });

  test("a god that owes a boon goes ahead of an idle god earlier in id order, whatever the deadline", async () => {
    const world = newWorld();
    const thread = owesBoon(world, "zeus");
    expect(thread.term.deadline - world.state.tick).toBeGreaterThan(200);
    const provider = startProvider();
    const runner = runnerFor(world, provider, ["hera", "zeus"]);
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(provider.requests.map((r) => r.god)).toEqual(["zeus"]);
  });

  test("of two gods that owe, the earlier deadline goes first, though the other is earlier in id order", async () => {
    const world = newWorld();
    // Hera owes until a long way off; Zeus owes sooner. Hera is first in id order.
    owes(world, "hera", "zeus", 400);
    owes(world, "zeus", "hera", 150);
    const provider = startProvider();
    const runner = runnerFor(world, provider, ["hera", "zeus"]);
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(provider.requests.map((r) => r.god)).toEqual(["zeus"]);
  });

  test("a god a thread is waiting on goes ahead of an idle god and after a god that owes: owing, then awaited, then idle", async () => {
    const world = newWorld();
    // Zeus owes Hera; Zeus has also asked something of Hera and waits for her answer. Athena has nothing.
    owes(world, "zeus", "hera");
    demands(world, "zeus", "hera");
    const provider = startProvider();
    const runner = runnerFor(world, provider, ["athena", "hera", "zeus"]);
    // No tick between turns: a god with a proposal waiting is not asked again, so each turn is the next in line.
    for (let turn = 0; turn < 3; turn += 1) {
      expect(runner.dispatch()).toBe(true);
      await runner.idle();
    }
    expect(provider.requests.map((r) => r.god)).toEqual([
      "zeus",
      "hera",
      "athena",
    ]);
  });

  test("a prayer, however many, raises nothing: a god with prayers waiting goes in its turn in id order like any idle god", async () => {
    const world = newWorld();
    stageEvents(world, {
      kind: "stock-spoiled",
      entityId: "ferryman",
      resource: "food",
      amount: 1,
      cause: "director",
    });
    stageEvents(world, {
      kind: "petition-opened",
      entityId: "ferryman",
      god: "zeus",
      cause: eventIdOf(world, "stock-spoiled"),
      request: {
        kind: "help",
        need: { kind: "resource", resource: "food", amount: 1 },
      },
    });
    const provider = startProvider();
    const runner = runnerFor(world, provider, ["hera", "zeus"]);
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(provider.requests.map((r) => r.god)).toEqual(["hera"]);
  });

  test("a starved idle god is served by its eighth chance at the latest, even with a god that owes always present", async () => {
    const world = newWorld();
    owes(world, "zeus", "hera", 450);
    const provider = startProvider();
    const runner = runnerFor(world, provider, ["hera", "zeus"]);
    const order = await turnsTaken(runner, world, provider, 16);
    const firstHera = order.indexOf("hera");
    expect(firstHera).toBeGreaterThanOrEqual(0);
    // Passed over seven times, served on the eighth.
    expect(firstHera + 1).toBeLessThanOrEqual(8);
    expect(order.slice(0, 8)).toEqual([
      "zeus",
      "zeus",
      "zeus",
      "zeus",
      "zeus",
      "zeus",
      "zeus",
      "hera",
    ]);
    // And it is the owing god that is served the most.
    expect(order.filter((g) => g === "zeus").length).toBeGreaterThan(
      order.filter((g) => g === "hera").length,
    );
  });

  test("with nothing urgent the order is the old round-robin: id order from the god served last, wrapping", async () => {
    const world = newWorld();
    const provider = startProvider();
    const runner = runnerFor(world, provider, ["hades", "hera", "zeus"]);
    const order = await turnsTaken(runner, world, provider, 7);
    expect(order).toEqual([
      "hades",
      "hera",
      "zeus",
      "hades",
      "hera",
      "zeus",
      "hades",
    ]);
  });

  test("a god travelling to a declared destination takes no turn; the same god standing still does", async () => {
    // Zeus in the great hall is three hops from the tavern: after the first, the journey is under way.
    const travelling = newWorld();
    stage(travelling, { actor: "zeus", kind: "travel", to: "tavern" });
    expect(travelling.state.journeys.has(id("zeus"))).toBe(true);
    const provider = startProvider();
    const runner = runnerFor(travelling, provider, ["zeus"]);
    expect(runner.dispatch()).toBe(false);
    expect(provider.requests).toHaveLength(0);

    // Control: with no journey, the same runner asks him.
    const standing = newWorld();
    const calm = startProvider();
    const plain = runnerFor(standing, calm, ["zeus"]);
    expect(plain.dispatch()).toBe(true);
    await plain.idle();
    expect(calm.requests.map((r) => r.god)).toEqual(["zeus"]);
  });

  test("the other gods are served while one travels, and owing alone does not call the traveller back", async () => {
    const world = newWorld();
    owes(world, "zeus", "hera");
    stage(world, { actor: "zeus", kind: "travel", to: "tavern" });
    const provider = startProvider();
    const runner = runnerFor(world, provider, ["hera", "zeus"]);
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    // Zeus owes, and would go first if he stood still.
    expect(provider.requests.map((r) => r.god)).toEqual(["hera"]);
    expect(runner.dispatch()).toBe(false);
    expect(provider.requests).toHaveLength(1);
  });

  test("a travelling god a thread is waiting on for its answer is picked", async () => {
    const world = newWorld();
    // Zeus asks something of Hera and waits for her answer; Hera, meanwhile, sets out for the tavern.
    demands(world, "zeus", "hera");
    stage(world, { actor: "hera", kind: "travel", to: "tavern" });
    expect(world.state.journeys.has(id("hera"))).toBe(true);
    const provider = startProvider();
    const runner = runnerFor(world, provider, ["hera"]);
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(provider.requests.map((r) => r.god)).toEqual(["hera"]);
  });

  test("a god is eligible again the tick it arrives", async () => {
    const world = newWorld();
    // The great hall to the mountain path is two hops, through the gate.
    stage(world, { actor: "zeus", kind: "travel", to: "mountain-path" });
    const provider = startProvider();
    const runner = runnerFor(world, provider, ["zeus"]);
    expect(runner.dispatch()).toBe(false);
    tick(world);
    expect(world.state.journeys.has(id("zeus"))).toBe(false);
    expect(String(world.state.actors.get(id("zeus"))?.locationId)).toBe(
      "mountain-path",
    );
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(provider.requests.map((r) => r.god)).toEqual(["zeus"]);
  });

  test("a god with a pending proposal is never picked, however urgent; it is picked again once the tick consumes it", async () => {
    const world = newWorld();
    owes(world, "zeus", "hera");
    const provider = startProvider();
    const runner = runnerFor(world, provider, ["hera", "zeus"]);
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    // Zeus owes, so Zeus went first; with its proposal waiting, Hera is the only god left, and then nobody.
    expect(provider.requests.map((r) => r.god)).toEqual(["zeus", "hera"]);
    expect(runner.dispatch()).toBe(false);
    expect(provider.requests).toHaveLength(2);
    // Consumed, and Zeus is urgent again.
    tick(world);
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(provider.requests.at(-1)?.god).toBe("zeus");
  });

  test("a restart resets the cursor and the skip counts: a new runner starts the rotation over without error", async () => {
    const world = newWorld();
    owes(world, "zeus", "hera", 450);
    const provider = startProvider();
    const first = runnerFor(world, provider, ["hera", "zeus"]);
    // Three turns: Hera has now been passed over three times.
    expect(await turnsTaken(first, world, provider, 3)).toEqual([
      "zeus",
      "zeus",
      "zeus",
    ]);

    // Killed and restarted: the new process remembers nothing of the old one's cursor or counts.
    restart(world);
    const second = runnerFor(world, provider, ["hera", "zeus"]);
    expect(await turnsTaken(second, world, provider, 8)).toEqual([
      "zeus",
      "zeus",
      "zeus",
      "zeus",
      "zeus",
      "zeus",
      "zeus",
      "hera",
    ]);
    // Nothing was persisted for it: the store holds no rotation table.
    const tables = world.store.db
      .query("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    expect(
      tables
        .map((t) => t.name)
        .filter((name) => /sched|rotation|skip/i.test(name)),
    ).toEqual([]);
  });

  test("the lifecycle still gates it: nothing is picked during catch-up or pause, and a god that owes waits with the rest", async () => {
    const world = newWorld();
    owes(world, "zeus", "hera");
    const provider = startProvider();
    const runner = runnerFor(world, provider, ["hera", "zeus"]);
    world.flags.catchUpRunning = true;
    expect(runner.dispatch()).toBe(false);
    world.flags.catchUpRunning = false;
    world.flags.paused = true;
    expect(runner.dispatch()).toBe(false);
    expect(provider.requests).toHaveLength(0);
    world.flags.paused = false;
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(provider.requests.map((r) => r.god)).toEqual(["zeus"]);
  });
});

// --- Restarts ---------------------------------------------------------------------------------------

describe("a restart", () => {
  test("after a kill that followed journaling: the proposal runs once, and the god gets no second turn while it is pending", async () => {
    const world = newWorld();
    const provider = startProvider();
    const first = runnerFor(world, provider, ["zeus"]);
    first.dispatch();
    await first.idle();
    expect(pendingModelProposals(world)).toHaveLength(1);

    // Killed here. A new process holds nothing of the first one's memory.
    restart(world);
    const second = runnerFor(world, provider, ["zeus"]);
    expect(second.dispatch()).toBe(false);
    expect(provider.requests).toHaveLength(1);

    tick(world);
    const journal = listExternalProposals(world.store.db);
    expect(journal).toHaveLength(1);
    expect(journal[0]?.outcome).toEqual({ status: "committed" });
    // Control: consumed, so the god reasons again.
    expect(second.dispatch()).toBe(true);
    await second.idle();
    expect(provider.requests).toHaveLength(2);
  });

  test("after a kill during inference: the god reasons afresh and exactly one proposal commits", async () => {
    const world = newWorld();
    const release = held();
    const provider = startProvider(async (god, n) => {
      if (n === 0) await release.gate;
      return LEGEND(god);
    });
    const first = runnerFor(world, provider, ["zeus"]);
    first.dispatch();
    await Bun.sleep(50);
    expect(provider.requests).toHaveLength(1);

    // Killed mid-inference: the turn died with the process, whatever the provider does next.
    first.stop();
    await first.idle();
    // An abandoned turn is neither an outage nor a request the world remembers.
    expect(world.statusRef.modelDegraded).toBeUndefined();
    expect(
      world.store.db
        .query("SELECT COUNT(*) AS n FROM trace_model_requests")
        .get(),
    ).toEqual({ n: 0 });
    restart(world);
    release.release();
    await Bun.sleep(50);
    expect(listExternalProposals(world.store.db)).toEqual([]);

    const second = runnerFor(world, provider, ["zeus"]);
    expect(second.dispatch()).toBe(true);
    await second.idle();
    expect(provider.requests).toHaveLength(2);
    tick(world);
    const committed = listExternalProposals(world.store.db).filter(
      (entry) => entry.outcome?.status === "committed",
    );
    expect(committed).toHaveLength(1);
    expect(
      listEvents(world.store.db).filter(
        (event) => event.kind === "legend-recorded",
      ),
    ).toHaveLength(1);
  });
});

// --- The lifecycle seam ----------------------------------------------------------------------------------

describe("the lifecycle seam", () => {
  test("no turn starts before startup catch-up completes, while any catch-up runs, or while the world is paused; open, one does", async () => {
    const closed: [string, (flags: Lifecycles) => void][] = [
      [
        "startup catch-up not complete",
        (f) => (f.startupCatchUpComplete = false),
      ],
      ["a catch-up running", (f) => (f.catchUpRunning = true)],
      ["paused", (f) => (f.paused = true)],
    ];
    for (const [name, close] of closed) {
      const world = newWorld();
      const provider = startProvider();
      const runner = runnerFor(world, provider, ["zeus"]);
      close(world.flags);
      expect(runner.dispatch(), name).toBe(false);
      await runner.idle();
      expect(provider.requests, name).toHaveLength(0);
    }

    // Control: with everything open the same runner dispatches.
    const world = newWorld();
    const provider = startProvider();
    const runner = runnerFor(world, provider, ["zeus"]);
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(provider.requests).toHaveLength(1);
  });

  test("through a real catch-up run no turn starts, on every chunk it commits; with the gate removed the same probe sees one start", async () => {
    const probe = async (lifecycleFor: (world: World) => Lifecycle) => {
      const world = newWorld();
      const provider = startProvider();
      const runner = runnerFor(
        world,
        provider,
        ["zeus", "hera"],
        lifecycleFor(world),
      );
      // Three minutes behind: three real chunks (the authored chunk is one minute), each committed to the real store. The property is about the boundaries between chunks, not the size of the gap, and a catch-up is CPU-bound, so a longer gap only makes the test depend on how busy the machine is (ten minutes took 1.5 s alone and over the 5 s limit under parallel load).
      world.store.db.run("UPDATE clock SET cursor_wall_ms = ? WHERE id = 1", [
        Date.now() - 3 * 60 * 1000,
      ]);
      const dispatched: boolean[] = [];
      world.flags.catchUpRunning = true;
      const result = await runCatchUp(world.state, world.prng, world.deps, {
        nowWallMs: Date.now(),
        onChunkCommitted: () => {
          dispatched.push(runner.dispatch());
          return false;
        },
      });
      world.flags.catchUpRunning = false;
      await runner.idle();
      return { world, provider, runner, dispatched, result };
    };

    const gated = await probe((world) => world.lifecycle);
    expect(gated.result.degraded).toBeUndefined();
    expect(gated.dispatched.length).toBeGreaterThan(1);
    expect(gated.dispatched.every((started) => !started)).toBe(true);
    expect(gated.provider.requests).toHaveLength(0);
    // Control: once the catch-up is over the same runner takes its turn.
    expect(gated.runner.dispatch()).toBe(true);
    await gated.runner.idle();
    expect(gated.provider.requests).toHaveLength(1);

    // The probe can fail: a runner that does not consult the catch-up flag starts a turn inside it.
    const ungated = await probe(() => ({
      startupCatchUpComplete: () => true,
      catchUpRunning: () => false,
      paused: () => false,
    }));
    expect(ungated.dispatched.some((started) => started)).toBe(true);
    expect(ungated.provider.requests.length).toBeGreaterThan(0);
  });

  test("control: a runner with no gate dispatches during a catch-up, so the check above would catch one", async () => {
    const world = newWorld();
    world.flags.catchUpRunning = true;
    const provider = startProvider();
    const ungated: Lifecycle = {
      startupCatchUpComplete: () => true,
      catchUpRunning: () => false,
      paused: () => false,
    };
    const runner = runnerFor(world, provider, ["zeus"], ungated);
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(provider.requests).toHaveLength(1);
  });

  test("a turn in flight when the world pauses still journals, and its proposal waits for the world to resume", async () => {
    const world = newWorld();
    const release = held();
    const provider = startProvider(async (god) => {
      await release.gate;
      return LEGEND(god);
    });
    const runner = runnerFor(world, provider, ["zeus"]);
    expect(runner.dispatch()).toBe(true);
    world.flags.paused = true;
    release.release();
    await runner.idle();

    expect(pendingModelProposals(world)).toHaveLength(1);
    // No new turn starts while paused, and the entry stays pending: no tick has run.
    expect(runner.dispatch()).toBe(false);
    expect(pendingModelProposals(world)).toHaveLength(1);

    world.flags.paused = false;
    tick(world);
    expect(listExternalProposals(world.store.db)[0]?.outcome).toEqual({
      status: "committed",
    });
  });
});

// --- Outage ---------------------------------------------------------------------------------------------------

// --- A store fault in a turn --------------------------------------------------------------------------------

/**
 * A store whose reads fail while `failing.on` is set, for the statements whose
 * SQL contains `failing.match`: the real database underneath, so once the
 * fault clears the same runner works against the same journal.
 */
function faultyStore(store: Store, failing: { on: boolean; match: string }) {
  const db = new Proxy(store.db, {
    get(target, property) {
      if (property === "query") {
        return (sql: string) => {
          if (failing.on && sql.includes(failing.match)) {
            throw new Error(`injected read failure: ${failing.match}`);
          }
          return target.query(sql);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { ...store, db } as Store;
}

describe("a store fault", () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  beforeEach(() => {
    unhandled.length = 0;
    process.on("unhandledRejection", onUnhandled);
  });
  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
  });

  test("while a turn prepares is logged and abandoned: nothing rejects, the flag clears, and the next dispatch works", async () => {
    const world = newWorld();
    const provider = startProvider();
    const failing = { on: true, match: "FROM events" };
    const logs: string[] = [];
    const runner = createGodTurnRunner({
      ...deps(provider, ["zeus"]),
      store: faultyStore(world.store, failing),
      getState: () => world.state,
      lifecycle: world.lifecycle,
      statusRef: world.statusRef,
      onLog: (message) => logs.push(message),
    });

    expect(runner.dispatch()).toBe(true);
    // The promise the service never awaits must not reject.
    await runner.idle();
    await Bun.sleep(20);
    expect(unhandled).toEqual([]);
    expect(runner.inFlight()).toBe(false);
    expect(logs.join("\n")).toContain("injected read failure");
    expect(provider.requests).toHaveLength(0);
    expect(listExternalProposals(world.store.db)).toEqual([]);

    // Control: the fault clears, and the same runner takes its turn.
    failing.on = false;
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(provider.requests).toHaveLength(1);
    expect(pendingModelProposals(world)).toHaveLength(1);
  });

  test("while dispatch chooses a god never throws into the tick: dispatch says no, and works again once the read does", async () => {
    const world = newWorld();
    const provider = startProvider();
    const failing = { on: true, match: "FROM external_proposals" };
    const logs: string[] = [];
    let stateFails = false;
    const runner = createGodTurnRunner({
      ...deps(provider, ["zeus"]),
      store: faultyStore(world.store, failing),
      getState: () => {
        if (stateFails) throw new Error("injected state failure");
        return world.state;
      },
      lifecycle: world.lifecycle,
      statusRef: world.statusRef,
      onLog: (message) => logs.push(message),
    });

    // The pending-entries read fails while choosing a god.
    expect(runner.dispatch()).toBe(false);
    expect(runner.inFlight()).toBe(false);
    // So does reading the state.
    failing.on = false;
    stateFails = true;
    expect(runner.dispatch()).toBe(false);
    expect(runner.inFlight()).toBe(false);
    expect(logs.join("\n")).toContain("injected read failure");
    expect(logs.join("\n")).toContain("injected state failure");
    expect(provider.requests).toHaveLength(0);

    // Control: with both reads healthy the same runner dispatches.
    stateFails = false;
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(provider.requests).toHaveLength(1);
    expect(unhandled).toEqual([]);
  });

  test("while the scheduler reads what the gods are waiting on never throws into the tick: dispatch says no, logs it, and works again once the read does", async () => {
    const world = newWorld();
    owes(world, "zeus", "hera");
    const provider = startProvider();
    const logs: string[] = [];
    // A state whose threads cannot be read: the signals are read from them.
    const unreadableThreads = () => {
      const threads = new Map(world.state.threads);
      threads.values = () => {
        throw new Error("injected thread read failure");
      };
      return threads;
    };
    let unreadable = true;
    const runner = createGodTurnRunner({
      ...deps(provider, ["hera", "zeus"]),
      store: world.store,
      getState: () =>
        unreadable
          ? {
              ...world.state,
              threads: unreadableThreads(),
            }
          : world.state,
      lifecycle: world.lifecycle,
      statusRef: world.statusRef,
      onLog: (message) => logs.push(message),
    });

    expect(() => runner.dispatch()).not.toThrow();
    expect(runner.dispatch()).toBe(false);
    expect(runner.inFlight()).toBe(false);
    expect(logs.join("\n")).toContain(
      "god turn not started: injected thread read failure",
    );
    expect(provider.requests).toHaveLength(0);
    // The failed read did not advance the rotation: nothing is lost by it.
    unreadable = false;
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(provider.requests.map((r) => r.god)).toEqual(["zeus"]);
    expect(unhandled).toEqual([]);
  });

  test("in the lifecycle gate never throws into the tick: dispatch says no, logs it, asks no model, and works again once the read does", async () => {
    const world = newWorld();
    const provider = startProvider();
    const logs: string[] = [];
    let pausedFails = true;
    const runner = createGodTurnRunner({
      ...deps(provider, ["zeus"]),
      store: world.store,
      getState: () => world.state,
      lifecycle: {
        ...world.lifecycle,
        paused: () => {
          if (pausedFails) throw new Error("db down");
          return world.flags.paused;
        },
      },
      statusRef: world.statusRef,
      onLog: (message) => logs.push(message),
    });

    expect(() => runner.dispatch()).not.toThrow();
    expect(runner.dispatch()).toBe(false);
    expect(runner.inFlight()).toBe(false);
    expect(logs).toContain("god turn not started: db down");
    expect(provider.requests).toHaveLength(0);

    // Control: with the read healthy the same runner takes its turn.
    pausedFails = false;
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(provider.requests).toHaveLength(1);
    expect(unhandled).toEqual([]);
  });
});

// --- What a god is shown of its own actions ------------------------------------------------------------------

/** Runs `world` forward one journaled turn at a time: the god's scripted reply is journaled, then a tick commits it. */
async function actOut(
  world: World,
  provider: Provider,
  replies: string[],
  god = "zeus",
): Promise<void> {
  const runner = runnerFor(world, provider, [god]);
  let next = 0;
  provider.respond = () => replies[next++] ?? '{"action":"wait"}';
  for (let i = 0; i < replies.length; i += 1) {
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    tick(world);
  }
}

describe("a god's own recent actions", () => {
  test("the bounded read returns exactly the events its own actions committed, newest first window, and the same ones the pure rule names", async () => {
    // Zeus at the tavern: a legend, a strike, then a trip; every kind of own action the read covers.
    const tavern = newWorld("tavern");
    const provider = startProvider();
    await actOut(tavern, provider, [
      '{"action":"legend","assertion":"The tavern will burn."}',
      '{"action":"strike","target":"the-tavern","power":3}',
      '{"action":"travel","to":"town-square"}',
    ]);
    // And a report, in the great hall where Hera stands.
    const hall = newWorld("great-hall");
    await actOut(hall, startProvider(), [
      '{"action":"report","listener":"hera","content":"Mind your tongue.","claim":{"effect":"harm","agent":"hera","target":"zeus"}}',
    ]);

    for (const world of [tavern, hall]) {
      const all = listEvents(world.store.db);
      const mine = all.filter((event) => authoredAction(event, id("zeus")));
      expect(mine.length).toBeGreaterThan(0);
      const read = readOwnEvents(
        world.store.db,
        id("zeus"),
        world.state.lastSequence,
      );
      expect(read.map((e) => e.id)).toEqual(mine.map((e) => e.id));
      // Other kinds exist in the log (costs, beliefs, goals) and are left out.
      expect(all.length).toBeGreaterThan(mine.length);
      // Control: a god that acted nowhere has nothing, and the read is bounded in sequence.
      expect(
        readOwnEvents(world.store.db, id("hera"), world.state.lastSequence),
      ).toEqual([]);
      expect(readOwnEvents(world.store.db, id("zeus"), 0)).toEqual([]);
    }
    expect(OWN_EVENT_WINDOW).toBeGreaterThan(0);
  });

  test("the read is capped at the window, keeping the newest", async () => {
    const world = newWorld("great-hall");
    const provider = startProvider();
    const moves = Array.from({ length: OWN_EVENT_WINDOW + 3 }, (_, i) =>
      JSON.stringify({
        action: "travel",
        to: i % 2 === 0 ? "olympus-gate" : "great-hall",
      }),
    );
    await actOut(world, provider, moves);
    const read = readOwnEvents(
      world.store.db,
      id("zeus"),
      world.state.lastSequence,
    );
    const all = listEvents(world.store.db).filter((e) =>
      authoredAction(e, id("zeus")),
    );
    expect(read).toHaveLength(OWN_EVENT_WINDOW);
    expect(read.map((e) => e.id)).toEqual(
      all.slice(-OWN_EVENT_WINDOW).map((e) => e.id),
    );
  });

  test("two gods in one store: each read returns only its own author's events, and Zeus's prompt carries Hera's words only as a belief he was told", async () => {
    const world = newWorld("great-hall");
    const provider = startProvider();
    const HERA_REPORT = "Hera's report about the sacred vows.";
    const HERA_LEGEND = "Hera's legend of the broken oath.";
    // Hera speaks first, with Zeus in the hall: a report to him, and a legend he hears.
    await actOut(
      world,
      provider,
      [
        JSON.stringify({
          action: "report",
          listener: "zeus",
          content: HERA_REPORT,
        }),
        JSON.stringify({ action: "legend", assertion: HERA_LEGEND }),
      ],
      "hera",
    );
    // Then each of them moves, and Zeus makes a report of his own.
    await actOut(
      world,
      provider,
      [
        JSON.stringify({
          action: "report",
          listener: "hera",
          content: "Zeus's own word.",
        }),
      ],
      "zeus",
    );
    await actOut(
      world,
      provider,
      [JSON.stringify({ action: "travel", to: "olympus-gate" })],
      "hera",
    );
    await actOut(
      world,
      provider,
      [JSON.stringify({ action: "travel", to: "olympus-gate" })],
      "zeus",
    );

    const all = listEvents(world.store.db);
    const authored = (god: string) =>
      all.filter((e) => authoredAction(e, id(god)));
    const heras = authored("hera");
    expect(heras.map((e) => e.kind as string).sort()).toEqual(
      ["entity-moved", "legend-recorded", "report-told"].sort(),
    );
    expect(authored("zeus").length).toBeGreaterThan(0);

    const last = world.state.lastSequence;
    const zeusRead = readOwnEvents(world.store.db, id("zeus"), last);
    const heraRead = readOwnEvents(world.store.db, id("hera"), last);
    // Zeus's read excludes every one of Hera's events; Hera's includes them.
    for (const event of heras) {
      expect(zeusRead.map((e) => e.id)).not.toContain(event.id);
      expect(heraRead.map((e) => e.id)).toContain(event.id);
    }
    expect(zeusRead.map((e) => e.id)).toEqual(
      authored("zeus").map((e) => e.id),
    );
    expect(heraRead.map((e) => e.id)).toEqual(heras.map((e) => e.id));
    expect(
      zeusRead.every((e) => "entityId" in e && e.entityId === id("zeus")),
    ).toBe(true);

    // Zeus's prompt: his own action lines never carry Hera's words ...
    const runner = runnerFor(world, provider, ["zeus"]);
    provider.respond = () => '{"action":"wait"}';
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    const prompt = JSON.parse(provider.requests.at(-1)?.body ?? "{}") as {
      messages: { content: string }[];
    };
    const text = prompt.messages.map((m) => m.content).join("\n");
    const lines = text.split("\n");
    const mine = lines.slice(
      lines.findIndex((l) => l.startsWith("What you did recently")),
    );
    for (const words of [HERA_REPORT, HERA_LEGEND]) {
      expect(mine.slice(0, 8).join("\n")).not.toContain(words);
      // ... and wherever her words do reach him, it is as an account she told him.
      const carrying = lines.filter((l) => l.includes(words));
      expect(carrying.length).toBeGreaterThan(0);
      for (const line of carrying) expect(line).toMatch(/^- hera told you: /);
    }
    expect(text).toContain("Zeus's own word.");
  });

  test("a turn's prompt shows the god's own committed report with its words and claim, and its goal", async () => {
    const world = newWorld("great-hall");
    const provider = startProvider();
    await actOut(world, provider, [
      '{"action":"report","listener":"hera","content":"Mind your tongue.","claim":{"effect":"harm","agent":"hera","target":"zeus"},"goal":{"set":{"text":"Make Hera respect me.","target":"hera"}}}',
    ]);
    const runner = runnerFor(world, provider, ["zeus"]);
    provider.respond = () => '{"action":"wait"}';
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    const prompt = provider.requests.at(-1)?.body ?? "";
    expect(prompt).toContain("What you did recently");
    expect(prompt).toContain("you told hera: ");
    expect(prompt).toContain("Mind your tongue.");
    expect(prompt).toContain("claiming hera harmed zeus");
    expect(prompt).toContain("Make Hera respect me.");
    // Hera's belief and feeling are hers: nothing of them is in Zeus's prompt.
    expect(prompt).not.toContain("How you feel now");
    expect(prompt).not.toContain("told you:");
  });

  test("a petition addressed to the god is in its turn prompt, and one addressed to the other god is not", async () => {
    const world = newWorld();
    const provider = startProvider();
    // The farmer prays about a director's theft, a trouble in Hermes's domain: the petition goes to Hermes, not to the farmer's patron Hera.
    const theft = {
      schemaVersion: 1,
      id: "evt-1-901",
      sequence: world.state.lastSequence + 1,
      simTime: 0,
      tick: world.state.tick,
      correlationId: "fixture",
      causationId: "fixture",
      approximate: false,
      kind: "theft",
      entityId: "woodcutter",
      victim: "farmer",
      resource: "food",
      amount: 1,
      cause: "director",
    } as unknown as WorldEvent;
    let staged = applyEvent(world.state, theft);
    const farmer = getActor(staged, id("farmer"));
    if (!farmer) throw new Error("farmer");
    staged = withActor(staged, { ...farmer, locationId: id("altar") });
    const submitted = submitProposal({
      schemaVersion: 1,
      actor: "farmer",
      kind: "pray",
      cause: "evt-1-901",
      targets: [],
      expectedRevisions: [],
      source: "routine",
      observationId: "obs-pray",
    });
    if (!submitted.ok) throw new Error("fixture");
    const prayed = runTick(staged, createPrng(1), [submitted.proposal]);
    expect(prayed.rejected).toEqual([]);
    world.state = prayed.state;
    const opened = prayed.events.find((e) => e.kind === "petition-opened");
    if (opened?.kind !== "petition-opened") throw new Error("no petition");

    provider.respond = () => '{"action":"wait"}';
    for (const [god, mine] of [
      ["hermes", true],
      ["zeus", false],
      ["hera", false],
    ] as const) {
      const runner = runnerFor(world, provider, [god]);
      expect(runner.dispatch()).toBe(true);
      await runner.idle();
      const body = provider.requests.at(-1)?.body ?? "";
      expect(body.includes("Prayers to you")).toBe(mine);
      expect(body.includes(String(opened.id))).toBe(mine);
    }
    expect(String(opened.god)).toBe("hermes");
  });

  test("after the world refuses a goal change, the god's next prompt says so and why", async () => {
    const world = newWorld();
    const provider = startProvider();
    const set = (text: string) =>
      JSON.stringify({
        action: "wait",
        goal: { set: { text, target: "zeus" } },
      });
    // Turn 1 sets a goal; turn 2 tries to replace it at once and is refused.
    await actOut(
      world,
      provider,
      [set("Make Zeus admit it."), set("Win Zeus over.")],
      "hera",
    );
    const refused = listEvents(world.store.db).filter(
      (e) => e.kind === "goal-change-refused",
    );
    expect(refused).toHaveLength(1);
    expect(world.state.goals.get(id("hera"))?.text).toBe("Make Zeus admit it.");

    const runner = runnerFor(world, provider, ["hera"]);
    provider.respond = () => '{"action":"wait"}';
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    const prompt = provider.requests.at(-1)?.body ?? "";
    expect(prompt).toContain("were refused");
    expect(prompt).toContain("locked");
    // Control: the other god, who tried nothing, is told nothing.
    const zeusRunner = runnerFor(world, provider, ["zeus"]);
    expect(zeusRunner.dispatch()).toBe(true);
    await zeusRunner.idle();
    expect(provider.requests.at(-1)?.body ?? "").not.toContain("were refused");
  });

  test("a fault while the turn reads the open petitions is logged and the turn abandoned: nothing rejects, no model is asked, and the next dispatch works", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const world = newWorld();
      const provider = startProvider();
      let broken = true;
      // Petitions are read from world state inside the turn: a state whose petitions cannot be read.
      const faulty = (): WorldState =>
        broken
          ? {
              ...world.state,
              petitions: new Proxy(new Map(), {
                get(target, property) {
                  if (property === "values" || property === Symbol.iterator) {
                    return () => {
                      throw new Error("injected petition read failure");
                    };
                  }
                  const value = Reflect.get(target, property, target);
                  return typeof value === "function"
                    ? value.bind(target)
                    : value;
                },
              }),
            }
          : world.state;
      const logs: string[] = [];
      const runner = createGodTurnRunner({
        ...deps(provider, ["hera"]),
        store: world.store,
        getState: faulty,
        lifecycle: world.lifecycle,
        statusRef: world.statusRef,
        onLog: (message) => logs.push(message),
      });
      expect(runner.dispatch()).toBe(true);
      await runner.idle();
      await Bun.sleep(20);
      expect(unhandled).toEqual([]);
      expect(runner.inFlight()).toBe(false);
      expect(logs.join("\n")).toContain("injected petition read failure");
      expect(provider.requests).toHaveLength(0);
      broken = false;
      expect(runner.dispatch()).toBe(true);
      await runner.idle();
      expect(provider.requests).toHaveLength(1);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("a store fault in the read of the latest refusal is logged and the turn abandoned: nothing rejects, no model is asked, and the next dispatch works", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const world = newWorld();
      const provider = startProvider();
      const failing = { on: true, match: "goal-change-refused" };
      const logs: string[] = [];
      const runner = createGodTurnRunner({
        ...deps(provider, ["hera"]),
        store: faultyStore(world.store, failing),
        getState: () => world.state,
        lifecycle: world.lifecycle,
        statusRef: world.statusRef,
        onLog: (message) => logs.push(message),
      });
      expect(runner.dispatch()).toBe(true);
      await runner.idle();
      await Bun.sleep(20);
      expect(unhandled).toEqual([]);
      expect(runner.inFlight()).toBe(false);
      expect(logs.join("\n")).toContain(
        "injected read failure: goal-change-refused",
      );
      expect(provider.requests).toHaveLength(0);
      failing.on = false;
      expect(runner.dispatch()).toBe(true);
      await runner.idle();
      expect(provider.requests).toHaveLength(1);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("a store fault in the read of its own actions is logged and the turn abandoned: nothing rejects, no model is asked, and the next dispatch works", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const world = newWorld();
      const provider = startProvider();
      // Only the own-actions read fails: the recent-events read still works.
      const failing = { on: true, match: "json_extract" };
      const logs: string[] = [];
      const runner = createGodTurnRunner({
        ...deps(provider, ["zeus"]),
        store: faultyStore(world.store, failing),
        getState: () => world.state,
        lifecycle: world.lifecycle,
        statusRef: world.statusRef,
        onLog: (message) => logs.push(message),
      });
      expect(runner.dispatch()).toBe(true);
      await runner.idle();
      await Bun.sleep(20);
      expect(unhandled).toEqual([]);
      expect(runner.inFlight()).toBe(false);
      expect(logs.join("\n")).toContain("injected read failure: json_extract");
      expect(provider.requests).toHaveLength(0);

      failing.on = false;
      expect(runner.dispatch()).toBe(true);
      await runner.idle();
      expect(provider.requests).toHaveLength(1);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("a god's journey", () => {
  test("once the journey ends the god's next prompt says how: it arrived; the god that never travelled is told nothing", async () => {
    const world = newWorld();
    stage(world, { actor: "zeus", kind: "travel", to: "mountain-path" });
    tick(world);
    expect(world.state.journeys.has(id("zeus"))).toBe(false);
    const provider = startProvider(() => '{"action":"wait"}');
    const runner = runnerFor(world, provider, ["zeus"]);
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(provider.requests.at(-1)?.body ?? "").toContain(
      "Your last journey ended: you arrived.",
    );
    // Control: Hera never set out, and is told of no journey.
    const hera = runnerFor(world, provider, ["hera"]);
    expect(hera.dispatch()).toBe(true);
    await hera.idle();
    expect(provider.requests.at(-1)?.body ?? "").not.toContain(
      "Your last journey",
    );
  });

  test("a travelling god a thread is waiting on is shown its journey: where it is going, and that waiting leaves it running", async () => {
    const world = newWorld();
    demands(world, "zeus", "hera");
    stage(world, { actor: "hera", kind: "travel", to: "tavern" });
    const provider = startProvider(() => '{"action":"wait"}');
    const runner = runnerFor(world, provider, ["hera"]);
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    const body = provider.requests.at(-1)?.body ?? "";
    expect(body).toContain("You are on a journey to The Tavern [tavern]");
    expect(body).toContain("Waiting leaves it running");
    // She waited: nothing was journaled, and the journey runs on.
    expect(pendingModelProposals(world)).toEqual([]);
    tick(world);
    expect(world.state.journeys.has(id("hera"))).toBe(true);
  });

  test("a store fault in the read of the latest journey ending is logged and the turn abandoned: nothing rejects, no model is asked, and the next dispatch works", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const world = newWorld();
      const provider = startProvider();
      const failing = { on: true, match: "journey-ended" };
      const logs: string[] = [];
      const runner = createGodTurnRunner({
        ...deps(provider, ["hera"]),
        store: faultyStore(world.store, failing),
        getState: () => world.state,
        lifecycle: world.lifecycle,
        statusRef: world.statusRef,
        onLog: (message) => logs.push(message),
      });
      expect(runner.dispatch()).toBe(true);
      await runner.idle();
      await Bun.sleep(20);
      expect(unhandled).toEqual([]);
      expect(runner.inFlight()).toBe(false);
      expect(logs.join("\n")).toContain("injected read failure: journey-ended");
      expect(provider.requests).toHaveLength(0);
      failing.on = false;
      expect(runner.dispatch()).toBe(true);
      await runner.idle();
      expect(provider.requests).toHaveLength(1);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("an outage", () => {
  test("idles the gods but never the world: nothing is journaled, routines keep committing, model-degraded is set and then cleared on recovery", async () => {
    const world = newWorld();
    const provider = startProvider(() => 500);
    const runner = runnerFor(world, provider, ["zeus", "hera"]);

    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(world.statusRef.modelDegraded).toBe(true);
    expect(listExternalProposals(world.store.db)).toEqual([]);
    const rows = world.store.db
      .query("SELECT outcome, proposal_id FROM trace_model_requests")
      .all() as { outcome: string; proposal_id: string | null }[];
    expect(rows).toEqual([{ outcome: "exhausted", proposal_id: null }]);

    // The world goes on: routines commit through the outage.
    const before = world.state.lastSequence;
    for (let index = 0; index < 5; index += 1) tick(world);
    expect(world.state.tick).toBe(5);
    expect(world.state.lastSequence).toBeGreaterThan(before);
    expect(world.statusRef.status).toBe("running");

    // Recovery: the next turn succeeds, journals, and clears the status.
    provider.respond = (god) => LEGEND(god);
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(world.statusRef.modelDegraded).toBe(false);
    expect(pendingModelProposals(world)).toHaveLength(1);
  });
});

// --- The director across an outage (M2 Unit 12) ---------------------------------------------------------
//
// The director is a step of the world's tick: it reads committed state and the persisted generator, and nothing
// the gods or their providers do reaches it except through the world they changed. So with the providers down, or
// answering, its fires are the fires of a world with no gods at all. Everything below is real ticks over a real
// store; the provider is the scripted loopback endpoint, and a turn is awaited, not timed.

/** A director event in the journal, reduced to what must match: when, what, to whom, and the attribution it carries. */
interface DirectorFire {
  readonly tick: number;
  readonly kind: string;
  readonly entity: string;
  readonly victim: string | undefined;
  readonly resource: string | undefined;
  readonly amount: number | undefined;
  readonly cause: "director";
}

const directorFires = (world: World): DirectorFire[] =>
  listEvents(world.store.db).flatMap((event): DirectorFire[] => {
    if (
      (event.kind === "theft" || event.kind === "stock-spoiled") &&
      event.cause === "director"
    ) {
      return [
        {
          tick: event.tick,
          kind: event.kind,
          entity: String(event.entityId),
          victim: event.kind === "theft" ? String(event.victim) : undefined,
          resource: event.resource,
          amount: event.amount,
          cause: "director",
        },
      ];
    }
    if (event.kind === "building-ignited" && event.cause.kind === "director") {
      return [
        {
          tick: event.tick,
          kind: event.kind,
          entity: String(event.entityId),
          victim: undefined,
          resource: undefined,
          amount: undefined,
          cause: "director",
        },
      ];
    }
    return [];
  });

/** The journal with each routine proposal's observation id (random per run) blanked in the ids that carry it. */
const withoutObservationIds = (events: readonly WorldEvent[]): WorldEvent[] =>
  events.map((event) => ({
    ...event,
    correlationId: String(event.correlationId).startsWith("obs-")
      ? "obs"
      : event.correlationId,
    causationId: String(event.causationId).startsWith("obs-")
      ? "obs"
      : event.causationId,
  })) as WorldEvent[];

/** Runs `ticks` ticks of `world`, a god's turn after each when `provider` is given (awaited to its end). */
async function runWithGods(
  world: World,
  ticks: number,
  provider?: Provider,
): Promise<void> {
  const runner =
    provider === undefined
      ? undefined
      : runnerFor(world, provider, ["zeus", "hera", "athena", "hermes"]);
  for (let index = 0; index < ticks; index += 1) {
    if (runner !== undefined) {
      runner.dispatch();
      await runner.idle();
    }
    tick(world);
  }
}

describe("the director across an outage", () => {
  const TICKS = 60;
  const INTERVAL = 10;

  test("with every provider failing, the director's fires, their ticks and attribution, its clock, and the persisted generator are those of a world with no gods", async () => {
    const bare = newWorld("great-hall", INTERVAL);
    await runWithGods(bare, TICKS);

    const down = newWorld("great-hall", INTERVAL);
    const provider = startProvider(() => 500);
    await runWithGods(down, TICKS, provider);
    // The gods did try, and every turn failed: no proposal reached the world.
    expect(provider.requests.length).toBeGreaterThan(0);
    expect(listExternalProposals(down.store.db)).toEqual([]);

    const fires = directorFires(bare);
    expect(fires.length).toBe(TICKS / INTERVAL);
    expect(fires.map((fire) => fire.tick)).toEqual([10, 20, 30, 40, 50, 60]);
    expect(directorFires(down)).toEqual(fires);
    expect(down.state.director).toEqual(bare.state.director);
    expect(down.state.director.lastFireTick).toBe(60);
    // The generator is the same: neither the outage nor the turns that failed drew from it.
    expect(down.prng).toEqual(bare.prng);
    // And nothing else differed either: the two journals are one journal, but for the random observation ids a
    // routine's proposal is stamped with.
    expect(withoutObservationIds(listEvents(down.store.db))).toEqual(
      withoutObservationIds(listEvents(bare.store.db)),
    );
  });

  test("with the providers answering, the director's fires and the persisted generator are the same: the gods act on the world, they do not draw from its generator", async () => {
    const bare = newWorld("great-hall", INTERVAL);
    await runWithGods(bare, TICKS);

    // Legends change what mortals believe, never what they hold or whose place has something open, so the world the
    // director reads is the bare world's; the fires must then be the bare world's too.
    const answering = newWorld("great-hall", INTERVAL);
    const provider = startProvider((god) => LEGEND(god));
    await runWithGods(answering, TICKS, provider);
    const committed = listEvents(answering.store.db).filter(
      (event) => event.kind === "legend-recorded",
    );
    expect(committed.length).toBeGreaterThan(0);

    expect(directorFires(answering)).toEqual(directorFires(bare));
    expect(answering.state.director).toEqual(bare.state.director);
    expect(answering.prng).toEqual(bare.prng);
  });

  test("the director's own decision ignores provider status, given the same state: a world marked model-degraded and one not plan the same step from the same generator", async () => {
    const world = newWorld("great-hall", INTERVAL);
    for (let index = 0; index < 9; index += 1) tick(world);
    // Tick 10 is the director's: plan it twice from this very state and generator, with the service's status flipped between.
    const before = { ...world.state, tick: world.state.tick + 1 };
    world.statusRef.modelDegraded = false;
    const healthy = planDirectorStep(before, world.prng);
    world.statusRef.modelDegraded = true;
    const degraded = planDirectorStep(before, world.prng);
    expect(degraded).toEqual(healthy);
    expect(healthy.events).toHaveLength(1);
  });
});

// --- The service ----------------------------------------------------------------------------------------
//
// In-process on a fast tick timer; only the stdin protocol is spawned.

const INDEX_ENTRY = join(import.meta.dir, "index.ts");
const TOKEN = "agents-service-token";

interface Spawned {
  readonly proc: ReturnType<typeof Bun.spawn>;
  readonly port: number;
  output(): string;
}

const spawned: Spawned[] = [];
const appDirs: string[] = [];

afterEach(() => {
  stopAllTestServices();
  for (const service of spawned.splice(0)) service.proc.kill();
  for (const dir of appDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The launch config line the shell sends: the settings' models, the offline switch, and the keys. */
function launchLineFor(provider: Provider, override?: unknown): string {
  return JSON.stringify(
    override ?? {
      models: {
        endpoints: [
          { id: "local", baseUrl: provider.baseUrl, model: "scripted" },
        ],
        // Every god in the pack needs a route of its own: one with no role has none.
        roles: Object.fromEntries(
          [
            "athena",
            "hades",
            "hephaestus",
            "hera",
            "hermes",
            "poseidon",
            "zeus",
          ].map((god) => [god, { endpoint: "local" }]),
        ),
      },
      offline: false,
      keys: {},
    },
  );
}

const freshAppDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "panthea-sim-agents-svc-"));
  appDirs.push(dir);
  return dir;
};

/** The service in this process on the fast tick timer. */
function startInProcess(
  provider: Provider,
  launch?: unknown,
  appDataDir = freshAppDir(),
): TestService {
  return startTestService({
    appDataDir,
    launch: parseLaunchConfig(launchLineFor(provider, launch)),
  });
}

/** The service as a separate process, for stdin tests. */
async function spawnService(
  provider: Provider,
  launch?: unknown,
): Promise<Spawned> {
  const appDataDir = freshAppDir();
  const proc = Bun.spawn(["bun", "run", INDEX_ENTRY], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      PANTHEA_APP_DATA_DIR: appDataDir,
      [TICK_TIMER_ENV]: String(FAST_TICK_MS),
    },
  });
  const writer = proc.stdin;
  if (typeof writer === "number" || !writer) throw new Error("stdin");
  writer.write(`${TOKEN}\n${launchLineFor(provider, launch)}\n`);
  await writer.flush();

  let buffer = "";
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("no PANTHEA_PORT")),
      10_000,
    );
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return reject(new Error("service exited early"));
          buffer += decoder.decode(value, { stream: true });
          const match = /PANTHEA_PORT=(\d+)/.exec(buffer);
          if (match?.[1]) {
            clearTimeout(timer);
            resolve(Number.parseInt(match[1], 10));
            break;
          }
        }
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
        }
      } catch {
        // Killed; nothing more to read.
      }
    })();
  });
  const service = { proc, port, output: () => buffer };
  spawned.push(service);
  return service;
}

async function frameOf(service: TestService) {
  const body = await (await service.call("/frame")).json();
  const parsed = parseSyncFrame(body);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

describe("the service's launch config", () => {
  const SENTINEL = "sk-sentinel-DO-NOT-LEAK-0123456789";

  test("a config line with no models: no god takes a turn, and the world runs", async () => {
    const provider = startProvider();
    const service = startInProcess(provider, {
      models: null,
      offline: false,
      keys: {},
    });
    // With routing a god is asked on the first tick; none is asked in five.
    await service.waitCycles("ticked", 5);
    expect(tickOf(service.appDataDir)).toBeGreaterThanOrEqual(5);
    expect(provider.requests).toHaveLength(0);
    const frame = await frameOf(service);
    expect(frame.status).toBe("running");
    expect(frame.degradedReason).toBeUndefined();
  });

  test("an invalid config line starts the world with god turns off under model-degraded, logs the parse error, and never logs a key", async () => {
    const provider = startProvider();
    const service = startInProcess(provider, {
      models: { endpoints: 3 },
      offline: false,
      keys: { "zeus-key": SENTINEL },
    });
    const frame = await until("model-degraded", async () => {
      const current = await frameOf(service);
      return current.degradedReason === "model-degraded" ? current : undefined;
    });
    expect(frame.status).toBe("degraded");
    // The world runs regardless: it keeps ticking.
    const t0 = tickOf(service.appDataDir);
    await service.waitCycles("ticked", 3);
    expect(tickOf(service.appDataDir)).toBeGreaterThan(t0);
    expect(provider.requests).toHaveLength(0);
    expect(service.output()).toMatch(
      /model settings are not valid: .*endpoints/,
    );
    expect(service.output()).toContain("god turns are off");
    expect(service.output()).not.toContain(SENTINEL);
  });

  test("a config line that is not JSON also degrades instead of failing startup, and does not echo the line", async () => {
    const provider = startProvider();
    const appDataDir = freshAppDir();
    const proc = Bun.spawn(["bun", "run", INDEX_ENTRY], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        PANTHEA_APP_DATA_DIR: appDataDir,
        [TICK_TIMER_ENV]: String(FAST_TICK_MS),
      },
    });
    const writer = proc.stdin;
    if (typeof writer === "number" || !writer) throw new Error("stdin");
    writer.write(`${TOKEN}\nthis is not json ${SENTINEL}\n`);
    await writer.flush();
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    try {
      await until("the service to print its port", async () => {
        const { value, done } = await reader.read();
        if (done) throw new Error(`service exited early:\n${output}`);
        output += decoder.decode(value, { stream: true });
        return /PANTHEA_PORT=\d+/.test(output) ? true : undefined;
      });
      expect(output).toContain("launch config is not valid JSON");
      expect(output).not.toContain(SENTINEL);
    } finally {
      proc.kill();
    }
    expect(provider.requests).toHaveLength(0);
  });

  test("stdin EOF after both lines still shuts the service down gracefully", async () => {
    const provider = startProvider();
    const service = await spawnService(provider);
    const stdin = service.proc.stdin;
    if (typeof stdin === "number" || !stdin) throw new Error("stdin");
    await stdin.end();
    expect(await service.proc.exited).toBe(0);
    expect(service.output()).toContain("shutting down (stdin-eof)");
  });
});

describe("the service with model routing configured", () => {
  test("the tick asks for a turn and never waits for it: a held answer does not stop the world, and when it comes the proposal commits on a later tick", async () => {
    const appDataDir = freshAppDir();
    const release = held();
    let tickWhenAsked: number | undefined;
    const provider = startProvider(async (god) => {
      tickWhenAsked ??= tickOf(appDataDir);
      await release.gate;
      return LEGEND(god);
    });
    const service = startInProcess(provider, undefined, appDataDir);

    await until("a model request", () =>
      provider.requests.length > 0 ? true : undefined,
    );
    // `index.ts` calls `dispatch()` after a live tick, so the world had ticked.
    expect(tickWhenAsked).toBeGreaterThanOrEqual(1);
    const start = (await frameOf(service)).sequence;
    const t0 = tickOf(appDataDir);
    // The answer is still held, and the world ticks through it.
    await service.waitCycles("ticked", 5);
    expect(tickOf(appDataDir) - t0).toBeGreaterThanOrEqual(5);
    expect(provider.requests).toHaveLength(1);
    expect((await frameOf(service)).sequence).toBeGreaterThan(start);

    release.release();
    const consumed = await until("the god's proposal to run", () =>
      journalOf(appDataDir).find(
        (entry) => entry.outcome?.status === "committed",
      ),
    );
    expect(consumed.proposal).toMatchObject({
      source: "model",
      kind: "legend",
    });
    expect(
      readStore(appDataDir, (db) =>
        listEvents(db).some((event) => event.kind === "legend-recorded"),
      ),
    ).toBe(true);
  });

  /** A store `behindMs` behind the wall clock, in a world with catch-up cap `capMs`. */
  function storeBehind(capMs: number, behindMs: number): string {
    const appDataDir = freshAppDir();
    const loaded = loadGreekWorldState();
    const seeded = {
      ...loaded,
      rules: { ...loaded.rules, catchUpCapMs: capMs },
    };
    const reducers = createWorldProjectionReducers(seeded);
    mkdirSync(join(appDataDir, "active"), { recursive: true });
    const store = openStore(
      join(appDataDir, "active", "world.sqlite"),
      reducers,
    );
    store.db.run("UPDATE clock SET cursor_wall_ms = ? WHERE id = 1", [
      Date.now() - behindMs,
    ]);
    closeStore(store);
    return appDataDir;
  }

  test("takes no turn until startup catch-up has finished: every provider request arrives after the catch-up's own finish line", async () => {
    // The gate, not the cap size, is the property: 10 minutes keeps it fast.
    const capMs = 10 * 60 * 1000;
    const appDataDir = storeBehind(capMs, 6 * capMs);
    const provider = startProvider();
    const service = startInProcess(provider, undefined, appDataDir);

    await until("the first model request", () =>
      provider.requests.length > 0 ? true : undefined,
    );
    const lines = service.lines();
    const starts = lines.filter((l) => l.text.endsWith("catch-up started"));
    const ends = lines.filter((l) => l.text.endsWith("catch-up finished"));
    expect(starts.length).toBeGreaterThanOrEqual(1);
    expect(ends.length).toBeGreaterThanOrEqual(1);
    expect(service.output()).toContain("startup catch-up complete");
    // The backlog was real: the cap was applied and the timer fired through it.
    expect(
      readStore(appDataDir, (db) => readCatchUpSummary(db))?.appliedMs,
    ).toBe(capMs);
    expect(service.cycles()["catch-up-running"]).toBeGreaterThan(0);
    const finished = ends[0]?.at ?? Number.POSITIVE_INFINITY;
    const early = provider.requests.filter((request) => request.at < finished);
    expect(early).toEqual([]);
  });
});

describe("a god's refused practice moves", () => {
  /** `speaker` tells the other god that `agent` wronged `target`. */
  const accuse = (speaker: string, agent: string, target: string) =>
    JSON.stringify({
      action: "report",
      listener: speaker === "zeus" ? "hera" : "zeus",
      content: `${agent} did wrong by ${target}`,
      claim: { effect: "harm", agent, target },
    });
  const termFor = (party: string, ticks = 100) => ({
    kind: "tell-legend",
    party,
    place: "town-square",
    deadlineTicks: ticks,
  });
  const demandOver = (cause: string, party: string, ticks = 100) =>
    JSON.stringify({
      action: "practice",
      move: "demand",
      cause,
      term: termFor(party, ticks),
    });
  const reportBy = (world: World, god: string) => {
    const found = listEvents(world.store.db).find(
      (e) => e.kind === "report-told" && e.entityId === id(god),
    );
    if (!found) throw new Error(`no report by ${god}`);
    return found.id;
  };

  /** Zeus and Hera in the hall each accuse the other; Zeus demands of Hera over her accusation, and she refuses. */
  async function loop() {
    const world = newWorld("great-hall");
    await actOut(world, startProvider(), [accuse("zeus", "hera", "zeus")]);
    await actOut(
      world,
      startProvider(),
      [accuse("hera", "zeus", "hera")],
      "hera",
    );
    const heraWords = reportBy(world, "zeus");
    const zeusWords = reportBy(world, "hera");
    const demand = demandOver(String(zeusWords), "hera");
    await actOut(world, startProvider(), [demand]);
    const [thread] = [...world.state.threads.values()];
    if (!thread) throw new Error("no thread opened");
    await actOut(
      world,
      startProvider(),
      [
        JSON.stringify({
          action: "practice",
          move: "refuse",
          thread: thread.id,
        }),
      ],
      "hera",
    );
    expect(world.state.threads.get(thread.id)?.status).toBe("refused");
    return { world, demand, thread, heraWords, zeusWords };
  }

  test("the world's refusal of a repeated demand is read back for the god that made it, and shown in its next prompt; the god that was not refused reads none", async () => {
    const { world, demand } = await loop();
    const last = () => world.state.lastSequence;
    expect(
      readLatestPracticeRefusal(world.store.db, id("zeus"), last()),
    ).toBeUndefined();
    await actOut(world, startProvider(), [demand]);
    const refusal = readLatestPracticeRefusal(
      world.store.db,
      id("zeus"),
      last(),
    );
    expect(refusal).toMatchObject({
      entityId: "zeus",
      attempted: "demand",
      reason: "no-progress",
    });
    expect(refusal?.why).toContain("already answered");
    expect(
      readLatestPracticeRefusal(world.store.db, id("hera"), last()),
    ).toBeUndefined();
    // Bounded in sequence: before it happened, there was none.
    expect(
      readLatestPracticeRefusal(world.store.db, id("zeus"), 0),
    ).toBeUndefined();

    // Zeus's next turn is told, in its prompt, that it was refused and why.
    const next = startProvider(() => '{"action":"wait"}');
    const runner = runnerFor(world, next, ["zeus"]);
    expect(runner.dispatch()).toBe(true);
    await runner.idle();
    expect(next.requests).toHaveLength(1);
    expect(next.requests[0]?.body).toContain("Your last demand was refused");
    expect(next.requests[0]?.body).toContain("already answered");
  });

  test("a refusal stops being shown once the god makes a practice move that commits: only what is newest and unanswered is told", async () => {
    const { world, demand, heraWords } = await loop();
    await actOut(world, startProvider(), [demand]);
    const last = () => world.state.lastSequence;
    expect(
      readLatestPracticeRefusal(world.store.db, id("zeus"), last()),
    ).toBeDefined();
    // Hera demands of Zeus over what he said, and he answers it: a move of his own that commits.
    await actOut(
      world,
      startProvider(),
      [demandOver(String(heraWords), "zeus")],
      "hera",
    );
    const [, second] = [...world.state.threads.values()];
    if (!second) throw new Error("no second thread");
    await actOut(world, startProvider(), [
      JSON.stringify({ action: "practice", move: "refuse", thread: second.id }),
    ]);
    expect(world.state.threads.get(second.id)?.status).toBe("refused");
    expect(
      readLatestPracticeRefusal(world.store.db, id("zeus"), last()),
    ).toBeUndefined();
  });
});

// --- The cap on the whole prompt ---------------------------------------------------------------

describe("the prompt cap", () => {
  const CAP_COLUMNS =
    "SELECT outcome, exhausted_reason, estimated_tokens, token_ratio, shed_events, shed_actions, shed_memories, shed_prayers FROM trace_model_requests";

  /** Zeus's persona is part of the protected floor: a lore line this long leaves nothing the cap may shed to fit. */
  function heavyRunner(world: World, provider: Provider): GodTurnRunner {
    const base = deps(provider, ["zeus"]);
    return createGodTurnRunner({
      ...base,
      profiles: new Map(
        [...base.profiles].map(([god, profile]) => [
          god,
          {
            ...profile,
            lore: [
              ...profile.lore,
              { id: "heavy", statement: "x".repeat(9_000), cites: [] },
            ],
          },
        ]),
      ),
      store: world.store,
      getState: () => world.state,
      lifecycle: world.lifecycle,
      statusRef: world.statusRef,
    });
  }

  test("an under-cap turn's trace row carries the estimate, the ratio and zero sheds", async () => {
    const world = newWorld();
    const provider = startProvider(() => '{"action":"wait"}');
    const runner = runnerFor(world, provider, ["zeus"]);
    expect(runner.dispatch()).toBe(true);
    await runner.idle();

    const [row] = world.store.db.query(CAP_COLUMNS).all() as Record<
      string,
      unknown
    >[];
    expect(row).toMatchObject({
      outcome: "intent",
      exhausted_reason: null,
      token_ratio: 2.75,
      shed_events: 0,
      shed_actions: 0,
      shed_memories: 0,
      shed_prayers: 0,
    });
    expect(row?.estimated_tokens).toBeGreaterThan(0);
    expect(row?.estimated_tokens).toBeLessThanOrEqual(3_000);
  });

  test("a turn over the cap at the protected floor sends nothing, is recorded exhausted for prompt-over-cap, and leaves the model status and every endpoint as they were", async () => {
    const world = newWorld();
    world.statusRef.modelEndpoints = [{ endpoint: "local", state: "ok" }];
    const provider = startProvider(() => '{"action":"wait"}');
    const runner = heavyRunner(world, provider);
    expect(runner.dispatch()).toBe(true);
    await runner.idle();

    expect(provider.requests).toEqual([]);
    expect(listExternalProposals(world.store.db)).toEqual([]);
    const rows = world.store.db.query(CAP_COLUMNS).all() as Record<
      string,
      unknown
    >[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: "exhausted",
      exhausted_reason: "prompt-over-cap",
      token_ratio: 2.75,
    });
    expect(rows[0]?.estimated_tokens).toBeGreaterThan(3_000);
    // No provider failed: the model is not degraded and no endpoint changed.
    expect(world.statusRef.modelDegraded).toBeUndefined();
    expect(world.statusRef.modelEndpoints).toEqual([
      { endpoint: "local", state: "ok" },
    ]);

    // The store reopens with the new columns.
    restart(world);
    expect(world.store.db.query(CAP_COLUMNS).all()).toHaveLength(1);
  });

  test("an ordinary exhausted chain still marks the model degraded", async () => {
    const world = newWorld();
    const provider = startProvider(() => 500);
    const runner = runnerFor(world, provider, ["zeus"]);
    expect(runner.dispatch()).toBe(true);
    await runner.idle();

    expect(world.statusRef.modelDegraded).toBe(true);
    expect(world.store.db.query(CAP_COLUMNS).all()).toMatchObject([
      { outcome: "exhausted", exhausted_reason: null },
    ]);
  });
});
