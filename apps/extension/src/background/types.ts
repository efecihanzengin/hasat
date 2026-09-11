import type {
  ExportFormat,
  ExtractionError,
  FormatOptions,
  JobItem,
  VideoItem,
  YouTubeContext,
} from "@youtube-transcript/core";

export const YTE_LIVENESS_PORT = "yte-liveness-port" as const;

export type JobStatus =
  | "idle"
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export type JobSummary = {
  total: number;
  done: number;
  skipped: number;
  failed: number;
};

export type JobState = {
  id: string;
  status: JobStatus;
  items: JobItem[];
  summary: JobSummary;
  channelOrPlaylist?: string;
  preferredLanguage?: string;
  format?: ExportFormat;
  formats?: ExportFormat[];
  formatOptions?: FormatOptions;
  createdAt: number;
  completedAt?: number;
  error?: string;
};

export type StartJobPayload = {
  jobId?: string;
  videos: VideoItem[];
  context?: YouTubeContext;
  preferredLanguage?: string;
  format?: ExportFormat;
  formats?: ExportFormat[];
  formatOptions?: FormatOptions;
  channelOrPlaylist?: string;
  concurrency?: number;
};

export type StartJobMessage = {
  type: "START_JOB";
  payload: StartJobPayload;
};

export type CancelJobPayload = {
  jobId?: string;
};

export type CancelJobMessage = {
  type: "CANCEL_JOB";
  payload?: CancelJobPayload;
};

export type GetJobStatusPayload = {
  jobId?: string;
};

export type GetJobStatusMessage = {
  type: "GET_JOB_STATUS";
  payload?: GetJobStatusPayload;
};

export type PingMessage = {
  type: "PING";
};

export type ServiceWorkerMessage =
  | StartJobMessage
  | CancelJobMessage
  | GetJobStatusMessage
  | PingMessage;

export type ServiceWorkerResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: ExtractionError };

export type JobProgressEvent = {
  type: "JOB_PROGRESS";
  job: JobState;
  updatedItem?: JobItem;
};

export type JobCompletedEvent = {
  type: "JOB_COMPLETED";
  job: JobState;
};

export type JobCancelledEvent = {
  type: "JOB_CANCELLED";
  job: JobState;
};

export type JobFailedEvent = {
  type: "JOB_FAILED";
  job: JobState;
  error: string;
};

export type PongEvent = {
  type: "PONG";
};

export type JobPortEvent =
  | JobProgressEvent
  | JobCompletedEvent
  | JobCancelledEvent
  | JobFailedEvent
  | PongEvent;

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

export function isStartJobMessage(val: unknown): val is StartJobMessage {
  if (!isRecord(val) || val.type !== "START_JOB" || !isRecord(val.payload)) {
    return false;
  }
  const payload = val.payload;
  if (!Array.isArray(payload.videos)) {
    return false;
  }
  for (const item of payload.videos) {
    if (
      !isRecord(item) ||
      typeof item.videoId !== "string" ||
      typeof item.title !== "string"
    ) {
      return false;
    }
  }
  return true;
}

export function isCancelJobMessage(val: unknown): val is CancelJobMessage {
  if (!isRecord(val) || val.type !== "CANCEL_JOB") {
    return false;
  }
  if (val.payload !== undefined && !isRecord(val.payload)) {
    return false;
  }
  return true;
}

export function isGetJobStatusMessage(val: unknown): val is GetJobStatusMessage {
  if (!isRecord(val) || val.type !== "GET_JOB_STATUS") {
    return false;
  }
  if (val.payload !== undefined && !isRecord(val.payload)) {
    return false;
  }
  return true;
}

export function isPingMessage(val: unknown): val is PingMessage {
  return isRecord(val) && val.type === "PING";
}

export function isServiceWorkerMessage(
  val: unknown
): val is ServiceWorkerMessage {
  return (
    isStartJobMessage(val) ||
    isCancelJobMessage(val) ||
    isGetJobStatusMessage(val) ||
    isPingMessage(val)
  );
}
