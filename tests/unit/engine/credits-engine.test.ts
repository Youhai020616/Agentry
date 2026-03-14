// @vitest-environment node
/**
 * CreditsEngine Tests
 * Tests balance, consumption, top-up, history, and analytics.
 * Uses the vitest-aliased better-sqlite3 mock (tests/__mocks__/better-sqlite3.ts)
 * and overrides it with a rich in-memory implementation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/agentry-test') },
}));

vi.mock('../../../electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── In-memory SQLite mock ────────────────────────────────────────────

/** Build a rich in-memory DB mock with enough fidelity for CreditsEngine. */
function createMockDb() {
  const rows: Array<Record<string, unknown>> = [];

  function makeStatement(sql: string) {
    // INSERT
    if (/INSERT/i.test(sql)) {
      return {
        run: vi.fn((params: Record<string, unknown>) => {
          rows.push({ ...params });
        }),
        get: vi.fn(),
        all: vi.fn(),
      };
    }

    // COUNT(*)
    if (/COUNT\(\*\)\s*as\s+cnt/i.test(sql)) {
      return {
        run: vi.fn(),
        get: vi.fn(() => ({ cnt: rows.length })),
        all: vi.fn(),
      };
    }

    // Balance: SUM(CASE ...) with no GROUP BY
    if (/SUM\(CASE/i.test(sql) && !/GROUP BY/i.test(sql)) {
      return {
        run: vi.fn(),
        get: vi.fn(() => {
          let total = 0;
          let used = 0;
          for (const r of rows) {
            const amt = r.amount as number;
            if (amt > 0) total += amt;
            else used += Math.abs(amt);
          }
          return { total, used };
        }),
        all: vi.fn(),
      };
    }

    // Daily summary: SUM ... GROUP BY day
    if (/GROUP BY/i.test(sql)) {
      return {
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn((_since: number) => {
          const byDay = new Map<string, { consumed: number; transactions: number }>();
          for (const r of rows) {
            const ts = r.timestamp as number;
            if (ts > _since) {
              const day = new Date(ts).toISOString().slice(0, 10);
              const entry = byDay.get(day) ?? { consumed: 0, transactions: 0 };
              if ((r.amount as number) < 0) entry.consumed += Math.abs(r.amount as number);
              entry.transactions++;
              byDay.set(day, entry);
            }
          }
          return Array.from(byDay.entries()).map(([day, e]) => ({
            day,
            consumed: e.consumed,
            transactions: e.transactions,
          }));
        }),
      };
    }

    // SELECT * WHERE employeeId = ?
    if (/WHERE\s+employeeId/i.test(sql)) {
      return {
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn((employeeId: string, limit: number) =>
          rows
            .filter((r) => r.employeeId === employeeId)
            .sort((a, b) => (b.timestamp as number) - (a.timestamp as number))
            .slice(0, limit)
        ),
      };
    }

    // SELECT * WHERE type = ?
    if (/WHERE\s+type/i.test(sql)) {
      return {
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn((type: string, limit: number) =>
          rows
            .filter((r) => r.type === type)
            .sort((a, b) => (b.timestamp as number) - (a.timestamp as number))
            .slice(0, limit)
        ),
      };
    }

    // SELECT * ORDER BY timestamp DESC LIMIT ? OFFSET ?
    if (/ORDER BY timestamp DESC LIMIT/i.test(sql)) {
      return {
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn((limit: number, offset: number) =>
          rows
            .sort((a, b) => (b.timestamp as number) - (a.timestamp as number))
            .slice(offset, offset + limit)
        ),
      };
    }

    // Fallback
    return { run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) };
  }

  return {
    open: true,
    pragma: vi.fn(),
    exec: vi.fn(),
    prepare: vi.fn((sql: string) => makeStatement(sql)),
    close: vi.fn(),
    _rows: rows,
  };
}

// Vitest aliases 'better-sqlite3' to tests/__mocks__/better-sqlite3.ts.
// We must mock that exact module ID the engine code imports by name.
vi.mock('better-sqlite3', () => {
  // Factory — vi.mock is hoisted, but createMockDb will be available because
  // vi.mock callbacks run lazily at first import, not at declaration time.
  return {
    default: class MockDatabase {
      open = true;
      _rows: Array<Record<string, unknown>> = [];
      pragma = vi.fn();
      exec = vi.fn();
      close = vi.fn(() => { this.open = false; });
      prepare = (sql: string) => this._makeStatement(sql);
      _makeStatement(sql: string) {
        const rows = this._rows;
        if (/INSERT/i.test(sql)) {
          return { run: vi.fn((p: Record<string, unknown>) => { rows.push({ ...p }); }), get: vi.fn(), all: vi.fn() };
        }
        if (/COUNT\(\*\)\s*as\s+cnt/i.test(sql)) {
          return { run: vi.fn(), get: vi.fn(() => ({ cnt: rows.length })), all: vi.fn() };
        }
        if (/SUM\(CASE/i.test(sql) && !/GROUP BY/i.test(sql)) {
          return { run: vi.fn(), get: vi.fn(() => {
            let total = 0, used = 0;
            for (const r of rows) { const a = r.amount as number; if (a > 0) total += a; else used += Math.abs(a); }
            return { total, used };
          }), all: vi.fn() };
        }
        if (/GROUP BY/i.test(sql)) {
          return { run: vi.fn(), get: vi.fn(), all: vi.fn((_since: number) => {
            const byDay = new Map<string, { consumed: number; transactions: number }>();
            for (const r of rows) {
              const ts = r.timestamp as number;
              if (ts > _since) {
                const day = new Date(ts).toISOString().slice(0, 10);
                const e = byDay.get(day) ?? { consumed: 0, transactions: 0 };
                if ((r.amount as number) < 0) e.consumed += Math.abs(r.amount as number);
                e.transactions++;
                byDay.set(day, e);
              }
            }
            return [...byDay.entries()].map(([day, e]) => ({ day, ...e }));
          }) };
        }
        if (/WHERE\s+employeeId/i.test(sql)) {
          return { run: vi.fn(), get: vi.fn(), all: vi.fn((eid: string, lim: number) =>
            rows.filter(r => r.employeeId === eid).sort((a, b) => (b.timestamp as number) - (a.timestamp as number)).slice(0, lim)
          ) };
        }
        if (/WHERE\s+type/i.test(sql)) {
          return { run: vi.fn(), get: vi.fn(), all: vi.fn((type: string, lim: number) =>
            rows.filter(r => r.type === type).sort((a, b) => (b.timestamp as number) - (a.timestamp as number)).slice(0, lim)
          ) };
        }
        if (/ORDER BY timestamp DESC LIMIT/i.test(sql)) {
          return { run: vi.fn(), get: vi.fn(), all: vi.fn((lim: number, off: number) =>
            rows.sort((a, b) => (b.timestamp as number) - (a.timestamp as number)).slice(off, off + lim)
          ) };
        }
        return { run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) };
      }
    },
  };
});

// ── Import under test ────────────────────────────────────────────────

import { CreditsEngine } from '../../../electron/engine/credits-engine';

// ── Tests ────────────────────────────────────────────────────────────

describe('CreditsEngine', () => {
  let engine: CreditsEngine;

  beforeEach(() => {
    engine = new CreditsEngine('/tmp/test-credits.db');
    engine.init();
  });

  afterEach(() => {
    engine.destroy();
  });

  // ── Lifecycle ─────────────────────────────────────────────────

  describe('init', () => {
    it('should initialize and seed welcome bonus', () => {
      const balance = engine.getBalance();
      expect(balance.total).toBe(1000);
      expect(balance.used).toBe(0);
      expect(balance.remaining).toBe(1000);
    });

    it('should enable WAL mode', () => {
      const db = engine.getDb();
      expect(db.pragma).toHaveBeenCalledWith('journal_mode = WAL');
    });
  });

  describe('destroy', () => {
    it('should close the database', () => {
      const db = engine.getDb();
      engine.destroy();
      expect(db.close).toHaveBeenCalled();
    });

    it('should remove all listeners', () => {
      const listener = vi.fn();
      engine.on('credits-changed', listener);
      engine.destroy();
      expect(engine.listenerCount('credits-changed')).toBe(0);
    });
  });

  // ── Consumption ───────────────────────────────────────────────

  describe('consume', () => {
    it('should deduct credits and return true', () => {
      const result = engine.consume('chat', 10, 'Test chat', 'emp-1');
      expect(result).toBe(true);

      const balance = engine.getBalance();
      expect(balance.used).toBe(10);
      expect(balance.remaining).toBe(990);
    });

    it('should return false when insufficient credits', () => {
      const result = engine.consume('execution', 2000, 'Too expensive');
      expect(result).toBe(false);
    });

    it('should emit credits-changed event on success', () => {
      const listener = vi.fn();
      engine.on('credits-changed', listener);

      engine.consume('tool', 5, 'Test tool');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should not emit credits-changed on insufficient balance', () => {
      const listener = vi.fn();
      engine.on('credits-changed', listener);

      engine.consume('execution', 2000, 'Too expensive');
      expect(listener).not.toHaveBeenCalled();
    });

    it('should accept optional employeeId and taskId', () => {
      const result = engine.consume('execution', 5, 'Task run', 'emp-1', 'task-42');
      expect(result).toBe(true);
    });
  });

  // ── Top-up ────────────────────────────────────────────────────

  describe('topup', () => {
    it('should add credits', () => {
      engine.topup(500, 'Manual top-up');
      const balance = engine.getBalance();
      expect(balance.total).toBe(1500);
      expect(balance.remaining).toBe(1500);
    });

    it('should emit credits-changed event', () => {
      const listener = vi.fn();
      engine.on('credits-changed', listener);

      engine.topup(100);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // ── Balance ───────────────────────────────────────────────────

  describe('getBalance', () => {
    it('should reflect mixed operations', () => {
      engine.consume('chat', 100, 'Chat');
      engine.consume('tool', 50, 'Tool');
      engine.topup(200, 'Top-up');

      const balance = engine.getBalance();
      expect(balance.total).toBe(1200);
      expect(balance.used).toBe(150);
      expect(balance.remaining).toBe(1050);
    });
  });

  // ── History ───────────────────────────────────────────────────

  describe('getHistory', () => {
    it('should return paginated transactions', () => {
      engine.consume('chat', 10, 'Chat 1');
      engine.consume('chat', 20, 'Chat 2');

      const history = engine.getHistory(10, 0);
      expect(history.total).toBe(3); // 1 seed + 2 consume
      expect(history.transactions.length).toBeLessThanOrEqual(10);
    });
  });

  describe('getHistoryByEmployee', () => {
    it('should filter by employeeId', () => {
      engine.consume('chat', 10, 'Chat', 'emp-1');
      engine.consume('tool', 20, 'Tool', 'emp-2');

      const history = engine.getHistoryByEmployee('emp-1');
      for (const tx of history) {
        expect(tx.employeeId).toBe('emp-1');
      }
    });
  });

  describe('getHistoryByType', () => {
    it('should filter by transaction type', () => {
      engine.consume('chat', 10, 'Chat');
      engine.consume('tool', 20, 'Tool');

      const history = engine.getHistoryByType('chat');
      for (const tx of history) {
        expect(tx.type).toBe('chat');
      }
    });
  });

  // ── Analytics ─────────────────────────────────────────────────

  describe('getDailySummary', () => {
    it('should return daily consumption data', () => {
      engine.consume('chat', 10, 'Chat');
      const summary = engine.getDailySummary(30);
      expect(Array.isArray(summary)).toBe(true);
    });
  });
});
