import { expect, test } from "bun:test";
import { fakeSource, zeusCanonPayload } from "../assets/_test-canon";
import { createCanonClient } from "../assets/canon";
import {
  defaultSelection,
  listAssets,
  optionsOf,
  selectionLabel,
  selectionQuery,
} from "./selection";

async function load() {
  const canon = createCanonClient({ source: fakeSource(zeusCanonPayload()) });
  return canon.load();
}

test("the snapshot's assets are listed by id with their kind", async () => {
  const { snapshot } = await load();

  expect(listAssets(snapshot)).toEqual([
    expect.objectContaining({ assetId: "zeus-portrait", kind: "portrait" }),
    expect.objectContaining({ assetId: "zeus-sprite", kind: "sprite" }),
  ]);
});

test("every vocabulary state, direction and expression can be picked, published or not", async () => {
  const { vocabulary } = await load();

  const options = optionsOf(vocabulary);

  expect(options.states.map((state) => state.id)).toContain("seated");
  expect(options.states.map((state) => state.id)).toContain("act");
  expect(options.states.find((state) => state.id === "act")?.perAbility).toBe(
    true,
  );
  expect(options.states.find((state) => state.id === "idle")?.perAbility).toBe(
    false,
  );
  expect(options.directions).toEqual(["south", "north", "east", "west"]);
  expect(options.expressions).toEqual([
    "neutral",
    "pleased",
    "angry",
    "grieving",
    "scheming",
    "awed",
  ]);
});

test("with no vocabulary there is nothing to pick from, and a default still exists", async () => {
  const { snapshot } = await load();
  const [portrait, sprite] = listAssets(snapshot);

  expect(optionsOf(undefined)).toEqual({
    states: [],
    directions: [],
    expressions: [],
  });
  expect(defaultSelection(sprite, undefined)).toEqual({
    assetId: "zeus-sprite",
    kind: "sprite",
    state: "idle",
    direction: "south",
  });
  expect(defaultSelection(portrait, undefined)).toEqual({
    assetId: "zeus-portrait",
    kind: "portrait",
    expression: "neutral",
  });
});

test("a selection becomes the resolver query it names, explicitly", () => {
  expect(
    selectionQuery({
      assetId: "zeus-sprite",
      kind: "sprite",
      state: "seated",
      direction: "south",
    }),
  ).toEqual({ spriteId: "zeus-sprite", state: "seated", direction: "south" });
  expect(
    selectionQuery({
      assetId: "zeus-sprite",
      kind: "sprite",
      state: "act",
      direction: "east",
      ability: "thunderbolt",
    }),
  ).toEqual({
    spriteId: "zeus-sprite",
    state: "act",
    direction: "east",
    ability: "thunderbolt",
  });
  expect(
    selectionQuery({
      assetId: "zeus-portrait",
      kind: "portrait",
      expression: "awed",
    }),
  ).toEqual({ spriteId: "zeus-portrait", expression: "awed" });
});

test("labels read as what is selected", () => {
  expect(
    selectionLabel({
      assetId: "zeus-sprite",
      kind: "sprite",
      state: "idle",
      direction: "south",
    }),
  ).toBe("zeus-sprite idle/south");
  expect(
    selectionLabel({
      assetId: "zeus-portrait",
      kind: "portrait",
      expression: "angry",
    }),
  ).toBe("zeus-portrait expression:angry");
});
