import {
  createExtractionError,
  createTranscript,
  getOrderedCaptionTracks,
  parsePlayerResponse,
  parseTimedTextJson,
  parseTimedTextXml,
  type CaptionTrack,
  type ExtractionError,
  type ExtractionResult,
  type ParsedPlayerResponse,
  type Transcript,
  type VideoMetadata,
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

export const VISIONOS_CLIENT_CONFIG = {
  clientName: "VISIONOS",
  clientVersion: "1.02",
  deviceMake: "Apple",
  deviceModel: "RealityDevice17,1",
  osName: "visionOS",
  osVersion: "26.5.23O471",
  hl: "en",
  timeZone: "UTC",
  utcOffsetMinutes: 0,
} as const;

export const IOS_CLIENT_CONFIG = {
  clientName: "IOS",
  clientVersion: "21.26.4",
  deviceMake: "Apple",
  deviceModel: "iPhone16,2",
  osName: "iPhone",
  osVersion: "18.3.2.22D82",
  hl: "en",
  timeZone: "UTC",
  utcOffsetMinutes: 0,
} as const;

export type PlayerClientType = "WEB" | "VISIONOS" | "IOS";

function buildJsonTimedTextUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    parsed.searchParams.set("fmt", "json3");
    return parsed.toString();
  } catch {
    const cleanBaseUrl = baseUrl.replace(
      /([?&])fmt=[^&]+(&|$)/g,
      (_match, p1, p2) => (p2 === "&" ? p1 : "")
    );
    const separator = cleanBaseUrl.includes("?") ? "&" : "?";
    return `${cleanBaseUrl}${separator}fmt=json3`;
  }
}

function buildXmlTimedTextUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    parsed.searchParams.delete("fmt");
    return parsed.toString();
  } catch {
    return baseUrl.replace(
      /([?&])fmt=[^&]+(&|$)/g,
      (_match, p1, p2) => (p2 === "&" ? p1 : "")
    );
  }
}

type RequestPlayerOptions = {
  clientType: PlayerClientType;
  videoId: string;
  context?: YouTubeContext;
  visitorData?: string;
  fetchFn: typeof fetch;
  signal?: AbortSignal;
  delayFn?: DelayFunction;
  backoffSchedule?: readonly number[];
};

async function requestPlayerEndpoint(
  options: RequestPlayerOptions
): Promise<ExtractionResult<ParsedPlayerResponse>> {
  const {
    clientType,
    videoId,
    context,
    visitorData,
    fetchFn,
    signal,
    delayFn,
    backoffSchedule,
  } = options;

  let playerBody: Record<string, unknown>;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (clientType === "VISIONOS") {
    headers["X-YouTube-Client-Name"] = "101";
    headers["X-YouTube-Client-Version"] = "1.02";
    headers["Origin"] = "https://www.youtube.com";
    playerBody = {
      context: {
        client: {
          ...VISIONOS_CLIENT_CONFIG,
          ...(visitorData ? { visitorData } : {}),
        },
      },
      videoId,
      playbackContext: {
        contentPlaybackContext: {
          html5Preference: "HTML5_PREF_WANTS",
        },
      },
      contentCheckOk: true,
      racyCheckOk: true,
    };
  } else if (clientType === "IOS") {
    headers["X-YouTube-Client-Name"] = "5";
    headers["X-YouTube-Client-Version"] = "21.26.4";
    headers["Origin"] = "https://www.youtube.com";
    playerBody = {
      context: {
        client: {
          ...IOS_CLIENT_CONFIG,
          ...(visitorData ? { visitorData } : {}),
        },
      },
      videoId,
      playbackContext: {
        contentPlaybackContext: {
          html5Preference: "HTML5_PREF_WANTS",
        },
      },
      contentCheckOk: true,
      racyCheckOk: true,
    };
  } else {
    // WEB client
    const clientName = context?.clientName ?? "WEB";
    playerBody = {
      context: {
        client: {
          clientName,
          clientVersion: context?.clientVersion,
          originalUrl: `https://www.youtube.com/watch?v=${videoId}`,
          ...(visitorData ? { visitorData } : {}),
        },
      },
      videoId,
    };
  }

  const playerEndpoint = context?.apiKey
    ? `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(
        context.apiKey
      )}&prettyPrint=false`
    : "https://www.youtube.com/youtubei/v1/player";

  const playerRetryResult = await executeWith429Retry<unknown>(
    async (): Promise<RetryableOperationResult<unknown>> => {
      const response = await fetchFn(playerEndpoint, {
        method: "POST",
        headers,
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
            response.status === 403 ? "PRIVATE_OR_MEMBERS" : "UNKNOWN",
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
            "Failed to parse player JSON"
          ),
        };
      }
    },
    { signal, delayFn, backoffSchedule }
  );

  if (!playerRetryResult.ok) {
    return playerRetryResult;
  }

  return parsePlayerResponse(playerRetryResult.value);
}

async function attemptWatchPageFallback(
  videoId: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
  delayFn?: DelayFunction,
  backoffSchedule?: readonly number[]
): Promise<ExtractionResult<ParsedPlayerResponse>> {
  console.info(`[Fetcher] Watch page fallback invoked for video ${videoId}`);

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
          error: createExtractionError("PARSE_ERROR", "Failed to read HTML"),
        };
      }
    },
    { signal, delayFn, backoffSchedule }
  );

  if (!watchRetryResult.ok) {
    return watchRetryResult;
  }

  const match = watchRetryResult.value.match(
    /ytInitialPlayerResponse\s*=\s*({.+?});/
  );
  if (match && match[1]) {
    try {
      const parsedJson = JSON.parse(match[1]) as unknown;
      return parsePlayerResponse(parsedJson);
    } catch {
      return {
        ok: false,
        error: createExtractionError(
          "PARSE_ERROR",
          "Failed to parse ytInitialPlayerResponse"
        ),
      };
    }
  }

  return {
    ok: false,
    error: createExtractionError(
      "PARSE_ERROR",
      "No ytInitialPlayerResponse found in HTML"
    ),
  };
}

type TimedTextAttemptResult =
  | { type: "success"; transcript: Transcript }
  | { type: "rate_limited"; error: ExtractionError }
  | { type: "aborted"; error: ExtractionError }
  | { type: "failed"; canFallback: boolean; reason: string };

async function attemptTimedTextExtraction(
  candidateTracks: CaptionTrack[],
  metadata: VideoMetadata,
  videoId: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
  delayFn?: DelayFunction,
  backoffSchedule?: readonly number[]
): Promise<TimedTextAttemptResult> {
  let lastTrackFailureReason = "All candidate tracks failed";
  let hadEmptyResponseBody = false;

  for (const track of candidateTracks) {
    if (signal?.aborted) {
      return {
        type: "aborted",
        error: createExtractionError("UNKNOWN", "Operation cancelled"),
      };
    }

    if (track.baseUrl.includes("exp=xpe") || track.baseUrl.includes("exp=xpv")) {
      hadEmptyResponseBody = true;
    }

    const timedTextJsonUrl = buildJsonTimedTextUrl(track.baseUrl);
    let xmlFallbackReason: string | null = null;

    const jsonRetryResult = await executeWith429Retry<{
      text: string;
      status: number;
      contentType: string;
      contentLength: string;
    }>(
      async (): Promise<
        RetryableOperationResult<{
          text: string;
          status: number;
          contentType: string;
          contentLength: string;
        }>
      > => {
        const response = await fetchFn(timedTextJsonUrl, {
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

        const status = response.status;
        const contentType = response.headers?.get?.("content-type") ?? "unknown";
        const contentLength =
          response.headers?.get?.("content-length") ?? "unknown";

        try {
          const text = await response.text();
          return {
            type: "success",
            value: { text, status, contentType, contentLength },
          };
        } catch {
          return {
            type: "failure",
            error: createExtractionError(
              "PARSE_ERROR",
              "Failed to read timedtext response"
            ),
          };
        }
      },
      { signal, delayFn, backoffSchedule }
    );

    if (!jsonRetryResult.ok) {
      if (jsonRetryResult.error.code === "RATE_LIMITED") {
        return { type: "rate_limited", error: jsonRetryResult.error };
      }
      if (
        signal?.aborted ||
        jsonRetryResult.error.message === "Operation cancelled"
      ) {
        return {
          type: "aborted",
          error: createExtractionError("UNKNOWN", "Operation cancelled"),
        };
      }
      xmlFallbackReason = jsonRetryResult.error.message;
    } else {
      const { text, status, contentType, contentLength } = jsonRetryResult.value;
      const rawText = text.trim();
      if (rawText.length === 0) {
        hadEmptyResponseBody = true;
        xmlFallbackReason = `json3 response body is empty (0 bytes) [HTTP ${status}, Content-Type: ${contentType}, Content-Length: ${contentLength}]`;
      } else {
        const segmentsParsed = parseTimedTextJson(rawText);
        if (segmentsParsed.ok && segmentsParsed.value.length > 0) {
          const transcript = createTranscript(
            metadata,
            track,
            segmentsParsed.value
          );
          return { type: "success", transcript };
        } else {
          if (
            !segmentsParsed.ok &&
            segmentsParsed.error.code === "PARSE_ERROR"
          ) {
            console.error(
              `[Fetcher] Timedtext JSON PARSE_ERROR for video ${videoId} track ${track.languageCode}:`,
              rawText
            );
          }
          const snippet = rawText.slice(0, 150).replace(/\s+/g, " ");
          xmlFallbackReason = segmentsParsed.ok
            ? `json3 contained 0 valid segments [HTTP ${status}, snippet: "${snippet}"]`
            : `${segmentsParsed.error.message} [HTTP ${status}, snippet: "${snippet}"]`;
        }
      }
    }

    if (signal?.aborted) {
      return {
        type: "aborted",
        error: createExtractionError("UNKNOWN", "Operation cancelled"),
      };
    }

    // XML Fallback: Log why json3 failed and fetch XML format per Requirement 4
    console.warn(
      `[Fetcher] json3 timedtext failed for video ${videoId} track ${track.languageCode} (Reason: ${xmlFallbackReason}). Triggering XML fallback.`
    );

    const timedTextXmlUrl = buildXmlTimedTextUrl(track.baseUrl);
    const xmlRetryResult = await executeWith429Retry<string>(
      async (): Promise<RetryableOperationResult<string>> => {
        const response = await fetchFn(timedTextXmlUrl, {
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
              `XML timedtext request failed with HTTP ${response.status}`
            ),
          };
        }

        try {
          const text = await response.text();
          return { type: "success", value: text };
        } catch {
          return {
            type: "failure",
            error: createExtractionError(
              "PARSE_ERROR",
              "Failed to read XML timedtext response"
            ),
          };
        }
      },
      { signal, delayFn, backoffSchedule }
    );

    if (!xmlRetryResult.ok) {
      if (xmlRetryResult.error.code === "RATE_LIMITED") {
        return { type: "rate_limited", error: xmlRetryResult.error };
      }
      if (
        signal?.aborted ||
        xmlRetryResult.error.message === "Operation cancelled"
      ) {
        return {
          type: "aborted",
          error: createExtractionError("UNKNOWN", "Operation cancelled"),
        };
      }
      console.warn(
        `[Fetcher] XML timedtext failed for video ${videoId} track ${track.languageCode} (Reason: ${xmlRetryResult.error.message}). Trying next candidate track.`
      );
      lastTrackFailureReason = xmlRetryResult.error.message;
      continue;
    }

    const xmlSegmentsParsed = parseTimedTextXml(xmlRetryResult.value);
    if (xmlSegmentsParsed.ok && xmlSegmentsParsed.value.length > 0) {
      console.info(
        `[Fetcher] XML fallback succeeded for video ${videoId} with ${xmlSegmentsParsed.value.length} segments.`
      );
      const transcript = createTranscript(
        metadata,
        track,
        xmlSegmentsParsed.value
      );
      return { type: "success", transcript };
    }

    if (xmlRetryResult.value.trim().length === 0) {
      hadEmptyResponseBody = true;
    }

    if (
      !xmlSegmentsParsed.ok &&
      xmlSegmentsParsed.error.code === "PARSE_ERROR"
    ) {
      console.error(
        `[Fetcher] Timedtext XML PARSE_ERROR for video ${videoId} track ${track.languageCode}:`,
        xmlRetryResult.value
      );
    }

    console.warn(
      `[Fetcher] Both json3 and XML timedtext formats failed for video ${videoId} track ${track.languageCode}. Trying next candidate track.`
    );
    lastTrackFailureReason = `Both json3 and XML timedtext formats failed for video ${videoId} track ${track.languageCode}`;
  }

  return {
    type: "failed",
    canFallback: hadEmptyResponseBody,
    reason: lastTrackFailureReason,
  };
}

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

  if (!context?.clientVersion) {
    throw new Error("Missing clientVersion in YouTube page context");
  }

  const visitorData = context?.visitorData;

  // Determine client cascade:
  // If context.clientName is explicitly VISIONOS or IOS, start with it.
  // Otherwise start with WEB, cascading to VISIONOS -> IOS.
  const clientCascade: PlayerClientType[] =
    context.clientName === "VISIONOS"
      ? ["VISIONOS", "IOS", "WEB"]
      : context.clientName === "IOS"
      ? ["IOS", "VISIONOS", "WEB"]
      : ["WEB", "VISIONOS", "IOS"];

  let lastExtractionError: ExtractionError = createExtractionError(
    "NO_CAPTIONS",
    `Both json3 and XML timedtext formats failed for video ${videoId}`
  );

  for (let i = 0; i < clientCascade.length; i++) {
    const clientType = clientCascade[i];
    if (!clientType) continue;

    if (signal?.aborted) {
      return {
        ok: false,
        error: createExtractionError("UNKNOWN", "Operation cancelled"),
      };
    }

    // Alternative mobile/VR clients require visitorData
    if (clientType !== "WEB" && !visitorData) {
      continue;
    }

    let playerParsed = await requestPlayerEndpoint({
      clientType,
      videoId,
      context,
      visitorData,
      fetchFn,
      signal,
      delayFn,
      backoffSchedule,
    });

    if (
      !playerParsed.ok &&
      clientType === "WEB" &&
      playerParsed.error.code === "PRIVATE_OR_MEMBERS"
    ) {
      playerParsed = await attemptWatchPageFallback(
        videoId,
        fetchFn,
        signal,
        delayFn,
        backoffSchedule
      );
    }

    if (!playerParsed.ok) {
      if (
        playerParsed.error.code === "RATE_LIMITED" ||
        signal?.aborted ||
        playerParsed.error.message === "Operation cancelled"
      ) {
        return playerParsed;
      }
      lastExtractionError = playerParsed.error;
      continue;
    }

    const { metadata, captionTracks, defaultCaptionTrackIndex } =
      playerParsed.value;

    if (!metadata.title && fallbackTitle) {
      metadata.title = fallbackTitle;
    }

    const candidateTracks = getOrderedCaptionTracks(
      captionTracks,
      preferredLanguage,
      defaultCaptionTrackIndex
    );

    if (candidateTracks.length === 0) {
      lastExtractionError = createExtractionError("NO_CAPTIONS");
      continue;
    }

    const timedTextResult = await attemptTimedTextExtraction(
      candidateTracks,
      metadata,
      videoId,
      fetchFn,
      signal,
      delayFn,
      backoffSchedule
    );

    if (timedTextResult.type === "success") {
      return { ok: true, value: timedTextResult.transcript };
    }

    if (
      timedTextResult.type === "rate_limited" ||
      timedTextResult.type === "aborted"
    ) {
      return { ok: false, error: timedTextResult.error };
    }

    if (
      timedTextResult.canFallback &&
      visitorData &&
      i < clientCascade.length - 1
    ) {
      console.warn(
        `[Fetcher] Caption extraction on ${clientType} client failed (${timedTextResult.reason}). Falling back to next client in cascade for video ${videoId}.`
      );
    } else {
      console.warn(
        `[Fetcher] InnerTube client ${clientType} failed for video ${videoId} (${timedTextResult.reason}).`
      );
    }

    lastExtractionError = createExtractionError(
      "NO_CAPTIONS",
      `Both json3 and XML timedtext formats failed for video ${videoId}`
    );
  }

  return {
    ok: false,
    error: lastExtractionError,
  };
}
