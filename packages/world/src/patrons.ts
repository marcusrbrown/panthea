// Defection: a mortal whose patron neglects it takes the god that last answered it.
//
// Judged in the tick, after the prayers that ended in it (answered, refused, lapsed) have moved the
// feelings: a mortal whose affinity for its patron is below `defectionAffinity` takes as its patron the
// last other god that answered one of its prayers, or keeps its patron when none has. There is no
// cooldown. The change is a `patron-changed` event, so a replay rebuilds it, and it is private: only
// the god lost and the god gained remember it (`patronageMemories`).

import type { EntityId, EventId, PatronChangedEvent } from "@panthea/contracts";
import { changeStanding } from "./contests";
import { getMemories, getRelationship } from "./memory";
import { petitionBalanceOf } from "./petitions";
import { practiceBalanceOf } from "./practices";
import {
  getActor,
  type MemoryEntry,
  type WorldEventDraft,
  type WorldState,
} from "./state";

/** Most ignored prayers a defection cites, newest first. */
const MAX_CITED = 5;

type Sign = Extract<MemoryEntry, { kind: "sign" }>;

const signsOf = (state: WorldState, mortal: EntityId): Sign[] =>
  getMemories(state, mortal).filter(
    (memory): memory is Sign => memory.kind === "sign",
  );

/** The change of patron `mortal` makes now, if its patron neglected it and another god answered it. */
function defectionOf(
  state: WorldState,
  mortal: EntityId,
): WorldEventDraft<PatronChangedEvent> | undefined {
  const actor = getActor(state, mortal);
  const patron = state.patrons.get(mortal);
  if (actor?.alive !== true || actor.isDeity === true || patron === undefined) {
    return undefined;
  }
  const affinity = getRelationship(state, mortal, patron)?.affinity ?? 0;
  if (affinity >= petitionBalanceOf(state.rules, "defectionAffinity")) {
    return undefined;
  }
  const signs = signsOf(state, mortal);
  const answered = signs
    .filter(
      (sign) =>
        sign.outcome === "answered" &&
        sign.god !== patron &&
        getActor(state, sign.god)?.alive === true,
    )
    .sort((a, b) => b.recordedAt - a.recordedAt)[0];
  if (answered === undefined) return undefined;
  const unanswered = signs
    .filter((sign) => sign.god === patron && sign.outcome !== "answered")
    .sort((a, b) => b.recordedAt - a.recordedAt)
    .slice(0, MAX_CITED)
    .map((sign) => sign.petitionId);
  return {
    kind: "patron-changed",
    entityId: mortal,
    from: patron,
    to: answered.god,
    answered: answered.petitionId,
    unanswered,
  };
}

/**
 * The defections this tick's prayer endings cause: for each mortal whose prayer was answered, refused, or
 * lapsed in it, in id order, one `patron-changed` draft citing that ending, when it defects now.
 */
export function planDefections(
  state: WorldState,
  endings: readonly {
    readonly mortal: EntityId;
    readonly event: { readonly id: EventId };
  }[],
): readonly {
  readonly draft: WorldEventDraft;
  readonly cause: { readonly id: EventId };
}[] {
  const first = new Map<EntityId, { readonly id: EventId }>();
  for (const { mortal, event } of endings) {
    if (!first.has(mortal)) first.set(mortal, event);
  }
  return [...first.keys()].sort().flatMap((mortal) => {
    const defection = defectionOf(state, mortal);
    const cause = first.get(mortal);
    return defection === undefined || cause === undefined
      ? []
      : [{ draft: defection, cause }];
  });
}

/**
 * A mortal's patron changes, and the places it lives in feel it: the god lost has one worshipper fewer there
 * and the god gained one more, each by `standingDelta`, held within the affinity limit.
 */
export function applyPatronChanged(
  state: WorldState,
  event: PatronChangedEvent,
): WorldState {
  const mortal = getActor(state, event.entityId);
  if (mortal === undefined) return state;
  const patrons = new Map(state.patrons).set(event.entityId, event.to);
  const home = mortal.home ?? mortal.locationId;
  const delta = practiceBalanceOf(state.rules, "standingDelta");
  return changeStanding(
    changeStanding({ ...state, patrons }, event.from, home, -delta),
    event.to,
    home,
    delta,
  );
}
