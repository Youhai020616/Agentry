/**
 * UV IPC Handlers
 * Python environment management via uv.
 */
import { ipcMain } from 'electron';
import { checkUvInstalled, installUv, setupManagedPython } from '../../utils/uv-setup';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';

export function register(_ctx: IpcContext): void {
  ipcMain.handle('uv:check', async () => {
    return await checkUvInstalled();
  });

  ipcMain.handle('uv:install-all', async () => {
    try {
      const isInstalled = await checkUvInstalled();
      if (!isInstalled) {
        await installUv();
      }
      await setupManagedPython();
      return { success: true };
    } catch (error) {
      logger.error('Failed to setup uv/python:', error);
      return { success: false, error: String(error) };
    }
  });
}
