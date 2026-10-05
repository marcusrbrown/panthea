import { expect, test } from "bun:test";
import type { ContentPack } from "@panthea/contracts";
import {
  crossesRealm,
  findEdge,
  isAdjacent,
  locationsInRealm,
  nextHop,
  outgoingEdges,
  routeLength,
  routeLengths,
} from "./geography";
import { createInitialWorldState, toEntityId } from "./state";

function minimalRules(): ContentPack["rules"] {
  return {
    catchUpCapMs: 3_600_000,
    catchUpChunkMs: 60_000,
    checkpointIntervalMs: 60_000,
    maxProposalsPerTick: 100,
    fireBalance: {},
    economyBalance: {},
  };
}

function pack(locations: ContentPack["locations"]): ContentPack {
  return {
    schemaVersion: 1,
    realms: ["mortal", "olympus", "underworld"],
    resources: [],
    locations,
    buildings: [],
    inhabitants: [],
    rules: minimalRules(),
    recipes: {},
  };
}

test("a declared edge makes two locations adjacent", () => {
  const state = createInitialWorldState(
    pack([
      {
        id: "grove",
        realm: "mortal",
        name: "Grove",
        edges: [{ to: "square", transport: "path", bidirectional: true }],
      },
      { id: "square", realm: "mortal", name: "Square", edges: [] },
    ]),
  );
  expect(isAdjacent(state, toEntityId("grove"), toEntityId("square"))).toBe(
    true,
  );
});

test("a bidirectional edge is traversable from either endpoint without being declared twice", () => {
  const state = createInitialWorldState(
    pack([
      {
        id: "grove",
        realm: "mortal",
        name: "Grove",
        edges: [{ to: "square", transport: "path", bidirectional: true }],
      },
      { id: "square", realm: "mortal", name: "Square", edges: [] },
    ]),
  );
  expect(isAdjacent(state, toEntityId("square"), toEntityId("grove"))).toBe(
    true,
  );
  expect(
    findEdge(state, toEntityId("square"), toEntityId("grove")),
  ).toMatchObject({ to: "grove" });
});

test("a one-way edge is not traversable in reverse", () => {
  const state = createInitialWorldState(
    pack([
      {
        id: "ferry-dock",
        realm: "mortal",
        name: "Ferry Dock",
        edges: [
          {
            to: "underworld-shore",
            transport: "divine-transport",
            bidirectional: false,
          },
        ],
      },
      {
        id: "underworld-shore",
        realm: "underworld",
        name: "Underworld Shore",
        edges: [],
      },
    ]),
  );
  expect(
    isAdjacent(state, toEntityId("ferry-dock"), toEntityId("underworld-shore")),
  ).toBe(true);
  expect(
    isAdjacent(state, toEntityId("underworld-shore"), toEntityId("ferry-dock")),
  ).toBe(false);
});

test("unrelated locations are not adjacent", () => {
  const state = createInitialWorldState(
    pack([
      { id: "a", realm: "mortal", name: "A", edges: [] },
      { id: "b", realm: "mortal", name: "B", edges: [] },
    ]),
  );
  expect(isAdjacent(state, toEntityId("a"), toEntityId("b"))).toBe(false);
});

test("crossesRealm reports true only when the two locations declare different realms", () => {
  const state = createInitialWorldState(
    pack([
      {
        id: "mountain-path",
        realm: "mortal",
        name: "Mountain Path",
        edges: [
          {
            to: "olympus-gate",
            transport: "divine-transport",
            bidirectional: true,
          },
        ],
      },
      { id: "olympus-gate", realm: "olympus", name: "Olympus Gate", edges: [] },
      { id: "town-square", realm: "mortal", name: "Town Square", edges: [] },
    ]),
  );
  expect(
    crossesRealm(
      state,
      toEntityId("mountain-path"),
      toEntityId("olympus-gate"),
    ),
  ).toBe(true);
  expect(
    crossesRealm(state, toEntityId("mountain-path"), toEntityId("town-square")),
  ).toBe(false);
});

test("locationsInRealm returns only locations in that realm", () => {
  const state = createInitialWorldState(
    pack([
      { id: "a", realm: "mortal", name: "A", edges: [] },
      { id: "b", realm: "olympus", name: "B", edges: [] },
      { id: "c", realm: "mortal", name: "C", edges: [] },
    ]),
  );
  expect(
    locationsInRealm(state, "mortal")
      .map((loc) => String(loc.id))
      .sort(),
  ).toEqual(["a", "c"]);
});

test("outgoingEdges includes both declared and synthesized reverse edges", () => {
  const state = createInitialWorldState(
    pack([
      {
        id: "square",
        realm: "mortal",
        name: "Square",
        edges: [
          { to: "tavern", transport: "path", bidirectional: true },
          { to: "shop", transport: "path", bidirectional: true },
        ],
      },
      { id: "tavern", realm: "mortal", name: "Tavern", edges: [] },
      { id: "shop", realm: "mortal", name: "Shop", edges: [] },
    ]),
  );
  const edges = outgoingEdges(state, toEntityId("tavern"));
  expect(edges).toHaveLength(1);
  expect(edges[0]).toMatchObject({ to: "square" });
});

// --- Next hop --------------------------------------------------------------------------------

function hallMap() {
  return createInitialWorldState(
    pack([
      { id: "hall", realm: "olympus", name: "Hall", edges: [] },
      {
        id: "gate",
        realm: "olympus",
        name: "Gate",
        requiredCapability: "divine",
        edges: [
          { to: "hall", transport: "path", bidirectional: true },
          { to: "pass", transport: "divine-transport", bidirectional: true },
        ],
      },
      {
        id: "pass",
        realm: "mortal",
        name: "Pass",
        edges: [{ to: "square", transport: "path", bidirectional: true }],
      },
      {
        id: "square",
        realm: "mortal",
        name: "Square",
        edges: [{ to: "tavern", transport: "path", bidirectional: true }],
      },
      { id: "tavern", realm: "mortal", name: "Tavern", edges: [] },
      { id: "island", realm: "mortal", name: "Island", edges: [] },
    ]),
  );
}

const here = toEntityId;

test("the next hop is the first exit on a shortest route, through realms and over declared and reverse edges", () => {
  const state = hallMap();
  const divine = ["divine"];
  expect(nextHop(state, here("hall"), here("square"), divine)).toBe(
    here("gate"),
  );
  expect(nextHop(state, here("gate"), here("square"), divine)).toBe(
    here("pass"),
  );
  expect(nextHop(state, here("pass"), here("tavern"), divine)).toBe(
    here("square"),
  );
  // Back the other way, over the reverse of declared edges.
  expect(nextHop(state, here("tavern"), here("hall"), divine)).toBe(
    here("square"),
  );
  // Adjacent: the hop is the place itself.
  expect(nextHop(state, here("square"), here("tavern"), divine)).toBe(
    here("tavern"),
  );
});

test("a place already here, an unreachable place, and an unknown place have no hop", () => {
  const state = hallMap();
  expect(
    nextHop(state, here("hall"), here("hall"), ["divine"]),
  ).toBeUndefined();
  expect(
    nextHop(state, here("hall"), here("island"), ["divine"]),
  ).toBeUndefined();
  expect(
    nextHop(state, here("hall"), here("nowhere"), ["divine"]),
  ).toBeUndefined();
  expect(
    nextHop(state, here("nowhere"), here("hall"), ["divine"]),
  ).toBeUndefined();
});

test("a route through a place needing a capability the traveler lacks is not a route, and the same journey with it is", () => {
  const state = hallMap();
  expect(nextHop(state, here("square"), here("hall"), [])).toBeUndefined();
  expect(nextHop(state, here("square"), here("hall"), ["divine"])).toBe(
    here("pass"),
  );
  // A mortal can still walk everywhere that does not need it.
  expect(nextHop(state, here("pass"), here("tavern"), [])).toBe(here("square"));
});

test("a route's length counts moves: zero when already there, one per hop, and none when there is no route", () => {
  const state = hallMap();
  const divine = ["divine"];
  expect(routeLength(state, here("hall"), here("hall"), divine)).toBe(0);
  expect(routeLength(state, here("hall"), here("gate"), divine)).toBe(1);
  expect(routeLength(state, here("hall"), here("tavern"), divine)).toBe(4);
  expect(
    routeLength(state, here("hall"), here("island"), divine),
  ).toBeUndefined();
  expect(routeLength(state, here("tavern"), here("hall"), [])).toBeUndefined();
});

test("routeLengths gives the steps to every place a route reaches, and none the traveler may not enter or cannot reach", () => {
  const state = hallMap();
  expect(
    [...routeLengths(state, here("hall"), ["divine"])].map(([place, steps]) => [
      String(place),
      steps,
    ]),
  ).toEqual([
    ["gate", 1],
    ["pass", 2],
    ["square", 3],
    ["tavern", 4],
  ]);
  // Without the capability the gate is closed, and the hall has no other way out.
  expect(routeLengths(state, here("hall"), []).size).toBe(0);
  expect(
    [...routeLengths(state, here("square"), [])].map(([place, steps]) => [
      String(place),
      steps,
    ]),
  ).toEqual([
    ["tavern", 1],
    ["pass", 1],
  ]);
  // It agrees with routeLength everywhere.
  for (const place of ["gate", "pass", "square", "tavern", "island", "hall"]) {
    expect(routeLengths(state, here("hall"), ["divine"]).get(here(place))).toBe(
      place === "hall"
        ? undefined
        : routeLength(state, here("hall"), here(place), ["divine"]),
    );
  }
});
