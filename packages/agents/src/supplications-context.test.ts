// What a god is shown of the prayers it may set terms on, and what it may answer
// with: the flat `practice` intent's `offer` move, the stakes it may attach, the
// proposal the service builds, and the rows a standing supplication gives its
// god. The world is real (the authored Greek pack, real ticks, the real
// validator); nothing here mocks the rules.

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
import { NO_PRACTICE, PRACTICES_HEADING } from "./practices";
import { godProfile, greekState, withoutFireSpread } from "./test-fixtures";

const id = toEntityId;

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
        observationId: `obs-sp-${this.n}`,
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
  /** `mortal` prays to `god` about food that spoiled: a real petition, opened by the world. */
  prays(mortal = "farmer", god = "zeus"): EventId {
    const cause = this.apply({
      kind: "stock-spoiled",
      entityId: mortal,
      resource: "food",
      amount: 1,
      cause: "director",
    });
    const opened = this.apply({
      kind: "petition-opened",
      entityId: mortal,
      god,
      cause: cause.id,
      request: {
        kind: "help",
        need: { kind: "resource", resource: "food", amount: 1 },
      },
    });
    return opened.id;
  }
  view(god: string, profile = godProfile(god)) {
    const snapshot = perceive(this.state, id(god), this.events);
    if (!snapshot) throw new Error("no snapshot");
    const remembered = rememberedBy(this.state, id(god));
    return {
      snapshot,
      remembered,
      context: buildGodContext(profile, snapshot, remembered),
      schema: godIntentSchema(profile, snapshot, remembered),
      actions: godAvailableActions(profile, snapshot, remembered),
    };
  }
  latest() {
    const thread = [...this.state.threads.values()].at(-1);
    if (!thread) throw new Error("no thread");
    return thread;
  }
}

const gift = (
  party = "farmer",
  god = "zeus",
  ticks = 80,
  extra: Record<string, unknown> = {},
) => ({
  kind: "make-offering",
  party,
  to: god,
  resource: "currency",
  amount: 1,
  deadlineTicks: ticks,
  ...extra,
});

const offerFields = (
  petition: EventId,
  term: unknown = gift(),
  extra: Record<string, unknown> = {},
) => ({ action: "practice", move: "offer", prayer: petition, term, ...extra });

const digestOf = (prompt: string) => {
  const lines = prompt.split("\n");
  const start = lines.indexOf(PRACTICES_HEADING);
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => !l.startsWith("- ") && !l.startsWith("  "));
  return [PRACTICES_HEADING, ...rest.slice(0, end < 0 ? rest.length : end)];
};

// --- What a god may offer ---------------------------------------------------------------------

test("a god with a prayer to answer may offer terms on it: practice is offered, the schema carries the prayer, the stakes the world authored, and the mortal as a party", () => {
  const run = new Run();
  const petition = run.prays();
  const { actions, schema, remembered } = run.view("zeus");
  expect(actions).toContain("practice");
  expect(remembered.practice.offerable).toEqual([
    { id: petition, petitioner: id("farmer") },
  ]);
  expect(remembered.practice.stakes).toEqual([{ id: "wolf", form: "wolf" }]);
  const properties = (
    schema.jsonSchema as {
      properties: Record<
        string,
        { enum?: string[]; properties?: Record<string, { enum?: string[] }> }
      >;
    }
  ).properties;
  expect(properties.move?.enum).toContain("offer");
  expect(properties.prayer?.enum).toEqual([petition]);
  // The prayer is its own field: a bless's `petition` is not widened by it.
  expect(properties.petition).toBeUndefined();
  expect(properties.stake?.enum).toEqual(["wolf"]);
  expect(properties.term?.properties?.party?.enum).toContain("farmer");
  expect(JSON.stringify(schema.jsonSchema)).not.toContain("anyOf");
  // Control: a god with no prayer to answer is offered nothing of the sort.
  const hera = run.view("hera");
  expect(hera.remembered.practice.offerable).toEqual([]);
  expect(hera.actions).not.toContain("practice");
  expect(JSON.stringify(hera.schema.jsonSchema)).not.toContain("stake");
});

test("a prayer already holding terms, or answered, or whose petitioner is dead, is not offered again", () => {
  const run = new Run();
  const petition = run.prays();
  run.tick({
    actor: "zeus",
    kind: "practice",
    move: "offer",
    petition,
    term: gift(),
  });
  expect(run.state.threads.size).toBe(1);
  expect(run.view("zeus").remembered.practice.offerable).toEqual([]);
  // Zeus may still withdraw his own terms, but there is nothing new to offer.
  const standing = (
    run.view("zeus").schema.jsonSchema as {
      properties: { move: { enum: string[] } };
    }
  ).properties.move.enum;
  expect(standing).toEqual(["withdraw"]);

  const dead = new Run();
  dead.prays();
  const farmer = getActor(dead.state, id("farmer"));
  if (!farmer) throw new Error("farmer");
  dead.state = withActor(dead.state, { ...farmer, alive: false });
  expect(dead.view("zeus").remembered.practice.offerable).toEqual([]);
});

test("a prayer whose answer window has closed (not yet lapsed by the world) is not offered", () => {
  const run = new Run();
  run.prays();
  expect(run.view("zeus").remembered.practice.offerable).toHaveLength(1);
  const window = run.state.rules.petitionBalance?.answerWindowTicks ?? 250;
  run.state = { ...run.state, tick: run.state.tick + window + 1 };
  expect(run.view("zeus").remembered.practice.offerable).toEqual([]);
});

test("the instructions name the stakes a god may attach to an offer; the prayer itself, not a list, shows the terms it may set and the boon stays its own to give", () => {
  const run = new Run();
  const petition = run.prays();
  const { instructions, prompt } = run.view("zeus").context;
  expect(instructions).toContain('(move "offer")');
  expect(instructions).toContain("stake");
  expect(instructions).toContain("wolf");
  expect(instructions).toContain("The boon stays yours to give");
  // The prayer lists the farmer and its choices, with the terms written out; the instructions no longer list them.
  expect(instructions).not.toContain(`[${petition}] farmer`);
  expect(prompt).toContain(`[${petition}] farmer`);
  expect(prompt).toContain("set terms");
  expect(prompt).toContain('"action":"bless"');
  // Hera has no prayers: she is told nothing about offering terms.
  expect(run.view("hera").context.instructions).not.toContain('move "offer"');
  expect(run.view("hera").context.prompt).not.toContain("set terms");
});

// --- Parsing ----------------------------------------------------------------------------------

test("an offer parses against the shown prayer and one offering term by the one who prayed to this god; anything else is refused at parse", () => {
  const run = new Run();
  const petition = run.prays();
  const { schema } = run.view("zeus");
  const ok = (fields: Record<string, unknown>) => schema.parse(fields).ok;
  expect(ok(offerFields(petition))).toBe(true);
  expect(ok(offerFields(petition, gift(), { stake: "wolf" }))).toBe(true);
  for (const bad of [
    offerFields("evt-404" as EventId),
    offerFields(petition, gift("woodcutter")),
    offerFields(petition, gift("zeus")),
    offerFields(petition, gift("farmer", "zeus", 80, { resource: "gold" })),
    offerFields(petition, gift("farmer", "zeus", 80, { amount: 0 })),
    offerFields(petition, gift("farmer", "zeus", 80, { amount: 1.5 })),
    offerFields(petition, gift("farmer", "zeus", 1)),
    offerFields(petition, gift("farmer", "zeus", 100000)),
    offerFields(petition, {
      kind: "be-at",
      party: "farmer",
      place: "altar",
      deadlineTicks: 80,
    }),
    offerFields(petition, {
      kind: "ally",
      party: "farmer",
      to: "zeus",
      deadlineTicks: 80,
    }),
    offerFields(petition, gift(), { stake: "gorgon" }),
    offerFields(petition, gift(), { stake: 3 }),
    offerFields(petition, null),
    { action: "practice", move: "offer", term: gift() },
    { action: "practice", move: "offer", petition, term: gift() },
  ]) {
    expect([JSON.stringify(bad), ok(bad)]).toEqual([
      JSON.stringify(bad),
      false,
    ]);
  }
});

test("a stake is for offers to a supplicant only: a demand, an accept, a counter, a refusal, and a withdrawal that carry one are refused at parse", () => {
  const run = new Run();
  const petition = run.prays();
  // Give Zeus a settlement thread to answer, and a cause to demand over.
  const report = run.apply({
    kind: "report-told",
    entityId: "farmer",
    listenerId: "hera",
    content: "Zeus slighted you",
  });
  run.apply({
    kind: "memory-recorded",
    memoryKind: "told",
    entityId: "hera",
    sourceEventId: report.id,
    teller: "farmer",
    content: "Zeus slighted you",
    subjects: ["farmer", "hera"],
    salience: 4,
  });
  run.tick({
    actor: "hera",
    kind: "practice",
    move: "demand",
    counterparty: "zeus",
    cause: report.id,
    term: { kind: "be-at", party: "zeus", place: "altar", deadlineTicks: 100 },
  });
  const settlement = run.latest();
  expect(settlement.practice).toBe("settlement");
  const { schema } = run.view("zeus");
  const term = {
    kind: "be-at",
    party: "zeus",
    place: "altar",
    deadlineTicks: 100,
  };
  for (const fields of [
    {
      action: "practice",
      move: "demand",
      cause: report.id,
      term,
      stake: "wolf",
    },
    {
      action: "practice",
      move: "accept",
      thread: settlement.id,
      stake: "wolf",
    },
    {
      action: "practice",
      move: "counter",
      thread: settlement.id,
      term,
      stake: "wolf",
    },
    {
      action: "practice",
      move: "refuse",
      thread: settlement.id,
      stake: "wolf",
    },
    {
      action: "practice",
      move: "withdraw",
      thread: settlement.id,
      stake: "wolf",
    },
  ]) {
    expect([fields.move, schema.parse(fields).ok]).toEqual([
      fields.move,
      false,
    ]);
  }
  // Control: each of those parses without the stake, and the offer parses with one.
  expect(
    schema.parse({ action: "practice", move: "accept", thread: settlement.id })
      .ok,
  ).toBe(true);
  expect(
    schema.parse(offerFields(petition, gift(), { stake: "wolf" })).ok,
  ).toBe(true);
});

test("with no stakes authored, no stake can be named and the schema carries none", () => {
  const run = new Run();
  run.state = {
    ...run.state,
    rules: { ...run.state.rules, practiceStakes: undefined },
  };
  const petition = run.prays();
  const { schema, remembered } = run.view("zeus");
  expect(remembered.practice.stakes).toEqual([]);
  expect(JSON.stringify(schema.jsonSchema)).not.toContain('"stake"');
  expect(
    schema.parse(offerFields(petition, gift(), { stake: "wolf" })).ok,
  ).toBe(false);
  expect(schema.parse(offerFields(petition)).ok).toBe(true);
});

// --- The proposal -----------------------------------------------------------------------------

test("a valid offer builds a proposal that pins nothing (it opens a thread), cites the prayer as a fact the god was shown, and the world commits it with the stake as authored", () => {
  const run = new Run();
  const petition = run.prays();
  const { snapshot, remembered, schema } = run.view("zeus");
  const parsed = schema.parse(offerFields(petition, gift(), { stake: "wolf" }));
  if (!parsed.ok) throw new Error(parsed.message);
  const built = buildModelProposal(
    id("zeus"),
    snapshot,
    parsed.value,
    remembered,
  );
  if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
  expect(built.proposal).toMatchObject({
    kind: "practice",
    move: "offer",
    petition,
    stake: "wolf",
    source: "model",
    expectedRevisions: [],
    term: {
      kind: "make-offering",
      party: "farmer",
      to: "zeus",
      resource: "currency",
    },
  });
  expect(built.observation.factsRead).toContain(`petition:${petition}`);
  const ran = runTick(run.state, createPrng(1), [built.proposal]);
  expect(ran.rejected).toEqual([]);
  const [thread] = [...ran.state.threads.values()];
  expect(thread).toMatchObject({
    practice: "supplication",
    petition,
    stake: { form: "wolf", capabilitiesGained: ["beast"] },
  });
  // Control: an offer on a prayer the god was not shown is refused by the builder.
  const unshown = buildModelProposal(id("zeus"), snapshot, parsed.value, {
    ...remembered,
    practice: { ...remembered.practice, offerable: [] },
  });
  expect(unshown.ok).toBe(false);
});

test("an offer without a stake builds without one; the stake is the only field a supplication adds to the flat intent", () => {
  const run = new Run();
  const petition = run.prays();
  const { snapshot, remembered, schema } = run.view("zeus");
  const parsed = schema.parse(offerFields(petition));
  if (!parsed.ok) throw new Error(parsed.message);
  const built = buildModelProposal(
    id("zeus"),
    snapshot,
    parsed.value,
    remembered,
  );
  if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
  expect("stake" in built.proposal).toBe(false);
});

// --- The digest -------------------------------------------------------------------------------

test("an offered thread shows its god what it offered, to whom, and what is due; once accepted it shows which half is done", () => {
  const run = new Run();
  const petition = run.prays();
  run.tick({
    actor: "zeus",
    kind: "practice",
    move: "offer",
    petition,
    term: gift(),
  });
  const thread = run.latest();
  const row = digestOf(run.view("zeus").context.prompt).join("\n");
  expect(row).toContain(`[${thread.id}] OPEN, waiting on farmer`);
  expect(row).toContain("you offered terms on its prayer");
  expect(row).toContain(`[${petition}]`);
  expect(row).toContain("farmer must offer you 1 currency");
  expect(row).toContain('"withdraw"');
  expect(row).not.toContain("practice-opened");

  run.tick({
    actor: "farmer",
    kind: "practice",
    move: "accept",
    thread: thread.id,
    source: "routine",
  });
  const accepted = digestOf(run.view("zeus").context.prompt).join("\n");
  // The boon is now the god's obligation: it owes the farmer, and the offering is the farmer's to come.
  expect(accepted).toContain(`[${thread.id}] YOU OWE farmer`);
  expect(accepted).toContain(`your boon on its prayer [${petition}]`);
  expect(accepted).toContain("its offering is still to come");

  // The boon is given, then the offering: each half shows as done.
  run.state = {
    ...run.state,
    threads: new Map(run.state.threads).set(thread.id, {
      ...run.latest(),
      progress: { boon: "evt-9-9" as EventId },
    }),
  };
  const half = digestOf(run.view("zeus").context.prompt).join("\n");
  expect(half).toContain("Boon: given");
  expect(half).toContain("Offering: still owed");
});

test("the supplication's row says nothing the god was not shown: no cause it holds no account of, no word of the mortal's own holdings", () => {
  const run = new Run();
  const petition = run.prays();
  run.tick({
    actor: "zeus",
    kind: "practice",
    move: "offer",
    petition,
    term: gift(),
  });
  const { context } = run.view("zeus");
  const row = digestOf(context.prompt).join("\n");
  expect(row).not.toContain("you hold no account");
  expect(row).not.toContain("inventory");
  // Hera, a third god, sees no trace of Zeus's bargain with the farmer.
  const hera = run.view("hera").context;
  expect(`${hera.instructions}\n${hera.prompt}`).not.toContain(run.latest().id);
  expect(`${hera.instructions}\n${hera.prompt}`).not.toContain(petition);
});

test("a prayer a god may set terms on appears in its own prayers section and nowhere in another god's prompt", () => {
  const run = new Run();
  const petition = run.prays("farmer", "zeus");
  expect(run.view("zeus").context.prompt).toContain(`[${petition}]`);
  const others = ["hera"].map((god) => {
    const view = run.view(god);
    return `${view.context.instructions}\n${view.context.prompt}\n${JSON.stringify(view.schema.jsonSchema)}`;
  });
  for (const text of others) {
    expect(text).not.toContain(petition);
    expect(text).not.toContain("farmer asks");
  }
});

// --- Size -------------------------------------------------------------------------------------

test("prompt size on Zeus with one prayer to answer, with terms offered, and with an accepted obligation to deliver stays within the 4K budget", () => {
  const sizes: Record<string, number> = {};
  const measure = (label: string, run: Run) => {
    const { context, schema, snapshot, remembered } = run.view("zeus");
    const text = `${context.instructions}\n\n${context.prompt}`;
    const before = buildGodContext(godProfile("zeus"), snapshot, {
      ...remembered,
      practice: {
        ...remembered.practice,
        offerable: [],
        stakes: [],
      },
    });
    sizes[label] = text.length;
    sizes[`${label} digest`] = digestOf(context.prompt).join("\n").length;
    sizes[`${label} before`] =
      `${before.instructions}\n\n${before.prompt}`.length;
    sizes[`${label} schema`] = JSON.stringify(schema.jsonSchema).length;
    sizes[`${label} schema before`] = JSON.stringify(
      godIntentSchema(godProfile("zeus"), snapshot, {
        ...remembered,
        practice: {
          ...NO_PRACTICE,
          ...remembered.practice,
          offerable: [],
          stakes: [],
        },
      }).jsonSchema,
    ).length;
    return text;
  };
  const prayer = new Run();
  prayer.prays();
  const open = measure("one prayer", prayer);
  const offered = new Run();
  const petition = offered.prays();
  offered.tick({
    actor: "zeus",
    kind: "practice",
    move: "offer",
    petition,
    term: gift(),
  });
  measure("terms offered", offered);
  offered.tick({
    actor: "farmer",
    kind: "practice",
    move: "accept",
    thread: offered.latest().id,
    source: "routine",
  });
  const owed = measure("accepted", offered);
  expect(open.length).toBeLessThan(16_000);
  expect(owed.length).toBeLessThan(16_000);
  console.log(`PROMPT_SIZE_SUPPLICATION ${JSON.stringify(sizes)}`);
});
