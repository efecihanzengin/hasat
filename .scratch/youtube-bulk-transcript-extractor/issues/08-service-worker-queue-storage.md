# 08: Service Worker Job Queue, Liveness Port & Chunked Storage

**What to build:**
The background job execution engine running in the MV3 Service Worker. Manages asynchronous video fetch queue (concurrency max 3, 250-500ms jittered delay, 429 exponential backoff with max 4 retries), immediate writing of completed transcripts to `chrome.storage.local` (ADR-0002), cancellation via `AbortController`, and maintenance of the `Liveness Port` (ADR-0001) with the content script to guarantee worker availability.

**Blocked by:** 05 (Pure JS Zip Packaging & Manifest Generator), 06 (Channel & Playlist Video Enumerator), 07 (Main World Context Extraction Bridge)

**Status:** completed

## Acceptance Criteria

- [x] Service worker message & port router handling job lifecycle (`START_JOB`, `CANCEL_JOB`, `GET_JOB_STATUS`, `DOWNLOAD_EXPORT`).
- [x] `Liveness Port` connection listener maintaining worker wake lock throughout active extraction jobs.
- [x] Concurrency-throttled queue processor executing max 3 video fetches simultaneously with 250-500ms jitter delay.
- [x] Exponential backoff retry handler for HTTP 429 responses (1s, 2s, 4s, 8s, up to 4 retries) before marking item `RATE_LIMITED`.
- [x] Immediate persistence of each completed transcript in `chrome.storage.local`.
- [x] Cancellation handling via `AbortController` cleanly halting pending fetches while retaining partial completed items.
- [x] Unit tests for queue throttling, retry state machine, and storage flush logic.
