import { expect, test } from "bun:test";
import type { ContentPack } from "@panthea/contracts";
import {
  createInitialWorldState,
  createPrng,
  runTick,
  submitProposal,
  toEntityId,
  withActor,
} from "./index";
import { testActor } from "./test-actor";

test("the barrel export wires state, geography, validate, and actions together", () => {
  const pack: ContentPack = {
    schemaVersion: 1,
    realms: ["mortal", "olympus", "underworld"],
    resources: [],
    locations: [
      {
        id: "agora",
        realm: "mortal",
        name: "Agora",
        edges: [{ to: "tavern", transport: "path", bidirectional: true }],
      },
      { id: "tavern", realm: "mortal", name: "Tavern", edges: [] },
    ],
    buildings: [],
    inhabitants: [],
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

  let state = createInitialWorldState(pack);
  state = withActor(
    state,
    testActor({
      id: toEntityId("npc-1"),
      locationId: toEntityId("agora"),
      alive: true,
      capabilities: [],
      inventory: new Map(),
      revision: 0,
    }),
  );

  const submitted = submitProposal({
    schemaVersion: 1,
    actor: "npc-1",
    targets: [],
    expectedRevisions: [],
    source: "fixture",
    observationId: "obs-1",
    kind: "move",
    to: "tavern",
  });
  expect(submitted.ok).toBe(true);
  if (!submitted.ok) return;

  const result = runTick(state, createPrng(1), [submitted.proposal]);

  expect(result.rejected).toEqual([]);
  expect(result.state.actors.get(toEntityId("npc-1"))).toMatchObject({
    locationId: "tavern",
  });
});
