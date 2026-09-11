# 07: Main World Context Extraction Bridge

**What to build:**
A main-world script execution bridge in `apps/extension` (`world: "MAIN"`) that safely extracts rotating YouTube runtime credentials (`window.ytcfg`: `INNERTUBE_API_KEY`, `INNERTUBE_CLIENT_VERSION`) and page-level metadata (`ytInitialData`: channel Videos tab token, playlist metadata) across the MV3 isolated-world boundary, passing them reliably to the content script.

**Blocked by:** 02 (Monorepo Scaffolding, Build & Verification Harness)

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] Main world script registered or injected via MV3 manifest (`world: "MAIN"` content script or execution).
- [ ] Safe reading of `window.ytcfg.get('INNERTUBE_API_KEY')` and `window.ytcfg.get('INNERTUBE_CLIENT_VERSION')` with defensive fallbacks.
- [ ] Extraction of the "Videos" tab token (`browseEndpoint` / `params`) from `window.ytInitialData` on channel pages.
- [ ] Typed messaging bridge sending extracted context to the isolated world content script via `window.postMessage` or DOM event.
- [ ] Automated/mock tests validating extraction and message passing when `window.ytcfg` and `ytInitialData` are present.
