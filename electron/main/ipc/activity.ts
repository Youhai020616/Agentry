/**
 * Activity IPC Handlers
 */
import { ipcMain } from 'electron';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';

export function register({ engineRef, gatewayManager, employeeManager }: IpcContext): void {
  // Lazily create the aggregator on first call
  let _aggregator: import('../../engine/activity-aggregator').ActivityAggregator | null = null;

  const getAggregator = async () => {
    if (_aggregator) return _aggregator;
    if (!engineRef.current) throw new Error('Engine not initialized');

    const lazy = await engineRef.current.getLazy(gatewayManager);
    const { ActivityAggregator } = await import('../../engine/activity-aggregator');
    _aggregator = new ActivityAggregator(lazy.taskQueue, engineRef.current.creditsEngine);

    // Populate employee names
    const names = new Map<string, string>();
    for (const emp of employeeManager.list()) {
      names.set(emp.id, emp.name);
    }
    _aggregator.setEmployeeNames(names);

    return _aggregator;
  };

  ipcMain.handle('activity:list', async (_event, params?: { limit?: number; before?: number }) => {
    try {
      const aggregator = await getAggregator();
      const events = aggregator.list(params?.limit ?? 50, params?.before);
      return { success: true, result: events };
    } catch (error) {
      logger.error('activity:list failed:', error);
      return { success: false, error: String(error) };
    }
  });
}
