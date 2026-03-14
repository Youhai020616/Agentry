/**
 * Project IPC Handlers
 */
import { ipcMain } from 'electron';
import type { IpcContext } from './types';

export function register({ engineRef, gatewayManager }: IpcContext): void {
  const getLazy = async () => {
    if (!engineRef.current) throw new Error('Engine not initialized');
    return engineRef.current.getLazy(gatewayManager);
  };

  ipcMain.handle('project:create', async (_, input: unknown) => {
    try {
      const lazy = await getLazy();
      const project = lazy.taskQueue.createProject(
        input as Parameters<typeof lazy.taskQueue.createProject>[0]
      );
      return { success: true, result: project };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('project:list', async () => {
    try {
      const lazy = await getLazy();
      const projects = lazy.taskQueue.listProjects();
      return { success: true, result: projects };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('project:get', async (_, id: string) => {
    try {
      const lazy = await getLazy();
      const project = lazy.taskQueue.getProject(id);
      return { success: true, result: project ?? null };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('project:execute', async (_, projectId: string) => {
    try {
      const lazy = await getLazy();
      await lazy.supervisor.executeProject(projectId);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
