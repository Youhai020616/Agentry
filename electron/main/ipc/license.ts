/**
 * License IPC Handlers
 */
import { ipcMain } from 'electron';
import { LicenseValidator } from '../../utils/license-validator';
import type { LicenseInfo } from '../../utils/license-validator';
import { logger } from '../../utils/logger';
import { getStore } from '../../utils/store-factory';
import type { IpcContext } from './types';

async function getLicenseStore() {
  return getStore('agentry-license');
}

export function register(_ctx: IpcContext): void {
  const validator = new LicenseValidator();

  // license:validate — validate and store a license key
  ipcMain.handle('license:validate', async (_event, key: string) => {
    try {
      const info = validator.validate(key);
      if (info && info.isValid) {
        const store = await getLicenseStore();
        store.set('license', info);
        logger.info('License activated:', info.tier);
        return { success: true, result: info };
      }
      return { success: false, error: 'Invalid license key' };
    } catch (error) {
      logger.error('license:validate failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // license:status — get current license status
  ipcMain.handle('license:status', async () => {
    try {
      const store = await getLicenseStore();
      const info = store.get('license', null) as LicenseInfo | null;
      const status = validator.getStatus(info);
      return { success: true, result: { info, status } };
    } catch (error) {
      logger.error('license:status failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // license:deactivate — remove license
  ipcMain.handle('license:deactivate', async () => {
    try {
      const store = await getLicenseStore();
      store.delete('license');
      logger.info('License deactivated');
      return { success: true };
    } catch (error) {
      logger.error('license:deactivate failed:', error);
      return { success: false, error: String(error) };
    }
  });
}
