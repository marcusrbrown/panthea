// Everything in the scene that is not an actor sprite: the ground grid, paths,
// places, buildings, flames, repair bars, event rings and the mark on a fallen
// actor. They are square-edged mesh clusters in render-target pixel space
// (whole pixels, x right, y up), using the same palette and depth ordering as
// the sprite layer. Rings and the fallen mark sit above actors; the rest sit
// below them.
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
import { buildingCenter, type WorldPoint } from "./layout";
import { type EffectTone, placeEvents, realmPaths } from "./presentation";

const INK = 0x273c35;
const MOSS = 0x426c58;
const RUST = 0xa54d36;
const GOLD = 0x96733e;
const PAPER = 0xeee9dc;
const PAPER_DEEP = 0xded6c4;
const REALM_TINT: Record<Realm, number> = {
  mortal: MOSS,
  olympus: GOLD,
  underworld: INK,
};

const EFFECT_COLOR: Record<EffectTone, number> = {
  fire: RUST,
  worship: GOLD,
  neutral: MOSS,
};

const OPERATIONAL = MOSS;
const STATUS_TINT: Record<string, number> = {
  operational: OPERATIONAL,
  damaged: GOLD,
  burning: RUST,
  destroyed: INK,
  repairing: MOSS,
};

const GRID_COLOR = PAPER_DEEP;
const FLAME_COLOR = GOLD;
const REPAIR_COLOR = MOSS;
const FALLEN_COLOR = RUST;

/** The scene's clear colour, as sRGB bytes. */
export const BACKGROUND: readonly [number, number, number] = [238, 233, 220];

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

function flame(building: ViewBuilding, x: number, y: number): Group {
  const ratio = building.fire?.destroyAt
    ? Math.min(1, building.fire.intensity / building.fire.destroyAt)
    : 0.65;
  const size = ratio > 0.75 ? 1 : 0;
  const group = new Group();
  group.name = `flame:${building.id}`;
  group.position.set(x + 10, y + 22, Z_FLAME);
  group.add(pixel("outer", 0, 0, RUST, 8 + size * 4, 12 + size * 4, 0));
  group.add(pixel("core", 0, -2, FLAME_COLOR, 4 + size * 2, 6 + size * 2, 1));
  group.add(pixel("spark", 0, 6 + size * 2, GOLD, 4, 2, 2));
  return group;
}

function repairBar(building: ViewBuilding, x: number, y: number): Group {
  const repair = building.repair;
  const ratio = repair?.required
    ? repair.progress / repair.required
    : (repair?.progress ?? 0) / ((repair?.progress ?? 0) + 1);
  const width = Math.max(2, Math.floor((28 * Math.min(1, ratio)) / 2) * 2);
  const group = new Group();
  group.name = `repair:${building.id}`;
  group.position.set(x, y - 15, Z_REPAIR);
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

function placeMark(name: string, point: WorldPoint, color: number): Group {
  const mark = new Group();
  mark.name = name;
  mark.position.set(point.x, point.y, Z_PLACE);
  for (const [row, width] of [4, 8, 12, 16, 12, 8, 4].entries()) {
    mark.add(pixel(`row:${row}`, 0, 6 - row * 2, color, width, 2, 0));
  }
  mark.add(pixel("heart", 0, 0, PAPER, 4, 4, 1));
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
  locations: readonly ViewLocation[],
  points: ReadonlyMap<string, WorldPoint>,
  fallen: ReadonlyMap<string, WorldPoint>,
): Decor {
  const objects: Object3D[] = [];
  const ink = REALM_TINT[realm];

  for (let y = -280; y < 320; y += 48) {
    objects.push(block(`grid:${y}`, 0, y, GRID_COLOR, 560, 2, Z_GRID));
  }
  for (const [fromId, toId] of realmPaths(locations)) {
    const start = points.get(fromId);
    const end = points.get(toId);
    if (start && end) {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const steps = Math.max(Math.abs(dx), Math.abs(dy));
      for (let step = 0; step <= steps; step += 4) {
        const x = Math.round(start.x + (dx * step) / Math.max(1, steps));
        const y = Math.round(start.y + (dy * step) / Math.max(1, steps));
        objects.push(
          block(`path:${fromId}:${toId}:${step}`, x, y, ink, 4, 4, Z_GRID),
        );
      }
    }
  }
  for (const location of locations) {
    const from = points.get(location.id);
    if (!from) continue;
    objects.push(placeMark(`place:${location.id}`, from, ink));
    for (const [index, building] of location.buildings.entries()) {
      const { x, y } = buildingCenter(from, index);
      const wall = STATUS_TINT[building.status] ?? OPERATIONAL;
      const house = new Group();
      house.name = `building:${building.id}`;
      house.position.set(x, y, Z_BUILDING);
      house.add(pixel("shadow", 0, -12, INK, 32, 4, 0));
      house.add(pixel("wall", 0, -3, wall, 24, 14, 1));
      house.add(
        pixel("roof", 0, 7, realm === "olympus" ? GOLD : RUST, 30, 6, 2),
      );
      house.add(pixel("gable", 0, 11, INK, 18, 2, 2));
      house.add(pixel("door", 0, -7, INK, 4, 8, 3));
      house.add(pixel("window", -7, -1, PAPER, 4, 4, 3));
      house.add(pixel("window", 7, -1, PAPER, 4, 4, 3));
      objects.push(house);
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
    objects.push(
      eventRing(
        `ring:${placed.event.id}`,
        point.x + 34,
        point.y - 23,
        EFFECT_COLOR[placed.tone],
        16 + (index % 3) * 4,
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
