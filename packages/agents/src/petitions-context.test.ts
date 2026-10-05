// What a god is shown of the prayers addressed to it, and what it may answer
// with: the petitions from world state (the divine sense), the way toward each
// place, the bless option, and why a goal change was refused. The world is real
// (the authored Greek pack, real ticks, the real validator); nothing here mocks
// the rules.

import { expect, test } from "bun:test";
import type {
  EventId,
  GoalChangeRefusedEvent,
  WorldEvent,
} from "@panthea/contracts";
import {
  applyEvent,
  createPrng,
  getActor,
  perceive,
  runTick,
  submitProposal,
  toEntityId,
  type WorldState,
  withActor,
} from "@panthea/world";
import { buildGodContext, godIntentSchema, rememberedBy } from "./context";
import { buildModelProposal } from "./observation";
import { actorAt, godProfile, greekState } from "./test-fixtures";

const id = toEntityId;

/** A world that keeps its events and lets a test stage the causes mortals pray about. */
class Run {
  state: WorldState;
  readonly events: WorldEvent[] = [];
  private n = 0;
  constructor(state: WorldState) {
    this.state = state;
  }
  /** Commits a fixture event as the world would have, so a cause exists. */
  apply(overrides: Record<string, unknown>): WorldEvent {
    this.n += 1;
    const event = {
      schemaVersion: 1,
      id: `evt-${this.state.tick}-${900 + this.n}`,
      sequence: this.state.lastSequence + 1,
      simTime: 0,
      tick: this.state.tick,
      correlationId: "fixture",
      causationId: "fixture",
      approximate: false,
      ...overrides,
    } as unknown as WorldEvent;
    this.state = applyEvent(this.state, event);
    this.events.push(event);
    return event;
  }
  tick(...raws: Record<string, unknown>[]) {
    const proposals = raws.map((raw) => {
      this.n += 1;
      const submitted = submitProposal({
        schemaVersion: 1,
        targets: [],
        expectedRevisions: [],
        source: "fixture",
        observationId: `obs-pc-${this.n}`,
        ...raw,
      });
      if (!submitted.ok) throw new Error(submitted.rejection.message);
      return submitted.proposal;
    });
    const result = runTick(this.state, createPrng(1), proposals);
    this.state = result.state;
    this.events.push(...result.events);
    return result;
  }
  /** `mortal` prays at the altar about a theft by `offender`; returns the petition's id and god. */
  prayAboutTheft(mortal: string, offender: string, resource = "food") {
    const cause = this.apply({
      kind: "theft",
      entityId: offender,
      victim: mortal,
      resource,
      amount: 1,
      cause: "director",
    });
    // The mortal was there when it happened: it remembers who did it.
    this.apply({
      kind: "memory-recorded",
      memoryKind: "witnessed",
      entityId: mortal,
      sourceEventId: cause.id,
      eventKind: "theft",
      subjects: [offender, mortal],
      salience: 6,
      consequence: { effect: "harm", agent: offender, target: mortal },
    });
    const placed = getActor(this.state, id(mortal));
    if (!placed) throw new Error(mortal);
    const home = placed.locationId;
    this.state = withActor(this.state, { ...placed, locationId: id("altar") });
    const ran = this.tick({
      actor: mortal,
      kind: "pray",
      cause: cause.id,
      source: "routine",
    });
    expect(ran.rejected).toEqual([]);
    const opened = ran.events.find((e) => e.kind === "petition-opened");
    if (opened?.kind !== "petition-opened") throw new Error("no petition");
    const back = getActor(this.state, id(mortal));
    if (back) this.state = withActor(this.state, { ...back, locationId: home });
    return opened;
  }
  prompt(god: string) {
    const snapshot = perceive(this.state, id(god), []);
    if (!snapshot) throw new Error("no snapshot");
    const remembered = rememberedBy(this.state, id(god));
    const context = buildGodContext(godProfile(god), snapshot, remembered);
    return `${context.instructions}\n${context.prompt}`;
  }
  schema(god: string) {
    const snapshot = perceive(this.state, id(god), []);
    if (!snapshot) throw new Error("no snapshot");
    return godIntentSchema(
      godProfile(god),
      snapshot,
      rememberedBy(this.state, id(god)),
    );
  }
}

const greek = () => new Run(greekState());
/** The prayers section alone: its heading and the indented or dashed lines under it. */
const prayersOf = (text: string) => {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith("Prayers to you:"));
  if (start < 0) return "";
  let end = start + 1;
  while (end < lines.length && /^( {2}|- )/.test(lines[end] ?? "")) end += 1;
  return lines.slice(start, end).join("\n");
};

test("Hera on Olympus is shown the farmer's punish petition: who asked, the request, the offender and the building, where each is, and travel to the town square", () => {
  const run = greek();
  const opened = run.prayAboutTheft("farmer", "woodcutter");
  expect(String(opened.god)).toBe("hera");
  expect(opened.request).toMatchObject({
    kind: "punish",
    offender: "woodcutter",
  });
  // Hera stands in the Hall of the Gods; the farmer, the woodcutter and the woodshed are far below.
  const hera = getActor(run.state, id("hera"));
  expect(hera?.locationId).toBe(id("great-hall"));

  const prayers = prayersOf(run.prompt("hera"));
  expect(prayers).toContain(`[${opened.id}]`);
  expect(prayers).toContain("farmer");
  expect(prayers).toContain("punish woodcutter");
  expect(prayers).toContain("woodshed");
  expect(prayers).toContain("Town Square");
  // The place the people are at, and that the god can travel there (the world walks it the way).
  expect(prayers).toContain(
    'farmer, woodcutter, woodshed at Town Square [town-square]: you can travel there (action "travel", to "town-square")',
  );
  // The theft it was about, as the cause.
  expect(prayers).toContain("woodcutter stole food");
});

test("Zeus's prompt never lists a petition addressed to Hera, and Hera's own never lists one addressed to Zeus", () => {
  const run = greek();
  const toHera = run.prayAboutTheft("farmer", "woodcutter");
  expect(String(toHera.god)).toBe("hera");
  expect(run.prompt("zeus")).not.toContain("Prayers to you");
  expect(run.prompt("zeus")).not.toContain(toHera.id);
  // Control: the named god's prompt does.
  expect(run.prompt("hera")).toContain(toHera.id);
  // A second mortal's petition goes to the god with fewer: Zeus. Hera's prompt does not list it.
  const toZeus = run.prayAboutTheft("woodcutter", "farmer");
  expect(String(toZeus.god)).toBe("zeus");
  expect(run.prompt("hera")).not.toContain(toZeus.id);
  expect(run.prompt("zeus")).toContain(toZeus.id);
});

test("an answered or lapsed petition is no longer listed", () => {
  const run = greek();
  const opened = run.prayAboutTheft("farmer", "woodcutter");
  expect(run.prompt("hera")).toContain(opened.id);
  const petition = run.state.petitions.get(opened.id);
  if (!petition) throw new Error("petition");
  run.state = {
    ...run.state,
    petitions: new Map(run.state.petitions).set(opened.id, {
      ...petition,
      status: "answered",
    }),
  };
  expect(run.prompt("hera")).not.toContain("Prayers to you");
});

test("the woodshed becomes a strike target only once it is in the scene: not from Olympus, and yes from the square", () => {
  const run = greek();
  run.prayAboutTheft("farmer", "woodcutter");
  const strikeTargets = (god: string) => {
    const properties = (
      run.schema(god).jsonSchema as {
        properties: Record<string, { enum?: string[] }>;
      }
    ).properties;
    return properties.target?.enum ?? [];
  };
  expect(strikeTargets("hera")).not.toContain("woodshed");
  run.state = actorAt(run.state, "hera", "town-square");
  expect(strikeTargets("hera")).toContain("woodshed");
  // And the prayers section no longer needs a route: she is there.
  expect(prayersOf(run.prompt("hera"))).not.toContain("take ");
});

test("bless is offered only for a petitioner who is present, naming one of its open help petitions", () => {
  const run = greek();
  // The farmer's tavern was damaged: a help petition for the building.
  const cause = run.apply({
    kind: "building-damaged",
    entityId: "the-tavern",
    amount: 1,
    actor: "zeus",
  });
  run.apply({
    kind: "memory-recorded",
    memoryKind: "witnessed",
    entityId: "farmer",
    sourceEventId: cause.id,
    eventKind: "building-damaged",
    subjects: ["zeus", "the-tavern", "farmer"],
    salience: 5,
    consequence: { effect: "harm", agent: "zeus", target: "farmer" },
  });
  const farmer = getActor(run.state, id("farmer"));
  if (!farmer) throw new Error("farmer");
  run.state = withActor(run.state, { ...farmer, locationId: id("altar") });
  const ran = run.tick({
    actor: "farmer",
    kind: "pray",
    cause: cause.id,
    source: "routine",
  });
  const opened = ran.events.find((e) => e.kind === "petition-opened");
  if (opened?.kind !== "petition-opened") throw new Error("no petition");
  expect(opened.request.kind).toBe("help");
  const god = String(opened.god);

  const blessProps = (g: string) => {
    const schema = run.schema(g).jsonSchema as {
      properties: Record<string, { enum?: string[] }>;
    };
    return {
      actions: schema.properties.action?.enum ?? [],
      petitions: schema.properties.petition?.enum,
    };
  };
  // The god is in the hall; the farmer is at the altar: not present, so no bless.
  expect(blessProps(god).actions).not.toContain("bless");
  expect(blessProps(god).petitions).toBeUndefined();
  // The god stands with the farmer: bless is offered, naming that one petition.
  run.state = actorAt(run.state, god, "altar");
  expect(blessProps(god).actions).toContain("bless");
  expect(blessProps(god).petitions).toEqual([opened.id]);
  expect(run.prompt(god)).toContain('action "bless"');
  // A punish petition's petitioner who is present does not get a bless: that is a strike.
  const other = god === "hera" ? "zeus" : "hera";
  expect(blessProps(other).actions).not.toContain("bless");
});

/** The farmer has an open help petition to a god who now stands with it at the altar, and the god has built a bless from what it saw there. */
function blessSituation() {
  const run = greek();
  const cause = run.apply({
    kind: "building-damaged",
    entityId: "the-tavern",
    amount: 1,
    actor: "zeus",
  });
  run.apply({
    kind: "memory-recorded",
    memoryKind: "witnessed",
    entityId: "farmer",
    sourceEventId: cause.id,
    eventKind: "building-damaged",
    subjects: ["zeus", "the-tavern", "farmer"],
    salience: 5,
    consequence: { effect: "harm", agent: "zeus", target: "farmer" },
  });
  const farmer = getActor(run.state, id("farmer"));
  if (!farmer) throw new Error("farmer");
  run.state = withActor(run.state, { ...farmer, locationId: id("altar") });
  const ran = run.tick({
    actor: "farmer",
    kind: "pray",
    cause: cause.id,
    source: "routine",
  });
  const opened = ran.events.find((e) => e.kind === "petition-opened");
  if (opened?.kind !== "petition-opened") throw new Error("no petition");
  const god = String(opened.god);
  run.state = actorAt(run.state, god, "altar");

  const snapshot = perceive(run.state, id(god), []);
  if (!snapshot) throw new Error("snapshot");
  const remembered = rememberedBy(run.state, id(god));
  const schema = godIntentSchema(godProfile(god), snapshot, remembered);
  const parsed = schema.parse({ action: "bless", petition: opened.id });
  if (!parsed.ok) throw new Error(parsed.message);
  const built = buildModelProposal(id(god), snapshot, parsed.value, remembered);
  if (!built.ok || built.kind !== "proposal")
    throw new Error("expected a proposal");
  return { run, god, opened, schema, built };
}

/** Runs the proposal built in `blessSituation` against the world as it is now. */
function validateBless(situation: ReturnType<typeof blessSituation>) {
  return runTick(situation.run.state, createPrng(1), [
    situation.built.proposal,
  ]);
}

test("a bless intent parses against the offered petitions only, and builds a proposal that cites the petition and pins nothing the validator re-checks", () => {
  const { run, god, opened, schema, built } = blessSituation();
  expect(schema.parse({ action: "bless", petition: opened.id }).ok).toBe(true);
  expect(schema.parse({ action: "bless", petition: "evt-404" }).ok).toBe(false);
  expect(schema.parse({ action: "bless" }).ok).toBe(false);
  expect(built.proposal).toMatchObject({
    kind: "bless",
    actor: god,
    petition: opened.id,
    targets: ["farmer"],
  });
  // Every condition a bless depends on is checked again when it is validated, so it
  // pins no revision: a world that moved on while the god thought cannot stale it.
  expect(built.proposal.expectedRevisions).toEqual([]);
  // The real validator commits it: the farmer is present and the god can pay.
  const committed = runTick(run.state, createPrng(1), [built.proposal]);
  expect(committed.rejected).toEqual([]);
  expect(committed.events.map((e) => e.kind)).toContain("blessing-granted");
});

test("a bless still commits after the petitioner's routine gathering changed its inventory while the god thought", () => {
  const situation = blessSituation();
  situation.run.apply({
    kind: "resource-gathered",
    entityId: "farmer",
    resource: "food",
    amount: 1,
  });
  const ran = validateBless(situation);
  expect(ran.rejected).toEqual([]);
  expect(ran.events.map((e) => e.kind)).toContain("blessing-granted");
});

test("a bless still commits after another mortal walked through the god's location while it thought", () => {
  const situation = blessSituation();
  situation.run.apply({
    kind: "entity-moved",
    entityId: "woodcutter",
    from: "town-square",
    to: "altar",
  });
  situation.run.apply({
    kind: "entity-moved",
    entityId: "woodcutter",
    from: "altar",
    to: "town-square",
  });
  const ran = validateBless(situation);
  expect(ran.rejected).toEqual([]);
  expect(ran.events.map((e) => e.kind)).toContain("blessing-granted");
});

// A bless the world has really moved past is still refused, for the reason that matters.

test("a bless is refused as not-adjacent when the petitioner walked away while the god thought", () => {
  const situation = blessSituation();
  situation.run.apply({
    kind: "entity-moved",
    entityId: "farmer",
    from: "altar",
    to: "town-square",
  });
  expect(validateBless(situation).rejected.map((r) => r.reason)).toEqual([
    "not-adjacent",
  ]);
});

test("a bless is refused when the petition was answered or lapsed while the god thought", () => {
  const answered = blessSituation();
  const petition = answered.run.state.petitions.get(answered.opened.id);
  if (!petition) throw new Error("petition");
  answered.run.state = {
    ...answered.run.state,
    petitions: new Map(answered.run.state.petitions).set(answered.opened.id, {
      ...petition,
      status: "answered",
    }),
  };
  expect(validateBless(answered).rejected.map((r) => r.reason)).toEqual([
    "malformed",
  ]);

  const lapsed = blessSituation();
  lapsed.run.state = {
    ...lapsed.run.state,
    tick: lapsed.run.state.tick + 100000,
  };
  expect(validateBless(lapsed).rejected.map((r) => r.reason)).toEqual([
    "malformed",
  ]);
});

test("a bless is refused when the petitioner died or the god spent its divinity while the god thought", () => {
  const dead = blessSituation();
  // No event kills an actor yet; the state carries the death and its revision bump.
  const farmer = getActor(dead.run.state, id("farmer"));
  if (!farmer) throw new Error("farmer");
  dead.run.state = withActor(dead.run.state, {
    ...farmer,
    alive: false,
    revision: farmer.revision + 1,
  });
  expect(validateBless(dead).rejected.map((r) => r.reason)).toEqual([
    "dead-actor",
  ]);

  const spent = blessSituation();
  spent.run.apply({
    kind: "resource-consumed",
    entityId: spent.god,
    resource: "divinity",
    amount: 1000,
  });
  expect(validateBless(spent).rejected.map((r) => r.reason)).toEqual([
    "insufficient-power",
  ]);
});

test("a goal may name anyone a prayer names, though they are not in the scene", () => {
  const run = greek();
  run.prayAboutTheft("farmer", "woodcutter");
  const snapshot = perceive(run.state, id("hera"), []);
  if (!snapshot) throw new Error("snapshot");
  const schema = godIntentSchema(
    godProfile("hera"),
    snapshot,
    rememberedBy(run.state, id("hera")),
  );
  for (const target of ["farmer", "woodcutter", "woodshed"]) {
    expect(
      schema.parse({
        action: "wait",
        goal: { set: { text: "See it done.", target } },
      }).ok,
    ).toBe(true);
  }
  // Control: before any prayer, the farmer is not someone Hera was shown.
  const bare = godIntentSchema(
    godProfile("hera"),
    snapshot,
    rememberedBy(greekState(), id("hera")),
  );
  expect(
    bare.parse({
      action: "wait",
      goal: { set: { text: "See it done.", target: "woodcutter" } },
    }).ok,
  ).toBe(false);
});

// --- The goal gate in the prompt ------------------------------------------------------------------

const refusal = (
  over: Partial<GoalChangeRefusedEvent> = {},
): GoalChangeRefusedEvent =>
  ({
    schemaVersion: 1,
    id: "evt-9-9" as EventId,
    sequence: 9999,
    simTime: 0,
    tick: 5,
    correlationId: "c",
    causationId: "c",
    approximate: false,
    kind: "goal-change-refused",
    entityId: id("hera"),
    reason: "locked",
    attempted: "replace",
    unlocksInTicks: 35,
    ...over,
  }) as GoalChangeRefusedEvent;

test("the prompt states the goal rule instead of promising a new goal ends the old one, and after a refusal says a change was refused, why, and when it unlocks", () => {
  const run = greek();
  run.tick({
    actor: "hera",
    kind: "goal",
    goal: { set: { text: "Win the farmer.", target: "farmer" } },
  });
  const text = run.prompt("hera");
  expect(text).not.toContain("A new goal ends your old one");
  expect(text).toMatch(/goal holds/i);
  expect(text).toContain("achieved");
  expect(text).not.toContain("refused");

  // After a refusal (read from the god's own events by the service), the next prompt says so.
  const snapshot = perceive(run.state, id("hera"), []);
  if (!snapshot) throw new Error("snapshot");
  const remembered = rememberedBy(
    run.state,
    id("hera"),
    [],
    refusal({ sequence: run.state.lastSequence + 1 }),
  );
  const after = buildGodContext(godProfile("hera"), snapshot, remembered);
  const afterText = `${after.instructions}\n${after.prompt}`;
  expect(afterText).toContain(
    "You tried to replace your goal and were refused",
  );
  expect(afterText).toContain("locked");
  expect(afterText).toMatch(/35 more ticks|ticks/);
});

test("a refusal from before the current goal was set is not shown", () => {
  const run = greek();
  run.tick({
    actor: "hera",
    kind: "goal",
    goal: { set: { text: "Win the farmer.", target: "farmer" } },
  });
  const snapshot = perceive(run.state, id("hera"), []);
  if (!snapshot) throw new Error("snapshot");
  const stale = rememberedBy(
    run.state,
    id("hera"),
    [],
    refusal({ sequence: 1 }),
  );
  const text = buildGodContext(godProfile("hera"), snapshot, stale);
  expect(`${text.instructions}\n${text.prompt}`).not.toContain("refused");
  // And with no goal at all there is nothing to have been refused.
  const bare = greek();
  const bareSnapshot = perceive(bare.state, id("hera"), []);
  if (!bareSnapshot) throw new Error("snapshot");
  const none = buildGodContext(
    godProfile("hera"),
    bareSnapshot,
    rememberedBy(bare.state, id("hera"), [], refusal()),
  );
  expect(`${none.instructions}\n${none.prompt}`).not.toContain("refused");
});

// --- The prayers section is budgeted: the newest are listed, the rest are counted -------------------
//
// R7 once said every open petition is listed, however many there are. Owner decision 2026-10-03
// (Unit 7): a crowd of prayers pushes the instructions out of the model's context (Ollama drops the
// start of a prompt silently past about 4,090 tokens), so the section has a budget and the prayers
// it cannot hold become one line. The world still keeps every petition. prayer-budget.test.ts
// holds the budget, the order, and the schema and parser agreement; this keeps the original
// seven-petition case honest.

test("seven open petitions to one god: the newest are listed within the budget, the rest are counted, none is lost from the world, and answering one changes the count; the prompt's growth is measured", () => {
  const run = greek();
  const bare = run.prompt("hera");
  // Each prayer is about a different resource, since a mortal holds one open petition per resource.
  const resources = ["food", "wood", "planks", "currency"];
  const opened = [
    "farmer",
    "woodcutter",
    "farmer",
    "woodcutter",
    "farmer",
    "woodcutter",
    "farmer",
  ].map((mortal, index) => {
    run.state = { ...run.state, tick: run.state.tick + 21 };
    // Fondness for Hera keeps each prayer coming to her.
    const relationships = new Map(run.state.relationships);
    relationships.set(`${mortal}>hera`, {
      from: id(mortal),
      toward: id("hera"),
      affinity: 5,
      grudge: 0,
      allied: false,
    });
    run.state = { ...run.state, relationships };
    return run.prayAboutTheft(
      mortal,
      mortal === "farmer" ? "woodcutter" : "farmer",
      resources[Math.floor(index / 2)],
    );
  });
  expect(new Set(opened.map((o) => String(o.god))).size).toBe(1);
  const idsOf = (text: string) =>
    text
      .split("\n")
      .filter((line) => /^- \[evt-/.test(line))
      .map((line) => /\[(evt-[^\]]+)\]/.exec(line)?.[1]);
  const text = run.prompt("hera");
  const shown = idsOf(text);
  // The newest, newest first: a prefix of the prayers in reverse order of opening.
  expect(shown.length).toBeGreaterThan(0);
  expect(shown.length).toBeLessThan(opened.length);
  expect(shown).toEqual(
    [...opened]
      .reverse()
      .slice(0, shown.length)
      .map((o) => o.id),
  );
  const more = opened.length - shown.length;
  expect(text).toContain(`- and ${more} more prayers to you.`);
  // The world keeps all of them.
  expect(
    [...run.state.petitions.values()].filter((p) => p.status === "open"),
  ).toHaveLength(opened.length);
  // Control: answering the oldest (a hidden one) leaves what is shown as it was and the count one lower.
  const first = run.state.petitions.get(opened[0]?.id as never);
  if (!first) throw new Error("petition");
  run.state = {
    ...run.state,
    petitions: new Map(run.state.petitions).set(first.id, {
      ...first,
      status: "answered",
    }),
  };
  const after = run.prompt("hera");
  expect(idsOf(after)).toEqual(shown);
  expect(after).toContain(`- and ${more - 1} more prayers to you.`);
  // Measured on the authored world: what seven petitions add to the prompt, in characters.
  console.log(
    `PROMPT_GROWTH_SEVEN_PETITIONS ${text.length - bare.length} total ${text.length}`,
  );
});

/** `mortal` at the altar prays about `cause`; returns the opened petition. */
function prayAbout(run: Run, mortal: string, cause: EventId) {
  const placed = getActor(run.state, id(mortal));
  if (!placed) throw new Error(mortal);
  run.state = withActor(run.state, { ...placed, locationId: id("altar") });
  const ran = run.tick({
    actor: mortal,
    kind: "pray",
    cause,
    source: "routine",
  });
  expect(ran.rejected).toEqual([]);
  const opened = ran.events.find((e) => e.kind === "petition-opened");
  if (opened?.kind !== "petition-opened") throw new Error("no petition");
  return opened;
}

test("a help prayer about an unwitnessed theft tells its god no offender: the farmer never knew who stole its currency", () => {
  const run = greek();
  const theft = run.apply({
    kind: "theft",
    entityId: "woodcutter",
    victim: "farmer",
    resource: "currency",
    amount: 1,
    cause: "director",
  });
  const opened = prayAbout(run, "farmer", theft.id);
  expect(opened.request).toMatchObject({ kind: "help" });
  const prayers = prayersOf(run.prompt(String(opened.god)));
  expect(prayers).toContain(opened.id);
  expect(prayers).toContain("currency");
  expect(prayers).not.toContain("woodcutter");
});

test("a help prayer about unwitnessed damage tells its god no offender: the farmer only noticed the damage", () => {
  const run = greek();
  const damage = run.apply({
    kind: "building-damaged",
    entityId: "the-tavern",
    amount: 1,
    actor: "zeus",
  });
  run.apply({
    kind: "memory-recorded",
    memoryKind: "noticed",
    entityId: "farmer",
    sourceEventId: damage.id,
    causeEventId: damage.id,
    subjects: ["farmer", "the-tavern"],
    salience: 5,
  });
  const opened = prayAbout(run, "farmer", damage.id);
  expect(opened.request).toMatchObject({ kind: "help" });
  const prayers = prayersOf(run.prompt(String(opened.god)));
  expect(prayers).toContain("the-tavern");
  expect(prayers).not.toContain("zeus");
});

test("control: a witnessed damage keeps its attribution in a help prayer", () => {
  const run = greek();
  // Make the damager one who owns no building, so the request is help, not punish.
  const damage = run.apply({
    kind: "building-damaged",
    entityId: "the-tavern",
    amount: 1,
    actor: "zeus",
  });
  run.apply({
    kind: "memory-recorded",
    memoryKind: "witnessed",
    entityId: "farmer",
    sourceEventId: damage.id,
    eventKind: "building-damaged",
    subjects: ["zeus", "the-tavern", "farmer"],
    salience: 5,
    consequence: { effect: "harm", agent: "zeus", target: "farmer" },
  });
  const opened = prayAbout(run, "farmer", damage.id);
  expect(opened.request).toMatchObject({ kind: "help" });
  const prayers = prayersOf(run.prompt(String(opened.god)));
  expect(prayers).toContain("zeus");
});

test("prayers are per-tick state, so they come after what the god remembers and after what is happening here, with the prayers just before the question", () => {
  const run = greek();
  const opened = run.prayAboutTheft("farmer", "woodcutter");
  // Hera also remembers being told something, and has a feeling about it.
  run.apply({
    kind: "memory-recorded",
    memoryKind: "told",
    entityId: "hera",
    sourceEventId: "evt-1-901",
    teller: "zeus",
    content: "The farmer cheated me.",
    subjects: ["zeus", "farmer"],
    salience: 4,
  });
  const text = run.prompt(String(opened.god));
  const prayers = text.indexOf("Prayers to you");
  expect(prayers).toBeGreaterThan(-1);
  // What the god remembers changes slowly and leads; the scene changes every tick; the prayers, which can change with it, are the last section.
  expect(text.indexOf("You remember")).toBeLessThan(prayers);
  expect(text.indexOf("Here with you")).toBeLessThan(prayers);
  expect(text.indexOf("Recent events here")).toBeLessThan(prayers);
  expect(text.indexOf("What do you do?")).toBeGreaterThan(prayers);
});

test("a help prayer from afar offers the way to help as a choice: travel to the petitioner if you choose to help, and bless once there", () => {
  const run = greek();
  const theft = run.apply({
    kind: "theft",
    entityId: "woodcutter",
    victim: "farmer",
    resource: "currency",
    amount: 1,
    cause: "director",
  });
  const opened = prayAbout(run, "farmer", theft.id);
  const prayers = prayersOf(run.prompt(String(opened.god)));
  expect(prayers).toContain("help freely");
  expect(prayers).toContain('{"action":"travel","to":"altar"} (Altar of Zeus)');
  expect(prayers).toContain("bless");
  // It takes several steps, and the hint is for one who chooses to help: a condition, not a command.
  expect(prayers).toContain("if you choose this");
  expect(prayers).toContain("the world walks you there");
  expect(prayers).not.toContain("turn by turn");
  expect(prayers).not.toContain("To answer it");
  expect(prayers).not.toContain("keep going each turn");
  // Not the guidance for a petitioner who is here.
  expect(prayers).not.toContain("is here (action");
});

test("a help prayer from a petitioner who is here offers bless as one of the choices, not as an order", () => {
  const run = greek();
  const theft = run.apply({
    kind: "theft",
    entityId: "woodcutter",
    victim: "farmer",
    resource: "currency",
    amount: 1,
    cause: "director",
  });
  const opened = prayAbout(run, "farmer", theft.id);
  const god = String(opened.god);
  run.state = actorAt(run.state, god, "altar");
  const prayers = prayersOf(run.prompt(god));
  expect(prayers).toContain(
    `help freely: farmer is here: {"action":"bless","petition":"${opened.id}"}`,
  );
  expect(prayers).toContain("let it be");
  expect(prayers).not.toContain("bless them now");
  expect(prayers).not.toContain("To answer it");
});

test("a punish prayer offers striking the offender's building as a choice: travel to it from afar if you choose to, and strike it where it stands once there", () => {
  const run = greek();
  const opened = run.prayAboutTheft("farmer", "woodcutter");
  const god = String(opened.god);
  const afar = prayersOf(run.prompt(god));
  expect(afar).toContain("punish freely");
  expect(afar).toContain("once you are there, strike woodshed");
  expect(afar).toContain("if you choose this");
  expect(afar).toContain('{"action":"travel","to":"town-square"}');
  expect(afar).not.toContain("To answer it");
  run.state = actorAt(run.state, god, "town-square");
  const near = prayersOf(run.prompt(god));
  expect(near).toContain(
    'punish freely: woodshed is here: {"action":"strike","target":"woodshed","power":1}',
  );
});

test("the instructions say a goal change can ride with an action or an answer in the same turn", () => {
  const run = greek();
  const text = run.prompt("hera");
  expect(text).toContain("same turn");
});

/** A remote help prayer (the farmer, at the altar, robbed by an unseen thief), with its god standing at the Gates of Olympus: the spot the gate runs got stuck at. */
function godAtTheGate() {
  const run = greek();
  const theft = run.apply({
    kind: "theft",
    entityId: "woodcutter",
    victim: "farmer",
    resource: "currency",
    amount: 1,
    cause: "director",
  });
  const opened = prayAbout(run, "farmer", theft.id);
  const god = String(opened.god);
  run.state = actorAt(run.state, god, "olympus-gate");
  return { run, god };
}

test("whatever the god's place, a prayer's guidance names one action, travel, to the place the people are: the world works out the way, so no hop and no crossing is named", () => {
  for (const place of ["olympus-gate", "great-hall"]) {
    const { run, god } = godAtTheGate();
    run.state = actorAt(run.state, god, place);
    const prayers = prayersOf(run.prompt(god));
    expect(prayers).toContain('{"action":"travel","to":"altar"}');
    expect(prayers).toContain(
      'farmer at Altar of Zeus [altar]: you can travel there (action "travel", to "altar")',
    );
    expect(prayers).not.toContain('"action":"move"');
    expect(prayers).not.toContain("realm-transition");
  }
});

test("the guided travel parses, from wherever the god stands, and a move or a crossing no longer does", () => {
  const { run, god } = godAtTheGate();
  const schema = run.schema(god);
  const to = (schema.jsonSchema as { properties: { to: { enum: string[] } } })
    .properties.to.enum;
  expect(to).toEqual(expect.arrayContaining(["altar", "great-hall"]));
  expect(schema.parse({ action: "travel", to: "altar" }) as unknown).toEqual({
    ok: true,
    value: { action: "travel", to: "altar" },
  });
  // The gate runs showed a model pairing the wrong kind of move with a destination; there is now one action to name.
  for (const action of ["move", "realm-transition"]) {
    expect(schema.parse({ action, to: "mountain-path" }).ok).toBe(false);
  }
});
