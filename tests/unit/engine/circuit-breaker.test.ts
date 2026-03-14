// @vitest-environment node
/**
 * CircuitBreaker Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../electron/utils/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { CircuitBreaker } from '../../../electron/gateway/circuit-breaker';

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 100, successThreshold: 1 });
  });

  // ── Closed state ──────────────────────────────────────────────

  describe('closed state', () => {
    it('should pass through successful calls', async () => {
      const result = await cb.execute('test', async () => 42);
      expect(result).toBe(42);
      expect(cb.getState().state).toBe('closed');
    });

    it('should rethrow errors from failed calls', async () => {
      await expect(
        cb.execute('test', async () => {
          throw new Error('fail');
        })
      ).rejects.toThrow('fail');
    });

    it('should remain closed below failure threshold', async () => {
      for (let i = 0; i < 2; i++) {
        await cb.execute('test', async () => { throw new Error('fail'); }).catch(() => {});
      }
      expect(cb.getState().state).toBe('closed');
      expect(cb.getState().failureCount).toBe(2);
    });

    it('should reset failure count on success', async () => {
      await cb.execute('test', async () => { throw new Error('fail'); }).catch(() => {});
      await cb.execute('test', async () => { throw new Error('fail'); }).catch(() => {});
      await cb.execute('test', async () => 'ok');
      expect(cb.getState().failureCount).toBe(0);
    });
  });

  // ── Closed → Open transition ──────────────────────────────────

  describe('closed → open', () => {
    it('should open after failureThreshold consecutive failures', async () => {
      for (let i = 0; i < 3; i++) {
        await cb.execute('test', async () => { throw new Error('fail'); }).catch(() => {});
      }
      expect(cb.getState().state).toBe('open');
    });

    it('should fast-fail when open', async () => {
      // Trip the breaker
      for (let i = 0; i < 3; i++) {
        await cb.execute('test', async () => { throw new Error('fail'); }).catch(() => {});
      }

      // Next call should fail immediately without calling fn
      const fn = vi.fn(async () => 'should not run');
      await expect(cb.execute('test', fn)).rejects.toThrow('Gateway temporarily unavailable');
      expect(fn).not.toHaveBeenCalled();
    });
  });

  // ── Open → Half-open transition ───────────────────────────────

  describe('open → half_open', () => {
    it('should transition to half_open after cooldown', async () => {
      for (let i = 0; i < 3; i++) {
        await cb.execute('test', async () => { throw new Error('fail'); }).catch(() => {});
      }
      expect(cb.getState().state).toBe('open');

      // Wait for cooldown
      await new Promise((r) => setTimeout(r, 120));

      // Next call should be a probe (half_open)
      const result = await cb.execute('test', async () => 'recovered');
      expect(result).toBe('recovered');
      expect(cb.getState().state).toBe('closed');
    });
  });

  // ── Half-open → Open (probe fails) ───────────────────────────

  describe('half_open → open', () => {
    it('should reopen if probe fails', async () => {
      for (let i = 0; i < 3; i++) {
        await cb.execute('test', async () => { throw new Error('fail'); }).catch(() => {});
      }

      await new Promise((r) => setTimeout(r, 120));

      // Probe fails
      await cb.execute('test', async () => { throw new Error('still broken'); }).catch(() => {});
      expect(cb.getState().state).toBe('open');
    });
  });

  // ── Exempt methods ────────────────────────────────────────────

  describe('exempt methods', () => {
    it('should always pass through exempt methods even when open', async () => {
      for (let i = 0; i < 3; i++) {
        await cb.execute('test', async () => { throw new Error('fail'); }).catch(() => {});
      }
      expect(cb.getState().state).toBe('open');

      // shutdown is exempt
      const result = await cb.execute('shutdown', async () => 'passed');
      expect(result).toBe('passed');
    });
  });

  // ── Reset ─────────────────────────────────────────────────────

  describe('reset', () => {
    it('should force-reset to closed', async () => {
      for (let i = 0; i < 3; i++) {
        await cb.execute('test', async () => { throw new Error('fail'); }).catch(() => {});
      }
      expect(cb.getState().state).toBe('open');

      cb.reset();
      expect(cb.getState().state).toBe('closed');
      expect(cb.getState().failureCount).toBe(0);
    });
  });

  // ── getState ──────────────────────────────────────────────────

  describe('getState', () => {
    it('should return diagnostic info', () => {
      const s = cb.getState();
      expect(s).toHaveProperty('state', 'closed');
      expect(s).toHaveProperty('failureCount', 0);
      expect(s).toHaveProperty('lastFailureTime', 0);
    });
  });
});
