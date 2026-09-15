import type { ExtractionResult, Segment } from "./types.js";
import { createExtractionError } from "./types.js";
import { normalizeText } from "./normalizer.js";

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

/**
 * Parses raw timedtext json3 format into a clean, normalized Segment array.
 * Drops events with no segs and drops segments that become empty after normalization.
 */
export function parseTimedTextJson(raw: unknown): ExtractionResult<Segment[]> {
  let parsed: unknown = raw;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("<")) {
      return parseTimedTextXml(trimmed);
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return {
        ok: false,
        error: createExtractionError(
          "PARSE_ERROR",
          "Malformed timedtext JSON string"
        ),
      };
    }
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.events)) {
    return {
      ok: false,
      error: createExtractionError(
        "PARSE_ERROR",
        "Timedtext response missing events array"
      ),
    };
  }

  const segments: Segment[] = [];

  for (const event of parsed.events) {
    if (!isRecord(event)) {
      continue;
    }

    // Drop events with no segs array
    if (!Array.isArray(event.segs) || event.segs.length === 0) {
      continue;
    }

    // Concatenate segs[].utf8
    const rawText = event.segs
      .map((seg) => {
        if (isRecord(seg) && typeof seg.utf8 === "string") {
          return seg.utf8;
        }
        return "";
      })
      .join("");

    // Normalize: unescape HTML entities, collapse multi-space runs, trim
    const normalizedText = normalizeText(rawText);

    // Drop segments that are empty after normalization
    if (normalizedText.length === 0) {
      continue;
    }

    const startMs =
      typeof event.tStartMs === "number" && !Number.isNaN(event.tStartMs)
        ? event.tStartMs
        : 0;
    const durationMs =
      typeof event.dDurationMs === "number" && !Number.isNaN(event.dDurationMs)
        ? event.dDurationMs
        : 0;

    // Convert milliseconds to seconds (float), rounded to 3 decimal places
    const start = Math.round(startMs) / 1000;
    const duration = Math.round(durationMs) / 1000;

    segments.push({
      start,
      duration,
      text: normalizedText,
    });
  }

  return {
    ok: true,
    value: segments,
  };
}

/**
 * Parses XML or SRV3 timedtext format.
 */
export function parseTimedTextXml(xmlStr: string): ExtractionResult<Segment[]> {
  const segments: Segment[] = [];
  
  // Match <text ...>content</text>
  const textTagRegex = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
  let textMatch: RegExpExecArray | null;
  let foundStandard = false;

  while ((textMatch = textTagRegex.exec(xmlStr)) !== null) {
    foundStandard = true;
    const attrs = textMatch[1] || "";
    const rawContent = textMatch[2] || "";

    const startAttr = attrs.match(/\bstart=["']([^"']+)["']/i);
    const durAttr = attrs.match(/\bdur=["']([^"']+)["']/i);

    const startStr = startAttr?.[1] || "";
    const durStr = durAttr?.[1] || "0";

    const start = parseFloat(startStr);
    const duration = parseFloat(durStr);

    if (isNaN(start) || isNaN(duration)) continue;

    // Remove inner tags like <font> and normalize
    const withoutTags = rawContent.replace(/<[^>]+>/g, "");
    const normalizedText = normalizeText(withoutTags)
      .replace(/<[^>]+>/g, "")
      .trim();

    if (normalizedText.length > 0) {
      segments.push({ start, duration, text: normalizedText });
    }
  }

  if (foundStandard) {
    return { ok: true, value: segments };
  }

  // Match <p ...>content</p> (SRV3 format)
  const pTagRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let pMatch: RegExpExecArray | null;
  let foundSrv3 = false;

  while ((pMatch = pTagRegex.exec(xmlStr)) !== null) {
    foundSrv3 = true;
    const attrs = pMatch[1] || "";
    const rawContent = pMatch[2] || "";

    const tAttr = attrs.match(/\bt=["']([^"']+)["']/i);
    const dAttr = attrs.match(/\bd=["']([^"']+)["']/i);

    const startMsStr = tAttr?.[1] || "";
    const durMsStr = dAttr?.[1] || "0";

    const startMs = parseInt(startMsStr, 10);
    const durationMs = parseInt(durMsStr, 10);

    if (isNaN(startMs) || isNaN(durationMs)) continue;

    const start = Math.round(startMs) / 1000;
    const duration = Math.round(durationMs) / 1000;

    const withoutTags = rawContent.replace(/<[^>]+>/g, "");
    const normalizedText = normalizeText(withoutTags)
      .replace(/<[^>]+>/g, "")
      .trim();

    if (normalizedText.length > 0) {
      segments.push({ start, duration, text: normalizedText });
    }
  }

  if (foundSrv3) {
    return { ok: true, value: segments };
  }

  return {
    ok: false,
    error: createExtractionError(
      "PARSE_ERROR",
      "Failed to parse timedtext XML response"
    ),
  };
}
