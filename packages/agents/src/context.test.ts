import { expect, test } from "bun:test";
import type { GodProfile } from "@panthea/content";
import type { WorldEvent } from "@panthea/contracts";
import { MAX_REPORT_LENGTH } from "@panthea/contracts";
import {
  createPrng,
  type PerceptionSnapshot,
  perceive,
  runTick,
  submitProposal,
  toEntityId,
  type WorldState,
} from "@panthea/world";
import {
  buildGodContext,
  GOD_INTENT_ACTIONS,
  type GodIntent,
  godAvailableActions,
  godIntentSchema,
  MAX_ASSERTION_LENGTH,
  MAX_REMEMBERED,
  type ParsedGodIntent,
  rememberedBy,
} from "./context";
import {
  actorAt,
  actorHolding,
  actorWithCapabilities,
  allGodProfiles,
  committedEvent,
  godProfile,
  greekState,
  withoutFireSpread,
} from "./test-fixtures";

const zeus = godProfile("zeus");

function snapshotOf(
  actor: string,
  at: string,
  events: Parameters<typeof perceive>[2] = [],
  prepare = (state: ReturnType<typeof greekState>) => state,
): PerceptionSnapshot {
  const snapshot = perceive(
    prepare(actorAt(greekState(), actor, at)),
    toEntityId(actor),
    events,
  );
  if (!snapshot) throw new Error(`${actor} perceives nothing`);
  return snapshot;
}

function withoutAbility(profile: GodProfile, action: string): GodProfile {
  return {
    ...profile,
    abilities: profile.abilities.filter((ability) => ability.action !== action),
  };
}

const atTavern = () => snapshotOf("zeus", "tavern");
const atSquare = () => snapshotOf("zeus", "town-square");

const properties = (schema: { readonly jsonSchema: unknown }) =>
  (schema.jsonSchema as { properties: Record<string, { enum?: string[] }> })
    .properties;

// --- godIntentSchema ---------------------------------------------------------

test("a valid strike on a building in view parses", () => {
  const schema = godIntentSchema(zeus, atTavern());
  expect(
    schema.parse({
      action: "strike",
      target: "the-tavern",
      power: 3,
    }) as unknown,
  ).toEqual({
    ok: true,
    value: { action: "strike", target: "the-tavern", power: 3 },
  });
});

test("a valid legend parses, with and without a linked event from the snapshot", () => {
  const event = committedEvent({
    kind: "building-ignited",
    entityId: "the-tavern",
  });
  const schema = godIntentSchema(zeus, snapshotOf("zeus", "tavern", [event]));

  expect(
    schema.parse({
      action: "legend",
      assertion: "Fire took it.",
    }) as unknown,
  ).toEqual({
    ok: true,
    value: { action: "legend", assertion: "Fire took it." },
  });
  expect(
    schema.parse({
      action: "legend",
      assertion: "Fire took it.",
      linkedEventId: event.id,
    }) as unknown,
  ).toEqual({
    ok: true,
    value: {
      action: "legend",
      assertion: "Fire took it.",
      linkedEventId: event.id,
    },
  });
});

test("a strike on a building outside the snapshot fails; the same strike parses once Zeus stands there", () => {
  const intent = { action: "strike", target: "old-oak", power: 2 };

  const tavern = godIntentSchema(zeus, atTavern());
  const refused = tavern.parse(intent);
  expect(refused.ok).toBe(false);
  if (!refused.ok) expect(refused.path).toBe("target");
  expect(properties(tavern).target?.enum).not.toContain("old-oak");

  const square = godIntentSchema(zeus, atSquare());
  expect(square.parse(intent).ok).toBe(true);
  expect(properties(square).target?.enum).toContain("old-oak");
});

test("a legend citing an event outside the snapshot fails", () => {
  const remote = committedEvent({
    kind: "building-ignited",
    entityId: "old-oak",
  });
  const schema = godIntentSchema(zeus, snapshotOf("zeus", "tavern", [remote]));
  const result = schema.parse({
    action: "legend",
    assertion: "The oak burned.",
    linkedEventId: remote.id,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.path).toBe("linkedEventId");
});

test("an action outside the god's abilities fails, and the schema never offers it", () => {
  const noStrike = withoutAbility(zeus, "strike");
  const schema = godIntentSchema(noStrike, atTavern());
  const result = schema.parse({
    action: "strike",
    target: "the-tavern",
    power: 1,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.path).toBe("action");
  expect(properties(schema).action?.enum).not.toContain("strike");

  // An action no profile grants is refused whatever the profile says.
  expect(
    godIntentSchema(zeus, atTavern()).parse({
      action: "gather",
      resource: "wood",
    }).ok,
  ).toBe(false);
});

test("the schema offers exactly the god's ability actions that can be used here plus travel", () => {
  expect(properties(godIntentSchema(zeus, atTavern())).action?.enum).toEqual([
    "travel",
    "strike",
    "legend",
    "wait",
  ]);
  const atMountain = snapshotOf("zeus", "mountain-path");
  expect(properties(godIntentSchema(zeus, atMountain)).action?.enum).toEqual([
    "travel",
    "legend",
    "wait",
  ]);
  expect(godAvailableActions(zeus, atMountain)).toEqual([
    "travel",
    "legend",
    "wait",
  ]);
});

test("strike power above the ability's power fails; power up to it parses", () => {
  const schema = godIntentSchema(zeus, atTavern());
  const over = schema.parse({
    action: "strike",
    target: "the-tavern",
    power: 4,
  });
  expect(over.ok).toBe(false);
  if (!over.ok) expect(over.path).toBe("power");
  expect(
    schema.parse({ action: "strike", target: "the-tavern", power: 1 }).ok,
  ).toBe(true);
  const power = properties(schema).power as {
    maximum?: number;
    minimum?: number;
  };
  expect(power.maximum).toBe(3);
  expect(power.minimum).toBe(1);
});

test("strike power above the divinity Zeus holds fails; with none held, strike is not offered", () => {
  const poor = snapshotOf("zeus", "tavern", [], (state) =>
    actorHolding(state, "zeus", "divinity", 2),
  );
  const schema = godIntentSchema(zeus, poor);
  expect(
    schema.parse({ action: "strike", target: "the-tavern", power: 3 }).ok,
  ).toBe(false);
  expect(
    schema.parse({ action: "strike", target: "the-tavern", power: 2 }).ok,
  ).toBe(true);

  const spent = snapshotOf("zeus", "tavern", [], (state) =>
    actorHolding(state, "zeus", "divinity", 0),
  );
  expect(properties(godIntentSchema(zeus, spent)).action?.enum).not.toContain(
    "strike",
  );
  expect(
    godIntentSchema(zeus, spent).parse({
      action: "strike",
      target: "the-tavern",
      power: 1,
    }).ok,
  ).toBe(false);
});

test("a non-integer, zero, or missing strike power fails", () => {
  const schema = godIntentSchema(zeus, atTavern());
  for (const power of [0, 1.5, "3", undefined]) {
    expect(
      schema.parse({ action: "strike", target: "the-tavern", power }).ok,
    ).toBe(false);
  }
});

test("travel names any place a route reaches from where the god stands, across realms; not where it stands, and not a place off the map", () => {
  const square = godIntentSchema(zeus, atSquare());
  expect(square.parse({ action: "travel", to: "tavern" }).ok).toBe(true);
  // No longer limited to the exits: the great hall is a journey away.
  expect(
    square.parse({ action: "travel", to: "great-hall" }) as unknown,
  ).toEqual({ ok: true, value: { action: "travel", to: "great-hall" } });
  for (const to of ["town-square", "atlantis"]) {
    const refused = square.parse({ action: "travel", to });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.path).toBe("to");
  }
  const mountain = godIntentSchema(zeus, snapshotOf("zeus", "mountain-path"));
  expect(
    mountain.parse({ action: "travel", to: "olympus-gate" }) as unknown,
  ).toEqual({
    ok: true,
    value: { action: "travel", to: "olympus-gate" },
  });
  // A god no longer names a step or a crossing.
  for (const action of ["move", "realm-transition"]) {
    expect(mountain.parse({ action, to: "olympus-gate" }).ok).toBe(false);
  }
});

test("non-object, unknown, and empty-assertion candidates fail", () => {
  const schema = godIntentSchema(zeus, atTavern());
  for (const candidate of [
    null,
    "strike",
    [],
    {},
    { action: "smite" },
    { action: "legend", assertion: "   " },
    { action: "legend" },
  ]) {
    expect(schema.parse(candidate).ok).toBe(false);
  }
});

test("every ability the authored gods have maps to an action a god intent supports", () => {
  for (const god of allGodProfiles) {
    for (const ability of god.abilities) {
      expect(GOD_INTENT_ACTIONS as readonly string[]).toContain(ability.action);
    }
  }
});

// --- buildGodContext -----------------------------------------------------------

test("the context carries the god's profile and only what Zeus perceives at the tavern", () => {
  const events = [
    committedEvent({ kind: "building-ignited", entityId: "the-tavern" }),
    committedEvent({ kind: "building-ignited", entityId: "old-oak" }),
    committedEvent({
      kind: "resource-gathered",
      entityId: "woodcutter",
      resource: "wood",
      amount: 2,
    }),
  ];
  const context = buildGodContext(zeus, snapshotOf("zeus", "tavern", events));
  const text = `${context.instructions}\n${context.prompt}`;

  expect(text).toContain("Zeus");
  expect(text).toContain("sovereignty");
  expect(text).toContain("Thunderbolt");
  expect(text).toContain(zeus.lore[0]?.statement ?? "missing");
  expect(text).toContain("hera");
  expect(text).toContain("The Tavern");
  expect(text).toContain("the-tavern");
  expect(text).toContain("divinity");

  // Elsewhere: unseen. Neither the actor, the building, nor the events.
  for (const remote of ["woodcutter", "farmer", "old-oak", "The Old Oak"]) {
    expect(text).not.toContain(remote);
  }
  expect(text).toContain("building-ignited");
});

test("positive control: with Zeus in the square the oak, the woodcutter, and their events appear", () => {
  const events = [
    committedEvent({ kind: "building-ignited", entityId: "old-oak" }),
    committedEvent({
      kind: "resource-gathered",
      entityId: "woodcutter",
      resource: "wood",
      amount: 2,
    }),
  ];
  const context = buildGodContext(
    zeus,
    snapshotOf("zeus", "town-square", events),
  );
  const text = `${context.instructions}\n${context.prompt}`;

  for (const present of ["woodcutter", "farmer", "old-oak", "The Old Oak"]) {
    expect(text).toContain(present);
  }
  expect(text).toContain("resource-gathered");
  expect(text).not.toContain("the-tavern");
});

test("the context states the strike limits the schema enforces", () => {
  const poor = snapshotOf("zeus", "tavern", [], (state) =>
    actorHolding(state, "zeus", "divinity", 2),
  );
  const text = buildGodContext(zeus, poor).instructions;
  expect(text).toMatch(/power (?:of )?(?:at most|up to) 2/);
});

test("each god's context speaks in that god's own voice and drives", () => {
  const hera = godProfile("hera");
  const context = buildGodContext(hera, snapshotOf("hera", "great-hall"));
  const text = `${context.instructions}\n${context.prompt}`;
  expect(text).toContain("Hera");
  expect(text).toContain("fidelity");
  expect(text).toContain("Wrath of Hera");
  expect(text).not.toContain("Thunderbolt");
  // Zeus stands in the hall with her.
  expect(text).toContain("zeus");
});

// --- wait ---------------------------------------------------------------------

test("wait parses and is always offered, even with nothing else to do", () => {
  const schema = godIntentSchema(zeus, atTavern());
  expect(schema.parse({ action: "wait" }) as unknown).toEqual({
    ok: true,
    value: { action: "wait" },
  });

  // No divinity, no legend ability, no exits: only waiting is left.
  const spent = snapshotOf("zeus", "tavern", [], (state) =>
    actorHolding(state, "zeus", "divinity", 0),
  );
  const bare: GodProfile = { ...zeus, abilities: [] };
  const stuck = godIntentSchema(bare, spent);
  expect(properties(stuck).action?.enum).toContain("wait");
  expect(godAvailableActions(bare, spent)).toContain("wait");
  expect(stuck.parse({ action: "wait" }).ok).toBe(true);
});

test("the prompt tells the god that waiting is allowed", () => {
  const context = buildGodContext(zeus, atTavern());
  expect(context.instructions).toMatch(/wait/i);
  expect(context.instructions).toContain('action "wait"');
});

// --- Branded intents -----------------------------------------------------------

test("only the schema's parse produces a ParsedGodIntent; a hand-built one does not compile", () => {
  const parsed = godIntentSchema(zeus, atTavern()).parse({ action: "wait" });
  if (!parsed.ok) throw new Error(parsed.message);
  const fromParse: ParsedGodIntent = parsed.value;
  expect(fromParse.action).toBe("wait");

  const handBuilt: GodIntent = { action: "wait" };
  // @ts-expect-error a plain GodIntent has not been through godIntentSchema's parse
  const notParsed: ParsedGodIntent = handBuilt;
  expect(notParsed as unknown).toBe(handBuilt);
});

// --- Perceived events in the schema and the prompt ------------------------------------

test("the linkedEventId enum lists only perceived event ids, and is absent when none are perceived", () => {
  const local = committedEvent({
    kind: "building-ignited",
    entityId: "the-tavern",
  });
  const remote = committedEvent({
    kind: "building-ignited",
    entityId: "old-oak",
  });

  const some = godIntentSchema(
    zeus,
    snapshotOf("zeus", "tavern", [remote, local]),
  );
  const linked = (
    some.jsonSchema as { properties: Record<string, { enum?: string[] }> }
  ).properties.linkedEventId;
  expect(linked?.enum).toEqual([local.id]);
  expect(linked?.enum).not.toContain(remote.id);

  const none = godIntentSchema(zeus, snapshotOf("zeus", "tavern", [remote]));
  expect(properties(none).linkedEventId).toBeUndefined();
});

test("an income event at a visible building does not put a remote owner in the prompt; positive control: co-located, it does", () => {
  // The farmer owns the tavern and works in the square.
  const income = committedEvent({
    kind: "income-earned",
    entityId: "farmer",
    buildingId: "the-tavern",
    amount: 1,
  });
  const apart = buildGodContext(zeus, snapshotOf("zeus", "tavern", [income]));
  const apartText = `${apart.instructions}\n${apart.prompt}`;
  expect(apartText).toContain("income-earned");
  expect(apartText).toContain("the-tavern");
  expect(apartText).not.toContain("farmer");

  const together = buildGodContext(
    zeus,
    snapshotOf("zeus", "tavern", [income], (state) =>
      actorAt(state, "farmer", "tavern"),
    ),
  );
  const line = (text: string) =>
    text.split("\n").find((row) => row.includes("income-earned")) ?? "";
  // The event line itself names the owner, not merely the actor list.
  expect(line(together.prompt)).toContain("farmer");
  expect(line(apart.prompt)).not.toContain("farmer");
});

// --- Capability-gated exits ------------------------------------------------------------

/** Zeus with the divine capability removed: the authored pack grants it to every deity. */
const undivine = (state: ReturnType<typeof greekState>) =>
  actorWithCapabilities(state, "zeus", []);

test("the authored deities hold `divine`; the authored mortals do not", () => {
  const state = greekState();
  const capabilities = (actor: string) =>
    state.actors.get(toEntityId(actor))?.capabilities;
  expect(capabilities("zeus")).toEqual(["divine"]);
  expect(capabilities("hera")).toEqual(["divine"]);
  expect(capabilities("woodcutter")).toEqual([]);
  expect(capabilities("farmer")).toEqual([]);
});

test("with the authored pack alone, Zeus may travel to olympus-gate and judgment-hall", () => {
  const mountain = godIntentSchema(zeus, snapshotOf("zeus", "mountain-path"));
  expect(properties(mountain).action?.enum).toContain("travel");
  expect(mountain.parse({ action: "travel", to: "olympus-gate" }).ok).toBe(
    true,
  );

  const hall = godIntentSchema(zeus, snapshotOf("zeus", "great-hall"));
  expect(hall.parse({ action: "travel", to: "olympus-gate" }).ok).toBe(true);
  expect(hall.parse({ action: "travel", to: "judgment-hall" }).ok).toBe(true);

  const meadow = godIntentSchema(zeus, snapshotOf("zeus", "asphodel-meadow"));
  expect(meadow.parse({ action: "travel", to: "judgment-hall" }).ok).toBe(true);
});

test("a deity without the required capability is not offered the restricted places; positive control: the authored Zeus is", () => {
  const plain = snapshotOf("zeus", "mountain-path", [], undivine);
  const withoutDivine = godIntentSchema(zeus, plain);
  expect(properties(withoutDivine).to?.enum ?? []).not.toContain(
    "olympus-gate",
  );
  expect(properties(withoutDivine).to?.enum ?? []).not.toContain("great-hall");
  expect(withoutDivine.parse({ action: "travel", to: "olympus-gate" }).ok).toBe(
    false,
  );
  expect(withoutDivine.parse({ action: "travel", to: "great-hall" }).ok).toBe(
    false,
  );

  const divine = snapshotOf("zeus", "mountain-path");
  const withDivine = godIntentSchema(zeus, divine);
  expect(godAvailableActions(zeus, divine)).toContain("travel");
  expect(properties(withDivine).to?.enum).toContain("olympus-gate");
  expect(properties(withDivine).to?.enum).toContain("great-hall");
});

test("the prompt does not list places the god cannot reach", () => {
  const plain = buildGodContext(
    zeus,
    snapshotOf("zeus", "mountain-path", [], undivine),
  );
  expect(plain.prompt).not.toContain("olympus-gate");
  const divine = buildGodContext(zeus, snapshotOf("zeus", "mountain-path"));
  expect(divine.prompt).toContain("olympus-gate");
});

// --- report: telling someone here what one says happened ---------------------------

/** Zeus and the farmer (who owns the tavern) at the tavern; Hera in the square. Real ticks. */
function tavernWorld() {
  const state = actorAt(
    actorAt(actorAt(greekState(), "zeus", "tavern"), "farmer", "tavern"),
    "hera",
    "town-square",
  );
  return withoutFireSpread(state);
}

function tick(state: WorldState, ...raws: Record<string, unknown>[]) {
  const proposals = raws.map((raw, index) => {
    const submitted = submitProposal({
      schemaVersion: 1,
      targets: [],
      expectedRevisions: [],
      source: "fixture",
      observationId: `obs-${state.tick}-${index}`,
      ...raw,
    });
    if (!submitted.ok) throw new Error(submitted.rejection.message);
    return submitted.proposal;
  });
  const result = runTick(state, createPrng(1), proposals);
  expect(result.rejected).toEqual([]);
  return result;
}

const strikeTavern = {
  actor: "zeus",
  kind: "strike",
  target: "the-tavern",
  power: 3,
};

function snapshotIn(state: WorldState, actor: string, events: WorldEvent[]) {
  const snapshot = perceive(state, toEntityId(actor), events);
  if (!snapshot) throw new Error(`${actor} perceives nothing`);
  return snapshot;
}

test("report is offered only where someone is present to hear it; alone at the tavern it is not", () => {
  const withCompany = snapshotIn(tavernWorld(), "zeus", []);
  expect(properties(godIntentSchema(zeus, withCompany)).action?.enum).toContain(
    "report",
  );
  expect(godAvailableActions(zeus, withCompany)).toContain("report");
  expect(GOD_INTENT_ACTIONS).toContain("report");

  const alone = atTavern();
  expect(properties(godIntentSchema(zeus, alone)).action?.enum).not.toContain(
    "report",
  );
  expect(
    godIntentSchema(zeus, alone).parse({
      action: "report",
      listener: "farmer",
      content: "hello",
    }).ok,
  ).toBe(false);
});

test("a report parses with its listener, its words, an optional claim, and an optional witnessed citation", () => {
  const struck = tick(tavernWorld(), strikeTavern);
  const remembered = rememberedBy(struck.state, toEntityId("zeus"));
  const snapshot = snapshotIn(struck.state, "zeus", [...struck.events]);
  const schema = godIntentSchema(zeus, snapshot, remembered);
  const ignition = struck.events.find((e) => e.kind === "building-ignited");
  if (!ignition) throw new Error("no ignition");

  expect(
    schema.parse({
      action: "report",
      listener: "farmer",
      content: "Fine day.",
    }) as unknown,
  ).toEqual({
    ok: true,
    value: { action: "report", listener: "farmer", content: "Fine day." },
  });
  const full = {
    action: "report",
    listener: "farmer",
    content: "Lightning found the tavern.",
    claim: { effect: "harm", agent: "zeus", target: "the-tavern" },
    linkedEventId: ignition.id,
  };
  expect(schema.parse(full) as unknown).toEqual({ ok: true, value: full });
});

test("a report naming a listener, a claim agent, or a claim target outside the snapshot is refused; the same names inside it parse", () => {
  const snapshot = snapshotIn(tavernWorld(), "zeus", []);
  const schema = godIntentSchema(zeus, snapshot);
  const base = { action: "report", listener: "farmer", content: "x" };

  // Hera is in the square, the oak beyond the tavern's walls.
  const outside: [Record<string, unknown>, string][] = [
    [{ ...base, listener: "hera" }, "listener"],
    [{ ...base, claim: { effect: "harm", agent: "hera" } }, "claim.agent"],
    [
      { ...base, claim: { effect: "harm", agent: "zeus", target: "old-oak" } },
      "claim.target",
    ],
  ];
  for (const [candidate, path] of outside) {
    const refused = schema.parse(candidate);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.path).toBe(path);
  }
  // Control: the farmer, Zeus himself, and the tavern are all here.
  expect(
    schema.parse({
      ...base,
      claim: { effect: "harm", agent: "zeus", target: "the-tavern" },
    }).ok,
  ).toBe(true);
  expect(
    schema.parse({
      ...base,
      claim: { effect: "kindness", agent: "farmer", target: "zeus" },
    }).ok,
  ).toBe(true);
});

test("report text is bounded, and a malformed claim or an empty report is refused", () => {
  const schema = godIntentSchema(zeus, snapshotIn(tavernWorld(), "zeus", []));
  const ok = (candidate: Record<string, unknown>) => schema.parse(candidate).ok;
  const base = { action: "report", listener: "farmer" };
  expect(ok({ ...base, content: "x".repeat(MAX_REPORT_LENGTH) })).toBe(true);
  expect(ok({ ...base, content: "x".repeat(MAX_REPORT_LENGTH + 1) })).toBe(
    false,
  );
  expect(ok({ ...base, content: "   " })).toBe(false);
  expect(ok({ ...base })).toBe(false);
  expect(
    ok({ ...base, content: "x", claim: { effect: "worship", agent: "zeus" } }),
  ).toBe(false);
  expect(ok({ ...base, content: "x", claim: "zeus harmed the farmer" })).toBe(
    false,
  );
});

test("a report may cite only an event the god witnessed: one it remembers seeing parses, one it did not is refused", () => {
  const struck = tick(tavernWorld(), strikeTavern);
  const ignition = struck.events.find((e) => e.kind === "building-ignited");
  if (!ignition) throw new Error("no ignition");

  // Zeus witnessed it, and remembers.
  const zeusSchema = godIntentSchema(
    zeus,
    snapshotIn(struck.state, "zeus", []),
    rememberedBy(struck.state, toEntityId("zeus")),
  );
  const cite = {
    action: "report",
    listener: "farmer",
    content: "x",
    linkedEventId: ignition.id,
  };
  expect(zeusSchema.parse(cite).ok).toBe(true);

  // Hera was in the square: same schema shape, no such memory.
  const heraState = actorAt(struck.state, "hera", "tavern");
  const hera = godProfile("hera");
  const heraSchema = godIntentSchema(
    hera,
    snapshotIn(heraState, "hera", []),
    rememberedBy(heraState, toEntityId("hera")),
  );
  const refused = heraSchema.parse({ ...cite, listener: "zeus" });
  expect(refused.ok).toBe(false);
  if (!refused.ok) expect(refused.path).toBe("linkedEventId");
});

// --- What each action may cite ----------------------------------------------------------

/** The instruction line about what `action` may cite, or `undefined` when there is none. */
const citationLine = (instructions: string, action: "report" | "legend") =>
  instructions.split("\n").find((l) => l.startsWith(`For a ${action}, `));

test.each([
  {
    name: "only a witnessed event (a report may cite it, a legend may not)",
    citable: "report",
    other: "legend",
  },
  {
    name: "only a perceived event (a legend may cite it, a report may not)",
    citable: "legend",
    other: "report",
  },
] as const)(
  "citation schema and guidance match the parser when only one action has citable events: $name",
  ({ citable, other }) => {
    const struck = tick(tavernWorld(), strikeTavern);
    const ignition = struck.events.find((e) => e.kind === "building-ignited");
    if (!ignition) throw new Error("no ignition");
    // Witnessed only: Zeus remembers the strike, and the scene shows no events.
    // Perceived only: the scene shows the strike, and Zeus remembers nothing.
    const world = citable === "report" ? struck.state : tavernWorld();
    const snapshot = snapshotIn(
      world,
      "zeus",
      citable === "report" ? [] : [...struck.events],
    );
    const remembered = rememberedBy(world, toEntityId("zeus"));
    const schema = godIntentSchema(zeus, snapshot, remembered);
    const instructions =
      buildGodContext(zeus, snapshot, remembered).instructions ?? "";
    const intent = {
      report: { action: "report", listener: "farmer", content: "x" },
      legend: { action: "legend", assertion: "x" },
    } as const;
    const cite = (action: "report" | "legend") => ({
      ...intent[action],
      linkedEventId: ignition.id,
    });

    // The parser: the right action's citation and any uncited action pass; the other action's citation is refused, never dropped.
    expect(schema.parse(cite(citable)).ok).toBe(true);
    expect(schema.parse(intent.report).ok).toBe(true);
    expect(schema.parse(intent.legend).ok).toBe(true);
    const refused = schema.parse(cite(other));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.path).toBe("linkedEventId");

    // The guidance lists the id for the action that may cite it, and says to omit it for the other.
    const allowed = citationLine(instructions, citable);
    const barred = citationLine(instructions, other);
    expect(allowed).toContain(ignition.id);
    expect(barred).toBeDefined();
    expect(barred).not.toContain(ignition.id);
    expect(barred).toContain("omit");

    // The schema stays flat: one linkedEventId enum, no per-action branches, and it says what to do with it.
    const json = schema.jsonSchema as {
      anyOf?: unknown;
      oneOf?: unknown;
      properties: Record<string, { enum?: string[]; description?: string }>;
    };
    expect(json.anyOf).toBeUndefined();
    expect(json.oneOf).toBeUndefined();
    expect(json.properties.linkedEventId?.enum).toContain(ignition.id);
    expect(json.properties.linkedEventId?.description).toContain("omit");
  },
);

test("with nothing to cite for either action the guidance says to omit linkedEventId and the schema has no such field", () => {
  const snapshot = snapshotIn(tavernWorld(), "zeus", []);
  const remembered = rememberedBy(tavernWorld(), toEntityId("zeus"));
  const instructions =
    buildGodContext(zeus, snapshot, remembered).instructions ?? "";
  expect(citationLine(instructions, "report")).toContain("omit");
  expect(citationLine(instructions, "legend")).toContain("omit");
  expect(
    properties(godIntentSchema(zeus, snapshot, remembered)).linkedEventId,
  ).toBeUndefined();
});

// --- What a god remembers, in its context ----------------------------------------------

test("the god's context carries what it remembers and how it feels, from its own memory alone", () => {
  const struck = tick(tavernWorld(), strikeTavern);
  const zeusView = rememberedBy(struck.state, toEntityId("zeus"));
  const farmerView = rememberedBy(struck.state, toEntityId("farmer"));
  const ignition = struck.events.find((e) => e.kind === "building-ignited");

  const zeusText = (() => {
    const c = buildGodContext(
      zeus,
      snapshotIn(struck.state, "zeus", []),
      zeusView,
    );
    return `${c.instructions}\n${c.prompt}`;
  })();
  expect(zeusText).toContain("You remember");
  expect(zeusText).toContain(String(ignition?.id));
  expect(zeusText).toContain("building-ignited");

  // The farmer feels wronged: Zeus's own context has no such feeling toward himself.
  expect(farmerView.relationships.map((r) => r.toward)).toContain(
    toEntityId("zeus"),
  );
  expect(zeusView.relationships).toEqual([]);

  // Positive control: Hera never saw it, so her context has no memory section at all.
  const hera = godProfile("hera");
  const heraView = rememberedBy(struck.state, toEntityId("hera"));
  const heraContext = buildGodContext(
    hera,
    snapshotIn(struck.state, "hera", []),
    heraView,
  );
  expect(`${heraContext.instructions}\n${heraContext.prompt}`).not.toContain(
    "You remember",
  );
  expect(`${heraContext.instructions}\n${heraContext.prompt}`).not.toContain(
    String(ignition?.id),
  );
});

test("a listener's context shows a belief as told, attributed to its teller, with the feeling it left", () => {
  // Zeus and Hera share the square; Zeus tells her the farmer wronged him.
  const state = actorAt(
    actorAt(greekState(), "zeus", "town-square"),
    "hera",
    "town-square",
  );
  const heard = tick(state, {
    actor: "zeus",
    kind: "report",
    listener: "hera",
    content: "The farmer cheated me.",
    claim: { effect: "harm", agent: "farmer", target: "zeus" },
  });
  const view = rememberedBy(heard.state, toEntityId("hera"));
  const hera = godProfile("hera");
  const context = buildGodContext(
    hera,
    snapshotIn(heard.state, "hera", []),
    view,
  );
  const text = `${context.instructions}\n${context.prompt}`;
  expect(text).toContain('zeus told you: "The farmer cheated me."');
  expect(text).toContain("farmer");
  expect(view.relationships).toMatchObject([
    { toward: "farmer", affinity: -1 },
  ]);
  expect(text).toMatch(/farmer[^\n]*affinity -1/);
});

test("what a god is shown of its memory is bounded, however much it remembers; with only a few memories, all are shown", () => {
  // Zeus strikes the oak in the square thirty times, watching each: thirty memories, in a world with room for them.
  const roomy = (state: WorldState): WorldState => ({
    ...state,
    rules: { ...state.rules, memoryBalance: { capacity: 40 } },
  });
  let state = roomy(
    actorHolding(
      actorAt(greekState(), "zeus", "town-square"),
      "zeus",
      "divinity",
      100,
    ),
  );
  for (let index = 0; index < 30; index += 1) {
    state = tick(state, {
      actor: "zeus",
      kind: "strike",
      target: "old-oak",
      power: 1,
    }).state;
  }
  expect(state.memories.get(toEntityId("zeus"))?.length).toBe(30);

  const view = rememberedBy(state, toEntityId("zeus"));
  expect(view.memories.length).toBe(MAX_REMEMBERED);
  const context = buildGodContext(zeus, snapshotIn(state, "zeus", []), view);
  const shown = context.prompt
    .split("\n")
    .filter((line) => line.startsWith("- You saw"));
  expect(shown).toHaveLength(MAX_REMEMBERED);

  // Control: after a single strike Zeus remembers little, and all of it is shown.
  const few = rememberedBy(
    tick(tavernWorld(), strikeTavern).state,
    toEntityId("zeus"),
  );
  expect(few.memories.length).toBeGreaterThan(0);
  expect(few.memories.length).toBeLessThan(MAX_REMEMBERED);
});

// --- The text limits, stated where the model reads them --------------------------------

test("the instructions state the legend and report text limits, from the constants the parser enforces", () => {
  const withCompany = buildGodContext(
    zeus,
    snapshotIn(tavernWorld(), "zeus", []),
  );
  expect(withCompany.instructions).toContain(
    `assertion (at most ${MAX_ASSERTION_LENGTH} characters)`,
  );
  expect(withCompany.instructions).toContain(
    `report content (at most ${MAX_REPORT_LENGTH} characters)`,
  );
  expect(withCompany.instructions).toContain("one or two short sentences");
  // The limit is one line, not a paragraph.
  const line = (withCompany.instructions ?? "")
    .split("\n")
    .filter((l) => l.startsWith("Keep a legend assertion"));
  expect(line).toHaveLength(1);
  expect(line[0]?.length).toBeLessThan(200);
});

// --- Practice -----------------------------------------------------------------

test("practice is a god intent action, offered only when there is a thread to answer or a cause to demand over: Zeus alone in the hall remembers nothing and is not offered it", () => {
  expect(GOD_INTENT_ACTIONS).toContain("practice");
  const bare = snapshotOf("zeus", "great-hall");
  expect(godAvailableActions(zeus, bare)).not.toContain("practice");
  expect(properties(godIntentSchema(zeus, bare))).not.toHaveProperty("move");
  expect(
    godIntentSchema(zeus, bare).parse({
      action: "practice",
      move: "demand",
      cause: "evt-1",
      term: { kind: "be-at", party: "hera", place: "altar", deadlineTicks: 50 },
    }).ok,
  ).toBe(false);
  // Control: remembering the strike gives Zeus a cause to demand over, and waiting stays last.
  const struck = tick(tavernWorld(), strikeTavern);
  const remembered = rememberedBy(struck.state, toEntityId("zeus"));
  const snapshot = snapshotIn(struck.state, "zeus", [...struck.events]);
  const offered = godAvailableActions(zeus, snapshot, remembered);
  expect(offered).toContain("practice");
  expect(offered.at(-1)).toBe("wait");
});
