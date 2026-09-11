import type {
  ExportFormat,
  FormatOptions,
  Segment,
  Transcript,
  TxtFormatOptions,
} from "./types.js";
import {
  formatSrtTimestamp,
  formatTxtTimestamp,
  formatVttTimestamp,
} from "./timestamp.js";

/**
 * Escapes a CSV field according to RFC 4180.
 * If the field contains a comma, double-quote, or newline, it is enclosed in double-quotes,
 * and any inner double-quotes are escaped with another double-quote.
 */
export function escapeCsvField(field: string): string {
  if (
    field.includes('"') ||
    field.includes(",") ||
    field.includes("\n") ||
    field.includes("\r")
  ) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Clamps segment end time so that it never overlaps with the subsequent segment's start time,
 * and is never less than the current segment's start time.
 */
export function calculateClampedEndTime(
  segments: Segment[],
  index: number
): number {
  const current = segments[index];
  if (!current) {
    return 0;
  }

  const startTime = Math.max(0, current.start);
  const rawEndTime = Math.max(startTime, current.start + current.duration);

  if (index < segments.length - 1) {
    const next = segments[index + 1];
    if (next) {
      const nextStart = Math.max(0, next.start);
      return Math.max(startTime, Math.min(rawEndTime, nextStart));
    }
  }

  return rawEndTime;
}

/**
 * Groups consecutive segments into paragraphs based on gaps.
 * A gap > 2.0 seconds between the end of a segment and the start of the next segment
 * triggers a new paragraph.
 */
export function groupSegmentsIntoParagraphs(segments: Segment[]): Segment[][] {
  if (segments.length === 0) {
    return [];
  }

  const paragraphs: Segment[][] = [];
  let currentParagraph: Segment[] = [segments[0] as Segment];

  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1] as Segment;
    const curr = segments[i] as Segment;
    const prevEnd = prev.start + prev.duration;
    const gap = curr.start - prevEnd;

    if (gap > 2.0) {
      paragraphs.push(currentParagraph);
      currentParagraph = [curr];
    } else {
      currentParagraph.push(curr);
    }
  }

  paragraphs.push(currentParagraph);
  return paragraphs;
}

/**
 * Formats a transcript as plain text (TXT).
 * Paragraph breaks occur on gaps > 2 seconds.
 * If includeTimestamps is true, prefixes segments with [mm:ss] (or [hh:mm:ss] if >= 1 hour).
 */
export function formatToTxt(
  transcript: Transcript,
  options?: TxtFormatOptions
): string {
  if (transcript.segments.length === 0) {
    return "";
  }

  const paragraphs = groupSegmentsIntoParagraphs(transcript.segments);
  const includeTimestamps = options?.includeTimestamps ?? false;

  if (includeTimestamps) {
    // When timestamps are requested, format each segment on its own line prefixed with [mm:ss],
    // separated by double newlines on paragraph breaks.
    return paragraphs
      .map((p) =>
        p
          .map((seg) => `${formatTxtTimestamp(seg.start)} ${seg.text}`)
          .join("\n")
      )
      .join("\n\n");
  }

  // Without timestamps: join segments within a paragraph with a space, paragraphs with double newlines
  return paragraphs
    .map((p) => p.map((seg) => seg.text).join(" "))
    .join("\n\n");
}

/**
 * Formats a transcript as pretty-printed JSON (2-space indentation).
 */
export function formatToJson(transcript: Transcript): string {
  return JSON.stringify(transcript, null, 2);
}

/**
 * Formats a transcript as RFC 4180 compliant CSV: start,duration,text.
 */
export function formatToCsv(transcript: Transcript): string {
  const lines = ["start,duration,text"];

  for (const seg of transcript.segments) {
    lines.push(`${seg.start},${seg.duration},${escapeCsvField(seg.text)}`);
  }

  return lines.join("\n");
}

/**
 * Formats a transcript as SubRip (SRT) subtitles:
 * 1-based indexing, HH:MM:SS,mmm --> HH:MM:SS,mmm, blank lines between cues,
 * with cue end times clamped so cues never overlap.
 */
export function formatToSrt(transcript: Transcript): string {
  if (transcript.segments.length === 0) {
    return "";
  }

  const cues: string[] = [];

  for (let i = 0; i < transcript.segments.length; i++) {
    const seg = transcript.segments[i] as Segment;
    const startTime = Math.max(0, seg.start);
    const endTime = calculateClampedEndTime(transcript.segments, i);
    const index = i + 1;

    cues.push(
      `${index}\n${formatSrtTimestamp(startTime)} --> ${formatSrtTimestamp(
        endTime
      )}\n${seg.text}`
    );
  }

  return cues.join("\n\n") + "\n";
}

/**
 * Formats a transcript as WebVTT subtitles:
 * Starts with WEBVTT header, HH:MM:SS.mmm --> HH:MM:SS.mmm timing,
 * and clamped cue end times to prevent overlaps.
 */
export function formatToVtt(transcript: Transcript): string {
  if (transcript.segments.length === 0) {
    return "WEBVTT\n";
  }

  const cues: string[] = [];

  for (let i = 0; i < transcript.segments.length; i++) {
    const seg = transcript.segments[i] as Segment;
    const startTime = Math.max(0, seg.start);
    const endTime = calculateClampedEndTime(transcript.segments, i);
    const index = i + 1;

    cues.push(
      `${index}\n${formatVttTimestamp(startTime)} --> ${formatVttTimestamp(
        endTime
      )}\n${seg.text}`
    );
  }

  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

/**
 * Formats a transcript as Markdown:
 * # {title} header, channel and language metadata block, followed by prose body.
 */
export function formatToMarkdown(transcript: Transcript): string {
  const metadataLines = [
    `# ${transcript.title}`,
    "",
    `- **Channel:** ${transcript.channelName}`,
    `- **Language:** ${transcript.language}`,
  ];

  const body = formatToTxt(transcript, { includeTimestamps: false });
  if (body.length > 0) {
    metadataLines.push("", body);
  }

  return metadataLines.join("\n");
}

/**
 * Unified formatter function for any supported export format.
 */
export function formatTranscript(
  transcript: Transcript,
  format: ExportFormat,
  options?: FormatOptions
): string {
  switch (format) {
    case "txt":
      return formatToTxt(transcript, options);
    case "json":
      return formatToJson(transcript);
    case "csv":
      return formatToCsv(transcript);
    case "srt":
      return formatToSrt(transcript);
    case "vtt":
      return formatToVtt(transcript);
    case "markdown":
      return formatToMarkdown(transcript);
  }
}
