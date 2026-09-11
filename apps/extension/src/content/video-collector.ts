import {
  enumerateVideos,
  type VideoItem,
  type YouTubeContext,
} from "@youtube-transcript/core";

export type CollectVideosOptions = {
  context?: YouTubeContext | null;
  signal?: AbortSignal;
  onProgress?: (count: number) => void;
  fetchFn?: typeof fetch;
  doc?: Document;
  windowLike?: Window;
};

/**
 * Extracts visible videos directly from the DOM as a robust fallback.
 */
export function extractVideosFromDom(
  doc: Document = typeof document !== "undefined" ? document : ({} as Document)
): VideoItem[] {
  const items: VideoItem[] = [];
  const seenIds = new Set<string>();

  if (!doc.querySelectorAll) {
    return items;
  }

  // Common YouTube video card link selectors
  const links = doc.querySelectorAll('a[href*="/watch?v="]');
  for (let i = 0; i < links.length; i++) {
    const link = links[i] as HTMLAnchorElement;
    const href = link.getAttribute("href") ?? "";
    const match = href.match(/[?&]v=([^&#]+)/);
    if (!match || !match[1]) {
      continue;
    }

    const videoId = match[1];
    if (seenIds.has(videoId)) {
      continue;
    }

    // Attempt to locate title
    let title =
      link.getAttribute("title") ??
      link.textContent?.trim() ??
      "";

    // If title on link is just time or empty, search container
    if (!title || title.length < 2 || /^\d{1,2}:\d{2}$/.test(title)) {
      const container =
        link.closest("ytd-rich-item-renderer") ??
        link.closest("ytd-grid-video-renderer") ??
        link.closest("ytd-playlist-video-renderer") ??
        link.closest("yt-lockup-view-model");
      if (container) {
        const titleEl =
          container.querySelector("#video-title") ??
          container.querySelector("h3") ??
          container.querySelector(".yt-lockup-metadata-view-model-wiz__title");
        if (titleEl?.textContent?.trim()) {
          title = titleEl.textContent.trim();
        }
      }
    }

    seenIds.add(videoId);
    items.push({
      videoId,
      title: title || `Video ${videoId}`,
    });
  }

  return items;
}

/**
 * Collects all videos for the active YouTube channel or playlist.
 * Combines InnerTube async generator pagination with DOM fallbacks.
 */
export async function collectVideos(
  options?: CollectVideosOptions
): Promise<VideoItem[]> {
  const context = options?.context;
  const signal = options?.signal;
  const onProgress = options?.onProgress;
  const fetchFn = options?.fetchFn ?? fetch;
  const doc =
    options?.doc ??
    (typeof document !== "undefined" ? document : ({} as Document));

  const allVideos: VideoItem[] = [];
  const seenIds = new Set<string>();

  const browseEndpoint = context?.apiKey
    ? `https://www.youtube.com/youtubei/v1/browse?key=${encodeURIComponent(
        context.apiKey
      )}&prettyPrint=false`
    : "https://www.youtube.com/youtubei/v1/browse";

  const clientContext = {
    client: {
      clientName: context?.clientName ?? "WEB",
      clientVersion: context?.clientVersion ?? "2.20240313.01.00",
      ...(context?.visitorData ? { visitorData: context.visitorData } : {}),
    },
  };

  const fetchContinuation = async (
    token: string,
    abortSignal?: { readonly aborted: boolean }
  ): Promise<unknown> => {
    if (abortSignal?.aborted || signal?.aborted) {
      throw new Error("Operation cancelled");
    }

    const response = await fetchFn(browseEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: clientContext,
        continuation: token,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`InnerTube browse failed with status ${response.status}`);
    }

    return response.json();
  };

  const initialContinuationToken =
    context?.playlist?.continuationToken ??
    context?.videosTab?.continuationToken;

  const browseId = context?.videosTab?.browseId;
  const params = context?.videosTab?.params;

  try {
    if (initialContinuationToken) {
      const generator = enumerateVideos({
        initialContinuationToken,
        fetchContinuation,
        signal,
      });

      for await (const page of generator) {
        if (signal?.aborted) {
          break;
        }
        for (const item of page) {
          if (!seenIds.has(item.videoId)) {
            seenIds.add(item.videoId);
            allVideos.push(item);
          }
        }
        onProgress?.(allVideos.length);
      }
    } else if (browseId && params) {
      const fetchPage = async (request: {
        browseId?: string;
        continuationToken?: string;
      }): Promise<unknown> => {
        if (signal?.aborted) {
          throw new Error("Operation cancelled");
        }

        const body: Record<string, unknown> = {
          context: clientContext,
        };

        if (request.continuationToken) {
          body.continuation = request.continuationToken;
        } else {
          body.browseId = request.browseId;
          body.params = params;
        }

        const response = await fetchFn(browseEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        });

        if (!response.ok) {
          throw new Error(`InnerTube browse failed with status ${response.status}`);
        }

        return response.json();
      };

      const generator = enumerateVideos({
        browseId,
        fetchPage,
        signal,
      });

      for await (const page of generator) {
        if (signal?.aborted) {
          break;
        }
        for (const item of page) {
          if (!seenIds.has(item.videoId)) {
            seenIds.add(item.videoId);
            allVideos.push(item);
          }
        }
        onProgress?.(allVideos.length);
      }
    }
  } catch (err: unknown) {
    if (signal?.aborted) {
      return allVideos;
    }
    console.warn(
      "[Video Collector] Continuation enumeration encountered error; falling back to DOM parsing:",
      err
    );
  }

  // Fallback: If no videos discovered via browse API, scan page DOM
  if (allVideos.length === 0 && !signal?.aborted) {
    const domVideos = extractVideosFromDom(doc);
    for (const item of domVideos) {
      if (!seenIds.has(item.videoId)) {
        seenIds.add(item.videoId);
        allVideos.push(item);
      }
    }
    onProgress?.(allVideos.length);
  }

  return allVideos;
}
