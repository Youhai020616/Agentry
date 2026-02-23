/**
 * CamofoxLauncher
 * Manages Camofox browser lifecycle: detect installation, install dependencies,
 * start/stop the Camofox server process from the Electron Main process.
 *
 * This eliminates the need for users to manually run terminal commands,
 * providing a one-click experience in the Onboarding wizard.
 */
import { spawn, type ChildProcess, execSync } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';

// ── Types ──────────────────────────────────────────────────────────

export interface CamofoxDetectResult {
  /** Whether a valid Camofox installation was found */
  installed: boolean;
  /** Absolute path to the Camofox directory (if found) */
  path?: string;
  /** Whether node_modules exists (dependencies installed) */
  depsInstalled?: boolean;
  /** Whether server.js entry point exists */
  hasEntryPoint?: boolean;
  /** Human-readable status message */
  message: string;
}

export interface CamofoxStartResult {
  success: boolean;
  /** PID of the spawned process */
  pid?: number;
  error?: string;
}

export interface CamofoxInstallResult {
  success: boolean;
  error?: string;
  output?: string;
}

// ── Constants ──────────────────────────────────────────────────────

/** Standard install path under ~/.openclaw/extensions */
const STANDARD_PATH = join(homedir(), '.openclaw', 'extensions', 'camofox-browser');

/** Common download locations to scan */
const SCAN_PATHS = [
  STANDARD_PATH,
  join(homedir(), 'Downloads'),
  join(homedir(), 'Desktop'),
  join(homedir(), 'Documents'),
];

/** Known directory name patterns for Camofox */
const CAMOFOX_DIR_PATTERNS = [
  'camofox-browser',
  'camofox-browser-main',
  'camofox-browser-master',
];

/** Entry point file to verify installation */
const ENTRY_FILE = 'server.js';

/** Health check timeout after starting (ms) */
const HEALTH_CHECK_TIMEOUT = 15_000;

/** Interval between health check polls (ms) */
const HEALTH_CHECK_INTERVAL = 1_000;

// ── Launcher Class ─────────────────────────────────────────────────

export class CamofoxLauncher {
  /** Reference to the managed Camofox child process */
  private process: ChildProcess | null = null;

  /** Cached detected path */
  private detectedPath: string | null = null;

  /**
   * Detect whether Camofox is installed on the system.
   * Scans standard path first, then common download locations.
   */
  detect(): CamofoxDetectResult {
    // 1. Check the standard install path first
    const standardResult = this.checkDirectory(STANDARD_PATH);
    if (standardResult.installed) {
      this.detectedPath = standardResult.path ?? null;
      return standardResult;
    }

    // 2. Scan common download locations for camofox-browser-* directories
    for (const basePath of SCAN_PATHS) {
      if (!existsSync(basePath)) continue;

      try {
        const entries = readdirSync(basePath);
        for (const entry of entries) {
          const fullPath = join(basePath, entry);

          // Check if this directory matches any known pattern
          const isMatch = CAMOFOX_DIR_PATTERNS.some(
            (pattern) => entry === pattern || entry.startsWith(pattern)
          );

          if (!isMatch) continue;

          try {
            const stat = statSync(fullPath);
            if (!stat.isDirectory()) continue;
          } catch {
            continue;
          }

          const result = this.checkDirectory(fullPath);
          if (result.installed) {
            this.detectedPath = result.path ?? null;
            return result;
          }
        }
      } catch {
        // Skip directories we can't read
        continue;
      }
    }

    return {
      installed: false,
      message: 'Camofox not found. Please download from GitHub.',
    };
  }

  /**
   * Check a specific directory for a valid Camofox installation.
   */
  private checkDirectory(dirPath: string): CamofoxDetectResult {
    if (!existsSync(dirPath)) {
      return { installed: false, message: `Directory not found: ${dirPath}` };
    }

    const hasPackageJson = existsSync(join(dirPath, 'package.json'));
    const hasEntryPoint = existsSync(join(dirPath, ENTRY_FILE));
    const hasDeps = existsSync(join(dirPath, 'node_modules'));

    if (!hasPackageJson) {
      return {
        installed: false,
        message: `Not a valid Camofox installation (no package.json): ${dirPath}`,
      };
    }

    if (!hasEntryPoint) {
      return {
        installed: true,
        path: dirPath,
        depsInstalled: hasDeps,
        hasEntryPoint: false,
        message: `Camofox found but missing ${ENTRY_FILE}: ${dirPath}`,
      };
    }

    return {
      installed: true,
      path: dirPath,
      depsInstalled: hasDeps,
      hasEntryPoint: true,
      message: hasDeps
        ? `Camofox ready at: ${dirPath}`
        : `Camofox found but dependencies not installed: ${dirPath}`,
    };
  }

  /**
   * Install npm dependencies in the Camofox directory.
   * Runs `npm install --production` synchronously (with timeout).
   */
  async installDeps(camofoxPath?: string): Promise<CamofoxInstallResult> {
    const targetPath = camofoxPath ?? this.detectedPath;

    if (!targetPath) {
      return { success: false, error: 'No Camofox path provided or detected' };
    }

    if (!existsSync(join(targetPath, 'package.json'))) {
      return { success: false, error: `No package.json found in: ${targetPath}` };
    }

    logger.info(`Installing Camofox dependencies at: ${targetPath}`);

    return new Promise((resolve) => {
      try {
        // Determine npm executable — use full path on Windows
        const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

        const child = spawn(npmCmd, ['install', '--production'], {
          cwd: targetPath,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: process.platform === 'win32',
          timeout: 120_000, // 2 min timeout
          env: { ...process.env },
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        child.stderr?.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        child.on('error', (err) => {
          logger.error('Camofox npm install spawn error:', err);
          resolve({ success: false, error: `Failed to run npm install: ${err.message}` });
        });

        child.on('exit', (code) => {
          if (code === 0) {
            logger.info('Camofox npm install completed successfully');
            resolve({ success: true, output: stdout });
          } else {
            logger.error(`Camofox npm install exited with code ${code}: ${stderr}`);
            resolve({
              success: false,
              error: `npm install exited with code ${code}`,
              output: stderr || stdout,
            });
          }
        });
      } catch (err) {
        logger.error('Camofox npm install exception:', err);
        resolve({ success: false, error: String(err) });
      }
    });
  }

  /**
   * Start the Camofox server process.
   * Spawns `node server.js` with the given port and API key.
   * Waits until the health endpoint responds before resolving.
   */
  async start(
    port: number = 9377,
    apiKey: string = 'pocketai',
    camofoxPath?: string
  ): Promise<CamofoxStartResult> {
    // If already running (managed by us), return early
    if (this.process && !this.process.killed) {
      // Verify it's actually still alive via health check
      const healthy = await this.healthCheck(port);
      if (healthy) {
        logger.debug('Camofox already running (managed process), skipping start');
        return { success: true, pid: this.process.pid };
      }
      // Process reference is stale, clean up
      this.process = null;
    }

    // Check if something is already running on that port (started externally)
    const alreadyRunning = await this.healthCheck(port);
    if (alreadyRunning) {
      logger.info(`Camofox already running on port ${port} (external process)`);
      return { success: true };
    }

    const targetPath = camofoxPath ?? this.detectedPath;

    if (!targetPath) {
      return { success: false, error: 'No Camofox path provided or detected. Run detect() first.' };
    }

    if (!existsSync(join(targetPath, ENTRY_FILE))) {
      return { success: false, error: `Entry point ${ENTRY_FILE} not found in: ${targetPath}` };
    }

    if (!existsSync(join(targetPath, 'node_modules'))) {
      return {
        success: false,
        error: 'Dependencies not installed. Run installDeps() first.',
      };
    }

    logger.info(`Starting Camofox at: ${targetPath} (port=${port})`);

    return new Promise((resolve) => {
      try {
        // Resolve Node.js executable path
        const nodePath = this.getNodePath();

        const env: Record<string, string | undefined> = {
          ...process.env,
          CAMOFOX_PORT: String(port),
          CAMOFOX_API_KEY: apiKey,
          // Prevent Electron from interfering if we're using Electron's Node
          ELECTRON_RUN_AS_NODE: '1',
        };

        const child = spawn(nodePath, [ENTRY_FILE], {
          cwd: targetPath,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
          env,
        });

        this.process = child;

        // Log stdout/stderr
        child.stdout?.on('data', (data: Buffer) => {
          logger.debug(`[camofox stdout] ${data.toString().trim()}`);
        });

        child.stderr?.on('data', (data: Buffer) => {
          logger.debug(`[camofox stderr] ${data.toString().trim()}`);
        });

        child.on('error', (err) => {
          logger.error('Camofox process spawn error:', err);
          this.process = null;
          resolve({ success: false, error: `Failed to start Camofox: ${err.message}` });
        });

        child.on('exit', (code, signal) => {
          logger.info(`Camofox process exited: code=${code}, signal=${signal}`);
          this.process = null;
        });

        // Wait for health check to confirm startup
        this.waitForHealthy(port)
          .then((healthy) => {
            if (healthy) {
              logger.info(`Camofox started successfully on port ${port} (PID: ${child.pid})`);
              resolve({ success: true, pid: child.pid });
            } else {
              logger.error('Camofox started but health check timed out');
              // Don't kill — it might still be starting up slowly
              resolve({
                success: false,
                pid: child.pid,
                error: 'Camofox process started but health check timed out',
              });
            }
          })
          .catch((err) => {
            resolve({ success: false, error: String(err) });
          });
      } catch (err) {
        logger.error('Camofox start exception:', err);
        resolve({ success: false, error: String(err) });
      }
    });
  }

  /**
   * Stop the managed Camofox process.
   */
  stop(): { success: boolean; error?: string } {
    if (!this.process) {
      return { success: true }; // Nothing to stop
    }

    try {
      const pid = this.process.pid;
      this.process.kill('SIGTERM');
      this.process = null;
      logger.info(`Camofox process stopped (PID: ${pid})`);
      return { success: true };
    } catch (err) {
      logger.error('Failed to stop Camofox:', err);
      return { success: false, error: String(err) };
    }
  }

  /**
   * Check if the managed Camofox process is running.
   */
  get isManaged(): boolean {
    return this.process !== null && !this.process.killed;
  }

  /**
   * Get the cached detected path.
   */
  get path(): string | null {
    return this.detectedPath;
  }

  /**
   * Clean up on app quit.
   */
  destroy(): void {
    if (this.process && !this.process.killed) {
      try {
        this.process.kill('SIGTERM');
      } catch {
        // Best effort
      }
      this.process = null;
    }
  }

  // ── Private Helpers ──────────────────────────────────────────────

  /**
   * Single health check against Camofox HTTP endpoint.
   */
  private async healthCheck(port: number): Promise<boolean> {
    try {
      const res = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Poll health endpoint until it responds or timeout expires.
   */
  private async waitForHealthy(port: number): Promise<boolean> {
    const deadline = Date.now() + HEALTH_CHECK_TIMEOUT;

    while (Date.now() < deadline) {
      const healthy = await this.healthCheck(port);
      if (healthy) return true;

      // Check if process has already exited
      if (this.process?.killed || this.process?.exitCode !== null) {
        return false;
      }

      await this.sleep(HEALTH_CHECK_INTERVAL);
    }

    return false;
  }

  /**
   * Resolve the Node.js executable path.
   * In packaged Electron apps, `process.execPath` points to the Electron binary,
   * but with ELECTRON_RUN_AS_NODE=1 it behaves as Node.
   * In development, use the system `node`.
   */
  private getNodePath(): string {
    // In packaged mode, use Electron binary as Node (with ELECTRON_RUN_AS_NODE=1)
    try {
      const { app } = require('electron');
      if (app.isPackaged) {
        return process.execPath;
      }
    } catch {
      // Not in Electron context
    }

    // In development, try to find system Node
    try {
      const nodePath = execSync('which node', { encoding: 'utf-8' }).trim();
      if (nodePath && existsSync(nodePath)) {
        return nodePath;
      }
    } catch {
      // Fallback
    }

    // Last resort: use process.execPath (works in most cases)
    return process.execPath;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ── Singleton ──────────────────────────────────────────────────────

let _instance: CamofoxLauncher | null = null;

/**
 * Get the singleton CamofoxLauncher instance.
 */
export function getCamofoxLauncher(): CamofoxLauncher {
  if (!_instance) {
    _instance = new CamofoxLauncher();
  }
  return _instance;
}
