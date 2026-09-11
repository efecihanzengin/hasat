import type {
  ChannelMetadata,
  PlaylistMetadata,
  VideosTabInfo,
} from "./types.js";
import {
  extractContinuationToken,
  extractTextFromTitle,
  extractVideosFromBrowse,
} from "./video-enumerator.js";

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
 * Checks if a tabRenderer represents the "Videos" tab on a channel page.
 * Uses URL pattern, protobuf parameter signature, and fallback title match.
 */
function isVideosTab(val: Record<string, unknown>): boolean {
  // 1. Check endpoint URL (e.g. "/@channel/videos")
  if (isRecord(val.endpoint)) {
    if (
      isRecord(val.endpoint.commandMetadata) &&
      isRecord(val.endpoint.commandMetadata.webCommandMetadata) &&
      typeof val.endpoint.commandMetadata.webCommandMetadata.url === "string"
    ) {
      const url = val.endpoint.commandMetadata.webCommandMetadata.url;
      if (/\/videos(\?.*)?$/.test(url)) {
        return true;
      }
    }

    if (isRecord(val.endpoint.browseEndpoint)) {
      const canonical = val.endpoint.browseEndpoint.canonicalBaseUrl;
      if (typeof canonical === "string" && /\/videos(\?.*)?$/.test(canonical)) {
        return true;
      }

      // Check base64 protobuf params for 'videos' tag (field 2 string = 0x12 0x06 'videos' -> 'EgZ2aWRlb3')
      const params = val.endpoint.browseEndpoint.params;
      if (typeof params === "string" && params.startsWith("EgZ2aWRlb3")) {
        return true;
      }
    }
  }

  // 2. Check tab identifier or title as fallback
  const title = extractTextFromTitle(val.title).toLowerCase().trim();
  if (title === "videos" || title === "videolar" || title === "vidéos") {
    return true;
  }

  return false;
}

/**
 * Defensively extracts the "Videos" tab token and metadata from a YouTube channel browse response.
 */
export function extractVideosTab(
  payload: unknown,
  options?: { maxDepth?: number }
): VideosTabInfo | null {
  if (!isRecord(payload)) {
    return null;
  }

  const maxDepth = options?.maxDepth ?? 25;
  const tabNodes = findNodesWithKeys(
    payload,
    (k) => k === "tabRenderer" || k === "expandableTabRenderer",
    maxDepth
  );

  for (const { val } of tabNodes) {
    if (!isVideosTab(val)) {
      continue;
    }

    let browseId: string | undefined;
    let params = "";
    let url: string | undefined;

    if (isRecord(val.endpoint)) {
      if (isRecord(val.endpoint.browseEndpoint)) {
        if (typeof val.endpoint.browseEndpoint.browseId === "string") {
          browseId = val.endpoint.browseEndpoint.browseId;
        }
        if (typeof val.endpoint.browseEndpoint.params === "string") {
          params = val.endpoint.browseEndpoint.params;
        }
      }

      if (
        isRecord(val.endpoint.commandMetadata) &&
        isRecord(val.endpoint.commandMetadata.webCommandMetadata) &&
        typeof val.endpoint.commandMetadata.webCommandMetadata.url === "string"
      ) {
        url = val.endpoint.commandMetadata.webCommandMetadata.url;
      }
    }

    const title = extractTextFromTitle(val.title);
    const selected = val.selected === true;
    let continuationToken: string | undefined;

    if (selected && isRecord(val.content)) {
      continuationToken = extractContinuationToken(val.content, { maxDepth });
    }

    if (params.length > 0 || browseId !== undefined) {
      return {
        browseId,
        params,
        url,
        title: title.length > 0 ? title : undefined,
        selected,
        continuationToken,
      };
    }
  }

  return null;
}

/**
 * Defensively extracts playlist metadata from a YouTube playlist browse response.
 */
export function extractPlaylistMetadata(
  payload: unknown,
  options?: { maxDepth?: number }
): PlaylistMetadata | null {
  if (!isRecord(payload)) {
    return null;
  }

  const maxDepth = options?.maxDepth ?? 25;
  let playlistId: string | undefined;
  let title: string | undefined;
  let videoCount: number | undefined;
  let author: string | undefined;

  // 1. Search for playlistHeaderRenderer or playlistMetadataRenderer
  const headerNodes = findNodesWithKeys(
    payload,
    (k) =>
      k === "playlistHeaderRenderer" ||
      k === "playlistMetadataRenderer" ||
      k === "microformatDataRenderer",
    maxDepth
  );

  for (const { key, val } of headerNodes) {
    if (key === "playlistHeaderRenderer") {
      if (typeof val.playlistId === "string") {
        playlistId = val.playlistId;
      }
      if (!title) {
        const t = extractTextFromTitle(val.title);
        if (t.length > 0) title = t;
      }
      if (!author && isRecord(val.ownerText)) {
        const a = extractTextFromTitle(val.ownerText);
        if (a.length > 0) author = a;
      }
      if (videoCount === undefined) {
        const countText = extractTextFromTitle(val.numVideosText);
        const match = countText.replace(/,/g, "").match(/\d+/);
        if (match) {
          videoCount = parseInt(match[0], 10);
        }
      }
    } else if (key === "playlistMetadataRenderer") {
      if (!title && typeof val.title === "string") {
        title = val.title;
      }
    } else if (key === "microformatDataRenderer") {
      if (!title && typeof val.title === "string") {
        title = val.title;
      }
      if (!playlistId && typeof val.urlCanonical === "string") {
        const listMatch = /[?&]list=([^&#]+)/.exec(val.urlCanonical);
        if (listMatch && listMatch[1]) {
          playlistId = listMatch[1];
        }
      }
    }
  }

  // 2. Check for continuation token & initial videos
  const continuationToken = extractContinuationToken(payload, { maxDepth });
  const initialVideos = extractVideosFromBrowse(payload, { maxDepth });

  if (playlistId) {
    return {
      playlistId,
      title,
      videoCount,
      author,
      continuationToken,
      initialVideos: initialVideos.length > 0 ? initialVideos : undefined,
    };
  }

  return null;
}

/**
 * Defensively extracts channel metadata from a YouTube channel browse response or header.
 * Handles pageHeaderRenderer (modern), c4TabbedHeaderRenderer, and channelHeaderRenderer (legacy).
 */
export function extractChannelMetadata(
  payload: unknown,
  options?: { maxDepth?: number }
): ChannelMetadata | null {
  if (!isRecord(payload)) {
    return null;
  }

  const maxDepth = options?.maxDepth ?? 25;
  let title: string | undefined;
  let handle: string | undefined;
  let videoCount: number | undefined;
  let channelId: string | undefined;

  const headerNodes = findNodesWithKeys(
    payload,
    (k) =>
      k === "pageHeaderRenderer" ||
      k === "c4TabbedHeaderRenderer" ||
      k === "channelHeaderRenderer" ||
      k === "channelMetadataRenderer",
    maxDepth
  );

  for (const { key, val } of headerNodes) {
    if (key === "pageHeaderRenderer") {
      if (typeof val.pageTitle === "string" && !title) {
        title = val.pageTitle;
      }
      if (isRecord(val.content) && isRecord(val.content.pageHeaderViewModel)) {
        const vm = val.content.pageHeaderViewModel;
        if (!title && isRecord(vm.title)) {
          const t = extractTextFromTitle(vm.title);
          if (t) title = t;
        }
        if (
          isRecord(vm.metadata) &&
          isRecord(vm.metadata.contentMetadataViewModel)
        ) {
          const rows = vm.metadata.contentMetadataViewModel.metadataRows;
          if (Array.isArray(rows)) {
            for (const row of rows) {
              if (!isRecord(row) || !Array.isArray(row.metadataParts)) continue;
              for (const part of row.metadataParts) {
                if (!isRecord(part)) continue;
                const text = extractTextFromTitle(part.text ?? part);
                if (!handle && text.startsWith("@")) {
                  handle = text;
                } else if (videoCount === undefined && /video/i.test(text)) {
                  const match = text.replace(/,/g, "").match(/\d+/);
                  if (match) {
                    videoCount = parseInt(match[0], 10);
                  }
                }
              }
            }
          }
        }
      }
    } else if (
      key === "c4TabbedHeaderRenderer" ||
      key === "channelHeaderRenderer"
    ) {
      if (!title && val.title) {
        const t = extractTextFromTitle(val.title);
        if (t) title = t;
      }
      if (!channelId && typeof val.channelId === "string") {
        channelId = val.channelId;
      }
      if (videoCount === undefined) {
        const countText = extractTextFromTitle(
          val.videosCountText ?? val.videoCountText
        );
        const match = countText.replace(/,/g, "").match(/\d+/);
        if (match) {
          videoCount = parseInt(match[0], 10);
        }
      }
    } else if (key === "channelMetadataRenderer") {
      if (!title && typeof val.title === "string") {
        title = val.title;
      }
      if (!channelId && typeof val.externalId === "string") {
        channelId = val.externalId;
      }
      if (!handle && typeof val.vanityChannelUrl === "string") {
        const match = val.vanityChannelUrl.match(/@([^/?#]+)/);
        if (match) {
          handle = `@${match[1]}`;
        }
      }
    }
  }

  if (title || handle || videoCount !== undefined || channelId) {
    return {
      title,
      handle,
      videoCount,
      channelId,
    };
  }

  return null;
}

/**
 * Extracts runtime credentials from an in-memory `window.ytcfg` representation.
 */
export function parseYtcfgCredentials(ytcfg: unknown): {
  apiKey?: string;
  clientVersion?: string;
  clientName?: string;
  visitorData?: string;
} {
  if (!isRecord(ytcfg)) {
    return {};
  }

  let apiKey: string | undefined;
  let clientVersion: string | undefined;
  let clientName: string | undefined;
  let visitorData: string | undefined;

  // 1. Try ytcfg.get(key) if available
  if (typeof ytcfg.get === "function") {
    const fn = ytcfg.get as (key: string) => unknown;
    const k = fn("INNERTUBE_API_KEY");
    if (typeof k === "string" && k.length > 0) apiKey = k;

    const v = fn("INNERTUBE_CLIENT_VERSION");
    if (typeof v === "string" && v.length > 0) clientVersion = v;

    const n = fn("INNERTUBE_CLIENT_NAME");
    if (typeof n === "string" && n.length > 0) clientName = n;

    const vis = fn("VISITOR_DATA");
    if (typeof vis === "string" && vis.length > 0) visitorData = vis;

    const ctx = fn("INNERTUBE_CONTEXT");
    if (isRecord(ctx) && isRecord(ctx.client)) {
      if (!clientVersion && typeof ctx.client.clientVersion === "string") {
        clientVersion = ctx.client.clientVersion;
      }
      if (!clientName && typeof ctx.client.clientName === "string") {
        clientName = ctx.client.clientName;
      }
      if (!visitorData && typeof ctx.client.visitorData === "string") {
        visitorData = ctx.client.visitorData;
      }
    }
  }

  // 2. Try ytcfg.data_ property bag
  const dataBag = isRecord(ytcfg.data_) ? ytcfg.data_ : ytcfg;

  if (!apiKey && typeof dataBag.INNERTUBE_API_KEY === "string") {
    apiKey = dataBag.INNERTUBE_API_KEY;
  }
  if (!clientVersion && typeof dataBag.INNERTUBE_CLIENT_VERSION === "string") {
    clientVersion = dataBag.INNERTUBE_CLIENT_VERSION;
  }
  if (!clientName && typeof dataBag.INNERTUBE_CLIENT_NAME === "string") {
    clientName = dataBag.INNERTUBE_CLIENT_NAME;
  }
  if (!visitorData && typeof dataBag.VISITOR_DATA === "string") {
    visitorData = dataBag.VISITOR_DATA;
  }

  if (
    isRecord(dataBag.INNERTUBE_CONTEXT) &&
    isRecord(dataBag.INNERTUBE_CONTEXT.client)
  ) {
    const cl = dataBag.INNERTUBE_CONTEXT.client;
    if (!clientVersion && typeof cl.clientVersion === "string") {
      clientVersion = cl.clientVersion;
    }
    if (!clientName && typeof cl.clientName === "string") {
      clientName = cl.clientName;
    }
    if (!visitorData && typeof cl.visitorData === "string") {
      visitorData = cl.visitorData;
    }
  }

  return { apiKey, clientVersion, clientName, visitorData };
}

/**
 * Extracts tracking parameter fallbacks (e.g. cver, visitorData) from a browse payload.
 */
export function extractTrackingCredentials(payload: unknown): {
  clientVersion?: string;
  visitorData?: string;
} {
  if (!isRecord(payload)) {
    return {};
  }

  let clientVersion: string | undefined;
  let visitorData: string | undefined;

  if (isRecord(payload.responseContext)) {
    const rc = payload.responseContext;
    if (Array.isArray(rc.serviceTrackingParams)) {
      for (const svc of rc.serviceTrackingParams) {
        if (!isRecord(svc) || !Array.isArray(svc.params)) continue;
        for (const p of svc.params) {
          if (
            !isRecord(p) ||
            typeof p.key !== "string" ||
            typeof p.value !== "string"
          )
            continue;
          if (p.key === "cver" && !clientVersion) {
            clientVersion = p.value;
          }
          if (p.key === "client.version" && !clientVersion) {
            clientVersion = p.value;
          }
          if (p.key === "visitor_data" && !visitorData) {
            visitorData = p.value;
          }
        }
      }
    }

    if (
      !visitorData &&
      isRecord(rc.webResponseContextExtensionData) &&
      isRecord(rc.webResponseContextExtensionData.ytConfigData) &&
      typeof rc.webResponseContextExtensionData.ytConfigData.visitorData ===
        "string"
    ) {
      visitorData = rc.webResponseContextExtensionData.ytConfigData.visitorData;
    }
  }

  return { clientVersion, visitorData };
}

/**
 * Defensive regex fallback to scan raw HTML / script contents for API key and client version.
 */
export function extractCredentialsFromHtml(html: string): {
  apiKey?: string;
  clientVersion?: string;
} {
  let apiKey: string | undefined;
  let clientVersion: string | undefined;

  const keyMatch = /"INNERTUBE_API_KEY":\s*"([^"]+)"/.exec(html);
  if (keyMatch && keyMatch[1]) {
    apiKey = keyMatch[1];
  }

  const verMatch = /"INNERTUBE_CLIENT_VERSION":\s*"([^"]+)"/.exec(html);
  if (verMatch && verMatch[1]) {
    clientVersion = verMatch[1];
  }

  return { apiKey, clientVersion };
}
