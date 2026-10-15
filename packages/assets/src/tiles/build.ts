// The tile set a ground profile and two posted patches make, and what is checked of each atlas
// cell. Pack builds the atlas this way and the publish-time audit builds it again the same way.

import { TILE_CELL, TILE_MASKS, tileAtlasRect } from "@panthea/contracts";
import {
  type ConformanceInput,
  conformImage,
  type Rgb,
  type RgbaImage,
} from "../conformance";
import type { PostPalette } from "../render/post-palette";
import type { ModelProfile } from "../render/profile";
import { stampParamsOf } from "./params";
import { type Patches, stampAtlas } from "./stamp";

export type TileSetResult =
  | {
      readonly ok: true;
      readonly atlas: RgbaImage;
      readonly period: number;
      readonly terrain: { readonly base: string; readonly over: string };
    }
  | { readonly ok: false; readonly message: string };

/** The atlas of a ground profile from its two posted patches. */
export function stampTileSet(
  profile: ModelProfile,
  palette: PostPalette,
  patches: Patches,
): TileSetResult {
  const made = stampParamsOf(profile, palette);
  if (!made.ok) return made;
  const stamped = stampAtlas(made.params, patches);
  if (!stamped.ok) return stamped;
  return {
    ok: true,
    atlas: stamped.image,
    period: made.params.period,
    terrain: made.build.terrain,
  };
}

/** One 64x32 cell of an atlas. */
export function atlasCell(
  atlas: RgbaImage,
  mask: number,
  offset: number,
  period: number,
): RgbaImage {
  const rect = tileAtlasRect(mask, offset, period);
  const rgba = new Uint8Array(rect.w * rect.h * 4);
  for (let row = 0; row < rect.h; row += 1)
    rgba.set(
      atlas.rgba.subarray(
        ((rect.y + row) * atlas.width + rect.x) * 4,
        ((rect.y + row) * atlas.width + rect.x + rect.w) * 4,
      ),
      row * rect.w * 4,
    );
  return { width: rect.w, height: rect.h, rgba };
}

export interface CellCheck {
  readonly check: string;
  readonly status: "pass" | "fail";
  readonly message?: string;
}

/**
 * Tile conformance of every atlas cell, report-only: a check named `mask/offset:check` for each of
 * the 16 masks at each of the N squared offsets.
 */
export function tileCellChecks(
  atlas: RgbaImage,
  period: number,
  paletteRgb: readonly Rgb[],
  conform: Pick<ConformanceInput, "background" | "alphaCutoff" | "grid">,
): { ok: true; checks: CellCheck[] } | { ok: false; message: string } {
  const checks: CellCheck[] = [];
  for (let offset = 0; offset < period * period; offset += 1)
    for (let mask = 0; mask < TILE_MASKS; mask += 1) {
      const cell = atlasCell(atlas, mask, offset, period);
      const result = conformImage({
        ...cell,
        kind: "tile",
        mode: "report-only",
        cell: { w: TILE_CELL.w, h: TILE_CELL.h },
        paletteRgb,
        colourLimit: paletteRgb.length,
        background: conform.background,
        alphaCutoff: conform.alphaCutoff,
        grid: conform.grid,
        scale: 1,
      });
      if (result.status !== "done")
        return {
          ok: false,
          message: `atlas cell (mask ${mask}, offset ${offset}) cannot be reported on: ${result.status === "invalid-input" ? `${result.field}: ${result.message}` : result.message}`,
        };
      for (const check of result.report.checks)
        checks.push({
          check: `${mask}/${offset}:${check.check}`,
          status: check.status,
          ...(check.message === undefined ? {} : { message: check.message }),
        });
    }
  return { ok: true, checks };
}
