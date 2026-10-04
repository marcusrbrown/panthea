// A god's one movement action is `travel`: it names any place it can reach and
// the world walks it there (packages/world journey). What the god is shown and
// may answer follows: reachable places in place of exits, its journey while one
// runs, and how its last one ended.

import { expect, test } from "bun:test";
import type { WorldEvent } from "@panthea/contracts";
import {
  createPrng,
  perceive,
  runTick,
  submitProposal,
  toEntityId,
  type WorldState,
} from "@panthea/world";
import {
  buildGodContext,
  DESTINATIONS_HEADING,
  GOD_INTENT_ACTIONS,
  godIntentSchema,
  rememberedBy,
} from "./context";
import { buildModelProposal, snapshotFacts } from "./observation";
import {
  actorAt,
  actorWithCapabilities,
  committedEvent,
  godProfile,
  greekState,
} from "./test-fixtures";

const id = toEntityId;
const zeus = godProfile("zeus");

function viewOf(
  state: WorldState,
  ownEvents: readonly WorldEvent[] = [],
  journeyEnded?: WorldEvent,
) {
  const snapshot = perceive(state, id("zeus"));
  if (!snapshot) throw new Error("zeus perceives nothing");
  const remembered = rememberedBy(
    state,
    id("zeus"),
    ownEvents,
    undefined,
    undefined,
    journeyEnded?.kind === "journey-ended" ? journeyEnded : undefined,
  );
  return {
    snapshot,
    remembered,
    context: buildGodContext(zeus, snapshot, remembered),
    schema: godIntentSchema(zeus, snapshot, remembered),
  };
}

const actions = (schema: { readonly jsonSchema: unknown }) =>
  (
    schema.jsonSchema as {
      properties: Record<string, { enum?: string[] }>;
    }
  ).properties;

/** Zeus at `from`, one tick into a journey to `to`. */
function travelling(to = "great-hall", from = "tavern"): WorldState {
  const submitted = submitProposal({
    schemaVersion: 1,
    actor: "zeus",
    kind: "travel",
    to,
    targets: [],
    expectedRevisions: [],
    source: "model",
    observationId: "obs-travel",
  });
  if (!submitted.ok) throw new Error(submitted.rejection.message);
  return runTick(actorAt(greekState(), "zeus", from), createPrng(1), [
    submitted.proposal,
  ]).state;
}

const atTavern = () => actorAt(greekState(), "zeus", "tavern");

// --- What the god may answer ----------------------------------------------------------

test("a god is offered travel as its one way to move, and no longer move or realm-transition", () => {
  expect(GOD_INTENT_ACTIONS as readonly string[]).toContain("travel");
  expect(GOD_INTENT_ACTIONS as readonly string[]).not.toContain("move");
  expect(GOD_INTENT_ACTIONS as readonly string[]).not.toContain(
    "realm-transition",
  );
  const { schema, snapshot } = viewOf(atTavern());
  const offered = actions(schema).action?.enum ?? [];
  expect(offered).toContain("travel");
  expect(offered).not.toContain("move");
  expect(offered).not.toContain("realm-transition");
  // The destinations are exactly the places the snapshot says a route reaches.
  expect(actions(schema).to?.enum).toEqual(
    snapshot.destinations.map((place) => String(place.id)),
  );
});

test("travel parses for any reachable place, across realms and over many steps, and for none that is not", () => {
  const { schema } = viewOf(atTavern());
  for (const to of ["town-square", "great-hall", "underworld-shore"]) {
    expect(schema.parse({ action: "travel", to }) as unknown).toEqual({
      ok: true,
      value: { action: "travel", to },
    });
  }
  // Where the god already stands, and a place that is not on the map.
  for (const to of ["tavern", "atlantis", undefined]) {
    const refused = schema.parse({ action: "travel", to });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.path).toBe("to");
  }
});

test("move and realm-transition are refused as actions, whatever place they name", () => {
  const { schema } = viewOf(atTavern());
  for (const action of ["move", "realm-transition"]) {
    const refused = schema.parse({ action, to: "town-square" });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.path).toBe("action");
  }
});

test("a place the god lacks the capability for is not offered, and naming it is refused", () => {
  const mortal = actorWithCapabilities(atTavern(), "zeus", []);
  const { schema } = viewOf(mortal);
  const offered = actions(schema).to?.enum ?? [];
  expect(offered).toContain("town-square");
  expect(offered).not.toContain("great-hall");
  expect(offered).not.toContain("olympus-gate");
  expect(schema.parse({ action: "travel", to: "great-hall" }).ok).toBe(false);
});

// --- What the god is shown -------------------------------------------------------------

test("the prompt lists the places the god can travel to with their steps, in place of ways out, and tells it to travel", () => {
  const { context } = viewOf(atTavern());
  expect(context.prompt).not.toContain("Ways out:");
  const line = context.prompt
    .split("\n")
    .find((candidate) => candidate.startsWith(DESTINATIONS_HEADING));
  expect(line).toStartWith(`${DESTINATIONS_HEADING} town-square 1, altar 2, `);
  // Every place the schema offers is in the line, with its steps, farthest last.
  expect(line).toContain(" great-hall 4, ");
  expect(line).toEndWith(" judgment-hall 5.");
  expect(context.instructions).toContain('action "travel"');
  expect(context.instructions).not.toContain('action "move"');
  expect(context.instructions).not.toContain('action "realm-transition"');
});

test("a god on a journey is told where it is going and how far it has left, and that waiting leaves it running", () => {
  const { context, remembered } = viewOf(travelling());
  expect(remembered.journey).toMatchObject({
    destination: "great-hall",
    steps: 3,
  });
  expect(context.prompt).toContain(
    "You are on a journey to Hall of the Gods [great-hall], 3 steps to go. Waiting leaves it running; anything else you do ends it.",
  );
  expect(context.prompt).toContain("You are at Town Square [town-square]");
  // Control: a god with no journey is told of none.
  expect(viewOf(atTavern()).context.prompt).not.toContain("journey");
});

test("how the last journey ended is shown: arriving, a refusal and why, and being replaced; and not while another journey runs", () => {
  const ended = (fields: Record<string, unknown>) =>
    committedEvent({
      kind: "journey-ended",
      entityId: "zeus",
      journeyEventId: "evt-1",
      ...fields,
    });
  const shown = (event: WorldEvent) => viewOf(atTavern(), [], event).context;
  expect(shown(ended({ ending: "arrived" })).prompt).toContain(
    "Your last journey ended: you arrived.",
  );
  const refused = shown(
    ended({ ending: "refused", reason: "restricted-realm" }),
  ).prompt;
  expect(refused).toContain(
    "Your last journey ended early: a step on the way was closed to you (restricted-realm), and the world took you no further.",
  );
  expect(shown(ended({ ending: "replaced" })).prompt).toContain(
    "Your last journey ended when you chose to do something else.",
  );
  // A journey under way is the news; an old ending is not.
  expect(
    viewOf(travelling(), [], ended({ ending: "arrived" })).context.prompt,
  ).not.toContain("Your last journey ended");
  // Once the god has acted since, the ending is old news.
  const arrived = ended({ ending: "arrived" });
  const spoke = committedEvent({
    kind: "legend-recorded",
    entityId: "zeus",
    assertion: "I was there.",
    hearers: [],
  });
  expect(viewOf(atTavern(), [spoke], arrived).context.prompt).not.toContain(
    "Your last journey ended",
  );
  // Control: another god's ending is not told to Zeus.
  expect(
    shown(ended({ ending: "arrived", entityId: "hera" })).prompt,
  ).not.toContain("Your last journey ended");
});

// --- The proposal it becomes ------------------------------------------------------------

test("a travel intent becomes a travel proposal that pins nothing and cites the place it names", () => {
  const { snapshot, remembered, schema } = viewOf(atTavern());
  const parsed = schema.parse({ action: "travel", to: "great-hall" });
  if (!parsed.ok) throw new Error(parsed.message);
  const built = buildModelProposal(
    id("zeus"),
    snapshot,
    parsed.value,
    remembered,
  );
  if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
  expect(built.proposal).toMatchObject({
    kind: "travel",
    to: "great-hall",
    actor: "zeus",
    source: "model",
    targets: [],
    expectedRevisions: [],
  });
  expect(built.observation.factsRead).toContain("location:great-hall");
  // Every fact it cites is one the snapshot holds.
  const facts = snapshotFacts(snapshot, remembered);
  for (const fact of built.observation.factsRead) {
    expect(facts.has(fact)).toBe(true);
  }
  expect(submitProposal(built.proposal).ok).toBe(true);
});

test("the builder refuses a travel intent naming a place the god was not shown", () => {
  const { snapshot, remembered } = viewOf(
    actorWithCapabilities(atTavern(), "zeus", []),
  );
  const forged = { action: "travel", to: "great-hall" } as never;
  const built = buildModelProposal(id("zeus"), snapshot, forged, remembered);
  expect(built.ok).toBe(false);
});
