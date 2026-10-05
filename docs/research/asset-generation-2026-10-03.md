# Asset generation research: sprites, tiles, effects, sound, editors

Reviewed 2026-10-03 from vendor documentation, model cards, and repositories. Documentation review, not hands-on tests; every timing below is someone else's hardware unless a probe link says otherwise. This informs the asset-studio requirements (`docs/brainstorms/2026-10-03-asset-studio-requirements.md`) and does not change owner decisions or ADRs.

## Bottom line

- No open-weights, 16 GB-friendly tool turns one approved sprite into a consistent walk cycle plus eight directions. The products that do (PixelLab, Retro Diffusion) are hosted. Locally the honest pipeline is: keyframe from diffusion → deterministic pixel-grid recovery and palette lock → hand finish → procedural derivation for the rest.
- The M0 chain (SD 1.5 + PixelArtRedmond LoRA) has a non-commercial-oriented LoRA licence. A candidate Apache-2.0 chain exists on stable-diffusion.cpp: FLUX.2-klein-base-4B plus the svntax LoRA (both Apache-2.0 per their model cards). Z-Image-Turbo is Apache-2.0 as a model, but its Civitai pixel LoRA carries custom permission flags rather than a named Apache licence, so it is gated on an owner decision before any acquisition. Quantization, 16 GB fit, and M1 Pro timings are all unmeasured and need a new probe.
- No open model emits edge-consistent isometric tilesets. Procedural stamping (seamless base texture → masked 16- or 47-tile sets) is deterministic and standard; Tiled TMJ with `orientation: isometric` and `wangsets` is the map format. LDtk will not do isometric.
- Sound is cheapest of all: zzfx/jsfxr parameter sets (MIT / Unlicense, <1 KB) rendered offline, with Stable Audio 3 Small-SFX (1.6 GB on MLX) for organic layers, and MIDI → SoundFont for chiptune loops.
- Aseprite is fully scriptable headless (`aseprite -b --script`, `--sheet`, `--data`); it stays a user-installed external tool.

## Runtime and derivation constraints

- `sd-server` is available. The M0 probe ran it with `/sdcpp/v1/...` and A1111-compatible `/sdapi/v1/...` routes ([tools/probes/art-local/README.md](../../tools/probes/art-local/README.md)), and the repository's `examples/server` documents it.
- The M0 probe used the release binary `master-921-168f7b8` and measured Metal speedups from `--diffusion-fa` (the f16 crash trace names an `MTL0` buffer). Verify the current release on the actual host before deciding whether a source build is required.
- Procedural derivation is limited to mirroring, palette swaps, overlays, and idle bob. Bob/offset rules cannot produce walk cycles (legs do not move), so walk and act frames are hand-drawn or generated and repaired.

## Local image generation on 16 GB

stable-diffusion.cpp (MIT, Metal) now loads SD1.x/2.x/SDXL, SD3/3.5, FLUX.1/FLUX.2 (dev, klein 4B/9B, Kontext), Qwen-Image and Qwen-Image-Edit, Z-Image, Wan 2.1/2.2, and others; LoRA applies to quantized weights at runtime; img2img, inpainting, and multi-reference edit paths exist. ControlNet is SD1.5 only; IP-Adapter is SD1.5 and SDXL only. <https://github.com/leejet/stable-diffusion.cpp>

| Chain | Licence | Fit in 16 GB | Notes |
| --- | --- | --- | --- |
| FLUX.2-klein-base-4B (+ Qwen3-4B encoder) + `svntax-dev/pixel_spritesheet_4walk_small_lora_v1` | Base model and LoRA both Apache-2.0 per their cards (Qwen3-4B encoder and FLUX.2 VAE also Apache-2.0, as declared by their source cards and recorded in `components.json`) | Unmeasured: quantization choice and 16 GB fit must be established by a probe; no published M1 Pro timing | The only open one-shot sprite-sheet LoRA found on an Apache base: 4×4 sheet of 32×32 characters (walk ×3 per direction, jump, prone), trained at 512×512 and downscaled ×4. The LoRA README specifies the base (`FLUX.2-klein-base-4B`) as its `base_model`; the author says the distilled klein-4B is technically compatible but ruins pixels and consistency. Author warns of cut hair and weak back views. Larger single-cell or portrait workloads (for example 512×640 or 768×768 with 8× downscale) differ from the training layout and are unmeasured style/workload mismatches. Multi-reference edit built in. <https://huggingface.co/black-forest-labs/FLUX.2-klein-base-4B>, <https://huggingface.co/svntax-dev/pixel_spritesheet_4walk_small_lora_v1>, <https://huggingface.co/svntax-dev/pixel_spritesheet_4walk_small_lora_v1/raw/main/README.md> |
| Z-Image-Turbo (6B) + "Pixel Art Style LoRA" (Civitai model 1770073, creator `tarn59`, version 2454660, file 2344890) | Z-Image-Turbo model: Apache-2.0. LoRA: no licence text; custom Civitai permission flags (commercial use: Image, RentCivit, Rent, Sell, SellMerge; no-credit, derivatives, and different-licence all allowed), not a named Apache-2.0 licence. Owner gate required before acquisition; not eligible as a canonical default on assumed Apache terms | Runs at Q3–Q8; "functional but tight" on 16 GB Macs; ~160 s per 1024² reported on M1 Max 32 GB | Good txt2img pixel art; weak at img2img restyling (too few steps). Permission flags read from the Civitai API (`GET https://civitai.com/api/v1/models/1770073`); download URL `https://civitai.com/api/download/models/2454660?fileId=2344890` (listed SHA256 `09B1B45CEED0202929BCA528E51B50208D0160F4E9D2BA0F42CB7E739A43577F`, API metadata only, not download-verified). <https://civitai.com/models/1770073/pixel-art-style-lora> |
| SDXL (or Illustrious) + `nerijs/pixel-art-xl` | CreativeML Open RAIL-M (use restrictions, outputs free) | ~7.5 GB fp16, comfortable | Only tier with IP-Adapter reference conditioning in sd.cpp; still no SDXL ControlNet there. <https://huggingface.co/nerijs/pixel-art-xl> |
| SD 1.5 + pixel LoRAs | RAIL-M; PixelArtRedmond LoRA is non-commercial-oriented | 4–5 GB, fastest, M0 measured 37.3 s/image at 512² Q8_0 | Only tier with ControlNet OpenPose in sd.cpp. Keep for pose-locked frames; do not use the Redmond LoRA for canon assets. |
| Qwen-Image / Qwen-Image-Edit + `fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA` | Apache-2.0 | 24 GB+ even at Q4 | The most principled open "rotate this character" tool (azimuth in 45° steps). Documented, not built. <https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA> |
| Wan 2.2 14B + pixel-animate LoRAs | Apache-2.0 | 24 GB+ | Sprite animation from a start frame; sd.cpp supports Wan. Documented, not built. <https://huggingface.co/styly-agents/Wan2-2-pixel-animate> |
| FLUX.1-dev, FLUX.2-klein-9B and their LoRAs | FLUX non-commercial | — | Avoid: redistributing the pipeline would mislead downstream users even though Panthea is noncommercial. |

Other local runtimes: Draw Things (macOS only, A1111-shaped HTTP, no model selection or cancel; M0 found it 6.5× faster at f16 but precision-confounded), mflux (MIT, MLX, FLUX/Z-Image/Qwen with ControlNet and inpaint; Python CLI), ComfyUI on MPS (GPL nodes, slowest of the three, richest node ecosystem). The sd.cpp arm stays the cross-platform base per ADR-0007.

## Character consistency

Ranked by reliability today:

1. Hosted: PixelLab `animate_character` / 8-direction rotate (API, MCP server at `api.pixellab.ai/mcp`, per-call pricing; outputs commercially usable, no training on outputs) and Retro Diffusion animation jobs (API v2, MCP server; walk/idle/attack cycles and 8-direction rotation from a start frame). Interface-only for Panthea.
2. Edit-model reference conditioning in sd.cpp (FLUX.2-klein multi-reference, FLUX.1-Kontext): pass the approved sprite, prompt the new direction or pose, expect drift, repair with palette lock and inpainting.
3. Sheet-in-one-shot LoRA (svntax): inter-frame consistency is free, but the start point is text, not an approved sprite; img2img at moderate strength is the workaround.
4. ComfyUI AnimateDiff + OpenPose + character LoRA: 12–16 GB VRAM, drifts past a couple of seconds, SD1.5/SDXL motion modules only.
5. Video models (Wan 2.2 pixel LoRAs): 24 GB+.

Research code (Sprite Sheet Diffusion, arXiv 2412.03685; Animate Anyone derivatives) targets HD characters, not pixel art. Nothing in 2025–2026 targets pixel sprites specifically.

Consequence for the studio: procedural derivation (mirroring, bob/offset cycles, palette swaps, overlays) is the consistency mechanism; generation fills gaps and gets repaired.

## Pixel-grid recovery and palette lock

| Tool | Licence | Form | Notes |
| --- | --- | --- | --- |
| `Retro-Diffusion/pixel-art-fixer` | MIT | Python reference + Rust binary | Three voting grid detectors with octave arbitration; 77% exact native-size recovery on their 4,300-image benchmark. Strongest detector; shell out from Bun. <https://github.com/Retro-Diffusion/pixel-art-fixer> |
| `jenissimo/unfake.js` | MIT (bundles libimagequant, which is GPL/commercial dual-licensed; check linkage before vendoring) | Rust→WASM, ESM | Scale detection, several downscale modes, grid snap, palette quantization, alpha binarization, cleanup. Browser-oriented; Bun loading unverified. <https://github.com/jenissimo/unfake.js> |
| `KohakuBlueleaf/PixelOE` | Apache-2.0 | Python | Outline-preserving downsampling and k-centroid; good for restyling non-pixel renders. <https://github.com/KohakuBlueleaf/PixelOE> |
| `Astropulse/pixeldetector` | MIT | Python | The original; superseded by the two above. |
| k-centroid downscale | algorithm | — | Per-cell k-means; a few hundred lines in TypeScript, deterministic. |
| `image-q` | MIT | TypeScript | Full quantizer/ditherer set; last release 2022 but complete. `sharp` (Apache-2.0) handles palette PNG output when a fixed palette is not needed. |

Background removal: generate on a flat chroma background and flood-fill plus alpha-binarize; it beats matting nets at 32–128 px. If a net is needed, `rembg` with `birefnet-general-lite` (MIT weights), not the default `bria-rmbg` (paid for commercial use) or RMBG-2.0 (CC BY-NC). Avoid `@imgly/background-removal` (AGPL).

Recommendation: implement grid detection, k-centroid downscale, and fixed-palette quantization in TypeScript inside `@panthea/assets` (deterministic, testable, no licence tangle), with `pixel-art-fixer` as an optional external detector when the TS detector reports low confidence.

## Tiles and maps

- Edge-consistent sets come from procedural stamping (AI or hand-made seamless base texture → template masks cut 16-tile dual-grid or 47-tile blob sets) or from hosted constrained generation (PixelLab Tiles Pro with isometric shapes and building kits; Retro Diffusion `rd_tile__tileset`). The only open in-sampler Wang method is Tiled Diffusion (CVPR 2025, PyTorch research code, no Mac claims). Red Blob Games documents autotile schemes; Excalibur's dual-grid post has TypeScript. <https://www.redblobgames.com/articles/autotile/claude/>, <https://github.com/madaror/tiled-diffusion>
- Isometric LoRAs for SDXL (Zavy's Cute Isometric Tiles, Isometric Tile Map) produce scenes and props, not grid-aligned sets; useful for buildings and look development.
- Map format: Tiled JSON (`orientation: "isometric"`, `tileoffset`, `wangsets` with eight-value `wangid`, infinite chunks). LDtk closed isometric as "wontdo" (issue #944). TypeScript parsers: `pixi-tiledmap` (MIT; parser separable from Pixi), `@kayahr/tiled` (types). <https://doc.mapeditor.org/en/stable/reference/json-map-format/>
- WFC: `wavefunctioncollapse` (MIT, 2021), `ndwfc` (MIT, infinite canvas); both small enough to vendor. `simplex-noise` (MIT) for terrain.
- three-flatland `0.1.0-alpha.10` (MIT, `three ^0.185.1`) has `TileMap2D`, Tiled and LDtk loaders, animated tiles, `AnimatedSprite2D`, `SpriteGroup`. Its `TileMapData.orientation` type includes `"isometric"` but no evidence of isometric placement or depth sorting was found; verify, and budget an isometric layer that emits sprites into `SpriteGroup` with `x + y − z` render order. <https://github.com/thejustinwalsh/three-flatland>
- Isometric conventions: 2:1 tiles, 64×32 modern default (draw the diamond 64×31 to avoid seams), elevation step one tile height, characters about 1–1.5 tile widths tall, integer zoom with nearest-neighbour, render to a low-resolution target and upscale.
- Damage states: lock silhouette with ControlNet canny/depth (SD1.5 in sd.cpp, or mflux for FLUX) and img2img at 0.3–0.5 denoise per state; prefer runtime overlay layers (cracks, scorch, fire) over regenerating the building.
- Pixel VFX tools (Pixel FX Designer, SpriteMancer, JuiceFX) are Windows GUIs; a small offline particle baker in Bun rendered to an indexed canvas is the scriptable equivalent.

## Sound

| Option | Licence | Memory | Notes |
| --- | --- | --- | --- |
| zzfx (+ ZzFXM) | MIT | none | 20 numeric parameters, <1 KB, Web Audio or offline render; ideal structured-output target for the resident LLM. <https://github.com/KilledByAPixel/ZzFX> |
| jsfxr | Unlicense | none | sfxr presets (coin, laser, explosion, hit, jump, blip), `toBuffer()` headless, b58 serialization. <https://github.com/chr15m/jsfxr> |
| Stable Audio 3 Small-SFX (May 2026) | Stability AI Community License (<$1M revenue, outputs free, attribution on redistribution, no training other models; T5Gemma pulls in Gemma terms) | 1.6 GB on official MLX; ~1 s per 10 s clip on M1 | Text-to-audio, variation, inpainting; gated download, never vendored. <https://github.com/Stability-AI/stable-audio-3> |
| MOSS-SoundEffect v2.0 | Apache-2.0 | ~8–10 GB on Mac, MPS unproven | Cleanest licence; batch-only when the LLM is unloaded. |
| spessasynth_core | Apache-2.0 | none | Pure TypeScript SF2/SF3 renderer, offline WAV with loop points; pair with a CC0 chiptune SoundFont for MIDI loops. <https://github.com/spessasus/spessasynth_core> |
| ACE-Step 1.5 | MIT | 6–8 GB | Full songs; swap-the-LLM-out job; reference only. |
| AudioGen, MusicGen, MAGNeT/LoopGen, Sony Woosh | CC BY-NC weights | — | Avoid. TangoFlux is research-only. ElevenLabs is hosted. |

Post-processing: ffmpeg `loudnorm` two-pass for music, true-peak (−1 dBTP) for short SFX; Ogg/Opus for delivery; PyMusicLooper (MIT) for loop points; measure loop points on the decoded buffer because Opus adds pre-skip. Tauri webviews block autoplay inconsistently (WebKitGTK, WebView2); gate a single `AudioContext` on first input.

## Editors and exchange

- Aseprite: proprietary EULA, source available (compile for personal use). Headless `--batch`, `--sheet --sheet-type packed --data --format json-array`, `--split-tags`, `--palette`, `--script file.lua --script-param`. Lua API covers sprites, layers, cels, tags, palettes, slices, tilemaps. `MalloyTheDev/aseprite-mcp` (MIT) proves end-to-end automation. Known quirk: `--trim` can misalign `frameTags` when frames are empty; keep character cells untrimmed. <https://www.aseprite.org/docs/cli/>
- Reading `.aseprite` in TypeScript: `ase-parser` (MIT, read-only). No production-grade JS writer; write through Aseprite Lua.
- FOSS editors: Pixelorama (MIT, Godot, headless CLI with a known `--output` bug), LibreSprite (GPL-2 fork, older CLI). Embeddable web editors: `dotting` (MIT React component, no timeline), Piskel (Apache-2.0, monolithic).
- Atlas packing: `maxrects-packer` (MIT, TypeScript, geometry only) or Aseprite's own packer; `free-tex-packer-core` (MIT) when ready-made exporters matter.

## Reference pipelines

- `gfargo/pixelkiln` (MIT, TypeScript CLI): manifest-driven generation, lockfile provenance with output hashes, provider abstraction (PixelLab default, ComfyUI self-hosted experimental), Tiled Wang and Godot terrain export, isometric tile generator. Closest architectural precedent; study, do not depend. <https://github.com/gfargo/pixelkiln>
- `gykim80/perfectpixel-studio` (MIT, Go): deterministic post-processing with a retry loop for frame-count accuracy and Aseprite JSON export; the retry design is worth copying.
- `mcp-tool-shop-org/sprite-foundry` (MIT, Python/ComfyUI, NVIDIA): validation gates, checksummed export contract.
- `PeaarLi/ComfyUI-PixelPipeline` (GPL-3): grid restore, Lab k-means palette, sheet packing; port the ideas, not the code.

## Licence flags for an MIT repository

- Owner gate before acquisition: the Civitai "Pixel Art Style LoRA" (model 1770073) has custom permission flags and no licence text, so it is not treated as Apache-2.0.
- Weights that cannot be vendored: every model above; ship download steps with recorded hashes and licences (the M0 probe already does this).
- Non-commercial or research-only: FLUX.1-dev and FLUX.2-klein-9B families, PixelArtRedmond LoRA (non-commercial-oriented), RMBG-2.0 and bria-rmbg, AudioGen, MusicGen, MAGNeT, Woosh, TangoFlux, the MIDI-LLM chiptune LoRA (trained on copyrighted soundtracks).
- Copyleft kept out of process: ComfyUI and its nodes, Draw Things community code, Furnace, `@imgly/background-removal`, libimagequant (inside unfake.js).
- Hosted output terms: PixelLab allows commercial use and forbids training on outputs; Retro Diffusion's Aseprite extension grants ownership of outputs, its web/API terms were not retrievable.

## Candidate packages (owner approval required before adding)

| Package | Licence | Purpose | Alternative |
| --- | --- | --- | --- |
| `maxrects-packer` | MIT | Atlas packing | Aseprite `--sheet` |
| `ase-parser` | MIT | Read `.aseprite` | Aseprite JSON export only |
| `sharp` | Apache-2.0 | Resize, PNG encode | Existing hand-rolled PNG encoder in the probe |
| `simplex-noise` | MIT | Terrain | Vendor 100 lines |
| `zzfx`, `jsfxr` | MIT, Unlicense | Procedural SFX | Vendor (both are tiny) |
| `spessasynth_core` | Apache-2.0 | MIDI → audio | Defer music |
| `image-q` | MIT | Quantization | Own k-centroid + median-cut in TS (recommended) |
