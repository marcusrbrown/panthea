// What a god is shown of the contests it may open and the ones it holds: a
// section of choices (never a command), each a copyable object the world's own
// validator has already accepted, within a character budget like the prayers'.
// The schema, the parser, and the section name the same acts and no others, and
// consent is never inferred. The world is real (the authored Greek pack, real
// ticks, the real validator).

import { expect, test } from "bun:test";
import type { EventId, WorldEvent } from "@panthea/contracts";
import {
  applyEvent,
  contestableActs,
  createPrng,
  decideRoutineProposal,
  getActor,
  perceive,
  runTick,
  submitProposal,
  toEntityId,
  validateProposal,
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
import { CONTESTS_BUDGET_CHARS, CONTESTS_HEADING } from "./practices";
import {
  allGodProfiles,
  godProfile,
  greekState,
  withoutFireSpread,
} from "./test-fixtures";

const id = toEntityId;

class Run {
  state: WorldState;
  readonly events: WorldEvent[] = [];
  private n = 0;
  constructor() {
    // Athena and Poseidon at the ferry dock, where fishers live: the place two rivals may claim.
    let state = withoutFireSpread(greekState());
    const athena = getActor(state, id("athena"));
    if (!athena) throw new Error("athena");
    state = withActor(state, { ...athena, locationId: id("ferry-dock") });
    // Gods with divinity to spare, so a crowd of blessings is not the limit of a test.
    for (const god of ["athena", "poseidon", "hera"]) {
      const actor = getActor(state, id(god));
      if (!actor) throw new Error(god);
      state = withActor(state, {
        ...actor,
        inventory: new Map(actor.inventory).set("divinity", 500),
      });
    }
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
        observationId: `obs-cx-${this.n}`,
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
  /** `god` blesses `mortal` at the dock after its prayer; returns the blessing the world committed. */
  blessing(god: string, mortal: string): EventId {
    const spoiled = this.apply({
      kind: "stock-spoiled",
      entityId: mortal,
      resource: "food",
      amount: 1,
      cause: "director",
    });
    const petition = this.apply({
      kind: "petition-opened",
      entityId: mortal,
      god,
      cause: spoiled.id,
      request: {
        kind: "help",
        need: { kind: "resource", resource: "food", amount: 1 },
      },
    });
    const ran = this.tick({ actor: god, kind: "bless", petition: petition.id });
    const granted = ran.events.find((e) => e.kind === "blessing-granted");
    if (!granted) throw new Error("no blessing");
    return granted.id as EventId;
  }
  view(god: string) {
    const snapshot = perceive(this.state, id(god), this.events);
    if (!snapshot) throw new Error("no snapshot");
    const remembered = rememberedBy(this.state, id(god), this.events);
    const profile = godProfile(god);
    return {
      snapshot,
      remembered,
      context: buildGodContext(profile, snapshot, remembered),
      schema: godIntentSchema(profile, snapshot, remembered),
      actions: godAvailableActions(profile, snapshot, remembered),
    };
  }
}

const FISHERS = [
  "fisher-kallias",
  "fisher-melina",
  "fisher-stavros",
  "fisher-eleni",
  "fisher-dion",
];

/** The lines of the contests section of a prompt: the heading and the dashed and indented lines under it. */
function contestsSection(prompt: string): string[] {
  const lines = prompt.split("\n");
  const at = lines.indexOf(CONTESTS_HEADING);
  if (at < 0) return [];
  let end = at + 1;
  while (end < lines.length && /^( {2}|- |You saw)/.test(lines[end] ?? "")) {
    end += 1;
  }
  return lines.slice(at, end);
}

const contestObject = (act: string) => ({
  action: "practice",
  move: "contest",
  act,
});

/** The act ids a section offers, read from the copyable objects it shows. */
const offeredActs = (section: readonly string[]): string[] =>
  section.flatMap((line) => {
    const match = /"move":"contest","act":"(evt-[^"]+)"/.exec(line);
    return match === null ? [] : [match[1] as string];
  });

// --- The choices -------------------------------------------------------------------------------

test("a god that perceived a rival's act is shown a choice to open a contest over it: a copyable object, never a command", () => {
  const run = new Run();
  const act = run.blessing("poseidon", FISHERS[0] as string);
  const { context, actions } = run.view("athena");
  const section = contestsSection(context.prompt);
  expect(section[0]).toBe(CONTESTS_HEADING);
  expect(actions).toContain("practice");
  // The object is shown whole, and the world's own validator has already taken it.
  expect(offeredActs(section)).toEqual([act]);
  expect(section.join("\n")).toContain(JSON.stringify(contestObject(act)));
  // A choice, not an order.
  const text = section.join("\n");
  expect(text).toContain("nothing requires it");
  expect(text).toContain("waiting is always allowed");
  expect(text).not.toMatch(
    /\b(you must|contest (it )?now|open a contest now|should)\b/i,
  );
  // It says who did what, and where.
  expect(text).toContain("poseidon");
  expect(text).toContain("blessed");
  expect(text).toContain("ferry-dock");
  // The instructions explain what a contest is without ordering one.
  expect(context.instructions).toContain("contest");
  expect(context.instructions).not.toMatch(/\bcontest now\b/i);
});

test("every object a section offers is one the world would commit: it becomes a proposal the validator accepts", () => {
  const run = new Run();
  const acts = [
    run.blessing("poseidon", FISHERS[0] as string),
    run.blessing("poseidon", FISHERS[1] as string),
  ];
  const { context, snapshot, remembered, schema } = run.view("athena");
  const shown = offeredActs(contestsSection(context.prompt));
  expect(shown.sort()).toEqual([...acts].sort());
  for (const act of shown) {
    const parsed = schema.parse(contestObject(act));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) continue;
    const built = buildModelProposal(
      id("athena"),
      snapshot,
      parsed.value,
      remembered,
    );
    if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
    expect(built.proposal).toMatchObject({
      kind: "practice",
      move: "contest",
      cause: act,
    });
    expect(validateProposal(run.state, built.proposal).ok).toBe(true);
  }
  expect(
    contestableActs(run.state, id("athena"))
      .map((a) => a.id)
      .sort(),
  ).toEqual([...acts].sort());
});

test("a god with no perceived rival act is offered no contest, even beside its rival: nothing to show, nothing to name", () => {
  const run = new Run();
  const { context, schema, actions } = run.view("athena");
  expect(contestsSection(context.prompt)).toEqual([]);
  expect(context.prompt).not.toContain('"move":"contest"');
  const move = (
    schema.jsonSchema as { properties: { move?: { enum: string[] } } }
  ).properties.move;
  expect(move?.enum ?? []).not.toContain("contest");
  expect(schema.parse(contestObject("evt-404")).ok).toBe(false);
  expect(actions).toContain("wait");
});

test("a rival's act another god did, or one the god did not perceive, is not offered; nor is its own", () => {
  // Hera blessed: no rivalry with Athena.
  const hera = new Run();
  const heraAt = getActor(hera.state, id("hera"));
  if (!heraAt) throw new Error("hera");
  hera.state = withActor(hera.state, {
    ...heraAt,
    locationId: id("ferry-dock"),
  });
  hera.blessing("hera", FISHERS[0] as string);
  expect(
    offeredActs(contestsSection(hera.view("athena").context.prompt)),
  ).toEqual([]);

  // Athena was elsewhere.
  const away = new Run();
  const athena = getActor(away.state, id("athena"));
  if (!athena) throw new Error("athena");
  away.state = withActor(away.state, {
    ...athena,
    locationId: id("town-square"),
  });
  away.blessing("poseidon", FISHERS[0] as string);
  expect(
    offeredActs(contestsSection(away.view("athena").context.prompt)),
  ).toEqual([]);

  // Its own act is never a rival's.
  const own = new Run();
  own.blessing("athena", FISHERS[0] as string);
  expect(
    offeredActs(contestsSection(own.view("athena").context.prompt)),
  ).toEqual([]);
});

// --- Schema, parser, and the section agree ---------------------------------------------------------

test("the schema, the parser, and the section name exactly the acts the world would take, and a move names its act outright: consent is never inferred", () => {
  const run = new Run();
  const act = run.blessing("poseidon", FISHERS[0] as string);
  const old = run.blessing("athena", FISHERS[1] as string); // Athena's own act: not offered to her
  const { context, schema } = run.view("athena");
  const section = contestsSection(context.prompt);
  const properties = (
    schema.jsonSchema as {
      properties: Record<string, { enum?: string[] }>;
    }
  ).properties;
  expect(properties.move?.enum).toContain("contest");
  expect(properties.act?.enum).toEqual([act]);
  expect(offeredActs(section)).toEqual([act]);
  // The act is its own field: a demand's cause is not widened by it.
  expect(properties.cause?.enum ?? []).not.toContain(act);

  expect(schema.parse(contestObject(act)).ok).toBe(true);
  // An act the god was not offered is refused: its own, one that never was, and a cause from elsewhere.
  for (const bad of [
    contestObject(old),
    contestObject("evt-404"),
    { action: "practice", move: "contest", act: "" },
    { action: "practice", move: "contest" },
  ]) {
    expect(schema.parse(bad).ok).toBe(false);
  }
  // The move is never inferred from the act alone, nor does a contest take what belongs to another move.
  const alone = schema.parse({ action: "practice", act });
  expect(alone.ok).toBe(false);
  if (!alone.ok) expect(alone.message).toContain("contest");
  for (const stray of [
    { cause: act },
    {
      term: {
        kind: "ally",
        party: "athena",
        to: "poseidon",
        deadlineTicks: 90,
      },
    },
    { thread: "evt-9" },
    { prayer: "evt-9" },
    { swear: true },
    { stake: "wolf" },
  ]) {
    expect(
      schema.parse({ action: "practice", move: "contest", act, ...stray }).ok,
    ).toBe(false);
  }
  // Waiting is always allowed.
  expect(schema.parse({ action: "wait" }).ok).toBe(true);
});

test("the contest's act field is required by the schema for a contest and by nothing else", () => {
  const run = new Run();
  run.blessing("poseidon", FISHERS[0] as string);
  const schema = run.view("athena").schema.jsonSchema as {
    allOf?: {
      if: { properties: Record<string, unknown> };
      then: { required: string[] };
    }[];
  };
  const conditions = (schema.allOf ?? []).filter((c) =>
    JSON.stringify(c.if).includes('"contest"'),
  );
  expect(conditions).toHaveLength(1);
  expect(conditions[0]?.then.required).toEqual(["act"]);
});

// --- Contests the god holds ---------------------------------------------------------------------------

test("a contest a god is in is shown to both gods with where, against whom, until when, and how many mortals favour each so far; and the world no longer offers a second at that place", () => {
  const run = new Run();
  const act = run.blessing("poseidon", FISHERS[0] as string);
  run.tick({ actor: "athena", kind: "practice", move: "contest", cause: act });
  const [contest] = [...run.state.contests.values()];
  if (!contest) throw new Error("no contest");
  run.blessing("athena", FISHERS[1] as string);
  run.blessing("athena", FISHERS[2] as string);
  run.blessing("poseidon", FISHERS[3] as string);

  const athena = contestsSection(run.view("athena").context.prompt).join("\n");
  expect(athena).toContain(`[${contest.id}]`);
  expect(athena).toContain("ferry-dock");
  expect(athena).toContain("against poseidon");
  expect(athena).toContain(`until tick ${contest.closesAt}`);
  expect(athena).toContain("2 mortals favour you");
  expect(athena).toContain("1 favours poseidon");

  const poseidon = contestsSection(run.view("poseidon").context.prompt).join(
    "\n",
  );
  expect(poseidon).toContain("against athena");
  expect(poseidon).toContain("1 favours you");
  expect(poseidon).toContain("2 mortals favour athena");

  // The place is held: Athena is offered no second contest over another of Poseidon's acts there.
  expect(
    offeredActs(contestsSection(run.view("athena").context.prompt)),
  ).toEqual([]);
});

test("a god that is not in a contest is not told of it", () => {
  const run = new Run();
  const act = run.blessing("poseidon", FISHERS[0] as string);
  run.tick({ actor: "athena", kind: "practice", move: "contest", cause: act });
  expect(contestsSection(run.view("zeus").context.prompt)).toEqual([]);
  expect(contestsSection(run.view("hera").context.prompt)).toEqual([]);
});

// --- The budget -------------------------------------------------------------------------------------------

test("a crowd of rival acts stays within the section's budget: the newest are offered, the rest are counted, and the schema and the parser name only those shown", () => {
  const run = new Run();
  const acts: EventId[] = [];
  for (let n = 0; n < 12; n += 1) {
    acts.push(run.blessing("poseidon", FISHERS[n % FISHERS.length] as string));
  }
  const { context, schema } = run.view("athena");
  const section = contestsSection(context.prompt);
  const size = section.reduce((sum, line) => sum + line.length + 1, 0);
  expect(size).toBeLessThanOrEqual(CONTESTS_BUDGET_CHARS);
  const shown = offeredActs(section);
  expect(shown.length).toBeGreaterThan(0);
  expect(shown.length).toBeLessThan(acts.length);
  // The newest, newest first.
  expect(shown).toEqual([...acts].reverse().slice(0, shown.length));
  expect(section.at(-1)).toBe(
    `- and ${acts.length - shown.length} more acts of rivals you saw.`,
  );
  const properties = (
    schema.jsonSchema as { properties: Record<string, { enum?: string[] }> }
  ).properties;
  expect([...(properties.act?.enum ?? [])].sort()).toEqual([...shown].sort());
  for (const act of shown)
    expect(schema.parse(contestObject(act)).ok).toBe(true);
  for (const act of acts.filter((a) => !shown.includes(a))) {
    expect(schema.parse(contestObject(act)).ok).toBe(false);
    expect(
      `${context.instructions}\n${context.prompt}\n${JSON.stringify(schema.jsonSchema)}`,
    ).not.toContain(act);
  }
});

test("a busy world with rival acts, open contests, and a crowd of prayers still builds every god's prompt within the whole-prompt guard", () => {
  const quiet = withoutFireSpread(greekState());
  // The town's own wrongs add prayers to every prompt; the prompt budget for them is measured with the prompts' own unit.
  const { temperamentOdds: _wrongs, ...rules } = quiet.rules;
  let state = { ...quiet, rules };
  let prng = createPrng(1);
  const log: WorldEvent[] = [];
  for (let tick = 0; tick < 400; tick += 1) {
    const queue = [];
    for (const actorId of state.actors.keys()) {
      const decided = decideRoutineProposal(state, actorId);
      if (decided) queue.push(decided.proposal);
    }
    const result = runTick(state, prng, queue);
    state = result.state;
    prng = result.prng;
    log.push(...result.events);
  }
  // The gods meet at the dock, where the fishers are (set here, not left to where the town's own day took them);
  // each of Poseidon's acts and Athena's is real, and one contest is held.
  for (const god of ["athena", "hera", "poseidon", ...FISHERS]) {
    const actor = getActor(state, id(god));
    if (actor)
      state = withActor(state, { ...actor, locationId: id("ferry-dock") });
  }
  const stage = new Run();
  stage.state = state;
  for (let n = 0; n < 20; n += 1) {
    const mortal = FISHERS[n % FISHERS.length] as string;
    try {
      stage.blessing(n % 2 === 0 ? "poseidon" : "hera", mortal);
    } catch {
      // A bless the world would not commit leaves no act: the prompt is measured as it stands.
    }
  }
  const crowd = stage.state;
  const worst = { chars: 0, god: "" };
  let sections = 0;
  for (const profile of allGodProfiles) {
    const recent = log.filter((event) => event.tick > crowd.tick - 10);
    const snapshot = perceive(crowd, id(profile.id), recent);
    if (!snapshot) continue;
    const remembered = rememberedBy(crowd, id(profile.id), recent);
    const built = buildGodContext(profile, snapshot, remembered);
    const section = contestsSection(built.prompt);
    if (section.length > 0) sections += 1;
    expect(
      section.reduce((sum, line) => sum + line.length + 1, 0),
    ).toBeLessThanOrEqual(CONTESTS_BUDGET_CHARS);
    const chars = (built.instructions?.length ?? 0) + built.prompt.length;
    if (chars > worst.chars) Object.assign(worst, { chars, god: profile.id });
  }
  expect(sections).toBeGreaterThan(0);
  // At about 3.3 characters a token (measured on qwen3-8b-4k) this is under 2.9K tokens of a 4K context
  // that Ollama truncates silently past about 4,090.
  expect(worst.chars).toBeLessThanOrEqual(9500);
});
