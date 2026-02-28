/**
 * Extension Installer
 * Manages detection, installation, and lifecycle of runtime extensions
 * declared in manifest.json `capabilities.runtime.requires`.
 *
 * Each extension is defined by an ExtensionRecipe that knows how to
 * detect, install, verify, and (optionally) start/stop a service.
 */
import { spawn, type ChildProcess } from 'child_process';
import {
  existsSync,
  mkdirSync,
  createWriteStream,
  renameSync,
  readdirSync,
  unlinkSync,
  chmodSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';

// ── Types ──────────────────────────────────────────────────────────

export interface ExtensionCheckResult {
  name: string;
  ready: boolean;
  installed: boolean;
  message: string;
  /** Service extensions only — whether the service is running */
  running?: boolean;
}

export interface ExtensionInstallResult {
  name: string;
  success: boolean;
  error?: string;
  /** Special marker for manual-download-required extensions */
  manualRequired?: boolean;
}

export interface ExtensionProgressEvent {
  name: string;
  phase: string;
  progress: number; // 0-100
  message: string;
}

export interface ExtensionRecipe {
  /** Matches runtime.requires entries */
  name: string;
  /** UI display name */
  displayName: string;
  /** Whether this is a long-running service (needs start/stop) */
  isService: boolean;
  /** Default port for service extensions */
  defaultPort?: number;

  detect(): Promise<ExtensionCheckResult>;
  install(onProgress?: (event: ExtensionProgressEvent) => void): Promise<ExtensionInstallResult>;
  verify(): Promise<{ success: boolean; error?: string }>;
  start?(
    options?: Record<string, unknown>
  ): Promise<{ success: boolean; pid?: number; error?: string }>;
  stop?(): Promise<{ success: boolean; error?: string }>;
  healthCheck?(): Promise<boolean>;
}

// ── Constants ──────────────────────────────────────────────────────

const EXTENSIONS_DIR = join(homedir(), '.openclaw', 'extensions');

// ── Helper Functions ───────────────────────────────────────────────

function ensureExtensionsDir(): void {
  if (!existsSync(EXTENSIONS_DIR)) {
    mkdirSync(EXTENSIONS_DIR, { recursive: true });
  }
}

/**
 * Promise-wrapped child_process.spawn
 */
function spawnAsync(
  cmd: string,
  args: string[],
  opts?: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    shell?: boolean;
    timeout?: number;
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
  }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, {
        cwd: opts?.cwd,
        env: opts?.env ?? { ...process.env },
        shell: opts?.shell ?? process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: opts?.timeout ?? 300_000, // 5 min default
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data: Buffer) => {
        const str = data.toString();
        stdout += str;
        opts?.onStdout?.(str);
      });

      child.stderr?.on('data', (data: Buffer) => {
        const str = data.toString();
        stderr += str;
        opts?.onStderr?.(str);
      });

      child.on('error', (err) => {
        resolve({ code: -1, stdout, stderr: stderr || err.message });
      });

      child.on('exit', (code) => {
        resolve({ code: code ?? -1, stdout, stderr });
      });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err) });
    }
  });
}

/**
 * HTTP GET health check
 */
async function healthCheckHttp(
  port: number,
  path: string = '/health',
  timeoutMs: number = 3000
): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Poll health endpoint until it responds or timeout expires
 */
async function waitForHealth(
  port: number,
  timeoutMs: number = 15_000,
  path: string = '/health'
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await healthCheckHttp(port, path);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/**
 * Get uv binary path — check PATH first, then bundled
 */
async function getUvBin(): Promise<string> {
  const inPath = await new Promise<boolean>((resolve) => {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
    const child = spawn(cmd, ['uv']);
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });

  if (inPath) return 'uv';

  // Bundled path
  const { app } = await import('electron');
  const platform = process.platform;
  const arch = process.arch;
  const binName = platform === 'win32' ? 'uv.exe' : 'uv';

  if (app.isPackaged) {
    return join(process.resourcesPath, 'bin', binName);
  }
  return join(process.cwd(), 'resources', 'bin', `${platform}-${arch}`, binName);
}

/**
 * Check if git is available in PATH
 */
async function isGitAvailable(): Promise<boolean> {
  const result = await spawnAsync(process.platform === 'win32' ? 'where.exe' : 'which', ['git']);
  return result.code === 0;
}

/**
 * Download a file from URL to destPath using Node https
 */
async function downloadFile(
  url: string,
  destPath: string,
  maxRedirects: number = 10
): Promise<void> {
  if (maxRedirects <= 0) {
    throw new Error('Too many redirects');
  }

  const https = await import('https');
  const http = await import('http');

  return new Promise((resolve, reject) => {
    const handler = url.startsWith('https') ? https : http;
    const request = handler.get(url, (response) => {
      // Follow redirects (with depth limit)
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        downloadFile(response.headers.location, destPath, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode && response.statusCode >= 400) {
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      const file = createWriteStream(destPath);
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
      file.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(120_000, () => {
      request.destroy(new Error('Download timeout'));
    });
  });
}

// ── Recipe: python3 ────────────────────────────────────────────────

function createPython3Recipe(): ExtensionRecipe {
  return {
    name: 'python3',
    displayName: 'Python 3.12',
    isService: false,

    async detect(): Promise<ExtensionCheckResult> {
      const { isPythonReady } = await import('../utils/uv-setup');
      const ready = await isPythonReady();
      return {
        name: 'python3',
        ready,
        installed: ready,
        message: ready ? 'Python 3.12 is available' : 'Python 3.12 not found',
      };
    },

    async install(onProgress): Promise<ExtensionInstallResult> {
      try {
        onProgress?.({
          name: 'python3',
          phase: 'checking',
          progress: 10,
          message: 'Checking uv...',
        });
        const { checkUvInstalled, installUv, setupManagedPython } =
          await import('../utils/uv-setup');

        const isUvInstalled = await checkUvInstalled();
        if (!isUvInstalled) {
          onProgress?.({
            name: 'python3',
            phase: 'installing-uv',
            progress: 20,
            message: 'Installing uv...',
          });
          await installUv();
        }

        onProgress?.({
          name: 'python3',
          phase: 'installing-python',
          progress: 40,
          message: 'Installing Python 3.12...',
        });
        await setupManagedPython();

        onProgress?.({
          name: 'python3',
          phase: 'done',
          progress: 100,
          message: 'Python 3.12 installed',
        });
        return { name: 'python3', success: true };
      } catch (err) {
        logger.error('python3 install failed:', err);
        return { name: 'python3', success: false, error: String(err) };
      }
    },

    async verify(): Promise<{ success: boolean; error?: string }> {
      const { isPythonReady } = await import('../utils/uv-setup');
      const ready = await isPythonReady();
      return ready
        ? { success: true }
        : { success: false, error: 'Python 3.12 not found after install' };
    },
  };
}

// ── Recipe: camofox ────────────────────────────────────────────────

function createCamofoxRecipe(): ExtensionRecipe {
  return {
    name: 'camofox',
    displayName: 'Camofox Browser',
    isService: true,
    defaultPort: 9377,

    async detect(): Promise<ExtensionCheckResult> {
      const { getCamofoxLauncher } = await import('./camofox-launcher');
      const launcher = getCamofoxLauncher();
      const result = launcher.detect();
      const running = await healthCheckHttp(9377);
      return {
        name: 'camofox',
        ready: result.installed && !!result.depsInstalled && (!!result.hasEntryPoint || running),
        installed: result.installed,
        running,
        message: result.message,
      };
    },

    async install(onProgress): Promise<ExtensionInstallResult> {
      const camofoxDir = join(EXTENSIONS_DIR, 'camofox-browser');
      const repoUrl = 'https://github.com/nicepkg/camofox-browser';
      const zipUrl = `${repoUrl}/archive/refs/heads/main.zip`;

      try {
        onProgress?.({
          name: 'camofox',
          phase: 'detecting',
          progress: 5,
          message: 'Detecting Camofox...',
        });
        const { getCamofoxLauncher } = await import('./camofox-launcher');
        let launcher = getCamofoxLauncher();
        let detectResult = launcher.detect();

        // ── Auto-download if not installed ──────────────────────────
        if (!detectResult.installed) {
          ensureExtensionsDir();

          const hasGit = await isGitAvailable();

          if (hasGit) {
            // Prefer git clone (shallow, faster updates later)
            onProgress?.({
              name: 'camofox',
              phase: 'cloning',
              progress: 10,
              message: 'Cloning Camofox repository...',
            });
            logger.info(`Cloning camofox-browser from ${repoUrl}`);
            const cloneResult = await spawnAsync(
              'git',
              ['clone', '--depth', '1', repoUrl, camofoxDir],
              { timeout: 120_000 }
            );
            if (cloneResult.code !== 0) {
              logger.error('git clone camofox failed:', cloneResult.stderr);
              // Fall through to ZIP fallback
            }
          }

          // ZIP fallback if git failed or unavailable
          if (!existsSync(join(camofoxDir, 'package.json'))) {
            onProgress?.({
              name: 'camofox',
              phase: 'downloading',
              progress: 15,
              message: 'Downloading Camofox ZIP...',
            });
            logger.info(`Downloading camofox-browser ZIP from ${zipUrl}`);

            const zipPath = join(EXTENSIONS_DIR, 'camofox-browser-main.zip');
            try {
              await downloadFile(zipUrl, zipPath);

              onProgress?.({
                name: 'camofox',
                phase: 'installing',
                progress: 30,
                message: 'Extracting Camofox...',
              });

              let extracted = false;
              if (process.platform === 'win32') {
                const psResult = await spawnAsync(
                  'powershell',
                  [
                    '-NoProfile',
                    '-Command',
                    `Expand-Archive -Path '${zipPath}' -DestinationPath '${EXTENSIONS_DIR}' -Force`,
                  ],
                  { timeout: 60_000 }
                );
                extracted = psResult.code === 0;
                if (!extracted) logger.error('PowerShell extract camofox failed:', psResult.stderr);
              } else {
                const unzipResult = await spawnAsync(
                  'unzip',
                  ['-o', zipPath, '-d', EXTENSIONS_DIR],
                  { timeout: 60_000 }
                );
                extracted = unzipResult.code === 0;
                if (!extracted) logger.error('unzip camofox failed:', unzipResult.stderr);
              }

              // Clean up ZIP
              try {
                unlinkSync(zipPath);
              } catch {
                /* non-fatal */
              }

              if (!extracted) {
                return {
                  name: 'camofox',
                  success: false,
                  manualRequired: true,
                  error: 'Failed to extract Camofox ZIP archive',
                };
              }

              // GitHub ZIPs extract to <repo>-<branch>/ — rename to canonical name
              const extractedDir = join(EXTENSIONS_DIR, 'camofox-browser-main');
              if (existsSync(extractedDir) && !existsSync(camofoxDir)) {
                renameSync(extractedDir, camofoxDir);
                logger.info(`Renamed camofox-browser-main → camofox-browser`);
              }
            } catch (err) {
              try {
                unlinkSync(zipPath);
              } catch {
                /* non-fatal */
              }
              logger.error('camofox ZIP download/extract failed:', err);
              return {
                name: 'camofox',
                success: false,
                manualRequired: true,
                error: `Failed to download Camofox: ${String(err)}`,
              };
            }
          }

          // Re-detect after download
          launcher = getCamofoxLauncher();
          detectResult = launcher.detect();

          if (!detectResult.installed) {
            return {
              name: 'camofox',
              success: false,
              manualRequired: true,
              error:
                'Camofox download succeeded but installation not detected. Please check: ' +
                camofoxDir,
            };
          }
          logger.info(`Camofox auto-installed at: ${detectResult.path}`);
        }

        // ── Install npm dependencies if needed ─────────────────────
        if (!detectResult.depsInstalled) {
          onProgress?.({
            name: 'camofox',
            phase: 'installing-deps',
            progress: 60,
            message: 'Installing npm dependencies...',
          });
          const installResult = await launcher.installDeps(detectResult.path);
          if (!installResult.success) {
            return {
              name: 'camofox',
              success: false,
              error: installResult.error ?? 'Dependency install failed',
            };
          }
        }

        onProgress?.({ name: 'camofox', phase: 'done', progress: 100, message: 'Camofox ready' });
        return { name: 'camofox', success: true };
      } catch (err) {
        logger.error('camofox install failed:', err);
        return { name: 'camofox', success: false, error: String(err) };
      }
    },

    async verify(): Promise<{ success: boolean; error?: string }> {
      const { getCamofoxLauncher } = await import('./camofox-launcher');
      const launcher = getCamofoxLauncher();
      const result = launcher.detect();
      return result.installed && result.hasEntryPoint
        ? { success: true }
        : { success: false, error: 'Camofox not fully installed' };
    },

    async start(options): Promise<{ success: boolean; pid?: number; error?: string }> {
      const { getCamofoxLauncher } = await import('./camofox-launcher');
      const launcher = getCamofoxLauncher();
      const port = (options?.port as number) ?? 9377;
      const apiKey = (options?.apiKey as string) ?? 'pocketai';
      return launcher.start(port, apiKey);
    },

    async stop(): Promise<{ success: boolean; error?: string }> {
      const { getCamofoxLauncher } = await import('./camofox-launcher');
      const launcher = getCamofoxLauncher();
      return launcher.stop();
    },

    async healthCheck(): Promise<boolean> {
      return healthCheckHttp(9377);
    },
  };
}

// ── Recipe: xiaohongshu-mcp ────────────────────────────────────────

function createXiaohongshuMcpRecipe(): ExtensionRecipe {
  const extensionDir = join(EXTENSIONS_DIR, 'xiaohongshu-mcp');
  const binaryName = process.platform === 'win32' ? 'xiaohongshu-mcp.exe' : 'xiaohongshu-mcp';
  const binaryPath = join(extensionDir, binaryName);
  const defaultPort = 18060;

  let serviceProcess: ChildProcess | null = null;

  return {
    name: 'xiaohongshu-mcp',
    displayName: 'Xiaohongshu MCP',
    isService: true,
    defaultPort,

    async detect(): Promise<ExtensionCheckResult> {
      const hasBinary = existsSync(binaryPath);
      const running = await healthCheckHttp(defaultPort, '/health');
      return {
        name: 'xiaohongshu-mcp',
        ready: hasBinary || running,
        installed: hasBinary,
        running,
        message: hasBinary
          ? running
            ? 'Xiaohongshu MCP is running'
            : 'Xiaohongshu MCP installed but not running'
          : 'Xiaohongshu MCP binary not found',
      };
    },

    async install(onProgress): Promise<ExtensionInstallResult> {
      ensureExtensionsDir();
      if (!existsSync(extensionDir)) {
        mkdirSync(extensionDir, { recursive: true });
      }

      // Already installed
      if (existsSync(binaryPath)) {
        return { name: 'xiaohongshu-mcp', success: true };
      }

      // ── Determine platform asset name ──────────────────────────
      const platform = process.platform;
      const arch = process.arch;

      let assetName: string;
      if (platform === 'win32' && arch === 'x64') {
        assetName = 'xiaohongshu-mcp-windows-amd64.zip';
      } else if (platform === 'darwin' && arch === 'arm64') {
        assetName = 'xiaohongshu-mcp-darwin-arm64.tar.gz';
      } else if (platform === 'darwin' && arch === 'x64') {
        assetName = 'xiaohongshu-mcp-darwin-amd64.tar.gz';
      } else if (platform === 'linux' && arch === 'arm64') {
        assetName = 'xiaohongshu-mcp-linux-arm64.tar.gz';
      } else if (platform === 'linux' && arch === 'x64') {
        assetName = 'xiaohongshu-mcp-linux-amd64.tar.gz';
      } else {
        return {
          name: 'xiaohongshu-mcp',
          success: false,
          manualRequired: true,
          error: `Unsupported platform: ${platform}-${arch}. Please download manually from https://github.com/xpzouying/xiaohongshu-mcp/releases and place the binary at: ${extensionDir}`,
        };
      }

      const downloadUrl = `https://github.com/xpzouying/xiaohongshu-mcp/releases/latest/download/${assetName}`;
      const archivePath = join(extensionDir, assetName);

      try {
        // ── Download ───────────────────────────────────────────────
        onProgress?.({
          name: 'xiaohongshu-mcp',
          phase: 'downloading',
          progress: 10,
          message: `Downloading ${assetName}...`,
        });
        logger.info(`Downloading xiaohongshu-mcp from ${downloadUrl}`);
        await downloadFile(downloadUrl, archivePath);

        // ── Extract ────────────────────────────────────────────────
        onProgress?.({
          name: 'xiaohongshu-mcp',
          phase: 'installing',
          progress: 50,
          message: 'Extracting archive...',
        });

        let extracted = false;

        if (platform === 'win32') {
          // Use PowerShell Expand-Archive for .zip
          const psResult = await spawnAsync(
            'powershell',
            [
              '-NoProfile',
              '-Command',
              `Expand-Archive -Path '${archivePath}' -DestinationPath '${extensionDir}' -Force`,
            ],
            { timeout: 60_000 }
          );
          extracted = psResult.code === 0;
          if (!extracted) {
            logger.error('PowerShell Expand-Archive failed:', psResult.stderr);
          }
        } else {
          // Use tar for .tar.gz
          const tarResult = await spawnAsync('tar', ['xzf', archivePath, '-C', extensionDir], {
            timeout: 60_000,
          });
          extracted = tarResult.code === 0;
          if (!extracted) {
            logger.error('tar extraction failed:', tarResult.stderr);
          }
        }

        if (!extracted) {
          // Clean up archive on failure
          try {
            unlinkSync(archivePath);
          } catch {
            /* non-fatal */
          }
          return {
            name: 'xiaohongshu-mcp',
            success: false,
            error: 'Failed to extract downloaded archive',
          };
        }

        // ── Rename platform-specific binary to generic name ──────
        onProgress?.({
          name: 'xiaohongshu-mcp',
          phase: 'installing',
          progress: 80,
          message: 'Finalizing installation...',
        });

        if (!existsSync(binaryPath)) {
          // Find the extracted binary (e.g. xiaohongshu-mcp-darwin-arm64, xiaohongshu-mcp-windows-amd64.exe)
          const files = readdirSync(extensionDir);
          const mcpBinary = files.find(
            (f) =>
              f.startsWith('xiaohongshu-mcp-') &&
              !f.endsWith('.tar.gz') &&
              !f.endsWith('.zip') &&
              !f.startsWith('xiaohongshu-login')
          );
          if (mcpBinary) {
            renameSync(join(extensionDir, mcpBinary), binaryPath);
            logger.info(`Renamed ${mcpBinary} → ${binaryName}`);
          }
        }

        // Set executable permission on non-Windows
        if (platform !== 'win32' && existsSync(binaryPath)) {
          chmodSync(binaryPath, 0o755);
        }

        // Also chmod the login tool if present
        if (platform !== 'win32') {
          const files = readdirSync(extensionDir);
          const loginBinary = files.find((f) => f.startsWith('xiaohongshu-login'));
          if (loginBinary) {
            try {
              chmodSync(join(extensionDir, loginBinary), 0o755);
            } catch {
              /* non-fatal */
            }
          }
        }

        // ── Clean up archive ───────────────────────────────────────
        try {
          unlinkSync(archivePath);
        } catch {
          /* non-fatal */
        }

        if (existsSync(binaryPath)) {
          onProgress?.({
            name: 'xiaohongshu-mcp',
            phase: 'done',
            progress: 100,
            message: 'Xiaohongshu MCP installed successfully',
          });
          logger.info(`xiaohongshu-mcp installed at ${binaryPath}`);
          return { name: 'xiaohongshu-mcp', success: true };
        }

        return {
          name: 'xiaohongshu-mcp',
          success: false,
          error: `Binary not found after extraction. Expected at: ${binaryPath}`,
        };
      } catch (err) {
        // Clean up on error
        try {
          unlinkSync(archivePath);
        } catch {
          /* non-fatal */
        }
        logger.error('xiaohongshu-mcp install failed:', err);
        return {
          name: 'xiaohongshu-mcp',
          success: false,
          error: `Download/install failed: ${String(err)}`,
        };
      }
    },

    async verify(): Promise<{ success: boolean; error?: string }> {
      if (!existsSync(binaryPath)) {
        return { success: false, error: `Binary not found: ${binaryPath}` };
      }
      const result = await spawnAsync(binaryPath, ['--help'], { timeout: 10_000 });
      // Accept exit code 0 or 1 (some CLI tools exit 1 for --help)
      return result.code <= 1
        ? { success: true }
        : { success: false, error: `Binary test failed with code ${result.code}` };
    },

    async start(options): Promise<{ success: boolean; pid?: number; error?: string }> {
      if (!existsSync(binaryPath)) {
        return { success: false, error: 'Binary not found' };
      }

      // Check if already running
      const running = await healthCheckHttp(defaultPort, '/health');
      if (running) {
        return { success: true };
      }

      // Kill any existing managed process
      if (serviceProcess && !serviceProcess.killed) {
        serviceProcess.kill('SIGTERM');
        serviceProcess = null;
      }

      const port = (options?.port as number) ?? defaultPort;

      return new Promise((resolve) => {
        try {
          // Pass explicit flags: -port for binding, -headless for production mode.
          // The Go binary also auto-downloads a headless browser (~150 MB) on first run,
          // so the health-check timeout below is generous.
          const child = spawn(binaryPath, [`-port`, `:${port}`, `-headless=true`], {
            cwd: extensionDir,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
            env: {
              ...process.env,
              PORT: String(port),
            },
          });

          serviceProcess = child;

          child.stdout?.on('data', (data: Buffer) => {
            logger.debug(`[xiaohongshu-mcp stdout] ${data.toString().trim()}`);
          });

          child.stderr?.on('data', (data: Buffer) => {
            logger.debug(`[xiaohongshu-mcp stderr] ${data.toString().trim()}`);
          });

          child.on('error', (err) => {
            logger.error('xiaohongshu-mcp spawn error:', err);
            serviceProcess = null;
            resolve({ success: false, error: err.message });
          });

          child.on('exit', (code, signal) => {
            logger.info(`xiaohongshu-mcp exited: code=${code}, signal=${signal}`);
            serviceProcess = null;
          });

          // First run downloads a headless browser (~150 MB), so allow up to 120 s.
          waitForHealth(port, 120_000, '/health')
            .then((healthy) => {
              if (healthy) {
                logger.info(`xiaohongshu-mcp started on port ${port} (PID: ${child.pid})`);
                resolve({ success: true, pid: child.pid });
              } else {
                // Don't kill — the process may still be downloading the browser
                // on first run.  Keep it alive so a subsequent health check can
                // succeed once the download finishes.
                logger.warn(
                  'xiaohongshu-mcp health check timed out (process kept alive, PID: ' +
                    child.pid +
                    '). It may still be downloading the headless browser.'
                );
                resolve({
                  success: false,
                  pid: child.pid,
                  error:
                    'Health check timed out — the service may still be starting ' +
                    '(first run downloads ~150 MB browser). Please retry in a minute.',
                });
              }
            })
            .catch((err) => {
              try {
                child.kill('SIGTERM');
              } catch {
                // non-fatal
              }
              serviceProcess = null;
              resolve({ success: false, error: String(err) });
            });
        } catch (err) {
          resolve({ success: false, error: String(err) });
        }
      });
    },

    async stop(): Promise<{ success: boolean; error?: string }> {
      if (!serviceProcess) {
        return { success: true };
      }
      try {
        serviceProcess.kill('SIGTERM');
        serviceProcess = null;
        logger.info('xiaohongshu-mcp stopped');
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },

    async healthCheck(): Promise<boolean> {
      return healthCheckHttp(defaultPort, '/health');
    },
  };
}

// ── Recipe: social-auto-upload ─────────────────────────────────────

function createSocialAutoUploadRecipe(): ExtensionRecipe {
  const extensionDir = join(EXTENSIONS_DIR, 'social-auto-upload');
  const venvDir = join(extensionDir, '.venv');
  const repoUrl = 'https://github.com/dreammis/social-auto-upload';

  return {
    name: 'social-auto-upload',
    displayName: 'Social Auto Upload',
    isService: false,

    async detect(): Promise<ExtensionCheckResult> {
      const hasDir = existsSync(extensionDir);
      const hasVenv = existsSync(venvDir);
      const hasUploader = existsSync(join(extensionDir, 'uploader'));
      return {
        name: 'social-auto-upload',
        ready: hasDir && hasVenv && hasUploader,
        installed: hasDir && hasUploader,
        message: !hasDir
          ? 'social-auto-upload not installed'
          : !hasUploader
            ? 'social-auto-upload directory found but missing uploader package'
            : !hasVenv
              ? 'social-auto-upload found but virtual environment not set up'
              : 'social-auto-upload is ready',
      };
    },

    async install(onProgress): Promise<ExtensionInstallResult> {
      try {
        ensureExtensionsDir();

        // Step 1: Clone or download the repository
        if (!existsSync(extensionDir)) {
          const hasGit = await isGitAvailable();

          if (hasGit) {
            onProgress?.({
              name: 'social-auto-upload',
              phase: 'cloning',
              progress: 10,
              message: 'Cloning repository...',
            });
            const cloneResult = await spawnAsync(
              'git',
              ['clone', '--depth', '1', repoUrl, extensionDir],
              {
                timeout: 120_000,
              }
            );
            if (cloneResult.code !== 0) {
              return {
                name: 'social-auto-upload',
                success: false,
                error: `git clone failed: ${cloneResult.stderr}`,
              };
            }
          } else {
            // Fallback: download ZIP
            onProgress?.({
              name: 'social-auto-upload',
              phase: 'downloading',
              progress: 10,
              message: 'Downloading repository...',
            });
            const zipPath = join(EXTENSIONS_DIR, 'social-auto-upload.zip');
            const zipUrl = `${repoUrl}/archive/refs/heads/main.zip`;

            await downloadFile(zipUrl, zipPath);

            onProgress?.({
              name: 'social-auto-upload',
              phase: 'extracting',
              progress: 25,
              message: 'Extracting...',
            });
            let extracted = false;

            // On Windows, use PowerShell Expand-Archive; elsewhere use unzip
            if (process.platform === 'win32') {
              const psResult = await spawnAsync(
                'powershell',
                [
                  '-NoProfile',
                  '-Command',
                  `Expand-Archive -Path '${zipPath}' -DestinationPath '${EXTENSIONS_DIR}' -Force`,
                ],
                { timeout: 120_000 }
              );
              extracted = psResult.code === 0;
            } else {
              const unzipResult = await spawnAsync('unzip', ['-o', zipPath, '-d', EXTENSIONS_DIR], {
                timeout: 60_000,
              });
              extracted = unzipResult.code === 0;
            }

            if (!extracted) {
              // Fallback: python zipfile module (cross-platform)
              const pyExtract = await spawnAsync('python3', [
                '-m',
                'zipfile',
                '-e',
                zipPath,
                EXTENSIONS_DIR,
              ]);
              if (pyExtract.code !== 0) {
                return {
                  name: 'social-auto-upload',
                  success: false,
                  error: 'Failed to extract ZIP',
                };
              }
            }

            // Rename extracted directory
            const { renameSync, unlinkSync } = await import('fs');
            const extractedDir = join(EXTENSIONS_DIR, 'social-auto-upload-main');
            if (existsSync(extractedDir) && !existsSync(extensionDir)) {
              renameSync(extractedDir, extensionDir);
            }

            // Clean up ZIP
            try {
              unlinkSync(zipPath);
            } catch {
              // non-fatal
            }
          }
        }

        // Step 2: Create venv with uv
        onProgress?.({
          name: 'social-auto-upload',
          phase: 'venv',
          progress: 40,
          message: 'Creating virtual environment...',
        });
        const uvBin = await getUvBin();
        const { getUvMirrorEnv } = await import('../utils/uv-env');
        const mirrorEnv = await getUvMirrorEnv();

        const venvResult = await spawnAsync(uvBin, ['venv', '.venv', '--python', '3.12'], {
          cwd: extensionDir,
          env: { ...process.env, ...mirrorEnv },
        });
        if (venvResult.code !== 0) {
          return {
            name: 'social-auto-upload',
            success: false,
            error: `venv creation failed: ${venvResult.stderr}`,
          };
        }

        // Step 3: Install Python dependencies
        onProgress?.({
          name: 'social-auto-upload',
          phase: 'pip-install',
          progress: 55,
          message: 'Installing Python dependencies...',
        });
        const pipResult = await spawnAsync(uvBin, ['pip', 'install', '-r', 'requirements.txt'], {
          cwd: extensionDir,
          env: { ...process.env, ...mirrorEnv, VIRTUAL_ENV: venvDir },
          timeout: 300_000, // 5 min for pip install
        });
        if (pipResult.code !== 0) {
          // Try installing with -e . as fallback
          const pipResult2 = await spawnAsync(uvBin, ['pip', 'install', '-e', '.'], {
            cwd: extensionDir,
            env: { ...process.env, ...mirrorEnv, VIRTUAL_ENV: venvDir },
            timeout: 300_000,
          });
          if (pipResult2.code !== 0) {
            return {
              name: 'social-auto-upload',
              success: false,
              error: `pip install failed: ${pipResult.stderr}`,
            };
          }
        }

        // Step 4: Install Playwright + Chromium
        onProgress?.({
          name: 'social-auto-upload',
          phase: 'playwright',
          progress: 75,
          message: 'Installing Playwright Chromium (~150MB)...',
        });
        const pythonBin = join(venvDir, process.platform === 'win32' ? 'Scripts' : 'bin', 'python');
        const playwrightResult = await spawnAsync(
          pythonBin,
          ['-m', 'playwright', 'install', 'chromium'],
          {
            cwd: extensionDir,
            env: { ...process.env, VIRTUAL_ENV: venvDir },
            timeout: 600_000, // 10 min for Chromium download
          }
        );
        if (playwrightResult.code !== 0) {
          logger.warn(`Playwright chromium install warning: ${playwrightResult.stderr}`);
          // Non-fatal — some systems have Playwright pre-installed
        }

        onProgress?.({
          name: 'social-auto-upload',
          phase: 'done',
          progress: 100,
          message: 'social-auto-upload installed',
        });
        return { name: 'social-auto-upload', success: true };
      } catch (err) {
        logger.error('social-auto-upload install failed:', err);
        return { name: 'social-auto-upload', success: false, error: String(err) };
      }
    },

    async verify(): Promise<{ success: boolean; error?: string }> {
      if (!existsSync(venvDir)) {
        return { success: false, error: 'Virtual environment not found' };
      }
      const pythonBin = join(venvDir, process.platform === 'win32' ? 'Scripts' : 'bin', 'python');
      const result = await spawnAsync(
        pythonBin,
        ['-c', 'from uploader.douyin_uploader.main import DouYinVideo'],
        {
          cwd: extensionDir,
          env: { ...process.env, VIRTUAL_ENV: venvDir },
          timeout: 15_000,
        }
      );
      return result.code === 0
        ? { success: true }
        : { success: false, error: `Import check failed: ${result.stderr}` };
    },
  };
}

// ── Recipe: playwright (meta) ──────────────────────────────────────

function createPlaywrightRecipe(): ExtensionRecipe {
  return {
    name: 'playwright',
    displayName: 'Playwright',
    isService: false,

    async detect(): Promise<ExtensionCheckResult> {
      // Delegate to social-auto-upload status
      const sauDir = join(EXTENSIONS_DIR, 'social-auto-upload');
      const venvDir = join(sauDir, '.venv');
      const hasVenv = existsSync(venvDir);

      if (!hasVenv) {
        return {
          name: 'playwright',
          ready: false,
          installed: false,
          message: 'Installed with social-auto-upload',
        };
      }

      // Check if playwright is importable
      const pythonBin = join(venvDir, process.platform === 'win32' ? 'Scripts' : 'bin', 'python');
      const result = await spawnAsync(pythonBin, ['-c', 'import playwright; print("ok")'], {
        cwd: sauDir,
        env: { ...process.env, VIRTUAL_ENV: venvDir },
        timeout: 10_000,
      });

      const ready = result.code === 0;
      return {
        name: 'playwright',
        ready,
        installed: ready,
        message: ready ? 'Playwright available' : 'Playwright not installed',
      };
    },

    async install(_onProgress): Promise<ExtensionInstallResult> {
      // Installed as part of social-auto-upload — pass-through
      return { name: 'playwright', success: true };
    },

    async verify(): Promise<{ success: boolean; error?: string }> {
      const checkResult = await this.detect();
      return checkResult.ready
        ? { success: true }
        : { success: false, error: 'Playwright not available' };
    },
  };
}

// ── ExtensionInstaller Class ───────────────────────────────────────

export class ExtensionInstaller {
  private recipes = new Map<string, ExtensionRecipe>();
  private installing = new Set<string>();

  constructor() {
    // Register built-in recipes
    const builtins = [
      createPython3Recipe(),
      createCamofoxRecipe(),
      createXiaohongshuMcpRecipe(),
      createSocialAutoUploadRecipe(),
      createPlaywrightRecipe(),
    ];
    for (const recipe of builtins) {
      this.recipes.set(recipe.name, recipe);
    }
  }

  /**
   * Get recipe metadata (for UI display)
   */
  getRecipe(name: string): ExtensionRecipe | undefined {
    return this.recipes.get(name);
  }

  /**
   * Batch-detect all required extensions
   */
  async checkAll(requires: string[]): Promise<Map<string, ExtensionCheckResult>> {
    const results = new Map<string, ExtensionCheckResult>();

    for (const name of requires) {
      const recipe = this.recipes.get(name);
      if (!recipe) {
        results.set(name, {
          name,
          ready: false,
          installed: false,
          message: `Unknown extension: ${name}`,
        });
        continue;
      }

      try {
        const result = await recipe.detect();
        results.set(name, result);
      } catch (err) {
        logger.error(`Extension detect failed for ${name}:`, err);
        results.set(name, {
          name,
          ready: false,
          installed: false,
          message: `Detection error: ${String(err)}`,
        });
      }
    }

    return results;
  }

  /**
   * Install a single extension by name
   */
  async install(
    name: string,
    onProgress?: (event: ExtensionProgressEvent) => void
  ): Promise<ExtensionInstallResult> {
    const recipe = this.recipes.get(name);
    if (!recipe) {
      return { name, success: false, error: `Unknown extension: ${name}` };
    }

    // Dedup concurrent installs
    if (this.installing.has(name)) {
      return { name, success: false, error: 'Installation already in progress' };
    }

    this.installing.add(name);
    try {
      logger.info(`Installing extension: ${name}`);
      const result = await recipe.install(onProgress);
      logger.info(`Extension ${name} install result: success=${result.success}`);
      return result;
    } catch (err) {
      logger.error(`Extension ${name} install error:`, err);
      return { name, success: false, error: String(err) };
    } finally {
      this.installing.delete(name);
    }
  }

  /**
   * Install all missing extensions from requires list
   */
  async installAll(
    requires: string[],
    onProgress?: (event: ExtensionProgressEvent) => void
  ): Promise<{ results: ExtensionInstallResult[]; allHandled: boolean }> {
    // First detect which ones are missing
    const checkResults = await this.checkAll(requires);
    const results: ExtensionInstallResult[] = [];

    for (const name of requires) {
      const check = checkResults.get(name);
      if (check?.ready) {
        results.push({ name, success: true });
        continue;
      }

      const result = await this.install(name, onProgress);
      results.push(result);
    }

    return {
      results,
      allHandled: results.every((r) => r.success || r.manualRequired),
    };
  }

  /**
   * Start a service extension
   */
  async start(
    name: string,
    options?: Record<string, unknown>
  ): Promise<{ success: boolean; pid?: number; error?: string }> {
    const recipe = this.recipes.get(name);
    if (!recipe) {
      return { success: false, error: `Unknown extension: ${name}` };
    }
    if (!recipe.isService || !recipe.start) {
      return { success: false, error: `${name} is not a service extension` };
    }
    return recipe.start(options);
  }

  /**
   * Stop a service extension
   */
  async stop(name: string): Promise<{ success: boolean; error?: string }> {
    const recipe = this.recipes.get(name);
    if (!recipe) {
      return { success: false, error: `Unknown extension: ${name}` };
    }
    if (!recipe.isService || !recipe.stop) {
      return { success: false, error: `${name} is not a service extension` };
    }
    return recipe.stop();
  }

  /**
   * Health check for a service extension
   */
  async health(name: string): Promise<boolean> {
    const recipe = this.recipes.get(name);
    if (!recipe?.healthCheck) return false;
    return recipe.healthCheck();
  }

  /**
   * Clean up all managed child processes on app quit
   */
  destroy(): void {
    logger.info('ExtensionInstaller destroying — cleaning up child processes');
    for (const [name, recipe] of this.recipes) {
      if (recipe.isService && recipe.stop) {
        recipe.stop().catch((err) => {
          logger.warn(`Failed to stop ${name} on destroy:`, err);
        });
      }
    }
  }
}

// ── Singleton ──────────────────────────────────────────────────────

let _instance: ExtensionInstaller | null = null;

/**
 * Get the singleton ExtensionInstaller instance
 */
export function getExtensionInstaller(): ExtensionInstaller {
  if (!_instance) {
    _instance = new ExtensionInstaller();
  }
  return _instance;
}
