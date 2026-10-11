// What the inspection fixture can select. A selection is explicit: an asset
// with a state, direction and optional ability (sprite) or an expression
// (portrait). It is never derived from world state, and it may name a state
// that no asset publishes, which draws the placeholder.

import type { RegistrySnapshot, ResolveQuery } from "@panthea/assets/browser";
import type { AssetVocabulary } from "@panthea/contracts";

import { selectionKey } from "./reference";

export type Selection =
  | {
      readonly assetId: string;
      readonly kind: "sprite";
      readonly state: string;
      readonly direction: string;
      readonly ability?: string;
    }
  | {
      readonly assetId: string;
      readonly kind: "portrait";
      readonly expression: string;
    };

export interface AssetListing {
  readonly assetId: string;
  readonly kind: string;
  readonly revision: string;
}

export function listAssets(snapshot: RegistrySnapshot): AssetListing[] {
  return [...snapshot.entries.values()]
    .map((entry) => ({
      assetId: entry.assetId as string,
      kind: entry.manifest.kind as string,
      revision: entry.revision as string,
    }))
    .sort((a, b) =>
      a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0,
    );
}

export interface SelectionOptions {
  readonly states: readonly {
    readonly id: string;
    readonly perAbility: boolean;
  }[];
  readonly directions: readonly string[];
  readonly expressions: readonly string[];
}

export function optionsOf(
  vocabulary: AssetVocabulary | undefined,
): SelectionOptions {
  if (vocabulary === undefined) {
    return { states: [], directions: [], expressions: [] };
  }
  return {
    states: vocabulary.states.map((state) => ({
      id: state.id,
      perAbility: state.perAbility === true,
    })),
    directions: vocabulary.directions,
    expressions: vocabulary.expressions,
  };
}

/** Idle facing south, or the neutral expression: where the fixture opens. */
export function defaultSelection(
  asset: AssetListing,
  _vocabulary: AssetVocabulary | undefined,
): Selection {
  return asset.kind === "portrait"
    ? { assetId: asset.assetId, kind: "portrait", expression: "neutral" }
    : {
        assetId: asset.assetId,
        kind: "sprite",
        state: "idle",
        direction: "south",
      };
}

export function selectionQuery(selection: Selection): ResolveQuery {
  if (selection.kind === "portrait") {
    return { spriteId: selection.assetId, expression: selection.expression };
  }
  return {
    spriteId: selection.assetId,
    state: selection.state,
    direction: selection.direction,
    ...(selection.ability === undefined || selection.ability === ""
      ? {}
      : { ability: selection.ability }),
  };
}

export function selectionLabel(selection: Selection): string {
  const key =
    selection.kind === "portrait"
      ? selectionKey({ expression: selection.expression })
      : selectionKey({
          state: selection.state,
          direction: selection.direction,
          ...(selection.ability === undefined || selection.ability === ""
            ? {}
            : { ability: selection.ability }),
        });
  return `${selection.assetId} ${key}`;
}
