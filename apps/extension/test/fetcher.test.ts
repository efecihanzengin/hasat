import { describe, it, expect, vi } from "vitest";
import playerStandardManual from "../../../packages/core/fixtures/player-standard-manual.json";
import playerNoCaptions from "../../../packages/core/fixtures/player-no-captions.json";
import timedTextFixture from "../../../packages/core/fixtures/timedtext-non-latin-asr.json";
import { fetchSingleTranscript } from "../src/background/fetcher.js";

function createMockResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

describe("fetchSingleTranscript", () => {
  const defaultContext = { clientVersion: "2.20240313.01.00" };

  it("throws error when clientVersion is missing in YouTube context", async () => {
    await expect(
      fetchSingleTranscript({
        videoId: "jNQXAC9IVRw",
      })
    ).rejects.toThrow("Missing clientVersion in YouTube page context");

    await expect(
      fetchSingleTranscript({
        videoId: "jNQXAC9IVRw",
        context: { apiKey: "AIzaTestKey123" },
      })
    ).rejects.toThrow("Missing clientVersion in YouTube page context");
  });

  it("successfully fetches player metadata and timedtext segments", async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createMockResponse(200, playerStandardManual))
      .mockResolvedValueOnce(createMockResponse(200, timedTextFixture));

    const result = await fetchSingleTranscript({
      videoId: "jNQXAC9IVRw",
      context: defaultContext,
      fetchFn: mockFetch,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.videoId).toBe("jNQXAC9IVRw");
    expect(result.value.title).toBe("Me at the zoo");
    expect(result.value.channelName).toBe("jawed");
    expect(result.value.segments.length).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify InnerTube player request payload
    const playerCall = mockFetch.mock.calls[0];
    expect(playerCall).toBeDefined();
    if (playerCall) {
      expect(playerCall[0]).toContain("/youtubei/v1/player");
      expect(playerCall[1]?.method).toBe("POST");
    }

    // Verify timedtext request URL includes &fmt=json3
    const timedTextCall = mockFetch.mock.calls[1];
    expect(timedTextCall).toBeDefined();
    if (timedTextCall) {
      expect(timedTextCall[0]).toContain("fmt=json3");
    }
  });

  it("appends apiKey to player endpoint when provided in context", async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createMockResponse(200, playerNoCaptions));

    await fetchSingleTranscript({
      videoId: "no-caps",
      context: { ...defaultContext, apiKey: "AIzaTestKey123" },
      fetchFn: mockFetch,
    });

    const playerCall = mockFetch.mock.calls[0];
    expect(playerCall).toBeDefined();
    if (playerCall) {
      expect(playerCall[0]).toContain("key=AIzaTestKey123");
    }
  });

  it("returns NO_CAPTIONS error when video has no caption tracks", async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createMockResponse(200, playerNoCaptions));

    const result = await fetchSingleTranscript({
      videoId: "no-caps",
      context: defaultContext,
      fetchFn: mockFetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NO_CAPTIONS");
    }
  });

  it("retries on HTTP 429 on player endpoint and recovers", async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createMockResponse(429, {})) // 429 first
      .mockResolvedValueOnce(createMockResponse(200, playerStandardManual)) // then 200
      .mockResolvedValueOnce(createMockResponse(200, timedTextFixture));

    const mockDelay = vi.fn(async () => {});

    const result = await fetchSingleTranscript({
      videoId: "jNQXAC9IVRw",
      context: defaultContext,
      fetchFn: mockFetch,
      delayFn: mockDelay,
    });

    expect(result.ok).toBe(true);
    expect(mockDelay).toHaveBeenCalledWith(1000, undefined);
  });

  it("returns RATE_LIMITED when player endpoint persistently returns 429", async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(createMockResponse(429, {}));

    const mockDelay = vi.fn(async () => {});

    const result = await fetchSingleTranscript({
      videoId: "jNQXAC9IVRw",
      context: defaultContext,
      fetchFn: mockFetch,
      delayFn: mockDelay,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RATE_LIMITED");
    }
  });

  it("returns RATE_LIMITED when timedtext endpoint persistently returns 429", async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createMockResponse(200, playerStandardManual))
      .mockResolvedValue(createMockResponse(429, {}));

    const mockDelay = vi.fn(async () => {});

    const result = await fetchSingleTranscript({
      videoId: "jNQXAC9IVRw",
      context: defaultContext,
      fetchFn: mockFetch,
      delayFn: mockDelay,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RATE_LIMITED");
    }
  });

  it("returns UNKNOWN error when HTTP status is not 200/429", async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createMockResponse(500, {}));

    const result = await fetchSingleTranscript({
      videoId: "fail-video",
      context: defaultContext,
      fetchFn: mockFetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNKNOWN");
      expect(result.error.message).toContain("HTTP 500");
    }
  });

  it("returns PARSE_ERROR when response is not valid JSON", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => {
        throw new Error("Invalid JSON");
      },
    } as unknown as Response);

    const result = await fetchSingleTranscript({
      videoId: "corrupt-video",
      context: defaultContext,
      fetchFn: mockFetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PARSE_ERROR");
    }
  });

  it("returns cancelled error when aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const mockFetch = vi.fn<typeof fetch>();
    const result = await fetchSingleTranscript({
      videoId: "jNQXAC9IVRw",
      context: defaultContext,
      fetchFn: mockFetch,
      signal: controller.signal,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNKNOWN");
      expect(result.error.message).toContain("cancelled");
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
