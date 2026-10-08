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
  godIntentSchema,
  PRAYERS_HEADING,
  rememberedBy,
} from "./context";
import { PROMPT_TOKEN_CAP } from "./practices";
import {
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
    expect(MODEL_RATIOS["granite3.3-8b-4k"]).toBe(2.85);
    expect(MODEL_RATIOS["qwen3-8b-4k"]).toBe(3.34);
    expect(DEFAULT_RATIO).toBe(2.8);
    expect(PROMPT_TOKEN_CAP).toBe(3000);
  });
});

describe("routeRatio: the most conservative step of the planned route", () => {
  test("a role on granite3.3 alone gives 2.85", () => {
    const plan = planFor(
      [{ id: "local", baseUrl: LOCAL, model: "granite3.3-8b-4k" }],
      { roles: { zeus: { endpoint: "local" } } },
    );
    expect(routeRatio(plan)).toBe(2.85);
  });

  test("a qwen3 primary with a granite3.3 fallback gives 2.85", () => {
    const plan = planFor(
      [
        { id: "a", baseUrl: LOCAL, model: "qwen3-8b-4k" },
        { id: "b", baseUrl: LOCAL, model: "granite3.3-8b-4k" },
      ],
      { roles: { zeus: { endpoint: "a" } }, fallback: ["b"] },
    );
    expect(routeRatio(plan)).toBe(2.85);
  });

  test("a role's model override is what is looked up, not the endpoint's default", () => {
    const plan = planFor([{ id: "a", baseUrl: LOCAL, model: "qwen3-8b-4k" }], {
      roles: { zeus: { endpoint: "a", model: "granite3.3-8b-4k" } },
    });
    expect(routeRatio(plan)).toBe(2.85);
  });

  test("an unknown model gives the default, and so does an empty plan", () => {
    const unknown = planFor(
      [{ id: "a", baseUrl: LOCAL, model: "mystery-70b" }],
      { roles: { zeus: { endpoint: "a" } } },
    );
    expect(routeRatio(unknown)).toBe(2.8);
    expect(routeRatio({ steps: [], offlineSkipped: [] })).toBe(2.8);
  });

  test("an unknown model on the route pulls the ratio down to the default", () => {
    const plan = planFor(
      [
        { id: "a", baseUrl: LOCAL, model: "qwen3-8b-4k" },
        { id: "b", baseUrl: LOCAL, model: "mystery-70b" },
      ],
      { roles: { zeus: { endpoint: "a" } }, fallback: ["b"] },
    );
    expect(routeRatio(plan)).toBe(2.8);
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
    expect(routeRatio(planFor(endpoints, extra, false))).toBe(2.85);
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
  const RATIO = 2.85;
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
      fitsCap(buildGodContext(w.profile, w.snapshot, w.remembered), 2.85),
    ).toBe(false);
  });

  test("capped at the granite3.3 ratio, the busy world lands at or under the cap", () => {
    const w = busyZeus({ live: 1 });
    const capped = capAt(w, 2.85);
    expect(capped.fits).toBe(true);
    expect(capped.estimatedTokens).toBeLessThanOrEqual(PROMPT_TOKEN_CAP);
    expect(capped.ratio).toBe(2.85);
    expect(fitsCap({ ...capped.context }, 2.85)).toBe(true);
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
    const never = busyZeus({
      events: 0,
      actions: 0,
      memories: [],
      feelings: [3, 4, 5],
    });
    const capped = capAt(w, ratioAt(chars(never)));
    expect(capped.shed).toEqual({
      events: 6,
      actions: 5,
      memories: 8,
      prayers: 0,
    });
    expect(capped.remembered.memories).toEqual([]);
    expect(capped.remembered).toEqual({ ...never.remembered });
    expectAgreement(w, capped);
  });

  test("then unprotected prayers, oldest first, with the 'and N more' line counting them", () => {
    const w = busyZeus();
    const total = w.remembered.petitions.length + w.remembered.morePrayers;
    const bare = busyZeus({
      events: 0,
      actions: 0,
      memories: [],
      feelings: [],
    });
    // Room for the bare world and one unprotected prayer less than it shows.
    const shownBefore = bare.remembered.petitions.length;
    const unprotectedShown = shownBefore - w.protectedIds.length;
    expect(unprotectedShown).toBeGreaterThan(1);
    const capped = shedAt(w, ratioAt(chars(bare) - 1));
    expect(capped.shed.events).toBe(6);
    expect(capped.shed.actions).toBe(5);
    expect(capped.shed.memories).toBe(11);
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
    const memoriesAndFeelings = 11;
    let last = { events: 0, actions: 0, memories: 0, prayers: 0 };
    for (const ratio of [
      2.85, 2.6, 2.4, 2.2, 2.0, 1.8, 1.6, 1.4, 1.2, 1.0, 0.8, 0.5,
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
    expect(capped.remembered.memories).toEqual([]);
    expect(capped.remembered.relationships).toEqual([]);
    expect(capped.remembered.petitions.map((p) => p.id).sort()).toEqual(
      [...w.protectedIds].sort(),
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
      memories: 11,
      prayers: w.remembered.petitions.length - 3,
    });
    expectAgreement(w, capped);
  });

  test("a god with no prayers and no events sheds its own actions and memories, and tells of no 'and 0 more'", () => {
    const w = busyZeus({ prayers: 0, events: 0 });
    expect(w.remembered.petitions).toEqual([]);
    const capped = capAt(w, 0.5);
    expect(capped.shed.events).toBe(0);
    expect(capped.shed.actions).toBe(5);
    expect(capped.shed.memories).toBe(11);
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
    // Everything of tiers 1 to 3 went (the two memories and the feeling are three units), and one prayer more.
    expect(gross.shed).toEqual({
      events: 1,
      actions: 1,
      memories: 3,
      prayers: 1,
    });
    expect(gross.remembered.memories).toEqual([]);
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
    expect(most).toBeGreaterThan(2);
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
