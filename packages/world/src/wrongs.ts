// Wrongs between mortals, decided by persisted state and the persisted PRNG alone.
//
// A mortal's temperament sets the odds of each wrong (`rules.temperamentOdds`, per mille per tick), and
// an open need multiplies them. Four kinds (theft, cheating, feud) are drawn; two come from a credit trade
// that fails (unpaid debt, broken agreement); a revenge is the victim's one feud, after its prayer about a
// wrong was refused or lapsed. Every wrong is one `wrong` event the victim knows and prays about.
//
// The step draws in a fixed order: credit judgments, then the wrongs, then revenge, each over mortals in
// id order, and it runs before the fire step and the director so a replay draws the same values.

import type {
  CreditExtendedEvent,
  CreditSettledEvent,
  EntityId,
  EventId,
  Temperament,
  WrongEvent,
  WrongKind,
} from "@panthea/contracts";
import {
  consumeAmountOf,
  debitActorInventory,
  mostValuableGood,
  resourceValue,
  transferBetweenActors,
} from "./economy";
import { petitionBalanceOf } from "./petitions";
import {
  type ActorState,
  type Credit,
  nextPrngValue,
  type PrngState,
  type WorldEventDraft,
  type WorldState,
} from "./state";

export interface WrongStep {
  readonly events: readonly WorldEventDraft[];
  readonly prng: PrngState;
}

const balance = (state: WorldState, key: string) =>
  petitionBalanceOf(state.rules, key);

const temperamentOf = (actor: ActorState): Temperament =>
  actor.temperament ?? "honest";

/** Per-mille odds a mortal of this temperament has of `kind` (or, for `revenge`, of taking it) in a tick. */
function oddsOf(state: WorldState, actor: ActorState, kind: string): number {
  return state.rules.temperamentOdds?.[temperamentOf(actor)]?.[kind] ?? 0;
}

/** The living mortals, in id order: who wrongs and who is wronged. */
function mortalsOf(state: WorldState): ActorState[] {
  return [...state.actors.values()]
    .filter((actor) => actor.alive && actor.isDeity !== true && actor.drives)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** What each actor holds as the step's own drafts would leave it, so two wrongs in a tick never take the same goods twice. */
class Ledger {
  private readonly delta = new Map<string, number>();
  constructor(private readonly state: WorldState) {}
  held(actor: EntityId, resource: string): number {
    return (
      (this.state.actors.get(actor)?.inventory.get(resource) ?? 0) +
      (this.delta.get(`${actor}|${resource}`) ?? 0)
    );
  }
  inventory(actor: EntityId): ReadonlyMap<string, number> {
    const held = new Map(this.state.actors.get(actor)?.inventory);
    for (const [key, change] of this.delta) {
      const [who, resource] = key.split("|") as [string, string];
      if (who === actor) held.set(resource, (held.get(resource) ?? 0) + change);
    }
    return held;
  }
  move(
    from: EntityId | undefined,
    to: EntityId | undefined,
    resource: string,
    amount: number,
  ) {
    for (const [who, sign] of [
      [from, -1],
      [to, 1],
    ] as const) {
      if (who === undefined) continue;
      const key = `${who}|${resource}`;
      this.delta.set(key, (this.delta.get(key) ?? 0) + sign * amount);
    }
  }
}

const openCredits = (state: WorldState) =>
  [...state.credits.values()].filter((credit) => credit.status === "open");

/** Whether `a` and `b` share a place. */
const together = (a: ActorState, b: ActorState) =>
  a.locationId === b.locationId;

// --- Credit ---------------------------------------------------------------------------------------

/** The credit trades this tick's open needs lead to: goods now and the price later, or the price now and the goods later. */
function extendCredits(
  state: WorldState,
  ledger: Ledger,
  mortals: readonly ActorState[],
  drafts: WorldEventDraft[],
) {
  const busy = new Set<EntityId>();
  for (const credit of openCredits(state)) {
    busy.add(credit.seller);
    busy.add(credit.buyer);
  }
  const deadline = state.tick + balance(state, "creditDeadlineTicks");
  const needs = [...state.needs.values()].sort(
    (a, b) =>
      (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0) ||
      (a.resource < b.resource ? -1 : 1),
  );
  for (const need of needs) {
    const buyer = mortals.find((mortal) => mortal.id === need.actor);
    if (buyer === undefined || busy.has(buyer.id)) continue;
    const amount = need.resource === "food" ? consumeAmountOf(state.rules) : 1;
    const price = amount * resourceValue(state.rules, need.resource);
    const others = mortals.filter(
      (mortal) =>
        mortal.id !== buyer.id &&
        !busy.has(mortal.id) &&
        together(buyer, mortal),
    );
    if (need.reason === "no-funds") {
      const seller = others.find(
        (mortal) => ledger.held(mortal.id, need.resource) >= amount,
      );
      if (seller === undefined) continue;
      ledger.move(seller.id, buyer.id, need.resource, amount);
      drafts.push(
        credit(
          seller.id,
          buyer.id,
          need.resource,
          amount,
          price,
          "payment",
          deadline,
        ),
      );
      busy.add(seller.id).add(buyer.id);
    } else if (
      need.reason === "no-seller" &&
      ledger.held(buyer.id, "currency") >= price
    ) {
      const seller = others.find(
        (mortal) =>
          mortal.gathers === need.resource &&
          ledger.held(mortal.id, need.resource) < amount,
      );
      if (seller === undefined) continue;
      ledger.move(buyer.id, seller.id, "currency", price);
      drafts.push(
        credit(
          seller.id,
          buyer.id,
          need.resource,
          amount,
          price,
          "delivery",
          deadline,
        ),
      );
      busy.add(seller.id).add(buyer.id);
    }
  }
}

function credit(
  seller: EntityId,
  buyer: EntityId,
  resource: string,
  amount: number,
  price: number,
  deferred: "payment" | "delivery",
  deadline: number,
): WorldEventDraft<CreditExtendedEvent> {
  return {
    kind: "credit-extended",
    entityId: seller,
    buyer,
    goods: { resource, amount },
    price: { resource: "currency", amount: price },
    deferred,
    deadline,
  };
}

/**
 * The credit trades whose deadline has come: the party that owes keeps its word when it holds what it owes, unless
 * its temperament's odds of failing a credit say otherwise (one draw, only when the odds are above 0), and fails
 * it when it does not hold it. A failure is a wrong, a debt or an agreement, and closes the credit.
 */
function judgeCredits(
  state: WorldState,
  ledger: Ledger,
  needy: ReadonlySet<EntityId>,
  draw: () => number,
  drafts: WorldEventDraft[],
) {
  const due = openCredits(state)
    .filter((held) => held.deadline <= state.tick)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const held of due) {
    const owes = held.deferred === "payment" ? held.buyer : held.seller;
    const owed = held.deferred === "payment" ? held.seller : held.buyer;
    const debtor = state.actors.get(owes);
    const creditor = state.actors.get(owed);
    if (debtor?.alive !== true || creditor?.alive !== true) continue;
    const side = held.deferred === "payment" ? held.price : held.goods;
    const kind: WrongKind =
      held.deferred === "payment" ? "unpaid-debt" : "broken-agreement";
    const able = ledger.held(owes, side.resource) >= side.amount;
    const odds = oddsOf(state, debtor, kind);
    if (able && (odds === 0 || draw() * 1000 >= odds)) {
      ledger.move(owes, owed, side.resource, side.amount);
      drafts.push({
        kind: "credit-settled",
        entityId: owes,
        credit: held.id,
      } satisfies WorldEventDraft<CreditSettledEvent>);
      continue;
    }
    drafts.push(
      wrong(debtor, owed, kind, side.resource, side.amount, needy.has(owes), {
        credit: held.id,
      }),
    );
  }
}

// --- Wrongs -------------------------------------------------------------------------------------------

function wrong(
  wrongdoer: ActorState,
  victim: EntityId,
  kind: WrongKind,
  resource: string,
  amount: number,
  needy: boolean,
  link: { revenge?: EventId; credit?: EventId } = {},
): WorldEventDraft<WrongEvent> {
  return {
    kind: "wrong",
    entityId: wrongdoer.id,
    victim,
    wrong: kind,
    resource,
    amount,
    temperament: temperamentOf(wrongdoer),
    needy,
    ...link,
  };
}

/** What `kind` would take from `victim` now: goods for a theft or a feud, coin for a cheat; nothing when it holds none. */
function lossFor(
  state: WorldState,
  ledger: Ledger,
  kind: WrongKind,
  victim: ActorState,
): { resource: string; amount: number } | undefined {
  const cap = balance(state, "wrongLossCap");
  if (kind === "cheating") {
    const coin = ledger.held(victim.id, "currency");
    return coin > 0
      ? { resource: "currency", amount: Math.min(coin, cap) }
      : undefined;
  }
  return mostValuableGood(state.rules, ledger.inventory(victim.id), cap, [
    "currency",
  ]);
}

/** Applies a drafted wrong to the ledger, so the next draft sees what it left. */
function settle(ledger: Ledger, draft: WorldEventDraft<WrongEvent>) {
  if (draft.wrong === "theft" || draft.wrong === "cheating") {
    ledger.move(draft.victim, draft.entityId, draft.resource, draft.amount);
  } else if (draft.wrong === "feud") {
    ledger.move(draft.victim, undefined, draft.resource, draft.amount);
  }
}

const RANDOM_KINDS = ["theft", "cheating", "feud"] as const;

/** The tick the mortal last wronged someone, or `undefined` if never: the cooldown counts from it. */
function lastWrongTick(
  state: WorldState,
  mortal: EntityId,
  fresh: readonly WorldEventDraft<WrongEvent>[],
): number | undefined {
  if (fresh.some((draft) => draft.entityId === mortal)) return state.tick;
  let last: number | undefined;
  for (const record of state.wrongs.values()) {
    if (
      record.wrongdoer === mortal &&
      record.revenge === undefined &&
      (last === undefined || record.tick > last)
    ) {
      last = record.tick;
    }
  }
  return last;
}

function drawWrongs(
  state: WorldState,
  ledger: Ledger,
  mortals: readonly ActorState[],
  needy: ReadonlySet<EntityId>,
  draw: (count?: number) => number,
  drafts: WorldEventDraft[],
) {
  const cooldown = balance(state, "wrongCooldownTicks");
  const multiplier = balance(state, "wrongNeedMultiplier");
  const fresh = () =>
    drafts.filter(
      (draft): draft is WorldEventDraft<WrongEvent> => draft.kind === "wrong",
    );
  for (const mortal of mortals) {
    const odds = RANDOM_KINDS.map((kind) => oddsOf(state, mortal, kind));
    if (odds.every((value) => value === 0)) continue;
    const last = lastWrongTick(state, mortal.id, fresh());
    if (last !== undefined && state.tick - last < cooldown) continue;
    const isNeedy = needy.has(mortal.id);
    const scaled = odds.map((value) =>
      Math.min(1000, isNeedy ? value * multiplier : value),
    );
    const roll = draw() * 1000;
    let kind: (typeof RANDOM_KINDS)[number] | undefined;
    let upto = 0;
    for (const [index, value] of scaled.entries()) {
      upto += value;
      if (roll < upto) {
        kind = RANDOM_KINDS[index];
        break;
      }
    }
    if (kind === undefined) continue;
    const victims = mortals.filter(
      (other) =>
        other.id !== mortal.id &&
        together(mortal, other) &&
        lossFor(state, ledger, kind, other) !== undefined,
    );
    if (victims.length === 0) continue;
    const victim = victims[victims.length === 1 ? 0 : draw(victims.length)];
    const loss = victim && lossFor(state, ledger, kind, victim);
    if (victim === undefined || loss === undefined) continue;
    const draft = wrong(
      mortal,
      victim.id,
      kind,
      loss.resource,
      loss.amount,
      isNeedy,
    );
    settle(ledger, draft);
    drafts.push(draft);
  }
}

// --- Revenge ----------------------------------------------------------------------------------------------

/**
 * The revenges this tick takes. A victim whose prayer about a wrong was refused or lapsed may take one feud
 * against the wrongdoer, once per wrong and only for a wrong that is not itself a revenge, while the
 * wrongdoer is alive and beside it with goods to spoil, and within the revenge window. It draws once a tick
 * while it may; the temperament's `revenge` odds say whether it does.
 */
function drawRevenge(
  state: WorldState,
  ledger: Ledger,
  needy: ReadonlySet<EntityId>,
  draw: () => number,
  drafts: WorldEventDraft[],
) {
  const window = balance(state, "revengeWindowTicks");
  const taken = new Set(
    drafts.flatMap((draft) =>
      draft.kind === "wrong" && draft.revenge !== undefined
        ? [draft.revenge]
        : [],
    ),
  );
  const petitions = [...state.petitions.values()];
  const records = [...state.wrongs.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const record of records) {
    if (
      record.revenge !== undefined ||
      record.avenged !== undefined ||
      taken.has(record.id) ||
      state.tick - record.tick > window
    ) {
      continue;
    }
    const victim = state.actors.get(record.victim);
    const wrongdoer = state.actors.get(record.wrongdoer);
    if (victim?.alive !== true || wrongdoer?.alive !== true) continue;
    const unanswered = petitions.some(
      (petition) =>
        petition.cause === record.id &&
        petition.petitioner === record.victim &&
        (petition.status === "lapsed" || petition.status === "refused"),
    );
    if (!unanswered) continue;
    const odds = oddsOf(state, victim, "revenge");
    if (odds === 0 || draw() * 1000 >= odds) continue;
    // Out of reach, or with nothing to spoil: nothing happens and nothing is recorded; it may come later.
    const loss = together(victim, wrongdoer)
      ? lossFor(state, ledger, "feud", wrongdoer)
      : undefined;
    if (loss === undefined) continue;
    const draft = wrong(
      victim,
      wrongdoer.id,
      "feud",
      loss.resource,
      loss.amount,
      needy.has(victim.id),
      { revenge: record.id },
    );
    settle(ledger, draft);
    drafts.push(draft);
  }
}

/**
 * The credit trades and wrongs of this tick, in the order they draw from `prng`: credit judgments, wrongs,
 * revenge. It reads `state` (the tick's, already advanced) and returns drafts and the generator after them.
 */
export function planWrongStep(state: WorldState, prng: PrngState): WrongStep {
  const odds = state.rules.temperamentOdds;
  const credits = state.credits.size > 0;
  if (odds === undefined && !credits) return { events: [], prng };
  let current = prng;
  const next = (): number => {
    const drawn = nextPrngValue(current);
    current = drawn.state;
    return drawn.value;
  };
  const draw = (count?: number): number =>
    count === undefined
      ? next()
      : Math.min(count - 1, Math.floor(next() * count));
  const mortals = mortalsOf(state);
  const ledger = new Ledger(state);
  const needy = new Set([...state.needs.values()].map((need) => need.actor));
  const drafts: WorldEventDraft[] = [];
  extendCredits(state, ledger, mortals, drafts);
  judgeCredits(state, ledger, needy, draw, drafts);
  drawWrongs(state, ledger, mortals, needy, draw, drafts);
  drawRevenge(state, ledger, needy, draw, drafts);
  return { events: drafts, prng: current };
}

// --- Reducers ---------------------------------------------------------------------------------------------

function withCredit(state: WorldState, held: Credit): WorldState {
  return { ...state, credits: new Map(state.credits).set(held.id, held) };
}

/** A wrong lands: the loss moves or is spoiled, it is recorded for a revenge to find, and a credit it failed is closed. */
export function applyWrong(state: WorldState, event: WrongEvent): WorldState {
  let next = state;
  if (event.wrong === "theft" || event.wrong === "cheating") {
    next = transferBetweenActors(
      next,
      event.victim,
      event.entityId,
      [{ resource: event.resource, amount: event.amount }],
      [],
    );
  } else if (event.wrong === "feud") {
    next = debitActorInventory(
      next,
      event.victim,
      event.resource,
      event.amount,
    );
  }
  const wrongs = new Map(next.wrongs);
  wrongs.set(event.id, {
    id: event.id,
    wrongdoer: event.entityId,
    victim: event.victim,
    kind: event.wrong,
    tick: event.tick,
    ...(event.revenge === undefined ? {} : { revenge: event.revenge }),
  });
  const avenged =
    event.revenge === undefined ? undefined : wrongs.get(event.revenge);
  if (avenged !== undefined && event.revenge !== undefined) {
    wrongs.set(event.revenge, { ...avenged, avenged: event.id });
  }
  next = { ...next, wrongs };
  const failed =
    event.credit === undefined ? undefined : next.credits.get(event.credit);
  return failed === undefined
    ? next
    : withCredit(next, { ...failed, status: "defaulted" });
}

/** A credit trade is struck: the side handed over now moves, and the rest is owed. */
export function applyCreditExtended(
  state: WorldState,
  event: CreditExtendedEvent,
): WorldState {
  const moved =
    event.deferred === "payment"
      ? transferBetweenActors(
          state,
          event.entityId,
          event.buyer,
          [event.goods],
          [],
        )
      : transferBetweenActors(
          state,
          event.buyer,
          event.entityId,
          [event.price],
          [],
        );
  return withCredit(moved, {
    id: event.id,
    seller: event.entityId,
    buyer: event.buyer,
    goods: event.goods,
    price: event.price,
    deferred: event.deferred,
    deadline: event.deadline,
    status: "open",
  });
}

/** A credit trade is kept: what was owed moves, and it is closed. */
export function applyCreditSettled(
  state: WorldState,
  event: CreditSettledEvent,
): WorldState {
  const held = state.credits.get(event.credit);
  if (held === undefined) return state;
  const moved =
    held.deferred === "payment"
      ? transferBetweenActors(state, held.buyer, held.seller, [held.price], [])
      : transferBetweenActors(state, held.seller, held.buyer, [held.goods], []);
  return withCredit(moved, { ...held, status: "settled" });
}
