// Goal privacy against a real prompt: a legend is told aloud, so a narrator's
// goal disclosed in one is public to everyone present, and the property must not
// call the visible legend line a leak. The prompt is built by the production
// `buildGodContext` after a real legend tick.

import { expect, test } from "bun:test";
import { join } from "node:path";
import { buildGodContext, rememberedBy } from "@panthea/agents";
import {
  loadContentPack,
  loadGodProfiles,
  withGodSprites,
} from "@panthea/content";
import {
  createInitialWorldState,
  createPrng,
  perceive,
  runTick,
  submitProposal,
  toEntityId,
} from "@panthea/world";
import { analyzeReal, type RealInput, type RealRequest } from "./real-analysis";

const GREEK = join(import.meta.dir, "..", "..", "..", "..", "content", "greek");
const packResult = loadContentPack(join(GREEK, "world"));
if (!packResult.ok) throw new Error(packResult.message);
const pack = packResult.value;
const godsResult = loadGodProfiles(join(GREEK, "gods"), pack);
if (!godsResult.ok) throw new Error(godsResult.message);
const gods = godsResult.value;
// A deity's sprite id is its profile's: fold it in, as pack assembly does, before genesis.
const foldedResult = withGodSprites(pack, gods);
if (!foldedResult.ok) throw new Error(foldedResult.message);
const foldedPack = foldedResult.value;
const profile = (id: string) => {
  const found = gods.find((g) => g.id === id);
  if (!found) throw new Error(`no profile ${id}`);
  return found;
};

const HERA_GOAL = "Make Zeus admit his deceit.";

/** Hera sets her goal, then tells that same text as a legend with Zeus in the hall. */
function legendDisclosure() {
  let state = createInitialWorldState(foldedPack);
  const events: unknown[] = [];
  let n = 0;
  const tick = (raw: Record<string, unknown>) => {
    n += 1;
    const submitted = submitProposal({
      schemaVersion: 1,
      targets: [],
      expectedRevisions: [],
      source: "model",
      observationId: `obs-d${n}`,
      ...raw,
    });
    if (!submitted.ok) throw new Error(submitted.rejection.message);
    const result = runTick(state, createPrng(1), [submitted.proposal]);
    expect(result.rejected).toEqual([]);
    state = result.state;
    events.push(...result.events);
    return result;
  };
  tick({
    actor: "hera",
    kind: "goal",
    goal: { set: { text: HERA_GOAL, target: "zeus" } },
  });
  const told = tick({
    actor: "hera",
    kind: "legend",
    assertion: HERA_GOAL,
    claim: { effect: "harm", agent: "zeus", target: "hera" },
  });
  const zeusId = toEntityId("zeus");
  const snapshot = perceive(state, zeusId, told.events);
  if (!snapshot) throw new Error("zeus perceives nothing");
  const context = buildGodContext(
    profile("zeus"),
    snapshot,
    rememberedBy(state, zeusId),
  );
  return { events, prompt: `${context.instructions}\n\n${context.prompt}` };
}

const analyze = (events: unknown[], requests: RealRequest[]) =>
  analyzeReal({
    requests,
    proposals: [],
    events: JSON.parse(JSON.stringify(events)) as RealInput["events"],
    polls: { total: 1, degraded: 0 },
  }).properties.find((p) => p.name === "goal privacy");

const zeusAsked = (prompt: string): RealRequest => ({
  proposalId: undefined,
  role: "zeus",
  outcome: "intent",
  elapsedMs: 1,
  promptPayload: prompt,
  steps: [{ mode: "native" }],
});

test("a goal Hera discloses in a legend is public to the hall: Zeus's real prompt carries it as the visible legend and as a told belief, and goal privacy passes", () => {
  const { events, prompt } = legendDisclosure();
  // The prompt really holds the goal text twice, both ways it legitimately reaches him.
  const carrying = prompt.split("\n").filter((l) => l.includes(HERA_GOAL));
  expect(carrying.some((l) => /^- \[[^\]]+\] legend-recorded /.test(l))).toBe(
    true,
  );
  expect(carrying.some((l) => /^- hera told you: /.test(l))).toBe(true);
  expect(analyze(events, [zeusAsked(prompt)])?.ok).toBe(true);
});

test("control: the same goal text anywhere else in the prompt is still a leak, and a legend line is not a way around the rule for text that is not in one", () => {
  const { events, prompt } = legendDisclosure();
  const leaked = analyze(events, [
    zeusAsked(`${prompt}\nSomething else: ${HERA_GOAL}`),
  ]);
  expect(leaked?.ok).toBe(false);
  expect(leaked?.detail).toContain("hera");
  // A different goal that Hera never disclosed, shown in a non-legend line, fails too.
  const secret = analyze(
    [
      ...events,
      {
        schemaVersion: 1,
        id: "evt-9-9",
        sequence: 99,
        simTime: 0,
        correlationId: "c",
        causationId: "c",
        tick: 1,
        approximate: false,
        kind: "goal-set",
        entityId: "hera",
        text: "A secret aim.",
        target: "zeus",
      },
    ],
    [zeusAsked(`${prompt}\nYou sense: A secret aim.`)],
  );
  expect(secret?.ok).toBe(false);
});
