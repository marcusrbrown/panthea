// Captures the seven gods' requests as the runtime cap leaves them, in worlds
// that press on the cap, so `measure-capped.ts` can read them to a real model.
//
//   bun run src/capture-capped.ts --out=/tmp/god-contexts-capped.json
//
// Three worlds, each the authored Greek pack run forward on its own routines
// (fixed seed, no god takes a turn) to tick 450:
//   aged     as it stands: what a service world holds with nobody acting on it.
//   crowded  every god also holds a dozen prayers (help and punish), six
//            memories (one an accusation by another god), five feelings and
//            five reports it told.
//   heavy    the same at twice the load: the most the town has shown one god.
//
// Each request is built the way a turn builds it: `rememberedBy`, then
// `fitToCap` at the granite3.3-8b-4k ratio, then `buildGodContext` and the
// intent schema from the reduced pair. The uncapped request is kept beside it.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildGodContext,
  estimateTokens,
  fitToCap,
  godIntentSchema,
  MODEL_RATIOS,
  rememberedBy,
  requestChars,
} from "@panthea/agents";
import {
  loadContentPack,
  loadGodProfiles,
  withGodSprites,
} from "@panthea/content";
import type { EventId, WorldEvent } from "@panthea/contracts";
import {
  applyEvent,
  createInitialWorldState,
  createPrng,
  decideRoutineProposal,
  perceive,
  runTick,
  toEntityId,
  type WorldState,
} from "@panthea/world";
import { GOD_ORDER } from "./capture";

export const MODEL = "granite3.3-8b-4k";

export interface CappedCapture {
  readonly world: string;
  readonly tick: number;
  readonly god: string;
  readonly instructions: string;
  readonly prompt: string;
  readonly schema: unknown;
  readonly ratio: number;
  readonly chars: number;
  readonly estimatedTokens: number;
  readonly uncappedChars: number;
  readonly uncappedEstimate: number;
  readonly shed: {
    readonly events: number;
    readonly actions: number;
    readonly memories: number;
    readonly prayers: number;
  };
  readonly fits: boolean;
}

const REPO = join(import.meta.dir, "../../../..");
const TICK = 450;

/** Applies hand-built events to a world, the way the agents suites grow one. */
class Grower {
  readonly events: WorldEvent[] = [];
  private n = 0;
  constructor(public state: WorldState) {}
  apply(overrides: Record<string, unknown>): WorldEvent {
    this.n += 1;
    const event = {
      schemaVersion: 1,
      id: `evt-${this.state.tick}-${9000 + this.n}`,
      sequence: this.state.lastSequence + 1,
      simTime: 0,
      tick: this.state.tick,
      correlationId: "probe",
      causationId: "probe",
      approximate: false,
      ...overrides,
    } as unknown as WorldEvent;
    this.state = applyEvent(this.state, event);
    this.events.push(event);
    return event;
  }
}

const mortalsOf = (state: WorldState) =>
  [...state.actors.values()]
    .filter((actor) => actor.alive && actor.isDeity !== true)
    .map((actor) => String(actor.id))
    .sort();

/** Gives every god `load` prayers, memories, feelings and told reports. */
function crowd(
  state: WorldState,
  gods: readonly string[],
  load: number,
): { state: WorldState; ownEvents: Map<string, WorldEvent[]> } {
  const grower = new Grower(state);
  const mortals = mortalsOf(state);
  const own = new Map<string, WorldEvent[]>();
  for (const [g, god] of gods.entries()) {
    for (let i = 0; i < load * 6; i += 1) {
      const mortal = mortals[(g * 3 + i) % mortals.length] as string;
      const offender = mortals[(g * 3 + i + 5) % mortals.length] as string;
      if (i % 2 === 0) {
        const cause = grower.apply({
          kind: "stock-spoiled",
          entityId: mortal,
          resource: "food",
          amount: 1,
          cause: "director",
        });
        grower.apply({
          kind: "petition-opened",
          entityId: mortal,
          god,
          cause: cause.id,
          request: {
            kind: "help",
            need: { kind: "resource", resource: "food", amount: 1 },
          },
        });
      } else {
        const theft = grower.apply({
          kind: "theft",
          entityId: offender,
          victim: mortal,
          resource: "currency",
          amount: 1,
          cause: "director",
        });
        grower.apply({
          kind: "petition-opened",
          entityId: mortal,
          god,
          cause: theft.id,
          request: { kind: "punish", offender, buildings: [] },
        });
      }
    }
    const rival = gods[(g + 1) % gods.length] as string;
    const accused = grower.apply({
      kind: "report-told",
      entityId: rival,
      listenerId: god,
      content: "You wronged me, and you know it.",
      claim: { effect: "harm", agent: god, target: rival },
    });
    grower.apply({
      kind: "memory-recorded",
      memoryKind: "told",
      entityId: god,
      sourceEventId: accused.id,
      teller: rival,
      content: "You wronged me, and you know it.",
      subjects: [rival, god],
      salience: 5,
      consequence: { effect: "harm", agent: god, target: rival },
    });
    for (let i = 0; i < load * 3; i += 1) {
      const subject = mortals[(g + i * 2) % mortals.length] as string;
      grower.apply({
        kind: "memory-recorded",
        memoryKind: "witnessed",
        entityId: god,
        sourceEventId: `evt-${TICK - 20 - i}-${100 + i}`,
        eventKind: "theft",
        subjects: ["farmer", subject],
        salience: 1 + ((g + i) % 7),
        consequence: { effect: "harm", agent: "farmer", target: subject },
      });
    }
    for (let i = 0; i < load * 2 + 1; i += 1) {
      grower.apply({
        kind: "relationship-changed",
        entityId: god,
        toward: mortals[(g * 2 + i) % mortals.length],
        affinityDelta: 1 + i,
        grudgeDelta: 0,
        memoryEventId: accused.id,
      });
    }
    own.set(
      god,
      Array.from({ length: 5 }, (_, i) =>
        grower.apply({
          kind: "report-told",
          entityId: god,
          listenerId: mortals[i] as string,
          content: `Word ${i} of the doings in the valley, told plainly.`,
        }),
      ),
    );
  }
  return { state: grower.state, ownEvents: own };
}

export function captureCapped(): CappedCapture[] {
  const greek = join(REPO, "content/greek");
  const pack = loadContentPack(join(greek, "world"));
  if (!pack.ok) throw new Error(`${pack.path}: ${pack.message}`);
  const profiles = loadGodProfiles(join(greek, "gods"), pack.value);
  if (!profiles.ok) throw new Error(`${profiles.path}: ${profiles.message}`);

  const folded = withGodSprites(pack.value, profiles.value);
  if (!folded.ok) throw new Error(`${folded.path}: ${folded.message}`);

  let state = createInitialWorldState(folded.value);
  let prng = createPrng(1);
  const log: WorldEvent[] = [];
  while (state.tick < TICK) {
    const queue = [];
    for (const id of state.actors.keys()) {
      const decision = decideRoutineProposal(state, id);
      if (decision) queue.push(decision.proposal);
    }
    const result = runTick(state, prng, queue);
    state = result.state;
    prng = result.prng;
    log.push(...result.events);
  }
  const recent = log.filter((event) => event.tick > state.tick - 10);
  const ratio = MODEL_RATIOS[MODEL] as number;

  const worlds: {
    name: string;
    state: WorldState;
    own: Map<string, WorldEvent[]>;
  }[] = [{ name: "aged", state, own: new Map() }];
  for (const [name, load] of [
    ["crowded", 2],
    ["heavy", 4],
  ] as const) {
    const grown = crowd(state, GOD_ORDER, load);
    worlds.push({ name, state: grown.state, own: grown.ownEvents });
  }

  const captures: CappedCapture[] = [];
  for (const world of worlds) {
    for (const name of GOD_ORDER) {
      const profile = profiles.value.find((p) => p.id === name);
      if (profile === undefined) throw new Error(`no profile for ${name}`);
      const id = toEntityId(name);
      const snapshot = perceive(world.state, id, recent);
      if (snapshot === undefined) continue;
      const remembered = rememberedBy(world.state, id, [
        ...recent,
        ...(world.own.get(name) ?? []),
      ] as WorldEvent[]);
      const uncapped = buildGodContext(profile, snapshot, remembered);
      const capped = fitToCap({
        profile,
        state: world.state,
        actorId: id,
        snapshot,
        remembered,
        ratio,
      });
      captures.push({
        world: world.name,
        tick: world.state.tick,
        god: name,
        instructions: capped.context.instructions ?? "",
        prompt: capped.context.prompt,
        schema: godIntentSchema(profile, capped.snapshot, capped.remembered)
          .jsonSchema,
        ratio,
        chars: requestChars(capped.context),
        estimatedTokens: capped.estimatedTokens,
        uncappedChars: requestChars(uncapped),
        uncappedEstimate: estimateTokens(uncapped, ratio),
        shed: capped.shed,
        fits: capped.fits,
      });
    }
  }
  return captures;
}

export type { EventId };

if (import.meta.main) {
  const out =
    process.argv.find((a) => a.startsWith("--out="))?.split("=")[1] ?? "";
  const captures = captureCapped();
  for (const c of captures) {
    console.error(
      `${c.world.padEnd(8)} ${c.god.padEnd(10)} chars ${String(c.chars).padStart(5)} est ${c.estimatedTokens} (uncapped ${c.uncappedChars} chars, est ${c.uncappedEstimate}) shed ${JSON.stringify(c.shed)}${c.fits ? "" : " OVER AT FLOOR"}`,
    );
  }
  if (out !== "") writeFileSync(out, JSON.stringify(captures));
}
