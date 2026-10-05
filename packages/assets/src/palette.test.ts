import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ParseResult } from "@panthea/contracts";
import type { Rgb } from "./conformance";
import { committedVocabulary } from "./fixtures";
import { PALETTE_20 } from "./fixtures/conformance/images";
import {
  type Palette,
  type PaletteSource,
  paletteDigest,
  parsePalette,
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
