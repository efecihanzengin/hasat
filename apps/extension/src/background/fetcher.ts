import {
  createExtractionError,
  createTranscript,
  parsePlayerResponse,
  parseTimedTextJson,
  selectCaptionTrack,
  type ExtractionResult,
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

  if (!playerRetryResult.ok) {
    return playerRetryResult;
  }

  // 2. Parse player response
  const playerParsed = parsePlayerResponse(playerRetryResult.value);
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
