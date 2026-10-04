// The durable journal behind POST /proposals, exercised against a real store
// that is closed and reopened through a freshly built composition root.

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createObservationId } from "@panthea/contracts";
import {
  closeStore,
  computeContentHash,
  exportArchive,
  getExternalProposal,
  listEvents,
  listExternalProposals,
  openStore,
  readClock,
  readLiveProjections,
  readPrngState,
  type Store,
} from "@panthea/persistence";
import {
  ensureTraceSchema,
  getProposalOutcomeByProposalId,
  type ProposalId,
} from "@panthea/telemetry";
import { createPrng, type PrngState, type WorldState } from "@panthea/world";
import {
  applyLiveTick,
  createServiceStatusRef,
  createSimulationServer,
  type SimulationServerHandle,
} from "./server";
import { buildRoutineQueue, type TickDeps } from "./tick";
import {
  createWorldProjectionReducers,
  deserializePrngState,
  loadGreekWorldState,
  restoreWorldTime,
  worldImportReducers,
} from "./world-store";
import { importWorldArchive } from "./worlds";

let dir: string;
const TOKEN = "journal-test-token";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "panthea-sim-journal-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A world opened the way a restarted service opens it: nothing carried over from an earlier open. */
interface World {
  readonly store: Store;
  readonly deps: TickDeps;
  state: WorldState;
  prng: PrngState;
  server?: SimulationServerHandle;
  url?: string;
}

function openWorld(
  storePath: string,
  options: { readonly maxProposalsPerTick?: number } = {},
): World {
  const authored = loadGreekWorldState();
  const reducers = createWorldProjectionReducers(authored);
  const store = openStore(storePath, reducers);
  ensureTraceSchema(store.db);
  const restored = restoreWorldTime(
    readLiveProjections(store, reducers),
    readClock(store.db),
  );
  const state =
    options.maxProposalsPerTick === undefined
      ? restored
      : {
          ...restored,
          rules: {
            ...restored.rules,
            maxProposalsPerTick: options.maxProposalsPerTick,
          },
        };
  return {
    store,
    deps: { store, reducers, traceDb: store.db },
    state,
    prng: deserializePrngState(readPrngState(store.db)) ?? createPrng(1),
  };
}

function startServer(world: World): void {
  const handle = createSimulationServer({
    token: TOKEN,
    store: world.store,
    reducers: world.deps.reducers,
    traceDb: world.store.db,
    slotsDir: join(dir, "slots"),
    statusRef: createServiceStatusRef(world.state),
    port: 0,
  });
  world.server = handle;
  world.url = `http://127.0.0.1:${handle.port}`;
}

function shutDown(world: World): void {
  world.server?.stop(true);
  closeStore(world.store);
}

/** One live tick, the way the service runs it: routines decided from the committed state, the journal read by the tick itself. */
function tick(
  world: World,
  deps: TickDeps = world.deps,
): "committed" | "failed" {
  const step = applyLiveTick(
    buildRoutineQueue(world.state),
    world.state,
    world.prng,
    deps,
    {
      cursorWallMs: readClock(world.store.db).cursorWallMs + 1000,
      paused: false,
    },
  );
  if (step.kind !== "committed") return "failed";
  world.state = step.state;
  world.prng = step.prng;
  return "committed";
}

let counter = 0;
function nextProposalId(): string {
  counter += 1;
  return `proposal-journal-${counter}`;
}

function envelope(
  actor: string,
  raw: Record<string, unknown>,
  proposalId: string = nextProposalId(),
) {
  const observationId = createObservationId();
  return {
    proposalId,
    observation: {
      schemaVersion: 1,
      id: observationId,
      observer: actor,
      stateRevision: 0,
      factsRead: [],
      source: "fixture",
    },
    proposal: {
      schemaVersion: 1,
      actor,
      targets: [],
      expectedRevisions: [],
      source: "fixture",
      observationId,
      ...raw,
    },
  };
}

const strike = (proposalId?: string) =>
  envelope(
    "zeus",
    { kind: "strike", target: "the-tavern", power: 3 },
    proposalId,
  );

async function post(world: World, body: unknown): Promise<Response> {
  return fetch(`${world.url}/proposals`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
}

const outcomeOf = (world: World, proposalId: string) =>
  getProposalOutcomeByProposalId(world.store.db, proposalId as ProposalId);

const eventsCausedBy = (world: World, observationId: string) =>
  listEvents(world.store.db).filter(
    (event) => String(event.correlationId) === observationId,
  );

describe("accepting a proposal", () => {
  test("answers 202 with the proposal id only after the entry is journaled", async () => {
    const world = openWorld(join(dir, "world.sqlite"));
    startServer(world);
    try {
      const body = strike();
      const response = await post(world, body);

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({
        ok: true,
        queued: true,
        proposalId: body.proposalId,
        status: "pending",
      });
      expect(
        getExternalProposal(world.store.db, body.proposalId),
      ).toMatchObject({
        inputOrder: 1,
        targetTick: 1,
        consumedTick: undefined,
      });
    } finally {
      shutDown(world);
    }
  });

  test("a proposal without a proposalId is refused at intake and journals nothing", async () => {
    const world = openWorld(join(dir, "world.sqlite"));
    startServer(world);
    try {
      const { proposalId: _omitted, ...withoutId } = strike();
      const response = await post(world, withoutId);

      expect(response.status).toBe(400);
      expect(listExternalProposals(world.store.db)).toEqual([]);
    } finally {
      shutDown(world);
    }
  });

  test("a store failure at intake is an error, never a queued success", async () => {
    const world = openWorld(join(dir, "world.sqlite"));
    startServer(world);
    try {
      world.store.db.exec("DROP TABLE external_proposals");
      const response = await post(world, strike());

      expect(response.status).toBe(500);
      expect(((await response.json()) as { ok: boolean }).ok).toBe(false);
    } finally {
      shutDown(world);
    }
  });

  test("an id already used by a routine's proposal is refused, so its outcome can never be dropped", async () => {
    const world = openWorld(join(dir, "world.sqlite"));
    startServer(world);
    try {
      expect(tick(world)).toBe("committed");
      const routineId = world.store.db
        .query("SELECT proposal_id FROM trace_proposal_outcomes LIMIT 1")
        .get() as { proposal_id: string };

      const response = await post(world, strike(routineId.proposal_id));

      expect(response.status).toBe(409);
      expect(listExternalProposals(world.store.db)).toEqual([]);
    } finally {
      shutDown(world);
    }
  });
});

describe("a journaled proposal across a restart", () => {
  test("accept, close, reopen: it runs exactly once and its outcome resolves by the returned proposal id", async () => {
    const storePath = join(dir, "world.sqlite");
    const first = openWorld(storePath);
    startServer(first);
    const body = strike();
    expect((await post(first, body)).status).toBe(202);
    shutDown(first);

    const second = openWorld(storePath);
    startServer(second);
    try {
      expect(tick(second)).toBe("committed");
      expect(outcomeOf(second, body.proposalId)).toMatchObject({
        outcome: "committed",
      });
      expect(
        eventsCausedBy(second, body.observation.id).map((e) => e.kind),
      ).toEqual(["resource-consumed", "building-ignited"]);
      expect(
        getExternalProposal(second.store.db, body.proposalId)?.consumedTick,
      ).toBe(1);

      const trace = await fetch(
        `${second.url}/trace/proposal?id=${body.proposalId}`,
        { headers: { Authorization: `Bearer ${TOKEN}` } },
      );
      const traced = (await trace.json()) as {
        result: { found: boolean; steps: { step: string }[] };
      };
      expect(traced.result.found).toBe(true);
      expect(traced.result.steps.map((s) => s.step)).toContain("validation");
    } finally {
      shutDown(second);
    }
  });

  test("after a committed consumption, a further restart does not apply the proposal again", async () => {
    const storePath = join(dir, "world.sqlite");
    const first = openWorld(storePath);
    startServer(first);
    const body = strike();
    await post(first, body);
    tick(first);
    shutDown(first);

    const second = openWorld(storePath);
    tick(second);
    tick(second);
    try {
      expect(eventsCausedBy(second, body.observation.id)).toHaveLength(2);
      expect(
        getExternalProposal(second.store.db, body.proposalId)?.consumedTick,
      ).toBe(1);
    } finally {
      shutDown(second);
    }
  });

  test("several inputs, a reopen, then more inputs: order and target ticks are preserved and they run in that order", async () => {
    const storePath = join(dir, "world.sqlite");
    const first = openWorld(storePath);
    startServer(first);
    const a = envelope("zeus", {
      kind: "strike",
      target: "the-tavern",
      power: 3,
    });
    const b = envelope("farmer", {
      kind: "worship",
      deity: "zeus",
      offering: { resource: "currency", amount: 1 },
    });
    await post(first, a);
    await post(first, b);
    tick(first);
    const c = envelope("woodcutter", {
      kind: "worship",
      deity: "zeus",
      offering: { resource: "currency", amount: 1 },
    });
    await post(first, c);
    shutDown(first);

    const second = openWorld(storePath);
    startServer(second);
    const d = envelope("zeus", { kind: "strike", target: "old-oak", power: 1 });
    await post(second, d);
    try {
      expect(
        listExternalProposals(second.store.db).map((entry) => [
          entry.proposalId,
          entry.inputOrder,
          entry.targetTick,
        ]),
      ).toEqual([
        [a.proposalId, 1, 1],
        [b.proposalId, 2, 1],
        [c.proposalId, 3, 2],
        [d.proposalId, 4, 2],
      ]);

      tick(second);

      const sequenceOf = (observationId: string) =>
        eventsCausedBy(second, observationId)[0]?.sequence ?? Number.NaN;
      expect(sequenceOf(c.observation.id)).toBeLessThan(
        sequenceOf(d.observation.id),
      );
    } finally {
      shutDown(second);
    }
  });
});

describe("a tick that fails to commit", () => {
  test("leaves the entry pending with no outcome and no effects; the next tick runs it once", async () => {
    const storePath = join(dir, "world.sqlite");
    const world = openWorld(storePath);
    startServer(world);
    const body = strike();
    await post(world, body);
    try {
      const failing: TickDeps = {
        ...world.deps,
        commitTick: () => {
          throw new Error("disk I/O error: SQLITE_FULL");
        },
      };
      expect(tick(world, failing)).toBe("failed");

      const pending = getExternalProposal(world.store.db, body.proposalId);
      expect(pending?.consumedTick).toBeUndefined();
      expect(pending?.outcome).toBeUndefined();
      expect(outcomeOf(world, body.proposalId)).toBeUndefined();
      expect(listEvents(world.store.db)).toEqual([]);

      expect(tick(world)).toBe("committed");
      expect(outcomeOf(world, body.proposalId)?.outcome).toBe("committed");
      expect(eventsCausedBy(world, body.observation.id)).toHaveLength(2);
    } finally {
      shutDown(world);
    }
  });
});

/** A copy of `body` citing observation `observationId`, whose evidence is `factsRead`. */
function citingObservation(
  body: ReturnType<typeof envelope>,
  observationId: string,
  factsRead: readonly string[],
  proposalId: string = nextProposalId(),
) {
  return {
    proposalId,
    observation: { ...body.observation, id: observationId, factsRead },
    proposal: { ...body.proposal, observationId },
  };
}

describe("an observation id binds to one content", () => {
  const strikeBy = (actor: string, target: string) =>
    envelope(actor, { kind: "strike", target, power: 1 });

  test("two pending proposals may cite one unchanged observation, and both run", async () => {
    const world = openWorld(join(dir, "world.sqlite"));
    startServer(world);
    try {
      const first = strikeBy("zeus", "old-oak");
      const again = citingObservation(
        strikeBy("zeus", "old-oak"),
        first.observation.id,
        [...first.observation.factsRead],
      );

      expect((await post(world, first)).status).toBe(202);
      expect((await post(world, again)).status).toBe(202);
      expect(listExternalProposals(world.store.db)).toHaveLength(2);
    } finally {
      shutDown(world);
    }
  });

  test("a second pending proposal reusing an observation id with different content is a 409 that names the conflict, and nothing is journaled for it", async () => {
    const world = openWorld(join(dir, "world.sqlite"));
    startServer(world);
    try {
      const first = strikeBy("zeus", "old-oak");
      await post(world, first);
      const conflicting = citingObservation(
        strikeBy("zeus", "old-oak"),
        first.observation.id,
        ["a different fact"],
      );

      const response = await post(world, conflicting);

      expect(response.status).toBe(409);
      expect(((await response.json()) as { error: string }).error).toContain(
        first.observation.id,
      );
      expect(
        getExternalProposal(world.store.db, conflicting.proposalId),
      ).toBeUndefined();
      expect(listExternalProposals(world.store.db)).toHaveLength(1);
    } finally {
      shutDown(world);
    }
  });

  test("an observation id already recorded in the trace, with different content, is a 409; exact reuse is accepted", async () => {
    const world = openWorld(join(dir, "world.sqlite"));
    startServer(world);
    try {
      const first = strikeBy("zeus", "old-oak");
      await post(world, first);
      tick(world);
      expect(outcomeOf(world, first.proposalId)?.outcome).toBe("committed");

      const conflicting = citingObservation(
        strikeBy("zeus", "old-oak"),
        first.observation.id,
        ["invented after the fact"],
      );
      const reuse = citingObservation(
        strikeBy("zeus", "old-oak"),
        first.observation.id,
        [...first.observation.factsRead],
      );

      expect((await post(world, conflicting)).status).toBe(409);
      expect(
        getExternalProposal(world.store.db, conflicting.proposalId),
      ).toBeUndefined();
      expect((await post(world, reuse)).status).toBe(202);
    } finally {
      shutDown(world);
    }
  });

  test("after a restart, both the recorded and the still-pending observation ids stay bound", async () => {
    const storePath = join(dir, "world.sqlite");
    const first = openWorld(storePath);
    startServer(first);
    const recorded = strikeBy("zeus", "old-oak");
    await post(first, recorded);
    tick(first);
    const pending = strikeBy("farmer", "old-oak");
    await post(first, pending);
    shutDown(first);

    const second = openWorld(storePath);
    startServer(second);
    try {
      const againstRecorded = citingObservation(
        strikeBy("zeus", "old-oak"),
        recorded.observation.id,
        ["changed"],
      );
      const againstPending = citingObservation(
        strikeBy("farmer", "old-oak"),
        pending.observation.id,
        ["changed"],
      );

      expect((await post(second, againstRecorded)).status).toBe(409);
      expect((await post(second, againstPending)).status).toBe(409);
      expect(listExternalProposals(second.store.db)).toHaveLength(2);
    } finally {
      shutDown(second);
    }
  });

  test("a proposal journaled before its observation id became bound elsewhere is refused at execution with a durable observation-conflict outcome, and the tick is not repeated", async () => {
    const world = openWorld(join(dir, "world.sqlite"));
    startServer(world);
    try {
      const victim = strikeBy("zeus", "old-oak");
      await post(world, victim);
      // Something else binds the id to different content before the tick.
      world.store.db.run(
        `INSERT INTO trace_observations (id, observer, state_revision, source, recorded_at, payload)
         VALUES (?, 'someone', 0, 'fixture', 0, ?)`,
        [
          victim.observation.id,
          JSON.stringify({ ...victim.observation, factsRead: ["elsewhere"] }),
        ],
      );

      expect(tick(world)).toBe("committed");

      expect(outcomeOf(world, victim.proposalId)).toMatchObject({
        outcome: "rejected",
        reason: "observation-conflict",
      });
      expect(
        getExternalProposal(world.store.db, victim.proposalId),
      ).toMatchObject({
        consumedTick: 1,
        outcome: { status: "rejected", reason: "observation-conflict" },
      });
      const retry = await post(world, victim);
      expect(await retry.json()).toMatchObject({
        status: "rejected",
        reason: "observation-conflict",
      });
      expect(tick(world)).toBe("committed");
    } finally {
      shutDown(world);
    }
  });
});

describe("sources that enter in-process only", () => {
  const strikeBody = () =>
    envelope("zeus", { kind: "strike", target: "old-oak", power: 1 });

  test.each([["model"], ["director"]])(
    "a proposal claiming the %s source is refused at /proposals and journals nothing",
    async (source) => {
      const world = openWorld(join(dir, "world.sqlite"));
      startServer(world);
      try {
        const body = strikeBody();
        const claiming = {
          ...body,
          observation: { ...body.observation, source },
          proposal: { ...body.proposal, source },
        };

        const response = await post(world, claiming);

        expect(response.status).toBe(400);
        expect(((await response.json()) as { error: string }).error).toContain(
          source,
        );
        expect(listExternalProposals(world.store.db)).toEqual([]);
      } finally {
        shutDown(world);
      }
    },
  );

  test.each([["model"], ["director"]])(
    "a proposal claiming the %s source is refused when its observation says fixture",
    async (source) => {
      const world = openWorld(join(dir, "world.sqlite"));
      startServer(world);
      try {
        const body = strikeBody();

        const response = await post(world, {
          ...body,
          proposal: { ...body.proposal, source },
        });

        expect(response.status).toBe(400);
        expect(((await response.json()) as { error: string }).error).toContain(
          source,
        );
        expect(listExternalProposals(world.store.db)).toEqual([]);
      } finally {
        shutDown(world);
      }
    },
  );

  test.each([["model"], ["director"]])(
    "an observation claiming the %s source is refused even when its proposal says fixture",
    async (source) => {
      const world = openWorld(join(dir, "world.sqlite"));
      startServer(world);
      try {
        const body = strikeBody();

        const response = await post(world, {
          ...body,
          observation: { ...body.observation, source },
        });

        expect(response.status).toBe(400);
        expect(listExternalProposals(world.store.db)).toEqual([]);
      } finally {
        shutDown(world);
      }
    },
  );

  test("a fixture proposal is still accepted", async () => {
    const world = openWorld(join(dir, "world.sqlite"));
    startServer(world);
    try {
      expect((await post(world, strikeBody())).status).toBe(202);
    } finally {
      shutDown(world);
    }
  });
});

describe("retrying a proposal", () => {
  test("the same id with the same content journals nothing new and reports its status, pending and then committed", async () => {
    const world = openWorld(join(dir, "world.sqlite"));
    startServer(world);
    try {
      const body = strike();
      await post(world, body);

      const whilePending = await post(world, {
        proposal: body.proposal,
        observation: body.observation,
        proposalId: body.proposalId,
      });
      expect(whilePending.status).toBe(202);
      expect(await whilePending.json()).toMatchObject({
        proposalId: body.proposalId,
        status: "pending",
      });
      expect(listExternalProposals(world.store.db)).toHaveLength(1);

      tick(world);
      const afterCommit = await post(world, body);
      expect(afterCommit.status).toBe(200);
      expect(await afterCommit.json()).toMatchObject({
        ok: true,
        queued: false,
        proposalId: body.proposalId,
        status: "committed",
      });
      expect(listExternalProposals(world.store.db)).toHaveLength(1);
      expect(eventsCausedBy(world, body.observation.id)).toHaveLength(2);
    } finally {
      shutDown(world);
    }
  });

  test("a retry of a rejected proposal reports the recorded rejection", async () => {
    const world = openWorld(join(dir, "world.sqlite"));
    startServer(world);
    try {
      const stale = envelope("zeus", {
        kind: "strike",
        target: "agora-shop",
        power: 1,
        expectedRevisions: [{ entityId: "agora-shop", revision: 999_999 }],
      });
      await post(world, stale);
      tick(world);

      const retry = await post(world, stale);

      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({
        status: "rejected",
        reason: "stale-target",
      });
    } finally {
      shutDown(world);
    }
  });

  test("the same id with changed content is a 409 and changes nothing", async () => {
    const world = openWorld(join(dir, "world.sqlite"));
    startServer(world);
    try {
      const body = strike();
      await post(world, body);

      const changed = await post(world, {
        ...body,
        proposal: { ...body.proposal, power: 9 },
      });

      expect(changed.status).toBe(409);
      expect(
        getExternalProposal(world.store.db, body.proposalId)?.proposal,
      ).toMatchObject({ power: 3 });
      expect(listExternalProposals(world.store.db)).toHaveLength(1);
    } finally {
      shutDown(world);
    }
  });

  test("changed content for an id whose proposal was already consumed is a 409, and the journal row is unchanged", async () => {
    const world = openWorld(join(dir, "world.sqlite"));
    startServer(world);
    try {
      const body = strike();
      await post(world, body);
      tick(world);
      const before = getExternalProposal(world.store.db, body.proposalId);
      expect(before?.consumedTick).toBe(1);

      const changed = await post(world, {
        ...body,
        proposal: { ...body.proposal, power: 9 },
      });

      expect(changed.status).toBe(409);
      expect(getExternalProposal(world.store.db, body.proposalId)).toEqual(
        before,
      );
      expect(listExternalProposals(world.store.db)).toHaveLength(1);
    } finally {
      shutDown(world);
    }
  });
});

describe("terminal outcomes", () => {
  test("stale, busy, and over-limit proposals are consumed with durable rejections, and none runs again after a reopen", async () => {
    const storePath = join(dir, "world.sqlite");
    const first = openWorld(storePath);
    startServer(first);
    const committed = strike();
    const busy = envelope("zeus", {
      kind: "strike",
      target: "old-oak",
      power: 1,
    });
    const stale = envelope("farmer", {
      kind: "strike",
      target: "agora-shop",
      power: 1,
      expectedRevisions: [{ entityId: "agora-shop", revision: 999_999 }],
    });
    for (const body of [committed, busy, stale]) await post(first, body);
    tick(first);

    expect(outcomeOf(first, committed.proposalId)?.outcome).toBe("committed");
    expect(outcomeOf(first, busy.proposalId)).toMatchObject({
      outcome: "rejected",
      reason: "busy-actor",
    });
    expect(outcomeOf(first, stale.proposalId)).toMatchObject({
      outcome: "rejected",
      reason: "stale-target",
    });
    shutDown(first);

    // A tight cap in a later tick: two actions fit, the third is over the limit.
    const second = openWorld(storePath, { maxProposalsPerTick: 2 });
    startServer(second);
    const fits1 = envelope("farmer", {
      kind: "worship",
      deity: "zeus",
      offering: { resource: "currency", amount: 1 },
    });
    const fits2 = envelope("woodcutter", {
      kind: "worship",
      deity: "zeus",
      offering: { resource: "currency", amount: 1 },
    });
    const over = envelope("zeus", {
      kind: "strike",
      target: "old-oak",
      power: 1,
    });
    for (const body of [fits1, fits2, over]) await post(second, body);
    tick(second);
    expect(outcomeOf(second, over.proposalId)).toMatchObject({
      outcome: "rejected",
      reason: "over-limit",
    });
    shutDown(second);

    const third = openWorld(storePath);
    const eventsBefore = listEvents(third.store.db).length;
    try {
      const all = [committed, busy, stale, fits1, fits2, over];
      for (const body of all) {
        expect(
          getExternalProposal(third.store.db, body.proposalId)?.consumedTick,
        ).toBeDefined();
        expect(outcomeOf(third, body.proposalId)).toBeDefined();
      }
      tick(third);
      const causedByJournal = listEvents(third.store.db)
        .slice(eventsBefore)
        .filter((event) =>
          all.some(
            (body) => String(event.correlationId) === body.observation.id,
          ),
        );
      expect(causedByJournal).toEqual([]);
    } finally {
      shutDown(third);
    }
  });
});

describe("a restored branch", () => {
  test("a retry of a consumed proposal reports its original terminal status, committed or rejected with its reason, though archives carry no trace", async () => {
    const source = openWorld(join(dir, "world.sqlite"));
    startServer(source);
    const committed = strike();
    const stale = envelope("farmer", {
      kind: "strike",
      target: "agora-shop",
      power: 1,
      expectedRevisions: [{ entityId: "agora-shop", revision: 999_999 }],
    });
    await post(source, committed);
    await post(source, stale);
    tick(source);
    const archivePath = join(dir, "snapshot.sqlite");
    exportArchive(source.store, archivePath);
    shutDown(source);

    const slot = importWorldArchive(
      archivePath,
      join(dir, "slots"),
      worldImportReducers,
    );
    // Reopened from the imported file alone: no trace rows came with it.
    const branch = openWorld(join(slot.slotPath, "world.sqlite"));
    startServer(branch);
    try {
      expect(outcomeOf(branch, committed.proposalId)).toBeUndefined();

      const committedRetry = await post(branch, committed);
      expect(committedRetry.status).toBe(200);
      expect(await committedRetry.json()).toMatchObject({
        ok: true,
        queued: false,
        proposalId: committed.proposalId,
        status: "committed",
      });

      const rejectedRetry = await post(branch, stale);
      expect(rejectedRetry.status).toBe(200);
      expect(await rejectedRetry.json()).toMatchObject({
        status: "rejected",
        reason: "stale-target",
      });
    } finally {
      shutDown(branch);
    }
  });

  test("executes the pending entries the snapshot held, once, and leaves consumed ones alone", async () => {
    const storePath = join(dir, "world.sqlite");
    const source = openWorld(storePath);
    startServer(source);
    const consumed = strike();
    await post(source, consumed);
    tick(source);
    const pending = envelope("zeus", {
      kind: "strike",
      target: "old-oak",
      power: 1,
    });
    await post(source, pending);
    const archivePath = join(dir, "snapshot.sqlite");
    exportArchive(source.store, archivePath);
    shutDown(source);

    const slot = importWorldArchive(
      archivePath,
      join(dir, "slots"),
      worldImportReducers,
    );
    const branch = openWorld(join(slot.slotPath, "world.sqlite"));
    try {
      const before = listEvents(branch.store.db).length;
      tick(branch);
      tick(branch);

      expect(outcomeOf(branch, pending.proposalId)?.outcome).toBe("committed");
      expect(eventsCausedBy(branch, pending.observation.id)).toHaveLength(2);
      expect(
        listEvents(branch.store.db)
          .slice(before)
          .some(
            (event) => String(event.correlationId) === consumed.observation.id,
          ),
      ).toBe(false);
      expect(
        getExternalProposal(branch.store.db, consumed.proposalId)?.consumedTick,
      ).toBe(1);
    } finally {
      shutDown(branch);
    }
  });
});

describe("a goal change on a journaled proposal", () => {
  const GOAL = {
    set: { text: "Burn the farmer's tavern.", target: "farmer" },
  };
  const goalEventsOf = (world: World) =>
    listEvents(world.store.db).filter(
      (event) => event.kind === "goal-set" || event.kind === "goal-ended",
    );

  test("a proposal rejected as stale-target still commits its goal: the trace row lists the goal event ids, the rejection reason stands, and the journal entry is consumed", async () => {
    const world = openWorld(join(dir, "world.sqlite"));
    startServer(world);
    try {
      const stale = envelope("zeus", {
        kind: "strike",
        target: "the-tavern",
        power: 1,
        expectedRevisions: [{ entityId: "the-tavern", revision: 999_999 }],
        goal: GOAL,
      });
      expect((await post(world, stale)).status).toBe(202);
      tick(world);

      const outcome = outcomeOf(world, stale.proposalId);
      expect(outcome).toMatchObject({
        outcome: "rejected",
        reason: "stale-target",
      });
      const goals = goalEventsOf(world);
      expect(goals.map((e) => e.kind)).toEqual(["goal-set"]);
      expect(outcome?.eventIds).toEqual(goals.map((e) => e.id));
      expect(
        getExternalProposal(world.store.db, stale.proposalId)?.consumedTick,
      ).toBe(1);
      // The action did nothing; the goal did.
      expect(
        eventsCausedBy(world, stale.observation.id).map((e) => e.kind),
      ).toEqual(["goal-set"]);
      expect(world.state.goals.get("zeus" as never)?.text).toBe(
        "Burn the farmer's tavern.",
      );
    } finally {
      shutDown(world);
    }
  });

  test("control: the same strike, not stale, commits with the goal riding along, and its trace row lists the action and the goal", async () => {
    const world = openWorld(join(dir, "world.sqlite"));
    startServer(world);
    try {
      const fresh = envelope("zeus", {
        kind: "strike",
        target: "the-tavern",
        power: 1,
        goal: GOAL,
      });
      await post(world, fresh);
      tick(world);
      const outcome = outcomeOf(world, fresh.proposalId);
      expect(outcome?.outcome).toBe("committed");
      expect(
        eventsCausedBy(world, fresh.observation.id).map((e) => e.kind),
      ).toEqual(["resource-consumed", "building-damaged", "goal-set"]);
      expect(outcome?.eventIds).toHaveLength(3);
    } finally {
      shutDown(world);
    }
  });

  test("accepted, closed, reopened: the goal commits once, and a further tick and reopen do not repeat it", async () => {
    const storePath = join(dir, "world.sqlite");
    const first = openWorld(storePath);
    startServer(first);
    const goalOnly = envelope("hera", {
      kind: "goal",
      goal: { set: { text: "Win the farmer.", target: "farmer" } },
    });
    expect((await post(first, goalOnly)).status).toBe(202);
    shutDown(first);

    const second = openWorld(storePath);
    try {
      expect(tick(second)).toBe("committed");
      expect(tick(second)).toBe("committed");
      expect(goalEventsOf(second)).toHaveLength(1);
      expect(second.state.goals.get("hera" as never)?.text).toBe(
        "Win the farmer.",
      );
    } finally {
      shutDown(second);
    }
    const third = openWorld(storePath);
    try {
      tick(third);
      expect(goalEventsOf(third)).toHaveLength(1);
      expect(third.state.goals.get("hera" as never)?.text).toBe(
        "Win the farmer.",
      );
    } finally {
      shutDown(third);
    }
  });

  test("with the action cap full, a goal-only proposal still commits once, is consumed once, and is never rejected as over-limit", async () => {
    const world = openWorld(join(dir, "world.sqlite"), {
      maxProposalsPerTick: 2,
    });
    startServer(world);
    try {
      const worship = (actor: string) =>
        envelope(actor, {
          kind: "worship",
          deity: "zeus",
          offering: { resource: "currency", amount: 1 },
        });
      const fits1 = worship("farmer");
      const fits2 = worship("woodcutter");
      const goalOnly = envelope("hera", {
        kind: "goal",
        goal: { set: { text: "Win the farmer.", target: "farmer" } },
      });
      for (const body of [fits1, fits2, goalOnly]) await post(world, body);
      tick(world);

      expect(outcomeOf(world, fits1.proposalId)?.outcome).toBe("committed");
      expect(outcomeOf(world, goalOnly.proposalId)).toMatchObject({
        outcome: "committed",
      });
      expect(outcomeOf(world, goalOnly.proposalId)?.reason).toBeUndefined();
      expect(goalEventsOf(world)).toHaveLength(1);
      expect(
        getExternalProposal(world.store.db, goalOnly.proposalId)?.consumedTick,
      ).toBe(1);
      // Control: a third action in the same tick is the one over the limit.
      const over = envelope("zeus", {
        kind: "strike",
        target: "old-oak",
        power: 1,
      });
      await post(world, worship("farmer"));
      await post(world, worship("woodcutter"));
      await post(world, over);
      tick(world);
      expect(outcomeOf(world, over.proposalId)).toMatchObject({
        outcome: "rejected",
        reason: "over-limit",
      });
    } finally {
      shutDown(world);
    }
  });

  test("an action that overflows the cap keeps its goal: rejected over-limit for the action, the trace row lists the goal event ids, the entry is consumed once, and a reopen repeats nothing", async () => {
    const storePath = join(dir, "world.sqlite");
    const world = openWorld(storePath, { maxProposalsPerTick: 1 });
    startServer(world);
    const first = envelope("zeus", {
      kind: "legend",
      assertion: "I speak first.",
    });
    const overflowing = envelope("hera", {
      kind: "legend",
      assertion: "I speak second.",
      goal: { set: { text: "Make Zeus admit his deceit.", target: "zeus" } },
    });
    await post(world, first);
    await post(world, overflowing);
    tick(world);

    const outcome = outcomeOf(world, overflowing.proposalId);
    expect(outcome).toMatchObject({
      outcome: "rejected",
      reason: "over-limit",
    });
    const goals = goalEventsOf(world);
    expect(goals.map((e) => e.kind)).toEqual(["goal-set"]);
    expect(outcome?.eventIds).toEqual(goals.map((e) => e.id));
    expect(world.state.goals.get("hera" as never)?.text).toBe(
      "Make Zeus admit his deceit.",
    );
    // Her legend did not run.
    expect(
      eventsCausedBy(world, overflowing.observation.id).map((e) => e.kind),
    ).toEqual(["goal-set"]);
    expect(
      getExternalProposal(world.store.db, overflowing.proposalId)?.consumedTick,
    ).toBe(1);
    shutDown(world);

    // Reopened: the goal is still hers, and nothing runs again.
    const reopened = openWorld(storePath, { maxProposalsPerTick: 1 });
    try {
      const before = listEvents(reopened.store.db).length;
      expect(reopened.state.goals.get("hera" as never)?.text).toBe(
        "Make Zeus admit his deceit.",
      );
      tick(reopened);
      tick(reopened);
      expect(goalEventsOf(reopened)).toHaveLength(1);
      expect(
        listEvents(reopened.store.db)
          .slice(before)
          .some((e) => String(e.correlationId) === overflowing.observation.id),
      ).toBe(false);
    } finally {
      shutDown(reopened);
    }
  });

  test("control: with the goal capacity also full, the overflowing action's goal overflows as before and nothing is recorded", async () => {
    const world = openWorld(join(dir, "world.sqlite"), {
      maxProposalsPerTick: 1,
    });
    startServer(world);
    try {
      const first = envelope("zeus", {
        kind: "legend",
        assertion: "I speak first.",
      });
      const zeusGoal = envelope("zeus", {
        kind: "goal",
        goal: { set: { text: "Calm the sky.", target: "hera" } },
      });
      const overflowing = envelope("hera", {
        kind: "legend",
        assertion: "I speak second.",
        goal: { set: { text: "Make Zeus admit his deceit.", target: "zeus" } },
      });
      for (const body of [first, zeusGoal, overflowing])
        await post(world, body);
      tick(world);
      const outcome = outcomeOf(world, overflowing.proposalId);
      expect(outcome).toMatchObject({
        outcome: "rejected",
        reason: "over-limit",
      });
      expect(outcome?.eventIds).toEqual([]);
      expect(world.state.goals.get("hera" as never)).toBeUndefined();
      expect(world.state.goals.get("zeus" as never)?.text).toBe(
        "Calm the sky.",
      );
      expect(
        getExternalProposal(world.store.db, overflowing.proposalId)
          ?.consumedTick,
      ).toBe(1);
    } finally {
      shutDown(world);
    }
  });

  test("an archive export and import rebuilds the same active goals from the event log, and a forged goal is refused", async () => {
    const source = openWorld(join(dir, "world.sqlite"));
    startServer(source);
    await post(source, envelope("hera", { kind: "goal", goal: GOAL }));
    await post(
      source,
      envelope("zeus", {
        kind: "goal",
        goal: { set: { text: "Calm the sky.", target: "hera" } },
      }),
    );
    tick(source);
    await post(
      source,
      envelope("zeus", {
        kind: "goal",
        goal: { end: { outcome: "achieved" } },
      }),
    );
    tick(source);
    const live = [...source.state.goals];
    expect(live).toHaveLength(1);
    const archivePath = join(dir, "snapshot.sqlite");
    exportArchive(source.store, archivePath);
    shutDown(source);

    const slot = importWorldArchive(
      archivePath,
      join(dir, "slots"),
      worldImportReducers,
    );
    const branch = openWorld(join(slot.slotPath, "world.sqlite"));
    try {
      expect([...branch.state.goals]).toEqual(live);
    } finally {
      shutDown(branch);
    }

    // A forged archive: Zeus's ended goal restored in the projection, with the hash recomputed.
    const forgedPath = join(dir, "forged.sqlite");
    copyFileSync(archivePath, forgedPath);
    const db = new Database(forgedPath);
    const row = db.query("SELECT data FROM projections WHERE id = 1").get() as {
      data: string;
    };
    const encoded = JSON.parse(row.data);
    encoded.goals.push([
      "zeus",
      {
        text: "Calm the sky.",
        target: "hera",
        eventId: "evt-1-1",
        sequence: 1,
        tick: 1,
      },
    ]);
    db.run("UPDATE projections SET data = ? WHERE id = 1", [
      JSON.stringify(encoded),
    ]);
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
    expect(() =>
      importWorldArchive(
        forgedPath,
        join(dir, "slots-forged"),
        worldImportReducers,
      ),
    ).toThrow(/event log/);
  });

  test("an archive export and import rebuilds an active journey from the event log and the imported world walks it on; a forged journey is refused", async () => {
    const source = openWorld(join(dir, "world.sqlite"));
    startServer(source);
    // Zeus in the great hall, headed for the tavern: four hops across two realms.
    await post(source, envelope("zeus", { kind: "travel", to: "tavern" }));
    tick(source);
    tick(source);
    const live = [...source.state.journeys];
    expect(
      live.map(([god, journey]) => [String(god), String(journey.destination)]),
    ).toEqual([["zeus", "tavern"]]);
    expect(String(source.state.actors.get("zeus" as never)?.locationId)).toBe(
      "mountain-path",
    );
    const archivePath = join(dir, "snapshot.sqlite");
    exportArchive(source.store, archivePath);
    shutDown(source);

    const slot = importWorldArchive(
      archivePath,
      join(dir, "slots"),
      worldImportReducers,
    );
    const branch = openWorld(join(slot.slotPath, "world.sqlite"));
    try {
      expect([...branch.state.journeys]).toEqual(live);
      // The branch carries on from where the journey stood.
      tick(branch);
      expect(String(branch.state.actors.get("zeus" as never)?.locationId)).toBe(
        "town-square",
      );
      expect(branch.state.journeys.size).toBe(1);
    } finally {
      shutDown(branch);
    }

    // A forged archive: a journey no event started, with the hash recomputed.
    const forgedPath = join(dir, "forged.sqlite");
    copyFileSync(archivePath, forgedPath);
    const db = new Database(forgedPath);
    const row = db.query("SELECT data FROM projections WHERE id = 1").get() as {
      data: string;
    };
    const encoded = JSON.parse(row.data);
    encoded.journeys.push([
      "hera",
      { destination: "tavern", eventId: "evt-1-1" },
    ]);
    db.run("UPDATE projections SET data = ? WHERE id = 1", [
      JSON.stringify(encoded),
    ]);
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
    expect(() =>
      importWorldArchive(
        forgedPath,
        join(dir, "slots-forged"),
        worldImportReducers,
      ),
    ).toThrow(/event log/);
  });
});
