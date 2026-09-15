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
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
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

    // Verify InnerTube player request payload uses WEB client context and credentials: include
    const playerCall = mockFetch.mock.calls[0];
    expect(playerCall).toBeDefined();
    if (playerCall) {
      expect(playerCall[0]).toContain("/youtubei/v1/player");
      expect(playerCall[1]?.method).toBe("POST");
      expect(playerCall[1]?.credentials).toBe("include");
      const body = JSON.parse(playerCall[1]?.body as string);
      expect(body.context.client.clientName).toBe("WEB");
      expect(body.context.client.clientVersion).toBe("2.20240313.01.00");
    }

    // Verify timedtext request URL includes fmt=json3 and credentials: include
    const timedTextCall = mockFetch.mock.calls[1];
    expect(timedTextCall).toBeDefined();
    if (timedTextCall) {
      expect(timedTextCall[0]).toContain("fmt=json3");
      expect(timedTextCall[1]?.credentials).toBe("include");
    }
  });

  it("falls back to XML caption track when json3 is empty, logging warning to console", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const xmlCaptionText = `<timedtext><text start="1.5" dur="3.0">Hello from XML</text></timedtext>`;

    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createMockResponse(200, playerStandardManual))
      .mockResolvedValueOnce(createMockResponse(200, "")) // json3 empty body
      .mockResolvedValueOnce(createMockResponse(200, xmlCaptionText)); // XML fallback

    const result = await fetchSingleTranscript({
      videoId: "jNQXAC9IVRw",
      context: defaultContext,
      fetchFn: mockFetch,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.segments).toEqual([
        { start: 1.5, duration: 3.0, text: "Hello from XML" },
      ]);
    }

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("json3 timedtext failed for video jNQXAC9IVRw")
    );
    consoleWarnSpy.mockRestore();
  });

  it("replaces existing fmt=srv3 in caption track baseUrl with fmt=json3", async () => {
    const playerWithSrv3 = JSON.parse(JSON.stringify(playerStandardManual));
    playerWithSrv3.captions.playerCaptionsTracklistRenderer.captionTracks[0].baseUrl =
      "https://www.youtube.com/api/timedtext?v=jNQXAC9IVRw&lang=en&fmt=srv3";

    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createMockResponse(200, playerWithSrv3))
      .mockResolvedValueOnce(createMockResponse(200, timedTextFixture));

    const result = await fetchSingleTranscript({
      videoId: "jNQXAC9IVRw",
      context: defaultContext,
      fetchFn: mockFetch,
    });

    expect(result.ok).toBe(true);
    const timedTextCall = mockFetch.mock.calls[1];
    expect(timedTextCall).toBeDefined();
    if (timedTextCall) {
      const url = new URL(timedTextCall[0] as string);
      expect(url.searchParams.get("fmt")).toBe("json3");
      expect(timedTextCall[0]).not.toContain("fmt=srv3");
    }
  });

  it("appends apiKey to player endpoint when provided in context", async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(createMockResponse(200, playerNoCaptions));

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
      .mockResolvedValue(createMockResponse(200, playerNoCaptions));

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
      .mockResolvedValue(createMockResponse(500, {}));

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
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => {
        throw new Error("Invalid JSON");
      },
      text: async () => {
        throw new Error("Invalid HTML");
      }
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

  it("falls back from an empty manual track to a populated auto-generated ASR track", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const playerDualTrack = {
      videoDetails: {
        videoId: "turk123",
        title: "Turkish Playlist Video",
        author: "Channel TR",
      },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: "https://www.youtube.com/api/timedtext?v=turk123&lang=tr",
              name: { simpleText: "Turkish" },
              languageCode: "tr",
              isDefault: true,
              vssId: ".tr",
            },
            {
              baseUrl: "https://www.youtube.com/api/timedtext?v=turk123&lang=tr&kind=asr",
              name: { simpleText: "Turkish (auto-generated)" },
              languageCode: "tr",
              kind: "asr",
              vssId: "a.tr",
            },
          ],
        },
      },
    };

    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createMockResponse(200, playerDualTrack))
      .mockResolvedValueOnce(createMockResponse(200, ""))
      .mockResolvedValueOnce(createMockResponse(200, ""))
      .mockResolvedValueOnce(createMockResponse(200, timedTextFixture));

    const result = await fetchSingleTranscript({
      videoId: "turk123",
      context: defaultContext,
      fetchFn: mockFetch,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.videoId).toBe("turk123");
      expect(result.value.language).toBe("tr");
      expect(result.value.isAutoGenerated).toBe(true);
      expect(result.value.segments.length).toBeGreaterThan(0);
    }

    expect(mockFetch).toHaveBeenCalledTimes(4);
    const track0JsonCall = mockFetch.mock.calls[1];
    const track0XmlCall = mockFetch.mock.calls[2];
    const track1JsonCall = mockFetch.mock.calls[3];

    expect(track0JsonCall?.[0]).toContain("lang=tr");
    expect(track0JsonCall?.[0]).toContain("fmt=json3");
    expect(track0XmlCall?.[0]).toContain("lang=tr");
    expect(track0XmlCall?.[0]).not.toContain("fmt=json3");

    expect(track1JsonCall?.[0]).toContain("kind=asr");
    expect(track1JsonCall?.[0]).toContain("fmt=json3");

    consoleWarnSpy.mockRestore();
  });

  it("aborts immediately without trying next candidate track when rate limited (429)", async () => {
    const playerDualTrack = {
      videoDetails: {
        videoId: "turk123",
        title: "Turkish Playlist Video",
        author: "Channel TR",
      },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: "https://www.youtube.com/api/timedtext?v=turk123&lang=tr",
              name: { simpleText: "Turkish" },
              languageCode: "tr",
              isDefault: true,
              vssId: ".tr",
            },
            {
              baseUrl: "https://www.youtube.com/api/timedtext?v=turk123&lang=tr&kind=asr",
              name: { simpleText: "Turkish (auto-generated)" },
              languageCode: "tr",
              kind: "asr",
              vssId: "a.tr",
            },
          ],
        },
      },
    };

    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createMockResponse(200, playerDualTrack))
      .mockResolvedValue(createMockResponse(429, {}));

    const mockDelay = vi.fn(async () => {});

    const result = await fetchSingleTranscript({
      videoId: "turk123",
      context: defaultContext,
      fetchFn: mockFetch,
      delayFn: mockDelay,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RATE_LIMITED");
    }

    for (const call of mockFetch.mock.calls) {
      const url = String(call[0]);
      expect(url).not.toContain("kind=asr");
    }
  });

  it("returns NO_CAPTIONS when all candidate tracks fail both json3 and XML formats", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const playerDualTrack = {
      videoDetails: {
        videoId: "turk123",
        title: "Turkish Playlist Video",
        author: "Channel TR",
      },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: "https://www.youtube.com/api/timedtext?v=turk123&lang=tr",
              name: { simpleText: "Turkish" },
              languageCode: "tr",
              isDefault: true,
              vssId: ".tr",
            },
            {
              baseUrl: "https://www.youtube.com/api/timedtext?v=turk123&lang=tr&kind=asr",
              name: { simpleText: "Turkish (auto-generated)" },
              languageCode: "tr",
              kind: "asr",
              vssId: "a.tr",
            },
          ],
        },
      },
    };

    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createMockResponse(200, playerDualTrack))
      .mockResolvedValueOnce(createMockResponse(200, ""))
      .mockResolvedValueOnce(createMockResponse(200, ""))
      .mockResolvedValueOnce(createMockResponse(200, ""))
      .mockResolvedValueOnce(createMockResponse(200, ""));

    const result = await fetchSingleTranscript({
      videoId: "turk123",
      context: defaultContext,
      fetchFn: mockFetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NO_CAPTIONS");
      expect(result.error.message).toContain("Both json3 and XML timedtext formats failed");
    }
    expect(mockFetch).toHaveBeenCalledTimes(5);

    consoleWarnSpy.mockRestore();
  });

  it("returns Operation cancelled and does not execute XML fallback when aborted during json3 timedtext fetch", async () => {
    const controller = new AbortController();
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createMockResponse(200, playerStandardManual))
      .mockImplementationOnce(async () => {
        controller.abort();
        throw new DOMException("The operation was aborted", "AbortError");
      });

    const result = await fetchSingleTranscript({
      videoId: "jNQXAC9IVRw",
      context: defaultContext,
      fetchFn: mockFetch,
      signal: controller.signal,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNKNOWN");
      expect(result.error.message).toBe("Operation cancelled");
    }
    // Only 2 calls: player and initial json3. XML fallback was not attempted!
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns Operation cancelled and does not execute watch page fallback when aborted during player request", async () => {
    const controller = new AbortController();
    const mockFetch = vi.fn<typeof fetch>().mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException("The operation was aborted", "AbortError");
    });

    const result = await fetchSingleTranscript({
      videoId: "jNQXAC9IVRw",
      context: defaultContext,
      fetchFn: mockFetch,
      signal: controller.signal,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNKNOWN");
      expect(result.error.message).toBe("Operation cancelled");
    }
    // Only 1 call: player request. Watch page fallback was not attempted!
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to VISIONOS client when WEB client timedtext returns empty body and visitorData is present", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const webPlayerResponse = {
      videoDetails: { videoId: "tp50RrOL9Es", title: "Test Video", author: "Author" },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: "https://www.youtube.com/api/timedtext?v=tp50RrOL9Es&exp=xpe&lang=en",
              name: { simpleText: "English" },
              languageCode: "en",
              isDefault: true,
              vssId: ".en",
            },
          ],
        },
      },
    };

    const visionOsPlayerResponse = {
      videoDetails: { videoId: "tp50RrOL9Es", title: "Test Video", author: "Author" },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: "https://www.youtube.com/api/timedtext?v=tp50RrOL9Es&lang=en",
              name: { simpleText: "English (auto-generated)" },
              languageCode: "en",
              isDefault: true,
              vssId: "a.en",
            },
          ],
        },
      },
    };

    const mockFetch = vi
      .fn<typeof fetch>()
      // 1. WEB player call
      .mockResolvedValueOnce(createMockResponse(200, webPlayerResponse))
      // 2. WEB json3 timedtext call returns empty
      .mockResolvedValueOnce(createMockResponse(200, ""))
      // 3. WEB XML timedtext call returns empty
      .mockResolvedValueOnce(createMockResponse(200, ""))
      // 4. VISIONOS player call
      .mockResolvedValueOnce(createMockResponse(200, visionOsPlayerResponse))
      // 5. VISIONOS json3 timedtext call returns valid segments
      .mockResolvedValueOnce(createMockResponse(200, timedTextFixture));

    const result = await fetchSingleTranscript({
      videoId: "tp50RrOL9Es",
      context: { ...defaultContext, visitorData: "testVisitorData123" },
      fetchFn: mockFetch,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.videoId).toBe("tp50RrOL9Es");
      expect(result.value.segments.length).toBeGreaterThan(0);
    }

    // Verify call 4 was to VISIONOS client
    const visionOsCall = mockFetch.mock.calls[3];
    expect(visionOsCall).toBeDefined();
    if (visionOsCall) {
      expect(visionOsCall[1]?.headers).toEqual(
        expect.objectContaining({
          "X-YouTube-Client-Name": "101",
          "X-YouTube-Client-Version": "1.02",
        })
      );
      const parsedBody = JSON.parse(visionOsCall[1]?.body as string);
      expect(parsedBody.context.client.clientName).toBe("VISIONOS");
      expect(parsedBody.context.client.visitorData).toBe("testVisitorData123");
    }

    consoleWarnSpy.mockRestore();
  });

  it("falls back to IOS client when both WEB and VISIONOS fail", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const webPlayerResponse = {
      videoDetails: { videoId: "tp50RrOL9Es", title: "Test Video", author: "Author" },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: "https://www.youtube.com/api/timedtext?v=tp50RrOL9Es&exp=xpe&lang=en",
              name: { simpleText: "English" },
              languageCode: "en",
              isDefault: true,
              vssId: ".en",
            },
          ],
        },
      },
    };

    const iosPlayerResponse = {
      videoDetails: { videoId: "tp50RrOL9Es", title: "Test Video", author: "Author" },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: "https://www.youtube.com/api/timedtext?v=tp50RrOL9Es&lang=en",
              name: { simpleText: "English" },
              languageCode: "en",
              isDefault: true,
              vssId: ".en",
            },
          ],
        },
      },
    };

    const mockFetch = vi
      .fn<typeof fetch>()
      // 1. WEB player call
      .mockResolvedValueOnce(createMockResponse(200, webPlayerResponse))
      // 2. WEB json3 empty
      .mockResolvedValueOnce(createMockResponse(200, ""))
      // 3. WEB XML empty
      .mockResolvedValueOnce(createMockResponse(200, ""))
      // 4. VISIONOS player call fails (e.g. 404)
      .mockResolvedValueOnce(createMockResponse(404, {}))
      // 5. IOS player call succeeds
      .mockResolvedValueOnce(createMockResponse(200, iosPlayerResponse))
      // 6. IOS json3 returns segments
      .mockResolvedValueOnce(createMockResponse(200, timedTextFixture));

    const result = await fetchSingleTranscript({
      videoId: "tp50RrOL9Es",
      context: { ...defaultContext, visitorData: "testVisitorData123" },
      fetchFn: mockFetch,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.videoId).toBe("tp50RrOL9Es");
      expect(result.value.segments.length).toBeGreaterThan(0);
    }

    const iosCall = mockFetch.mock.calls[4];
    expect(iosCall).toBeDefined();
    if (iosCall) {
      expect(iosCall[1]?.headers).toEqual(
        expect.objectContaining({
          "X-YouTube-Client-Name": "5",
          "X-YouTube-Client-Version": "21.26.4",
        })
      );
      const parsedBody = JSON.parse(iosCall[1]?.body as string);
      expect(parsedBody.context.client.clientName).toBe("IOS");
    }

    consoleWarnSpy.mockRestore();
  });

  it("directly uses VISIONOS client when context.clientName is VISIONOS", async () => {
    const visionOsPlayerResponse = {
      videoDetails: { videoId: "tp50RrOL9Es", title: "Test Video", author: "Author" },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: "https://www.youtube.com/api/timedtext?v=tp50RrOL9Es&lang=en",
              name: { simpleText: "English" },
              languageCode: "en",
              isDefault: true,
              vssId: ".en",
            },
          ],
        },
      },
    };

    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createMockResponse(200, visionOsPlayerResponse))
      .mockResolvedValueOnce(createMockResponse(200, timedTextFixture));

    const result = await fetchSingleTranscript({
      videoId: "tp50RrOL9Es",
      context: { ...defaultContext, clientName: "VISIONOS", visitorData: "testVisitorData123" },
      fetchFn: mockFetch,
    });

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const firstCall = mockFetch.mock.calls[0];
    const parsedBody = JSON.parse(firstCall?.[1]?.body as string);
    expect(parsedBody.context.client.clientName).toBe("VISIONOS");
  });
});
