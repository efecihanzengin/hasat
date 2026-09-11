# 0002: Job State and Segment Persistence in Extension Storage

## Context
Accumulating full transcripts for 1,000+ videos in volatile Service Worker memory risks hitting browser memory thresholds and loses all progress if the user accidentally reloads or closes the tab.

## Decision
As each video's transcript completes, it is written immediately to `chrome.storage.local`. The Service Worker maintains an index of completed IDs and statuses. The final `.zip` file is generated on-demand during the export step, reading items from storage.
