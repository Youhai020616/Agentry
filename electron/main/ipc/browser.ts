/**
 * Browser IPC Handlers
 */
import { ipcMain } from 'electron';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';

export function register({ mainWindow }: IpcContext): void {
  // Lazy import — uses stealth-cli (Camoufox) as the browser engine
  const getBrowser = async () => {
    const { getStealthBrowserManager } = await import('../../engine/stealth-browser-manager');
    return getStealthBrowserManager();
  };

  // Forward browser status changes to renderer
  void (async () => {
    try {
      const browser = await getBrowser();
      browser.on('status-changed', (state: unknown) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('browser:status-changed', state);
        }
      });
    } catch (error) {
      logger.warn('Failed to attach browser status listener:', error);
    }
  })();

  // browser:start — Launch managed Chrome browser
  ipcMain.handle('browser:start', async (_event, params?: { profile?: string }) => {
    try {
      const browser = await getBrowser();
      const state = await browser.start(params?.profile);
      return { success: true, result: state };
    } catch (error) {
      logger.error('browser:start failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // browser:stop — Stop managed browser
  ipcMain.handle('browser:stop', async () => {
    try {
      const browser = await getBrowser();
      await browser.stop();
      return { success: true };
    } catch (error) {
      logger.error('browser:stop failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // browser:status — Get current browser state
  ipcMain.handle('browser:status', async () => {
    try {
      const browser = await getBrowser();
      const state = browser.getState();
      return { success: true, result: state };
    } catch (error) {
      logger.error('browser:status failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // browser:open — Navigate to a URL
  ipcMain.handle('browser:open', async (_event, params: { url: string }) => {
    try {
      const browser = await getBrowser();
      await browser.open(params.url);
      return { success: true };
    } catch (error) {
      logger.error('browser:open failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // browser:snapshot — Take a page snapshot (text representation with element refs)
  ipcMain.handle(
    'browser:snapshot',
    async (
      _event,
      params?: { format?: 'ai' | 'interactive'; labels?: boolean; selector?: string }
    ) => {
      try {
        const browser = await getBrowser();
        const snapshot = await browser.snapshot(params?.format ?? 'ai', {
          labels: params?.labels,
          selector: params?.selector,
        });
        return { success: true, result: snapshot };
      } catch (error) {
        logger.error('browser:snapshot failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // browser:screenshot — Take a visual screenshot
  ipcMain.handle('browser:screenshot', async (_event, params?: { fullPage?: boolean }) => {
    try {
      const browser = await getBrowser();
      const screenshot = await browser.screenshot(params?.fullPage);
      return { success: true, result: screenshot };
    } catch (error) {
      logger.error('browser:screenshot failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // browser:click — Click an element by snapshot ref
  ipcMain.handle('browser:click', async (_event, params: { ref: string }) => {
    try {
      const browser = await getBrowser();
      await browser.click(params.ref);
      return { success: true };
    } catch (error) {
      logger.error('browser:click failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // browser:type — Type text into an element
  ipcMain.handle(
    'browser:type',
    async (_event, params: { ref: string; text: string; clear?: boolean }) => {
      try {
        const browser = await getBrowser();
        await browser.type(params.ref, params.text, params.clear);
        return { success: true };
      } catch (error) {
        logger.error('browser:type failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // browser:scroll — Scroll the page
  ipcMain.handle(
    'browser:scroll',
    async (_event, params: { direction: 'up' | 'down' | 'left' | 'right'; amount?: number }) => {
      try {
        const browser = await getBrowser();
        await browser.scroll(params.direction, params.amount);
        return { success: true };
      } catch (error) {
        logger.error('browser:scroll failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // browser:highlight — Highlight an element (visual debugging)
  ipcMain.handle('browser:highlight', async (_event, params: { ref: string }) => {
    try {
      const browser = await getBrowser();
      await browser.highlight(params.ref);
      return { success: true };
    } catch (error) {
      logger.error('browser:highlight failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // browser:errors — Get console errors from the browser
  ipcMain.handle('browser:errors', async (_event, params?: { clear?: boolean }) => {
    try {
      const browser = await getBrowser();
      const errors = await browser.getErrors(params?.clear);
      return { success: true, result: errors };
    } catch (error) {
      logger.error('browser:errors failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // browser:requests — Get network requests from the browser
  ipcMain.handle(
    'browser:requests',
    async (_event, params?: { filter?: string; clear?: boolean }) => {
      try {
        const browser = await getBrowser();
        const requests = await browser.getRequests(params?.filter, params?.clear);
        return { success: true, result: requests };
      } catch (error) {
        logger.error('browser:requests failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // browser:trace:start — Start recording a trace
  ipcMain.handle('browser:trace:start', async () => {
    try {
      const browser = await getBrowser();
      await browser.traceStart();
      return { success: true };
    } catch (error) {
      logger.error('browser:trace:start failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // browser:trace:stop — Stop recording and return trace result
  ipcMain.handle('browser:trace:stop', async () => {
    try {
      const browser = await getBrowser();
      const result = await browser.traceStop();
      return { success: true, result };
    } catch (error) {
      logger.error('browser:trace:stop failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // browser:profiles — List available browser profiles
  ipcMain.handle('browser:profiles', async () => {
    try {
      const browser = await getBrowser();
      const profiles = await browser.listProfiles();
      return { success: true, result: profiles };
    } catch (error) {
      logger.error('browser:profiles failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // browser:history — Get action history
  ipcMain.handle('browser:history', async () => {
    try {
      const browser = await getBrowser();
      const history = browser.getActionHistory();
      return { success: true, result: history };
    } catch (error) {
      logger.error('browser:history failed:', error);
      return { success: false, error: String(error) };
    }
  });
}
