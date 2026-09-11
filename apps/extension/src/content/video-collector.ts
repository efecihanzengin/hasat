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
 * Collects all videos for the active YouTube channel or playlist using
 * InnerTube continuation token pagination.
 */
export async function collectVideos(
  options?: CollectVideosOptions
): Promise<VideoItem[]> {
  const context = options?.context;
  const signal = options?.signal;
  const onProgress = options?.onProgress;
  const fetchFn = options?.fetchFn ?? fetch;

  if (!context?.clientVersion) {
    throw new Error("Missing clientVersion in YouTube page context");
  }

  const allVideos: VideoItem[] = [];
  const seenIds = new Set<string>();

  const addPageVideos = (items: readonly VideoItem[]): void => {
    for (const item of items) {
      if (!seenIds.has(item.videoId)) {
        seenIds.add(item.videoId);
        allVideos.push(item);
      }
    }
    onProgress?.(allVideos.length);
  };

  const browseEndpoint = context.apiKey
    ? `https://www.youtube.com/youtubei/v1/browse?key=${encodeURIComponent(
        context.apiKey
      )}&prettyPrint=false`
    : "https://www.youtube.com/youtubei/v1/browse";

  const clientContext = {
    client: {
      clientName: context.clientName ?? "WEB",
      clientVersion: context.clientVersion,
      ...(context.visitorData ? { visitorData: context.visitorData } : {}),
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
    context.playlist?.continuationToken ?? context.videosTab?.continuationToken;

  const browseId = context.videosTab?.browseId;
  const params = context.videosTab?.params;

  // Pre-seed with initial videos already present in context (e.g. playlist browse response)
  const initialBatch = context.playlist?.initialVideos ?? context.initialVideos;
  if (initialBatch && initialBatch.length > 0) {
    addPageVideos(initialBatch);
  }

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
        addPageVideos(page);
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
          throw new Error(
            `InnerTube browse failed with status ${response.status}`
          );
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
        addPageVideos(page);
      }
    }
  } catch (err: unknown) {
    if (signal?.aborted) {
      return allVideos;
    }
    throw err;
  }

  return allVideos;
}
