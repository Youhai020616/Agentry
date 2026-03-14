/**
 * Task IPC Handlers
 */
import { ipcMain } from 'electron';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';

export function register({ engineRef, gatewayManager }: IpcContext): void {
  const getLazy = async () => {
    if (!engineRef.current) throw new Error('Engine not initialized');
    return engineRef.current.getLazy(gatewayManager);
  };

  ipcMain.handle('task:create', async (_, input: unknown) => {
    try {
      const lazy = await getLazy();
      const task = lazy.taskQueue.create(input as Parameters<typeof lazy.taskQueue.create>[0]);
      return { success: true, result: task };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('task:list', async (_, projectId?: string) => {
    try {
      const lazy = await getLazy();
      const tasks = lazy.taskQueue.list(projectId);
      return { success: true, result: tasks };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('task:get', async (_, id: string) => {
    try {
      const lazy = await getLazy();
      const task = lazy.taskQueue.get(id);
      return { success: true, result: task ?? null };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('task:update', async (_, id: string, changes: unknown) => {
    try {
      const lazy = await getLazy();
      const task = lazy.taskQueue.update(
        id,
        changes as Parameters<typeof lazy.taskQueue.update>[1]
      );
      return { success: true, result: task };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('task:claim', async (_, taskId: string, employeeId: string) => {
    try {
      const lazy = await getLazy();
      const task = lazy.taskQueue.claim(taskId, employeeId);
      return { success: true, result: task };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'task:complete',
    async (_, taskId: string, output: string, outputFiles?: string[]) => {
      try {
        const lazy = await getLazy();
        const task = lazy.taskQueue.complete(taskId, output, outputFiles);
        return { success: true, result: task };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('task:cancel', async (_, taskId: string) => {
    try {
      const lazy = await getLazy();
      const task = lazy.taskQueue.cancel(taskId);
      return { success: true, result: task };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('task:available', async (_, projectId: string) => {
    try {
      const lazy = await getLazy();
      const tasks = lazy.taskQueue.listAvailable(projectId);
      return { success: true, result: tasks };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('task:rate', async (_event, taskId: string, rating: number, feedback?: string) => {
    try {
      const lazy = await getLazy();
      lazy.taskQueue.rate(taskId, rating, feedback);
      return { success: true };
    } catch (error) {
      logger.error('task:rate failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // task:execute — Execute a task by dispatching it to the assigned employee's AI session
  ipcMain.handle(
    'task:execute',
    async (
      _,
      params: {
        taskId: string;
        employeeId: string;
        timeoutMs?: number;
        context?: string;
        includeProjectContext?: boolean;
      }
    ) => {
      try {
        const lazy = await getLazy();
        const result = await lazy.taskExecutor.executeTask(params.taskId, params.employeeId, {
          timeoutMs: params.timeoutMs,
          context: params.context,
          includeProjectContext: params.includeProjectContext,
        });
        return { success: true, result };
      } catch (error) {
        logger.error('task:execute failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // task:executeAdHoc — Create and execute a one-off task for an employee
  ipcMain.handle(
    'task:executeAdHoc',
    async (
      _,
      params: {
        employeeId: string;
        description: string;
        timeoutMs?: number;
        context?: string;
      }
    ) => {
      try {
        const lazy = await getLazy();
        const result = await lazy.taskExecutor.executeAdHoc(params.employeeId, params.description, {
          timeoutMs: params.timeoutMs,
          context: params.context,
        });
        return { success: true, result };
      } catch (error) {
        logger.error('task:executeAdHoc failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // task:cancelExecution — Cancel a running task execution
  ipcMain.handle('task:cancelExecution', async (_, taskId: string) => {
    try {
      const lazy = await getLazy();
      const cancelled = lazy.taskExecutor.cancel(taskId);
      return { success: true, result: { cancelled } };
    } catch (error) {
      logger.error('task:cancelExecution failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // task:executionStatus — Get execution status of tasks
  ipcMain.handle('task:executionStatus', async () => {
    try {
      const lazy = await getLazy();
      const stats = lazy.taskExecutor.getStats();
      const executing = lazy.taskExecutor.getExecutingTasks();
      return {
        success: true,
        result: { ...stats, executingTaskIds: executing },
      };
    } catch (error) {
      logger.error('task:executionStatus failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // task:setAutoExecute — Toggle auto-execution when tasks are claimed
  ipcMain.handle('task:setAutoExecute', async (_, enabled: boolean) => {
    try {
      const lazy = await getLazy();
      lazy.taskExecutor.setAutoExecute(enabled);
      return { success: true };
    } catch (error) {
      logger.error('task:setAutoExecute failed:', error);
      return { success: false, error: String(error) };
    }
  });
}
