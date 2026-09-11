# 08: Service Worker Job Queue, Liveness Port & Chunked Storage

**What to build:**
The background job execution engine running in the MV3 Service Worker. Manages asynchronous video fetch queue (concurrency max 3, 250-500ms jittered delay, 429 exponential backoff with max 4 retries), immediate writing of completed transcripts to `chrome.storage.local` (ADR-0002), cancellation via `AbortController`, and maintenance of the `Liveness Port` (ADR-0001) with the content script to guarantee worker availability.

**Blocked by:** 05 (Pure JS Zip Packaging & Manifest Generator), 06 (Channel & Playlist Video Enumerator), 07 (Main World Context Extraction Bridge)

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] Service worker message & port router handling job lifecycle (`START_JOB`, `CANCEL_JOB`, `GET_JOB_STATUS`, `DOWNLOAD_EXPORT`).
- [ ] `Liveness Port` connection listener maintaining worker wake lock throughout active extraction jobs.
- [ ] Concurrency-throttled queue processor executing max 3 video fetches simultaneously with 250-500ms jitter delay.
- [ ] Exponential backoff retry handler for HTTP 429 responses (1s, 2s, 4s, 8s, up to 4 retries) before marking item `RATE_LIMITED`.
- [ ] Immediate persistence of each completed transcript in `chrome.storage.local`.
- [ ] Cancellation handling via `AbortController` cleanly halting pending fetches while retaining partial completed items.
- [ ] Unit tests for queue throttling, retry state machine, and storage flush logic.
