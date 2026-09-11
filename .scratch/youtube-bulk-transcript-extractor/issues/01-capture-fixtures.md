# 01: Capture Real Redacted InnerTube Fixtures

**What to build:**
A committed suite of sanitized, real-world YouTube InnerTube raw JSON response payloads saved under `packages/core/fixtures/`. These fixtures serve as the sole ground-truth data sources for all parser, normalizer, and enumerator unit tests, guaranteeing zero network dependencies during testing.

**Blocked by:** None (can start immediately)

**Status:** completed

## Acceptance Criteria

- [x] Captured a real player response for a standard video with manual caption tracks.
- [x] Captured a real player response for a video with no captions (`NO_CAPTIONS` test case).
- [x] Captured a real `json3` timedtext caption response containing auto-generated captions with non-Latin script (e.g. Cyrillic, Arabic, or CJK).
- [x] Captured a real channel or playlist `browse` response containing at least one valid continuation token.
- [x] All cookies, session tokens, API keys, client tokens, and headers (`Authorization`, `SAPISID`, etc.) are completely redacted/scrubbed before commit.
- [x] Fixtures are placed under `packages/core/fixtures/` as cleanly formatted `.json` files.

