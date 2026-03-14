/**
 * Star Office IPC Handlers
 * Virtual office UI backend lifecycle management.
 */
import { ipcMain } from 'electron';
import type { IpcContext } from './types';

export function register({ mainWindow, starOfficeManager }: IpcContext): void {
  if (!starOfficeManager) return;

  ipcMain.handle('star-office:start', async () => {
    try {
      await starOfficeManager.start();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('star-office:stop', async () => {
    try {
      await starOfficeManager.stop();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('star-office:restart', async () => {
    try {
      await starOfficeManager.restart();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('star-office:status', () => {
    return { success: true, result: starOfficeManager.getStatus() };
  });

  ipcMain.handle('star-office:get-url', () => {
    return { success: true, result: starOfficeManager.getUrl() };
  });

  // Forward status events to renderer
  starOfficeManager.on('status', (status) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('star-office:status-changed', status);
    }
  });

  starOfficeManager.on('error', (error) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('star-office:status-changed', {
        ...starOfficeManager.getStatus(),
        error: error.message,
      });
    }
  });
}
