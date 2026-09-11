import type {
  ExportFormat,
  ExportManifest,
  JobItem,
  ManifestItem,
  ManifestSummary,
} from "./types.js";
import { formatArchiveFileName } from "./filename.js";

export type CreateManifestOptions = {
  format?: ExportFormat;
  channelOrPlaylist?: string;
  generatedAt?: string;
  filenames?: Map<string, string> | Record<string, string>;
};

/**
 * Creates a structured export manifest describing all items in a job,
 * their final statuses, error codes, and exported filenames.
 */
export function createManifest(
  items: JobItem[],
  options?: CreateManifestOptions
): ExportManifest {
  let exported = 0;
  let skipped = 0;
  let failed = 0;

  const manifestItems: ManifestItem[] = items.map((item, index) => {
    const itemIndex = index + 1;

    if (item.status === "done") {
      exported++;
    } else if (item.status === "skipped") {
      skipped++;
    } else {
      // "failed", "pending", or "fetching" (if cancelled/interrupted)
      failed++;
    }

    let filename: string | undefined;
    if (options?.filenames) {
      if (options.filenames instanceof Map) {
        filename = options.filenames.get(item.videoId);
      } else {
        filename = options.filenames[item.videoId];
      }
    } else if (item.status === "done" && options?.format) {
      filename = formatArchiveFileName({
        index: itemIndex,
        title: item.title,
        videoId: item.videoId,
        format: options.format,
      });
    }

    const manifestItem: ManifestItem = {
      index: itemIndex,
      videoId: item.videoId,
      title: item.title,
      status: item.status,
    };

    if (filename !== undefined) {
      manifestItem.filename = filename;
    }

    if (item.error) {
      manifestItem.error = {
        code: item.error.code,
        message: item.error.message,
      };
    }

    return manifestItem;
  });

  const summary: ManifestSummary = {
    total: items.length,
    exported,
    skipped,
    failed,
  };

  const manifest: ExportManifest = {
    version: "1.0",
    generatedAt: options?.generatedAt ?? new Date().toISOString(),
    summary,
    items: manifestItems,
  };

  if (options?.format !== undefined) {
    manifest.format = options.format;
  }

  if (options?.channelOrPlaylist !== undefined) {
    manifest.channelOrPlaylist = options.channelOrPlaylist;
  }

  return manifest;
}

/**
 * Serializes an ExportManifest to pretty-printed JSON (2-space indent).
 */
export function generateManifestJson(manifest: ExportManifest): string {
  return JSON.stringify(manifest, null, 2);
}
