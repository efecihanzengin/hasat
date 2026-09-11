import type { Transcript } from "@youtube-transcript/core";
import type { JobState } from "./types.js";

export interface JobStorage {
  saveJob(job: JobState): Promise<void>;
  getJob(jobId: string): Promise<JobState | null>;
  getActiveJobId(): Promise<string | null>;
  setActiveJobId(jobId: string | null): Promise<void>;
  saveTranscript(
    jobId: string,
    videoId: string,
    transcript: Transcript
  ): Promise<void>;
  getTranscript(jobId: string, videoId: string): Promise<Transcript | null>;
  getAllJobTranscripts(jobId: string): Promise<Map<string, Transcript>>;
  clearJob(jobId: string): Promise<void>;
}

export const ACTIVE_JOB_KEY = "active_job_id" as const;

export function formatJobStorageKey(jobId: string): string {
  return `job:${jobId}`;
}

export function formatTranscriptStorageKey(
  jobId: string,
  videoId: string
): string {
  return `transcript:${jobId}:${videoId}`;
}

export class MemoryJobStorage implements JobStorage {
  private store = new Map<string, unknown>();

  async saveJob(job: JobState): Promise<void> {
    this.store.set(formatJobStorageKey(job.id), structuredClone(job));
  }

  async getJob(jobId: string): Promise<JobState | null> {
    const data = this.store.get(formatJobStorageKey(jobId));
    if (!data) return null;
    return structuredClone(data as JobState);
  }

  async getActiveJobId(): Promise<string | null> {
    const id = this.store.get(ACTIVE_JOB_KEY);
    return typeof id === "string" ? id : null;
  }

  async setActiveJobId(jobId: string | null): Promise<void> {
    if (jobId === null) {
      this.store.delete(ACTIVE_JOB_KEY);
    } else {
      this.store.set(ACTIVE_JOB_KEY, jobId);
    }
  }

  async saveTranscript(
    jobId: string,
    videoId: string,
    transcript: Transcript
  ): Promise<void> {
    this.store.set(
      formatTranscriptStorageKey(jobId, videoId),
      structuredClone(transcript)
    );
  }

  async getTranscript(
    jobId: string,
    videoId: string
  ): Promise<Transcript | null> {
    const data = this.store.get(formatTranscriptStorageKey(jobId, videoId));
    if (!data) return null;
    return structuredClone(data as Transcript);
  }

  async getAllJobTranscripts(jobId: string): Promise<Map<string, Transcript>> {
    const prefix = `transcript:${jobId}:`;
    const result = new Map<string, Transcript>();
    for (const [key, val] of this.store.entries()) {
      if (key.startsWith(prefix)) {
        const videoId = key.slice(prefix.length);
        result.set(videoId, structuredClone(val as Transcript));
      }
    }
    return result;
  }

  async clearJob(jobId: string): Promise<void> {
    this.store.delete(formatJobStorageKey(jobId));
    const active = await this.getActiveJobId();
    if (active === jobId) {
      await this.setActiveJobId(null);
    }
    const prefix = `transcript:${jobId}:`;
    const keysToDelete: string[] = [];
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.store.delete(key);
    }
  }
}

export class ChromeJobStorage implements JobStorage {
  async saveJob(job: JobState): Promise<void> {
    const key = formatJobStorageKey(job.id);
    await chrome.storage.local.set({ [key]: job });
  }

  async getJob(jobId: string): Promise<JobState | null> {
    const key = formatJobStorageKey(jobId);
    const result = await chrome.storage.local.get(key);
    const val = result[key];
    return val ? (val as JobState) : null;
  }

  async getActiveJobId(): Promise<string | null> {
    const result = await chrome.storage.local.get(ACTIVE_JOB_KEY);
    const val = result[ACTIVE_JOB_KEY];
    return typeof val === "string" ? val : null;
  }

  async setActiveJobId(jobId: string | null): Promise<void> {
    if (jobId === null) {
      await chrome.storage.local.remove(ACTIVE_JOB_KEY);
    } else {
      await chrome.storage.local.set({ [ACTIVE_JOB_KEY]: jobId });
    }
  }

  async saveTranscript(
    jobId: string,
    videoId: string,
    transcript: Transcript
  ): Promise<void> {
    const key = formatTranscriptStorageKey(jobId, videoId);
    await chrome.storage.local.set({ [key]: transcript });
  }

  async getTranscript(
    jobId: string,
    videoId: string
  ): Promise<Transcript | null> {
    const key = formatTranscriptStorageKey(jobId, videoId);
    const result = await chrome.storage.local.get(key);
    const val = result[key];
    return val ? (val as Transcript) : null;
  }

  async getAllJobTranscripts(jobId: string): Promise<Map<string, Transcript>> {
    const all = await chrome.storage.local.get(null);
    const prefix = `transcript:${jobId}:`;
    const result = new Map<string, Transcript>();
    for (const [key, val] of Object.entries(all)) {
      if (key.startsWith(prefix) && val) {
        const videoId = key.slice(prefix.length);
        result.set(videoId, val as Transcript);
      }
    }
    return result;
  }

  async clearJob(jobId: string): Promise<void> {
    const active = await this.getActiveJobId();
    const toRemove: string[] = [formatJobStorageKey(jobId)];
    if (active === jobId) {
      toRemove.push(ACTIVE_JOB_KEY);
    }

    const all = await chrome.storage.local.get(null);
    const prefix = `transcript:${jobId}:`;
    for (const key of Object.keys(all)) {
      if (key.startsWith(prefix)) {
        toRemove.push(key);
      }
    }

    await chrome.storage.local.remove(toRemove);
  }
}
