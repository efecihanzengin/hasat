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
    try {
      parsed = JSON.parse(raw);
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
