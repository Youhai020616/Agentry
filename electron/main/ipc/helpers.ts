/**
 * IPC Handler Helpers
 * Standardized wrapper for IPC handlers with:
 *  - Automatic try/catch + error logging
 *  - Performance timing via perf tracker
 */
import { ipcMain } from 'electron';
import { logger } from '../../utils/logger';
import { perf } from '../../utils/perf';

type IpcSuccess<T> = { success: true; result: T };
type IpcError = { success: false; error: string };
type IpcResult<T> = IpcSuccess<T> | IpcError;

/**
 * Register an IPC handler with automatic error handling, logging, and perf tracking.
 *
 * @example
 * ```ts
 * ipcHandle('employee:list', async () => {
 *   return getManager().list();
 * });
 * ```
 * Returns `{ success: true, result: T }` on success,
 * `{ success: false, error: string }` on failure.
 */
export function ipcHandle<T>(
  channel: string,
  fn: (...args: unknown[]) => Promise<T> | T
): void {
  ipcMain.handle(
    channel,
    async (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]): Promise<IpcResult<T>> => {
      const done = perf.start(channel);
      try {
        const result = await fn(...args);
        return { success: true, result };
      } catch (error) {
        logger.error(`${channel} failed:`, error);
        return { success: false, error: String(error) };
      } finally {
        done();
      }
    }
  );
}
