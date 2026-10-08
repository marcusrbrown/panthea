import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = "127.0.0.1";

export default defineConfig({
  plugins: [react()],

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
