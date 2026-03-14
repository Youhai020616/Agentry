// @vitest-environment node
/**
 * PerformanceTracker Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../electron/utils/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { perf } from '../../../electron/utils/perf';

describe('PerformanceTracker', () => {
  beforeEach(() => {
    perf.clear();
  });

  describe('start/done', () => {
    it('should record a timing entry', () => {
      const done = perf.start('test:op');
      done();
      const recent = perf.getRecent(1);
      expect(recent).toHaveLength(1);
      expect(recent[0].name).toBe('test:op');
      expect(recent[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should measure actual elapsed time', async () => {
      const done = perf.start('slow:op');
      await new Promise((r) => setTimeout(r, 50));
      done();
      const recent = perf.getRecent(1);
      expect(recent[0].durationMs).toBeGreaterThanOrEqual(40);
    });
  });

  describe('wrap', () => {
    it('should wrap async function and record timing', async () => {
      const result = await perf.wrap('wrapped:op', async () => 42);
      expect(result).toBe(42);
      const recent = perf.getRecent(1);
      expect(recent[0].name).toBe('wrapped:op');
    });

    it('should record timing even on error', async () => {
      await expect(
        perf.wrap('error:op', async () => {
          throw new Error('fail');
        })
      ).rejects.toThrow('fail');
      const recent = perf.getRecent(1);
      expect(recent[0].name).toBe('error:op');
    });
  });

  describe('getSlow', () => {
    it('should return entries above threshold', async () => {
      const done = perf.start('slow:op');
      await new Promise((r) => setTimeout(r, 60));
      done();

      perf.start('fast:op')();

      const slow = perf.getSlow(50);
      expect(slow.length).toBe(1);
      expect(slow[0].name).toBe('slow:op');
    });
  });

  describe('getStats', () => {
    it('should aggregate per-channel stats', () => {
      for (let i = 0; i < 5; i++) {
        perf.start('channel:a')();
      }
      for (let i = 0; i < 3; i++) {
        perf.start('channel:b')();
      }

      const stats = perf.getStats();
      const a = stats.find((s) => s.name === 'channel:a');
      const b = stats.find((s) => s.name === 'channel:b');
      expect(a?.count).toBe(5);
      expect(b?.count).toBe(3);
    });

    it('should compute avg, max, p95', () => {
      perf.start('test')();
      const stats = perf.getStats();
      expect(stats[0]).toHaveProperty('avgMs');
      expect(stats[0]).toHaveProperty('maxMs');
      expect(stats[0]).toHaveProperty('p95Ms');
    });
  });

  describe('getRecent', () => {
    it('should return newest first', () => {
      perf.start('first')();
      perf.start('second')();
      perf.start('third')();
      const recent = perf.getRecent(3);
      expect(recent[0].name).toBe('third');
      expect(recent[2].name).toBe('first');
    });

    it('should respect limit', () => {
      for (let i = 0; i < 10; i++) {
        perf.start(`op-${i}`)();
      }
      expect(perf.getRecent(3)).toHaveLength(3);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      perf.start('test')();
      perf.clear();
      expect(perf.getRecent()).toHaveLength(0);
    });
  });
});
