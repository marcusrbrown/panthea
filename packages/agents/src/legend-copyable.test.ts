// A god that can tell a legend is shown the exact shape to send, the way travel is, and the schema requires the
// assertion a legend needs. Before this, the legend's words had no named field in the prompt and the schema let
// {"action":"legend"} through while the parser refused it: on the 2026-10-07 gate 12 of 84 requests were exhausted
// on that (the model sent the cited event, or put its words in a report's `content`, and no `assertion`).

import { expect, test } from "bun:test";
import {
  createPrng,
  perceive,
  runTick,
  submitProposal,
  toEntityId,
} from "@panthea/world";
import {
  buildGodContext,
  godIntentSchema,
  MAX_ASSERTION_LENGTH,
  rememberedBy,
} from "./context";
import { buildModelProposal } from "./observation";
import {
  actorAt,
  allGodProfiles,
  godProfile,
  greekState,
} from "./test-fixtures";

const id = toEntityId;

const LEGEND_LINE =
  'For a legend: {"action":"legend","assertion":"<what you say, one or two short sentences>"}';
const TRAVEL_LINE =
  'You may also travel to any place you can reach, naming it in "to": {"action":"travel","to":"<place id>"}. The world walks you there, one step a tick.';

const viewOf = (god: string, at = "town-square") => {
  const state = actorAt(greekState(), god, at);
  const snapshot = perceive(state, id(god));
  if (!snapshot) throw new Error(`${god} perceives nothing`);
  const profile = godProfile(god);
  const remembered = rememberedBy(state, id(god));
  return {
    state,
    snapshot,
    remembered,
    profile,
    context: buildGodContext(profile, snapshot, remembered),
    schema: godIntentSchema(profile, snapshot, remembered),
  };
};

const withoutLegend = (god: string) => {
  const profile = godProfile(god);
  return {
    ...profile,
    abilities: profile.abilities.filter((a) => a.action !== "legend"),
  };
};

const hasLegend = (god: string) =>
  godProfile(god).abilities.some((a) => a.action === "legend");

test("a god that can tell a legend is shown its exact shape, on the line after the one that tells it to decide, and a god that cannot is not", () => {
  const { context } = viewOf("athena");
  const lines = context.instructions?.split("\n") ?? [];
  expect(lines).toContain(LEGEND_LINE);
  // The start every god shares: travel's line is no longer in it, so the legend's shape follows the first line.
  expect(
    lines[lines.findIndex((l) => l.startsWith("Decide what you do")) + 1],
  ).toBe(LEGEND_LINE);
  // Shown once, and not as a command: it states a shape, as travel's line does.
  expect(context.instructions?.split(LEGEND_LINE).length).toBe(2);

  // A god with no legend ability is not offered the action, so is not shown the shape.
  const view = viewOf("athena");
  const mute = buildGodContext(
    withoutLegend("athena"),
    view.snapshot,
    view.remembered,
  );
  expect(mute.instructions).not.toContain('{"action":"legend"');
  expect(mute.instructions).toContain(TRAVEL_LINE);
});

test("every god of the cast is shown the legend shape exactly when it has the legend ability", () => {
  for (const profile of allGodProfiles) {
    const { context } = viewOf(String(profile.id));
    expect([
      String(profile.id),
      context.instructions?.includes(LEGEND_LINE) ?? false,
    ]).toEqual([String(profile.id), hasLegend(String(profile.id))]);
  }
  // At least one god can tell a legend, so the test above proves something.
  expect(allGodProfiles.some((p) => hasLegend(String(p.id)))).toBe(true);
});

test("the form copied from the prompt validates: through the parser, the builder, and the world", () => {
  const { state, snapshot, remembered, schema, context } = viewOf("athena");
  const shown = context.instructions
    ?.split("\n")
    .find((line) => line.startsWith("For a legend: "));
  if (shown === undefined) throw new Error("no legend line");
  const copied = JSON.parse(shown.slice("For a legend: ".length)) as Record<
    string,
    unknown
  >;
  expect(Object.keys(copied)).toEqual(["action", "assertion"]);
  // The placeholder is a valid assertion as it stands, and so is a real sentence in its place.
  for (const assertion of [
    copied.assertion,
    "The olive keeps what the war took.",
  ]) {
    const parsed = schema.parse({ ...copied, assertion });
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.value as unknown).toEqual({ action: "legend", assertion });
  }
  expect(String(copied.assertion).length).toBeLessThanOrEqual(
    MAX_ASSERTION_LENGTH,
  );

  const parsed = schema.parse({
    ...copied,
    assertion: "The olive keeps what the war took.",
  });
  if (!parsed.ok) throw new Error(parsed.message);
  const built = buildModelProposal(
    id("athena"),
    snapshot,
    parsed.value,
    remembered,
  );
  if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
  const submitted = submitProposal(built.proposal);
  if (!submitted.ok) throw new Error(submitted.rejection.message);
  // The world accepts it: a legend recorded, nothing rejected.
  const ran = runTick(state, createPrng(1), [submitted.proposal]);
  expect(ran.rejected).toEqual([]);
  expect(ran.events.map((e) => e.kind)).toContain("legend-recorded");
});

test("the schema requires the assertion when the action is a legend, as the parser does", () => {
  const { schema } = viewOf("athena");
  const js = schema.jsonSchema as {
    required: string[];
    allOf?: {
      if?: unknown;
      then?: { required?: string[] };
    }[];
  };
  const legendCondition = js.allOf?.find(
    (condition) =>
      JSON.stringify(condition.if) ===
      JSON.stringify({
        properties: { action: { const: "legend" } },
        required: ["action"],
      }),
  );
  expect(legendCondition?.then?.required).toEqual(["assertion"]);
  // The parser says the same: no assertion, an empty one, or one past the limit is refused.
  for (const bad of [
    { action: "legend" },
    { action: "legend", linkedEventId: "evt-1-1" },
    { action: "legend", assertion: "" },
    { action: "legend", assertion: "x".repeat(MAX_ASSERTION_LENGTH + 1) },
    { action: "legend", content: "Words in the report's field." },
  ]) {
    expect(schema.parse(bad).ok).toBe(false);
  }
  expect(
    schema.parse({
      action: "legend",
      assertion: "x".repeat(MAX_ASSERTION_LENGTH),
    }).ok,
  ).toBe(true);
});

test("a god with no legend ability has no legend condition, no assertion property, and no legend action", () => {
  const view = viewOf("athena");
  const schema = godIntentSchema(
    withoutLegend("athena"),
    view.snapshot,
    view.remembered,
  );
  const js = schema.jsonSchema as {
    properties: Record<string, { enum?: string[] }>;
    allOf?: { if?: { properties?: { action?: { const?: string } } } }[];
  };
  expect(js.properties.assertion).toBeUndefined();
  expect(js.properties.action?.enum).not.toContain("legend");
  expect(
    (js.allOf ?? []).some(
      (condition) => condition.if?.properties?.action?.const === "legend",
    ),
  ).toBe(false);
  // A legend is refused outright, as before.
  expect(schema.parse({ action: "legend", assertion: "No." }).ok).toBe(false);
});
