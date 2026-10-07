// S23 and S25: what the world does on its own clocks, through the compiled sidecar, in staged worlds of their own
// (see `staging.ts`).
//
// S23: a trouble in a god's domain befalls a mortal, who prays about it to that god and not to the god it reveres;
// the domain god's prompt lists the prayer as one about a trouble in its domain, and the mortal's patron's does not.
// Its control is in-process: it breaks the evidence the step collected, and the step's own check must fail on it.
//
// S25: the quiet-world director fires on its own clock, once every interval since it last fired, with the world busy
// around it, in a world whose interval is a few ticks.

import { ScenarioFailure } from "../../../m1-living-world/src/helpers";
import type { StoredEvent } from "../checks";
import type { Recorder, Story } from "./context";
import { storedEvents } from "./practice";
import { inStagedWorld, isAlive, patronOf, stagePrayer } from "./staging";
import { check, stateOf, waitFor } from "./support";

/** The director's interval in the staged world of S25, in ticks. */
export const DIRECTOR_INTERVAL_TICKS = 3;

/** A control that breaks the evidence its step collected, in-process, and the step's own check must fail on it. */
export interface WorldControlRun {
  readonly control: string;
  readonly sabotage: string;
  readonly failure: string;
}

/** Where a trouble's prayer went, as the step read it from the world. */
export interface TroubleRouting {
  readonly trouble: string;
  readonly domain: string;
  readonly patron: string;
  readonly heardBy: string;
}

/** The step's check: the prayer went to the god of the trouble's domain, and not to the god the mortal reveres. */
export const troubleRouteCheck = (
  r: TroubleRouting,
): {
  readonly ok: boolean;
  readonly name: string;
  readonly detail: string;
} => ({
  ok: r.heardBy === r.domain && r.heardBy !== r.patron,
  name: `the prayer about the ${r.trouble} goes to ${r.domain}, the god of its domain, and not to ${r.patron}, whom the mortal reveres`,
  detail: `heard by ${r.heardBy}; domain ${r.domain}; patron ${r.patron}`,
});

export const TROUBLE_ROUTE_SABOTAGE =
  "The harness reads the prayer about a trouble in a god's domain as if it had gone to the god the afflicted mortal reveres.";

export async function stepTroubleRoute(
  recorder: Recorder,
  story: Story,
): Promise<readonly WorldControlRun[]> {
  const controls: WorldControlRun[] = [];
  await recorder.run(
    "S23",
    "A trouble in a god's domain is prayed about to that god, whoever the afflicted mortal reveres",
    "In a world whose gods each have a trouble within a few ticks, a trouble in a god's domain befalls a mortal that reveres another god; the mortal prays about it, and the prayer goes to the domain god and not to the mortal's patron. The domain god's prompt lists it as a prayer about a trouble in its domain, and the patron's prompts do not list it. The control, in-process, reads the recorded prayer as if it had gone to the patron: the same check fails.",
    async (step) => {
      await inStagedWorld(
        story,
        "trouble-route",
        { petition: { troubleFloorTicks: 3 }, odds: {} },
        async (world) => {
          const found = await waitFor(
            "a trouble befalls a mortal that reveres another god",
            async () => {
              const state = await stateOf(world);
              for (const trouble of storedEvents(world)) {
                if (trouble.kind !== "trouble") continue;
                const mortal = String(trouble.entityId);
                const patron = patronOf(state, mortal);
                if (
                  patron !== "" &&
                  patron !== String(trouble.god) &&
                  isAlive(state, mortal)
                ) {
                  return { trouble, mortal, patron };
                }
              }
              return undefined;
            },
            { timeoutMs: 15_000, intervalMs: 300 },
          );
          const { trouble, mortal, patron } = found;
          const prayer = await stagePrayer(
            world,
            mortal,
            trouble.id,
            `${mortal} prays about the ${trouble.trouble}`,
          );
          const evidence: TroubleRouting = {
            trouble: String(trouble.trouble),
            domain: String(trouble.god),
            patron,
            heardBy: String(prayer.god),
          };
          const routed = troubleRouteCheck(evidence);
          check(routed.ok, routed.name, routed.detail);
          const domain = evidence.domain;
          const shown = await waitFor(
            `${domain}'s prompt lists the prayer as one about a trouble in its domain`,
            () =>
              world.provider.requests.find(
                (r) =>
                  r.god === domain &&
                  r.prompt.includes(`[${prayer.id}]`) &&
                  r.prompt.includes(`(a ${trouble.trouble} in your domain)`),
              ),
            { timeoutMs: 20_000, intervalMs: 200 },
          );
          check(
            !world.provider.requests.some(
              (r) => r.god === patron && r.prompt.includes(`[${prayer.id}]`),
            ),
            `${patron}, whom the mortal reveres, is never shown the prayer`,
            patron,
          );
          // The control: the same check on the evidence read as if the prayer had gone to the patron.
          const broken = troubleRouteCheck({ ...evidence, heardBy: patron });
          if (broken.ok)
            throw new Error("the trouble-route control did not trip");
          controls.push({
            control: "trouble-route",
            sabotage: TROUBLE_ROUTE_SABOTAGE,
            failure: new ScenarioFailure(broken.name, broken.detail).message,
          });
          step.done(
            `${trouble.id}: a ${trouble.trouble} (${trouble.source}, ${trouble.season}) befell ${mortal}, who reveres ${patron}; it prayed to ${domain} [${prayer.id}], whose prompt (request ${shown.n}) lists it as a trouble in its domain`,
          );
        },
      );
    },
  );
  return controls;
}

/** A trouble the director itself caused. */
const isDirectorFire = (event: StoredEvent): boolean =>
  ((event.kind === "theft" || event.kind === "stock-spoiled") &&
    event.cause === "director") ||
  (event.kind === "building-ignited" &&
    (event.cause as { kind?: string } | undefined)?.kind === "director");

export async function stepDirectorClock(
  recorder: Recorder,
  story: Story,
): Promise<void> {
  await recorder.run(
    "S25",
    "The director fires on its own clock, once every interval, whatever else happens",
    `A world made with the director's interval at ${DIRECTOR_INTERVAL_TICKS} ticks (the story's own keeps it off, and a persisted world keeps its rules). The director fires three times, each exactly ${DIRECTOR_INTERVAL_TICKS} ticks after the one before, while mortals gather, trade, and walk around it: nothing but its own firing moves its clock. With the interval left at its quiet default, it never fires.`,
    async (step) => {
      await inStagedWorld(
        story,
        "director",
        {
          petition: {
            directorIntervalTicks:
              story.options.control === "director-off"
                ? 10_000_000
                : DIRECTOR_INTERVAL_TICKS,
          },
          odds: {},
        },
        async (world) => {
          const fires = await waitFor(
            "the director fires three times",
            () => {
              const own = storedEvents(world).filter(isDirectorFire);
              return own.length >= 3 ? own.slice(0, 3) : undefined;
            },
            { timeoutMs: 20_000, intervalMs: 200 },
          );
          const ticks = fires.map((e) => Number(e.tick));
          check(
            ticks[1] === (ticks[0] ?? 0) + DIRECTOR_INTERVAL_TICKS &&
              ticks[2] === (ticks[1] ?? 0) + DIRECTOR_INTERVAL_TICKS,
            `each fire comes exactly ${DIRECTOR_INTERVAL_TICKS} ticks after the one before`,
            ticks.join(", "),
          );
          const busy = storedEvents(world).filter(
            (e) =>
              Number(e.tick) >= (ticks[0] ?? 0) &&
              Number(e.tick) <= (ticks[2] ?? 0) &&
              !isDirectorFire(e) &&
              [
                "resource-gathered",
                "resource-traded",
                "entity-moved",
                "need-met",
              ].includes(String(e.kind)),
          );
          check(
            busy.length > 0,
            "the world was busy between the fires: mortals gathered, traded, or walked, and none of it moved the clock",
            `${busy.length} events`,
          );
          step.done(
            `the director fired at ticks ${ticks.join(", ")}, ${DIRECTOR_INTERVAL_TICKS} apart, with ${busy.length} gatherings, trades, and walks between them`,
          );
        },
      );
    },
  );
}
