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
  });
});
