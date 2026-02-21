/**
 * MessageBus Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { MessageBus } from '../../../electron/engine/message-bus';

// ── Mock Helpers ──────────────────────────────────────────────────────

function createMockDb() {
  const store: any[] = [];
  return {
    exec: vi.fn(),
    prepare: vi.fn().mockImplementation((_sql: string) => ({
      run: vi.fn().mockImplementation((...args: any[]) => {
        store.push(args);
      }),
      get: vi.fn().mockImplementation(() => store[0] ?? undefined),
      all: vi.fn().mockReturnValue([]),
    })),
    /** Expose store for assertions */
    _store: store,
  };
}

describe('MessageBus', () => {
  let bus: MessageBus;
  let db: ReturnType<typeof createMockDb>;
  let getActiveEmployeeIds: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    getActiveEmployeeIds = vi.fn().mockReturnValue([]);
    bus = new MessageBus(db as any, getActiveEmployeeIds);
  });

  // ── init ─────────────────────────────────────────────────────────

  describe('init', () => {
    it('should call db.exec to create messages table and indexes', () => {
      bus.init();

      expect(db.exec).toHaveBeenCalledTimes(1);
      const sql = db.exec.mock.calls[0][0] as string;
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS messages');
      expect(sql).toContain('idx_messages_recipient');
      expect(sql).toContain('idx_messages_unread');
    });

    it('should throw and log if db.exec fails', () => {
      const error = new Error('DB init failed');
      db.exec.mockImplementation(() => {
        throw error;
      });

      expect(() => bus.init()).toThrow('DB init failed');
    });
  });

  // ── send ─────────────────────────────────────────────────────────

  describe('send', () => {
    it('should insert a message and emit new-message', () => {
      const listener = vi.fn();
      bus.on('new-message', listener);

      bus.send({
        type: 'message',
        from: 'emp-1',
        recipient: 'emp-2',
        content: 'Hello!',
        summary: 'Greeting',
      });

      // db.prepare should have been called for the INSERT statement
      expect(db.prepare).toHaveBeenCalled();
      const insertCall = db.prepare.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO messages'),
      );
      expect(insertCall).toBeDefined();

      // Event should be emitted
      expect(listener).toHaveBeenCalledTimes(1);
      const emittedMessage = listener.mock.calls[0][0];
      expect(emittedMessage.from).toBe('emp-1');
      expect(emittedMessage.recipient).toBe('emp-2');
      expect(emittedMessage.content).toBe('Hello!');
      expect(emittedMessage.read).toBe(false);
      expect(emittedMessage.id).toBeDefined();
      expect(emittedMessage.timestamp).toBeGreaterThan(0);
    });

    it('should broadcast to all active employees except the sender', () => {
      getActiveEmployeeIds.mockReturnValue(['emp-1', 'emp-2', 'emp-3']);
      const listener = vi.fn();
      bus.on('new-message', listener);

      bus.send({
        type: 'broadcast',
        from: 'emp-1',
        recipient: '', // broadcast ignores this
        content: 'Announcement',
        summary: 'News',
      });

      // Should emit once per recipient (emp-2 and emp-3, excluding sender emp-1)
      expect(listener).toHaveBeenCalledTimes(2);
      const recipients = listener.mock.calls.map((call: any[]) => call[0].recipient);
      expect(recipients).toContain('emp-2');
      expect(recipients).toContain('emp-3');
      expect(recipients).not.toContain('emp-1');
    });

    it('should warn and return when broadcast has no active recipients', async () => {
      const { logger } = await import('../../../electron/utils/logger');
      getActiveEmployeeIds.mockReturnValue(['emp-1']); // only sender
      const listener = vi.fn();
      bus.on('new-message', listener);

      bus.send({
        type: 'broadcast',
        from: 'emp-1',
        recipient: '',
        content: 'No one to hear',
        summary: 'Empty room',
      });

      expect(listener).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should pass requestId and approve fields through', () => {
      const listener = vi.fn();
      bus.on('new-message', listener);

      bus.send({
        type: 'plan_approval',
        from: 'emp-1',
        recipient: 'pm-1',
        content: 'My plan',
        summary: 'Plan',
        requestId: 'task-42',
        approve: true,
      });

      const emittedMessage = listener.mock.calls[0][0];
      expect(emittedMessage.requestId).toBe('task-42');
      expect(emittedMessage.approve).toBe(true);
    });
  });

  // ── getInbox ─────────────────────────────────────────────────────

  describe('getInbox', () => {
    it('should call prepare with correct query for unread messages', () => {
      bus.getInbox('emp-1');

      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM messages WHERE recipient = ? AND read = 0 ORDER BY timestamp ASC',
      );
    });

    it('should return empty array on error', () => {
      db.prepare.mockImplementation(() => {
        throw new Error('DB error');
      });

      const result = bus.getInbox('emp-1');
      expect(result).toEqual([]);
    });
  });

  // ── getHistory ───────────────────────────────────────────────────

  describe('getHistory', () => {
    it('should call prepare with correct query for history', () => {
      bus.getHistory('emp-1', 50);

      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM messages WHERE recipient = ? OR "from" = ? ORDER BY timestamp DESC LIMIT ?',
      );
    });
  });

  // ── markRead ─────────────────────────────────────────────────────

  describe('markRead', () => {
    it('should update read flag for a single message', () => {
      bus.markRead('msg-123');

      expect(db.prepare).toHaveBeenCalledWith(
        'UPDATE messages SET read = 1 WHERE id = ?',
      );

      // The run function should be called with the message id
      const stmt = db.prepare.mock.results[0].value;
      expect(stmt.run).toHaveBeenCalledWith('msg-123');
    });

    it('should handle errors gracefully', () => {
      db.prepare.mockImplementation(() => {
        throw new Error('DB error');
      });

      // Should not throw
      expect(() => bus.markRead('msg-123')).not.toThrow();
    });
  });

  // ── markAllRead ──────────────────────────────────────────────────

  describe('markAllRead', () => {
    it('should update all unread messages for an employee', () => {
      bus.markAllRead('emp-1');

      expect(db.prepare).toHaveBeenCalledWith(
        'UPDATE messages SET read = 1 WHERE recipient = ? AND read = 0',
      );

      const stmt = db.prepare.mock.results[0].value;
      expect(stmt.run).toHaveBeenCalledWith('emp-1');
    });

    it('should handle errors gracefully', () => {
      db.prepare.mockImplementation(() => {
        throw new Error('DB error');
      });

      expect(() => bus.markAllRead('emp-1')).not.toThrow();
    });
  });

  // ── getUnreadCount ───────────────────────────────────────────────

  describe('getUnreadCount', () => {
    it('should return the count from the query result', () => {
      db.prepare.mockImplementation(() => ({
        run: vi.fn(),
        get: vi.fn().mockReturnValue({ count: 5 }),
        all: vi.fn(),
      }));

      const count = bus.getUnreadCount('emp-1');
      expect(count).toBe(5);
    });

    it('should return 0 when no rows returned', () => {
      db.prepare.mockImplementation(() => ({
        run: vi.fn(),
        get: vi.fn().mockReturnValue(undefined),
        all: vi.fn(),
      }));

      const count = bus.getUnreadCount('emp-1');
      expect(count).toBe(0);
    });

    it('should return 0 on error', () => {
      db.prepare.mockImplementation(() => {
        throw new Error('DB error');
      });

      const count = bus.getUnreadCount('emp-1');
      expect(count).toBe(0);
    });

    it('should call prepare with correct COUNT query', () => {
      bus.getUnreadCount('emp-1');

      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT COUNT(*) AS count FROM messages WHERE recipient = ? AND read = 0',
      );
    });
  });
});
