/**
 * Star Office Process Manager
 * Manages the Star Office Flask backend as a child process.
 * Pattern follows gateway/manager.ts.
 */
import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { logger } from '../utils/logger';
import { StarOfficeClient } from './client';

export type StarOfficeManagerState = 'stopped' | 'starting' | 'running' | 'error';

export interface StarOfficeManagerStatus {
  state: StarOfficeManagerState;
  port: number;
  pid?: number;
  url?: string;
  error?: string;
}

export interface StarOfficeManagerEvents {
  status: (status: StarOfficeManagerStatus) => void;
  exit: (code: number | null) => void;
  error: (error: Error) => void;
}

const DEFAULT_PORT = 19000;
const HEALTH_CHECK_INTERVAL = 30_000;
const STARTUP_TIMEOUT = 30_000;
const STARTUP_POLL_INTERVAL = 500;

export class StarOfficeManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private status: StarOfficeManagerStatus;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private startLock = false;
  readonly client: StarOfficeClient;

  constructor(port?: number) {
    super();
    const p = port ?? (parseInt(process.env.AGENTRY_PORT_STAR_OFFICE ?? '', 10) || DEFAULT_PORT);
    this.status = { state: 'stopped', port: p };
    this.client = new StarOfficeClient(p);
  }

  getStatus(): StarOfficeManagerStatus {
    return { ...this.status };
  }

  getUrl(): string {
    return `http://127.0.0.1:${this.status.port}`;
  }

  isRunning(): boolean {
    return this.status.state === 'running';
  }

  /** Resolve Star Office root directory */
  private getStarOfficeDir(): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, 'resources', 'star-office');
    }
    return join(process.cwd(), 'resources', 'star-office');
  }

  /** Find python3 command — prefer venv if available */
  private getPythonCommand(): string {
    const starOfficeDir = this.getStarOfficeDir();
    const venvPython =
      process.platform === 'win32'
        ? join(starOfficeDir, '.venv', 'Scripts', 'python.exe')
        : join(starOfficeDir, '.venv', 'bin', 'python3');

    if (existsSync(venvPython)) {
      logger.debug(`[StarOffice] Using venv Python: ${venvPython}`);
      return venvPython;
    }
    return process.platform === 'win32' ? 'python' : 'python3';
  }

  async start(): Promise<void> {
    if (this.startLock) {
      logger.debug('[StarOffice] Start ignored — already in progress');
      return;
    }
    if (this.status.state === 'running') {
      logger.debug('[StarOffice] Already running, skipping start');
      return;
    }

    this.startLock = true;
    this.setStatus({ state: 'starting', error: undefined });

    try {
      // Check if already running on this port
      const alreadyUp = await this.client.health();
      if (alreadyUp) {
        logger.info(`[StarOffice] Already running on port ${this.status.port}`);
        this.setStatus({ state: 'running', url: this.getUrl() });
        this.startHealthCheck();
        return;
      }

      await this.spawnProcess();
      await this.waitForReady();
      this.setStatus({ state: 'running', url: this.getUrl() });
      this.startHealthCheck();
      logger.info(`[StarOffice] Started on port ${this.status.port}`);
    } catch (error) {
      logger.error('[StarOffice] Start failed:', error);
      this.setStatus({ state: 'error', error: String(error) });
      throw error;
    } finally {
      this.startLock = false;
    }
  }

  async stop(): Promise<void> {
    logger.info('[StarOffice] Stop requested');
    this.clearHealthCheck();

    if (this.process) {
      const child = this.process;
      this.process = null;
      logger.info(`[StarOffice] Sending SIGTERM (pid=${child.pid ?? 'unknown'})`);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) {
          logger.warn('[StarOffice] Force killing with SIGKILL');
          child.kill('SIGKILL');
        }
      }, 5000);
    }

    this.setStatus({ state: 'stopped', error: undefined, pid: undefined, url: undefined });
  }

  async restart(): Promise<void> {
    await this.stop();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await this.start();
  }

  /** Clean up — call on app quit. Uses stop() for SIGKILL fallback. */
  async destroy(): Promise<void> {
    await this.stop();
    this.removeAllListeners();
  }

  private async spawnProcess(): Promise<void> {
    const starOfficeDir = this.getStarOfficeDir();
    const backendDir = join(starOfficeDir, 'backend');
    const appPy = join(backendDir, 'app.py');

    if (!existsSync(appPy)) {
      throw new Error(`Star Office backend not found at: ${appPy}`);
    }

    // Ensure state.json exists
    const stateJson = join(starOfficeDir, 'state.json');
    if (!existsSync(stateJson)) {
      const sampleJson = join(starOfficeDir, 'state.sample.json');
      if (existsSync(sampleJson)) {
        const { copyFileSync } = await import('fs');
        copyFileSync(sampleJson, stateJson);
        logger.info('[StarOffice] Created state.json from sample');
      }
    }

    const python = this.getPythonCommand();
    const env: Record<string, string | undefined> = {
      ...process.env,
      STAR_BACKEND_PORT: String(this.status.port),
      FLASK_ENV: app.isPackaged ? 'production' : 'development',
    };

    logger.info(
      `[StarOffice] Spawning: ${python} app.py (cwd=${backendDir}, port=${this.status.port})`
    );

    return new Promise<void>((resolve, reject) => {
      this.process = spawn(python, ['app.py'], {
        cwd: backendDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        env,
      });

      const child = this.process;

      child.on('error', (error) => {
        logger.error('[StarOffice] Process spawn error:', error);
        reject(error);
      });

      child.on('exit', (code, signal) => {
        const msg = code !== null ? `code=${code}` : `signal=${signal}`;
        logger.info(`[StarOffice] Process exited (${msg})`);
        if (this.process === child) {
          this.process = null;
        }
        this.emit('exit', code);

        if (this.status.state === 'running') {
          this.setStatus({ state: 'stopped', pid: undefined, url: undefined });
        }
      });

      child.stdout?.on('data', (data) => {
        const line = data.toString().trim();
        if (line) logger.debug(`[StarOffice stdout] ${line}`);
      });

      child.stderr?.on('data', (data) => {
        const line = data.toString().trim();
        if (line) {
          // Flask outputs normal startup info to stderr
          if (line.includes('Running on') || line.includes('Serving Flask')) {
            logger.info(`[StarOffice] ${line}`);
          } else {
            logger.debug(`[StarOffice stderr] ${line}`);
          }
        }
      });

      if (child.pid) {
        logger.info(`[StarOffice] Process started (pid=${child.pid})`);
        this.setStatus({ pid: child.pid });
      }

      resolve();
    });
  }

  private async waitForReady(): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT;
    while (Date.now() < deadline) {
      const ok = await this.client.health();
      if (ok) return;
      if (!this.process) {
        throw new Error('Star Office process exited before becoming ready');
      }
      await new Promise((resolve) => setTimeout(resolve, STARTUP_POLL_INTERVAL));
    }
    throw new Error(`Star Office did not become ready within ${STARTUP_TIMEOUT / 1000}s`);
  }

  private startHealthCheck(): void {
    this.clearHealthCheck();
    this.healthCheckInterval = setInterval(async () => {
      if (this.status.state !== 'running') return;
      try {
        const ok = await this.client.health();
        if (!ok) {
          logger.warn('[StarOffice] Health check failed');
          this.setStatus({ state: 'error', error: 'Health check failed' });
          this.emit('error', new Error('Health check failed'));
        }
      } catch (error) {
        logger.error('[StarOffice] Health check error:', error);
      }
    }, HEALTH_CHECK_INTERVAL);
  }

  private clearHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private setStatus(update: Partial<StarOfficeManagerStatus>): void {
    const prev = this.status.state;
    this.status = { ...this.status, ...update };
    this.emit('status', { ...this.status });
    if (prev !== this.status.state) {
      logger.debug(`[StarOffice] State: ${prev} -> ${this.status.state}`);
    }
  }
}
