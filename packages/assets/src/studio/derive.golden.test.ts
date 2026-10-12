// Characterization of the derivation core: the exact PNG bytes (by sha256) each
// recipe produces for fixed inputs, and the result hash each step records. The
// hashes are committed; they change only when a recipe or the PNG encoder
// changes, and then the recipe version (or ENCODER_IDENTITY) is bumped with
// them. Every golden PNG is also validated structurally, not just hashed: a
// truncated or mis-framed file can match a hash it was captured from.

import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import type { AssetId, Sha256 } from "@panthea/contracts";
import type { Rgb, RgbaImage } from "../conformance";
import { type Palette, parsePalette } from "../palette";
import { encodeRgbaPng } from "../placeholder";
import { filtersValid, inflatedLength, parsePng } from "../png";
import {
  type BobParams,
  bobSlot,
  type Derivation,
  type DerivedSlot,
  mirrorSlot,
  type SlotInput,
  swapPalette,
} from "./derive";
import { decodePng } from "./png/decode";

const CONTENT = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "content",
  "greek",
);
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const palette: Palette = (() => {
  const read = (name: string) =>
    readFileSync(join(CONTENT, "palette", name), "utf8");
  const parsed = parsePalette(
    {
      json: JSON.parse(read("palette.json")),
      gpl: read("master.gpl"),
      hex: read("master.hex"),
    },
    ["town", "olympus", "underworld"],
  );
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
})();
const ramps = (id: string) => {
  const found = palette.families.find((f) => f.id === id);
  if (found === undefined) throw new Error(`no family ${id}`);
  return found.ramps;
};
const olympus = ramps("olympus");
const underworld = ramps("underworld");

const [W, H] = [64, 80];
const GEOMETRY = {
  cell: { w: W, h: H },
  pivot: { x: 32, y: 80 },
  footprint: { w: 1, h: 1 },
};
const SOURCE = {
  assetId: "zeus-sprite" as AssetId,
  revision: "a".repeat(64) as Sha256,
};
const DURATIONS = [333, 167, 333, 167];

function paint(
  image: RgbaImage,
  x: number,
  y: number,
  w: number,
  h: number,
  rgb: Rgb,
) {
  for (let row = y; row < y + h; row += 1)
    for (let col = x; col < x + w; col += 1)
      image.rgba.set(
        [rgb[0], rgb[1], rgb[2], 255],
        (row * image.width + col) * 4,
      );
}

const shade = (ramp: number, index: number): Rgb =>
  (olympus[ramp] as { shades: readonly Rgb[] }).shades[index] as Rgb;

function figure(rise: number, bolt: boolean): RgbaImage {
  const image: RgbaImage = {
    rgba: new Uint8Array(W * H * 4),
    width: W,
    height: H,
  };
  paint(image, 28, 10 - rise, 8, 8, shade(0, 2));
  paint(image, 24, 18, 16, 30, shade(2, 1));
  paint(image, 26, 48, 12, 26, shade(2, 0));
  paint(image, 29, 74, 6, 4, shade(1, 0));
  if (bolt) {
    paint(image, 40, 20, 4, 14, shade(1, 2));
    paint(image, 44, 16, 2, 10, shade(3, 3));
  }
  return image;
}

const slotOf = (key: string, bolt: boolean): SlotInput => ({
  key,
  frames: DURATIONS.map((durationMs, i) => ({
    image: figure(i, bolt),
    durationMs,
  })),
});

/** Structure, CRCs, inflated length and filter bytes of an encoded frame, and the pixels it decodes to. */
function expectWellFormedPng(bytes: Uint8Array, image: RgbaImage) {
  const parsed = parsePng(bytes);
  if (!parsed.ok) throw new Error(parsed.reason);
  const { png } = parsed;
  expect([
    png.width,
    png.height,
    png.bitDepth,
    png.colorType,
    png.interlace,
  ]).toEqual([image.width, image.height, 8, 6, 0]);
  const raw = inflateSync(Buffer.concat(png.idat));
  expect(raw.length).toBe(inflatedLength(png));
  expect(filtersValid(raw, png)).toBe(true);
  const decoded = decodePng(bytes);
  if (!decoded.ok) throw new Error(decoded.message);
  expect(decoded.image.rgba).toEqual(image.rgba);
  // RGB hidden under alpha 0 is zero in every golden.
  for (let at = 0; at < image.rgba.length; at += 4)
    if (image.rgba[at + 3] === 0)
      expect([...image.rgba.subarray(at, at + 3)]).toEqual([0, 0, 0]);
}

interface Golden {
  /** sha256 of each frame's PNG bytes, in order. */
  readonly frames: readonly string[];
  /** The step's recorded result hash, one per output slot. */
  readonly results: readonly string[];
}

function check(
  derived: Derivation | { ok: false; message: string },
): readonly DerivedSlot[] {
  if (!derived.ok) throw new Error(derived.message);
  return derived.slots;
}

function observe(slots: readonly DerivedSlot[]): Golden {
  const frames: string[] = [];
  for (const slot of slots)
    for (const frame of slot.frames) {
      expectWellFormedPng(frame.png, frame.image);
      expect(frame.png).toEqual(
        encodeRgbaPng(frame.image.rgba, frame.image.width, frame.image.height),
      );
      frames.push(sha(frame.png));
    }
  return { frames, results: slots.map((s) => s.resultHash) };
}

const east = (bolt: boolean) => slotOf("idle/east", bolt);

const mirrorOf = (bolt: boolean) =>
  mirrorSlot({
    source: SOURCE,
    slot: east(bolt),
    subject: {},
    geometry: GEOMETRY,
  });

const swapOf = () =>
  swapPalette({
    source: SOURCE,
    slots: [slotOf("idle/south", true), slotOf("act/south/thunderbolt", true)],
    sourceFamily: "olympus",
    targetFamily: "underworld",
    pairs: olympus.map((source, i) => ({
      source,
      target: underworld[i] as (typeof underworld)[number],
    })),
  });

const BOB: BobParams = {
  region: { x: 20, y: 8, w: 30, h: 40 },
  exclude: [{ x: 40, y: 19, w: 6, h: 16 }],
  dy: [0, 0, -1, 0],
  durationsMs: DURATIONS,
  seam: "fill-from-fixed",
  repairs: [],
};
const bobOf = () =>
  bobSlot({
    source: SOURCE,
    slot: slotOf("idle/south", true),
    geometry: { cell: GEOMETRY.cell },
    limits: { frames: { min: 4, max: 4 }, durationMs: { min: 166, max: 334 } },
    params: BOB,
  });

// The canon zeus-sprite revision, read-only and pinned by its hash.
const CANON_REVISION =
  "1382b7f7604f3fed64721f7f1bb4ee99f474d1ddafed5bde2aa7a1487230a56d";

function canonIdle(): SlotInput {
  const registry = join(CONTENT, "assets", "registry");
  const text = readFileSync(
    join(registry, "manifests", `${CANON_REVISION}.json`),
    "utf8",
  );
  expect(sha(new TextEncoder().encode(text))).toBe(CANON_REVISION);
  const manifest = JSON.parse(text);
  const atlasBytes = new Uint8Array(
    readFileSync(join(registry, "blobs", `${manifest.atlas.blob}.png`)),
  );
  expect(sha(atlasBytes)).toBe(manifest.atlas.blob);
  const atlas = decodePng(atlasBytes);
  if (!atlas.ok) throw new Error(atlas.message);
  const idle = manifest.animations.find(
    (a: { state: string }) => a.state === "idle",
  );
  return {
    key: "idle/south",
    frames: idle.frames.map(
      (f: {
        rect: { x: number; y: number; w: number; h: number };
        durationMs: number;
      }) => {
        const { x, y, w, h } = f.rect;
        const rgba = new Uint8Array(w * h * 4);
        for (let row = 0; row < h; row += 1) {
          const from = ((y + row) * atlas.image.width + x) * 4;
          rgba.set(atlas.image.rgba.subarray(from, from + w * 4), row * w * 4);
        }
        return {
          image: { rgba, width: w, height: h },
          durationMs: f.durationMs,
        };
      },
    ),
  };
}

/** The probe's region for the idle rise (tools/probes/art-edit/sprite_idle_c2.py). */
const CANON_BOB: BobParams = {
  region: { x: 25, y: 30, w: 39, h: 16 },
  exclude: [{ x: 38, y: 43, w: 26, h: 37 }],
  dy: [0, 0, -1, 0],
  durationsMs: DURATIONS,
  seam: "fill-from-fixed",
  repairs: [],
};

const canonBobOf = (params: BobParams) => () =>
  bobSlot({
    source: SOURCE,
    slot: canonIdle(),
    geometry: { cell: GEOMETRY.cell },
    limits: { frames: { min: 4, max: 4 }, durationMs: { min: 166, max: 334 } },
    params,
  });

const GOLDENS: Record<
  string,
  { run: () => Derivation | { ok: false; message: string }; golden: Golden }
> = {
  "mirror: symmetric figure, east to west": {
    run: () => mirrorOf(false),
    golden: {
      frames: [
        "d09c366e61c2f2f6ff7e7b6103925c9164aaefe454ac95a77834c80f92120847",
        "a52552326c303f2ba874732ffb9ac35e57e42591a2afbadf1c4abeb2d1c79908",
        "7783919845431042fb224c889f09593143233c6ee737d83045dfa54487783cc3",
        "def69e303a17843e27759b83f4d1a764879d76d60f2dfd707d8ff3a15607a0f3",
      ],
      results: [
        "e42146603b0f7199e937484a6d79cca1d70023941136bd1b8c5255d8574397b3",
      ],
    },
  },
  "mirror: figure with an east-only bolt, east to west": {
    run: () => mirrorOf(true),
    golden: {
      frames: [
        "cb5cc3ea48445e26b5a55a85a90d8b7da206460f817343e7754699d50242b863",
        "4ff03a9d9614af44bb8ad2757e98383644dab2ff019bc9cf53bc4f23debb6439",
        "5dcdadbcea2d7e027db95e9a0ade215bdef75cd86694d7c5f49f253553c2fbb0",
        "b49a3182af3c60bddec1a038a12ab4287ddeb148ea9009fb3666483f4f8a53e4",
      ],
      results: [
        "5d19ba6cf766478bfeec2b88028b9380b3667ae66f7ceb898072cd3cac158843",
      ],
    },
  },
  "palette swap: olympus to underworld, idle and act": {
    run: swapOf,
    golden: {
      frames: [
        "a4b2b941990d7aec51eae97f50dcde0c8d60b41d70d0933d71e562899f906411",
        "1bf5eda607c929cdf3c3bce94adedcabfe23ec316d36cf6c729025efa5467d21",
        "e2ed000c3bd57f8f079b8959bcd7581f0db9f2998f8a742d6bd1d282b77531ad",
        "328786808a73926e9e897bff0c29d8db266566c6ced0990fb7041ef2d5b9d3ff",
        "a4b2b941990d7aec51eae97f50dcde0c8d60b41d70d0933d71e562899f906411",
        "1bf5eda607c929cdf3c3bce94adedcabfe23ec316d36cf6c729025efa5467d21",
        "e2ed000c3bd57f8f079b8959bcd7581f0db9f2998f8a742d6bd1d282b77531ad",
        "328786808a73926e9e897bff0c29d8db266566c6ced0990fb7041ef2d5b9d3ff",
      ],
      results: [
        "5d96f0ea4009c9b968a64f6185b1ae87644213ab6e467107c23ac7bd54d39398",
        "5d96f0ea4009c9b968a64f6185b1ae87644213ab6e467107c23ac7bd54d39398",
      ],
    },
  },
  "bob: synthetic figure, bolt held": {
    run: bobOf,
    golden: {
      frames: [
        "45738a662f7b41790d758ec5c72e3445296a8c1fb9b9ef204017d595e0061e49",
        "45738a662f7b41790d758ec5c72e3445296a8c1fb9b9ef204017d595e0061e49",
        "dd4eb8d42c17fbf4cfa2376a104a3a638e0f724779d976dfcee2b5128ec8f01a",
        "45738a662f7b41790d758ec5c72e3445296a8c1fb9b9ef204017d595e0061e49",
      ],
      results: [
        "184e7a5c5c3ad8b0635713074cf80a8fd12d29d1a87dab1b246690dfd43c50ae",
      ],
    },
  },
  "bob: canon zeus-sprite idle, pure translation": {
    run: canonBobOf(CANON_BOB),
    golden: {
      frames: [
        "5fcdc94cbc2f6e4a92b52188386a19a22e20f78e292a21ee5da0c07299070a17",
        "5fcdc94cbc2f6e4a92b52188386a19a22e20f78e292a21ee5da0c07299070a17",
        "427433d165fb677b962aa8b7d9a7a9dbd1bbbc55ef958c7ee493587790dd277d",
        "5fcdc94cbc2f6e4a92b52188386a19a22e20f78e292a21ee5da0c07299070a17",
      ],
      results: [
        "50653616ad3ee44335c6b4e29c2686f562ed2faf0e00a2e492d890e33b409048",
      ],
    },
  },
  "bob: canon zeus-sprite idle, with the recorded repair list": {
    run: canonBobOf({
      ...CANON_BOB,
      repairs: [
        { frame: 1, x: 26, y: 49, colour: "#f3f0dc" },
        { frame: 1, x: 29, y: 46, colour: "#c7d8d4" },
        { frame: 2, x: 25, y: 39, colour: "#637b89" },
        { frame: 2, x: 25, y: 40, colour: "#9fb5bf" },
        { frame: 2, x: 25, y: 45, colour: "#f3f0dc" },
        { frame: 2, x: 26, y: 49, colour: "#f3f0dc" },
        { frame: 2, x: 29, y: 46, colour: "#c7d8d4" },
        { frame: 3, x: 28, y: 47, colour: "#f3f0dc" },
      ],
    }),
    golden: {
      frames: [
        "5fcdc94cbc2f6e4a92b52188386a19a22e20f78e292a21ee5da0c07299070a17",
        "b48b3b052b36023ed762d2989b2f84f2cffdf02603efe02892bd7000ebc7f520",
        "0e59522fd871db3f39ac7fcd602a7e6f107bba77573b400149a4a84e8e81737c",
        "7d4e6bb50575e343e1f394b7bf80f4203c77a5df01133c356bd8ef558e4cfe20",
      ],
      results: [
        "171ff4f97f5ef0ec0b72d9cd758739c3970198cc42b68a800e550f22c02bd8dc",
      ],
    },
  },
};

describe("derivation goldens", () => {
  for (const [name, { run, golden }] of Object.entries(GOLDENS)) {
    it(`${name}: committed PNG hashes and result hashes, byte-identical on a second run`, () => {
      const first = observe(check(run()));
      const second = observe(check(run()));
      expect(second).toEqual(first);
      expect(first).toEqual(golden);
    });
  }

  it("a symmetric figure mirrors to its own bytes, frame for frame", () => {
    const slots = check(mirrorOf(false));
    const source = east(false);
    for (const [i, frame] of (slots[0] as DerivedSlot).frames.entries()) {
      const rest = (source.frames[i] as { image: RgbaImage }).image;
      expect(sha(frame.png)).toBe(
        sha(encodeRgbaPng(rest.rgba, rest.width, rest.height)),
      );
    }
  });

  it("an east-only bolt does change the bytes when mirrored", () => {
    const slots = check(mirrorOf(true));
    const source = east(true);
    for (const [i, frame] of (slots[0] as DerivedSlot).frames.entries()) {
      const rest = (source.frames[i] as { image: RgbaImage }).image;
      expect(sha(frame.png)).not.toBe(
        sha(encodeRgbaPng(rest.rgba, rest.width, rest.height)),
      );
    }
  });
});
