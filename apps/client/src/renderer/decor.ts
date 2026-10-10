// Everything in the scene that is not an actor sprite: the ground grid, paths,
// places, buildings, flames, repair bars, event rings and the mark on a fallen
// actor. They are plain meshes in render-target pixel space (whole pixels, x
// right, y up) and keep the look they had before the shared pixel core; the
// visual pass restyles them. Their z sits below every actor except the rings
// and the mark, which sit above, so the sprite layer's depth key orders the
// rest.
//
// Colours are authored sRGB bytes and the target does no colour management,
// so they are set as bytes (see `pixelColor`).

import type { Realm } from "@panthea/contracts";
import { DEPTH_Z_MAX } from "@panthea/renderer";
import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  Group,
  Line,
  LinearSRGBColorSpace,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  RingGeometry,
  Vector3,
} from "three";

import type { ViewBuilding, ViewLocation, WorldViewModel } from "../store";
import { buildingCenter, type WorldPoint } from "./layout";
import { type EffectTone, placeEvents, realmPaths } from "./presentation";

const REALM_TINT: Record<Realm, number> = {
  mortal: 0x9a7956,
  olympus: 0x8c9d91,
  underworld: 0x716b73,
};

const EFFECT_COLOR: Record<EffectTone, number> = {
  fire: 0xc95637,
  worship: 0x8e7957,
  neutral: 0x668b80,
};

const OPERATIONAL = 0x8d9e81;
const STATUS_TINT: Record<string, number> = {
  operational: OPERATIONAL,
  damaged: 0xb7794d,
  burning: 0xc95637,
  destroyed: 0x625b56,
  repairing: 0x71918b,
};

const GRID_COLOR = 0xbdb5a5;
const FLAME_COLOR = 0xd56b36;
const REPAIR_COLOR = 0x71918b;
const FALLEN_COLOR = 0x6c3e38;

/** The scene's clear colour, as sRGB bytes. */
export const BACKGROUND: readonly [number, number, number] = [231, 223, 206];

// Depth, below every actor: grid and paths, places, buildings, flames, bars.
const Z_GRID = 0;
const Z_PLACE = 2;
const Z_BUILDING = 3;
const Z_FLAME = 4;
const Z_REPAIR = 5;
// Above every actor.
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

function line(
  name: string,
  from: WorldPoint,
  to: WorldPoint,
  color: number,
): Line {
  const path = new Line(
    new BufferGeometry().setFromPoints([
      new Vector3(from.x, from.y, Z_GRID),
      new Vector3(to.x, to.y, Z_GRID),
    ]),
    new LineBasicMaterial({
      color: pixelColor(color),
      transparent: true,
      opacity: 0.75,
    }),
  );
  path.name = name;
  return path;
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

function flame(building: ViewBuilding, x: number, y: number): Mesh {
  const ratio = building.fire?.destroyAt
    ? Math.min(1, building.fire.intensity / building.fire.destroyAt)
    : 0.65;
  const mesh = new Mesh(
    new CircleGeometry(7 + ratio * 8, 12),
    new MeshBasicMaterial({
      color: pixelColor(FLAME_COLOR),
      transparent: true,
      opacity: 0.82,
    }),
  );
  mesh.name = `flame:${building.id}`;
  mesh.position.set(x + 9, y + 20, Z_FLAME);
  return mesh;
}

function repairBar(building: ViewBuilding, x: number, y: number): Mesh {
  const repair = building.repair;
  const ratio = repair?.required
    ? repair.progress / repair.required
    : (repair?.progress ?? 0) / ((repair?.progress ?? 0) + 1);
  return block(
    `repair:${building.id}`,
    x,
    y - 15,
    REPAIR_COLOR,
    28 * Math.min(1, ratio),
    3,
    Z_REPAIR,
  );
}

/** A small cross at the foot of a fallen actor. */
function fallenMark(id: string, foot: WorldPoint): Group {
  const mark = new Group();
  mark.name = `dead:${id}`;
  mark.position.set(foot.x, foot.y + 6, Z_FALLEN);
  mark.add(block("bar", 0, 0, FALLEN_COLOR, 11, 3, 0));
  mark.add(block("bar", 0, 0, FALLEN_COLOR, 3, 11, 0));
  return mark;
}

export function buildDecor(
  view: WorldViewModel,
  realm: Realm,
  locations: readonly ViewLocation[],
  points: ReadonlyMap<string, WorldPoint>,
  fallen: ReadonlyMap<string, WorldPoint>,
): Decor {
  const objects: Object3D[] = [];
  const ink = REALM_TINT[realm];

  for (let y = -280; y < 320; y += 44) {
    objects.push(line(`grid:${y}`, { x: -460, y }, { x: 460, y }, GRID_COLOR));
  }
  for (const [fromId, toId] of realmPaths(locations)) {
    const start = points.get(fromId);
    const end = points.get(toId);
    if (start && end) {
      objects.push(line(`path:${fromId}:${toId}`, start, end, ink));
    }
  }
  for (const location of locations) {
    const from = points.get(location.id);
    if (!from) continue;
    const size = realm === "mortal" ? 26 : 19;
    objects.push(
      block(`place:${location.id}`, from.x, from.y, ink, size, size, Z_PLACE),
    );
    for (const [index, building] of location.buildings.entries()) {
      const { x, y } = buildingCenter(from, index);
      objects.push(
        block(
          `building:${building.id}`,
          x,
          y,
          STATUS_TINT[building.status] ?? OPERATIONAL,
          28,
          22,
          Z_BUILDING,
        ),
      );
      if (building.status === "burning") objects.push(flame(building, x, y));
      if (building.status === "repairing" && building.repair) {
        objects.push(repairBar(building, x, y));
      }
    }
  }
  for (const [id, foot] of fallen) objects.push(fallenMark(id, foot));

  const drawnEventIds: string[] = [];
  for (const [index, placed] of placeEvents(view, realm).entries()) {
    const point = points.get(placed.locationId);
    if (!point) continue;
    const ring = new Mesh(
      new RingGeometry(13 + (index % 3) * 3, 17 + (index % 3) * 3, 20),
      new MeshBasicMaterial({
        color: pixelColor(EFFECT_COLOR[placed.tone]),
        transparent: true,
        opacity: 0.72,
      }),
    );
    ring.name = `ring:${placed.event.id}`;
    ring.position.set(point.x + 34, point.y - 23, Z_RING);
    objects.push(ring);
    drawnEventIds.push(placed.event.id);
  }
  return { objects, drawnEventIds };
}

/** Removes every child of `group` and releases its geometry and materials. */
export function clearDecor(group: Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((node) => {
      if (node instanceof Mesh || node instanceof Line) {
        node.geometry.dispose();
        const materials = Array.isArray(node.material)
          ? node.material
          : [node.material];
        for (const material of materials) material.dispose();
      }
    });
  }
}
