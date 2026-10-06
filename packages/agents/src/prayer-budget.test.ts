// A crowd of prayers must not push a god's instructions out of the model's
// context. The prayers section has a character budget; the prayers it cannot
// hold become one line, "and N more prayers to you". What the god is shown, what
// the schema lets it name, and what the parser accepts are the same prayers:
// a god is never offered an id it cannot see, and a hidden id is refused. The
// world is real (the authored Greek pack, real ticks, the real validator).

import { expect, test } from "bun:test";
import type { EventId, WorldEvent } from "@panthea/contracts";
import {
  applyEvent,
  createPrng,
  decideRoutineProposal,
  getActor,
  perceive,
  runTick,
  submitProposal,
  toEntityId,
  type WorldState,
} from "@panthea/world";
import {
  buildGodContext,
  godIntentSchema,
  PRAYERS_HEADING,
  rememberedBy,
} from "./context";
import { PRAYERS_BUDGET_CHARS } from "./practices";
import {
  allGodProfiles,
  godProfile,
  greekState,
  withoutFireSpread,
} from "./test-fixtures";

const id = toEntityId;

/** The prayers section of a prompt: the heading and the dashed or indented lines under it. */
function prayersSection(prompt: string): string {
  const lines = prompt.split("\n");
  const at = lines.indexOf(PRAYERS_HEADING);
  if (at < 0) return "";
  let end = at + 1;
  while (end < lines.length && /^( {2}|- )/.test(lines[end] ?? "")) end += 1;
  return lines.slice(at, end).join("\n");
}

const shownPrayerIds = (prompt: string): string[] =>
  [...prayersSection(prompt).matchAll(/^- \[(evt-[^\]]+)\]/gm)].map(
    (match) => match[1] as string,
  );

class Run {
  state: WorldState = withoutFireSpread(greekState());
  readonly events: WorldEvent[] = [];
  private n = 0;
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
        observationId: `obs-pb-${this.n}`,
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
  /** A tick passes with nothing proposed, so the next prayer is newer. */
  later() {
    this.state = { ...this.state, tick: this.state.tick + 1 };
  }
  /** `mortal` prays to `god` about food that spoiled. */
  prays(mortal: string, god = "zeus"): EventId {
    this.later();
    const cause = this.apply({
      kind: "stock-spoiled",
      entityId: mortal,
      resource: "food",
      amount: 1,
      cause: "director",
    });
    return this.apply({
      kind: "petition-opened",
      entityId: mortal,
      god,
      cause: cause.id,
      request: {
        kind: "help",
        need: { kind: "resource", resource: "food", amount: 1 },
      },
    }).id as EventId;
  }
  view(god: string) {
    const snapshot = perceive(this.state, id(god), this.events);
    if (!snapshot) throw new Error("no snapshot");
    const remembered = rememberedBy(this.state, id(god));
    const profile = godProfile(god);
    return {
      snapshot,
      remembered,
      context: buildGodContext(profile, snapshot, remembered),
      schema: godIntentSchema(profile, snapshot, remembered),
    };
  }
}

/** Mortals of the pack that hold currency, so each can be asked for an offering. */
function offeringMortals(state: WorldState): string[] {
  return [...state.actors.values()]
    .filter(
      (actor) =>
        actor.alive &&
        !actor.isDeity &&
        (actor.inventory.get("currency") ?? 0) >= 1,
    )
    .map((actor) => String(actor.id));
}

const gift = (party: string, ticks = 80) => ({
  kind: "make-offering",
  party,
  to: "zeus",
  resource: "currency",
  amount: 1,
  deadlineTicks: ticks,
});

/** Thirty open prayers to Zeus, oldest first; the first three are from mortals Zeus has already set terms with (two open offers and one accepted). */
function crowd() {
  const run = new Run();
  const mortals = offeringMortals(run.state);
  const ids: EventId[] = [];
  for (let i = 0; i < 30; i += 1) {
    ids.push(run.prays(mortals[i % mortals.length] as string));
  }
  const live = [ids[0], ids[1], ids[2]] as EventId[];
  const partyOf = (petition: EventId) =>
    String(run.state.petitions.get(petition)?.petitioner);
  for (const petition of live) {
    run.tick({
      actor: "zeus",
      kind: "practice",
      move: "offer",
      petition,
      term: gift(partyOf(petition)),
    });
  }
  // The third is accepted: an obligation that names the prayer.
  const threads = [...run.state.threads.values()];
  const accepted = threads.find((t) => t.petition === live[2]);
  if (!accepted) throw new Error("no thread on the third prayer");
  run.tick({
    actor: partyOf(live[2] as EventId),
    kind: "practice",
    move: "accept",
    thread: accepted.id,
  });
  return { run, ids, live };
}

test("with thirty open prayers to one god, the section stays within the budget, ends with the count of those it left out, and holds every prayer a live practice names", () => {
  const { run, ids, live } = crowd();
  const { context, remembered } = run.view("zeus");
  const section = prayersSection(context.prompt);
  expect(section.length).toBeGreaterThan(0);
  expect(section.length).toBeLessThanOrEqual(PRAYERS_BUDGET_CHARS);
  const shown = shownPrayerIds(context.prompt);
  expect(shown.length).toBeGreaterThan(0);
  expect(shown.length).toBeLessThan(ids.length);
  const lines = section.split("\n");
  expect(lines.at(-1)).toBe(
    `- and ${ids.length - shown.length} more prayers to you.`,
  );
  // Every prayer a live practice names is shown, whatever the budget.
  for (const petition of live) expect(shown).toContain(petition);
  // The world keeps them all; only the prompt is shorter.
  expect(remembered.petitions.map((p) => p.id)).toEqual(shown as EventId[]);
  expect(
    [...run.state.petitions.values()].filter((p) => p.status === "open"),
  ).toHaveLength(ids.length);
});

test("prayers with a live practice come first, then the newest; none of the rest is older than one it hid", () => {
  const { run, ids, live } = crowd();
  const shown = shownPrayerIds(run.view("zeus").context.prompt);
  expect(shown.slice(0, live.length).sort()).toEqual([...live].sort());
  const rest = shown.slice(live.length);
  expect(rest.length).toBeGreaterThan(0);
  const age = (petition: string) => ids.indexOf(petition as EventId);
  // Newest first among the rest, and everything it hid is older than the oldest it showed.
  for (let i = 1; i < rest.length; i += 1) {
    expect(age(rest[i - 1] as string)).toBeGreaterThan(age(rest[i] as string));
  }
  const hidden = ids.filter(
    (petition) => !shown.includes(petition) && !live.includes(petition),
  );
  const oldestShown = Math.min(...rest.map(age));
  for (const petition of hidden)
    expect(age(petition)).toBeLessThan(oldestShown);
});

test("the schema, the parser, and the openings name exactly the prayers shown: a hidden prayer is not offered an id and an offer on it is refused", () => {
  const { run, ids } = crowd();
  const { context, schema, remembered } = run.view("zeus");
  const shown = shownPrayerIds(context.prompt);
  const hidden = ids.filter((petition) => !shown.includes(petition));
  expect(hidden.length).toBeGreaterThan(0);

  const properties = (
    schema.jsonSchema as {
      properties: Record<string, { enum?: string[] }>;
    }
  ).properties;
  // The prayers a god may still set terms on are the shown ones that hold none.
  const offerable = remembered.practice.offerable.map((p) => String(p.id));
  expect(offerable.length).toBeGreaterThan(0);
  for (const petition of offerable) expect(shown).toContain(petition);
  expect([...(properties.prayer?.enum ?? [])].sort()).toEqual(
    [...offerable].sort(),
  );
  // No hidden id is anywhere the god can read: prompt, instructions, schema, or an opening.
  const everything = `${context.instructions}\n${context.prompt}\n${JSON.stringify(schema.jsonSchema)}\n${JSON.stringify(remembered.practice.openings)}`;
  for (const petition of hidden) expect(everything).not.toContain(petition);
  // The opening points at a prayer the god can see.
  for (const opening of remembered.practice.openings) {
    const prayer = (opening.intent as { prayer?: string }).prayer;
    if (prayer !== undefined) expect(shown).toContain(prayer);
  }
  // The parser refuses what the schema does not list.
  const mortalOf = (petition: string) =>
    String(run.state.petitions.get(petition as EventId)?.petitioner);
  const offerOn = (petition: string) => ({
    action: "practice",
    move: "offer",
    prayer: petition,
    term: gift(mortalOf(petition)),
  });
  expect(schema.parse(offerOn(offerable[0] as string)).ok).toBe(true);
  expect(schema.parse(offerOn(hidden[0] as string)).ok).toBe(false);
});

test("a bless names only a prayer shown: the schema's petition ids are the shown prayers whose petitioner stands here, and a hidden one is refused at parse", () => {
  const run = new Run();
  const mortals = offeringMortals(run.state);
  const ids: EventId[] = [];
  // Zeus stands at the great hall; bring every petitioner there so every prayer is blessable.
  for (let i = 0; i < 30; i += 1) {
    const mortal = mortals[i % mortals.length] as string;
    const actor = getActor(run.state, id(mortal));
    if (actor) {
      run.state = {
        ...run.state,
        actors: new Map(run.state.actors).set(actor.id, {
          ...actor,
          locationId: getActor(run.state, id("zeus"))?.locationId as never,
        }),
      };
    }
    ids.push(run.prays(mortal));
  }
  const { context, schema, remembered } = run.view("zeus");
  const shown = shownPrayerIds(context.prompt);
  expect(shown.length).toBeLessThan(ids.length);
  const properties = (
    schema.jsonSchema as { properties: Record<string, { enum?: string[] }> }
  ).properties;
  const blessable = properties.petition?.enum ?? [];
  expect(blessable.length).toBeGreaterThan(0);
  for (const petition of blessable) expect(shown).toContain(petition);
  expect(remembered.petitions.map((p) => String(p.id))).toEqual(shown);
  const hidden = ids.find((petition) => !shown.includes(petition));
  expect(hidden).toBeDefined();
  expect(
    schema.parse({ action: "bless", petition: hidden as EventId }).ok,
  ).toBe(false);
  expect(
    schema.parse({ action: "bless", petition: blessable[0] as EventId }).ok,
  ).toBe(true);
});

test("a god with few prayers sees them all, in the order it always did, with no line about the rest", () => {
  const run = new Run();
  const mortals = offeringMortals(run.state);
  const ids = [0, 1, 2].map((i) => run.prays(mortals[i] as string));
  const { context } = run.view("zeus");
  expect(shownPrayerIds(context.prompt).sort()).toEqual([...ids].sort());
  expect(prayersSection(context.prompt)).not.toContain("more prayers");
});

test("a busy world cannot build a prompt past the budget for any of the seven gods: prayers stay within their share and the whole prompt stays well inside 4K tokens", () => {
  let state = greekState();
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
  // Mortals go short rarely now, so the routines alone no longer crowd a god's prayers: the day ends with a crowd of
  // prayers to Zeus, staged as the world would have committed them.
  const crowd = new Run();
  crowd.state = state;
  const petitioners = [...state.actors.values()]
    .filter((actor) => !actor.isDeity && actor.drives)
    .map((actor) => String(actor.id));
  for (let i = 0; i < 30; i += 1) {
    crowd.prays(petitioners[i % petitioners.length] as string);
  }
  state = crowd.state;
  log.push(...crowd.events);
  const worst = { chars: 0, god: "" };
  let crowded = 0;
  for (const profile of allGodProfiles) {
    const snapshot = perceive(
      state,
      id(profile.id),
      log.filter((event) => event.tick > state.tick - 10),
    );
    if (!snapshot) continue;
    const remembered = rememberedBy(
      state,
      id(profile.id),
      log.filter((event) => event.tick > state.tick - 10),
    );
    const context = buildGodContext(profile, snapshot, remembered);
    const open = [...state.petitions.values()].filter(
      (p) => p.god === profile.id && p.status === "open",
    ).length;
    if (open > shownPrayerIds(context.prompt).length) crowded += 1;
    expect(prayersSection(context.prompt).length).toBeLessThanOrEqual(
      PRAYERS_BUDGET_CHARS,
    );
    const chars = (context.instructions?.length ?? 0) + context.prompt.length;
    if (chars > worst.chars) {
      worst.chars = chars;
      worst.god = profile.id;
    }
  }
  // The world kept prayers the prompt could not hold, so the cap was exercised.
  expect(crowded).toBeGreaterThan(0);
  // At about 3.3 characters a token (measured on qwen3-8b-4k) this is under 2.7K tokens of a 4K context
  // that Ollama truncates silently past about 4,090. The bound was 8,500 before a god's way out became a
  // line naming every place it can travel to (ids and steps, about 250 characters for the authored map).
  expect(worst.chars).toBeLessThanOrEqual(8700);
});
