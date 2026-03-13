/**
 * Electron Main Process Entry
 * Manages window creation, system tray, and IPC handlers
 */

// ── Global EPIPE guard ──────────────────────────────────────────────────────
// In packaged Electron apps launched via .app bundle (macOS) or detached from a
// terminal, stdout/stderr may be connected to a pipe that is already closed.
// Any console.* call then throws an uncaught EPIPE, crashing the process.
// Installing error handlers on both streams prevents this.
for (const stream of [process.stdout, process.stderr]) {
  stream?.on?.('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') return; // swallow
    // Re-throw non-EPIPE errors so they are still caught by the normal handler
    throw err;
  });
}
// ─────────────────────────────────────────────────────────────────────────────

import { app, BrowserWindow, nativeImage, session, shell } from 'electron';
import { join } from 'path';
import { GatewayManager } from '../gateway/manager';
import { StarOfficeManager } from '../star-office/manager';
import { StarOfficeSyncBridge } from '../star-office/sync-bridge';
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
import { getWindowState, trackWindowState } from './window';
import { logger } from '../utils/logger';
import { warmupNetworkOptimization } from '../utils/uv-env';

import { ClawHubService } from '../gateway/clawhub';

// NOTE: Hardware acceleration is required for backdrop-filter (glass morphism).
// Only disable if you encounter GPU rendering crashes on specific hardware.
// app.disableHardwareAcceleration();

// Global references
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
const gatewayManager = new GatewayManager();
const clawHubService = new ClawHubService();
const starOfficeManager = new StarOfficeManager(getPort('STAR_OFFICE'));
const starOfficeSyncBridge = new StarOfficeSyncBridge(starOfficeManager.client);
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
async function createWindow(): Promise<BrowserWindow> {
  const isMac = process.platform === 'darwin';
  const savedState = await getWindowState();

  const win = new BrowserWindow({
    x: savedState.x,
    y: savedState.y,
    width: savedState.width,
    height: savedState.height,
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

  // Restore maximized state
  if (savedState.isMaximized) {
    win.maximize();
  }

  // Track window position/size changes for persistence
  trackWindowState(win);

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
  logger.info('=== Agentry Application Starting ===');
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

  // Set application menu
  createMenu();

  // Create the main window (async: restores saved position/size)
  mainWindow = await createWindow();

  // Create system tray
  createTray(mainWindow);

  // Inject OpenRouter site headers (HTTP-Referer & X-Title) for rankings on openrouter.ai
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://openrouter.ai/*'] },
    (details, callback) => {
      details.requestHeaders['HTTP-Referer'] = 'https://claw-x.com';
      details.requestHeaders['X-Title'] = 'Agentry';
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
  registerIpcHandlers(gatewayManager, clawHubService, mainWindow, engineRef, starOfficeManager);

  // Register update handlers
  registerUpdateHandlers(appUpdater, mainWindow);

  // Bootstrap Skill Runtime Engine (after IPC handlers are registered)
  // Once bootstrapped, set engineRef.current so all IPC handlers can access it.
  try {
    engineContext = await bootstrapEngine();
    engineRef.current = engineContext;
    logger.info('Skill Runtime Engine bootstrapped');

    // Attach Star Office sync bridge to employee manager
    starOfficeSyncBridge.attach(engineContext.employeeManager);

    // Enable sync when Star Office starts, disable when it stops
    starOfficeManager.on('status', (status) => {
      if (status.state === 'running') {
        void starOfficeSyncBridge.enable();
      } else if (status.state === 'stopped' || status.state === 'error') {
        starOfficeSyncBridge.disable();
      }
    });
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
  app.on('activate', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    } else if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = await createWindow();
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

    starOfficeSyncBridge.destroy();
    await starOfficeManager.destroy();
    await gatewayManager.stop();
    cleanupDone = true;
    app.quit(); // Re-trigger quit now that cleanup is done
  })();
});

// Export for testing
export { mainWindow, gatewayManager };
