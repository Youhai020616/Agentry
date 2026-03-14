// @vitest-environment node
/**
 * MemoryEngine Tests
 * Tests file-backed episodic memory and brand context.
 * Redirects homedir() to a temp directory before module import.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ── Mocks (must be declared before module import) ────────────────────

// vi.hoisted runs synchronously before vi.mock hoisting
 
const { TEST_DIR } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const _path = require('node:path') as typeof import('node:path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const _os = require('node:os') as typeof import('node:os');
  return { TEST_DIR: _path.join(_os.tmpdir(), `agentry-memory-test-${process.pid}-${Date.now()}`) };
});

// Mock homedir BEFORE MemoryEngine reads it at module level
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => TEST_DIR,
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

// ── Import under test (after mocks) ─────────────────────────────────

import { MemoryEngine } from '../../../electron/engine/memory';

// Derived paths (must match the constants inside memory.ts after mock)
const EMPLOYEES_DIR = join(TEST_DIR, '.agentry', 'employees');
const SHARED_DIR = join(TEST_DIR, '.agentry', 'shared');
const BRAND_FILE = join(SHARED_DIR, 'BRAND.md');

// ── Tests ────────────────────────────────────────────────────────────

describe('MemoryEngine', () => {
  let engine: MemoryEngine;

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    engine = new MemoryEngine();
    engine.init();
  });

  afterEach(() => {
    engine.destroy();
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ── Lifecycle ─────────────────────────────────────────────────

  describe('init', () => {
    it('should create employee and shared directories', () => {
      expect(existsSync(EMPLOYEES_DIR)).toBe(true);
      expect(existsSync(SHARED_DIR)).toBe(true);
    });
  });

  describe('destroy', () => {
    it('should remove all listeners', () => {
      const listener = vi.fn();
      engine.on('memory-changed', listener);
      engine.destroy();
      expect(engine.listenerCount('memory-changed')).toBe(0);
    });
  });

  // ── Episodic Memory ───────────────────────────────────────────

  describe('storeEpisodic', () => {
    it('should store a memory and return an id', () => {
      const id = engine.storeEpisodic('emp-1', 'Learned about React hooks', ['react', 'hooks'], 4);
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    it('should create MEMORY.md file for employee', () => {
      engine.storeEpisodic('emp-1', 'Test memory');
      const memoryFile = join(EMPLOYEES_DIR, 'emp-1', 'MEMORY.md');
      expect(existsSync(memoryFile)).toBe(true);
    });

    it('should write content in expected format', () => {
      engine.storeEpisodic('emp-1', 'Deployed the API', ['deploy', 'api'], 5, 'task-42');
      const memoryFile = join(EMPLOYEES_DIR, 'emp-1', 'MEMORY.md');
      const content = readFileSync(memoryFile, 'utf-8');
      expect(content).toContain('Deployed the API');
      expect(content).toContain('deploy');
      expect(content).toContain('api');
      expect(content).toContain('importance: 5');
    });

    it('should append multiple memories', () => {
      engine.storeEpisodic('emp-1', 'Memory 1');
      engine.storeEpisodic('emp-1', 'Memory 2');
      engine.storeEpisodic('emp-1', 'Memory 3');
      expect(engine.getEpisodicCount('emp-1')).toBe(3);
    });

    it('should emit memory-changed event', () => {
      const listener = vi.fn();
      engine.on('memory-changed', listener);
      engine.storeEpisodic('emp-1', 'Test memory');
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'episodic', action: 'store' })
      );
    });
  });

  describe('recall', () => {
    it('should return most recent memories first', () => {
      engine.storeEpisodic('emp-1', 'Old memory', [], 3);
      engine.storeEpisodic('emp-1', 'New memory', [], 5);

      const memories = engine.recall('emp-1', 10);
      expect(memories.length).toBe(2);
      expect(memories[0].content).toBe('New memory');
      expect(memories[1].content).toBe('Old memory');
    });

    it('should respect the limit parameter', () => {
      for (let i = 0; i < 20; i++) {
        engine.storeEpisodic('emp-1', `Memory ${i}`);
      }
      const memories = engine.recall('emp-1', 5);
      expect(memories.length).toBe(5);
    });

    it('should return empty array for unknown employee', () => {
      expect(engine.recall('nonexistent')).toEqual([]);
    });

    it('should preserve tags in recalled memories', () => {
      engine.storeEpisodic('emp-1', 'Tagged memory', ['react', 'typescript'], 4);
      const memories = engine.recall('emp-1', 1);
      expect(memories[0].tags).toContain('react');
      expect(memories[0].tags).toContain('typescript');
    });

    it('should preserve importance in recalled memories', () => {
      engine.storeEpisodic('emp-1', 'Important memory', [], 5);
      const memories = engine.recall('emp-1', 1);
      expect(memories[0].importance).toBe(5);
    });
  });

  describe('getEpisodicCount', () => {
    it('should return 0 for new employee', () => {
      expect(engine.getEpisodicCount('new-emp')).toBe(0);
    });

    it('should count accurately', () => {
      engine.storeEpisodic('emp-1', 'Memory 1');
      engine.storeEpisodic('emp-1', 'Memory 2');
      expect(engine.getEpisodicCount('emp-1')).toBe(2);
    });
  });

  describe('generateEpisodicPromptSection', () => {
    it('should return empty string for no memories', () => {
      expect(engine.generateEpisodicPromptSection('emp-1')).toBe('');
    });

    it('should generate formatted section', () => {
      engine.storeEpisodic('emp-1', 'Learned about error handling', ['errors']);
      engine.storeEpisodic('emp-1', 'Deployed to production', ['deploy']);
      const section = engine.generateEpisodicPromptSection('emp-1', 5);
      expect(section).toContain('Past Experience');
      expect(section).toContain('Deployed to production');
    });
  });

  // ── Brand Context ─────────────────────────────────────────────

  describe('setBrandContext', () => {
    it('should write BRAND.md', () => {
      engine.setBrandContext('# Acme Corp\n\nWe make rockets.');
      expect(existsSync(BRAND_FILE)).toBe(true);
      expect(readFileSync(BRAND_FILE, 'utf-8')).toContain('Acme Corp');
    });

    it('should overwrite existing content', () => {
      engine.setBrandContext('First brand');
      engine.setBrandContext('Second brand');
      expect(readFileSync(BRAND_FILE, 'utf-8')).toBe('Second brand');
    });

    it('should emit memory-changed event', () => {
      const listener = vi.fn();
      engine.on('memory-changed', listener);
      engine.setBrandContext('Brand context');
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'brand', action: 'set' })
      );
    });
  });

  describe('getBrandContext', () => {
    it('should return empty string when no brand file', () => {
      expect(engine.getBrandContext()).toBe('');
    });

    it('should return saved brand context', () => {
      engine.setBrandContext('# My Brand');
      expect(engine.getBrandContext()).toContain('My Brand');
    });
  });

  describe('generateBusinessContextSection', () => {
    it('should return empty string when no brand context', () => {
      expect(engine.generateBusinessContextSection()).toBe('');
    });

    it('should generate formatted section', () => {
      engine.setBrandContext('We are a fintech company.');
      const section = engine.generateBusinessContextSection();
      expect(section).toContain('Business Context');
      expect(section).toContain('fintech');
    });
  });

  // ── File Access ───────────────────────────────────────────────

  describe('getMemoryFile', () => {
    it('should return empty string for unknown employee', () => {
      expect(engine.getMemoryFile('nonexistent')).toBe('');
    });

    it('should return raw MEMORY.md content', () => {
      engine.storeEpisodic('emp-1', 'Some memory');
      const content = engine.getMemoryFile('emp-1');
      expect(content).toContain('Some memory');
    });
  });

  // ── Employee isolation ────────────────────────────────────────

  describe('employee isolation', () => {
    it('should not leak memories between employees', () => {
      engine.storeEpisodic('emp-1', 'Memory for emp-1');
      engine.storeEpisodic('emp-2', 'Memory for emp-2');

      const mem1 = engine.recall('emp-1', 10);
      const mem2 = engine.recall('emp-2', 10);

      expect(mem1.length).toBe(1);
      expect(mem2.length).toBe(1);
      expect(mem1[0].content).toBe('Memory for emp-1');
      expect(mem2[0].content).toBe('Memory for emp-2');
    });
  });
});
