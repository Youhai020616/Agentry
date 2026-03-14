/**
 * Window Control IPC Handlers
 * For custom title bar on Windows/Linux.
 */
import { ipcMain } from 'electron';
import type { IpcContext } from './types';

export function register({ mainWindow }: IpcContext): void {
  ipcMain.handle('window:minimize', () => {
    mainWindow.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle('window:close', () => {
    mainWindow.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow.isMaximized();
  });
}
