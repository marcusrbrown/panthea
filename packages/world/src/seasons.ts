// Seasons and the troubles of the gods' domains.
//
// The season is derived from the tick (`floor(tick / seasonTicks) mod 4`, spring at tick 0), so catch-up and
// replay reach the same season with no state kept for it; a `season-turned` event only records the turn on its
// boundary tick. A pack's trouble table (`rules.troubles`) says what each domain trouble takes and its odds in
// each season, and `rules.troubleKinds` names the one god it belongs to. Troubles come two ways, both drawn
// from the persisted PRNG:
//
// - the season's draw: each tick, each trouble with odds in the season fires at those odds;
// - the god's floor: in every window of `troubleFloorTicks`, a god with no trouble yet in it has one at a tick
//   the PRNG picks (each tick the chance is one in the ticks the window has left, so the last tick is certain).
//
// A trouble is the world's: no mortal did it and no god acted. It takes some of a good a mortal carries, or
// damages a building a mortal owns, and the afflicted prays about it to the trouble's god.

import {
  type EntityId,
  SEASONS,
  type Season,
  type SeasonTurnedEvent,
  type TroubleEvent,
  type TroubleSpec,
} from "@panthea/contracts";
import { debitActorInventory } from "./economy";
import { applyBuildingDamaged } from "./fire";
import { petitionBalanceOf } from "./petitions";
import {
  type ActorState,
  nextPrngValue,
  type PrngState,
  type WorldEventDraft,
  type WorldState,
} from "./state";

/** The season `tick` falls in. */
export function seasonAt(state: WorldState, tick: number = state.tick): Season {
  const length = petitionBalanceOf(state.rules, "seasonTicks");
  return SEASONS[Math.floor(tick / length) % SEASONS.length] as Season;
}

/**
 * The turn this tick brings, if it is a boundary: a pack with a trouble table has seasons (they exist to move
 * its odds), and the first tick of each season after the first turns into it.
 */
export function planSeasonTurn(
  state: WorldState,
): readonly WorldEventDraft<SeasonTurnedEvent>[] {
  if (state.rules.troubles === undefined) return [];
  const length = petitionBalanceOf(state.rules, "seasonTicks");
  if (state.tick === 0 || state.tick % length !== 0) return [];
  return [
    {
      kind: "season-turned",
      season: seasonAt(state),
      previous: seasonAt(state, state.tick - 1),
    },
  ];
}

export interface TroubleStep {
  readonly events: readonly WorldEventDraft<TroubleEvent>[];
  readonly prng: PrngState;
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The god a trouble belongs to, when it is a living god. */
function godOf(state: WorldState, trouble: string): EntityId | undefined {
  const god = state.rules.troubleKinds?.[trouble] as EntityId | undefined;
  const actor = god === undefined ? undefined : state.actors.get(god);
  return actor?.alive === true && actor.isDeity === true ? god : undefined;
}

/**
 * This tick's domain troubles, drawn from `prng` in a fixed order: the season's draw over troubles in id order,
 * then each god's floor in id order. Nothing is drawn when the pack has no trouble table.
 */
export function planTroubleStep(
  state: WorldState,
  prng: PrngState,
): TroubleStep {
  const table = state.rules.troubles;
  if (table === undefined) return { events: [], prng };
  let current = prng;
  const next = (): number => {
    const drawn = nextPrngValue(current);
    current = drawn.state;
    return drawn.value;
  };
  const pick = (count: number): number =>
    Math.min(count - 1, Math.floor(next() * count));

  const season = seasonAt(state);
  const ids = Object.keys(table).sort(byId);
  const cap = petitionBalanceOf(state.rules, "troubleLossCap");
  const mortals = [...state.actors.values()]
    .filter((actor) => actor.alive && actor.isDeity !== true)
    .sort((a, b) => byId(a.id, b.id));
  const events: WorldEventDraft<TroubleEvent>[] = [];
  const taken = new Map<string, number>();
  const damaged = new Set<EntityId>();

  const heldOf = (mortal: ActorState, resource: string) =>
    (mortal.inventory.get(resource) ?? 0) -
    (taken.get(`${mortal.id}|${resource}`) ?? 0);

  /** The trouble `id`'s loss on a mortal the draw picks, or nothing when no mortal can suffer it. */
  const fire = (
    id: string,
    spec: TroubleSpec,
    source: TroubleEvent["source"],
  ) => {
    const god = godOf(state, id);
    if (god === undefined) return false;
    if (spec.effect === "resource") {
      const options = mortals.flatMap((mortal) => {
        const resource = (spec.resources ?? []).find(
          (name) => heldOf(mortal, name) >= 1,
        );
        return resource === undefined ? [] : [{ mortal, resource }];
      });
      if (options.length === 0) return false;
      const chosen = options[options.length === 1 ? 0 : pick(options.length)];
      if (chosen === undefined) return false;
      const amount = Math.min(heldOf(chosen.mortal, chosen.resource), cap);
      const key = `${chosen.mortal.id}|${chosen.resource}`;
      taken.set(key, (taken.get(key) ?? 0) + amount);
      events.push({
        kind: "trouble",
        entityId: chosen.mortal.id,
        trouble: id,
        god,
        season,
        source,
        loss: { kind: "resource", resource: chosen.resource, amount },
      });
      return true;
    }
    const options = [...state.buildings.values()]
      .filter(
        (building) =>
          building.status === "operational" &&
          !damaged.has(building.id) &&
          (spec.buildings === undefined ||
            spec.buildings.includes(building.id)) &&
          building.owner !== undefined &&
          mortals.some((mortal) => mortal.id === building.owner),
      )
      .sort((a, b) => byId(a.id, b.id));
    if (options.length === 0) return false;
    const building = options[options.length === 1 ? 0 : pick(options.length)];
    if (building?.owner === undefined) return false;
    damaged.add(building.id);
    events.push({
      kind: "trouble",
      entityId: building.owner,
      trouble: id,
      god,
      season,
      source,
      loss: { kind: "building", building: building.id },
    });
    return true;
  };

  // The season's draw.
  for (const id of ids) {
    const spec = table[id] as TroubleSpec;
    const odds = spec.seasons[season] ?? 0;
    if (odds > 0 && next() * 1000 < odds) fire(id, spec, "season");
  }

  // Each god's floor: a god with no trouble yet in this window has one at a tick the PRNG picks.
  const floor = petitionBalanceOf(state.rules, "troubleFloorTicks");
  const start = Math.floor(state.tick / floor) * floor;
  const left = start + floor - state.tick;
  const gods = [...new Set(ids.flatMap((id) => godOf(state, id) ?? []))].sort(
    byId,
  );
  for (const god of gods) {
    const last = state.lastTrouble.get(god);
    const done =
      (last !== undefined && last >= start) ||
      events.some((event) => event.god === god);
    if (done || next() * left >= 1) continue;
    const own = ids.filter((id) => godOf(state, id) === god);
    // Favour what the season brings: each of the god's troubles weighs its odds now, and at least 1.
    const weights = own.map((id) => (table[id]?.seasons[season] ?? 0) + 1);
    let roll = next() * weights.reduce((sum, weight) => sum + weight, 0);
    const order = own
      .map((id, index) => ({ id, weight: weights[index] ?? 1 }))
      .sort((a, b) => b.weight - a.weight || byId(a.id, b.id));
    const hit = order.findIndex(({ weight }) => {
      roll -= weight;
      return roll < 0;
    });
    // The chosen trouble first, then the rest by weight: the floor falls on whatever can happen.
    const chosen = hit < 0 ? 0 : hit;
    const attempts = [
      ...order.slice(chosen, chosen + 1),
      ...order.filter((_, index) => index !== chosen),
    ];
    for (const { id } of attempts) {
      if (fire(id, table[id] as TroubleSpec, "floor")) break;
    }
  }

  return { events, prng: current };
}

/** A trouble lands: what it took is gone, and the god's domain has had its trouble this tick. */
export function applyTrouble(
  state: WorldState,
  event: TroubleEvent,
): WorldState {
  const lost =
    event.loss.kind === "resource"
      ? debitActorInventory(
          state,
          event.entityId,
          event.loss.resource,
          event.loss.amount,
        )
      : applyBuildingDamaged(state, event.loss.building);
  const lastTrouble = new Map(lost.lastTrouble).set(event.god, event.tick);
  return { ...lost, lastTrouble };
}
