# 10: In-Page Panel React UI & State Controller

**What to build:**
The interactive slide-out drawer UI mounted inside the Shadow DOM container, implemented in React. Presents the user with detected source metadata, export format checkboxes (TXT, JSON, CSV, SRT, VTT, Markdown), timestamp toggle, language selector dropdown, Start button, real-time extraction progress (`{done}/{total}`), scrollable item status list, Cancel button, and one-click zip download upon completion.

**Blocked by:** 08 (Service Worker Job Queue, Liveness Port & Chunked Storage), 09 (SPA-Safe Button Injection & Shadow DOM Shell)

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] React root mounted into the isolated Shadow DOM root with encapsulated styling.
- [ ] Source header displaying detected channel/playlist title and estimated video count.
- [ ] Configuration controls: checkboxes for all 6 formats, timestamp toggle for TXT, and language selector (popular languages + "Auto / Video Default").
- [ ] "Start" button initiating the job and establishing the `Liveness Port` with the Service Worker.
- [ ] Active job view: live progress counter (`{done}/{total}`), visual progress bar, and scrollable list showing per-video status and error badges.
- [ ] "Cancel" button triggering `AbortController` cancellation in the Service Worker while keeping completed items downloadable.
- [ ] Completion summary banner (`N exported, M skipped, K failed`) and "Download (.zip)" button.
- [ ] Panel state synchronizes with Service Worker so closing/reopening the drawer does not disrupt active job monitoring.
