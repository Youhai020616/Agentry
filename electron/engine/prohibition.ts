/**
 * Prohibition Engine
 * SQLite-backed rules & restrictions system for AI employees.
 * Hard rules cannot be overridden; soft rules require confirmation.
 *
 * Events:
 *  - 'prohibitions-changed' — emitted after mutations
 */
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { app } from 'electron';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger';

// ── Types ────────────────────────────────────────────────────────────

export type ProhibitionLevel = 'hard' | 'soft';

export interface Prohibition {
  id: string;
  level: ProhibitionLevel;
  rule: string;
  description: string;
  employeeId?: string; // null = applies to all employees
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// ── Row type ─────────────────────────────────────────────────────────

interface ProhibitionRow {
  id: string;
  level: string;
  rule: string;
  description: string;
  employeeId: string | null;
  enabled: number;
  createdAt: number;
  updatedAt: number;
}

// ── SQL Schema ───────────────────────────────────────────────────────

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS prohibitions (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL DEFAULT 'hard',
  rule TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  employeeId TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
)`;

// ── Default rules ────────────────────────────────────────────────────

const DEFAULT_RULES: Array<{ level: ProhibitionLevel; rule: string; description: string }> = [
  {
    level: 'hard',
    rule: 'Never share API keys or secrets in responses',
    description: 'Prevents accidental exposure of sensitive credentials',
  },
  {
    level: 'hard',
    rule: 'Never execute destructive operations without explicit confirmation',
    description: 'Prevents accidental data loss or system damage',
  },
  {
    level: 'soft',
    rule: 'Ask for confirmation before making changes that affect pricing or billing',
    description: 'Requires human approval for financial changes',
  },
];

// ── ProhibitionEngine ────────────────────────────────────────────────

export class ProhibitionEngine extends EventEmitter {
  private db!: Database.Database;
  private dbPath: string;

  constructor(dbPath?: string) {
    super();
    this.dbPath = dbPath ?? join(app.getPath('userData'), 'clawx-prohibitions.db');
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  init(): void {
    logger.info('ProhibitionEngine initializing...');
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');

      this.db.exec(CREATE_TABLE);

      // Seed default rules for new installs
      const row = this.db.prepare('SELECT COUNT(*) as cnt FROM prohibitions').get() as {
        cnt: number;
      };
      if (row.cnt === 0) {
        this.seedDefaults();
      }

      logger.info(`ProhibitionEngine initialized (db: ${this.dbPath})`);
    } catch (err) {
      logger.error(`ProhibitionEngine failed to initialize: ${err}`);
      throw err;
    }
  }

  destroy(): void {
    logger.info('ProhibitionEngine destroying...');
    try {
      if (this.db?.open) {
        this.db.close();
      }
    } catch (err) {
      logger.error(`ProhibitionEngine failed to close database: ${err}`);
    }
    this.removeAllListeners();
  }

  // ── CRUD ───────────────────────────────────────────────────────

  create(
    level: ProhibitionLevel,
    rule: string,
    description: string = '',
    employeeId?: string
  ): string {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO prohibitions (id, level, rule, description, employeeId, enabled, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(id, level, rule, description, employeeId ?? null, now, now);
    this.emit('prohibitions-changed');
    return id;
  }

  update(
    id: string,
    updates: Partial<Pick<Prohibition, 'level' | 'rule' | 'description' | 'enabled'>>
  ): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.level !== undefined) {
      fields.push('level = ?');
      values.push(updates.level);
    }
    if (updates.rule !== undefined) {
      fields.push('rule = ?');
      values.push(updates.rule);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(updates.enabled ? 1 : 0);
    }

    if (fields.length === 0) return;

    fields.push('updatedAt = ?');
    values.push(Date.now());
    values.push(id);

    this.db.prepare(`UPDATE prohibitions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    this.emit('prohibitions-changed');
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM prohibitions WHERE id = ?').run(id);
    this.emit('prohibitions-changed');
  }

  /**
   * List enabled prohibitions for a specific employee (includes global rules).
   * If no employeeId provided, returns all prohibitions (including disabled).
   */
  list(employeeId?: string): Prohibition[] {
    let rows: ProhibitionRow[];
    if (employeeId) {
      rows = this.db
        .prepare(
          'SELECT * FROM prohibitions WHERE (employeeId IS NULL OR employeeId = ?) AND enabled = 1 ORDER BY level, createdAt'
        )
        .all(employeeId) as ProhibitionRow[];
    } else {
      rows = this.db
        .prepare('SELECT * FROM prohibitions ORDER BY level, createdAt')
        .all() as ProhibitionRow[];
    }
    return rows.map((row) => this.rowToProhibition(row));
  }

  /**
   * List all prohibitions regardless of status.
   */
  listAll(): Prohibition[] {
    const rows = this.db
      .prepare('SELECT * FROM prohibitions ORDER BY level, createdAt')
      .all() as ProhibitionRow[];
    return rows.map((row) => this.rowToProhibition(row));
  }

  /**
   * Generate [Rules & Restrictions] prompt section for system prompt injection.
   */
  generateProhibitionPromptSection(employeeId?: string): string {
    const prohibitions = this.list(employeeId);
    if (prohibitions.length === 0) return '';

    const hardRules = prohibitions.filter((p) => p.level === 'hard');
    const softRules = prohibitions.filter((p) => p.level === 'soft');

    const sections: string[] = [];

    if (hardRules.length > 0) {
      sections.push(
        '### Hard Rules (MUST NOT violate)\n' +
          hardRules.map((r, i) => `${i + 1}. ${r.rule}`).join('\n')
      );
    }

    if (softRules.length > 0) {
      sections.push(
        '### Soft Rules (Require confirmation to override)\n' +
          softRules.map((r, i) => `${i + 1}. ${r.rule}`).join('\n')
      );
    }

    return `\n\n## Rules & Restrictions\n\n${sections.join('\n\n')}`;
  }

  // ── Private helpers ────────────────────────────────────────────

  private seedDefaults(): void {
    const stmt = this.db.prepare(
      `INSERT INTO prohibitions (id, level, rule, description, enabled, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
    );

    const now = Date.now();
    for (const d of DEFAULT_RULES) {
      stmt.run(randomUUID(), d.level, d.rule, d.description, now, now);
    }
    logger.info(`Seeded ${DEFAULT_RULES.length} default prohibition rules`);
  }

  private rowToProhibition(row: ProhibitionRow): Prohibition {
    return {
      id: row.id,
      level: row.level as ProhibitionLevel,
      rule: row.rule,
      description: row.description,
      employeeId: row.employeeId ?? undefined,
      enabled: Boolean(row.enabled),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
