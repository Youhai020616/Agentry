/**
 * WhatsApp Login IPC Handlers
 */
import { ipcMain } from 'electron';
import { whatsAppLoginManager } from '../../utils/whatsapp-login';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';

export function register({ mainWindow }: IpcContext): void {
  ipcMain.handle('channel:requestWhatsAppQr', async (_, accountId: string) => {
    try {
      logger.info('channel:requestWhatsAppQr', { accountId });
      await whatsAppLoginManager.start(accountId);
      return { success: true };
    } catch (error) {
      logger.error('channel:requestWhatsAppQr failed', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('channel:cancelWhatsAppQr', async () => {
    try {
      await whatsAppLoginManager.stop();
      return { success: true };
    } catch (error) {
      logger.error('channel:cancelWhatsAppQr failed', error);
      return { success: false, error: String(error) };
    }
  });

  whatsAppLoginManager.on('qr', (data) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('channel:whatsapp-qr', data);
  });

  whatsAppLoginManager.on('success', (data) => {
    if (!mainWindow.isDestroyed()) {
      logger.info('whatsapp:login-success', data);
      mainWindow.webContents.send('channel:whatsapp-success', data);
    }
  });

  whatsAppLoginManager.on('error', (error) => {
    if (!mainWindow.isDestroyed()) {
      logger.error('whatsapp:login-error', error);
      mainWindow.webContents.send('channel:whatsapp-error', error);
    }
  });
}
