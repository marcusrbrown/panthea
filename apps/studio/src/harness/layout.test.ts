import { describe, expect, it } from "bun:test";
import type { PreviewItem } from "../renderer/preview";
import {
  HARNESS_CAMERA,
  harnessItems,
  MISSING_SPRITE,
  PORTRAIT_PANEL_AT,
} from "./layout";

const zeus = { source: "draft", id: "zeus-idle" } as const;
const portrait = { source: "canon", id: "zeus-portrait" } as const;

function byId(items: readonly PreviewItem[], id: string): PreviewItem {
  const found = items.find((item) => item.id === id);
  if (found === undefined) throw new Error(`no item ${id}`);
  return found;
}

describe("harnessItems", () => {
  const items = harnessItems({
    subject: zeus,
    portrait,
    state: "idle",
    direction: "south",
    expression: "neutral",
    companion: true,
  });

  it("lays a 4x4 ground patch of diamonds", () => {
    const ground = items.filter((item) => item.kind === "diamond");
    expect(ground).toHaveLength(16);
    expect(new Set(ground.map((item) => item.id)).size).toBe(16);
  });

  it("asks for the chosen state and direction of the subject, and the seated state beside it", () => {
    expect(byId(items, "subject")).toMatchObject({
      kind: "sprite",
      layer: "actor",
      request: { ...zeus, state: "idle", direction: "south" },
    });
    expect(byId(items, "seated")).toMatchObject({
      kind: "sprite",
      request: { ...zeus, state: "seated", direction: "south" },
    });
  });

  it("omits the seated companion when it is switched off", () => {
    const without = harnessItems({
      subject: zeus,
      portrait,
      state: "idle",
      direction: "south",
      expression: "neutral",
      companion: false,
    });
    expect(without.some((item) => item.id === "seated")).toBe(false);
  });

  it("draws a placeholder mortal for scale and a 2x2 placeholder structure two depth steps behind the subject", () => {
    expect(byId(items, "mortal")).toMatchObject({
      layer: "actor",
      request: MISSING_SPRITE,
    });
    expect(byId(items, "structure")).toMatchObject({
      layer: "structure",
      cell: { x: 0, y: 0, z: 0 },
      footprint: { w: 2, h: 2 },
      request: MISSING_SPRITE,
    });
    expect(byId(items, "subject")).toMatchObject({
      cell: { x: 2, y: 2, z: 0 },
    });
  });

  it("puts the portrait on a flat panel at the fixed screen position, asking for the chosen expression", () => {
    expect(byId(items, "portrait")).toMatchObject({
      kind: "flat",
      at: PORTRAIT_PANEL_AT,
      request: { ...portrait, expression: "neutral" },
    });
  });

  it("falls back to a placeholder subject and no portrait when nothing is selected", () => {
    const empty = harnessItems({
      subject: undefined,
      portrait: undefined,
      state: "idle",
      direction: "south",
      expression: "neutral",
      companion: true,
    });
    expect(byId(empty, "subject")).toMatchObject({ request: MISSING_SPRITE });
    expect(empty.some((item) => item.id === "portrait")).toBe(false);
  });

  it("swaps the layers and shares the subject's bottom cell when the structure is to draw in front", () => {
    const swapped = harnessItems({
      subject: zeus,
      portrait,
      state: "idle",
      direction: "south",
      expression: "neutral",
      companion: false,
      occlusion: "structure-front",
    });
    expect(byId(swapped, "structure")).toMatchObject({
      layer: "actor",
      cell: { x: 1, y: 1, z: 0 },
      footprint: { w: 2, h: 2 },
    });
    expect(byId(swapped, "subject")).toMatchObject({
      layer: "structure",
      cell: { x: 2, y: 2, z: 0 },
    });
  });

  it("keeps the camera on whole logical pixels", () => {
    expect(Number.isInteger(HARNESS_CAMERA.x)).toBe(true);
    expect(Number.isInteger(HARNESS_CAMERA.y)).toBe(true);
  });
});
