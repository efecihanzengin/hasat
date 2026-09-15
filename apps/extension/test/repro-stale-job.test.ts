import { describe, it, expect, vi } from "vitest";
import { JobManager } from "../src/background/job-manager.js";
import { MemoryJobStorage } from "../src/background/storage.js";
import type { StartJobPayload } from "../src/background/types.js";

describe("Bug Reproduction: Stale Job in Storage", () => {
  it("when a job finishes, active job should be cleared from storage so new pages do not load old completed job", async () => {
    const storage = new MemoryJobStorage();
    const manager = new JobManager({
      storage,
      fetchFn: vi.fn().mockImplementation(async (url: unknown) => {
        const urlStr = String(url);
        if (urlStr.includes("youtubei/v1/player")) {
          return {
            status: 200,
            ok: true,
            json: async () => ({
              captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } },
              videoDetails: { title: "Test Video" },
            }),
          } as Response;
        }
        return { status: 404, ok: false } as Response;
      }),
      delayFn: async () => {},
      getJitterDelay: () => 0,
    });

    const payload: StartJobPayload = {
      videos: [{ videoId: "v1", title: "Vid 1" }],
      concurrency: 1,
      channelOrPlaylist: "Channel A",
      context: { clientVersion: "2.20240313.01.00" },
    };

    const job = await manager.startJob(payload);
    expect(job.status).toBe("running");

    // Wait for completion
    let status = await manager.getJobStatus();
    while (status?.status === "running") {
      await new Promise((r) => setTimeout(r, 10));
      status = await manager.getJobStatus();
    }

    expect(status?.status).toBe("completed");

    // Now verify activeJobId in storage:
    // Once a job is completed, activeJobId should NO LONGER be set to this completed job!
    // If it is still set, any new tab / session opening the drawer will be stuck on "Extraction Complete".
    // FAILS CURRENTLY: storage.getActiveJobId() still returns job.id!
    const activeJobId = await storage.getActiveJobId();
    expect(activeJobId).toBeNull();
  });
});
