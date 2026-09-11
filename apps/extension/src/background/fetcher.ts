import {
  createExtractionError,
  createTranscript,
  parsePlayerResponse,
  parseTimedTextJson,
  selectCaptionTrack,
  type ExtractionResult,
  type ParsedPlayerResponse,
  type Transcript,
  type YouTubeContext,
} from "@youtube-transcript/core";
import {
  executeWith429Retry,
  type DelayFunction,
  type RetryableOperationResult,
} from "./retry.js";

export type FetchTranscriptOptions = {
  videoId: string;
  fallbackTitle?: string;
  context?: YouTubeContext;
  preferredLanguage?: string;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
  delayFn?: DelayFunction;
  backoffSchedule?: readonly number[];
};

export async function fetchSingleTranscript(
  options: FetchTranscriptOptions
): Promise<ExtractionResult<Transcript>> {
  const {
    videoId,
    fallbackTitle,
    context,
    preferredLanguage,
    signal,
    fetchFn = fetch,
    delayFn,
    backoffSchedule,
  } = options;

  if (signal?.aborted) {
    return {
      ok: false,
      error: createExtractionError("UNKNOWN", "Operation cancelled"),
    };
  }

  // 1. Fetch player endpoint with 429 retry
  const playerEndpoint = context?.apiKey
    ? `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(
        context.apiKey
      )}&prettyPrint=false`
    : "https://www.youtube.com/youtubei/v1/player";

  const playerBody = {
    context: {
      client: {
        clientName: context?.clientName ?? "WEB",
        clientVersion: context?.clientVersion ?? "2.20240313.01.00",
        originalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        ...(context?.visitorData ? { visitorData: context.visitorData } : {}),
      },
    },
    videoId,
  };

  const playerRetryResult = await executeWith429Retry<unknown>(
    async (): Promise<RetryableOperationResult<unknown>> => {
      const response = await fetchFn(playerEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(playerBody),
        signal,
      });

      if (response.status === 429) {
        return { type: "rate_limited" };
      }

      if (!response.ok) {
        return {
          type: "failure",
          error: createExtractionError(
            "UNKNOWN",
            `Player request failed with HTTP ${response.status}`
          ),
        };
      }

      try {
        const data = (await response.json()) as unknown;
        return { type: "success", value: data };
      } catch {
        return {
          type: "failure",
          error: createExtractionError(
            "PARSE_ERROR",
            "Failed to parse player response JSON"
          ),
        };
      }
    },
    { signal, delayFn, backoffSchedule }
  );

  let playerParsed: ExtractionResult<ParsedPlayerResponse> | null = null;
  if (playerRetryResult.ok) {
    playerParsed = parsePlayerResponse(playerRetryResult.value);
  }

  // Fallback to watch page HTML if player endpoint failed with 403 (e.g. MV3 cross-origin POST)
  // or returned an unplayable response mapping to PRIVATE_OR_MEMBERS
  if (
    (!playerRetryResult.ok &&
      playerRetryResult.error.message.includes("403")) ||
    (playerParsed &&
      !playerParsed.ok &&
      playerParsed.error.code === "PRIVATE_OR_MEMBERS")
  ) {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const watchRetryResult = await executeWith429Retry<string>(
      async (): Promise<RetryableOperationResult<string>> => {
        const response = await fetchFn(watchUrl, {
          method: "GET",
          headers: {
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          credentials: "include",
          signal,
        });

        if (response.status === 429) {
          return { type: "rate_limited" };
        }

        if (!response.ok) {
          return {
            type: "failure",
            error: createExtractionError(
              "UNKNOWN",
              `Watch page request failed with HTTP ${response.status}`
            ),
          };
        }

        try {
          const html = await response.text();
          return { type: "success", value: html };
        } catch {
          return {
            type: "failure",
            error: createExtractionError(
              "PARSE_ERROR",
              "Failed to read watch page HTML"
            ),
          };
        }
      },
      { signal, delayFn, backoffSchedule }
    );

    if (watchRetryResult.ok) {
      const match = watchRetryResult.value.match(
        /ytInitialPlayerResponse\s*=\s*({.+?});/
      );
      if (match && match[1]) {
        try {
          const parsedJson = JSON.parse(match[1]) as unknown;
          playerParsed = parsePlayerResponse(parsedJson);
        } catch {
          // If watch page JSON parsing fails, retain original error
        }
      }
    } else if (!playerRetryResult.ok) {
      return watchRetryResult;
    }
  }

  if (!playerParsed) {
    return playerRetryResult as ExtractionResult<Transcript>;
  }

  if (!playerParsed.ok) {
    return playerParsed;
  }

  const { metadata, captionTracks, defaultCaptionTrackIndex } =
    playerParsed.value;

  if (!metadata.title && fallbackTitle) {
    metadata.title = fallbackTitle;
  }

  // 3. Select caption track
  const track = selectCaptionTrack(
    captionTracks,
    preferredLanguage,
    defaultCaptionTrackIndex
  );

  if (!track) {
    return {
      ok: false,
      error: createExtractionError("NO_CAPTIONS"),
    };
  }

  // 4. Fetch timedtext track baseUrl with &fmt=json3
  const separator = track.baseUrl.includes("?") ? "&" : "?";
  const timedTextUrl = `${track.baseUrl}${separator}fmt=json3`;

  const timedTextRetryResult = await executeWith429Retry<unknown>(
    async (): Promise<RetryableOperationResult<unknown>> => {
      const response = await fetchFn(timedTextUrl, {
        method: "GET",
        credentials: "include",
        signal,
      });

      if (response.status === 429) {
        return { type: "rate_limited" };
      }

      if (!response.ok) {
        return {
          type: "failure",
          error: createExtractionError(
            "UNKNOWN",
            `Timedtext request failed with HTTP ${response.status}`
          ),
        };
      }

      try {
        const data = (await response.json()) as unknown;
        return { type: "success", value: data };
      } catch {
        return {
          type: "failure",
          error: createExtractionError(
            "PARSE_ERROR",
            "Failed to parse timedtext response JSON"
          ),
        };
      }
    },
    { signal, delayFn, backoffSchedule }
  );

  if (!timedTextRetryResult.ok) {
    return timedTextRetryResult;
  }

  // 5. Parse timedtext events and normalize segments
  const segmentsParsed = parseTimedTextJson(timedTextRetryResult.value);
  if (!segmentsParsed.ok) {
    return segmentsParsed;
  }

  // 6. Build final normalized Transcript
  const transcript = createTranscript(metadata, track, segmentsParsed.value);
  return {
    ok: true,
    value: transcript,
  };
}
