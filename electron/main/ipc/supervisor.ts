/**
 * Supervisor IPC Handlers
 */
import { ipcMain } from 'electron';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';

export function register({ engineRef, gatewayManager, mainWindow }: IpcContext): void {
  // Fix L2: event forwarding is deferred until the first real getLazy() call
  // from an IPC handler, instead of being eagerly triggered at registration time.
  let eventForwardingInitialized = false;

  const getLazy = async () => {
    if (!engineRef.current) throw new Error('Engine not initialized');
    const lazy = await engineRef.current.getLazy(gatewayManager);

    // Wire up event forwarding exactly once on first successful lazy init
    if (!eventForwardingInitialized) {
      eventForwardingInitialized = true;

      lazy.taskQueue.on('task-changed', (task: unknown) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('task:changed', task);
        }
      });
      lazy.taskQueue.on('project-changed', (project: unknown) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('project:changed', project);
        }
      });

      // Fix L1: bridge MessageBus 'new-message' events to the renderer so that
      // deliverPendingMessages() actually reaches a real consumer.
      lazy.messageBus.on('new-message', (message: unknown) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('message:new', message);
        }
      });

      logger.info('Event forwarding to renderer initialized (task/project/message)');
    }

    return lazy;
  };

  // supervisor:enable — Activate the Supervisor employee
  // Delegation is now handled natively by the Supervisor agent via `sessions_spawn`.
  // No engine-side delegation detection or event forwarding needed.
  ipcMain.handle('supervisor:enable', async (_, supervisorSlug?: string) => {
    try {
      const slug = supervisorSlug ?? 'supervisor';
      await getLazy(); // ensure engine is initialized

      // Activate the supervisor employee if not already active
      const employee = engineRef.current!.employeeManager.get(slug);
      if (!employee || employee.status === 'offline') {
        await engineRef.current!.employeeManager.activate(slug);
      }

      logger.info(`Supervisor mode enabled: ${slug}`);
      return { success: true, result: { slug, enabled: true } };
    } catch (error) {
      logger.error('supervisor:enable failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // supervisor:disable — Deactivate the Supervisor employee
  ipcMain.handle('supervisor:disable', async () => {
    try {
      await getLazy(); // ensure engine is initialized
      const slug = 'supervisor';
      const employee = engineRef.current!.employeeManager.get(slug);
      if (employee && employee.status !== 'offline') {
        await engineRef.current!.employeeManager.deactivate(slug);
      }

      logger.info('Supervisor mode disabled');
      return { success: true };
    } catch (error) {
      logger.error('supervisor:disable failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // supervisor:status — Get current Supervisor status
  ipcMain.handle('supervisor:status', async () => {
    try {
      await getLazy(); // ensure engine is initialized
      const slug = 'supervisor';
      const employee = engineRef.current!.employeeManager.get(slug);
      const enabled = !!employee && employee.status !== 'offline';
      return {
        success: true,
        result: {
          enabled,
          supervisorSlug: enabled ? slug : null,
        },
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // ── Issue #2: Missing Project Planning IPC Handlers ──────────────

  // supervisor:planProject — Decompose a user goal into a task DAG
  ipcMain.handle(
    'supervisor:planProject',
    async (_, params: { goal: string; pmEmployeeId: string }) => {
      try {
        const lazy = await getLazy();
        const project = await lazy.supervisor.planProject(params.goal, params.pmEmployeeId);
        return { success: true, result: project };
      } catch (error) {
        logger.error('supervisor:planProject failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // supervisor:approvePlan — PM approves a submitted plan
  ipcMain.handle('supervisor:approvePlan', async (_, taskId: string) => {
    try {
      const lazy = await getLazy();
      await lazy.supervisor.approvePlan(taskId);
      return { success: true };
    } catch (error) {
      logger.error('supervisor:approvePlan failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // supervisor:rejectPlan — PM rejects a plan with feedback
  ipcMain.handle(
    'supervisor:rejectPlan',
    async (_, params: { taskId: string; feedback: string }) => {
      try {
        const lazy = await getLazy();
        await lazy.supervisor.rejectPlan(params.taskId, params.feedback);
        return { success: true };
      } catch (error) {
        logger.error('supervisor:rejectPlan failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // supervisor:submitPlan — Employee submits a plan for review
  ipcMain.handle('supervisor:submitPlan', async (_, params: { taskId: string; plan: string }) => {
    try {
      const lazy = await getLazy();
      await lazy.supervisor.submitPlan(params.taskId, params.plan);
      return { success: true };
    } catch (error) {
      logger.error('supervisor:submitPlan failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // supervisor:synthesize — Manually trigger PM synthesis for a project
  ipcMain.handle('supervisor:synthesize', async (_, projectId: string) => {
    try {
      const lazy = await getLazy();
      const synthesis = await lazy.supervisor.synthesizeResults(projectId);
      return { success: true, result: synthesis };
    } catch (error) {
      logger.error('supervisor:synthesize failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // supervisor:closeProject — Gracefully close a project
  ipcMain.handle('supervisor:closeProject', async (_, projectId: string) => {
    try {
      const lazy = await getLazy();
      await lazy.supervisor.closeProject(projectId);
      return { success: true };
    } catch (error) {
      logger.error('supervisor:closeProject failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // ── Issue #8: Forward task-changed / project-changed / new-message events ──
  // Fix L2: event forwarding is deferred — it's wired up inside the getLazy()
  // wrapper above on first successful call, not eagerly at registration time.
  // Fix L1: MessageBus 'new-message' events are also bridged to the renderer
  // so that deliverPendingMessages() reaches a real consumer.
}
