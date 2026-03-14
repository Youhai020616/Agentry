/**
 * Performance Tracker
 * Lightweight local-only telemetry for IPC handler timing.
 * No external reporting — all data stays in-process for diagnostics.
 */
import { logger } from './logger';

interface PerfEntry {
  name: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

const MAX_ENTRIES = 500;
const SLOW_THRESHOLD_MS = 2000;

class PerformanceTracker {
  private entries: PerfEntry[] = [];

  /**
   * Start timing an operation. Returns a `done()` function to call when finished.
   *
   * @example
   * ```ts
   * const done = perf.start('employee:list');
   * // ... do work ...
   * done(); // records timing
   * ```
   */
  start(name: string): () => void {
    const startMs = Date.now();
    return () => {
      const endMs = Date.now();
      const durationMs = endMs - startMs;
      const entry: PerfEntry = { name, startMs, endMs, durationMs };

      this.entries.push(entry);
      if (this.entries.length > MAX_ENTRIES) {
        this.entries.shift();
      }

      if (durationMs > SLOW_THRESHOLD_MS) {
        logger.warn(`[perf] Slow IPC: ${name} took ${durationMs}ms`);
      }
    };
  }

  /**
   * Wrap an async function with automatic timing.
   *
   * @example
   * ```ts
   * const result = await perf.wrap('employee:list', async () => {
   *   return employeeManager.list();
   * });
   * ```
   */
  async wrap<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const done = this.start(name);
    try {
      return await fn();
    } finally {
      done();
    }
  }

  /**
   * Get entries slower than a threshold.
   */
  getSlow(thresholdMs = SLOW_THRESHOLD_MS): PerfEntry[] {
    return this.entries.filter((e) => e.durationMs > thresholdMs);
  }

  /**
   * Get aggregate stats per IPC channel.
   */
  getStats(): Array<{
    name: string;
    count: number;
    avgMs: number;
    maxMs: number;
    p95Ms: number;
  }> {
    const byName = new Map<string, number[]>();
    for (const e of this.entries) {
      const arr = byName.get(e.name) ?? [];
      arr.push(e.durationMs);
      byName.set(e.name, arr);
    }

    return Array.from(byName.entries())
      .map(([name, durations]) => {
        durations.sort((a, b) => a - b);
        const count = durations.length;
        const avgMs = Math.round(durations.reduce((a, b) => a + b, 0) / count);
        const maxMs = durations[count - 1];
        const p95Ms = durations[Math.floor(count * 0.95)] ?? maxMs;
        return { name, count, avgMs, maxMs, p95Ms };
      })
      .sort((a, b) => b.maxMs - a.maxMs);
  }

  /**
   * Get recent entries (newest first).
   */
  getRecent(limit = 50): PerfEntry[] {
    return this.entries.slice(-limit).reverse();
  }

  /** Clear all entries */
  clear(): void {
    this.entries.length = 0;
  }
}

/** Singleton instance */
export const perf = new PerformanceTracker();
