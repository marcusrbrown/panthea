// Everything in the scene that is not a sprite: repair bars, event rings and
// the mark on a fallen actor. (The ground is tiles, ./ground.) They are
// square-edged mesh clusters in render-target pixel space (whole pixels, x
// right, y up), using the same palette and depth ordering as the sprite layer.
// Rings and the fallen mark sit above the sprites; the repair bars sit below them,
// above the ground.
// Actors, buildings, fire and the strike are sprites (./actors, ./structures).
//
// Colours are authored sRGB bytes and the target does no colour management,
// so they are set as bytes (see `pixelColor`).

import type { Realm } from "@panthea/contracts";
import { DEPTH_Z_MAX } from "@panthea/renderer";
import {
  BoxGeometry,
  Color,
  Group,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
} from "three";

import type { ViewBuilding, ViewLocation, WorldViewModel } from "../store";
import {
  buildingFoot,
  EVENT_RING,
  PLACE_ORIGIN,
  type WorldPoint,
} from "./layout";
import { type EffectTone, placeEvents } from "./presentation";

const INK = 0x273c35;
const MOSS = 0x426c58;
const RUST = 0xa54d36;
const GOLD = 0x96733e;
const PAPER_DEEP = 0xded6c4;

const EFFECT_COLOR: Record<EffectTone, number> = {
  fire: RUST,
  worship: GOLD,
  neutral: MOSS,
};

const REPAIR_COLOR = MOSS;
const FALLEN_COLOR = RUST;

/** The scene's clear colour, as sRGB bytes. */
export const BACKGROUND: readonly [number, number, number] = [238, 233, 220];

// Depth, below every sprite and above the ground tiles (z 0): the repair bars.
const Z_REPAIR = 5;
// Above every sprite.
const Z_FALLEN = DEPTH_Z_MAX - 1;
const Z_RING = DEPTH_Z_MAX;

/** A colour whose bytes reach the target unchanged: authored sRGB, taken as linear because nothing re-encodes it. */
export function pixelColor(hex: number): Color {
  return new Color().setRGB(
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
    LinearSRGBColorSpace,
  );
}

export interface Decor {
  readonly objects: readonly Object3D[];
  /** The events a ring was drawn for: the ones a receipt may be sent for. */
  readonly drawnEventIds: readonly string[];
}

/** A small, square-edged pixel cluster, centred on whole logical pixels. */
function pixel(
  name: string,
  x: number,
  y: number,
  color: number,
  width: number,
  height: number,
  z: number,
): Mesh {
  return block(name, x, y, color, width, height, z);
}

function block(
  name: string,
  x: number,
  y: number,
  color: number,
  width: number,
  height: number,
  z: number,
): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(width, height, 2),
    new MeshBasicMaterial({ color: pixelColor(color) }),
  );
  mesh.name = name;
  mesh.position.set(x, y, z);
  return mesh;
}

/** The bar sits this far below a building's foot: under the lowest of its art, which reaches 45 px below the foot. */
const REPAIR_BAR_BELOW_FOOT = 52;

function repairBar(building: ViewBuilding, foot: WorldPoint): Group {
  const repair = building.repair;
  const ratio = repair?.required
    ? repair.progress / repair.required
    : (repair?.progress ?? 0) / ((repair?.progress ?? 0) + 1);
  const width = Math.max(2, Math.floor((28 * Math.min(1, ratio)) / 2) * 2);
  const group = new Group();
  group.name = `repair:${building.id}`;
  group.position.set(foot.x, foot.y - REPAIR_BAR_BELOW_FOOT, Z_REPAIR);
  group.add(pixel("track", 0, 0, PAPER_DEEP, 30, 6, 0));
  group.add(pixel("fill", -15 + width / 2, 0, REPAIR_COLOR, width, 2, 1));
  return group;
}

/** A small grave marker at the foot of a fallen actor. */
function fallenMark(id: string, foot: WorldPoint): Group {
  const mark = new Group();
  mark.name = `dead:${id}`;
  mark.position.set(foot.x, foot.y + 6, Z_FALLEN);
  mark.add(pixel("stone", 0, 0, INK, 14, 6, 0));
  mark.add(pixel("stone-top", 0, 5, FALLEN_COLOR, 8, 4, 0));
  mark.add(pixel("inscription", 0, 0, GOLD, 2, 2, 1));
  return mark;
}

/** A two-pixel outline ring made from horizontal runs, never a smoothed circle. */
function eventRing(
  name: string,
  x: number,
  y: number,
  color: number,
  radius: number,
): Group {
  const ring = new Group();
  ring.name = name;
  ring.position.set(x, y, Z_RING);
  for (let row = -radius; row <= radius; row += 2) {
    const outer = Math.floor(Math.sqrt(radius * radius - row * row) / 2) * 2;
    const innerRadius = Math.max(0, radius - 4);
    const inner =
      Math.floor(
        Math.sqrt(Math.max(0, innerRadius * innerRadius - row * row)) / 2,
      ) * 2;
    if (outer <= inner) continue;
    const width = outer * 2;
    const hole = inner * 2;
    if (hole > 0) {
      const side = Math.max(2, Math.floor((width - hole) / 2 / 2) * 2);
      ring.add(
        pixel(`row:${row}:left`, -hole / 2 - side / 2, row, color, side, 2, 0),
      );
      ring.add(
        pixel(`row:${row}:right`, hole / 2 + side / 2, row, color, side, 2, 0),
      );
    } else {
      ring.add(pixel(`row:${row}`, 0, row, color, width, 2, 0));
    }
  }
  return ring;
}

export function buildDecor(
  view: WorldViewModel,
  realm: Realm,
  place: ViewLocation | undefined,
  fallen: ReadonlyMap<string, WorldPoint>,
): Decor {
  const objects: Object3D[] = [];

  const drawnEventIds: string[] = [];
  if (place === undefined) return { objects, drawnEventIds };

  for (const [index, building] of place.buildings.entries()) {
    if (building.status === "repairing" && building.repair) {
      objects.push(
        repairBar(
          building,
          buildingFoot(PLACE_ORIGIN, index, place.buildings.length),
        ),
      );
    }
  }
  for (const [id, foot] of fallen) objects.push(fallenMark(id, foot));

  // An event ring stands beside the place for each event placed at it; events at other places are not drawn.
  const here = placeEvents(view, realm).filter(
    (placed) => placed.locationId === place.id,
  );
  for (const [index, placed] of here.entries()) {
    objects.push(
      eventRing(
        `ring:${placed.event.id}`,
        PLACE_ORIGIN.x + EVENT_RING.dx,
        PLACE_ORIGIN.y + EVENT_RING.dy,
        EFFECT_COLOR[placed.tone],
        EVENT_RING.radius + (index % EVENT_RING.sizes) * EVENT_RING.step,
      ),
    );
    drawnEventIds.push(placed.event.id);
  }
  return { objects, drawnEventIds };
}

/** Removes every child of `group` and releases its geometry and materials. */
export function clearDecor(group: Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((node) => {
      if (node instanceof Mesh) {
        node.geometry.dispose();
        const materials = Array.isArray(node.material)
          ? node.material
          : [node.material];
        for (const material of materials) material.dispose();
      }
    });
  }
}
