import { describe, it, expect } from "vitest";
import {
  unescapeHtml,
  collapseWhitespace,
  normalizeText,
  normalizeSegments,
} from "../src/normalizer.js";
import type { Segment } from "../src/types.js";

describe("normalizer", () => {
  describe("unescapeHtml", () => {
    it("unescapes standard named XML and HTML entities", () => {
      expect(unescapeHtml("Rock &amp; Roll")).toBe("Rock & Roll");
      expect(unescapeHtml("&lt;div&gt;&quot;Hello&quot;&lt;/div&gt;")).toBe(
        '<div>"Hello"</div>'
      );
      expect(unescapeHtml("It&apos;s working")).toBe("It's working");
      expect(unescapeHtml("Space&nbsp;here")).toBe("Space here");
      expect(unescapeHtml("&copy; 2026 &euro; 100")).toBe("© 2026 € 100");
    });

    it("unescapes decimal numeric entities", () => {
      expect(unescapeHtml("It&#39;s sunny")).toBe("It's sunny");
      expect(unescapeHtml("Letter &#65; and &#66;")).toBe("Letter A and B");
      expect(unescapeHtml("Unicode &#169;")).toBe("Unicode ©");
    });

    it("unescapes hex numeric entities including extended Unicode code points", () => {
      expect(unescapeHtml("Letter &#x41;")).toBe("Letter A");
      expect(unescapeHtml("Emoji: &#x1F600;")).toBe("Emoji: 😀");
      expect(unescapeHtml("Slash: &#x2F;")).toBe("Slash: /");
    });

    it("safely handles invalid, out-of-range, and surrogate numeric entities without crashing", () => {
      expect(unescapeHtml("&#x999999999;")).toBe("&#x999999999;");
      expect(unescapeHtml("&#xd800;")).toBe("&#xd800;");
      expect(unescapeHtml("Plain text with &unknown; entity")).toBe(
        "Plain text with &unknown; entity"
      );
    });
  });

  describe("collapseWhitespace", () => {
    it("collapses multiple spaces, tabs, and newlines into a single space", () => {
      expect(collapseWhitespace("Hello    world")).toBe("Hello world");
      expect(collapseWhitespace("Line 1\n\nLine 2\t\tLine 3\r\nLine 4")).toBe(
        "Line 1 Line 2 Line 3 Line 4"
      );
    });
  });

  describe("normalizeText", () => {
    it("combines unescaping, collapsing, and trimming", () => {
      const raw =
        "   Hello &amp;  welcome&#39;s \n\n to &quot;YouTube&quot;!   ";
      expect(normalizeText(raw)).toBe('Hello & welcome\'s to "YouTube"!');
    });

    it("returns empty string for whitespace-only input", () => {
      expect(normalizeText("   \n\t  \r\n  ")).toBe("");
    });
  });

  describe("normalizeSegments", () => {
    it("normalizes text and drops empty segments", () => {
      const segments: Segment[] = [
        { start: 0, duration: 2, text: "   First &amp; segment   " },
        { start: 2, duration: 1, text: "\n\t  " },
        { start: 3, duration: 2.5, text: "Second segment" },
        { start: 5.5, duration: 0.5, text: "   " },
      ];

      const normalized = normalizeSegments(segments);
      expect(normalized).toEqual([
        { start: 0, duration: 2, text: "First & segment" },
        { start: 3, duration: 2.5, text: "Second segment" },
      ]);
    });
  });
});
