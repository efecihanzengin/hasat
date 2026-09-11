import { describe, expect, it } from "vitest";
import {
  formatArchiveFileName,
  getFormatExtension,
  isWindowsReservedName,
  sanitizeFilename,
  sanitizeTitle,
} from "../src/filename.js";

describe("filename utilities", () => {
  describe("getFormatExtension", () => {
    it("maps all supported ExportFormat values to file extensions", () => {
      expect(getFormatExtension("txt")).toBe("txt");
      expect(getFormatExtension("json")).toBe("json");
      expect(getFormatExtension("csv")).toBe("csv");
      expect(getFormatExtension("srt")).toBe("srt");
      expect(getFormatExtension("vtt")).toBe("vtt");
      expect(getFormatExtension("markdown")).toBe("md");
    });
  });

  describe("isWindowsReservedName", () => {
    it("detects Windows reserved device names case-insensitively", () => {
      expect(isWindowsReservedName("CON")).toBe(true);
      expect(isWindowsReservedName("con")).toBe(true);
      expect(isWindowsReservedName("Prn")).toBe(true);
      expect(isWindowsReservedName("AUX")).toBe(true);
      expect(isWindowsReservedName("NUL")).toBe(true);
      expect(isWindowsReservedName("COM1")).toBe(true);
      expect(isWindowsReservedName("com9")).toBe(true);
      expect(isWindowsReservedName("LPT1")).toBe(true);
      expect(isWindowsReservedName("lpt8")).toBe(true);
      expect(isWindowsReservedName("valid-name")).toBe(false);
      expect(isWindowsReservedName("VIDEO_CON")).toBe(false);
    });
  });

  describe("sanitizeTitle", () => {
    it('strips Windows illegal characters: < > : " / \\ | ? *', () => {
      const input = 'What is <AI>? "A Guide" / Tutorial \\ Part:1 | Yes*No';
      const output = sanitizeTitle(input);
      expect(output).toBe("What-is-AI-A-Guide-Tutorial-Part1-YesNo");
      expect(output).not.toMatch(/[<>:"/\\|?*]/);
    });

    it("strips ASCII control characters", () => {
      const input = "Title\x00with\x1fcontrol\x7fchars";
      expect(sanitizeTitle(input)).toBe("Titlewithcontrolchars");
    });

    it("collapses runs of whitespace to a single hyphen", () => {
      const input = "Multiple    spaces \t and \n newlines";
      expect(sanitizeTitle(input)).toBe("Multiple-spaces-and-newlines");
    });

    it("collapses consecutive hyphens and trims leading/trailing hyphens and dots", () => {
      const input = "---..Title with extra hyphens..---";
      expect(sanitizeTitle(input)).toBe("Title-with-extra-hyphens");
    });

    it("falls back to 'untitled' when the title is empty or only illegal characters", () => {
      expect(sanitizeTitle("")).toBe("untitled");
      expect(sanitizeTitle("   ")).toBe("untitled");
      expect(sanitizeTitle('<>:"/\\|?*')).toBe("untitled");
      expect(sanitizeTitle("---...---")).toBe("untitled");
    });

    it("truncates to maxLength (default 100) and trims trailing hyphens", () => {
      const longTitle = "a".repeat(95) + "----" + "b".repeat(20);
      const output = sanitizeTitle(longTitle, 100);
      expect(output.length).toBeLessThanOrEqual(100);
      expect(output.endsWith("-")).toBe(false);
    });

    it("escapes Windows reserved names by appending an underscore", () => {
      expect(sanitizeTitle("CON")).toBe("CON_");
      expect(sanitizeTitle("aux")).toBe("aux_");
      expect(sanitizeTitle("NUL")).toBe("NUL_");
    });

    it("preserves non-Latin and Unicode characters", () => {
      expect(sanitizeTitle("Türkçe Başlık: Nasıl Yapılır?")).toBe(
        "Türkçe-Başlık-Nasıl-Yapılır"
      );
      expect(sanitizeTitle("日本語のタイトル: パート1")).toBe(
        "日本語のタイトル-パート1"
      );
    });
  });

  describe("sanitizeFilename", () => {
    it("strips illegal characters and collapses whitespace in filenames", () => {
      const input = 'My <Cool> : Video? "HD" .txt';
      const output = sanitizeFilename(input);
      expect(output).toBe("My-Cool-Video-HD.txt");
    });

    it("preserves the file extension when truncating to 100 characters", () => {
      const longBase = "x".repeat(120);
      const input = `${longBase}.markdown`;
      const output = sanitizeFilename(input, 100);

      expect(output.length).toBeLessThanOrEqual(100);
      expect(output.endsWith(".markdown")).toBe(true);
    });

    it("falls back to 'untitled' for empty filenames", () => {
      expect(sanitizeFilename("")).toBe("untitled");
      expect(sanitizeFilename("   ")).toBe("untitled");
    });

    it("escapes Windows reserved names in filenames", () => {
      expect(sanitizeFilename("CON.txt")).toBe("CON_.txt");
      expect(sanitizeFilename("prn.json")).toBe("prn_.json");
    });
  });

  describe("formatArchiveFileName", () => {
    it("formats according to {index}-{sanitized-title}-{videoId}.{ext} using options object", () => {
      const result = formatArchiveFileName({
        index: 1,
        title: "Hello World: Part 1?",
        videoId: "dQw4w9WgXcQ",
        format: "txt",
      });

      expect(result).toBe("1-Hello-World-Part-1-dQw4w9WgXcQ.txt");
    });

    it("formats according to {index}-{sanitized-title}-{videoId}.{ext} using positional arguments", () => {
      const result = formatArchiveFileName(
        5,
        "Another Video / Guide",
        "abc123xyz00",
        "markdown"
      );

      expect(result).toBe("5-Another-Video-Guide-abc123xyz00.md");
    });

    it("supports zero-padding for the index", () => {
      const result = formatArchiveFileName({
        index: 7,
        title: "Padded Index Test",
        videoId: "vid123",
        format: "json",
        padWidth: 3,
      });

      expect(result).toBe("007-Padded-Index-Test-vid123.json");
    });

    it("handles all six export formats correctly", () => {
      const formats = ["txt", "json", "csv", "srt", "vtt", "markdown"] as const;
      const expectedExts = ["txt", "json", "csv", "srt", "vtt", "md"];

      formats.forEach((format, i) => {
        const result = formatArchiveFileName({
          index: 1,
          title: "Format Test",
          videoId: "vid001",
          format,
        });
        expect(result).toBe(`1-Format-Test-vid001.${expectedExts[i]}`);
      });
    });

    it("falls back to safe defaults if title or videoId are empty", () => {
      const result = formatArchiveFileName({
        index: 2,
        title: "???",
        videoId: "",
        format: "srt",
      });

      expect(result).toBe("2-untitled-unknown.srt");
    });

    it("enforces 100-character total filename limit with long titles while preserving extension", () => {
      const longTitle =
        "This is an extraordinarily long video title designed specifically to exceed the usual boundaries of filesystem limits and test strict truncation " +
        "repeated again and again to ensure length exceeds several hundred characters easily";

      const resultTxt = formatArchiveFileName({
        index: 42,
        title: longTitle,
        videoId: "jNQXAC9IVRw",
        format: "txt",
        padWidth: 3,
      });

      expect(resultTxt.length).toBeLessThanOrEqual(100);
      expect(resultTxt.endsWith("-jNQXAC9IVRw.txt")).toBe(true);
      expect(resultTxt.startsWith("042-")).toBe(true);

      const resultMd = formatArchiveFileName({
        index: 100,
        title: longTitle,
        videoId: "dQw4w9WgXcQ",
        format: "markdown",
      });

      expect(resultMd.length).toBeLessThanOrEqual(100);
      expect(resultMd.endsWith("-dQw4w9WgXcQ.md")).toBe(true);
      expect(resultMd.startsWith("100-")).toBe(true);
    });

    it("safely truncates entire filename to 100 characters even if videoId or index is abnormally long", () => {
      const extremeVideoId = "a".repeat(85);
      const longTitle = "A".repeat(50);
      const result = formatArchiveFileName({
        index: 12345,
        title: longTitle,
        videoId: extremeVideoId,
        format: "json",
      });

      expect(result.length).toBeLessThanOrEqual(100);
      expect(result.endsWith(".json")).toBe(true);
    });
  });
});
