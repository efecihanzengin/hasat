import type { YouTubeContext } from "@youtube-transcript/core";

export const YTE_BRIDGE_SOURCE_MAIN = "YTE_MAIN_WORLD" as const;
export const YTE_BRIDGE_SOURCE_ISOLATED = "YTE_ISOLATED_WORLD" as const;

export type RequestYouTubeContextMessage = {
  source: typeof YTE_BRIDGE_SOURCE_ISOLATED;
  target: typeof YTE_BRIDGE_SOURCE_MAIN;
  type: "REQUEST_YOUTUBE_CONTEXT";
  requestId: string;
};

export type ResponseYouTubeContextMessage = {
  source: typeof YTE_BRIDGE_SOURCE_MAIN;
  target: typeof YTE_BRIDGE_SOURCE_ISOLATED;
  type: "RESPONSE_YOUTUBE_CONTEXT";
  requestId: string;
  payload: YouTubeContext;
};

export type YouTubeContextUpdatedMessage = {
  source: typeof YTE_BRIDGE_SOURCE_MAIN;
  target: typeof YTE_BRIDGE_SOURCE_ISOLATED;
  type: "YOUTUBE_CONTEXT_UPDATED";
  payload: YouTubeContext;
};

export type BridgeMessage =
  | RequestYouTubeContextMessage
  | ResponseYouTubeContextMessage
  | YouTubeContextUpdatedMessage;

export function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

export function isBridgeRequest(
  val: unknown
): val is RequestYouTubeContextMessage {
  return (
    isRecord(val) &&
    val.source === YTE_BRIDGE_SOURCE_ISOLATED &&
    val.target === YTE_BRIDGE_SOURCE_MAIN &&
    val.type === "REQUEST_YOUTUBE_CONTEXT" &&
    typeof val.requestId === "string"
  );
}

export function isBridgeResponse(
  val: unknown
): val is ResponseYouTubeContextMessage {
  return (
    isRecord(val) &&
    val.source === YTE_BRIDGE_SOURCE_MAIN &&
    val.target === YTE_BRIDGE_SOURCE_ISOLATED &&
    val.type === "RESPONSE_YOUTUBE_CONTEXT" &&
    typeof val.requestId === "string" &&
    isRecord(val.payload)
  );
}

export function isBridgeContextUpdated(
  val: unknown
): val is YouTubeContextUpdatedMessage {
  return (
    isRecord(val) &&
    val.source === YTE_BRIDGE_SOURCE_MAIN &&
    val.target === YTE_BRIDGE_SOURCE_ISOLATED &&
    val.type === "YOUTUBE_CONTEXT_UPDATED" &&
    isRecord(val.payload)
  );
}
