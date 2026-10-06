// S24: a neglected mortal defects to the god that answered it, through the compiled sidecar, in a staged world of its
// own (see `staging.ts`: the defection threshold is above any feeling, so a mortal whose prayer ends with another god
// having answered it defects at once, and the trouble that gives a god the chance to answer comes within a few ticks).
//
// The world does the chain: a trouble in a blessing god's domain takes goods from a mortal that reveres another god,
// which prays about it to the domain god. A god strikes the mortal, which prays about the harm to its patron, who
// refuses: no other god has answered it, so it keeps its patron. Then the harness has the domain god bless the first
// prayer: it ends with the mortal's feeling for its patron below the threshold, and the world moves it to the god that
// answered it. Only the god lost and the god gained
// remember it, and the god lost may open a contest over the mortal's home. With no god having answered it, the
// mortal keeps its patron however many prayers are refused.

import { toEntityId } from "@panthea/world";
import type { Recorder, Story } from "./context";
import { eventsOfKind, storedEvents } from "./practice";
import {
  BLESSERS,
  inStagedWorld,
  isAlive,
  patronOf,
  STRIKERS,
  stageBlessing,
  stagePrayer,
  withGod,
} from "./staging";
import { check, postFixture, stateOf, waitFor } from "./support";

const GODS = [
  "athena",
  "hades",
  "hephaestus",
  "hera",
  "hermes",
  "poseidon",
  "zeus",
];

/** Seconds a scripted god is given to take its turn: the world gives each of the seven one in a few. */
const GOD_TURN_MS = 20_000;

export async function stepDefection(
  recorder: Recorder,
  story: Story,
): Promise<void> {
  await recorder.run(
    "S24",
    "A neglected mortal defects to the god that answered it: only the two gods remember it, and the god it left contests its home",
    "In a world where any feeling below a very high threshold is cause to defect, a trouble in a blessing god's domain takes goods from a mortal that reveres another god, and it prays about it to the domain god. A god strikes the mortal and its patron refuses its prayer about the harm: no god has answered it, so it keeps its patron. The domain god then blesses the first prayer, and the world, as that prayer ends, moves the mortal to the god that answered it: a patron-changed event citing the answered prayer and the one left unanswered. Exactly the god lost and the god gained remember it, each naming the mortal, its home, and the other god, and no one else does. The god lost opens a contest for the mortal's home, resting on that memory, which the world holds without any rivalry, and a god told nothing of the defection is refused one. With no god having answered the mortal, it keeps its patron however many prayers are refused.",
    async (step) => {
      await inStagedWorld(
        story,
        "defection",
        {
          // A floor of 12 ticks: a blessing god's trouble comes within seconds, and the prayers the other troubles open do not
          // crowd the one the step needs out of the patron's prompt (a prompt lists its newest prayers first).
          petition: { troubleFloorTicks: 12, defectionAffinity: 100 },
          odds: {},
        },
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
                if (
                  (trouble.loss as { kind?: string }).kind === "resource" &&
                  BLESSERS.includes(domain) &&
                  patron !== "" &&
                  patron !== domain &&
                  isAlive(state, mortal)
                ) {
                  return { trouble, mortal, domain, patron };
                }
              }
              return undefined;
            },
            { timeoutMs: 25_000, intervalMs: 300 },
          );
          const { trouble, mortal, domain, patron } = found;
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

          // The neglect: a god strikes the mortal, which prays about the harm to its patron, who refuses.
          const state = await stateOf(world);
          const striker = STRIKERS.find(
            (god) =>
              god !== patron &&
              god !== domain &&
              (state.actors.get(toEntityId(god))?.inventory.get("divinity") ??
                0) >= 1,
          );
          check(
            striker !== undefined,
            "a god that can strike stands apart from the mortal's patron and the domain god",
            STRIKERS.join(", "),
          );
          if (striker === undefined) throw new Error("no striker");
          await postFixture(
            world,
            striker,
            { kind: "strike", target: mortal, power: 1 },
            `${striker} strikes ${mortal}`,
          );
          const harm = eventsOfKind(
            world,
            "mortal-struck",
            (e) => e.entityId === mortal,
          )[0];
          check(
            harm !== undefined,
            `${striker}'s strike on ${mortal} lands`,
            "none",
          );
          if (harm === undefined) throw new Error("no strike");
          const prayed = await stagePrayer(
            world,
            mortal,
            harm.id,
            `${mortal} prays about the strike`,
          );
          check(
            String(prayed.god) === patron,
            "the mortal prays about a harm to its own patron",
            `${prayed.god}; patron ${patron}`,
          );
          await withGod(
            world,
            patron,
            `{"action":"refuse","petition":"${prayed.id}"`,
            () =>
              waitFor(
                `${patron} refuses ${mortal}'s prayer`,
                () =>
                  eventsOfKind(
                    world,
                    "petition-refused",
                    (e) => e.petitionId === prayed.id,
                  )[0],
                { timeoutMs: GOD_TURN_MS, intervalMs: 200 },
              ),
          );

          check(
            patronOf(await stateOf(world), mortal) === patron &&
              eventsOfKind(world, "patron-changed").length === 0,
            "refused and unanswered by any other god, the mortal keeps its patron",
            patronOf(await stateOf(world), mortal),
          );

          // Then the god of the domain answers its prayer about the trouble (unless the control leaves it with no answerer):
          // the prayer ends with the mortal's feeling for its patron below the threshold, and another god having answered it.
          const withheld = story.options.control === "no-answerer";
          if (!withheld) {
            await stageBlessing(
              world,
              { id: prayer.id, petitioner: mortal },
              domain,
              `${domain} answers ${mortal}'s prayer`,
            );
            check(
              (await stateOf(world)).petitions.get(prayer.id as never)
                ?.status === "answered",
              `${domain} answered ${mortal}'s prayer`,
              "not answered",
            );
          }

          // The world's own consequence: the defection, in the tick the answer ended the prayer.
          const changed = await waitFor(
            `${mortal} defects to the god that answered it${withheld ? " (the control: no god answered it)" : ""}`,
            () =>
              eventsOfKind(
                world,
                "patron-changed",
                (e) => e.entityId === mortal,
              )[0],
            { timeoutMs: 5_000, intervalMs: 100 },
          );
          check(
            String(changed.from) === patron &&
              String(changed.to) === domain &&
              changed.answered === prayer.id &&
              (changed.unanswered as string[]).includes(String(prayed.id)),
            "the change cites the god lost, the god gained, the answered prayer, and the prayer left unanswered",
            JSON.stringify(changed),
          );
          const now = await stateOf(world);
          const home = String(
            now.actors.get(toEntityId(mortal))?.home ??
              now.actors.get(toEntityId(mortal))?.locationId,
          );
          check(
            patronOf(now, mortal) === domain,
            `${mortal}'s patron is now ${domain}`,
            patronOf(now, mortal),
          );
          const remembered = GODS.filter((god) =>
            (now.memories.get(toEntityId(god)) ?? []).some(
              (m) => m.kind === "patronage" && m.sourceEventId === changed.id,
            ),
          );
          check(
            remembered.length === 2 &&
              remembered.includes(patron) &&
              remembered.includes(domain),
            "exactly the god lost and the god gained remember the change",
            remembered.join(", "),
          );
          for (const [god, other] of [
            [patron, domain],
            [domain, patron],
          ] as const) {
            const memory = (now.memories.get(toEntityId(god)) ?? []).find(
              (m) => m.kind === "patronage" && m.sourceEventId === changed.id,
            );
            check(
              memory?.kind === "patronage" &&
                String(memory.mortal) === mortal &&
                String(memory.home) === home &&
                String(memory.from) === patron &&
                String(memory.to) === domain &&
                memory.subjects.map(String).includes(other),
              `${god} remembers ${mortal}, its home, and ${other}`,
              JSON.stringify(memory),
            );
          }

          // A god told nothing of it is refused a contest over it.
          const stranger = STRIKERS.find((g) => g !== patron && g !== domain);
          if (stranger !== undefined) {
            const row = await postFixture(
              world,
              stranger,
              { kind: "practice", move: "contest", cause: changed.id },
              `${stranger}, told nothing of the defection, tries to contest it`,
            );
            check(
              row.outcome === "rejected",
              "a god that was not told of the defection is refused a contest over it",
              `${row.outcome} ${row.reason}`,
            );
          }

          // The god lost opens a contest for the mortal's home, from its prompt.
          const contest = await withGod(
            world,
            patron,
            `{"action":"practice","move":"contest","act":"${changed.id}"`,
            () =>
              waitFor(
                `${patron} opens a contest over the defection`,
                () =>
                  eventsOfKind(
                    world,
                    "contest-opened",
                    (e) => e.cause === changed.id,
                  )[0],
                { timeoutMs: GOD_TURN_MS, intervalMs: 200 },
              ),
          );
          const held = (await stateOf(world)).contests.get(contest.id as never);
          check(
            held?.status === "open" &&
              String(held.opener) === patron &&
              String(held.rival) === domain &&
              String(held.place) === home &&
              held.cause === changed.id,
            "the world holds an open contest for the mortal's home between the god lost and the god gained, resting on the defection",
            JSON.stringify(held),
          );
          step.done(
            `${trouble.id}: a ${trouble.trouble} took goods from ${mortal}, who revered ${patron}; ${domain} answered its prayer [${prayer.id}]; ${striker} struck it [${harm.id}] and ${patron} refused its prayer [${prayed.id}]: ${mortal} left ${patron} for ${domain} [${changed.id}], remembered by those two gods alone; ${patron} opened ${contest.id} for ${home}`,
          );
        },
      );
    },
  );
}
