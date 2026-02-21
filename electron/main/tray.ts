/**
 * System Tray Management
 * Creates and manages the system tray icon and menu
 */
import { Tray, Menu, BrowserWindow, app, nativeImage } from 'electron';
import { join } from 'path';

let tray: Tray | null = null;
let cachedMainWindow: BrowserWindow | null = null;

/**
 * Lightweight employee info for tray display
 */
export interface EmployeeTrayInfo {
  id: string;
  name: string;
  status: string;
}

/**
 * Resolve the icons directory path (works in both dev and packaged mode)
 */
function getIconsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', 'icons');
  }
  return join(__dirname, '../../resources/icons');
}

/**
 * Create system tray icon and menu
 */
export function createTray(mainWindow: BrowserWindow): Tray {
  cachedMainWindow = mainWindow;
  // Use platform-appropriate icon for system tray
  const iconsDir = getIconsDir();
  let iconPath: string;

  if (process.platform === 'win32') {
    // Windows: use .ico for best quality in system tray
    iconPath = join(iconsDir, 'icon.ico');
  } else if (process.platform === 'darwin') {
    // macOS: use Template.png for proper status bar icon
    // The "Template" suffix tells macOS to treat it as a template image
    iconPath = join(iconsDir, 'tray-icon-Template.png');
  } else {
    // Linux: use 32x32 PNG
    iconPath = join(iconsDir, '32x32.png');
  }

  let icon = nativeImage.createFromPath(iconPath);

  // Fallback to icon.png if platform-specific icon not found
  if (icon.isEmpty()) {
    icon = nativeImage.createFromPath(join(iconsDir, 'icon.png'));
    // Still try to set as template for macOS
    if (process.platform === 'darwin') {
      icon.setTemplateImage(true);
    }
  }

  // Note: Using "Template" suffix in filename automatically marks it as template image
  // But we can also explicitly set it for safety
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }
  
  tray = new Tray(icon);
  
  // Set tooltip
  tray.setToolTip('ClawX - AI Assistant');
  
  // Create context menu
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show ClawX',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      type: 'separator',
    },
    {
      label: 'Gateway Status',
      enabled: false,
    },
    {
      label: '  Running',
      type: 'checkbox',
      checked: true,
      enabled: false,
    },
    {
      type: 'separator',
    },
    {
      label: 'Quick Actions',
      submenu: [
        {
          label: 'Open Dashboard',
          click: () => {
            mainWindow.show();
            mainWindow.webContents.send('navigate', '/');
          },
        },
        {
          label: 'Open Chat',
          click: () => {
            mainWindow.show();
            mainWindow.webContents.send('navigate', '/chat');
          },
        },
        {
          label: 'Open Settings',
          click: () => {
            mainWindow.show();
            mainWindow.webContents.send('navigate', '/settings');
          },
        },
      ],
    },
    {
      type: 'separator',
    },
    {
      label: 'Check for Updates...',
      click: () => {
        mainWindow.webContents.send('update:check');
      },
    },
    {
      type: 'separator',
    },
    {
      label: 'Quit ClawX',
      click: () => {
        app.quit();
      },
    },
  ]);
  
  tray.setContextMenu(contextMenu);
  
  // Click to show window (Windows/Linux)
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  
  // Double-click to show window (Windows)
  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
  
  return tray;
}

/**
 * Status icon mapping for employee states
 */
const STATUS_ICONS: Record<string, string> = {
  idle: '⚪',
  working: '🟢',
  blocked: '🟡',
  error: '🔴',
  offline: '⚫',
};

/**
 * Update tray context menu with dynamic employee status list
 */
export function updateTrayMenu(mainWindow: BrowserWindow, employees: EmployeeTrayInfo[]): void {
  if (!tray) return;

  const workingCount = employees.filter((e) => e.status === 'working').length;
  const tooltip =
    workingCount > 0
      ? `ClawX - ${workingCount} employee${workingCount > 1 ? 's' : ''} working`
      : 'ClawX - AI Employee Platform';
  tray.setToolTip(tooltip);

  const employeeMenuItems: Electron.MenuItemConstructorOptions[] =
    employees.length > 0
      ? employees.map((e) => ({
          label: `${STATUS_ICONS[e.status] ?? '⚫'} ${e.name}`,
          enabled: false,
        }))
      : [{ label: '  No employees', enabled: false }];

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show ClawX',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: 'separator' },
    { label: 'Employees', enabled: false },
    ...employeeMenuItems,
    { type: 'separator' },
    {
      label: 'Quick Actions',
      submenu: [
        {
          label: 'Employee Hub',
          click: () => {
            mainWindow.show();
            mainWindow.webContents.send('navigate', '/employees');
          },
        },
        {
          label: 'Task Board',
          click: () => {
            mainWindow.show();
            mainWindow.webContents.send('navigate', '/tasks');
          },
        },
        {
          label: 'Settings',
          click: () => {
            mainWindow.show();
            mainWindow.webContents.send('navigate', '/settings');
          },
        },
      ],
    },
    { type: 'separator' },
    {
      label: 'Quit ClawX',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

/**
 * Update tray tooltip with Gateway status
 */
export function updateTrayStatus(status: string): void {
  if (tray) {
    tray.setToolTip(`ClawX - ${status}`);
  }
}

/**
 * Destroy tray icon
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
