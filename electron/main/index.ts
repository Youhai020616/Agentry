/**
 * Electron Main Process Entry
 * Manages window creation, system tray, and IPC handlers
 */
import { app, BrowserWindow, nativeImage, session, shell } from 'electron';
import { join } from 'path';
import { GatewayManager } from '../gateway/manager';
import { registerIpcHandlers } from './ipc-handlers';
import type { EngineRef } from './ipc-handlers';
import { createTray, updateTrayMenu } from './tray';
import type { EmployeeTrayInfo } from './tray';
import { createMenu } from './menu';
import { bootstrapEngine } from '../engine/bootstrap';
import type { EngineContext } from '../engine/bootstrap';

import { appUpdater, registerUpdateHandlers } from './updater';
import { logger } from '../utils/logger';
import { warmupNetworkOptimization } from '../utils/uv-env';

import { ClawHubService } from '../gateway/clawhub';

// Disable GPU acceleration for better compatibility
app.disableHardwareAcceleration();

// Global references
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
const gatewayManager = new GatewayManager();
const clawHubService = new ClawHubService();

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
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isGatewayUrl =
      details.url.includes('127.0.0.1:18789') || details.url.includes('localhost:18789');

    if (!isGatewayUrl) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }

    const headers = { ...details.responseHeaders };
    delete headers['X-Frame-Options'];
    delete headers['x-frame-options'];
    if (headers['Content-Security-Policy']) {
      headers['Content-Security-Policy'] = headers['Content-Security-Policy'].map((csp) =>
        csp.replace(/frame-ancestors\s+'none'/g, "frame-ancestors 'self' *")
      );
    }
    if (headers['content-security-policy']) {
      headers['content-security-policy'] = headers['content-security-policy'].map((csp) =>
        csp.replace(/frame-ancestors\s+'none'/g, "frame-ancestors 'self' *")
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
  let engine: EngineContext | null = null;
  try {
    engine = await bootstrapEngine();
    engineRef.current = engine;
    logger.info('Skill Runtime Engine bootstrapped');
  } catch (error) {
    logger.error('Skill Runtime Engine bootstrap failed:', error);
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

  // Bind employee status changes to system tray
  if (engine) {
    const refreshTray = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const employees = engine!.employeeManager.list();
      const trayInfos: EmployeeTrayInfo[] = employees.map((e) => ({
        id: e.id,
        name: e.name,
        status: e.status,
      }));
      updateTrayMenu(mainWindow!, trayInfos);
    };
    engine.employeeManager.on('status', refreshTray);
    refreshTray();
  }
}

// Application lifecycle
app.whenReady().then(() => {
  initialize();

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

app.on('before-quit', async () => {
  isQuitting = true;

  // Clean up extension child processes
  try {
    const { getExtensionInstaller } = await import('../engine/extension-installer');
    getExtensionInstaller().destroy();
  } catch {
    // Non-fatal
  }

  await gatewayManager.stop();
});

// Export for testing
export { mainWindow, gatewayManager };
