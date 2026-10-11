// Test support: views built through the real codec and parser, as a live
// frame is, with Zeus carrying the sprite id the world sets for him.

import { parseSyncFrame } from "@panthea/contracts";
import { decode, toEntityId, withActor } from "@panthea/world";

import { baseState, framePayload } from "../fixtures";
import { toViewModel, type WorldViewModel } from "../store";

export function viewWithZeus(
  options: Parameters<typeof framePayload>[1] = {},
): WorldViewModel {
  const base = baseState();
  const zeus = base.actors.get(toEntityId("zeus"));
  if (zeus === undefined) throw new Error("fixture has no Zeus");
  const state = withActor(base, { ...zeus, sprite: "zeus-sprite" });
  const parsed = parseSyncFrame(framePayload(state, options));
  if (!parsed.ok) throw new Error(parsed.message);
  return toViewModel(parsed.value, decode(parsed.value.state));
}
