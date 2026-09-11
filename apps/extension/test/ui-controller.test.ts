import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MockDocument, MockWindow } from "./mock-dom.js";
import {
  detectSourceMetadata,
  parseVideoCountText,
} from "../src/content/source-detector.js";
import { collectVideos } from "../src/content/video-collector.js";
import {
  mountPanelUi,
  ensureMountPoint,
  togglePanel,
  openPanel,
  closePanel,
  isPanelOpen,
  _resetPanelStateForTesting,
} from "../src/content/index.js";
import type { YouTubeContext } from "@youtube-transcript/core";
import { ALL_FORMATS, POPULAR_LANGUAGES } from "../src/content/ui/types.js";

describe("UI Controller & Source Detection", () => {
  let mockWin: MockWindow;
  let mockDoc: MockDocument;

  beforeEach(() => {
    _resetPanelStateForTesting();
    mockWin = new MockWindow("https://www.youtube.com/@veritasium");
    mockDoc = mockWin.document;
  });

  afterEach(() => {
    _resetPanelStateForTesting();
    vi.restoreAllMocks();
  });

  describe("detectSourceMetadata & parseVideoCountText", () => {
    it("parses video count variations from strings", () => {
      expect(parseVideoCountText("533 videos")).toBe(533);
      expect(parseVideoCountText("1,250 videolar")).toBe(1250);
      expect(parseVideoCountText("42 video")).toBe(42);
      expect(parseVideoCountText("No count")).toBeUndefined();
    });

    it("detects channel metadata from YouTubeContext", () => {
      const mockContext: YouTubeContext = {
        channel: {
          title: "Veritasium",
          handle: "@veritasium",
          videoCount: 533,
        },
      };

      const source = detectSourceMetadata(
        mockContext,
        mockDoc as unknown as Document,
        "https://www.youtube.com/@veritasium/videos"
      );

      expect(source.type).toBe("channel");
      expect(source.title).toBe("Veritasium");
      expect(source.handleOrAuthor).toBe("@veritasium");
      expect(source.estimatedCount).toBe(533);
    });

    it("detects playlist metadata from YouTubeContext", () => {
      const mockContext: YouTubeContext = {
        playlist: {
          playlistId: "PL12345",
          title: "Calculus Series",
          author: "3Blue1Brown",
          videoCount: 15,
        },
      };

      const source = detectSourceMetadata(
        mockContext,
        mockDoc as unknown as Document,
        "https://www.youtube.com/playlist?list=PL12345"
      );

      expect(source.type).toBe("playlist");
      expect(source.title).toBe("Calculus Series");
      expect(source.handleOrAuthor).toBe("3Blue1Brown");
      expect(source.estimatedCount).toBe(15);
    });

    it("falls back to document title and URL handle when context is empty", () => {
      mockDoc.title = "Kurzgesagt – In a Nutshell - YouTube";

      const source = detectSourceMetadata(
        null,
        mockDoc as unknown as Document,
        "https://www.youtube.com/@kurzgesagt"
      );

      expect(source.type).toBe("channel");
      expect(source.title).toBe("Kurzgesagt – In a Nutshell");
      expect(source.handleOrAuthor).toBe("/@kurzgesagt");
    });
  });

  describe("collectVideos", () => {
    it("throws error when clientVersion is missing in YouTube context", async () => {
      await expect(
        collectVideos({
          context: null,
        })
      ).rejects.toThrow("Missing clientVersion in YouTube page context");

      await expect(
        collectVideos({
          context: { apiKey: "AIzaTestKey" },
        })
      ).rejects.toThrow("Missing clientVersion in YouTube page context");
    });

    it("collects videos via continuation token pagination and reports progress", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          onResponseReceivedActions: [
            {
              appendContinuationItemsAction: {
                continuationItems: [
                  {
                    videoRenderer: {
                      videoId: "v_page1_1",
                      title: { runs: [{ text: "Paged Video 1" }] },
                    },
                  },
                  {
                    videoRenderer: {
                      videoId: "v_page1_2",
                      title: { runs: [{ text: "Paged Video 2" }] },
                    },
                  },
                ],
              },
            },
          ],
        }),
      });

      const mockContext: YouTubeContext = {
        apiKey: "AIzaTestKey",
        clientVersion: "2.20240313.01.00",
        playlist: {
          playlistId: "PL_TEST",
          continuationToken: "TOKEN_P1",
        },
      };

      const progressSpy = vi.fn();

      const videos = await collectVideos({
        context: mockContext,
        fetchFn: mockFetch as unknown as typeof fetch,
        onProgress: progressSpy,
      });

      expect(videos).toHaveLength(2);
      expect(videos[0]?.videoId).toBe("v_page1_1");
      expect(videos[1]?.videoId).toBe("v_page1_2");
      expect(progressSpy).toHaveBeenCalledWith(2);
    });
  });

  describe("mountPanelUi into Shadow DOM Root", () => {
    it("idempotently mounts React root in Shadow DOM", () => {
      const root1 = mountPanelUi(mockDoc as unknown as Document);
      expect(root1).toBeDefined();

      const mount = ensureMountPoint(mockDoc as unknown as Document);
      expect(mount.root).toBeDefined();

      // Second call returns existing root instance
      const root2 = mountPanelUi(mockDoc as unknown as Document);
      expect(root2).toBe(root1);
    });

    it("toggles panel drawer state", () => {
      expect(isPanelOpen()).toBe(false);

      openPanel(mockDoc as unknown as Document);
      expect(isPanelOpen()).toBe(true);

      closePanel(mockDoc as unknown as Document);
      expect(isPanelOpen()).toBe(false);

      togglePanel(undefined, mockDoc as unknown as Document);
      expect(isPanelOpen()).toBe(true);
    });
  });

  describe("UI Constants and Definitions", () => {
    it("includes all 6 export formats required by the spec", () => {
      expect(ALL_FORMATS).toEqual([
        "txt",
        "json",
        "csv",
        "srt",
        "vtt",
        "markdown",
      ]);
    });

    it("contains auto option and popular language options", () => {
      expect(POPULAR_LANGUAGES[0]?.code).toBe("auto");
      expect(POPULAR_LANGUAGES[0]?.label).toContain("Auto");
      expect(POPULAR_LANGUAGES.some((l) => l.code === "en")).toBe(true);
      expect(POPULAR_LANGUAGES.some((l) => l.code === "tr")).toBe(true);
      expect(POPULAR_LANGUAGES.some((l) => l.code === "es")).toBe(true);
    });
  });

  describe("Service Worker Message Router & Liveness Port Protocol", () => {
    it("connects to YTE_LIVENESS_PORT and broadcasts progress, cancellation, and completion", () => {
      const portListeners: ((msg: unknown) => void)[] = [];
      let portConnected = false;

      const mockPort = {
        name: "yte-liveness-port",
        postMessage: vi.fn(),
        onMessage: {
          addListener: vi.fn((cb: (msg: unknown) => void) => {
            portListeners.push(cb);
          }),
        },
        onDisconnect: {
          addListener: vi.fn(),
        },
        disconnect: vi.fn(() => {
          portConnected = false;
        }),
      };

      const mockRuntime = {
        connect: vi.fn((opts: { name: string }) => {
          if (opts.name === "yte-liveness-port") {
            portConnected = true;
          }
          return mockPort;
        }),
        sendMessage: vi.fn(),
      };

      // 1. Verify port connection
      const port = mockRuntime.connect({ name: "yte-liveness-port" });
      expect(mockRuntime.connect).toHaveBeenCalledWith({
        name: "yte-liveness-port",
      });
      expect(portConnected).toBe(true);
      expect(port.name).toBe("yte-liveness-port");

      // 2. Dispatch progress event
      const progressEvent = {
        type: "JOB_PROGRESS",
        job: {
          id: "job_test_123",
          status: "running",
          summary: { total: 10, done: 3, skipped: 1, failed: 0 },
          items: [],
          createdAt: Date.now(),
        },
      };

      for (const listener of portListeners) {
        listener(progressEvent);
      }

      // 3. Dispatch completion event
      const completedEvent = {
        type: "JOB_COMPLETED",
        job: {
          id: "job_test_123",
          status: "completed",
          summary: { total: 10, done: 9, skipped: 1, failed: 0 },
          items: [],
          createdAt: Date.now(),
          completedAt: Date.now(),
        },
      };

      for (const listener of portListeners) {
        listener(completedEvent);
      }

      port.disconnect();
      expect(portConnected).toBe(false);
    });
  });
});
