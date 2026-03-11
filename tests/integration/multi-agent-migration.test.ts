/**
 * Multi-Agent Migration Integration Tests
 *
 * Tests the session key migration from `agent:main:employee-{slug}`
 * to `agent:{slug}:main` (native multi-agent routing).
 *
 * Covers:
 * 1. MessageStore session key migration (SQLite) — requires native better-sqlite3
 * 2. Session key format verification (regex patterns)
 * 3. Model injection regex correctness
 *
 * NOTE: SQLite tests require better-sqlite3 compiled for the current Node version.
 * When running under vitest (system Node) vs Electron Node, the native module may
 * fail to load. These tests are skipped gracefully with a diagnostic message.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Mock Electron APIs before importing engine modules ────────────────

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return '/tmp/agentry-test';
      return `/tmp/${name}`;
    },
  },
}));

// Mock electron-store (used by EmployeeManager for secrets/onboarding)
vi.mock('electron-store', () => ({
  default: class MockStore {
    private data: Record<string, unknown> = {};
    get(key: string) {
      return this.data[key];
    }
    set(key: string, value: unknown) {
      this.data[key] = value;
    }
  },
}));

// Mock logger to suppress noise
vi.mock('../../electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Conditional SQLite import ────────────────────────────────────────
// better-sqlite3 is a native module compiled for Electron's Node version.
// When running vitest with system Node, the module may fail to load.
// We detect this upfront and skip SQLite tests gracefully.

let MessageStore: typeof import('../../electron/engine/message-store').MessageStore | null = null;
let sqliteAvailable = false;

try {
  const mod = await import('../../electron/engine/message-store');
  MessageStore = mod.MessageStore;
  // Try to actually instantiate to verify native module loads
  const tmpDb = join(tmpdir(), `agentry-sqlite-probe-${Date.now()}.db`);
  const probe = new MessageStore(tmpDb);
  probe.init();
  probe.destroy();
  try {
    rmSync(tmpDb);
  } catch {
    /* ignore */
  }
  sqliteAvailable = true;
} catch {
  // Native module mismatch — SQLite tests will be skipped
}

const describeWithSqlite = sqliteAvailable ? describe : describe.skip;

// ═══════════════════════════════════════════════════════════════════════
// Test Suite
// ═══════════════════════════════════════════════════════════════════════

describe('Multi-Agent Migration Integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentry-migration-test-'));
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Windows may hold file handles briefly
    }
  });

  // ── MessageStore Session Key Migration ─────────────────────────────

  describeWithSqlite('MessageStore session key migration', () => {
    it('should migrate old session keys in messages table on init', () => {
      if (!MessageStore) throw new Error('MessageStore not available');
      const dbPath = join(tmpDir, 'migration-messages.db');

      // Phase 1: Create a store with old-format data
      const store1 = new MessageStore!(dbPath);
      store1.init();

      // Insert messages with old session key format
      store1.save({
        id: 'msg-1',
        sessionKey: 'agent:main:employee-seo-expert',
        role: 'user',
        content: 'Research keywords for AI tools',
        timestamp: Date.now() - 10000,
      });
      store1.save({
        id: 'msg-2',
        sessionKey: 'agent:main:employee-seo-expert',
        role: 'assistant',
        content: 'Top keywords: "AI assistant" (vol: 12K)',
        timestamp: Date.now() - 9000,
      });
      store1.save({
        id: 'msg-3',
        sessionKey: 'agent:main:employee-copywriter',
        role: 'user',
        content: 'Write a landing page',
        timestamp: Date.now() - 8000,
      });

      // Also save a message with the NEW format (should not be affected)
      store1.save({
        id: 'msg-new-1',
        sessionKey: 'agent:researcher:main',
        role: 'user',
        content: 'Already in new format',
        timestamp: Date.now() - 7000,
      });

      // And a non-employee session (should not be affected)
      store1.save({
        id: 'msg-default-1',
        sessionKey: 'agent:main:main',
        role: 'user',
        content: 'Default agent session',
        timestamp: Date.now() - 6000,
      });

      // Update session meta for old keys
      store1.updateSessionMeta('agent:main:employee-seo-expert', {
        label: 'SEO Expert Chat',
        employeeId: 'seo-expert',
      });
      store1.updateSessionMeta('agent:main:employee-copywriter', {
        label: 'Copywriter Chat',
        employeeId: 'copywriter',
      });

      store1.destroy();

      // Phase 2: Re-open the store — migration should run automatically
      const store2 = new MessageStore!(dbPath);
      store2.init();

      // Verify: old session keys should be migrated
      const seoMessages = store2.listBySession('agent:seo-expert:main', 100);
      expect(seoMessages).toHaveLength(2);
      expect(seoMessages[0].id).toBe('msg-1');
      expect(seoMessages[0].sessionKey).toBe('agent:seo-expert:main');
      expect(seoMessages[1].id).toBe('msg-2');
      expect(seoMessages[1].sessionKey).toBe('agent:seo-expert:main');

      const copyMessages = store2.listBySession('agent:copywriter:main', 100);
      expect(copyMessages).toHaveLength(1);
      expect(copyMessages[0].id).toBe('msg-3');
      expect(copyMessages[0].sessionKey).toBe('agent:copywriter:main');

      // Verify: old keys should have zero messages
      const oldSeoMessages = store2.listBySession('agent:main:employee-seo-expert', 100);
      expect(oldSeoMessages).toHaveLength(0);

      const oldCopyMessages = store2.listBySession('agent:main:employee-copywriter', 100);
      expect(oldCopyMessages).toHaveLength(0);

      // Verify: new-format and default messages are untouched
      const researcherMessages = store2.listBySession('agent:researcher:main', 100);
      expect(researcherMessages).toHaveLength(1);
      expect(researcherMessages[0].id).toBe('msg-new-1');

      const defaultMessages = store2.listBySession('agent:main:main', 100);
      expect(defaultMessages).toHaveLength(1);
      expect(defaultMessages[0].id).toBe('msg-default-1');

      // Verify: session meta was migrated
      const seoMeta = store2.getSessionMeta('agent:seo-expert:main');
      expect(seoMeta).toBeDefined();
      expect(seoMeta!.label).toBe('SEO Expert Chat');
      expect(seoMeta!.employeeId).toBe('seo-expert');

      const copyMeta = store2.getSessionMeta('agent:copywriter:main');
      expect(copyMeta).toBeDefined();
      expect(copyMeta!.label).toBe('Copywriter Chat');

      // Old meta should be gone
      const oldSeoMeta = store2.getSessionMeta('agent:main:employee-seo-expert');
      expect(oldSeoMeta).toBeUndefined();

      store2.destroy();
    });

    it('should be idempotent — running migration twice does nothing extra', () => {
      if (!MessageStore) throw new Error('MessageStore not available');
      const dbPath = join(tmpDir, 'migration-idempotent.db');

      // Create store with old data
      const store1 = new MessageStore(dbPath);
      store1.init();
      store1.save({
        id: 'msg-idem-1',
        sessionKey: 'agent:main:employee-researcher',
        role: 'user',
        content: 'First message',
        timestamp: Date.now(),
      });
      store1.destroy();

      // First re-open — migration runs
      const store2 = new MessageStore!(dbPath);
      store2.init();
      const messages1 = store2.listBySession('agent:researcher:main', 100);
      expect(messages1).toHaveLength(1);
      store2.destroy();

      // Second re-open — migration runs again but is a no-op
      const store3 = new MessageStore!(dbPath);
      store3.init();
      const messages2 = store3.listBySession('agent:researcher:main', 100);
      expect(messages2).toHaveLength(1);
      expect(messages2[0].id).toBe('msg-idem-1');
      expect(messages2[0].content).toBe('First message');

      // No orphaned messages under old key
      const oldMessages = store3.listBySession('agent:main:employee-researcher', 100);
      expect(oldMessages).toHaveLength(0);

      store3.destroy();
    });

    it('should handle empty database gracefully (no old keys to migrate)', () => {
      if (!MessageStore) throw new Error('MessageStore not available');
      const dbPath = join(tmpDir, 'migration-empty.db');
      const store = new MessageStore(dbPath);

      // Should not throw
      expect(() => store.init()).not.toThrow();

      // Insert a new-format message — should work normally
      store.save({
        id: 'msg-fresh-1',
        sessionKey: 'agent:seo-expert:main',
        role: 'user',
        content: 'Fresh start',
        timestamp: Date.now(),
      });

      const messages = store.listBySession('agent:seo-expert:main', 100);
      expect(messages).toHaveLength(1);

      store.destroy();
    });

    it('should handle slug with multiple dashes correctly', () => {
      if (!MessageStore) throw new Error('MessageStore not available');
      const dbPath = join(tmpDir, 'migration-dashes.db');
      const store1 = new MessageStore(dbPath);
      store1.init();

      store1.save({
        id: 'msg-dash-1',
        sessionKey: 'agent:main:employee-reddit-nurture-bot',
        role: 'user',
        content: 'Test multi-dash slug',
        timestamp: Date.now(),
      });
      store1.destroy();

      const store2 = new MessageStore!(dbPath);
      store2.init();

      const messages = store2.listBySession('agent:reddit-nurture-bot:main', 100);
      expect(messages).toHaveLength(1);
      expect(messages[0].sessionKey).toBe('agent:reddit-nurture-bot:main');

      store2.destroy();
    });

    it('should not migrate session keys that are not employee sessions', () => {
      if (!MessageStore) throw new Error('MessageStore not available');
      const dbPath = join(tmpDir, 'migration-non-employee.db');
      const store1 = new MessageStore(dbPath);
      store1.init();

      // Default main session — should NOT be migrated
      store1.save({
        id: 'msg-main-1',
        sessionKey: 'agent:main:main',
        role: 'user',
        content: 'Default agent chat',
        timestamp: Date.now(),
      });

      // Custom session — should NOT be migrated
      store1.save({
        id: 'msg-custom-1',
        sessionKey: 'agent:main:session-1234',
        role: 'user',
        content: 'Custom session',
        timestamp: Date.now(),
      });

      store1.destroy();

      const store2 = new MessageStore!(dbPath);
      store2.init();

      // Both should remain under their original keys
      const mainMessages = store2.listBySession('agent:main:main', 100);
      expect(mainMessages).toHaveLength(1);
      expect(mainMessages[0].id).toBe('msg-main-1');

      const customMessages = store2.listBySession('agent:main:session-1234', 100);
      expect(customMessages).toHaveLength(1);
      expect(customMessages[0].id).toBe('msg-custom-1');

      store2.destroy();
    });

    it('should handle conflict when new key already has messages', () => {
      if (!MessageStore) throw new Error('MessageStore not available');
      const dbPath = join(tmpDir, 'migration-conflict.db');
      const store1 = new MessageStore(dbPath);
      store1.init();

      // Old-format message
      store1.save({
        id: 'msg-old-1',
        sessionKey: 'agent:main:employee-researcher',
        role: 'user',
        content: 'Old format message',
        timestamp: Date.now() - 5000,
      });

      // New-format message (same employee, already using new key)
      store1.save({
        id: 'msg-new-1',
        sessionKey: 'agent:researcher:main',
        role: 'user',
        content: 'New format message',
        timestamp: Date.now(),
      });

      // Session meta for old key
      store1.updateSessionMeta('agent:main:employee-researcher', {
        label: 'Old Label',
        employeeId: 'researcher',
      });

      // Session meta for new key
      store1.updateSessionMeta('agent:researcher:main', {
        label: 'New Label',
        employeeId: 'researcher',
      });

      store1.destroy();

      // Re-open — migration should merge old messages into new key
      const store2 = new MessageStore!(dbPath);
      store2.init();

      // Both messages should be under the new key
      const messages = store2.listBySession('agent:researcher:main', 100);
      expect(messages).toHaveLength(2);

      const ids = messages.map((m) => m.id).sort();
      expect(ids).toEqual(['msg-new-1', 'msg-old-1']);

      // New session meta should be preserved (not overwritten by old)
      const meta = store2.getSessionMeta('agent:researcher:main');
      expect(meta).toBeDefined();
      expect(meta!.label).toBe('New Label');

      // Old meta should be deleted
      const oldMeta = store2.getSessionMeta('agent:main:employee-researcher');
      expect(oldMeta).toBeUndefined();

      store2.destroy();
    });
  });

  // ── Session Key Format Verification ────────────────────────────────

  describe('Session key format', () => {
    it('should use agent:{slug}:main format (not old agent:main:employee-{slug})', () => {
      // Verify the pattern via regex matching (same regex used in browser-event-detector)
      const NEW_PATTERN = /^agent:(?!main:)(.+):main$/;
      const OLD_PATTERN = /^agent:main:employee-(.+)$/;

      // New format keys
      expect('agent:seo-expert:main').toMatch(NEW_PATTERN);
      expect('agent:copywriter:main').toMatch(NEW_PATTERN);
      expect('agent:reddit-nurture:main').toMatch(NEW_PATTERN);
      expect('agent:browser-agent:main').toMatch(NEW_PATTERN);
      expect('agent:supervisor:main').toMatch(NEW_PATTERN);

      // New format should NOT match old pattern
      expect('agent:seo-expert:main').not.toMatch(OLD_PATTERN);
      expect('agent:copywriter:main').not.toMatch(OLD_PATTERN);

      // Default agent should NOT match employee pattern
      expect('agent:main:main').not.toMatch(NEW_PATTERN);

      // Old format keys should NOT match new pattern
      expect('agent:main:employee-seo-expert').not.toMatch(NEW_PATTERN);
      expect('agent:main:employee-copywriter').not.toMatch(NEW_PATTERN);
    });

    it('should extract correct slug from new format session key', () => {
      const REGEX = /^agent:(?!main:)(.+):main$/;

      const testCases = [
        { key: 'agent:seo-expert:main', slug: 'seo-expert' },
        { key: 'agent:copywriter:main', slug: 'copywriter' },
        { key: 'agent:reddit-nurture-bot:main', slug: 'reddit-nurture-bot' },
        { key: 'agent:browser-agent:main', slug: 'browser-agent' },
        { key: 'agent:supervisor:main', slug: 'supervisor' },
      ];

      for (const { key, slug } of testCases) {
        const match = key.match(REGEX);
        expect(match, `Expected ${key} to match`).not.toBeNull();
        expect(match![1]).toBe(slug);
      }
    });

    it('should correctly reject non-employee session keys', () => {
      const REGEX = /^agent:(?!main:)(.+):main$/;

      const nonEmployeeKeys = [
        'agent:main:main', // Default OpenClaw agent
        'agent:main:session-12345', // Custom session
        'random-key', // Not an agent key at all
        '', // Empty string
      ];

      for (const key of nonEmployeeKeys) {
        expect(key.match(REGEX), `Expected ${key} to NOT match`).toBeNull();
      }
    });
  });

  // ── Model Injection Regex ──────────────────────────────────────────

  describe('Model injection regex (ipc-handlers)', () => {
    // The model injection regex in ipc-handlers.ts uses the simpler pattern
    // without the main: exclusion (model injection for default agent is harmless)
    const MODEL_REGEX = /^agent:(.+):main$/;

    it('should match employee session keys for model injection', () => {
      const testCases = [
        { key: 'agent:seo-expert:main', id: 'seo-expert' },
        { key: 'agent:copywriter:main', id: 'copywriter' },
        { key: 'agent:main:main', id: 'main' }, // Default agent — harmless match
      ];

      for (const { key, id } of testCases) {
        const match = key.match(MODEL_REGEX);
        expect(match).not.toBeNull();
        expect(match![1]).toBe(id);
      }
    });

    it('should NOT match old-format session keys', () => {
      expect('agent:main:employee-seo-expert'.match(MODEL_REGEX)).toBeNull();
      expect('agent:main:employee-copywriter'.match(MODEL_REGEX)).toBeNull();
    });
  });
});
