import { describe, it, expect, vi } from "vitest";
import browseChannelPage from "../fixtures/browse-channel-page.json";
import browseContinuation from "../fixtures/browse-continuation.json";
import browsePlaylistPage from "../fixtures/browse-playlist-page.json";
import {
  extractVideosFromBrowse,
  extractContinuationToken,
  extractTextFromTitle,
  enumerateVideos,
} from "../src/video-enumerator.js";
import type { AbortSignalLike, VideoItem } from "../src/types.js";

type GlobalWithAbortController = {
  AbortController: new () => {
    signal: AbortSignalLike;
    abort: () => void;
  };
};

function createAbortController(): { signal: AbortSignalLike; abort: () => void } {
  const g = globalThis as unknown as GlobalWithAbortController;
  return new g.AbortController();
}

describe("video-enumerator", () => {
  describe("extractTextFromTitle", () => {
    it("extracts text from simple string", () => {
      expect(extractTextFromTitle("Simple Title")).toBe("Simple Title");
    });

    it("extracts text from runs array", () => {
      const titleObj = {
        runs: [{ text: "Hello " }, { text: "World" }],
      };
      expect(extractTextFromTitle(titleObj)).toBe("Hello World");
    });

    it("extracts text from simpleText", () => {
      const titleObj = {
        simpleText: "Simple Text Title",
      };
      expect(extractTextFromTitle(titleObj)).toBe("Simple Text Title");
    });

    it("extracts text from content property", () => {
      const titleObj = {
        content: "Content Title",
      };
      expect(extractTextFromTitle(titleObj)).toBe("Content Title");
    });

    it("extracts text from lockupMetadataViewModel", () => {
      const meta = {
        lockupMetadataViewModel: {
          title: {
            content: "Lockup Title",
          },
        },
      };
      expect(extractTextFromTitle(meta)).toBe("Lockup Title");
    });

    it("returns empty string for invalid input", () => {
      expect(extractTextFromTitle(null)).toBe("");
      expect(extractTextFromTitle(undefined)).toBe("");
      expect(extractTextFromTitle(12345)).toBe("");
      expect(extractTextFromTitle({})).toBe("");
    });
  });

  describe("extractVideosFromBrowse", () => {
    it("extracts 30 videos from real browse-channel-page fixture", () => {
      const videos = extractVideosFromBrowse(browseChannelPage);
      expect(videos).toHaveLength(30);

      expect(videos[0]).toEqual({
        videoId: "J1WoNuemKOg",
        title: "We sent a camera to space to film the solar eclipse",
      });

      expect(videos[1]).toEqual({
        videoId: "wt4p2oalmRY",
        title: "Is spider web stronger than steel?",
      });

      expect(videos[29]).toEqual({
        videoId: "onr80iOoEXs",
        title: "Alfred Nobel: The Man Who Fooled The World",
      });
    });

    it("extracts 30 videos from real browse-continuation fixture", () => {
      const videos = extractVideosFromBrowse(browseContinuation);
      expect(videos).toHaveLength(30);

      expect(videos[0]).toEqual({
        videoId: "tZ8ehplVFp4",
        title: "Why Do Escalator Steps Have Teeth?",
      });

      expect(videos[29]).toEqual({
        videoId: "cUBz04LlLVk",
        title: "People said this experiment was impossible, so we tested it",
      });
    });

    it("extracts videos from real browse-playlist-page fixture", () => {
      const videos = extractVideosFromBrowse(browsePlaylistPage);
      expect(videos).toHaveLength(2);

      expect(videos[0]).toEqual({
        videoId: "pl_vid_001",
        title: "Playlist First Video",
      });

      expect(videos[1]).toEqual({
        videoId: "pl_vid_002",
        title: "Playlist Second Video",
      });
    });

    it("extracts from videoRenderer, gridVideoRenderer, and compactVideoRenderer nodes", () => {
      const payload = {
        sectionListRenderer: {
          contents: [
            {
              videoRenderer: {
                videoId: "vid_std_1",
                title: { runs: [{ text: "Standard Video" }] },
              },
            },
            {
              gridVideoRenderer: {
                videoId: "vid_grid_2",
                title: { simpleText: "Grid Video" },
              },
            },
            {
              compactVideoRenderer: {
                videoId: "vid_compact_3",
                headline: { simpleText: "Compact Video" },
              },
            },
            {
              // watchEndpoint fallback for videoId
              videoRenderer: {
                navigationEndpoint: {
                  watchEndpoint: {
                    videoId: "vid_endpoint_4",
                  },
                },
                title: "Endpoint Video",
              },
            },
          ],
        },
      };

      const videos = extractVideosFromBrowse(payload);
      expect(videos).toEqual([
        { videoId: "vid_std_1", title: "Standard Video" },
        { videoId: "vid_grid_2", title: "Grid Video" },
        { videoId: "vid_compact_3", title: "Compact Video" },
        { videoId: "vid_endpoint_4", title: "Endpoint Video" },
      ]);
    });

    it("skips non-video lockupViewModels", () => {
      const payload = {
        contents: [
          {
            lockupViewModel: {
              contentId: "playlist_123",
              contentType: "LOCKUP_CONTENT_TYPE_PLAYLIST",
              metadata: {
                lockupMetadataViewModel: {
                  title: { content: "My Playlist" },
                },
              },
            },
          },
          {
            lockupViewModel: {
              contentId: "video_123",
              contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
              metadata: {
                lockupMetadataViewModel: {
                  title: { content: "Valid Video" },
                },
              },
            },
          },
        ],
      };

      const videos = extractVideosFromBrowse(payload);
      expect(videos).toHaveLength(1);
      expect(videos[0]?.videoId).toBe("video_123");
    });

    it("deduplicates video IDs within the same response", () => {
      const payload = {
        contents: [
          {
            videoRenderer: {
              videoId: "duplicate_id",
              title: "Duplicate 1",
            },
          },
          {
            videoRenderer: {
              videoId: "duplicate_id",
              title: "Duplicate 2",
            },
          },
        ],
      };

      const videos = extractVideosFromBrowse(payload);
      expect(videos).toHaveLength(1);
      expect(videos[0]?.title).toBe("Duplicate 1");
    });

    it("returns empty array for invalid or non-object payloads", () => {
      expect(extractVideosFromBrowse(null)).toEqual([]);
      expect(extractVideosFromBrowse(undefined)).toEqual([]);
      expect(extractVideosFromBrowse("invalid")).toEqual([]);
      expect(extractVideosFromBrowse(42)).toEqual([]);
      expect(extractVideosFromBrowse({})).toEqual([]);
    });
  });

  describe("extractContinuationToken", () => {
    it("extracts token from real browse-channel-page fixture", () => {
      const token = extractContinuationToken(browseChannelPage);
      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token?.startsWith("4qmFsgLZ")).toBe(true);
    });

    it("extracts token from real browse-continuation fixture", () => {
      const token = extractContinuationToken(browseContinuation);
      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token?.startsWith("4qmFsgLB")).toBe(true);
    });

    it("extracts token from playlist fixture", () => {
      const token = extractContinuationToken(browsePlaylistPage);
      expect(token).toBe("4qmFsgPlaylistContinuationToken123");
    });

    it("ignores reload UI tokens from channel sorting chips", () => {
      const payloadWithChipOnly = {
        chipBarViewModel: {
          chips: [
            {
              continuationCommand: {
                token: "CHIP_TOKEN_SHOULD_BE_IGNORED",
                request: "CONTINUATION_REQUEST_TYPE_BROWSE",
                command: {
                  showReloadUiCommand: { targetId: "target-123" },
                },
              },
            },
          ],
        },
      };

      expect(extractContinuationToken(payloadWithChipOnly)).toBeUndefined();
    });

    it("extracts from nextContinuationData", () => {
      const payload = {
        continuationItemRenderer: {
          nextContinuationData: {
            continuation: "NEXT_DATA_TOKEN_123",
          },
        },
      };

      expect(extractContinuationToken(payload)).toBe("NEXT_DATA_TOKEN_123");
    });

    it("returns undefined when no continuation is present", () => {
      expect(extractContinuationToken({ contents: [] })).toBeUndefined();
      expect(extractContinuationToken(null)).toBeUndefined();
      expect(extractContinuationToken("")).toBeUndefined();
    });
  });

  describe("enumerateVideos async generator", () => {
    it("paginates across real fixtures without network access", async () => {
      const fetchContinuationMock = vi
        .fn()
        .mockImplementation(async (token: string) => {
          expect(token.startsWith("4qmFsgLZ")).toBe(true);
          return browseContinuation;
        });

      const pages: VideoItem[][] = [];

      for await (const page of enumerateVideos({
        initialData: browseChannelPage,
        fetchContinuation: fetchContinuationMock,
        maxPages: 2,
      })) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(pages[0]).toHaveLength(30);
      expect(pages[1]).toHaveLength(30);

      expect(pages[0]?.[0]?.videoId).toBe("J1WoNuemKOg");
      expect(pages[1]?.[0]?.videoId).toBe("tZ8ehplVFp4");

      expect(fetchContinuationMock).toHaveBeenCalledTimes(1);
    });

    it("enumerates starting from browseId with fetchPage", async () => {
      const fetchPageMock = vi
        .fn()
        .mockImplementation(
          async ({
            browseId,
            continuationToken,
          }: {
            browseId?: string;
            continuationToken?: string;
          }) => {
            if (browseId === "UC_CHANNEL_TEST") {
              return browseChannelPage;
            }
            if (continuationToken?.startsWith("4qmFsgLZ")) {
              return browseContinuation;
            }
            return { contents: [] };
          }
        );

      const pages: VideoItem[][] = [];

      for await (const page of enumerateVideos("UC_CHANNEL_TEST", {
        fetchPage: fetchPageMock,
        maxPages: 2,
      })) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(pages[0]?.[0]?.videoId).toBe("J1WoNuemKOg");
      expect(pages[1]?.[0]?.videoId).toBe("tZ8ehplVFp4");

      expect(fetchPageMock).toHaveBeenCalledTimes(2);
      expect(fetchPageMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ browseId: "UC_CHANNEL_TEST" })
      );
      expect(fetchPageMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          continuationToken: expect.stringMatching(/^4qmFsgLZ/),
        })
      );
    });

    it("terminates when continuation tokens are exhausted", async () => {
      // Create a continuation payload that has no next continuationItemRenderer
      const terminalContinuation = {
        contents: [
          {
            videoRenderer: {
              videoId: "final_vid",
              title: "Final Video",
            },
          },
        ],
      };

      const fetchContinuationMock = vi
        .fn()
        .mockResolvedValueOnce(terminalContinuation);

      const pages: VideoItem[][] = [];

      for await (const page of enumerateVideos({
        initialData: browsePlaylistPage,
        fetchContinuation: fetchContinuationMock,
      })) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(pages[0]).toHaveLength(2);
      expect(pages[1]).toHaveLength(1);
      expect(pages[1]?.[0]?.videoId).toBe("final_vid");

      // Should stop after terminalContinuation since it has no continuation token
      expect(fetchContinuationMock).toHaveBeenCalledTimes(1);
    });

    it("terminates on continuation token loop to prevent infinite cycle", async () => {
      const loopingContinuation = {
        continuationItemRenderer: {
          continuationEndpoint: {
            continuationCommand: {
              token: "LOOPING_TOKEN",
            },
          },
        },
        videoRenderer: {
          videoId: "vid_loop_1",
          title: "Loop 1",
        },
      };

      const fetchContinuationMock = vi
        .fn()
        .mockResolvedValue(loopingContinuation);

      const pages: VideoItem[][] = [];

      for await (const page of enumerateVideos({
        initialContinuationToken: "LOOPING_TOKEN",
        fetchContinuation: fetchContinuationMock,
      })) {
        pages.push(page);
      }

      // First fetch uses LOOPING_TOKEN and returns LOOPING_TOKEN again.
      // Generator breaks out of loop instead of running forever.
      expect(pages).toHaveLength(1);
      expect(fetchContinuationMock).toHaveBeenCalledTimes(1);
    });

    it("deduplicates video items across pagination boundaries", async () => {
      const page1 = {
        videoRenderer: { videoId: "vid_overlap", title: "Overlap Video" },
        continuationItemRenderer: {
          continuationCommand: { token: "TOKEN_2" },
        },
      };

      const page2 = {
        contents: [
          { videoRenderer: { videoId: "vid_overlap", title: "Overlap Video" } },
          { videoRenderer: { videoId: "vid_unique", title: "Unique Video" } },
        ],
      };

      const fetchContinuationMock = vi.fn().mockResolvedValueOnce(page2);

      const pages: VideoItem[][] = [];

      for await (const page of enumerateVideos({
        initialData: page1,
        fetchContinuation: fetchContinuationMock,
      })) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(pages[0]).toEqual([
        { videoId: "vid_overlap", title: "Overlap Video" },
      ]);
      expect(pages[1]).toEqual([
        { videoId: "vid_unique", title: "Unique Video" },
      ]);
    });

    it("respects maxPages limit", async () => {
      const fetchContinuationMock = vi.fn().mockResolvedValue(browseContinuation);

      const pages: VideoItem[][] = [];

      for await (const page of enumerateVideos({
        initialData: browseChannelPage,
        fetchContinuation: fetchContinuationMock,
        maxPages: 1,
      })) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(fetchContinuationMock).not.toHaveBeenCalled();
    });

    it("stops cleanly when AbortSignal is triggered", async () => {
      const abortController = createAbortController();

      const fetchContinuationMock = vi
        .fn()
        .mockImplementation(async () => {
          abortController.abort();
          return browseContinuation;
        });

      const pages: VideoItem[][] = [];

      for await (const page of enumerateVideos({
        initialData: browseChannelPage,
        fetchContinuation: fetchContinuationMock,
        signal: abortController.signal,
      })) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(fetchContinuationMock).toHaveBeenCalledTimes(1);
    });

    it("throws typed ExtractionError if fetchPage is missing when needed", async () => {
      const generator = enumerateVideos({
        browseId: "UC_NO_FETCHER",
      });

      await expect(async () => {
        await generator.next();
      }).rejects.toMatchObject({
        code: "UNKNOWN",
        message: expect.stringContaining("fetchPage required"),
      });
    });
  });
});
