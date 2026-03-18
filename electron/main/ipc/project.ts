/**
 * Project IPC Handlers
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

  ipcHandle('project:create', async (input: unknown) => {
    const lazy = await getLazy();
    return lazy.taskQueue.createProject(
      input as Parameters<typeof lazy.taskQueue.createProject>[0]
    );
  });

  ipcHandle('project:list', async () => {
    const lazy = await getLazy();
    return lazy.taskQueue.listProjects();
  });

  ipcHandle('project:get', async (id: string) => {
    const lazy = await getLazy();
    return lazy.taskQueue.getProject(id) ?? null;
  });

  ipcHandle('project:execute', async (projectId: string) => {
    const lazy = await getLazy();
    await lazy.supervisor.executeProject(projectId);
  });
}
