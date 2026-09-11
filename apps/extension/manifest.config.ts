import { defineManifest } from "@crxjs/vite-plugin";

export const manifestConfig = {
  manifest_version: 3 as const,
  name: "YouTube Bulk Transcript Extractor",
  version: "0.0.1",
  description:
    "Bulk extract transcripts from YouTube channels and playlists as TXT, JSON, CSV, SRT, VTT, or Markdown.",
  action: {},
  permissions: ["storage"],
  host_permissions: ["https://www.youtube.com/*", "https://*.googlevideo.com/*"],
  background: {
    service_worker: "src/background/index.ts",
    type: "module" as const,
  },
  content_scripts: [
    {
      matches: ["https://www.youtube.com/*"],
      js: ["src/content/index.ts"],
    },
    {
      matches: ["https://www.youtube.com/*"],
      js: ["src/content/main-world.ts"],
      world: "MAIN" as const,
      run_at: "document_start" as const,
    },
  ],
};

export default defineManifest(manifestConfig);
