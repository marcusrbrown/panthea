// A god that can report is shown the exact shape to send, the way travel and a legend are, and the schema requires the
// listener and content a report needs. On the 2026-10-07T02-58-12 gate Hermes lost two requests sending
// {"action":"report","to":"<place>","content":…}: `to` is travel's field, and the listener had no named place in the
// prompt. The same fault the legend had, in the next field over.

import { expect, test } from "bun:test";
import { MAX_REPORT_LENGTH } from "@panthea/contracts";
import {
  createPrng,
  perceive,
  runTick,
  submitProposal,
  toEntityId,
} from "@panthea/world";
import { buildGodContext, godIntentSchema, rememberedBy } from "./context";
import { buildModelProposal } from "./observation";
import { actorAt, godProfile, greekState } from "./test-fixtures";

const id = toEntityId;

const REPORT_LINE =
  'For a report: {"action":"report","listener":"<who is here>","content":"<what you tell, one or two short sentences>"}';
const LEGEND_LINE =
  'For a legend: {"action":"legend","assertion":"<what you say, one or two short sentences>"}';
const TRAVEL_LINE =
  'You may also travel to any place you can reach, naming it in "to": {"action":"travel","to":"<place id>"}. The world walks you there, one step a tick.';

/** `god` standing at `at`; `alone` moves every other actor out of the scene. */
function viewOf(god: string, at: string, alone = false) {
  let state = actorAt(greekState(), god, at);
  if (alone) {
    for (const actor of state.actors.values()) {
      if (actor.id !== id(god) && actor.locationId === id(at)) {
        state = {
          ...state,
          actors: new Map(state.actors).set(actor.id, {
            ...actor,
            locationId: id("wilderness-grove"),
          }),
        };
      }
    }
  }
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
}

const REPORT_GUIDANCE =
  'You may also tell someone here something (action "report", naming the listener, your words, and optionally a claim of who harmed or did a kindness to whom, and an event you saw). It is your own account, told as you choose.';

test("a god with someone to tell is shown the report's exact shape, on the line after the report's description, and a god with no one here is not", () => {
  const { context, snapshot } = viewOf("athena", "ancient-olive-tree");
  expect(snapshot.actors.length).toBeGreaterThan(0);
  const lines = context.instructions?.split("\n") ?? [];
  expect(lines).toContain(REPORT_LINE);
  // Beside the report's own guidance: the line after its description, shown once, and not as a command.
  expect(lines[lines.indexOf(REPORT_GUIDANCE) + 1]).toBe(REPORT_LINE);
  expect(context.instructions?.split(REPORT_LINE).length).toBe(2);
  // The legend's line stays in the start every god shares, and travel's is not in it.
  expect(lines.indexOf(LEGEND_LINE)).toBeLessThan(lines.indexOf(TRAVEL_LINE));

  // No one here: a report has no listener to name, so the action is not offered and its shape is not shown.
  const alone = viewOf("athena", "ancient-olive-tree", true);
  expect(alone.snapshot.actors.length).toBe(0);
  expect(alone.context.instructions).not.toContain('{"action":"report"');
  expect(alone.context.instructions).not.toContain(REPORT_GUIDANCE);
  expect(alone.context.instructions).toContain(LEGEND_LINE);
  expect(
    (alone.schema.jsonSchema as { properties: { action: { enum: string[] } } })
      .properties.action.enum,
  ).not.toContain("report");
});

test("the report's shape is not in the start every god shares: whether anyone is here varies it from god to god, so it sits after what the gods are told alike", () => {
  const withCompany = viewOf("athena", "ancient-olive-tree").context
    .instructions;
  const alone = viewOf("athena", "ancient-olive-tree", true).context
    .instructions;
  if (withCompany === undefined || alone === undefined) throw new Error("none");
  // The two differ only from the report's guidance on; everything before the first scene-dependent line is the same.
  const at = withCompany.indexOf(REPORT_GUIDANCE);
  expect(at).toBeGreaterThan(0);
  expect(withCompany.slice(0, at)).toBe(alone.slice(0, at));
});

test("the form copied from the prompt validates: through the parser, the builder, and the world", () => {
  const { state, snapshot, remembered, schema, context } = viewOf(
    "athena",
    "ancient-olive-tree",
  );
  const shown = context.instructions
    ?.split("\n")
    .find((line) => line.startsWith("For a report: "));
  if (shown === undefined) throw new Error("no report line");
  const copied = JSON.parse(shown.slice("For a report: ".length)) as Record<
    string,
    unknown
  >;
  expect(Object.keys(copied)).toEqual(["action", "listener", "content"]);
  // The placeholders are what a god replaces: a real listener from the scene and its words.
  const listener = snapshot.actors[0]?.id;
  if (listener === undefined) throw new Error("no one here");
  const intent = {
    ...copied,
    listener,
    content: "The olive keeps what the war took.",
  };
  const parsed = schema.parse(intent);
  if (!parsed.ok) throw new Error(parsed.message);
  expect(parsed.value as unknown).toEqual({
    action: "report",
    listener,
    content: "The olive keeps what the war took.",
  });
  expect(String(copied.content).length).toBeLessThanOrEqual(MAX_REPORT_LENGTH);
  // The placeholder listener is not an id in the scene, so copying it as it stands is refused, as it should be.
  expect(schema.parse(copied).ok).toBe(false);

  const built = buildModelProposal(
    id("athena"),
    snapshot,
    parsed.value,
    remembered,
  );
  if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
  const submitted = submitProposal(built.proposal);
  if (!submitted.ok) throw new Error(submitted.rejection.message);
  // The world accepts it: the listener is told, nothing is rejected.
  const ran = runTick(state, createPrng(1), [submitted.proposal]);
  expect(ran.rejected).toEqual([]);
  expect(ran.events.map((e) => e.kind)).toContain("report-told");
});

test("the schema requires the listener and the content when the action is a report, as the parser does", () => {
  const { schema } = viewOf("athena", "ancient-olive-tree");
  const js = schema.jsonSchema as {
    properties: Record<string, unknown>;
    allOf?: {
      if?: unknown;
      then?: { required?: string[] };
    }[];
  };
  const reportCondition = js.allOf?.find(
    (condition) =>
      JSON.stringify(condition.if) ===
      JSON.stringify({
        properties: { action: { const: "report" } },
        required: ["action"],
      }),
  );
  expect(reportCondition?.then?.required).toEqual(["listener", "content"]);
  // The fields it names are properties of the schema.
  expect(js.properties.listener).toBeDefined();
  expect(js.properties.content).toBeDefined();
  // The parser says the same: a place in `to`, no listener, no content, an empty or over-long one, are all refused.
  const listener = viewOf("athena", "ancient-olive-tree").snapshot.actors[0]
    ?.id;
  for (const bad of [
    { action: "report", to: "ferry-dock", content: "Words." },
    { action: "report", content: "Words." },
    { action: "report", listener },
    { action: "report", listener, content: "" },
    {
      action: "report",
      listener,
      content: "x".repeat(MAX_REPORT_LENGTH + 1),
    },
  ]) {
    expect(schema.parse(bad).ok).toBe(false);
  }
  expect(
    schema.parse({
      action: "report",
      listener,
      content: "x".repeat(MAX_REPORT_LENGTH),
    }).ok,
  ).toBe(true);
});

test("with no one to tell the schema has no report condition and no listener property, and a report is refused outright", () => {
  const { schema } = viewOf("athena", "ancient-olive-tree", true);
  const js = schema.jsonSchema as {
    properties: Record<string, unknown>;
    allOf?: { if?: { properties?: { action?: { const?: string } } } }[];
  };
  expect(js.properties.listener).toBeUndefined();
  expect(
    (js.allOf ?? []).some(
      (condition) => condition.if?.properties?.action?.const === "report",
    ),
  ).toBe(false);
  expect(
    schema.parse({ action: "report", listener: "zeus", content: "No." }).ok,
  ).toBe(false);
});
