import { describe, it, expect } from "vitest";
import { manifestConfig } from "../manifest.config.js";

describe("manifest configuration", () => {
  it("conforms to Manifest V3 specification", () => {
    expect(manifestConfig.manifest_version).toBe(3);
    expect(manifestConfig.name).toBe("YouTube Bulk Transcript Extractor");
    expect(manifestConfig.permissions).toContain("storage");
    expect(manifestConfig.host_permissions).toContain(
      "https://www.youtube.com/*"
    );
    expect(manifestConfig.action).toBeDefined();
    expect(manifestConfig.background?.service_worker).toBe(
      "src/background/index.ts"
    );

    const contentScripts = manifestConfig.content_scripts;
    expect(contentScripts).toBeDefined();
    expect(contentScripts.length).toBe(2);

    const isolatedScript = contentScripts.find((cs) =>
      cs.js?.includes("src/content/index.ts")
    );
    expect(isolatedScript).toBeDefined();
    expect(isolatedScript?.matches).toContain("https://www.youtube.com/*");

    const mainWorldScript = contentScripts.find((cs) =>
      cs.js?.includes("src/content/main-world.ts")
    );
    expect(mainWorldScript).toBeDefined();
    expect(mainWorldScript?.matches).toContain("https://www.youtube.com/*");
    expect(mainWorldScript?.world).toBe("MAIN");
    expect(mainWorldScript?.run_at).toBe("document_start");
  });
});
