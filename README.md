# YouTube Bulk Transcript Extractor

A Chrome Manifest V3 extension that extracts transcripts in bulk from every video in a YouTube channel or playlist and exports them as **TXT**, **JSON**, **CSV**, **SRT**, **VTT**, or **Markdown** inside a single `.zip` package with a structured `manifest.json`.

---

## Architecture & Design Principles

Per **SPEC §1**, transcripts **must be fetched from the user's browser, not from an external server**:
- **Zero Datacenter/Proxy Blocks**: YouTube aggressively blocks cloud/datacenter IP ranges and imposes proof-of-origin (PoToken) challenges. Running as an MV3 browser extension guarantees that all extraction requests originate from the user's authentic browser session and residential IP.
- **Pure Core Library (`packages/core`)**: Zero DOM, zero `chrome.*`, zero network at module scope. Houses defensiveness-first InnerTube payload parsers, caption track selectors, transcript segment normalizers, formatters, and streaming ZIP packaging. Thoroughly covered by fixture-driven unit tests.
- **Chrome MV3 Extension (`apps/extension`)**: Vite + CRXJS + React. Injected into YouTube channel and playlist pages, encapsulated strictly inside **Shadow DOM** to prevent CSS bleeding and styling collisions with YouTube's dynamic theme.
- **Service Worker Lifecycle (Liveness Port)**: Long-running extractions (hundreds of videos) maintain an open `chrome.runtime.Port` between the content script and background service worker, preventing Chrome from suspending the service worker mid-job.
- **Chunked Storage Persistence**: Transcripts are streamed to `chrome.storage.local` upon completion of each video (per ADR-0002), preventing heap exhaustion and ensuring job resumability.

---

## Developer Setup & Build

### Prerequisites

- **Node.js**: >= 20.0.0
- **pnpm**: >= 9.0.0
- **Google Chrome**: Modern version supporting Manifest V3

### Installation & Build

1. Clone the repository and install dependencies:
   ```bash
   git clone <repo-url>
   cd youtubetranscript
   pnpm install
   ```

2. Run typechecking, linting, and tests:
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   ```

3. Build the extension for production:
   ```bash
   pnpm build
   ```
   The unpacked extension will be compiled into `apps/extension/dist/`.

---

## Installing Unpacked Extension in Chrome

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** using the toggle switch in the top-right corner.
3. Click the **Load unpacked** button in the top-left toolbar.
4. Select the directory:
   ```
   <repo-root>/apps/extension/dist
   ```
5. Confirm that **YouTube Bulk Transcript Extractor** appears in your extensions list and is active.

---

## How to Use

### 1. Channel Pages
- Navigate to any YouTube channel home or videos tab:
  - `https://www.youtube.com/@ChannelName`
  - `https://www.youtube.com/@ChannelName/videos`
- A red **Transcribe** button will be automatically injected into the channel header action row.
- The extension automatically resolves the channel's "Videos" tab continuation token to enumerate full uploads rather than featured home reels.

### 2. Playlist Pages
- Navigate to any public or unlisted YouTube playlist:
  - `https://www.youtube.com/playlist?list=...`
- The **Transcribe** button appears cleanly in the playlist action bar alongside "Play all" and "Share".

### 3. In-Page Panel (Slide-out Drawer)
1. Click **Transcribe** to open the panel. The panel renders within an isolated Shadow DOM.
2. Select your desired **Export Formats**:
   - `TXT` (with optional timestamp toggle `[mm:ss]`)
   - `JSON` (full transcript object tree)
   - `CSV` (`start,duration,text` with RFC 4180 quoting)
   - `SRT` (standard SubRip subtitle format)
   - `VTT` (WebVTT subtitle format)
   - `Markdown` (formatted heading and language metadata)
3. Select **Preferred Language** (e.g. "Auto / Video Default", "English", "Turkish", etc.).
4. Click **Start Extraction**.
5. Watch real-time progress and live item status indicators:
   - Status counters: `{done}/{total}`.
   - Per-video status: `pending`, `fetching`, `done`, `skipped` (e.g., Live streams), or `failed` with typed error details.
6. Once complete, click **Download (.zip)** to save the complete archive.

---

## Output Structure & Naming Conventions

The downloaded archive is named after the channel or playlist:
`{sanitized-channel-or-playlist-title}-export.zip`

### File Naming Convention
Per **SPEC §6.1**, each transcript file inside the archive is formatted as:
```
{1-based-index}-{sanitized-title}-{videoId}.{ext}
```
- Filenames strip illegal characters (`< > : " / \ | ? *`), collapse whitespace into hyphens (`-`), and clamp titles to 100 characters while preserving the extension.
- Example: `001-Python-Tutorial-for-Beginners-1-Install-and-Setup-HGOBQPFzWKo.srt`

### `manifest.json`
Every archive includes a root `manifest.json` recording full metadata and execution audit details:
```json
{
  "version": "1.0",
  "generatedAt": "2026-09-11T11:00:00.000Z",
  "summary": {
    "total": 158,
    "exported": 150,
    "skipped": 5,
    "failed": 3
  },
  "channelOrPlaylist": "Python Tutorials",
  "items": [
    {
      "index": 1,
      "videoId": "HGOBQPFzWKo",
      "title": "Python Tutorial for Beginners 1: Install and Setup",
      "status": "done",
      "filename": "1-Python-Tutorial-for-Beginners-1-Install-and-Setup-HGOBQPFzWKo.txt"
    },
    {
      "index": 2,
      "videoId": "exampleId",
      "title": "Music Video Without Subtitles",
      "status": "failed",
      "error": {
        "code": "NO_CAPTIONS",
        "message": "No transcript available"
      }
    }
  ]
}
```

---

## Error Taxonomy

Failures are strongly typed and never crash the queue:

| Code | Cause | Behavior |
|---|---|---|
| `NO_CAPTIONS` | Video does not have captions/subtitles in any track | Recorded in manifest; job continues smoothly |
| `PRIVATE_OR_MEMBERS` | Video is private, deleted, or members-only | Flagged in manifest; job proceeds to next item |
| `AGE_RESTRICTED` | Sign-in or age verification required | Flagged in manifest; job proceeds |
| `LIVE_STREAM` | Video is an active ongoing livestream | Automatically `skipped`; job proceeds |
| `RATE_LIMITED` | HTTP 429 received after exponential retries | Marked `failed`; job preserves all earlier successes |
| `PARSE_ERROR` | Unexpected InnerTube schema change | Logs raw response to console; marks item failed |
| `UNKNOWN` | Network drop or other unexpected exception | Logged and handled gracefully |

---

## Known Limitations & Best Practices

1. **Residential IP & Bot Protection**:
   - Extractions must run in a real desktop Chrome browser with standard user navigation.
   - Headless or datacenter environments without genuine user profiles will be challenged by Google's automated query detection (HTTP 429 / CAPTCHA).
2. **Active Browser Tab Requirement**:
   - The YouTube tab hosting the extraction panel must remain open while a bulk job is running.
   - Closing the tab severs the Liveness Port connection and stops worker orchestration.
3. **Pacing and Concurrency Ceiling**:
   - Concurrency is capped at 3 concurrent workers (with 250–500ms jittered intervals) to protect your IP from triggering YouTube's rate limiters.
   - If HTTP 429 is encountered, the extension uses exponential backoff (1s, 2s, 4s, 8s) up to 4 retries before gracefully marking the video rate-limited.
