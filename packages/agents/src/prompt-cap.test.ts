// The runtime cap on a god's whole prompt: which characters-per-token ratio
// the cap counts with, and how a built request is estimated against it.

import { describe, expect, test } from "bun:test";
import type { EventId, WorldEvent } from "@panthea/contracts";
import {
  type PerceivedEvent,
  type PerceptionSnapshot,
  perceive,
  toEntityId,
} from "@panthea/world";
import { parseRoutingConfig, planRoute, type RoutePlan } from "./config";
import {
  buildGodContext,
  type GoalHistoryEntry,
  godIntentSchema,
  PRAYERS_HEADING,
  rememberedBy,
} from "./context";
import { PROMPT_TOKEN_CAP } from "./practices";
import {
  causalSet,
  DEFAULT_RATIO,
  estimateTokens,
  fitsCap,
  fitToCap,
  MODEL_RATIOS,
  maxCharsFor,
  routeRatio,
  shedToCap,
} from "./prompt-cap";
import { createRouter, requestChars } from "./router";
import { godProfile, WorldRun } from "./test-fixtures";

const id = toEntityId;

const LOCAL = "http://127.0.0.1:11434/v1";
const HOSTED = "https://api.example.com/v1";

function planFor(
  endpoints: readonly { id: string; baseUrl: string; model: string }[],
  extra: Record<string, unknown>,
  offline = false,
): RoutePlan {
  const parsed = parseRoutingConfig({ endpoints, ...extra });
  if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.message}`);
  return planRoute(parsed.value, "zeus", { offline });
}

describe("the table", () => {
  test("pins the measured ratios, the default and the cap", () => {
    expect(MODEL_RATIOS["granite3.3-8b-4k"]).toBe(2.75);
    expect(MODEL_RATIOS["qwen3-8b-4k"]).toBe(3.34);
    expect(DEFAULT_RATIO).toBe(2.75);
    expect(PROMPT_TOKEN_CAP).toBe(3000);
  });

  test("granite3.3's ratio is under the densest request measured (2.807 characters a token, the unattended rerun's 3,002-token request of 8,427 characters), and the default is no higher than any measured ratio", () => {
    const granite = MODEL_RATIOS["granite3.3-8b-4k"] as number;
    expect(granite).toBeLessThan(8427 / 3002);
    expect(DEFAULT_RATIO).toBeLessThanOrEqual(
      Math.min(...Object.values(MODEL_RATIOS)),
    );
    // That request is over the cap at this ratio (it was counted 2,957 tokens at 2.85); the limit is 8,250 characters.
    expect(maxCharsFor(granite)).toBe(8250);
    const request = { prompt: "p".repeat(8427) };
    expect(estimateTokens(request, granite)).toBe(3065);
    expect(fitsCap(request, granite)).toBe(false);
    expect(estimateTokens(request, 2.85)).toBe(2957);
  });
});

describe("routeRatio: the most conservative step of the planned route", () => {
  test("a role on granite3.3 alone gives 2.75", () => {
    const plan = planFor(
      [{ id: "local", baseUrl: LOCAL, model: "granite3.3-8b-4k" }],
      { roles: { zeus: { endpoint: "local" } } },
    );
    expect(routeRatio(plan)).toBe(2.75);
  });

  test("a qwen3 primary with a granite3.3 fallback gives 2.75", () => {
    const plan = planFor(
      [
        { id: "a", baseUrl: LOCAL, model: "qwen3-8b-4k" },
        { id: "b", baseUrl: LOCAL, model: "granite3.3-8b-4k" },
      ],
      { roles: { zeus: { endpoint: "a" } }, fallback: ["b"] },
    );
    expect(routeRatio(plan)).toBe(2.75);
  });

  test("a role's model override is what is looked up, not the endpoint's default", () => {
    const plan = planFor([{ id: "a", baseUrl: LOCAL, model: "qwen3-8b-4k" }], {
      roles: { zeus: { endpoint: "a", model: "granite3.3-8b-4k" } },
    });
    expect(routeRatio(plan)).toBe(2.75);
  });

  test("an unknown model gives the default, and so does an empty plan", () => {
    const unknown = planFor(
      [{ id: "a", baseUrl: LOCAL, model: "mystery-70b" }],
      { roles: { zeus: { endpoint: "a" } } },
    );
    expect(routeRatio(unknown)).toBe(2.75);
    expect(routeRatio({ steps: [], offlineSkipped: [] })).toBe(2.75);
  });

  test("an unknown model on the route pulls the ratio down to the default", () => {
    const plan = planFor(
      [
        { id: "a", baseUrl: LOCAL, model: "qwen3-8b-4k" },
        { id: "b", baseUrl: LOCAL, model: "mystery-70b" },
      ],
      { roles: { zeus: { endpoint: "a" } }, fallback: ["b"] },
    );
    expect(routeRatio(plan)).toBe(2.75);
  });

  test("offline drops a hosted fallback with a lower ratio, so the local ratio applies; online, the lower ratio applies", () => {
    const endpoints = [
      { id: "local", baseUrl: LOCAL, model: "qwen3-8b-4k" },
      { id: "hosted", baseUrl: HOSTED, model: "granite3.3-8b-4k" },
    ];
    const extra = {
      roles: { zeus: { endpoint: "local" } },
      fallback: ["hosted"],
    };
    expect(routeRatio(planFor(endpoints, extra, false))).toBe(2.75);
    expect(routeRatio(planFor(endpoints, extra, true))).toBe(3.34);
  });
});

describe("Router.plan", () => {
  test("returns the steps route would try, online and offline", () => {
    const parsed = parseRoutingConfig({
      endpoints: [
        { id: "local", baseUrl: LOCAL, model: "qwen3-8b-4k" },
        { id: "hosted", baseUrl: HOSTED, model: "granite3.3-8b-4k" },
      ],
      roles: { zeus: { endpoint: "local" } },
      fallback: ["hosted"],
    });
    if (!parsed.ok) throw new Error(parsed.message);
    for (const offline of [false, true]) {
      const router = createRouter({ config: parsed.value, offline });
      expect(router.plan("zeus")).toEqual(
        planRoute(parsed.value, "zeus", { offline }),
      );
    }
    const online = createRouter({ config: parsed.value, offline: false });
    expect(online.plan("zeus").steps.map((step) => step.endpoint.id)).toEqual([
      "local",
      "hosted",
    ]);
    const offline = createRouter({ config: parsed.value, offline: true });
    expect(offline.plan("zeus").steps.map((step) => step.endpoint.id)).toEqual([
      "local",
    ]);
    expect(offline.plan("zeus").offlineSkipped).toEqual(["hosted"]);
  });
});

describe("the estimate", () => {
  const RATIO = 2.75;
  const LIMIT = Math.round(PROMPT_TOKEN_CAP * RATIO);

  /** A context whose request, as the turn joins it, is `chars` long. */
  const sized = (chars: number) => ({
    instructions: "i".repeat(10),
    prompt: "p".repeat(chars - 10 - 2),
  });

  test("a request is counted as the turn joins it: instructions, a blank line, the prompt", () => {
    expect(requestChars(sized(100))).toBe(100);
    expect(requestChars({ prompt: "abc" })).toBe(3);
  });

  test("the estimate is the bare request: no room is reserved for a retry's note", () => {
    const base = sized(1000);
    expect(estimateTokens(base, RATIO)).toBe(Math.ceil(1000 / RATIO));
  });

  test("a bare request exactly at the cap fits, and one character over does not", () => {
    const atCap = sized(LIMIT);
    expect(estimateTokens(atCap, RATIO)).toBe(PROMPT_TOKEN_CAP);
    expect(fitsCap(atCap, RATIO)).toBe(true);
    expect(maxCharsFor(RATIO)).toBe(LIMIT);
    const over = sized(LIMIT + 1);
    expect(estimateTokens(over, RATIO)).toBe(PROMPT_TOKEN_CAP + 1);
    expect(fitsCap(over, RATIO)).toBe(false);
  });
});

// --- The shedding transform -------------------------------------------------------------------
//
// A busy Zeus: nine prayers (the first three held by a live practice: two open
// offers and one accepted, so a boon is owed), six memories of salience 1 to 6,
// five feelings of strength 1 to 5, five of his own actions and six recent
// events. The world is real; the recent events are plain data on the snapshot,
// so their ids are known.

interface WorldOptions {
  readonly prayers?: number;
  /** The salience of each memory. */
  readonly memories?: readonly number[];
  /** The strength of each feeling. */
  readonly feelings?: readonly number[];
  readonly events?: number;
  readonly actions?: number;
  /** How many of the oldest prayers a live practice holds: 3 is two open offers and an accepted one (a boon owed), 1 is one open offer. */
  readonly live?: 1 | 3;
  /** Every memory is of the same kind of loss, about the goal's target, with a line of the same length. */
  readonly uniform?: boolean;
  /** The characters of the legend each recent event carries; 0 for none. */
  readonly eventText?: number;
  /** The characters of the words each of the god's own reports tells. */
  readonly actionText?: number;
  /** Told accusations of Zeus, oldest first (each older than every other memory): who told him, and the salience of the memory. The one with the highest salience is the demand opening shown first. */
  readonly accusers?: readonly { teller: string; salience: number }[];
  /** A witnessed memory newer than every other, of this salience. */
  readonly newest?: number;
  /** Memories about the goal's target, older and less salient than the shown ones, so no shown memory backs their goal-history rows. */
  readonly independent?: number;
  /** Prayers after the live ones alternate between a help prayer and a (longer) punish prayer, the first of them a help prayer. */
  readonly mixedPrayers?: boolean;
}

function busyZeus(options: WorldOptions = {}) {
  const {
    prayers = 9,
    memories = [1, 2, 3, 4, 5, 6],
    feelings = [1, 2, 3, 4, 5],
    events = 6,
    actions = 5,
    live = 3,
    uniform = false,
    accusers = [],
    newest,
    independent = 0,
    eventText = 0,
    actionText = 0,
    mixedPrayers = false,
  } = options;
  const run = new WorldRun();
  const people = [...run.state.actors.values()]
    .filter((actor) => actor.alive && actor.isDeity !== true)
    .map((actor) => String(actor.id))
    .filter((who) => who !== "farmer" && who !== "woodcutter")
    .sort();
  const payers = [...run.state.actors.values()]
    .filter(
      (actor) =>
        actor.alive &&
        actor.isDeity !== true &&
        (actor.inventory.get("currency") ?? 0) >= 1,
    )
    .map((actor) => String(actor.id));
  run.apply({
    kind: "goal-set",
    entityId: "zeus",
    text: "Keep watch over the farmer.",
    target: "farmer",
  });
  const prayerIds: EventId[] = [];
  for (let i = 0; i < prayers; i += 1) {
    const mortal = payers[i % payers.length] as string;
    if (mixedPrayers && i >= live && (i - live) % 2 === 1) {
      // A theft by the woodcutter, and a prayer to punish him and his woodshed.
      run.state = { ...run.state, tick: run.state.tick + 1 };
      const theft = run.apply({
        kind: "theft",
        entityId: "woodcutter",
        victim: mortal,
        resource: "currency",
        amount: 1,
        cause: "director",
      });
      prayerIds.push(
        run.apply({
          kind: "petition-opened",
          entityId: mortal,
          god: "zeus",
          cause: theft.id,
          request: {
            kind: "punish",
            offender: "woodcutter",
            buildings: ["woodshed"],
          },
        }).id as EventId,
      );
    } else {
      prayerIds.push(run.prays(mortal));
    }
  }
  const protectedIds = prayerIds.slice(0, live);
  if (prayers >= live) {
    const partyOf = (petition: EventId) =>
      String(run.state.petitions.get(petition)?.petitioner);
    for (const petition of protectedIds) {
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
    if (live === 3) {
      const accepted = [...run.state.threads.values()].find(
        (thread) => thread.petition === protectedIds[2],
      );
      if (!accepted) throw new Error("no thread on the third prayer");
      run.tick({
        actor: partyOf(protectedIds[2] as EventId),
        kind: "practice",
        move: "accept",
        thread: accepted.id,
      });
    }
  }
  const accusedBy = accusers.map((accuser) => ({
    ...accuser,
    cause: run.accused(
      "zeus",
      accuser.teller,
      { agent: "zeus", target: accuser.teller },
      accuser.salience,
    ),
  }));
  for (let i = 0; i < independent; i += 1) {
    run.apply({
      id: `evt-m-ind-${i}`,
      sequence: 400 + i,
      kind: "memory-recorded",
      memoryKind: "witnessed",
      entityId: "zeus",
      sourceEventId: `evt-7-ind${i}`,
      eventKind: "theft",
      subjects: ["woodcutter", "farmer"],
      salience: 1,
      consequence: { effect: "harm", agent: "woodcutter", target: "farmer" },
    });
  }
  for (const salience of memories) {
    const subject =
      uniform || salience === 2 || salience === 5 ? "farmer" : people[salience];
    run.apply({
      id: `evt-m-${salience}`,
      sequence: 500 + salience,
      kind: "memory-recorded",
      memoryKind: "witnessed",
      entityId: "zeus",
      sourceEventId: `evt-7-1${salience}`,
      eventKind: "theft",
      subjects: ["woodcutter", subject],
      salience,
      consequence: { effect: "harm", agent: "woodcutter", target: subject },
    });
  }
  if (newest !== undefined) {
    run.apply({
      id: "evt-m-newest",
      sequence: 800,
      kind: "memory-recorded",
      memoryKind: "witnessed",
      entityId: "zeus",
      sourceEventId: "evt-7-1n",
      eventKind: "theft",
      subjects: ["woodcutter", people[newest]],
      salience: newest,
      consequence: {
        effect: "harm",
        agent: "woodcutter",
        target: people[newest],
      },
    });
  }
  for (const strength of feelings) {
    run.apply({
      id: `evt-r-${strength}`,
      sequence: 600 + strength,
      kind: "relationship-changed",
      entityId: "zeus",
      toward: people[10 + strength],
      affinityDelta: strength,
      grudgeDelta: 0,
      memoryEventId: "evt-7-11",
    });
  }
  const listeners = ["farmer", "hera", ...people.slice(0, 3)];
  const ownEvents = Array.from({ length: actions }, (_, i) => ({
    schemaVersion: 1,
    id: `evt-8-80${i}`,
    sequence: 700 + i,
    simTime: 0,
    tick: run.state.tick,
    correlationId: "fixture",
    causationId: "fixture",
    approximate: false,
    kind: "report-told",
    entityId: "zeus",
    listenerId: listeners[i],
    content: `Word ${i}.`.padEnd(actionText, "."),
  })) as unknown as WorldEvent[];
  const seen = perceive(run.state, id("zeus"), run.events);
  if (!seen) throw new Error("no snapshot");
  const recent: PerceivedEvent[] = Array.from({ length: events }, (_, i) => ({
    id: `evt-6-6${i}` as EventId,
    kind: "stock-spoiled",
    sequence: i + 1,
    subjects: [id(people[i] as string)],
    ...(eventText === 0 ? {} : { assertion: "e".repeat(eventText) }),
  }));
  const snapshot: PerceptionSnapshot = { ...seen, events: recent };
  const remembered = rememberedBy(run.state, id("zeus"), ownEvents);
  return {
    state: run.state,
    profile: godProfile("zeus"),
    snapshot,
    remembered,
    prayerIds,
    protectedIds,
    accusedBy,
  };
}

type World = ReturnType<typeof busyZeus>;

const chars = (w: Pick<World, "profile" | "snapshot" | "remembered">) =>
  requestChars(buildGodContext(w.profile, w.snapshot, w.remembered));

/** The ratio at which a bare request of `size` characters is exactly at the cap. */
const ratioAt = (size: number) => size / PROMPT_TOKEN_CAP;

const capAt = (w: World, ratio: number) =>
  fitToCap({
    profile: w.profile,
    state: w.state,
    actorId: id("zeus"),
    snapshot: w.snapshot,
    remembered: w.remembered,
    ratio,
  });

/** The same world shed to the cap and no further: what `fitToCap` starts its refill from. */
const shedAt = (w: World, ratio: number) =>
  shedToCap({
    profile: w.profile,
    state: w.state,
    actorId: id("zeus"),
    snapshot: w.snapshot,
    remembered: w.remembered,
    ratio,
  });

const shownText = (c: { context: { instructions?: string; prompt: string } }) =>
  `${c.context.instructions}\n${c.context.prompt}`;

/** Every ledger id the prompt, the schema and the parser could name. */
function idsIn(text: string): Set<string> {
  return new Set(text.match(/evt-[\w-]+/g) ?? []);
}

/** W04: every id the schema offers is one the prompt shows, and no shed id is in either. */
function expectAgreement(w: World, capped: ReturnType<typeof capAt>) {
  const schema = godIntentSchema(w.profile, capped.snapshot, capped.remembered);
  const text = shownText(capped);
  const offered = JSON.stringify(schema.jsonSchema);
  for (const evt of idsIn(offered)) expect(text).toContain(evt);
  const before = new Set<string>([
    ...w.snapshot.events.map((event) => event.id),
    ...w.remembered.memories.map((memory) => memory.sourceEventId),
    ...w.remembered.petitions.map((petition) => petition.id),
  ]);
  const after = new Set<string>([
    ...capped.snapshot.events.map((event) => event.id),
    ...capped.remembered.memories.map((memory) => memory.sourceEventId),
    ...capped.remembered.petitions.map((petition) => petition.id),
  ]);
  for (const gone of before) {
    if (after.has(gone)) continue;
    expect(text).not.toContain(gone);
    expect(offered).not.toContain(gone);
  }
}

describe("fitToCap: the fixture", () => {
  test("positive control: at the granite3.3 ratio the busy world is over the cap with nothing shed", () => {
    const w = busyZeus({ live: 1 });
    expect(w.remembered.petitions.length).toBeGreaterThan(3);
    expect(w.remembered.morePrayers).toBeGreaterThan(0);
    expect(w.remembered.memories).toHaveLength(6);
    expect(w.remembered.relationships).toHaveLength(5);
    expect(w.remembered.ownActions).toHaveLength(5);
    expect(
      fitsCap(buildGodContext(w.profile, w.snapshot, w.remembered), 2.75),
    ).toBe(false);
  });

  test("capped at the granite3.3 ratio, the busy world lands at or under the cap", () => {
    const w = busyZeus({ live: 1 });
    const capped = capAt(w, 2.75);
    expect(capped.fits).toBe(true);
    expect(capped.estimatedTokens).toBeLessThanOrEqual(PROMPT_TOKEN_CAP);
    expect(capped.ratio).toBe(2.75);
    expect(fitsCap({ ...capped.context }, 2.75)).toBe(true);
    expectAgreement(w, capped);
  });
});

describe("fitToCap: the order of shedding", () => {
  test("a world just over the cap sheds only recent events, oldest first", () => {
    const w = busyZeus();
    const kept = { ...w.snapshot, events: w.snapshot.events.slice(2) };
    const capped = capAt(w, ratioAt(chars({ ...w, snapshot: kept })));
    expect(capped.shed).toEqual({
      events: 2,
      actions: 0,
      memories: 0,
      prayers: 0,
    });
    expect(capped.snapshot.events).toEqual(w.snapshot.events.slice(2));
    expect(capped.remembered).toEqual(w.remembered);
    expectAgreement(w, capped);
  });

  test("then own actions, oldest first, and their goal-history rows go with them", () => {
    const w = busyZeus();
    const lighter = busyZeus({ events: 0, actions: 3 });
    const ratio = ratioAt(
      chars({ ...lighter, snapshot: { ...lighter.snapshot } }),
    );
    // The oldest two actions are shed; the lighter world holds the newest three, which the same events produce.
    const capped = capAt(w, ratio);
    expect(capped.shed).toEqual({
      events: 6,
      actions: 2,
      memories: 0,
      prayers: 0,
    });
    expect(capped.remembered.ownActions.map((event) => event.id)).toEqual(
      w.remembered.ownActions.slice(2).map((event) => event.id),
    );
    // The oldest action told the farmer, the goal's target: its row in the goal's history is gone with it.
    const oldest = w.remembered.ownActions[0]?.id;
    expect(
      w.remembered.goalHistory.some(
        (entry) => entry.kind === "action" && entry.event.id === oldest,
      ),
    ).toBe(true);
    expect(
      capped.remembered.goalHistory.some(
        (entry) => entry.kind === "action" && entry.event.id === oldest,
      ),
    ).toBe(false);
    expect(shownText(capped)).not.toContain("Word 0.");
    expect(shownText(capped)).toContain("Word 4.");
    expectAgreement(w, capped);
  });

  test("then memories, lowest salience first, re-derived like a world that never held them", () => {
    const w = busyZeus();
    const never = busyZeus({ events: 0, actions: 0, memories: [3, 4, 5, 6] });
    const capped = capAt(w, ratioAt(chars(never)));
    expect(capped.shed).toEqual({
      events: 6,
      actions: 5,
      memories: 2,
      prayers: 0,
    });
    expect(capped.remembered.memories.map((m) => m.salience)).toEqual([
      3, 4, 5, 6,
    ]);
    expect(capped.remembered).toEqual({ ...never.remembered });
    // Memory 2 was about the farmer, the goal's target: its goal-history row, its witnessed citation and its demand cause are gone.
    const gone = "evt-7-12" as EventId;
    expect(shownText(capped)).not.toContain(gone);
    expect(
      capped.remembered.practice.causes.map((cause) => cause.id),
    ).not.toContain(gone);
    expect(w.remembered.practice.causes.map((cause) => cause.id)).toContain(
      gone,
    );
    const schema = godIntentSchema(
      w.profile,
      capped.snapshot,
      capped.remembered,
    );
    expect(
      schema.parse({
        action: "report",
        listener: "hera",
        content: "x",
        linkedEventId: gone,
      }).ok,
    ).toBe(false);
    expectAgreement(w, capped);
  });

  test("a memory's schema entry goes with it: the world that still holds it can cite it", () => {
    const w = busyZeus();
    const schema = godIntentSchema(w.profile, w.snapshot, w.remembered);
    expect(
      schema.parse({
        action: "report",
        listener: "hera",
        content: "x",
        linkedEventId: "evt-7-12",
      }).ok,
    ).toBe(true);
  });

  test("then feelings, weakest first, once every memory is gone", () => {
    const w = busyZeus();
    // The newest memory (salience 6) is part of the floor, so it stays when every other is gone.
    const never = busyZeus({
      events: 0,
      actions: 0,
      memories: [6],
      feelings: [3, 4, 5],
    });
    const capped = capAt(w, ratioAt(chars(never)));
    expect(capped.shed).toEqual({
      events: 6,
      actions: 5,
      memories: 7,
      prayers: 0,
    });
    expect(capped.remembered.memories.map((m) => m.salience)).toEqual([6]);
    expect(capped.remembered).toEqual({ ...never.remembered });
    expectAgreement(w, capped);
  });

  test("then unprotected prayers, oldest first, with the 'and N more' line counting them", () => {
    const w = busyZeus();
    const total = w.remembered.petitions.length + w.remembered.morePrayers;
    const bare = busyZeus({
      events: 0,
      actions: 0,
      memories: [6],
      feelings: [],
    });
    // Room for the bare world and one unprotected prayer less than it shows.
    const shownBefore = bare.remembered.petitions.length;
    const unprotectedShown = shownBefore - w.protectedIds.length;
    expect(unprotectedShown).toBeGreaterThan(1);
    const capped = shedAt(w, ratioAt(chars(bare) - 1));
    expect(capped.shed.events).toBe(6);
    expect(capped.shed.actions).toBe(5);
    expect(capped.shed.memories).toBe(10);
    expect(capped.shed.prayers).toBe(1);
    expect(capped.remembered.petitions.map((p) => p.id)).toEqual(
      bare.remembered.petitions.slice(0, -1).map((p) => p.id),
    );
    expect(capped.remembered.morePrayers).toBe(total - (shownBefore - 1));
    expect(shownText(capped)).toContain(
      `- and ${capped.remembered.morePrayers} more prayers to you.`,
    );
    expectAgreement(w, capped);
    for (const gone of bare.remembered.petitions.slice(-1)) {
      expect(shownText(capped)).not.toContain(gone.id);
      const schema = godIntentSchema(
        w.profile,
        capped.snapshot,
        capped.remembered,
      );
      expect(schema.parse({ action: "refuse", petition: gone.id }).ok).toBe(
        false,
      );
      expect(schema.parse({ action: "bless", petition: gone.id }).ok).toBe(
        false,
      );
      expect(JSON.stringify(capped.remembered.practice)).not.toContain(gone.id);
    }
  });

  test("whatever the ratio, a tier is touched only once every tier before it is gone", () => {
    const w = busyZeus();
    const events = w.snapshot.events.length;
    const actions = w.remembered.ownActions.length;
    // Eleven units, less the newest memory the cap keeps.
    const memoriesAndFeelings = 10;
    let last = { events: 0, actions: 0, memories: 0, prayers: 0 };
    for (const ratio of [
      2.75, 2.6, 2.4, 2.2, 2.0, 1.8, 1.6, 1.4, 1.2, 1.0, 0.8, 0.5,
    ]) {
      const { shed, fits } = shedAt(w, ratio);
      if (shed.actions > 0) expect(shed.events).toBe(events);
      if (shed.memories > 0) expect(shed.actions).toBe(actions);
      if (shed.prayers > 0) expect(shed.memories).toBe(memoriesAndFeelings);
      // A tighter ratio never gives back what a looser one shed.
      expect(shed.events).toBeGreaterThanOrEqual(last.events);
      expect(shed.actions).toBeGreaterThanOrEqual(last.actions);
      expect(shed.memories).toBeGreaterThanOrEqual(last.memories);
      expect(shed.prayers).toBeGreaterThanOrEqual(last.prayers);
      last = shed;
      expect(typeof fits).toBe("boolean");
    }
  });
});

describe("fitToCap: the floor", () => {
  test("protected prayers survive when every other prayer is shed, with their choices intact, and the goal stays", () => {
    const w = busyZeus();
    const capped = capAt(w, 0.5);
    expect(capped.fits).toBe(false);
    expect(capped.snapshot.events).toEqual([]);
    expect(capped.remembered.ownActions).toEqual([]);
    // Only the newest memory is left (it is part of the floor), and no feeling.
    expect(capped.remembered.memories.map((m) => m.salience)).toEqual([6]);
    expect(capped.remembered.relationships).toEqual([]);
    // The prayers a live practice names, and the one prayer the god can answer.
    const answerable = w.remembered.petitions
      .filter((petition) => !w.protectedIds.includes(petition.id))
      .sort(
        (a, b) =>
          (w.state.petitions.get(b.id)?.sequence ?? 0) -
          (w.state.petitions.get(a.id)?.sequence ?? 0),
      )[0] as { id: string };
    expect(capped.remembered.petitions.map((p) => p.id).sort()).toEqual(
      [...w.protectedIds, answerable.id as EventId].sort(),
    );
    for (const kept of capped.remembered.petitions) {
      expect(w.remembered.petitions).toContainEqual(kept);
    }
    // One is the prayer of an accepted offer (a boon owed), one an open offer.
    expect(capped.remembered.threads).toEqual(w.remembered.threads);
    expect(
      capped.remembered.threads.some((view) => view.owedBoon !== undefined),
    ).toBe(true);
    expect(capped.remembered.goal).toEqual(w.remembered.goal);
    expect(shownText(capped)).toContain(
      'Your goal: "Keep watch over the farmer."',
    );
    expect(capped.shed).toEqual({
      events: 6,
      actions: 5,
      memories: 10,
      prayers: w.remembered.petitions.length - 4,
    });
    expectAgreement(w, capped);
  });

  test("a god with no prayers and no events sheds its own actions and memories, and tells of no 'and 0 more'", () => {
    const w = busyZeus({ prayers: 0, events: 0 });
    expect(w.remembered.petitions).toEqual([]);
    const capped = capAt(w, 0.5);
    expect(capped.shed.events).toBe(0);
    expect(capped.shed.actions).toBe(5);
    expect(capped.shed.memories).toBe(10);
    expect(capped.shed.prayers).toBe(0);
    expect(shownText(capped)).not.toContain(PRAYERS_HEADING);
    expect(shownText(capped)).not.toContain("more prayers");
  });
});

describe("fitToCap: no room is kept for a retry's note", () => {
  // The room a retry's note once took (some 470 characters, 165 tokens) is not taken from the prompt. The router
  // trims the note to the room left instead, so a world that fits as built keeps everything it holds. S13's
  // blame memory and S21's punish prayer were what the reserve cost; the story run holds those worlds, this holds
  // the shape: a world exactly at the cap keeps its memory a demand rests on and its punish prayer.
  const RESERVE = 470;

  test("a world whose bare request is at the cap sheds nothing, and keeps the memory a demand rests on and the punish prayer", () => {
    const w = busyZeus({ events: 0, actions: 0, mixedPrayers: true });
    const punish = w.remembered.petitions.filter(
      (petition) => petition.request.kind === "punish",
    );
    expect(punish.length).toBeGreaterThan(0);
    expect(w.remembered.practice.causes.length).toBeGreaterThan(0);

    const capped = capAt(w, ratioAt(chars(w)));
    expect(capped.shed).toEqual({
      events: 0,
      actions: 0,
      memories: 0,
      prayers: 0,
    });
    expect(capped.remembered).toBe(w.remembered);
    expect(capped.estimatedTokens).toBe(PROMPT_TOKEN_CAP);
    for (const petition of punish) {
      expect(shownText(capped)).toContain(petition.id);
    }
    for (const cause of w.remembered.practice.causes) {
      expect(shownText(capped)).toContain(cause.id);
    }
  });

  test("the same world 470 characters over the cap does shed: the reserve was what cost it units", () => {
    const w = busyZeus({ events: 0, actions: 0, mixedPrayers: true });
    const capped = capAt(w, ratioAt(chars(w) - RESERVE));
    expect(Object.values(capped.shed).some((n) => n > 0)).toBe(true);
    expect(capped.fits).toBe(true);
    expect(requestChars(capped.context)).toBeLessThanOrEqual(
      chars(w) - RESERVE,
    );
  });
});

describe("fitToCap: the boundary", () => {
  test("at the cap exactly nothing is shed; one character over, exactly one unit is", () => {
    const w = busyZeus();
    const full = chars(w);
    const atCap = capAt(w, ratioAt(full));
    expect(atCap.shed).toEqual({
      events: 0,
      actions: 0,
      memories: 0,
      prayers: 0,
    });
    expect(atCap.snapshot).toBe(w.snapshot);
    expect(atCap.remembered).toBe(w.remembered);
    expect(atCap.estimatedTokens).toBe(PROMPT_TOKEN_CAP);
    const over = capAt(w, ratioAt(full - 1));
    expect(over.shed).toEqual({
      events: 1,
      actions: 0,
      memories: 0,
      prayers: 0,
    });
    expect(over.snapshot.events.map((e) => e.id)).toEqual(
      w.snapshot.events.slice(1).map((e) => e.id),
    );
  });
});

describe("fitToCap: the refill", () => {
  /**
   * Hera's tick-99 turn under granite3.3, in Zeus's world: two memories and a feeling, one recent event and one
   * action of their own that are long, and prayers over the budget. Tier 3 runs out before one prayer closes the gap.
   */
  const heraShape = () =>
    busyZeus({
      events: 1,
      actions: 1,
      memories: [3, 4],
      feelings: [2],
      eventText: 380,
      actionText: 380,
    });

  test("Hera's turn: the shed runs out of memories and feelings before one prayer closes the gap, and the refill brings the memories and the feeling back", () => {
    const w = heraShape();
    const ratio = loosestPrayerRatio(w);
    const gross = shedAt(w, ratio);
    // Everything of tiers 1 to 3 went but the newest memory, which the cap keeps (the other memory and the feeling
    // are two units), and one prayer more.
    expect(gross.shed).toEqual({
      events: 1,
      actions: 1,
      memories: 2,
      prayers: 1,
    });
    expect(gross.remembered.memories.map((m) => m.salience)).toEqual([4]);
    expect(gross.remembered.relationships).toEqual([]);

    const capped = capAt(w, ratio);
    expect(capped.shed).toEqual({
      events: 1,
      actions: 1,
      memories: 0,
      prayers: 1,
    });
    // Exact survivors: both memories and the feeling are back, whole; the long event and action stay out.
    expect(capped.remembered.memories).toEqual(w.remembered.memories);
    expect(capped.remembered.relationships).toEqual(w.remembered.relationships);
    expect(capped.remembered.ownActions).toEqual([]);
    expect(capped.snapshot.events).toEqual([]);
    // The prayer stays shed, with the 'and N more' line counting it.
    expect(capped.remembered.petitions.map((p) => p.id)).toEqual(
      gross.remembered.petitions.map((p) => p.id),
    );
    expect(capped.remembered.morePrayers).toBe(gross.remembered.morePrayers);
    // What came back is cited and offered like what was never shed (W04).
    const basis = capped.remembered.practice.causes.map((cause) => cause.id);
    for (const memory of w.remembered.memories) {
      expect(basis).toContain(memory.sourceEventId);
    }
    const schema = godIntentSchema(
      w.profile,
      capped.snapshot,
      capped.remembered,
    );
    for (const memory of w.remembered.memories) {
      expect(
        schema.parse({
          action: "report",
          listener: "hera",
          content: "x",
          linkedEventId: memory.sourceEventId,
        }).ok,
      ).toBe(true);
    }
    expectAgreement(w, capped);
    // It fits, and the unshed world is the positive control: it does not.
    expect(capped.fits).toBe(true);
    expect(capped.estimatedTokens).toBeLessThanOrEqual(PROMPT_TOKEN_CAP);
    expect(fitsCap(capped.context, ratio)).toBe(true);
    expect(
      fitsCap(buildGodContext(w.profile, w.snapshot, w.remembered), ratio),
    ).toBe(false);
  });

  test("with room for one re-add only, the most salient memory comes back and not a lower one, and the goal-history row comes with it", () => {
    // Every memory is of one size and about the goal's target, and each has its row in the goal's history (the
    // history shows four), so only salience says which comes back first.
    const w = busyZeus({
      events: 0,
      actions: 0,
      memories: [3, 4, 5, 6],
      feelings: [],
      uniform: true,
    });
    const start = loosestPrayerRatio(w);
    let one = 0;
    for (let step = 0; step < 600; step += 1) {
      const ratio = start - step * 0.0005;
      const gross = shedAt(w, ratio);
      if (gross.shed.prayers !== 1) break;
      const capped = capAt(w, ratio);
      const back = capped.remembered.memories.map((m) => m.salience);
      // Whatever comes back is the top of the shed memories, never a lower one while a higher one is out.
      expect(back).toEqual([6, 5, 4, 3].slice(0, back.length).reverse());
      if (back.length === 1) {
        one += 1;
        expect(back).toEqual([6]);
        const rows = capped.remembered.goalHistory.flatMap((entry) =>
          entry.kind === "memory" ? [entry.memory.salience] : [],
        );
        expect(rows).toEqual([6]);
        expectAgreement(w, capped);
      }
      expect(capped.fits).toBe(true);
    }
    // The scan met ratios with room for exactly one.
    expect(one).toBeGreaterThan(0);
  });

  test("a shed prayer is never re-added, however much room is left: the prayers are those the shed left, at every ratio", () => {
    const w = busyZeus({
      events: 0,
      actions: 0,
      memories: [],
      feelings: [],
      prayers: 12,
      mixedPrayers: true,
    });
    const start = loosestPrayerRatio(w);
    let fewest = Number.POSITIVE_INFINITY;
    let sweeps = 0;
    let most = 0;
    for (let step = 0; step < 4000; step += 1) {
      const ratio = start - step * 0.0005;
      const gross = shedAt(w, ratio);
      if (!gross.fits) break;
      const capped = capAt(w, ratio);
      expect(capped.remembered.petitions.map((p) => p.id)).toEqual(
        gross.remembered.petitions.map((p) => p.id),
      );
      expect(capped.remembered.morePrayers).toBe(gross.remembered.morePrayers);
      expect(capped.shed.prayers).toBe(gross.shed.prayers);
      sweeps += 1;
      most = Math.max(most, gross.shed.prayers);
      fewest = Math.min(fewest, gross.shed.prayers);
    }
    expect(sweeps).toBeGreaterThan(100);
    expect(fewest).toBe(1);
    expect(most).toBeGreaterThan(1);
  });

  test("whatever the ratio, the refilled request fits and is no smaller than the shed one, brings back no more than was shed, and the unshed world is over the cap", () => {
    for (const w of [
      busyZeus(),
      busyZeus({ live: 1 }),
      heraShape(),
      busyZeus({ uniform: true, mixedPrayers: true }),
    ]) {
      const unshed = buildGodContext(w.profile, w.snapshot, w.remembered);
      for (let ratio = 3.6; ratio >= 0.5; ratio -= 0.05) {
        const gross = shedAt(w, ratio);
        const capped = capAt(w, ratio);
        expect(capped.fits).toBe(gross.fits);
        if (!capped.fits) continue;
        expect(capped.estimatedTokens).toBeLessThanOrEqual(PROMPT_TOKEN_CAP);
        expect(fitsCap(capped.context, ratio)).toBe(true);
        expect(capped.estimatedTokens).toBeGreaterThanOrEqual(
          gross.estimatedTokens,
        );
        for (const tier of ["events", "actions", "memories"] as const) {
          expect(capped.shed[tier]).toBeLessThanOrEqual(gross.shed[tier]);
        }
        expect(capped.shed.prayers).toBe(gross.shed.prayers);
        // The rebuilt prompt is the one the reduced pair makes.
        expect(capped.context).toEqual(
          buildGodContext(w.profile, capped.snapshot, capped.remembered),
        );
        expectAgreement(w, capped);
        // Positive control: with no shedding, a world that was shed is over the cap.
        if (Object.values(gross.shed).some((n) => n > 0)) {
          expect(fitsCap(unshed, ratio)).toBe(false);
        }
      }
    }
  });
});

/** The loosest ratio at which `shedToCap` has to shed at least one prayer: just below it, one prayer closes the gap. */
function loosestPrayerRatio(w: World): number {
  let lo = 0.5;
  let hi = 4;
  for (let step = 0; step < 60; step += 1) {
    const mid = (lo + hi) / 2;
    if (shedAt(w, mid).shed.prayers >= 1) lo = mid;
    else hi = mid;
  }
  return lo;
}

describe("fitToCap: goal-history rows the shown memories and actions do not back", () => {
  /**
   * `rememberedBy` keeps goal history from a wider ledger than the memories and actions it shows (at most 6 and 5):
   * a row may rest on a memory or an action that is in neither slice. Two such rows are put in the middle of the
   * history here, around the rows the shown ones back, so a rebuild from the shown slices would lose them.
   */
  function withOutsideRows(w: World) {
    const [memory] = w.remembered.memories;
    const [action] = w.remembered.ownActions;
    if (memory === undefined || action === undefined) {
      throw new Error("the fixture needs a memory and an action");
    }
    const rows = w.remembered.goalHistory;
    const middle = Math.floor(rows.length / 2);
    const outsideMemory: GoalHistoryEntry = {
      kind: "memory",
      sequence: -2,
      memory: {
        ...memory,
        id: "evt-m-outside" as typeof memory.id,
        sourceEventId: "evt-7-outside" as typeof memory.sourceEventId,
      },
    };
    const outsideAction: GoalHistoryEntry = {
      kind: "action",
      sequence: -1,
      event: { ...action, id: "evt-8-outside" as typeof action.id },
    };
    const goalHistory = [
      ...rows.slice(0, middle),
      outsideMemory,
      outsideAction,
      ...rows.slice(middle),
    ];
    const world: World = {
      ...w,
      remembered: { ...w.remembered, goalHistory },
    };
    return { world, outside: [outsideMemory, outsideAction] };
  }

  const fixture = () =>
    withOutsideRows(
      busyZeus({ memories: [3, 4, 5], actions: 3, uniform: true }),
    );

  /** The shown ledger a row rests on is still shown. */
  const backed = (
    entry: GoalHistoryEntry,
    remembered: {
      memories: readonly { id: string }[];
      ownActions: readonly { id: string }[];
    },
  ) =>
    entry.kind === "memory"
      ? remembered.memories.some((m) => m.id === entry.memory.id)
      : remembered.ownActions.some((a) => a.id === entry.event.id);

  test("positive control: the fixture holds rows no shown memory or action backs, and rows that some do", () => {
    const { world, outside } = fixture();
    const rows = world.remembered.goalHistory;
    for (const entry of outside) {
      expect(rows).toContain(entry);
      expect(backed(entry, world.remembered)).toBe(false);
    }
    expect(
      rows.filter((entry) => backed(entry, world.remembered)).length,
    ).toBeGreaterThan(1);
  });

  test("restoring a memory or an action keeps every independent row the request holds, never adds one on its own, and the result fits", () => {
    const { world: w, outside } = fixture();
    let restored = 0;
    for (let ratio = loosestPrayerRatio(w); ratio >= 1.5; ratio -= 0.01) {
      const gross = shedAt(w, ratio);
      if (!gross.fits) break;
      const capped = capAt(w, ratio);
      const back =
        capped.remembered.memories.length > gross.remembered.memories.length ||
        capped.remembered.ownActions.length >
          gross.remembered.ownActions.length;
      // A row the shed kept is never lost to a restore.
      for (const entry of outside) {
        if (gross.remembered.goalHistory.includes(entry)) {
          expect(capped.remembered.goalHistory).toContain(entry);
        }
      }
      expect(capped.fits).toBe(true);
      expect(fitsCap(capped.context, ratio)).toBe(true);
      if (back) restored += 1;
      expectAgreement(w, capped);
    }
    // The scan met ratios where something came back.
    expect(restored).toBeGreaterThan(0);
  });

  test("shedding a unit removes the goal-history rows that unit backs and no other, and an independent row goes before any shown memory", () => {
    const { world: w, outside } = fixture();
    const rows = w.remembered.goalHistory;
    let shedSome = 0;
    let shedRows = 0;
    for (let ratio = 3.2; ratio >= 1.5; ratio -= 0.02) {
      const gross = shedAt(w, ratio);
      if (!gross.fits) break;
      const goneMemories = new Set(
        w.remembered.memories
          .filter((m) => !gross.remembered.memories.includes(m))
          .map((m) => m.id),
      );
      const goneActions = new Set(
        w.remembered.ownActions
          .filter((a) => !gross.remembered.ownActions.includes(a))
          .map((a) => a.id),
      );
      // The rows a shed unit backed are out, and every other row is either held or one of the independent ones.
      const kept = gross.remembered.goalHistory;
      for (const entry of rows) {
        const unitGone =
          entry.kind === "memory"
            ? goneMemories.has(entry.memory.id)
            : goneActions.has(entry.event.id);
        if (unitGone) expect(kept).not.toContain(entry);
        if (!outside.includes(entry) && !unitGone) {
          expect(kept).toContain(entry);
        }
      }
      expect(kept).toEqual(rows.filter((entry) => kept.includes(entry)));
      // Independent rows go oldest first, and none is left once a shown memory has gone.
      const left = outside.filter((entry) => kept.includes(entry));
      if (left.length > 0) expect(left).toEqual(outside.slice(-left.length));
      if (goneMemories.size > 0) expect(left).toEqual([]);
      if (left.length < outside.length) shedRows += 1;
      if (goneMemories.size + goneActions.size > 0) shedSome += 1;
    }
    expect(shedSome).toBeGreaterThan(0);
    expect(shedRows).toBeGreaterThan(0);
  });

  test("a restored unit brings back only its own rows, and every row is in its original order, at every ratio", () => {
    const { world: w } = fixture();
    const rows = w.remembered.goalHistory;
    let checked = 0;
    for (let ratio = 3.4; ratio >= 1.5; ratio -= 0.01) {
      const gross = shedAt(w, ratio);
      if (!gross.fits) break;
      const capped = capAt(w, ratio);
      const kept = capped.remembered.goalHistory;
      // The history is the original with some rows out, never reordered or added to.
      expect(kept).toEqual(rows.filter((entry) => kept.includes(entry)));
      // A row a shown unit backs is shown exactly when its unit is.
      for (const entry of rows) {
        if (backed(entry, w.remembered)) {
          expect(kept.includes(entry)).toBe(backed(entry, capped.remembered));
        }
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(20);
  });
});

// --- The causal set ---------------------------------------------------------------------------
//
// Beyond the floor the cap keeps three things, fixed from the world as built: the newest memory, the evidence
// behind the demand opening shown first, and one prayer the god can answer.

describe("the causal set: the newest memory", () => {
  test("rememberedBy admits the newest memory first, even when its salience is the lowest of more than six", () => {
    // Seven memories: salience 3 to 7 and a newest one of salience 1. By salience alone the newest is left out.
    const w = busyZeus({
      memories: [3, 4, 5, 6, 7],
      newest: 1,
      accusers: [{ teller: "hera", salience: 2 }],
      live: 1,
      feelings: [],
    });
    const shown = w.remembered.memories;
    expect(shown).toHaveLength(6);
    expect(shown.map((m) => String(m.id))).toContain("evt-m-newest");
    // The least salient of the rest (the accusation, salience 2) is the one left out; the order is oldest first.
    expect(shown.some((m) => m.salience === 2)).toBe(false);
    expect(String(shown.at(-1)?.id)).toBe("evt-m-newest");
  });

  test("S13's shape: the newest memory survives a cap that sheds every memory by salience, and a prayer goes instead", () => {
    const w = busyZeus({
      live: 1,
      events: 0,
      actions: 0,
      feelings: [],
      memories: [5, 6, 7],
      newest: 1,
    });
    const ratio = loosestPrayerRatio(w);
    const gross = shedAt(w, ratio);
    expect(gross.shed.memories).toBe(3);
    expect(gross.shed.prayers).toBeGreaterThanOrEqual(1);
    // Exact survivors: the newest memory alone; every other memory is gone and some unprotected prayers with them.
    expect(gross.remembered.memories.map((m) => String(m.id))).toEqual([
      "evt-m-newest",
    ]);
    expect(gross.remembered.petitions.map((p) => p.id)).toEqual(
      w.remembered.petitions
        .slice(0, w.remembered.petitions.length - gross.shed.prayers)
        .map((p) => p.id),
    );
    expect(shownText(gross)).toContain("evt-7-1n");
    for (const salience of [5, 6, 7]) {
      expect(shownText(gross)).not.toContain(`evt-7-1${salience}`);
    }
    // The memory is cited in the schema and the parser as it was.
    const schema = godIntentSchema(w.profile, gross.snapshot, gross.remembered);
    expect(
      schema.parse({
        action: "report",
        listener: "hera",
        content: "x",
        linkedEventId: "evt-7-1n",
      }).ok,
    ).toBe(true);
    expectAgreement(w, gross);
    // It also survives the refill.
    const capped = capAt(w, ratio);
    expect(capped.remembered.memories.map((m) => String(m.id))).toContain(
      "evt-m-newest",
    );
    expect(capped.fits).toBe(true);
  });
});

describe("the causal set: the evidence behind the demand opening shown first", () => {
  const accused = (extra: Partial<WorldOptions> = {}) =>
    busyZeus({
      live: 1,
      events: 0,
      actions: 0,
      feelings: [],
      memories: [5, 6, 7],
      newest: 3,
      accusers: [{ teller: "hera", salience: 2 }],
      ...extra,
    });

  test("the first demand's cause memory survives a cap that would shed it, and its citation stays valid in the schema and the parser", () => {
    const w = accused();
    const first = w.remembered.practice.openings[0];
    expect(first?.kind).toBe("demand");
    const memory = w.accusedBy[0] as { cause: string };
    const ratio = loosestPrayerRatio(w);
    const gross = shedAt(w, ratio);
    // The evidence is the least salient memory but one the cap does not shed: it and the newest memory are what is left.
    expect(gross.remembered.memories.map((m) => m.salience).sort()).toEqual([
      2, 3,
    ]);
    expect(gross.remembered.practice.openings[0]).toEqual(first);
    expect(shownText(gross)).toContain(first?.label as string);
    const schema = godIntentSchema(w.profile, gross.snapshot, gross.remembered);
    expect(schema.parse(first?.intent).ok).toBe(true);
    expect(JSON.stringify(schema.jsonSchema)).toContain(memory.cause);
    expectAgreement(w, gross);
    // And a bare cap sheds a memory that the cap with this protection keeps: the positive control.
    expect(w.remembered.memories.map((m) => m.salience)).toContain(2);
  });

  test("only the opening shown first is protected: with two accusers, the other's evidence is shed", () => {
    const w = accused({
      accusers: [
        { teller: "hera", salience: 2 },
        { teller: "poseidon", salience: 3 },
      ],
    });
    const first = w.remembered.practice.openings[0];
    expect(first?.kind).toBe("demand");
    // Poseidon's account is the more salient, so the opening rests on it.
    expect(first?.label).toContain("poseidon");
    const gross = shedAt(w, loosestPrayerRatio(w));
    const told = gross.remembered.memories.filter((m) => m.kind === "told");
    expect(
      told.map((m) => (m.kind === "told" ? String(m.teller) : "")),
    ).toEqual(["poseidon"]);
    expect(gross.remembered.practice.openings[0]).toEqual(first);
    expectAgreement(w, gross);
  });
});

describe("the causal set: one answerable prayer", () => {
  /** The floor and nothing else the cap may shed: every unprotected prayer that can go, goes. */
  const squeezed = (w: World) => capAt(w, 0.5);

  test("the prayer the first offer names survives, with its choices intact", () => {
    const w = busyZeus({
      live: 1,
      events: 0,
      actions: 0,
      feelings: [],
      memories: [],
    });
    const offer = w.remembered.practice.openings.find(
      (opening) => opening.kind === "offer",
    );
    const named = offer?.intent.prayer as EventId;
    expect(named).toBeDefined();
    expect(w.protectedIds).not.toContain(named);
    const capped = squeezed(w);
    expect(capped.remembered.petitions.map((p) => p.id).sort()).toEqual(
      [...w.protectedIds, named].sort(),
    );
    const kept = capped.remembered.petitions.find((p) => p.id === named);
    const was = w.remembered.petitions.find((p) => p.id === named);
    expect(kept).toEqual(was);
    // Its choices: help freely, set terms, refuse.
    expect(kept?.bless).toBeDefined();
    expect(kept?.offer).toBeDefined();
    expect(kept?.refuse).toBeDefined();
    expect(capped.remembered.practice.openings).toContainEqual(
      offer as NonNullable<typeof offer>,
    );
    expectAgreement(w, capped);
  });

  test("with no offer naming one, the newest prayer the god can answer survives, with its choices intact", () => {
    // A boon is owed, so no terms are offered on any prayer: no opening and no offer names a prayer.
    const w = busyZeus({ events: 0, actions: 0, feelings: [], memories: [] });
    expect(w.remembered.practice.openings).toEqual([]);
    expect(w.remembered.petitions.some((p) => p.offer !== undefined)).toBe(
      false,
    );
    const newest = w.remembered.petitions
      .filter((p) => !w.protectedIds.includes(p.id))
      .sort(
        (a, b) =>
          (w.state.petitions.get(b.id)?.sequence ?? 0) -
          (w.state.petitions.get(a.id)?.sequence ?? 0),
      )[0] as World["remembered"]["petitions"][number];
    const capped = squeezed(w);
    expect(capped.remembered.petitions.map((p) => p.id).sort()).toEqual(
      [...w.protectedIds, newest.id].sort(),
    );
    expect(capped.remembered.petitions.find((p) => p.id === newest.id)).toEqual(
      newest,
    );
    expect(newest.bless).toBeDefined();
    expect(newest.refuse).toBeDefined();
    expectAgreement(w, capped);
  });
});

describe("the causal set: fixed once", () => {
  test("the set is read from the world as built, and shedding adds nothing to it", () => {
    const w = busyZeus({
      live: 1,
      events: 0,
      actions: 0,
      feelings: [],
      memories: [5, 6, 7],
      newest: 3,
      accusers: [
        { teller: "hera", salience: 2 },
        { teller: "poseidon", salience: 4 },
      ],
    });
    const input = {
      profile: w.profile,
      state: w.state,
      actorId: id("zeus"),
      snapshot: w.snapshot,
      remembered: w.remembered,
      ratio: 0.5,
    };
    const set = causalSet(input);
    // The newest memory and poseidon's account, the one the first demand opening rests on; the offer's prayer.
    expect([...set.memories].map(String).sort()).toEqual(
      [
        "evt-m-newest",
        String(
          w.remembered.practice.causes.find(
            (cause) =>
              cause.id === w.remembered.practice.openings[0]?.intent.cause,
          )?.memoryId,
        ),
      ].sort(),
    );
    expect(set.prayers.size).toBe(1);
    // Reading it again from what the shed left asks the world about survivors only, and finds no more.
    const squeezed = shedToCap(input, set);
    const again = causalSet({ ...input, remembered: squeezed.remembered });
    expect(again.memories).toEqual(set.memories);
    expect(again.prayers).toEqual(set.prayers);
    // Everything that survives of the set is the set: no other memory, and one prayer beyond the live practice.
    expect(
      squeezed.remembered.memories.map((m) => String(m.id)).sort(),
    ).toEqual([...set.memories].sort());
    expect(
      squeezed.remembered.petitions
        .map((p) => p.id)
        .filter((pid) => !w.protectedIds.includes(pid)),
    ).toEqual([...set.prayers]);
  });
});

describe("the causal set: frozen before any shed", () => {
  test("shedding keeps exactly the set it was given and never asks the survivors for another", () => {
    const w = busyZeus({
      live: 1,
      events: 0,
      actions: 0,
      feelings: [],
      memories: [5, 6, 7],
      newest: 3,
      accusers: [{ teller: "hera", salience: 2 }],
    });
    const input = {
      profile: w.profile,
      state: w.state,
      actorId: id("zeus"),
      snapshot: w.snapshot,
      remembered: w.remembered,
      ratio: 0.5,
    };
    // A set the world would never derive: the memory of salience 6 alone, and no prayer.
    const given = {
      memories: new Set([toEntityId("evt-m-6") as unknown as EventId]),
      prayers: new Set<EventId>(),
    };
    expect(
      causalSet(input).memories.has(
        given.memories.values().next().value as EventId,
      ),
    ).toBe(false);
    const squeezed = shedToCap(input, given);
    expect(squeezed.remembered.memories.map((m) => String(m.id))).toEqual([
      "evt-m-6",
    ]);
    // Only the prayers a live practice names are left.
    expect(squeezed.remembered.petitions.map((p) => p.id)).toEqual(
      w.protectedIds,
    );
  });
});

describe("the causal set: the floor plus the set over the cap", () => {
  test("is not sent: the cap reports it does not fit, however it is asked", () => {
    const w = busyZeus({
      live: 1,
      events: 0,
      actions: 0,
      feelings: [],
      memories: [5, 6, 7],
      newest: 3,
      accusers: [{ teller: "hera", salience: 2 }],
    });
    const squeezed = capAt(w, 0.5);
    // At the size of the floor and the set exactly, it fits; one character less and it does not.
    const exact = requestChars(squeezed.context);
    expect(capAt(w, ratioAt(exact)).fits).toBe(true);
    const over = capAt(w, ratioAt(exact - 1));
    expect(over.fits).toBe(false);
    expect(over.remembered.memories).toEqual(squeezed.remembered.memories);
    // The set is what is over: the same world with no memory to keep is smaller than the size that did not fit.
    const floorOnly = busyZeus({
      live: 1,
      events: 0,
      actions: 0,
      feelings: [],
      memories: [],
    });
    const floor = requestChars(capAt(floorOnly, 0.5).context);
    expect(floor).toBeLessThan(exact - 1);
    expect(capAt(floorOnly, ratioAt(exact - 1)).fits).toBe(true);
  });
});

// --- Goal-history rows that no shown unit backs ---------------------------------------------------
//
// `rememberedBy` takes the goal's history from every memory and own action about the goal's target since the goal
// was set, not only from the shown ones, so a row may rest on a memory or action the prompt does not show. Such a
// row (96 characters on Zeus's turns at ticks 6463-7029 of the 2026-10-08 rerun) sheds with nothing. It is the
// lowest-valued unit of the memories tier, so it goes before the least salient shown memory.

type History = World["remembered"]["goalHistory"][number];

/** A goal-history row that none of `remembered`'s shown memories or own actions backs. */
const isIndependent = (
  entry: History,
  remembered: World["remembered"],
): boolean =>
  entry.kind === "memory"
    ? !remembered.memories.some((m) => m.id === entry.memory.id)
    : !remembered.ownActions.some((e) => e.id === entry.event.id);

const independentOf = (remembered: World["remembered"]) =>
  remembered.goalHistory.filter((entry) => isIndependent(entry, remembered));

describe("independent goal-history rows", () => {
  const world = (options: Partial<WorldOptions> = {}) =>
    busyZeus({
      live: 1,
      independent: 1,
      events: 0,
      actions: 0,
      feelings: [],
      ...options,
    });

  test("the fixture holds a row that no shown memory backs, older than the rows that shown memories back", () => {
    const w = world();
    expect(w.remembered.memories).toHaveLength(6);
    const independent = independentOf(w.remembered);
    expect(independent).toHaveLength(1);
    expect(w.remembered.goalHistory[0]).toBe(independent[0]);
    expect(w.remembered.goalHistory).toHaveLength(3);
  });

  test("the shed takes the independent row first in the memories tier, before the least salient shown memory, and touches nothing else", () => {
    const w = world();
    const full = chars(w);
    const one = shedAt(w, ratioAt(full - 1));
    expect(one.shed).toEqual({
      events: 0,
      actions: 0,
      memories: 1,
      prayers: 0,
    });
    // Exact survivors: every shown memory, and every row but the independent one, in their order.
    expect(one.remembered.memories).toEqual(w.remembered.memories);
    expect(one.remembered.goalHistory).toEqual(
      w.remembered.goalHistory.slice(1),
    );
    expect(one.remembered.goal).toEqual(w.remembered.goal);
    expect(shownText(one)).toContain(
      'Your goal: "Keep watch over the farmer."',
    );
    expect(shownText(one)).not.toContain("evt-7-ind0");
    expectAgreement(w, one);
    // One unit more: now the least salient shown memory goes, with the row it backs, if it has one.
    const rowless = chars({
      ...w,
      snapshot: one.snapshot,
      remembered: one.remembered,
    });
    const two = shedAt(w, ratioAt(rowless - 1));
    expect(two.shed.memories).toBe(2);
    expect(two.remembered.memories.map((m) => m.salience)).toEqual([
      2, 3, 4, 5, 6,
    ]);
    expectAgreement(w, two);
  });

  test("Zeus's tick-6463 shape: at the floor and the causal set, 40 characters over because of the independent row; capped, it fits, and the row went before anything protected", () => {
    const w = world({ mixedPrayers: true });
    // The floor the cap reaches: every shown unit shed that may be.
    const floor = capAt(w, 0.5);
    expect(floor.remembered.goalHistory).toEqual(
      floor.remembered.goalHistory.filter(
        (e) => !isIndependent(e, floor.remembered),
      ),
    );
    // The same floor with the independent row put back: what the cap measured before the row could be shed.
    const withRow = {
      ...floor.remembered,
      goalHistory: w.remembered.goalHistory.filter(
        (e) =>
          isIndependent(e, w.remembered) ||
          floor.remembered.goalHistory.includes(e),
      ),
    };
    const heavy = requestChars(
      buildGodContext(w.profile, floor.snapshot, withRow),
    );
    const light = requestChars(floor.context);
    expect(heavy - light).toBeGreaterThanOrEqual(40);
    const capped = capAt(w, ratioAt(heavy - 40));
    expect(capped.fits).toBe(true);
    expect(independentOf(capped.remembered)).toEqual([]);
    // What is protected is all there: the goal, the causal set, the prayer a live practice names.
    expect(capped.remembered.goal).toEqual(w.remembered.goal);
    const set = causalSet({
      profile: w.profile,
      state: w.state,
      actorId: id("zeus"),
      snapshot: w.snapshot,
      remembered: w.remembered,
      ratio: 0.5,
    });
    const kept = new Set(capped.remembered.memories.map((m) => m.id));
    for (const memory of set.memories) expect(kept.has(memory)).toBe(true);
    const prayers = new Set(capped.remembered.petitions.map((p) => p.id));
    for (const prayer of [...set.prayers, ...w.protectedIds]) {
      expect(prayers.has(prayer)).toBe(true);
    }
    expectAgreement(w, capped);
    // Positive control: with the row unsheddable the same limit does not fit.
    const stuck = buildGodContext(w.profile, floor.snapshot, withRow);
    expect(fitsCap(stuck, ratioAt(heavy - 40))).toBe(false);
  });

  test("the refill restores a shed independent row in its original place, and only after what is worth more", () => {
    const w = world();
    let restored = 0;
    for (let size = chars(w) - 1; size > chars(w) - 1200; size -= 1) {
      const ratio = ratioAt(size);
      const gross = shedAt(w, ratio);
      const net = capAt(w, ratio);
      const grossRows = independentOf(gross.remembered);
      const netRows = independentOf(net.remembered);
      if (grossRows.length === 0 && netRows.length === 1) {
        restored += 1;
        // Original place: first, ahead of every row a shown memory backs.
        expect(net.remembered.goalHistory[0]).toBe(w.remembered.goalHistory[0]);
        expect(net.remembered.goalHistory).toEqual(
          w.remembered.goalHistory.filter((e) =>
            net.remembered.goalHistory.includes(e),
          ),
        );
        expect(net.fits).toBe(true);
        expect(net.estimatedTokens).toBeLessThanOrEqual(PROMPT_TOKEN_CAP);
        expectAgreement(w, net);
        // Everything worth more that was shed is back first: no shown memory the shed took is still out.
        expect(net.remembered.memories.length).toBeGreaterThanOrEqual(
          gross.remembered.memories.length,
        );
      }
      // A row is restored only into a request that fits; never invented.
      expect(netRows.length).toBeLessThanOrEqual(1);
    }
    expect(restored).toBeGreaterThan(0);
  });

  test("a god whose rows are all backed sheds the same units as before: no independent row, no change", () => {
    const w = busyZeus({ live: 1, events: 0, actions: 0, feelings: [] });
    expect(independentOf(w.remembered)).toEqual([]);
    const one = shedAt(w, ratioAt(chars(w) - 1));
    expect(one.shed.memories).toBe(1);
    expect(one.remembered.memories.map((m) => m.salience)).toEqual([
      2, 3, 4, 5, 6,
    ]);
  });
});
