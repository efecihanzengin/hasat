import {
  createExtractionError,
  type ExtractionError,
} from "@youtube-transcript/core";

export const DEFAULT_429_BACKOFF_SCHEDULE = [
  1000, 2000, 4000, 8000,
] as const;

export type DelayFunction = (
  ms: number,
  signal?: AbortSignal
) => Promise<void>;

export async function defaultDelay(
  ms: number,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted", "AbortError"));
    }

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export type RetryableOperationResult<T> =
  | { type: "success"; value: T }
  | { type: "rate_limited" }
  | { type: "failure"; error: ExtractionError };

export type RetryOptions = {
  backoffSchedule?: readonly number[];
  delayFn?: DelayFunction;
  signal?: AbortSignal;
  onRetry?: (attempt: number, delayMs: number) => void;
};

/**
 * Executes an operation with exponential backoff on HTTP 429 rate limit responses.
 * Follows SPEC §4.3: 1s, 2s, 4s, 8s (up to 4 retries). If all retries fail with 429,
 * returns an ExtractionError with code RATE_LIMITED.
 */
export async function executeWith429Retry<T>(
  operation: (attempt: number) => Promise<RetryableOperationResult<T>>,
  options?: RetryOptions
): Promise<
  { ok: true; value: T } | { ok: false; error: ExtractionError }
> {
  const schedule = options?.backoffSchedule ?? DEFAULT_429_BACKOFF_SCHEDULE;
  const delay = options?.delayFn ?? defaultDelay;
  const signal = options?.signal;
  const maxRetries = schedule.length;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      return {
        ok: false,
        error: createExtractionError("UNKNOWN", "Operation cancelled"),
      };
    }

    let result: RetryableOperationResult<T>;
    try {
      result = await operation(attempt);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return {
          ok: false,
          error: createExtractionError("UNKNOWN", "Operation cancelled"),
        };
      }
      const message =
        err instanceof Error ? err.message : "Unexpected operation exception";
      return {
        ok: false,
        error: createExtractionError("UNKNOWN", message),
      };
    }

    if (result.type === "success") {
      return { ok: true, value: result.value };
    }

    if (result.type === "failure") {
      return { ok: false, error: result.error };
    }

    // Rate limited
    if (attempt < maxRetries) {
      const waitMs = schedule[attempt] as number;
      options?.onRetry?.(attempt + 1, waitMs);
      try {
        await delay(waitMs, signal);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return {
            ok: false,
            error: createExtractionError("UNKNOWN", "Operation cancelled"),
          };
        }
        throw err;
      }
    }
  }

  return {
    ok: false,
    error: createExtractionError("RATE_LIMITED"),
  };
}
