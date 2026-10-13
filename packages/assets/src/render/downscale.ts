// 4x raw passes to 1x maps. Each cell pixel is a SUPERSAMPLE x SUPERSAMPLE block of the raw
// frame. Colour: the palette colour that most of the block's opaque pixels snap to (a tie goes
// to the earliest palette colour); the pixel is opaque when at least half the block is. Part id
// and depth: the block's modal part (a tie goes to the later name) and that part's mean depth.
// A port of the probe's `downscale_figure(..., "mode", ...)` and `block_maps`.

import type { RgbaImage } from "../conformance";
import { decodePartId, type PartId, SUPERSAMPLE } from "./parts";
import type { PostPalette } from "./post-palette";

const BLOCK = SUPERSAMPLE * SUPERSAMPLE;

export function modeDownscale(
  source: RgbaImage,
  cell: { readonly w: number; readonly h: number },
  palette: PostPalette,
): RgbaImage {
  const out = new Uint8Array(cell.w * cell.h * 4);
  const counts = new Int32Array(palette.colours.length);
  const touched: number[] = [];
  for (let by = 0; by < cell.h; by += 1) {
    for (let bx = 0; bx < cell.w; bx += 1) {
      let opaque = 0;
      touched.length = 0;
      for (let dy = 0; dy < SUPERSAMPLE; dy += 1) {
        const row =
          ((by * SUPERSAMPLE + dy) * source.width + bx * SUPERSAMPLE) * 4;
        for (let dx = 0; dx < SUPERSAMPLE; dx += 1) {
          const at = row + dx * 4;
          if (source.rgba[at + 3] === 0) continue;
          opaque += 1;
          const index = palette.snapIndex([
            source.rgba[at] as number,
            source.rgba[at + 1] as number,
            source.rgba[at + 2] as number,
          ]);
          if (counts[index] === 0) touched.push(index);
          counts[index] = (counts[index] as number) + 1;
        }
      }
      let best = -1;
      let bestCount = 0;
      for (const index of touched) {
        const count = counts[index] as number;
        if (count > bestCount || (count === bestCount && index < best)) {
          best = index;
          bestCount = count;
        }
        counts[index] = 0;
      }
      if (best >= 0 && opaque / BLOCK >= 0.5 - 1e-9) {
        const colour = palette.colours[best] as readonly number[];
        out.set(
          [colour[0] as number, colour[1] as number, colour[2] as number, 255],
          (by * cell.w + bx) * 4,
        );
      }
    }
  }
  return { width: cell.w, height: cell.h, rgba: out };
}

export interface BlockMaps {
  /** The part at each cell pixel, null where the id pass is empty. */
  readonly parts: readonly (PartId | null)[];
  /** Mean camera distance of that part within the block, in metres; 0 where there is no part. */
  readonly depths: readonly number[];
  /** Opaque id-pass pixels whose byte is not a known part. */
  readonly unknown: number;
}

export function blockMaps(
  id: RgbaImage,
  depth: RgbaImage,
  cell: { readonly w: number; readonly h: number },
  depthByte: readonly number[],
): BlockMaps {
  const parts: (PartId | null)[] = [];
  const depths: number[] = [];
  let unknown = 0;
  for (let by = 0; by < cell.h; by += 1) {
    for (let bx = 0; bx < cell.w; bx += 1) {
      const votes = new Map<PartId, number>();
      const total = new Map<PartId, number>();
      for (let dy = 0; dy < SUPERSAMPLE; dy += 1) {
        const row = ((by * SUPERSAMPLE + dy) * id.width + bx * SUPERSAMPLE) * 4;
        for (let dx = 0; dx < SUPERSAMPLE; dx += 1) {
          const at = row + dx * 4;
          if (id.rgba[at + 3] === 0) continue;
          const part = decodePartId(id.rgba[at] as number);
          if (part === null) {
            unknown += 1;
            continue;
          }
          votes.set(part, (votes.get(part) ?? 0) + 1);
          total.set(
            part,
            (total.get(part) ?? 0) +
              (depthByte[depth.rgba[at] as number] as number),
          );
        }
      }
      let chosen: PartId | null = null;
      let chosenVotes = 0;
      for (const [part, count] of votes) {
        if (
          count > chosenVotes ||
          (count === chosenVotes && chosen !== null && part > chosen)
        ) {
          chosen = part;
          chosenVotes = count;
        }
      }
      parts.push(chosen);
      depths.push(
        chosen === null ? 0 : (total.get(chosen) as number) / chosenVotes,
      );
    }
  }
  return { parts, depths, unknown };
}
