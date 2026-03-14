/**
 * Extension IPC Handlers
 */
import { ipcMain } from 'electron';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';

export function register({ mainWindow }: IpcContext): void {
  // extension:check — Batch-detect extension status
  ipcMain.handle('extension:check', async (_event, params: { requires: string[] }) => {
    try {
      const { getExtensionInstaller } = await import('../../engine/extension-installer');
      const installer = getExtensionInstaller();
      const results = await installer.checkAll(params.requires);
      // Convert Map to plain object for IPC serialization
      const obj: Record<string, unknown> = {};
      for (const [k, v] of results) {
        obj[k] = v;
      }
      return { success: true, result: obj };
    } catch (error) {
      logger.error('extension:check failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // extension:install — Install a single extension
  ipcMain.handle('extension:install', async (_event, params: { name: string }) => {
    try {
      const { getExtensionInstaller } = await import('../../engine/extension-installer');
      const installer = getExtensionInstaller();
      const result = await installer.install(params.name, (event) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('extension:install-progress', event);
        }
      });
      return { success: true, result };
    } catch (error) {
      logger.error('extension:install failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // extension:installAll — Install all missing extensions
  ipcMain.handle('extension:installAll', async (_event, params: { requires: string[] }) => {
    try {
      const { getExtensionInstaller } = await import('../../engine/extension-installer');
      const installer = getExtensionInstaller();
      const result = await installer.installAll(params.requires, (event) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('extension:install-progress', event);
        }
      });
      return { success: true, result };
    } catch (error) {
      logger.error('extension:installAll failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // extension:start — Start a service extension
  ipcMain.handle(
    'extension:start',
    async (_event, params: { name: string; options?: Record<string, unknown> }) => {
      try {
        const { getExtensionInstaller } = await import('../../engine/extension-installer');
        const installer = getExtensionInstaller();
        const result = await installer.start(params.name, params.options);
        return { success: true, result };
      } catch (error) {
        logger.error('extension:start failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // extension:stop — Stop a service extension
  ipcMain.handle('extension:stop', async (_event, params: { name: string }) => {
    try {
      const { getExtensionInstaller } = await import('../../engine/extension-installer');
      const installer = getExtensionInstaller();
      const result = await installer.stop(params.name);
      return { success: true, result };
    } catch (error) {
      logger.error('extension:stop failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // extension:health — Health check for a service extension
  ipcMain.handle('extension:health', async (_event, params: { name: string }) => {
    try {
      const { getExtensionInstaller } = await import('../../engine/extension-installer');
      const installer = getExtensionInstaller();
      const healthy = await installer.health(params.name);
      return { success: true, result: healthy };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
