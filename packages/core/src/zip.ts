import { strToU8, strFromU8, unzipSync, Zip, ZipDeflate } from "fflate";
import type {
  BuildTranscriptArchiveParams,
  BuildTranscriptArchiveResult,
  ExportManifest,
  JobItem,
  ZipFileInput,
} from "./types.js";
import { formatArchiveFileName } from "./filename.js";
import { formatTranscript } from "./formatters.js";
import { createManifest, generateManifestJson } from "./manifest.js";

export { strToU8, strFromU8, unzipSync };

export type ZipArchiveOptions = {
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
};

/**
 * Pure JS, memory-efficient streaming ZIP archive builder powered by fflate.
 * Files are compressed and streamed chunk-by-chunk on demand, avoiding buffering
 * all uncompressed payloads simultaneously in a single large object.
 */
export class ZipArchive {
  private chunks: Uint8Array[] = [];
  private zip: Zip;
  private isFinalized = false;
  private defaultLevel: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  private endPromise: Promise<Uint8Array>;
  private resolveEnd: (data: Uint8Array) => void = () => {};
  private rejectEnd: (err: Error) => void = () => {};

  constructor(options?: ZipArchiveOptions) {
    this.defaultLevel = options?.level ?? 6;

    this.endPromise = new Promise<Uint8Array>((resolve, reject) => {
      this.resolveEnd = resolve;
      this.rejectEnd = reject;
    });

    this.zip = new Zip((err, chunk, isLast) => {
      if (err) {
        this.rejectEnd(err);
        return;
      }

      if (chunk && chunk.length > 0) {
        this.chunks.push(chunk);
      }

      if (isLast) {
        const totalLength = this.chunks.reduce((acc, c) => acc + c.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const c of this.chunks) {
          result.set(c, offset);
          offset += c.length;
        }
        this.resolveEnd(result);
      }
    });
  }

  /**
   * Adds a file to the ZIP archive and immediately deflates it into the output stream.
   */
  addFile(
    filename: string,
    content: string | Uint8Array,
    options?: { level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }
  ): void {
    if (this.isFinalized) {
      throw new Error("Cannot add files to a finalized ZipArchive");
    }

    const data = typeof content === "string" ? strToU8(content) : content;
    const file = new ZipDeflate(filename, {
      level: options?.level ?? this.defaultLevel,
    });

    this.zip.add(file);
    file.push(data, true);
  }

  /**
   * Finalizes the ZIP archive (writes central directory records) and returns the full Uint8Array.
   */
  async finalize(): Promise<Uint8Array> {
    if (this.isFinalized) {
      return this.endPromise;
    }

    this.isFinalized = true;
    this.zip.end();
    return this.endPromise;
  }
}

/**
 * Creates an in-memory ZIP package from an array or iterable / async-iterable of files.
 */
export async function createZipPackage(
  files: ZipFileInput[] | Iterable<ZipFileInput> | AsyncIterable<ZipFileInput>,
  options?: ZipArchiveOptions
): Promise<Uint8Array> {
  const archive = new ZipArchive(options);

  if (Symbol.asyncIterator in files) {
    for await (const file of files as AsyncIterable<ZipFileInput>) {
      archive.addFile(file.filename, file.content);
    }
  } else {
    for (const file of files as Iterable<ZipFileInput>) {
      archive.addFile(file.filename, file.content);
    }
  }

  return archive.finalize();
}

/**
 * High-level helper that packages completed transcripts into a single .zip archive,
 * generates and includes `manifest.json`, and names files according to SPEC §6.1:
 * {index}-{sanitized-title}-{videoId}.{ext}
 */
export async function buildTranscriptArchive(
  params: BuildTranscriptArchiveParams
): Promise<BuildTranscriptArchiveResult> {
  const {
    items,
    getTranscript,
    format,
    formatOptions,
    channelOrPlaylist,
    includeManifest = true,
  } = params;

  const archive = new ZipArchive();
  const filenamesMap = new Map<string, string>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i] as JobItem;
    const itemIndex = i + 1;

    if (item.status === "done") {
      const transcript = await getTranscript(item.videoId);
      if (transcript) {
        const filename = formatArchiveFileName({
          index: itemIndex,
          title: item.title,
          videoId: item.videoId,
          format,
        });

        const formattedContent = formatTranscript(
          transcript,
          format,
          formatOptions
        );

        archive.addFile(filename, formattedContent);
        filenamesMap.set(item.videoId, filename);
      }
    }
  }

  const manifest: ExportManifest = createManifest(items, {
    format,
    channelOrPlaylist,
    filenames: filenamesMap,
  });

  if (includeManifest) {
    const manifestJson = generateManifestJson(manifest);
    archive.addFile("manifest.json", manifestJson);
  }

  const zipData = await archive.finalize();

  return {
    zipData,
    manifest,
  };
}
