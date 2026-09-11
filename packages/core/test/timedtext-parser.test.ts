import { describe, it, expect } from "vitest";
import timedtextNonLatinAsr from "../fixtures/timedtext-non-latin-asr.json";
import { parseTimedTextJson } from "../src/timedtext-parser.js";

describe("timedtext-parser", () => {
  describe("real fixture: timedtext-non-latin-asr.json", () => {
    it("parses events into clean segments with entity unescaping and empty segment pruning", () => {
      const result = parseTimedTextJson(timedtextNonLatinAsr);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }

      const segments = result.value;
      expect(segments.length).toBeGreaterThan(0);

      // Event 0 had no segs; verify no segment starts at 0 with empty text
      const zeroSeg = segments.find((s) => s.start === 0);
      expect(zeroSeg).toBeUndefined();

      // Segment 0: Japanese text
      const japaneseSeg = segments[0];
      expect(japaneseSeg).toEqual({
        start: 1.2,
        duration: 3.8,
        text: "こんにちは、皆さん！",
      });

      // Segment 1: Traditional Chinese text with entity unescaping (&amp;, &#39;) and space collapsing
      const chineseSeg = segments[1];
      expect(chineseSeg).toEqual({
        start: 5.0,
        duration: 4.2,
        text: "歡迎來到 YouTube & 探索頻道'測試'",
      });

      // Segment 2: Cyrillic text (Ukrainian)
      const cyrillicSeg = segments[2];
      expect(cyrillicSeg).toEqual({
        start: 9.2,
        duration: 4.6,
        text: "Сьогодні ми розглядаємо нові технології",
      });

      // Segment 3: Arabic text with unescaped &quot; entities
      const arabicSeg = segments[3];
      expect(arabicSeg).toEqual({
        start: 13.8,
        duration: 5.1,
        text: 'مرحبا بكم في هذا الفيديو "التعليمي"',
      });

      // Segment 4: English text with millisecond float conversion (2139ms -> 2.139s)
      const englishSeg = segments[4];
      expect(englishSeg).toEqual({
        start: 2.139,
        duration: 6.211,
        text: "really pioneers for all of us you know",
      });

      // Verify no empty segments exist anywhere in the output
      for (const seg of segments) {
        expect(seg.text.length).toBeGreaterThan(0);
        expect(seg.text.trim()).toBe(seg.text);
      }
    });

    it("parses raw JSON string input seamlessly", () => {
      const jsonString = JSON.stringify(timedtextNonLatinAsr);
      const result = parseTimedTextJson(jsonString);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeGreaterThan(0);
      }
    });
  });

  describe("error handling", () => {
    it("returns PARSE_ERROR for malformed JSON string", () => {
      const result = parseTimedTextJson("{ invalid json ");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARSE_ERROR");
      }
    });

    it("returns PARSE_ERROR when events array is missing", () => {
      const result = parseTimedTextJson({ wireMagic: "pb3" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARSE_ERROR");
      }
    });
  });
});
