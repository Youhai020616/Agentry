/**
 * Dialog IPC Handlers
 */
import { ipcMain, dialog } from 'electron';
import type { IpcContext } from './types';

export function register(_ctx: IpcContext): void {
  ipcMain.handle('dialog:open', async (_, options: Electron.OpenDialogOptions) => {
    const result = await dialog.showOpenDialog(options);
    return result;
  });

  ipcMain.handle('dialog:save', async (_, options: Electron.SaveDialogOptions) => {
    const result = await dialog.showSaveDialog(options);
    return result;
  });

  ipcMain.handle('dialog:message', async (_, options: Electron.MessageBoxOptions) => {
    const result = await dialog.showMessageBox(options);
    return result;
  });
}
