import { describe, it, expect } from "vitest";
import timedtextNonLatinAsr from "../fixtures/timedtext-non-latin-asr.json";
import { parseTimedTextJson, parseTimedTextXml } from "../src/timedtext-parser.js";

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

  describe("parseTimedTextXml", () => {
    it("parses standard XML format with text tags and entity unescaping", () => {
      const xml = `<?xml version="1.0" encoding="utf-8" ?>
<timedtext format="3">
  <body>
    <text start="1.25" dur="3.5">Hello &amp; welcome to &lt;b&gt;YouTube&lt;/b&gt;</text>
    <text start="5.0" dur="2.1">Second segment here&#39;s more</text>
  </body>
</timedtext>`;
      const result = parseTimedTextXml(xml);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([
          { start: 1.25, duration: 3.5, text: "Hello & welcome to YouTube" },
          { start: 5.0, duration: 2.1, text: "Second segment here's more" },
        ]);
      }
    });

    it("parses SRV3 XML format with p tags and millisecond offsets", () => {
      const srv3 = `<timedtext format="3">
  <body>
    <p t="1500" d="3000"><s>First</s> <s>SRV3</s> <s>sentence</s></p>
    <p t="4800" d="2200"><s>Second</s> <s>part</s></p>
  </body>
</timedtext>`;
      const result = parseTimedTextXml(srv3);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([
          { start: 1.5, duration: 3.0, text: "First SRV3 sentence" },
          { start: 4.8, duration: 2.2, text: "Second part" },
        ]);
      }
    });

    it("parses XML format with inverted attribute order, single quotes, extra attributes, and multiline text", () => {
      const xml = `<transcript>
  <text id="0" dur='2.4' start='0.5'>
    Line 1
    Line 2 &amp; more
  </text>
  <text dur="1.8" start="3.2">Followup</text>
</transcript>`;
      const result = parseTimedTextXml(xml);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([
          { start: 0.5, duration: 2.4, text: "Line 1 Line 2 & more" },
          { start: 3.2, duration: 1.8, text: "Followup" },
        ]);
      }
    });

    it("parses SRV3 XML format with inverted attribute order", () => {
      const srv3 = `<timedtext format="3">
  <body>
    <p d="2000" t="1000"><s>Inverted</s> <s>attributes</s></p>
  </body>
</timedtext>`;
      const result = parseTimedTextXml(srv3);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([
          { start: 1.0, duration: 2.0, text: "Inverted attributes" },
        ]);
      }
    });

    it("returns PARSE_ERROR for invalid or empty XML without text/p tags", () => {
      const result = parseTimedTextXml("<timedtext></timedtext>");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARSE_ERROR");
      }
    });
  });
});
