/**
 * Memory IPC Handlers
 */
import { ipcMain, app } from 'electron';
import { join } from 'node:path';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';

export function register({ engineRef }: IpcContext): void {
  const getMemoryEngine = () => {
    if (!engineRef.current) throw new Error('Engine not initialized');
    return engineRef.current.memoryEngine;
  };

  ipcMain.handle(
    'memory:store',
    async (
      _event,
      employeeId: string,
      content: string,
      tags?: string[],
      importance?: number,
      taskId?: string
    ) => {
      try {
        const id = getMemoryEngine().storeEpisodic(
          employeeId,
          content,
          tags ?? [],
          importance ?? 3,
          taskId
        );
        return { success: true, result: id };
      } catch (error) {
        logger.error('memory:store failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('memory:recall', async (_event, employeeId: string, limit?: number) => {
    try {
      const memories = getMemoryEngine().recall(employeeId, limit ?? 10);
      return { success: true, result: memories };
    } catch (error) {
      logger.error('memory:recall failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('memory:count', async (_event, employeeId: string) => {
    try {
      const count = getMemoryEngine().getEpisodicCount(employeeId);
      return { success: true, result: count };
    } catch (error) {
      logger.error('memory:count failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // ── Brand Context Handlers ──────────────────────────────────────

  ipcMain.handle('memory:setBrand', async (_event, markdown: string) => {
    try {
      getMemoryEngine().setBrandContext(markdown);
      return { success: true };
    } catch (error) {
      logger.error('memory:setBrand failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('memory:getBrand', async () => {
    try {
      const content = getMemoryEngine().getBrandContext();
      return { success: true, result: content };
    } catch (error) {
      logger.error('memory:getBrand failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // ── File Access Handler ─────────────────────────────────────────

  ipcMain.handle('memory:getMemoryFile', async (_event, employeeId: string) => {
    try {
      const content = getMemoryEngine().getMemoryFile(employeeId);
      return { success: true, result: content };
    } catch (error) {
      logger.error('memory:getMemoryFile failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // ── Migration Handler ───────────────────────────────────────────

  ipcMain.handle('memory:migrate', async (_event, dbPath?: string) => {
    try {
      const path = dbPath ?? join(app.getPath('userData'), 'agentry-memory.db');
      const { MemoryEngine } = await import('../../engine/memory');
      const result = await MemoryEngine.migrateFromSQLite(path, getMemoryEngine());
      return { success: true, result };
    } catch (error) {
      logger.error('memory:migrate failed:', error);
      return { success: false, error: String(error) };
    }
  });
}
