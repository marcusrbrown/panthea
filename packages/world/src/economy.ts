// The resource graph: inventory accounting, recipe conversion, and the
// deterministic rule a trade counterparty accepts or declines by. Every
// function here is pure over plain values or a `WorldState`; nothing
// touches SQLite or the wall clock.
//
// Conservation: currency and goods are conserved except at three declared
// points -- `creditActorInventory` alone is a source (gather), the input
// side of `applyRecipe` alone is a sink while its output side is a source
// (produce converts one into the other), and `debitActorInventory` alone
// is a sink (consume). `transferBetweenActors` never changes a total: it
// only moves an amount from one actor's inventory to another's.

import type {
  EntityId,
  InhabitantDrives,
  Recipe,
  ResourceAmount,
  WorldRules,
} from "@panthea/contracts";
import { getActor, type WorldState } from "./state";

export function getResourceAmount(
  inventory: ReadonlyMap<string, number>,
  resource: string,
): number {
  return inventory.get(resource) ?? 0;
}

/**
 * Sets `resource` to `amount` in `inventory`, returning a new map. Deletes
 * the key rather than storing an explicit zero, so two inventories holding
 * the same resources always compare equal regardless of which additions
 * and subtractions produced them.
 */
function withResourceAmount(
  inventory: ReadonlyMap<string, number>,
  resource: string,
  amount: number,
): ReadonlyMap<string, number> {
  const next = new Map(inventory);
  if (amount === 0) {
    next.delete(resource);
  } else {
    next.set(resource, amount);
  }
  return next;
}

function creditInventory(
  inventory: ReadonlyMap<string, number>,
  resource: string,
  amount: number,
): ReadonlyMap<string, number> {
  return withResourceAmount(
    inventory,
    resource,
    getResourceAmount(inventory, resource) + amount,
  );
}

function debitInventory(
  inventory: ReadonlyMap<string, number>,
  resource: string,
  amount: number,
): ReadonlyMap<string, number> {
  return withResourceAmount(
    inventory,
    resource,
    getResourceAmount(inventory, resource) - amount,
  );
}

/** Adds `amount` of `resource` to an actor's inventory -- a source: nothing else changes. */
export function creditActorInventory(
  state: WorldState,
  actorId: EntityId,
  resource: string,
  amount: number,
): WorldState {
  const actor = getActor(state, actorId);
  if (!actor) return state;
  const actors = new Map(state.actors);
  actors.set(actorId, {
    ...actor,
    inventory: creditInventory(actor.inventory, resource, amount),
    revision: actor.revision + 1,
  });
  return { ...state, actors };
}

/**
 * Removes `amount` of `resource` from an actor's inventory -- a sink:
 * nothing else changes. Assumes the caller (a proposal validator) already
 * confirmed the actor holds enough; does not clamp or reject here.
 */
export function debitActorInventory(
  state: WorldState,
  actorId: EntityId,
  resource: string,
  amount: number,
): WorldState {
  const actor = getActor(state, actorId);
  if (!actor) return state;
  const actors = new Map(state.actors);
  actors.set(actorId, {
    ...actor,
    inventory: debitInventory(actor.inventory, resource, amount),
    revision: actor.revision + 1,
  });
  return { ...state, actors };
}

/**
 * Moves `give` from `fromId` to `toId` and `receive` from `toId` to
 * `fromId` -- a zero-sum transfer between two actors' inventories; the
 * combined total of every resource is unchanged.
 */
export function transferBetweenActors(
  state: WorldState,
  fromId: EntityId,
  toId: EntityId,
  give: readonly ResourceAmount[],
  receive: readonly ResourceAmount[],
): WorldState {
  if (fromId === toId) {
    throw new Error(
      `transferBetweenActors: fromId and toId must differ, both were ${fromId}`,
    );
  }
  const from = getActor(state, fromId);
  const to = getActor(state, toId);
  if (!from || !to) return state;

  let fromInventory = from.inventory;
  let toInventory = to.inventory;
  for (const item of give) {
    fromInventory = debitInventory(fromInventory, item.resource, item.amount);
    toInventory = creditInventory(toInventory, item.resource, item.amount);
  }
  for (const item of receive) {
    toInventory = debitInventory(toInventory, item.resource, item.amount);
    fromInventory = creditInventory(fromInventory, item.resource, item.amount);
  }

  const actors = new Map(state.actors);
  actors.set(fromId, {
    ...from,
    inventory: fromInventory,
    revision: from.revision + 1,
  });
  actors.set(toId, {
    ...to,
    inventory: toInventory,
    revision: to.revision + 1,
  });
  return { ...state, actors };
}

/**
 * Converts `recipe.inputs` into `recipe.outputs`, scaled by `quantity` --
 * the input side is a sink and the output side is a source; together they
 * convert one declared total into another, never conserving either alone.
 */
export function applyRecipe(
  state: WorldState,
  actorId: EntityId,
  recipe: Recipe,
  quantity: number,
): WorldState {
  const actor = getActor(state, actorId);
  if (!actor) return state;
  let inventory = actor.inventory;
  for (const input of recipe.inputs) {
    inventory = debitInventory(
      inventory,
      input.resource,
      input.amount * quantity,
    );
  }
  for (const output of recipe.outputs) {
    inventory = creditInventory(
      inventory,
      output.resource,
      output.amount * quantity,
    );
  }
  const actors = new Map(state.actors);
  actors.set(actorId, { ...actor, inventory, revision: actor.revision + 1 });
  return { ...state, actors };
}

/** Every drive at zero: the acceptance baseline for a counterparty with no authored drives. */
export const NEUTRAL_DRIVES: InhabitantDrives = {
  thrift: 0,
  appetite: 0,
  greed: 0,
  piety: 0,
};

/** A resource's base value per unit, from `rules.economyBalance["value_<resource>"]`; unlisted resources default to 1. */
export function resourceValue(rules: WorldRules, resource: string): number {
  return rules.economyBalance[`value_${resource}`] ?? 1;
}

/**
 * The good in `inventory` worth the most per unit (then the larger holding, then the name that sorts first),
 * and how much of it to take: what is held, up to `cap`. Nothing when the inventory holds no such good.
 */
export function mostValuableGood(
  rules: WorldRules,
  inventory: ReadonlyMap<string, number>,
  cap: number,
  excluding: readonly string[] = [],
): { resource: string; amount: number } | undefined {
  let best: { resource: string; held: number; value: number } | undefined;
  for (const [resource, held] of inventory) {
    if (held <= 0 || excluding.includes(resource)) continue;
    const value = resourceValue(rules, resource);
    if (
      best === undefined ||
      value > best.value ||
      (value === best.value &&
        (held > best.held || (held === best.held && resource < best.resource)))
    ) {
      best = { resource, held, value };
    }
  }
  return best === undefined
    ? undefined
    : { resource: best.resource, amount: Math.min(best.held, cap) };
}

/** The amount one gather commits, from `rules.economyBalance.gatherAmount`; defaults to 1. */
export function gatherAmountOf(rules: WorldRules): number {
  return rules.economyBalance.gatherAmount ?? 1;
}

/** The amount one consume commits, from `rules.economyBalance.consumeAmount`; defaults to 1. */
export function consumeAmountOf(rules: WorldRules): number {
  return rules.economyBalance.consumeAmount ?? 1;
}

function totalValue(
  rules: WorldRules,
  items: readonly ResourceAmount[],
): number {
  return items.reduce(
    (sum, item) => sum + item.amount * resourceValue(rules, item.resource),
    0,
  );
}

/**
 * The counterparty's deterministic acceptance rule: it accepts a trade iff
 * the value it receives (`give`, from the proposing actor's side) is at
 * least the value it gives up (`receive`) scaled by its own demand. A
 * thriftier counterparty demands more back before parting with anything; a
 * greedier one is easier to entice with any surplus. Evaluated at
 * execution against the counterparty's actual committed drives -- never
 * against a proposal-declared value.
 */
export function evaluateTradeAcceptance(
  rules: WorldRules,
  counterpartyDrives: InhabitantDrives,
  give: readonly ResourceAmount[],
  receive: readonly ResourceAmount[],
): boolean {
  const received = totalValue(rules, give);
  const given = totalValue(rules, receive);
  const demand = 1 + counterpartyDrives.thrift - counterpartyDrives.greed;
  return received >= given * demand;
}
