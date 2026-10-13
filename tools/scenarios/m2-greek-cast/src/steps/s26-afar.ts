// S26 and S27: a god answers a prayer from where it stands, through the compiled sidecar, in staged worlds of their own
// (see `staging.ts`: the world is created with the rules that make the cause come within a few ticks, so nothing waits
// on chance, and the chain from there is the real service's).
//
// S26: a trouble in a blessing god's domain takes goods from a mortal, which prays about it to that god. The god is not
// with the mortal: it copies the bless its prompt offers and sends it as written, with no walk first. The world accepts
// it in that one turn, the prayer is answered, the god has not moved, the mortals at the blessed one's place perceive it,
// and none of them learns where the god is.
//
// S27: a mortal prays to a god to punish a wrongdoer who owns a building the prayer lists. The god, away from both,
// copies the strike on the building its prompt offers and sends it as written. The world damages the building in that
// one turn, the prayer is answered, the god has not moved, the mortals at the building's place perceive it, and none of
// them learns where the god is.
//
// The controls leave the god's remote line out of what it sends: it only waits, as a god told to walk first would when
// it has not walked, and the step fails at its own wait.

import type { WorldEvent } from "@panthea/contracts";
import { perceive, toEntityId, type WorldState } from "@panthea/world";
import type { Recorder, Story } from "./context";
import { storedEvents } from "./practice";
import {
  BLESSERS,
  inStagedWorld,
  isAlive,
  patronOf,
  STRIKERS,
  type StagedWorld,
  stagePrayer,
  withGod,
} from "./staging";
import { check, stateOf, waitFor } from "./support";

/** Seconds a scripted god is given to take its turn: the world gives each of the seven one in a few. */
const GOD_TURN_MS = 20_000;

/**
 * Where `god` stands, and whether it has journeyed or moved since `since` (a sequence): nothing the god did in answering
 * may have moved it, and it must have no journey under way.
 */
function stayed(
  world: StagedWorld,
  state: WorldState,
  god: string,
  before: string,
  since: number,
): { readonly ok: boolean; readonly detail: string } {
  const now = String(state.actors.get(toEntityId(god))?.locationId);
  const moved = storedEvents(world).filter(
    (e) =>
      e.kind === "entity-moved" &&
      e.entityId === god &&
      Number(e.sequence) > since,
  );
  const journeying = state.journeys.has(toEntityId(god));
  return {
    ok: now === before && moved.length === 0 && !journeying,
    detail: `at ${before} then ${now}; ${moved.length} moves; journey ${journeying}`,
  };
}

/**
 * The world as it stood when the event at `sequence` was committed: every actor's place rewound by the moves that came
 * after it (the event window the perception reads is the same, so a mortal that has since walked away is where it was).
 */
function rewound(
  world: StagedWorld,
  state: WorldState,
  sequence: number,
  tick: number,
): WorldState {
  let actors = new Map(state.actors);
  const later = storedEvents(world)
    .filter((e) => e.kind === "entity-moved" && Number(e.sequence) > sequence)
    .reverse();
  for (const move of later) {
    const who = toEntityId(String(move.entityId));
    const actor = actors.get(who);
    if (actor !== undefined) {
      actors = new Map(actors).set(who, {
        ...actor,
        locationId: toEntityId(String(move.from)),
      });
    }
  }
  return { ...state, actors, tick };
}

/**
 * R7 from the mortals' side: those standing at `place` when `event` happened perceive it, the god (standing elsewhere)
 * is in none of their scenes, and none perceives an event placed at the god's own place (its divinity spent).
 */
function perceivedByMortalsAt(
  world: StagedWorld,
  now: WorldState,
  event: { readonly [key: string]: unknown },
  place: string,
  godPlace: string,
  kinds: readonly string[],
  god: string,
): { readonly ok: boolean; readonly detail: string } {
  const then = rewound(world, now, Number(event.sequence), Number(event.tick));
  const events = storedEvents(world).filter(
    (e) => Number(e.sequence) <= Number(event.sequence),
  ) as unknown as WorldEvent[];
  const here = [...then.actors.values()].filter(
    (a) => a.alive && a.isDeity !== true && String(a.locationId) === place,
  );
  if (here.length === 0) {
    return { ok: false, detail: `no mortal stood at ${place}` };
  }
  let sawIt = 0;
  const leaks: string[] = [];
  for (const mortal of here) {
    const seen = perceive(then, mortal.id, events);
    if (seen === null || seen === undefined) continue;
    if (seen.events.some((e) => kinds.includes(e.kind))) sawIt += 1;
    if (seen.actors.some((a) => String(a.id) === god)) {
      leaks.push(`${mortal.id} sees ${god} in the scene`);
    }
    if (
      seen.events.some(
        (e) =>
          e.kind === "resource-consumed" &&
          e.subjects.some((subject) => String(subject) === god),
      )
    ) {
      leaks.push(`${mortal.id} sees ${god} spend divinity at ${godPlace}`);
    }
  }
  return {
    ok: sawIt === here.length && leaks.length === 0,
    detail: `${sawIt} of ${here.length} mortals at ${place} perceived ${kinds.join(" or ")}; ${leaks.join("; ") || `none saw the god, nor anything at ${godPlace}`}`,
  };
}

export async function stepRemoteBless(
  recorder: Recorder,
  story: Story,
): Promise<void> {
  await recorder.run(
    "S26",
    "A god answers a prayer with a blessing from where it stands: one turn, no walk, the effect at the blessed one's place",
    "In a world whose gods each have a trouble within a few ticks, a trouble in a blessing god's domain takes goods from a mortal that reveres another god, and it prays about it to that god. The god is not with the mortal and copies the bless its prompt offers, as written: the world accepts it in that one turn, the prayer is answered, the god has not moved and has no journey, the mortals at the blessed one's place perceive the blessing, and none of them learns where the god is. With the god only waiting, as one that has not walked first would, the blessing never comes and the step fails at its wait.",
    async (step) => {
      await inStagedWorld(
        story,
        "remote-bless",
        { petition: { troubleFloorTicks: 3 }, odds: {} },
        async (world) => {
          const found = await waitFor(
            "a trouble in a blessing god's domain takes goods from a mortal that reveres another god",
            async () => {
              const state = await stateOf(world);
              for (const trouble of storedEvents(world)) {
                if (trouble.kind !== "trouble") continue;
                const domain = String(trouble.god);
                const mortal = String(trouble.entityId);
                const patron = patronOf(state, mortal);
                const at = state.actors.get(toEntityId(mortal))?.locationId;
                const godAt = state.actors.get(toEntityId(domain))?.locationId;
                if (
                  (trouble.loss as { kind?: string }).kind === "resource" &&
                  BLESSERS.includes(domain) &&
                  patron !== "" &&
                  patron !== domain &&
                  isAlive(state, mortal) &&
                  at !== undefined &&
                  godAt !== undefined &&
                  at !== godAt
                ) {
                  return { trouble, mortal, domain };
                }
              }
              return undefined;
            },
            { timeoutMs: 25_000, intervalMs: 300 },
          );
          const { trouble, mortal, domain } = found;
          const prayer = await stagePrayer(
            world,
            mortal,
            trouble.id,
            `${mortal} prays about the ${trouble.trouble}`,
          );
          check(
            String(prayer.god) === domain,
            "the prayer about the trouble goes to the god of its domain",
            `${prayer.god}; ${domain}`,
          );

          // The god stands apart from the mortal now: it is shown the bless and sends it as written.
          const before = await stateOf(world);
          const godBefore = String(
            before.actors.get(toEntityId(domain))?.locationId,
          );
          const mortalPlace = String(
            before.actors.get(toEntityId(mortal))?.locationId,
          );
          check(
            godBefore !== mortalPlace,
            `${domain} is not with ${mortal}`,
            `${godBefore}; ${mortalPlace}`,
          );
          const since = Number(storedEvents(world).at(-1)?.sequence ?? 0);
          const sabotaged = story.options.control === "remote-bless";
          const blessing = await withGod(
            world,
            domain,
            sabotaged
              ? undefined
              : `{"action":"bless","petition":"${prayer.id}"`,
            () =>
              waitFor(
                `${domain} blesses ${mortal} from where it stands`,
                () =>
                  storedEvents(world).find(
                    (e) =>
                      e.kind === "blessing-granted" &&
                      e.petitionId === prayer.id,
                  ),
                { timeoutMs: GOD_TURN_MS, intervalMs: 200 },
              ),
          );
          const after = await stateOf(world);
          check(
            after.petitions.get(prayer.id as never)?.status === "answered",
            "the blessing answers the prayer in that one turn",
            String(after.petitions.get(prayer.id as never)?.status),
          );
          const still = stayed(world, after, domain, godBefore, since);
          check(
            still.ok,
            `${domain} did not move to bless from afar`,
            still.detail,
          );
          const placeThen = String(
            rewound(
              world,
              after,
              Number(blessing.sequence),
              Number(blessing.tick),
            ).actors.get(toEntityId(mortal))?.locationId,
          );
          const seen = perceivedByMortalsAt(
            world,
            after,
            blessing,
            placeThen,
            godBefore,
            ["blessing-granted"],
            domain,
          );
          check(
            seen.ok,
            "the mortals at the blessed one's place perceive the blessing and learn nothing of where the god is",
            seen.detail,
          );
          step.done(
            `${trouble.id}: a ${trouble.trouble} took goods from ${mortal}, who reveres ${patronOf(before, mortal)}, and it prayed to ${domain} [${prayer.id}]; ${domain}, at ${godBefore} and not at ${mortalPlace}, blessed it in one turn [${blessing.id}] without moving: ${seen.detail}`,
          );
        },
      );
    },
  );
}

export async function stepRemoteStrike(
  recorder: Recorder,
  story: Story,
): Promise<void> {
  await recorder.run(
    "S27",
    "A god answers a punish prayer by striking a building it lists from where it stands: one turn, no walk, the effect at the building's place",
    "In a world made with every mortal certain to steal, a theft's victim prays to a god that can strike to punish a wrongdoer who owns a building, and the prayer lists the building. The god is away from both and copies the strike on the building its prompt offers, as written: the world damages the building in that one turn, the prayer is answered, the god has not moved and has no journey, the mortals at the building's place perceive it, and none of them learns where the god is. With the god only waiting, the building is never struck and the step fails at its wait.",
    async (step) => {
      await inStagedWorld(
        story,
        "remote-strike",
        {
          // Every temperament steals, so a mortal that owns a building does too: the prayer to punish it lists the building.
          odds: {
            greedy: { theft: 1000 },
            quarrelsome: { theft: 1000 },
            proud: { theft: 1000 },
            honest: { theft: 1000 },
          },
        },
        async (world) => {
          const found = await waitFor(
            "a theft whose wrongdoer owns a building, the victim's patron a god that can strike and not with either",
            async () => {
              const state = await stateOf(world);
              for (const wrong of storedEvents(world)) {
                if (wrong.kind !== "wrong") continue;
                const victim = String(wrong.victim);
                const wrongdoer = String(wrong.entityId);
                const patron = patronOf(state, victim);
                const owned = [...state.buildings.values()].find(
                  (b) =>
                    b.owner !== undefined &&
                    String(b.owner) === wrongdoer &&
                    b.status === "operational",
                );
                const godAt = state.actors.get(toEntityId(patron))?.locationId;
                const victimAt = state.actors.get(
                  toEntityId(victim),
                )?.locationId;
                if (
                  STRIKERS.includes(patron) &&
                  owned !== undefined &&
                  godAt !== undefined &&
                  godAt !== owned.locationId &&
                  godAt !== victimAt &&
                  isAlive(state, victim) &&
                  isAlive(state, wrongdoer)
                ) {
                  return { wrong, victim, wrongdoer, patron, building: owned };
                }
              }
              return undefined;
            },
            { timeoutMs: 15_000, intervalMs: 300 },
          );
          const { wrong, victim, wrongdoer, patron, building } = found;
          const prayer = await stagePrayer(
            world,
            victim,
            wrong.id,
            `${victim} prays about the theft`,
          );
          const request = prayer.request as
            | { kind?: string; offender?: string; buildings?: string[] }
            | undefined;
          check(
            String(prayer.god) === patron &&
              request?.kind === "punish" &&
              request.offender === wrongdoer &&
              (request.buildings ?? []).includes(String(building.id)),
            "the victim's prayer goes to its own patron and lists the wrongdoer's building",
            `${prayer.god}; ${JSON.stringify(request)}`,
          );

          const before = await stateOf(world);
          const godBefore = String(
            before.actors.get(toEntityId(patron))?.locationId,
          );
          const buildingPlace = String(
            before.buildings.get(building.id)?.locationId,
          );
          check(
            godBefore !== buildingPlace,
            `${patron} is not at ${building.id}`,
            `${godBefore}; ${buildingPlace}`,
          );
          const since = Number(storedEvents(world).at(-1)?.sequence ?? 0);
          const sabotaged = story.options.control === "remote-strike";
          const hit = await withGod(
            world,
            patron,
            sabotaged
              ? undefined
              : `{"action":"strike","target":"${building.id}"`,
            () =>
              waitFor(
                `${patron} strikes ${building.id} from where it stands`,
                () =>
                  storedEvents(world).find(
                    (e) =>
                      (e.kind === "building-damaged" ||
                        e.kind === "building-ignited") &&
                      e.entityId === building.id,
                  ),
                { timeoutMs: GOD_TURN_MS, intervalMs: 200 },
              ),
          );
          const after = await stateOf(world);
          check(
            after.petitions.get(prayer.id as never)?.status === "answered",
            "the strike on the listed building answers the prayer in that one turn",
            String(after.petitions.get(prayer.id as never)?.status),
          );
          const still = stayed(world, after, patron, godBefore, since);
          check(
            still.ok,
            `${patron} did not move to strike from afar`,
            still.detail,
          );
          const seen = perceivedByMortalsAt(
            world,
            after,
            hit,
            buildingPlace,
            godBefore,
            ["building-damaged", "building-ignited"],
            patron,
          );
          check(
            seen.ok,
            "the mortals at the building's place perceive the strike and learn nothing of where the god is",
            seen.detail,
          );
          step.done(
            `${wrong.id}: ${wrongdoer} stole from ${victim}, who prayed to ${patron} [${prayer.id}] to punish it and its ${building.id}; ${patron}, at ${godBefore} and not at ${buildingPlace}, struck the building in one turn [${hit.id}] without moving: ${seen.detail}`,
          );
        },
      );
    },
  );
}
