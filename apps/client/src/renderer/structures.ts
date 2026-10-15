// Buildings as sprites. A building draws the published structure art its
// status selects (intact, damaged or ruin), standing on its foot; a burning
// building also draws the fire loop over it, as a second structure sprite
// anchored on the structure. The status and the art are the client's choice
// for presenting what the world says: nothing here decides an outcome.
//
// Art that is not published draws the shared placeholder, as an actor does.
// A structure sorts by its foot's screen row on the structure layer, so an
// actor in front of a building draws in front of it and one behind draws
// behind. The repair bar and the place and event-ring marks stay meshes.

import {
  type PixelResolution,
  type RegistrySnapshot,
  resolveAssetPixels,
} from "@panthea/assets/browser";
import {
  FIRE_ANIMATION,
  FIRE_ASSET,
  STRUCTURE_ANCHORS,
  STRUCTURE_ASSETS,
  type StructureArt,
  type StructureState,
} from "@panthea/renderer";
import type { BuildingStatus } from "@panthea/world";

import type { ViewBuilding, ViewLocation } from "../store";
import type { ActorArt, SpriteItem } from "./actors";
import { buildingFoot, PLACE_ORIGIN } from "./layout";

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
}

const artFrom = (resolved: PixelResolution): ActorArt =>
  resolved.source === "canon"
    ? { source: "canon", resolution: resolved }
    : resolved;

/**
 * The sprites that draw the buildings of the followed place, back to front by
 * slot: each building, then, when it burns, its fire. The buildings stand in
 * one centred row (see `buildingFoot`). The fire's id sorts after its
 * building's, and it is keyed on the building's foot, so at one depth it draws
 * over the building.
 */
export function planStructures(
  place: ViewLocation | undefined,
  snapshot: RegistrySnapshot,
): StructureItem[] {
  const items: StructureItem[] = [];
  const buildings = place?.buildings ?? [];
  for (const [index, building] of buildings.entries()) {
    const foot = buildingFoot(PLACE_ORIGIN, index, buildings.length);
    const kind = structureArtOf(building.id);
    const look = structureStateOf(building.status);
    const assetId = STRUCTURE_ASSETS[kind];
    const id = `structure:${building.id}`;
    items.push({
      id,
      building,
      role: "building",
      assetId,
      foot,
      art: artFrom(
        resolveAssetPixels(snapshot, {
          spriteId: assetId,
          state: look.state,
          direction: STRUCTURE_FACING,
        }),
      ),
    });
    if (!look.fire) continue;
    const anchor = STRUCTURE_ANCHORS[kind].fire;
    items.push({
      id: `${id}:fire`,
      building,
      role: "fire",
      assetId: FIRE_ASSET,
      // The anchor is an offset down the screen; the layout's y points up.
      foot: { x: foot.x + anchor.x, y: foot.y - anchor.y },
      depthFoot: foot,
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
