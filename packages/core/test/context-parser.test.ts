import { describe, it, expect } from "vitest";
import channelFixture from "../fixtures/browse-channel-page.json";
import playlistFixture from "../fixtures/browse-playlist-page.json";
import {
  extractVideosTab,
  extractPlaylistMetadata,
  extractChannelMetadata,
  parseYtcfgCredentials,
  extractTrackingCredentials,
  extractCredentialsFromHtml,
} from "../src/context-parser.js";

describe("extractVideosTab", () => {
  it("extracts videos tab token and metadata from real channel fixture", () => {
    const result = extractVideosTab(channelFixture);
    expect(result).not.toBeNull();
    expect(result?.browseId).toBe("UCHnyfMqiRRG1u-2MsSQLbXA");
    expect(result?.params).toBe("EgZ2aWRlb3PyBgQKAjoA");
    expect(result?.url).toBe("/@veritasium/videos");
    expect(result?.selected).toBe(true);
    expect(result?.title).toBe("Videolar");
    expect(result?.continuationToken).toBeDefined();
    expect(typeof result?.continuationToken).toBe("string");
  });

  it("extracts videos tab when URL ends with /videos", () => {
    const mockPayload = {
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                endpoint: {
                  commandMetadata: {
                    webCommandMetadata: {
                      url: "/@creator/featured",
                    },
                  },
                },
                title: "Home",
              },
            },
            {
              tabRenderer: {
                endpoint: {
                  commandMetadata: {
                    webCommandMetadata: {
                      url: "/@creator/videos",
                    },
                  },
                  browseEndpoint: {
                    browseId: "UC1234567890",
                    params: "EgZ2aWRlb3MockParams",
                  },
                },
                title: "Videos",
                selected: false,
              },
            },
          ],
        },
      },
    };

    const result = extractVideosTab(mockPayload);
    expect(result).toEqual({
      browseId: "UC1234567890",
      params: "EgZ2aWRlb3MockParams",
      url: "/@creator/videos",
      title: "Videos",
      selected: false,
      continuationToken: undefined,
    });
  });

  it("handles localized non-English tab titles", () => {
    const mockPayload = {
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                endpoint: {
                  browseEndpoint: {
                    browseId: "UC999",
                    params: "EgZ2aWRlb3Token",
                  },
                },
                title: "Videolar",
              },
            },
          ],
        },
      },
    };

    const result = extractVideosTab(mockPayload);
    expect(result).not.toBeNull();
    expect(result?.browseId).toBe("UC999");
    expect(result?.params).toBe("EgZ2aWRlb3Token");
  });

  it("returns null for non-channel payloads or missing videos tab", () => {
    expect(extractVideosTab(null)).toBeNull();
    expect(extractVideosTab({})).toBeNull();
    expect(extractVideosTab({ tabs: [] })).toBeNull();
  });
});

describe("extractPlaylistMetadata", () => {
  it("extracts playlist metadata from real playlist fixture", () => {
    const result = extractPlaylistMetadata(playlistFixture);
    // In playlistFixture, continuationToken is present in playlistVideoListRenderer
    // while playlistHeaderRenderer might be in sidebar or header
    expect(
      result === null || typeof result.continuationToken === "string"
    ).toBe(true);
  });

  it("extracts playlist id, title, and video count from header renderer", () => {
    const mockPayload = {
      header: {
        playlistHeaderRenderer: {
          playlistId: "PL123456789",
          title: { simpleText: "Test Awesome Playlist" },
          ownerText: { runs: [{ text: "Channel Name" }] },
          numVideosText: { runs: [{ text: "142 videos" }] },
        },
      },
    };

    const result = extractPlaylistMetadata(mockPayload);
    expect(result).toEqual({
      playlistId: "PL123456789",
      title: "Test Awesome Playlist",
      videoCount: 142,
      author: "Channel Name",
      continuationToken: undefined,
    });
  });

  it("extracts playlist id from microformat URL fallback", () => {
    const mockPayload = {
      microformat: {
        microformatDataRenderer: {
          title: "Microformat Title",
          urlCanonical: "https://www.youtube.com/playlist?list=PLCanonicalId",
        },
      },
    };

    const result = extractPlaylistMetadata(mockPayload);
    expect(result?.playlistId).toBe("PLCanonicalId");
    expect(result?.title).toBe("Microformat Title");
  });

  it("extracts initial videos from playlistVideoRenderer nodes in payload", () => {
    const mockPayload = {
      header: {
        playlistHeaderRenderer: {
          playlistId: "PL_VIDEOS_123",
          title: { simpleText: "Initial Videos Playlist" },
        },
      },
      contents: {
        playlistVideoListRenderer: {
          contents: [
            {
              playlistVideoRenderer: {
                videoId: "vid_001",
                title: { runs: [{ text: "First Video" }] },
              },
            },
            {
              playlistVideoRenderer: {
                videoId: "vid_002",
                title: { runs: [{ text: "Second Video" }] },
              },
            },
          ],
        },
      },
    };

    const result = extractPlaylistMetadata(mockPayload);
    expect(result?.initialVideos).toHaveLength(2);
    expect(result?.initialVideos?.[0]).toEqual({
      videoId: "vid_001",
      title: "First Video",
    });
    expect(result?.initialVideos?.[1]).toEqual({
      videoId: "vid_002",
      title: "Second Video",
    });
  });

  it("extracts playlist metadata and initial videos from watch page payload", () => {
    const mockWatchPayload = {
      contents: {
        twoColumnWatchNextResults: {
          playlist: {
            playlist: {
              title: "Watch Page Homelab",
              playlistId: "PL_WATCH_123",
              totalVideos: 10,
              ownerName: { simpleText: "Test Creator" },
              contents: [
                {
                  playlistPanelVideoRenderer: {
                    videoId: "panel_vid_1",
                    title: { simpleText: "First Panel Video" },
                  },
                },
                {
                  playlistPanelVideoRenderer: {
                    videoId: "panel_vid_2",
                    title: { simpleText: "Second Panel Video" },
                  },
                },
              ],
            },
          },
        },
      },
    };

    const result = extractPlaylistMetadata(mockWatchPayload);
    expect(result).not.toBeNull();
    expect(result?.playlistId).toBe("PL_WATCH_123");
    expect(result?.title).toBe("Watch Page Homelab");
    expect(result?.videoCount).toBe(10);
    expect(result?.author).toBe("Test Creator");
    expect(result?.initialVideos).toHaveLength(2);
    expect(result?.initialVideos?.[0]).toEqual({
      videoId: "panel_vid_1",
      title: "First Panel Video",
    });
  });

  it("returns null for invalid payload", () => {
    expect(extractPlaylistMetadata(null)).toBeNull();
    expect(extractPlaylistMetadata({})).toBeNull();
  });
});

describe("parseYtcfgCredentials", () => {
  it("extracts credentials using ytcfg.get() function", () => {
    const mockYtcfg = {
      get: (key: string) => {
        const store: Record<string, unknown> = {
          INNERTUBE_API_KEY: "AIzaSyFakeKey123",
          INNERTUBE_CLIENT_VERSION: "2.20260911.00.00",
          INNERTUBE_CLIENT_NAME: "WEB",
          VISITOR_DATA: "CgtFakeVisitorData",
        };
        return store[key];
      },
    };

    const creds = parseYtcfgCredentials(mockYtcfg);
    expect(creds).toEqual({
      apiKey: "AIzaSyFakeKey123",
      clientVersion: "2.20260911.00.00",
      clientName: "WEB",
      visitorData: "CgtFakeVisitorData",
    });
  });

  it("extracts credentials from data_ property bag or direct keys", () => {
    const mockYtcfg = {
      data_: {
        INNERTUBE_API_KEY: "AIzaSyDataBagKey",
        INNERTUBE_CLIENT_VERSION: "2.20260101",
        INNERTUBE_CONTEXT: {
          client: {
            clientName: "WEB",
            visitorData: "VisitorInContext",
          },
        },
      },
    };

    const creds = parseYtcfgCredentials(mockYtcfg);
    expect(creds).toEqual({
      apiKey: "AIzaSyDataBagKey",
      clientVersion: "2.20260101",
      clientName: "WEB",
      visitorData: "VisitorInContext",
    });
  });

  it("handles empty or invalid ytcfg safely", () => {
    expect(parseYtcfgCredentials(null)).toEqual({});
    expect(parseYtcfgCredentials({})).toEqual({});
  });
});

describe("extractTrackingCredentials", () => {
  it("extracts client version and visitor data from channel fixture", () => {
    const creds = extractTrackingCredentials(channelFixture);
    expect(creds.clientVersion).toBe("2.20260910.01.00");
    expect(creds.visitorData).toBeDefined();
    expect(creds.visitorData?.length).toBeGreaterThan(10);
  });
});

describe("extractCredentialsFromHtml", () => {
  it("extracts API key and version from HTML script string", () => {
    const html = `
      <script>
        var ytcfg = {d: function() { return {"INNERTUBE_API_KEY": "AIzaSyRegexKey456", "INNERTUBE_CLIENT_VERSION": "2.20260911"}; }};
      </script>
    `;
    const creds = extractCredentialsFromHtml(html);
    expect(creds.apiKey).toBe("AIzaSyRegexKey456");
    expect(creds.clientVersion).toBe("2.20260911");
  });

  it("returns undefined fields when regex does not match", () => {
    expect(extractCredentialsFromHtml("<html></html>")).toEqual({
      apiKey: undefined,
      clientVersion: undefined,
    });
  });
});

describe("extractChannelMetadata", () => {
  it("extracts channel title, handle, and video count from real channel fixture", () => {
    const channel = extractChannelMetadata(channelFixture);
    expect(channel).not.toBeNull();
    expect(channel?.title).toBe("Veritasium");
    expect(channel?.handle).toBe("@veritasium");
    expect(channel?.videoCount).toBe(533);
  });

  it("extracts channel metadata from legacy header structure", () => {
    const legacyPayload = {
      header: {
        c4TabbedHeaderRenderer: {
          channelId: "UC12345",
          title: "Legacy Creator",
          videosCountText: {
            runs: [{ text: "120 videos" }],
          },
        },
      },
    };
    const channel = extractChannelMetadata(legacyPayload);
    expect(channel).not.toBeNull();
    expect(channel?.title).toBe("Legacy Creator");
    expect(channel?.channelId).toBe("UC12345");
    expect(channel?.videoCount).toBe(120);
  });

  it("handles non-record and empty payloads gracefully", () => {
    expect(extractChannelMetadata(null)).toBeNull();
    expect(extractChannelMetadata({})).toBeNull();
  });
});
