# 06: Channel & Playlist Video Enumerator

**What to build:**
An asynchronous generator/iterator in `packages/core` that takes a channel or playlist identifier, follows InnerTube `browse` continuation tokens defensively across pagination without buffering entire channels in memory, and yields pages of video items (`videoId`, `title`).

**Blocked by:** 01 (Capture Real Redacted InnerTube Fixtures), 02 (Monorepo Scaffolding, Build & Verification Harness)

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] Generator function `enumerateVideos` yielding pages of video items.
- [ ] Defensive extraction of `videoRenderer` and `playlistVideoRenderer` nodes by walking the InnerTube response object tree.
- [ ] Continuation token extractor correctly identifying next page tokens from `continuationItemRenderer` or `continuationCommand`.
- [ ] Termination when continuation tokens are exhausted.
- [ ] Unit tests running against multi-page continuation fixtures from ticket 01, verifying pagination without network access.
