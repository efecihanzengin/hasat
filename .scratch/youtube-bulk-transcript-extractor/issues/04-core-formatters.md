# 04: Six Core Formatters & Timestamp Validation

**What to build:**
Pure formatter functions in `packages/core` that convert `Transcript` objects into six target formats (TXT, JSON, CSV, SRT, VTT, Markdown), backed by rigorous unit tests covering timestamp edge cases (0s, sub-seconds, minute/hour boundaries, >10 hours) and RFC 4180 CSV escaping.

**Blocked by:** 03 (Core Data Types, Parsing & Normalization Engine)

**Status:** completed

## Acceptance Criteria

- [x] TXT formatter: plain text with paragraph breaks on gaps > 2s; optional `[mm:ss]` prefix with `includeTimestamps`.
- [x] JSON formatter: pretty-printed `Transcript` representation with 2-space indentation.
- [x] CSV formatter: `start,duration,text` with RFC 4180 compliance (double quotes on fields with commas/quotes/newlines).
- [x] SRT formatter: 1-based indexing, `HH:MM:SS,mmm --> HH:MM:SS,mmm`, clamped end-times to prevent overlap.
- [x] VTT formatter: `WEBVTT` header with millisecond dot separator.
- [x] Markdown formatter: `# {title}` header, metadata block (channel, language), followed by prose body.
- [x] Dedicated unit tests for timestamp edge cases: 0.0s, fractional seconds, minute boundary transitions, hour boundary transitions, and durations exceeding 10 hours.
