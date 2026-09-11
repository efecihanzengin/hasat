import type { ExportFormat, FormatArchiveFileNameOptions } from "./types.js";

/**
 * Strips characters illegal on Windows (< > : " / \ | ? *) as well as ASCII control characters.
 */
export function stripIllegalChars(str: string): string {
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    const char = str[i];
    if (
      code <= 0x1f ||
      code === 0x7f ||
      char === "<" ||
      char === ">" ||
      char === ":" ||
      char === '"' ||
      char === "/" ||
      char === "\\" ||
      char === "|" ||
      char === "?" ||
      char === "*"
    ) {
      continue;
    }
    result += char;
  }
  return result;
}

const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

/**
 * Maps an ExportFormat enum value to its canonical file extension (without leading dot).
 */
export function getFormatExtension(format: ExportFormat): string {
  switch (format) {
    case "txt":
      return "txt";
    case "json":
      return "json";
    case "csv":
      return "csv";
    case "srt":
      return "srt";
    case "vtt":
      return "vtt";
    case "markdown":
      return "md";
  }
}

/**
 * Checks if a filename base matches any Windows reserved device name (CON, PRN, AUX, etc.).
 */
export function isWindowsReservedName(name: string): boolean {
  return WINDOWS_RESERVED_NAMES.has(name.toUpperCase());
}

/**
 * Sanitizes a video title for use in filenames:
 * - Strips illegal Windows/POSIX characters (< > : " / \ | ? * and ASCII control characters)
 * - Collapses consecutive whitespace to a single hyphen (-)
 * - Collapses consecutive hyphens to a single hyphen (-)
 * - Trims leading and trailing hyphens and dots
 * - Falls back to "untitled" if empty
 * - Truncates to maxLength (default 100) while avoiding trailing hyphens
 * - Escapes Windows reserved names (e.g. CON -> CON_)
 */
export function sanitizeTitle(title: string, maxLength = 100): string {
  if (typeof title !== "string") {
    return "untitled";
  }

  let sanitized = stripIllegalChars(title)
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  if (sanitized.length === 0) {
    return "untitled";
  }

  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength).replace(/[-.]+$/g, "");
    if (sanitized.length === 0) {
      return "untitled";
    }
  }

  if (isWindowsReservedName(sanitized)) {
    sanitized = `${sanitized}_`;
  }

  return sanitized;
}

/**
 * Sanitizes an entire filename:
 * - Strips illegal characters (< > : " / \ | ? * and control chars)
 * - Collapses whitespace sequences to hyphens (-)
 * - Preserves extension while truncating basename so total length <= maxLength (default 100)
 * - Protects against Windows reserved device names
 */
export function sanitizeFilename(filename: string, maxLength = 100): string {
  if (typeof filename !== "string" || filename.length === 0) {
    return "untitled";
  }

  // Extract extension if present
  const lastDotIndex = filename.lastIndexOf(".");
  let rawBase: string;
  let rawExt: string;

  if (lastDotIndex > 0 && lastDotIndex < filename.length - 1) {
    rawBase = filename.slice(0, lastDotIndex);
    rawExt = filename.slice(lastDotIndex); // includes dot
  } else if (lastDotIndex === 0 && filename.length > 1) {
    // Dotfile like .txt
    rawBase = "";
    rawExt = filename;
  } else {
    rawBase = filename;
    rawExt = "";
  }

  // Sanitize extension
  const cleanExt = stripIllegalChars(rawExt).replace(/\s+/g, "");

  // Sanitize basename
  let cleanBase = stripIllegalChars(rawBase)
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  if (cleanBase.length === 0) {
    cleanBase = "untitled";
  }

  if (isWindowsReservedName(cleanBase)) {
    cleanBase = `${cleanBase}_`;
  }

  // Truncate base to ensure total length <= maxLength while preserving extension
  const extLength = cleanExt.length;
  const maxBaseLength = Math.max(1, maxLength - extLength);

  if (cleanBase.length > maxBaseLength) {
    cleanBase = cleanBase.slice(0, maxBaseLength).replace(/[-.]+$/g, "");
    if (cleanBase.length === 0) {
      cleanBase = "untitled".slice(0, maxBaseLength) || "u";
    }
  }

  return `${cleanBase}${cleanExt}`;
}

/**
 * Formats the archive filename according to SPEC §6.1:
 * {index}-{sanitized-title}-{videoId}.{ext}
 */
export function formatArchiveFileName(
  optionsOrIndex: FormatArchiveFileNameOptions | number,
  titleArg?: string,
  videoIdArg?: string,
  formatOrExtArg?: ExportFormat | string
): string {
  let index: number;
  let title: string;
  let videoId: string;
  let ext: string;
  let padWidth: number | undefined;

  if (typeof optionsOrIndex === "object" && optionsOrIndex !== null) {
    index = optionsOrIndex.index;
    title = optionsOrIndex.title;
    videoId = optionsOrIndex.videoId;
    padWidth = optionsOrIndex.padWidth;

    if (optionsOrIndex.ext) {
      ext = optionsOrIndex.ext.replace(/^\./, "");
    } else if (optionsOrIndex.format) {
      ext = getFormatExtension(optionsOrIndex.format);
    } else {
      ext = "txt";
    }
  } else {
    index = optionsOrIndex;
    title = titleArg ?? "";
    videoId = videoIdArg ?? "";

    if (
      formatOrExtArg === "txt" ||
      formatOrExtArg === "json" ||
      formatOrExtArg === "csv" ||
      formatOrExtArg === "srt" ||
      formatOrExtArg === "vtt" ||
      formatOrExtArg === "markdown"
    ) {
      ext = getFormatExtension(formatOrExtArg);
    } else if (
      typeof formatOrExtArg === "string" &&
      formatOrExtArg.length > 0
    ) {
      ext = formatOrExtArg.replace(/^\./, "");
    } else {
      ext = "txt";
    }
  }

  const formattedIndex =
    typeof padWidth === "number" && padWidth > 0
      ? String(index).padStart(padWidth, "0")
      : String(index);

  const cleanVideoId = stripIllegalChars(videoId).replace(/\s+/g, "");
  const safeVideoId = cleanVideoId.length > 0 ? cleanVideoId : "unknown";
  const safeExt = ext.length > 0 ? ext : "txt";

  const prefix = `${formattedIndex}-`;
  const suffix = `-${safeVideoId}.${safeExt}`;
  const maxTitleLength = Math.max(1, 100 - prefix.length - suffix.length);

  const cleanTitle = sanitizeTitle(title, maxTitleLength);
  let candidate = `${prefix}${cleanTitle}${suffix}`;

  if (candidate.length > 100) {
    const extWithDot = `.${safeExt}`;
    const maxBaseLen = Math.max(1, 100 - extWithDot.length);
    const base = candidate.slice(0, candidate.length - extWithDot.length);
    const truncatedBase = base.slice(0, maxBaseLen).replace(/[-.]+$/g, "");
    candidate = `${truncatedBase}${extWithDot}`;
  }

  return candidate;
}
