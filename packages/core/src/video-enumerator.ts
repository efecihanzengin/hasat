import type { EnumerateVideosOptions, VideoItem } from "./types.js";
import { createExtractionError } from "./types.js";

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

type NodeMatch = {
  key: string;
  val: Record<string, unknown>;
};

/**
 * Defensively traverses an object tree to collect key-value pairs matching a predicate.
 * Visited set prevents infinite loops on circular structures.
 */
function findNodesWithKeys(
  root: unknown,
  predicate: (key: string, val: Record<string, unknown>) => boolean,
  maxDepth = 25
): NodeMatch[] {
  const matches: NodeMatch[] = [];
  const visited = new Set<unknown>();

  function walk(node: unknown, depth: number): void {
    if (depth > maxDepth || node === null || typeof node !== "object") {
      return;
    }
    if (visited.has(node)) {
      return;
    }
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item, depth + 1);
      }
      return;
    }

    if (isRecord(node)) {
      for (const [key, val] of Object.entries(node)) {
        if (isRecord(val) && predicate(key, val)) {
          matches.push({ key, val });
        }
        walk(val, depth + 1);
      }
    }
  }

  walk(root, 0);
  return matches;
}

/**
 * Extracts human-readable text from various YouTube title representations:
 * direct strings, runs arrays, simpleText, or lockup view model title objects.
 */
export function extractTextFromTitle(rawTitle: unknown): string {
  if (typeof rawTitle === "string") {
    return rawTitle;
  }
  if (!isRecord(rawTitle)) {
    return "";
  }
  if (isRecord(rawTitle.lockupMetadataViewModel)) {
    return extractTextFromTitle(rawTitle.lockupMetadataViewModel);
  }
  if (typeof rawTitle.content === "string") {
    return rawTitle.content;
  }
  if (typeof rawTitle.simpleText === "string") {
    return rawTitle.simpleText;
  }
  if (Array.isArray(rawTitle.runs)) {
    return rawTitle.runs
      .filter(
        (r): r is { text: string } => isRecord(r) && typeof r.text === "string"
      )
      .map((r) => r.text)
      .join("");
  }
  if (isRecord(rawTitle.title)) {
    return extractTextFromTitle(rawTitle.title);
  }
  return "";
}

/**
 * Extracts a video ID and title from a candidate renderer node.
 */
function extractVideoFromNode(
  key: string,
  val: Record<string, unknown>
): VideoItem | null {
  let videoId = "";
  let title = "";

  if (key === "lockupViewModel") {
    const contentType =
      typeof val.contentType === "string" ? val.contentType : "";
    if (contentType === "LOCKUP_CONTENT_TYPE_VIDEO" || contentType === "") {
      if (typeof val.contentId === "string") {
        videoId = val.contentId;
      }
    }
    if (
      isRecord(val.metadata) &&
      isRecord(val.metadata.lockupMetadataViewModel)
    ) {
      title = extractTextFromTitle(val.metadata.lockupMetadataViewModel.title);
    } else if (isRecord(val.metadata)) {
      title = extractTextFromTitle(val.metadata);
    }
  } else {
    if (typeof val.videoId === "string") {
      videoId = val.videoId;
    } else if (
      isRecord(val.navigationEndpoint) &&
      isRecord(val.navigationEndpoint.watchEndpoint) &&
      typeof val.navigationEndpoint.watchEndpoint.videoId === "string"
    ) {
      videoId = val.navigationEndpoint.watchEndpoint.videoId;
    }

    title = extractTextFromTitle(val.title);
    if (title.length === 0 && isRecord(val.headline)) {
      title = extractTextFromTitle(val.headline);
    }
  }

  if (videoId.trim().length > 0) {
    return { videoId: videoId.trim(), title: title.trim() };
  }

  return null;
}

/**
 * Defensively extracts video items from a browse page or continuation response
 * by traversing the object tree for known renderers.
 */
export function extractVideosFromBrowse(
  payload: unknown,
  options?: { maxDepth?: number }
): VideoItem[] {
  if (!isRecord(payload)) {
    return [];
  }

  const maxDepth = options?.maxDepth ?? 25;
  const rendererKeys = new Set([
    "videoRenderer",
    "playlistVideoRenderer",
    "playlistPanelVideoRenderer",
    "gridVideoRenderer",
    "compactVideoRenderer",
    "lockupViewModel",
  ]);

  const candidateNodes = findNodesWithKeys(
    payload,
    (key) => rendererKeys.has(key),
    maxDepth
  );

  const videos: VideoItem[] = [];
  const seenInPage = new Set<string>();

  for (const { key, val } of candidateNodes) {
    const item = extractVideoFromNode(key, val);
    if (item && !seenInPage.has(item.videoId)) {
      seenInPage.add(item.videoId);
      videos.push(item);
    }
  }

  return videos;
}

/**
 * Defensively extracts the pagination continuation token from a browse response.
 * Prioritizes continuationItemRenderer to avoid selecting sorting chip tokens.
 */
export function extractContinuationToken(
  payload: unknown,
  options?: { maxDepth?: number }
): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const maxDepth = options?.maxDepth ?? 25;

  // 1. Look for continuationItemRenderer first (standard pagination container)
  const itemRenderers = findNodesWithKeys(
    payload,
    (k) => k === "continuationItemRenderer",
    maxDepth
  );

  for (const { val } of itemRenderers) {
    if (
      isRecord(val.continuationEndpoint) &&
      isRecord(val.continuationEndpoint.continuationCommand) &&
      typeof val.continuationEndpoint.continuationCommand.token === "string" &&
      val.continuationEndpoint.continuationCommand.token.length > 0
    ) {
      return val.continuationEndpoint.continuationCommand.token;
    }

    if (
      isRecord(val.continuationCommand) &&
      typeof val.continuationCommand.token === "string" &&
      val.continuationCommand.token.length > 0
    ) {
      return val.continuationCommand.token;
    }

    if (
      isRecord(val.nextContinuationData) &&
      typeof val.nextContinuationData.continuation === "string" &&
      val.nextContinuationData.continuation.length > 0
    ) {
      return val.nextContinuationData.continuation;
    }
  }

  // 2. Fallback to continuationCommand (skip reload UI commands from sorting chips)
  const commands = findNodesWithKeys(
    payload,
    (k) => k === "continuationCommand",
    maxDepth
  );

  for (const { val } of commands) {
    if (isRecord(val.command) && isRecord(val.command.showReloadUiCommand)) {
      continue;
    }
    if (typeof val.token === "string" && val.token.length > 0) {
      return val.token;
    }
  }

  // 3. Fallback to nextContinuationData / reloadContinuationData
  const continuationData = findNodesWithKeys(
    payload,
    (k) => k === "nextContinuationData" || k === "reloadContinuationData",
    maxDepth
  );

  for (const { val } of continuationData) {
    if (typeof val.continuation === "string" && val.continuation.length > 0) {
      return val.continuation;
    }
  }

  return undefined;
}

/**
 * Asynchronous generator that yields pages of VideoItem from YouTube channel
 * or playlist browse responses, following continuation tokens defensively.
 */
export async function* enumerateVideos(
  optionsOrBrowseId: string | EnumerateVideosOptions,
  maybeOptions?: EnumerateVideosOptions
): AsyncGenerator<VideoItem[], void, unknown> {
  const options: EnumerateVideosOptions =
    typeof optionsOrBrowseId === "string"
      ? { browseId: optionsOrBrowseId, ...maybeOptions }
      : optionsOrBrowseId;

  const maxDepth = options.maxDepth ?? 25;
  const maxPages = options.maxPages ?? Infinity;
  const signal = options.signal;

  const seenVideoIds = new Set<string>();
  const seenContinuationTokens = new Set<string>();
  let pagesYielded = 0;
  let currentToken: string | undefined;

  // Process initial page if pre-loaded data is provided
  if (options.initialData !== undefined) {
    if (signal?.aborted) {
      return;
    }

    const pageVideos = extractVideosFromBrowse(options.initialData, {
      maxDepth,
    });
    const newVideos: VideoItem[] = [];

    for (const v of pageVideos) {
      if (!seenVideoIds.has(v.videoId)) {
        seenVideoIds.add(v.videoId);
        newVideos.push(v);
      }
    }

    if (newVideos.length > 0) {
      pagesYielded++;
      yield newVideos;
    }

    currentToken =
      extractContinuationToken(options.initialData, { maxDepth }) ??
      options.initialContinuationToken;
  } else if (options.initialContinuationToken !== undefined) {
    currentToken = options.initialContinuationToken;
  } else if (options.browseId !== undefined) {
    if (!options.fetchPage) {
      throw createExtractionError(
        "UNKNOWN",
        "fetchPage required when initialData or initialContinuationToken is not provided"
      );
    }

    if (signal?.aborted) {
      return;
    }

    const pagePayload = await options.fetchPage({
      browseId: options.browseId,
      signal,
    });

    if (signal?.aborted) {
      return;
    }

    const pageVideos = extractVideosFromBrowse(pagePayload, { maxDepth });
    const newVideos: VideoItem[] = [];

    for (const v of pageVideos) {
      if (!seenVideoIds.has(v.videoId)) {
        seenVideoIds.add(v.videoId);
        newVideos.push(v);
      }
    }

    if (newVideos.length > 0) {
      pagesYielded++;
      yield newVideos;
    }

    currentToken = extractContinuationToken(pagePayload, { maxDepth });
  }

  // Iterate across continuation tokens
  while (
    currentToken !== undefined &&
    currentToken.length > 0 &&
    pagesYielded < maxPages
  ) {
    if (signal?.aborted) {
      return;
    }

    // Guard against infinite token cycles
    if (seenContinuationTokens.has(currentToken)) {
      break;
    }
    seenContinuationTokens.add(currentToken);

    let continuationPayload: unknown;

    if (options.fetchContinuation) {
      continuationPayload = await options.fetchContinuation(
        currentToken,
        signal
      );
    } else if (options.fetchPage) {
      continuationPayload = await options.fetchPage({
        continuationToken: currentToken,
        signal,
      });
    } else {
      throw createExtractionError(
        "UNKNOWN",
        "fetchContinuation or fetchPage required to follow continuation tokens"
      );
    }

    if (signal?.aborted) {
      return;
    }

    const pageVideos = extractVideosFromBrowse(continuationPayload, {
      maxDepth,
    });
    const newVideos: VideoItem[] = [];

    for (const v of pageVideos) {
      if (!seenVideoIds.has(v.videoId)) {
        seenVideoIds.add(v.videoId);
        newVideos.push(v);
      }
    }

    if (newVideos.length > 0) {
      pagesYielded++;
      yield newVideos;
    }

    const nextToken = extractContinuationToken(continuationPayload, {
      maxDepth,
    });
    if (!nextToken || nextToken === currentToken) {
      break;
    }

    currentToken = nextToken;
  }
}
