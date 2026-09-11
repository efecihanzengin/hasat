# 03: Core Data Types, Parsing & Normalization Engine

**What to build:**
Pure TypeScript data models (`Segment`, `Transcript`, `JobItem`, `ExtractionError`) and defensive InnerTube caption parsers that convert raw `player` and `timedtext json3` responses into normalized `Transcript` objects, handling language fallback hierarchy, HTML entity unescaping, whitespace collapsing, and empty segment pruning.

**Blocked by:** 01 (Capture Real Redacted InnerTube Fixtures), 02 (Monorepo Scaffolding, Build & Verification Harness)

**Status:** completed

## Acceptance Criteria

- [x] Domain types defined in `packages/core`: `Segment`, `Transcript`, `JobItem`, `ExtractionError`.
- [x] Error taxonomy typed matching SPEC §5 (`NO_CAPTIONS`, `PRIVATE_OR_MEMBERS`, `AGE_RESTRICTED`, `LIVE_STREAM`, `RATE_LIMITED`, `PARSE_ERROR`, `UNKNOWN`).
- [x] Defensive caption parser extracts `captionTracks` from raw player payload without assuming fixed index paths.
- [x] Track selection order implemented: preferred language -> video default manual -> auto-generated -> first available.
- [x] `json3` event parser converts `events[].segs[].utf8` into clean `Segment[]`.
- [x] Normalizer unescapes HTML entities, collapses multi-space runs, trims text, and drops empty segments.
- [x] Unit tests pass against all 3 committed player/caption fixtures from ticket 01.
