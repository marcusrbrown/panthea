// The scene's entities, placed. `composeScene` puts every entity in the shared isometric projection, relative to
// the scene's own origin (lattice point (0, 0) of the place's grid), and sorts them by the shared depth key; this
// moves the result to the layout's world: the grid's top vertex is `GRID_ORIGIN`, in the target's y-up space the
// layer takes (an instance's y is the top edge, y down).

import {
  type Composition,
  composeScene,
  type SceneEntity,
} from "@panthea/renderer";

import { GRID_ORIGIN } from "./layout";

export function composeWorld(entities: readonly SceneEntity[]): Composition {
  const composed = composeScene(entities);
  return {
    refused: composed.refused,
    instances: composed.instances.map((instance) => ({
      ...instance,
      x: instance.x + GRID_ORIGIN.x,
      y: instance.y - GRID_ORIGIN.y,
    })),
  };
}
