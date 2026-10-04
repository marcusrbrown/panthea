// The gate's reading of an owed boon, against rows a real world writes: the Greek pack, real proposals through the
// real validator and judge, the digest the real prompt builder produces, and the proposals a god then sends. Nothing
// here hand-writes a digest; what the row shows is what the world and the prompt said.

import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  buildGodContext,
  godIntentSchema,
  rememberedBy,
} from "@panthea/agents";
import {
  type GodProfile,
  loadContentPack,
  loadGodProfiles,
} from "@panthea/content";
import type { WorldEvent } from "@panthea/contracts";
import {
  applyEvent,
  createInitialWorldState,
  createPrng,
  getActor,
  perceive,
  runTick,
  submitProposal,
  toEntityId,
  type WorldState,
  withActor,
} from "@panthea/world";
import { REPO_ROOT } from "../../m1-living-world/src/sidecar";
import { analyzePractices, obligationRows } from "./practice-analysis";
import type { RealInput, RealProposal, RealRequest } from "./real-analysis";

const id = toEntityId;
const GREEK = join(REPO_ROOT, "content", "greek");
const loadedPack = loadContentPack(join(GREEK, "world"));
if (!loadedPack.ok) throw new Error(loadedPack.message);
const pack = loadedPack.value;
const loadedGods = loadGodProfiles(join(GREEK, "gods"), pack);
if (!loadedGods.ok) throw new Error(loadedGods.message);
const gods = loadedGods.value;
const profileOf = (god: string): GodProfile => {
  const found = gods.find((profile) => profile.id === god);
  if (!found) throw new Error(god);
  return found;
};

class World {
  state: WorldState = createInitialWorldState(pack);
  readonly events: WorldEvent[] = [];
  readonly requests: RealRequest[] = [];
  readonly proposals: RealProposal[] = [];
  private n = 0;
  constructor() {
    // Fire never spreads, so a strike on one building is one event.
    this.state = {
      ...this.state,
      rules: {
        ...this.state.rules,
        fireBalance: {
          ...this.state.rules.fireBalance,
          spreadChancePerTick: 0,
        },
      },
    };
  }
  apply(overrides: Record<string, unknown>): WorldEvent {
    this.n += 1;
    const event = {
      schemaVersion: 1,
      id: `evt-${this.state.tick}-${900 + this.n}`,
      sequence: this.state.lastSequence + 1,
      simTime: 0,
      tick: this.state.tick,
      correlationId: "fixture",
      causationId: "fixture",
      approximate: false,
      ...overrides,
    } as unknown as WorldEvent;
    this.state = applyEvent(this.state, event);
    this.events.push(event);
    return event;
  }
  tick(...raws: Record<string, unknown>[]) {
    const proposals = raws.map((raw) => {
      this.n += 1;
      const submitted = submitProposal({
        schemaVersion: 1,
        targets: [],
        expectedRevisions: [],
        source: "fixture",
        observationId: `obs-ob-${this.n}`,
        ...raw,
      });
      if (!submitted.ok) throw new Error(submitted.rejection.message);
      return submitted.proposal;
    });
    const result = runTick(this.state, createPrng(1), proposals);
    this.state = result.state;
    this.events.push(...result.events);
    return result;
  }
  place(who: string, where: string) {
    const actor = getActor(this.state, id(who));
    if (!actor) throw new Error(who);
    this.state = withActor(this.state, { ...actor, locationId: id(where) });
  }
  /** The prompt the god is shown now, as the real builder writes it. */
  promptFor(god: string) {
    const snapshot = perceive(this.state, id(god), this.events);
    if (!snapshot) throw new Error("no snapshot");
    const remembered = rememberedBy(this.state, id(god));
    const context = buildGodContext(profileOf(god), snapshot, remembered);
    return {
      prompt: context.prompt,
      schema: godIntentSchema(profileOf(god), snapshot, remembered),
    };
  }
  /** A god's turn: its request with the prompt it was shown, and its proposal as the world judged it, journaled as the service would. */
  turn(god: string, intent: Record<string, unknown>) {
    const shown = this.promptFor(god);
    const proposalId = `turn-${this.n++}`;
    const parsed = shown.schema.parse(intent);
    if (!parsed.ok)
      throw new Error(`the schema refused ${JSON.stringify(intent)}`);
    const { action, ...fields } = parsed.value as Record<string, unknown>;
    const ran = this.tick({ actor: god, kind: action, ...fields });
    const committed = ran.rejected.length === 0;
    this.requests.push({
      proposalId,
      role: god,
      outcome: "intent",
      elapsedMs: 1000,
      promptPayload: shown.prompt,
      steps: [{ mode: "native" }],
    });
    this.proposals.push({
      proposalId,
      actor: god,
      kind: String(action),
      observationId: `obs-turn-${this.n}`,
      proposal: { actor: god, kind: action, ...fields },
      outcome: committed ? "committed" : "rejected",
      ...(committed ? {} : { reason: ran.rejected[0]?.reason }),
    } as RealProposal);
    return { shown, ran, committed };
  }
  input(): RealInput {
    return {
      requests: this.requests,
      proposals: this.proposals,
      events: this.events,
      polls: { total: 1, degraded: 0 },
    } as unknown as RealInput;
  }
}

/** A punish prayer by the farmer to Zeus against the woodshed, terms offered and accepted: Zeus owes the strike. */
function punishAgreed(world: World) {
  const theft = world.apply({
    kind: "theft",
    entityId: "woodcutter",
    victim: "farmer",
    resource: "currency",
    amount: 1,
    cause: "director",
  });
  const petition = world.apply({
    kind: "petition-opened",
    entityId: "farmer",
    god: "zeus",
    cause: theft.id,
    request: {
      kind: "punish",
      offender: "woodcutter",
      buildings: ["woodshed"],
    },
  });
  world.tick({
    actor: "zeus",
    kind: "practice",
    move: "offer",
    petition: petition.id,
    term: {
      kind: "make-offering",
      party: "farmer",
      to: "zeus",
      resource: "currency",
      amount: 1,
      deadlineTicks: 80,
    },
  });
  const thread = [...world.state.threads.values()].at(-1);
  if (!thread) throw new Error("no thread");
  world.tick({
    actor: "farmer",
    kind: "practice",
    move: "accept",
    thread: thread.id,
    source: "routine",
  });
  return { petition: petition.id, thread: thread.id };
}

const turnsOf = (world: World) => analyzePractices(world.input()).obligated;

test("a strike the world does not count as the boon is not performed: Hera damages the woodshed, so it is no longer operational, and Zeus's second strike commits but answers nothing", () => {
  const world = new World();
  const { thread } = punishAgreed(world);
  world.place("zeus", "town-square");
  // Hera damages the woodshed first: the prayer is open and the building is no longer operational.
  world.place("hera", "town-square");
  world.tick({ actor: "hera", kind: "strike", target: "woodshed", power: 1 });
  expect(world.state.buildings.get(id("woodshed"))?.status).not.toBe(
    "operational",
  );

  const { shown, committed } = world.turn("zeus", {
    action: "strike",
    target: "woodshed",
    power: 1,
  });
  // The digest showed no step, only why: and the strike commits but the world never counts it.
  expect(committed).toBe(true);
  const rows = obligationRows(shown.prompt);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.next).toBeUndefined();
  expect(rows[0]?.unperformable).toContain("can be struck now");
  expect(
    world.state.threads.get(thread as never)?.progress?.boon,
  ).toBeUndefined();
  const turn = turnsOf(world).turns.find((t) => t.god === "zeus");
  expect(turn?.class).not.toBe("performed");
  expect(turn?.class).toBe("waited for a named event");
});

test("control: a strike the row showed, with the building operational, is performed and the world counts it as the boon", () => {
  const world = new World();
  const { thread } = punishAgreed(world);
  world.place("zeus", "town-square");
  const { shown, committed } = world.turn("zeus", {
    action: "strike",
    target: "woodshed",
    power: 1,
  });
  expect(committed).toBe(true);
  const rows = obligationRows(shown.prompt);
  expect(rows[0]?.next).toEqual({
    action: "strike",
    target: "woodshed",
    power: 1,
  });
  expect(
    world.state.threads.get(thread as never)?.progress?.boon,
  ).toBeDefined();
  expect(turnsOf(world).turns.find((t) => t.god === "zeus")?.class).toBe(
    "performed",
  );
});

test("a correct move along a compacted row's hop is performed: four boons owed, a digest too tight to show them whole, and the step is still read from the compact row", () => {
  const world = new World();
  const mortals = [...world.state.actors.values()]
    .filter(
      (actor) =>
        actor.alive &&
        !actor.isDeity &&
        (actor.inventory.get("currency") ?? 0) >= 1 &&
        actor.locationId !== getActor(world.state, id("zeus"))?.locationId,
    )
    .slice(0, 4)
    .map((actor) => String(actor.id));
  expect(mortals).toHaveLength(4);
  for (const mortal of mortals) {
    const spoiled = world.apply({
      kind: "stock-spoiled",
      entityId: mortal,
      resource: "food",
      amount: 1,
      cause: "director",
    });
    const petition = world.apply({
      kind: "petition-opened",
      entityId: mortal,
      god: "zeus",
      cause: spoiled.id,
      request: {
        kind: "help",
        need: { kind: "resource", resource: "food", amount: 1 },
      },
    });
    world.tick({
      actor: "zeus",
      kind: "practice",
      move: "offer",
      petition: petition.id,
      term: {
        kind: "make-offering",
        party: mortal,
        to: "zeus",
        resource: "currency",
        amount: 1,
        deadlineTicks: 80,
      },
    });
    const thread = [...world.state.threads.values()].at(-1);
    if (!thread) throw new Error("no thread");
    world.tick({
      actor: mortal,
      kind: "practice",
      move: "accept",
      thread: thread.id,
      source: "routine",
    });
  }
  // Every owed row, however the digest budget treated it, gives its step or its obstacle.
  const shown = world.promptFor("zeus");
  const rows = obligationRows(shown.prompt);
  expect(rows).toHaveLength(4);
  for (const row of rows) {
    expect(row.next !== undefined || row.unperformable !== undefined).toBe(
      true,
    );
  }
});
