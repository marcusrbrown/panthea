// A god's turn through the production router and a scripted OpenAI-compatible
// endpoint on loopback (the provider boundary): snapshot -> memory -> context
// -> route -> trusted proposal. The world is real: memories come from real
// ticks, and a built proposal is committed by the real validator.

import { afterEach, expect, test } from "bun:test";
import type { EventId, WorldEvent } from "@panthea/contracts";
import {
  applyEvent,
  createPrng,
  runTick,
  submitProposal,
  toEntityId,
  type WorldState,
} from "@panthea/world";
import { parseRoutingConfig } from "./config";
import { rememberedBy } from "./context";
import { PROMPT_TOKEN_CAP } from "./practices";
import { createRouter, type Router } from "./router";
import {
  actorAt,
  godProfile,
  greekState,
  WorldRun,
  withoutFireSpread,
} from "./test-fixtures";
import { runGodTurn } from "./turn";

interface Stub {
  readonly baseUrl: string;
  readonly seen: Record<string, unknown>[];
  stop(): void;
}

const stubs: Stub[] = [];
afterEach(() => {
  for (const stub of stubs.splice(0)) stub.stop();
});

/** Replies with `replies[n]` to the nth request, repeating the last; a reply of `500` answers with a server error. */
function startStub(...replies: (string | 500)[]): Stub {
  const seen: Record<string, unknown>[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const n = seen.length;
      seen.push((await request.json()) as Record<string, unknown>);
      const reply = replies[Math.min(n, replies.length - 1)] as string | 500;
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
  const stub: Stub = {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    seen,
    stop: () => server.stop(true),
  };
  stubs.push(stub);
  return stub;
}

function routerFor(stub: Stub) {
  const config = parseRoutingConfig({
    endpoints: [{ id: "ollama", baseUrl: stub.baseUrl, model: "scripted" }],
    roles: { zeus: { endpoint: "ollama" }, hera: { endpoint: "ollama" } },
  });
  if (!config.ok) throw new Error(`${config.path}: ${config.message}`);
  return createRouter({
    config: config.value,
    offline: false,
    limits: {
      attemptTimeoutMs: 2_000,
      totalTimeoutMs: 10_000,
      maxAttempts: 2,
      backoffBaseMs: 1,
      backoffMaxMs: 4,
    },
  });
}

const id = toEntityId;
const profiles = new Map([
  [id("zeus"), godProfile("zeus")],
  [id("hera"), godProfile("hera")],
]);

const zeusAtTavern = () => actorAt(greekState(), "zeus", "tavern");

function deps(stub: Stub) {
  return { router: routerFor(stub), profiles };
}

const STRIKE_TAVERN = '{"action":"strike","target":"the-tavern","power":2}';

test("a scripted reply becomes a service-built proposal the world commits, with the request that produced it", async () => {
  const stub = startStub(STRIKE_TAVERN);
  const state = zeusAtTavern();

  const turn = await runGodTurn(deps(stub), { state, actorId: id("zeus") });
  expect(turn?.kind).toBe("proposal");
  if (turn?.kind !== "proposal") return;

  expect(turn.proposal).toMatchObject({
    kind: "strike",
    actor: "zeus",
    target: "the-tavern",
    source: "model",
  });
  expect(turn.observation.source).toBe("model");
  expect(turn.request).toMatchObject({
    role: "zeus",
    route: { kind: "intent", step: { endpoint: "ollama", mode: "native" } },
    output: '{"action":"strike","target":"the-tavern","power":2}',
  });
  // The trace's prompt is what the model was actually shown.
  expect(turn.request.prompt).toContain("The Tavern");
  expect(JSON.stringify(stub.seen[0])).toContain("The Tavern");

  const tick = runTick(state, createPrng(1), [turn.proposal]);
  expect(tick.rejected).toEqual([]);
});

test("a scripted wait is a wait: no proposal, but the request is still reported", async () => {
  const stub = startStub('{"action":"wait"}');
  const turn = await runGodTurn(deps(stub), {
    state: zeusAtTavern(),
    actorId: id("zeus"),
  });
  expect(turn?.kind).toBe("wait");
  if (turn?.kind !== "wait") return;
  expect(turn.request.route.kind).toBe("intent");
});

test("every endpoint failing is exhausted: no proposal, and the steps say why", async () => {
  const stub = startStub(500);
  const turn = await runGodTurn(deps(stub), {
    state: zeusAtTavern(),
    actorId: id("zeus"),
  });
  expect(turn?.kind).toBe("exhausted");
  if (turn?.kind !== "exhausted") return;
  expect(turn.request.route.steps[0]).toMatchObject({ endpoint: "ollama" });
  // Control: the same world with a working endpoint gives a proposal.
  const working = await runGodTurn(deps(startStub(STRIKE_TAVERN)), {
    state: zeusAtTavern(),
    actorId: id("zeus"),
  });
  expect(working?.kind).toBe("proposal");
});

test("a dead or unknown actor has no turn and asks no model; a god with no profile has none either", async () => {
  const stub = startStub(STRIKE_TAVERN);
  const state = zeusAtTavern();
  const zeus = state.actors.get(id("zeus"));
  if (!zeus) throw new Error("no zeus");
  const dead: WorldState = {
    ...state,
    actors: new Map(state.actors).set(id("zeus"), { ...zeus, alive: false }),
  };
  expect(
    await runGodTurn(deps(stub), { state: dead, actorId: id("zeus") }),
  ).toBeUndefined();
  expect(
    await runGodTurn(deps(stub), { state, actorId: id("nobody") }),
  ).toBeUndefined();
  // Ares stands in no profile map.
  expect(
    await runGodTurn(deps(stub), { state, actorId: id("farmer") }),
  ).toBeUndefined();
  expect(stub.seen).toHaveLength(0);

  // Control: the living god with a profile asks once.
  await runGodTurn(deps(stub), { state, actorId: id("zeus") });
  expect(stub.seen).toHaveLength(1);
});

function struck(): WorldState {
  const state = withoutFireSpread(
    actorAt(actorAt(zeusAtTavern(), "farmer", "tavern"), "hera", "town-square"),
  );
  const submitted = submitProposal({
    schemaVersion: 1,
    actor: "zeus",
    targets: [],
    expectedRevisions: [],
    source: "fixture",
    observationId: "obs-strike",
    kind: "strike",
    target: "the-tavern",
    power: 3,
  });
  if (!submitted.ok) throw new Error(submitted.rejection.message);
  return runTick(state, createPrng(1), [submitted.proposal]).state;
}

test("the prompt carries the god's own memory of a real strike, and a god who did not see it is shown none", async () => {
  const state = struck();
  const zeusStub = startStub('{"action":"wait"}');
  await runGodTurn(deps(zeusStub), { state, actorId: id("zeus") });
  const zeusPrompt = JSON.stringify(zeusStub.seen[0]);
  expect(zeusPrompt).toContain("You remember");
  expect(zeusPrompt).toContain("building-ignited");

  const heraStub = startStub('{"action":"wait"}');
  await runGodTurn(deps(heraStub), { state, actorId: id("hera") });
  expect(JSON.stringify(heraStub.seen[0])).not.toContain("You remember");
});

test("a report built from a turn commits: the listener forms a belief from the claim, and a hallucinated listener never becomes a proposal", async () => {
  const state = struck();
  const reply = JSON.stringify({
    action: "report",
    listener: "farmer",
    content: "Fire took your tavern.",
    claim: { effect: "harm", agent: "zeus", target: "the-tavern" },
  });
  const turn = await runGodTurn(deps(startStub(reply)), {
    state,
    actorId: id("zeus"),
  });
  expect(turn?.kind).toBe("proposal");
  if (turn?.kind !== "proposal") return;
  const tick = runTick(state, createPrng(1), [turn.proposal]);
  expect(tick.rejected).toEqual([]);
  expect(
    tick.state.memories.get(id("farmer"))?.some((m) => m.kind === "told"),
  ).toBe(true);

  // Hera is in the square, out of Zeus's snapshot.
  const hallucinated = JSON.stringify({
    action: "report",
    listener: "hera",
    content: "Fire took the tavern.",
  });
  const refused = await runGodTurn(deps(startStub(hallucinated)), {
    state,
    actorId: id("zeus"),
  });
  expect(refused?.kind).toBe("exhausted");
});

// --- Goals through the turn -------------------------------------------------------------

test("a scripted reply that sets a goal alongside its action becomes one proposal carrying both, and the world commits both", async () => {
  const state = zeusAtTavern();
  const reply = JSON.stringify({
    action: "strike",
    target: "the-tavern",
    power: 2,
    goal: { set: { text: "Burn it all down.", target: "the-tavern" } },
  });
  const turn = await runGodTurn(deps(startStub(reply)), {
    state,
    actorId: id("zeus"),
  });
  expect(turn?.kind).toBe("proposal");
  if (turn?.kind !== "proposal") return;
  expect(turn.proposal).toMatchObject({
    kind: "strike",
    goal: { set: { text: "Burn it all down.", target: "the-tavern" } },
  });
  const tick = runTick(state, createPrng(1), [turn.proposal]);
  expect(tick.rejected).toEqual([]);
  expect(String(tick.state.goals.get(id("zeus"))?.target)).toBe("the-tavern");
});

test("a scripted wait that sets a goal journals a goal-only proposal; a plain wait journals nothing", async () => {
  const state = zeusAtTavern();
  const goalWait = await runGodTurn(
    deps(
      startStub(
        '{"action":"wait","goal":{"set":{"text":"Watch the tavern.","target":"the-tavern"}}}',
      ),
    ),
    { state, actorId: id("zeus") },
  );
  expect(goalWait?.kind).toBe("proposal");
  if (goalWait?.kind === "proposal") {
    expect(goalWait.proposal.kind).toBe("goal");
    expect(
      runTick(state, createPrng(1), [goalWait.proposal]).state.goals.size,
    ).toBe(1);
  }
  const plain = await runGodTurn(deps(startStub('{"action":"wait"}')), {
    state,
    actorId: id("zeus"),
  });
  expect(plain?.kind).toBe("wait");
});

test("a goal naming someone the god was not shown never becomes a proposal", async () => {
  const state = zeusAtTavern();
  const bad =
    '{"action":"wait","goal":{"set":{"text":"Hunt him.","target":"the-woodcutter"}}}';
  const turn = await runGodTurn(deps(startStub(bad)), {
    state,
    actorId: id("zeus"),
  });
  expect(turn?.kind).toBe("exhausted");
});

test("the prompt shows the god its active goal and its own recent action, from the world it acted in", async () => {
  const first = await runGodTurn(
    deps(
      startStub(
        '{"action":"strike","target":"the-tavern","power":3,"goal":{"set":{"text":"Punish the farmer.","target":"the-tavern"}}}',
      ),
    ),
    { state: zeusAtTavern(), actorId: id("zeus") },
  );
  if (first?.kind !== "proposal") throw new Error("expected a proposal");
  const ticked = runTick(zeusAtTavern(), createPrng(1), [first.proposal]);

  const stub = startStub('{"action":"wait"}');
  await runGodTurn(deps(stub), {
    state: ticked.state,
    actorId: id("zeus"),
    ownEvents: ticked.events,
  });
  const prompt = JSON.stringify(stub.seen[0]);
  expect(prompt).toContain("Your goal");
  expect(prompt).toContain("Punish the farmer.");
  expect(prompt).toContain("you struck the-tavern");
  // Control: without the own events read, the goal still shows but no action does.
  const bare = startStub('{"action":"wait"}');
  await runGodTurn(deps(bare), { state: ticked.state, actorId: id("zeus") });
  expect(JSON.stringify(bare.seen[0])).toContain("Punish the farmer.");
  expect(JSON.stringify(bare.seen[0])).not.toContain("What you did recently");
});

/** Hera was told of something Zeus did, and demanded a legend at the altar of him: a real thread awaiting Zeus. */
function demandedOfZeus(): { state: WorldState; thread: EventId } {
  const base = greekState();
  const apply = (state: WorldState, overrides: Record<string, unknown>) =>
    applyEvent(state, {
      schemaVersion: 1,
      tick: 0,
      simTime: 0,
      correlationId: "fixture",
      causationId: "fixture",
      approximate: false,
      sequence: state.lastSequence + 1,
      ...overrides,
    } as unknown as WorldEvent);
  let state = apply(base, {
    id: "evt-0-1",
    kind: "report-told",
    entityId: "farmer",
    listenerId: "hera",
    content: "Zeus visited a nymph",
  });
  state = apply(state, {
    id: "evt-0-2",
    kind: "memory-recorded",
    memoryKind: "told",
    entityId: "hera",
    sourceEventId: "evt-0-1",
    teller: "farmer",
    content: "Zeus visited a nymph",
    subjects: ["farmer", "hera"],
    salience: 4,
  });
  const submitted = submitProposal({
    schemaVersion: 1,
    actor: "hera",
    targets: [],
    expectedRevisions: [],
    source: "fixture",
    observationId: "obs-demand",
    kind: "practice",
    move: "demand",
    counterparty: "zeus",
    cause: "evt-0-1",
    term: {
      kind: "tell-legend",
      party: "zeus",
      place: "altar",
      deadlineTicks: 100,
    },
  });
  if (!submitted.ok) throw new Error(submitted.rejection.message);
  const ran = runTick(state, createPrng(1), [submitted.proposal]);
  expect(ran.rejected).toEqual([]);
  const [thread] = [...ran.state.threads.keys()];
  if (!thread) throw new Error("no thread");
  return { state: ran.state, thread };
}

test("a scripted practice answer becomes a service-built proposal pinned only to its thread, which the world commits; the model saw the thread in its prompt", async () => {
  const { state, thread } = demandedOfZeus();
  const stub = startStub(
    JSON.stringify({ action: "practice", move: "accept", thread, swear: true }),
  );
  const turn = await runGodTurn(deps(stub), { state, actorId: id("zeus") });
  expect(turn?.kind).toBe("proposal");
  if (turn?.kind !== "proposal") return;
  expect(turn.request.prompt).toContain(`AWAITING YOUR ANSWER`);
  expect(JSON.stringify(stub.seen[0])).toContain(thread);
  expect(turn.proposal).toMatchObject({
    kind: "practice",
    move: "accept",
    thread,
    swear: true,
    source: "model",
    expectedRevisions: [
      { entityId: thread, revision: state.threads.get(thread)?.revision },
    ],
  });
  const ran = runTick(state, createPrng(1), [turn.proposal]);
  expect(ran.rejected).toEqual([]);
  expect(ran.state.threads.get(thread)?.status).toBe("accepted");
});

test("a scripted answer on a thread that is not the god's is not a valid intent: the router repairs or exhausts, and no proposal is built", async () => {
  const { state } = demandedOfZeus();
  const stub = startStub(
    '{"action":"practice","move":"accept","thread":"evt-404"}',
  );
  const turn = await runGodTurn(deps(stub), { state, actorId: id("zeus") });
  expect(turn?.kind).toBe("exhausted");
});

// --- The cap on the whole prompt ------------------------------------------------------------------

/** A router on granite3.3-8b-4k (2.85 characters a token) that records what the turn asks of it. */
function capped(stub: Stub) {
  const config = parseRoutingConfig({
    endpoints: [
      { id: "ollama", baseUrl: stub.baseUrl, model: "granite3.3-8b-4k" },
    ],
    roles: { zeus: { endpoint: "ollama" } },
  });
  if (!config.ok) throw new Error(`${config.path}: ${config.message}`);
  const router = createRouter({
    config: config.value,
    offline: false,
    limits: {
      attemptTimeoutMs: 2_000,
      totalTimeoutMs: 10_000,
      maxAttempts: 2,
      backoffBaseMs: 1,
      backoffMaxMs: 4,
    },
  });
  const calls = { plan: 0, route: [] as { maxChars?: number }[] };
  const spy: Router = {
    plan: (role) => {
      calls.plan += 1;
      return router.plan(role);
    },
    route(role, context, schema, options) {
      calls.route.push({
        ...(options?.maxChars === undefined
          ? {}
          : { maxChars: options.maxChars }),
      });
      return router.route(role, context, schema, options);
    },
  };
  return { deps: { router: spy, profiles }, calls };
}

/** What a stub was sent, joined as the turn counts a request. */
const sent = (stub: Stub, n: number): string =>
  (stub.seen[n] as { messages: { content: string }[] }).messages
    .map((message) => message.content)
    .join("\n\n");

/** Zeus with `count` open help prayers; with `live`, the oldest three are held by a live practice (two open offers and an accepted one, so a boon is owed). */
function crowded(count: number, live: boolean) {
  const run = new WorldRun();
  const payers = [...run.state.actors.values()]
    .filter(
      (actor) =>
        actor.alive &&
        actor.isDeity !== true &&
        (actor.inventory.get("currency") ?? 0) >= 1,
    )
    .map((actor) => String(actor.id));
  const ids = Array.from({ length: count }, (_, i) =>
    run.prays(payers[i % payers.length] as string),
  );
  if (live) {
    const partyOf = (petition: EventId) =>
      String(run.state.petitions.get(petition)?.petitioner);
    for (const petition of ids.slice(0, 3)) {
      run.tick({
        actor: "zeus",
        kind: "practice",
        move: "offer",
        petition,
        term: {
          kind: "make-offering",
          party: partyOf(petition),
          to: "zeus",
          resource: "currency",
          amount: 1,
          deadlineTicks: 80,
        },
      });
    }
    const accepted = [...run.state.threads.values()].find(
      (thread) => thread.petition === ids[2],
    );
    if (!accepted) throw new Error("no thread on the third prayer");
    run.tick({
      actor: partyOf(ids[2] as EventId),
      kind: "practice",
      move: "accept",
      thread: accepted.id,
    });
  }
  return { state: run.state, ids };
}

test("a turn under the cap sends the whole request unreduced, with the router's limit, and records the estimate, the ratio and no sheds", async () => {
  const stub = startStub('{"action":"wait"}');
  const { deps: capDeps, calls } = capped(stub);

  const turn = await runGodTurn(capDeps, {
    state: zeusAtTavern(),
    actorId: id("zeus"),
  });

  expect(turn?.kind).toBe("wait");
  if (turn?.kind !== "wait") return;
  expect(turn.request.cap).toEqual({
    estimatedTokens: expect.any(Number),
    ratio: 2.85,
    shed: { events: 0, actions: 0, memories: 0, prayers: 0 },
  });
  expect(turn.request.cap.estimatedTokens).toBeLessThanOrEqual(
    PROMPT_TOKEN_CAP,
  );
  expect(calls.route).toEqual([{ maxChars: 8550 }]);
  expect(sent(stub, 0)).toBe(turn.request.prompt);
});

test("a crowded turn sends the reduced prompt, records what it shed, and refuses an id that was shed", async () => {
  const { state, ids } = crowded(14, false);
  const stub = startStub('{"action":"wait"}');
  const first = await runGodTurn(capped(stub).deps, {
    state,
    actorId: id("zeus"),
  });
  expect(first?.kind).toBe("wait");
  if (first?.kind !== "wait") return;
  const { cap, prompt } = first.request;
  expect(cap.shed.prayers).toBeGreaterThan(0);
  expect(cap.shed).toMatchObject({ events: 0, actions: 0, memories: 0 });
  expect(cap.estimatedTokens).toBeLessThanOrEqual(PROMPT_TOKEN_CAP);
  expect(sent(stub, 0)).toBe(prompt);

  // A prayer the budget alone showed and the cap then shed.
  const budgeted = rememberedBy(state, id("zeus")).petitions.map((p) => p.id);
  expect(budgeted.length).toBeGreaterThan(0);
  const shedId = budgeted.find((petition) => !prompt.includes(petition));
  const keptId = ids.find((petition) => prompt.includes(petition));
  if (shedId === undefined || keptId === undefined) throw new Error("no split");
  // The reduced pair builds the schema and the proposal: a bless of a shed prayer is not an intent.
  const refused = await runGodTurn(
    capped(startStub(JSON.stringify({ action: "bless", petition: shedId })))
      .deps,
    { state, actorId: id("zeus") },
  );
  expect(refused?.kind).toBe("exhausted");
  if (refused?.kind === "exhausted") {
    expect(refused.request.route.steps[0]?.reason).toBe("invalid-output");
  }
  const blessed = await runGodTurn(
    capped(startStub(JSON.stringify({ action: "bless", petition: keptId })))
      .deps,
    { state, actorId: id("zeus") },
  );
  expect(blessed?.kind).toBe("proposal");
});

test("when the protected floor alone is over the cap, the turn reads the plan, never calls route, sends nothing, and is exhausted for prompt-over-cap", async () => {
  const { state } = crowded(9, true);
  const stub = startStub('{"action":"wait"}');
  const { deps: capDeps, calls } = capped(stub);

  const turn = await runGodTurn(capDeps, { state, actorId: id("zeus") });

  expect(turn?.kind).toBe("exhausted");
  if (turn?.kind !== "exhausted") return;
  expect(turn.request.exhaustedReason).toBe("prompt-over-cap");
  expect(turn.request.route).toMatchObject({ kind: "exhausted", steps: [] });
  expect(turn.request.cap.estimatedTokens).toBeGreaterThan(PROMPT_TOKEN_CAP);
  expect(turn.request.cap.ratio).toBe(2.85);
  // Everything sheddable was shed first.
  expect(turn.request.cap.shed.prayers).toBeGreaterThan(0);
  expect(calls.plan).toBe(1);
  expect(calls.route).toEqual([]);
  expect(stub.seen).toEqual([]);
});

test("a retry after an invalid reply carries refusal feedback and still stays within the limit", async () => {
  const { state } = crowded(14, false);
  const stub = startStub('{"action":"dance"}', '{"action":"wait"}');
  const { deps: capDeps, calls } = capped(stub);

  const turn = await runGodTurn(capDeps, { state, actorId: id("zeus") });

  expect(turn?.kind).toBe("wait");
  expect(stub.seen).toHaveLength(2);
  const limit = calls.route[0]?.maxChars as number;
  expect(limit).toBe(8550);
  expect(sent(stub, 1).length).toBeGreaterThan(sent(stub, 0).length);
  expect(sent(stub, 1).length).toBeLessThanOrEqual(limit);
});
