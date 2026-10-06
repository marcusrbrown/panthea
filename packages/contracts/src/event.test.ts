import { expect, test } from "bun:test";
import {
  causalChain,
  eventCause,
  eventSubjects,
  LATEST_EVENT_SCHEMA_VERSION,
  MAX_GOAL_LENGTH,
  MAX_REPORT_LENGTH,
  parseEvent,
  UNPLACED_EVENT_KINDS,
  WITNESSED_EVENT_KINDS,
  WORLD_EVENT_KINDS,
  type WorldEvent,
} from "./event";

function envelope(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: LATEST_EVENT_SCHEMA_VERSION,
    id: "evt-1",
    sequence: 0,
    simTime: 0,
    tick: 3,
    correlationId: "corr-1",
    causationId: "cause-1",
    approximate: false,
    ...overrides,
  };
}

test("a valid entity-moved event parses", () => {
  const result = parseEvent(
    envelope({ kind: "entity-moved", entityId: "npc-1", to: "loc-2" }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      schemaVersion: LATEST_EVENT_SCHEMA_VERSION,
      id: "evt-1",
      sequence: 0,
      simTime: 0,
      correlationId: "corr-1",
      causationId: "cause-1",
      approximate: false,
      kind: "entity-moved",
      entityId: "npc-1",
      to: "loc-2",
    });
  }
});

test("a valid realm-transitioned event parses", () => {
  const result = parseEvent(
    envelope({
      kind: "realm-transitioned",
      entityId: "npc-1",
      to: "underworld-gate",
      via: "styx",
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "realm-transitioned",
      entityId: "npc-1",
      to: "underworld-gate",
      via: "styx",
    });
  }
});

test("a valid resource-gathered event parses", () => {
  const result = parseEvent(
    envelope({
      kind: "resource-gathered",
      entityId: "npc-1",
      resource: "wood",
      amount: 2,
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "resource-gathered",
      entityId: "npc-1",
      resource: "wood",
      amount: 2,
    });
  }
});

test("a valid resource-produced event parses", () => {
  const result = parseEvent(
    envelope({
      kind: "resource-produced",
      entityId: "npc-1",
      output: "planks",
      quantity: 3,
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "resource-produced",
      entityId: "npc-1",
      output: "planks",
      quantity: 3,
    });
  }
});

test("a valid resource-traded event parses with give and receive lines", () => {
  const result = parseEvent(
    envelope({
      kind: "resource-traded",
      entityId: "woodcutter",
      counterpartyId: "farmer",
      give: [{ resource: "wood", amount: 2 }],
      receive: [{ resource: "currency", amount: 2 }],
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "resource-traded",
      entityId: "woodcutter",
      counterpartyId: "farmer",
      give: [{ resource: "wood", amount: 2 }],
      receive: [{ resource: "currency", amount: 2 }],
    });
  }
});

test("a valid resource-consumed event parses", () => {
  const result = parseEvent(
    envelope({
      kind: "resource-consumed",
      entityId: "npc-1",
      resource: "food",
      amount: 1,
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "resource-consumed",
      entityId: "npc-1",
      resource: "food",
      amount: 1,
    });
  }
});

test("a valid building-damaged event parses", () => {
  const result = parseEvent(
    envelope({
      kind: "building-damaged",
      entityId: "old-oak",
      amount: 1,
      actor: "zeus",
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "building-damaged",
      entityId: "old-oak",
      amount: 1,
      actor: "zeus",
    });
  }
});

test("a valid building-ignited event parses, carrying the strike that started the fire", () => {
  const result = parseEvent(
    envelope({
      kind: "building-ignited",
      entityId: "the-tavern",
      cause: { kind: "strike", actor: "zeus" },
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "building-ignited",
      entityId: "the-tavern",
      cause: { kind: "strike", actor: "zeus" },
    });
  }
});

test("a spread ignition names the source building's ignition event and the actor who started the fire", () => {
  const result = parseEvent(
    envelope({
      kind: "building-ignited",
      entityId: "old-oak",
      cause: { kind: "spread", from: "evt-4", actor: "zeus" },
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      cause: { kind: "spread", from: "evt-4", actor: "zeus" },
    });
  }
});

test("an ignition without a cause, or with a malformed one, is rejected", () => {
  const missing = parseEvent(
    envelope({ kind: "building-ignited", entityId: "the-tavern" }),
  );
  expect(missing.ok).toBe(false);
  for (const cause of [
    { kind: "lightning", actor: "zeus" },
    { kind: "strike" },
    { kind: "spread", actor: "zeus" },
    "evt-4",
  ]) {
    const result = parseEvent(
      envelope({ kind: "building-ignited", entityId: "the-tavern", cause }),
    );
    expect(result.ok).toBe(false);
  }
});

test("a valid building-burn-ticked event parses", () => {
  const result = parseEvent(
    envelope({
      kind: "building-burn-ticked",
      entityId: "the-tavern",
      fireIntensity: 2,
      ticksBurning: 1,
      cause: "evt-3",
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "building-burn-ticked",
      entityId: "the-tavern",
      fireIntensity: 2,
      ticksBurning: 1,
      cause: "evt-3",
    });
  }
});

test("a valid building-destroyed event parses with its disposed inventory", () => {
  const result = parseEvent(
    envelope({
      kind: "building-destroyed",
      entityId: "the-tavern",
      disposedInventory: [{ resource: "wine", amount: 3 }],
      cause: "evt-3",
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "building-destroyed",
      entityId: "the-tavern",
      disposedInventory: [{ resource: "wine", amount: 3 }],
      cause: "evt-3",
    });
  }
});

test("burn and destruction events without the ignition they follow from are rejected", () => {
  expect(
    parseEvent(
      envelope({
        kind: "building-burn-ticked",
        entityId: "the-tavern",
        fireIntensity: 1,
        ticksBurning: 1,
      }),
    ).ok,
  ).toBe(false);
  expect(
    parseEvent(
      envelope({
        kind: "building-destroyed",
        entityId: "the-tavern",
        disposedInventory: [],
      }),
    ).ok,
  ).toBe(false);
});

test("a valid repair-progressed event parses", () => {
  const result = parseEvent(
    envelope({
      kind: "repair-progressed",
      entityId: "farmer",
      structureId: "the-tavern",
      resource: "planks",
      amount: 1,
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "repair-progressed",
      entityId: "farmer",
      structureId: "the-tavern",
      resource: "planks",
      amount: 1,
    });
  }
});

test("a valid building-repaired event parses", () => {
  const result = parseEvent(
    envelope({ kind: "building-repaired", entityId: "the-tavern" }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "building-repaired",
      entityId: "the-tavern",
    });
  }
});

test("a valid worship-performed event parses with an offering and a favor", () => {
  const result = parseEvent(
    envelope({
      kind: "worship-performed",
      entityId: "farmer",
      deity: "zeus",
      offering: { resource: "wine", amount: 1 },
      favorEffect: "trade-favor",
      favorExpiresAtTick: 20,
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "worship-performed",
      entityId: "farmer",
      deity: "zeus",
      offering: { resource: "wine", amount: 1 },
      favorEffect: "trade-favor",
      favorExpiresAtTick: 20,
    });
  }
});

test("a valid worship-performed event parses without an offering", () => {
  const result = parseEvent(
    envelope({
      kind: "worship-performed",
      entityId: "farmer",
      deity: "zeus",
      favorEffect: "trade-favor",
      favorExpiresAtTick: 20,
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({ kind: "worship-performed" });
    if (result.value.kind === "worship-performed") {
      expect(result.value.offering).toBeUndefined();
    }
  }
});

test("a valid income-earned event parses", () => {
  const result = parseEvent(
    envelope({
      kind: "income-earned",
      entityId: "farmer",
      buildingId: "agora-shop",
      amount: 2,
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      kind: "income-earned",
      entityId: "farmer",
      buildingId: "agora-shop",
      amount: 2,
    });
  }
});

test("a legend-recorded event carries an attributed assertion and, optionally, an evidence link -- and no truth flag", () => {
  const unlinked = parseEvent(
    envelope({
      kind: "legend-recorded",
      entityId: "bard",
      assertion: "Zeus struck down the old oak",
      hearers: [],
    }),
  );
  expect(unlinked.ok).toBe(true);
  if (unlinked.ok && unlinked.value.kind === "legend-recorded") {
    expect(unlinked.value).toMatchObject({
      entityId: "bard",
      assertion: "Zeus struck down the old oak",
    });
    expect(unlinked.value.linkedEventId).toBeUndefined();
    expect("verified" in unlinked.value).toBe(false);
    expect("legendId" in unlinked.value).toBe(false);
  }

  const linked = parseEvent(
    envelope({
      kind: "legend-recorded",
      entityId: "bard",
      assertion: "Zeus destroyed the entire Underworld",
      linkedEventId: "evt-9",
      hearers: [],
    }),
  );
  expect(linked.ok).toBe(true);
  if (linked.ok && linked.value.kind === "legend-recorded") {
    expect(String(linked.value.linkedEventId)).toBe("evt-9");
    expect("verified" in linked.value).toBe(false);
  }
});

test("a legend-recorded event with a non-string linkedEventId is rejected", () => {
  const result = parseEvent(
    envelope({
      kind: "legend-recorded",
      entityId: "bard",
      assertion: "Zeus struck down the old oak",
      linkedEventId: 9,
      hearers: [],
    }),
  );
  expect(result.ok).toBe(false);
});

function subjectsOf(event: WorldEvent): readonly string[] {
  return eventSubjects(event);
}

function parsedEvent(overrides: Record<string, unknown>): WorldEvent {
  const result = parseEvent(envelope(overrides));
  if (!result.ok) {
    throw new Error(`fixture failed to parse: ${result.message}`);
  }
  return result.value;
}

test("eventSubjects lists every entity a movement touches", () => {
  expect(
    subjectsOf(
      parsedEvent({ kind: "entity-moved", entityId: "npc-1", to: "loc-2" }),
    ),
  ).toEqual(["npc-1", "loc-2"]);
  expect(
    subjectsOf(
      parsedEvent({
        kind: "realm-transitioned",
        entityId: "npc-1",
        to: "underworld-gate",
        via: "styx",
      }),
    ),
  ).toEqual(["npc-1", "underworld-gate", "styx"]);
});

test("eventSubjects lists the counterparty, structure, deity, and building an event names", () => {
  expect(
    subjectsOf(
      parsedEvent({
        kind: "resource-traded",
        entityId: "npc-1",
        counterpartyId: "npc-2",
        give: [],
        receive: [],
      }),
    ),
  ).toEqual(["npc-1", "npc-2"]);
  expect(
    subjectsOf(
      parsedEvent({
        kind: "repair-progressed",
        entityId: "npc-1",
        structureId: "tavern",
        resource: "planks",
        amount: 1,
      }),
    ),
  ).toEqual(["npc-1", "tavern"]);
  expect(
    subjectsOf(
      parsedEvent({
        kind: "worship-performed",
        entityId: "npc-1",
        deity: "zeus",
        favorEffect: "gather-bonus",
        favorExpiresAtTick: 12,
      }),
    ),
  ).toEqual(["npc-1", "zeus"]);
  expect(
    subjectsOf(
      parsedEvent({
        kind: "income-earned",
        entityId: "npc-1",
        buildingId: "tavern",
        amount: 1,
      }),
    ),
  ).toEqual(["npc-1", "tavern"]);
});

test("eventSubjects lists only the building for building-scoped events", () => {
  expect(
    subjectsOf(
      parsedEvent({
        kind: "building-ignited",
        entityId: "tavern",
        cause: { kind: "strike", actor: "zeus" },
      }),
    ),
  ).toEqual(["tavern"]);
  expect(
    subjectsOf(
      parsedEvent({
        kind: "building-burn-ticked",
        entityId: "tavern",
        fireIntensity: 1,
        ticksBurning: 1,
        cause: "evt-3",
      }),
    ),
  ).toEqual(["tavern"]);
});

test("eventSubjects never repeats an id an event names twice", () => {
  expect(
    subjectsOf(
      parsedEvent({
        kind: "resource-traded",
        entityId: "npc-1",
        counterpartyId: "npc-1",
        give: [],
        receive: [],
      }),
    ),
  ).toEqual(["npc-1"]);
});

test("WORLD_EVENT_KINDS lists every kind parseEvent accepts", () => {
  expect(WORLD_EVENT_KINDS).toContain("entity-moved");
  expect(WORLD_EVENT_KINDS).toContain("legend-recorded");
  expect(new Set(WORLD_EVENT_KINDS).size).toBe(WORLD_EVENT_KINDS.length);
  expect(WORLD_EVENT_KINDS).toContain("memory-recorded");
  expect(WORLD_EVENT_KINDS).toContain("report-told");
  expect(WORLD_EVENT_KINDS).toContain("relationship-changed");
  expect(WORLD_EVENT_KINDS).toHaveLength(44);
});

test("an unknown event kind is rejected with reason unknown-kind", () => {
  const result = parseEvent(
    envelope({ kind: "teleported", entityId: "npc-1" }),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("unknown-kind");
  }
});

test("an unsupported schema version is rejected distinctly from a malformed payload", () => {
  const result = parseEvent(
    envelope({
      schemaVersion: 99,
      kind: "entity-moved",
      entityId: "npc-1",
      to: "loc-2",
    }),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("unsupported-version");
  }

  const malformedInput = envelope({
    kind: "entity-moved",
    entityId: "npc-1",
    to: "loc-2",
  });
  delete malformedInput.id;
  const malformed = parseEvent(malformedInput);
  expect(malformed.ok).toBe(false);
  if (!malformed.ok) {
    expect(malformed.reason).toBe("malformed");
    expect(malformed.path).toBe("id");
  }
});

// --- Social events: memory, reports, relationships -----------------------------

const WITNESSED = {
  kind: "memory-recorded",
  memoryKind: "witnessed",
  entityId: "farmer",
  sourceEventId: "evt-4",
  eventKind: "building-ignited",
  subjects: ["the-tavern"],
  salience: 8,
  consequence: { effect: "harm", agent: "zeus", target: "farmer" },
};

const TOLD = {
  kind: "memory-recorded",
  memoryKind: "told",
  entityId: "hera",
  sourceEventId: "evt-9",
  teller: "farmer",
  content: "Zeus burned the whole agora down",
  linkedEventId: "evt-4",
  subjects: ["farmer", "the-tavern"],
  salience: 4,
  consequence: { effect: "harm", agent: "zeus", target: "farmer" },
};

test("a witnessed memory parses with the event it rests on, what was seen, and its consequence", () => {
  const result = parseEvent(envelope(WITNESSED));
  expect(result.ok).toBe(true);
  if (result.ok && result.value.kind === "memory-recorded") {
    expect(result.value.memoryKind).toBe("witnessed");
    expect(String(result.value.sourceEventId)).toBe("evt-4");
    expect(result.value.salience).toBe(8);
    expect(result.value.consequence as unknown).toEqual({
      effect: "harm",
      agent: "zeus",
      target: "farmer",
    });
  }
});

test("a told memory parses attributed to its teller, with the content as told and the event the teller cited", () => {
  const result = parseEvent(envelope(TOLD));
  expect(result.ok).toBe(true);
  if (
    result.ok &&
    result.value.kind === "memory-recorded" &&
    result.value.memoryKind === "told"
  ) {
    expect(String(result.value.teller)).toBe("farmer");
    expect(result.value.content).toBe("Zeus burned the whole agora down");
    expect(String(result.value.linkedEventId)).toBe("evt-4");
  }
  // A told memory needs no cited event and no consequence: a bare story.
  const bare = parseEvent(
    envelope({
      ...TOLD,
      linkedEventId: undefined,
      consequence: undefined,
    }),
  );
  expect(bare.ok).toBe(true);
});

test("a memory missing what its kind requires, or with a malformed field, is rejected", () => {
  const broken: Record<string, unknown>[] = [
    { ...WITNESSED, eventKind: undefined },
    { ...WITNESSED, eventKind: "not-a-kind" },
    { ...WITNESSED, sourceEventId: undefined },
    { ...WITNESSED, salience: 0 },
    { ...WITNESSED, salience: 1.5 },
    { ...WITNESSED, subjects: "the-tavern" },
    { ...WITNESSED, consequence: { effect: "worship", agent: "zeus" } },
    { ...WITNESSED, consequence: { effect: "harm" } },
    { ...TOLD, teller: undefined },
    { ...TOLD, content: undefined },
    { ...TOLD, content: "" },
    { ...WITNESSED, memoryKind: "dreamed" },
    { ...WITNESSED, memoryKind: undefined },
  ];
  for (const overrides of broken) {
    expect(parseEvent(envelope(overrides)).ok).toBe(false);
  }
});

test("a report-told event names the teller, the listener, the content told, and any event the teller cited", () => {
  const result = parseEvent(
    envelope({
      kind: "report-told",
      entityId: "farmer",
      listenerId: "hera",
      content: "Zeus burned the whole agora down",
      linkedEventId: "evt-4",
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok && result.value.kind === "report-told") {
    expect(String(result.value.listenerId)).toBe("hera");
    expect(String(result.value.linkedEventId)).toBe("evt-4");
    expect("verified" in result.value).toBe(false);
  }
  expect(
    parseEvent(
      envelope({
        kind: "report-told",
        entityId: "farmer",
        listenerId: "hera",
      }),
    ).ok,
  ).toBe(false);
});

test("a relationship-changed event names who feels it, toward whom, the change, and the memory that caused it", () => {
  const result = parseEvent(
    envelope({
      kind: "relationship-changed",
      entityId: "hera",
      toward: "zeus",
      affinityDelta: -1,
      grudgeDelta: 0,
      allied: false,
      memoryEventId: "evt-10",
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok && result.value.kind === "relationship-changed") {
    expect(result.value.affinityDelta).toBe(-1);
    expect(result.value.allied).toBe(false);
    expect(String(result.value.memoryEventId)).toBe("evt-10");
  }
  // `allied` is present only when the change flipped it.
  expect(
    parseEvent(
      envelope({
        kind: "relationship-changed",
        entityId: "hera",
        toward: "zeus",
        affinityDelta: 1,
        grudgeDelta: 0,
        memoryEventId: "evt-10",
      }),
    ).ok,
  ).toBe(true);
});

test("a relationship-changed event without a cause, with a fractional delta, or with a negative grudge change is rejected", () => {
  const good = {
    kind: "relationship-changed",
    entityId: "hera",
    toward: "zeus",
    affinityDelta: -1,
    grudgeDelta: 0,
    memoryEventId: "evt-10",
  };
  for (const overrides of [
    { memoryEventId: undefined },
    { affinityDelta: -0.5 },
    { grudgeDelta: -1 },
    { toward: undefined },
    { allied: "yes" },
  ]) {
    expect(parseEvent(envelope({ ...good, ...overrides })).ok).toBe(false);
  }
});

test("eventSubjects lists the owner of a memory, both ends of a report, and both ends of a relationship", () => {
  expect(subjectsOf(parsedEvent(WITNESSED))).toEqual(["farmer"]);
  expect(
    subjectsOf(
      parsedEvent({
        kind: "report-told",
        entityId: "farmer",
        listenerId: "hera",
        content: "x",
      }),
    ),
  ).toEqual(["farmer", "hera"]);
  expect(
    subjectsOf(
      parsedEvent({
        kind: "relationship-changed",
        entityId: "hera",
        toward: "zeus",
        affinityDelta: -1,
        grudgeDelta: 0,
        memoryEventId: "evt-10",
      }),
    ),
  ).toEqual(["hera", "zeus"]);
});

// --- Causal chains ---------------------------------------------------------------

function log(...events: Record<string, unknown>[]): Map<string, WorldEvent> {
  const byId = new Map<string, WorldEvent>();
  for (const [index, overrides] of events.entries()) {
    const event = parsedEvent({
      id: `evt-${index + 1}`,
      sequence: index + 1,
      ...overrides,
    });
    byId.set(event.id, event);
  }
  return byId;
}

test("eventCause is the event a fire event, a memory, a report, or a relationship change follows from", () => {
  const events = log(
    {
      kind: "building-ignited",
      entityId: "the-tavern",
      cause: { kind: "strike", actor: "zeus" },
    },
    {
      kind: "building-ignited",
      entityId: "old-oak",
      cause: { kind: "spread", from: "evt-1", actor: "zeus" },
    },
    {
      kind: "building-burn-ticked",
      entityId: "old-oak",
      fireIntensity: 1,
      ticksBurning: 1,
      cause: "evt-2",
    },
    {
      kind: "building-destroyed",
      entityId: "old-oak",
      disposedInventory: [],
      cause: "evt-2",
    },
    { ...WITNESSED, sourceEventId: "evt-4" },
    {
      kind: "report-told",
      entityId: "farmer",
      listenerId: "hera",
      content: "x",
      linkedEventId: "evt-1",
    },
    {
      kind: "relationship-changed",
      entityId: "farmer",
      toward: "zeus",
      affinityDelta: -2,
      grudgeDelta: 1,
      memoryEventId: "evt-5",
    },
    {
      kind: "report-told",
      entityId: "farmer",
      listenerId: "hera",
      content: "an uncited story",
    },
  );
  const cause = (n: number) => {
    const event = events.get(`evt-${n}`);
    return event === undefined ? undefined : eventCause(event);
  };
  // A strike ignition is a root: its own proposal, not another event, caused it.
  expect(cause(1)).toBeUndefined();
  expect(String(cause(2))).toBe("evt-1");
  expect(String(cause(3))).toBe("evt-2");
  expect(String(cause(4))).toBe("evt-2");
  expect(String(cause(5))).toBe("evt-4");
  expect(String(cause(6))).toBe("evt-1");
  expect(String(cause(7))).toBe("evt-5");
  // A bare story cites nothing.
  expect(cause(8)).toBeUndefined();
});

test("causalChain walks a destruction back through spread and ignition to the strike, root first", () => {
  const events = log(
    {
      kind: "building-ignited",
      entityId: "the-tavern",
      cause: { kind: "strike", actor: "zeus" },
    },
    {
      kind: "building-ignited",
      entityId: "old-oak",
      cause: { kind: "spread", from: "evt-1", actor: "zeus" },
    },
    {
      kind: "building-destroyed",
      entityId: "old-oak",
      disposedInventory: [],
      cause: "evt-2",
    },
  );
  const chain = causalChain((id) => events.get(id), "evt-3" as never);
  expect(chain.map((event) => String(event.id))).toEqual([
    "evt-1",
    "evt-2",
    "evt-3",
  ]);
});

test("causalChain of a root event, or of one whose cause is not in the log, ends where the log does", () => {
  const events = log(
    {
      kind: "building-ignited",
      entityId: "the-tavern",
      cause: { kind: "strike", actor: "zeus" },
    },
    {
      kind: "building-burn-ticked",
      entityId: "the-tavern",
      fireIntensity: 1,
      ticksBurning: 1,
      cause: "evt-404",
    },
  );
  expect(
    causalChain((id) => events.get(id), "evt-1" as never).map((e) =>
      String(e.id),
    ),
  ).toEqual(["evt-1"]);
  expect(
    causalChain((id) => events.get(id), "evt-2" as never).map((e) =>
      String(e.id),
    ),
  ).toEqual(["evt-2"]);
  expect(causalChain((id) => events.get(id), "evt-404" as never)).toEqual([]);
});

// --- Claims, text limits, and what can be witnessed ---------------------------

test("a report-told event may carry the claim its teller asserted, shape-checked and never judged", () => {
  const result = parseEvent(
    envelope({
      kind: "report-told",
      entityId: "farmer",
      listenerId: "hera",
      content: "Zeus wronged me",
      claim: { effect: "harm", agent: "zeus", target: "farmer" },
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok && result.value.kind === "report-told") {
    expect(result.value.claim as unknown).toEqual({
      effect: "harm",
      agent: "zeus",
      target: "farmer",
    });
  }
  expect(
    parseEvent(
      envelope({
        kind: "report-told",
        entityId: "farmer",
        listenerId: "hera",
        content: "x",
        claim: { effect: "harm" },
      }),
    ).ok,
  ).toBe(false);
});

test("report text is bounded in the event and in the belief it becomes", () => {
  const atLimit = "x".repeat(MAX_REPORT_LENGTH);
  const over = `${atLimit}x`;
  const told = (content: string) =>
    parseEvent(
      envelope({
        kind: "report-told",
        entityId: "farmer",
        listenerId: "hera",
        content,
      }),
    ).ok;
  expect(told(atLimit)).toBe(true);
  expect(told(over)).toBe(false);
  const belief = (content: string) =>
    parseEvent(envelope({ ...TOLD, content })).ok;
  expect(belief(atLimit)).toBe(true);
  expect(belief(over)).toBe(false);
});

test("only kinds someone can perceive are witnessable: a memory of a report, a memory, or a feeling is rejected", () => {
  for (const eventKind of [
    "report-told",
    "memory-recorded",
    "relationship-changed",
  ]) {
    expect(parseEvent(envelope({ ...WITNESSED, eventKind })).ok).toBe(false);
    expect(WITNESSED_EVENT_KINDS as readonly string[]).not.toContain(eventKind);
  }
  // Control: every other kind can be witnessed.
  for (const eventKind of WITNESSED_EVENT_KINDS) {
    expect(parseEvent(envelope({ ...WITNESSED, eventKind })).ok).toBe(true);
  }
  expect(WITNESSED_EVENT_KINDS).toHaveLength(WORLD_EVENT_KINDS.length - 24);
});

// --- Legend tellings: a claim and the recorded hearers ------------------------------------

test("a legend-recorded event records who heard it and may carry a claim shaped like a report's", () => {
  const result = parseEvent(
    envelope({
      kind: "legend-recorded",
      entityId: "hera",
      assertion: "Zeus cheated me.",
      claim: { effect: "harm", agent: "zeus", target: "hera" },
      hearers: ["farmer", "zeus"],
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok && result.value.kind === "legend-recorded") {
    expect(result.value.hearers.map(String)).toEqual(["farmer", "zeus"]);
    expect(result.value.claim as unknown).toEqual({
      effect: "harm",
      agent: "zeus",
      target: "hera",
    });
  }
  // A legend told to no one is still a legend: an empty audience is valid.
  expect(
    parseEvent(
      envelope({
        kind: "legend-recorded",
        entityId: "hera",
        assertion: "Alone.",
        hearers: [],
      }),
    ).ok,
  ).toBe(true);
});

test("a legend-recorded event without its hearers, or with a malformed hearer list or claim, is rejected", () => {
  const good = {
    kind: "legend-recorded",
    entityId: "hera",
    assertion: "x",
    hearers: ["farmer"],
  };
  expect(parseEvent(envelope(good)).ok).toBe(true);
  for (const overrides of [
    { hearers: undefined },
    { hearers: "farmer" },
    { hearers: [3] },
    { claim: { effect: "worship", agent: "zeus" } },
    { claim: { effect: "harm" } },
  ]) {
    expect(parseEvent(envelope({ ...good, ...overrides })).ok).toBe(false);
  }
});

// --- Goal events ---------------------------------------------------------------------------

test("a goal-set event names the god, its words, and its one target", () => {
  const result = parseEvent(
    envelope({
      kind: "goal-set",
      entityId: "hera",
      text: "Make Zeus admit his deceit.",
      target: "zeus",
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok && result.value.kind === "goal-set") {
    expect(result.value.text).toBe("Make Zeus admit his deceit.");
    expect(String(result.value.target)).toBe("zeus");
  }
});

test("a goal-ended event names the god, the outcome, and the goal-set event it ends", () => {
  for (const outcome of ["achieved", "failed", "abandoned"]) {
    const result = parseEvent(
      envelope({
        kind: "goal-ended",
        entityId: "hera",
        outcome,
        goalEventId: "evt-3",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === "goal-ended") {
      expect(result.value.outcome as string).toBe(outcome);
      expect(String(result.value.goalEventId)).toBe("evt-3");
    }
  }
});

test("goal events with empty or over-long text, an unknown outcome, or a missing field are rejected", () => {
  const set = {
    kind: "goal-set",
    entityId: "hera",
    text: "Win the farmer's devotion.",
    target: "farmer",
  };
  expect(parseEvent(envelope(set)).ok).toBe(true);
  expect(
    parseEvent(envelope({ ...set, text: "x".repeat(MAX_GOAL_LENGTH) })).ok,
  ).toBe(true);
  for (const overrides of [
    { text: "" },
    { text: "x".repeat(MAX_GOAL_LENGTH + 1) },
    { text: undefined },
    { target: undefined },
    { entityId: undefined },
  ]) {
    expect(parseEvent(envelope({ ...set, ...overrides })).ok).toBe(false);
  }
  const ended = {
    kind: "goal-ended",
    entityId: "hera",
    outcome: "achieved",
    goalEventId: "evt-3",
  };
  expect(parseEvent(envelope(ended)).ok).toBe(true);
  for (const overrides of [
    { outcome: "won" },
    { outcome: undefined },
    { goalEventId: undefined },
  ]) {
    expect(parseEvent(envelope({ ...ended, ...overrides })).ok).toBe(false);
  }
});

test("goal events are private and unplaced: in the unplaced set, out of the witnessed set; and a legend stays witnessable", () => {
  for (const kind of ["goal-set", "goal-ended"]) {
    expect(UNPLACED_EVENT_KINDS as readonly string[]).toContain(kind);
    expect(WITNESSED_EVENT_KINDS as readonly string[]).not.toContain(kind);
    // A witnessed memory cannot name them.
    expect(
      parseEvent(
        envelope({
          kind: "memory-recorded",
          memoryKind: "witnessed",
          entityId: "farmer",
          sourceEventId: "evt-2",
          eventKind: kind,
          subjects: [],
          salience: 4,
        }),
      ).ok,
    ).toBe(false);
  }
  // Control: the legend event is placed and witnessable.
  expect(UNPLACED_EVENT_KINDS as readonly string[]).not.toContain(
    "legend-recorded",
  );
  expect(WITNESSED_EVENT_KINDS as readonly string[]).toContain(
    "legend-recorded",
  );
});

test("a goal-ended event follows the goal it ends; a goal-set is a root; subjects name the god and the target", () => {
  const events = new Map<string, WorldEvent>();
  for (const [index, overrides] of [
    {
      kind: "goal-set",
      entityId: "hera",
      text: "Win devotion.",
      target: "farmer",
    },
    {
      kind: "goal-ended",
      entityId: "hera",
      outcome: "abandoned",
      goalEventId: "evt-1",
    },
  ].entries()) {
    const event = parsedEvent({
      id: `evt-${index + 1}`,
      sequence: index + 1,
      ...overrides,
    });
    events.set(event.id, event);
  }
  const set = events.get("evt-1");
  const ended = events.get("evt-2");
  if (!set || !ended) throw new Error("fixture");
  expect(eventCause(set)).toBeUndefined();
  expect(String(eventCause(ended))).toBe("evt-1");
  expect(subjectsOf(set)).toEqual(["hera", "farmer"]);
  expect(subjectsOf(ended)).toEqual(["hera"]);
});

// --- Petitions, needs, trouble, and refused goal changes ---------------------------------------

const OPENED = {
  kind: "petition-opened",
  entityId: "farmer",
  god: "hera",
  cause: "evt-3",
  request: { kind: "help", need: { kind: "building", building: "the-tavern" } },
};

test("a petition-opened event names the petitioner, the god, the cause, and one request: help for a building or a resource, or punishment of an offender who owns buildings", () => {
  for (const request of [
    { kind: "help", need: { kind: "building", building: "the-tavern" } },
    { kind: "help", need: { kind: "resource", resource: "planks" } },
    { kind: "punish", offender: "woodcutter", buildings: ["woodshed"] },
  ]) {
    const result = parseEvent(envelope({ ...OPENED, request }));
    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === "petition-opened") {
      expect(String(result.value.god)).toBe("hera");
      expect(String(result.value.cause)).toBe("evt-3");
      expect(result.value.request as unknown).toEqual(request);
    }
  }
});

test("a petition is refused with no god, no cause, a punish request with no offender or no buildings list, or a malformed request; a punish request for an offender who owns nothing is valid", () => {
  expect(
    parseEvent(
      envelope({
        ...OPENED,
        request: { kind: "punish", offender: "woodcutter", buildings: [] },
      }),
    ).ok,
  ).toBe(true);
  for (const overrides of [
    { god: undefined },
    { cause: undefined },
    { request: undefined },
    { request: { kind: "punish", offender: "woodcutter" } },
    { request: { kind: "punish", buildings: ["woodshed"] } },
    { request: { kind: "help" } },
    { request: { kind: "help", need: { kind: "building" } } },
    { request: { kind: "help", need: { kind: "wishes", wish: "x" } } },
    { request: { kind: "pray" } },
  ]) {
    expect(parseEvent(envelope({ ...OPENED, ...overrides })).ok).toBe(false);
  }
});

test("answers, lapses, and refused goal changes parse, and are private: unplaced, never witnessed", () => {
  const answered = parseEvent(
    envelope({
      kind: "petition-answered",
      entityId: "farmer",
      god: "hera",
      petitionId: "evt-4",
      answeredBy: "evt-9",
    }),
  );
  expect(answered.ok).toBe(true);
  const lapsed = parseEvent(
    envelope({
      kind: "petition-lapsed",
      entityId: "farmer",
      god: "hera",
      petitionId: "evt-4",
    }),
  );
  expect(lapsed.ok).toBe(true);
  const refused = parseEvent(
    envelope({
      kind: "goal-change-refused",
      entityId: "zeus",
      reason: "locked",
      attempted: "replace",
      unlocksInTicks: 38,
    }),
  );
  expect(refused.ok).toBe(true);
  for (const kind of [
    "petition-answered",
    "petition-lapsed",
    "goal-change-refused",
    "unmet-need",
  ]) {
    expect(UNPLACED_EVENT_KINDS as readonly string[]).toContain(kind);
    expect(WITNESSED_EVENT_KINDS as readonly string[]).not.toContain(kind);
  }
  // Control: a prayer, a theft, and spoiled stock happen at a place, so they are witnessable.
  for (const kind of ["petition-opened", "theft", "stock-spoiled"]) {
    expect(UNPLACED_EVENT_KINDS as readonly string[]).not.toContain(kind);
    expect(WITNESSED_EVENT_KINDS as readonly string[]).toContain(kind);
  }
  for (const bad of [
    {
      kind: "petition-answered",
      entityId: "farmer",
      god: "hera",
      petitionId: "evt-4",
    },
    { kind: "petition-lapsed", entityId: "farmer", petitionId: "evt-4" },
    {
      kind: "goal-change-refused",
      entityId: "zeus",
      reason: "bored",
      attempted: "replace",
      unlocksInTicks: 1,
    },
    {
      kind: "goal-change-refused",
      entityId: "zeus",
      reason: "locked",
      attempted: "end",
      unlocksInTicks: 1,
    },
    {
      kind: "goal-change-refused",
      entityId: "zeus",
      reason: "locked",
      attempted: "replace",
      unlocksInTicks: -1,
    },
  ]) {
    expect(parseEvent(envelope(bad)).ok).toBe(false);
  }
});

test("unmet needs, theft, and spoiled stock parse; trouble records the director as its cause and a theft names its offender", () => {
  expect(
    parseEvent(
      envelope({
        kind: "unmet-need",
        entityId: "farmer",
        resource: "planks",
        reason: "no-seller",
      }),
    ).ok,
  ).toBe(true);
  for (const reason of ["no-seller", "no-funds", "no-buyer"]) {
    expect(
      parseEvent(
        envelope({
          kind: "unmet-need",
          entityId: "farmer",
          resource: "food",
          reason,
        }),
      ).ok,
    ).toBe(true);
  }
  expect(
    parseEvent(
      envelope({
        kind: "unmet-need",
        entityId: "farmer",
        resource: "food",
        reason: "bored",
      }),
    ).ok,
  ).toBe(false);
  const theft = {
    kind: "theft",
    entityId: "woodcutter",
    victim: "farmer",
    resource: "currency",
    amount: 3,
    cause: "director",
  };
  expect(parseEvent(envelope(theft)).ok).toBe(true);
  const spoiled = {
    kind: "stock-spoiled",
    entityId: "farmer",
    resource: "food",
    amount: 2,
    cause: "director",
  };
  expect(parseEvent(envelope(spoiled)).ok).toBe(true);
  for (const bad of [
    { ...theft, cause: undefined },
    { ...theft, cause: "nobody" },
    { ...theft, victim: undefined },
    { ...theft, amount: 0 },
    { ...theft, amount: 1.5 },
    { ...spoiled, cause: undefined },
    { ...spoiled, amount: -1 },
  ]) {
    expect(parseEvent(envelope(bad)).ok).toBe(false);
  }
});

test("a fire the director started has no actor; a spread from it carries none forward; a strike's still names one", () => {
  const ignited = (cause: unknown) =>
    parseEvent(
      envelope({ kind: "building-ignited", entityId: "the-tavern", cause }),
    );
  expect(ignited({ kind: "director" }).ok).toBe(true);
  expect(ignited({ kind: "spread", from: "evt-2" }).ok).toBe(true);
  expect(ignited({ kind: "spread", from: "evt-2", actor: "zeus" }).ok).toBe(
    true,
  );
  expect(ignited({ kind: "strike", actor: "zeus" }).ok).toBe(true);
  expect(ignited({ kind: "strike" }).ok).toBe(false);
  expect(ignited({ kind: "director", actor: "zeus" }).ok).toBe(true);
});

test("eventCause and subjects follow the new events: an answer and a lapse follow their petition, a petition its cause, and who is named is who is touched", () => {
  const events = new Map<string, WorldEvent>();
  for (const [index, overrides] of [
    {
      kind: "theft",
      entityId: "woodcutter",
      victim: "farmer",
      resource: "currency",
      amount: 3,
      cause: "director",
    },
    {
      ...OPENED,
      cause: "evt-1",
      request: {
        kind: "punish",
        offender: "woodcutter",
        buildings: ["woodshed"],
      },
    },
    {
      kind: "petition-answered",
      entityId: "farmer",
      god: "hera",
      petitionId: "evt-2",
      answeredBy: "evt-9",
    },
    {
      kind: "petition-lapsed",
      entityId: "farmer",
      god: "hera",
      petitionId: "evt-2",
    },
  ].entries()) {
    const event = parsedEvent({
      id: `evt-${index + 1}`,
      sequence: index + 1,
      ...overrides,
    });
    events.set(event.id, event);
  }
  const get = (n: number) => events.get(`evt-${n}`) as WorldEvent;
  expect(eventCause(get(1))).toBeUndefined();
  expect(String(eventCause(get(2)))).toBe("evt-1");
  expect(String(eventCause(get(3)))).toBe("evt-2");
  expect(String(eventCause(get(4)))).toBe("evt-2");
  expect(subjectsOf(get(1))).toEqual(["woodcutter", "farmer"]);
  expect(subjectsOf(get(2))).toEqual([
    "farmer",
    "hera",
    "woodcutter",
    "woodshed",
  ]);
  expect(subjectsOf(get(3))).toEqual(["farmer", "hera"]);
});

test("every event records the tick it happened in, and one without a whole non-negative tick is rejected", () => {
  const moved = {
    kind: "entity-moved",
    entityId: "farmer",
    from: "a",
    to: "b",
  };
  const parsed = parseEvent(envelope(moved));
  expect(parsed.ok && parsed.value.tick).toBe(3);
  for (const tick of [undefined, -1, 1.5, "3"]) {
    expect(parseEvent(envelope({ ...moved, tick })).ok).toBe(false);
  }
  // Control: tick 0 is a tick.
  expect(parseEvent(envelope({ ...moved, tick: 0 })).ok).toBe(true);
});

test("a need-met event closes the unmet need it names: the mortal, the resource, and the unmet-need event; it follows that event", () => {
  const result = parseEvent(
    envelope({
      kind: "need-met",
      entityId: "farmer",
      resource: "planks",
      needEventId: "evt-3",
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(String(eventCause(result.value))).toBe("evt-3");
    expect(subjectsOf(result.value)).toEqual(["farmer"]);
  }
  for (const bad of [
    { entityId: "farmer", resource: "planks" },
    { entityId: "farmer", needEventId: "evt-3" },
    { resource: "planks", needEventId: "evt-3" },
  ]) {
    expect(parseEvent(envelope({ kind: "need-met", ...bad })).ok).toBe(false);
  }
});

// --- Blessings and signs ------------------------------------------------------------------

test("a blessing-granted event names the god, the one it blessed, the petition it answers, and what it granted: planks for a building, or a resource", () => {
  const planks = {
    kind: "blessing-granted",
    entityId: "hera",
    recipient: "farmer",
    petitionId: "evt-4",
    resource: "planks",
    amount: 3,
    building: "the-tavern",
  };
  const result = parseEvent(envelope(planks));
  expect(result.ok).toBe(true);
  if (result.ok && result.value.kind === "blessing-granted") {
    expect(String(result.value.recipient)).toBe("farmer");
    expect(String(result.value.building)).toBe("the-tavern");
    expect(String(eventCause(result.value))).toBe("evt-4");
    expect(subjectsOf(result.value)).toEqual(["hera", "farmer", "the-tavern"]);
  }
  // A resource grant names no building.
  const food = { ...planks, resource: "food", amount: 2, building: undefined };
  expect(parseEvent(envelope(food)).ok).toBe(true);
  for (const bad of [
    { recipient: undefined },
    { petitionId: undefined },
    { resource: "" },
    { amount: 0 },
    { amount: 1.5 },
  ]) {
    expect(parseEvent(envelope({ ...planks, ...bad })).ok).toBe(false);
  }
  // A blessing happens where the god stands, so it is witnessable.
  expect(WITNESSED_EVENT_KINDS as readonly string[]).toContain(
    "blessing-granted",
  );
});

test("a sign memory records which god answered or let lapse which petition, with the kindness or harm it left", () => {
  const sign = {
    kind: "memory-recorded",
    memoryKind: "sign",
    entityId: "farmer",
    sourceEventId: "evt-9",
    god: "zeus",
    outcome: "answered",
    petitionId: "evt-4",
    subjects: ["zeus"],
    salience: 6,
    consequence: { effect: "kindness", agent: "zeus", target: "farmer" },
  };
  const result = parseEvent(envelope(sign));
  expect(result.ok).toBe(true);
  expect(
    parseEvent(
      envelope({
        ...sign,
        outcome: "lapsed",
        consequence: { effect: "harm", agent: "zeus", target: "farmer" },
      }),
    ).ok,
  ).toBe(true);
  for (const bad of [
    { god: undefined },
    { outcome: "ignored" },
    { petitionId: undefined },
    { consequence: undefined },
  ]) {
    expect(parseEvent(envelope({ ...sign, ...bad })).ok).toBe(false);
  }
});

test("a help request for a resource may carry the amount lost, a whole positive number, so a blessing can grant it back", () => {
  const ask = (need: unknown) =>
    parseEvent(envelope({ ...OPENED, request: { kind: "help", need } }));
  const withAmount = ask({ kind: "resource", resource: "food", amount: 3 });
  expect(withAmount.ok).toBe(true);
  if (withAmount.ok && withAmount.value.kind === "petition-opened") {
    expect(withAmount.value.request as unknown).toEqual({
      kind: "help",
      need: { kind: "resource", resource: "food", amount: 3 },
    });
  }
  // Without one (an unmet need) it is as before.
  expect(ask({ kind: "resource", resource: "food" }).ok).toBe(true);
  for (const amount of [0, -1, 1.5, "3"]) {
    expect(ask({ kind: "resource", resource: "food", amount }).ok).toBe(false);
  }
});

// --- Losses noticed ------------------------------------------------------------------------

test("a loss-noticed event names the owner, the event that caused the loss, and what was lost: a building, or a resource and amount; it is private and follows its cause", () => {
  const building = parseEvent(
    envelope({
      kind: "loss-noticed",
      entityId: "farmer",
      causeEventId: "evt-3",
      building: "the-tavern",
    }),
  );
  expect(building.ok).toBe(true);
  if (building.ok) {
    expect(String(eventCause(building.value))).toBe("evt-3");
    expect(subjectsOf(building.value)).toEqual(["farmer", "the-tavern"]);
  }
  const stock = parseEvent(
    envelope({
      kind: "loss-noticed",
      entityId: "farmer",
      causeEventId: "evt-3",
      resource: "food",
      amount: 2,
    }),
  );
  expect(stock.ok).toBe(true);
  expect(UNPLACED_EVENT_KINDS as readonly string[]).toContain("loss-noticed");
  expect(WITNESSED_EVENT_KINDS as readonly string[]).not.toContain(
    "loss-noticed",
  );
  for (const bad of [
    { causeEventId: undefined, building: "the-tavern" },
    { entityId: undefined, building: "the-tavern" },
    // It names a building or a resource, not neither and not both.
    {},
    { building: "the-tavern", resource: "food", amount: 1 },
    { resource: "food" },
    { resource: "food", amount: 0 },
  ]) {
    expect(
      parseEvent(
        envelope({
          kind: "loss-noticed",
          entityId: "farmer",
          causeEventId: "evt-3",
          ...bad,
        }),
      ).ok,
    ).toBe(false);
  }
});

test("a noticed memory records which loss the mortal noticed and names no offender: it cites the cause event and the loss", () => {
  const noticed = {
    kind: "memory-recorded",
    memoryKind: "noticed",
    entityId: "farmer",
    sourceEventId: "evt-9",
    causeEventId: "evt-3",
    subjects: ["farmer", "the-tavern"],
    salience: 5,
  };
  expect(parseEvent(envelope(noticed)).ok).toBe(true);
  for (const bad of [
    { causeEventId: undefined },
    { sourceEventId: undefined },
    { salience: 0 },
    // A noticed memory carries no consequence: no one is blamed.
    { consequence: { effect: "harm", agent: "zeus", target: "farmer" } },
  ]) {
    expect(parseEvent(envelope({ ...noticed, ...bad })).ok).toBe(false);
  }
});

// --- Practice threads -------------------------------------------------------------------------

const TERM = {
  kind: "tell-legend",
  party: "zeus",
  place: "altar",
  deadline: 150,
};

const PRACTICE_OPENED = {
  kind: "practice-opened",
  entityId: "hera",
  practice: "settlement",
  counterparty: "zeus",
  causes: ["evt-3"],
  term: TERM,
  negotiationDeadline: 120,
  counterBudget: 3,
};

test("a practice-opened event names the demander, the other party, the causes it consumes, one term with an absolute deadline, the negotiation deadline, and the counteroffer budget", () => {
  const result = parseEvent(envelope(PRACTICE_OPENED));
  expect(result.ok).toBe(true);
  if (result.ok && result.value.kind === "practice-opened") {
    expect(result.value.practice).toBe("settlement");
    expect(result.value.causes.map(String)).toEqual(["evt-3"]);
    expect(result.value.term).toEqual(TERM as never);
    expect(result.value.negotiationDeadline).toBe(120);
    expect(result.value.counterBudget).toBe(3);
  }
  const linked = parseEvent(
    envelope({ ...PRACTICE_OPENED, succeeds: "evt-2" }),
  );
  expect(linked.ok).toBe(true);
  if (linked.ok && linked.value.kind === "practice-opened") {
    expect(String(linked.value.succeeds)).toBe("evt-2");
  }
  for (const overrides of [
    { counterparty: undefined },
    { causes: [] },
    { causes: undefined },
    { causes: [""] },
    { practice: "contest" },
    { term: undefined },
    { term: { ...TERM, kind: "swear-fealty" } },
    { term: { ...TERM, deadline: undefined } },
    { term: { ...TERM, deadline: -1 } },
    { negotiationDeadline: undefined },
    { negotiationDeadline: 1.5 },
    { counterBudget: -1 },
    { succeeds: 7 },
  ]) {
    expect(parseEvent(envelope({ ...PRACTICE_OPENED, ...overrides })).ok).toBe(
      false,
    );
  }
});

test("practice-moved events carry what their move needs: a counter its term, an accept its swear flag, a refusal or withdrawal only the thread", () => {
  const moved = (overrides: Record<string, unknown>) =>
    parseEvent(
      envelope({
        kind: "practice-moved",
        entityId: "zeus",
        threadId: "evt-9",
        ...overrides,
      }),
    );
  const counter = moved({ move: "counter", term: TERM });
  expect(counter.ok).toBe(true);
  if (
    counter.ok &&
    counter.value.kind === "practice-moved" &&
    counter.value.move === "counter"
  ) {
    expect(counter.value.term).toEqual(TERM as never);
  }
  const accept = moved({ move: "accept", sworn: true });
  expect(accept.ok).toBe(true);
  if (
    accept.ok &&
    accept.value.kind === "practice-moved" &&
    accept.value.move === "accept"
  ) {
    expect(accept.value.sworn).toBe(true);
  }
  expect(moved({ move: "refuse" }).ok).toBe(true);
  expect(moved({ move: "withdraw" }).ok).toBe(true);
  for (const bad of [
    { move: "counter" },
    { move: "accept" },
    { move: "accept", sworn: "yes" },
    { move: "demand" },
    { move: "refuse", threadId: undefined },
  ]) {
    expect(moved(bad).ok).toBe(false);
  }
});

test("practice-ended events record the world's ruling: an outcome with the reason and, when a performance was seen, the event that showed it", () => {
  const ended = (overrides: Record<string, unknown>) =>
    parseEvent(
      envelope({
        kind: "practice-ended",
        entityId: "hera",
        counterparty: "zeus",
        threadId: "evt-9",
        outcome: "fulfilled",
        reason: "performed",
        performedBy: "evt-12",
        ...overrides,
      }),
    );
  const fulfilled = ended({});
  expect(fulfilled.ok).toBe(true);
  if (fulfilled.ok && fulfilled.value.kind === "practice-ended") {
    expect(String(fulfilled.value.performedBy)).toBe("evt-12");
  }
  expect(
    ended({
      outcome: "breached",
      reason: "obligation-deadline",
      performedBy: undefined,
    }).ok,
  ).toBe(true);
  for (const bad of [
    { outcome: "accepted" },
    { outcome: "open" },
    { reason: "bored" },
    { outcome: undefined },
    { reason: undefined },
    { threadId: undefined },
    { counterparty: undefined },
    { performedBy: 4 },
  ]) {
    expect(ended(bad).ok).toBe(false);
  }
});

test("practice events are private (unplaced, never witnessed), list their parties as subjects, and trace their cause: an opening to the event it rests on, a move to its thread, an ending to the performance or its thread", () => {
  const opened = parsedEvent(PRACTICE_OPENED);
  const moved = parsedEvent({
    kind: "practice-moved",
    entityId: "zeus",
    threadId: "evt-9",
    move: "refuse",
  });
  const fulfilled = parsedEvent({
    kind: "practice-ended",
    entityId: "hera",
    counterparty: "zeus",
    threadId: "evt-9",
    outcome: "fulfilled",
    reason: "performed",
    performedBy: "evt-12",
  });
  const expired = parsedEvent({
    kind: "practice-ended",
    entityId: "hera",
    counterparty: "zeus",
    threadId: "evt-9",
    outcome: "expired",
    reason: "negotiation-deadline",
  });
  for (const kind of ["practice-opened", "practice-moved", "practice-ended"]) {
    expect(WORLD_EVENT_KINDS as readonly string[]).toContain(kind);
    expect(UNPLACED_EVENT_KINDS as readonly string[]).toContain(kind);
    expect(WITNESSED_EVENT_KINDS as readonly string[]).not.toContain(kind);
  }
  expect(subjectsOf(opened)).toEqual(["hera", "zeus"]);
  expect(subjectsOf(moved)).toEqual(["zeus"]);
  expect(subjectsOf(fulfilled)).toEqual(["hera", "zeus"]);
  expect(String(eventCause(opened))).toBe("evt-3");
  expect(String(eventCause(moved))).toBe("evt-9");
  expect(String(eventCause(fulfilled))).toBe("evt-12");
  expect(String(eventCause(expired))).toBe("evt-9");
});

// --- Motifs, restored access, and memories of endings ---------------------------------------

const MOTIF_BASE = {
  kind: "motif-applied",
  entityId: "zeus",
  threadId: "evt-9",
  cause: "evt-12",
};
const OATH = {
  ...MOTIF_BASE,
  motif: "oath-penalty",
  effect: "oath-penalty",
  divinityLost: 3,
  capability: "divine",
  accessRestoredAt: 250,
};
const TRANSFORMATION = {
  ...MOTIF_BASE,
  motif: "transformation-punishment",
  effect: "transformation",
  intent: "punishment",
  form: "stag",
  capabilitiesGained: ["beast"],
  capabilitiesLost: ["divine"],
};
const STANDING = {
  ...MOTIF_BASE,
  motif: "standing-lost",
  effect: "standing",
  place: "altar",
  delta: -1,
};

test("a motif-applied event records the motif and what it changed, by effect: an oath penalty, a transformation, or a standing record", () => {
  const oath = parseEvent(envelope(OATH));
  expect(oath.ok).toBe(true);
  if (oath.ok && oath.value.kind === "motif-applied") {
    expect(oath.value).toMatchObject({
      motif: "oath-penalty",
      effect: "oath-penalty",
      divinityLost: 3,
      capability: "divine",
      accessRestoredAt: 250,
    });
    expect(String(oath.value.cause)).toBe("evt-12");
  }
  const form = parseEvent(envelope(TRANSFORMATION));
  expect(form.ok).toBe(true);
  if (form.ok && form.value.kind === "motif-applied") {
    expect(form.value).toMatchObject({
      effect: "transformation",
      intent: "punishment",
      form: "stag",
      capabilitiesGained: ["beast"],
      capabilitiesLost: ["divine"],
    });
  }
  expect(parseEvent(envelope(STANDING)).ok).toBe(true);
  expect(
    parseEvent(
      envelope({
        ...TRANSFORMATION,
        motif: "transformation-mercy",
        intent: "mercy",
      }),
    ).ok,
  ).toBe(true);
  expect(
    parseEvent(
      envelope({
        ...STANDING,
        motif: "standing-won",
        delta: 1,
      }),
    ).ok,
  ).toBe(true);
});

test("a motif-applied event cannot say a motif did something other than its catalogued change, or move standing the wrong way", () => {
  for (const bad of [
    { ...OATH, motif: "boon" },
    { ...OATH, motif: "standing-lost" },
    { ...OATH, motif: "curse" },
    { ...OATH, divinityLost: -1 },
    { ...OATH, capability: undefined },
    { ...OATH, accessRestoredAt: 1.5 },
    { ...TRANSFORMATION, motif: "oath-penalty" },
    { ...TRANSFORMATION, intent: "mercy" },
    { ...TRANSFORMATION, intent: "curse" },
    { ...TRANSFORMATION, form: undefined },
    { ...TRANSFORMATION, capabilitiesGained: undefined },
    { ...TRANSFORMATION, capabilitiesLost: [7] },
    { ...STANDING, motif: "standing-won" },
    { ...STANDING, delta: 0 },
    { ...STANDING, delta: 1 },
    { ...STANDING, place: undefined },
    { ...STANDING, motif: "transformation-mercy" },
    { ...OATH, effect: "banishment" },
    { ...OATH, effect: undefined },
    { ...OATH, threadId: undefined },
    { ...OATH, cause: undefined },
    { ...OATH, entityId: undefined },
  ]) {
    expect(parseEvent(envelope(bad)).ok).toBe(false);
  }
});

test("an access-restored event names the actor, the capability, and the penalty it ends", () => {
  const restored = {
    kind: "access-restored",
    entityId: "zeus",
    capability: "divine",
    motifEventId: "evt-13",
  };
  expect(parseEvent(envelope(restored)).ok).toBe(true);
  for (const bad of [
    { capability: undefined },
    { motifEventId: undefined },
    { entityId: undefined },
    { capability: 7 },
  ]) {
    expect(parseEvent(envelope({ ...restored, ...bad })).ok).toBe(false);
  }
});

test("motifs and restored access are private events with traceable causes: a motif follows the ending that called for it, a restoration the penalty it ends", () => {
  const oath = parsedEvent(OATH);
  const restored = parsedEvent({
    kind: "access-restored",
    entityId: "zeus",
    capability: "divine",
    motifEventId: "evt-13",
  });
  for (const kind of ["motif-applied", "access-restored"]) {
    expect(WORLD_EVENT_KINDS as readonly string[]).toContain(kind);
    expect(UNPLACED_EVENT_KINDS as readonly string[]).toContain(kind);
    expect(WITNESSED_EVENT_KINDS as readonly string[]).not.toContain(kind);
  }
  expect(subjectsOf(oath)).toEqual(["zeus"]);
  expect(subjectsOf(restored)).toEqual(["zeus"]);
  expect(String(eventCause(oath))).toBe("evt-12");
  expect(String(eventCause(restored))).toBe("evt-13");
});

test("a practice-opened event may carry the transformation its breacher faces, and a malformed stake is refused", () => {
  const stake = {
    form: "stag",
    capabilitiesGained: ["beast"],
    capabilitiesLost: [],
  };
  const result = parseEvent(envelope({ ...PRACTICE_OPENED, stake }));
  expect(result.ok).toBe(true);
  if (result.ok && result.value.kind === "practice-opened") {
    expect(result.value.stake).toEqual(stake);
  }
  const plain = parseEvent(envelope(PRACTICE_OPENED));
  if (plain.ok && plain.value.kind === "practice-opened") {
    expect(plain.value.stake).toBeUndefined();
  }
  for (const bad of [
    { stake: "stag" },
    { stake: { ...stake, form: "" } },
    { stake: { ...stake, capabilitiesGained: "beast" } },
    { stake: { form: "stag" } },
  ]) {
    expect(parseEvent(envelope({ ...PRACTICE_OPENED, ...bad })).ok).toBe(false);
  }
});

test("an ally term parses with its other god, and a sealed ending is a reason the world may give", () => {
  const ally = { kind: "ally", party: "zeus", to: "hera", deadline: 150 };
  const opened = parseEvent(envelope({ ...PRACTICE_OPENED, term: ally }));
  expect(opened.ok).toBe(true);
  if (opened.ok && opened.value.kind === "practice-opened") {
    expect(opened.value.term).toEqual(ally as never);
  }
  expect(
    parseEvent(
      envelope({ ...PRACTICE_OPENED, term: { ...ally, to: undefined } }),
    ).ok,
  ).toBe(false);
  expect(
    parseEvent(
      envelope({
        kind: "practice-ended",
        entityId: "hera",
        counterparty: "zeus",
        threadId: "evt-9",
        outcome: "fulfilled",
        reason: "sealed",
      }),
    ).ok,
  ).toBe(true);
});

test("a witnessed memory of a thread ending says how it ended, and no other witnessed memory does", () => {
  const ending = (overrides: Record<string, unknown>) =>
    parseEvent(
      envelope({
        ...WITNESSED,
        eventKind: "practice-ended",
        ending: { outcome: "breached", agent: "zeus" },
        ...overrides,
      }),
    );
  const breached = ending({});
  expect(breached.ok).toBe(true);
  if (
    breached.ok &&
    breached.value.kind === "memory-recorded" &&
    breached.value.memoryKind === "witnessed"
  ) {
    expect(breached.value.ending).toMatchObject({
      outcome: "breached",
      agent: "zeus",
    });
  }
  expect(ending({ eventKind: "practice-moved" }).ok).toBe(true);
  expect(ending({ ending: { outcome: "fulfilled", sealed: true } }).ok).toBe(
    true,
  );
  expect(ending({ ending: { outcome: "expired" } }).ok).toBe(true);
  for (const bad of [
    { ending: undefined },
    { ending: { outcome: "accepted" } },
    { ending: { outcome: "breached", agent: 7 } },
    { ending: { outcome: "breached", sealed: false } },
    { ending: "breached" },
    { eventKind: "entity-moved" },
    { eventKind: "practice-opened" },
  ]) {
    expect(ending(bad).ok).toBe(false);
  }
});

// --- Anti-loop: a thread's subject, refused moves, and how a thread ended ---------------------

test("a practice-opened event may name the thread's subject: the agent and, when the cause names one, the target; a malformed subject is refused", () => {
  const withSubject = (subject: unknown) =>
    parseEvent(envelope({ ...PRACTICE_OPENED, subject }));
  const both = withSubject({ agent: "zeus", target: "farmer" });
  expect(both.ok).toBe(true);
  if (both.ok && both.value.kind === "practice-opened") {
    expect(both.value.subject).toEqual({
      agent: "zeus",
      target: "farmer",
    } as never);
  }
  expect(withSubject({ agent: "zeus" }).ok).toBe(true);
  expect(parseEvent(envelope(PRACTICE_OPENED)).ok).toBe(true);
  for (const bad of [
    {},
    { target: "farmer" },
    { agent: 7 },
    { agent: "zeus", target: 4 },
    "zeus",
  ]) {
    expect(withSubject(bad).ok).toBe(false);
  }
});

test("a practice-refused event records a refused practice move and why: a reason the world gives, the move, the thread it concerned, and for no-progress what already answered it", () => {
  const refused = (overrides: Record<string, unknown>) =>
    parseEvent(
      envelope({
        kind: "practice-refused",
        entityId: "hera",
        attempted: "demand",
        reason: "no-progress",
        thread: "evt-9",
        why: "that was already answered",
        ...overrides,
      }),
    );
  const good = refused({});
  expect(good.ok).toBe(true);
  if (good.ok && good.value.kind === "practice-refused") {
    expect(good.value.reason).toBe("no-progress");
    expect(String(good.value.thread)).toBe("evt-9");
    expect(good.value.why).toBe("that was already answered");
  }
  for (const attempted of [
    "demand",
    "counter",
    "accept",
    "refuse",
    "withdraw",
    "report",
    "legend",
  ]) {
    expect(refused({ attempted }).ok).toBe(true);
  }
  expect(
    refused({ thread: undefined, why: undefined, reason: "stale-target" }).ok,
  ).toBe(true);
  for (const bad of [
    { attempted: "swear" },
    { attempted: undefined },
    { reason: "bored" },
    { reason: undefined },
    { thread: 4 },
    { why: "" },
    { why: 4 },
    { entityId: undefined },
  ]) {
    expect(refused(bad).ok).toBe(false);
  }
  // Private, like every practice event; it names the god that was refused and traces to its thread.
  expect(UNPLACED_EVENT_KINDS as readonly string[]).toContain(
    "practice-refused",
  );
  expect(WITNESSED_EVENT_KINDS as readonly string[]).not.toContain(
    "practice-refused",
  );
  const event = parsedEvent({
    kind: "practice-refused",
    entityId: "hera",
    attempted: "report",
    reason: "no-progress",
    thread: "evt-9",
  });
  expect(subjectsOf(event)).toEqual(["hera"]);
  expect(String(eventCause(event))).toBe("evt-9");
  expect(
    eventCause(
      parsedEvent({
        kind: "practice-refused",
        entityId: "hera",
        attempted: "demand",
        reason: "malformed",
      }),
    ),
  ).toBeUndefined();
});

test("a memory of an ending may say the term was sworn; sworn is true or nothing", () => {
  const ending = (e: Record<string, unknown>) =>
    parseEvent(
      envelope({
        ...WITNESSED,
        eventKind: "practice-ended",
        ending: { outcome: "breached", agent: "zeus", ...e },
      }),
    );
  const sworn = ending({ sworn: true });
  expect(sworn.ok).toBe(true);
  if (
    sworn.ok &&
    sworn.value.kind === "memory-recorded" &&
    sworn.value.memoryKind === "witnessed"
  ) {
    expect(sworn.value.ending?.sworn).toBe(true);
  }
  expect(ending({}).ok).toBe(true);
  expect(ending({ sworn: false }).ok).toBe(false);
  expect(ending({ sworn: "yes" }).ok).toBe(false);
});

// --- Supplication: terms offered to a mortal who prayed ---------------------------------------

const SUPPLICATION_OPENED = {
  kind: "practice-opened",
  entityId: "hera",
  practice: "supplication",
  counterparty: "farmer",
  causes: ["evt-3"],
  petition: "evt-4",
  term: {
    kind: "make-offering",
    party: "farmer",
    to: "hera",
    resource: "wood",
    amount: 1,
    deadline: 150,
  },
  negotiationDeadline: 120,
  counterBudget: 0,
  stake: {
    form: "wolf",
    capabilitiesGained: ["beast-form"],
    capabilitiesLost: [],
  },
};

test("a supplication thread opens with the petition it answers, no counteroffers, and may carry a stake; a settlement may not name a petition", () => {
  const parsed = parseEvent(envelope(SUPPLICATION_OPENED));
  expect(parsed.ok).toBe(true);
  if (parsed.ok && parsed.value.kind === "practice-opened") {
    expect(parsed.value.practice).toBe("supplication");
    expect(String(parsed.value.petition)).toBe("evt-4");
    expect(parsed.value.counterBudget).toBe(0);
  }
  expect(
    parseEvent(envelope({ ...SUPPLICATION_OPENED, petition: undefined })).ok,
  ).toBe(false);
  expect(parseEvent(envelope({ ...SUPPLICATION_OPENED, petition: 4 })).ok).toBe(
    false,
  );
  expect(
    parseEvent(envelope({ ...SUPPLICATION_OPENED, practice: "settlement" })).ok,
  ).toBe(false);
  // Control: a settlement is as it was.
  expect(parseEvent(envelope(PRACTICE_OPENED)).ok).toBe(true);
});

test("practice-progressed records one half of a supplication done, the boon or the offering, with the event that showed it; it is private and traces to that event", () => {
  const progressed = (overrides: Record<string, unknown>) =>
    parseEvent(
      envelope({
        kind: "practice-progressed",
        entityId: "hera",
        counterparty: "farmer",
        threadId: "evt-9",
        step: "boon",
        by: "evt-12",
        ...overrides,
      }),
    );
  for (const step of ["boon", "offering"]) {
    expect(progressed({ step }).ok).toBe(true);
  }
  for (const bad of [
    { step: "prayer" },
    { step: undefined },
    { by: undefined },
    { threadId: undefined },
    { counterparty: undefined },
    { entityId: undefined },
  ]) {
    expect(progressed(bad).ok).toBe(false);
  }
  expect(UNPLACED_EVENT_KINDS as readonly string[]).toContain(
    "practice-progressed",
  );
  expect(WITNESSED_EVENT_KINDS as readonly string[]).not.toContain(
    "practice-progressed",
  );
  const event = parsedEvent({
    kind: "practice-progressed",
    entityId: "hera",
    counterparty: "farmer",
    threadId: "evt-9",
    step: "offering",
    by: "evt-12",
  });
  expect(subjectsOf(event)).toEqual(["hera", "farmer"]);
  expect(String(eventCause(event))).toBe("evt-12");
});

test("a supplication can end because the boon never came, and a refused offer, a practice-ended reason, and a refused move name it", () => {
  const ended = (overrides: Record<string, unknown>) =>
    parseEvent(
      envelope({
        kind: "practice-ended",
        entityId: "hera",
        counterparty: "farmer",
        threadId: "evt-9",
        outcome: "expired",
        reason: "boon-unanswered",
        ...overrides,
      }),
    );
  expect(ended({}).ok).toBe(true);
  expect(ended({ reason: "boon-withheld" }).ok).toBe(false);
  expect(
    parseEvent(
      envelope({
        kind: "practice-refused",
        entityId: "hera",
        attempted: "offer",
        reason: "no-progress",
        thread: "evt-9",
        why: "the farmer already answered that",
      }),
    ).ok,
  ).toBe(true);
});

// --- Contests: opened by a god over a rival's act, closed by the world --------------------------

const CONTEST_OPENED = {
  kind: "contest-opened",
  entityId: "athena",
  rival: "poseidon",
  place: "town-square",
  cause: "evt-12",
  closesAt: 130,
};
const CONTEST_CLOSED = {
  kind: "contest-closed",
  entityId: "athena",
  rival: "poseidon",
  place: "town-square",
  contestId: "evt-20",
  result: "decided",
  reason: "window",
  winner: "athena",
  favoured: [
    { mortal: "farmer", god: "athena" },
    { mortal: "woodcutter", god: "poseidon" },
  ],
};

test("a contest-opened event names the god, its rival, the place, the rival act it rests on, and the last tick that counts", () => {
  const opened = parseEvent(envelope(CONTEST_OPENED));
  expect(opened.ok).toBe(true);
  if (opened.ok && opened.value.kind === "contest-opened") {
    expect(opened.value).toMatchObject({
      entityId: "athena",
      rival: "poseidon",
      place: "town-square",
      closesAt: 130,
    });
    expect(String(opened.value.cause)).toBe("evt-12");
    expect(opened.value.succeeds).toBeUndefined();
  }
  // A successor links the closed contest it follows.
  const successor = parseEvent(
    envelope({ ...CONTEST_OPENED, succeeds: "evt-7" }),
  );
  expect(successor.ok).toBe(true);
  if (successor.ok && successor.value.kind === "contest-opened") {
    expect(String(successor.value.succeeds)).toBe("evt-7");
  }
  for (const bad of [
    { entityId: undefined },
    { rival: undefined },
    { place: undefined },
    { cause: undefined },
    { closesAt: undefined },
    { closesAt: -1 },
    { closesAt: 1.5 },
    // A god cannot contest itself.
    { rival: "athena" },
  ]) {
    expect(parseEvent(envelope({ ...CONTEST_OPENED, ...bad })).ok).toBe(false);
  }
});

test("a contest-closed event is decided with a winner and the mortals' favour, or expired with none: a decision changes standing and an expiry never does", () => {
  const decided = parseEvent(envelope(CONTEST_CLOSED));
  expect(decided.ok).toBe(true);
  if (
    decided.ok &&
    decided.value.kind === "contest-closed" &&
    decided.value.result === "decided"
  ) {
    expect(String(decided.value.winner)).toBe("athena");
    expect(decided.value.favoured).toHaveLength(2);
  } else {
    throw new Error("expected a decided contest");
  }
  for (const expired of [
    {
      result: "expired",
      reason: "place-empty",
      winner: undefined,
      favoured: [],
    },
    { result: "expired", reason: "no-favour", winner: undefined, favoured: [] },
  ]) {
    expect(parseEvent(envelope({ ...CONTEST_CLOSED, ...expired })).ok).toBe(
      true,
    );
  }
  for (const bad of [
    // A decision needs a winner of the two gods, and its reason is the window.
    { winner: undefined },
    { winner: "hera" },
    { reason: "place-empty" },
    // An expiry has no winner and no favour to record.
    { result: "expired", reason: "place-empty" },
    { result: "expired", reason: "window", winner: undefined, favoured: [] },
    { result: "settled" },
    { reason: "tired" },
    { contestId: undefined },
    { favoured: "farmer" },
    { favoured: [{ mortal: "farmer" }] },
    { favoured: [{ mortal: "farmer", god: "hera" }] },
  ]) {
    expect(parseEvent(envelope({ ...CONTEST_CLOSED, ...bad })).ok).toBe(false);
  }
});

test("contest events are private to the gods in them, name both gods and the place, and follow what they rest on", () => {
  const opened = parsedEvent(CONTEST_OPENED);
  const closed = parsedEvent(CONTEST_CLOSED);
  for (const kind of ["contest-opened", "contest-closed"]) {
    expect(WORLD_EVENT_KINDS as readonly string[]).toContain(kind);
    expect(UNPLACED_EVENT_KINDS as readonly string[]).toContain(kind);
    expect(WITNESSED_EVENT_KINDS as readonly string[]).not.toContain(kind);
  }
  expect(subjectsOf(opened)).toEqual(["athena", "poseidon", "town-square"]);
  expect(subjectsOf(closed)).toEqual(["athena", "poseidon", "town-square"]);
  expect(String(eventCause(opened))).toBe("evt-12");
  expect(String(eventCause(closed))).toBe("evt-20");
});

test("a refused contest can be the thing a practice-refused event is about", () => {
  expect(
    parseEvent(
      envelope({
        kind: "practice-refused",
        entityId: "athena",
        attempted: "contest",
        reason: "no-progress",
      }),
    ).ok,
  ).toBe(true);
});

// --- Journey events ------------------------------------------------------------------------

test("a journey-started event names the god and its destination, and is private to the god", () => {
  const started = parsedEvent({
    kind: "journey-started",
    entityId: "zeus",
    to: "tavern",
  });
  expect(started.kind).toBe("journey-started");
  expect(WORLD_EVENT_KINDS as readonly string[]).toContain("journey-started");
  expect(UNPLACED_EVENT_KINDS as readonly string[]).toContain(
    "journey-started",
  );
  expect(WITNESSED_EVENT_KINDS as readonly string[]).not.toContain(
    "journey-started",
  );
  expect(subjectsOf(started)).toEqual(["zeus", "tavern"]);
  expect(eventCause(started)).toBeUndefined();
  for (const overrides of [{ to: undefined }, { entityId: undefined }]) {
    expect(
      parseEvent(
        envelope({
          kind: "journey-started",
          entityId: "zeus",
          to: "tavern",
          ...overrides,
        }),
      ).ok,
    ).toBe(false);
  }
});

test("a journey-ended event names how the journey ended: arrived or replaced alone, refused with the world's reason; it follows the journey it ends and is private", () => {
  for (const ending of ["arrived", "replaced"]) {
    const ended = parsedEvent({
      kind: "journey-ended",
      entityId: "zeus",
      journeyEventId: "evt-3",
      ending,
    });
    expect(ended).toMatchObject({ kind: "journey-ended", ending });
    expect(String(eventCause(ended))).toBe("evt-3");
    expect(subjectsOf(ended)).toEqual(["zeus"]);
  }
  const refused = parsedEvent({
    kind: "journey-ended",
    entityId: "zeus",
    journeyEventId: "evt-3",
    ending: "refused",
    reason: "restricted-realm",
  });
  expect(refused).toMatchObject({
    ending: "refused",
    reason: "restricted-realm",
  });
  expect(UNPLACED_EVENT_KINDS as readonly string[]).toContain("journey-ended");
  expect(WITNESSED_EVENT_KINDS as readonly string[]).not.toContain(
    "journey-ended",
  );
  const good = {
    kind: "journey-ended",
    entityId: "zeus",
    journeyEventId: "evt-3",
    ending: "arrived",
  };
  for (const overrides of [
    { ending: "lost" },
    { ending: undefined },
    { journeyEventId: undefined },
    // A refusal says why; no other ending carries a reason.
    { ending: "refused" },
    { ending: "refused", reason: "no-such-reason" },
    { reason: "restricted-realm" },
  ]) {
    expect(parseEvent(envelope({ ...good, ...overrides })).ok).toBe(false);
  }
});

test("a strike on a mortal parses: it took a resource exactly when it took an amount, and is a placed, witnessable event", () => {
  const struck = {
    kind: "mortal-struck",
    entityId: "lykos",
    actor: "poseidon",
  };
  const taken = parseEvent(
    envelope({ ...struck, resource: "food", amount: 2 }),
  );
  expect(taken.ok && taken.value).toMatchObject({
    kind: "mortal-struck",
    resource: "food",
    amount: 2,
  });
  // Struck with nothing to take: no resource, an amount of 0.
  const empty = parseEvent(envelope({ ...struck, amount: 0 }));
  expect(empty.ok).toBe(true);
  if (empty.ok) expect("resource" in empty.value).toBe(false);
  for (const bad of [
    { ...struck, amount: 2 },
    { ...struck, resource: "food", amount: 0 },
    { ...struck, resource: "food", amount: -1 },
    { ...struck, resource: "food", amount: 1.5 },
    { ...struck, resource: 3, amount: 1 },
    { kind: "mortal-struck", entityId: "lykos", resource: "food", amount: 1 },
    { ...struck },
  ]) {
    expect(parseEvent(envelope(bad)).ok).toBe(false);
  }
  expect(WITNESSED_EVENT_KINDS as readonly string[]).toContain("mortal-struck");
  expect(
    eventSubjects(taken.ok ? taken.value : (undefined as never)).map(String),
  ).toEqual(["lykos", "poseidon"]);
});

test("a refused petition parses, is private, and follows the petition it closes; a sign may record it", () => {
  const refused = parseEvent(
    envelope({
      kind: "petition-refused",
      entityId: "poseidon",
      petitioner: "doris",
      petitionId: "evt-4",
    }),
  );
  expect(refused.ok).toBe(true);
  if (refused.ok) {
    expect(eventSubjects(refused.value).map(String)).toEqual([
      "poseidon",
      "doris",
    ]);
    expect(String(eventCause(refused.value))).toBe("evt-4");
  }
  expect(WITNESSED_EVENT_KINDS as readonly string[]).not.toContain(
    "petition-refused",
  );
  for (const missing of ["entityId", "petitioner", "petitionId"]) {
    const raw: Record<string, unknown> = {
      kind: "petition-refused",
      entityId: "poseidon",
      petitioner: "doris",
      petitionId: "evt-4",
    };
    delete raw[missing];
    expect(parseEvent(envelope(raw)).ok).toBe(false);
  }
  const sign = (outcome: string) =>
    parseEvent(
      envelope({
        kind: "memory-recorded",
        memoryKind: "sign",
        entityId: "doris",
        sourceEventId: "evt-5",
        salience: 6,
        subjects: ["poseidon"],
        god: "poseidon",
        outcome,
        petitionId: "evt-4",
        consequence: { effect: "harm", agent: "poseidon", target: "doris" },
      }),
    ).ok;
  expect([sign("refused"), sign("lapsed"), sign("answered")]).toEqual([
    true,
    true,
    true,
  ]);
  expect(sign("ignored")).toBe(false);
});

test("a change of patron parses with the god lost, the god gained, the answered prayer, and the ignored ones; it is private and follows the answer", () => {
  const raw = {
    kind: "patron-changed",
    entityId: "fisher",
    from: "poseidon",
    to: "athena",
    answered: "evt-4",
    unanswered: ["evt-2", "evt-3"],
  };
  const parsed = parseEvent(envelope(raw));
  expect(parsed.ok).toBe(true);
  if (parsed.ok) {
    expect(eventSubjects(parsed.value).map(String)).toEqual([
      "fisher",
      "poseidon",
      "athena",
    ]);
    expect(String(eventCause(parsed.value))).toBe("evt-4");
  }
  // With nothing ignored (a feeling that fell for other reasons) it is still a change.
  expect(parseEvent(envelope({ ...raw, unanswered: [] })).ok).toBe(true);
  expect(WITNESSED_EVENT_KINDS as readonly string[]).not.toContain(
    "patron-changed",
  );
  for (const bad of [
    { ...raw, to: "poseidon" },
    { ...raw, from: undefined },
    { ...raw, to: undefined },
    { ...raw, answered: undefined },
    { ...raw, unanswered: undefined },
    { ...raw, unanswered: [""] },
    { ...raw, unanswered: "evt-2" },
  ]) {
    expect(parseEvent(envelope(bad)).ok).toBe(false);
  }
});

test("a patronage memory names the mortal, its home, and both gods, and blames no one", () => {
  const memory = {
    kind: "memory-recorded",
    memoryKind: "patronage",
    entityId: "poseidon",
    sourceEventId: "evt-5",
    salience: 8,
    subjects: ["fisher", "dock", "athena"],
    mortal: "fisher",
    home: "dock",
    from: "poseidon",
    to: "athena",
  };
  expect(parseEvent(envelope(memory)).ok).toBe(true);
  for (const bad of [
    { ...memory, mortal: undefined },
    { ...memory, home: undefined },
    { ...memory, from: 3 },
    { ...memory, to: undefined },
    { ...memory, salience: 0 },
    { ...memory, consequence: { effect: "harm", agent: "athena" } },
  ]) {
    expect(parseEvent(envelope(bad)).ok).toBe(false);
  }
});
