// The quiet-world director: when nothing real has happened for the quiet
// window, it causes attributed trouble among mortals, so the world gives gods
// something to answer.
//
// It is an environmental step of the tick, beside income, fire, and the need
// scan. It uses the persisted PRNG, so a replay chooses the same trouble. Its
// trouble is theft, spoiled stock, or a fire in a victim's building, each
// recorded with the director as its cause (never a god, never a mortal's
// choice). It only takes, spoils, or burns; it never undoes damage. Talk,
// goals, and prayers are not consequential and do not reset its timer.
//
// It prefers the people of places where something is open (an open thread, a
// contest no god has served yet) for its trouble, so the world's pressure lands
// on the matters gods are already working. It only chooses whom trouble befalls
// and what kind: it never opens a thread or a contest, never answers for a god,
// and reads nothing but the world and the persisted PRNG, so it does the same
// whatever drives the gods' turns.

import type { WorldEvent } from "@panthea/contracts";
import { placeOf, placesWithSomethingOpen } from "./contests";
import { petitionBalanceOf } from "./petitions";
import {
  type ActorState,
  nextPrngValue,
  type PrngState,
  type WorldEventDraft,
  type WorldState,
} from "./state";

/** The state the director keeps: the tick of the last consequential event. */
export interface DirectorState {
  readonly lastConsequentialTick: number;
}

/**
 * Whether `event` is something that really happened in the world, and so
 * counts as activity: a strike, a fire, a theft or spoilage, a trade, a bless,
 * or an answered petition. Prayers, goals, reports, and legends are not.
 */
export function isConsequential(event: WorldEvent): boolean {
  switch (event.kind) {
    case "building-damaged":
    case "mortal-struck":
    case "building-ignited":
    case "theft":
    case "stock-spoiled":
    case "resource-traded":
    case "blessing-granted":
    case "petition-answered":
      return true;
    default:
      return false;
  }
}

/** Notes `event` in the director's timer. */
export function noteConsequential(
  state: WorldState,
  event: WorldEvent,
): WorldState {
  if (!isConsequential(event)) return state;
  if (state.director.lastConsequentialTick >= event.tick) return state;
  return { ...state, director: { lastConsequentialTick: event.tick } };
}

/** The living mortals, in id order: who the director may rob or burn. */
function eligibleMortals(state: WorldState): ActorState[] {
  return [...state.actors.values()]
    .filter((actor) => actor.alive && actor.isDeity !== true && actor.drives)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Whom trouble may befall: the mortals who belong to a place where something is open, when any do (and
 * at least two, so a thief remains), else everyone eligible.
 */
function pressured(state: WorldState, mortals: ActorState[]): ActorState[] {
  const open = placesWithSomethingOpen(state);
  if (open.size === 0) return mortals;
  const chosen = mortals.filter((mortal) => open.has(placeOf(mortal)));
  return chosen.length === 0 ? mortals : chosen;
}

/** What `victim` holds most of, by name on a tie; absent when it holds nothing. */
function mostPlentiful(
  victim: ActorState,
): { resource: string; amount: number } | undefined {
  let best: { resource: string; amount: number } | undefined;
  for (const [resource, amount] of [...victim.inventory].sort((a, b) =>
    a[0] < b[0] ? -1 : 1,
  )) {
    if (amount > 0 && (best === undefined || amount > best.amount)) {
      best = { resource, amount };
    }
  }
  return best;
}

export interface DirectorStep {
  readonly events: readonly WorldEventDraft[];
  readonly prng: PrngState;
}

/**
 * The trouble this tick's director step causes, if the quiet window has
 * passed: it draws a victim from the eligible mortals in id order, then one of
 * the troubles that victim can suffer. With fewer than two mortals eligible it
 * skips. `tick` is the tick the step runs in.
 */
export function planDirectorStep(
  state: WorldState,
  prng: PrngState,
  tick: number = state.tick,
): DirectorStep {
  const quiet = petitionBalanceOf(state.rules, "directorQuietTicks");
  if (tick - state.director.lastConsequentialTick < quiet) {
    return { events: [], prng };
  }
  const mortals = eligibleMortals(state);
  if (mortals.length < 2) return { events: [], prng };

  let current = prng;
  const draw = (count: number): number => {
    const next = nextPrngValue(current);
    current = next.state;
    return Math.min(count - 1, Math.floor(next.value * count));
  };

  // A victim is drawn from the people of places with something open, when there are any; a thief from everyone else.
  const victims = pressured(state, mortals);
  const victim = victims[draw(victims.length)] as ActorState;
  const held = mostPlentiful(victim);
  const burnable = [...state.buildings.values()]
    .filter(
      (building) =>
        building.owner === victim.id &&
        building.combustible &&
        building.status === "operational",
    )
    .map((building) => building.id)
    .sort();

  const troubles: (() => WorldEventDraft)[] = [];
  if (held !== undefined) {
    const amount = Math.max(1, Math.floor(held.amount / 2));
    const thieves = mortals.filter((mortal) => mortal.id !== victim.id);
    const thief = thieves[draw(thieves.length)] as ActorState;
    troubles.push(
      () => ({
        kind: "theft",
        entityId: thief.id,
        victim: victim.id,
        resource: held.resource,
        amount,
        cause: "director",
      }),
      () => ({
        kind: "stock-spoiled",
        entityId: victim.id,
        resource: held.resource,
        amount,
        cause: "director",
      }),
    );
  }
  if (burnable.length > 0) {
    troubles.push(() => ({
      kind: "building-ignited",
      entityId: burnable[0] as (typeof burnable)[number],
      cause: { kind: "director" },
    }));
  }
  if (troubles.length === 0) return { events: [], prng: current };
  const chosen = troubles[draw(troubles.length)] as () => WorldEventDraft;
  return { events: [chosen()], prng: current };
}
