import { describe, it, expect, vi } from "vitest";
import {
  processQueue,
  getRandomJitterDelay,
  MIN_JITTER_MS,
  MAX_JITTER_MS,
  MAX_CONCURRENCY,
} from "../src/background/queue.js";

describe("queue", () => {
  describe("getRandomJitterDelay", () => {
    it("returns values within 1000ms and 2000ms range", () => {
      for (let i = 0; i < 50; i++) {
        const delay = getRandomJitterDelay();
        expect(delay).toBeGreaterThanOrEqual(MIN_JITTER_MS);
        expect(delay).toBeLessThanOrEqual(MAX_JITTER_MS);
      }
    });
  });

  describe("processQueue", () => {
    it("throttles execution to default concurrency 1 when unspecified", async () => {
      let activeWorkers = 0;
      let maxActiveWorkers = 0;
      const items = [1, 2, 3, 4];

      const processed = await processQueue(
        items,
        async () => {
          activeWorkers += 1;
          if (activeWorkers > maxActiveWorkers) {
            maxActiveWorkers = activeWorkers;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
          activeWorkers -= 1;
          return true;
        },
        {
          getJitterDelay: () => 0,
        }
      );

      expect(maxActiveWorkers).toBe(1);
      expect(processed.total).toBe(4);
      expect(processed.processed).toBe(4);
      expect(processed.aborted).toBe(false);
    });

    it("throttles execution to specified concurrency limit", async () => {
      let activeWorkers = 0;
      let maxActiveWorkers = 0;
      const items = [1, 2, 3, 4, 5, 6, 7, 8];

      const processed = await processQueue(
        items,
        async () => {
          activeWorkers += 1;
          if (activeWorkers > maxActiveWorkers) {
            maxActiveWorkers = activeWorkers;
          }
          // Micro delay to simulate async work
          await new Promise((resolve) => setTimeout(resolve, 10));
          activeWorkers -= 1;
          return true;
        },
        {
          concurrency: 3,
          getJitterDelay: () => 0,
        }
      );

      expect(maxActiveWorkers).toBeLessThanOrEqual(3);
      expect(processed.total).toBe(8);
      expect(processed.processed).toBe(8);
      expect(processed.aborted).toBe(false);
    });

    it("enforces hard ceiling of 5 even if higher concurrency is requested", async () => {
      let activeWorkers = 0;
      let maxActiveWorkers = 0;
      const items = Array.from({ length: 15 }, (_, i) => i);

      await processQueue(
        items,
        async () => {
          activeWorkers += 1;
          if (activeWorkers > maxActiveWorkers) {
            maxActiveWorkers = activeWorkers;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
          activeWorkers -= 1;
        },
        {
          concurrency: 10, // Exceeds ceiling of 5
          getJitterDelay: () => 0,
        }
      );

      expect(maxActiveWorkers).toBeLessThanOrEqual(MAX_CONCURRENCY);
    });

    it("applies jitter delay between sequential items processed by workers", async () => {
      const delays: number[] = [];
      const mockDelay = vi.fn(async (ms: number) => {
        delays.push(ms);
      });

      const items = [1, 2, 3, 4];
      await processQueue(items, async (item) => item * 2, {
        concurrency: 1, // Single worker makes jitter delay invocations deterministic
        getJitterDelay: () => 300,
        delayFn: mockDelay,
      });

      // 4 items processed sequentially by 1 worker -> 3 delays between requests
      expect(delays.length).toBe(3);
      expect(delays.every((d) => d === 300)).toBe(true);
    });

    it("cleanly cancels pending items when AbortController aborts", async () => {
      const controller = new AbortController();
      const items = [1, 2, 3, 4, 5, 6, 7, 8];
      const completed: number[] = [];

      const statsPromise = processQueue(
        items,
        async (item) => {
          if (item === 2) {
            controller.abort();
          }
          completed.push(item);
          await new Promise((resolve) => setTimeout(resolve, 10));
          return item;
        },
        {
          concurrency: 1,
          getJitterDelay: () => 0,
          signal: controller.signal,
        }
      );

      const stats = await statsPromise;
      expect(stats.aborted).toBe(true);
      expect(completed.length).toBeLessThan(items.length);
    });

    it("continues queue execution when individual items encounter errors", async () => {
      const items = [1, 2, 3, 4];
      const completed: number[] = [];
      const errors: unknown[] = [];

      const stats = await processQueue(
        items,
        async (item) => {
          if (item === 2) {
            throw new Error("Item 2 failed");
          }
          completed.push(item);
        },
        {
          concurrency: 2,
          getJitterDelay: () => 0,
          onItemError: (_item, err) => {
            errors.push(err);
          },
        }
      );

      expect(stats.processed).toBe(4);
      expect(completed).toEqual([1, 3, 4]);
      expect(errors.length).toBe(1);
    });

    it("respects shouldDelay callback to bypass jitter delay for non-network or cached items", async () => {
      const delays: number[] = [];
      const mockDelay = vi.fn(async (ms: number) => {
        delays.push(ms);
      });

      const items = [
        { id: 1, cached: true },
        { id: 2, cached: false },
        { id: 3, cached: true },
        { id: 4, cached: false },
      ];

      await processQueue(
        items,
        async (item) => item,
        {
          concurrency: 1,
          getJitterDelay: () => 1500,
          delayFn: mockDelay,
          shouldDelay: (_item, result) => !result.cached,
        }
      );

      // Only items 2 and 4 were not cached; item 2 triggers delay before 3.
      // Item 4 is the last item, so no delay after it.
      expect(delays.length).toBe(1);
      expect(delays[0]).toBe(1500);
    });

    it("handles empty items array gracefully", async () => {
      const stats = await processQueue([], async () => {});
      expect(stats.total).toBe(0);
      expect(stats.processed).toBe(0);
      expect(stats.aborted).toBe(false);
    });
  });
});
