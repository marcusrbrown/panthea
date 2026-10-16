// Buildings as sprites. A building draws the published structure art its
// status selects (intact, damaged or ruin), standing on its slot's cell (./layout,
// BUILDING_SLOTS); a burning building also draws the fire loop over it, an effect
// sprite anchored on the structure's bottom cell. `composeScene` places both by the
// shared projection and sorts them by the shared depth key, the depth of the
// footprint's bottom cell: an actor on a cell in front of a building draws over
// it and one behind draws under it. The status and the art are the client's
// choice for presenting what the world says: nothing here decides an outcome.
//
// Art that is not published draws the shared placeholder, as an actor does, in the
// footprint the art declares. The repair bar and the place and event-ring marks
// stay meshes (./decor).

import {
  type CanonResolution,
  type PixelResolution,
  type RegistrySnapshot,
  resolveAssetPixels,
} from "@panthea/assets/browser";
import {
  FIRE_ANIMATION,
  FIRE_ASSET,
  type Footprint,
  type Point,
  type SceneEntity,
  STRUCTURE_ANCHORS,
  STRUCTURE_ASSETS,
  STRUCTURE_FOOTPRINTS,
  type StructureArt,
  type StructureState,
} from "@panthea/renderer";
import type { BuildingStatus } from "@panthea/world";

import type { ViewBuilding, ViewLocation } from "../store";
import { type ActorArt, type SpriteItem, sceneResolutionOf } from "./actors";
import { buildingCell, type GridCell } from "./layout";

/** The Old Oak is a building in the world and a tree on screen; material cannot say so, as the Woodshed is wood too. */
const TREE_BUILDING_ID = "old-oak";

const STRUCTURE_FACING = "south";

export interface StructureLook {
  readonly state: StructureState;
  /** The fire loop is drawn over the structure. */
  readonly fire: boolean;
  /** The repair bar is drawn below the structure. */
  readonly repair: boolean;
}

/** What a building's status looks like. Exhaustive: a new status is a compile error here. */
export function structureStateOf(status: BuildingStatus): StructureLook {
  switch (status) {
    case "operational":
      return { state: "intact", fire: false, repair: false };
    case "damaged":
      return { state: "damaged", fire: false, repair: false };
    case "burning":
      return { state: "damaged", fire: true, repair: false };
    case "repairing":
      return { state: "damaged", fire: false, repair: true };
    case "destroyed":
      return { state: "ruin", fire: false, repair: false };
  }
}

export function structureArtOf(buildingId: string): StructureArt {
  return buildingId === TREE_BUILDING_ID ? "tree" : "building";
}

export interface StructureItem extends SpriteItem {
  readonly building: ViewBuilding;
  readonly role: "building" | "fire";
  /** The published asset the item draws, so a failed atlas can report and fall back by it. */
  readonly assetId: string;
  /** The cell the item is placed at: a structure's footprint origin, an effect's own cell. */
  readonly cell: GridCell;
  /** The building's bottom cell: where its foot stands, which its depth and its effects are read from. */
  readonly bottom: GridCell;
  /** The footprint a placeholder stands in with. */
  readonly footprint?: Footprint;
  /** Whole pixels added to the placed position, down the screen: an effect's anchor on the structure. */
  readonly offset?: Point;
}

const artFrom = (resolved: PixelResolution): ActorArt =>
  resolved.source === "canon"
    ? { source: "canon", resolution: resolved }
    : resolved;

/**
 * The sprites that draw the buildings of the followed place, by slot: each
 * building, then, when it burns, its fire. A building stands on its slot's
 * bottom cell, its footprint reaching back from it; a building past the slots
 * is not drawn. The fire's id sorts after its building's and it sits on the
 * same bottom cell, so at one depth it draws over the building.
 */
export function planStructures(
  place: ViewLocation | undefined,
  snapshot: RegistrySnapshot,
): StructureItem[] {
  const items: StructureItem[] = [];
  const buildings = place?.buildings ?? [];
  for (const [index, building] of buildings.entries()) {
    const bottom = buildingCell(index, buildings.length);
    if (bottom === undefined) continue;
    const kind = structureArtOf(building.id);
    const footprint = STRUCTURE_FOOTPRINTS[kind];
    const look = structureStateOf(building.status);
    const assetId = STRUCTURE_ASSETS[kind];
    const id = `structure:${building.id}`;
    items.push({
      id,
      building,
      role: "building",
      assetId,
      cell: { x: bottom.x - footprint.w + 1, y: bottom.y - footprint.h + 1 },
      bottom,
      footprint,
      art: artFrom(
        resolveAssetPixels(snapshot, {
          spriteId: assetId,
          state: look.state,
          direction: STRUCTURE_FACING,
        }),
      ),
    });
    if (!look.fire) continue;
    items.push({
      id: `${id}:fire`,
      building,
      role: "fire",
      assetId: FIRE_ASSET,
      cell: bottom,
      bottom,
      // The anchor is an offset down the screen from the foot.
      offset: STRUCTURE_ANCHORS[kind].fire,
      art: artFrom(
        resolveAssetPixels(snapshot, {
          spriteId: FIRE_ASSET,
          animation: FIRE_ANIMATION,
        }),
      ),
    });
  }
  return items;
}

/** The item as a scene entity: a sprite on the structure layer, the fire over its building at the same depth. */
export function structureEntity(item: StructureItem): SceneEntity {
  return {
    kind: "sprite",
    id: item.id,
    layer: "structure",
    cell: { ...item.cell, z: 0 },
    ...(item.footprint === undefined ? {} : { footprint: item.footprint }),
    ...(item.offset === undefined ? {} : { offset: item.offset }),
    resolution: sceneResolutionOf(item.art),
  };
}

/**
 * A strike's frame as a scene entity: an effect on the building's bottom cell, at the structure's strike anchor,
 * so it sorts with the building and, on the effect layer, over it and its fire.
 */
export function strikeEntity(
  id: string,
  bottom: GridCell,
  art: StructureArt,
  resolution: CanonResolution,
): SceneEntity {
  return {
    kind: "sprite",
    id,
    layer: "effect",
    cell: { ...bottom, z: 0 },
    offset: STRUCTURE_ANCHORS[art].strike,
    resolution,
  };
}
