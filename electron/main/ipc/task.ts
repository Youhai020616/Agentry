/**
 * Task IPC Handlers
 *
 * Migrated to ipcHandle() wrapper for automatic error handling + perf tracking.
 */
import { ipcHandle } from './helpers';
import type { IpcContext } from './types';

export function register({ engineRef, gatewayManager }: IpcContext): void {
  const getLazy = async () => {
    if (!engineRef.current) throw new Error('Engine not initialized');
    return engineRef.current.getLazy(gatewayManager);
  };

  ipcHandle('task:create', async (input: unknown) => {
    const lazy = await getLazy();
    return lazy.taskQueue.create(input as Parameters<typeof lazy.taskQueue.create>[0]);
  });

  ipcHandle('task:list', async (projectId?: string) => {
    const lazy = await getLazy();
    return lazy.taskQueue.list(projectId);
  });

  ipcHandle('task:get', async (id: string) => {
    const lazy = await getLazy();
    return lazy.taskQueue.get(id) ?? null;
  });

  ipcHandle('task:update', async (id: string, changes: unknown) => {
    const lazy = await getLazy();
    return lazy.taskQueue.update(id, changes as Parameters<typeof lazy.taskQueue.update>[1]);
  });

  ipcHandle('task:claim', async (taskId: string, employeeId: string) => {
    const lazy = await getLazy();
    return lazy.taskQueue.claim(taskId, employeeId);
  });

  ipcHandle('task:complete', async (taskId: string, output: string, outputFiles?: string[]) => {
    const lazy = await getLazy();
    return lazy.taskQueue.complete(taskId, output, outputFiles);
  });

  ipcHandle('task:cancel', async (taskId: string) => {
    const lazy = await getLazy();
    return lazy.taskQueue.cancel(taskId);
  });

  ipcHandle('task:available', async (projectId: string) => {
    const lazy = await getLazy();
    return lazy.taskQueue.listAvailable(projectId);
  });

  ipcHandle('task:rate', async (taskId: string, rating: number, feedback?: string) => {
    const lazy = await getLazy();
    lazy.taskQueue.rate(taskId, rating, feedback);
  });

  ipcHandle(
    'task:execute',
    async (params: {
      taskId: string;
      employeeId: string;
      timeoutMs?: number;
      context?: string;
      includeProjectContext?: boolean;
    }) => {
      const lazy = await getLazy();
      return lazy.taskExecutor.executeTask(params.taskId, params.employeeId, {
        timeoutMs: params.timeoutMs,
        context: params.context,
        includeProjectContext: params.includeProjectContext,
      });
    }
  );

  ipcHandle(
    'task:executeAdHoc',
    async (params: {
      employeeId: string;
      description: string;
      timeoutMs?: number;
      context?: string;
    }) => {
      const lazy = await getLazy();
      return lazy.taskExecutor.executeAdHoc(params.employeeId, params.description, {
        timeoutMs: params.timeoutMs,
        context: params.context,
      });
    }
  );

  ipcHandle('task:cancelExecution', async (taskId: string) => {
    const lazy = await getLazy();
    return { cancelled: lazy.taskExecutor.cancel(taskId) };
  });

  ipcHandle('task:executionStatus', async () => {
    const lazy = await getLazy();
    const stats = lazy.taskExecutor.getStats();
    const executing = lazy.taskExecutor.getExecutingTasks();
    return { ...stats, executingTaskIds: executing };
  });

  ipcHandle('task:setAutoExecute', async (enabled: boolean) => {
    const lazy = await getLazy();
    lazy.taskExecutor.setAutoExecute(enabled);
  });
}
