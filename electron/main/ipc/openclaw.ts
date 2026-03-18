/**
 * OpenClaw & Channel Config IPC Handlers
 */
import { ipcMain } from 'electron';
import { existsSync } from 'node:fs';
import {
  getOpenClawStatus,
  getOpenClawDir,
  getOpenClawConfigDir,
  getOpenClawSkillsDir,
  ensureDir,
} from '../../utils/paths';
import { getOpenClawCliCommand, installOpenClawCliMac } from '../../utils/openclaw-cli';
import {
  saveChannelConfig,
  getChannelConfig,
  getChannelFormValues,
  deleteChannelConfig,
  listConfiguredChannels,
  setChannelEnabled,
  validateChannelConfig,
  validateChannelCredentials,
} from '../../utils/channel-config';
import { configUpdateQueue } from '../../engine/config-update-queue';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';

export function register(ctx: IpcContext): void {
  ipcMain.handle('openclaw:status', () => {
    const status = getOpenClawStatus();
    logger.info('openclaw:status IPC called', status);
    return status;
  });

  ipcMain.handle('openclaw:isReady', () => {
    const status = getOpenClawStatus();
    return status.packageExists;
  });

  ipcMain.handle('openclaw:getDir', () => getOpenClawDir());

  ipcMain.handle('openclaw:getConfigDir', () => getOpenClawConfigDir());

  ipcMain.handle('openclaw:getSkillsDir', () => {
    const dir = getOpenClawSkillsDir();
    ensureDir(dir);
    return dir;
  });

  ipcMain.handle('openclaw:getCliCommand', () => {
    try {
      const status = getOpenClawStatus();
      if (!status.packageExists) {
        return { success: false, error: `OpenClaw package not found at: ${status.dir}` };
      }
      if (!existsSync(status.entryPath)) {
        return { success: false, error: `OpenClaw entry script not found at: ${status.entryPath}` };
      }
      return { success: true, command: getOpenClawCliCommand() };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('openclaw:installCliMac', async () => installOpenClawCliMac());

  // ── Channel Configuration ──────────────────────────────────────

  ipcMain.handle(
    'channel:saveConfig',
    async (_, channelType: string, config: Record<string, unknown>) => {
      try {
        logger.info('channel:saveConfig', { channelType, keys: Object.keys(config || {}) });
        await configUpdateQueue.enqueue(async () => {
          saveChannelConfig(channelType, config);
        });
        try {
          await ctx.employeeManager.syncChannelBindings();
        } catch (err) {
          logger.warn(`Failed to sync channel bindings after saveConfig: ${err}`);
        }
        return { success: true };
      } catch (error) {
        logger.error('Failed to save channel config:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('channel:getConfig', async (_, channelType: string) => {
    try {
      const config = getChannelConfig(channelType);
      return { success: true, config };
    } catch (error) {
      logger.error('Failed to get channel config:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('channel:getFormValues', async (_, channelType: string) => {
    try {
      const values = getChannelFormValues(channelType);
      return { success: true, values };
    } catch (error) {
      logger.error('Failed to get channel form values:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('channel:deleteConfig', async (_, channelType: string) => {
    try {
      await configUpdateQueue.enqueue(async () => deleteChannelConfig(channelType));
      return { success: true };
    } catch (error) {
      logger.error('Failed to delete channel config:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('channel:listConfigured', async () => {
    try {
      const channels = listConfiguredChannels();
      return { success: true, channels };
    } catch (error) {
      logger.error('Failed to list channels:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('channel:setEnabled', async (_, channelType: string, enabled: boolean) => {
    try {
      await configUpdateQueue.enqueue(async () => setChannelEnabled(channelType, enabled));
      try {
        await ctx.employeeManager.syncChannelBindings();
      } catch (err) {
        logger.warn(`Failed to sync channel bindings after setEnabled: ${err}`);
      }
      return { success: true };
    } catch (error) {
      logger.error('Failed to set channel enabled:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('channel:validate', async (_, channelType: string) => {
    try {
      const result = await validateChannelConfig(channelType);
      return { success: true, ...result };
    } catch (error) {
      logger.error('Failed to validate channel:', error);
      return { success: false, valid: false, errors: [String(error)], warnings: [] };
    }
  });

  ipcMain.handle(
    'channel:validateCredentials',
    async (_, channelType: string, config: Record<string, string>) => {
      try {
        const result = await validateChannelCredentials(channelType, config);
        return { success: true, ...result };
      } catch (error) {
        logger.error('Failed to validate channel credentials:', error);
        return { success: false, valid: false, errors: [String(error)], warnings: [] };
      }
    }
  );
}
