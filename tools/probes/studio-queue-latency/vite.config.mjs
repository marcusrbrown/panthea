// Run from apps/studio so react, react-dom and vite resolve from its
// node_modules (this probe has none of its own):
//   cd apps/studio && bunx vite build --config ../../tools/probes/studio-queue-latency/vite.config.mjs
// A production build, so React runs without its development checks.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const studio = join(here, "..", "..", "..", "apps", "studio");

export default {
  root: here,
  base: "./",
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: [
      // The profiling build of React DOM, so <Profiler> reports in a production build.
      {
        find: "react-dom/client",
        replacement: join(studio, "node_modules", "react-dom", "profiling.js"),
      },
      {
        find: "react-dom",
        replacement: join(studio, "node_modules", "react-dom"),
      },
      { find: "react", replacement: join(studio, "node_modules", "react") },
    ],
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: process.env.OUT_DIR ?? join(here, "dist"),
    emptyOutDir: true,
    target: "es2022",
  },
  server: { fs: { strict: false } },
};
