// Shared test fixtures: the authored Greek world and god profiles, loaded from
// content/greek, so agent tests exercise the real pack rather than a copy.

import { join } from "node:path";
import {
  type GodProfile,
  loadContentPack,
  loadGodProfiles,
} from "@panthea/content";
import type { EventId, WorldEvent } from "@panthea/contracts";
import {
  applyEvent,
  createInitialWorldState,
  createPrng,
  getActor,
  runTick,
  submitProposal,
  toEntityId,
  type WorldState,
  withActor,
} from "@panthea/world";

const GREEK = join(import.meta.dir, "..", "..", "..", "content", "greek");

const packResult = loadContentPack(join(GREEK, "world"));
if (!packResult.ok)
  throw new Error(`${packResult.path}: ${packResult.message}`);
const pack = packResult.value;
const godsResult = loadGodProfiles(join(GREEK, "gods"), pack);
if (!godsResult.ok)
  throw new Error(`${godsResult.path}: ${godsResult.message}`);
const gods = godsResult.value;

export function greekState(): WorldState {
  return createInitialWorldState(pack);
}

/** The gods the pack added after Zeus and Hera. */
const LATER_GODS = ["athena", "hades", "hephaestus", "hermes", "poseidon"];

/**
 * `state` with only Zeus and Hera among the gods, for a test about a two-god
 * quarrel: with a third god in the world, a move that names "the other god"
 * has more than one choice.
 */
export function withOnlyZeusAndHera(state: WorldState): WorldState {
  const actors = new Map(state.actors);
  for (const god of LATER_GODS) actors.delete(toEntityId(god));
  return { ...state, actors };
}

/**
 * `state` with fire unable to spread, for a test about what one strike made
 * its witnesses remember: the square now holds a woodshed beside the oak, and
 * a spread to either would be a second thing Hera saw.
 */
export function withoutFireSpread(state: WorldState): WorldState {
  return {
    ...state,
    rules: {
      ...state.rules,
      fireBalance: { ...state.rules.fireBalance, spreadChancePerTick: 0 },
    },
  };
}

export function godProfile(id: string): GodProfile {
  const profile = gods.find((god) => god.id === id);
  if (!profile) throw new Error(`no god profile for ${id}`);
  return profile;
}

export const allGodProfiles: readonly GodProfile[] = gods;

/** `state` with `actorId` standing at `locationId`. */
export function actorAt(
  state: WorldState,
  actorId: string,
  locationId: string,
): WorldState {
  const actor = getActor(state, toEntityId(actorId));
  if (!actor) throw new Error(`the Greek pack has no actor ${actorId}`);
  return withActor(state, { ...actor, locationId: toEntityId(locationId) });
}

/** `state` with `actorId` holding `amount` of `resource`. */
export function actorHolding(
  state: WorldState,
  actorId: string,
  resource: string,
  amount: number,
): WorldState {
  const actor = getActor(state, toEntityId(actorId));
  if (!actor) throw new Error(`the Greek pack has no actor ${actorId}`);
  const inventory = new Map(actor.inventory);
  inventory.set(resource, amount);
  return withActor(state, { ...actor, inventory });
}

let nextSequence = 1;

/** A committed event with a fixed envelope, for perception windows. */
export function committedEvent(
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

/** `state` with `actorId` holding exactly `capabilities`; a test uses it for a capability-less deity, which the authored pack no longer has. */
export function actorWithCapabilities(
  state: WorldState,
  actorId: string,
  capabilities: readonly string[],
): WorldState {
  const actor = getActor(state, toEntityId(actorId));
  if (!actor) throw new Error(`the Greek pack has no actor ${actorId}`);
  return withActor(state, { ...actor, capabilities });
}

/** A real Greek world that tests grow by applying events and running ticks, as the agents suites do. */
export class WorldRun {
  state: WorldState = withoutFireSpread(greekState());
  readonly events: WorldEvent[] = [];
  private n = 0;
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
        observationId: `obs-run-${this.n}`,
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
  /** `mortal` prays to `god` about food that spoiled; a tick passes first, so the next prayer is newer. */
  prays(mortal: string, god = "zeus"): EventId {
    this.state = { ...this.state, tick: this.state.tick + 1 };
    const cause = this.apply({
      kind: "stock-spoiled",
      entityId: mortal,
      resource: "food",
      amount: 1,
      cause: "director",
    });
    return this.apply({
      kind: "petition-opened",
      entityId: mortal,
      god,
      cause: cause.id,
      request: {
        kind: "help",
        need: { kind: "resource", resource: "food", amount: 1 },
      },
    }).id as EventId;
  }
}
