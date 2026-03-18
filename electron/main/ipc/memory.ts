/**
 * Memory IPC Handlers
 *
 * Migrated to ipcHandle() wrapper for automatic error handling + perf tracking.
 */
import { app } from 'electron';
import { join } from 'node:path';
import { ipcHandle } from './helpers';
import type { IpcContext } from './types';

export function register({ engineRef }: IpcContext): void {
  const getMemoryEngine = () => {
    if (!engineRef.current) throw new Error('Engine not initialized');
    return engineRef.current.memoryEngine;
  };

  ipcHandle(
    'memory:store',
    async (
      employeeId: string,
      content: string,
      tags?: string[],
      importance?: number,
      taskId?: string
    ) => {
      return getMemoryEngine().storeEpisodic(
        employeeId,
        content,
        tags ?? [],
        importance ?? 3,
        taskId
      );
    }
  );

  ipcHandle('memory:recall', (employeeId: string, limit?: number) => {
    return getMemoryEngine().recall(employeeId, limit ?? 10);
  });

  ipcHandle('memory:count', (employeeId: string) => {
    return getMemoryEngine().getEpisodicCount(employeeId);
  });

  ipcHandle('memory:setBrand', (markdown: string) => {
    getMemoryEngine().setBrandContext(markdown);
  });

  ipcHandle('memory:getBrand', () => {
    return getMemoryEngine().getBrandContext();
  });

  ipcHandle('memory:getMemoryFile', (employeeId: string) => {
    return getMemoryEngine().getMemoryFile(employeeId);
  });

  ipcHandle('memory:migrate', async (dbPath?: string) => {
    const path = dbPath ?? join(app.getPath('userData'), 'agentry-memory.db');
    const { MemoryEngine } = await import('../../engine/memory');
    return MemoryEngine.migrateFromSQLite(path, getMemoryEngine());
  });
}
