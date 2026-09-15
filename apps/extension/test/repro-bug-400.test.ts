import { describe, it, expect, vi } from "vitest";
import { extractPlaylistMetadata } from "@youtube-transcript/core";
import { collectVideos } from "../src/content/video-collector.js";
import type { YouTubeContext } from "@youtube-transcript/core";

describe("Bug Reproduction: InnerTube browse 400 and stale job persistence", () => {
  describe("Bug 2: InnerTube browse 400 on playlist with ~20 videos and comments continuation", () => {
    // A realistic YouTube playlist page with ~20 videos in playlistVideoListRenderer
    // and an unrelated continuationItemRenderer elsewhere in the payload (e.g. comments or recommendations)
    const playlistWith20VideosAndCommentsContinuation = {
      header: {
        playlistHeaderRenderer: {
          playlistId: "PL_HOMELAB_20",
          title: { simpleText: "My Kubernetes Homelab" },
          ownerText: { runs: [{ text: "Mischa van den Burg" }] },
          numVideosText: { runs: [{ text: "20 videos" }] },
        },
      },
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  sectionListRenderer: {
                    contents: [
                      {
                        itemSectionRenderer: {
                          contents: [
                            {
                              playlistVideoListRenderer: {
                                contents: Array.from({ length: 20 }, (_, i) => ({
                                  playlistVideoRenderer: {
                                    videoId: `video_${i + 1}`,
                                    title: { simpleText: `Homelab Video #${i + 1}` },
                                  },
                                })),
                                // Notice: NO continuationItemRenderer here, because all 20 videos are loaded!
                              },
                            },
                          ],
                        },
                      },
                      // Unrelated section with comments or guide continuation
                      {
                        itemSectionRenderer: {
                          contents: [
                            {
                              continuationItemRenderer: {
                                continuationEndpoint: {
                                  continuationCommand: {
                                    token: "COMMENTS_OR_GUIDE_CONTINUATION_TOKEN_BAD_FOR_BROWSE",
                                    request: "CONTINUATION_REQUEST_TYPE_WATCH_NEXT",
                                  },
                                },
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    };

    it("should NOT extract unrelated continuation token for a fully-loaded 20-video playlist", () => {
      const meta = extractPlaylistMetadata(playlistWith20VideosAndCommentsContinuation);
      expect(meta).not.toBeNull();
      expect(meta?.initialVideos).toHaveLength(20);
      // FAILS CURRENTLY: extractPlaylistMetadata picks up COMMENTS_OR_GUIDE_CONTINUATION_TOKEN_BAD_FOR_BROWSE
      expect(meta?.continuationToken).toBeUndefined();
    });

    it("collectVideos should NOT trigger InnerTube browse 400 when initial 20 videos are present", async () => {
      const meta = extractPlaylistMetadata(playlistWith20VideosAndCommentsContinuation);

      const mockFetch = vi.fn().mockImplementation(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || "{}")) as { continuation?: string };
        if (body.continuation?.includes("BAD_FOR_BROWSE")) {
          // InnerTube returns 400 Bad Request for comments/unrelated tokens
          return {
            status: 400,
            ok: false,
            json: async () => ({
              error: {
                code: 400,
                message: "Invalid continuation token",
                status: "INVALID_ARGUMENT",
              },
            }),
          } as Response;
        }
        return {
          status: 200,
          ok: true,
          json: async () => ({}),
        } as Response;
      });

      const context: YouTubeContext = {
        apiKey: "AIzaValidKey",
        clientVersion: "2.20240313.01.00",
        playlist: meta ?? undefined,
      };

      // FAILS CURRENTLY: collectVideos fetches continuation and throws "InnerTube browse failed with status 400"
      const videos = await collectVideos({
        context,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(videos).toHaveLength(20);
      expect(videos[0]?.videoId).toBe("video_1");
      expect(videos[19]?.videoId).toBe("video_20");
    });
  });
});
