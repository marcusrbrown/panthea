import { describe, expect, it } from "bun:test";
import {
  parseStructureSubject,
  parseStructureSubjects,
} from "./structure-subject";

const FAMILIES = ["town", "olympus", "underworld"];

const house = {
  schemaVersion: 1,
  id: "greek-house",
  name: "Greek house",
  paletteFamily: "town",
  render: {
    profile: "greek-house",
    matrix: {
      cellClass: "structure",
      directions: ["south"],
      required: [{ state: "intact" }, { state: "damaged" }, { state: "ruin" }],
    },
  },
};

describe("parseStructureSubject", () => {
  it("parses a structure and its render matrix", () => {
    const parsed = parseStructureSubject(house);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.id).toBe("greek-house");
    expect(parsed.value.render.matrix.cellClass).toBe("structure");
    expect(parsed.value.render.matrix.deferred).toEqual([]);
  });

  it("refuses an unknown key, a missing render and an ability slot", () => {
    expect(parseStructureSubject({ ...house, godId: "zeus" }).ok).toBe(false);
    const { render: _render, ...bare } = house;
    expect(parseStructureSubject(bare).ok).toBe(false);
    const withAbility = parseStructureSubject({
      ...house,
      render: {
        ...house.render,
        matrix: {
          ...house.render.matrix,
          required: [{ state: "act", ability: "thunderbolt" }],
        },
      },
    });
    expect(withAbility.ok).toBe(false);
    if (!withAbility.ok) expect(withAbility.message).toContain("no abilities");
  });
});

describe("parseStructureSubjects", () => {
  const input = (value: unknown, label = "greek-house.json") => ({
    label,
    value,
  });

  it("parses a set and returns it in order", () => {
    const parsed = parseStructureSubjects(
      [input(house), input({ ...house, id: "oak-tree" }, "oak-tree.json")],
      ["zeus"],
      FAMILIES,
    );
    expect(parsed.ok && parsed.value.map((s) => s.id)).toEqual([
      "greek-house",
      "oak-tree",
    ]);
  });

  it("refuses a duplicate id, a god's id and an unknown palette family", () => {
    const duplicate = parseStructureSubjects(
      [input(house), input(house, "again.json")],
      ["zeus"],
      FAMILIES,
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.path).toBe("again.json.id");

    const clash = parseStructureSubjects(
      [input({ ...house, id: "zeus" }, "zeus.json")],
      ["zeus"],
      FAMILIES,
    );
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.message).toContain("god");

    const family = parseStructureSubjects(
      [input({ ...house, paletteFamily: "sea" })],
      ["zeus"],
      FAMILIES,
    );
    expect(family.ok).toBe(false);
    if (!family.ok) expect(family.path).toBe("greek-house.json.paletteFamily");
  });
});
