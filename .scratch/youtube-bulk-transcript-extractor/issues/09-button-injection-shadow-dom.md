# 09: SPA-Safe Button Injection & Shadow DOM Shell

**What to build:**
A resilient content script module in `apps/extension` that monitors YouTube's Single Page Application (SPA) navigation using `yt-navigate-finish` (with `MutationObserver` fallback), injects exactly one "Transcribe" button into channel and playlist header toolbars without duplicates, and mounts a container element hosting an isolated Shadow DOM root where the In-Page Panel renders without style collisions.

**Blocked by:** 07 (Main World Context Extraction Bridge)

**Status:** completed

## Acceptance Criteria

- [x] Navigation listener subscribing to YouTube's `yt-navigate-finish` event.
- [x] Reliable element detection for injection targets on channel headers (`#buttons`) and playlist headers (`.metadata-action-bar`).
- [x] Idempotent injection: "Transcribe" button is never duplicated on repeated or rapid SPA route transitions.
- [x] Mount point creation: attaches an isolated Shadow DOM container to `document.body` for the In-Page Panel.
- [x] Button click dispatches toggle event to open/close the In-Page Panel inside the Shadow DOM.
- [x] DOM cleanup on route changes away from channel/playlist pages.

