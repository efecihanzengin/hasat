# 11: End-to-End Browser Verification & Documentation

**What to build:**
Verification of the complete built MV3 extension in a real Chrome browser against a live YouTube playlist/channel meeting all acceptance criteria in SPEC §8, plus comprehensive user documentation in `README.md` explaining unpacked installation and known limitations.

**Blocked by:** 10 (In-Page Panel React UI & State Controller)

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` passes clean across the monorepo.
- [ ] Extension loaded unpacked in Chrome, tested against a real YouTube playlist with ≥ 50 videos.
- [ ] Job completes without uncaught errors in content script or service worker console.
- [ ] Resulting `.zip` downloads and contains valid transcript files matching the selected formats, with a complete `manifest.json`.
- [ ] Handling of missing captions verified (produces `NO_CAPTIONS` in manifest without crashing job).
- [ ] SPA navigation between at least 3 distinct channels verified: exactly one "Transcribe" button injected per page.
- [ ] In-Page Panel opens smoothly and renders cleanly inside Shadow DOM without YouTube CSS interference.
- [ ] `README.md` written documenting:
  - Step-by-step developer build & unpacked installation in Chrome (`chrome://extensions`).
  - How to use the extension on channel and playlist pages.
  - Supported export formats and output naming conventions.
  - Known limitations (residential IP requirement, browser tab must remain open, rate-limit backoff behavior).
