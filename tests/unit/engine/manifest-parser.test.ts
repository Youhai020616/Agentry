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
  skills: [
    { id: 'seo-audit', name: 'SEO Audit', prompt: 'Perform an SEO audit' },
  ],
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

      expect(() => parser.parseFromPath('/nonexistent')).toThrow(
        'Failed to read manifest.json'
      );
    });

    it('should throw on invalid JSON', () => {
      mockReadFileSync.mockReturnValue('not valid json {{{');

      expect(() => parser.parseFromPath('/skills/bad')).toThrow(
        'Invalid JSON in manifest.json'
      );
    });

    it('should throw on manifest missing required fields', () => {
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ name: 'test' })
      );

      expect(() => parser.parseFromPath('/skills/incomplete')).toThrow(
        'missing required fields'
      );
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
});
