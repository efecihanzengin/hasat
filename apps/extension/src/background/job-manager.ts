import {
  createExtractionError,
  type ExtractionError,
  type ExtractionResult,
  type JobItem,
  type Transcript,
  type YouTubeContext,
} from "@youtube-transcript/core";
import {
  fetchSingleTranscript,
  type FetchTranscriptOptions,
} from "./fetcher.js";
import { processQueue } from "./queue.js";
import { type DelayFunction } from "./retry.js";
import { ChromeJobStorage, type JobStorage } from "./storage.js";
import {
  TAB_DISCONNECTED_MESSAGE,
  YTE_LIVENESS_PORT,
  type CancelJobPayload,
  type FetchTranscriptResponseEvent,
  type GetJobStatusPayload,
  type JobPortEvent,
  type JobState,
  type ResumeJobPayload,
  type StartJobPayload,
} from "./types.js";

export const CIRCUIT_BREAKER_RATE_LIMIT_THRESHOLD = 3;
export const CIRCUIT_BREAKER_MESSAGE =
  "YouTube hız sınırı — tamamlananlar kaydedildi, sonra devam edebilirsin";
export { TAB_DISCONNECTED_MESSAGE };

export type JobManagerOptions = {
  storage?: JobStorage;
  fetchFn?: typeof fetch;
  fetchTranscriptFn?: (
    options: FetchTranscriptOptions
  ) => Promise<ExtractionResult<Transcript>>;
  delayFn?: DelayFunction;
  getJitterDelay?: () => number;
  backoffSchedule?: readonly number[];
};

export class JobManager {
  private storage: JobStorage;
  private fetchFn?: typeof fetch;
  private fetchTranscriptFn?: (
    options: FetchTranscriptOptions
  ) => Promise<ExtractionResult<Transcript>>;
  private delayFn?: DelayFunction;
  private getJitterDelay?: () => number;
  private backoffSchedule?: readonly number[];

  private currentJobState: JobState | null = null;
  private currentAbortController: AbortController | null = null;
  private connectedPorts = new Set<chrome.runtime.Port>();
  private activePort: chrome.runtime.Port | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private pendingPortRequests = new Map<
    string,
    {
      resolve: (res: ExtractionResult<Transcript>) => void;
      reject: (err: unknown) => void;
      port: chrome.runtime.Port;
    }
  >();

  constructor(options?: JobManagerOptions) {
    this.storage = options?.storage ?? new ChromeJobStorage();
    this.fetchFn = options?.fetchFn;
    this.fetchTranscriptFn = options?.fetchTranscriptFn;
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
    this.activePort = port;

    port.onDisconnect.addListener(() => {
      this.connectedPorts.delete(port);
      const wasActivePort = this.activePort === port;
      if (wasActivePort) {
        this.activePort = null;
      }

      // If a job is actively running and the active content script port disconnected, pause the job first
      if (this.currentJobState?.status === "running" && wasActivePort) {
        void this.handlePortDisconnectWhileRunning();
      }

      // Reject any pending requests that were dispatched to this port
      for (const [requestId, pending] of this.pendingPortRequests) {
        if (pending.port === port) {
          this.pendingPortRequests.delete(requestId);
          pending.reject(
            createExtractionError("UNKNOWN", TAB_DISCONNECTED_MESSAGE)
          );
        }
      }

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
      } else if (
        typeof msg === "object" &&
        msg !== null &&
        (msg as { type?: string }).type === "FETCH_TRANSCRIPT_RESPONSE"
      ) {
        const resp = msg as FetchTranscriptResponseEvent;
        const pending = this.pendingPortRequests.get(resp.requestId);
        if (pending) {
          this.pendingPortRequests.delete(resp.requestId);
          pending.resolve(resp.result);
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
    if (this.activePort === port) {
      const remaining = Array.from(this.connectedPorts);
      this.activePort = remaining.length > 0 ? (remaining[0] ?? null) : null;
    }
  }

  getActivePort(): chrome.runtime.Port | null {
    if (this.activePort) {
      return this.activePort;
    }
    const ports = Array.from(this.connectedPorts);
    return ports.length > 0 ? (ports[0] ?? null) : null;
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
   * Handles unexpected port disconnection while a job is running (tab closed or navigated away).
   * Pauses the job, preserves completed transcripts, resets fetching items, and records user-facing message.
   */
  async handlePortDisconnectWhileRunning(): Promise<void> {
    const job = this.currentJobState;
    if (!job || (job.status !== "running" && job.status !== "paused")) {
      return;
    }

    console.warn(
      `[JobManager] Content script port disconnected while job running. Pausing job: ${TAB_DISCONNECTED_MESSAGE}`
    );

    job.status = "paused";
    job.error = TAB_DISCONNECTED_MESSAGE;

    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }

    // Reset any items that were mid-flight back to pending so resume can retry them
    for (const item of job.items) {
      if (
        item.status === "fetching" ||
        (item.status === "failed" &&
          item.error?.message === TAB_DISCONNECTED_MESSAGE)
      ) {
        if (item.status === "failed") {
          job.summary.failed = Math.max(0, job.summary.failed - 1);
        }
        item.status = "pending";
        item.error = undefined;
      }
    }

    await this.storage.saveJob(job);
    this.stopHeartbeat();
    this.broadcast({
      type: "JOB_PAUSED",
      job,
      message: TAB_DISCONNECTED_MESSAGE,
    });
  }

  /**
   * Delegates transcript extraction to the active Content Script port.
   */
  private async fetchTranscriptViaPort(
    port: chrome.runtime.Port,
    options: {
      videoId: string;
      fallbackTitle?: string;
      context?: YouTubeContext;
      preferredLanguage?: string;
      signal?: AbortSignal;
    }
  ): Promise<ExtractionResult<Transcript>> {
    if (options.signal?.aborted) {
      return {
        ok: false,
        error: createExtractionError("UNKNOWN", "Operation cancelled"),
      };
    }

    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<ExtractionResult<Transcript>>((resolve, reject) => {
      const cleanup = () => {
        this.pendingPortRequests.delete(requestId);
      };

      const onAbort = () => {
        cleanup();
        resolve({
          ok: false,
          error: createExtractionError("UNKNOWN", "Operation cancelled"),
        });
      };

      if (options.signal) {
        options.signal.addEventListener("abort", onAbort, { once: true });
      }

      this.pendingPortRequests.set(requestId, {
        resolve: (res) => {
          if (options.signal) {
            options.signal.removeEventListener("abort", onAbort);
          }
          cleanup();
          resolve(res);
        },
        reject: (err) => {
          if (options.signal) {
            options.signal.removeEventListener("abort", onAbort);
          }
          cleanup();
          reject(err);
        },
        port,
      });

      try {
        port.postMessage({
          type: "FETCH_TRANSCRIPT_REQUEST",
          requestId,
          payload: {
            videoId: options.videoId,
            fallbackTitle: options.fallbackTitle,
            context: options.context,
            preferredLanguage: options.preferredLanguage,
          },
        });
      } catch {
        cleanup();
        reject(
          createExtractionError("UNKNOWN", TAB_DISCONNECTED_MESSAGE)
        );
      }
    });
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
        cached: 0,
      },
      channelOrPlaylist: payload.channelOrPlaylist,
      preferredLanguage: payload.preferredLanguage,
      format: payload.format,
      formats: payload.formats,
      formatOptions: payload.formatOptions,
      context: payload.context,
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
    let consecutiveRateLimits = 0;
    let circuitBreakerTripped = false;

    try {
      const itemsToProcess = job.items.filter(
        (item) => item.status !== "done" && item.status !== "skipped"
      );

      if (itemsToProcess.length === 0) {
        job.status = "completed";
        job.completedAt = Date.now();
        await this.storage.saveJob(job);
        await this.storage.setActiveJobId(null);
        this.broadcast({ type: "JOB_COMPLETED", job });
        return;
      }

      await processQueue(
        itemsToProcess,
        async (
          item,
          workerSignal
        ): Promise<{ fromCache?: boolean; skipped?: boolean }> => {
          if (
            workerSignal?.aborted ||
            signal.aborted ||
            job.status === "paused"
          ) {
            return { skipped: true };
          }

          // If item is already completed or skipped (e.g. on resume), do not re-process
          if (item.status === "done" || item.status === "skipped") {
            return { skipped: true };
          }

          const targetLang = payload.preferredLanguage || "auto";

          // 1. Check transcript cache first before hitting network
          const cachedTranscript = await this.storage.getCachedTranscript(
            item.videoId,
            targetLang
          );

          if (cachedTranscript) {
            item.fromCache = true;
            item.status = "done";
            item.error = undefined;
            await this.storage.saveTranscript(
              job.id,
              item.videoId,
              cachedTranscript
            );
            job.summary.done += 1;
            job.summary.cached = (job.summary.cached ?? 0) + 1;
            consecutiveRateLimits = 0;

            await this.storage.saveJob(job);
            this.broadcast({
              type: "JOB_PROGRESS",
              job,
              updatedItem: item,
            });
            return { fromCache: true };
          }

          item.status = "fetching";
          await this.storage.saveJob(job);
          this.broadcast({
            type: "JOB_PROGRESS",
            job,
            updatedItem: item,
          });

          let result: ExtractionResult<Transcript>;
          try {
            const activePort = this.getActivePort();
            if (activePort) {
              result = await this.fetchTranscriptViaPort(activePort, {
                videoId: item.videoId,
                fallbackTitle: item.title,
                context: payload.context,
                preferredLanguage: payload.preferredLanguage,
                signal: workerSignal ?? signal,
              });
            } else if (this.fetchTranscriptFn) {
              result = await this.fetchTranscriptFn({
                videoId: item.videoId,
                fallbackTitle: item.title,
                context: payload.context,
                preferredLanguage: payload.preferredLanguage,
                signal: workerSignal ?? signal,
              });
            } else if (this.fetchFn) {
              result = await fetchSingleTranscript({
                videoId: item.videoId,
                fallbackTitle: item.title,
                context: payload.context,
                preferredLanguage: payload.preferredLanguage,
                signal: workerSignal ?? signal,
                fetchFn: this.fetchFn,
                delayFn: this.delayFn,
                backoffSchedule: this.backoffSchedule,
              });
            } else {
              throw createExtractionError(
                "UNKNOWN",
                TAB_DISCONNECTED_MESSAGE
              );
            }
          } catch (fetchErr) {
            if (signal.aborted || this.currentJobState?.status === "paused") {
              return { skipped: true };
            }
            const errMsg =
              fetchErr instanceof Error
                ? fetchErr.message
                : typeof fetchErr === "object" &&
                    fetchErr !== null &&
                    "message" in fetchErr
                  ? String((fetchErr as { message: unknown }).message)
                  : "Fetch failed";

            if (errMsg === TAB_DISCONNECTED_MESSAGE) {
              await this.handlePortDisconnectWhileRunning();
              return { skipped: true };
            }

            result = {
              ok: false,
              error: createExtractionError("UNKNOWN", errMsg),
            };
          }

          if (signal.aborted || this.currentJobState?.status === "paused") {
            return { skipped: true };
          }

          if (result.ok) {
            // Persist completed transcript immediately per ADR-0002
            await this.storage.saveTranscript(
              job.id,
              item.videoId,
              result.value
            );
            // Save to transcript cache under targetLang
            await this.storage.saveCachedTranscript(
              item.videoId,
              targetLang,
              result.value
            );
            // Also cache under actual detected language if different
            if (result.value.language && result.value.language !== targetLang) {
              await this.storage.saveCachedTranscript(
                item.videoId,
                result.value.language,
                result.value
              );
            }

            item.status = "done";
            item.error = undefined;
            job.summary.done += 1;
            consecutiveRateLimits = 0;
          } else {
            const error: ExtractionError = result.error;
            item.error = error;
            if (error.code === "LIVE_STREAM") {
              item.status = "skipped";
              job.summary.skipped += 1;
              consecutiveRateLimits = 0;
            } else {
              item.status = "failed";
              job.summary.failed += 1;
              if (error.code === "RATE_LIMITED") {
                consecutiveRateLimits += 1;
                if (
                  consecutiveRateLimits >= CIRCUIT_BREAKER_RATE_LIMIT_THRESHOLD
                ) {
                  circuitBreakerTripped = true;
                  abortController.abort();
                }
              } else {
                consecutiveRateLimits = 0;
              }
            }
          }

          // Persist updated job index immediately per ADR-0002
          await this.storage.saveJob(job);
          this.broadcast({
            type: "JOB_PROGRESS",
            job,
            updatedItem: item,
          });
          return {};
        },
        {
          concurrency: payload.concurrency,
          getJitterDelay: this.getJitterDelay,
          delayFn: this.delayFn,
          signal,
          shouldDelay: (_item, res) => !res?.fromCache && !res?.skipped,
        }
      );

      if (this.currentJobState?.status === "paused") {
        // Paused by port disconnection handler
        return;
      }

      if (circuitBreakerTripped) {
        job.status = "paused";
        job.error = CIRCUIT_BREAKER_MESSAGE;
        await this.storage.saveJob(job);
        this.broadcast({
          type: "JOB_PAUSED",
          job,
          message: CIRCUIT_BREAKER_MESSAGE,
        });
      } else if (signal.aborted) {
        job.status = "cancelled";
        await this.storage.saveJob(job);
        await this.storage.setActiveJobId(null);
        this.broadcast({ type: "JOB_CANCELLED", job });
      } else {
        job.status = "completed";
        job.completedAt = Date.now();
        await this.storage.saveJob(job);
        await this.storage.setActiveJobId(null);
        this.broadcast({ type: "JOB_COMPLETED", job });
      }
    } catch (err) {
      if (this.currentJobState?.status === "paused") {
        return;
      }

      if (circuitBreakerTripped) {
        job.status = "paused";
        job.error = CIRCUIT_BREAKER_MESSAGE;
        await this.storage.saveJob(job);
        this.broadcast({
          type: "JOB_PAUSED",
          job,
          message: CIRCUIT_BREAKER_MESSAGE,
        });
      } else if (signal.aborted) {
        job.status = "cancelled";
        await this.storage.saveJob(job);
        await this.storage.setActiveJobId(null);
        this.broadcast({ type: "JOB_CANCELLED", job });
      } else {
        const errorMsg =
          err instanceof Error ? err.message : "Job queue execution failure";
        job.status = "failed";
        job.error = errorMsg;
        await this.storage.saveJob(job);
        await this.storage.setActiveJobId(null);
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
    await this.storage.setActiveJobId(null);
    this.broadcast({ type: "JOB_CANCELLED", job });

    return job;
  }

  /**
   * Clears active job state and storage reference.
   */
  async clearActiveJob(): Promise<void> {
    this.currentJobState = null;
    await this.storage.setActiveJobId(null);
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
        if (
          job.status === "completed" ||
          job.status === "cancelled" ||
          job.status === "failed"
        ) {
          await this.storage.setActiveJobId(null);
          return null;
        }
        this.currentJobState = job;
        return job;
      }
    }

    return null;
  }

  /**
   * Resumes a paused extraction job (e.g. after circuit breaker triggered or tab disconnected).
   */
  async resumeJob(payload?: ResumeJobPayload): Promise<JobState> {
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
      throw createExtractionError("UNKNOWN", "No active job found to resume");
    }

    if (job.status !== "paused") {
      throw createExtractionError(
        "UNKNOWN",
        `Cannot resume job with status "${job.status}"`
      );
    }

    // Reset rate-limited failed items, tab-disconnected items, and mid-flight fetching items back to pending
    for (const item of job.items) {
      if (item.status === "fetching") {
        item.status = "pending";
      }
      if (
        item.status === "failed" &&
        (item.error?.code === "RATE_LIMITED" ||
          item.error?.message === TAB_DISCONNECTED_MESSAGE)
      ) {
        item.status = "pending";
        item.error = undefined;
        job.summary.failed = Math.max(0, job.summary.failed - 1);
      }
    }

    job.status = "running";
    job.error = undefined;
    this.currentJobState = job;
    this.currentAbortController = new AbortController();

    await this.storage.saveJob(job);
    this.startHeartbeat();
    this.broadcast({ type: "JOB_PROGRESS", job });

    const resumePayload: StartJobPayload = {
      jobId: job.id,
      videos: job.items.map((i) => ({ videoId: i.videoId, title: i.title })),
      context: job.context,
      preferredLanguage: job.preferredLanguage,
      format: job.format,
      formats: job.formats,
      formatOptions: job.formatOptions,
      channelOrPlaylist: job.channelOrPlaylist,
    };

    void this.executeJobQueue(resumePayload, this.currentAbortController);

    return job;
  }
}
