import { defaultDelay, type DelayFunction } from "./retry.js";

export const DEFAULT_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 5;
export const MIN_JITTER_MS = 1000;
export const MAX_JITTER_MS = 2000;

export function getRandomJitterDelay(
  min = MIN_JITTER_MS,
  max = MAX_JITTER_MS
): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

export type QueueOptions<T, R> = {
  concurrency?: number;
  getJitterDelay?: () => number;
  delayFn?: DelayFunction;
  signal?: AbortSignal;
  onItemStart?: (item: T) => void | Promise<void>;
  onItemComplete?: (item: T, result: R) => void | Promise<void>;
  onItemError?: (item: T, error: unknown) => void | Promise<void>;
};

export type QueueProcessStats = {
  total: number;
  processed: number;
  aborted: boolean;
};

/**
 * Throttled concurrent queue processor with jittered delays and AbortSignal support.
 * Complies with SPEC §4.3: Concurrency 1 by default (configurable, hard ceiling 5),
 * and 1000-2000ms jittered delay between requests.
 */
export async function processQueue<T, R>(
  items: readonly T[],
  processItem: (item: T, signal?: AbortSignal) => Promise<R>,
  options?: QueueOptions<T, R>
): Promise<QueueProcessStats> {
  const signal = options?.signal;
  if (items.length === 0 || signal?.aborted) {
    return {
      total: items.length,
      processed: 0,
      aborted: Boolean(signal?.aborted),
    };
  }

  const requestedConcurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
  const effectiveConcurrency = Math.max(
    1,
    Math.min(requestedConcurrency, MAX_CONCURRENCY)
  );
  const workerCount = Math.min(items.length, effectiveConcurrency);

  const getJitter = options?.getJitterDelay ?? getRandomJitterDelay;
  const delay = options?.delayFn ?? defaultDelay;

  let nextIndex = 0;
  let processedCount = 0;

  async function worker(): Promise<void> {
    while (true) {
      if (signal?.aborted) {
        break;
      }

      if (nextIndex >= items.length) {
        break;
      }

      const currentIndex = nextIndex;
      nextIndex += 1;

      const item = items[currentIndex];
      if (item === undefined) {
        break;
      }

      try {
        await options?.onItemStart?.(item);
      } catch {
        // Consumer callback errors should not crash queue worker
      }

      try {
        const result = await processItem(item, signal);
        processedCount += 1;
        try {
          await options?.onItemComplete?.(item, result);
        } catch {
          // Consumer callback errors should not crash queue worker
        }
      } catch (err) {
        processedCount += 1;
        try {
          await options?.onItemError?.(item, err);
        } catch {
          // Consumer callback errors should not crash queue worker
        }
      }

      if (signal?.aborted) {
        break;
      }

      // If more work remains, apply pacing jitter delay
      if (nextIndex < items.length) {
        const jitterMs = getJitter();
        if (jitterMs > 0) {
          try {
            await delay(jitterMs, signal);
          } catch {
            if (signal?.aborted) {
              break;
            }
          }
        }
      }
    }
  }

  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  return {
    total: items.length,
    processed: processedCount,
    aborted: Boolean(signal?.aborted),
  };
}
