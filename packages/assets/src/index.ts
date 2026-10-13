// Asset foundation: deterministic placeholder art, pure registry lookup, PNG
// and hash helpers. The filesystem registry (publish, load) is the separate
// "@panthea/assets/registry" subpath, so importing this root never pulls in
// node:fs. The placeholder and hash modules use node:zlib and node:crypto, so
// this root is for Node and Bun. The webview imports the browser-safe
// "@panthea/assets/browser" subpath instead: the same lookup and placeholder
// pixels, with no node: module in its import graph.

export * from "./conformance";
export * from "./hash";
export * from "./palette";
export * from "./placeholder";
export { type PngHeader, readPngHeader } from "./png";
export * from "./resolve";
