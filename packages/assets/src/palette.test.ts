import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ParseResult } from "@panthea/contracts";
import type { Rgb } from "./conformance";
import { committedVocabulary } from "./fixtures";
import { PALETTE_20 } from "./fixtures/conformance/images";
import { sha256Hex } from "./hash";
import {
  colourLimit,
  MASTER_PALETTE_ID,
  type Palette,
  type PaletteSource,
  paletteDigest,
  paletteSubdirectory,
  parsePalette,
  shadeBounds,
} from "./palette";

const FAMILIES = ["town", "olympus", "underworld"];
// biome-ignore lint/suspicious/noExplicitAny: the tests mutate nested JSON by path
type Json = Record<string, any>;
const MASTER: Rgb[] = [...PALETTE_20];

const hex6 = (c: Rgb) => c.map((v) => v.toString(16).padStart(2, "0")).join("");
const hash = (c: Rgb) => `#${hex6(c)}`;
const ramp = (id: string, shades: readonly Rgb[]) => ({
  id,
  shades: shades.map(hash),
});

// Plain JSON the way a file holds it, so each test mutates a fresh copy.
const jsonFor = (colours: readonly Rgb[]): Json => ({
  schemaVersion: 1,
  id: "test-master",
  approval: { status: "draft" },
  families: [
    {
      id: "town",
      ramps: [
        ramp("soil", colours.slice(0, 4)),
        ramp("olive", colours.slice(4, 8)),
      ],
    },
    {
      id: "olympus",
      ramps: [
        ramp("marble", colours.slice(8, 12)),
        ramp("gold", colours.slice(12, 17)),
      ],
    },
    // Shares colours with town: a colour may belong to several families.
    { id: "underworld", ramps: [ramp("ash", colours.slice(0, 4))] },
  ],
});

const gplOf = (colours: readonly Rgb[], name = "Test") =>
  [
    "GIMP Palette",
    `Name: ${name}`,
    "Columns: 4",
    "# a test palette",
    "",
    ...colours.map((c, i) => `${c.join(" ")} swatch-${i}`),
    "",
  ].join("\n");
const hexOf = (colours: readonly Rgb[]) => `${colours.map(hex6).join("\n")}\n`;

const source = (
  colours: readonly Rgb[] = MASTER,
  json: Json = jsonFor(colours),
): PaletteSource => ({
  json,
  gpl: gplOf(colours),
  hex: hexOf(colours),
});
const parse = (s: PaletteSource) => parsePalette(s, FAMILIES);

const must = <T>(result: ParseResult<T>): T => {
  if (!result.ok) throw new Error(`${result.path}: ${result.message}`);
  return result.value;
};
const failsAt = (result: ParseResult<unknown>, path: string, message = "") => {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.path).toContain(path);
  expect(result.message).toContain(message);
};

const uniqueColours = (n: number): Rgb[] =>
  Array.from({ length: n }, (_, i) => [i * 3, 255 - i * 2, (i * 7) % 256]);

describe("parsing a palette", () => {
  it("reads a draft with the master list, ramps and families as RGB", () => {
    const palette = must(parse(source()));
    expect(palette.id).toBe("test-master");
    expect(palette.approval).toEqual({ status: "draft" });
    expect(palette.colours).toEqual(MASTER);
    expect(palette.families.map((f) => f.id)).toEqual(FAMILIES);
    expect(palette.families[0]?.ramps[0]).toEqual({
      id: "soil",
      shades: MASTER.slice(0, 4),
    });
    expect(palette.families[1]?.ramps[1]?.shades).toHaveLength(5);
  });

  it("accepts a colour shared between families", () => {
    const palette = must(parse(source()));
    expect(palette.families[2]?.ramps[0]?.shades).toEqual(
      palette.families[0]?.ramps[0]?.shades,
    );
  });

  it("ignores GPL names, comments and headers, so the digest does not move", () => {
    const base = source();
    const renamed = {
      ...base,
      gpl: gplOf(MASTER, "Other name")
        .replace(/swatch-/g, "renamed-")
        .replace("# a test palette", "# another comment"),
    };
    const bare = {
      ...base,
      gpl: `GIMP Palette\n${MASTER.map((c) => c.join(" ")).join("\n")}\n`,
    };
    const digest = paletteDigest(must(parse(base)));
    expect(paletteDigest(must(parse(renamed)))).toBe(digest);
    expect(paletteDigest(must(parse(bare)))).toBe(digest);
  });

  it("never throws on input that is not a palette", () => {
    for (const json of [null, 5, "x", [], undefined, {}]) {
      expect(parsePalette({ json, gpl: "", hex: "" }, FAMILIES).ok).toBe(false);
    }
    expect(parse({ ...source(), json: null }).ok).toBe(false);
  });
});

describe("the GPL and HEX lists", () => {
  it("must name the same colours in the same order", () => {
    const base = source();
    const swapped = [...MASTER];
    [swapped[3], swapped[4]] = [swapped[4] as Rgb, swapped[3] as Rgb];
    const changed = MASTER.map((c, i): Rgb => (i === 6 ? [1, 2, 3] : c));
    failsAt(parse({ ...base, hex: hexOf(swapped) }), "master");
    failsAt(parse({ ...base, hex: hexOf(changed) }), "master");
    failsAt(parse({ ...base, hex: hexOf(MASTER.slice(0, 19)) }), "master");
    failsAt(parse({ ...base, gpl: gplOf(MASTER.slice(0, 19)) }), "master");
  });

  it("require the GPL header and 0-255 decimal channels", () => {
    const base = source();
    const lines = gplOf(MASTER).split("\n");
    const withLine = (index: number, line: string) => {
      const copy = [...lines];
      copy[index] = line;
      return copy.join("\n");
    };
    failsAt(
      parse({ ...base, gpl: withLine(0, "GIMP palette") }),
      "master.gpl",
      "GIMP Palette",
    );
    failsAt(
      parse({ ...base, gpl: withLine(5, "256 0 0 over") }),
      "master.gpl",
      "0-255",
    );
    failsAt(parse({ ...base, gpl: withLine(5, "-1 0 0") }), "master.gpl");
    failsAt(parse({ ...base, gpl: withLine(5, "1 2") }), "master.gpl");
    failsAt(
      parse({ ...base, gpl: withLine(5, "one two three") }),
      "master.gpl",
    );
    failsAt(parse({ ...base, gpl: gplOf(MASTER).slice(13) }), "master.gpl");
  });

  it("require lowercase six-digit lines with no #, LF endings and no blank lines", () => {
    const base = source();
    const good = hexOf(MASTER);
    const first = hex6(MASTER[4] as Rgb);
    const bad = [
      good.replace(first, first.toUpperCase()),
      good.replace(first, `#${first}`),
      good.replace(first, first.slice(0, 5)),
      good.slice(0, -1),
      `${good}\n`,
      good.replace("\n", "\n\n"),
      good.replace(/\n/g, "\r\n"),
      "",
    ];
    for (const hex of bad) {
      failsAt(parse({ ...base, hex }), "master.hex");
    }
  });

  it("allow 64 unique colours and refuse 65", () => {
    const sixtyFour = uniqueColours(64);
    expect(must(parse(source(sixtyFour))).colours).toHaveLength(64);
    failsAt(parse(source(uniqueColours(65))), "master", "64");
  });

  it("refuse a colour listed twice", () => {
    const repeated = MASTER.map(
      (c, i): Rgb => (i === 9 ? (MASTER[2] as Rgb) : c),
    );
    failsAt(parse(source(repeated, jsonFor(MASTER))), "master", "duplicate");
  });
});

describe("the palette JSON", () => {
  const mutate = (change: (json: Json) => void) => {
    const json = jsonFor(MASTER);
    change(json);
    return parse(source(MASTER, json));
  };

  it("is strict at every level", () => {
    failsAt(
      mutate((j) => {
        j.extra = 1;
      }),
      "extra",
      "unknown key",
    );
    failsAt(
      mutate((j) => {
        j.approval.extra = 1;
      }),
      "approval.extra",
    );
    failsAt(
      mutate((j) => {
        j.families[0].extra = 1;
      }),
      "families[0].extra",
    );
    failsAt(
      mutate((j) => {
        j.families[0].ramps[0].extra = 1;
      }),
      "ramps[0].extra",
    );
    failsAt(
      mutate((j) => {
        j.schemaVersion = 2;
      }),
      "schemaVersion",
    );
    failsAt(
      mutate((j) => {
        j.id = "Not A Slug";
      }),
      "id",
    );
  });

  it("names exactly the vocabulary's palette families", () => {
    failsAt(
      mutate((j) => {
        j.families.pop();
      }),
      "families",
      "underworld",
    );
    failsAt(
      mutate((j) => {
        j.families.push({
          id: "elysium",
          ramps: [ramp("x", MASTER.slice(0, 4))],
        });
      }),
      "families[3]",
      "elysium",
    );
    failsAt(
      mutate((j) => {
        j.families[2].id = "town";
      }),
      "families[2]",
      "duplicate",
    );
    failsAt(
      mutate((j) => {
        j.families[0].ramps = [];
      }),
      "families[0].ramps",
    );
    failsAt(
      mutate((j) => {
        j.families[0].ramps[1].id = "soil";
      }),
      "ramps[1]",
      "duplicate",
    );
  });

  it("takes four or five shades per ramp", () => {
    const withShades = (count: number) =>
      mutate((j) => {
        j.families[2].ramps[0].shades = MASTER.slice(0, count).map(hash);
      });
    failsAt(withShades(3), "families[2].ramps[0].shades", "4");
    expect(withShades(4).ok).toBe(true);
    expect(withShades(5).ok).toBe(true);
    failsAt(withShades(6), "families[2].ramps[0].shades", "5");
  });

  it("refuses a colour twice in one family, within or across ramps", () => {
    failsAt(
      mutate((j) => {
        j.families[0].ramps[0].shades[3] = j.families[0].ramps[0].shades[0];
      }),
      "families[0].ramps[0]",
      "duplicate",
    );
    failsAt(
      mutate((j) => {
        j.families[0].ramps[1].shades[0] = j.families[0].ramps[0].shades[1];
      }),
      "families[0].ramps[1]",
      "duplicate",
    );
  });

  it("refuses a shade that is not in the master list or not #rrggbb", () => {
    failsAt(
      mutate((j) => {
        j.families[1].ramps[0].shades[2] = "#010203";
      }),
      "families[1].ramps[0].shades[2]",
      "master",
    );
    for (const bad of ["#ABCDEF", "181428", "#fff", 7]) {
      failsAt(
        mutate((j) => {
          j.families[1].ramps[0].shades[2] = bad;
        }),
        "families[1].ramps[0].shades[2]",
      );
    }
  });
});

describe("approval and the digest", () => {
  const approvedJson = (palette: Palette, digest = paletteDigest(palette)) => ({
    ...jsonFor(MASTER),
    approval: { status: "approved", digest },
  });
  const draft = () => must(parse(source()));

  it("is a draft without a digest, or approved with the digest of this palette", () => {
    const palette = draft();
    expect(palette.approval).toEqual({ status: "draft" });
    const approved = must(parse(source(MASTER, approvedJson(palette))));
    expect(approved.approval).toEqual({
      status: "approved",
      digest: paletteDigest(palette),
    });
    expect(paletteDigest(approved)).toBe(paletteDigest(palette));
  });

  it("repeats for the same data and moves with any colour, ramp, id or order change", () => {
    const palette = draft();
    const digest = paletteDigest(palette);
    expect(paletteDigest(must(parse(source())))).toBe(digest);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);

    const approved = approvedJson(palette, digest);
    const shade = JSON.parse(JSON.stringify(approved));
    shade.families[0].ramps[0].shades[0] = hash(MASTER[9] as Rgb);
    failsAt(parse(source(MASTER, shade)), "approval.digest", "does not match");

    const renamed = { ...approved, id: "other-master" };
    failsAt(parse(source(MASTER, renamed)), "approval.digest");

    const rampId = JSON.parse(JSON.stringify(approved));
    rampId.families[1].ramps[0].id = "marble-2";
    failsAt(parse(source(MASTER, rampId)), "approval.digest");

    const unusedColour = MASTER.map((c, i): Rgb => (i === 19 ? [9, 9, 9] : c));
    failsAt(
      parse(source(unusedColour, approved)),
      "approval.digest",
      "does not match",
    );

    const reordered = [...MASTER];
    [reordered[18], reordered[19]] = [
      reordered[19] as Rgb,
      reordered[18] as Rgb,
    ];
    failsAt(parse(source(reordered, approved)), "approval.digest");
  });

  it("refuses an approval without a digest, a draft with one, and a malformed digest", () => {
    const palette = draft();
    failsAt(
      parse(
        source(MASTER, {
          ...jsonFor(MASTER),
          approval: { status: "approved" },
        }),
      ),
      "approval.digest",
    );
    failsAt(
      parse(
        source(MASTER, {
          ...jsonFor(MASTER),
          approval: { status: "draft", digest: paletteDigest(palette) },
        }),
      ),
      "approval",
    );
    failsAt(
      parse(source(MASTER, approvedJson(palette, "abc" as never))),
      "approval.digest",
    );
    failsAt(
      parse(
        source(MASTER, { ...jsonFor(MASTER), approval: { status: "pending" } }),
      ),
      "approval.status",
    );
  });
});

describe("the committed master palette", () => {
  const dir = join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "content",
    "greek",
    "palette",
  );
  const read = (name: string) => readFileSync(join(dir, name), "utf8");

  it("parses with ordered GPL and HEX lists and the vocabulary's families", () => {
    const palette = must(
      parsePalette(
        {
          json: JSON.parse(read("palette.json")),
          gpl: read("master.gpl"),
          hex: read("master.hex"),
        },
        committedVocabulary().paletteFamilies,
      ),
    );
    expect(palette.id).toBe("greek-master");
    expect(palette.colours).toHaveLength(48);
    expect(palette.families.map((f) => f.id)).toEqual([
      "town",
      "olympus",
      "underworld",
    ]);
    const ramps = palette.families.flatMap((f) => f.ramps);
    expect(ramps).toHaveLength(12);
    expect(ramps.every((r) => r.shades.length === 4)).toBe(true);
  });
});

describe("limits a palette declares", () => {
  const withLimits = (limits: unknown, shades = 6): Json => {
    const json = jsonFor(MASTER);
    json.limits = limits;
    json.families[2].ramps[0].shades = MASTER.slice(0, shades).map(hash);
    return json;
  };
  const RETRO = { shades: { min: 4, max: 6 }, colours: { sprite: 48 } };

  it("falls back to the legacy rules when none are declared: 4-5 shades, 16 per sprite, 32 per portrait", () => {
    const palette = must(parse(source()));
    expect(palette.limits).toBeUndefined();
    expect(shadeBounds(palette)).toEqual({ min: 4, max: 5 });
    expect(colourLimit(palette, "sprite")).toBe(16);
    expect(colourLimit(palette, "portrait")).toBe(32);
  });

  it("passes a 6-shade ramp under declared 4-6 shades and fails the same ramp without them", () => {
    const declared = must(parse(source(MASTER, withLimits(RETRO))));
    expect(declared.families[2]?.ramps[0]?.shades).toHaveLength(6);
    expect(shadeBounds(declared)).toEqual({ min: 4, max: 6 });
    failsAt(
      parse(source(MASTER, withLimits(undefined))),
      "families[2].ramps[0].shades",
      "5",
    );
  });

  it("holds the declared bounds on both sides", () => {
    failsAt(
      parse(source(MASTER, withLimits(RETRO, 7))),
      "families[2].ramps[0].shades",
      "6",
    );
    failsAt(
      parse(source(MASTER, withLimits(RETRO, 3))),
      "families[2].ramps[0].shades",
      "4",
    );
    // A declared bound is the palette's own: 4-5 declared refuses a sixth shade.
    const narrow = { ...RETRO, shades: { min: 4, max: 5 } };
    failsAt(
      parse(source(MASTER, withLimits(narrow, 6))),
      "families[2].ramps[0].shades",
      "5",
    );
  });

  it("reads the per-sprite colour budget, and the portrait budget when declared", () => {
    const palette = must(parse(source(MASTER, withLimits(RETRO))));
    expect(colourLimit(palette, "sprite")).toBe(48);
    expect(colourLimit(palette, "portrait")).toBe(32);
    const portrait = must(
      parse(
        source(
          MASTER,
          withLimits({ ...RETRO, colours: { sprite: 48, portrait: 40 } }),
        ),
      ),
    );
    expect(colourLimit(portrait, "portrait")).toBe(40);
  });

  it("refuses malformed limits with a path", () => {
    const cases: [string, unknown, string][] = [
      ["unknown key", { ...RETRO, extra: 1 }, "limits.extra"],
      ["no shades", { colours: RETRO.colours }, "limits.shades"],
      ["no colours", { shades: RETRO.shades }, "limits.colours"],
      [
        "inverted shades",
        { ...RETRO, shades: { min: 6, max: 4 } },
        "limits.shades",
      ],
      [
        "fewer than two shades",
        { ...RETRO, shades: { min: 1, max: 6 } },
        "limits.shades.min",
      ],
      [
        "more than eight shades",
        { ...RETRO, shades: { min: 4, max: 9 } },
        "limits.shades.max",
      ],
      [
        "a sprite budget over the 64-colour master cap",
        { ...RETRO, colours: { sprite: 65 } },
        "limits.colours.sprite",
      ],
      [
        "a zero sprite budget",
        { ...RETRO, colours: { sprite: 0 } },
        "limits.colours.sprite",
      ],
      [
        "a fractional budget",
        { ...RETRO, colours: { sprite: 4.5 } },
        "limits.colours.sprite",
      ],
      [
        "an unknown colours key",
        { ...RETRO, colours: { sprite: 48, tile: 8 } },
        "limits.colours.tile",
      ],
      ["limits that are not an object", 48, "limits"],
    ];
    for (const [label, limits, path] of cases) {
      const result = parse(source(MASTER, withLimits(limits, 4)));
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.path, label).toContain(path);
    }
    expect(parse(source(MASTER, withLimits(RETRO, 4))).ok).toBe(true);
  });

  it("makes the limits part of the digest, and leaves the digest of a palette without them as it was", () => {
    const plain = must(parse(source(MASTER, withLimits(undefined, 4))));
    const declared = must(parse(source(MASTER, withLimits(RETRO, 4))));
    const widened = must(
      parse(
        source(MASTER, withLimits({ ...RETRO, colours: { sprite: 49 } }, 4)),
      ),
    );
    const wider = must(
      parse(
        source(MASTER, withLimits({ ...RETRO, shades: { min: 4, max: 5 } }, 4)),
      ),
    );
    const digests = [plain, declared, widened, wider].map(paletteDigest);
    expect(new Set(digests).size).toBe(4);
    // Same colours, ramps and id: only the declared limits differ.
    expect(declared.colours).toEqual(plain.colours);
  });

  it("refuses an approved palette whose limits were edited after approval", () => {
    const palette = must(parse(source(MASTER, withLimits(RETRO, 4))));
    const approvedJson = (limits: unknown): Json => ({
      ...withLimits(limits, 4),
      approval: { status: "approved", digest: paletteDigest(palette) },
    });
    expect(parse(source(MASTER, approvedJson(RETRO))).ok).toBe(true);
    failsAt(
      parse(
        source(MASTER, approvedJson({ ...RETRO, colours: { sprite: 64 } })),
      ),
      "approval.digest",
    );
    // Declaring limits on a palette approved without them changes its digest too.
    failsAt(parse(source(MASTER, approvedJson(undefined))), "approval.digest");
  });
});

describe("where a palette lives", () => {
  it("maps greek-master to the palette root and any other id to a subdirectory", () => {
    expect(MASTER_PALETTE_ID).toBe("greek-master");
    expect(paletteSubdirectory("greek-master")).toBe("");
    expect(paletteSubdirectory("greek-retro")).toBe("greek-retro");
  });
});

describe("the committed palettes", () => {
  const root = join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "content",
    "greek",
    "palette",
  );
  const read = (dir: string, name: string) =>
    readFileSync(join(root, dir, name), "utf8");
  const load = (dir: string) =>
    must(
      parsePalette(
        {
          json: JSON.parse(read(dir, "palette.json")),
          gpl: read(dir, "master.gpl"),
          hex: read(dir, "master.hex"),
        },
        committedVocabulary().paletteFamilies,
      ),
    );

  it("leaves greek-master's three files and its approved digest exactly as they were on main", () => {
    const sha = (name: string): string =>
      sha256Hex(new TextEncoder().encode(read("", name)));
    expect(sha("palette.json")).toBe(
      "6229c87590e46c65895d7f1c3bac730bb649c40961446831aa0db3368ba0b496",
    );
    expect(sha("master.gpl")).toBe(
      "0fa8f49ca1b2ede23034e54f8d1748f993c9a1bf27819adb0d74e5eb767dc238",
    );
    expect(sha("master.hex")).toBe(
      "e0bcae8baa24a6e68074ca1dcb84b4f08284920dcbb2a8961edf847b4723996a",
    );
    const master = load("");
    expect(master.limits).toBeUndefined();
    expect(String(paletteDigest(master))).toBe(
      "faa637b2ce7bd3493f20a7a1b191554640b9a801a6e8fc42f8a985bb07073209",
    );
    expect(master.approval).toEqual({
      status: "approved",
      digest:
        "faa637b2ce7bd3493f20a7a1b191554640b9a801a6e8fc42f8a985bb07073209",
    } as never);
  });

  describe("greek-retro", () => {
    const retro = load("greek-retro");

    it("is approved against its own digest, with its own id and the declared 4-6 shade, 48-colour limits", () => {
      expect(retro.id).toBe("greek-retro");
      // Approved by the owner on 2026-10-12: the digest covers id, colours, ramps and limits.
      expect(retro.approval).toEqual({
        status: "approved",
        digest:
          "40f059ffae86409cd87d776492fd797f5efc6ad970114810fd97102e83e9c686",
      } as never);
      expect(String(paletteDigest(retro))).toBe(
        "40f059ffae86409cd87d776492fd797f5efc6ad970114810fd97102e83e9c686",
      );
      expect(retro.limits).toEqual({
        shades: { min: 4, max: 6 },
        colours: { sprite: 48 },
      });
      expect(colourLimit(retro, "sprite")).toBe(48);
      expect(retro.colours.length).toBeLessThanOrEqual(64);
    });

    it("keeps the vocabulary's three families, every ramp a 4-6 shade ramp of the master list", () => {
      expect(retro.families.map((f) => f.id)).toEqual([
        "town",
        "olympus",
        "underworld",
      ]);
      for (const ramp of retro.families.flatMap((f) => f.ramps))
        expect(ramp.shades.length).toBeGreaterThanOrEqual(4);
    });

    it("holds every ramp Zeus draws inside olympus", () => {
      const olympus = retro.families.find((f) => f.id === "olympus");
      const ramps = new Map(olympus?.ramps.map((r) => [r.id, r.shades]));
      // The probe's Zeus: skin and trim and bolt in pale-gold, robe and beard in cloud, hair and brow in marble, eyes in lapis.
      for (const id of ["pale-gold", "cloud", "marble", "lapis"])
        expect(ramps.has(id), id).toBe(true);
      const olympusColours = new Set(
        (olympus?.ramps ?? []).flatMap((r) => r.shades.map(hash)),
      );
      // The bolt stamp's dark, mid and light (tools/probes/blender-sprite/stamps/bolt-stamps.json).
      for (const stamp of ["#76572f", "#ddbf70", "#f4e4ae"])
        expect(olympusColours.has(stamp), stamp).toBe(true);
      // Outline: the darkest shade of each Zeus ramp.
      for (const id of ["pale-gold", "cloud", "marble", "lapis"])
        expect(olympusColours.has(hash(ramps.get(id)?.[0] as Rgb)), id).toBe(
          true,
        );
    });

    it("computes a stable digest of its own data", () => {
      expect(paletteDigest(retro)).toMatch(/^[0-9a-f]{64}$/);
      expect(paletteDigest(retro)).not.toBe(paletteDigest(load("")));
    });
  });
});
