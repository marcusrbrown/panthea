// Captures what the seven gods' requests look like in the real Greek world at
// several ticks, as the router sends them: the system text (`instructions`),
// the user text (`prompt`), and the intent schema. The world is the authored
// pack run forward by its own routines with a fixed seed (no god takes a turn,
// so the captures are the same on every run and on every layout of the prompt).
//
//   bun run src/capture.ts --out=/tmp/god-contexts-before.json
//
// A capture is a pure function of the code that builds the prompt, so running
// it before and after a change to that code gives the two sets the measurement
// compares on the same world.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildGodContext,
  godIntentSchema,
  rememberedBy,
} from "@panthea/agents";
import { loadContentPack, loadGodProfiles } from "@panthea/content";
import type { WorldEvent } from "@panthea/contracts";
import {
  createInitialWorldState,
  createPrng,
  decideRoutineProposal,
  perceive,
  runTick,
  toEntityId,
} from "@panthea/world";

export interface Capture {
  readonly tick: number;
  readonly god: string;
  readonly instructions: string;
  readonly prompt: string;
  readonly schema: unknown;
}

/** The order the service asks the gods in (`nextGod` walks them alphabetically). */
export const GOD_ORDER = [
  "athena",
  "hades",
  "hephaestus",
  "hera",
  "hermes",
  "poseidon",
  "zeus",
] as const;

const REPO = join(import.meta.dir, "../../../..");

/** Captures every god's request at each of `ticks`, running the world forward between them. */
export function captureWorld(ticks: readonly number[]): Capture[] {
  const greek = join(REPO, "content/greek");
  const pack = loadContentPack(join(greek, "world"));
  if (!pack.ok) throw new Error(`${pack.path}: ${pack.message}`);
  const profiles = loadGodProfiles(join(greek, "gods"), pack.value);
  if (!profiles.ok) throw new Error(`${profiles.path}: ${profiles.message}`);

  let state = createInitialWorldState(pack.value);
  let prng = createPrng(1);
  const log: WorldEvent[] = [];
  const captures: Capture[] = [];
  const wanted = new Set(ticks);
  const last = Math.max(...ticks);

  const capture = () => {
    const recent = log.filter((event) => event.tick > state.tick - 10);
    for (const name of GOD_ORDER) {
      const profile = profiles.value.find((p) => p.id === name);
      if (profile === undefined) throw new Error(`no profile for ${name}`);
      const id = toEntityId(name);
      const snapshot = perceive(state, id, recent);
      if (snapshot === undefined) continue;
      const remembered = rememberedBy(state, id, recent);
      const context = buildGodContext(profile, snapshot, remembered);
      captures.push({
        tick: state.tick,
        god: name,
        instructions: context.instructions ?? "",
        prompt: context.prompt,
        schema: godIntentSchema(profile, snapshot, remembered).jsonSchema,
      });
    }
  };

  if (wanted.has(0)) capture();
  while (state.tick < last) {
    const queue = [];
    for (const id of state.actors.keys()) {
      const decision = decideRoutineProposal(state, id);
      if (decision) queue.push(decision.proposal);
    }
    const result = runTick(state, prng, queue);
    state = result.state;
    prng = result.prng;
    log.push(...result.events);
    if (wanted.has(state.tick)) capture();
  }
  return captures;
}

if (import.meta.main) {
  const arg = (name: string, fallback: string) =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ??
    fallback;
  const ticks = arg("ticks", "0,300,400,500").split(",").map(Number);
  const out = arg("out", "");
  const captures = captureWorld(ticks);
  const sizes = captures.map(
    (c) => c.instructions.length + 2 + c.prompt.length,
  );
  console.error(
    `${captures.length} captures at ticks ${ticks.join(", ")}; request chars min ${Math.min(...sizes)} median ${[...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)]} max ${Math.max(...sizes)}`,
  );
  if (out !== "") writeFileSync(out, JSON.stringify(captures));
}
