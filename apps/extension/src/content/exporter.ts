import {
  buildTranscriptArchive,
  sanitizeFilename,
  type ExportFormat,
  type ExportManifest,
  type FormatOptions,
  type Transcript,
} from "@youtube-transcript/core";
import { formatTranscriptStorageKey } from "../background/storage.js";
import type { JobState } from "../background/types.js";

export type StorageReader = {
  get: (keys: string | string[]) => Promise<Record<string, unknown>>;
};

export type ExportJobZipOptions = {
  job: JobState;
  formats?: readonly ExportFormat[];
  formatOptions?: FormatOptions;
  channelOrPlaylist?: string;
  storageArea?: StorageReader;
  doc?: Document;
};

export type ExportJobZipResult = {
  filename: string;
  manifest: ExportManifest;
};

/**
 * Reads completed transcripts chunk-by-chunk from storage, packages them into a
 * ZIP archive with manifest.json using pure JS compression (fflate), and triggers
 * a browser download via an object URL before immediately revoking the URL.
 */
export async function exportJobZip(
  options: ExportJobZipOptions
): Promise<ExportJobZipResult> {
  const { job, formats, formatOptions, channelOrPlaylist, storageArea, doc } =
    options;

  if (!job) {
    throw new Error("No job provided for export");
  }

  const storage =
    storageArea ??
    (typeof chrome !== "undefined" && chrome.storage?.local
      ? chrome.storage.local
      : null);

  if (!storage) {
    throw new Error("Storage area is not available for export");
  }

  const targetFormats: readonly ExportFormat[] =
    formats && formats.length > 0
      ? formats
      : job.formats && job.formats.length > 0
        ? job.formats
        : job.format
          ? [job.format]
          : (["txt"] as const);

  const resolvedFormatOptions = formatOptions ?? job.formatOptions;
  const resolvedChannelTitle =
    channelOrPlaylist ?? job.channelOrPlaylist ?? "youtube-transcripts";

  // Stream/deflate transcripts item-by-item to avoid loading entire dataset into memory
  const archiveResult = await buildTranscriptArchive({
    items: job.items,
    getTranscript: async (videoId: string): Promise<Transcript | null> => {
      const key = formatTranscriptStorageKey(job.id, videoId);
      const stored = await storage.get(key);
      const transcript = stored[key] as Transcript | undefined;
      return transcript ?? null;
    },
    formats: targetFormats,
    formatOptions: resolvedFormatOptions,
    channelOrPlaylist: resolvedChannelTitle,
    includeManifest: true,
  });

  const zipBytes = archiveResult.zipData;
  const arrayBuffer =
    zipBytes.buffer instanceof ArrayBuffer
      ? zipBytes.buffer.slice(
          zipBytes.byteOffset,
          zipBytes.byteOffset + zipBytes.byteLength
        )
      : new ArrayBuffer(0);
  const blob = new Blob([arrayBuffer], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const sanitizedTitle = sanitizeFilename(resolvedChannelTitle);
  const filename = `${sanitizedTitle || "youtube-transcripts"}-export.zip`;

  const targetDoc = doc ?? (typeof document !== "undefined" ? document : null);

  if (targetDoc?.createElement && targetDoc.body?.appendChild) {
    const anchor = targetDoc.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    targetDoc.body.appendChild(anchor);
    anchor?.click?.();
    targetDoc.body.removeChild(anchor);
  }

  // Immediately release memory allocated for the blob URL
  URL.revokeObjectURL(url);

  return {
    filename,
    manifest: archiveResult.manifest,
  };
}
