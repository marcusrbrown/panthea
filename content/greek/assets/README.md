# Greek assets

Studio-owned asset data, separate from the core god profiles in `../gods/`.

- `vocabulary.json`: versioned directions, expressions, palette families, cell classes and animation states, taken from [art-guide.md](../../../docs/product/art-guide.md).
- `subjects/<god>.json`: a god's visual profile, joined to its profile by `godId`. The stable sprite id stays `sprite` in the god profile (Zeus: `placeholder-zeus`).
- `registry/`: the published canon, plain files readable without the studio. `index.json` maps asset ids to revisions; `manifests/<revision>.json` and `blobs/<sha256>.png` are immutable and content-addressed. It starts empty; a partial canon is valid and the placeholder covers anything missing.

Check it with `bun run --cwd tools/content validate:assets`.
