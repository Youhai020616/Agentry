/**
 * BrowserLoginManager
 * Opens a dedicated BrowserWindow for browser-based employee onboarding.
 * Uses a custom session partition to isolate cookies from the main app.
 *
 * Flow:
 *   1. openLoginWindow(options) creates a BrowserWindow with isolated session
 *   2. Loads the loginUrl (e.g., Reddit login page)
 *   3. Polls session.cookies every 2s looking for the successIndicator cookie
 *   4. On success: extracts all cookies for the specified domains → resolves
 *   5. On window close / timeout (5min) → rejects
 */
import { BrowserWindow, session } from 'electron';
import { logger } from '../utils/logger';

export interface BrowserLoginOptions {
  loginUrl: string;
  /** Cookie name that proves login success (e.g. "reddit_session") */
  successIndicator: string;
  /** Cookie domains to capture (e.g. [".reddit.com"]) */
  cookieDomains: string[];
  parentWindow?: BrowserWindow;
  width?: number;
  height?: number;
}

/** Serializable cookie for storage */
export interface SerializedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
  sameSite?: string;
}

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 2000; // 2 seconds

export class BrowserLoginManager {
  private loginWindow: BrowserWindow | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  /**
   * Open a browser login window and wait for the user to authenticate.
   * Returns serialized cookies on success.
   */
  async openLoginWindow(options: BrowserLoginOptions): Promise<SerializedCookie[]> {
    // Close any existing window first
    this.close();

    const partition = `persist:onboarding-${Date.now()}`;

    // Use a real Chrome User-Agent so Google OAuth doesn't block the embedded browser.
    // Google rejects login from user-agents containing "Electron" or "CriOS".
    const chromeUA =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

    const loginSession = session.fromPartition(partition);
    loginSession.setUserAgent(chromeUA);

    this.loginWindow = new BrowserWindow({
      width: options.width ?? 520,
      height: options.height ?? 720,
      parent: options.parentWindow,
      modal: false,
      show: false,
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        // No sandbox — Google OAuth and other login pages need full web features
      },
      title: 'Login',
    });

    this.loginWindow.once('ready-to-show', () => {
      this.loginWindow?.show();
    });

    // Prevent new window popups — open in same window
    this.loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      this.loginWindow?.loadURL(url);
      return { action: 'deny' };
    });

    await this.loginWindow.loadURL(options.loginUrl);
    logger.info(`Browser login window opened: ${options.loginUrl}`);

    return new Promise<SerializedCookie[]>((resolve, reject) => {
      const sessionCookies = loginSession.cookies;

      // Poll for the success indicator cookie
      this.pollInterval = setInterval(async () => {
        try {
          const allCookies: Electron.Cookie[] = [];
          for (const domain of options.cookieDomains) {
            const domainCookies = await sessionCookies.get({ domain });
            allCookies.push(...domainCookies);
          }

          const hasSuccess = allCookies.some(
            (c) => c.name === options.successIndicator
          );

          if (hasSuccess) {
            logger.info(
              `Browser login success: found "${options.successIndicator}" cookie (${allCookies.length} cookies total)`
            );
            this.cleanup();
            const serialized = allCookies.map(serializeCookie);
            resolve(serialized);
          }
        } catch (err) {
          logger.warn(`Cookie poll error: ${err}`);
        }
      }, POLL_INTERVAL_MS);

      // Handle window closed by user before login completes
      this.loginWindow?.on('closed', () => {
        this.loginWindow = null;
        this.cleanup();
        reject(new Error('Login window closed by user'));
      });

      // Timeout
      this.timeoutHandle = setTimeout(() => {
        this.cleanup();
        this.close();
        reject(new Error('Login timed out (5 minutes)'));
      }, LOGIN_TIMEOUT_MS);
    });
  }

  /** Close the login window if open */
  close(): void {
    this.cleanup();
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.close();
    }
    this.loginWindow = null;
  }

  private cleanup(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }
}

/** Convert Electron.Cookie to a plain serializable object */
function serializeCookie(cookie: Electron.Cookie): SerializedCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain ?? '',
    path: cookie.path ?? '/',
    secure: cookie.secure ?? false,
    httpOnly: cookie.httpOnly ?? false,
    expirationDate: cookie.expirationDate,
    sameSite: cookie.sameSite,
  };
}
