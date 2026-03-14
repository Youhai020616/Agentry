/**
 * Skill Config IPC Handlers
 * Direct read/write to ~/.openclaw/openclaw.json (bypasses Gateway RPC).
 */
import { ipcMain } from 'electron';
import { updateSkillConfig, getSkillConfig, getAllSkillConfigs } from '../../utils/skill-config';
import { configUpdateQueue } from '../../engine/config-update-queue';
import type { IpcContext } from './types';

export function register(_ctx: IpcContext): void {
  ipcMain.handle(
    'skill:updateConfig',
    async (
      _,
      params: {
        skillKey: string;
        apiKey?: string;
        env?: Record<string, string>;
      }
    ) => {
      return configUpdateQueue.enqueue(async () => {
        return updateSkillConfig(params.skillKey, {
          apiKey: params.apiKey,
          env: params.env,
        });
      });
    }
  );

  ipcMain.handle('skill:getConfig', async (_, skillKey: string) => {
    return getSkillConfig(skillKey);
  });

  ipcMain.handle('skill:getAllConfigs', async () => {
    return getAllSkillConfigs();
  });
}
