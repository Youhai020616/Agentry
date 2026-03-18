/**
 * Message Bus
 * SQLite-backed cross-employee messaging system for the Agentry AI Employee Platform.
 *
 * @deprecated Migration Roadmap:
 *
 * **Phase A (current):** MessageBus retained as offline audit log + plan_approval workflow.
 *   SupervisorEngine.handleStuckTask() and submitPlan/approvePlan/rejectPlan still use it.
 *   deliverPendingMessages() bridges offline→online transitions (Issue #7).
 *
 * **Phase B:** Replace plan_approval flow with Gateway-native `sessions_send`.
 *   - Supervisor sends approval requests via `sessions_send` to employee agents
 *   - Employee agents respond via `sessions_send`
 *   - MessageBus becomes read-only (historical queries only)
 *   - Remove `send()` method, keep `getHistory()` / `getInbox()`
 *
 * **Phase C:** Remove MessageBus entirely.
 *   - Migrate historical data to MessageStore (already exists in `message-store.ts`)
 *   - Remove `messages` table from agentry-tasks.db
 *   - Remove MessageBus from bootstrap.ts `getLazy()`
 *   - Remove `message:*` IPC channels from preload whitelist
 *
 * **DO NOT** add new features to MessageBus. New inter-agent communication
 * should use `tools.agentToAgent` + `sessions_send` in openclaw.json.
 *
 * Events:
 *  - 'new-message' (message: Message) — emitted when a message is inserted
 */
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type Database from 'better-sqlite3';
import { logger } from '../utils/logger';
import type { Message, MessageType, SendMessageInput } from '@shared/types/task';

/**
 * Raw row shape coming from SQLite (approve and read stored as INTEGER)
 */
interface MessageRow {
  id: string;
  type: string;
  from: string;
  recipient: string;
  content: string;
  summary: string;
  requestId: string | null;
  approve: number | null;
  timestamp: number;
  read: number;
}

export class MessageBus extends EventEmitter {
  private db: Database.Database;
  private getActiveEmployeeIds: () => string[];

  constructor(db: Database.Database, getActiveEmployeeIds: () => string[]) {
    super();
    this.db = db;
    this.getActiveEmployeeIds = getActiveEmployeeIds;
  }

  // ── Initialization ──────────────────────────────────────────────────

  /**
   * Create the messages table and indexes if they don't exist.
   */
  init(): void {
    logger.info('MessageBus initializing...');
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL DEFAULT 'message',
          "from" TEXT NOT NULL,
          recipient TEXT NOT NULL,
          content TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          requestId TEXT,
          approve INTEGER,
          timestamp INTEGER NOT NULL,
          read INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient);
        CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(recipient, read);
      `);
      logger.info('MessageBus initialized');
    } catch (err) {
      logger.error(`MessageBus failed to initialize: ${err}`);
      throw err;
    }
  }

  // ── Send ────────────────────────────────────────────────────────────

  /**
   * Send a message. For broadcasts, inserts a copy per active employee (excluding sender).
   */
  send(input: SendMessageInput): void {
    try {
      if (input.type === 'broadcast') {
        const recipients = this.getActiveEmployeeIds().filter((id) => id !== input.from);
        if (recipients.length === 0) {
          logger.warn(`MessageBus broadcast from ${input.from}: no active recipients`);
          return;
        }
        for (const recipient of recipients) {
          this.insertMessage({ ...input, recipient });
        }
        logger.debug(
          `MessageBus broadcast from ${input.from} to ${recipients.length} recipient(s)`
        );
      } else {
        this.insertMessage(input);
      }
    } catch (err) {
      logger.error(`MessageBus send failed: ${err}`);
    }
  }

  // ── Queries ─────────────────────────────────────────────────────────

  /**
   * Get unread messages for an employee, ordered by timestamp ASC.
   */
  getInbox(employeeId: string): Message[] {
    try {
      const stmt = this.db.prepare(
        'SELECT * FROM messages WHERE recipient = ? AND read = 0 ORDER BY timestamp ASC'
      );
      const rows = stmt.all(employeeId) as MessageRow[];
      return rows.map(this.rowToMessage);
    } catch (err) {
      logger.error(`MessageBus getInbox failed for ${employeeId}: ${err}`);
      return [];
    }
  }

  /**
   * Get message history (sent + received) for an employee, ordered by timestamp DESC.
   */
  getHistory(employeeId: string, limit = 100): Message[] {
    try {
      const stmt = this.db.prepare(
        'SELECT * FROM messages WHERE recipient = ? OR "from" = ? ORDER BY timestamp DESC LIMIT ?'
      );
      const rows = stmt.all(employeeId, employeeId, limit) as MessageRow[];
      return rows.map(this.rowToMessage);
    } catch (err) {
      logger.error(`MessageBus getHistory failed for ${employeeId}: ${err}`);
      return [];
    }
  }

  /**
   * Mark a single message as read.
   */
  markRead(messageId: string): void {
    try {
      this.db.prepare('UPDATE messages SET read = 1 WHERE id = ?').run(messageId);
    } catch (err) {
      logger.error(`MessageBus markRead failed for ${messageId}: ${err}`);
    }
  }

  /**
   * Mark all unread messages for an employee as read.
   */
  markAllRead(employeeId: string): void {
    try {
      this.db
        .prepare('UPDATE messages SET read = 1 WHERE recipient = ? AND read = 0')
        .run(employeeId);
    } catch (err) {
      logger.error(`MessageBus markAllRead failed for ${employeeId}: ${err}`);
    }
  }

  /**
   * Get the count of unread messages for an employee.
   */
  getUnreadCount(employeeId: string): number {
    try {
      const row = this.db
        .prepare('SELECT COUNT(*) AS count FROM messages WHERE recipient = ? AND read = 0')
        .get(employeeId) as { count: number } | undefined;
      return row?.count ?? 0;
    } catch (err) {
      logger.error(`MessageBus getUnreadCount failed for ${employeeId}: ${err}`);
      return 0;
    }
  }

  // ── Pending Messages (Issue #7) ───────────────────────────────────

  /**
   * Check if an employee has unread pending messages.
   */
  hasPendingMessages(employeeId: string): boolean {
    return this.getUnreadCount(employeeId) > 0;
  }

  /**
   * Deliver all pending (unread) messages to an employee by emitting them.
   * Called when an employee comes back online.
   *
   * Fix M4: marks all delivered messages as read immediately after emitting,
   * so that subsequent activations won't re-deliver the same messages.
   */
  deliverPendingMessages(employeeId: string): void {
    const messages = this.getInbox(employeeId);
    for (const message of messages) {
      this.emit('new-message', message);
    }
    if (messages.length > 0) {
      // M4 fix: mark as read to prevent duplicate delivery on next activation
      this.markAllRead(employeeId);
      logger.info(`Delivered ${messages.length} pending message(s) to ${employeeId}`);
    }
  }

  /**
   * Destroy — remove event listeners.
   * Note: the DB connection is shared with TaskQueue and closed there.
   */
  destroy(): void {
    logger.info('MessageBus destroying...');
    this.removeAllListeners();
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Insert a single message row and emit the 'new-message' event.
   */
  private insertMessage(input: SendMessageInput): void {
    const message: Message = {
      id: randomUUID(),
      type: input.type,
      from: input.from,
      recipient: input.recipient,
      content: input.content,
      summary: input.summary,
      requestId: input.requestId,
      approve: input.approve,
      timestamp: Date.now(),
      read: false,
    };

    this.db
      .prepare(
        `INSERT INTO messages (id, type, "from", recipient, content, summary, requestId, approve, timestamp, read)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        message.id,
        message.type,
        message.from,
        message.recipient,
        message.content,
        message.summary,
        message.requestId ?? null,
        message.approve != null ? (message.approve ? 1 : 0) : null,
        message.timestamp,
        0
      );

    this.emit('new-message', message);
  }

  /**
   * Convert a raw SQLite row to a typed Message object.
   * - `approve`: INTEGER (0/1/null) → boolean | undefined
   * - `read`: INTEGER (0/1) → boolean
   */
  private rowToMessage = (row: MessageRow): Message => {
    return {
      id: row.id,
      type: row.type as MessageType,
      from: row.from,
      recipient: row.recipient,
      content: row.content,
      summary: row.summary,
      requestId: row.requestId ?? undefined,
      approve: row.approve != null ? row.approve === 1 : undefined,
      timestamp: row.timestamp,
      read: row.read === 1,
    };
  };
}
