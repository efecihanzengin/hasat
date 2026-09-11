import {
  buildTranscriptArchive,
  createExtractionError,
  sanitizeFilename,
  type ExportFormat,
  type ExtractionError,
  type FormatOptions,
  type JobItem,
  type Transcript,
} from "@youtube-transcript/core";
import { fetchSingleTranscript } from "./fetcher.js";
import { processQueue } from "./queue.js";
import { type DelayFunction } from "./retry.js";
import { ChromeJobStorage, type JobStorage } from "./storage.js";
import {
  YTE_LIVENESS_PORT,
  type CancelJobPayload,
  type DownloadExportData,
  type DownloadExportPayload,
  type GetJobStatusPayload,
  type JobPortEvent,
  type JobState,
  type StartJobPayload,
} from "./types.js";

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

export type JobManagerOptions = {
  storage?: JobStorage;
  fetchFn?: typeof fetch;
  delayFn?: DelayFunction;
  getJitterDelay?: () => number;
  backoffSchedule?: readonly number[];
};

export class JobManager {
  private storage: JobStorage;
  private fetchFn: typeof fetch;
  private delayFn?: DelayFunction;
  private getJitterDelay?: () => number;
  private backoffSchedule?: readonly number[];

  private currentJobState: JobState | null = null;
  private currentAbortController: AbortController | null = null;
  private connectedPorts = new Set<chrome.runtime.Port>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options?: JobManagerOptions) {
    this.storage = options?.storage ?? new ChromeJobStorage();
    this.fetchFn = options?.fetchFn ?? fetch;
    this.delayFn = options?.delayFn;
    this.getJitterDelay = options?.getJitterDelay;
    this.backoffSchedule = options?.backoffSchedule;
  }

  /**
   * Registers an active Liveness Port connected from the content script.
   */
  registerPort(port: chrome.runtime.Port): void {
    if (port.name !== YTE_LIVENESS_PORT) {
      return;
    }

    this.connectedPorts.add(port);

    port.onDisconnect.addListener(() => {
      this.connectedPorts.delete(port);
      if (this.connectedPorts.size === 0 && this.heartbeatInterval !== null) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
    });

    port.onMessage.addListener((msg: unknown) => {
      if (
        typeof msg === "object" &&
        msg !== null &&
        (msg as { type?: string }).type === "PING"
      ) {
        try {
          port.postMessage({ type: "PONG" });
        } catch {
          // Port disconnected
        }
      }
    });

    // Start heartbeat interval if an active job is running
    if (
      this.currentJobState?.status === "running" &&
      this.heartbeatInterval === null
    ) {
      this.startHeartbeat();
    }
  }

  unregisterPort(port: chrome.runtime.Port): void {
    this.connectedPorts.delete(port);
  }

  /**
   * Broadcasts a job event to all active connected Liveness Ports.
   */
  broadcast(event: JobPortEvent): void {
    for (const port of this.connectedPorts) {
      try {
        port.postMessage(event);
      } catch {
        this.connectedPorts.delete(port);
      }
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
    }
    this.heartbeatInterval = setInterval(() => {
      this.broadcast({ type: "PONG" });
    }, 15000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Starts a new extraction job, creating JobItems and executing the throttled queue.
   */
  async startJob(payload: StartJobPayload): Promise<JobState> {
    // If a job is already running, cancel it first
    if (this.currentJobState?.status === "running") {
      await this.cancelJob({ jobId: this.currentJobState.id });
    }

    const jobId =
      payload.jobId ??
      `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const items: JobItem[] = payload.videos.map((v) => ({
      videoId: v.videoId,
      title: v.title,
      status: "pending",
    }));

    const jobState: JobState = {
      id: jobId,
      status: "running",
      items,
      summary: {
        total: items.length,
        done: 0,
        skipped: 0,
        failed: 0,
      },
      channelOrPlaylist: payload.channelOrPlaylist,
      preferredLanguage: payload.preferredLanguage,
      format: payload.format,
      formatOptions: payload.formatOptions,
      createdAt: Date.now(),
    };

    this.currentJobState = jobState;
    this.currentAbortController = new AbortController();

    await this.storage.saveJob(jobState);
    await this.storage.setActiveJobId(jobId);

    this.startHeartbeat();
    this.broadcast({ type: "JOB_PROGRESS", job: jobState });

    // Execute background queue processing asynchronously
    void this.executeJobQueue(payload, this.currentAbortController);

    return jobState;
  }

  private async executeJobQueue(
    payload: StartJobPayload,
    abortController: AbortController
  ): Promise<void> {
    const job = this.currentJobState;
    if (!job) return;

    const signal = abortController.signal;

    try {
      await processQueue(
        job.items,
        async (item, workerSignal) => {
          if (workerSignal?.aborted || signal.aborted) {
            return;
          }

          item.status = "fetching";
          await this.storage.saveJob(job);
          this.broadcast({
            type: "JOB_PROGRESS",
            job,
            updatedItem: item,
          });

          const result = await fetchSingleTranscript({
            videoId: item.videoId,
            fallbackTitle: item.title,
            context: payload.context,
            preferredLanguage: payload.preferredLanguage,
            signal: workerSignal ?? signal,
            fetchFn: this.fetchFn,
            delayFn: this.delayFn,
            backoffSchedule: this.backoffSchedule,
          });

          if (signal.aborted) {
            return;
          }

          if (result.ok) {
            // Persist completed transcript immediately per ADR-0002
            await this.storage.saveTranscript(
              job.id,
              item.videoId,
              result.value
            );
            item.status = "done";
            item.error = undefined;
            job.summary.done += 1;
          } else {
            const error: ExtractionError = result.error;
            item.error = error;
            if (error.code === "LIVE_STREAM") {
              item.status = "skipped";
              job.summary.skipped += 1;
            } else {
              item.status = "failed";
              job.summary.failed += 1;
            }
          }

          // Persist updated job index immediately per ADR-0002
          await this.storage.saveJob(job);
          this.broadcast({
            type: "JOB_PROGRESS",
            job,
            updatedItem: item,
          });
        },
        {
          concurrency: payload.concurrency,
          getJitterDelay: this.getJitterDelay,
          delayFn: this.delayFn,
          signal,
        }
      );

      if (signal.aborted) {
        job.status = "cancelled";
        await this.storage.saveJob(job);
        this.broadcast({ type: "JOB_CANCELLED", job });
      } else {
        job.status = "completed";
        job.completedAt = Date.now();
        await this.storage.saveJob(job);
        this.broadcast({ type: "JOB_COMPLETED", job });
      }
    } catch (err) {
      if (signal.aborted) {
        job.status = "cancelled";
        await this.storage.saveJob(job);
        this.broadcast({ type: "JOB_CANCELLED", job });
      } else {
        const errorMsg =
          err instanceof Error ? err.message : "Job queue execution failure";
        job.status = "failed";
        job.error = errorMsg;
        await this.storage.saveJob(job);
        this.broadcast({ type: "JOB_FAILED", job, error: errorMsg });
      }
    } finally {
      this.stopHeartbeat();
    }
  }

  /**
   * Cancels the active extraction job via AbortController, retaining partial completed items.
   */
  async cancelJob(payload?: CancelJobPayload): Promise<JobState> {
    let job = this.currentJobState;
    if (!job && payload?.jobId) {
      job = await this.storage.getJob(payload.jobId);
    }
    if (!job) {
      const activeId = await this.storage.getActiveJobId();
      if (activeId) {
        job = await this.storage.getJob(activeId);
      }
    }

    if (!job) {
      throw createExtractionError("UNKNOWN", "No active job found to cancel");
    }

    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }

    this.stopHeartbeat();

    job.status = "cancelled";
    await this.storage.saveJob(job);
    this.broadcast({ type: "JOB_CANCELLED", job });

    return job;
  }

  /**
   * Gets current job status from memory or persistent storage.
   */
  async getJobStatus(payload?: GetJobStatusPayload): Promise<JobState | null> {
    if (payload?.jobId) {
      return this.storage.getJob(payload.jobId);
    }

    if (this.currentJobState) {
      return this.currentJobState;
    }

    const activeId = await this.storage.getActiveJobId();
    if (activeId) {
      const job = await this.storage.getJob(activeId);
      if (job) {
        this.currentJobState = job;
        return job;
      }
    }

    return null;
  }

  /**
   * Generates a .zip export package on-demand reading transcripts from storage per SPEC §6.1.
   */
  async downloadExport(
    payload?: DownloadExportPayload
  ): Promise<DownloadExportData> {
    let job = this.currentJobState;
    if (!job && payload?.jobId) {
      job = await this.storage.getJob(payload.jobId);
    }
    if (!job) {
      const activeId = await this.storage.getActiveJobId();
      if (activeId) {
        job = await this.storage.getJob(activeId);
      }
    }

    if (!job) {
      throw createExtractionError(
        "UNKNOWN",
        "No job found to generate export archive"
      );
    }

    const format: ExportFormat =
      payload?.format ?? job.format ?? "txt";
    const formatOptions: FormatOptions | undefined =
      payload?.formatOptions ?? job.formatOptions;
    const channelOrPlaylist =
      payload?.channelOrPlaylist ?? job.channelOrPlaylist ?? "transcripts";

    const archiveResult = await buildTranscriptArchive({
      items: job.items,
      getTranscript: async (
        videoId: string
      ): Promise<Transcript | null> => {
        return this.storage.getTranscript(job.id, videoId);
      },
      format,
      formatOptions,
      channelOrPlaylist,
      includeManifest: true,
    });

    const dataBase64 = uint8ArrayToBase64(archiveResult.zipData);
    const sanitizedTitle = sanitizeFilename(channelOrPlaylist);
    const filename = `${sanitizedTitle || "youtube-transcripts"}-export.zip`;

    return {
      filename,
      dataBase64,
      manifest: archiveResult.manifest,
    };
  }
}
