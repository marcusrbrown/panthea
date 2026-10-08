// What S21 to S25 share: a staged world of their own, and the harness staging that sets a cause up.
//
// Each of these steps starts a fresh world beside the story's (a second sidecar on the same compiled binary, with a
// scripted provider of its own), created with story-only rules that make the world's own logic produce the thing
// the step is about within a few ticks: a temperament's odds of a theft or a revenge at 1000 per mille, a short
// director interval, a trouble floor of a few ticks, a defection threshold above any feeling. A persisted world
// keeps its rules, so these never touch the story's own world, and S1 to S20 never see them. The chain from there is
// the real service's: the world draws the wrong, records it, routes the prayer, judges the strike, and so on; the
// harness posts only moves and prayers for the mortals (proposals the real validator judges, as `stageLoss` does) and
// scripts what the gods answer, each reply a function of the prompt its god was shown.

import { join } from "node:path";
import { nextHop, toEntityId, type WorldState } from "@panthea/world";
import {
  type LaunchConfigLine,
  startSidecar,
} from "../../../m1-living-world/src/sidecar";
import type { StoredEvent } from "../checks";
import { GODS, startProvider, WAIT } from "../provider";
import type { Story } from "./context";
import { storedEvents } from "./practice";
import {
  check,
  postFixture,
  stateOf,
  submitFixture,
  waitFor,
  waitForConsumed,
} from "./support";

/** Gods that can strike a mortal (the strike ability). */
export const STRIKERS: readonly string[] = [
  "athena",
  "hephaestus",
  "hera",
  "poseidon",
  "zeus",
];

/** Gods that can answer a loss with a blessing. */
export const BLESSERS: readonly string[] = ["athena", "hephaestus", "hermes"];

/** The model config every staged world and the story's own launch with: every god on one scripted endpoint. */
export const launchConfigFor = (baseUrl: string): LaunchConfigLine => ({
  models: {
    endpoints: [{ id: "scripted", baseUrl, model: "scripted" }],
    roles: Object.fromEntries(
      GODS.map((god) => [god, { endpoint: "scripted" }]),
    ),
  },
  offline: false,
  keys: {},
});

/** A staged world, shaped as a story so every step helper works on it. */
export interface StagedWorld extends Story {
  stop(): Promise<void>;
}

export interface StagedRules {
  /** Petition tunables over the authored ones (the director stays off unless the step sets it). */
  readonly petition?: Readonly<Record<string, number>>;
  /** The temperament odds table, whole: absent kinds and temperaments have no odds. */
  readonly odds: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

/** Starts a fresh world named `name` under the story's root, with `rules` at its creation. */
export async function stageWorld(
  story: Story,
  name: string,
  rules: StagedRules,
): Promise<StagedWorld> {
  const provider = startProvider();
  const dataDir = join(story.root, name);
  const sidecar = await startSidecar(story.binary, dataDir, {
    env: {
      PANTHEA_PETITION_BALANCE: JSON.stringify({
        directorIntervalTicks: 10_000_000,
        prayerCooldownTicks: 1,
        ...rules.petition,
      }),
      PANTHEA_TEMPERAMENT_ODDS: JSON.stringify(rules.odds),
    },
    launchConfig: launchConfigFor(provider.baseUrl),
  });
  const world: StagedWorld = {
    options: story.options,
    binary: story.binary,
    root: story.root,
    dataDir,
    provider,
    sidecar,
    restart: () => Promise.reject(new Error("a staged world is not restarted")),
    async stop() {
      await world.sidecar.stop("SIGTERM").catch(() => undefined);
      provider.stop();
    },
  };
  return world;
}

/** Runs `run` in a staged world and stops it after, whatever happens. */
export async function inStagedWorld<T>(
  story: Story,
  name: string,
  rules: StagedRules,
  run: (world: StagedWorld) => Promise<T>,
): Promise<T> {
  const world = await stageWorld(story, name, rules);
  try {
    return await run(world);
  } finally {
    await world.stop();
  }
}

export const patronOf = (state: WorldState, mortal: string): string =>
  String(state.patrons.get(toEntityId(mortal)) ?? "");

export const isAlive = (state: WorldState, actor: string): boolean =>
  state.actors.get(toEntityId(actor))?.alive === true;

/** The event `id`, from the store. */
export const eventById = (story: Story, id: unknown): StoredEvent | undefined =>
  storedEvents(story).find((e) => e.id === id);

/** The JSON object the prompt shows that starts with `prefix`, balanced, as the text to send. */
export function copyOf(prompt: string, prefix: string): string | undefined {
  const at = prompt.indexOf(prefix);
  if (at < 0) return undefined;
  let depth = 0;
  for (let i = at; i < prompt.length; i += 1) {
    if (prompt[i] === "{") depth += 1;
    else if (prompt[i] === "}") {
      depth -= 1;
      if (depth === 0) return prompt.slice(at, i + 1);
    }
  }
  return undefined;
}

/**
 * Runs `run` with `god` answering from its prompt: it copies the object that starts with `prefix` whenever its
 * prompt shows one, and waits otherwise. With no prefix it only waits (the sabotage of a positive control).
 */
export async function withGod<T>(
  story: Story,
  god: string,
  prefix: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  story.provider.policy(god as (typeof GODS)[number], (seen) =>
    prefix === undefined ? WAIT : (copyOf(seen.prompt, prefix) ?? WAIT),
  );
  try {
    return await run();
  } finally {
    story.provider.policy(god as (typeof GODS)[number], undefined);
  }
}

/** The prayer `mortal` has opened about `cause`, if it has. */
export const prayerOf = (
  world: Story,
  mortal: string,
  cause: unknown,
): StoredEvent | undefined =>
  storedEvents(world).find(
    (e) =>
      e.kind === "petition-opened" &&
      e.entityId === mortal &&
      e.cause === cause,
  );

/**
 * `mortal` prays about `cause`: the harness walks it to the altar a hop at a time along the world's own map, each
 * hop a fixture move the real validator judges, and the last hop goes with the prayer in one breath so the mortal's
 * own routine cannot walk it off between them. The world judges the prayer as it judges any: it routes it, opens it,
 * and a mortal that could not pray about that cause is refused. At most a few hops and seconds: the altar is a
 * short walk from anywhere.
 */
export async function stagePrayer(
  world: Story,
  mortal: string,
  cause: unknown,
  why: string,
): Promise<StoredEvent> {
  // A mortal that already prayed about it (its routine may have) needs no staging.
  const already = prayerOf(world, mortal, cause);
  if (already !== undefined) return already;
  const altar = toEntityId("altar");
  const who = toEntityId(mortal);
  for (let hop = 0; hop < 12; hop += 1) {
    const state = await stateOf(world);
    const actor = state.actors.get(who);
    check(actor !== undefined, `${why}: ${mortal} is in the world`, "gone");
    if (actor === undefined) break;
    const next =
      actor.locationId === altar
        ? altar
        : nextHop(state, actor.locationId, altar, actor.capabilities);
    check(
      next !== undefined,
      `${why}: ${mortal} has a way to the altar`,
      String(actor.locationId),
    );
    if (next === undefined) break;
    if (next !== altar) {
      await postFixture(world, mortal, { kind: "move", to: String(next) }, why);
      continue;
    }
    if (actor.locationId !== altar) {
      await postFixture(world, mortal, { kind: "move", to: "altar" }, why);
    }
    const praying = await submitFixture(
      world,
      mortal,
      { kind: "pray", cause },
      why,
    );
    const row = await waitForConsumed(
      world,
      praying,
      `${why}: the prayer runs`,
      10_000,
    );
    // A mortal's own routine takes its one proposal of a tick (busy-actor), or walks it off the altar between the
    // move and the prayer (not-adjacent): the harness tries again, a few times, and the world judges each try.
    if (row.outcome !== "committed") {
      check(
        (row.reason === "not-adjacent" || row.reason === "busy-actor") &&
          hop < 11,
        `${why}: the world judges the prayer`,
        `${row.outcome} ${row.reason}`,
      );
      continue;
    }
    return waitFor(
      `${why}: the prayer is opened`,
      () => prayerOf(world, mortal, cause),
      { timeoutMs: 5_000, intervalMs: 100 },
    );
  }
  throw new Error(`${why}: ${mortal} never reached the altar`);
}

/**
 * `god` blesses the petitioner of `petition`, from wherever the god stands: one fixture proposal the real validator
 * judges (a blessing answers an open prayer addressed to the god, wherever either is). It is tried again a few times
 * only if a tick collision (`busy-actor`) refuses it.
 */
export async function stageBlessing(
  world: Story,
  petition: { readonly id: unknown; readonly petitioner: string },
  god: string,
  why: string,
): Promise<StoredEvent> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = await postFixture(
      world,
      god,
      { kind: "bless", petition: petition.id },
      why,
    );
    if (row.outcome === "committed") {
      const granted = storedEvents(world).find(
        (e) => e.kind === "blessing-granted" && e.petitionId === petition.id,
      );
      if (granted !== undefined) return granted;
    }
    check(
      row.reason === "busy-actor" && attempt < 3,
      `${why}: the world judges the blessing`,
      `${row.outcome} ${row.reason}`,
    );
  }
  throw new Error(`${why}: ${god} could not bless ${petition.petitioner}`);
}
