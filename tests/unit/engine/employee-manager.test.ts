/**
 * EmployeeManager Tests (Scan-based discovery)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron-store (ESM dynamic import)
vi.mock('electron-store', () => {
  const MockStore = vi.fn().mockImplementation(() => ({
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
  }));
  return { default: MockStore };
});

vi.mock('../../../electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../electron/utils/paths', () => ({
  getOpenClawSkillsDir: vi.fn().mockReturnValue('/tmp/.openclaw/skills'),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}));

// Mock fs to simulate skill directories (CJS module needs explicit default export)
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const mocked = {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readdirSync: vi.fn().mockReturnValue([]),
    cpSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
  return { ...mocked, default: mocked };
});

const mockManifest = {
  name: 'seo-expert',
  version: '1.0.0',
  description: 'SEO Expert',
  type: 'knowledge' as const,
  employee: {
    role: 'SEO Expert',
    roleZh: 'SEO 专家',
    avatar: '🔍',
    team: 'Marketing',
    personality: { style: 'analytical', greeting: 'Hello!' },
  },
  skills: [{ id: 'seo-audit', name: 'SEO Audit', prompt: 'Audit' }],
};

const { mockParseFromPath } = vi.hoisted(() => ({
  mockParseFromPath: vi.fn(),
}));

vi.mock('../../../electron/engine/manifest-parser', () => {
  class MockManifestParser {
    parseFromPath = mockParseFromPath;
  }
  return { ManifestParser: MockManifestParser };
});

vi.mock('../../../electron/engine/compiler', () => {
  class MockSkillCompiler {
    compile = vi.fn().mockReturnValue('You are SEO Expert...');
  }
  return { SkillCompiler: MockSkillCompiler };
});

import { existsSync, readdirSync } from 'node:fs';
import { EmployeeManager } from '../../../electron/engine/employee-manager';

/**
 * Helper: set up fs mocks so scan() discovers one skill directory
 */
function setupScanMocks() {
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readdirSync).mockReturnValue([
    { name: 'seo-expert', isDirectory: () => true },
  ] as unknown as ReturnType<typeof readdirSync>);
}

describe('EmployeeManager', () => {
  let manager: EmployeeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no directories exist
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([]);
    mockParseFromPath.mockReturnValue(mockManifest);
    manager = new EmployeeManager();
  });

  describe('scan', () => {
    it('should discover employees from skill directories', async () => {
      setupScanMocks();

      const employees = await manager.scan();

      expect(employees).toHaveLength(1);
      expect(employees[0].slug).toBe('seo-expert');
      expect(employees[0].id).toBe('seo-expert');
      expect(employees[0].role).toBe('SEO Expert');
      expect(employees[0].roleZh).toBe('SEO 专家');
      expect(employees[0].team).toBe('Marketing');
      expect(employees[0].status).toBe('offline');
    });

    it('should return empty list when no skill directories exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const employees = await manager.scan();
      expect(employees).toHaveLength(0);
    });
  });

  describe('list', () => {
    it('should return all employees', async () => {
      setupScanMocks();
      await manager.scan();

      const all = manager.list();
      expect(all).toHaveLength(1);
    });

    it('should filter by status', async () => {
      setupScanMocks();
      await manager.scan();

      const offline = manager.list('offline');
      expect(offline).toHaveLength(1);

      const idle = manager.list('idle');
      expect(idle).toHaveLength(0);
    });
  });

  describe('get', () => {
    it('should return employee by slug', async () => {
      setupScanMocks();
      await manager.scan();

      const found = manager.get('seo-expert');
      expect(found).toBeDefined();
      expect(found?.slug).toBe('seo-expert');
    });

    it('should return undefined for unknown slug', () => {
      expect(manager.get('nonexistent')).toBeUndefined();
    });
  });

  describe('activate', () => {
    it('should generate a session key and set status to idle', async () => {
      setupScanMocks();
      await manager.scan();

      const activated = await manager.activate('seo-expert');

      expect(activated.status).toBe('idle');
      expect(activated.gatewaySessionKey).toBe('agent:main:employee-seo-expert');
    });

    it('should throw for non-existent employee', async () => {
      await expect(manager.activate('nonexistent')).rejects.toThrow('Employee not found');
    });
  });

  describe('deactivate', () => {
    it('should clear session key and set status to offline', async () => {
      setupScanMocks();
      await manager.scan();
      await manager.activate('seo-expert');

      const deactivated = manager.deactivate('seo-expert');

      expect(deactivated.status).toBe('offline');
      expect(deactivated.gatewaySessionKey).toBeUndefined();
    });
  });

  describe('state machine', () => {
    it('should transition idle -> working via assignTask', async () => {
      setupScanMocks();
      await manager.scan();
      await manager.activate('seo-expert');

      expect(manager.getStatus('seo-expert')).toBe('idle');

      manager.assignTask('seo-expert');
      expect(manager.getStatus('seo-expert')).toBe('working');
    });

    it('should transition working -> idle via completeTask', async () => {
      setupScanMocks();
      await manager.scan();
      await manager.activate('seo-expert');
      manager.assignTask('seo-expert');

      expect(manager.getStatus('seo-expert')).toBe('working');

      manager.completeTask('seo-expert');
      expect(manager.getStatus('seo-expert')).toBe('idle');
    });

    it('should not assign task when not idle', async () => {
      setupScanMocks();
      await manager.scan();
      // Status is 'offline', not 'idle'
      manager.assignTask('seo-expert');
      expect(manager.getStatus('seo-expert')).toBe('offline');
    });

    it('should allow markBlocked and markError', async () => {
      setupScanMocks();
      await manager.scan();
      await manager.activate('seo-expert');

      manager.markBlocked('seo-expert');
      expect(manager.getStatus('seo-expert')).toBe('blocked');

      manager.markError('seo-expert');
      expect(manager.getStatus('seo-expert')).toBe('error');
    });

    it('should emit status events on transitions', async () => {
      const statusSpy = vi.fn();
      manager.on('status', statusSpy);

      setupScanMocks();
      await manager.scan();
      await manager.activate('seo-expert');

      expect(statusSpy).toHaveBeenCalledWith('seo-expert', 'idle');
    });
  });

  describe('getStatus', () => {
    it('should return offline for unknown employee', () => {
      expect(manager.getStatus('nonexistent')).toBe('offline');
    });
  });

  describe('checkRuntimeRequirements', () => {
    // Mock extension-installer (dynamic import inside the method)
    const mockCheckAll = vi.fn();

    beforeEach(() => {
      vi.doMock('../../../electron/engine/extension-installer', () => ({
        getExtensionInstaller: () => ({
          checkAll: mockCheckAll,
        }),
      }));
    });

    it('should return satisfied when manifest has no requires', async () => {
      setupScanMocks();
      // Manifest without runtime.requires
      mockParseFromPath.mockReturnValue({
        ...mockManifest,
        capabilities: { inputs: [], outputs: [] },
      });
      await manager.scan();

      const result = await manager.checkRuntimeRequirements('seo-expert');

      expect(result.satisfied).toBe(true);
      expect(result.missing).toHaveLength(0);
      expect(result.requires).toHaveLength(0);
    });

    it('should return satisfied when all extensions are ready', async () => {
      setupScanMocks();
      mockParseFromPath.mockReturnValue({
        ...mockManifest,
        capabilities: { inputs: [], outputs: [], runtime: { requires: ['python3'] } },
      });
      await manager.scan();

      mockCheckAll.mockResolvedValue(
        new Map([['python3', { name: 'python3', ready: true, installed: true, message: 'ok' }]])
      );

      const result = await manager.checkRuntimeRequirements('seo-expert');

      expect(result.satisfied).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('should return missing list when extensions are not ready', async () => {
      setupScanMocks();
      mockParseFromPath.mockReturnValue({
        ...mockManifest,
        capabilities: {
          inputs: [],
          outputs: [],
          runtime: { requires: ['python3', 'camofox'] },
        },
      });
      await manager.scan();

      mockCheckAll.mockResolvedValue(
        new Map([
          ['python3', { name: 'python3', ready: true, installed: true, message: 'ok' }],
          ['camofox', { name: 'camofox', ready: false, installed: false, message: 'not found' }],
        ])
      );

      const result = await manager.checkRuntimeRequirements('seo-expert');

      expect(result.satisfied).toBe(false);
      expect(result.missing).toHaveLength(1);
      expect(result.missing[0].name).toBe('camofox');
      expect(result.missing[0].status).toBe('not-installed');
      expect(result.requires).toEqual(['python3', 'camofox']);
    });

    it('should throw for non-existent employee', async () => {
      await expect(manager.checkRuntimeRequirements('nonexistent')).rejects.toThrow(
        'Employee not found'
      );
    });
  });

  describe('scan with all employees', () => {
    const employeeManifests: Record<string, typeof mockManifest> = {
      supervisor: {
        ...mockManifest,
        name: 'supervisor',
        employee: { ...mockManifest.employee, role: 'Supervisor', roleZh: '主管', team: 'management' },
      },
      'new-media': {
        ...mockManifest,
        name: 'new-media',
        type: 'knowledge' as const,
        employee: {
          ...mockManifest.employee,
          role: 'Content Creator',
          roleZh: '内容策划师',
          team: 'marketing',
        },
      },
      'reddit-nurture': {
        ...mockManifest,
        name: 'reddit-nurture',
        type: 'execution' as const,
        employee: {
          ...mockManifest.employee,
          role: 'Reddit Growth Specialist',
          roleZh: 'Reddit 养号专家',
          team: 'growth',
        },
      },
      'publisher-xhs': {
        ...mockManifest,
        name: 'publisher-xhs',
        type: 'execution' as const,
        employee: {
          ...mockManifest.employee,
          role: 'Xiaohongshu Publisher',
          roleZh: '小红书发布专员',
          team: 'publishing',
        },
      },
      'publisher-douyin': {
        ...mockManifest,
        name: 'publisher-douyin',
        type: 'execution' as const,
        employee: {
          ...mockManifest.employee,
          role: 'Douyin Publisher',
          roleZh: '抖音发布专员',
          team: 'publishing',
        },
      },
      researcher: {
        ...mockManifest,
        name: 'researcher',
        type: 'knowledge' as const,
        employee: {
          ...mockManifest.employee,
          role: 'Research Analyst',
          roleZh: '研究员',
          team: 'research',
        },
      },
    };

    function setupMultiEmployeeScan() {
      vi.mocked(existsSync).mockReturnValue(true);
      // Only the builtin dir returns entries; marketplace dir returns empty
      vi.mocked(readdirSync).mockImplementation((dirPath: unknown) => {
        const p = String(dirPath);
        if (p.includes('employees') || p.includes('resources')) {
          return [
            { name: 'supervisor', isDirectory: () => true },
            { name: 'new-media', isDirectory: () => true },
            { name: 'reddit-nurture', isDirectory: () => true },
            { name: 'publisher-xhs', isDirectory: () => true },
            { name: 'publisher-douyin', isDirectory: () => true },
            { name: 'researcher', isDirectory: () => true },
          ] as unknown as ReturnType<typeof readdirSync>;
        }
        return [] as unknown as ReturnType<typeof readdirSync>;
      });

      // Dynamic mock: return correct manifest per directory
      mockParseFromPath.mockImplementation((skillDir: string) => {
        const dirName = skillDir.split('/').pop() || '';
        return employeeManifests[dirName] || mockManifest;
      });
    }

    it('should discover 6 employees after adding new ones', async () => {
      setupMultiEmployeeScan();

      const employees = await manager.scan();

      expect(employees).toHaveLength(6);
      const slugs = employees.map((e) => e.slug);
      expect(slugs).toContain('supervisor');
      expect(slugs).toContain('new-media');
      expect(slugs).toContain('reddit-nurture');
      expect(slugs).toContain('publisher-xhs');
      expect(slugs).toContain('publisher-douyin');
      expect(slugs).toContain('researcher');
    });

    it('should assign correct team for each employee via manifest', async () => {
      setupMultiEmployeeScan();

      const employees = await manager.scan();

      expect(employees).toHaveLength(6);
      const teamMap = new Map(employees.map((e) => [e.slug, e.team]));
      expect(teamMap.get('supervisor')).toBe('management');
      expect(teamMap.get('new-media')).toBe('marketing');
      expect(teamMap.get('reddit-nurture')).toBe('growth');
      expect(teamMap.get('publisher-xhs')).toBe('publishing');
      expect(teamMap.get('publisher-douyin')).toBe('publishing');
      expect(teamMap.get('researcher')).toBe('research');
    });
  });
});
