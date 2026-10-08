import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { assetBridgePlugin } from "./src/source/dev-bridge";

const host = "127.0.0.1";

const studioRoot = process.env.PANTHEA_STUDIO_ROOT;
const registryRoot = process.env.PANTHEA_REGISTRY_ROOT;

export default defineConfig({
  plugins: [
    react(),
    assetBridgePlugin({
      ...(studioRoot ? { studioRoot } : {}),
      ...(registryRoot ? { registryRoot } : {}),
    }),
  ],

  // Only expose `VITE_*`-prefixed env vars to client code (Vite's default,
  // stated explicitly).
  envPrefix: "VITE_",

  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    host,
  },
  preview: {
    port: 1431,
    strictPort: true,
    host,
  },
});
