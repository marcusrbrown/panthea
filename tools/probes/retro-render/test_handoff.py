"""Smoke test for the CLI handoff: the directory the render step writes for a tag is the one postprocess, build_report and
check_resample read, every item the scene needs is in the item list, and the README's current sequence says the same. Pure path
and argument logic; Blender is replaced by stand-in modules, so nothing renders."""

from __future__ import annotations

import contextlib
import io
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))

import build_report as br
import check_resample as cr
import postprocess_retro as pp
import retro_paths as paths
import retro_plan as rp
import scene_plan as sc

HERE = Path(__file__).parent
BLENDER_MODULES = ("bpy", "bmesh", "mathutils", "bpy_extras", "bpy_extras.object_utils", "numpy")


class Reached(Exception):
    """Raised by a stand-in for the first step after the input check."""


def run_cli(main, argv: list[str]) -> tuple[int, str]:
    err = io.StringIO()
    with mock.patch.object(sys, "argv", ["prog", *argv]), contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
        try:
            code = main()
        except Reached:
            code = -1
    return code, err.getvalue()


def write_renders(render: Path, items: tuple[str, ...]) -> None:
    for item in items:
        (render / item).mkdir(parents=True, exist_ok=True)
        (render / item / "meta.json").write_text("{}")


def parse_render_args(argv: list[str]):
    """render_retro.parse_args() with the Blender modules stubbed, so the real argument handling runs."""
    stubs = {name: mock.MagicMock() for name in BLENDER_MODULES if name not in sys.modules}
    before = set(sys.modules)
    with mock.patch.dict(sys.modules, stubs):
        try:
            import render_retro

            with mock.patch.object(sys, "argv", ["blender", "--", *argv]):
                return render_retro.parse_args()
        finally:
            for name in set(sys.modules) - before:
                if name in ("render_retro", "retro_lib"):
                    del sys.modules[name]


class RenderOutputTests(unittest.TestCase):
    def test_tag_selects_scratch_render_tag(self) -> None:
        self.assertEqual(paths.render_dir(Path("s"), "r3"), Path("s/render-r3"))
        self.assertEqual(paths.cells_dir(Path("s"), "r3"), Path("s/cells-r3"))

    def test_an_empty_tag_selects_the_untagged_directories(self) -> None:
        self.assertEqual(paths.render_dir(Path("s"), ""), Path("s/render"))
        self.assertEqual(paths.cells_dir(Path("s"), ""), Path("s/cells"))

    def test_render_needs_exactly_one_of_out_and_tag(self) -> None:
        with self.assertRaises(ValueError):
            paths.resolve_render_out(None, None)
        with self.assertRaises(ValueError):
            paths.resolve_render_out("x", "r3")
        self.assertEqual(paths.resolve_render_out("x", None), Path("x"))

    def test_the_render_cli_writes_where_postprocess_reads(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            scratch = Path(tmp)
            args = parse_render_args(["--item", "zeus", "--models", "m", "--tag", "r9", "--scratch", str(scratch)])
            self.assertEqual(Path(args.out), paths.render_dir(scratch, "r9"))
            self.assertEqual(Path(args.out) / "zeus" / "meta.json", paths.meta_path(paths.render_dir(scratch, "r9"), "zeus"))

    def test_the_render_cli_rejects_both_out_and_tag(self) -> None:
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            parse_render_args(["--item", "zeus", "--models", "m", "--tag", "r9", "--out", "x"])

    def test_the_render_cli_requires_a_destination(self) -> None:
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            parse_render_args(["--item", "zeus", "--models", "m"])


class PostprocessHandoffTests(unittest.TestCase):
    def test_a_wrong_tag_exits_non_zero_and_writes_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            scratch = Path(tmp)
            write_renders(paths.resolve_render_out(None, "aaa", scratch), paths.DEFAULT_ITEMS)
            with mock.patch.object(pp, "process_item", side_effect=Reached):
                code, err = run_cli(pp.main, ["--scratch", tmp, "--tag", "bbb"])
            self.assertEqual(code, 1)
            self.assertIn("render-bbb", err)
            self.assertFalse((scratch / "report").exists())
            self.assertFalse((scratch / "cells-bbb").exists())

    def test_the_directory_the_render_step_writes_is_the_one_postprocess_reads(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            scratch = Path(tmp)
            out = paths.resolve_render_out(None, "aaa", scratch)
            write_renders(out, paths.DEFAULT_ITEMS)
            with mock.patch.object(pp, "process_item", side_effect=Reached) as process:
                code, _ = run_cli(pp.main, ["--scratch", tmp, "--tag", "aaa"])
            self.assertEqual(code, -1)  # past the input check, into the first item
            self.assertEqual(process.call_args.args[1], out)
            self.assertEqual(process.call_args.args[2], paths.cells_dir(scratch, "aaa"))

    def test_an_item_with_no_render_exits_non_zero(self) -> None:
        for gap in paths.DEFAULT_ITEMS:
            with self.subTest(missing=gap), tempfile.TemporaryDirectory() as tmp:
                write_renders(paths.render_dir(Path(tmp), "aaa"), tuple(i for i in paths.DEFAULT_ITEMS if i != gap))
                with mock.patch.object(pp, "process_item", side_effect=Reached):
                    code, err = run_cli(pp.main, ["--scratch", tmp, "--tag", "aaa"])
                self.assertEqual(code, 1)
                self.assertIn(gap, err)

    def test_an_unknown_item_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            code, _ = run_cli(pp.main, ["--scratch", tmp, "--tag", "aaa", "--items", "zeus,hades"])
            self.assertEqual(code, 2)

    def test_the_default_tag_is_the_documented_current_round(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            write_renders(paths.render_dir(Path(tmp), paths.DEFAULT_TAG), paths.DEFAULT_ITEMS)
            with mock.patch.object(pp, "process_item", side_effect=Reached):
                code, _ = run_cli(pp.main, ["--scratch", tmp])
            self.assertEqual(code, -1)


class BuildAndCheckHandoffTests(unittest.TestCase):
    def test_build_report_reads_the_cells_of_its_tag(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            scratch = Path(tmp)
            for item in paths.DEFAULT_ITEMS:
                cell_dir = paths.cells_dir(scratch, "aaa") / item / "toon"
                cell_dir.mkdir(parents=True)
                (cell_dir / "x_south_00.png").write_bytes(b"")
            with mock.patch.object(br, "canon_frames", side_effect=Reached):
                self.assertEqual(run_cli(br.main, ["--scratch", tmp, "--tag", "aaa"])[0], -1)
                code, err = run_cli(br.main, ["--scratch", tmp, "--tag", "bbb"])
            self.assertEqual(code, 1)
            self.assertIn("cells-bbb", err)

    def test_check_resample_reads_the_results_postprocess_writes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            scratch = Path(tmp)
            report = paths.report_dir(scratch)
            report.mkdir()
            for item in ("zeus", "zeus-tall", "mortal"):
                (report / f"{paths.report_prefix('aaa')}-{item}-results.json").write_text(json.dumps({}))
            ok = {"matching": 1, "mismatching": 0, "pixels_differing": 0, "pairs": 1}
            with mock.patch.object(cr, "check_item", return_value=ok) as check:
                self.assertEqual(run_cli(cr.main, ["--scratch", tmp, "--tag", "aaa"])[0], 0)
                self.assertEqual(check.call_args.args[1:3], (scratch, "aaa"))
                self.assertEqual(run_cli(cr.main, ["--scratch", tmp, "--tag", "bbb"])[0], 1)


class SceneItemTests(unittest.TestCase):
    def test_every_item_the_scene_needs_is_in_the_item_list(self) -> None:
        needed: set[str] = set()
        for zeus_item in br.SCENE_ZEUS.values():
            needed |= {e.item for e in sc.ground_entities() + sc.object_entities(zeus_item)} - {"canon"}
        self.assertEqual(needed, {"zeus", "zeus-tall", "mortal", "bull", "tree", "temple", "house", "tile"})
        self.assertLessEqual(needed, set(paths.DEFAULT_ITEMS))

    def test_the_item_list_has_no_unknown_or_repeated_items(self) -> None:
        self.assertEqual(set(paths.DEFAULT_ITEMS), set(rp.ITEMS))
        self.assertEqual(len(paths.DEFAULT_ITEMS), len(set(paths.DEFAULT_ITEMS)))


class ReadmeSequenceTests(unittest.TestCase):
    """The README's current-round block is the sequence the tools expect: same tag everywhere, every item rendered."""

    @staticmethod
    def current_block() -> str:
        readme = (HERE / "README.md").read_text()
        section = readme.split("### Current round", 1)[1].split("\n### ", 1)[0]
        return re.search(r"```sh\n(.*?)```", section, re.S).group(1)

    def test_the_loop_renders_every_item_in_the_list(self) -> None:
        loop = re.search(r"for ITEM in ([^;]+); do", self.current_block()).group(1).split()
        self.assertEqual(loop, list(paths.DEFAULT_ITEMS))

    def test_every_step_uses_the_same_tag(self) -> None:
        block = self.current_block()
        self.assertIn(f'TAG="${{TAG:-{paths.DEFAULT_TAG}}}"', block)
        self.assertEqual(block.count('--tag "$TAG"'), 4)
        self.assertNotIn("--out", block)

    def test_the_sequence_ends_with_the_resample_check(self) -> None:
        steps = [line.split()[1] for line in self.current_block().splitlines() if line.startswith("python3 ")]
        self.assertEqual([Path(s.strip('"')).name for s in steps], ["postprocess_retro.py", "build_report.py", "check_resample.py"])


if __name__ == "__main__":
    unittest.main()
