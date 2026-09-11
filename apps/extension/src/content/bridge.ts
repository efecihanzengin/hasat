import type { YouTubeContext } from "@youtube-transcript/core";
import { createExtractionError } from "@youtube-transcript/core";
import {
  isBridgeContextUpdated,
  isBridgeResponse,
  YTE_BRIDGE_SOURCE_ISOLATED,
  YTE_BRIDGE_SOURCE_MAIN,
} from "./types.js";
import type { WindowLike } from "./main-world.js";

let lastKnownContext: YouTubeContext | null = null;
let isBridgeInitialized = false;

export function getLastKnownContext(): YouTubeContext | null {
  return lastKnownContext;
}

export function setLastKnownContext(ctx: YouTubeContext | null): void {
  lastKnownContext = ctx;
}

/**
 * Initializes listeners in the isolated world to passively capture context updates.
 */
export function initIsolatedBridge(
  win: WindowLike = typeof window !== "undefined"
    ? (window as unknown as WindowLike)
    : ({} as WindowLike)
): () => void {
  if (isBridgeInitialized) {
    return () => {};
  }
  isBridgeInitialized = true;

  const onMessage = (event: Event): void => {
    if (!("data" in event)) {
      return;
    }

    const data = (event as { data: unknown }).data;
    if (isBridgeContextUpdated(data)) {
      lastKnownContext = data.payload;
    }
  };

  win.addEventListener("message", onMessage);

  return () => {
    isBridgeInitialized = false;
    win.removeEventListener("message", onMessage);
  };
}

export type RequestContextOptions = {
  timeoutMs?: number;
  targetWindow?: WindowLike;
};

/**
 * Requests YouTube credentials and page metadata from the main world script via window.postMessage.
 * Returns a typed YouTubeContext Promise with timeout rejection.
 */
export function requestYouTubeContext(
  options?: RequestContextOptions
): Promise<YouTubeContext> {
  const timeoutMs = options?.timeoutMs ?? 2500;
  const win =
    options?.targetWindow ??
    (typeof window !== "undefined" ? (window as unknown as WindowLike) : null);

  if (!win) {
    return Promise.reject(
      createExtractionError(
        "UNKNOWN",
        "Window object unavailable for main world bridge"
      )
    );
  }

  const requestId =
    "yte_" +
    Math.random().toString(36).slice(2, 11) +
    "_" +
    Date.now().toString(36);

  return new Promise<YouTubeContext>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      win.removeEventListener("message", handleMessage);
    };

    const handleMessage = (event: Event): void => {
      if (!("data" in event)) {
        return;
      }

      const data = (event as { data: unknown }).data;
      if (isBridgeResponse(data) && data.requestId === requestId) {
        cleanup();
        lastKnownContext = data.payload;
        resolve(data.payload);
      }
    };

    win.addEventListener("message", handleMessage);

    timer = setTimeout(() => {
      cleanup();
      if (lastKnownContext) {
        // Fallback to last known context if available
        resolve(lastKnownContext);
      } else {
        reject(
          createExtractionError(
            "UNKNOWN",
            `Timeout waiting for main world bridge response (${timeoutMs}ms)`
          )
        );
      }
    }, timeoutMs);

    win.postMessage(
      {
        source: YTE_BRIDGE_SOURCE_ISOLATED,
        target: YTE_BRIDGE_SOURCE_MAIN,
        type: "REQUEST_YOUTUBE_CONTEXT",
        requestId,
      },
      "*"
    );
  });
}
