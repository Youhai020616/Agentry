/**
 * Onboarding IPC Handlers
 */
import { ipcMain } from 'electron';
import { BrowserLoginManager } from '../../engine/browser-login';
import { CamofoxClient } from '../../engine/camofox-client';
import { logger } from '../../utils/logger';
import { getEmployeeSecretsStore } from './shared-stores';
import type { IpcContext } from './types';


const browserLoginManager = new BrowserLoginManager();

export function register({ mainWindow, employeeManager }: IpcContext): void {
  // onboarding:browserLogin — Open a BrowserWindow for the user to log in
  ipcMain.handle(
    'onboarding:browserLogin',
    async (
      _event,
      params: {
        loginUrl: string;
        successIndicator: string;
        cookieDomains: string[];
      }
    ) => {
      try {
        const cookies = await browserLoginManager.openLoginWindow({
          loginUrl: params.loginUrl,
          successIndicator: params.successIndicator,
          cookieDomains: params.cookieDomains,
          parentWindow: mainWindow,
        });
        return { success: true, result: { cookies } };
      } catch (error) {
        logger.error('onboarding:browserLogin failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // onboarding:cancelLogin — Close the browser login window
  ipcMain.handle('onboarding:cancelLogin', async () => {
    try {
      browserLoginManager.close();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // onboarding:saveData — Save onboarding data (cookies, config) for an employee
  ipcMain.handle(
    'onboarding:saveData',
    async (
      _event,
      employeeId: string,
      data: { cookies: unknown[]; username?: string; config?: Record<string, unknown> }
    ) => {
      try {
        const store = await getEmployeeSecretsStore();
        store.set(`onboarding-data.${employeeId}`, {
          ...data,
          completedAt: Date.now(),
        });
        // Mark onboarding as completed on the employee record
        await employeeManager.markOnboardingComplete(employeeId);
        return { success: true };
      } catch (error) {
        logger.error('onboarding:saveData failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // onboarding:getData — Retrieve stored onboarding data
  ipcMain.handle('onboarding:getData', async (_event, employeeId: string) => {
    try {
      const store = await getEmployeeSecretsStore();
      const data = store.get(`onboarding-data.${employeeId}`);
      return { success: true, result: data ?? null };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // camofox:health — Check if Camofox is running
  ipcMain.handle('camofox:health', async (_event, params?: { port?: number; apiKey?: string }) => {
    try {
      const client = new CamofoxClient({
        port: params?.port ?? 9377,
        apiKey: params?.apiKey ?? 'pocketai',
      });
      const healthy = await client.health();
      return { success: true, result: healthy };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // camofox:pushCookies — Push cookies to a Camofox session
  ipcMain.handle(
    'camofox:pushCookies',
    async (
      _event,
      params: { userId: string; cookies: unknown[]; port?: number; apiKey?: string }
    ) => {
      try {
        const client = new CamofoxClient({
          port: params.port ?? 9377,
          apiKey: params.apiKey ?? 'pocketai',
        });
        const result = await client.pushCookies(params.userId, params.cookies);
        return { success: true, result };
      } catch (error) {
        logger.error('camofox:pushCookies failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // camofox:detect — Detect if Camofox is installed on the system
  ipcMain.handle('camofox:detect', async () => {
    try {
      const { getCamofoxLauncher } = await import('../../engine/camofox-launcher');
      const launcher = getCamofoxLauncher();
      const result = launcher.detect();
      return { success: true, result };
    } catch (error) {
      logger.error('camofox:detect failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // camofox:installDeps — Install npm dependencies in the Camofox directory
  ipcMain.handle('camofox:installDeps', async (_event, params?: { path?: string }) => {
    try {
      const { getCamofoxLauncher } = await import('../../engine/camofox-launcher');
      const launcher = getCamofoxLauncher();
      const result = await launcher.installDeps(params?.path);
      return { success: true, result };
    } catch (error) {
      logger.error('camofox:installDeps failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // camofox:start — Start the Camofox server process
  ipcMain.handle(
    'camofox:start',
    async (_event, params?: { port?: number; apiKey?: string; path?: string }) => {
      try {
        const { getCamofoxLauncher } = await import('../../engine/camofox-launcher');
        const launcher = getCamofoxLauncher();
        const result = await launcher.start(
          params?.port ?? 9377,
          params?.apiKey ?? 'pocketai',
          params?.path
        );
        return { success: true, result };
      } catch (error) {
        logger.error('camofox:start failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // camofox:stop — Stop the managed Camofox process
  ipcMain.handle('camofox:stop', async () => {
    try {
      const { getCamofoxLauncher } = await import('../../engine/camofox-launcher');
      const launcher = getCamofoxLauncher();
      const result = launcher.stop();
      return { success: true, result };
    } catch (error) {
      logger.error('camofox:stop failed:', error);
      return { success: false, error: String(error) };
    }
  });
}
