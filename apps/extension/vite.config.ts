import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config.js";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    crx({
      manifest,
      contentScripts: {
        standaloneFiles: ["src/content/index.ts", "src/content/main-world.ts"],
      },
    }),
  ],
  define: {
    "process.env.NODE_ENV": JSON.stringify(mode),
    "process.env": {},
  },
  build: {
    emptyOutDir: true,
    outDir: "dist",
  },
}));
