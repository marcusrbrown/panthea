"""Scene palette for the retro-render probe: Olympus (and a few town) ramps extended to six shades, at most 64 colours.

Pure, standard library only. The extension keeps every original shade and inserts OKLab midpoints into the widest
lightness gaps, so existing art (the round-3 bolt stamp, canon Zeus) stays inside the palette.

    python3 tools/probes/retro-render/palette_plan.py     # rewrites palette/scene-palette.json
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SOURCE_PALETTE = REPO / "content/greek/palette/palette.json"
OUT_PALETTE = ROOT / "palette/scene-palette.json"

FAMILY_ID = "retro-scene"
SHADES_PER_RAMP = 6
MAX_SCENE_COLOURS = 64
MAX_SPRITE_COLOURS = 48
# (source family, ramp) in the order they appear in the scene palette.
SCENE_RAMPS = (
    ("olympus", "marble"),
    ("olympus", "pale-gold"),
    ("olympus", "cloud"),
    ("olympus", "lapis"),
    ("town", "soil"),
    ("town", "olive"),
    ("town", "terracotta"),
    ("town", "stone-sky"),
    ("underworld", "bone"),
)

RGB = tuple[int, int, int]
Lab = tuple[float, float, float]


def _lin(c: int) -> float:
    v = c / 255.0
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def _gamma(v: float) -> float:
    v = min(1.0, max(0.0, v))
    return 12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055


def oklab(rgb: RGB) -> Lab:
    r, g, b = (_lin(c) for c in rgb)
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = l ** (1 / 3), m ** (1 / 3), s ** (1 / 3)
    return (
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    )


def from_oklab(lab: Lab) -> RGB:
    l_ = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2]
    m_ = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2]
    s_ = lab[0] - 0.0894841775 * lab[1] - 1.2914855480 * lab[2]
    l, m, s = l_**3, m_**3, s_**3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return (round(_gamma(r) * 255), round(_gamma(g) * 255), round(_gamma(b) * 255))


def distance(a: RGB, b: RGB) -> float:
    la, lb = oklab(a), oklab(b)
    return math.dist(la, lb)


def midpoint(a: RGB, b: RGB) -> RGB:
    la, lb = oklab(a), oklab(b)
    return from_oklab(tuple((x + y) / 2 for x, y in zip(la, lb, strict=True)))  # type: ignore[arg-type]


def to_hex(rgb: RGB) -> str:
    return "#%02x%02x%02x" % rgb


def from_hex(text: str) -> RGB:
    return tuple(bytes.fromhex(text.removeprefix("#")))  # type: ignore[return-value]


def extend_ramp(shades: list[RGB], count: int = SHADES_PER_RAMP) -> list[RGB]:
    """Grow a dark-to-light ramp to `count` shades. Originals are kept; each new shade is the OKLab midpoint of the
    currently widest gap. Raises if the ramp is longer than `count` or the gaps are too small to split into distinct colours."""
    if len(shades) > count:
        raise ValueError("ramp already longer than requested")
    out = list(shades)
    while len(out) < count:
        gaps = [(distance(out[i], out[i + 1]), i) for i in range(len(out) - 1)]
        _, at = max(gaps)
        mid = midpoint(out[at], out[at + 1])
        if mid in out:
            raise ValueError("gap too small to split into a distinct shade")
        out.insert(at + 1, mid)
    return out


def build(source: dict) -> dict:
    """Scene palette document (same schema as palette.json, one family) from the source palette."""
    families = {f["id"]: {r["id"]: r["shades"] for r in f["ramps"]} for f in source["families"]}
    ramps = []
    seen: set[RGB] = set()
    for family, ramp in SCENE_RAMPS:
        original = [from_hex(h) for h in families[family][ramp]]
        extended = extend_ramp(original)
        for c in extended:
            if c in seen:
                raise ValueError(f"colour {to_hex(c)} appears in two ramps")
            seen.add(c)
        ramps.append({"id": ramp, "source": f"{family}/{ramp}", "shades": [to_hex(c) for c in extended], "kept": [to_hex(c) for c in original]})
    if len(seen) > MAX_SCENE_COLOURS:
        raise ValueError(f"{len(seen)} colours exceeds the scene palette limit of {MAX_SCENE_COLOURS}")
    digest = hashlib.sha256(json.dumps(source["families"], sort_keys=True).encode()).hexdigest()
    return {
        "schemaVersion": 1,
        "id": "retro-scene-provisional",
        "note": "Provisional probe palette; does not change the art guide. Shades 0 (darkest) is the outline; bands use shades 1 to 5.",
        "derivedFrom": {"palette": source["id"], "familiesDigest": digest},
        "limits": {"sceneColours": MAX_SCENE_COLOURS, "spriteColours": MAX_SPRITE_COLOURS, "shadesPerRamp": SHADES_PER_RAMP},
        "families": [{"id": FAMILY_ID, "ramps": ramps}],
    }


def ramp_shades(doc: dict, ramp_id: str) -> list[RGB]:
    ramp = next(r for f in doc["families"] for r in f["ramps"] if r["id"] == ramp_id)
    return [from_hex(h) for h in ramp["shades"]]


def all_colours(doc: dict) -> list[RGB]:
    return [from_hex(h) for f in doc["families"] for r in f["ramps"] for h in r["shades"]]


def nearest_ramp(doc: dict, rgb: RGB) -> str:
    """Ramp whose middle shades are closest to `rgb` in OKLab (used to map kit material colours to ramps)."""
    best, best_d = "", math.inf
    for f in doc["families"]:
        for r in f["ramps"]:
            shades = [from_hex(h) for h in r["shades"]]
            d = min(distance(rgb, s) for s in shades[1:-1])
            if d < best_d:
                best, best_d = r["id"], d
    return best


def main() -> int:
    source = json.loads(SOURCE_PALETTE.read_text())
    doc = build(source)
    OUT_PALETTE.parent.mkdir(parents=True, exist_ok=True)
    OUT_PALETTE.write_text(json.dumps(doc, indent=2) + "\n")
    colours = all_colours(doc)
    print(json.dumps({"ramps": len(doc["families"][0]["ramps"]), "colours": len(colours), "unique": len(set(colours))}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
