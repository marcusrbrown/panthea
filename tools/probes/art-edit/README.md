# Local Zeus art-edit probe

Status: round 1 and round 2 complete. This is research evidence only; none of these images are canon.

Evidence conventions. The 4× sheets are whole-number nearest-neighbour enlargements of the 1× sheets and are not committed; only the `-1x.png` sheets are. `build_sheets.py` and `build_sprite_init.py` write a `-4x.png` beside each `-1x.png` they build, and any other 4× view is `nearest_resize(sheet, 4 * width, 4 * height, integer_factor=True)` from `pipeline.py`. The review passages below name 4× files by name, because those are what the reviewer opened; the files are no longer in the repo. Recorded paths use `<repo>` for this checkout and `<main-checkout>` for the Panthea checkout that holds the pinned art-local-2 binaries and models (`tools/probes/art-local-2`); one misspelled home directory in a mistyped command is shown as `<mistyped-home>`. `run.ts` takes the runtime directory from `PANTHEA_ART_LOCAL_2` and defaults to this repo's `tools/probes/art-local-2`.

## Scope and method

The probe compares local edit and generation workflows using only the already-staged `art-local-2` runtime/models. See that checkout's `tools/probes/art-local-2/README.md` and `components.json` for provenance. Runs are serial; `tools/probes/art-edit/run.ts` records the exact argv, seed, strength, wall time, exit status and output hash to `.context/studio-pipeline/art-edit/runs.jsonl`, with full stdout/stderr in the same scratch directory. Raw images and masks stay outside the repository.

Host/runtime: Apple M1 Pro, macOS 15.6; `stable-diffusion.cpp` `master-929-3f8527a` (same pinned `sd-cli` binary recorded in art-local-2). Runtime path: `<main-checkout>/tools/probes/art-local-2/bin/release/sd-cli`.

The specified neutral portrait exists at `.context/studio-pipeline/u7-creative/studio/blobs/c3097cd1e2a1c2fcb11545603856a4e5ec6ea811baa5f218c392135c1e8a47ba.png`; its bytes hash to **`c3097cd1e2a1c2fcb11545603856a4e5ec6ea811baa5f218c392135c1e8a47ba`**. It is a usable 768×768 pixel-art bust with a stable head outline, identifiable hairline, eyes, moustache and beard. A copy was made under scratch as `inputs/base.png`.

Model hashes below are the pinned values from `<main-checkout>/tools/probes/art-local-2/components.json` (verified against the on-disk model files). Round 1 and 2 A1 use Z-Image Turbo Q3_K (`4b44bdaa7814f20d7cf144e3939bd93aa32f50660204dd0c2aea5c5376232980`), Qwen3-4B-Instruct-2507 (`3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597`) and AE (`afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38`). Round 1 A2/B1 use FLUX.2 Klein base 4B (`c3a2854510677b7aa37dd7547d908c54889a76c6d6aa3ffe902fcaa092d1328b`), Qwen3-4B (`f6f851777709861056efcdad3af01da38b31223a3ba26e61a4f8bf3a2195813a`), flux2 VAE (`868fe7b343cc8f3a19dbcfcafbc3d5f888802be3f89bd81b65b3621a066ce8f3`) and svntax pixel-walk LoRA (`a968c042c2443bf6bfed41ce833a0e06bf5bbb7961ac40b88fb7257a940ae54e`). Round 1/2 B2 use SDXL base (`31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b`), SDXL VAE (`235745af8d86bf4a4c1b5b4f529868b37019a10f7c0b2e79ad0abca3a22bc6e1`) and pixel-art-xl LoRA (`4234637cb80c998f41e348e6a6cb6bc20d8d038b2b0f256b6129b3b5e353eef7`).

For round 1 A1, a binary white-on-black mask selects two interior face zones while leaving hairline and head outline unmasked: eyes/brows rectangle `(x=363,y=222,w=196,h=83)` and mouth rectangle `(x=385,y=329,w=176,h=88)` on the 768×768 base, with all other pixels black. Each expression starts from the same base and uses seed `20261006`, Z-Image Turbo Q3_K, euler/8 steps/guidance 1, 768×768. Strengths are 0.45, 0.60 and 0.75. Source outputs are reduced to 96×96 with nearest-neighbour for 1× and enlarged 4× with nearest-neighbour for the 4× review sheet. No palette snap was applied.

For each command, common exact args are:

```sh
sd-cli -M img_gen --diffusion-model models/z_image_turbo-Q3_K.gguf \
  --llm models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf --vae models/ae.safetensors \
  --offload-to-cpu --diffusion-fa -W 768 -H 768 --sampling-method euler \
  --steps 8 --guidance 1 -s 20261006 --strength <0.45|0.60|0.75> \
  -i <repo>/.context/studio-pipeline/art-edit/inputs/base.png \
  --mask <repo>/.context/studio-pipeline/art-edit/inputs/face-mask.png \
  -p 'pixel art portrait of the same Greek god Zeus, preserve the same hairline, face shape, eye placement, skin, beard and composition; change only the facial expression to <expression prompt>' \
  -n 'different person, altered hairstyle, changed face shape, duplicated or asymmetrical eyes, exaggerated cartoon expression, round O mouth, photorealistic, blurry, antialiasing' \
  -o <repo>/.context/studio-pipeline/art-edit/outputs/<run>.png
```

The run tables below give exact prompt text, output names, and all settings that vary per run. The command blocks define the invariant argv. Full resolved argv and raw logs are also preserved in the scratch run records, rather than duplicating long identical commands in every row. Any failed attempt is listed separately from its successful retry.

### A1 — Z-Image masked img2img

| Prompt suffix (exact) | Strength | Seed | Wall time (s) | Output | Output SHA-256 | Error? |
|---|---:|---:|---:|---|---|---|
| pleased: gently raised brows, softly smiling mouth with corners slightly upturned, calm human eyes | 0.45 | 20261006 | 167.92 | `a1-pleased-045.png` (run label `a1-pleased-045-retry`) | `851865fa310414b0ba0e4581ca4749dae6735521c17a9258a2c7b29bf61591da` | no |
| angry: brows drawn down and inward, eyes focused with a human gaze, mouth closed and firmly pressed into a slight frown | 0.45 | 20261006 | 160.93 | `a1-angry-045.png` | `8b97ea5af3a0031ee81b743385581f404c44cae5de32233efbc0d8d59f6a4031` | no |
| grieving: inner brows lifted with sadness, eyes gently downcast, mouth softly downturned and closed, restrained sorrow | 0.45 | 20261006 | 161.01 | `a1-grieving-045.png` | `57cac1f30eb9c8355fd775ed81c4a0bf0e38c36ffc3c3bcc6a101fe74881e250` | no |
| scheming: one brow subtly raised, eyes calmly narrowed but human, a small knowing asymmetrical closed-mouth smile | 0.45 | 20261006 | 164.43 | `a1-scheming-045.png` | `bd347f9d961cb17b1647e392385630ff2e389d0007f8588e0f8eeadd1d0e8e8d` | no |
| awed: brows raised, eyes naturally widened with human pupils, lips gently parted in a small relaxed expression, not a round O | 0.45 | 20261006 | 161.64 | `a1-awed-045.png` | `7efc633d190f8826e5d930b05ec1077e8343d1d28c2c19d6698e4aa3601195f8` | no |
| pleased: gently raised brows, softly smiling mouth with corners slightly upturned, calm human eyes | 0.60 | 20261006 | 195.83 | `a1-pleased-060.png` | `13659b46ed5403e5d02ad96eb4aa334efb5d4bcfe1579eb1c78f882bc149a95b` | no |
| angry: brows drawn down and inward, eyes focused with a human gaze, mouth closed and firmly pressed into a slight frown | 0.60 | 20261006 | 198.58 | `a1-angry-060.png` | `610e84e6ac42ab47fb878fc1771f9bb15d3aa410e1da171bad047544ec949496` | no |
| grieving: inner brows lifted with sadness, eyes gently downcast, mouth softly downturned and closed, restrained sorrow | 0.60 | 20261006 | 248.52 | `a1-grieving-060.png` | `60e4b10eb7b9f6299b36aace41930c75c4075dacbf05d2da6efeb0bddfa39701` | no |
| scheming: one brow subtly raised, eyes calmly narrowed but human, a small knowing asymmetrical closed-mouth smile | 0.60 | 20261006 | 239.43 | `a1-scheming-060.png` | `c6fb41af0437bae4e4b78585c10bc546bef0bf2cac3bc25208f37410976d0e5d` | no |
| awed: brows raised, eyes naturally widened with human pupils, lips gently parted in a small relaxed expression, not a round O | 0.60 | 20261006 | 206.57 | `a1-awed-060.png` | `01abc6a0b0360290aa1729e9011ed5ea9ac4f611ab2b9bf406ede76d056e39af` | no |
| pleased: gently raised brows, softly smiling mouth with corners slightly upturned, calm human eyes | 0.75 | 20261006 | 261.31 | `a1-pleased-075.png` | `87dd7cdd21bee041d18cc65673c1ddaafeab2fd38050bfe8165139d5e636732a` | no |
| angry: brows drawn down and inward, eyes focused with a human gaze, mouth closed and firmly pressed into a slight frown | 0.75 | 20261006 | 267.95 | `a1-angry-075.png` | `c868346c50c64b491ac22bd8153796696234313563e0e7d1a4c8560bb7f07bc2` | no |
| grieving: inner brows lifted with sadness, eyes gently downcast, mouth softly downturned and closed, restrained sorrow | 0.75 | 20261006 | 260.74 | `a1-grieving-075.png` | `dacd010a176931097da19f102cec645099713226931a3bee36a99e1011aaaf9e` | no |
| scheming: one brow subtly raised, eyes calmly narrowed but human, a small knowing asymmetrical closed-mouth smile | 0.75 | 20261006 | 263.71 | `a1-scheming-075.png` | `ca6e9e0d2f2037727368273fb0dd9afdd36daee7bb746e126819deea233e0578` | no |
| awed: brows raised, eyes naturally widened with human pupils, lips gently parted in a small relaxed expression, not a round O | 0.75 | 20261006 | 260.43 | `a1-awed-075.png` | `e5d5e0387283088acf3174c6bbd9933eddea14e6a1d50c5538a70f9e2f9a2758` | no |

Contact sheets (order: base, pleased, angry / grieving, scheming, awed): [0.45 at 1×](evidence/a1-045-1x.png), [0.60 at 1×](evidence/a1-060-1x.png), [0.75 at 1×](evidence/a1-075-1x.png).

Assessment (corrected after independent visual review): identity, head outline and hairline are preserved exactly outside the mask. Eyes are stable and human at 0.45 and 0.60; the 0.75 eyes distort and awed is comical. At 1× and 0.60, angry and grieving read; pleased looks like a frown, while scheming and awed are not distinct from neutral. Mouths are structurally constrained by the moustache/beard and are not five reliable cues at 96×96. A1 at 0.60 remains a partial base, not a complete six-expression set.

Two failed attempts (not included in the 15 successful matrix runs):

- Pleased 0.45, seed 20261006, command used `-m models/z_image_turbo-Q3_K.gguf` instead of `--diffusion-model models/z_image_turbo-Q3_K.gguf`; exit 1 after 0.742 s. Output: `new_sd_ctx_t failed` and `[ERROR] diffusion_engine.cpp:992 - get sd version from file failed: 'models/z_image_turbo-Q3_K.gguf'`. Corrected command ran as `a1-pleased-045-retry`, 167.917 s, output hash above.
- Angry 0.45, seed 20261006, same settings/prompt as the successful angry row but output was mistyped as `<mistyped-home>/src/github.com/marcusrbrown/panthea-studio/.context/studio-pipeline/art-edit/outputs/a1-angry-045.png` (a misspelled home directory, `mrbown`). Runner recorded exit 1 after 163.272 s and no output hash. The retry used the correct `<repo>/...` path and succeeded (160.930 s). The first run reused the eventual retry's log filename, so its detailed stderr was overwritten; the exact argv and exit record remain in `runs.jsonl`.

### A2 — FLUX.2 Klein 4B reference edit

Smoke test succeeded: `-r` loaded and preprocessed the 768×768 base (`preprocess ref[0] ... output=768x768`), the log says `Using 'flux2' preset for reference images` and `EDIT mode`, then `encode_first_stage completed`. The output retained the recognizable face, hairline and placement. This is evidence that the Klein CLI uses the reference in this build, not a no-reference control comparison.

| Expression | Exact expression text | Seed | Strength | Wall time (s) | Output | Output SHA-256 | Error? |
|---|---|---:|---|---:|---|---|---|
| pleased (smoke) | a small closed-mouth smile with relaxed human eyes | 20261006 | n/a | 720.46 | `a2-flux-ref-smoke.png` | `7b35f3f7ff4996f77a4cfb1df18ffb3c5e6c7a7021d4b3417cef86d0439100f4` | no |
| angry | brows drawn down and inward, focused human eyes, a small firm frown | 20261006 | n/a | 785.80 | `a2-angry.png` | `2a8ffb40b1736c93c63fd827a1bf6903c30c19419c465c1ee8ba7a65d190388e` | no |
| grieving | inner brows lifted with sadness, downcast human eyes, a gently downturned closed mouth | 20261006 | n/a | 794.82 | `a2-grieving.png` | `3f4d0552d6501f6e468c658380bf6ba2166a78c6e43994435c2f62d82ee769fc` | no |
| scheming | one subtly raised brow, calmly narrowed human eyes, a small knowing asymmetrical closed-mouth smile | 20261006 | n/a | 698.71 | `a2-scheming.png` | `de4896c0df69867b77703a358b7c9d9c99bc13b497c5a4e2b797013ead056096` | no |
| awed | raised brows, naturally widened human eyes, gently parted lips, not a round O | 20261006 | n/a | 694.37 | `a2-awed.png` | `4bdf36a446e36011434a817460effbe92fcc645e17d1afea16e1f72134766f82` | no |

All runs used FLUX.2 Klein base 4B Q4_0, Qwen3-4B Q4_K_M, flux2 VAE, `--offload-to-cpu --diffusion-fa`, 768×768, euler, 20 steps, `--cfg-scale 4 --img-cfg-scale 4`, and `-r <repo>/.context/studio-pipeline/art-edit/inputs/base.png`. Prompt prefix: `same character, same pixel art style, same face shape and eyes, change only the facial expression to`; negative prompt for the smoke/angry/grieving/scheming runs: `different person, altered hairline, changed face shape, distorted eyes, exaggerated cartoon expression, blurry, antialiasing`; awed additionally forbids `round O mouth`.

Exact common CLI argv (substitute the prompt suffix, optional extra negative phrase, and output name from the table; the smoke command additionally had `--lora-model-dir models/loras`):

```sh
sd-cli -M img_gen --diffusion-model models/flux-2-klein-base-4b-Q4_0.gguf \
  --llm models/Qwen3-4B-Q4_K_M.gguf --vae models/flux2-vae.safetensors \
  --offload-to-cpu --diffusion-fa -W 768 -H 768 --sampling-method euler \
  --steps 20 --cfg-scale 4 --img-cfg-scale 4 -s 20261006 \
  -r <repo>/.context/studio-pipeline/art-edit/inputs/base.png \
  -p 'same character, same pixel art style, same face shape and eyes, change only the facial expression to <expression>' \
  -n 'different person, altered hairline, changed face shape, distorted eyes, exaggerated cartoon expression, blurry, antialiasing, <optional round O mouth>' \
  -o <repo>/.context/studio-pipeline/art-edit/outputs/<run>.png
```

The smoke-test command also included `--lora-model-dir models/loras` but no LoRA activation token; it did not log or apply a LoRA. The four expression follow-ups omitted that directory flag.

Contact sheets (order: base, pleased, angry / grieving, scheming, awed): [1×](evidence/a2-1x.png).

Assessment (corrected after independent visual review): the five outputs look essentially the same as one another and the reference; none reads as the requested expression. Background shifts to saturated blue, with hair/beard and robe colours also drifting. Eye consistency reflects copying the reference, not demonstrated expression control. A2 is not viable as run.

### B1 — FLUX.2 Klein 4B + svntax pixel-walk LoRA

The LoRA is 512×512, 4×4, multiplier 1.0, Apache-2.0. The art-local-2 README records the 512×512 4×4 layout but no trigger phrase or row order. Its pinned model card supplies the prompt format and row directions: down-facing walk (3 frames, then arms raised), left walk (3, then jump), right walk (3, then jump), back/up walk (3, then lying down). The pinned stable-diffusion.cpp docs specify activation token `<lora:pixel_4walk_small_flux2_klein_base_4b_v1:1>`. Thus native-sheet review uses first row, first cell (front-facing/down), not arms-raised fourth cell.

Single-figure command (other than the seed and output filename, these args are fixed across that matrix):

```sh
sd-cli -M img_gen --diffusion-model models/flux-2-klein-base-4b-Q4_0.gguf \
  --llm models/Qwen3-4B-Q4_K_M.gguf --vae models/flux2-vae.safetensors \
  --offload-to-cpu --diffusion-fa --lora-model-dir models/loras \
  -W 512 -H 640 --sampling-method euler --steps 20 --cfg-scale 4 -s <seed> \
  -p 'pixel art, <lora:pixel_4walk_small_flux2_klein_base_4b_v1:1>, a full-body character sprite of Zeus, front-facing straight-on view, relaxed idle stance, both arms down, one small golden lightning bolt held low at his right side, white Greek chiton, short neat white beard, simple golden laurel crown, clean connected silhouette, limited palette, plain flat background, one centered figure, no animation sheet' \
  -n 'sword, dagger, spear, shield, cloak, cape, torn fabric, blurry, antialiasing, smooth gradient, photorealistic, 3d render, multiple figures, text, watermark, cropped feet, cropped head, background objects' \
  -o <repo>/.context/studio-pipeline/art-edit/outputs/b1-single-lora-<seed>.png
```

Native-sheet command uses the same model/LoRA flags, euler/20 steps/cfg 4, and 512×512, changing the prompt to the LoRA's documented layout:

```sh
sd-cli -M img_gen --diffusion-model models/flux-2-klein-base-4b-Q4_0.gguf \
  --llm models/Qwen3-4B-Q4_K_M.gguf --vae models/flux2-vae.safetensors \
  --offload-to-cpu --diffusion-fa --lora-model-dir models/loras \
  -W 512 -H 512 --sampling-method euler --steps 20 --cfg-scale 4 -s <seed> \
  -p 'A pixel art spritesheet of Zeus, front-facing small Greek god with a white beard, simple golden laurel crown, white chiton, holding one small golden thunderbolt low at his side, same simple character in every cell. The spritesheet is a 4 by 4 grid of four rows of frames: first row is 3 walking frames facing down and 1 frame both arms raised; second row is 3 walking frames facing left and 1 frame jumping left; third row is 3 walking frames facing right and 1 frame jumping right; fourth row is 3 walking frames back view facing up and 1 frame lying on floor. Clean pixel-art clusters, plain consistent background. <lora:pixel_4walk_small_flux2_klein_base_4b_v1:1>' \
  -n 'sword, dagger, spear, shield, cloak, cape, torn fabric, extra characters, text, watermark, blurry, antialiasing, smooth gradient, photorealistic, 3d render' \
  -o <repo>/.context/studio-pipeline/art-edit/outputs/b1-sheet-lora-<seed>.png
```

Common settings for both B1 matrices: FLUX.2 Klein base 4B Q4_0, Qwen3-4B Q4_K_M, flux2 VAE, `--offload-to-cpu --diffusion-fa`, LoRA directory `models/loras`, activation `<lora:pixel_4walk_small_flux2_klein_base_4b_v1:1>` (all logs confirm `apply lora at runtime`), euler, 20 steps, cfg 4. Single figures are 512×640; native sheets 512×512. LoRA runs do not use a denoising strength.

| Single-figure seed | Strength | Wall time (s) | Output | Output SHA-256 | Error? |
|---:|---|---:|---|---|---|
| 20261006 | n/a | 436.01 | `b1-single-lora-20261006.png` | `ec2658a2683a753996bd56267b48357f8fdcc20aa4ea7442660a6a79cb2d835a` | no |
| 20261007 | n/a | 442.75 | `b1-single-lora-20261007.png` | `4414e2ac53218d70e2c1094dbfd55f59a9e7d909f7bca467fbef80c4000e5e83` | no |
| 20261008 | n/a | 441.76 | `b1-single-lora-20261008.png` | `5b990f7c33a9a5a7e32a117f677e66f1e2829d21886b3060a97a0599bfa2735b` | no |
| 20261009 | n/a | 441.51 | `b1-single-lora-20261009.png` | `dff787c2acccdbcfae1592a9739e9d5339b27125ae7a1d01d434140f8e6c5f70` | no |

| Native-sheet seed | Strength | Wall time (s) | Output | Output SHA-256 | Error? |
|---:|---|---:|---|---|---|
| 20261006 | n/a | 365.75 | `b1-sheet-lora-20261006.png` | `b88579ff019b6d331371100924221aa9e578881e3c3e32e4ebdc04bbcc1a3143` | no |
| 20261007 | n/a | 365.48 | `b1-sheet-lora-20261007.png` | `9ab7b5ec99aa98f5fe821f3f7148b02740926ebcdf39e28ca0f1e9fbaa9045e0` | no |
| 20261008 | n/a | 366.32 | `b1-sheet-lora-20261008.png` | `d646288feff8b30b0762b4ad1e2681820d107a48da803fd0ad00c30f19c6ccbb` | no |
| 20261009 | n/a | 366.29 | `b1-sheet-lora-20261009.png` | `9ff8f071db625afd79d6a8873f5547ec84e268124850d556cc98f1a52489a7c7` | no |

The seed-20261006 untagged preflight was a valid no-LoRA image generation but not part of the required four-seed LoRA set (291.49 s, no strength, SHA `a15e900aa84760d84c2d59ec3db07160c5308f17631302f16e9bab869b732646`, exit 0). Its command used the B1 single-figure command above with `-o <repo>/.context/studio-pipeline/art-edit/outputs/b1-single-seed-20261006.png`, but omitted `<lora:pixel_4walk_small_flux2_klein_base_4b_v1:1>` from the prompt. It produced a detached bolt; it is intentionally not included in the contact sheet.

The reproducible B1 contact sheet is a four-column, two-row grid (64×80 cells; singles seeds 20261006–09 left-to-right on row 1, native-sheet first cells in the same order on row 2): [1×, 256×160](evidence/b1-round1-rebuilt-1x.png). The [uncropped full-frame single-figure sources at 1×](evidence/b1-round1-raw-1x.png) show the duplicated figures. The original sheet-crop method was not logged; these rebuilt sheets supersede the earlier soft-resampled versions. `python3 tools/probes/art-edit/build_sheets.py b1` detects contiguous content bands using RGB distance >30 from the four-corner background, selects the lower band for the two stacked outputs (20261007, 20261009), fits each content bbox to 56px high with nearest-neighbour resampling, centers it in 64×80 and aligns its feet to row79. Native sheets are cropped at `(0,0,128,128)`, content-bounded by the same threshold, then nearest-fitted to 56px high and bottom-aligned. A 4× sheet is assembled by 4× nearest-neighbour replication. Exact source crop rectangles and method are in [`b1-round1-crops.json`](evidence/b1-round1-crops.json); runnable code is in `build_sheets.py` and `pipeline.py`. Run the focused tests with `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/probes/art-edit -p 'test_*.py'`.

Assessment (corrected after independent visual review): single-figure subjects are chibi-like, with heads about 35–45% of figure height, soft in the original evidence, and costume/hair vary; the two stacked outputs are 20261007 and 20261009. Native first cells have heads about 40% high, leafy wreaths rather than a clear Zeus crown, blank faces and no bolt; they are walking poses. Neither B1 route is viable for the requested idle. The rebuilt evidence uses nearest-neighbour crops so its edge quality is no longer the original reviewer concern.

### B2 — SDXL + pixel-art-xl

Large generated images are 1024×1280; 1× candidates are nearest-neighbour reduced to 52×65 and padded into a 64×80 cell. The SDXL LoRA trigger phrase is `pixel art`; runtime selection uses `<lora:pixel-art-xl:1.2>`, `--lora-apply-mode at_runtime`, euler_a, 20 steps, cfg 7.

```sh
sd-cli -M img_gen -m models/sd_xl_base_1.0.safetensors --vae models/sdxl_vae.safetensors \
  --lora-model-dir models/loras --lora-apply-mode at_runtime \
  -W 1024 -H 1280 --sampling-method euler_a --steps 20 --cfg-scale 7 -s <seed> \
  -p 'pixel art, <lora:pixel-art-xl:1.2>, original full-body Zeus game sprite, adult Greek god with white beard, simple gold laurel crown, white chiton with gold trim, front-facing straight-on, relaxed idle standing pose, both arms down, a single small golden lightning bolt held low in his right hand, no movement, clean compact clusters, limited palette, plain flat white background, one character centered occupying roughly two thirds of image height' \
  -n 'sword, dagger, spear, shield, cloak, cape, torn clothes, blurry, antialiasing, smooth gradient, photorealistic, 3d render, multiple characters, spritesheet, text, watermark, cropped feet, cropped head, background objects' \
  -o <repo>/.context/studio-pipeline/art-edit/outputs/b2-sdxl-<seed>.png
```

| Seed | Wall time (s) | Strength | Output | Output SHA-256 | Error? |
|---:|---:|---|---|---|---|
| 20261006 | 488.82 | n/a | `b2-sdxl-20261006.png` | `b502fa013fb8237df42188844c1abb8ba164603eae797c5dc9477dd7b89e2503` | no |
| 20261007 | 487.87 | n/a | `b2-sdxl-20261007.png` | `407c43ad610794c82d45286ea43fb479dec72c80206eba29921815be271ad5f7` | no |
| 20261008 | 487.43 | n/a | `b2-sdxl-20261008.png` | `746cbd66b2d44c8a77e079d4e9a8df82d898f5b3b9f2a7d8b87088248a10af22` | no |
| 20261009 | 529.02 | n/a | `b2-sdxl-20261009.png` | `ea17e622883b69c87be4ac24d5470f142e0fa84804467324afb7ce9100c97e2c` | no |

Nearest-neighbour reduction to 52×65 followed by white padding (6 px left, 6 px right, 15 px top) produced the full 64×80 cell; figure height is about 56 px. Contact sheets, order by seed: [1×](evidence/b2-1x.png).

Assessment (corrected after independent visual review): B2 seed 20261007 is the best static base: clean silhouette, white chiton, gold crown and beard, with a head about 22–25% of figure height. Seeds 20261006 and 20261008 have bare torsos; 20261009 is blobby/wide. None has a clear bolt. At 1× the output is not over-detailed; the previous non-integer resize creates uneven clusters, and the off-white background tiles would leave a halo if keyed naively. Round 2 regenerates 20261007 at a source size for exact 8× reduction.

### Round 1 sprite head ratios

Visual estimates on the reviewed source/crops, head (crown/hair through beard) divided by full figure height; these are not automated conformance measurements.

| Path / candidate | Approx. head-to-height ratio |
|---|---:|
| B1 single figures, seeds 20261006/07/08/09 | 35–45% (varies by seed) |
| B1 native-sheet first cells, seeds 20261006/07/08/09 | about 40% |
| B2 SDXL, seed 20261006 | about 30% |
| B2 SDXL, seed 20261007 | 22–25% |
| B2 SDXL, seed 20261008 | about 30% |
| B2 SDXL, seed 20261009 | about 34% |

## Run summary

35 `sd-cli` invocations, 32 successful target runs, 2 failed attempts, and 1 successful untagged B1 preflight that was excluded from the LoRA matrix. Summed process wall time: **12,587.664 s (3 h 29 min 47.664 s)**. This is the sum of each invocation's measured wall time; it excludes image resizing/contact-sheet work and idle gaps.

| Technique | Invocations | Successful target outputs | Summed wall time | Short verdict |
|---|---:|---:|---:|---|
| A1 Z-Image masked portraits | 17 (15 target + 2 failed) | 15 | 3,383.006 s | Eyes are stable/human at 0.45–0.60; expression range is inadequate and 0.75 fails. |
| A2 Klein reference portraits | 5 | 5 | 3,694.170 s | Outputs look alike and drift in color; not viable as run. |
| B1 Klein + pixel-walk LoRA | 9 (8 target + 1 untagged preflight) | 8 | 3,517.353 s | Chibi proportions, poor character/costume identity and no idle bolt. |
| B2 SDXL + pixel-art-xl | 4 | 4 | 1,993.135 s | Seed 20261007 is a viable static base; no seed generated a bolt. |

## Method deviations / limitations

- B1's single-figure untagged preflight and the two A1 failures are detailed above. The mistaken angry output path's first log was overwritten by its corrected retry; the saved `runs.jsonl` still records the exact argv, elapsed time, exit code, and missing hash. The current runner writes timestamp-unique log names to prevent this.
- The art-local-2 README did not contain separate svntax LoRA trigger words or row directions. The pinned Hugging Face model card and pinned stable-diffusion.cpp LoRA docs were consulted as supplementary documentation; no model was downloaded.
- All results are visual research drafts, not palette-snapped, conformance-checked, canon-approved, or ready to ship. No external screenshot was taken.

## Review

Independent visual review. I viewed a1-045 (1×, 4×), a1-060 (1×, 4×), a1-075-4x, a2 (1×, 4×), b1 (1×, 4×) and b2 (1×, 4×). I did not open a1-075-1x; my 0.75 findings come from the 4× sheet. I did not see the raw 768 px outputs, the masks, `runs.jsonl` or the raw logs, because none are in the repository. Every claim below is about the committed sheets. I recomputed the run counts and wall-time sums from the README tables; those are internally consistent (see discrepancies).

### Verdicts

**Bottom line: no technique gives a shippable set. Portrait technique A1 at 0.60 is a partial base, and sprite technique B2 seed 20261007 is a partial base. A2 and B1 are not viable as run.**

#### A1 — Z-Image masked img2img (portraits)

- **Identity and head:** preserved exactly at every strength. Outside the mask the pixels are unchanged, so hairline, outline and bust are identical. This is the point of the technique and it works.
- **Eyes, 0.45 and 0.60:** I disagree with the README here. The eyes are mostly stable and human: a dark iris, a white corner, the same placement and the same 3/4 gaze. There is drift, such as the pale-sclera oddity on grieving at 0.45, but nothing like the "different and inhuman in every frame" the owner rejected. The README's "both eyes are reinterpreted on every render, often changing placement" overstates the problem at these strengths.
- **Eyes, 0.75:** it fails exactly as the owner described. There are big white sclera blocks, a square pupil, a stray yellow/orange tear or blemish, and white pixels spilling into the beard. Awed (bottom-right at 0.75) is comical: a startled mannequin with a white moustache. Scheming (bottom-middle at 0.75) is a white-block stare with a stray cyan pixel. Reject 0.75 outright.
- **Readability at 1×:**
  - **0.60 gives two real reads:** angry (brows drawn down, brown brow pixels) and grieving (drooping eyelid and brow, pursed mouth) both read without labels.
  - **Pleased fails:** it looks like a frown or a grumble, not a smile. This is the most damaging failure, because a smile is the one expression a player must be able to find.
  - **Scheming and awed fail:** they cannot be told apart from neutral or from each other at 1×.
  - **0.45:** only angry reads, and weakly. Everything else sits within one or two pixels of neutral.
- **The cause is structural.** Zeus's mouth is a 1-pixel line under a moustache inside a beard. Mouth shape cannot carry five expressions at 96 px. Only brows and eyelids can.
- **Pixel quality:** clean. The 768→96 reduction is an integer 8× nearest-neighbour step, the source is already hard-edged pixel art, and the only mush is the 0.75 sclera.
- **Verdict:** not a six-expression pipeline, but not worthless. At 0.60 it is a usable base for angry, grieving and neutral. The remaining three expressions need a different lever (see recommendations).

#### A2 — FLUX.2 Klein 4B reference edit (portraits)

- **Expression:** I cannot tell the five outputs apart at 1× or at 4×. The README says the expressions are "too subtle to reliably distinguish", which undersells it. As rendered, A2 is a near-copy of the reference with a colour shift. None of the five expressions reads, and angry does not read as angry.
- **Colour drift, which the README omits:** every A2 output has a saturated bright-blue background where the base is a greyer teal. The hair and beard shift orange and the robe shadows warm up. The first tile of the sheet is visibly a different background shade from the other five. Head outline and hairline hold, but the palette is not preserved, so these frames would need a palette snap to be usable. This matters for the guide's "same head, hairline" rule only indirectly, but it breaks consistency across a set.
- **Eyes:** consistent and human, but only because the model copied the reference. That is not evidence of controlled editing.
- **Pixel quality:** hard-edged and clean.
- **Verdict:** not viable as run. It trades expression range for preservation, and the preservation setting is the only one tested.
- **Cost:** 695–795 s per image against about 160–260 s for A1. Seed or img-cfg sweeps are expensive.

#### B1 — FLUX.2 Klein + pixel-walk LoRA (sprites)

- **Single-figure crops (top row):**
  - **Reads as Zeus-adjacent:** seed 20261009 (white hair, beard, gold headband, held gold bolt) is the best of the four. Seed 20261007 has a dark helmet-like hair blob. Seeds 20261006 and 20261008 have brown hair, and the bolt is a tiny stub or a stray fleck.
  - **No stray weapons:** confirmed.
  - **Proportions:** these are chibi figures. The head is about 35–45% of the height against the guide's roughly 25% (art-guide line 30). Three of the four have a bare-chested tank-top look, and the costume varies by seed.
  - **Edges are soft.** At 4× the outlines are anti-aliased and the colours blended. This is not clean pixel art. The README says the crops were "fit" to 64×80 but does not say what resampling was used. B2's crops are stated as nearest-neighbour, so I infer these used a smoothing filter. That should be fixed or recorded.
  - **Height:** about 56 px, in range.
- **Native-sheet first cells (bottom row):**
  - **Clean and consistent:** these have crisp pixel clusters and a black outline, and the four seeds are near-identical, which suggests little diversity from the LoRA.
  - **Not Zeus:** the figure has a green leafy wreath with a red gem, a blank face, a salmon-pink body and no bolt. At 1× it reads as a bearded dwarf in a hat or a leaf-crowned bush.
  - **Pose:** it is mid-stride, not an idle. The head is about 40% of the height.
- **Verdict:** not viable. The README's "clean, recognizable bearded/crowned Zeus in 4/4" is too generous. It is true for the colour brief but not for "clean" and not for proportions. It also cannot be checked from the repo, because the two-figure raw outputs are not shown.

#### B2 — SDXL + pixel-art-xl (sprites)

- **Silhouette:** the cleanest of the four sprite paths and the only one that matches the guide's "shape plus two colours" test. It is white and gold, with the crown and beard as the identifiers.
- **Head ratio:** in range, about 22–25% of the height.
- **Height:** about 56 px, in range.
- **Seed 20261007 (second cell):** a symmetrical standing figure with a white chiton, a gold belt, a gold crown and a white beard. It reads as an old king or god at 1× and is a credible static base for an idle.
- **Seed 20261006:** bare torso, plus a stray teal pixel on the arm and gold flecks on the skirt.
- **Seed 20261008:** bare torso.
- **Seed 20261009:** blobby and wide, with a cape-like drape. It reads worst.
- **No bolt anywhere.** Without it the figure is "a king", not Zeus. I agree with the README that this is the missing defining prop.
- **I disagree on "over-detailed".** At 1× the figure is simple enough. The real problems are different:
  - **Non-integer nearest-neighbour reduction.** 1024×1280 → 52×65 is a ~19.7× ratio, so pixel clusters are uneven and some detail is dropped at random.
  - **Off-white background rectangles.** A faint grey tile is visible around each figure against the pure-white padding. A cutout would carry a halo.
  - **Bare torsos** in two seeds.
- **Verdict:** best sprite candidate, not acceptable as-is. Seed 20261007 is usable after cleanup.

### README discrepancies and record gaps

1. **A1 eye claim.** "Both eyes are reinterpreted on every render" is wrong for 0.45 and 0.60, per the above. The A1 rejection is right on expression range and on 0.75 eyes, but the stated reason is not what the sheets show.
2. **A2 assessment.** "Too subtle" understates "indistinguishable". The README also omits the colour and background drift, and the odd-one-out tile in the sheet.
3. **B1 "clean … 4/4".** The crops are soft, with anti-aliased edges, and the resampling method for them is unrecorded. It is also unrecorded for the native-sheet 128→64 reduction.
4. **B1 "two stacked figures in 2/4".** This cannot be verified from the repository. The raw outputs are not committed, and the contact sheet shows only the lower figure.
5. **Head ratio.** The README never states head-to-height ratio for any sprite, though art-guide line 30 requires about 1/4. B1 fails it and B2 meets it.
6. **Contact-sheet building is unrecorded.** The crop, pad, resize and sheet-assembly code is not in the repo. Only `run.ts` is, and it handles only the runs. The cropping coordinates for the B1 single figures and the exact nearest-neighbour method behind the 1×/4× sheets cannot be reproduced.
7. **The A1 mask is unreproducible.** The README says it selects "two interior face zones" but gives no coordinates. The mask file is scratch-only.
8. **Run records are scratch-only.** `runs.jsonl`, the raw logs, the base image and the outputs live under `.context/` and are not in the repo. The commands, seeds and wall times are in the README. They are complete for all 32 successful runs and for the 3 non-target runs: the 2 failures and the 1 preflight. They are auditable only against local scratch. Each run has a seed and wall time; no run lacks one.
9. **Per-run command variance.** A1 and A2 record one common argv with a placeholder, and the per-run `<expression>` text is in the tables. That is enough to rebuild each command. The B1 preflight output path appears as `b1-single-seed-20261006.png`, and its prompt is described as the single-figure command with the LoRA token removed. That is acceptable, but it is a prose diff, not an argv.
10. **Output naming.** The A1 pleased 0.45 retry is named `a1-pleased-045-retry` in prose, while the table row lists `a1-pleased-045.png`. This is minor, but the run name and filename should be reconciled.
11. **External provenance.** The runtime and model paths point at a different checkout (`.../panthea/tools/probes/art-local-2/...`), and no model or binary hashes are given here. The README defers to that checkout.
12. **A2 is single-seed, single-img-cfg.** It has no no-reference control. The README admits the control is missing, but the A2 verdict reads as if the technique was explored. One setting was tried.
13. **Counts and times are consistent.**
    - Invocations: 17 (A1) + 5 + 9 + 4 = 35. Successful: 15 + 5 + 8 + 4 = 32. Failed: 2. Preflight: 1.
    - Wall times, per technique: A1 3,383.01 s, A2 3,694.16 s, B1 3,517.36 s, B2 1,993.14 s, total 12,587.67 s (3 h 29 min 47.7 s).
    - These match the README to within rounding (A1 differs by 0.008 s).
    - No missing seed or wall-time entry in the tables.

### Recommendations

1. **Portraits.** The most promising base is A1 at 0.60, not A2.
   - **Why A1:** it holds identity perfectly, and the eyes are acceptable at 0.45–0.60.
   - **Single most useful change:** stop asking the model to draw mouths. Run A1 at 0.60 on a **brow-and-eyelid-only mask**, with several seeds per expression (4–8 at about 200 s each, around 1 h for the set), and a single-cue prompt per expression. Pick the best seed. Carry the mouth and the "one secondary cue" (art-guide line 35) by hand: a few pixels, not a new generation.
   - **Why:** the beard hides the mouth, and brows and eyelids are the readable signal at 96 px. Pleased, scheming and awed need either a hand-drawn smile line or a hand-placed secondary cue (a cheek highlight, a raised-brow arch, a wide-eye highlight).
   - **Reject** A2 as run. If A2 is pursued again, lower `--img-cfg-scale` to about 1.5–2.5, run at least three seeds, composite only the face region back onto the base, and palette-snap. That costs about 12 min per image, so it should come second.
2. **Sprites.** B2 seed 20261007 is a viable *static* base.
   - **A 4-frame idle is a 1–2 px bob** of a clean standing figure. It does not need a walk cycle.
   - **Single most useful change:** a **pixel-snap pass** and then hand cleanup.
     - Reduce by an integer ratio, or by block-mode and area averaging rather than point sampling.
     - Quantize to the art-guide palette.
     - Key the background to alpha.
     - Hand-draw the bolt in the right hand and the chiton over the torso if needed.
   - **Alternatively, run more B2 seeds** with an explicit "white chiton covering chest" prompt and keep only symmetric ones.
   - **Drop B1.** Its walk-sheet layout is useful for later directional work, but the figure it makes is not Zeus.
3. **If those fail:** the next step is hand-drawn (or hand-finished) 64×80 Zeus and a six-frame portrait overlay set, for which A1 0.60 and B2-seed-7 are references, not finals. The Qwen-Image-Edit-2511 download is worth trying only if it is cheap and the owner agrees; it is a download and a runtime unknown, and no evidence here shows it would beat A1's local-mask approach. Do not spend more wall-clock on A2 or B1.

### Reviewer confirmation

I edited only this Review section of `tools/probes/art-edit/README.md`. I changed no other file, wrote nothing outside `/tmp`, and made no commits. I did not re-run any model; this review is visual only.

## Round 2 — new measurements

The independent Review section above is preserved untouched. All new raw inputs, masks, outputs, logs and scratch run records are under `.context/studio-pipeline/art-edit/`; final small review PNGs, scripts and the copied per-run JSONL are under `tools/probes/art-edit/`.

### A1 — Z-Image masked portraits

Round 2 uses the verified 768×768 base SHA-256 recorded above, Z-Image Turbo Q3_K, Qwen3-4B-Instruct-2507 and AE, euler, 8 steps, guidance 1, strength 0.60, fixed seed set `20261010`–`20261013` repeated for each expression/configuration. The prompts use one strong cue per expression: pleased `warm broad smile, cheeks raised, crinkled eyes`; angry `furious scowl, brows drawn hard down`; grieving `grief-stricken, inner brows raised, eyes downcast, mouth turned down`; scheming `sly one-sided smirk, one brow raised`; awed `astonished, brows high, mouth slightly open`. No face pixels are manually edited.

Two binary mask configurations are retained: brows/eyelids only and both zones combined. A separate mouth/beard-front mask was prepared but not run: a brows-only scheming seed-20261012 attempt took 1,332.012 seconds, so we used the owner's explicit two-configuration fallback rather than add a third 20-run matrix. Rectangles are half-open `[x,y,width,height]` in the base's 768×768 coordinates: brows/eyelids `(371,225,94,24)`, `(478,221,62,28)`, `(389,248,27,4)`, `(439,248,21,4)`, `(495,246,29,4)`; mouth/beard-front `(397,337,153,100)`; combined is their union. The brow/eyelid rectangles stop before the iris/pupil pixels. They are generated by `build_sheets.py masks`; the exact machine-readable list is in `.context/studio-pipeline/art-edit/inputs/a1-r2-mask-coordinates.json`. Four seeds per expression/configuration are retained. Contact sheets use five rows (one per expression) and five columns (the base first, then seeds 20261010–13 left-to-right); best picks have a pale-gold border. Sheets are 1× and 4×.

Command template, substituting `<config>` (`brows` or `combined`), `<expression>`, and each listed seed. Prompts above are the expression suffixes; all invocations use the same base, model flags, and strength:

```sh
bun tools/probes/art-edit/run.ts a1-r2-<config>-<expression>-<seed> -- \
  -M img_gen --diffusion-model models/z_image_turbo-Q3_K.gguf \
  --llm models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf --vae models/ae.safetensors \
  --offload-to-cpu --diffusion-fa -W 768 -H 768 --sampling-method euler \
  --steps 8 --guidance 1 -s <seed> --strength 0.60 \
  -i <repo>/.context/studio-pipeline/art-edit/inputs/base.png \
  --mask <repo>/.context/studio-pipeline/art-edit/inputs/a1-r2-<config>-mask.png \
  -p 'same Greek god Zeus, preserve the same head, hairline, face shape, eyes, beard, skin and composition; <expression cue>' \
  -n 'different person, changed identity, changed hairline, new facial features, altered iris or pupil, photorealistic, blurry, antialiasing, round O mouth' \
  -o <repo>/.context/studio-pipeline/art-edit/outputs/a1-r2-<config>-<expression>-<seed>.png
```

Only `<config>=brows` and `combined` are generated; `mouth` is recorded as an unrun prepared mask. The owner's fallback (brows-only plus combined) was used instead of adding a third 20-run matrix after a brows-only scheming seed-20261012 run took 1,332.012 s. A 30-minute outer timeout ended the four-run brows-only scheming shell batch before seed 20261013 completed; that seed was retried alone and succeeded. A separate combined grieving seed-20261010 run was interrupted at sampling step 3/5 and then retried successfully. The missing-output attempt and the interrupted model run are in `interrupted-attempts.jsonl`; every runner-started attempt is in `runs.jsonl`. Later calls use one CLI invocation per shell command.

The five-row/five-column sheets link here: brows [1×](evidence/a1-r2-brows-1x.png); combined [1×](evidence/a1-r2-combined-1x.png). Picks are provisional and marked with a pale-gold cell border in [`a1-r2-picks.json`](evidence/a1-r2-picks.json); all seeds remain visible for independent selection.

### B2 — SDXL inpaint, then Z-Image masked img2img

Regenerate the 20261007 SDXL + pixel-art-xl base at 512×640. Its measured figure bbox is `(152,32)–(368,616)`, 584 px high; the card's recommended 8× reduction would leave it 73 px tall, outside target. `pipeline.py` centers the keyed image on a 704×880 transparent canvas and uses exact 11× nearest-neighbour reduction to 64×80. The resulting figure is 53 px tall, with crown-to-beard head height about 14 px (26% of figure height), feet at row79 and horizontal pivot at x32.5. The raw base itself has a bare chest; a second prompt still produced a bare chest and oversized head and was discarded. Inpainting is performed on the selected 512×640 base before snap. SDXL inpainting with the same pixel-art-xl LoRA was attempted first, followed by Z-Image masked img2img; four final seeds per backend share the same source base and widened binary mask. No bolt or face pixels are hand-drawn. The pipeline quantizes opaque pixels to the 16 Olympus ramp colors in `content/greek/palette/palette.json`, flood-keys border-connected background pixels to binary alpha, normalizes hidden RGB, rejects pure black/white, then places the feet at row79 without shifting the horizontal body pivot. Processing and sheet-building code is `pipeline.py` and `build_sheets.py` (Python standard library plus already-installed ffmpeg/ffprobe; no dependency install).

Base regeneration uses the B2 component flags (SDXL base + VAE + `pixel-art-xl` at runtime), euler_a, 20 steps, cfg 7, seed `20261007`, at 512×640. The selected prompt asks for one full-body front-facing Zeus, a white chiton, simple gold laurel crown, short white beard, both arms down, no prop, and about two-thirds of canvas height. It nevertheless produced a 584px figure (91% of the canvas) with a bare torso; SHA-256 `5ff836681bc439f2508a89672e124c1db14f3d518ceef973a0dcc6ec11b13880`. A second prompt with an explicit 65%-height fully clothed figure still produced a bare torso and a 504px figure with an oversized head, so it was discarded (SHA-256 `1d77416a970a9e5512214ef7cc1fa39512f4071ab1ba0e9e5d3051907b2f4a9e`). Bolt inpainting uses the first base, `b2-r2-base-20261007.png` in scratch.

The final bolt mask is one white half-open rectangle `(112,336,120,136)` in the 512×640 input (viewer-left, Zeus's lowered right hand plus room around it), black elsewhere. The first `(128,354,76,86)` mask was too tight: SDXL altered the hand but drew no bolt. The original mask and coordinates are preserved as `b2-r2-bolt-mask-tight.png` and `b2-r2-bolt-mask-tight-coordinates.json`; the final mask and coordinates are regenerated by `python3 tools/probes/art-edit/build_sheets.py b2-mask` and recorded in the scratch coordinate JSON. The four final SDXL runs use SDXL base + VAE + runtime `pixel-art-xl` LoRA, `--offload-to-cpu`, 512×640, euler_a/20/cfg7, `--init-img <selected base> --mask <widened mask> --strength 0.75 -s <seed>`, positive `pixel art, one clear crisp small golden zigzag lightning bolt visibly held in Zeus’s right hand on the viewer-left side, its tip beside his body; preserve the rest of the character and background`, negative `floating bolt, lightning in sky, bolt elsewhere, sword, dagger, spear, shield, extra fingers, changed face, changed pose, text, blurry, antialiasing`, seeds `20261014`–`20261017`. The first seed-20261014 attempt without CPU offload failed with Metal `Insufficient Memory (00000008:kIOGPUCommandBufferCallbackErrorOutOfMemory)` after 79.538 s; adding `--offload-to-cpu` succeeded. Its tight-mask retry's raw output (`45f363429fd976be558d94c7570617f4632841b27afa94582673a1d80c8dc8d4`) was overwritten when the widened-mask retry was promoted to the canonical seed-20261014 output path; its full argv, log and SHA remain recorded, but that intermediate PNG is no longer present. The tight-mask retry and all four widened-mask seeds completed, but none produced a legible bolt.

The follow-up Z-Image masked-img2img command uses the same base and widened mask, Z-Image Turbo Q3_K + Qwen3-4B-Instruct-2507 + AE, offload/FA, 512×640, euler/8/guidance1, `--init-img <same base> --mask <same mask> --strength 0.60 -s <seed>`, positive `same Zeus pixel sprite, add one clear small golden thunderbolt, a sharp zigzag lightning symbol with three alternating points, held in his right fist on the viewer-left side; preserve the face, beard, crown, pose and background`, negative `floating bolt, lightning in sky, round bolt, sword, dagger, spear, shield, extra objects, changed face, changed clothes, text, blurry, antialiasing`, and seeds `20261018`–`20261021`. None has a clear bolt; the edits mostly change the hand or leave isolated color marks. The final processing command is `python3 tools/probes/art-edit/build_sheets.py b2`.

Review sheets: [all eight 1× cells](evidence/b2-r2-1x.png), and the two-colour silhouette threshold sheet at [1×](evidence/b2-r2-silhouette-1x.png). The [candidate cells](evidence/b2-r2-candidates/) are 64×80; measured opaque bbox is `(23,27)–(42,80)`, 53 px tall, centered on x32.5. Head-to-height is about 26%. All eight snapped cells use exactly 16 Olympus ramp colors and have no opaque pure-black or pure-white pixels. Both arms remain lowered, but no output contains a clear bolt; SDXL leaves a gold smear or robe/hand changes, while Z-Image leaves dark or pale marks. The source is bare-chested and still reads more as a crowned king than Zeus. Pixel silhouette is clean at 1× but too narrow at 19 px wide; the absent bolt is the decisive failure.

The `runs.jsonl` and `interrupted-attempts.jsonl` files beside this README contain the copied per-invocation argv, seed, strength, elapsed time, exit status and output hash. Round 2 logged 53 runner-started invocations, 51 successful and 2 failed; one additional invocation was cut by an outer timeout before it produced a runner record (54 total attempts, 3 failures). Runner-measured elapsed time sums to **11,590.827 s (3 h 13 min 10.827 s)** for the 53 logged attempts: A1 10,078.475 s and B2 1,512.352 s. This is not a complete wall-time total: the unlogged brows-only scheming retry has no per-run duration, and the combined grieving attempt's runner timer says 240.495 s while the Bash request reached its 1,800 s timeout. Exact elapsed time for those interruptions is not recoverable. No external images or models were downloaded.

#### Round 2 blunt assessment

- **A1 brows-only:** preserves the stable human eyes as intended, but brows alone do not separate the five expressions reliably at 1×.
- **A1 combined:** adding the mouth/beard-front changes pixels, but not into five distinct readable mouth cues; expressions still look nearly the same at 1×. Neither A1 mask is a complete expression pipeline.
- **B2 SDXL:** after CPU offload, all four runs complete, but neither the original tight mask nor the wider mask makes a legible bolt. The wider mask disrupts the hand/robe and sometimes adds a gold smear.
- **B2 Z-Image:** none of four seeds produces a clear bolt; several leave stray marks around the hand and robe.
- **B2 pixel snap:** the 64×80 cells meet the requested 48–56 px height and pivot; at 53 px tall and about 26% head height, proportions are in range. But the narrow silhouette, bare torso and missing bolt mean the sprite still fails the target.

## Round 2 review

Independent visual review. I opened `a1-r2-brows-{1x,4x}.png`, `a1-r2-combined-{1x,4x}.png`, `a1-r2-picks.json`, `b2-r2-{1x,4x}.png` and `b2-r2-silhouette-4x.png`. I did not open `b2-r2-silhouette-1x.png`. I did not open the eight candidate PNGs one at a time; I rebuilt them as one 8× nearest-neighbour sheet under `/tmp/art-r2/` and read their pixels with a throwaway script that imports `pipeline.py` (the script is not in the repo). I also built 7× face crops of the picked portrait tiles in `/tmp`. I read `pipeline.py`, `build_sheets.py`, `test_pipeline.py`, `runs.jsonl` and `interrupted-attempts.jsonl` in full or by script. I did not see the raw scratch outputs, masks or logs under `.context/`, and I did not re-run any model. Everything below is about the committed evidence.

### Verdicts

**Bottom line: neither track produced a usable result. A1 masked img2img does not deliver six readable expressions. B2 never produced a bolt, and the figure it produced does not meet the guide.** The method claims in the README mostly hold. The shortfall is in results, not in record-keeping.

#### Portraits (A1, Z-Image masked img2img at 0.60)

Reads at 1×, judged from the sheets without labels. The neutral base already has a downturned moustache that looks stern, so everything is read against a frown.

| Expression | Brows-only (1×) | Combined (1×) |
|---|---|---|
| angry | **Reads.** Brows drawn down, darker brow, narrowed look. | **Reads**, slightly stronger because the mouth looks more set. |
| grieving | **Marginal.** One heavy lid and a smear; reads as tired or sad if you already know the label. | **Marginal.** The mouth turns down but picks up white flecks. |
| pleased | **No.** The brow lifts a little and the mouth is still a frown, so it reads neutral or stern. | **No.** The moustache turns messy and orange; no smile. |
| scheming | **No.** Indistinguishable from the base. | **No.** The moustache is flattened and noisy; not a smirk. |
| awed | **No.** The same as the base. | **No.** Not an awed look. |

Result: 1 clear read (angry), 1 marginal (grieving), 3 not readable. That is the same hit rate as round 1 at 0.60, after 40 more runs and about 2.8 h.

- **Eyes:** identical, human and consistent across all 20 tiles in each configuration. This is the one real win against the owner's rejection. It is largely by construction, because the masks stop before the iris and pupil. A few seeds leave an odd bright orange pixel at an eye corner (brows-only angry 12 and 13). Nothing is comical or uncanny, and there is no "O" mouth.
- **Head and hairline:** preserved visually. They are not pixel-exact. The VAE round trip shifts the whole frame by about 2–3 levels (background `(163,200,203)` becomes `(162,198,201)`, mean per-tile channel difference about 3 to 5). Round 1's "unchanged outside the mask" is true to the eye but not to the byte. These tiles would need a composite of the unmasked region from the base, plus a palette snap, before use.
- **Why it fails: the edit signal is tiny.** I counted pixels in each 96×96 tile that differ from the base by more than 24 levels. Brows-only changes about 45–70 pixels (about 0.7%). Combined changes about 150–250 pixels (about 2.5%). Seed-to-seed differences for the same expression are the same size (about 40–65 pixels brows-only, about 150–200 combined). The expression effect is roughly the size of the seed noise. A "pick the best seed" step is therefore picking noise for pleased, scheming and awed.
- **Combined mask:** the mouth/beard-front change is mostly texture noise (orange flecks, white clusters that look like teeth), not a mouth shape. It also degrades the moustache and beard line, which is part of the "same head" rule. I rate it worse than brows-only.
- **Picks:** I agree with brows angry 20261010 (clean, no orange corner pixel) and brows grieving 20261012. I would not defend the other picks, because no seed shows a distinct pleased, scheming or awed cue and the picks are arbitrary. Combined picks are all noisier than their brows-only counterparts. The sheet's gold borders suggest a selection that the images do not support.
- **Show to the owner?** Not as a candidate expression pipeline. At most, show it as evidence that the eyes can be kept consistent and that brows give two reads. For mouth-driven expressions (pleased, scheming, awed), masked img2img on Z-Image Turbo Q3_K at 96 px is a dead end on this hardware.

#### Sprite (B2 snapped candidates)

Measured with a script on the eight 64×80 PNGs in `b2-r2-candidates/`.

| Check | Result |
|---|---|
| Figure height | 53 px (rows 27–79). In the 48–56 range. |
| Head height and ratio | About 13–14 px, about 25–26%. Meets the guide's roughly 1/4. |
| Feet row | Row 79. Pass. Feet span x 25–38, so the foot midpoint is x 32.0. |
| Width | 19 px at the shoulders, 14 px for the skirt. Narrow; a column below the shoulders. |
| Alpha | Exactly `{0, 255}` in all eight. Pass. |
| Colours | Exactly 16 colours, all inside the Olympus palette. That palette has no `#000000` or `#FFFFFF`. Pass. |
| Outline | **Fail.** The darkest colour `(36,63,99)` appears on 3 pixels. There is no 1 px outline, which the guide requires on the exterior silhouette. The README does not say so. |
| Bolt | **None in any of the eight.** Candidates differ from the first SDXL candidate by only 55–133 pixels out of about 1,000 opaque, and all eight share the same bbox. The inpaint edits are small hand and skirt changes. |
| Noise | The skirt is mottled with scattered light-blue pixels. This is point sampling of a non-grid-aligned source. The guide asks for clusters, not noise. |

- **Candidate marks:** SDXL 14 and 17 have a blue-grey smear at the lowered hand and skirt edge. Z-Image 19 has stray navy pixels and an orange fleck on the skirt. Z-Image 20 has a vertical blue line. I do not see a "gold smear" as the README describes for SDXL; the smears I see are blue-grey.
- **Reads as Zeus at 1×?** No. It reads as a bare-chested, bearded man in a long white wrap. The crown is a brown fleck on each side of the head. The face is about 3 pixels. At 1× it could be a priest, a pharaoh or a wrestler.
- **Silhouette:** clean and binary, but generic. It is a hat-peak, then a 19 px torso, then a 14 px column. It carries no crown, beard or bolt cue, so it fails the guide's "identifiable from shape plus two colours" test for Zeus. All eight silhouettes are identical.
- **Base regression:** the round 1 case for seed 20261007 was a white chiton with a gold belt. The regenerated 512×640 base has a bare chest. The README admits the bare chest, but it also removes the reason round 1 gave for preferring this seed.
- **Method check:** the 11× nearest-neighbour step is exact, as the code and test show: 704 / 64 = 11 and 880 / 80 = 11, with centre sampling. But "integer factor" is not the same as "grid-aligned". The generator's own pixel grid is not 11 px, so point sampling gives the skirt noise. A snap that detects the source's pixel grid, or a block-mode reduction, would be cleaner.
- **Usable as an idle base?** No. It is a reference at best. It has no outline, a tube skirt, a bare torso, noisy fill and no bolt. A 1–2 px bob would work mechanically, but it would animate a figure that is not yet Zeus.

#### Records

Checked against `runs.jsonl` and `interrupted-attempts.jsonl`:

- **Counts hold.** There are 53 round 2 runner records: A1 41 (40 successful, 1 exit 143) and B2 12 (11 successful, 1 exit 1). That gives 51 successful and 2 failed, plus 1 unlogged timed-out run (brows scheming 20261013, exit 124, no record), so 54 attempts and 3 failures. Elapsed sums match the README: A1 10,078.475 s, B2 1,512.352 s, total 11,590.827 s. All 51 successful runs have an output SHA-256 and none repeats.
- **Honesty of the bad runs is good.** The 30-minute outer timeout, the interrupted combined grieving run, the unrecoverable elapsed times, the OOM failure, the overwritten tight-mask output and the unrun mouth mask are all stated. The overwritten intermediate PNG is gone but its argv, log and SHA are recorded. I have no complaint here.
- **Minor discrepancies:**
  1. The README gives strength 0.75 for the SDXL runs without noting that the first failed attempt and its CPU retry on the tight mask used 0.65 (`runs.jsonl`). The final four runs at 0.75 are correct.
  2. A second slow A1 run, `a1-r2-brows-awed-20261012` at 554 s (about 2.9× the 194 s median), is not mentioned. Only the 1,332 s scheming run is.
  3. "Horizontal pivot at x32.5" is the bbox centre (23–42). The foot midpoint, which is the guide's pivot, is x 32.0.
  4. The README does not say that the sprite has no outline.
  5. The README does not say that A1 outputs are not byte-identical to the base outside the mask.
  6. `b2-r2-order.json` had absolute home-directory output paths (now repo-relative). It is named "order" but holds the sprite records.
  7. The run summary table in the round 1 section still totals round 1 only; the round 2 totals are in prose.
- **Reproducibility:** the code reproduces the sheets, masks and sprite cells from scratch outputs. The scratch outputs themselves are not in the repo, so the sheets are auditable only locally.

#### Python and dependencies

- **Dependencies:** standard library only for `pipeline.py`, `build_sheets.py` and `test_pipeline.py`. There is no Pillow and no numpy, and none is installed on this machine. It does shell out to `ffmpeg` and `ffprobe` (`decode_png`, `encode_png`) at `/opt/homebrew/bin`. The README states this ("Python standard library plus already-installed ffmpeg/ffprobe"). The tests do not need ffmpeg.
- **`__pycache__/`:** it exists on disk in `tools/probes/art-edit/` and is ignored by the repo's `.gitignore` (`__pycache__/`, line 2; checked with `git check-ignore -v`). It also holds a stale `pipeline.test.cpython-314.pyc` for a module that does not exist. Harmless.
- **Tests:** `cd tools/probes/art-edit && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v` ran 11 tests, all OK, **exit code 0** (Python 3.14.8). The tests cover the pure pixel operations. They do not cover `decode_png`, `encode_png`, `olympus_palette` or `build_a1`/`build_b2`, so the ffmpeg path and the sheet builders are untested.
- **Nits:** `build_sheets.py` re-defines `opaque_bbox` right after importing it from `pipeline.py`, and its `--config mouth` choice fails because no mouth runs exist. Neither matters for a probe.
- **Bun workspace:** the Python is isolated in the probe directory. I did not run `bun run check`, so I cannot say whether Bun's lint or test discovery tolerates the `.py` files.

### Recommendations

1. **Portraits: stop generating on Z-Image.** There were 40 runs in round 2 and 15 in round 1, about 4 h in total, and the result is one clear expression plus one marginal. The mouth is the limiting cue and the model cannot be steered to draw it at this scale, so a fifth seed sweep would only reshuffle noise. The base neutral portrait is decent. The best next step is a **human-drawn overlay set** (brows, eyes, mouth, one cue) on that neutral base, which fits the guide's "only eyes, brows, mouth and one cue change" and the owner's no-hand-pixelling rule for agents. I would **not** approve the Qwen-Image-Edit-2511 download blind. This machine is an M1 Pro with 16 GiB. My estimate for a 20B Q4 model plus its text encoder is about 17 GB, so it would not fit without heavy swapping. Z-Image at 6B already took 1,332 s for one run, and SDXL at 512×640 hit a Metal out-of-memory error without CPU offload. If the owner still wants it, gate it on a single timed feasibility run (one image, a fixed time cap, and a check that it fits in memory) before any matrix. I expect it to fail that gate.
2. **Sprite: stop generating.** Inpainting a bolt failed on 8 of 8 seeds across two backends, with SDXL base not being an inpaint model, and the base itself fails the guide on outline, torso and noise. Treat the figure as a reference. If you continue at all, the single change is to **replace "generate a bolt" with a hand-authored bolt overlay** (a prop of about 5×10 px composited at the hand; the guide already treats overlays as procedural, and the owner's ban covers faces, not props). That alone will not make the base shippable. The outline pass (1 px, darkest ramp shade, deterministic) and a clothed torso are still missing, so the realistic route is a human-finished 64×80 sprite using this figure as a reference.

### Reviewer confirmation

I edited only this Round 2 review section of `tools/probes/art-edit/README.md`, by appending text after its heading. I did not touch the round 1 "Review" section or anything above this heading. I changed no other file, wrote scratch only under `/tmp/art-r2/`, made no commits and ran no model. I ran `python3 -m unittest` with `PYTHONDONTWRITEBYTECODE=1` so it left no new bytecode.

## Round 3 prep

Prepared a model-independent, flat-block Zeus idle from scratch; no pixels were copied from the B2 figure. `build_sprite_init.py` draws at 64×80 from the Olympus ramps, then nearest-neighbour upscales by exactly 8×. The planned generation route is Z-Image Turbo masked img2img with Apache-licensed weights only; SDXL and pixel-art-xl are excluded. The init and both binary mask variants are under `.context/studio-pipeline/art-edit/sprite-init/`; `measurements.json`, `mask-coordinates.json`, and `generation-plan.md` record geometry and sweep settings. The full-figure mask adds a 2px 1× margin around the figure; the optional protected-bolt mask leaves the bolt and grip unmasked. 1× previews of the init and each mask are in `evidence/sprite-init-*-1x.png`; `build_sprite_init.py` writes the 4× enlargements beside them.

Measured 1× init: **54px figure height**, **14/54px head (25.9%)**, feet on **row 79**, foot midpoint **x=32**, and **9 colors** including the flat background. The 512×640 init contains exact 8× blocks. The planned prompt suffix is: “front view, standing at rest, full-body pixel-art sprite of Zeus; white chiton covering the torso with a gold sash; grey-white hair and beard; warm skin; both arms hanging naturally down; one large, clear gold zigzag thunderbolt held low in his right hand on the viewer-left; feet flat on the ground; clean connected silhouette, limited Olympus palette, plain flat background; no other weapons or props, no motion sheet, no text.” Planned strengths are **0.45, 0.60, 0.75**, each with seeds **20261022–20261025** (12 runs, serial). This is prep only: no model, `sd-cli`, or `sd-server` was run.

## Round 9 — scripted cleanup, no model runs

Round 9 reused the R8 working sets and generated no models. The portrait edit is `zeus-portraits-scripted-head-composite-mouths-u7-r9`, based on cleaned edit `zeus-portraits-cleanup-u7-r8` (sheet `e80495603f4b5284f894db36347c896f3956f5e4ddc4e22546816b0d67c549c1`). It restores all non-edit pixels from neutral, retains only generated brow-rectangle pixels per expression, and scripts five distinct mouth shapes in the inclusive patch x=46–70, y=42–58. Measured outside-rectangle drift is **0 pixels in every slot**. Mouth widths are pleased 10px, angry 10px, grieving 10px, scheming 10px, awed 9px. Eyes were not hand-edited. All six report-only portrait commands returned `ok: true`, exit 0.

The sprite edit is `zeus-idle-south-scripted-cleanup-outline-bob-u7-r9`, from `zeus-idle-south-u7-r8-full-s075-20261023-0000` (candidate hash `b1c15745f27ec67e80382f5d1d6ee19f139d33fca525e2401851134877b5c918`). Cleanup removed 14 blue-grey spark pixels; the cloak was kept because it reads as a shoulder cloak; the bolt is a connected 10×15px zigzag joined to a 3px hand block. A deterministic 1px #243f63 exterior contour was applied after the candidate had already passed conformance. The 4-frame bob translates the upper body up 1px on inhale, leaves 64 lower-leg anchor pixels fixed, duplicates no scanlines, and uses 167/166/167/166ms with pivot (32,80).

Measured sprite geometry: figure 55px in base frames and 56px in inhale frames; head 15px (27.27% / 26.79%); feet on row 79; foot centers x=27 and x=37, midpoint **32.0**. Outline coverage is 100% of the measured outer boundary (231px base, 239px inhale). It has 10 Olympus colors, binary alpha, no pure black/white. The full conformance checks for all four final frames pass, but the report-only command exits 1 with `proposal-would-replace`: the configured background key `(40,65,99) ±32` would remove 435/442/442/435 pixels matching the required outline color and navy cloak. No proposal was applied. This is the expected consequence of conforming before adding the outline, not a clean post-outline report-only pass.

The Round 8 manifest already contains the requested correction: the hand-authored init included the bolt, and the four deleted enclosed foot pixels are `(32,76)` through `(32,79)`. Review files are in `../../../.context/studio-pipeline/u7-creative/r9/review/`: `portraits-after-{1x,4x}.png`, `portraits-before-after-{1x,4x}.png`, `sprite-final-{1x,4x}.png`, `sprite-silhouette-threshold-{1x,4x}.png`, and `sprite-two-colour-test-{1x,4x}.png`. The complete measurements, hashes, provenance IDs, and report summaries are in `r9-run-manifest.json`; processing and tests are `round9_pixels.py` and `test_round9_pixels.py`.

Verification: `python3 -m unittest tools/probes/art-edit/test_round9_pixels.py` passed (4 tests). No source/config/content edits, downloads, or model processes. The independent Round 9 review is pending.

## Round 9 review


## Sprite downscale (Phase A)

Status: complete, no model runs. Research evidence only; nothing here is canon, and no file under `content/` was written. The independent visual review is pending, so this section records measurements only.

### Question

Earlier sprite routes forced an integer downscale, because the studio conform step accepts a scale only when the source size equals scale × cell. A 512×640 source therefore had to be scale 8, and the B2 route used an 11× nearest snap. The best pose so far, Z-Image r4c candidate 0001, came out 63 px tall against a 48–56 px target. Hypothesis: downscaling at any real ratio, straight onto the palette, and only then conforming at scale 1 puts the figure in range and may keep the silhouette readable.

### Method

`sprite_downscale.py` (standard library; PNG I/O through `pipeline.py`), `sprite_sheet.py`, `unfake_compare.py` and `run_sprite_downscale.py` are the code; `test_sprite_downscale.py` holds the unit tests.

1. **Foreground.** At source resolution, border-connected pixels within a Euclidean RGB tolerance of the mean corner colour become transparent. Opaque components smaller than 0.1% of the largest are dropped. The figure bounding box comes from what remains.
2. **Ratio.** The figure is sampled onto `H` rows, where `H` is the target total height minus 2 for the outline, so the scale is `H / figure_height`, any real number. Targets are 50, 54 and 56 px total including the outline. Each output pixel covers one source rectangle, anchored at the figure box's left and top edges, with exact overlap areas as weights.
3. **Alpha.** An output pixel is opaque when the opaque share of its rectangle is at least 0.5, so alpha stays binary.
4. **Colour, three methods per rectangle,** over its opaque pixels only: **A** overlap-weighted mean, snapped to the palette; **K** k-means (k=3, farthest-point start, up to 8 iterations) in OKLab, mean of the heaviest cluster, snapped; **M** the palette colour carrying the most overlap area after each source pixel is snapped. Snapping is nearest in OKLab (a unit test pins a colour where RGB distance would pick a different entry).
5. **Outline.** A 1 px exterior outline, 4-connected, drawn only on transparent pixels reachable from the cell border, so enclosed holes get none and no interior pixel changes. Each outline pixel takes the darkest shade of the ramp of its darkest adjacent pixel.
6. **Placement.** The cell is 64×80. The soles are the lowest opaque row of the downscaled figure, placed on row 78 so that the outline's bottom row is row 79. The feet midpoint is the midpoint of the opaque width over the two lowest figure rows, in pixel-edge coordinates, moved by a whole number of pixels to the nearest value to x=32.0. When that width has odd parity the best reachable value is 32.5. It is read from the pre-outline figure so a hem overhang cannot move it.
7. **Conformance.** `conform_report.ts` runs the studio's `reportOnly` (`packages/assets`, the function `tools/studio report` calls) at `scale: 1` on every 64×80 result, against the Zeus sprite spec built from the committed content: background `alpha`, alpha cutoff 128, grid edge tolerance 8, min confidence 0.6, min edges 20.

### Palette

All 16 entries of the `olympus` family of `greek-master` (the family Zeus declares as `paletteFamily`), in four ramps, listed dark to light:

| Ramp | Shades | Outline shade (darkest) |
| --- | --- | --- |
| marble | `#526471` `#8fa6ad` `#c7d8d4` `#f0eee0` | `#526471` |
| pale-gold | `#76572f` `#b38b43` `#ddbf70` `#f4e4ae` | `#76572f` |
| lapis | `#243f63` `#3c6290` `#7194b8` `#c5d1d3` | `#243f63` |
| cloud | `#637b89` `#9fb5bf` `#d6e1df` `#f3f0dc` | `#637b89` |

The outline shades are members of those 16, so the budget is 16 colours including outline. The palette has no skin ramp, and the studio checks a Zeus sprite against exactly these 16 entries, so a ramp from another family would fail its palette check. Skin therefore snaps to the pale-gold ramp.

### Sources

| Row | Source | Path | SHA-256 | Size | Key (mean corners) | Tolerance | Figure box (x0,y0,x1,y1) | Figure h × w | Specks dropped |
| --- | --- | --- | --- | --- | --- | ---: | --- | --- | ---: |
| S1 | job `zeus-idle-south-u7-r4c-0001`, text-to-image, Z-Image Turbo Q3_K (Apache-2.0) | `<repo>/.context/studio-pipeline/u7-creative/studio/blobs/f7f548b015690f98c02418c03ac21c6d349f3c1a5fe1d7275a3e2027bcf3779c.png` | `f7f548b015690f98c02418c03ac21c6d349f3c1a5fe1d7275a3e2027bcf3779c` | 512×640 | (232,222,191) | 24 | (127, 64, 398, 572) | 508 × 271 | 8 |
| S2 | B2 round 1, SDXL + pixel-art-xl, euler_a, 20 steps, cfg 7 (OpenRAIL-M, so not a canon route) | `<repo>/.context/studio-pipeline/art-edit/outputs/b2-sdxl-20261007.png` | `407c43ad610794c82d45286ea43fb479dec72c80206eba29921815be271ad5f7` | 1024×1280 | (249,250,251) | 16 | (296, 80, 769, 1201) | 1121 × 473 | 2 |
| S3 | B2 round 2 base `b2-r2-base-20261007.png`, same model and seed, regenerated at 512x640 | `<repo>/.context/studio-pipeline/art-edit/outputs/b2-r2-base-20261007.png` | `5ff836681bc439f2508a89672e124c1db14f3d518ceef973a0dcc6ec11b13880` | 512×640 | (250,250,251) | 16 | (152, 32, 368, 617) | 585 × 216 | 1 |
| S4 | job `zeus-idle-south-u7-r8-full-s075-20261023-0000`, masked img2img from the hand-blocked init, strength 0.75, Z-Image Turbo Q3_K (Apache-2.0) | `<repo>/.context/studio-pipeline/u7-creative/studio/blobs/db95d09f58f358038eb179193a58c5da8b6419b2b7156317fe0aaafa6c4343fb.png` | `db95d09f58f358038eb179193a58c5da8b6419b2b7156317fe0aaafa6c4343fb` | 512×640 | (60,76,101) | 135 | (86, 190, 367, 640) | 450 × 281 | 6 |

Key notes:

- S1 at 8× is the 63 px figure of the earlier round: the keyed figure here is 508 px, so the hypothesised ratios are 50→48/508 = 1/10.6, 54→52/508 = 1/9.8, 56→54/508 = 1/9.4 (interior rows, outline excluded).
- S2 has a pale grey ground shadow (about `#b6abb1`) under the hem and feet that is far from the key and so stays foreground. It does not move the bottom of the box, which is the soles.
- S4 carries a dark halo around the figure (down to about `#00051b`, about 120 from the key), so its tolerance is 135. Lower tolerances kept the halo as foreground. The source figure also runs off the bottom of the canvas (`touches_bottom_edge` is true), so its "soles" are the canvas edge, not drawn feet.

### unfake comparison

- Version `unfake==1.0.7` (PyPI), licence MIT per its package metadata. Installed into the probe-local, gitignored venv `tools/probes/art-edit/.venv` (Python 3.13.15, via `uv venv --python 3.13` and `uv pip install -r tools/probes/art-edit/requirements-unfake.txt`); pins: numpy 2.5.3, opencv-python 5.0.0.93, pillow 12.3.0.
- unfake has a fixed-palette mode (`fixed_palette`, hex colours), which maps by nearest RGB. It was used as supplied. Its whole-number block downscalers cannot take an arbitrary ratio; only its content-adaptive downscaler takes a target size.
- **C**: the keyed figure crop, with RGB under alpha 0 filled from the nearest opaque pixel so no background colour is averaged in, goes through `content_adaptive_downscale` at the same target size as A/K/M, then alpha binarisation at 128 and `quantize_colors` with the 16-colour fixed palette.
- **D**: `process_image` with `manual_scale` = the nearest whole number to figure height ÷ interior rows, `downscale_method="dominant"`, the fixed palette (applied before the downscale), `snap_grid=False`. The crop is padded with transparent rows on top and columns on the right so no block is cut off at the soles. Its height therefore follows the block size, not the target.
- The same outline and placement steps were applied to C and D, and a shared palette-snap step ran on their output as a guard. It moved 0 pixels in every unfake tile, so unfake's fixed-palette output was already on the palette.

### Results

Tile code = method letter + target total height. "Fig h" and "Fig w" are the opaque bounding box of the finished 64×80 cell, outline included; "Colours" is the distinct opaque colours including outline; "Outline" is yes when every exterior boundary pixel is one of the four ramp-darkest shades; "Foot mid x" is in pixel-edge coordinates; all bottom rows are 79. Conform is the report-only status at scale 1.

**S1 — job `zeus-idle-south-u7-r4c-0001`**

| Tile | Method | Fig h | Fig w | Colours | Outline | Foot mid x | Conform | Notes |
| --- | --- | ---: | ---: | ---: | --- | ---: | --- | --- |
| A50 | area-average | 50 | 28 | 15 | yes | 32.5 | pass |  |
| A54 | area-average | 54 | 30 | 16 | yes | 32.5 | pass |  |
| A56 | area-average | 56 | 31 | 15 | yes | 32.5 | pass |  |
| K50 | k-centroid (k=3) | 50 | 28 | 12 | yes | 32.5 | pass |  |
| K54 | k-centroid (k=3) | 54 | 30 | 12 | yes | 32.5 | pass |  |
| K56 | k-centroid (k=3) | 56 | 31 | 12 | yes | 32.5 | pass |  |
| M50 | mode | 50 | 28 | 11 | yes | 32.5 | pass |  |
| M54 | mode | 54 | 30 | 12 | yes | 32.5 | pass |  |
| M56 | mode | 56 | 31 | 12 | yes | 32.5 | pass |  |
| C50 | unfake content-adaptive | 50 | 28 | 14 | yes | 32.0 | pass | target 26×48 |
| C54 | unfake content-adaptive | 54 | 30 | 15 | yes | 32.0 | pass | target 28×52 |
| C56 | unfake content-adaptive | 56 | 31 | 15 | yes | 32.5 | pass | target 29×54 |
| D50 | unfake dominant (whole-number block) | 48 | 27 | 10 | yes | 32.5 | pass | block 11 |
| D54 | unfake dominant (whole-number block) | 53 | 29 | 11 | yes | 32.5 | pass | block 10 |
| D56 | unfake dominant (whole-number block) | 58 | 32 | 11 | yes | 32.0 | pass | block 9 |

**S2 — B2 round 1**

| Tile | Method | Fig h | Fig w | Colours | Outline | Foot mid x | Conform | Notes |
| --- | --- | ---: | ---: | ---: | --- | ---: | --- | --- |
| A50 | area-average | 50 | 22 | 15 | yes | 32.0 | pass |  |
| A54 | area-average | 54 | 24 | 15 | yes | 32.0 | pass |  |
| A56 | area-average | 56 | 25 | 15 | yes | 32.5 | pass |  |
| K50 | k-centroid (k=3) | 50 | 22 | 15 | yes | 32.0 | pass |  |
| K54 | k-centroid (k=3) | 54 | 24 | 15 | yes | 32.0 | pass |  |
| K56 | k-centroid (k=3) | 56 | 25 | 15 | yes | 32.5 | pass |  |
| M50 | mode | 50 | 22 | 14 | yes | 32.0 | pass |  |
| M54 | mode | 54 | 24 | 14 | yes | 32.0 | pass |  |
| M56 | mode | 56 | 25 | 14 | yes | 32.5 | pass |  |
| C50 | unfake content-adaptive | 50 | 23 | 12 | yes | 32.5 | pass | target 21×48 |
| C54 | unfake content-adaptive | 54 | 24 | 14 | yes | 32.0 | pass | target 22×52 |
| C56 | unfake content-adaptive | 56 | 25 | 14 | yes | 32.0 | pass | target 23×54 |
| D50 | unfake dominant (whole-number block) | 51 | 23 | 11 | yes | 32.5 | pass | block 23 |
| D54 | unfake dominant (whole-number block) | 53 | 23 | 12 | yes | 32.5 | pass | block 22 |
| D56 | unfake dominant (whole-number block) | 55 | 24 | 11 | yes | 32.5 | pass | block 21 |

**S3 — B2 round 2 base `b2-r2-base-20261007.png`**

| Tile | Method | Fig h | Fig w | Colours | Outline | Foot mid x | Conform | Notes |
| --- | --- | ---: | ---: | ---: | --- | ---: | --- | --- |
| A50 | area-average | 50 | 20 | 15 | yes | 32.5 | pass |  |
| A54 | area-average | 54 | 21 | 15 | yes | 32.0 | pass |  |
| A56 | area-average | 56 | 22 | 15 | yes | 32.5 | pass |  |
| K50 | k-centroid (k=3) | 50 | 20 | 16 | yes | 32.5 | pass |  |
| K54 | k-centroid (k=3) | 54 | 21 | 16 | yes | 32.0 | pass |  |
| K56 | k-centroid (k=3) | 56 | 22 | 16 | yes | 32.5 | pass |  |
| M50 | mode | 50 | 20 | 14 | yes | 32.5 | pass |  |
| M54 | mode | 54 | 21 | 14 | yes | 32.0 | pass |  |
| M56 | mode | 56 | 22 | 14 | yes | 32.5 | pass |  |
| C50 | unfake content-adaptive | 50 | 20 | 14 | yes | 32.5 | pass | target 18×48 |
| C54 | unfake content-adaptive | 54 | 22 | 16 | yes | 32.5 | pass | target 20×52 |
| C56 | unfake content-adaptive | 56 | 22 | 15 | yes | 32.5 | pass | target 20×54 |
| D50 | unfake dominant (whole-number block) | 51 | 20 | 15 | yes | 32.5 | pass | block 12 |
| D54 | unfake dominant (whole-number block) | 55 | 22 | 16 | yes | 32.5 | pass | block 11 |
| D56 | unfake dominant (whole-number block) | 55 | 22 | 16 | yes | 32.5 | pass | block 11 |

**S4 — job `zeus-idle-south-u7-r8-full-s075-20261023-0000`**

| Tile | Method | Fig h | Fig w | Colours | Outline | Foot mid x | Conform | Notes |
| --- | --- | ---: | ---: | ---: | --- | ---: | --- | --- |
| A50 | area-average | 50 | 32 | 15 | yes | 32.5 | pass |  |
| A54 | area-average | 54 | 34 | 14 | yes | 32.0 | pass |  |
| A56 | area-average | 56 | 36 | 14 | yes | 32.5 | pass |  |
| K50 | k-centroid (k=3) | 50 | 32 | 11 | yes | 32.5 | pass |  |
| K54 | k-centroid (k=3) | 54 | 34 | 11 | yes | 32.0 | pass |  |
| K56 | k-centroid (k=3) | 56 | 36 | 13 | yes | 32.5 | pass |  |
| M50 | mode | 50 | 32 | 12 | yes | 32.5 | pass |  |
| M54 | mode | 54 | 34 | 11 | yes | 32.0 | pass |  |
| M56 | mode | 56 | 36 | 13 | yes | 32.5 | pass |  |
| C50 | unfake content-adaptive | 50 | 32 | 15 | yes | 32.5 | pass | target 30×48 |
| C54 | unfake content-adaptive | 54 | 35 | 14 | yes | 32.0 | pass | target 33×52 |
| C56 | unfake content-adaptive | 56 | 36 | 14 | yes | 32.5 | pass | target 34×54 |
| D50 | unfake dominant (whole-number block) | 52 | 33 | 12 | yes | 32.0 | pass | block 9 |
| D54 | unfake dominant (whole-number block) | 52 | 33 | 12 | yes | 32.0 | pass | block 9 |
| D56 | unfake dominant (whole-number block) | 58 | 37 | 13 | yes | 32.5 | pass | block 8 |

### Measured summary

- Heights: methods A, K, M and C hit the requested total height in all 48 tiles. Method D, limited to whole-number blocks, landed -2 to +2 px from the request.
- All 60 tiles pass the studio report-only conformance at scale 1; none has a colour outside the 16 Olympus entries, and all have bottom row 79 and an outline.
- Foot midpoint is 32.0 in 20 tiles and 32.5 in 40 (odd-parity feet width).
- Colours including outline, method A: 14–16.
- Colours including outline, method K: 11–16.
- Colours including outline, method M: 11–14.
- Colours including outline, method C: 12–16.
- Colours including outline, method D: 10–16.

### Outputs and reproduction

Everything lands in `<repo>/.context/studio-pipeline/sprite-downscale/` (gitignored): `cells/<row>/<tile>.png` (64×80), `keyed/<row>.png` (magenta marks transparent), `contact-1x.png`, `contact-4x.png` (whole-number nearest enlargement), `legend.md` and `results.json`. Rows of the contact sheets are S1–S4 top to bottom; columns are method × height, in the order A, K, M, C, D, each at 50, 54, 56, with the tile code drawn under every tile.

```sh
uv venv --python 3.13 tools/probes/art-edit/.venv
uv pip install --python tools/probes/art-edit/.venv/bin/python -r tools/probes/art-edit/requirements-unfake.txt
tools/probes/art-edit/.venv/bin/python tools/probes/art-edit/run_sprite_downscale.py
python3 -m unittest tools/probes/art-edit/test_sprite_downscale.py
```

### Limits

- Foreground keying is tolerance-based and per source; the tolerances above were set by looking at the keyed previews, and S2 keeps its ground shadow and S4 needed a high tolerance for its halo.
- The outline rule (4-connected, darkest neighbour decides the ramp) is one reading of "darkest shade of the local ramp"; the guide also allows an outline where forms overlap, which is not drawn here.
- Conformance cannot see readability. Silhouette and any other judgement belong to the visual review, which has not happened.

## Sprite cleanup (Phase B, frame 1)

Status: one static frame, no model runs, research evidence only. The independent visual review is pending, so this section records measurements and method, not a judgement. No file under `content/` and nothing in the studio store was written.

**Base.** `<repo>/.context/studio-pipeline/sprite-downscale/cells/sdxl-b2-r2-20261007/M54.png` (row S3, mode downscale, 54 px), SHA-256 `a7e2f39ededc70360f81e377c73507050d1e9736315b5d64362b38d4473b20e4`. It is read only, to count changed pixels.

**Method.** `sprite_cleanup_b1.py` sets every pixel by an explicit operation and copies none from the base or from any other image:

1. The left half of the body (x=22..31, rows 27–78) is a character grid, one symbol per pixel, mirrored about x=32. Symbols 0–f index the 16 Olympus entries of `greek-master` in file order.
2. Asymmetric patches follow: the viewer-left fist, the thunderbolt and the one beard shadow cluster.
3. `add_outline` from `sprite_downscale.py` adds the 1 px exterior outline in the darkest shade of the adjacent ramp. Overlap outlines (arm and torso, beard and chest, waist) are drawn in the grid.

| Defect | Handling |
| --- | --- |
| Face and beard | brow, two eyes and a nose in a 6×4 pixel block; the beard and hair are one white region with one 6-pixel shadow cluster |
| Bolt | two 4-pixel down-left strokes joined by an 8-pixel horizontal jog, pale-gold core with a gold edge, outlined, held below the viewer-left fist and clear of the skirt |
| Hands | an overlap line (darkest gold) at x=26 and x=37 from the shoulder to the fist |
| Feet | two explicit soles, x=24–29 and x=34–39 on row 79, a 4 px gap between them |
| Skin | the chest is two flat clusters (one body tone, one shade band); no highlights |
| Silhouette | the beard overlaps the chest through a one-pixel diagonal line, and the waist has its own line; no second perimeter stroke |
| Noise | every colour region is at least two pixels, which a test pins |

**Measurements** (`<repo>/.context/studio-pipeline/sprite-cleanup/report.json`):

| Item | Value |
| --- | --- |
| Output SHA-256 | `report.json` holds it |
| Changed pixels against the base | 912 of 1050 opaque (including the transparent-to-opaque changes) |
| Figure height including outline | 54 (rows 26–79) |
| Figure width | 32 |
| Sole midpoint | x=32.0: soles at x=24–29 and x=34–39 on row 79, measured between the two soles |
| Colours | 9 of 16: `#243f63` `#526471` `#76572f` `#8fa6ad` `#b38b43` `#c7d8d4` `#ddbf70` `#f0eee0` `#f4e4ae` |
| Conformance, report-only at scale 1 | pass; 0 pixels changed; 9 colours against the 16 limit |

**Tests.** `test_sprite_cleanup_b1.py` pins the palette, binary alpha, height in range, the sole midpoint at 32 on row 79 with a two-run row 79 and a 2 px minimum gap, an exterior-only outline in the darkest ramp shades, no isolated single pixels, the face and beard rules, the chest rules, the arm and beard overlap lines, and the bolt rule. The bolt rule requires at least 60 bolt pixels in a one-run row span of at least 12, exactly one rightward jog of at least 3 px between two strokes that each run at least four rows down and left, a tip ending more than 4 px left of the start, and at least one clear pixel between the two outlines on every bolt row. With `B1_TARGET=base` the same rules run against the base tile: seven of the eleven fail there, and all eleven pass on the edit.

**Outputs.** `<repo>/.context/studio-pipeline/sprite-cleanup/`: `b1.png`, `b1-4x.png`, `before-after-1x.png`, `before-after-4x.png`, `report.json`. Reproduce with `python3 tools/probes/art-edit/sprite_cleanup_b1.py` (needs `bun` for the conformance step) and `python3 -m unittest tools/probes/art-edit/test_sprite_cleanup_b1.py`.

## Sprite cleanup (Phase B, frame 2: light touch)

Status: one static frame, no model runs, research evidence only; the independent visual review is pending, so this section records method and measurements, not a judgement. Frame 1 (`sprite_cleanup_b1.py`, outputs `b1*.png`) was rejected because it redrew the figure as a mirrored half plus patches, replacing the base's modelling and lighting; it stays here as the record of that attempt. No file under `content/` and nothing in the studio store was written.

**Base.** `<repo>/.context/studio-pipeline/sprite-downscale/cells/sdxl-b2-r2-20261007/M54.png`, SHA-256 `a7e2f39ededc70360f81e377c73507050d1e9736315b5d64362b38d4473b20e4`, 893 opaque pixels. It is read only.

**Method.** `sprite_cleanup_b2.py` loads the base's own pixels and edits them where they stand, as explicit `(x, y, symbol)` triples (symbols 0–f are the 16 Olympus entries in file order). Every edit is filed under a region and must lie inside it, or the script raises. No mirroring, no regeneration from primitives, no pixel from another image, no blanket re-outline.

| Region | What it holds | Pixels changed |
| --- | --- | ---: |
| Bolt and grip | the viewer-left bolt (pale-gold fill, a down-left stroke, a jog to the right, a down-left stroke ending in one pixel, each stroke at most 3 px thick), its 1 px darkest-pale-gold outline on new edges only, and a knuckle block over the shaft so hand pixels overlap it, with the old inner outline at x=23 recoloured to skin | 86 |
| Feet | two separate soles on row 79 at x=26–29 and x=34–37; the hem's bottom outline between them is cut away and the hem edge above the gap re-outlined | 15 |
| Specks | 44 isolated single pixels (no same-colour 8-neighbour), each set to a colour already beside it; the list is frozen in the script | 44 |
| Face | unchanged apart from speck removals; the three eye-row pixels at (31,33), (32,33), (33,33) look like flecks but are features and are kept | 0 |

The optional chest-skin merge was not done. The beard and hair, the crown, the robe drapery and the silhouette are the base's, apart from the listed pixels.

**Measurements** (`<repo>/.context/studio-pipeline/sprite-cleanup/report-b2.json`):

| Item | Value |
| --- | --- |
| Changed pixels against the base | 145 of 893 opaque, 16.24%, with a budget of 178 (20%); transparent↔opaque flips are counted |
| Figure height including outline | 54 (rows 26–79) |
| Figure width | 30 |
| Sole midpoint | x=32.0: soles at x=26–29 and x=34–37 on row 79, measured between the soles |
| Colours | 14 of 16 |
| Conformance, report-only at scale 1 | pass; 0 pixels changed |

**Tests.** `test_sprite_cleanup_b2.py` pins rules, not a design: at most 20% of the base's opaque pixels change; at least 80% survive and the figure is not mirror-symmetric; nothing changes outside the declared regions, and the silhouette and the kept face pixels outside them are the base's; palette-only colours; binary alpha; height 48–56; two distinct soles with a 2 px gap and their midpoint at 32 on row 79; new edges are darkest-ramp outline; no isolated single pixels except the three kept face pixels; and the bolt rule (at least 30 fill pixels over at least 12 rows, thickness at most 3, a one-pixel far tip, two down-left strokes of at least three rows with a rightward jog of at least 3 px between them, bolt pixels above and below the fist with hand pixels over the shaft between them, at least one clear pixel between the bolt's outline and the skirt, and a darkest-pale-gold outline). With `B2_TARGET=base` four of the twelve fail on the base tile (the soles, the flecks, the bolt and the bolt outline); all twelve pass on the edit.

**Outputs.** `<repo>/.context/studio-pipeline/sprite-cleanup/`: `b2.png`, `b2-4x.png`, `strip-base-b1-b2-1x.png` and `strip-base-b1-b2-4x.png` (tiles `0` base, `1` frame 1, `2` frame 2), `report-b2.json`. Reproduce with `python3 tools/probes/art-edit/sprite_cleanup_b2.py` (needs `bun` for the conformance step) and `python3 -m unittest tools/probes/art-edit/test_sprite_cleanup_b2.py`.

**Revision B2c (grip only).** `sprite_cleanup_b2c.py` applies five explicit grip pixels on top of B2 (the shaft entering and leaving the fist at (19,54) and (19,57), the new outline at (18,54), and skin at (20,54) and (20,57) in place of the dark divider), changing 146 of 893 opaque pixels against the base (16.35%) and keeping the shaft between them hidden; outputs `b2c.png`, `b2c-4x.png`, `strip-base-b2-b2c-1x.png`, `strip-base-b2-b2c-4x.png` (tiles `0` base, `2` B2, `3` B2c) and `report-b2c.json` in `<repo>/.context/studio-pipeline/sprite-cleanup/`.

## Sprite Phase C1

Status: candidates generated and downscaled; no selection made. Research evidence only. Nothing under `content/` or the canon registry was written; the studio store at `<repo>/.context/studio-pipeline/u7-creative/studio` received the request, eight jobs and one working set through the normal studio commands.

**Why.** The owner rejected the hand-cleaned B1, B2 and B2c frames. Phase C generates fresh sources through the studio itself, so the Apache-2.0 Z-Image profile records truthful provenance, with no painted layout. C1 covers generation and downscaling only; hand-pixelling the face and bolt comes later.

**Request.** `zeus-idle-south-u7-c1`, one `idle`/`south` sprite slot, text-to-image, batch 8, base seed 20261040 (the studio draws seeds 20261040–20261047 in order), 512×640, working set `zeus-idle-south-u7-c1-set`. It ran as a `studio session` under `nohup` with the U7 authoring config, fed from `<repo>/.context/studio-pipeline/c1/session-input.jsonl`. The studio builds the prompt itself; the only addition is the `--style-note` text (the studio's existing request option; no content file was edited). The exact prompt recorded on every job:

```text
pixel art, Zeus, Greek god, thunderbolt, full body, front view, facing the viewer, idle pose, plain flat background, limited colour palette, swept-back silver hair, long flowing white beard, aged noble face, white himation draped over one shoulder with a gold band, standing tall facing the viewer, both feet visible, thunderbolt held raised in his right hand on the viewer's left, plain flat background, no scenery
```

The negative prompt, sampler and the other settings are the profile's (euler, 8 steps, CFG 1) and are in each job record.

| Job | Seed | Output SHA-256 | Duration | Keyed figure (h × w) | Bottom margin | Edges touched |
| --- | ---: | --- | ---: | --- | ---: | --- |
| zeus-idle-south-u7-c1-0000 | 20261040 | `db187882bdc54eba68416578e38ccb815ce2f4389837703bc8460429face0c29` | 92 s | 573 × 293 | 34 px | none |
| zeus-idle-south-u7-c1-0001 | 20261041 | `a72907a5c4327a45a91863455a3e282308fdb56ae8c52719172b8d4704671f60` | 80 s | 609 × 366 | 19 px | none |
| zeus-idle-south-u7-c1-0002 | 20261042 | `c77dd4a2aa1f8b3977e966890011669bd3def9baef1c71ffe4923a0ba37ea2ec` | 80 s | 567 × 316 | 36 px | none |
| zeus-idle-south-u7-c1-0003 | 20261043 | `254f6f4f4a6989628a25799bde8fb209c0f2237f58a85b41178aaefa2c565e50` | 81 s | 581 × 295 | 31 px | none |
| zeus-idle-south-u7-c1-0004 | 20261044 | `6c5f89afbb25b5d7f27ec132f397563a0c44895ec71fdd0f2c09a9525995918c` | 83 s | 566 × 285 | 38 px | none |
| zeus-idle-south-u7-c1-0005 | 20261045 | `11ecec55a5d3d6101a139c437708787861186a28d87e38ce006a5d58d1447a35` | 82 s | 567 × 278 | 37 px | none |
| zeus-idle-south-u7-c1-0006 | 20261046 | `bbc465f452f01ef5f83a83d6b699872d885c4e6eb0af971c40a00a6418abcafd` | 80 s | 578 × 296 | 33 px | none |
| zeus-idle-south-u7-c1-0007 | 20261047 | `c9b27b551573da09c3374c03b510c52b20a5666883eb790ed81f5ecdcee8a19c` | 80 s | 588 × 291 | 26 px | none |

Durations are the gaps between the job records' modification times (the records carry no timestamps), so they are accurate to a second or two.

**Downscale.** `run_sprite_c1.py` keys each render at source resolution (border-connected flood from the mean corner colour, RGB tolerance 24, components under 0.1% of the largest dropped), then runs `sprite_downscale.py` with the 16-colour Olympus palette, the 1 px exterior outline and foot placement. Tiles: mode (M) and k-centroid (K) at total height 54, and mode at 50 and 56. The keyed figure box includes everything the key leaves behind, so it counts a raised bolt, a ground shadow or a prop that is not close to the key colour; it is a measurement of the box, not of the figure alone.

Keying notes per render, from the measurements: the backgrounds are not all the same, with a mid-grey ground in 0001 and a brown ground in 0007. The key follows the corner mean in each case. Renders 0001 (a dark ground ellipse under the feet), 0002 (a vertical staff and a ground line) and 0003 (ground smudges beside the feet, 9 foreground runs on its lowest row) keep those extras inside the figure box.

**Outputs** (`<repo>/.context/studio-pipeline/c1/`, gitignored): `cells/<job>/<tile>.png`, `keyed/<job>.png` (magenta marks transparent), `contact-1x.png` and `contact-4x.png` (a row per seed S1–S8 in job order, columns M54, K54, M50, M56), `raw-half.png` and `raw-quarter.png` (the 512×640 renders box-averaged by 2 and by 4, four per row, in job order), `results.json` (all measurements) and the session logs. Reproduce the downscale with `python3 tools/probes/art-edit/run_sprite_c1.py` once the store holds the jobs.

## Sprite Phase C2

C2a, a clean downscale of candidate S4 (job `zeus-idle-south-u7-c1-0003`, seed 20261043); no face or bolt work, no model runs, studio store read only. `run_sprite_c2a.py` re-keys the raw render by recorded rules (the border key, then in the lowest 3% of the first keyed box the ground-shadow colour [189, 193, 194] within 30 and its light low-chroma fringe, then the border flood again, then the largest 8-connected component with others under 500 px dropped), which removed 1202 shadow and 387 fringe pixels and left 5 specks of 6 px in total to drop. At source resolution the feet are x 179–250 and 320–387, soles on row 607, sole midpoint 284.0; the body (crown to soles) is 536 px and the box with the raised bolt is 580 px. Tiles M and K at body heights 50 and 52 (totals 54 and 56 with the bolt), placed by the midpoint between the soles, are in `<repo>/.context/studio-pipeline/c2/` with `results.json`, the before/after keyed views and a raw | old C1 M56 | new strip.

C2b hand-pixels the M50 tile to a written spec (`sprite_cleanup_c2b.py`, spec as per-region lists with a removal box; any write outside its region or over its ceiling raises): the face, a new bolt and grip replacing the old prop, and the cloth folds and belt, changing 131 of 920 opaque pixels (5 face, 97 bolt and grip, 29 cloth and belt; ceilings 12, 135, 37 and 184 in total), with the feet, hem, head outline and placement frozen. Outputs `c2b.png`, `c2b-4x.png`, `strip-b2c-m50-c2b-1x.png`, `strip-b2c-m50-c2b-4x.png` (tiles `2` B2c, `50` M50, `C2` C2b) and `report-c2b.json` are in `<repo>/.context/studio-pipeline/c2/`.

C2c fixes the outlines of the accepted C2b frame (`sprite_cleanup_c2c.py`, recolour only, alpha identical): rule 1 sets each exterior pixel to the darkest shade of the ramp of the form it bounds, rule 3 thins a 2 px inherited border to 1 px by setting its inner pixel to that ramp's next-darker shade, and rule 4 keeps a 1 px dark line only where forms overlap (the front form's darkest shade) and sets other interior lapis seams to the ramp's shadow tone; the art guide calls for no lit-side exception, so none is applied. Reviewer rulings (A layer order: robe, belt and arm in front of the cape; B ties and empties; C unresolved thinning; D overlap lines) are explicit pixel tables that take priority, with two small labelled tables for rule misfires (E) and neighbours the rulings imply (F, including the hand's exposed bottom-right corner at (41,59)). It changes 236 pixels against C2b (A 20, B 11, C 9, D 7, E 4, F 4, R1 91, R3 78, R4-overlap 8, R4-seam 4) and leaves the bolt, fist, grip and face feature pixels untouched; outputs `c2c.png`, `c2c-4x.png`, `strip-c2b-c2c-1x.png`, `strip-c2b-c2c-4x.png`, `diff-c2b-c2c-4x.png` (changed pixels magenta) and `report-c2c.json` are in `<repo>/.context/studio-pipeline/c2/`.

## Sprite Phase C2 idle

A 4-frame idle-south breathing loop from the accepted C2c frame, held at 333, 167, 333 and 167 ms (a 1000 ms loop; GIF delays 33, 17, 33, 17 cs) (`sprite_idle_c2.py`; every frame is C2c plus explicit operations). F0 is C2c exactly. F1 and F3 change only the diagonal chest fold (2 pixels and 1 pixel). F2 raises the head, hair, crown, beard, shoulders and upper chest (rows 30–45 right of x=24, without the right arm and hand from row 43; 183 pixels) by 1 px with their outlines, fills the 17 cells that leaves with the fixed pixel below, repairs 3 pixels, and holds F1's raised chest fold at its two pixels (93 changed pixels against F0). The bolt, fist, grip, forearm, upper-arm column, belt, robe, hem and feet are identical in all four frames; the soles stay at x=22–29 and 34–41 on row 79 (midpoint 32.0), the height stays 54 and every frame passes report-only conformance at scale 1. Outputs are `f0.png`–`f3.png`, `sheet.png`, `sheet-4x.png`, `idle-1x.gif`, `idle-4x.gif`, `diff-4x.png` and `report-idle.json` in `<repo>/.context/studio-pipeline/idle/`.
