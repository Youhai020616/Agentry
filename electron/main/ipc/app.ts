/**
 * App IPC Handlers
 */
import { ipcMain, app } from 'electron';
import type { IpcContext } from './types';

export function register(_ctx: IpcContext): void {
  ipcMain.handle('app:version', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:name', () => {
    return app.getName();
  });

  ipcMain.handle('app:getPath', (_, name: Parameters<typeof app.getPath>[0]) => {
    return app.getPath(name);
  });

  ipcMain.handle('app:platform', () => {
    return process.platform;
  });

  ipcMain.handle('app:quit', () => {
    app.quit();
  });

  ipcMain.handle('app:relaunch', () => {
    app.relaunch();
    app.quit();
  });
}
