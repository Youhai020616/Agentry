/**
 * Electron Main Process Entry
 * Manages window creation, system tray, and IPC handlers
 */
import { app, BrowserWindow, nativeImage, net, protocol, session, shell } from 'electron';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { GatewayManager } from '../gateway/manager';
import { getPort } from '../utils/config';
import { registerIpcHandlers } from './ipc-handlers';
import type { EngineRef } from './ipc-handlers';
import { createTray, updateTrayMenu } from './tray';
import type { EmployeeTrayInfo } from './tray';
import { createMenu } from './menu';
import { bootstrapEngine } from '../engine/bootstrap';
import { migrateKeysToEncryptedStorage } from '../utils/secure-storage';
import type { EngineContext } from '../engine/bootstrap';

import { appUpdater, registerUpdateHandlers } from './updater';
import { logger } from '../utils/logger';
import { warmupNetworkOptimization } from '../utils/uv-env';

import { ClawHubService } from '../gateway/clawhub';

// Disable GPU acceleration for better compatibility
app.disableHardwareAcceleration();

// Register custom protocol scheme for serving local files to the renderer.
// Must be called before app.whenReady(). The actual handler is set up in initialize().
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-resource',
    privileges: {
      standard: false,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
    },
  },
]);

// Global references
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
const gatewayManager = new GatewayManager();
const clawHubService = new ClawHubService();
let engineContext: EngineContext | null = null;

/**
 * Resolve the icons directory path (works in both dev and packaged mode)
 */
function getIconsDir(): string {
  if (app.isPackaged) {
    // Packaged: icons are in extraResources → process.resourcesPath/resources/icons
    return join(process.resourcesPath, 'resources', 'icons');
  }
  // Development: relative to dist-electron/main/
  return join(__dirname, '../../resources/icons');
}

/**
 * Get the app icon for the current platform
 */
function getAppIcon(): Electron.NativeImage | undefined {
  if (process.platform === 'darwin') return undefined; // macOS uses the app bundle icon

  const iconsDir = getIconsDir();
  const iconPath =
    process.platform === 'win32' ? join(iconsDir, 'icon.ico') : join(iconsDir, 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? undefined : icon;
}

/**
 * Create the main application window
 */
function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    icon: getAppIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true, // Enable <webview> for embedding OpenClaw Control UI
    },
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    frame: isMac,
    show: false,
  });

  // Show window when ready to prevent visual flash
  win.once('ready-to-show', () => {
    win.show();
  });

  // Handle external links
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(join(__dirname, '../../dist/index.html'));
  }

  return win;
}

/**
 * Initialize the application
 */
async function initialize(): Promise<void> {
  // Initialize logger first
  logger.init();
  logger.info('=== PocketCrow Application Starting ===');
  logger.debug(
    `Runtime: platform=${process.platform}/${process.arch}, electron=${process.versions.electron}, node=${process.versions.node}, packaged=${app.isPackaged}`
  );

  // Warm up network optimization (non-blocking)
  void warmupNetworkOptimization();

  // Migrate any plaintext API keys to encrypted storage (idempotent, non-blocking).
  // Must run after app.isReady() so that safeStorage.isEncryptionAvailable() returns true.
  migrateKeysToEncryptedStorage()
    .then((stats) => {
      if (stats.migrated > 0) {
        logger.info(
          `API key migration: ${stats.migrated} encrypted, ${stats.skipped} already encrypted, ${stats.failed} failed`
        );
      }
    })
    .catch((err) => logger.warn('API key migration failed (non-fatal):', err));

  // Register local-resource:// protocol to serve local files (images, etc.)
  // to the renderer process. Only files under the app's resources directory are allowed.
  const appResourcesDir = resolve(
    app.isPackaged
      ? join(process.resourcesPath, 'resources')
      : join(__dirname, '../../resources')
  );
  const userDataDir = app.getPath('userData');

  protocol.handle('local-resource', (request) => {
    // URL format: local-resource://file/C:/Users/.../image.jpg
    // Decode the pathname to get the file path
    let filePath: string;
    try {
      const url = new URL(request.url);
      // Remove leading slash on Windows paths (e.g., /C:/Users → C:/Users)
      filePath = decodeURIComponent(url.pathname);
      if (process.platform === 'win32' && filePath.startsWith('/')) {
        filePath = filePath.slice(1);
      }
    } catch {
      return new Response('Invalid URL', { status: 400 });
    }

    // Security: Only serve files under resources/ or userData/
    const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
    const normalizedResources = appResourcesDir.replace(/\\/g, '/').toLowerCase();
    const normalizedUserData = userDataDir.replace(/\\/g, '/').toLowerCase();
    if (
      !normalizedPath.startsWith(normalizedResources) &&
      !normalizedPath.startsWith(normalizedUserData)
    ) {
      logger.warn(`local-resource: blocked access to ${filePath}`);
      return new Response('Forbidden', { status: 403 });
    }

    return net.fetch(pathToFileURL(filePath).href);
  });

  // Set application menu
  createMenu();

  // Create the main window
  mainWindow = createWindow();

  // Create system tray
  createTray(mainWindow);

  // Inject OpenRouter site headers (HTTP-Referer & X-Title) for rankings on openrouter.ai
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://openrouter.ai/*'] },
    (details, callback) => {
      details.requestHeaders['HTTP-Referer'] = 'https://claw-x.com';
      details.requestHeaders['X-Title'] = 'PocketCrow';
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  // Override security headers ONLY for the OpenClaw Gateway Control UI
  const gatewayPort = getPort('OPENCLAW_GATEWAY');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isGatewayUrl =
      details.url.includes(`127.0.0.1:${gatewayPort}`) ||
      details.url.includes(`localhost:${gatewayPort}`);

    if (!isGatewayUrl) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }

    const headers = { ...details.responseHeaders };
    delete headers['X-Frame-Options'];
    delete headers['x-frame-options'];
    if (headers['Content-Security-Policy']) {
      headers['Content-Security-Policy'] = headers['Content-Security-Policy'].map((csp) =>
        csp.replace(/frame-ancestors\s+'none'/g, "frame-ancestors 'self'")
      );
    }
    if (headers['content-security-policy']) {
      headers['content-security-policy'] = headers['content-security-policy'].map((csp) =>
        csp.replace(/frame-ancestors\s+'none'/g, "frame-ancestors 'self'")
      );
    }
    callback({ responseHeaders: headers });
  });

  // Hide to tray instead of quitting when window is closed
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // Clean up reference when window is actually destroyed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Register IPC handlers IMMEDIATELY — the renderer starts loading as soon as
  // createWindow() returns, and may invoke IPC channels before async bootstrap
  // work completes.  Registering handlers first eliminates the startup race.
  // Engine is null here; engine-dependent handlers read engineRef.current lazily,
  // so they'll pick up the engine once bootstrap completes.
  const engineRef: EngineRef = { current: null };
  registerIpcHandlers(gatewayManager, clawHubService, mainWindow, engineRef);

  // Register update handlers
  registerUpdateHandlers(appUpdater, mainWindow);

  // Bootstrap Skill Runtime Engine (after IPC handlers are registered)
  // Once bootstrapped, set engineRef.current so all IPC handlers can access it.
  try {
    engineContext = await bootstrapEngine();
    engineRef.current = engineContext;
    logger.info('Skill Runtime Engine bootstrapped');
  } catch (error) {
    logger.error('Skill Runtime Engine bootstrap failed:', error);
    // Notify the renderer so the UI can show a meaningful error instead of
    // silently displaying "Gateway not running".
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:error', String(error));
    }
  }

  // Start Gateway automatically (after IPC handlers are registered)
  try {
    logger.debug('Auto-starting Gateway...');
    await gatewayManager.start();
    logger.info('Gateway auto-start succeeded');
  } catch (error) {
    logger.error('Gateway auto-start failed:', error);
    mainWindow?.webContents.send('gateway:error', String(error));
  }

  // Bind employee status changes to system tray and forward to renderer
  if (engineContext) {
    const engine = engineContext;
    const refreshTray = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const employees = engine.employeeManager.list();
      const trayInfos: EmployeeTrayInfo[] = employees.map((e) => ({
        id: e.id,
        name: e.name,
        status: e.status,
      }));
      updateTrayMenu(mainWindow!, trayInfos);
    };
    engine.employeeManager.on('status', refreshTray);
    refreshTray();

    // NOTE: employee:status-changed forwarding to renderer is handled by
    // the `forwardStatus` listener in ipc-handlers.ts (via getEmployeeManager()
    // migration). Do NOT add a duplicate listener here — it would cause the
    // renderer to receive every status change event twice.
  }
}

// Application lifecycle
app.whenReady().then(async () => {
  await initialize();

  // Register activate handler AFTER app is ready to prevent
  // "Cannot create BrowserWindow before app is ready" on macOS.
  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    } else if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Don't quit — we hide to tray instead.
  // The tray icon keeps the app process running on all platforms.
});

let cleanupDone = false;

app.on('before-quit', (event) => {
  isQuitting = true;

  if (cleanupDone) return; // Already cleaned up, allow quit to proceed

  // Prevent immediate quit to allow async cleanup
  event.preventDefault();

  (async () => {
    // Clean up extension child processes
    try {
      const { getExtensionInstaller } = await import('../engine/extension-installer');
      getExtensionInstaller().destroy();
    } catch {
      // Non-fatal
    }

    // Clean up engine components (SQLite connections, event listeners)
    if (engineContext) {
      try {
        await engineContext.employeeManager.destroy();
      } catch {
        // Non-fatal
      }
      try {
        engineContext.creditsEngine.destroy();
      } catch {
        // Non-fatal
      }
      // Clean up lazy-initialized components if they were created
      try {
        const lazy = await engineContext.getLazy(gatewayManager);
        // Destroy supervisor first — clears setInterval monitor loops that
        // would otherwise keep the event loop alive and delay process exit.
        lazy.supervisor.destroy();
        // Cancel all running task executions and remove the orphaned
        // task-changed listener from taskQueue.
        lazy.taskExecutor.destroy();
        // Clean up any running child processes in the execution worker.
        lazy.executionWorker.removeAllListeners();
        lazy.taskQueue.destroy();
        lazy.messageBus.destroy();
        lazy.memoryEngine.destroy();
        lazy.prohibitionEngine.destroy();
        lazy.messageStore.destroy();
      } catch {
        // Non-fatal — lazy components may not have been initialized
      }
    }

    await gatewayManager.stop();
    cleanupDone = true;
    app.quit(); // Re-trigger quit now that cleanup is done
  })();
});

// Export for testing
export { mainWindow, gatewayManager };
