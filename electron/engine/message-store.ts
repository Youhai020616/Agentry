/**
 * Message Store
 * SQLite-backed persistent storage for chat messages.
 *
 * Ensures chat history survives Gateway restarts by caching messages locally.
 * Messages are keyed by sessionKey and stored chronologically.
 *
 * Design decisions:
 * - Uses the same SQLite pattern as TaskQueue (better-sqlite3, WAL mode)
 * - Separate DB file (clawx-messages.db) to avoid coupling with task data
 * - Supports upsert to handle re-syncs from Gateway without duplicates
 * - Provides efficient pagination for history loading
 * - Stores raw message JSON to preserve all provider-specific fields
 */
import { EventEmitter } from 'node:events';
import { app } from 'electron';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { logger } from '../utils/logger';

// ── SQL Schema ───────────────────────────────────────────────────────

const CREATE_MESSAGES_TABLE = `
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sessionKey TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  timestamp INTEGER NOT NULL,
  runId TEXT,
  providerId TEXT,
  model TEXT,
  stopReason TEXT,
  toolCalls TEXT,
  attachedFiles TEXT,
  raw TEXT,
  createdAt INTEGER NOT NULL
);`;

const CREATE_MESSAGES_INDEX = `
CREATE INDEX IF NOT EXISTS idx_messages_session_ts
  ON messages (sessionKey, timestamp ASC);`;

const CREATE_SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS session_meta (
  sessionKey TEXT PRIMARY KEY,
  label TEXT,
  employeeId TEXT,
  systemPrompt TEXT,
  model TEXT,
  lastActivityAt INTEGER NOT NULL,
  messageCount INTEGER NOT NULL DEFAULT 0
);`;

// ── Row types ────────────────────────────────────────────────────────

export interface StoredMessage {
  id: string;
  sessionKey: string;
  role: string;
  content: string;
  timestamp: number;
  runId?: string;
  providerId?: string;
  model?: string;
  stopReason?: string;
  toolCalls?: unknown[];
  attachedFiles?: unknown[];
  raw?: Record<string, unknown>;
}

interface MessageRow {
  id: string;
  sessionKey: string;
  role: string;
  content: string;
  timestamp: number;
  runId: string | null;
  providerId: string | null;
  model: string | null;
  stopReason: string | null;
  toolCalls: string | null;
  attachedFiles: string | null;
  raw: string | null;
  createdAt: number;
}

export interface SessionMeta {
  sessionKey: string;
  label?: string;
  employeeId?: string;
  systemPrompt?: string;
  model?: string;
  lastActivityAt: number;
  messageCount: number;
}

interface SessionMetaRow {
  sessionKey: string;
  label: string | null;
  employeeId: string | null;
  systemPrompt: string | null;
  model: string | null;
  lastActivityAt: number;
  messageCount: number;
}

export interface SaveMessageInput {
  id: string;
  sessionKey: string;
  role: string;
  content: string;
  timestamp?: number;
  runId?: string;
  providerId?: string;
  model?: string;
  stopReason?: string;
  toolCalls?: unknown[];
  attachedFiles?: unknown[];
  raw?: Record<string, unknown>;
}

// ── MessageStore ─────────────────────────────────────────────────────

/**
 * MessageStore — SQLite-backed chat message persistence
 *
 * Events:
 *  - 'message-saved'   (message: StoredMessage)
 *  - 'messages-synced'  (sessionKey: string, count: number)
 *  - 'session-cleared'  (sessionKey: string)
 */
export class MessageStore extends EventEmitter {
  private db!: Database.Database;
  private dbPath: string;

  // Prepared statements
  private stmtUpsertMessage!: Database.Statement;
  private stmtGetMessage!: Database.Statement;
  private stmtListMessages!: Database.Statement;
  private stmtListMessagesPaginated!: Database.Statement;
  private stmtCountMessages!: Database.Statement;
  private stmtDeleteMessage!: Database.Statement;
  private stmtDeleteSessionMessages!: Database.Statement;
  private stmtUpsertSessionMeta!: Database.Statement;
  private stmtGetSessionMeta!: Database.Statement;
  private stmtListSessionMeta!: Database.Statement;
  private stmtDeleteSessionMeta!: Database.Statement;
  private stmtGetLatestMessage!: Database.Statement;
  private stmtListSessionKeys!: Database.Statement;

  constructor(dbPath?: string) {
    super();
    this.dbPath = dbPath ?? join(app.getPath('userData'), 'clawx-messages.db');
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  /**
   * Initialize — open database, create tables, prepare statements
   */
  init(): void {
    logger.info('MessageStore initializing...');
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');

      this.db.exec(CREATE_MESSAGES_TABLE);
      this.db.exec(CREATE_MESSAGES_INDEX);
      this.db.exec(CREATE_SESSIONS_TABLE);

      this.prepareStatements();
      logger.info(`MessageStore initialized (db: ${this.dbPath})`);
    } catch (err) {
      logger.error(`MessageStore failed to initialize: ${err}`);
      throw err;
    }
  }

  /**
   * Destroy — close database connection and remove listeners
   */
  destroy(): void {
    logger.info('MessageStore destroying...');
    try {
      if (this.db?.open) {
        this.db.close();
      }
    } catch (err) {
      logger.error(`MessageStore failed to close database: ${err}`);
    }
    this.removeAllListeners();
  }

  /**
   * Expose the database instance (for testing or advanced queries)
   */
  getDb(): Database.Database {
    return this.db;
  }

  // ── Message CRUD ─────────────────────────────────────────────────

  /**
   * Save (upsert) a message. If a message with the same ID exists, it is updated.
   */
  save(input: SaveMessageInput): StoredMessage {
    const now = Date.now();
    const timestamp = input.timestamp ?? now;

    try {
      this.stmtUpsertMessage.run({
        id: input.id,
        sessionKey: input.sessionKey,
        role: input.role,
        content: input.content,
        timestamp,
        runId: input.runId ?? null,
        providerId: input.providerId ?? null,
        model: input.model ?? null,
        stopReason: input.stopReason ?? null,
        toolCalls: input.toolCalls ? JSON.stringify(input.toolCalls) : null,
        attachedFiles: input.attachedFiles ? JSON.stringify(input.attachedFiles) : null,
        raw: input.raw ? JSON.stringify(input.raw) : null,
        createdAt: now,
      });

      // Update session meta
      this.touchSession(input.sessionKey);

      const message = this.rowToMessage({
        id: input.id,
        sessionKey: input.sessionKey,
        role: input.role,
        content: input.content,
        timestamp,
        runId: input.runId ?? null,
        providerId: input.providerId ?? null,
        model: input.model ?? null,
        stopReason: input.stopReason ?? null,
        toolCalls: input.toolCalls ? JSON.stringify(input.toolCalls) : null,
        attachedFiles: input.attachedFiles ? JSON.stringify(input.attachedFiles) : null,
        raw: input.raw ? JSON.stringify(input.raw) : null,
        createdAt: now,
      });

      this.emit('message-saved', message);
      return message;
    } catch (err) {
      logger.error(`Failed to save message ${input.id}: ${err}`);
      throw err;
    }
  }

  /**
   * Save multiple messages in a single transaction (bulk sync)
   */
  saveMany(messages: SaveMessageInput[]): number {
    if (messages.length === 0) return 0;

    const sessionKey = messages[0]?.sessionKey;
    let saved = 0;

    const txn = this.db.transaction(() => {
      for (const msg of messages) {
        try {
          this.save(msg);
          saved++;
        } catch (err) {
          logger.warn(`Failed to save message ${msg.id} during bulk save: ${err}`);
        }
      }
    });

    txn();

    if (sessionKey) {
      this.emit('messages-synced', sessionKey, saved);
    }

    logger.info(`MessageStore: bulk saved ${saved}/${messages.length} messages`);
    return saved;
  }

  /**
   * Get a single message by ID
   */
  get(id: string): StoredMessage | undefined {
    try {
      const row = this.stmtGetMessage.get(id) as MessageRow | undefined;
      return row ? this.rowToMessage(row) : undefined;
    } catch (err) {
      logger.error(`Failed to get message ${id}: ${err}`);
      throw err;
    }
  }

  /**
   * List messages for a session, ordered by timestamp ASC
   */
  listBySession(sessionKey: string, limit = 200, offset = 0): StoredMessage[] {
    try {
      if (offset > 0) {
        const rows = this.stmtListMessagesPaginated.all(sessionKey, limit, offset) as MessageRow[];
        return rows.map((r) => this.rowToMessage(r));
      }
      const rows = this.stmtListMessages.all(sessionKey, limit) as MessageRow[];
      return rows.map((r) => this.rowToMessage(r));
    } catch (err) {
      logger.error(`Failed to list messages for session ${sessionKey}: ${err}`);
      throw err;
    }
  }

  /**
   * Count messages for a session
   */
  countBySession(sessionKey: string): number {
    try {
      const row = this.stmtCountMessages.get(sessionKey) as { count: number } | undefined;
      return row?.count ?? 0;
    } catch (err) {
      logger.error(`Failed to count messages for session ${sessionKey}: ${err}`);
      return 0;
    }
  }

  /**
   * Get the latest message for a session
   */
  getLatest(sessionKey: string): StoredMessage | undefined {
    try {
      const row = this.stmtGetLatestMessage.get(sessionKey) as MessageRow | undefined;
      return row ? this.rowToMessage(row) : undefined;
    } catch (err) {
      logger.error(`Failed to get latest message for session ${sessionKey}: ${err}`);
      return undefined;
    }
  }

  /**
   * Delete a single message by ID
   */
  deleteMessage(id: string): boolean {
    try {
      const result = this.stmtDeleteMessage.run(id);
      return result.changes > 0;
    } catch (err) {
      logger.error(`Failed to delete message ${id}: ${err}`);
      return false;
    }
  }

  /**
   * Delete all messages for a session
   */
  clearSession(sessionKey: string): number {
    try {
      const result = this.stmtDeleteSessionMessages.run(sessionKey);
      this.stmtDeleteSessionMeta.run(sessionKey);
      this.emit('session-cleared', sessionKey);
      logger.info(`Cleared ${result.changes} messages for session ${sessionKey}`);
      return result.changes;
    } catch (err) {
      logger.error(`Failed to clear session ${sessionKey}: ${err}`);
      return 0;
    }
  }

  /**
   * List all session keys that have stored messages
   */
  listSessionKeys(): string[] {
    try {
      const rows = this.stmtListSessionKeys.all() as Array<{ sessionKey: string }>;
      return rows.map((r) => r.sessionKey);
    } catch (err) {
      logger.error(`Failed to list session keys: ${err}`);
      return [];
    }
  }

  // ── Session Meta ─────────────────────────────────────────────────

  /**
   * Update or create session metadata
   */
  updateSessionMeta(
    sessionKey: string,
    meta: Partial<Omit<SessionMeta, 'sessionKey' | 'messageCount' | 'lastActivityAt'>>
  ): void {
    try {
      const existing = this.getSessionMeta(sessionKey);
      const count = this.countBySession(sessionKey);

      this.stmtUpsertSessionMeta.run({
        sessionKey,
        label: meta.label ?? existing?.label ?? null,
        employeeId: meta.employeeId ?? existing?.employeeId ?? null,
        systemPrompt: meta.systemPrompt ?? existing?.systemPrompt ?? null,
        model: meta.model ?? existing?.model ?? null,
        lastActivityAt: Date.now(),
        messageCount: count,
      });
    } catch (err) {
      logger.error(`Failed to update session meta for ${sessionKey}: ${err}`);
    }
  }

  /**
   * Get session metadata
   */
  getSessionMeta(sessionKey: string): SessionMeta | undefined {
    try {
      const row = this.stmtGetSessionMeta.get(sessionKey) as SessionMetaRow | undefined;
      if (!row) return undefined;

      return {
        sessionKey: row.sessionKey,
        label: row.label ?? undefined,
        employeeId: row.employeeId ?? undefined,
        systemPrompt: row.systemPrompt ?? undefined,
        model: row.model ?? undefined,
        lastActivityAt: row.lastActivityAt,
        messageCount: row.messageCount,
      };
    } catch (err) {
      logger.error(`Failed to get session meta for ${sessionKey}: ${err}`);
      return undefined;
    }
  }

  /**
   * List all session metadata, ordered by last activity descending
   */
  listSessionMeta(): SessionMeta[] {
    try {
      const rows = this.stmtListSessionMeta.all() as SessionMetaRow[];
      return rows.map((row) => ({
        sessionKey: row.sessionKey,
        label: row.label ?? undefined,
        employeeId: row.employeeId ?? undefined,
        systemPrompt: row.systemPrompt ?? undefined,
        model: row.model ?? undefined,
        lastActivityAt: row.lastActivityAt,
        messageCount: row.messageCount,
      }));
    } catch (err) {
      logger.error(`Failed to list session meta: ${err}`);
      return [];
    }
  }

  // ── Sync helper ──────────────────────────────────────────────────

  /**
   * Sync messages from Gateway history response.
   * Merges Gateway messages with local store, avoiding duplicates.
   *
   * @param sessionKey  The session to sync
   * @param gatewayMessages  Messages from Gateway's chat.history response
   * @returns Number of new messages added
   */
  syncFromGateway(
    sessionKey: string,
    gatewayMessages: Array<Record<string, unknown>>
  ): number {
    let newCount = 0;

    const txn = this.db.transaction(() => {
      for (const msg of gatewayMessages) {
        const id =
          (msg.id as string) ??
          (msg.providerId as string) ??
          `gw-${sessionKey}-${msg.timestamp ?? Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Extract content from various possible formats
        let content = '';
        if (typeof msg.content === 'string') {
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          content = (msg.content as Array<{ type?: string; text?: string }>)
            .filter((b) => b.type === 'text' || !b.type)
            .map((b) => b.text ?? '')
            .join('\n');
        }

        const existing = this.get(id);
        if (!existing) {
          this.save({
            id,
            sessionKey,
            role: (msg.role as string) ?? 'unknown',
            content,
            timestamp: (msg.timestamp as number) ?? Date.now(),
            runId: msg.runId as string | undefined,
            providerId: msg.providerId as string | undefined,
            model: msg.model as string | undefined,
            stopReason: msg.stopReason as string | undefined,
            toolCalls: msg.toolCalls as unknown[] | undefined,
            attachedFiles: (msg._attachedFiles ?? msg.attachedFiles) as unknown[] | undefined,
            raw: msg as Record<string, unknown>,
          });
          newCount++;
        }
      }
    });

    txn();

    if (newCount > 0) {
      logger.info(
        `MessageStore: synced ${newCount} new messages from Gateway for session ${sessionKey}`
      );
    }

    return newCount;
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Touch session metadata (update lastActivityAt and messageCount)
   */
  private touchSession(sessionKey: string): void {
    try {
      const count = this.countBySession(sessionKey);
      const existing = this.getSessionMeta(sessionKey);

      this.stmtUpsertSessionMeta.run({
        sessionKey,
        label: existing?.label ?? null,
        employeeId: existing?.employeeId ?? null,
        systemPrompt: existing?.systemPrompt ?? null,
        model: existing?.model ?? null,
        lastActivityAt: Date.now(),
        messageCount: count,
      });
    } catch (err) {
      // Non-fatal — session meta is supplementary
      logger.debug(`Failed to touch session meta for ${sessionKey}: ${err}`);
    }
  }

  /**
   * Convert a database row to a StoredMessage
   */
  private rowToMessage(row: MessageRow): StoredMessage {
    const msg: StoredMessage = {
      id: row.id,
      sessionKey: row.sessionKey,
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
    };

    if (row.runId) msg.runId = row.runId;
    if (row.providerId) msg.providerId = row.providerId;
    if (row.model) msg.model = row.model;
    if (row.stopReason) msg.stopReason = row.stopReason;

    if (row.toolCalls) {
      try {
        msg.toolCalls = JSON.parse(row.toolCalls);
      } catch {
        /* malformed JSON, skip */
      }
    }

    if (row.attachedFiles) {
      try {
        msg.attachedFiles = JSON.parse(row.attachedFiles);
      } catch {
        /* malformed JSON, skip */
      }
    }

    if (row.raw) {
      try {
        msg.raw = JSON.parse(row.raw);
      } catch {
        /* malformed JSON, skip */
      }
    }

    return msg;
  }

  /**
   * Prepare all SQL statements for reuse
   */
  private prepareStatements(): void {
    this.stmtUpsertMessage = this.db.prepare(`
      INSERT INTO messages (id, sessionKey, role, content, timestamp, runId, providerId, model, stopReason, toolCalls, attachedFiles, raw, createdAt)
      VALUES (@id, @sessionKey, @role, @content, @timestamp, @runId, @providerId, @model, @stopReason, @toolCalls, @attachedFiles, @raw, @createdAt)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        timestamp = excluded.timestamp,
        runId = COALESCE(excluded.runId, messages.runId),
        providerId = COALESCE(excluded.providerId, messages.providerId),
        model = COALESCE(excluded.model, messages.model),
        stopReason = COALESCE(excluded.stopReason, messages.stopReason),
        toolCalls = COALESCE(excluded.toolCalls, messages.toolCalls),
        attachedFiles = COALESCE(excluded.attachedFiles, messages.attachedFiles),
        raw = COALESCE(excluded.raw, messages.raw)
    `);

    this.stmtGetMessage = this.db.prepare(
      'SELECT * FROM messages WHERE id = ?'
    );

    this.stmtListMessages = this.db.prepare(
      'SELECT * FROM messages WHERE sessionKey = ? ORDER BY timestamp ASC LIMIT ?'
    );

    this.stmtListMessagesPaginated = this.db.prepare(
      'SELECT * FROM messages WHERE sessionKey = ? ORDER BY timestamp ASC LIMIT ? OFFSET ?'
    );

    this.stmtCountMessages = this.db.prepare(
      'SELECT COUNT(*) as count FROM messages WHERE sessionKey = ?'
    );

    this.stmtGetLatestMessage = this.db.prepare(
      'SELECT * FROM messages WHERE sessionKey = ? ORDER BY timestamp DESC LIMIT 1'
    );

    this.stmtDeleteMessage = this.db.prepare(
      'DELETE FROM messages WHERE id = ?'
    );

    this.stmtDeleteSessionMessages = this.db.prepare(
      'DELETE FROM messages WHERE sessionKey = ?'
    );

    this.stmtListSessionKeys = this.db.prepare(
      'SELECT DISTINCT sessionKey FROM messages ORDER BY sessionKey'
    );

    // Session meta statements
    this.stmtUpsertSessionMeta = this.db.prepare(`
      INSERT INTO session_meta (sessionKey, label, employeeId, systemPrompt, model, lastActivityAt, messageCount)
      VALUES (@sessionKey, @label, @employeeId, @systemPrompt, @model, @lastActivityAt, @messageCount)
      ON CONFLICT(sessionKey) DO UPDATE SET
        label = COALESCE(excluded.label, session_meta.label),
        employeeId = COALESCE(excluded.employeeId, session_meta.employeeId),
        systemPrompt = COALESCE(excluded.systemPrompt, session_meta.systemPrompt),
        model = COALESCE(excluded.model, session_meta.model),
        lastActivityAt = excluded.lastActivityAt,
        messageCount = excluded.messageCount
    `);

    this.stmtGetSessionMeta = this.db.prepare(
      'SELECT * FROM session_meta WHERE sessionKey = ?'
    );

    this.stmtListSessionMeta = this.db.prepare(
      'SELECT * FROM session_meta ORDER BY lastActivityAt DESC'
    );

    this.stmtDeleteSessionMeta = this.db.prepare(
      'DELETE FROM session_meta WHERE sessionKey = ?'
    );
  }
}
