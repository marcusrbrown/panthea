import { expect, test } from "bun:test";
import type { ContentPack, WorldEvent } from "@panthea/contracts";
import {
  MAX_PERCEIVED_EVENTS,
  perceive,
  perceivedLocations,
} from "./perception";
import {
  createInitialWorldState,
  getActor,
  getBuilding,
  toEntityId,
  type WorldState,
  withActor,
  withBuilding,
} from "./state";

function fixtureState(): WorldState {
  const pack: ContentPack = {
    schemaVersion: 1,
    realms: ["mortal", "olympus", "underworld"],
    resources: [],
    locations: [
      {
        id: "tavern",
        realm: "mortal",
        name: "The Tavern",
        edges: [{ to: "square", transport: "path", bidirectional: true }],
      },
      {
        id: "square",
        realm: "mortal",
        name: "The Square",
        edges: [
          {
            to: "olympus-gate",
            transport: "divine-transport",
            bidirectional: true,
          },
        ],
      },
      { id: "olympus-gate", realm: "olympus", name: "Olympus Gate", edges: [] },
    ],
    buildings: [
      {
        id: "the-tavern",
        locationId: "tavern",
        name: "The Tavern House",
        material: "wood",
        combustible: true,
        services: ["drink"],
        inventory: [],
      },
      {
        id: "old-oak",
        locationId: "square",
        name: "The Old Oak",
        material: "wood",
        combustible: true,
        services: [],
        inventory: [],
      },
    ],
    inhabitants: [
      {
        id: "zeus",
        sprite: "placeholder-zeus",
        name: "Zeus",
        locationId: "tavern",
        deity: true,
        startingInventory: [{ resource: "divinity", amount: 10 }],
      },
      {
        id: "farmer",
        sprite: "placeholder-farmer",
        name: "The Farmer",
        locationId: "tavern",
        startingInventory: [{ resource: "currency", amount: 7 }],
      },
      {
        id: "woodcutter",
        sprite: "placeholder-woodcutter",
        name: "The Woodcutter",
        locationId: "square",
        startingInventory: [{ resource: "currency", amount: 3 }],
      },
    ],
    rules: {
      catchUpCapMs: 3_600_000,
      catchUpChunkMs: 60_000,
      checkpointIntervalMs: 60_000,
      maxProposalsPerTick: 100,
      fireBalance: {},
      economyBalance: {},
    },
    recipes: {},
  };
  return createInitialWorldState(pack);
}

const id = toEntityId;

let nextSequence = 1;

/** A committed event with a fixed envelope; `sequence` defaults to the next unused number. */
function event(
  payload: Record<string, unknown>,
  sequence = nextSequence++,
): WorldEvent {
  return {
    schemaVersion: 1,
    id: `evt-${sequence}`,
    sequence,
    simTime: sequence * 1000,
    correlationId: `obs-${sequence}`,
    causationId: `obs-${sequence}`,
    tick: 1,
    approximate: false,
    ...payload,
  } as unknown as WorldEvent;
}

const ignited = (building: string, sequence?: number) =>
  event({ kind: "building-ignited", entityId: building }, sequence);
const gathered = (actor: string, sequence?: number) =>
  event(
    { kind: "resource-gathered", entityId: actor, resource: "wood", amount: 2 },
    sequence,
  );
const moved = (actor: string, to: string, sequence?: number) =>
  event({ kind: "entity-moved", entityId: actor, to }, sequence);

function actorAt(
  state: WorldState,
  actorId: string,
  locationId: string,
): WorldState {
  const actor = getActor(state, id(actorId));
  if (!actor) throw new Error(`fixture has no ${actorId}`);
  return withActor(state, { ...actor, locationId: id(locationId) });
}

function ownedBy(
  state: WorldState,
  buildingId: string,
  owner: string,
): WorldState {
  const building = getBuilding(state, id(buildingId));
  if (!building) throw new Error(`fixture has no ${buildingId}`);
  return withBuilding(state, { ...building, owner: id(owner) });
}

const income = (owner: string, building: string, sequence?: number) =>
  event(
    {
      kind: "income-earned",
      entityId: owner,
      buildingId: building,
      amount: 1,
    },
    sequence,
  );

const ids = (items: readonly { readonly id: string }[]) =>
  items.map((item) => item.id).sort();

test("Zeus at the tavern perceives its location, the actors and buildings there with revisions, and his own goods", () => {
  const snapshot = perceive(fixtureState(), id("zeus"));
  expect(snapshot).toBeDefined();
  if (!snapshot) return;

  expect(snapshot.observer).toBe(id("zeus"));
  expect(snapshot.location as unknown).toEqual({
    id: "tavern",
    name: "The Tavern",
    realm: "mortal",
    revision: 0,
  });
  expect(ids(snapshot.actors)).toEqual(["farmer"]);
  expect(snapshot.actors[0]).toMatchObject({
    id: "farmer",
    locationId: "tavern",
    revision: 0,
  });
  expect(ids(snapshot.buildings)).toEqual(["the-tavern"]);
  expect(snapshot.buildings[0]).toMatchObject({
    id: "the-tavern",
    status: "operational",
    revision: 0,
  });
  expect(snapshot.self).toMatchObject({
    id: "zeus",
    revision: 0,
    divinity: 10,
    inventory: [{ resource: "divinity", amount: 10 }],
  });
  expect(snapshot.exits as unknown).toEqual([
    { to: "square", name: "The Square", realm: "mortal", transport: "path" },
  ]);
});

test("an actor, building, and events at another location are absent; moving Zeus there makes them present", () => {
  const events = [
    ignited("old-oak"),
    gathered("woodcutter"),
    ignited("the-tavern"),
  ];

  const atTavern = perceive(fixtureState(), id("zeus"), events);
  expect(atTavern).toBeDefined();
  if (!atTavern) return;
  expect(ids(atTavern.actors)).not.toContain("woodcutter");
  expect(ids(atTavern.buildings)).not.toContain("old-oak");
  expect(atTavern.events.map((e) => e.kind)).toEqual(["building-ignited"]);
  expect(JSON.stringify(atTavern.events)).toContain("the-tavern");
  expect(JSON.stringify(atTavern)).not.toContain("old-oak");
  expect(JSON.stringify(atTavern)).not.toContain("woodcutter");

  const atSquare = perceive(
    actorAt(fixtureState(), "zeus", "square"),
    id("zeus"),
    events,
  );
  expect(atSquare).toBeDefined();
  if (!atSquare) return;
  expect(ids(atSquare.actors)).toEqual(["woodcutter"]);
  expect(ids(atSquare.buildings)).toEqual(["old-oak"]);
  expect(atSquare.events.map((e) => e.kind).sort()).toEqual([
    "building-ignited",
    "resource-gathered",
  ]);
  expect(ids(atSquare.actors)).not.toContain("farmer");
  expect(JSON.stringify(atSquare)).not.toContain("the-tavern");
});

test("other actors are seen by id and revision only: their inventories stay unseen", () => {
  const snapshot = perceive(fixtureState(), id("zeus"));
  if (!snapshot) throw new Error("expected a snapshot");
  expect(Object.keys(snapshot.actors[0]).sort()).toEqual([
    "id",
    "isDeity",
    "locationId",
    "revision",
  ]);
  expect(JSON.stringify(snapshot.actors)).not.toContain("currency");
});

test("an actor's event is placed where the actor was when it happened, not where it is now", () => {
  // The farmer gathered at the square, then walked to the tavern. Zeus at the
  // tavern sees the arrival but not the earlier gather.
  const afterWalk = actorAt(fixtureState(), "farmer", "tavern");
  const events = [gathered("farmer", 10), moved("farmer", "tavern", 11)];
  const seen = perceive(afterWalk, id("zeus"), events);
  expect(seen?.events.map((e) => e.kind)).toEqual(["entity-moved"]);

  // The farmer arrived at the tavern, gathered, then left for the square:
  // the gather happened in front of Zeus.
  const afterLeaving = actorAt(fixtureState(), "farmer", "square");
  const arrivedThenLeft = [
    moved("farmer", "tavern", 20),
    gathered("farmer", 21),
    moved("farmer", "square", 22),
  ];
  const witnessed = perceive(afterLeaving, id("zeus"), arrivedThenLeft);
  expect(witnessed?.events.map((e) => e.sequence)).toEqual([20, 21]);
});

test("the snapshot keeps only the most recent perceived events, oldest first", () => {
  const many = Array.from({ length: MAX_PERCEIVED_EVENTS + 3 }, (_, index) =>
    ignited("the-tavern", 100 + index),
  );
  const snapshot = perceive(fixtureState(), id("zeus"), many);
  expect(snapshot?.events).toHaveLength(MAX_PERCEIVED_EVENTS);
  expect(snapshot?.events[0]?.sequence).toBe(103);
  expect(snapshot?.events.at(-1)?.sequence).toBe(
    100 + MAX_PERCEIVED_EVENTS + 2,
  );
});

test("a dead or unknown observer perceives nothing, and dead neighbors are not listed", () => {
  const state = fixtureState();
  expect(perceive(state, id("nobody"))).toBeUndefined();

  const farmer = getActor(state, id("farmer"));
  if (!farmer) throw new Error("fixture has no farmer");
  const withDeadFarmer = withActor(state, { ...farmer, alive: false });
  expect(perceive(withDeadFarmer, id("farmer"))).toBeUndefined();
  expect(ids(perceive(withDeadFarmer, id("zeus"))?.actors ?? [])).toEqual([]);
});

test("perceive is a pure function of state and events", () => {
  const state = fixtureState();
  const events = [ignited("the-tavern")];
  const before = JSON.stringify(perceive(state, id("zeus"), events));
  expect(JSON.stringify(perceive(state, id("zeus"), events))).toBe(before);
  expect(state.tick).toBe(0);
  expect(getActor(state, id("zeus"))?.locationId).toBe(id("tavern"));
});

test("the locations an actor perceives are its own location alone until a sensing power widens them", () => {
  const state = fixtureState();
  const zeus = getActor(state, id("zeus"));
  if (!zeus) throw new Error("fixture has no zeus");
  expect([...perceivedLocations(state, zeus)]).toEqual([id("tavern")]);
});

test("a perceived event exposes only its id, kind, sequence, and subjects, never the raw payload", () => {
  const snapshot = perceive(fixtureState(), id("zeus"), [
    gathered("farmer", 30),
  ]);
  const [seen] = snapshot?.events ?? [];
  expect(seen as unknown).toEqual({
    id: "evt-30",
    kind: "resource-gathered",
    sequence: 30,
    subjects: ["farmer"],
  });
  expect(JSON.stringify(seen)).not.toContain("wood");
});

test("an income event at a perceived building does not name an owner who is elsewhere; positive control: co-located, it does", () => {
  const events = [income("woodcutter", "the-tavern", 40)];

  // The woodcutter owns the tavern house but stands in the square.
  const remoteOwner = ownedBy(fixtureState(), "the-tavern", "woodcutter");
  const apart = perceive(remoteOwner, id("zeus"), events);
  expect(apart?.events).toHaveLength(1);
  expect(apart?.events[0]?.subjects).toEqual([id("the-tavern")]);
  expect(apart?.buildings[0]?.owner).toBeUndefined();
  expect(JSON.stringify(apart)).not.toContain("woodcutter");

  // Positive control: the same event with the owner standing in the tavern.
  const together = perceive(
    actorAt(remoteOwner, "woodcutter", "tavern"),
    id("zeus"),
    events,
  );
  expect(together?.events[0]?.subjects).toEqual([
    id("woodcutter"),
    id("the-tavern"),
  ]);
  expect(together?.buildings[0]?.owner).toBe(id("woodcutter"));
});

test("the observer itself, the location, and exits stay named as event subjects", () => {
  // Zeus gathers, then moves in from the square.
  const events = [
    gathered("zeus", 50),
    moved("farmer", "tavern", 51),
    event({ kind: "worship-performed", entityId: "farmer", deity: "zeus" }, 52),
  ];
  const seen = perceive(fixtureState(), id("zeus"), events)?.events ?? [];
  expect(seen.map((e) => e.subjects)).toEqual([
    [id("zeus")],
    [id("farmer"), id("tavern")],
    [id("farmer"), id("zeus")],
  ]);
});

test("a legend keeps its assertion but drops a linked event the observer did not perceive", () => {
  const events = [
    event(
      {
        kind: "legend-recorded",
        entityId: "farmer",
        assertion: "The oak burned.",
        linkedEventId: "evt-999",
      },
      60,
    ),
  ];
  const [seen] = perceive(fixtureState(), id("zeus"), events)?.events ?? [];
  expect(seen as unknown).toEqual({
    id: "evt-60",
    kind: "legend-recorded",
    sequence: 60,
    subjects: ["farmer"],
    assertion: "The oak burned.",
  });
});

test("a realm transition is perceived at its destination and not from outside", () => {
  const events = [
    event(
      {
        kind: "realm-transitioned",
        entityId: "farmer",
        to: "olympus-gate",
        via: "square",
      },
      70,
    ),
  ];
  // The farmer has arrived at the gate; Zeus is there too.
  const arrived = actorAt(
    actorAt(fixtureState(), "farmer", "olympus-gate"),
    "zeus",
    "olympus-gate",
  );
  const destination = perceive(arrived, id("zeus"), events);
  expect(destination?.events.map((e) => e.kind)).toEqual([
    "realm-transitioned",
  ]);
  // The origin square is an exit of the gate, so it may be named.
  expect(destination?.events[0]?.subjects).toEqual([
    id("farmer"),
    id("olympus-gate"),
    id("square"),
  ]);

  // Zeus stays in the tavern: he perceives nothing of it.
  const outside = perceive(
    actorAt(fixtureState(), "farmer", "olympus-gate"),
    id("zeus"),
    events,
  );
  expect(outside?.events).toEqual([]);
  // The gate is a place Zeus could travel to, so the snapshot may name it as one; nothing of the crossing is in what he perceived.
  expect(JSON.stringify(outside?.events)).not.toContain("olympus-gate");
});

test("the cap keeps the newest perceived events: remote events never crowd out older local ones", () => {
  const local = Array.from({ length: 5 }, (_, index) =>
    ignited("the-tavern", 100 + index),
  );
  const remote = Array.from({ length: MAX_PERCEIVED_EVENTS + 2 }, (_, index) =>
    ignited("old-oak", 200 + index),
  );
  // Unsorted on purpose: the window order is the caller's.
  const snapshot = perceive(fixtureState(), id("zeus"), [...remote, ...local]);
  expect(snapshot?.events.map((e) => e.sequence)).toEqual([
    100, 101, 102, 103, 104,
  ]);
});

test("the snapshot carries the observer's capabilities and each exit's required capability", () => {
  // A deity starts with `divine`; a mortal with nothing.
  expect(perceive(fixtureState(), id("zeus"))?.self.capabilities).toEqual([
    "divine",
  ]);
  expect(perceive(fixtureState(), id("farmer"))?.self.capabilities).toEqual([]);

  // The square's exit to the gate is a restricted place in this fixture.
  const state = fixtureState();
  const gate = state.locations.get(id("olympus-gate"));
  if (!gate) throw new Error("fixture has no gate");
  const locations = new Map(state.locations).set(id("olympus-gate"), {
    ...gate,
    requiredCapability: "divine",
  });
  const restricted = { ...actorAt(state, "zeus", "square"), locations };
  const seen = perceive(restricted, id("zeus"));
  expect(seen?.exits.find((e) => e.to === id("olympus-gate"))).toMatchObject({
    requiredCapability: "divine",
  });
  expect(seen?.exits.find((e) => e.to === id("tavern"))).not.toHaveProperty(
    "requiredCapability",
  );
});

// --- Presence: an event is perceived only if the observer was there when it happened ---------

test("a private event in the tavern before Zeus arrives is not perceived; his own arrival is", () => {
  // Zeus stood in the square, the farmer gathered in the tavern, then Zeus walked in.
  const events = [gathered("farmer", 200), moved("zeus", "tavern", 201)];
  const snapshot = perceive(fixtureState(), id("zeus"), events);
  expect(snapshot?.events.map((e) => e.sequence)).toEqual([201]);
  expect(JSON.stringify(snapshot?.events)).not.toContain("evt-200");
});

test("positive control: Zeus already in the tavern when the farmer gathers perceives it", () => {
  // Zeus arrived first (sequence 210), then the farmer gathered (211).
  const events = [moved("zeus", "tavern", 210), gathered("farmer", 211)];
  const snapshot = perceive(fixtureState(), id("zeus"), events);
  expect(snapshot?.events.map((e) => e.sequence)).toEqual([210, 211]);
});

test("with no moves by the observer in the window, it was here throughout and perceives what happened here", () => {
  const events = [gathered("farmer", 220), ignited("the-tavern", 221)];
  expect(
    perceive(fixtureState(), id("zeus"), events)?.events.map((e) => e.sequence),
  ).toEqual([220, 221]);
});

test("a building event in the tavern before Zeus arrives is not perceived either", () => {
  const events = [ignited("the-tavern", 230), moved("zeus", "tavern", 231)];
  expect(
    perceive(fixtureState(), id("zeus"), events)?.events.map((e) => e.sequence),
  ).toEqual([231]);
});

test("when the window cannot say where the observer was, the event is dropped", () => {
  // The window holds only Zeus's arrival, never where he came from, so
  // nothing before it can be placed against him.
  const events = [ignited("the-tavern", 240), moved("zeus", "tavern", 241)];
  const seen = perceive(fixtureState(), id("zeus"), events)?.events ?? [];
  expect(seen.map((e) => e.sequence)).toEqual([241]);
});

test("Zeus left and came back: what happened while he was away is missed; before his first move the window cannot place him, so that is dropped too", () => {
  const events = [
    gathered("farmer", 250), // before any move of his in the window: unplaceable
    moved("zeus", "square", 251),
    gathered("farmer", 252), // Zeus in the square: missed
    moved("zeus", "tavern", 253),
    gathered("farmer", 254), // back in the tavern
  ];
  expect(
    perceive(fixtureState(), id("zeus"), events)?.events.map((e) => e.sequence),
  ).toEqual([253, 254]);
});

test("an event witnessed at a place Zeus has since left is not in the snapshot: the snapshot is what he perceives where he stands now", () => {
  // Zeus gathered-with-the-farmer in the tavern (260), then went to the square.
  // He was present, but the snapshot's "recent events here", subjects and exits
  // all describe his current place, so the old event would appear with its
  // subjects stripped. It belongs to a memory of the tavern, not to this view.
  const events = [gathered("farmer", 260), moved("zeus", "square", 261)];
  const inSquare = actorAt(fixtureState(), "zeus", "square");
  const snapshot = perceive(inSquare, id("zeus"), events);
  expect(snapshot?.events.map((e) => e.sequence)).toEqual([261]);
});

test("reports, memories, and feelings are private: no snapshot carries them, even one taken at the place they were made", () => {
  const events = [
    ignited("the-tavern"),
    event({
      kind: "report-told",
      entityId: "farmer",
      listenerId: "zeus",
      content: "a private word",
    }),
    event({
      kind: "memory-recorded",
      memoryKind: "told",
      entityId: "zeus",
      sourceEventId: "evt-2",
      teller: "farmer",
      content: "a private word",
      subjects: ["farmer"],
      salience: 4,
    }),
    event({
      kind: "relationship-changed",
      entityId: "zeus",
      toward: "farmer",
      affinityDelta: 1,
      grudgeDelta: 0,
      memoryEventId: "evt-3",
    }),
  ];
  const snapshot = perceive(fixtureState(), id("zeus"), events);
  // The ignition beside them is seen; nothing of the three is.
  expect(snapshot?.events.map((e) => e.kind)).toEqual(["building-ignited"]);
  expect(JSON.stringify(snapshot)).not.toContain("a private word");
});

test("a god's goal is its own: no snapshot carries a goal-set or goal-ended event, even one taken at the god's own place", () => {
  const events = [
    ignited("the-tavern"),
    event({
      kind: "goal-set",
      entityId: "zeus",
      text: "Win the farmer's devotion.",
      target: "farmer",
    }),
    event({
      kind: "goal-ended",
      entityId: "zeus",
      outcome: "abandoned",
      goalEventId: "evt-2",
    }),
  ];
  for (const observer of ["zeus", "farmer"]) {
    const snapshot = perceive(fixtureState(), id(observer), events);
    expect(snapshot?.events.map((e) => e.kind)).toEqual(["building-ignited"]);
    expect(JSON.stringify(snapshot)).not.toContain("devotion");
  }
});

// --- A blessing stays where it was given ---------------------------------------------------------

const blessed = (recipient: string, sequence?: number) =>
  event(
    {
      kind: "blessing-granted",
      entityId: "zeus",
      recipient,
      petitionId: "evt-1",
      resource: "currency",
      amount: 1,
    },
    sequence,
  );

test("a blessing is placed where the blessed one stood when it was given: an observer at the place the recipient walked to later does not see it", () => {
  // The farmer was at the tavern, was blessed there, then walked to the square. The woodcutter, at the square, sees the farmer
  // arrive; the blessing happened in the tavern and he was not there.
  const afterWalk = actorAt(fixtureState(), "farmer", "square");
  const events = [
    moved("farmer", "tavern", 300),
    blessed("farmer", 301),
    moved("farmer", "square", 302),
  ];
  const seen = perceive(afterWalk, id("woodcutter"), events);
  expect(seen?.events.map((e) => e.sequence)).toEqual([302]);
  expect(seen?.events.map((e) => e.kind)).not.toContain("blessing-granted");
});

test("positive control: an observer who was at the place when it was given still sees the blessing there, after the recipient has left", () => {
  // Zeus stood in the tavern throughout; the farmer arrived, was blessed in front of him, and left.
  const afterWalk = actorAt(fixtureState(), "farmer", "square");
  const events = [
    moved("farmer", "tavern", 310),
    blessed("farmer", 311),
    moved("farmer", "square", 312),
  ];
  const seen = perceive(afterWalk, id("zeus"), events);
  expect(seen?.events.map((e) => [e.sequence, e.kind])).toEqual([
    [310, "entity-moved"],
    [311, "blessing-granted"],
  ]);
});

test("a blessing of one who has not moved within the window is placed where the recipient stands, like any actor's event", () => {
  const events = [blessed("farmer", 320)];
  expect(
    perceive(fixtureState(), id("zeus"), events)?.events.map((e) => e.sequence),
  ).toEqual([320]);
  expect(
    perceive(fixtureState(), id("woodcutter"), events)?.events ?? [],
  ).toEqual([]);
});

test("when the window cannot say where the recipient was, the blessing is visible to no one: not where the recipient is now, not where it may have been", () => {
  // The window holds the farmer's later move to the square but never where he came from.
  const afterWalk = actorAt(fixtureState(), "farmer", "square");
  const events = [blessed("farmer", 330), moved("farmer", "square", 331)];
  for (const observer of ["zeus", "woodcutter", "farmer"]) {
    const seen = perceive(afterWalk, id(observer), events)?.events ?? [];
    expect(seen.map((e) => e.kind)).not.toContain("blessing-granted");
  }
  // The woodcutter, who is at the square the farmer walked to, still sees him arrive.
  expect(
    perceive(afterWalk, id("woodcutter"), events)?.events.map(
      (e) => e.sequence,
    ),
  ).toEqual([331]);
});

test("a blessing is still seen by the recipient itself at the place it was given, and by a god standing there", () => {
  const events = [blessed("farmer", 340)];
  const farmer = perceive(fixtureState(), id("farmer"), events);
  expect(farmer?.events.map((e) => e.sequence)).toEqual([340]);
});

// --- Destinations ----------------------------------------------------------------------------------

test("a snapshot lists every place the observer could travel to, nearest first, each with its steps, and never where it stands", () => {
  const snapshot = perceive(fixtureState(), id("zeus"));
  expect(
    snapshot?.destinations.map((place) => [
      String(place.id),
      place.name,
      place.realm,
      place.steps,
    ]),
  ).toEqual([
    ["square", "The Square", "mortal", 1],
    ["olympus-gate", "Olympus Gate", "olympus", 2],
  ]);
  const atGate = perceive(
    actorAt(fixtureState(), "zeus", "olympus-gate"),
    id("zeus"),
  );
  expect(atGate?.destinations.map((place) => String(place.id))).toEqual([
    "square",
    "tavern",
  ]);
});

test("a place the observer lacks the capability for is not a destination", () => {
  const state = fixtureState();
  const gate = state.locations.get(id("olympus-gate"));
  if (!gate) throw new Error("no gate");
  const gated: WorldState = {
    ...state,
    locations: new Map(state.locations).set(id("olympus-gate"), {
      ...gate,
      requiredCapability: "divine",
    }),
  };
  const farmer = perceive(gated, id("farmer"));
  expect(farmer?.destinations.map((place) => String(place.id))).toEqual([
    "square",
  ]);
  const zeus = perceive(gated, id("zeus"));
  expect(zeus?.destinations.map((place) => String(place.id))).toEqual([
    "square",
    "olympus-gate",
  ]);
});
