// @vitest-environment node

/**
 * ExtensionInstaller Tests
 * Tests recipe registration, detection, installation, service lifecycle, and cleanup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (available inside vi.mock factories) ──────────

const {
  mockIsPythonReady,
  mockCheckUvInstalled,
  mockInstallUv,
  mockSetupManagedPython,
  mockCamofoxDetect,
  mockCamofoxInstallDeps,
  mockCamofoxStart,
  mockCamofoxStop,
  mockExistsSync,
  mockMkdirSync,
  mockCreateWriteStream,
  mockRenameSync,
  mockReaddirSync,
  mockUnlinkSync,
  mockChmodSync,
  mockHttpGet,
} = vi.hoisted(() => ({
  mockIsPythonReady: vi.fn(),
  mockCheckUvInstalled: vi.fn(),
  mockInstallUv: vi.fn(),
  mockSetupManagedPython: vi.fn(),
  mockCamofoxDetect: vi.fn(),
  mockCamofoxInstallDeps: vi.fn(),
  mockCamofoxStart: vi.fn(),
  mockCamofoxStop: vi.fn(),
  mockExistsSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockCreateWriteStream: vi.fn().mockReturnValue({
    on: vi.fn(),
    close: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
  }),
  mockHttpGet: vi.fn(),
  mockRenameSync: vi.fn(),
  mockReaddirSync: vi.fn().mockReturnValue([]),
  mockUnlinkSync: vi.fn(),
  mockChmodSync: vi.fn(),
}));

// ── Module mocks ─────────────────────────────────────────────────

vi.mock('../../../electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  app: { isPackaged: false },
}));

vi.mock('../../../electron/utils/uv-setup', () => ({
  isPythonReady: (...args: unknown[]) => mockIsPythonReady(...args),
  checkUvInstalled: (...args: unknown[]) => mockCheckUvInstalled(...args),
  installUv: (...args: unknown[]) => mockInstallUv(...args),
  setupManagedPython: (...args: unknown[]) => mockSetupManagedPython(...args),
}));

vi.mock('../../../electron/utils/uv-env', () => ({
  getUvMirrorEnv: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../electron/engine/camofox-launcher', () => ({
  getCamofoxLauncher: () => ({
    detect: mockCamofoxDetect,
    installDeps: mockCamofoxInstallDeps,
    start: mockCamofoxStart,
    stop: mockCamofoxStop,
  }),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const mocked = {
    ...actual,
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
    createWriteStream: (...args: unknown[]) => mockCreateWriteStream(...args),
    renameSync: (...args: unknown[]) => mockRenameSync(...args),
    readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
    unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
    chmodSync: (...args: unknown[]) => mockChmodSync(...args),
  };
  return { ...mocked, default: mocked };
});

// Mock https/http to prevent real network requests from downloadFile().
// downloadFile uses dynamic `await import('https')` so we must mock the module.
function createMockHttpModule() {
  return {
    get: vi.fn((_url: string, cb: (res: unknown) => void) => {
      // Simulate a failed response so download paths return errors gracefully
      const mockResponse = {
        statusCode: 500,
        headers: {},
        on: vi.fn(),
        pipe: vi.fn(),
      };
      // Fire callback on next tick to mimic async behavior
      setTimeout(() => cb(mockResponse), 5);
      const request = {
        on: vi.fn(),
        setTimeout: vi.fn(),
        destroy: vi.fn(),
      };
      return request;
    }),
  };
}

vi.mock('https', () => {
  const mod = createMockHttpModule();
  return { ...mod, default: mod };
});

vi.mock('http', () => {
  const mod = createMockHttpModule();
  return { ...mod, default: mod };
});

// Mock child_process — spawn is used by spawnAsync helper.
// We mock it to immediately emit 'exit' with code 0 by default.
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const mockSpawn = vi.fn().mockImplementation(() => {
    const child = {
      stdout: {
        on: vi.fn(),
      },
      stderr: {
        on: vi.fn(),
      },
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        // Auto-fire 'exit' with code 0 on next tick
        if (event === 'exit') {
          setTimeout(() => cb(0, null), 5);
        }
      }),
      killed: false,
      kill: vi.fn(),
      pid: 12345,
      exitCode: null,
    };
    return child;
  });

  return { ...actual, spawn: mockSpawn, default: { ...actual, spawn: mockSpawn } };
});

// Mock global fetch for health checks
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Import after mocks ────────────────────────────────────────────

import {
  ExtensionInstaller,
  getExtensionInstaller,
} from '../../../electron/engine/extension-installer';

// ── Tests ──────────────────────────────────────────────────────────

describe('ExtensionInstaller', () => {
  let installer: ExtensionInstaller;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockFetch.mockRejectedValue(new Error('fetch error'));
    // Return a mock writable stream from createWriteStream to prevent pipe() errors
    mockCreateWriteStream.mockReturnValue({
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'finish') setTimeout(cb, 5);
      }),
      close: vi.fn(),
      end: vi.fn(),
      write: vi.fn(),
    });
    installer = new ExtensionInstaller();
  });

  // ── Recipe Registration ────────────────────────────────────────

  describe('recipe registration', () => {
    it('should register 5 built-in recipes', () => {
      expect(installer.getRecipe('python3')).toBeDefined();
      expect(installer.getRecipe('camofox')).toBeDefined();
      expect(installer.getRecipe('xiaohongshu-mcp')).toBeDefined();
      expect(installer.getRecipe('social-auto-upload')).toBeDefined();
      expect(installer.getRecipe('playwright')).toBeDefined();
    });

    it('should return undefined for unknown recipe', () => {
      expect(installer.getRecipe('nonexistent')).toBeUndefined();
    });

    it('should have correct isService flag for service recipes', () => {
      expect(installer.getRecipe('camofox')!.isService).toBe(true);
      expect(installer.getRecipe('xiaohongshu-mcp')!.isService).toBe(true);
      expect(installer.getRecipe('python3')!.isService).toBe(false);
      expect(installer.getRecipe('social-auto-upload')!.isService).toBe(false);
      expect(installer.getRecipe('playwright')!.isService).toBe(false);
    });

    it('should have default ports for service recipes', () => {
      expect(installer.getRecipe('camofox')!.defaultPort).toBe(9377);
      expect(installer.getRecipe('xiaohongshu-mcp')!.defaultPort).toBe(18060);
    });
  });

  // ── python3 Recipe ─────────────────────────────────────────────

  describe('python3 recipe', () => {
    it('should detect ready when Python 3.12 is available', async () => {
      mockIsPythonReady.mockResolvedValue(true);

      const result = await installer.getRecipe('python3')!.detect();

      expect(result.name).toBe('python3');
      expect(result.ready).toBe(true);
      expect(result.installed).toBe(true);
      expect(result.message).toContain('available');
    });

    it('should detect not ready when Python 3.12 is missing', async () => {
      mockIsPythonReady.mockResolvedValue(false);

      const result = await installer.getRecipe('python3')!.detect();

      expect(result.ready).toBe(false);
      expect(result.installed).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should install Python 3.12 via uv', async () => {
      mockCheckUvInstalled.mockResolvedValue(true);
      mockSetupManagedPython.mockResolvedValue(undefined);

      const onProgress = vi.fn();
      const result = await installer.getRecipe('python3')!.install(onProgress);

      expect(result.success).toBe(true);
      expect(result.name).toBe('python3');
      expect(mockSetupManagedPython).toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'python3', phase: 'done', progress: 100 })
      );
    });

    it('should install uv first if not available', async () => {
      mockCheckUvInstalled.mockResolvedValue(false);
      mockInstallUv.mockResolvedValue(undefined);
      mockSetupManagedPython.mockResolvedValue(undefined);

      const onProgress = vi.fn();
      await installer.getRecipe('python3')!.install(onProgress);

      expect(mockInstallUv).toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'installing-uv' }));
    });

    it('should return failure when install throws', async () => {
      mockCheckUvInstalled.mockResolvedValue(true);
      mockSetupManagedPython.mockRejectedValue(new Error('install failed'));

      const result = await installer.getRecipe('python3')!.install();

      expect(result.success).toBe(false);
      expect(result.error).toContain('install failed');
    });

    it('should verify via isPythonReady', async () => {
      mockIsPythonReady.mockResolvedValue(true);
      const result = await installer.getRecipe('python3')!.verify();
      expect(result.success).toBe(true);
    });

    it('should fail verify when Python not found', async () => {
      mockIsPythonReady.mockResolvedValue(false);
      const result = await installer.getRecipe('python3')!.verify();
      expect(result.success).toBe(false);
    });
  });

  // ── camofox Recipe ─────────────────────────────────────────────

  describe('camofox recipe', () => {
    it('should delegate detect to CamofoxLauncher', async () => {
      mockCamofoxDetect.mockReturnValue({
        installed: true,
        depsInstalled: true,
        hasEntryPoint: true,
        path: '/some/path',
        message: 'Camofox ready',
      });
      mockFetch.mockResolvedValue({ ok: false });

      const result = await installer.getRecipe('camofox')!.detect();

      expect(result.name).toBe('camofox');
      expect(result.installed).toBe(true);
      expect(result.ready).toBe(true);
      expect(mockCamofoxDetect).toHaveBeenCalled();
    });

    it('should report not installed when CamofoxLauncher says not installed', async () => {
      mockCamofoxDetect.mockReturnValue({
        installed: false,
        message: 'Camofox not found',
      });
      mockFetch.mockRejectedValue(new Error('connection refused'));

      const result = await installer.getRecipe('camofox')!.detect();

      expect(result.installed).toBe(false);
      expect(result.ready).toBe(false);
    });

    it('should return manualRequired when camofox not installed', async () => {
      mockCamofoxDetect.mockReturnValue({ installed: false, message: 'Not found' });
      // Allow git clone path to succeed (package.json exists after "clone")
      // but re-detect still returns not installed → manualRequired
      mockExistsSync.mockImplementation((path: unknown) => {
        return String(path).includes('package.json');
      });

      const result = await installer.getRecipe('camofox')!.install();

      expect(result.success).toBe(false);
      expect(result.manualRequired).toBe(true);
    });

    it('should install deps when camofox found but deps missing', async () => {
      mockCamofoxDetect.mockReturnValue({
        installed: true,
        depsInstalled: false,
        hasEntryPoint: true,
        path: '/camofox',
        message: 'Deps missing',
      });
      mockCamofoxInstallDeps.mockResolvedValue({ success: true });

      const onProgress = vi.fn();
      const result = await installer.getRecipe('camofox')!.install(onProgress);

      expect(result.success).toBe(true);
      expect(mockCamofoxInstallDeps).toHaveBeenCalledWith('/camofox');
    });

    it('should delegate start to CamofoxLauncher', async () => {
      mockCamofoxStart.mockResolvedValue({ success: true, pid: 999 });

      const result = await installer.getRecipe('camofox')!.start!({ port: 9377, apiKey: 'test' });

      expect(result.success).toBe(true);
      expect(mockCamofoxStart).toHaveBeenCalledWith(9377, 'test');
    });

    it('should delegate stop to CamofoxLauncher', async () => {
      mockCamofoxStop.mockReturnValue({ success: true });

      const result = await installer.getRecipe('camofox')!.stop!();

      expect(result.success).toBe(true);
      expect(mockCamofoxStop).toHaveBeenCalled();
    });
  });

  // ── xiaohongshu-mcp Recipe ─────────────────────────────────────

  describe('xiaohongshu-mcp recipe', () => {
    it('should detect ready when binary exists', async () => {
      mockExistsSync.mockImplementation((path: unknown) => {
        return String(path).includes('xiaohongshu-mcp');
      });
      mockFetch.mockRejectedValue(new Error('not running'));

      const result = await installer.getRecipe('xiaohongshu-mcp')!.detect();

      expect(result.name).toBe('xiaohongshu-mcp');
      expect(result.ready).toBe(true);
      expect(result.installed).toBe(true);
    });

    it('should detect not ready when binary missing and service not running', async () => {
      mockExistsSync.mockReturnValue(false);
      mockFetch.mockRejectedValue(new Error('not running'));

      const result = await installer.getRecipe('xiaohongshu-mcp')!.detect();

      expect(result.ready).toBe(false);
      expect(result.installed).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should detect running even without binary', async () => {
      mockExistsSync.mockReturnValue(false);
      mockFetch.mockResolvedValue({ ok: true });

      const result = await installer.getRecipe('xiaohongshu-mcp')!.detect();

      expect(result.ready).toBe(true);
      expect(result.running).toBe(true);
    });

    it('should attempt auto-download when binary not found', async () => {
      // existsSync returns false for everything → triggers download path
      mockExistsSync.mockReturnValue(false);

      const result = await installer.getRecipe('xiaohongshu-mcp')!.install();

      // Download will fail in test env (no real network), so we expect a failure
      // but NOT manualRequired — it should attempt the download first
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return manualRequired for unsupported platform', async () => {
      mockExistsSync.mockReturnValue(false);

      // Save originals
      const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      const origArch = Object.getOwnPropertyDescriptor(process, 'arch');

      // Simulate unsupported platform
      Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });
      Object.defineProperty(process, 'arch', { value: 'mips', configurable: true });

      // Need a fresh installer to pick up the new platform values
      const freshInstaller = new ExtensionInstaller();
      const result = await freshInstaller.getRecipe('xiaohongshu-mcp')!.install();

      expect(result.success).toBe(false);
      expect(result.manualRequired).toBe(true);
      expect(result.error).toContain('Unsupported platform');

      // Restore
      if (origPlatform) Object.defineProperty(process, 'platform', origPlatform);
      if (origArch) Object.defineProperty(process, 'arch', origArch);
    });

    it('should succeed install when binary already exists', async () => {
      mockExistsSync.mockImplementation((path: unknown) => {
        return String(path).includes('xiaohongshu-mcp');
      });

      const result = await installer.getRecipe('xiaohongshu-mcp')!.install();

      expect(result.success).toBe(true);
    });
  });

  // ── social-auto-upload Recipe ──────────────────────────────────

  describe('social-auto-upload recipe', () => {
    it('should detect ready when dir + venv + uploader all exist', async () => {
      mockExistsSync.mockImplementation((path: unknown) => {
        const p = String(path);
        return (
          p.includes('social-auto-upload') &&
          (p.endsWith('social-auto-upload') || p.includes('.venv') || p.includes('uploader'))
        );
      });

      const result = await installer.getRecipe('social-auto-upload')!.detect();

      expect(result.ready).toBe(true);
      expect(result.installed).toBe(true);
    });

    it('should detect installed but not ready when venv missing', async () => {
      mockExistsSync.mockImplementation((path: unknown) => {
        const p = String(path);
        if (p.includes('.venv')) return false;
        return p.includes('social-auto-upload');
      });

      const result = await installer.getRecipe('social-auto-upload')!.detect();

      expect(result.installed).toBe(true);
      expect(result.ready).toBe(false);
      expect(result.message).toContain('virtual environment');
    });

    it('should detect not installed when dir missing', async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await installer.getRecipe('social-auto-upload')!.detect();

      expect(result.installed).toBe(false);
      expect(result.ready).toBe(false);
    });
  });

  // ── playwright Recipe (meta) ───────────────────────────────────

  describe('playwright recipe', () => {
    it('should detect not ready when social-auto-upload venv missing', async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await installer.getRecipe('playwright')!.detect();

      expect(result.ready).toBe(false);
      expect(result.installed).toBe(false);
    });

    it('should install as pass-through (always succeeds)', async () => {
      const result = await installer.getRecipe('playwright')!.install();

      expect(result.success).toBe(true);
      expect(result.name).toBe('playwright');
    });
  });

  // ── checkAll ───────────────────────────────────────────────────

  describe('checkAll', () => {
    it('should batch-detect all required extensions', async () => {
      mockIsPythonReady.mockResolvedValue(true);
      mockCamofoxDetect.mockReturnValue({
        installed: true,
        depsInstalled: true,
        hasEntryPoint: true,
        message: 'ready',
      });
      mockFetch.mockRejectedValue(new Error('not running'));

      const results = await installer.checkAll(['python3', 'camofox']);

      expect(results.size).toBe(2);
      expect(results.get('python3')!.ready).toBe(true);
      expect(results.get('camofox')!.ready).toBe(true);
    });

    it('should gracefully handle unknown recipes', async () => {
      const results = await installer.checkAll(['nonexistent-extension']);

      expect(results.size).toBe(1);
      const result = results.get('nonexistent-extension')!;
      expect(result.ready).toBe(false);
      expect(result.message).toContain('Unknown extension');
    });

    it('should handle detection errors gracefully', async () => {
      mockIsPythonReady.mockRejectedValue(new Error('detection crash'));

      const results = await installer.checkAll(['python3']);

      expect(results.size).toBe(1);
      expect(results.get('python3')!.ready).toBe(false);
      expect(results.get('python3')!.message).toContain('Detection error');
    });

    it('should return empty map for empty requires', async () => {
      const results = await installer.checkAll([]);
      expect(results.size).toBe(0);
    });
  });

  // ── install ────────────────────────────────────────────────────

  describe('install', () => {
    it('should return error for unknown extension', async () => {
      const result = await installer.install('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown extension');
    });

    it('should deduplicate concurrent installs', async () => {
      mockCheckUvInstalled.mockResolvedValue(true);
      mockSetupManagedPython.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 50))
      );

      const [result1, result2] = await Promise.all([
        installer.install('python3'),
        installer.install('python3'),
      ]);

      // One succeeds, one gets dedup error
      const successes = [result1, result2].filter((r) => r.success);
      const deduped = [result1, result2].filter(
        (r) => !r.success && r.error?.includes('already in progress')
      );

      expect(successes.length + deduped.length).toBe(2);
      expect(deduped.length).toBe(1);
    });
  });

  // ── installAll ─────────────────────────────────────────────────

  describe('installAll', () => {
    it('should skip already-ready extensions', async () => {
      mockIsPythonReady.mockResolvedValue(true);
      mockCamofoxDetect.mockReturnValue({
        installed: false,
        message: 'Not found',
      });
      mockFetch.mockRejectedValue(new Error('not running'));
      // Allow git clone path to succeed for camofox install
      mockExistsSync.mockImplementation((path: unknown) => {
        return String(path).includes('package.json');
      });

      const onProgress = vi.fn();
      const result = await installer.installAll(['python3', 'camofox'], onProgress);

      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toEqual({ name: 'python3', success: true });
      // camofox will fail with manualRequired since re-detect still shows not installed
      expect(result.results[1].manualRequired).toBe(true);
    });

    it('should report allHandled when all succeed or manualRequired', async () => {
      mockIsPythonReady.mockResolvedValue(true);

      const result = await installer.installAll(['python3']);

      expect(result.allHandled).toBe(true);
    });
  });

  // ── Service start/stop ─────────────────────────────────────────

  describe('service lifecycle', () => {
    it('should reject start for non-service extensions', async () => {
      const result = await installer.start('python3');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not a service');
    });

    it('should reject stop for non-service extensions', async () => {
      const result = await installer.stop('python3');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not a service');
    });

    it('should return error for unknown extension start', async () => {
      const result = await installer.start('unknown');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown');
    });

    it('should return error for unknown extension stop', async () => {
      const result = await installer.stop('unknown');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown');
    });
  });

  // ── Health check ───────────────────────────────────────────────

  describe('health', () => {
    it('should return false for non-service extensions', async () => {
      const result = await installer.health('python3');
      expect(result).toBe(false);
    });

    it('should return false for unknown extension', async () => {
      const result = await installer.health('unknown');
      expect(result).toBe(false);
    });

    it('should delegate to recipe healthCheck for camofox', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const result = await installer.health('camofox');
      expect(result).toBe(true);
    });

    it('should return false when health check fails', async () => {
      mockFetch.mockRejectedValue(new Error('connection refused'));

      const result = await installer.health('camofox');
      expect(result).toBe(false);
    });
  });

  // ── destroy ────────────────────────────────────────────────────

  describe('destroy', () => {
    it('should call stop on all service recipes without throwing', () => {
      expect(() => installer.destroy()).not.toThrow();
    });
  });

  // ── Singleton ──────────────────────────────────────────────────

  describe('getExtensionInstaller', () => {
    it('should return the same instance', () => {
      const inst1 = getExtensionInstaller();
      const inst2 = getExtensionInstaller();
      expect(inst1).toBe(inst2);
    });
  });
});
