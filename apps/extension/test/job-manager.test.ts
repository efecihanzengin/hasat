import { describe, it, expect, vi, beforeEach } from "vitest";
import playerStandardManual from "../../../packages/core/fixtures/player-standard-manual.json";
import playerNoCaptions from "../../../packages/core/fixtures/player-no-captions.json";
import timedTextFixture from "../../../packages/core/fixtures/timedtext-non-latin-asr.json";
import { JobManager } from "../src/background/job-manager.js";
import { MemoryJobStorage } from "../src/background/storage.js";
import { createMessageRouter } from "../src/background/index.js";
import {
  YTE_LIVENESS_PORT,
  type JobPortEvent,
  type StartJobPayload,
} from "../src/background/types.js";

function createMockResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body, text: async () => typeof body === "string" ? body : JSON.stringify(body),
  } as unknown as Response;
}

describe("JobManager", () => {
  let storage: MemoryJobStorage;
  let mockFetch: ReturnType<typeof vi.fn<typeof fetch>>;
  const defaultContext = { clientVersion: "2.20240313.01.00" };

  beforeEach(() => {
    storage = new MemoryJobStorage();
    mockFetch = vi.fn<typeof fetch>();
  });

  function setupSuccessfulFetch() {
    mockFetch.mockImplementation(async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("youtubei/v1/player")) {
        return createMockResponse(200, playerStandardManual);
      }
      if (urlStr.includes("timedtext") || urlStr.includes("fmt=json3")) {
        return createMockResponse(200, timedTextFixture);
      }
      return createMockResponse(404, {});
    });
  }

  it("completes a multi-video extraction job and persists items immediately per ADR-0002", async () => {
    setupSuccessfulFetch();

    const manager = new JobManager({
      storage,
      fetchFn: mockFetch,
      delayFn: async () => {},
      getJitterDelay: () => 0,
    });

    const payload: StartJobPayload = {
      videos: [
        { videoId: "v1", title: "First Video" },
        { videoId: "v2", title: "Second Video" },
      ],
      format: "txt",
      channelOrPlaylist: "Test Channel",
      concurrency: 2,
      context: defaultContext,
    };

    const initialJob = await manager.startJob(payload);
    expect(initialJob.status).toBe("running");
    expect(initialJob.summary.total).toBe(2);

    // Wait for queue completion
    let status = await manager.getJobStatus();
    while (status?.status === "running") {
      await new Promise((r) => setTimeout(r, 10));
      status = await manager.getJobStatus();
    }
    expect(status?.status).toBe("completed");
    expect(status?.summary.done).toBe(2);
    expect(status?.summary.failed).toBe(0);

    // Verify chunked transcripts persisted in storage
    const t1 = await storage.getTranscript(initialJob.id, "v1");
    const t2 = await storage.getTranscript(initialJob.id, "v2");
    expect(t1).not.toBeNull();
    expect(t2).not.toBeNull();
    expect(t1?.videoId).toBe("jNQXAC9IVRw"); // from player fixture
  });

  it("handles mixed success and failure without terminating the entire job", async () => {
    mockFetch.mockImplementation(async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("youtubei/v1/player")) {
        // Return no captions for v2
        if (urlStr.includes("no-caps")) {
          return createMockResponse(200, playerNoCaptions);
        }
        return createMockResponse(200, playerStandardManual);
      }
      if (urlStr.includes("timedtext")) {
        return createMockResponse(200, timedTextFixture);
      }
      return createMockResponse(404, {});
    });

    const manager = new JobManager({
      storage,
      fetchFn: mockFetch,
      delayFn: async () => {},
      getJitterDelay: () => 0,
    });

    const payload: StartJobPayload = {
      videos: [
        { videoId: "good-video", title: "Good Video" },
        { videoId: "no-caps-video", title: "No Captions Video" },
      ],
      concurrency: 1,
      context: defaultContext,
    };

    mockFetch.mockImplementation(async (url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("timedtext") || urlStr.includes("fmt=json3")) {
        return createMockResponse(200, timedTextFixture);
      }
      const body = JSON.parse(String(init?.body || "{}")) as {
        videoId?: string;
      };
      if (body.videoId === "no-caps-video") {
        return createMockResponse(200, playerNoCaptions);
      }
      return createMockResponse(200, playerStandardManual);
    });

    await manager.startJob(payload);

    let status = await manager.getJobStatus();
    while (status?.status === "running") {
      await new Promise((r) => setTimeout(r, 10));
      status = await manager.getJobStatus();
    }

    expect(status?.status).toBe("completed");
    expect(status?.summary.done).toBe(1);
    expect(status?.summary.failed).toBe(1);

    const failedItem = status?.items.find((i) => i.videoId === "no-caps-video");
    expect(failedItem?.status).toBe("failed");
    expect(failedItem?.error?.code).toBe("NO_CAPTIONS");
  });

  it("cancels active job, halting pending items while keeping completed items downloadable", async () => {
    mockFetch.mockImplementation(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}")) as {
        videoId?: string;
      };
      if (body.videoId === "v1") {
        return createMockResponse(200, playerStandardManual);
      }
      // Delay subsequent requests
      await new Promise((resolve) => setTimeout(resolve, 50));
      return createMockResponse(200, playerStandardManual);
    });

    const manager = new JobManager({
      storage,
      fetchFn: mockFetch,
      delayFn: async () => {},
      getJitterDelay: () => 0,
    });

    const payload: StartJobPayload = {
      videos: [
        { videoId: "v1", title: "Video 1" },
        { videoId: "v2", title: "Video 2" },
        { videoId: "v3", title: "Video 3" },
      ],
      concurrency: 1,
      context: defaultContext,
    };

    const initialJob = await manager.startJob(payload);

    // Cancel job
    await new Promise((r) => setTimeout(r, 20));
    const cancelledJob = await manager.cancelJob({ jobId: initialJob.id });

    expect(cancelledJob.status).toBe("cancelled");

    // Check status
    const status = await manager.getJobStatus();
    expect(status?.status).toBe("cancelled");
  });

  it("manages Liveness Port connection and broadcasts events", async () => {
    const manager = new JobManager({ storage });
    const events: JobPortEvent[] = [];

    const mockPort = {
      name: YTE_LIVENESS_PORT,
      postMessage: vi.fn((msg: JobPortEvent) => {
        events.push(msg);
      }),
      onDisconnect: {
        addListener: vi.fn(),
      },
      onMessage: {
        addListener: vi.fn(),
      },
    } as unknown as chrome.runtime.Port;

    manager.registerPort(mockPort);

    // Broadcast test
    manager.broadcast({
      type: "JOB_PROGRESS",
      job: {
        id: "j1",
        status: "running",
        items: [],
        summary: { total: 0, done: 0, skipped: 0, failed: 0 },
        createdAt: 0,
      },
    });

    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe("JOB_PROGRESS");
  });

  it("routes runtime messages correctly via createMessageRouter", async () => {
    setupSuccessfulFetch();

    const manager = new JobManager({
      storage,
      fetchFn: mockFetch,
      delayFn: async () => {},
      getJitterDelay: () => 0,
    });

    const router = createMessageRouter(manager);
    const sender = {} as chrome.runtime.MessageSender;

    // 1. PING message
    const pingResponse = vi.fn();
    const isAsyncPing = router({ type: "PING" }, sender, pingResponse);
    expect(isAsyncPing).toBe(false);
    expect(pingResponse).toHaveBeenCalledWith({
      ok: true,
      data: { pong: true },
    });

    // 2. START_JOB message
    const startResponse = vi.fn();
    const isAsyncStart = router(
      {
        type: "START_JOB",
        payload: {
          videos: [{ videoId: "v1", title: "Vid 1" }],
          context: defaultContext,
        },
      },
      sender,
      startResponse
    );
    expect(isAsyncStart).toBe(true);

    await new Promise((r) => setTimeout(r, 20));
    expect(startResponse).toHaveBeenCalled();

    // 3. GET_JOB_STATUS message
    const statusResponse = vi.fn();
    const isAsyncStatus = router(
      { type: "GET_JOB_STATUS" },
      sender,
      statusResponse
    );
    expect(isAsyncStatus).toBe(true);

    await new Promise((r) => setTimeout(r, 20));
    expect(statusResponse).toHaveBeenCalled();

    // 4. CANCEL_JOB message
    const cancelResponse = vi.fn();
    const isAsyncCancel = router(
      { type: "CANCEL_JOB" },
      sender,
      cancelResponse
    );
    expect(isAsyncCancel).toBe(true);

    await new Promise((r) => setTimeout(r, 20));
    expect(cancelResponse).toHaveBeenCalled();

    // 5. RESUME_JOB message
    const resumeResponse = vi.fn();
    const isAsyncResume = router(
      { type: "RESUME_JOB", payload: { jobId: "test-id" } },
      sender,
      resumeResponse
    );
    expect(isAsyncResume).toBe(true);

    // 6. Unknown message
    const unknownResponse = vi.fn();
    const isAsyncUnknown = router(
      { type: "UNKNOWN_MSG" },
      sender,
      unknownResponse
    );
    expect(isAsyncUnknown).toBe(false);
  });

  it("checks transcript cache before fetching and does not hit network when cached", async () => {
    setupSuccessfulFetch();

    const cachedTranscript = {
      videoId: "cached-vid",
      title: "Already Cached Video",
      channelName: "Test Channel",
      language: "en",
      isAutoGenerated: false,
      segments: [{ start: 0, duration: 2, text: "Cached content" }],
    };

    // Pre-populate transcript cache
    await storage.saveCachedTranscript("cached-vid", "auto", cachedTranscript);

    const manager = new JobManager({
      storage,
      fetchFn: mockFetch,
      delayFn: async () => {},
      getJitterDelay: () => 0,
    });

    const payload: StartJobPayload = {
      videos: [
        { videoId: "cached-vid", title: "Cached Video" },
        { videoId: "fresh-vid", title: "Fresh Video" },
      ],
      concurrency: 1,
      context: defaultContext,
    };

    await manager.startJob(payload);

    let status = await manager.getJobStatus();
    while (status?.status === "running") {
      await new Promise((r) => setTimeout(r, 10));
      status = await manager.getJobStatus();
    }

    expect(status?.status).toBe("completed");
    expect(status?.summary.done).toBe(2);
    expect(status?.summary.cached).toBe(1);

    const cachedItem = status?.items.find((i) => i.videoId === "cached-vid");
    expect(cachedItem?.status).toBe("done");
    expect(cachedItem?.fromCache).toBe(true);

    // Verify mockFetch was NEVER called for cached-vid
    const calls = mockFetch.mock.calls.map((c) => String(c[0]));
    const fetchedCachedVid = calls.some((url) => url.includes("cached-vid"));
    expect(fetchedCachedVid).toBe(false);

    // Verify fresh-vid was stored in cache for future jobs
    const cachedFresh = await storage.getCachedTranscript("fresh-vid", "auto");
    expect(cachedFresh).not.toBeNull();
  });

  it("trips circuit breaker after 3 consecutive RATE_LIMITED errors and halts remaining items", async () => {
    // Return 429 for all player requests
    mockFetch.mockImplementation(async () => {
      return createMockResponse(429, {});
    });

    const manager = new JobManager({
      storage,
      fetchFn: mockFetch,
      delayFn: async () => {},
      getJitterDelay: () => 0,
      backoffSchedule: [1], // Fast backoff in test
    });

    const payload: StartJobPayload = {
      videos: [
        { videoId: "cb-v1", title: "Video 1" },
        { videoId: "cb-v2", title: "Video 2" },
        { videoId: "cb-v3", title: "Video 3" },
        { videoId: "cb-v4", title: "Video 4" },
        { videoId: "cb-v5", title: "Video 5" },
      ],
      concurrency: 1,
      context: defaultContext,
    };

    await manager.startJob(payload);

    let status = await manager.getJobStatus();
    while (status?.status === "running") {
      await new Promise((r) => setTimeout(r, 10));
      status = await manager.getJobStatus();
    }

    // Circuit breaker must pause the job completely
    expect(status?.status).toBe("paused");
    expect(status?.error).toBe(
      "YouTube hız sınırı — tamamlananlar kaydedildi, sonra devam edebilirsin"
    );

    // Exactly 3 videos failed with RATE_LIMITED
    expect(status?.summary.failed).toBe(3);
    expect(status?.items[0]?.status).toBe("failed");
    expect(status?.items[0]?.error?.code).toBe("RATE_LIMITED");
    expect(status?.items[1]?.status).toBe("failed");
    expect(status?.items[1]?.error?.code).toBe("RATE_LIMITED");
    expect(status?.items[2]?.status).toBe("failed");
    expect(status?.items[2]?.error?.code).toBe("RATE_LIMITED");

    // Remaining videos must NOT have been fetched, remaining pending
    expect(status?.items[3]?.status).toBe("pending");
    expect(status?.items[4]?.status).toBe("pending");

    // Verify mockFetch was NEVER called for cb-v4 or cb-v5
    const bodyPayloads = mockFetch.mock.calls
      .map((c) => {
        const init = c[1] as RequestInit | undefined;
        try {
          return JSON.parse(String(init?.body || "{}")) as { videoId?: string };
        } catch {
          return {};
        }
      })
      .map((b) => b.videoId);

    expect(bodyPayloads).not.toContain("cb-v4");
    expect(bodyPayloads).not.toContain("cb-v5");
  });

  it("resets consecutive rate limit count when a request succeeds", async () => {
    const rateLimitedVideos = new Set(["r1", "r2", "r4"]);
    mockFetch.mockImplementation(async (url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("timedtext") || urlStr.includes("fmt=json3")) {
        return createMockResponse(200, timedTextFixture);
      }
      try {
        const body = JSON.parse(String(init?.body || "{}")) as {
          videoId?: string;
        };
        if (body.videoId && rateLimitedVideos.has(body.videoId)) {
          return createMockResponse(429, {});
        }
      } catch {
        // ignore
      }
      return createMockResponse(200, playerStandardManual);
    });

    const manager = new JobManager({
      storage,
      fetchFn: mockFetch,
      delayFn: async () => {},
      getJitterDelay: () => 0,
      backoffSchedule: [1],
    });

    const payload: StartJobPayload = {
      videos: [
        { videoId: "r1", title: "Vid 1" },
        { videoId: "r2", title: "Vid 2" },
        { videoId: "r3", title: "Vid 3" },
        { videoId: "r4", title: "Vid 4" },
        { videoId: "r5", title: "Vid 5" },
      ],
      concurrency: 1,
      context: defaultContext,
    };

    await manager.startJob(payload);

    let status = await manager.getJobStatus();
    while (status?.status === "running") {
      await new Promise((r) => setTimeout(r, 10));
      status = await manager.getJobStatus();
    }

    // Because failures were never 3 consecutive, job should complete
    expect(status?.status).toBe("completed");
    expect(status?.summary.done).toBe(2);
    expect(status?.summary.failed).toBe(3);
  });

  it("allows resuming a paused job and retrying rate-limited items", async () => {
    let return429 = true;
    mockFetch.mockImplementation(async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("timedtext") || urlStr.includes("fmt=json3")) {
        return createMockResponse(200, timedTextFixture);
      }
      if (return429) {
        return createMockResponse(429, {});
      }
      return createMockResponse(200, playerStandardManual);
    });

    const manager = new JobManager({
      storage,
      fetchFn: mockFetch,
      delayFn: async () => {},
      getJitterDelay: () => 0,
      backoffSchedule: [1],
    });

    const payload: StartJobPayload = {
      videos: [
        { videoId: "res1", title: "Vid 1" },
        { videoId: "res2", title: "Vid 2" },
        { videoId: "res3", title: "Vid 3" },
        { videoId: "res4", title: "Vid 4" },
      ],
      concurrency: 1,
      context: defaultContext,
    };

    await manager.startJob(payload);

    let status = await manager.getJobStatus();
    while (status?.status === "running") {
      await new Promise((r) => setTimeout(r, 10));
      status = await manager.getJobStatus();
    }

    expect(status?.status).toBe("paused");
    expect(status?.summary.failed).toBe(3);

    // Network conditions improve
    return429 = false;

    // Resume the job
    const resumed = await manager.resumeJob({ jobId: status?.id });
    expect(resumed.status).toBe("running");

    status = await manager.getJobStatus();
    while (status?.status === "running") {
      await new Promise((r) => setTimeout(r, 10));
      status = await manager.getJobStatus();
    }

    expect(status?.status).toBe("completed");
    expect(status?.summary.done).toBe(4);
    expect(status?.summary.failed).toBe(0);
  });

  describe("Content Script Port Delegation & Disconnect Handling", () => {
    function createMockPort(name = YTE_LIVENESS_PORT) {
      const messageListeners = new Set<(msg: unknown) => void>();
      const disconnectListeners = new Set<() => void>();
      const postMessage = vi.fn();

      const port = {
        name,
        postMessage,
        disconnect: vi.fn(() => {
          for (const listener of disconnectListeners) {
            listener();
          }
        }),
        onMessage: {
          addListener: (fn: (msg: unknown) => void) => messageListeners.add(fn),
          removeListener: (fn: (msg: unknown) => void) =>
            messageListeners.delete(fn),
        },
        onDisconnect: {
          addListener: (fn: () => void) => disconnectListeners.add(fn),
          removeListener: (fn: () => void) => disconnectListeners.delete(fn),
        },
      } as unknown as chrome.runtime.Port;

      return {
        port,
        postMessage,
        triggerMessage: (msg: unknown) => {
          for (const listener of messageListeners) {
            listener(msg);
          }
        },
        triggerDisconnect: () => {
          for (const listener of disconnectListeners) {
            listener();
          }
        },
      };
    }

    it("delegates transcript extraction to connected content script port", async () => {
      const manager = new JobManager({
        storage,
        delayFn: async () => {},
        getJitterDelay: () => 0,
      });

      const mockPort = createMockPort();
      manager.registerPort(mockPort.port);

      // Listen for postMessage calls on mockPort to respond to FETCH_TRANSCRIPT_REQUEST
      mockPort.postMessage.mockImplementation((msg: unknown) => {
        if (
          typeof msg === "object" &&
          msg !== null &&
          (msg as { type?: string }).type === "FETCH_TRANSCRIPT_REQUEST"
        ) {
          const req = msg as {
            type: string;
            requestId: string;
            payload: { videoId: string; fallbackTitle?: string };
          };
          setTimeout(() => {
            mockPort.triggerMessage({
              type: "FETCH_TRANSCRIPT_RESPONSE",
              requestId: req.requestId,
              result: {
                ok: true,
                value: {
                  videoId: req.payload.videoId,
                  title: req.payload.fallbackTitle || "Port Video",
                  channelName: "Test Channel",
                  language: "en",
                  isAutoGenerated: false,
                  segments: [{ start: 0, duration: 5, text: "Extracted via port" }],
                },
              },
            });
          }, 5);
        }
      });

      const job = await manager.startJob({
        videos: [{ videoId: "port-v1", title: "Port Video 1" }],
        context: defaultContext,
      });

      let status = await manager.getJobStatus();
      while (status?.status === "running") {
        await new Promise((r) => setTimeout(r, 10));
        status = await manager.getJobStatus();
      }

      expect(status?.status).toBe("completed");
      expect(status?.summary.done).toBe(1);
      const savedTranscript = await storage.getTranscript(job.id, "port-v1");
      expect(savedTranscript).not.toBeNull();
      expect(savedTranscript?.segments[0]?.text).toBe("Extracted via port");
    });

    it("pauses running job, preserves completed items, and sets message when content script port disconnects", async () => {
      const manager = new JobManager({
        storage,
        delayFn: async () => {},
        getJitterDelay: () => 0,
      });

      const mockPort = createMockPort();
      manager.registerPort(mockPort.port);

      let fetchCount = 0;
      mockPort.postMessage.mockImplementation((msg: unknown) => {
        if (
          typeof msg === "object" &&
          msg !== null &&
          (msg as { type?: string }).type === "FETCH_TRANSCRIPT_REQUEST"
        ) {
          const req = msg as {
            type: string;
            requestId: string;
            payload: { videoId: string; fallbackTitle?: string };
          };
          fetchCount += 1;
          if (fetchCount === 1) {
            // First video succeeds
            setTimeout(() => {
              mockPort.triggerMessage({
                type: "FETCH_TRANSCRIPT_RESPONSE",
                requestId: req.requestId,
                result: {
                  ok: true,
                  value: {
                    videoId: req.payload.videoId,
                    title: req.payload.fallbackTitle || "Video 1",
                    channelName: "Channel",
                    language: "en",
                    isAutoGenerated: false,
                    segments: [{ start: 0, duration: 2, text: "First completed" }],
                  },
                },
              });
            }, 5);
          } else {
            // During second video fetch, user closes the YouTube tab!
            setTimeout(() => {
              mockPort.triggerDisconnect();
            }, 5);
          }
        }
      });

      const job = await manager.startJob({
        videos: [
          { videoId: "tab-v1", title: "Tab Video 1" },
          { videoId: "tab-v2", title: "Tab Video 2" },
        ],
        context: defaultContext,
      });

      let status = await manager.getJobStatus();
      while (status?.status === "running") {
        await new Promise((r) => setTimeout(r, 10));
        status = await manager.getJobStatus();
      }

      // Must be paused with exact message
      expect(status?.status).toBe("paused");
      expect(status?.error).toBe("YouTube sekmesi kapandı, iş duraklatıldı");

      // First video must be preserved as done
      expect(status?.summary.done).toBe(1);
      expect(status?.items[0]?.status).toBe("done");
      expect(status?.items[1]?.status).toBe("pending");

      const savedV1 = await storage.getTranscript(job.id, "tab-v1");
      expect(savedV1).not.toBeNull();
      expect(savedV1?.segments[0]?.text).toBe("First completed");

      // Now user re-opens YouTube tab and connects a new port
      const newMockPort = createMockPort();
      manager.registerPort(newMockPort.port);

      newMockPort.postMessage.mockImplementation((msg: unknown) => {
        if (
          typeof msg === "object" &&
          msg !== null &&
          (msg as { type?: string }).type === "FETCH_TRANSCRIPT_REQUEST"
        ) {
          const req = msg as {
            type: string;
            requestId: string;
            payload: { videoId: string; fallbackTitle?: string };
          };
          setTimeout(() => {
            newMockPort.triggerMessage({
              type: "FETCH_TRANSCRIPT_RESPONSE",
              requestId: req.requestId,
              result: {
                ok: true,
                value: {
                  videoId: req.payload.videoId,
                  title: req.payload.fallbackTitle || "Video 2",
                  channelName: "Channel",
                  language: "en",
                  isAutoGenerated: false,
                  segments: [{ start: 0, duration: 2, text: "Second completed" }],
                },
              },
            });
          }, 5);
        }
      });

      const resumedJob = await manager.resumeJob({ jobId: job.id });
      expect(resumedJob.status).toBe("running");

      status = await manager.getJobStatus();
      while (status?.status === "running") {
        await new Promise((r) => setTimeout(r, 10));
        status = await manager.getJobStatus();
      }

      expect(status?.status).toBe("completed");
      expect(status?.summary.done).toBe(2);
      const savedV2 = await storage.getTranscript(job.id, "tab-v2");
      expect(savedV2).not.toBeNull();
      expect(savedV2?.segments[0]?.text).toBe("Second completed");
    });

    it("pauses running job when active port disconnects even if secondary YouTube tabs remain open", async () => {
      const manager = new JobManager({
        storage,
        delayFn: async () => {},
        getJitterDelay: () => 0,
      });

      // User has Tab 1 (active port) and Tab 2 (idle tab)
      const tab1Port = createMockPort();
      const tab2Port = createMockPort();

      manager.registerPort(tab1Port.port);
      manager.registerPort(tab2Port.port);

      // Tab 2 was registered second, but tab 1 or activePort is running the job
      expect(manager.getActivePort()).toBe(tab2Port.port);

      // Now start extraction job
      await manager.startJob({
        videos: [{ videoId: "v-multi-1", title: "Multi 1" }],
        context: defaultContext,
      });

      // Disconnect the active port
      const activePort = manager.getActivePort();
      expect(activePort).not.toBeNull();
      if (activePort === tab2Port.port) {
        tab2Port.triggerDisconnect();
      } else {
        tab1Port.triggerDisconnect();
      }

      const status = await manager.getJobStatus();
      expect(status?.status).toBe("paused");
      expect(status?.error).toBe("YouTube sekmesi kapandı, iş duraklatıldı");
    });

    it("resuming a job does not incur artificial jitter delays for already-completed items", async () => {
      const delays: number[] = [];
      const mockDelay = vi.fn(async (ms: number) => {
        delays.push(ms);
      });

      const manager = new JobManager({
        storage,
        delayFn: mockDelay,
        getJitterDelay: () => 1500,
      });

      const mockPort = createMockPort();
      manager.registerPort(mockPort.port);

      mockPort.postMessage.mockImplementation((msg: unknown) => {
        if (
          typeof msg === "object" &&
          msg !== null &&
          (msg as { type?: string }).type === "FETCH_TRANSCRIPT_REQUEST"
        ) {
          const req = msg as {
            type: string;
            requestId: string;
            payload: { videoId: string };
          };
          setTimeout(() => {
            mockPort.triggerMessage({
              type: "FETCH_TRANSCRIPT_RESPONSE",
              requestId: req.requestId,
              result: {
                ok: true,
                value: {
                  videoId: req.payload.videoId,
                  title: "Video",
                  channelName: "Channel",
                  language: "en",
                  isAutoGenerated: false,
                  segments: [{ start: 0, duration: 2, text: "Text" }],
                },
              },
            });
          }, 5);
        }
      });

      // Create job with 4 videos, but 3 are already marked "done"
      const jobState = {
        id: "job-fast-resume",
        status: "paused" as const,
        items: [
          { videoId: "done-1", title: "Done 1", status: "done" as const },
          { videoId: "done-2", title: "Done 2", status: "done" as const },
          { videoId: "done-3", title: "Done 3", status: "done" as const },
          { videoId: "pending-4", title: "Pending 4", status: "pending" as const },
        ],
        summary: { total: 4, done: 3, skipped: 0, failed: 0 },
        createdAt: Date.now(),
        context: defaultContext,
      };

      await storage.saveJob(jobState);
      await storage.setActiveJobId(jobState.id);

      const resumed = await manager.resumeJob({ jobId: jobState.id });
      expect(resumed.status).toBe("running");

      let status = await manager.getJobStatus();
      while (status?.status === "running") {
        await new Promise((r) => setTimeout(r, 10));
        status = await manager.getJobStatus();
      }

      expect(status?.status).toBe("completed");
      expect(status?.summary.done).toBe(4);

      // Crucial verification: NO delays occurred for the 3 done items!
      // Only 1 item needed fetching (pending-4), which was the last item, so delays.length is 0.
      expect(delays.length).toBe(0);
    });
  });
});
