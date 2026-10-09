import { describe, expect, it } from "bun:test";
import zeusJson from "../../../content/greek/gods/zeus.json";
import { type GodProfile, parseGodProfile } from "./god-profile";
import {
  type GodVisualProfile,
  parseGodVisualProfile,
  parseGodVisualProfiles,
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
