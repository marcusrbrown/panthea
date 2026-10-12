"""Writes models.json: provenance for every third-party input of the retro-render probe (source page, licence, date, sha256).

    python3 tools/probes/retro-render/make_models_json.py --models <main-checkout>/tools/probes/retro-render/models

Paths are recorded as `<main-checkout>/...`; nothing under models/ is committed (tools/probes/*/models/ is gitignored).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
PLACEHOLDER = "<main-checkout>/tools/probes/retro-render/models"
DATE = "2026-10-11"
CC0 = "https://creativecommons.org/publicdomain/zero/1.0/"

sys.path.insert(0, str(ROOT))
from retro_assets import KENNEY_DIR, MEDIEVAL_DIR, UA_DIR, UBC_DIR  # noqa: E402  (the directories the renderer imports from)

KAYKIT_DIR = "KayKit_Forest_Nature_Pack_1.0_FREE/KayKit_Forest_Nature_Pack_1.0_FREE"

PACKS = [
    {
        "id": "universal-base-characters",
        "title": "Universal Base Characters [Standard]",
        "author": "Quaternius",
        "sourcePage": "https://quaternius.com/packs/universalbasecharacters.html",
        "zip": "Universal Base Characters[Standard].zip",
        "licenceFile": f"{UBC_DIR}/License_Standard.txt",
        "licence": "CC0 1.0 Universal",
        "licenceUrl": CC0,
        "status": "used",
        "usedFor": "Zeus (Superhero_Male_FullBody, Hair_Beard, Hair_SimpleParted, Hair_Long: side locks and back mass) and the mortal (Superhero_Female_FullBody, Hair_SimpleParted); skinned to the UAL clips",
        "files": [
            f"{UBC_DIR}/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf",
            f"{UBC_DIR}/Base Characters/Godot - UE/Superhero_Male_FullBody.bin",
            f"{UBC_DIR}/Base Characters/Godot - UE/Superhero_Female_FullBody.gltf",
            f"{UBC_DIR}/Base Characters/Godot - UE/Superhero_Female_FullBody.bin",
            f"{UBC_DIR}/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Beard.gltf",
            f"{UBC_DIR}/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Beard.bin",
            f"{UBC_DIR}/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_SimpleParted.gltf",
            f"{UBC_DIR}/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_SimpleParted.bin",
            f"{UBC_DIR}/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Long.gltf",
            f"{UBC_DIR}/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Long.bin",
        ],
        "note": "Material textures are not used: every material is replaced by a palette ramp. The Standard tier ships two base characters.",
    },
    {
        "id": "farm-animals",
        "title": "LowPoly Animated Animals (Farm Animals Animated)",
        "author": "Quaternius",
        "sourcePage": "https://quaternius.itch.io/lowpoly-animated-animals",
        "zip": "Farm Animals Animated  by Quaternius.zip",
        "licenceFile": None,
        "licence": "NOT SHIPPED: the archive contains OBJ, FBX, Blend, Preview.gif and no licence file",
        "licenceUrl": None,
        "status": "excluded-not-used",
        "usedFor": "nothing. No licence file ships and the page text does not state the licence, so it stays excluded; the Ultimate Animated Animals pack (below) supplies the animal instead.",
        "files": [],
        "note": "Only the zip hash is recorded.",
    },
    {
        "id": "kaykit-forest-nature",
        "title": "KayKit Forest Nature Pack 1.0 FREE",
        "author": "Kay Lousberg",
        "sourcePage": "https://kaylousberg.itch.io/kaykit-forest",
        "zip": "KayKit_Forest_Nature_Pack_1.0_FREE.zip",
        "licenceFile": f"{KAYKIT_DIR}/License.txt",
        "licence": "Creative Commons Zero, CC0 (credit not mandatory)",
        "licenceUrl": "http://creativecommons.org/publicdomain/zero/1.0/",
        "status": "inspected-not-used",
        "usedFor": "nothing. Tree_1_A, Tree_3_A and Tree_4_A were inspected; their textured trees are taller and bulkier than the cypress-like silhouette the scene needs.",
        "files": [],
        "note": "",
    },
    {
        "id": "medieval-village",
        "title": "Medieval Village Pack - Dec 2020",
        "author": "Quaternius",
        "sourcePage": "https://quaternius.com/packs/medievalvillage.html",
        "zip": "Medieval Village Pack - Dec 2020-20261012T081001Z-1-001.zip",
        "licenceFile": f"{MEDIEVAL_DIR}/License.txt",
        "licence": "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication",
        "licenceUrl": CC0,
        "status": "used",
        "usedFor": "the style-comparison building (Buildings/OBJ/House_1)",
        "files": [f"{MEDIEVAL_DIR}/Buildings/OBJ/House_1.obj", f"{MEDIEVAL_DIR}/Buildings/OBJ/House_1.mtl"],
        "note": "The zip name carries a Google Drive export suffix; it was re-zipped from the original pack, so its hash will not match quaternius.com's download.",
    },
    {
        "id": "ultimate-animated-animals",
        "title": "Ultimate Animated Animals - July 2021",
        "author": "Quaternius",
        "sourcePage": "https://quaternius.com/packs/ultimateanimatedanimals.html",
        "downloadedOn": "2026-10-12",
        "zip": "Ultimate Animated Animals - July 2021-20261012T171708Z-1-001.zip",
        "licenceFile": f"{UA_DIR}/License.txt",
        "licence": "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication",
        "licenceUrl": CC0,
        "status": "used",
        "usedFor": "the animal: Bull (glTF/Bull.gltf, its own rig and the Idle and Walk clips). Deer, Donkey and Horse were the alternatives",
        "files": [f"{UA_DIR}/glTF/Bull.gltf"],
        "note": "The zip name carries a Google Drive export suffix, so it is a re-zip of the original pack. Bull.gltf embeds its buffer, so there is no .bin. The material colours are not used: each Bull material is mapped to a scene ramp by hand.",
    },
    {
        "id": "kenney-nature-kit",
        "title": "Nature Kit 2.1",
        "author": "Kenney",
        "sourcePage": "https://kenney.nl/assets/nature-kit",
        "zip": f"{KENNEY_DIR}.zip",
        "licenceFile": f"{KENNEY_DIR}/License.txt",
        "licence": "Creative Commons Zero, CC0 (credit not mandatory)",
        "licenceUrl": "http://creativecommons.org/publicdomain/zero/1.0/",
        "status": "used",
        "usedFor": "the tree (Models/GLTF format/tree_cone.glb); tree_pineTallA, tree_thin, tree_pineSmallA and tree_oak were rendered for comparison only",
        "files": [f"{KENNEY_DIR}/Models/GLTF format/tree_cone.glb"],
        "note": "",
    },
]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True)
    args = ap.parse_args()
    root = Path(args.models)
    ual = json.loads((REPO / "tools/probes/blender-sprite/models.json").read_text())
    out = {
        "note": "Provenance for the third-party inputs of the retro-render probe. Files live outside git in the main checkout (tools/probes/*/models/ is gitignored); paths below are relative to <main-checkout>/tools/probes/retro-render/models.",
        "modelsDirectory": PLACEHOLDER + "/",
        "downloadedOn": DATE,
        "downloadedBy": "the owner, through a browser",
        "packs": [],
        "animationSource": {
            "id": "universal-animation-library",
            "see": "tools/probes/blender-sprite/models.json",
            "file": "<main-checkout>/tools/probes/blender-sprite/models/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb",
            "sha256": next(f["sha256"] for f in ual["assets"][0]["filesUsed"] if f["path"].endswith("UAL1_Standard.glb")),
            "licence": "CC0 1.0 (see the blender-sprite provenance)",
        },
    }
    for pack in PACKS:
        entry = {k: v for k, v in pack.items() if k not in ("zip", "files", "licenceFile")}
        entry["zip"] = {"file": f"{PLACEHOLDER}/{pack['zip']}", "sha256": sha256(root / pack["zip"]), "bytes": (root / pack["zip"]).stat().st_size}
        if pack["licenceFile"]:
            lic = root / pack["licenceFile"]
            entry["licenceFile"] = {"file": f"{PLACEHOLDER}/{pack['licenceFile']}", "sha256": sha256(lic), "text": " ".join(lic.read_text().split())[:600]}
        else:
            entry["licenceFile"] = None
        entry["files"] = [{"file": f"{PLACEHOLDER}/{f}", "sha256": sha256(root / f), "bytes": (root / f).stat().st_size} for f in pack["files"]]
        out["packs"].append(entry)
    (ROOT / "models.json").write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps({"packs": [(p["id"], p["status"], len(p["files"])) for p in out["packs"]]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
