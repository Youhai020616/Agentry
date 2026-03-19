/**
 * Config Update Queue
 *
 * Promise-based mutex that serializes read-modify-write cycles on openclaw.json.
 * Prevents race conditions when multiple employees activate/deactivate concurrently
 * and all need to update the shared Gateway config file.
 *
 * Usage:
 *   import { configUpdateQueue } from './config-update-queue';
 *
 *   await configUpdateQueue.enqueue(async () => {
 *     const config = readOpenClawConfig();
 *     // ... modify config ...
 *     writeOpenClawConfig(config);
 *   });
 *
 * The queue guarantees that only one config mutation runs at a time.
 * If a mutation throws, the error propagates to the caller but does NOT
 * block subsequent enqueued operations.
 */
import { logger } from '../utils/logger';

export class ConfigUpdateQueue {
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;

  /**
   * Enqueue a config mutation function.
   * The function will execute only after all previously enqueued operations complete.
   * Returns the result of the function.
   *
   * If the function throws, the error is propagated to the caller but the queue
   * continues processing subsequent operations (the failed operation is skipped).
   */
  async enqueue<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
    this.pending++;
    logger.debug(`[ConfigUpdateQueue] Enqueued operation (pending: ${this.pending})`);

    const executeWithRetry = async (): Promise<T> => {
      let lastError: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          return await fn();
        } catch (err) {
          lastError = err;
          if (attempt < retries) {
            const delay = 100 * (attempt + 1);
            logger.warn(
              `[ConfigUpdateQueue] Attempt ${attempt + 1}/${retries + 1} failed, retrying in ${delay}ms...`
            );
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }
      throw lastError;
    };

    const result = new Promise<T>((resolve, reject) => {
      this.queue = this.queue
        .then(async () => {
          try {
            const value = await executeWithRetry();
            resolve(value);
          } catch (err) {
            reject(err);
          } finally {
            this.pending--;
            logger.debug(`[ConfigUpdateQueue] Operation complete (pending: ${this.pending})`);
          }
        })
        // Catch so a rejected operation doesn't break the chain for subsequent operations
        .catch(() => {
          // Error already propagated via reject() above; keep the chain alive
        });
    });

    return result;
  }

  /**
   * Number of operations currently waiting (including the one running).
   */
  get size(): number {
    return this.pending;
  }
}

/**
 * Singleton instance — use this throughout the app to serialize all openclaw.json writes.
 */
export const configUpdateQueue = new ConfigUpdateQueue();
