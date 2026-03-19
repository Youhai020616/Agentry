/**
 * Cron Task IPC Handlers
 * Proxies cron operations to the Gateway RPC service.
 */
import { ipcMain } from 'electron';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';

interface GatewayCronJob {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: { kind: string; expr?: string; everyMs?: number; at?: string; tz?: string };
  payload: { kind: string; message?: string; text?: string };
  delivery?: { mode: string; channel?: string; to?: string };
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
    lastDurationMs?: number;
  };
}

function transformCronJob(job: GatewayCronJob) {
  const message = job.payload?.message || job.payload?.text || '';
  const channelType = job.delivery?.channel || 'unknown';
  const target = { channelType, channelId: channelType, channelName: channelType };
  const lastRun = job.state?.lastRunAtMs
    ? {
        time: new Date(job.state.lastRunAtMs).toISOString(),
        success: job.state.lastStatus === 'ok',
        error: job.state.lastError,
        duration: job.state.lastDurationMs,
      }
    : undefined;
  const nextRun = job.state?.nextRunAtMs
    ? new Date(job.state.nextRunAtMs).toISOString()
    : undefined;

  return {
    id: job.id,
    name: job.name,
    message,
    schedule: job.schedule,
    target,
    enabled: job.enabled,
    createdAt: new Date(job.createdAtMs).toISOString(),
    updatedAt: new Date(job.updatedAtMs).toISOString(),
    lastRun,
    nextRun,
  };
}

import { getStore } from '../../utils/store-factory';

async function getCronEmployeeStore() {
  return getStore('cron-employee-assignments', { defaults: {} });
}

export function register({ gatewayManager, engineRef }: IpcContext): void {
  ipcMain.handle('cron:list', async () => {
    try {
      const result = await gatewayManager.rpc('cron.list', { includeDisabled: true });
      const data = result as { jobs?: GatewayCronJob[] };
      const jobs = data?.jobs ?? [];
      const assignmentStore = await getCronEmployeeStore();
      return jobs.map((job) => {
        const transformed = transformCronJob(job);
        const assignedEmployeeId = assignmentStore.get(job.id) as string | undefined;
        if (assignedEmployeeId) {
          (transformed as Record<string, unknown>).assignedEmployeeId = assignedEmployeeId;
        }
        return transformed;
      });
    } catch (error) {
      logger.error('Failed to list cron jobs:', error);
      throw error;
    }
  });

  ipcMain.handle(
    'cron:create',
    async (
      _,
      input: {
        name: string;
        message: string;
        schedule: string;
        target: { channelType: string; channelId: string; channelName: string };
        enabled?: boolean;
        assignedEmployeeId?: string;
      }
    ) => {
      try {
        const recipientId = input.target.channelId;
        const deliveryTo =
          input.target.channelType === 'discord' && recipientId
            ? `channel:${recipientId}`
            : recipientId;

        const gatewayInput = {
          name: input.name,
          schedule: { kind: 'cron', expr: input.schedule },
          payload: { kind: 'agentTurn', message: input.message },
          enabled: input.enabled ?? true,
          wakeMode: 'next-heartbeat',
          sessionTarget: 'isolated',
          delivery: { mode: 'announce', channel: input.target.channelType, to: deliveryTo },
        };
        const result = await gatewayManager.rpc('cron.add', gatewayInput);
        if (result && typeof result === 'object') {
          const transformed = transformCronJob(result as GatewayCronJob);
          if (input.assignedEmployeeId) {
            const assignmentStore = await getCronEmployeeStore();
            assignmentStore.set((result as GatewayCronJob).id, input.assignedEmployeeId);
            (transformed as Record<string, unknown>).assignedEmployeeId = input.assignedEmployeeId;
          }
          return transformed;
        }
        return result;
      } catch (error) {
        logger.error('Failed to create cron job:', error);
        throw error;
      }
    }
  );

  ipcMain.handle('cron:update', async (_, id: string, input: Record<string, unknown>) => {
    try {
      const patch = { ...input };
      if (typeof patch.schedule === 'string') {
        patch.schedule = { kind: 'cron', expr: patch.schedule };
      }
      if (typeof patch.message === 'string') {
        patch.payload = { kind: 'agentTurn', message: patch.message };
        delete patch.message;
      }
      const assignedEmployeeId = patch.assignedEmployeeId as string | undefined;
      delete patch.assignedEmployeeId;

      const result = await gatewayManager.rpc('cron.update', { id, patch });

      const assignmentStore = await getCronEmployeeStore();
      if (assignedEmployeeId !== undefined) {
        if (assignedEmployeeId) {
          assignmentStore.set(id, assignedEmployeeId);
        } else {
          assignmentStore.delete(id);
        }
      }
      return result;
    } catch (error) {
      logger.error('Failed to update cron job:', error);
      throw error;
    }
  });

  ipcMain.handle('cron:delete', async (_, id: string) => {
    try {
      const result = await gatewayManager.rpc('cron.remove', { id });
      const assignmentStore = await getCronEmployeeStore();
      assignmentStore.delete(id);
      return result;
    } catch (error) {
      logger.error('Failed to delete cron job:', error);
      throw error;
    }
  });

  ipcMain.handle('cron:toggle', async (_, id: string, enabled: boolean) => {
    try {
      return await gatewayManager.rpc('cron.update', { id, patch: { enabled } });
    } catch (error) {
      logger.error('Failed to toggle cron job:', error);
      throw error;
    }
  });

  ipcMain.handle('cron:trigger', async (_, id: string) => {
    try {
      const result = await gatewayManager.rpc('cron.run', { id, mode: 'force' });

      try {
        const assignmentStore = await getCronEmployeeStore();
        const assignedEmployeeId = assignmentStore.get(id) as string | undefined;
        const engine = engineRef.current;
        if (assignedEmployeeId && engine) {
          const lazy = await engine.getLazy(gatewayManager);
          const taskQueue = lazy.taskQueue;
          if (taskQueue) {
            let cronName = `Cron Job ${id}`;
            let cronMessage = '';
            try {
              const listResult = await gatewayManager.rpc('cron.list', { includeDisabled: true });
              const data = listResult as { jobs?: GatewayCronJob[] };
              const cronJob = data?.jobs?.find((j) => j.id === id);
              if (cronJob) {
                cronName = cronJob.name;
                cronMessage = cronJob.payload?.message || cronJob.payload?.text || '';
              }
            } catch {
              // Ignore; use fallback name
            }
            taskQueue.create({
              projectId: 'cron-auto',
              subject: `Cron: ${cronName}`,
              description: cronMessage || cronName,
              owner: assignedEmployeeId,
              assignedBy: 'user',
              priority: 'medium',
            });
            logger.info(
              `Cron trigger created task for employee ${assignedEmployeeId} (cron: ${id})`
            );
          }
        }
      } catch (taskErr) {
        logger.warn(`Failed to create task from cron trigger: ${taskErr}`);
      }

      return result;
    } catch (error) {
      logger.error('Failed to trigger cron job:', error);
      throw error;
    }
  });
}
