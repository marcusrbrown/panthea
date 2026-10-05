# Art guide

Status: Draft defaults proposed 2026-10-03 for owner review. These are D23 tunables, not owner decisions; the asset studio's conformance step enforces whatever this file says, so change the file rather than the tool. content-direction.md asked for this guide; D14, X02, and X03 govern delivery.

## Purpose

One place that says what a Panthea asset looks like so that a generated, hand-drawn, or procedurally derived frame can be checked against it. Every rule here is either measurable by the conformance step or a do/don't an owner review can apply.

## World scale

- The world renders at 1× logical pixels into a low-resolution target and upscales by an integer factor (2×, 3×, 4×) with nearest-neighbour filtering. No fractional zoom, no camera positions off the pixel grid.
- Isometric tiles are 64×32 (2:1). The diamond is drawn 64×31 so adjacent tiles lock without a seam row.
- One elevation step is 16 px. Stacked tiles anchor to the bottom vertex of their grid cell.
- Depth order is `x + y − z` in tile units; taller sprites use their footprint's bottom-vertex cell. Ties break by layer: ground, ground decals, structures, actors, effects, speech.
- Target window is 1280×720 at 2× (640×360 logical), per ux-direction.md. Compose scenes so a town street reads at that size.

## Characters

| Class | Height | Cell | Notes |
| --- | --- | --- | --- |
| Mortals, animals | 40–48 px | 64×64 | About 1.5 tile widths tall; children and small animals down to 24 px. |
| Gods | 48–56 px | 64×80 | Taller than mortals at rest; a divine aura or motif, never a size that breaks the cell. |
| Beasts, large props | up to 96 px | 128×128 | Footprint 2×2 tiles or larger; declare it. |

- Pivot is the midpoint between the feet, placed at the bottom vertex of the occupied tile. Collision footprint is declared in tiles (1×1 for humanoids).
- Four directions for the MVP: south, north, east, west. West is east mirrored unless the asset declares an asymmetry (Hephaestus's hammer hand, Zeus's bolt hand). Eight directions are deferred.
- States (versioned data, defaults here): `idle` (4 frames at 6 fps), `seated` (2 frames, gods only; Zeus on a cloud with body partly obscured is the reference), one `act` per declared ability (4–6 frames at 10–12 fps), `walk` (6 frames at 10 fps; deferred until the world carries position and facing), `hurt` (2 frames), `down` (1 frame). Timing is per-frame in milliseconds in the manifest.
- Only `idle` bob, east/west mirroring, palette swaps, and overlays are derived procedurally; `walk` and `act` frames are drawn or generated and repaired.
- Silhouette first: a character must be identifiable at 1× from shape and two colours alone. Test by thresholding to black on white.
- Readable features at this scale: head about one quarter of height, hands as 2–3 px blocks, no faces beyond eyes and brow on world sprites. Expression lives in portraits.

## Portraits

- 96×96 at 1×, bust framing, facing three-quarter toward the viewer, flat background in the realm's family colour.
- Six expressions per character: `neutral`, `pleased`, `angry`, `grieving`, `scheming`, `awed`. The same head position and hairline across all six; only eyes, brows, mouth, and one secondary cue (a hand, a glow) change.
- Portraits may use more detail and colours than world sprites (up to 32 colours against 16) but the same palette families and outline rule.

## Palette

- One master palette per content pack, at most 64 colours, committed as a `.gpl`/`.hex` file under `content/greek/palette/` and referenced by every asset. The owner approves the master palette before any asset is marked canon; drafts conform against a provisional palette until then.
- Each character gets ramps of 4–5 shades drawn from the master palette; world sprites use at most 16 colours including outline, portraits at most 32.
- Realm families (hues set by the owner-approved [`greek-master` palette](../../content/greek/palette/palette.json); other guide defaults remain owner-vetoable):
  - Town and wilderness: warm earth, olive, terracotta, sun-bleached stone; sky light.
  - Olympus: cool whites, pale gold, lapis, marble; high key.
  - Underworld: desaturated violet, ash, bone, ember accents; low key.
- Realm variants of a shared asset are palette swaps, never redraws, so the conformance step can verify them.
- No pure black (#000000) or pure white (#FFFFFF) in sprites; the darkest outline shade and the brightest highlight are palette entries.

## Line, light, and dithering

- Selective outline: 1 px, in the darkest shade of the local ramp, on the exterior silhouette and where forms overlap; no outline between adjacent shades of one form.
- Key light from the upper left (north-west in iso), consistent across every asset, including buildings and tiles. Cast shadows are a single flat shade on the ground layer, one tile-height tall at most.
- No automatic dithering. Hand dithering is allowed for large gradients (sky, water, cloth) in checkerboard only.
- No anti-aliasing between sprite and background; alpha is binary. Interior anti-aliasing is allowed on portraits only.
- Pixel clusters, not noise: no isolated single pixels except deliberate highlights.

## Tiles, structures, and decals

- Ground tiles use dual-grid (16-tile) autotiling for terrain transitions; blob (47-tile) sets only where a material needs inner corners (walls, water edges).
- Structures declare footprint, height in elevation steps, door tiles, and three states: `intact`, `damaged`, `burning`. Damage and fire are overlay layers on the intact sprite so the silhouette never changes mid-scene.
- Decals (scorch, rubble, blood, offerings) are 1-tile ground-layer sprites with binary alpha and no outline.
- Repeating textures must be seamless at tile boundaries; the conformance step checks edge pixels against neighbours in the set.

## Effects

- Every effect ships in three intensity tiers. Tier 1 is the reduced-effects presentation (X03): no full-screen flash, no screen shake, under 300 ms, still communicates the event. Tier 3 is the spectacle version.
- Effects use the master palette. An effect may declare up to 4 emissive accent colours outside it, listed in its metadata and reviewed with the effect. Any other colour outside the master palette fails conformance. Additive blending is allowed for tier 2 and 3 only.
- Effect pivot and footprint are declared like actors; a strike effect anchors to the target tile.
- Frame timing is per-frame; loops declare their loop start.

## Interface

- Long text uses ordinary readable fonts scaled independently of world zoom (ux-direction.md). Pixel type only for short decorative labels.
- Frames and panels are hand-drawn 9-slice sets at 8 px or 16 px corner size; icons are 16×16 or 24×24 on the master palette.
- Do not rely on colour alone for state; pair with shape or text.

## Metadata every asset carries

From content-direction.md, made concrete: `id`, `kind`, `pixelScale`, `cell` (w×h), `pivot` (x, y), `footprint` (tiles), `directions`, `states` with frame lists and per-frame durations, `paletteFamily`, `paletteId`, `styleTag`, `realmVariants`, and for portraits `characterId` and `expressions`; for tiles `orientation`, `layer`, `occlusion`, `wangId`; for effects `tier` and `emissiveAccents` (up to 4 colours outside the master palette, empty by default). Provenance fields live beside this in the manifest (creation method, inputs, model, seed, hashes, hand-edit steps, licences).

## Conformance checks (what the studio measures)

- Native grid recovered to 1×; no sub-pixel colour blending remains.
- Colour count within the class limit; every colour is a master palette entry, except an effect's declared emissive accents (at most 4, listed in its metadata).
- Canvas equals the declared cell; pivot and footprint inside it; binary alpha.
- Silhouette threshold test produces a connected shape with no stray pixels.
- Directions present and east/west mirror consistent unless asymmetry declared.
- Frame counts and durations within the state's declared range.
- Tiles: edges seamless with declared neighbours.
- Effects: three tiers present; tier 1 under 300 ms and no full-screen fill; no colour outside the master palette and the declared emissive accents.

## Do and don't

- Do read as one hand drew everything, across gods, mortals, and three realms.
- Do keep gods human-scaled and legible; divinity shows in posture, motif, and effect, not in pixel count.
- Don't copy Chrono Trigger, Final Fantasy Tactics, or any existing game's sprites, portraits, or palettes; original work only (content-direction.md).
- Don't let generated output ship unconformed; a frame that fails a check is a draft.
- Don't add detail that does not survive the 1× silhouette test.

## Open for owner decision

- Exact master palette hues (a Lospec-style 64-colour palette authored for Panthea or adapted from a CC0 palette with attribution).
- Whether gods get an always-on aura or only in `act` states.
- Portrait framing: strict bust or allowing hands and props in frame.
- Whether the town uses a single terrain family or splits street and field palettes.
