import type { YouTubeContext } from "@youtube-transcript/core";
import { isTargetPage, type TargetPageType } from "./button-injector.js";

export type DetectedSourceType = TargetPageType;

export type DetectedSource = {
  type: DetectedSourceType;
  title: string;
  handleOrAuthor?: string;
  estimatedCount?: number;
};

/**
 * Extracts a numeric video count from arbitrary text strings like "533 videos", "42 video", "1,200 videos".
 */
export function parseVideoCountText(text: string): number | undefined {
  const match = text.replace(/,/g, "").match(/(\d+)\s*(?:video|videolar|vidéo)/i);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  return undefined;
}

/**
 * Resolves the detected channel or playlist metadata from the YouTubeContext or DOM fallbacks.
 */
export function detectSourceMetadata(
  context?: YouTubeContext | null,
  doc: Document = typeof document !== "undefined" ? document : ({} as Document),
  currentUrl?: string
): DetectedSource {
  const href =
    currentUrl ??
    (typeof window !== "undefined" && window.location ? window.location.href : "");
  const target = isTargetPage(href);
  const type: DetectedSourceType = target.type ?? "channel";

  if (type === "playlist") {
    let title = context?.playlist?.title;
    const author = context?.playlist?.author;
    let estimatedCount = context?.playlist?.videoCount;

    if (!title && doc.querySelector) {
      const el =
        doc.querySelector("ytd-playlist-header-renderer .metadata-wrapper #title") ??
        doc.querySelector("ytd-playlist-header-renderer h1") ??
        doc.querySelector(".metadata-action-bar h1");
      if (el?.textContent?.trim()) {
        title = el.textContent.trim();
      }
    }

    if (estimatedCount === undefined && doc.querySelector) {
      const countEl =
        doc.querySelector("ytd-playlist-header-renderer .metadata-stats") ??
        doc.querySelector("ytd-playlist-header-renderer #stats");
      if (countEl?.textContent) {
        estimatedCount = parseVideoCountText(countEl.textContent);
      }
    }

    if (!title) {
      const docTitle = doc.title ?? "";
      title = docTitle.replace(/ - YouTube$/, "").trim() || "YouTube Playlist";
    }

    return {
      type: "playlist",
      title,
      handleOrAuthor: author,
      estimatedCount,
    };
  }

  // Channel page
  let title = context?.channel?.title;
  let handle = context?.channel?.handle;
  let estimatedCount = context?.channel?.videoCount;

  if (!title && doc.querySelector) {
    const titleEl =
      doc.querySelector("yt-page-header-renderer h1") ??
      doc.querySelector("ytd-channel-name #text") ??
      doc.querySelector("#channel-header #text") ??
      doc.querySelector("#inner-header-container #text");
    if (titleEl?.textContent?.trim()) {
      title = titleEl.textContent.trim();
    }
  }

  if (!handle) {
    if (doc.querySelector) {
      const handleEl =
        doc.querySelector("yt-page-header-renderer .yt-content-metadata-view-model-wiz__delimiter")
          ?.previousElementSibling ??
        doc.querySelector("#channel-tagline") ??
        doc.querySelector("#channel-handle");
      if (handleEl?.textContent?.trim()?.startsWith("@")) {
        handle = handleEl.textContent.trim();
      }
    }
    if (!handle) {
      try {
        const urlObj = new URL(href, "https://www.youtube.com");
        const match = urlObj.pathname.match(/^(\/@[^/?#]+)/);
        if (match && match[1]) {
          handle = match[1];
        }
      } catch {
        // invalid url
      }
    }
  }

  if (estimatedCount === undefined && doc.querySelector) {
    const metaEl =
      doc.querySelector("yt-page-header-renderer") ??
      doc.querySelector("#meta") ??
      doc.querySelector("#header-sub-menu");
    if (metaEl?.textContent) {
      estimatedCount = parseVideoCountText(metaEl.textContent);
    }
  }

  if (!title) {
    const docTitle = doc.title ?? "";
    title = docTitle.replace(/ - YouTube$/, "").trim() || "YouTube Channel";
  }

  return {
    type: "channel",
    title,
    handleOrAuthor: handle,
    estimatedCount,
  };
}
