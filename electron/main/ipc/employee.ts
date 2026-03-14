/**
 * Employee IPC Handlers
 */
import { ipcMain } from 'electron';
import { readOpenClawConfig, writeOpenClawConfig } from '../../utils/channel-config';
import { configUpdateQueue } from '../../engine/config-update-queue';
import { logger } from '../../utils/logger';
import { getEmployeeSecretsStore } from './shared-stores';
import type { IpcContext } from './types';

export function register({ employeeManager }: IpcContext): void {
  ipcMain.handle('employee:list', async (_event, params?: { status?: string }) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const employees = employeeManager.list(params?.status as any);
      return { success: true, result: employees };
    } catch (error) {
      logger.error('employee:list failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('employee:get', async (_event, id: string) => {
    try {
      const employee = employeeManager.get(id);
      if (!employee) {
        return { success: false, error: `Employee not found: ${id}` };
      }
      return { success: true, result: employee };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('employee:activate', async (_event, id: string) => {
    try {
      const employee = await employeeManager.activate(id);
      return { success: true, result: employee };
    } catch (error) {
      logger.error('employee:activate failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('employee:deactivate', async (_event, id: string) => {
    try {
      const employee = await employeeManager.deactivate(id);
      return { success: true, result: employee };
    } catch (error) {
      logger.error('employee:deactivate failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('employee:status', async (_event, id: string) => {
    try {
      const status = employeeManager.getStatus(id);
      return { success: true, result: status };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // employee:scan — Re-scan skill directories, returns refreshed employee list
  ipcMain.handle('employee:scan', async () => {
    try {
      const employees = await employeeManager.scan();
      return { success: true, result: employees };
    } catch (error) {
      logger.error('employee:scan failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('employee:getManifest', async (_event, id: string) => {
    try {
      const manifest = employeeManager.getManifest(id);
      return { success: true, result: manifest };
    } catch (error) {
      logger.error('employee:getManifest failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'employee:setSecret',
    async (_event, employeeId: string, key: string, value: string) => {
      try {
        const store = await getEmployeeSecretsStore();
        const secretKey = `employee-secrets.${employeeId}.${key}`;
        store.set(secretKey, value);
        return { success: true };
      } catch (error) {
        logger.error('employee:setSecret failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('employee:getSecrets', async (_event, employeeId: string) => {
    try {
      const store = await getEmployeeSecretsStore();
      const secrets = (store.get(`employee-secrets.${employeeId}`) ?? {}) as Record<string, string>;
      return { success: true, result: secrets };
    } catch (error) {
      logger.error('employee:getSecrets failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // employee:setModel — Save per-employee model override and sync to openclaw.json
  ipcMain.handle('employee:setModel', async (_event, employeeId: string, modelId: string) => {
    try {
      const store = await getEmployeeSecretsStore();
      if (modelId) {
        store.set(`employee-models.${employeeId}`, modelId);
        logger.info(`Set model override for employee ${employeeId}: ${modelId}`);
      } else {
        // Clear the override — employee will use global default
        store.set(`employee-models.${employeeId}`, '');
        logger.info(`Cleared model override for employee ${employeeId}`);
      }

      // Sync model to openclaw.json agent entry if the employee is currently activated.
      // This keeps the native OpenClaw agent config in sync so that even requests
      // not intercepted by RPC-time injection (e.g. cron jobs) use the correct model.
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
          // Non-fatal — Gateway will use global default model until next activate() re-syncs
          logger.warn(`[employee:setModel] Failed to sync model to openclaw.json: ${err}`);
        }
      }

      return { success: true };
    } catch (error) {
      logger.error('employee:setModel failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // employee:getModel — Get per-employee model override
  ipcMain.handle('employee:getModel', async (_event, employeeId: string) => {
    try {
      const store = await getEmployeeSecretsStore();
      const modelId = (store.get(`employee-models.${employeeId}`) ?? '') as string;
      return { success: true, result: modelId };
    } catch (error) {
      logger.error('employee:getModel failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // employee:checkDeps — Check if employee's runtime.requires are satisfied
  ipcMain.handle('employee:checkDeps', async (_event, employeeId: string) => {
    try {
      const result = await employeeManager.checkRuntimeRequirements(employeeId);
      return { success: true, result };
    } catch (error) {
      logger.error('employee:checkDeps failed:', error);
      return { success: false, error: String(error) };
    }
  });
}
