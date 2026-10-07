// S21 and S22: what a wrong between mortals leads to, through the compiled sidecar, in staged worlds of their own
// (see `staging.ts`: the world is created with the odds that make the thing happen on its first ticks, so nothing
// waits on chance, and the chain from there is the real service's).
//
// S21: a theft between mortals of different patrons becomes the victim's prayer to its patron, who punishes the
// wrongdoer (the world takes its goods, and the strike is an act the contests count); the wrongdoer, harmed by a
// god, prays to its own patron naming that god, who demands redress of it, citing the harm.
//
// S22: a victim whose patron refuses its prayer takes one revenge; the wrongdoer's prayer about that revenge is
// refused too, and it takes none: revenge is damped.

import { toEntityId } from "@panthea/world";
import type { Recorder, Story } from "./context";
import { eventsOfKind, storedEvents } from "./practice";
import {
  inStagedWorld,
  isAlive,
  patronOf,
  STRIKERS,
  stagePrayer,
  withGod,
} from "./staging";
import { check, stateOf, waitFor } from "./support";

/** The most a strike takes of a mortal's goods (`strikeGoodsCap`). */
const STRIKE_CAP = 2;

/** Seconds a scripted god is given to take its turn: the world gives each of the seven one in a few. */
const GOD_TURN_MS = 20_000;

export async function stepWrongChain(
  recorder: Recorder,
  story: Story,
): Promise<void> {
  await recorder.run(
    "S21",
    "A wrong between mortals of different patrons reaches both patrons: the victim's patron punishes the wrongdoer's goods, and the wrongdoer prays to its own patron, who demands redress of the god that struck it",
    "In a world made with greedy mortals certain to steal from whoever stands beside them, a theft between mortals of different patrons becomes the victim's prayer to its patron, who strikes the wrongdoer: the world takes the mortal's most valuable carried good up to the cap, the prayer is answered, and the strike is an act the contests count. The wrongdoer, struck by a god, prays to its own patron naming the god that struck it, and that patron demands redress of the god, citing the harm, which the world opens as a thread. With the victim's patron only waiting, the wrongdoer is never struck and the chain stops at the strike.",
    async (step) => {
      await inStagedWorld(
        story,
        "wrong-chain",
        { odds: { greedy: { theft: 1000 } } },
        async (world) => {
          // The world draws the thefts on its first ticks; this is a theft whose parties have different patrons.
          const found = await waitFor(
            "a theft between mortals of different patrons, the victim's patron a god that can strike",
            async () => {
              const state = await stateOf(world);
              for (const wrong of storedEvents(world)) {
                if (wrong.kind !== "wrong") continue;
                const victim = String(wrong.victim);
                const wrongdoer = String(wrong.entityId);
                const patron = patronOf(state, victim);
                const theirs = patronOf(state, wrongdoer);
                if (
                  patron !== "" &&
                  theirs !== "" &&
                  patron !== theirs &&
                  STRIKERS.includes(patron) &&
                  isAlive(state, victim) &&
                  isAlive(state, wrongdoer)
                ) {
                  return { wrong, victim, wrongdoer, patron, theirs };
                }
              }
              return undefined;
            },
            { timeoutMs: 15_000, intervalMs: 300 },
          );
          const { wrong, victim, wrongdoer, patron, theirs } = found;

          // The victim prays about it to its patron.
          const prayer = await stagePrayer(
            world,
            victim,
            wrong.id,
            `${victim} prays about the theft`,
          );
          const request = prayer.request as
            | { kind?: string; offender?: string }
            | undefined;
          check(
            String(prayer.god) === patron &&
              request?.kind === "punish" &&
              request.offender === wrongdoer,
            "the victim's prayer goes to its own patron and asks it to punish the wrongdoer",
            `${prayer.god}; ${JSON.stringify(request)}`,
          );

          // The victim's patron strikes the wrongdoer, copying the object its prayer's entry offers.
          const sabotaged = story.options.control === "strike-chain";
          const strike = await withGod(
            world,
            patron,
            sabotaged
              ? undefined
              : `{"action":"strike","target":"${wrongdoer}"`,
            () =>
              waitFor(
                `${patron} strikes ${wrongdoer}, the wrongdoer of ${victim}'s prayer`,
                () =>
                  storedEvents(world).find(
                    (e) =>
                      e.kind === "mortal-struck" &&
                      e.entityId === wrongdoer &&
                      e.actor === patron,
                  ),
                { timeoutMs: GOD_TURN_MS, intervalMs: 200 },
              ),
          );
          const taken = Number(strike.amount);
          check(
            taken >= 0 &&
              taken <= STRIKE_CAP &&
              (strike.resource === undefined) === (taken === 0),
            "the strike took goods up to the cap, or nothing when the mortal carried none",
            JSON.stringify(strike),
          );
          const struck = await stateOf(world);
          check(
            struck.petitions.get(prayer.id as never)?.status === "answered",
            "the victim's prayer is answered by the strike on its wrongdoer",
            String(struck.petitions.get(prayer.id as never)?.status),
          );
          check(
            struck.services.some(
              (act) =>
                act.kind === "strike" &&
                String(act.god) === patron &&
                act.tick === Number(strike.tick),
            ),
            "the strike on a mortal is an act the contests count",
            `${patron}'s acts: ${struck.services
              .filter((s) => String(s.god) === patron)
              .map((s) => `${s.kind}@${s.tick}`)
              .join(", ")}`,
          );

          // The wrongdoer, struck by a god, prays to its own patron, naming that god.
          const harmed = await stagePrayer(
            world,
            wrongdoer,
            strike.id,
            `${wrongdoer} prays about the strike`,
          );
          const heard = (await stateOf(world)).petitions.get(
            harmed.id as never,
          );
          check(
            String(harmed.god) === theirs &&
              heard?.about.kind === "harm" &&
              String(heard.about.offender) === patron,
            "the wrongdoer's prayer goes to its own patron and names the god that struck it",
            `${harmed.god}; ${JSON.stringify(heard?.about)}`,
          );

          // That patron demands redress of the god, citing the harm.
          const demand = await withGod(
            world,
            theirs,
            `{"action":"practice","move":"demand","cause":"${strike.id}"`,
            () =>
              waitFor(
                `${theirs} demands redress of ${patron}, citing the harm`,
                () =>
                  eventsOfKind(
                    world,
                    "practice-opened",
                    (e) =>
                      e.entityId === theirs &&
                      e.counterparty === patron &&
                      Array.isArray(e.causes) &&
                      (e.causes as unknown[]).includes(strike.id),
                  )[0],
                { timeoutMs: GOD_TURN_MS, intervalMs: 200 },
              ),
          );
          check(
            [...(await stateOf(world)).threads.keys()].includes(
              demand.id as never,
            ),
            "the world holds the demand as a thread between the two gods",
            String(demand.id),
          );
          step.done(
            `${wrong.id}: ${wrongdoer} stole from ${victim}; ${victim} prayed to ${patron} [${prayer.id}], who struck ${wrongdoer} (${taken} ${strike.resource ?? "of nothing"}) [${strike.id}]; ${wrongdoer} prayed to ${theirs} naming ${patron} [${harmed.id}], who demanded redress [${demand.id}]`,
          );
        },
      );
    },
  );
}

export async function stepRevenge(
  recorder: Recorder,
  story: Story,
): Promise<void> {
  await recorder.run(
    "S22",
    "A refused prayer leaves the victim one revenge, and the revenge is damped",
    "In a world made with greedy mortals certain to steal, and every victim certain to take revenge once its prayer about the wrong is refused or lapses, a theft's victim prays to its patron. The patron refuses the prayer: the world closes it as refused and the victim remembers the refusal. The victim then takes one revenge on the wrongdoer, a feud the world records as an answer to that wrong, and the wrong is marked avenged. The wrongdoer prays to its own patron about the revenge and is refused too, and over the ticks after it takes none: there is exactly one revenge, and a revenge is never avenged. With the patron answering the prayer by striking the wrongdoer instead, there is no revenge.",
    async (step) => {
      const answering = story.options.control === "refusal-revenge";
      await inStagedWorld(
        story,
        "revenge",
        {
          odds: {
            greedy: { theft: 1000, revenge: 1000 },
            quarrelsome: { revenge: 1000 },
            proud: { revenge: 1000 },
            honest: { revenge: 1000 },
          },
        },
        async (world) => {
          // A theft between mortals who live at one place, so the victim, once it is home from the altar, is beside the
          // wrongdoer again and its revenge is drawn at once. (The control has the patron strike, so it needs one that can.)
          const found = await waitFor(
            "a theft between mortals who live at one place",
            async () => {
              const state = await stateOf(world);
              for (const wrong of storedEvents(world)) {
                if (wrong.kind !== "wrong") continue;
                const victim = String(wrong.victim);
                const wrongdoer = String(wrong.entityId);
                const patron = patronOf(state, victim);
                const them = state.actors.get(toEntityId(wrongdoer));
                const us = state.actors.get(toEntityId(victim));
                if (
                  patron !== "" &&
                  patronOf(state, wrongdoer) !== "" &&
                  (!answering || STRIKERS.includes(patron)) &&
                  isAlive(state, victim) &&
                  isAlive(state, wrongdoer) &&
                  us?.home !== undefined &&
                  us.home === them?.home
                ) {
                  return {
                    wrong,
                    victim,
                    wrongdoer,
                    patron,
                    theirs: patronOf(state, wrongdoer),
                  };
                }
              }
              return undefined;
            },
            { timeoutMs: 15_000, intervalMs: 300 },
          );
          const { wrong, victim, wrongdoer, patron, theirs } = found;
          const prayer = await stagePrayer(
            world,
            victim,
            wrong.id,
            `${victim} prays about the theft`,
          );

          // The patron refuses the prayer; with the control it answers by striking the wrongdoer instead.
          const refusal = await withGod(
            world,
            patron,
            answering
              ? `{"action":"strike","target":"${wrongdoer}"`
              : `{"action":"refuse","petition":"${prayer.id}"`,
            () =>
              waitFor(
                `${patron} ${answering ? "answers" : "refuses"} ${victim}'s prayer`,
                () =>
                  storedEvents(world).find(
                    (e) =>
                      (e.kind === "petition-refused" ||
                        e.kind === "petition-answered") &&
                      e.petitionId === prayer.id,
                  ),
                { timeoutMs: GOD_TURN_MS, intervalMs: 200 },
              ),
          );
          if (!answering) {
            const closed = await stateOf(world);
            check(
              refusal.kind === "petition-refused" &&
                closed.petitions.get(prayer.id as never)?.status === "refused",
              "the world closes the prayer as refused",
              `${refusal.kind}; ${closed.petitions.get(prayer.id as never)?.status}`,
            );
            check(
              (closed.memories.get(toEntityId(victim)) ?? []).some(
                (m) =>
                  m.kind === "sign" &&
                  m.outcome === "refused" &&
                  String(m.god) === patron,
              ),
              "the victim remembers the refusal as harm by its patron",
              "no sign memory",
            );
          }

          // One revenge, an answer to that wrong: the victim walks home, is beside the wrongdoer, and draws.
          const revenge = await waitFor(
            `${victim} takes revenge on ${wrongdoer} for ${wrong.id}`,
            () =>
              storedEvents(world).find(
                (e) =>
                  e.kind === "wrong" &&
                  e.revenge === wrong.id &&
                  e.entityId === victim &&
                  e.victim === wrongdoer,
              ),
            { timeoutMs: 20_000, intervalMs: 200 },
          );
          const now = await stateOf(world);
          check(
            now.wrongs.get(wrong.id as never)?.avenged === revenge.id &&
              now.wrongs.get(revenge.id as never)?.revenge === wrong.id &&
              now.wrongs.get(revenge.id as never)?.avenged === undefined,
            "the wrong is marked avenged by the revenge, which is itself avenged by no one",
            JSON.stringify([
              now.wrongs.get(wrong.id as never),
              now.wrongs.get(revenge.id as never),
            ]),
          );

          // The wrongdoer prays about the revenge to its own patron, is refused, and, though every victim here is
          // certain to take revenge, takes none: the world never avenges a revenge.
          const aboutRevenge = await stagePrayer(
            world,
            wrongdoer,
            revenge.id,
            `${wrongdoer} prays about the revenge`,
          );
          await withGod(
            world,
            theirs,
            `{"action":"refuse","petition":"${aboutRevenge.id}"`,
            () =>
              waitFor(
                `${theirs} refuses ${wrongdoer}'s prayer about the revenge`,
                () =>
                  eventsOfKind(
                    world,
                    "petition-refused",
                    (e) => e.petitionId === aboutRevenge.id,
                  )[0],
                { timeoutMs: GOD_TURN_MS, intervalMs: 200 },
              ),
          );
          const refusedAt = (await stateOf(world)).tick;
          await waitFor(
            "eight ticks pass after the refusal",
            async () =>
              (await stateOf(world)).tick >= refusedAt + 8 ? true : undefined,
            { timeoutMs: 15_000, intervalMs: 200 },
          );
          const revenges = eventsOfKind(
            world,
            "wrong",
            (e) => e.revenge === wrong.id || e.revenge === revenge.id,
          );
          check(
            revenges.length === 1 && revenges[0]?.id === revenge.id,
            "there is exactly one revenge, and none of the revenge: revenge is damped",
            JSON.stringify(revenges.map((e) => [e.id, e.entityId, e.revenge])),
          );
          step.done(
            `${wrongdoer} stole from ${victim} [${wrong.id}]; ${patron} refused the prayer [${prayer.id}] and ${victim} took one revenge [${revenge.id}]; ${theirs} refused ${wrongdoer}'s prayer about it [${aboutRevenge.id}] and, eight ticks on, there is no second revenge`,
          );
        },
      );
    },
  );
}
