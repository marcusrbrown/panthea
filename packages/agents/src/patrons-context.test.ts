// What a god is shown of its flock, the season, and the moves Units 2 and 3 gave it: a worshipper's prayer that names the
// god that struck it, a mortal to punish and a prayer to refuse, a demand for redress, and a contest over a defection.
// The world is real (the authored Greek pack, real ticks, the real validator); nothing here mocks the rules, and every
// object a prompt shows is sent through the world as written.

import { expect, test } from "bun:test";
import type { EventId, WorldEvent } from "@panthea/contracts";
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
import {
  buildGodContext,
  godAvailableActions,
  godIntentSchema,
  rememberedBy,
} from "./context";
import { buildModelProposal } from "./observation";
import { CONTESTS_HEADING, PRAYERS_BUDGET_CHARS } from "./practices";
import { actorAt, actorHolding, godProfile, greekState } from "./test-fixtures";

const id = toEntityId;

class Run {
  state: WorldState;
  readonly events: WorldEvent[] = [];
  private n = 0;
  constructor(state: WorldState = greekState()) {
    this.state = state;
  }
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
        observationId: `obs-pt-${this.n}`,
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
  /** `mortal` prays at the altar about `cause`, and goes home. */
  pray(mortal: string, cause: EventId) {
    const placed = getActor(this.state, id(mortal));
    if (!placed) throw new Error(mortal);
    this.state = withActor(this.state, { ...placed, locationId: id("altar") });
    const ran = this.tick({
      actor: mortal,
      kind: "pray",
      cause,
      source: "routine",
    });
    expect(ran.rejected).toEqual([]);
    const opened = ran.events.find((e) => e.kind === "petition-opened");
    if (opened?.kind !== "petition-opened") throw new Error("no petition");
    const back = getActor(this.state, id(mortal));
    if (back) {
      this.state = withActor(this.state, {
        ...back,
        locationId: placed.locationId,
      });
    }
    return opened;
  }
  /** A god strikes `mortal`, and the mortal prays about it to its patron. */
  struckAndPrays(god: string, mortal: string) {
    const ran = this.tick({
      actor: god,
      kind: "strike",
      target: mortal,
      power: 1,
    });
    expect(ran.rejected).toEqual([]);
    const harm = ran.events.find((e) => e.kind === "mortal-struck");
    if (harm?.kind !== "mortal-struck") throw new Error("no strike");
    return { harm, petition: this.pray(mortal, harm.id) };
  }
  view(god: string) {
    const snapshot = perceive(this.state, id(god), []);
    if (!snapshot) throw new Error("no snapshot");
    const remembered = rememberedBy(this.state, id(god));
    const profile = godProfile(god);
    return {
      snapshot,
      remembered,
      profile,
      context: buildGodContext(profile, snapshot, remembered),
      schema: godIntentSchema(profile, snapshot, remembered),
    };
  }
  /** `intent` as the service would build it for `god`, then run on a tick: what the world did with it. */
  send(god: string, intent: unknown) {
    const { snapshot, remembered, schema } = this.view(god);
    const parsed = schema.parse(intent);
    if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.message}`);
    const built = buildModelProposal(
      id(god),
      snapshot,
      parsed.value,
      remembered,
    );
    if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
    const result = runTick(this.state, createPrng(1), [built.proposal]);
    this.state = result.state;
    this.events.push(...result.events);
    return result;
  }
}

const prompt = (view: ReturnType<Run["view"]>) =>
  `${view.context.instructions}\n${view.context.prompt}`;

/** The one JSON object on the first line of `text` that starts with `marker`. */
function objectAfter(text: string, marker: string): Record<string, unknown> {
  const line = text.split("\n").find((l) => l.includes(marker));
  if (line === undefined) throw new Error(`no line with ${marker}`);
  const from = line.indexOf("{", line.indexOf(marker));
  let depth = 0;
  for (let at = from; at < line.length; at += 1) {
    if (line[at] === "{") depth += 1;
    if (line[at] === "}" && --depth === 0) {
      return JSON.parse(line.slice(from, at + 1));
    }
  }
  throw new Error(`no object after ${marker}`);
}

const IRIS = "market-trader-iris"; // Hermes's worshipper at the square

test("Hermes's prompt shows its worshipper's prayer naming Poseidon, who struck it, with a demand for redress the world takes as written", () => {
  const run = new Run();
  const { harm, petition } = run.struckAndPrays("poseidon", IRIS);
  expect(petition.god).toBe(id("hermes"));
  const view = run.view("hermes");
  const text = prompt(view);
  // Whose prayer it is, and what struck it.
  expect(text).toContain(`[${petition.id}] ${IRIS} (your worshipper)`);
  expect(text).toContain("poseidon struck it and took its food");
  // The demand cites the harm and names the god as written; the world takes it.
  const demand = objectAfter(text, "demand redress of poseidon");
  expect(demand).toMatchObject({
    action: "practice",
    move: "demand",
    cause: harm.id,
  });
  const result = run.send("hermes", demand);
  expect(result.rejected).toEqual([]);
  expect(result.events.find((e) => e.kind === "practice-opened")).toMatchObject(
    {
      entityId: "hermes",
      counterparty: "poseidon",
      causes: [harm.id],
    },
  );
  // It is a choice among the others, never a command.
  expect(text).toContain("Your choices:");
  expect(text).not.toMatch(/\b(you must|demand redress now)\b/i);
});

test("the harm is a cause Hermes may demand over: the schema and the parser name it, and no other god's prayer shows it", () => {
  const run = new Run();
  const { harm } = run.struckAndPrays("poseidon", IRIS);
  const view = run.view("hermes");
  expect(view.remembered.practice.causes.map((c) => c.id)).toContain(harm.id);
  expect(prompt(view)).toContain(`[${harm.id}]`);
  const demand = {
    action: "practice",
    move: "demand",
    cause: harm.id,
    term: { kind: "ally", party: "poseidon", to: "hermes", deadlineTicks: 90 },
  };
  expect(view.schema.parse(demand).ok).toBe(true);
  expect(view.schema.parse({ ...demand, cause: "evt-1-1" }).ok).toBe(false);
  // Athena was not prayed to: she is shown none of it and may cite nothing.
  const athena = run.view("athena");
  expect(prompt(athena)).not.toContain(harm.id);
  expect(athena.schema.parse(demand).ok).toBe(false);
});

test("a prayer about nothing taken asks the patron to make the god answer: Hermes is shown the demand and may refuse it, and the god is not offered to be struck", () => {
  let state = greekState();
  state = actorHolding(
    actorHolding(state, IRIS, "food", 0),
    IRIS,
    "currency",
    0,
  );
  const run = new Run(state);
  const { petition } = run.struckAndPrays("poseidon", IRIS);
  const view = run.view("hermes");
  const text = prompt(view);
  expect(text).toContain(
    `[${petition.id}] ${IRIS} (your worshipper) asks that poseidon, a god, answer for it`,
  );
  expect(text).toContain("demand redress of poseidon");
  // A god is no target of a strike: it is not an id the schema offers.
  const schema = view.schema.jsonSchema as {
    properties: Record<string, { enum?: string[] }>;
  };
  expect(schema.properties.target?.enum ?? []).not.toContain("poseidon");
  expect(
    view.schema.parse({ action: "strike", target: "poseidon", power: 1 }).ok,
  ).toBe(false);
});

test("a mortal to punish is a choice shown with its strike written out, no building or journey needed, and the world takes the goods", () => {
  const run = new Run();
  // Doris-like: a fisher of Poseidon's holds a grudge against Iris, who owns nothing in sight.
  const fisher = "fisher-kallias";
  const grudge = run.apply({
    kind: "relationship-changed",
    entityId: fisher,
    toward: IRIS,
    affinityDelta: -2,
    grudgeDelta: 1,
    memoryEventId: "evt-0-fixture-memory",
  });
  const prayed = run.pray(fisher, grudge.id);
  expect(prayed.request).toMatchObject({
    kind: "punish",
    offender: IRIS,
    buildings: [],
  });
  const view = run.view("poseidon");
  const text = prompt(view);
  expect(text).toContain(
    `${fisher} (your worshipper) asks you to punish ${IRIS}`,
  );
  const strike = objectAfter(text, `punish ${IRIS} itself`);
  expect(strike).toEqual({ action: "strike", target: IRIS, power: 1 });
  const before = getActor(run.state, id(IRIS))?.inventory.get("food") ?? 0;
  const result = run.send("poseidon", strike);
  expect(result.rejected).toEqual([]);
  expect(result.events.find((e) => e.kind === "mortal-struck")).toMatchObject({
    entityId: IRIS,
    actor: "poseidon",
    resource: "food",
  });
  expect(
    getActor(run.state, id(IRIS))?.inventory.get("food") ?? 0,
  ).toBeLessThan(before);
  // The prayer it answered is closed.
  expect(run.state.petitions.get(prayed.id)?.status).toBe("answered");
});

test("the strike's schema names the mortal a shown prayer asks to punish and no other, and the parser is as strict", () => {
  const run = new Run();
  const fisher = "fisher-kallias";
  const grudge = run.apply({
    kind: "relationship-changed",
    entityId: fisher,
    toward: IRIS,
    affinityDelta: -2,
    grudgeDelta: 1,
    memoryEventId: "evt-0-fixture-memory",
  });
  run.pray(fisher, grudge.id);
  const view = run.view("poseidon");
  const props = (
    view.schema.jsonSchema as {
      properties: Record<string, { enum?: string[]; maximum?: number }>;
    }
  ).properties;
  expect(props.target?.enum).toContain(IRIS);
  // Anyone else: refused, however alive; the prayer's own petitioner, a worshipper elsewhere, a god.
  for (const other of ["woodcutter", fisher, "zeus", "fisher-melina"]) {
    expect([
      other,
      view.schema.parse({ action: "strike", target: other, power: 1 }).ok,
    ]).toEqual([other, false]);
  }
  expect(
    view.schema.parse({ action: "strike", target: IRIS, power: 1 }).ok,
  ).toBe(true);
  expect(
    view.schema.parse({ action: "strike", target: IRIS, power: 0 }).ok,
  ).toBe(false);
  expect(
    view.schema.parse({
      action: "strike",
      target: IRIS,
      power: (props.power?.maximum ?? 0) + 1,
    }).ok,
  ).toBe(false);
  // A god with no prayer naming a mortal is offered no mortal.
  const zeus = run.view("zeus");
  expect(
    zeus.schema.parse({ action: "strike", target: IRIS, power: 1 }).ok,
  ).toBe(false);
});

test("a prayer may be refused: the refusal is written out, the schema and the parser name only the prayers shown, and the world closes it and remembers it as harm", () => {
  const run = new Run();
  const { petition } = run.struckAndPrays("poseidon", IRIS);
  const view = run.view("hermes");
  const text = prompt(view);
  const refuse = objectAfter(text, "refuse it");
  expect(refuse).toEqual({ action: "refuse", petition: petition.id });
  expect(
    godAvailableActions(view.profile, view.snapshot, view.remembered),
  ).toContain("refuse");
  const props = (
    view.schema.jsonSchema as {
      properties: Record<string, { enum?: string[] }>;
    }
  ).properties;
  expect(props.petition?.enum).toContain(petition.id);
  expect(view.schema.parse({ action: "refuse", petition: "evt-1-1" }).ok).toBe(
    false,
  );
  expect(view.schema.parse({ action: "refuse" }).ok).toBe(false);
  // Another god, never prayed to, has nothing to refuse.
  expect(
    godAvailableActions(
      godProfile("athena"),
      run.view("athena").snapshot,
      run.view("athena").remembered,
    ),
  ).not.toContain("refuse");
  expect(run.view("athena").schema.parse(refuse).ok).toBe(false);

  const result = run.send("hermes", refuse);
  expect(result.rejected).toEqual([]);
  expect(
    result.events.find((e) => e.kind === "petition-refused"),
  ).toMatchObject({
    entityId: "hermes",
    petitioner: IRIS,
    petitionId: petition.id,
  });
  expect(run.state.petitions.get(petition.id)?.status).toBe("refused");
  // Once closed it is no longer shown or offered.
  const after = run.view("hermes");
  expect(prompt(after)).not.toContain(`[${petition.id}]`);
  expect(after.schema.parse(refuse).ok).toBe(false);
});

test("the schema requires a petition for a bless and for a refusal, each from its own ids, as the parser does", () => {
  const run = new Run();
  const { petition } = run.struckAndPrays("poseidon", IRIS);
  const { schema } = run.view("hermes");
  const conditions = (
    schema.jsonSchema as {
      allOf: {
        if: { properties: { action: { const: string } } };
        then: {
          required: string[];
          properties: { petition: { enum: string[] } };
        };
      }[];
    }
  ).allOf;
  const refusal = conditions.find(
    (c) => c.if.properties.action?.const === "refuse",
  );
  expect(refusal?.then.required).toEqual(["petition"]);
  expect(refusal?.then.properties.petition.enum).toEqual([petition.id]);
  // A bless is offered wherever the petitioner is: Iris is at the square, Hermes is not, and the prayer is its own id.
  const blessing = conditions.find(
    (c) => c.if.properties.action?.const === "bless",
  );
  expect(blessing?.then.required).toEqual(["petition"]);
  expect(blessing?.then.properties.petition.enum).toEqual([petition.id]);
  // And the same with Hermes standing at the square beside her.
  const here = new Run(actorAt(greekState(), "hermes", "town-square"));
  const { petition: nearby } = here.struckAndPrays("poseidon", IRIS);
  const beside = (
    here.view("hermes").schema.jsonSchema as unknown as {
      allOf: typeof conditions;
    }
  ).allOf.find((c) => c.if.properties.action?.const === "bless");
  expect(beside?.then.required).toEqual(["petition"]);
  expect(beside?.then.properties.petition.enum).toEqual([nearby.id]);
});

test("a prayer about a trouble in a god's domain is marked as one, naming the trouble, from anyone: Zeus is shown a squall, and the prayer went to him though the afflicted reveres another", () => {
  const run = new Run();
  const trouble = run.apply({
    kind: "trouble",
    entityId: "farmer",
    trouble: "squall",
    god: "zeus",
    season: "autumn",
    source: "season",
    loss: { kind: "building", building: "agora-shop" },
  });
  const prayed = run.pray("farmer", trouble.id);
  expect(run.state.patrons.get(id("farmer"))).toBe(id("hera"));
  expect(prayed.god).toBe(id("zeus"));
  const text = prompt(run.view("zeus"));
  expect(text).toContain(`[${prayed.id}] farmer (a squall in your domain)`);
  expect(text).toContain("agora-shop was damaged by a squall");
  // Hera, its patron, is not shown it.
  expect(prompt(run.view("hera"))).not.toContain(prayed.id);
});

test("the prompt names the season after a turn and when the next begins (AE7), and counts the god's flock", () => {
  const run = new Run({ ...greekState(), tick: 199 });
  expect(prompt(run.view("zeus"))).toContain(
    "It is spring; summer begins at tick 200.",
  );
  run.tick();
  expect(run.events.some((e) => e.kind === "season-turned")).toBe(true);
  const text = prompt(run.view("zeus"));
  expect(text).toContain("It is summer; autumn begins at tick 400.");
  // Hermes has four worshippers, at four places.
  expect(prompt(run.view("hermes"))).toMatch(
    /Your flock: 4 mortals revere you, most at [a-z-]+ \(1\), [a-z-]+ \(1\)\./,
  );
  // Zeus has one.
  expect(text).toMatch(
    /Your flock: 1 mortal reveres you, most at town-square \(1\)\./,
  );
  // A world with no trouble table has no seasons to name.
  const { troubles: _none, ...rules } = greekState().rules;
  const bare = new Run({ ...greekState(), rules });
  expect(prompt(bare.view("zeus"))).not.toMatch(
    /It is (spring|summer|autumn|winter)/,
  );
});

test("a god that lost a worshipper is shown the defection as a cause to demand over and a contest to open, written out, and the world takes the contest", () => {
  const run = new Run();
  const fisher = "fisher-kallias"; // Poseidon's, at the dock
  const change = run.apply({
    kind: "patron-changed",
    entityId: fisher,
    from: "poseidon",
    to: "athena",
    answered: "evt-0-1",
    unanswered: [],
  });
  for (const [god, other] of [
    ["poseidon", "athena"],
    ["athena", "poseidon"],
  ] as const) {
    run.apply({
      kind: "memory-recorded",
      memoryKind: "patronage",
      entityId: god,
      sourceEventId: change.id,
      salience: 8,
      subjects: [fisher, "ferry-dock", other],
      mortal: fisher,
      home: "ferry-dock",
      from: "poseidon",
      to: "athena",
    });
  }
  const view = run.view("poseidon");
  const text = prompt(view);
  // The memory itself, and the act it makes available.
  expect(text).toContain("You remember:");
  expect(text).toContain(`${fisher} of ferry-dock left poseidon for athena`);
  expect(text).toContain(CONTESTS_HEADING);
  expect(text).toContain(`athena took ${fisher} of ferry-dock from your flock`);
  const contest = objectAfter(text, "took fisher-kallias");
  expect(contest).toEqual({
    action: "practice",
    move: "contest",
    act: change.id,
  });
  const result = run.send("poseidon", contest);
  expect(result.rejected).toEqual([]);
  expect(result.events.find((e) => e.kind === "contest-opened")).toMatchObject({
    entityId: "poseidon",
    rival: "athena",
    place: "ferry-dock",
    cause: change.id,
  });
  // Athena, who gained the worshipper, is offered no contest over it.
  const gainer = run.view("athena");
  expect(prompt(gainer)).not.toContain("from your flock");
  expect(gainer.schema.parse(contest).ok).toBe(false);
});

test("every copyable move shown in a crowded prompt validates through the world, and the schema names exactly the prayers the prompt shows", () => {
  const run = new Run();
  // Many worshippers of Hermes pray: struck by gods, one after another.
  const worshippers = [
    "market-trader-iris",
    "fisher-dion",
    "herdsman-damon",
    "provisioner-nikanor",
  ];
  for (const [index, mortal] of worshippers.entries()) {
    run.struckAndPrays(index % 2 === 0 ? "poseidon" : "athena", mortal);
    run.state = { ...run.state, tick: run.state.tick + 25 };
  }
  const view = run.view("hermes");
  const text = prompt(view);
  const shown = view.remembered.petitions.map((p) => p.id);
  expect(shown.length).toBeGreaterThan(0);
  // The section is within its budget, and ends with how many it left out when it left any out.
  const section = text.slice(text.indexOf("Prayers to you:"));
  expect(section.length).toBeLessThan(PRAYERS_BUDGET_CHARS + 600);
  if (view.remembered.morePrayers > 0) {
    expect(text).toContain(
      `- and ${view.remembered.morePrayers} more prayers to you.`,
    );
  }
  // Every object in a choice line goes through the real validator and parser.
  const objects = text
    .split("\n")
    .filter((line) => /^ {2}- (refuse it|demand redress|punish)/.test(line))
    .map((line) => {
      const from = line.indexOf("{");
      let depth = 0;
      for (let at = from; at < line.length; at += 1) {
        if (line[at] === "{") depth += 1;
        if (line[at] === "}" && --depth === 0)
          return JSON.parse(line.slice(from, at + 1));
      }
      throw new Error(line);
    });
  expect(objects.length).toBeGreaterThanOrEqual(shown.length);
  for (const intent of objects) {
    const copy = new Run(run.state);
    const result = copy.send("hermes", intent);
    expect([JSON.stringify(intent), result.rejected]).toEqual([
      JSON.stringify(intent),
      [],
    ]);
  }
  // The schema's refusable ids are the shown prayers.
  const props = (
    view.schema.jsonSchema as {
      properties: Record<string, { enum?: string[] }>;
    }
  ).properties;
  expect([...(props.petition?.enum ?? [])].sort()).toEqual([...shown].sort());
  // The harms its worshippers prayed about are causes to demand over, but only the newest two: the prompt has a budget.
  const prayerCauses = view.remembered.practice.causes.filter(
    (cause) => cause.fact !== undefined,
  );
  expect(prayerCauses.length).toBeLessThanOrEqual(2);
  // A live practice keeps its prayer in view: the one an open offer names is always shown (see prayer-budget.test.ts).
});
