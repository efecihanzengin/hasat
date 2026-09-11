import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  extractYouTubeContextFromWindow,
  setupMainWorldBridge,
  type WindowLike,
} from "../src/content/main-world.js";
import {
  initIsolatedBridge,
  getLastKnownContext,
  setLastKnownContext,
  requestYouTubeContext,
} from "../src/content/bridge.js";

class MockWindow extends EventTarget implements WindowLike {
  ytcfg?: unknown;
  ytInitialData?: unknown;
  document?: {
    scripts?: Array<{ textContent?: string | null; innerHTML?: string | null }>;
  };

  postMessage(message: unknown): void {
    // Dispatch as MessageEvent asynchronously to mimic real browser behavior
    setTimeout(() => {
      const event = new MessageEvent("message", { data: message });
      this.dispatchEvent(event);
    }, 0);
  }
}

describe("Main World Context Extraction Bridge", () => {
  let mockWin: MockWindow;

  beforeEach(() => {
    vi.useFakeTimers();
    setLastKnownContext(null);
    mockWin = new MockWindow();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setLastKnownContext(null);
  });

  it("extracts full context directly when ytcfg and ytInitialData are present", () => {
    mockWin.ytcfg = {
      get: (key: string) => {
        const data: Record<string, string> = {
          INNERTUBE_API_KEY: "AIzaTestKey123",
          INNERTUBE_CLIENT_VERSION: "2.20260911.01.00",
          INNERTUBE_CLIENT_NAME: "WEB",
          VISITOR_DATA: "CgtVisitorData123",
        };
        return data[key];
      },
    };

    mockWin.ytInitialData = {
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                endpoint: {
                  commandMetadata: {
                    webCommandMetadata: {
                      url: "/@testchannel/videos",
                    },
                  },
                  browseEndpoint: {
                    browseId: "UC_TestChannelId",
                    params: "EgZ2aWRlb3PyBgQKAjoA",
                  },
                },
                title: "Videos",
                selected: true,
              },
            },
          ],
        },
      },
    };

    const ctx = extractYouTubeContextFromWindow(mockWin);
    expect(ctx.apiKey).toBe("AIzaTestKey123");
    expect(ctx.clientVersion).toBe("2.20260911.01.00");
    expect(ctx.clientName).toBe("WEB");
    expect(ctx.visitorData).toBe("CgtVisitorData123");
    expect(ctx.videosTab).toEqual({
      browseId: "UC_TestChannelId",
      params: "EgZ2aWRlb3PyBgQKAjoA",
      url: "/@testchannel/videos",
      title: "Videos",
      selected: true,
      continuationToken: undefined,
    });
  });

  it("extracts context with defensive fallbacks when ytcfg.get is missing", () => {
    mockWin.ytcfg = {
      data_: {
        INNERTUBE_API_KEY: "AIzaFallbackDataBagKey",
        INNERTUBE_CLIENT_VERSION: "2.20260101.00.00",
      },
    };

    mockWin.ytInitialData = {
      responseContext: {
        serviceTrackingParams: [
          {
            service: "GFEEDBACK",
            params: [{ key: "visitor_data", value: "CgtTrackingVisitor" }],
          },
        ],
      },
    };

    const ctx = extractYouTubeContextFromWindow(mockWin);
    expect(ctx.apiKey).toBe("AIzaFallbackDataBagKey");
    expect(ctx.clientVersion).toBe("2.20260101.00.00");
    expect(ctx.visitorData).toBe("CgtTrackingVisitor");
  });

  it("falls back to document script scanning when ytcfg is incomplete", () => {
    mockWin.ytcfg = {};
    mockWin.document = {
      scripts: [
        {
          textContent:
            'window["ytcfg"] = {"INNERTUBE_API_KEY": "AIzaFromScriptTag", "INNERTUBE_CLIENT_VERSION": "2.20260909"};',
        },
      ],
    };

    const ctx = extractYouTubeContextFromWindow(mockWin);
    expect(ctx.apiKey).toBe("AIzaFromScriptTag");
    expect(ctx.clientVersion).toBe("2.20260909");
  });

  it("successfully passes extracted context across postMessage bridge", async () => {
    mockWin.ytcfg = {
      get: (k: string) =>
        k === "INNERTUBE_API_KEY" ? "AIzaBridgeKey" : undefined,
    };

    const cleanupMain = setupMainWorldBridge(mockWin);

    const promise = requestYouTubeContext({
      targetWindow: mockWin,
      timeoutMs: 1000,
    });

    // Advance fake timers so postMessage setTimeout(..., 0) runs
    await vi.advanceTimersByTimeAsync(10);

    const result = await promise;
    expect(result.apiKey).toBe("AIzaBridgeKey");
    expect(getLastKnownContext()?.apiKey).toBe("AIzaBridgeKey");

    cleanupMain();
  });

  it("times out and rejects when main world bridge does not respond", async () => {
    // No setupMainWorldBridge -> no listener to respond
    const promise = requestYouTubeContext({
      targetWindow: mockWin,
      timeoutMs: 500,
    });

    // Advance timers past timeout
    const timeoutAssertion = expect(promise).rejects.toMatchObject({
      code: "UNKNOWN",
      message: expect.stringContaining(
        "Timeout waiting for main world bridge response (500ms)"
      ),
    });

    await vi.advanceTimersByTimeAsync(550);

    await timeoutAssertion;
  });

  it("ignores irrelevant foreign window messages", async () => {
    const cleanupMain = setupMainWorldBridge(mockWin);

    // Send a foreign message
    mockWin.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "youtube-player", type: "ON_PLAY", videoId: "123" },
      })
    );

    // Now send normal request
    mockWin.ytcfg = {
      get: (k: string) => (k === "INNERTUBE_API_KEY" ? "AIzaValid" : undefined),
    };

    const promise = requestYouTubeContext({
      targetWindow: mockWin,
      timeoutMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(10);

    const result = await promise;
    expect(result.apiKey).toBe("AIzaValid");

    cleanupMain();
  });

  it("updates cached context on YouTube SPA navigation (yt-navigate-finish)", async () => {
    const cleanupIsolated = initIsolatedBridge(mockWin);
    const cleanupMain = setupMainWorldBridge(mockWin);

    expect(getLastKnownContext()).toBeNull();

    mockWin.ytcfg = {
      get: (k: string) =>
        k === "INNERTUBE_API_KEY" ? "AIzaNavKey" : undefined,
    };

    // Dispatch SPA navigation finish event
    mockWin.dispatchEvent(new Event("yt-navigate-finish"));

    await vi.advanceTimersByTimeAsync(10);

    expect(getLastKnownContext()).not.toBeNull();
    expect(getLastKnownContext()?.apiKey).toBe("AIzaNavKey");

    cleanupMain();
    cleanupIsolated();
  });
});
