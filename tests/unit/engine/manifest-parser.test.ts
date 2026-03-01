// @vitest-environment node

/**
 * ManifestParser Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReadFileSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
}));

vi.mock(import('node:fs'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...actual, readFileSync: mockReadFileSync },
    readFileSync: mockReadFileSync,
  };
});

vi.mock('../../../electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { ManifestParser } from '../../../electron/engine/manifest-parser';

const validManifest = {
  name: 'seo-expert',
  version: '1.0.0',
  description: 'An SEO analysis expert',
  type: 'knowledge',
  employee: {
    role: 'SEO Expert',
    roleZh: 'SEO 专家',
    avatar: '🔍',
    team: 'Marketing',
    personality: {
      style: 'analytical',
      greeting: 'Hello, ready for SEO analysis!',
    },
  },
  skills: [{ id: 'seo-audit', name: 'SEO Audit', prompt: 'Perform an SEO audit' }],
};

describe('ManifestParser', () => {
  let parser: ManifestParser;

  beforeEach(() => {
    parser = new ManifestParser();
    vi.clearAllMocks();
  });

  describe('parseFromPath', () => {
    it('should parse valid manifest.json', () => {
      mockReadFileSync.mockReturnValue(JSON.stringify(validManifest));

      const result = parser.parseFromPath('/skills/seo-expert');

      expect(result).toEqual(validManifest);
      expect(mockReadFileSync).toHaveBeenCalledWith(
        expect.stringContaining('manifest.json'),
        'utf-8'
      );
    });

    it('should throw on missing file', () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      expect(() => parser.parseFromPath('/nonexistent')).toThrow('Failed to read manifest.json');
    });

    it('should throw on invalid JSON', () => {
      mockReadFileSync.mockReturnValue('not valid json {{{');

      expect(() => parser.parseFromPath('/skills/bad')).toThrow('Invalid JSON in manifest.json');
    });

    it('should throw on manifest missing required fields', () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'test' }));

      expect(() => parser.parseFromPath('/skills/incomplete')).toThrow('missing required fields');
    });
  });

  describe('validate', () => {
    it('should return true for valid manifest', () => {
      expect(parser.validate(validManifest)).toBe(true);
    });

    it('should return false for null', () => {
      expect(parser.validate(null)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect(parser.validate('string')).toBe(false);
    });

    it('should return false when name is missing', () => {
      expect(parser.validate({ ...validManifest, name: '' })).toBe(false);
    });

    it('should return false when version is missing', () => {
      expect(parser.validate({ ...validManifest, version: '' })).toBe(false);
    });

    it('should return false for invalid type', () => {
      expect(parser.validate({ ...validManifest, type: 'invalid' })).toBe(false);
    });

    it('should accept all valid types', () => {
      for (const type of ['knowledge', 'execution', 'hybrid']) {
        expect(parser.validate({ ...validManifest, type })).toBe(true);
      }
    });

    it('should return false when employee is missing', () => {
      expect(parser.validate({ ...validManifest, employee: null })).toBe(false);
    });

    it('should return false when employee.role is empty', () => {
      const manifest = {
        ...validManifest,
        employee: { ...validManifest.employee, role: '' },
      };
      expect(parser.validate(manifest)).toBe(false);
    });

    it('should return false when skills array is empty', () => {
      expect(parser.validate({ ...validManifest, skills: [] })).toBe(false);
    });

    it('should return false when a skill entry is missing id', () => {
      const manifest = {
        ...validManifest,
        skills: [{ id: '', name: 'Test', prompt: 'test' }],
      };
      expect(parser.validate(manifest)).toBe(false);
    });
  });

  describe('new employee manifests', () => {
    const publisherXhsManifest = {
      name: 'publisher-xhs',
      version: '1.0.0',
      description: 'Xiaohongshu automated publisher',
      type: 'execution',
      employee: {
        role: 'Xiaohongshu Publisher',
        roleZh: '小红书发布专员',
        avatar: '📕',
        team: 'publishing',
        personality: {
          style: 'precise, reliable, detail-oriented, automation-focused',
          greeting: 'Hi! I am your Xiaohongshu Publisher.',
        },
      },
      skills: [{ id: 'publish-note', name: 'Publish Xiaohongshu Note', prompt: './SKILL.md' }],
      tools: [{ name: 'publish-xhs', cli: 'python', requiredSecret: 'XHS_COOKIES' }],
      onboarding: {
        type: 'browser-login',
        loginUrl: 'https://www.xiaohongshu.com/login',
        successIndicator: 'web_session',
        cookieDomains: ['.xiaohongshu.com'],
      },
    };

    const publisherDouyinManifest = {
      name: 'publisher-douyin',
      version: '1.0.0',
      description: 'Douyin automated publisher',
      type: 'execution',
      employee: {
        role: 'Douyin Publisher',
        roleZh: '抖音发布专员',
        avatar: '🎵',
        team: 'publishing',
        personality: {
          style: 'efficient, methodical, detail-oriented',
          greeting: 'Hi! I am your Douyin Publisher.',
        },
      },
      skills: [{ id: 'publish-video', name: 'Publish Douyin Video', prompt: './SKILL.md' }],
      tools: [{ name: 'publish-douyin', cli: 'python', requiredSecret: 'DOUYIN_COOKIES' }],
      onboarding: {
        type: 'browser-login',
        loginUrl: 'https://creator.douyin.com/',
        successIndicator: 'sessionid',
        cookieDomains: ['.douyin.com', '.toutiao.com'],
      },
    };

    const researcherManifest = {
      name: 'researcher',
      version: '1.0.0',
      description: 'Research analyst',
      type: 'knowledge',
      employee: {
        role: 'Research Analyst',
        roleZh: '研究员',
        avatar: '🔬',
        team: 'research',
        personality: {
          style: 'rigorous, analytical, evidence-driven',
          greeting: 'Hi! I am your Research Analyst.',
        },
      },
      skills: [{ id: 'competitive-research', name: 'Competitive Research', prompt: './SKILL.md' }],
      tools: [{ name: 'web_search' }, { name: 'web_fetch' }],
    };

    const updatedNewMediaManifest = {
      ...validManifest,
      name: 'new-media',
      type: 'knowledge',
      employee: {
        role: 'Content Creator',
        roleZh: '内容策划师',
        avatar: '📱',
        team: 'marketing',
        personality: {
          style: 'creative, data-driven',
          greeting: 'Hi!',
        },
      },
      tools: [{ name: 'generate-image', cli: 'python', requiredSecret: 'DEERAPI_KEY' }],
    };

    it('should validate publisher-xhs manifest (execution + onboarding)', () => {
      expect(parser.validate(publisherXhsManifest)).toBe(true);
    });

    it('should validate publisher-douyin manifest (execution + multiple cookieDomains)', () => {
      expect(parser.validate(publisherDouyinManifest)).toBe(true);
    });

    it('should validate researcher manifest (knowledge + no onboarding)', () => {
      expect(parser.validate(researcherManifest)).toBe(true);
    });

    it('should validate updated new-media manifest (knowledge + tools retained)', () => {
      expect(parser.validate(updatedNewMediaManifest)).toBe(true);
    });
  });
});
