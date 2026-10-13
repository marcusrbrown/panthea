#!/usr/bin/env python3
"""Revision B2c: five explicit pixel edits to the grip of the B2 frame.

Starts from `sprite_cleanup_b2.build()` (so B2 stays reproducible and unchanged) and sets
exactly the five pixels in GRIP_EDITS, each inside the B2 bolt-and-grip region. The shaft
between (19,54) and (19,57) stays hidden behind the fist.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline import Raster, decode_png, encode_png
from sprite_cleanup_b2 import (
    BASE,
    BOLT_RECT,
    OUT,
    PALETTE_JSON,
    REPO,
    apply,
    changed_pixels,
    conform,
    inside,
    symbol_colours,
)
from sprite_downscale import load_palette, measure
from sprite_sheet import contact_sheet, enlarge

Edit = tuple[int, int, str]

# (x, y, symbol): 7 bolt light #f4e4ae, 4 darkest gold #76572f, 6 skin #ddbf70, 5 skin shadow #b38b43
GRIP_EDITS: list[Edit] = [
    (19, 54, "7"),
    (19, 57, "7"),
    (18, 54, "4"),
    (20, 54, "6"),
    (20, 57, "5"),
]


def build() -> Raster:
    b2, _ = apply(decode_png(BASE))
    colours = symbol_colours()
    pixels = bytearray(b2.rgba)
    for x, y, symbol in GRIP_EDITS:
        if not inside(BOLT_RECT, x, y):
            raise ValueError(f"{(x, y)} is outside the grip region")
        at = (y * b2.width + x) * 4
        pixels[at : at + 4] = bytes((*colours[symbol], 255))
    return Raster(b2.width, b2.height, bytes(pixels))


def main() -> int:
    palette = load_palette(PALETTE_JSON)
    base = decode_png(BASE)
    b2 = apply(base)[0]
    edited = build()
    changed = changed_pixels(base, edited)
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / "b2c.png"
    encode_png(edited, out)
    encode_png(enlarge(edited, 4), OUT / "b2c-4x.png")
    strip = contact_sheet([[("0", base), ("2", b2), ("3", edited)]], ["S3"])
    encode_png(strip, OUT / "strip-base-b2-b2c-1x.png")
    encode_png(enlarge(strip, 4), OUT / "strip-base-b2-b2c-4x.png")
    facts = measure(edited, palette)
    row79 = [x for x in range(64) if edited.pixel(x, 79)[3]]
    runs: list[list[int]] = []
    for x in row79:
        if runs and x == runs[-1][-1] + 1:
            runs[-1].append(x)
        else:
            runs.append([x])
    opaque = sum(1 for a in base.rgba[3::4] if a)
    report = conform([out])[str(out)]
    summary = {
        "base": str(BASE.relative_to(REPO)),
        "base_sha256": hashlib.sha256(BASE.read_bytes()).hexdigest(),
        "output": str(out.relative_to(REPO)),
        "output_sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
        "grip_edits": [{"x": x, "y": y, "symbol": s} for x, y, s in GRIP_EDITS],
        "changed_vs_b2": len(changed_pixels(b2, edited)),
        "base_opaque_pixels": opaque,
        "changed_pixels": len(changed),
        "changed_percent_of_base_opaque": round(100 * len(changed) / opaque, 2),
        "budget_pixels": opaque // 5,
        "height": facts["height"],
        "width": facts["width"],
        "bottom_row": facts["bottom_row"],
        "soles": [[run[0], run[-1]] for run in runs],
        "sole_midpoint": (runs[0][0] + runs[-1][-1] + 1) / 2 if len(runs) == 2 else None,
        "colours": facts["colours"],
        "palette_entries": ["#%02x%02x%02x" % c for c in facts["palette_entries"]],
        "outside_palette": facts["outside_palette"],
        "conform": report,
    }
    (OUT / "report-b2c.json").write_text(json.dumps(summary, indent=1) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k not in ("conform", "palette_entries")}, indent=1))
    print("conform:", report["status"], [c for c in report.get("checks", []) if c["status"] != "pass"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
