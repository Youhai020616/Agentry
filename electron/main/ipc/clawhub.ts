/**
 * ClawHub IPC Handlers
 * Skill marketplace operations.
 */
import { ipcMain } from 'electron';
import type {
  ClawHubSearchParams,
  ClawHubInstallParams,
  ClawHubUninstallParams,
} from '../../gateway/clawhub';
import type { IpcContext } from './types';

export function register({ clawHubService }: IpcContext): void {
  ipcMain.handle('clawhub:search', async (_, params: ClawHubSearchParams) => {
    try {
      const results = await clawHubService.search(params);
      return { success: true, results };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('clawhub:install', async (_, params: ClawHubInstallParams) => {
    try {
      await clawHubService.install(params);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('clawhub:uninstall', async (_, params: ClawHubUninstallParams) => {
    try {
      await clawHubService.uninstall(params);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('clawhub:list', async () => {
    try {
      const results = await clawHubService.listInstalled();
      return { success: true, results };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('clawhub:openSkillReadme', async (_, slug: string) => {
    try {
      await clawHubService.openSkillReadme(slug);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
