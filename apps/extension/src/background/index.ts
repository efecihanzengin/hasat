import {
  createExtractionError,
  type ExtractionError,
} from "@youtube-transcript/core";
import { JobManager } from "./job-manager.js";
import { ChromeJobStorage } from "./storage.js";
import {
  isCancelJobMessage,
  isClearActiveJobMessage,
  isGetJobStatusMessage,
  isPingMessage,
  isResumeJobMessage,
  isStartJobMessage,
  YTE_LIVENESS_PORT,
  type ServiceWorkerResponse,
} from "./types.js";

export * from "./types.js";
export * from "./storage.js";
export * from "./retry.js";
export * from "./fetcher.js";
export * from "./queue.js";
export * from "./job-manager.js";

const storage = new ChromeJobStorage();
export const jobManager = new JobManager({ storage });
(globalThis as unknown as { jobManager: JobManager }).jobManager = jobManager;

function toExtractionError(
  err: unknown,
  fallbackMessage: string
): ExtractionError {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    "message" in err &&
    typeof (err as ExtractionError).code === "string" &&
    typeof (err as ExtractionError).message === "string"
  ) {
    return err as ExtractionError;
  }
  return createExtractionError(
    "UNKNOWN",
    err instanceof Error ? err.message : fallbackMessage
  );
}

export function createMessageRouter(manager: JobManager) {
  return (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ServiceWorkerResponse) => void
  ): boolean => {
    if (isStartJobMessage(message)) {
      manager
        .startJob(message.payload)
        .then((job) => sendResponse({ ok: true, data: job }))
        .catch((err: unknown) => {
          sendResponse({
            ok: false,
            error: toExtractionError(err, "Failed to start job"),
          });
        });
      return true;
    }

    if (isCancelJobMessage(message)) {
      manager
        .cancelJob(message.payload)
        .then((job) => sendResponse({ ok: true, data: job }))
        .catch((err: unknown) => {
          sendResponse({
            ok: false,
            error: toExtractionError(err, "Failed to cancel job"),
          });
        });
      return true;
    }

    if (isGetJobStatusMessage(message)) {
      manager
        .getJobStatus(message.payload)
        .then((job) => sendResponse({ ok: true, data: job }))
        .catch((err: unknown) => {
          sendResponse({
            ok: false,
            error: toExtractionError(err, "Failed to get job status"),
          });
        });
      return true;
    }

    if (isResumeJobMessage(message)) {
      manager
        .resumeJob(message.payload)
        .then((job) => sendResponse({ ok: true, data: job }))
        .catch((err: unknown) => {
          sendResponse({
            ok: false,
            error: toExtractionError(err, "Failed to resume job"),
          });
        });
      return true;
    }

    if (isClearActiveJobMessage(message)) {
      manager
        .clearActiveJob()
        .then(() => sendResponse({ ok: true, data: { cleared: true } }))
        .catch((err: unknown) => {
          sendResponse({
            ok: false,
            error: toExtractionError(err, "Failed to clear active job"),
          });
        });
      return true;
    }

    if (isPingMessage(message)) {
      sendResponse({ ok: true, data: { pong: true } });
      return false;
    }

    return false;
  };
}

if (typeof chrome !== "undefined" && chrome.runtime) {
  chrome.runtime.onInstalled?.addListener(() => {
    console.log("[Background] Service worker initialized");
  });

  chrome.runtime.onConnect?.addListener((port) => {
    if (port.name === YTE_LIVENESS_PORT) {
      jobManager.registerPort(port);
    }
  });

  chrome.runtime.onMessage?.addListener(createMessageRouter(jobManager));
}
