/**
 * Ollama IPC Handlers
 */
import { ipcMain } from 'electron';
import { ollamaManager } from '../../utils/ollama-manager';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';

export function register({ mainWindow }: IpcContext): void {
  // ollama:status — get installation & running status + models
  ipcMain.handle('ollama:status', async () => {
    try {
      const status = await ollamaManager.getStatus();
      return { success: true, result: status };
    } catch (error) {
      logger.error('ollama:status failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // ollama:listModels — list locally installed models
  ipcMain.handle('ollama:listModels', async () => {
    try {
      const models = await ollamaManager.listModels();
      return { success: true, result: models };
    } catch (error) {
      logger.error('ollama:listModels failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // ollama:pullModel — pull a model (streaming progress via events)
  let pullAbortController: AbortController | null = null;

  ipcMain.handle('ollama:pullModel', async (_event, name: string) => {
    try {
      // Abort any existing pull
      if (pullAbortController) {
        pullAbortController.abort();
      }
      pullAbortController = new AbortController();
      const { signal } = pullAbortController;

      await ollamaManager.pullModel(
        name,
        (progress) => {
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ollama:pull-progress', { name, ...progress });
          }
        },
        signal
      );

      pullAbortController = null;
      return { success: true };
    } catch (error) {
      pullAbortController = null;
      const msg = String(error);
      if (msg.includes('cancelled') || msg.includes('aborted')) {
        return { success: false, error: 'Pull cancelled' };
      }
      logger.error('ollama:pullModel failed:', error);
      return { success: false, error: msg };
    }
  });

  // ollama:deleteModel — delete a locally installed model
  ipcMain.handle('ollama:deleteModel', async (_event, name: string) => {
    try {
      const deleted = await ollamaManager.deleteModel(name);
      if (deleted) {
        return { success: true };
      }
      return { success: false, error: 'Failed to delete model' };
    } catch (error) {
      logger.error('ollama:deleteModel failed:', error);
      return { success: false, error: String(error) };
    }
  });
}
