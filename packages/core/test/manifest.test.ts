import { describe, expect, it } from "vitest";
import { createManifest, generateManifestJson } from "../src/manifest.js";
import {
  createExtractionError,
  createJobItem,
  type JobItem,
} from "../src/types.js";

describe("manifest generator", () => {
  it("generates an empty manifest when no items are provided", () => {
    const manifest = createManifest([]);

    expect(manifest.version).toBe("1.0");
    expect(manifest.summary).toEqual({
      total: 0,
      exported: 0,
      skipped: 0,
      failed: 0,
      cached: 0,
    });
    expect(manifest.items).toEqual([]);
    expect(typeof manifest.generatedAt).toBe("string");
  });

  it("accurately computes total, exported, skipped, and failed counts", () => {
    const items: JobItem[] = [
      {
        videoId: "v1",
        title: "Video 1",
        status: "done",
      },
      {
        videoId: "v2",
        title: "Video 2",
        status: "done",
      },
      {
        videoId: "v3",
        title: "Live Stream Video",
        status: "skipped",
        error: createExtractionError("LIVE_STREAM"),
      },
      {
        videoId: "v4",
        title: "No Captions Video",
        status: "failed",
        error: createExtractionError("NO_CAPTIONS"),
      },
      {
        videoId: "v5",
        title: "Rate Limited Video",
        status: "failed",
        error: createExtractionError("RATE_LIMITED"),
      },
      {
        videoId: "v6",
        title: "Interrupted Video",
        status: "pending",
      },
    ];

    const manifest = createManifest(items, {
      format: "txt",
      channelOrPlaylist: "Test Channel",
    });

    expect(manifest.summary).toEqual({
      total: 6,
      exported: 2,
      skipped: 1,
      failed: 3, // v4, v5, and unfinished v6
      cached: 0,
    });

    expect(manifest.format).toBe("txt");
    expect(manifest.channelOrPlaylist).toBe("Test Channel");

    // Check item 1 (done)
    expect(manifest.items[0]).toEqual({
      index: 1,
      videoId: "v1",
      title: "Video 1",
      status: "done",
      filename: "1-Video-1-v1.txt",
    });

    // Check item 3 (skipped with error)
    expect(manifest.items[2]).toEqual({
      index: 3,
      videoId: "v3",
      title: "Live Stream Video",
      status: "skipped",
      error: {
        code: "LIVE_STREAM",
        message: "Live stream — skipped",
      },
    });

    // Check item 4 (failed with NO_CAPTIONS)
    expect(manifest.items[3]).toEqual({
      index: 4,
      videoId: "v4",
      title: "No Captions Video",
      status: "failed",
      error: {
        code: "NO_CAPTIONS",
        message: "No transcript available",
      },
    });
  });

  it("preserves custom filenames map if provided", () => {
    const items: JobItem[] = [
      {
        videoId: "vidA",
        title: "Title A",
        status: "done",
      },
    ];

    const filenames = new Map<string, string>();
    filenames.set("vidA", "custom-file-name.json");

    const manifest = createManifest(items, { filenames });
    expect(manifest.items[0]?.filename).toBe("custom-file-name.json");
  });

  it("handles custom generatedAt timestamp", () => {
    const customTime = "2026-01-01T00:00:00.000Z";
    const manifest = createManifest([], { generatedAt: customTime });
    expect(manifest.generatedAt).toBe(customTime);
  });

  it("serializes to valid formatted JSON string", () => {
    const item = createJobItem("v1", "Sample Video");
    item.status = "done";

    const manifest = createManifest([item], { format: "csv" });
    const json = generateManifestJson(manifest);

    expect(typeof json).toBe("string");
    const parsed = JSON.parse(json) as typeof manifest;
    expect(parsed.version).toBe("1.0");
    expect(parsed.summary.total).toBe(1);
    expect(parsed.summary.exported).toBe(1);
    expect(parsed.items[0]?.filename).toBe("1-Sample-Video-v1.csv");
  });

  it("accurately tracks and reports items loaded from transcript cache", () => {
    const items: JobItem[] = [
      {
        videoId: "cached1",
        title: "Cached Video 1",
        status: "done",
        fromCache: true,
      },
      {
        videoId: "fresh1",
        title: "Fresh Fetched Video",
        status: "done",
        fromCache: false,
      },
      {
        videoId: "cached2",
        title: "Cached Video 2",
        status: "done",
        fromCache: true,
      },
    ];

    const manifest = createManifest(items, { format: "json" });

    expect(manifest.summary).toEqual({
      total: 3,
      exported: 3,
      skipped: 0,
      failed: 0,
      cached: 2,
    });

    expect(manifest.items[0]?.fromCache).toBe(true);
    expect(manifest.items[1]?.fromCache).toBeUndefined();
    expect(manifest.items[2]?.fromCache).toBe(true);
  });
});
