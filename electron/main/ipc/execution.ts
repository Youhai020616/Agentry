/**
 * Execution IPC Handlers
 */
import { ipcMain } from 'electron';
import { logger } from '../../utils/logger';
import type { ExecutionOptions } from '../../engine/execution-worker';
import type { IpcContext } from './types';

export function register({ engineRef, gatewayManager }: IpcContext): void {
  const getLazy = async () => {
    if (!engineRef.current) throw new Error('Engine not initialized');
    return engineRef.current.getLazy(gatewayManager);
  };

  ipcMain.handle('execution:run', async (_, id: string, options: ExecutionOptions) => {
    try {
      const lazy = await getLazy();
      const result = await lazy.executionWorker.run(id, options);
      return { success: true, result };
    } catch (error) {
      logger.error('execution:run failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('execution:cancel', async (_, id: string) => {
    try {
      const lazy = await getLazy();
      lazy.executionWorker.cancel(id);
      return { success: true };
    } catch (error) {
      logger.error('execution:cancel failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('execution:status', async (_, id: string) => {
    try {
      const lazy = await getLazy();
      const status = lazy.executionWorker.getStatus(id);
      return { success: true, result: status };
    } catch (error) {
      logger.error('execution:status failed:', error);
      return { success: false, error: String(error) };
    }
  });
}
