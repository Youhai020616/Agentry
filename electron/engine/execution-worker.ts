/**
 * Execution Worker
 * Python script execution engine using UV runtime.
 * Spawns `uv run python <script>` processes and manages their lifecycle.
 */
import { EventEmitter } from 'node:events';
import { spawn, ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { logger } from '../utils/logger';
import { getUvMirrorEnv } from '../utils/uv-env';

export interface ExecutionOptions {
  scriptPath: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeout?: number; // ms, default 300000 (5 min)
  outputDir?: string; // directory to scan for output files
}

export interface ExecutionResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  outputFiles: string[];
  duration: number; // ms
}

export type ExecutionStatus = 'idle' | 'running' | 'completed' | 'failed' | 'timeout';

/**
 * Resolve the UV binary path.
 * Checks system PATH first, then falls back to the bundled binary.
 */
function getBundledUvPath(): string {
  const platform = process.platform;
  const arch = process.arch;
  const target = `${platform}-${arch}`;
  const binName = platform === 'win32' ? 'uv.exe' : 'uv';

  if (app.isPackaged) {
    return join(process.resourcesPath, 'bin', binName);
  }
  return join(process.cwd(), 'resources', 'bin', target, binName);
}

async function resolveUvBin(): Promise<string> {
  const inPath = await new Promise<boolean>((resolve) => {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
    const child = spawn(cmd, ['uv']);
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });

  if (inPath) return 'uv';

  const bundled = getBundledUvPath();
  if (existsSync(bundled)) return bundled;

  throw new Error('uv binary not found in PATH or bundled location');
}

/**
 * ExecutionWorker — spawns Python scripts via UV and manages their lifecycle.
 *
 * Events:
 *  - 'execution:started'   (id: string)
 *  - 'execution:output'    (id: string, data: { stream: 'stdout' | 'stderr', text: string })
 *  - 'execution:completed' (id: string, result: ExecutionResult)
 *  - 'execution:failed'    (id: string, error: string)
 */
export class ExecutionWorker extends EventEmitter {
  private processes: Map<string, ChildProcess> = new Map();
  private statuses: Map<string, ExecutionStatus> = new Map();

  /**
   * Run a Python script using UV.
   *
   * @param id   Unique identifier for this execution (for cancellation/status)
   * @param options  Execution configuration
   * @returns ExecutionResult on completion
   */
  async run(id: string, options: ExecutionOptions): Promise<ExecutionResult> {
    if (this.processes.has(id)) {
      throw new Error(`Execution ${id} is already running`);
    }

    const {
      scriptPath,
      args = [],
      env = {},
      cwd,
      timeout = 300000,
      outputDir,
    } = options;

    if (!existsSync(scriptPath)) {
      throw new Error(`Script not found: ${scriptPath}`);
    }

    const uvBin = await resolveUvBin();
    const uvEnv = await getUvMirrorEnv();

    logger.info(`[ExecutionWorker] Starting execution ${id}: ${uvBin} run python ${scriptPath}`);

    const startTime = Date.now();
    this.statuses.set(id, 'running');
    this.emit('execution:started', id);

    return new Promise<ExecutionResult>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      const finish = (result: ExecutionResult) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        this.processes.delete(id);
        resolve(result);
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        this.processes.delete(id);
        reject(error);
      };

      const proc = spawn(uvBin, ['run', 'python', scriptPath, ...args], {
        cwd: cwd ?? undefined,
        env: {
          ...process.env,
          ...uvEnv,
          ...env,
        },
        shell: process.platform === 'win32',
      });

      this.processes.set(id, proc);

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        this.emit('execution:output', id, { stream: 'stdout', text });
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        this.emit('execution:output', id, { stream: 'stderr', text });
      });

      proc.on('close', (code) => {
        const duration = Date.now() - startTime;
        const outputFiles = outputDir ? this.scanOutputDir(outputDir) : [];

        if (code === 0) {
          this.statuses.set(id, 'completed');
          const result: ExecutionResult = {
            exitCode: code,
            stdout,
            stderr,
            outputFiles,
            duration,
          };
          logger.info(
            `[ExecutionWorker] Execution ${id} completed in ${duration}ms (exit=${code}, files=${outputFiles.length})`
          );
          this.emit('execution:completed', id, result);
          finish(result);
        } else {
          this.statuses.set(id, 'failed');
          const result: ExecutionResult = {
            exitCode: code,
            stdout,
            stderr,
            outputFiles,
            duration,
          };
          logger.warn(`[ExecutionWorker] Execution ${id} failed with exit code ${code}`);
          this.emit('execution:failed', id, `Process exited with code ${code}`);
          finish(result);
        }
      });

      proc.on('error', (err) => {
        this.statuses.set(id, 'failed');
        logger.error(`[ExecutionWorker] Execution ${id} spawn error: ${err.message}`);
        this.emit('execution:failed', id, err.message);
        fail(new Error(`Failed to spawn process: ${err.message}`));
      });

      // Timeout handling: SIGTERM first, then SIGKILL after 5s grace period
      if (timeout > 0) {
        timeoutHandle = setTimeout(() => {
          if (settled) return;
          logger.warn(`[ExecutionWorker] Execution ${id} timed out after ${timeout}ms`);
          this.statuses.set(id, 'timeout');

          proc.kill('SIGTERM');
          setTimeout(() => {
            if (!settled) {
              proc.kill('SIGKILL');
            }
          }, 5000);

          const duration = Date.now() - startTime;
          const outputFiles = outputDir ? this.scanOutputDir(outputDir) : [];
          const result: ExecutionResult = {
            exitCode: null,
            stdout,
            stderr,
            outputFiles,
            duration,
          };
          this.emit('execution:failed', id, `Execution timed out after ${timeout}ms`);
          finish(result);
        }, timeout);
      }
    });
  }

  /**
   * Cancel a running execution.
   * Sends SIGTERM first, then SIGKILL after 5s grace period.
   */
  cancel(id: string): void {
    const proc = this.processes.get(id);
    if (!proc) {
      logger.debug(`[ExecutionWorker] cancel(${id}): no running process found`);
      return;
    }

    logger.info(`[ExecutionWorker] Cancelling execution ${id}`);
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (this.processes.has(id)) {
        proc.kill('SIGKILL');
      }
    }, 5000);
  }

  /**
   * Get the current status of an execution.
   */
  getStatus(id: string): ExecutionStatus {
    return this.statuses.get(id) ?? 'idle';
  }

  /**
   * Scan a directory for output files.
   * Returns an array of absolute file paths.
   */
  private scanOutputDir(dir: string): string[] {
    if (!existsSync(dir)) return [];
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(dir, entry.name));
    } catch (err) {
      logger.warn(`[ExecutionWorker] Failed to scan output directory ${dir}: ${err}`);
      return [];
    }
  }
}
