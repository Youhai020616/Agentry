/**
 * User IPC Handlers
 */
import { ipcMain } from 'electron';
import { UserManager } from '../../engine/user-manager';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';


const userManager = new UserManager();

export function register(_ctx: IpcContext): void {
  // Initialize the user manager database
  userManager.init();

  // user:list — list all users
  ipcMain.handle('user:list', async () => {
    try {
      const users = userManager.list();
      return { success: true, result: users };
    } catch (error) {
      logger.error('user:list failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // user:get — get a single user by ID
  ipcMain.handle('user:get', async (_event, id: string) => {
    try {
      const user = userManager.get(id);
      if (!user) {
        return { success: false, error: `User not found: ${id}` };
      }
      return { success: true, result: user };
    } catch (error) {
      logger.error('user:get failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // user:create — create a new user
  ipcMain.handle(
    'user:create',
    async (_event, input: { name: string; email?: string; role?: string; avatar?: string }) => {
      try {
        const user = userManager.create(input as Parameters<typeof userManager.create>[0]);
        return { success: true, result: user };
      } catch (error) {
        logger.error('user:create failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // user:update — update a user
  ipcMain.handle(
    'user:update',
    async (
      _event,
      params: {
        id: string;
        updates: { name?: string; email?: string; role?: string; avatar?: string };
      }
    ) => {
      try {
        const user = userManager.update(
          params.id,
          params.updates as Parameters<typeof userManager.update>[1]
        );
        return { success: true, result: user };
      } catch (error) {
        logger.error('user:update failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // user:delete — delete a user
  ipcMain.handle('user:delete', async (_event, id: string) => {
    try {
      userManager.delete(id);
      return { success: true };
    } catch (error) {
      logger.error('user:delete failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // user:current — get the current active user
  ipcMain.handle('user:current', async () => {
    try {
      const user = await userManager.getCurrentUser();
      return { success: true, result: user };
    } catch (error) {
      logger.error('user:current failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // user:switch — set the current active user
  ipcMain.handle('user:switch', async (_event, id: string) => {
    try {
      await userManager.setCurrentUser(id);
      const user = await userManager.getCurrentUser();
      return { success: true, result: user };
    } catch (error) {
      logger.error('user:switch failed:', error);
      return { success: false, error: String(error) };
    }
  });
}
