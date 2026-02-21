/**
 * SkillCompiler Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReadFileSync, mockExistsSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockExistsSync: vi.fn(),
}));

vi.mock(import('node:fs'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...actual, readFileSync: mockReadFileSync, existsSync: mockExistsSync },
    readFileSync: mockReadFileSync,
    existsSync: mockExistsSync,
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

import { SkillCompiler } from '../../../electron/engine/compiler';
import type { SkillManifest } from '../../../src/types/manifest';

const mockManifest: SkillManifest = {
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
      style: 'analytical and thorough',
      greeting: 'Hello!',
    },
  },
  skills: [
    { id: 'seo-audit', name: 'SEO Audit', prompt: 'Perform an SEO audit' },
    { id: 'keyword', name: 'Keyword Research', prompt: 'Research keywords' },
  ],
};

describe('SkillCompiler', () => {
  let compiler: SkillCompiler;

  beforeEach(() => {
    compiler = new SkillCompiler();
    vi.clearAllMocks();
  });

  describe('compile', () => {
    it('should read SKILL.md and replace template variables', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        'You are {{ROLE}} ({{ROLE_ZH}}) on team {{TEAM}}. Style: {{PERSONALITY_STYLE}}'
      );

      const result = compiler.compile('/skills/seo', mockManifest);

      expect(result).toBe(
        'You are SEO Expert (SEO 专家) on team Marketing. Style: analytical and thorough'
      );
    });

    it('should generate default prompt when SKILL.md does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const result = compiler.compile('/skills/seo', mockManifest);

      expect(result).toContain('SEO Expert');
      expect(result).toContain('SEO 专家');
      expect(result).toContain('Marketing');
      expect(result).toContain('analytical and thorough');
      expect(result).toContain('SEO Audit, Keyword Research');
    });

    it('should generate default prompt when SKILL.md read fails', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = compiler.compile('/skills/seo', mockManifest);

      expect(result).toContain('SEO Expert');
      expect(result).toContain('Marketing');
    });

    it('should replace multiple occurrences of the same variable', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        '{{ROLE}} is {{ROLE}}. Team: {{TEAM}} and {{TEAM}}'
      );

      const result = compiler.compile('/skills/seo', mockManifest);

      expect(result).toBe(
        'SEO Expert is SEO Expert. Team: Marketing and Marketing'
      );
    });

    it('should leave unrecognized template variables as-is', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        '{{ROLE}} with {{UNKNOWN_VAR}}'
      );

      const result = compiler.compile('/skills/seo', mockManifest);

      expect(result).toBe('SEO Expert with {{UNKNOWN_VAR}}');
    });
  });
});
