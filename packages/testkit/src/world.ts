// Test support: an `ActorState` literal without the sprite id every real actor carries. Exposed as
// `@panthea/testkit/world`; nothing in a running world imports it.

import type { ActorState } from "@panthea/world";

/** `actor` with a sprite id, `placeholder-<id>` unless the test names one: the id a real mortal with no art is authored with. */
export function testActor(
  actor: Omit<ActorState, "sprite"> & { readonly sprite?: string },
): ActorState {
  return { ...actor, sprite: actor.sprite ?? `placeholder-${actor.id}` };
}
