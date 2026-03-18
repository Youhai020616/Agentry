/**
 * Employee IPC Handlers
 *
 * Migrated to ipcHandle() wrapper for automatic error handling + perf tracking.
 * Exception: employee:list returns [] on engine-not-ready (graceful degradation).
 */
import { ipcMain } from 'electron';
import { readOpenClawConfig, writeOpenClawConfig } from '../../utils/channel-config';
import { configUpdateQueue } from '../../engine/config-update-queue';
import { logger } from '../../utils/logger';
import { ipcHandle } from './helpers';
import { getEmployeeSecretsStore } from './shared-stores';
import type { IpcContext } from './types';

export function register({ employeeManager }: IpcContext): void {
  // employee:list — special: returns [] before engine is ready (no error)
  ipcMain.handle('employee:list', async (_event, params?: { status?: string }) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { success: true, result: employeeManager.list(params?.status as any) };
    } catch {
      return { success: true, result: [] };
    }
  });

  // employee:get — special: returns "not initialized" before engine is ready
  ipcMain.handle('employee:get', async (_event, id: string) => {
    try {
      const employee = employeeManager.get(id);
      if (!employee) return { success: false, error: `Employee not found: ${id}` };
      return { success: true, result: employee };
    } catch {
      return { success: false, error: 'Engine not yet initialized' };
    }
  });

  ipcHandle('employee:activate', async (id: string) => {
    return employeeManager.activate(id);
  });

  ipcHandle('employee:deactivate', async (id: string) => {
    return employeeManager.deactivate(id);
  });

  ipcHandle('employee:status', (id: string) => {
    return employeeManager.getStatus(id);
  });

  ipcHandle('employee:scan', async () => {
    return employeeManager.scan();
  });

  ipcHandle('employee:getManifest', (id: string) => {
    return employeeManager.getManifest(id);
  });

  ipcHandle('employee:setSecret', async (employeeId: string, key: string, value: string) => {
    const store = await getEmployeeSecretsStore();
    store.set(`employee-secrets.${employeeId}.${key}`, value);
  });

  ipcHandle('employee:getSecrets', async (employeeId: string) => {
    const store = await getEmployeeSecretsStore();
    return (store.get(`employee-secrets.${employeeId}`) ?? {}) as Record<string, string>;
  });

  ipcHandle('employee:setModel', async (employeeId: string, modelId: string) => {
    const store = await getEmployeeSecretsStore();
    if (modelId) {
      store.set(`employee-models.${employeeId}`, modelId);
      logger.info(`Set model override for employee ${employeeId}: ${modelId}`);
    } else {
      store.set(`employee-models.${employeeId}`, '');
      logger.info(`Cleared model override for employee ${employeeId}`);
    }

    // Sync to openclaw.json if employee is activated
    const employee = employeeManager.get(employeeId);
    if (employee?.gatewaySessionKey) {
      try {
        await configUpdateQueue.enqueue(async () => {
          const config = readOpenClawConfig();
          const agents = (config as Record<string, unknown>).agents as
            | Record<string, unknown>
            | undefined;
          const agentsList = (agents?.list ?? []) as Array<Record<string, unknown>>;
          const entry = agentsList.find((a) => a.id === employeeId);
          if (entry) {
            if (modelId) {
              entry.model = `openrouter/${modelId}`;
            } else {
              delete entry.model;
            }
            writeOpenClawConfig(config);
            logger.info(
              `[employee:setModel] Synced model to openclaw.json for ${employeeId}: ${modelId || '(cleared)'}`
            );
          }
        });
      } catch (err) {
        logger.warn(`[employee:setModel] Failed to sync model to openclaw.json: ${err}`);
      }
    }
  });

  ipcHandle('employee:getModel', async (employeeId: string) => {
    const store = await getEmployeeSecretsStore();
    return (store.get(`employee-models.${employeeId}`) ?? '') as string;
  });

  ipcHandle('employee:checkDeps', async (employeeId: string) => {
    return employeeManager.checkRuntimeRequirements(employeeId);
  });
}
