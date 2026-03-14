/**
 * Log IPC Handlers
 * Allows the renderer to read application logs for diagnostics.
 */
import { ipcMain } from 'electron';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';

export function register(_ctx: IpcContext): void {
  ipcMain.handle('log:getRecent', async (_, count?: number) => {
    return logger.getRecentLogs(count);
  });

  ipcMain.handle('log:readFile', async (_, tailLines?: number) => {
    return logger.readLogFile(tailLines);
  });

  ipcMain.handle('log:getFilePath', async () => {
    return logger.getLogFilePath();
  });

  ipcMain.handle('log:getDir', async () => {
    return logger.getLogDir();
  });

  ipcMain.handle('log:listFiles', async () => {
    return logger.listLogFiles();
  });
}
