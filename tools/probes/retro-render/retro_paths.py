"""Where each step of the retro-render pipeline writes and reads. Pure; standard library only (no Blender).

The render step writes `<scratch>/render-<tag>/<item>/`, postprocess reads the same directory and writes `<scratch>/cells-<tag>/`,
build_report and check_resample read the cells and results for the same tag. Every CLI derives its paths from the functions here,
so a tag selects one consistent set of directories (round 1/2 shipped a README whose render directory was not the one postprocess
read; the post step skipped every item and wrote nothing).
"""

from __future__ import annotations

from pathlib import Path

import retro_plan as rp

ROOT = Path(__file__).resolve().parent
DEFAULT_SCRATCH = ROOT / "scratch"
DEFAULT_TAG = "r3"  # the current round
DEFAULT_ITEMS: tuple[str, ...] = tuple(rp.ITEMS)  # every item the scene needs, in render order


def suffix(tag: str) -> str:
    return f"-{tag}" if tag else ""


def render_dir(scratch: Path, tag: str) -> Path:
    """The directory render_retro.py writes into (one subdirectory per item) and postprocess_retro.py reads."""
    return Path(scratch) / f"render{suffix(tag)}"


def cells_dir(scratch: Path, tag: str) -> Path:
    return Path(scratch) / f"cells{suffix(tag)}"


def report_dir(scratch: Path) -> Path:
    return Path(scratch) / "report"


def report_prefix(tag: str) -> str:
    return f"retro{suffix(tag)}"


def item_render_dir(render: Path, item_id: str) -> Path:
    """One item's render output: the directory holding its `meta.json` and the 4x passes."""
    return Path(render) / item_id


def meta_path(render: Path, item_id: str) -> Path:
    return item_render_dir(render, item_id) / "meta.json"


def resolve_render_out(out: str | None, tag: str | None, scratch: Path = DEFAULT_SCRATCH) -> Path:
    """The render step's output directory: `--out` as given, or `render-<tag>` under the scratch directory. Exactly one is required."""
    if out and tag is not None:
        raise ValueError("pass --out or --tag, not both")
    if out:
        return Path(out)
    if tag is None:
        raise ValueError("pass --tag (or --out)")
    return render_dir(scratch, tag)


def split_items(items: str) -> list[str]:
    """A comma-separated `--items` value -> item ids, in order. Unknown ids raise ValueError."""
    ids = [i.strip() for i in items.split(",") if i.strip()]
    unknown = [i for i in ids if i not in rp.ITEMS]
    if not ids or unknown:
        raise ValueError(f"unknown or empty item list {items!r}: {unknown or 'no items'}; known: {', '.join(rp.ITEMS)}")
    return ids


def missing_renders(render: Path, item_ids: list[str]) -> list[str]:
    """Requested items with no `meta.json` in the render directory."""
    return [i for i in item_ids if not meta_path(render, i).exists()]
