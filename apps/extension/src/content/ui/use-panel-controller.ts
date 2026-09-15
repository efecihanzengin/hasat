import { useCallback, useEffect, useRef, useState } from "react";
import {
  createExtractionError,
  type ExportFormat,
  type YouTubeContext,
} from "@youtube-transcript/core";
import { fetchSingleTranscript } from "../../background/fetcher.js";
import {
  TAB_DISCONNECTED_MESSAGE,
  YTE_LIVENESS_PORT,
  type FetchTranscriptRequestEvent,
  type JobPortEvent,
  type JobState,
  type ServiceWorkerResponse,
} from "../../background/types.js";
import { requestYouTubeContext } from "../bridge.js";
import { exportJobZip, type StorageReader } from "../exporter.js";
import { onPanelToggle } from "../shadow-shell.js";
import {
  detectSourceMetadata,
  type DetectedSource,
} from "../source-detector.js";
import { collectVideos } from "../video-collector.js";
import type { PanelViewState } from "./types.js";

export type PanelControllerOptions = {
  chromeRuntime?: typeof chrome.runtime;
  chromeStorage?: { local: StorageReader };
  doc?: Document;
};

function isContextValid(
  runtime: typeof chrome.runtime | null | undefined
): boolean {
  if (!runtime) return false;
  try {
    if (
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      runtime === chrome.runtime
    ) {
      return typeof runtime.id === "string" && runtime.id.length > 0;
    }
    return true;
  } catch {
    return false;
  }
}

export function usePanelController(options?: PanelControllerOptions) {
  const runtime =
    options?.chromeRuntime ??
    (typeof chrome !== "undefined" && chrome.runtime ? chrome.runtime : null);
  const doc =
    options?.doc ??
    (typeof document !== "undefined" ? document : ({} as Document));
  const storageArea =
    options?.chromeStorage?.local ??
    (typeof chrome !== "undefined" && chrome.storage?.local
      ? chrome.storage.local
      : undefined);

  // Configuration state
  const [selectedFormats, setSelectedFormats] = useState<ExportFormat[]>([
    "txt",
  ]);
  const [includeTimestamps, setIncludeTimestamps] = useState<boolean>(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("auto");

  // Job & View state
  const [viewState, setViewState] = useState<PanelViewState>("config");
  const [detectedSource, setDetectedSource] = useState<DetectedSource>(() =>
    detectSourceMetadata(null, doc)
  );
  const [context, setContext] = useState<YouTubeContext | null>(null);
  const [jobState, setJobState] = useState<JobState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [enumeratedCount, setEnumeratedCount] = useState<number>(0);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);

  const portRef = useRef<chrome.runtime.Port | null>(null);
  const enumAbortControllerRef = useRef<AbortController | null>(null);
  const contextRef = useRef<YouTubeContext | null>(null);

  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  // Helper to disconnect active port
  const disconnectPort = useCallback(() => {
    if (portRef.current) {
      try {
        portRef.current.disconnect();
      } catch {
        // already disconnected
      }
      portRef.current = null;
    }
  }, []);

  // Helper to establish Liveness Port with background service worker
  const connectLivenessPort = useCallback((): chrome.runtime.Port | null => {
    if (!isContextValid(runtime) || !runtime?.connect) {
      return null;
    }
    if (portRef.current) {
      return portRef.current;
    }

    try {
      const port = runtime.connect({ name: YTE_LIVENESS_PORT });
      portRef.current = port;

      port.onMessage.addListener((msg: unknown) => {
        const event = msg as JobPortEvent;
        if (!event || typeof event !== "object") return;

        if (event.type === "FETCH_TRANSCRIPT_REQUEST") {
          const req = event as FetchTranscriptRequestEvent;
          void (async () => {
            try {
              const res = await fetchSingleTranscript({
                videoId: req.payload.videoId,
                fallbackTitle: req.payload.fallbackTitle,
                context: req.payload.context ?? contextRef.current ?? undefined,
                preferredLanguage: req.payload.preferredLanguage,
              });
              try {
                port.postMessage({
                  type: "FETCH_TRANSCRIPT_RESPONSE",
                  requestId: req.requestId,
                  result: res,
                });
              } catch {
                // Port disconnected
              }
            } catch (err: unknown) {
              try {
                port.postMessage({
                  type: "FETCH_TRANSCRIPT_RESPONSE",
                  requestId: req.requestId,
                  result: {
                    ok: false,
                    error: createExtractionError(
                      "UNKNOWN",
                      err instanceof Error ? err.message : "Fetch failed"
                    ),
                  },
                });
              } catch {
                // Port disconnected
              }
            }
          })();
          return;
        }

        if (event.type === "JOB_PROGRESS") {
          setJobState(event.job);
        } else if (event.type === "JOB_COMPLETED") {
          setJobState(event.job);
          setViewState("completed");
          disconnectPort();
        } else if (event.type === "JOB_CANCELLED") {
          setJobState(event.job);
          setViewState("cancelled");
          disconnectPort();
        } else if (event.type === "JOB_PAUSED") {
          setJobState(event.job);
          setViewState("paused");
          setErrorMessage(event.message ?? event.job.error ?? null);
          disconnectPort();
        } else if (event.type === "JOB_FAILED") {
          setJobState(event.job);
          setViewState("failed");
          setErrorMessage(event.error || "Extraction failed");
          disconnectPort();
        }
      });

      port.onDisconnect.addListener(() => {
        // Read runtime.lastError to clear any unhandled port errors
        void runtime.lastError;
        portRef.current = null;
        setJobState((currentJob) => {
          if (currentJob?.status === "running") {
            setViewState("paused");
            setErrorMessage(TAB_DISCONNECTED_MESSAGE);
            return {
              ...currentJob,
              status: "paused",
              error: TAB_DISCONNECTED_MESSAGE,
            };
          }
          return currentJob;
        });
      });

      return port;
    } catch (err) {
      if (err instanceof Error && err.message.includes("Extension context invalidated")) {
        return null;
      }
      console.warn("[Panel Controller] Failed to connect liveness port:", err);
      return null;
    }
  }, [runtime, disconnectPort]);

  // Synchronizes state with Service Worker and refreshes detected page source
  const syncWithServiceWorker = useCallback(async () => {
    // 1. Fetch main-world context
    let currentSource: DetectedSource;
    try {
      const ctx = await requestYouTubeContext({ timeoutMs: 1500 });
      setContext(ctx);
      currentSource = detectSourceMetadata(ctx, doc);
      setDetectedSource(currentSource);
    } catch {
      currentSource = detectSourceMetadata(null, doc);
      setDetectedSource(currentSource);
    }

    // 2. Query active job status
    if (!isContextValid(runtime) || !runtime?.sendMessage) {
      return;
    }

    try {
      runtime.sendMessage(
        { type: "GET_JOB_STATUS" },
        (response: ServiceWorkerResponse<JobState | null>) => {
          // Read runtime.lastError to avoid "Unchecked runtime.lastError" in extensions panel
          const lastError = runtime.lastError;
          if (lastError) {
            return;
          }

          if (!response || !response.ok || !response.data) {
            return;
          }

          const existingJob = response.data;

          // If the job belongs to a different channel/playlist and is not actively running/paused,
          // do not restore it on this new page.
          if (
            existingJob.channelOrPlaylist &&
            currentSource.title &&
            existingJob.channelOrPlaylist !== currentSource.title &&
            existingJob.status !== "running" &&
            existingJob.status !== "paused"
          ) {
            if (isContextValid(runtime) && runtime.sendMessage) {
              try {
                runtime.sendMessage({ type: "CLEAR_ACTIVE_JOB" }, () => {
                  void runtime.lastError;
                });
              } catch {
                // context invalidated
              }
            }
            return;
          }

          setJobState(existingJob);

          if (existingJob.status === "running") {
            setErrorMessage(null);
            setViewState("running");
            connectLivenessPort();
          } else if (existingJob.status === "completed") {
            setErrorMessage(null);
            setViewState("completed");
          } else if (existingJob.status === "cancelled") {
            setErrorMessage(null);
            setViewState("cancelled");
          } else if (existingJob.status === "paused") {
            setViewState("paused");
            setErrorMessage(existingJob.error ?? null);
          } else if (existingJob.status === "failed") {
            setViewState("failed");
            setErrorMessage(existingJob.error ?? "Previous job failed");
          }
        }
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes("Extension context invalidated")) {
        return;
      }
      console.warn("[Panel Controller] Failed to get job status:", err);
    }
  }, [runtime, doc, connectLivenessPort]);

  // Initial sync on mount and register listener for drawer open/close
  useEffect(() => {
    void syncWithServiceWorker();

    const unsubscribe = onPanelToggle((isOpen) => {
      if (isOpen) {
        void syncWithServiceWorker();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [syncWithServiceWorker]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnectPort();
      if (enumAbortControllerRef.current) {
        enumAbortControllerRef.current.abort();
      }
    };
  }, [disconnectPort]);

  // Format selection toggle (ensures at least one format remains selected)
  const toggleFormat = useCallback((format: ExportFormat) => {
    setSelectedFormats((prev) => {
      if (prev.includes(format)) {
        if (prev.length <= 1) {
          return prev; // keep at least 1
        }
        return prev.filter((f) => f !== format);
      } else {
        return [...prev, format];
      }
    });
  }, []);

  // Initiate job start
  const startExtraction = useCallback(async () => {
    if (selectedFormats.length === 0) {
      setErrorMessage("Select at least one export format.");
      return;
    }

    setErrorMessage(null);
    setViewState("enumerating");
    setEnumeratedCount(0);

    const abortController = new AbortController();
    enumAbortControllerRef.current = abortController;

    // Establish liveness port with Service Worker
    connectLivenessPort();

    try {
      const videos = await collectVideos({
        context,
        signal: abortController.signal,
        doc,
        onProgress: (count) => {
          setEnumeratedCount(count);
        },
      });

      if (abortController.signal.aborted) {
        setViewState("config");
        return;
      }

      if (videos.length === 0) {
        setErrorMessage(
          "No videos found on this channel or playlist. Make sure the page is loaded."
        );
        setViewState("config");
        disconnectPort();
        return;
      }

      // Transition to running state and start background job
      setViewState("running");

      if (!isContextValid(runtime) || !runtime?.sendMessage) {
        throw new Error("Chrome runtime unavailable");
      }

      runtime.sendMessage(
        {
          type: "START_JOB",
          payload: {
            videos,
            context: context ?? undefined,
            preferredLanguage:
              selectedLanguage === "auto" ? undefined : selectedLanguage,
            format: selectedFormats[0],
            formats: selectedFormats,
            formatOptions: { includeTimestamps },
            channelOrPlaylist: detectedSource.title,
          },
        },
        (response: ServiceWorkerResponse<JobState>) => {
          const lastError = runtime.lastError;
          if (lastError) {
            setViewState("failed");
            setErrorMessage(lastError.message ?? "Extension context invalidated");
            disconnectPort();
            return;
          }

          if (!response || !response.ok) {
            setViewState("failed");
            setErrorMessage(
              response?.error?.message ?? "Failed to start extraction job"
            );
            disconnectPort();
          } else {
            setJobState(response.data);
          }
        }
      );
    } catch (err: unknown) {
      if (abortController.signal.aborted) {
        return;
      }
      setViewState("failed");
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to start extraction"
      );
      disconnectPort();
    } finally {
      enumAbortControllerRef.current = null;
    }
  }, [
    selectedFormats,
    includeTimestamps,
    selectedLanguage,
    context,
    doc,
    detectedSource.title,
    runtime,
    connectLivenessPort,
    disconnectPort,
  ]);

  // Cancel job
  const cancelExtraction = useCallback(() => {
    if (viewState === "enumerating") {
      if (enumAbortControllerRef.current) {
        enumAbortControllerRef.current.abort();
        enumAbortControllerRef.current = null;
      }
      setViewState("config");
      disconnectPort();
      return;
    }

    if (isContextValid(runtime) && runtime?.sendMessage) {
      try {
        runtime.sendMessage(
          {
            type: "CANCEL_JOB",
            payload: { jobId: jobState?.id },
          },
          (response: ServiceWorkerResponse<JobState>) => {
            void runtime.lastError;
            if (response?.ok && response.data) {
              setJobState(response.data);
            }
            setViewState("cancelled");
            disconnectPort();
          }
        );
      } catch {
        // context invalidated
      }
    }
  }, [viewState, runtime, jobState?.id, disconnectPort]);

  // Download export zip directly in content script per memory constraints
  const downloadExport = useCallback(async () => {
    if (!jobState) {
      return;
    }

    setIsDownloading(true);
    setErrorMessage(null);

    try {
      await exportJobZip({
        job: jobState,
        formats: selectedFormats,
        formatOptions: { includeTimestamps },
        channelOrPlaylist: detectedSource.title,
        storageArea,
        doc,
      });
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to generate export zip"
      );
    } finally {
      setIsDownloading(false);
    }
  }, [
    jobState,
    selectedFormats,
    includeTimestamps,
    detectedSource.title,
    storageArea,
    doc,
  ]);

  // Reset back to config
  const resetToConfig = useCallback(() => {
    setViewState("config");
    setJobState(null);
    setErrorMessage(null);
    disconnectPort();
    if (isContextValid(runtime) && runtime?.sendMessage) {
      try {
        runtime.sendMessage({ type: "CLEAR_ACTIVE_JOB" }, () => {
          void runtime.lastError;
        });
      } catch {
        // runtime unavailable
      }
    }
  }, [disconnectPort, runtime]);

  // Resume paused extraction
  const resumeExtraction = useCallback(async () => {
    if (!jobState) {
      return;
    }

    setErrorMessage(null);
    setViewState("running");
    connectLivenessPort();

    if (!isContextValid(runtime) || !runtime?.sendMessage) {
      setViewState("failed");
      setErrorMessage("Chrome runtime unavailable");
      return;
    }

    try {
      runtime.sendMessage(
        {
          type: "RESUME_JOB",
          payload: { jobId: jobState.id },
        },
        (response: ServiceWorkerResponse<JobState>) => {
          const lastError = runtime.lastError;
          if (lastError) {
            setViewState("failed");
            setErrorMessage(lastError.message ?? "Extension context invalidated");
            disconnectPort();
            return;
          }

          if (!response || !response.ok) {
            setViewState("failed");
            setErrorMessage(
              response?.error?.message ?? "Failed to resume extraction job"
            );
            disconnectPort();
          } else {
            setJobState(response.data);
          }
        }
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes("Extension context invalidated")) {
        setViewState("failed");
        setErrorMessage("Extension context invalidated");
        disconnectPort();
        return;
      }
      throw err;
    }
  }, [jobState, runtime, connectLivenessPort, disconnectPort]);

  return {
    viewState,
    detectedSource,
    selectedFormats,
    toggleFormat,
    includeTimestamps,
    setIncludeTimestamps,
    selectedLanguage,
    setSelectedLanguage,
    startExtraction,
    cancelExtraction,
    resumeExtraction,
    downloadExport,
    resetToConfig,
    jobState,
    errorMessage,
    enumeratedCount,
    isDownloading,
  };
}
