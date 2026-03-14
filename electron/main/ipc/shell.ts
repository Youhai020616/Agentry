/**
 * Shell IPC Handlers
 */
import { ipcMain, shell } from 'electron';
import type { IpcContext } from './types';

export function register(_ctx: IpcContext): void {
  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    await shell.openExternal(url);
  });

  ipcMain.handle('shell:showItemInFolder', async (_, path: string) => {
    shell.showItemInFolder(path);
  });

  ipcMain.handle('shell:openPath', async (_, path: string) => {
    return await shell.openPath(path);
  });
}
