import { describe, expect, it } from "bun:test";
import zeusSubject from "../../../content/greek/assets/subjects/zeus.json";
import zeusJson from "../../../content/greek/gods/zeus.json";
import { type GodProfile, parseGodProfile } from "./god-profile";
import {
  type GodVisualProfile,
  parseGodVisualProfile,
  parseGodVisualProfiles,
  requiredRenderSlotKeys,
} from "./god-visual-profile";

const zeus = (() => {
  const parsed = parseGodProfile(zeusJson);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
})();
const hera: GodProfile = {
  ...zeus,
  id: "hera",
  name: "Hera",
  sprite: "placeholder-hera",
};

const visual = {
  schemaVersion: 1,
  godId: "zeus",
  paletteFamily: "olympus",
  iconography: ["thunderbolt", "cloud throne"],
};
const FAMILIES = ["town", "olympus", "underworld"];

describe("parseGodVisualProfile", () => {
  it("parses a profile and keeps an optional portrait id", () => {
    expect(parseGodVisualProfile(visual)).toEqual({
      ok: true,
      value: visual as GodVisualProfile,
    });
    const withPortrait = parseGodVisualProfile({
      ...visual,
      portrait: "zeus-portrait",
    });
    expect(withPortrait.ok && withPortrait.value.portrait).toBe(
      "zeus-portrait",
    );
  });

  it("keeps an optional asymmetry feature and leaves it absent otherwise", () => {
    const plain = parseGodVisualProfile(visual);
    expect(plain.ok && "asymmetry" in plain.value).toBe(false);
    const declared = parseGodVisualProfile({
      ...visual,
      portrait: "zeus-portrait",
      asymmetry: { feature: "bolt hand" },
    });
    expect(declared.ok && declared.value.asymmetry).toEqual({
      feature: "bolt hand",
    });
    expect(declared.ok && declared.value.portrait).toBe("zeus-portrait");
    expect(
      parseGodVisualProfile({ ...visual, asymmetry: { feature: "bolt hand" } }),
    ).toEqual({
      ok: true,
      value: { ...visual, asymmetry: { feature: "bolt hand" } },
    } as never);
  });

  it("refuses a malformed asymmetry with a path", () => {
    const cases: [unknown, RegExp][] = [
      [{}, /asymmetry\.feature/],
      [{ feature: "" }, /asymmetry\.feature/],
      [{ feature: 3 }, /asymmetry\.feature/],
      [{ feature: "bolt hand", side: "west" }, /side/],
      ["bolt hand", /asymmetry/],
    ];
    for (const [asymmetry, path] of cases) {
      const result = parseGodVisualProfile({ ...visual, asymmetry });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(`${result.path} ${result.message}`).toMatch(path);
    }
  });

  it("is strict: unknown keys, versions, empty or duplicate iconography and bad ids fail with a path", () => {
    const cases: [object, RegExp][] = [
      [{ ...visual, sprite: "x" }, /sprite/],
      [{ ...visual, schemaVersion: 2 }, /schemaVersion/],
      [{ ...visual, godId: "" }, /godId/],
      [{ ...visual, paletteFamily: undefined }, /paletteFamily/],
      [{ ...visual, iconography: [] }, /iconography/],
      [{ ...visual, iconography: ["a", "a"] }, /iconography\[1\]/],
      [{ ...visual, portrait: "Zeus Portrait" }, /portrait/],
    ];
    for (const [input, path] of cases) {
      const result = parseGodVisualProfile(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(`${result.path} ${result.message}`).toMatch(path);
    }
    expect(parseGodVisualProfile("nope").ok).toBe(false);
  });
});

describe("parseGodVisualProfiles", () => {
  const labeled = (...values: object[]) =>
    values.map((value, i) => ({ label: `subjects/${i}.json`, value }));

  it("joins profiles to gods by id", () => {
    const parsed = parseGodVisualProfiles(
      labeled(visual),
      [zeus, hera],
      FAMILIES,
    );
    expect(parsed.ok && parsed.value.map((p) => p.godId)).toEqual(["zeus"]);
  });

  it("rejects an unknown god, a duplicate, an unknown family and a shared portrait", () => {
    const unknown = parseGodVisualProfiles(
      labeled({ ...visual, godId: "apollo" }),
      [zeus],
      FAMILIES,
    );
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.path).toBe("subjects/0.json.godId");

    const duplicate = parseGodVisualProfiles(
      labeled(visual, visual),
      [zeus],
      FAMILIES,
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.path).toBe("subjects/1.json.godId");

    const family = parseGodVisualProfiles(
      labeled({ ...visual, paletteFamily: "elysium" }),
      [zeus],
      FAMILIES,
    );
    expect(family.ok).toBe(false);
    if (!family.ok) expect(family.path).toBe("subjects/0.json.paletteFamily");

    const shared = parseGodVisualProfiles(
      labeled(
        { ...visual, portrait: "same-portrait" },
        { ...visual, godId: "hera", portrait: "same-portrait" },
      ),
      [zeus, hera],
      FAMILIES,
    );
    expect(shared.ok).toBe(false);
    if (!shared.ok) expect(shared.path).toBe("subjects/1.json.portrait");
  });
});

describe("the core god profile is unchanged", () => {
  it("parses to exactly the core fields and ignores visual keys", () => {
    const keys = Object.keys(zeus).sort();
    expect(keys).toEqual(
      [
        "abilities",
        "domains",
        "drives",
        "id",
        "inventions",
        "lore",
        "name",
        "relationships",
        "schemaVersion",
        "sources",
        "sprite",
        "troubles",
        "variants",
      ].sort(),
    );
    expect(zeus.sprite).toBe("zeus-sprite");
    const withVisual = parseGodProfile({
      ...zeusJson,
      paletteFamily: "olympus",
      iconography: ["x"],
    });
    expect(withVisual.ok && Object.keys(withVisual.value).sort()).toEqual(keys);
  });
});

describe("a subject's render profile and required matrix", () => {
  const render = {
    profile: "zeus",
    matrix: {
      cellClass: "god-tall",
      directions: ["south", "north", "east", "west"],
      required: [
        { state: "idle" },
        { state: "walk" },
        { state: "seated" },
        { state: "act", ability: "thunderbolt" },
      ],
      deferred: [{ state: "act", ability: "pronouncement" }],
    },
  };
  const parseRender = (change: Record<string, unknown> = {}) =>
    parseGodVisualProfile({ ...visual, render: { ...render, ...change } });
  const withMatrix = (change: Record<string, unknown>) =>
    parseRender({ matrix: { ...render.matrix, ...change } });

  it("parses a profile id and a matrix, and leaves render absent otherwise", () => {
    const parsed = parseGodVisualProfile({ ...visual, render });
    expect(parsed.ok && parsed.value.render).toEqual(render as never);
    const plain = parseGodVisualProfile(visual);
    expect(plain.ok && "render" in plain.value).toBe(false);
  });

  it("expands the matrix to one slot key per state, ability and facing", () => {
    const parsed = parseGodVisualProfile({ ...visual, render });
    if (!parsed.ok || parsed.value.render === undefined)
      throw new Error("no render");
    const keys = requiredRenderSlotKeys(parsed.value.render.matrix);
    expect(keys).toHaveLength(16);
    expect(keys).toContain("idle/south");
    expect(keys).toContain("walk/west");
    expect(keys).toContain("seated/north");
    expect(keys).toContain("act/east/thunderbolt");
    expect(keys.some((key) => key.includes("pronouncement"))).toBe(false);
    expect(new Set(keys).size).toBe(16);
  });

  it("refuses a malformed render with a path (positive control: the well-formed render parses)", () => {
    expect(parseRender().ok).toBe(true);
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ["empty profile id", { profile: "" }, /render\.profile/],
      ["uppercase profile id", { profile: "Zeus" }, /render\.profile/],
      ["no matrix", { matrix: undefined }, /render\.matrix/],
      ["unknown render key", { camera: "iso" }, /camera/],
    ];
    for (const [label, change, path] of cases) {
      const result = parseRender(change);
      expect(result.ok, label).toBe(false);
      if (!result.ok)
        expect(`${result.path} ${result.message}`, label).toMatch(path);
    }
    const matrixCases: [string, Record<string, unknown>, RegExp][] = [
      ["no cell class", { cellClass: undefined }, /matrix\.cellClass/],
      ["no directions", { directions: [] }, /matrix\.directions/],
      [
        "duplicate direction",
        { directions: ["south", "south"] },
        /matrix\.directions/,
      ],
      ["no required slot", { required: [] }, /matrix\.required/],
      [
        "duplicate required slot",
        { required: [{ state: "idle" }, { state: "idle" }] },
        /matrix\.required\[1\]/,
      ],
      [
        "required slot without a state",
        { required: [{ ability: "x" }] },
        /required\[0\]\.state/,
      ],
      [
        "required slot that is also deferred",
        { deferred: [{ state: "idle" }] },
        /matrix\.deferred\[0\]/,
      ],
      ["unknown matrix key", { rows: 4 }, /rows/],
    ];
    for (const [label, change, path] of matrixCases) {
      const result = withMatrix(change);
      expect(result.ok, label).toBe(false);
      if (!result.ok)
        expect(`${result.path} ${result.message}`, label).toMatch(path);
    }
  });

  it("checks a matrix ability against the god's abilities when joined to its god", () => {
    const joined = (value: unknown) =>
      parseGodVisualProfiles([{ label: "zeus", value }], [zeus], FAMILIES);
    expect(joined({ ...visual, render }).ok).toBe(true);
    const bad = joined({
      ...visual,
      render: {
        ...render,
        matrix: {
          ...render.matrix,
          required: [{ state: "act", ability: "lightning" }],
        },
      },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain("lightning");
    const badDeferred = joined({
      ...visual,
      render: {
        ...render,
        matrix: {
          ...render.matrix,
          deferred: [{ state: "act", ability: "lightning" }],
        },
      },
    });
    expect(badDeferred.ok).toBe(false);
  });

  it("is declared on the committed Zeus subject: god-tall, four facings, pronouncement deferred", () => {
    const parsed = parseGodVisualProfile(zeusSubject);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.value.render).toEqual({
      profile: "zeus",
      matrix: {
        cellClass: "god-tall",
        directions: ["south", "north", "east", "west"],
        required: [
          { state: "idle" },
          { state: "walk" },
          { state: "seated" },
          { state: "act", ability: "thunderbolt" },
        ],
        deferred: [{ state: "act", ability: "pronouncement" }],
      },
    });
    // The legacy fields are unchanged.
    expect(parsed.value).toMatchObject({
      godId: "zeus",
      paletteFamily: "olympus",
      iconography: ["thunderbolt"],
      portrait: "zeus-portrait",
      asymmetry: { feature: "bolt hand" },
    });
  });
});
