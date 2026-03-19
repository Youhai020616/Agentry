/**
 * Credits IPC Handlers
 *
 * Migrated to ipcHandle() wrapper for automatic error handling + perf tracking.
 * Note: credits handlers return graceful defaults when engine is not yet ready.
 */
import { ipcMain } from 'electron';
import { ipcHandle } from './helpers';
import type { IpcContext } from './types';

export function register({ engineRef }: IpcContext): void {
  // credits:balance — special: returns zeros before engine is ready
  ipcMain.handle('credits:balance', async () => {
    try {
      const engine = engineRef.current;
      if (!engine?.creditsEngine) {
        return { success: true, result: { total: 0, used: 0, remaining: 0 } };
      }
      return { success: true, result: engine.creditsEngine.getBalance() };
    } catch {
      return { success: true, result: { total: 0, used: 0, remaining: 0 } };
    }
  });

  // credits:history — special: returns empty before engine is ready
  ipcMain.handle('credits:history', async (_, limit?: number, offset?: number) => {
    try {
      const engine = engineRef.current;
      if (!engine?.creditsEngine) {
        return { success: true, result: { transactions: [], total: 0 } };
      }
      return { success: true, result: engine.creditsEngine.getHistory(limit, offset) };
    } catch {
      return { success: true, result: { transactions: [], total: 0 } };
    }
  });

  ipcHandle(
    'credits:consume',
    async (params: {
      type: string;
      amount: number;
      description: string;
      employeeId?: string;
      taskId?: string;
    }) => {
      const engine = engineRef.current;
      if (!engine?.creditsEngine) throw new Error('Credits engine not initialized');
      const ok = engine.creditsEngine.consume(
        params.type as Parameters<typeof engine.creditsEngine.consume>[0],
        params.amount,
        params.description,
        params.employeeId,
        params.taskId
      );
      if (!ok) throw new Error('Insufficient credits');
    }
  );

  ipcHandle('credits:topup', (params: { amount: number; description?: string }) => {
    const engine = engineRef.current;
    if (!engine?.creditsEngine) throw new Error('Credits engine not initialized');
    engine.creditsEngine.topup(params.amount, params.description);
  });

  ipcHandle('credits:dailySummary', (days?: number) => {
    const engine = engineRef.current;
    if (!engine?.creditsEngine) return [];
    return engine.creditsEngine.getDailySummary(days);
  });

  ipcHandle('credits:historyByEmployee', (employeeId: string, limit?: number) => {
    const engine = engineRef.current;
    if (!engine?.creditsEngine) return [];
    return engine.creditsEngine.getHistoryByEmployee(employeeId, limit);
  });

  ipcHandle('credits:historyByType', (type: string, limit?: number) => {
    const engine = engineRef.current;
    if (!engine?.creditsEngine) return [];
    return engine.creditsEngine.getHistoryByType(
      type as Parameters<typeof engine.creditsEngine.getHistoryByType>[0],
      limit
    );
  });
}
