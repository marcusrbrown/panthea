"""Third-party files the renderer imports, in one place. Pure; standard library only (no Blender).

render_retro.py builds every import path through these functions, and `imported_assets()` lists what a default scene run reads, so
a test can compare that list with the provenance in models.json (make_models_json.py builds its file list from the same
directory constants). A file the renderer imports but models.json does not record is a test failure.

Paths are relative to the `--models` directory (`<main-checkout>/tools/probes`); nothing under `models/` is committed.
"""

from __future__ import annotations

import retro_plan as rp

PACKS_ROOT = "retro-render/models"
UBC_DIR = "Universal Base Characters[Standard]/Universal Base Characters[Standard]"
MEDIEVAL_DIR = "Medieval Village Pack - Dec 2020-20261012T081001Z-1-001/Medieval Village Pack - Dec 2020"
UA_DIR = "Ultimate Animated Animals - July 2021-20261012T171708Z-1-001/Ultimate Animated Animals - July 2021"
KENNEY_DIR = "kenney_nature-kit"
UAL = "blender-sprite/models/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb"  # provenance: blender-sprite/models.json

DEFAULT_TREE = "tree_cone"
DEFAULT_HOUSE = "House_1"
BULL = "Bull"
GENDER = {"zeus": "Male", "mortal": "Female"}
EMBEDDED_BUFFER = frozenset({f"{UA_DIR}/glTF/Bull.gltf"})  # a glTF whose buffer is inside the file: no .bin
COMPANION_SUFFIX = {".gltf": ".bin", ".obj": ".mtl"}

BASE_DIR = f"{UBC_DIR}/Base Characters/Godot - UE"
HAIR_DIR = f"{UBC_DIR}/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)"


def _under_packs(pack_relative: str) -> str:
    return f"{PACKS_ROOT}/{pack_relative}"


def character_gltf(kind: str) -> str:
    return _under_packs(f"{BASE_DIR}/Superhero_{GENDER[kind]}_FullBody.gltf")


def hair_gltf(file: str) -> str:
    return _under_packs(f"{HAIR_DIR}/{file}.gltf")


def bull_gltf() -> str:
    return _under_packs(f"{UA_DIR}/glTF/{BULL}.gltf")


def tree_glb(name: str) -> str:
    return _under_packs(f"{KENNEY_DIR}/Models/GLTF format/{name}.glb")


def house_obj(name: str) -> str:
    return _under_packs(f"{MEDIEVAL_DIR}/Buildings/OBJ/{name}.obj")


def imported_assets() -> list[str]:
    """Files a default run imports from the packs (relative to `--models`), without companions and without the animation source.

    The debugging overrides (`--hair`, `--tree`, `--house`) can import other files from the same packs; those are not part of the scene.
    """
    out = [character_gltf(kind) for kind in rp.PROFILES]
    for profile in rp.PROFILES.values():
        out.extend(hair_gltf(piece.file) for piece in profile.hair)
    out.extend([bull_gltf(), tree_glb(DEFAULT_TREE), house_obj(DEFAULT_HOUSE)])
    return list(dict.fromkeys(out))


def companions(path: str) -> list[str]:
    """Files a main file needs beside it: the .bin of a glTF with an external buffer, the .mtl of an OBJ."""
    pack_relative = path.removeprefix(f"{PACKS_ROOT}/")
    for suffix, companion in COMPANION_SUFFIX.items():
        if path.endswith(suffix) and pack_relative not in EMBEDDED_BUFFER:
            return [path[: -len(suffix)] + companion]
    return []


def provenance_paths() -> list[str]:
    """Everything models.json must record for a default run: each imported file and its companions (relative to `--models`)."""
    out: list[str] = []
    for asset in imported_assets():
        out.append(asset)
        out.extend(companions(asset))
    return out
