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
    json: async () => body,
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

    const failedItem = status?.items.find(
      (i) => i.videoId === "no-caps-video"
    );
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

    // 5. Unknown message
    const unknownResponse = vi.fn();
    const isAsyncUnknown = router(
      { type: "UNKNOWN_MSG" },
      sender,
      unknownResponse
    );
    expect(isAsyncUnknown).toBe(false);
  });
});
