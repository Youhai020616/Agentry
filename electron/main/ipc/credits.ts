/**
 * Credits IPC Handlers
 */
import { ipcMain } from 'electron';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';

export function register({ engineRef }: IpcContext): void {
  ipcMain.handle('credits:balance', async () => {
    try {
      const engine = engineRef.current;
      if (!engine?.creditsEngine) {
        return { success: true, result: { total: 0, used: 0, remaining: 0 } };
      }
      const balance = engine.creditsEngine.getBalance();
      return { success: true, result: balance };
    } catch (error) {
      logger.error('credits:balance failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('credits:history', async (_, limit?: number, offset?: number) => {
    try {
      const engine = engineRef.current;
      if (!engine?.creditsEngine) {
        return { success: true, result: { transactions: [], total: 0 } };
      }
      const history = engine.creditsEngine.getHistory(limit, offset);
      return { success: true, result: history };
    } catch (error) {
      logger.error('credits:history failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'credits:consume',
    async (
      _event,
      params: {
        type: string;
        amount: number;
        description: string;
        employeeId?: string;
        taskId?: string;
      }
    ) => {
      try {
        const engine = engineRef.current;
        if (!engine?.creditsEngine) {
          return { success: false, error: 'Credits engine not initialized' };
        }
        const ok = engine.creditsEngine.consume(
          params.type as Parameters<typeof engine.creditsEngine.consume>[0],
          params.amount,
          params.description,
          params.employeeId,
          params.taskId
        );
        if (!ok) {
          return { success: false, error: 'Insufficient credits' };
        }
        return { success: true };
      } catch (error) {
        logger.error('credits:consume failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    'credits:topup',
    async (_event, params: { amount: number; description?: string }) => {
      try {
        const engine = engineRef.current;
        if (!engine?.creditsEngine) {
          return { success: false, error: 'Credits engine not initialized' };
        }
        engine.creditsEngine.topup(params.amount, params.description);
        return { success: true };
      } catch (error) {
        logger.error('credits:topup failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('credits:dailySummary', async (_, days?: number) => {
    try {
      const engine = engineRef.current;
      if (!engine?.creditsEngine) {
        return { success: true, result: [] };
      }
      const summary = engine.creditsEngine.getDailySummary(days);
      return { success: true, result: summary };
    } catch (error) {
      logger.error('credits:dailySummary failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('credits:historyByEmployee', async (_, employeeId: string, limit?: number) => {
    try {
      const engine = engineRef.current;
      if (!engine?.creditsEngine) {
        return { success: true, result: [] };
      }
      const transactions = engine.creditsEngine.getHistoryByEmployee(employeeId, limit);
      return { success: true, result: transactions };
    } catch (error) {
      logger.error('credits:byEmployee failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('credits:historyByType', async (_, type: string, limit?: number) => {
    try {
      const engine = engineRef.current;
      if (!engine?.creditsEngine) {
        return { success: true, result: [] };
      }
      const transactions = engine.creditsEngine.getHistoryByType(
        type as Parameters<typeof engine.creditsEngine.getHistoryByType>[0],
        limit
      );
      return { success: true, result: transactions };
    } catch (error) {
      logger.error('credits:byType failed:', error);
      return { success: false, error: String(error) };
    }
  });
}
