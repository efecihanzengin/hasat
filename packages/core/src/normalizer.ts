import type { Segment } from "./types.js";

const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
  "&cent;": "¢",
  "&pound;": "£",
  "&yen;": "¥",
  "&euro;": "€",
  "&copy;": "©",
  "&reg;": "®",
};

function safeFromCodePoint(code: number): string | null {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
    return null;
  }
  // Surrogates (0xD800-0xDFFF) are invalid code points for String.fromCodePoint
  if (code >= 0xd800 && code <= 0xdfff) {
    return null;
  }
  try {
    return String.fromCodePoint(code);
  } catch {
    return null;
  }
}

/**
 * Pure TypeScript entity unescaper that handles named XML/HTML entities,
 * decimal numeric entities, and hex numeric entities without DOM dependencies.
 */
export function unescapeHtml(text: string): string {
  // First decode hex entities (e.g. &#x2F; or &#x1F600;)
  let decoded = text.replace(/&#x([0-9a-fA-F]+);/gi, (match, hex: string) => {
    const code = parseInt(hex, 16);
    const char = safeFromCodePoint(code);
    return char ?? match;
  });

  // Decode decimal entities (e.g. &#39; or &#65;)
  decoded = decoded.replace(/&#(\d+);/g, (match, dec: string) => {
    const code = parseInt(dec, 10);
    const char = safeFromCodePoint(code);
    return char ?? match;
  });

  // Decode named entities (e.g. &amp;, &quot;)
  decoded = decoded.replace(/&[a-zA-Z]+;/g, (match) => {
    return NAMED_ENTITIES[match] ?? match;
  });

  return decoded;
}

/**
 * Collapses all runs of whitespace (including newlines and tabs) to a single space.
 */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ");
}

/**
 * Unescapes HTML entities, collapses multi-space runs, and trims ends.
 */
export function normalizeText(text: string): string {
  return collapseWhitespace(unescapeHtml(text)).trim();
}

/**
 * Normalizes segment text and removes segments that are empty after normalization.
 */
export function normalizeSegments(segments: Segment[]): Segment[] {
  const result: Segment[] = [];

  for (const seg of segments) {
    const text = normalizeText(seg.text);
    if (text.length > 0) {
      result.push({
        start: seg.start,
        duration: seg.duration,
        text,
      });
    }
  }

  return result;
}
