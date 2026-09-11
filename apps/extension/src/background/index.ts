import { JobManager } from "./job-manager.js";
import { ChromeJobStorage } from "./storage.js";
import {
  isCancelJobMessage,
  isDownloadExportMessage,
  isGetJobStatusMessage,
  isPingMessage,
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
          const errorMsg =
            err instanceof Error ? err.message : "Failed to start job";
          sendResponse({ ok: false, error: errorMsg });
        });
      return true;
    }

    if (isCancelJobMessage(message)) {
      manager
        .cancelJob(message.payload)
        .then((job) => sendResponse({ ok: true, data: job }))
        .catch((err: unknown) => {
          const errorMsg =
            err instanceof Error ? err.message : "Failed to cancel job";
          sendResponse({ ok: false, error: errorMsg });
        });
      return true;
    }

    if (isGetJobStatusMessage(message)) {
      manager
        .getJobStatus(message.payload)
        .then((job) => sendResponse({ ok: true, data: job }))
        .catch((err: unknown) => {
          const errorMsg =
            err instanceof Error ? err.message : "Failed to get job status";
          sendResponse({ ok: false, error: errorMsg });
        });
      return true;
    }

    if (isDownloadExportMessage(message)) {
      manager
        .downloadExport(message.payload)
        .then((exportData) => sendResponse({ ok: true, data: exportData }))
        .catch((err: unknown) => {
          const errorMsg =
            err instanceof Error ? err.message : "Failed to generate export";
          sendResponse({ ok: false, error: errorMsg });
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
