// An actor's sprite id is presentation data the world carries and never reads:
// set at genesis from the pack, encoded with the actor, and absent from every
// rule's inputs.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ContentPack } from "@panthea/contracts";
import { runTick, submitProposal } from "./actions";
import { decode, encode } from "./codec";
import {
  createInitialWorldState,
  createPrng,
  toEntityId,
  type WorldState,
  withActor,
} from "./state";

function pack(
  inhabitants: ContentPack["inhabitants"] = [
    {
      id: "woodcutter",
      name: "The Woodcutter",
      locationId: "grove",
      sprite: "placeholder-woodcutter",
    },
    {
      id: "zeus",
      name: "Zeus",
      locationId: "grove",
      deity: true,
      sprite: "zeus-sprite",
    },
  ],
): ContentPack {
  return {
    schemaVersion: 1,
    realms: ["mortal"],
    resources: [],
    locations: [
      {
        id: "grove",
        realm: "mortal",
        name: "Grove",
        edges: [{ to: "square", transport: "path", bidirectional: true }],
      },
      { id: "square", realm: "mortal", name: "Square", edges: [] },
    ],
    buildings: [],
    inhabitants,
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
}

test("genesis gives each actor the sprite id its inhabitant carries", () => {
  const state = createInitialWorldState(pack());
  expect(state.actors.get(toEntityId("zeus"))?.sprite).toBe("zeus-sprite");
  expect(state.actors.get(toEntityId("woodcutter"))?.sprite).toBe(
    "placeholder-woodcutter",
  );
});

test("genesis refuses an inhabitant with no sprite: an unfolded deity is a bug, not a placeholder", () => {
  const { sprite: _folded, ...bare } = {
    id: "hera",
    name: "Hera",
    locationId: "grove",
    deity: true,
    sprite: "placeholder-hera",
  };
  expect(() => createInitialWorldState(pack([bare]))).toThrow(
    /hera.*sprite|sprite.*hera/,
  );
});

function stateWithSprite(sprite: string): WorldState {
  const base = createInitialWorldState(pack());
  const woodcutter = base.actors.get(toEntityId("woodcutter"));
  if (!woodcutter) throw new Error("woodcutter missing");
  return withActor(base, { ...woodcutter, sprite });
}

test("changing an actor's sprite changes no committed event, state field or PRNG draw but the sprite itself", () => {
  const proposal = submitProposal({
    schemaVersion: 1,
    actor: "woodcutter",
    targets: [],
    expectedRevisions: [],
    source: "fixture",
    observationId: "obs-1",
    kind: "move",
    to: "square",
  });
  if (!proposal.ok) throw new Error(JSON.stringify(proposal.rejection));

  const plain = runTick(
    stateWithSprite("placeholder-woodcutter"),
    createPrng(7),
    [proposal.proposal],
  );
  const redrawn = runTick(stateWithSprite("woodcutter-sprite"), createPrng(7), [
    proposal.proposal,
  ]);

  expect(plain.events.length).toBeGreaterThan(0);
  expect(redrawn.events).toEqual(plain.events);
  expect(redrawn.prng).toEqual(plain.prng);
  expect(redrawn.rejected).toEqual(plain.rejected);

  const strip = (state: WorldState) => {
    const encoded = encode(state);
    return {
      ...encoded,
      actors: encoded.actors.map(([id, actor]) => {
        const { sprite: _sprite, ...rest } = actor;
        return [id, rest] as const;
      }),
    };
  };
  expect(strip(redrawn.state)).toEqual(strip(plain.state));
  expect(redrawn.state.actors.get(toEntityId("woodcutter"))?.sprite).toBe(
    "woodcutter-sprite",
  );
});

test("a sprite survives a tick and the codec: the world carries it unchanged", () => {
  const proposal = submitProposal({
    schemaVersion: 1,
    actor: "woodcutter",
    targets: [],
    expectedRevisions: [],
    source: "fixture",
    observationId: "obs-1",
    kind: "move",
    to: "square",
  });
  if (!proposal.ok) throw new Error(JSON.stringify(proposal.rejection));
  const ticked = runTick(stateWithSprite("woodcutter-sprite"), createPrng(1), [
    proposal.proposal,
  ]);
  const restored = decode(JSON.parse(JSON.stringify(encode(ticked.state))));
  expect(restored.actors.get(toEntityId("woodcutter"))?.sprite).toBe(
    "woodcutter-sprite",
  );
});

test("no world rule reads an actor's sprite: only genesis writes it and the codec carries it", () => {
  const carriers = new Set(["state.ts", "codec.ts", "test-actor.ts"]);
  const sources = readdirSync(import.meta.dir).filter(
    (name) =>
      name.endsWith(".ts") && !name.endsWith(".test.ts") && !carriers.has(name),
  );
  expect(sources.length).toBeGreaterThan(10);
  for (const name of sources) {
    const text = readFileSync(join(import.meta.dir, name), "utf8");
    expect({ name, reads: /\bsprite\b/i.test(text) }).toEqual({
      name,
      reads: false,
    });
  }
});
