# YouTube Bulk Transcript Extractor

Domain glossary for the transcript extraction tool.

## Language

### Core Domain

**Source**:
A YouTube channel or playlist containing videos to be extracted.
_Avoid_: Target, account, channel page

**Enumeration**:
The process of resolving a Source into an ordered stream of video IDs using InnerTube continuation tokens.
_Avoid_: Scraping, crawling, listing

**Transcript**:
The complete captured spoken content of a video, broken into timed segments and accompanied by metadata (language, author, auto-generated status).
_Avoid_: Subtitles, captions, CC

**Segment**:
A single timed piece of speech containing normalized text, start time in seconds, and duration in seconds.
_Avoid_: Cue, subtitle line, timestamp block

**Job**:
An active or completed bulk extraction session targeting a single Source with specific export format and language preferences.
_Avoid_: Batch, process, worker task

**Extraction Error**:
A classified, typed failure mapped to the system error taxonomy (e.g. `NO_CAPTIONS`, `RATE_LIMITED`).
_Avoid_: Exception, crash, fetch failure

### User Interface & Extension Architecture

**In-page Panel**:
The slide-out drawer interface injected into the YouTube DOM inside an isolated Shadow DOM container.
_Avoid_: Popup, action window, extension dialog

**Liveness Port**:
A long-lived `chrome.runtime.Port` maintained between the Content Script and Service Worker to prevent MV3 worker termination during extraction jobs.
_Avoid_: Heartbeat socket, keep-alive fetch
