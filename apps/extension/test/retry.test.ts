import { describe, it, expect, vi } from "vitest";
import {
  executeWith429Retry,
  DEFAULT_429_BACKOFF_SCHEDULE,
  type RetryableOperationResult,
} from "../src/background/retry.js";
import { createExtractionError } from "@youtube-transcript/core";

describe("executeWith429Retry", () => {
  it("returns value immediately when operation succeeds on first attempt", async () => {
    const op = vi.fn().mockResolvedValue({
      type: "success",
      value: "ok-data",
    } satisfies RetryableOperationResult<string>);

    const result = await executeWith429Retry(op);

    expect(result).toEqual({ ok: true, value: "ok-data" });
    expect(op).toHaveBeenCalledTimes(1);
    expect(op).toHaveBeenCalledWith(0);
  });

  it("does not retry on non-429 failure and returns the error", async () => {
    const op = vi.fn().mockResolvedValue({
      type: "failure",
      error: createExtractionError("NO_CAPTIONS"),
    } satisfies RetryableOperationResult<string>);

    const result = await executeWith429Retry(op);

    expect(result).toEqual({
      ok: false,
      error: createExtractionError("NO_CAPTIONS"),
    });
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("retries with 1s, 2s, 4s, 8s backoff schedule on 429 and succeeds when recovered", async () => {
    const delays: number[] = [];
    const mockDelay = vi.fn(async (ms: number) => {
      delays.push(ms);
    });

    let calls = 0;
    const op = vi.fn(
      async (attempt: number): Promise<RetryableOperationResult<string>> => {
        calls += 1;
        if (attempt < 2) {
          return { type: "rate_limited" };
        }
        return { type: "success", value: "recovered" };
      }
    );

    const result = await executeWith429Retry(op, {
      delayFn: mockDelay,
    });

    expect(result).toEqual({ ok: true, value: "recovered" });
    expect(calls).toBe(3); // attempt 0, attempt 1 (rate limited), attempt 2 (success)
    expect(delays).toEqual([1000, 2000]);
  });

  it("exhausts all 4 retries on persistent 429 and returns RATE_LIMITED error", async () => {
    const delays: number[] = [];
    const mockDelay = vi.fn(async (ms: number) => {
      delays.push(ms);
    });

    const op = vi.fn().mockResolvedValue({
      type: "rate_limited",
    } satisfies RetryableOperationResult<string>);

    const result = await executeWith429Retry(op, {
      delayFn: mockDelay,
    });

    expect(result).toEqual({
      ok: false,
      error: createExtractionError("RATE_LIMITED"),
    });
    // Initial attempt (0) + 4 retries (1, 2, 3, 4) = 5 calls
    expect(op).toHaveBeenCalledTimes(5);
    expect(delays).toEqual([...DEFAULT_429_BACKOFF_SCHEDULE]);
  });

  it("aborts immediately if AbortSignal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const op = vi.fn();
    const result = await executeWith429Retry(op, {
      signal: controller.signal,
    });

    expect(result.ok).toBe(false);
    expect(op).not.toHaveBeenCalled();
  });

  it("aborts during retry delay when signal is aborted", async () => {
    const controller = new AbortController();
    const op = vi.fn().mockResolvedValue({
      type: "rate_limited",
    } satisfies RetryableOperationResult<string>);

    const mockDelay = vi.fn(async (_ms: number, signal?: AbortSignal) => {
      controller.abort();
      if (signal?.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
    });

    const result = await executeWith429Retry(op, {
      delayFn: mockDelay,
      signal: controller.signal,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNKNOWN");
      expect(result.error.message).toContain("cancelled");
    }
  });

  it("invokes onRetry callback with attempt number and waitMs", async () => {
    const retries: { attempt: number; waitMs: number }[] = [];
    const mockDelay = vi.fn(async () => {});

    let callCount = 0;
    const op = vi.fn(async (): Promise<RetryableOperationResult<string>> => {
      callCount += 1;
      if (callCount <= 2) {
        return { type: "rate_limited" };
      }
      return { type: "success", value: "ok" };
    });

    await executeWith429Retry(op, {
      delayFn: mockDelay,
      onRetry: (attempt, waitMs) => {
        retries.push({ attempt, waitMs });
      },
    });

    expect(retries).toEqual([
      { attempt: 1, waitMs: 1000 },
      { attempt: 2, waitMs: 2000 },
    ]);
  });
});
