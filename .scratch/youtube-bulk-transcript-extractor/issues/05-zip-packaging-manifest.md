# 05: Pure JS Zip Packaging & Manifest Generator

**What to build:**
A packaging module in `packages/core` using `fflate` that streams files into an in-memory `.zip` archive on demand, sanitizes video filenames safely across operating systems (stripping `< > : " / \ | ? *`, collapsing whitespace to `-`, truncating to 100 characters), and generates a comprehensive `manifest.json` report of all job items and status codes.

**Blocked by:** 03 (Core Data Types, Parsing & Normalization Engine)

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] Filename sanitization function stripping illegal characters (`< > : " / \ | ? *`), collapsing whitespace to `-`, and truncating to 100 characters while preserving the extension.
- [ ] Filename formatting: `{index}-{sanitized-title}-{videoId}.{ext}`.
- [ ] Manifest generation function producing `manifest.json` containing total count, exported count, skipped/failed items, and error codes.
- [ ] Integration with `fflate` for memory-efficient zip compression runnable in pure JS environments.
- [ ] Unit tests verifying filename sanitization edge cases (Windows reserved characters, empty titles, very long strings).
- [ ] Unit tests verifying zip creation and manifest accuracy against simulated job outputs.
