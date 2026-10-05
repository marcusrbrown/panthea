// Pack loading, lore manifests, and realm definitions.
//
// `loadContentPack` reads an authored world directory (locations + rules
// required; buildings + inhabitants optional) and parses it through
// packages/contracts' `parseContentPack`, so invalid content fails loudly
// at load time with a clear, structured message. `loadGodProfiles` reads the
// sourced god profiles beside it and checks them against the pack, and
// `loadMotifCatalogue` reads the sourced endings (motifs) a thread can draw on.

export * from "./god-profile";
export * from "./god-visual-profile";
export * from "./load";
export * from "./motifs";
