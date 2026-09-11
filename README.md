# hasat

Harvest every transcript from a YouTube channel or playlist, straight from your own browser.

[Formats](#output) · [Install](#install) · [How it works](#how-it-works) · [Limits](#limits)

Transcript tools tend to work beautifully on your laptop and die the moment you deploy them. YouTube blocks most datacenter IP ranges, so a server-side fetcher starts returning IpBlocked and 429 on day one — which is why the paid services in this space are really selling a rotating residential proxy pool with a nice UI in front of it.

hasat sidesteps that entirely. It is a Chrome extension: the requests come from your browser, your session, your home IP. Nothing to deploy, nothing to pay for, no proxy to rotate.

```
┌ hasat ──────────────────────────────────────────────┐
│                                                     │
│  Lex Fridman Podcast · 447 videos                   │
│                                                     │
│  Formats   [x] txt  [x] json  [ ] srt  [ ] vtt      │
│  Language  Auto (video default)                     │
│                                                     │
│  ────────────────────────────────────────── 118/447 │
│                                                     │
│  #416 Yann LeCun: Meta AI…               done       │
│  #415 Yuval Noah Harari: Human…          done       │
│  #414 [Members only]                     skipped    │
│  #413 Neil Adams: Judo…                  fetching   │
│                                                     │
│  [ Cancel ]                            [ Download ] │
└─────────────────────────────────────────────────────┘
```

- **Six formats.** TXT, JSON, CSV, SRT, VTT and Markdown, exported together as a single zip with a `manifest.json` recording what succeeded, what was skipped and why.
- **Survives the long jobs.** Every finished transcript is written to `storage.local` immediately. Close the panel, switch tabs, reload the page — the job keeps running and nothing already fetched is lost.
- **Fails one video at a time.** A members-only video, a live stream or a video with no captions is recorded in the manifest and the job carries on. One bad video never takes down a 400-video run.
- **Stops when YouTube says stop.** Rate limits are treated as a signal rather than an obstacle: requests are paced and serialised, and three consecutive 429s pause the whole job instead of digging the hole deeper.
- **Nothing leaves your machine.** No backend, no telemetry, no account. The only hosts contacted are YouTube's own.

## Install

Not on the Chrome Web Store. Build it and load it unpacked:

```bash
git clone https://github.com/efecihanzengin/hasat.git
cd hasat
pnpm install
pnpm build
```

Then open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select `apps/extension/dist`.

Open any YouTube channel or playlist and a Harvest button appears next to the page title.

## Output

The zip contains one file per video plus a manifest:

```
hasat-lex-fridman-2026-09-11.zip
├── 001-Yann-LeCun-Meta-AI-dQw4w9WgXcQ.txt
├── 002-Yuval-Noah-Harari-Human-oHg5SJYRHA0.txt
├── …
└── manifest.json
```

```json
{
  "source": {
    "type": "channel",
    "name": "Lex Fridman Podcast",
    "videoCount": 447
  },
  "exported": 412,
  "skipped": 32,
  "failed": 3,
  "items": [
    {
      "videoId": "dQw4w9WgXcQ",
      "title": "Yann LeCun: Meta AI…",
      "status": "done"
    },
    {
      "videoId": "oHg5SJYRHA0",
      "title": "…",
      "status": "skipped",
      "error": "NO_CAPTIONS"
    }
  ]
}
```

## How it works

A content script reads YouTube's own InnerTube configuration from the page, then walks the browse endpoint's continuation tokens to enumerate the channel or playlist. Each video's caption track is fetched as json3 and normalised into timed segments. The service worker owns the queue; the content script owns the export.

Two consequences worth knowing about. The extension only works while a YouTube tab is open, because that tab is what makes the requests legitimate. And caption tracks are whatever YouTube actually has — a manually written track when one exists, an auto-generated one otherwise, with the quality difference that implies.

## Limits

- **Chrome and Chromium only.** Manifest V3, no Firefox port.
- **YouTube will rate-limit you.** Pacing is deliberately conservative; a 400-video channel takes ten minutes or so. If you hit 429, wait fifteen minutes — a VPN just moves the problem to a new IP.
- **No private, members-only or age-restricted videos.** They are recorded as skipped.
- **Live streams are skipped while still live.**
- **Response shapes change without warning.** When YouTube reshuffles something, the raw payload is logged to the extension console — that log is the first place to look.

## Development

```bash
pnpm typecheck && pnpm lint && pnpm test # everything, fixture-driven, no network
pnpm build                               # unpacked extension → apps/extension/dist
```

| Component | Description |
|---|---|
| `packages/core` | pure TypeScript — parsing, formatters, enumeration |
| `apps/extension` | MV3 service worker, content script, panel UI |

`packages/core` has no DOM and no `chrome.*` types, enforced by its `tsconfig` rather than by convention. Parser tests run against captured real InnerTube payloads in `packages/core/fixtures/`, with credentials stripped.

## Legal

Not affiliated with, endorsed by or sponsored by YouTube or Google. YouTube's Terms of Service restrict downloading content; this is a personal research tool and using it is your call.

## License

MIT
