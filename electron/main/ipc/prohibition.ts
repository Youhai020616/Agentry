/**
 * Prohibition IPC Handlers
 */
import { ipcMain } from 'electron';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';

export function register({ engineRef, gatewayManager }: IpcContext): void {
  const getLazy = async () => {
    if (!engineRef.current) throw new Error('Engine not initialized');
    return engineRef.current.getLazy(gatewayManager);
  };

  ipcMain.handle('prohibition:list', async (_event, employeeId?: string) => {
    try {
      const lazy = await getLazy();
      const prohibitions = employeeId
        ? lazy.prohibitionEngine.list(employeeId)
        : lazy.prohibitionEngine.listAll();
      return { success: true, result: prohibitions };
    } catch (error) {
      logger.error('prohibition:list failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'prohibition:create',
    async (
      _event,
      params: {
        level: string;
        rule: string;
        description?: string;
        employeeId?: string;
      }
    ) => {
      try {
        const lazy = await getLazy();
        const id = lazy.prohibitionEngine.create(
          params.level as 'hard' | 'soft',
          params.rule,
          params.description ?? '',
          params.employeeId
        );
        return { success: true, result: id };
      } catch (error) {
        logger.error('prohibition:create failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    'prohibition:update',
    async (
      _event,
      id: string,
      updates: {
        level?: string;
        rule?: string;
        description?: string;
        enabled?: boolean;
      }
    ) => {
      try {
        const lazy = await getLazy();
        lazy.prohibitionEngine.update(
          id,
          updates as Parameters<typeof lazy.prohibitionEngine.update>[1]
        );
        return { success: true };
      } catch (error) {
        logger.error('prohibition:update failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('prohibition:delete', async (_event, id: string) => {
    try {
      const lazy = await getLazy();
      lazy.prohibitionEngine.delete(id);
      return { success: true };
    } catch (error) {
      logger.error('prohibition:delete failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('prohibition:toggle', async (_event, id: string, enabled: boolean) => {
    try {
      const lazy = await getLazy();
      lazy.prohibitionEngine.update(id, { enabled });
      return { success: true };
    } catch (error) {
      logger.error('prohibition:toggle failed:', error);
      return { success: false, error: String(error) };
    }
  });
}
