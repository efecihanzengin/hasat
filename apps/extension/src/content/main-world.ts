import type { YouTubeContext } from "@youtube-transcript/core";
import {
  extractChannelMetadata,
  extractCredentialsFromHtml,
  extractPlaylistMetadata,
  extractTrackingCredentials,
  extractVideosTab,
  parseYtcfgCredentials,
} from "@youtube-transcript/core";
import {
  isBridgeRequest,
  YTE_BRIDGE_SOURCE_ISOLATED,
  YTE_BRIDGE_SOURCE_MAIN,
} from "./types.js";

export type WindowLike = {
  ytcfg?: unknown;
  ytInitialData?: unknown;
  document?: {
    scripts?: ArrayLike<{
      textContent?: string | null;
      innerHTML?: string | null;
    }>;
  };
  addEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ) => void;
  removeEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ) => void;
  postMessage: (message: unknown, targetOrigin?: string) => void;
};

/**
 * Extracts YouTube credentials and page-level metadata from global window state
 * with robust defensive fallbacks across ytcfg, ytInitialData tracking params, and HTML scripts.
 */
export function extractYouTubeContextFromWindow(
  win: WindowLike,
  pagePayload?: unknown
): YouTubeContext {
  // 1. Parse credentials from window.ytcfg
  const ytcfgCreds = parseYtcfgCredentials(win.ytcfg);

  let apiKey = ytcfgCreds.apiKey;
  let clientVersion = ytcfgCreds.clientVersion;
  const clientName = ytcfgCreds.clientName ?? "WEB";
  let visitorData = ytcfgCreds.visitorData;

  const activePageData = pagePayload ?? win.ytInitialData;

  // 2. Fallback to activePageData responseContext tracking parameters
  if ((!clientVersion || !visitorData) && activePageData) {
    const tracking = extractTrackingCredentials(activePageData);
    if (!clientVersion && tracking.clientVersion) {
      clientVersion = tracking.clientVersion;
    }
    if (!visitorData && tracking.visitorData) {
      visitorData = tracking.visitorData;
    }
  }

  // 3. Fallback to scanning document script tags if apiKey or clientVersion is still missing
  if ((!apiKey || !clientVersion) && win.document?.scripts) {
    const scripts = win.document.scripts;
    for (let i = 0; i < scripts.length; i++) {
      const script = scripts[i];
      if (!script) {
        continue;
      }
      const text = script.textContent ?? script.innerHTML ?? "";
      if (
        text.includes("INNERTUBE_API_KEY") ||
        text.includes("INNERTUBE_CLIENT_VERSION")
      ) {
        const htmlCreds = extractCredentialsFromHtml(text);
        if (!apiKey && htmlCreds.apiKey) {
          apiKey = htmlCreds.apiKey;
        }
        if (!clientVersion && htmlCreds.clientVersion) {
          clientVersion = htmlCreds.clientVersion;
        }
      }
      if (apiKey && clientVersion) {
        break;
      }
    }
  }

  // 4. Extract page-level metadata from current page data
  const videosTab = activePageData
    ? extractVideosTab(activePageData)
    : null;
  const playlist = activePageData
    ? extractPlaylistMetadata(activePageData)
    : null;
  const channel = activePageData
    ? extractChannelMetadata(activePageData)
    : null;

  return {
    apiKey,
    clientVersion,
    clientName,
    visitorData,
    videosTab: videosTab ?? undefined,
    playlist: playlist ?? undefined,
    channel: channel ?? undefined,
  };
}

/**
 * Sets up the main-world message listener and SPA navigation event handlers.
 * Returns a cleanup function that removes all listeners.
 */
export function setupMainWorldBridge(win: WindowLike): () => void {
  let lastNavigatedData: unknown = undefined;

  const onMessage = (event: Event): void => {
    if (!("data" in event)) {
      return;
    }

    const data = (event as { data: unknown }).data;
    if (!isBridgeRequest(data)) {
      return;
    }

    const context = extractYouTubeContextFromWindow(win, lastNavigatedData);
    win.postMessage(
      {
        source: YTE_BRIDGE_SOURCE_MAIN,
        target: YTE_BRIDGE_SOURCE_ISOLATED,
        type: "RESPONSE_YOUTUBE_CONTEXT",
        requestId: data.requestId,
        payload: context,
      },
      "*"
    );
  };

  const onNavigateFinish = (event?: Event): void => {
    if (event && "detail" in event) {
      const detail = (event as { detail?: { response?: unknown } }).detail;
      if (detail && typeof detail === "object" && "response" in detail && detail.response) {
        lastNavigatedData = detail.response;
      }
    }
    const context = extractYouTubeContextFromWindow(win, lastNavigatedData);
    win.postMessage(
      {
        source: YTE_BRIDGE_SOURCE_MAIN,
        target: YTE_BRIDGE_SOURCE_ISOLATED,
        type: "YOUTUBE_CONTEXT_UPDATED",
        payload: context,
      },
      "*"
    );
  };

  win.addEventListener("message", onMessage);
  win.addEventListener("yt-navigate-finish", onNavigateFinish);

  return () => {
    win.removeEventListener("message", onMessage);
    win.removeEventListener("yt-navigate-finish", onNavigateFinish);
  };
}

// Auto-initialize when executing as a content script in the browser main world
if (typeof window !== "undefined") {
  const win = window as unknown as WindowLike;
  setupMainWorldBridge(win);
  console.log("[Main World Bridge] YouTube Context Bridge initialized");
}
