"""Provenance: every third-party file the renderer imports from a pack is recorded in models.json with a hash, and nothing
recorded as used is unused. The imported-asset list comes from retro_assets.py, which render_retro.py builds all its import paths
from (checked below), so the comparison cannot drift from what Blender loads."""

from __future__ import annotations

import ast
import json
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import make_models_json as mm
import retro_assets as assets
import retro_plan as rp

HERE = Path(__file__).parent
MODELS = json.loads((HERE / "models.json").read_text())
PLACEHOLDER = "<main-checkout>/tools/probes/"
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def recorded_files() -> dict[str, dict]:
    """Path relative to `--models` -> entry, for every file under a pack that is marked used."""
    out: dict[str, dict] = {}
    for pack in MODELS["packs"]:
        if pack["status"] != "used":
            continue
        for f in pack["files"]:
            assert f["file"].startswith(PLACEHOLDER), f["file"]
            out[f["file"].removeprefix(PLACEHOLDER)] = f
    return out


class ImportedAssetTests(unittest.TestCase):
    def test_every_imported_file_and_its_companion_is_recorded_with_a_hash(self) -> None:
        recorded = recorded_files()
        for path in assets.provenance_paths():
            with self.subTest(path=path):
                self.assertIn(path, recorded)
                self.assertRegex(recorded[path]["sha256"], SHA256)
                self.assertGreater(recorded[path]["bytes"], 0)

    def test_nothing_recorded_as_used_is_unimported(self) -> None:
        self.assertEqual(sorted(recorded_files()), sorted(assets.provenance_paths()))

    def test_the_animation_source_is_recorded(self) -> None:
        source = MODELS["animationSource"]
        self.assertEqual(source["file"].removeprefix(PLACEHOLDER), assets.UAL)
        self.assertRegex(source["sha256"], SHA256)

    def test_every_hair_piece_in_a_profile_is_in_the_imported_list(self) -> None:
        hair = {p.file for profile in rp.PROFILES.values() for p in profile.hair}
        self.assertIn("Hair_Long", hair)  # Zeus's side locks and back mass
        imported = set(assets.imported_assets())
        self.assertLessEqual({assets.hair_gltf(f) for f in hair}, imported)

    def test_zeus_hair_long_is_described_and_hashed(self) -> None:
        pack = next(p for p in MODELS["packs"] if p["id"] == "universal-base-characters")
        self.assertIn("Hair_Long", pack["usedFor"])
        names = {Path(f["file"]).name for f in pack["files"]}
        self.assertLessEqual({"Hair_Long.gltf", "Hair_Long.bin"}, names)

    def test_the_generator_and_the_renderer_share_the_pack_directories(self) -> None:
        packs = {p["id"]: p for p in mm.PACKS}
        for pack_id, directory in (("universal-base-characters", assets.UBC_DIR), ("medieval-village", assets.MEDIEVAL_DIR), ("ultimate-animated-animals", assets.UA_DIR), ("kenney-nature-kit", assets.KENNEY_DIR)):
            self.assertTrue(all(f.startswith(directory) for f in packs[pack_id]["files"]), pack_id)
        generated = {f.removeprefix("") for p in mm.PACKS if p["status"] == "used" for f in p["files"]}
        self.assertEqual({p.removeprefix(f"{assets.PACKS_ROOT}/") for p in assets.provenance_paths()}, generated)


class RendererUsesTheAssetListTests(unittest.TestCase):
    """render_retro.py needs Blender, so it is read as source: every import call must take its path from retro_assets."""

    def test_every_import_call_builds_its_path_through_retro_assets(self) -> None:
        tree = ast.parse((HERE / "render_retro.py").read_text())
        calls = [
            n for n in ast.walk(tree)
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr in ("import_gltf", "import_obj")
        ]
        self.assertGreaterEqual(len(calls), 6)  # UAL, base character, hair, bull, tree, house
        for call in calls:
            with self.subTest(line=call.lineno):
                self.assertIn("assets.", ast.unparse(call))

    def test_no_pack_path_is_spelled_out_in_the_renderer(self) -> None:
        tree = ast.parse((HERE / "render_retro.py").read_text())
        strings = [n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)]
        for needle in ("retro-render/models", ".gltf", ".glb", ".obj", "Universal Base", "Medieval Village", "Ultimate Animated", "kenney_nature"):
            for value in strings:
                if needle in value and len(value) < 200:  # the module docstring is prose, not a path
                    self.fail(f"{needle!r} spelled out in {value!r}")


if __name__ == "__main__":
    unittest.main()
