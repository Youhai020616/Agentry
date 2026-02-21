/**
 * Memory Engine
 * SQLite-backed episodic and semantic memory for AI employees.
 * Episodic memories capture past task experiences; semantic memories store
 * long-term factual knowledge (Phase 2).
 *
 * Events:
 *  - 'memory-changed' ({ type: MemoryType, action: string }) — emitted after mutations
 */
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { app } from 'electron';
import Database from 'better-sqlite3';
import { logger } from '../utils/logger';
import type { EpisodicMemory, MemoryType } from '../../src/types/memory';

// ── SQL Schema ───────────────────────────────────────────────────────

const CREATE_EPISODIC_TABLE = `
CREATE TABLE IF NOT EXISTS episodic_memories (
  id TEXT PRIMARY KEY,
  employeeId TEXT NOT NULL,
  taskId TEXT,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  importance INTEGER NOT NULL DEFAULT 3,
  createdAt INTEGER NOT NULL
)`;

const CREATE_SEMANTIC_TABLE = `
CREATE TABLE IF NOT EXISTS semantic_memories (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(category, key)
)`;

// ── Row types ────────────────────────────────────────────────────────

interface EpisodicRow {
  id: string;
  employeeId: string;
  taskId: string | null;
  content: string;
  tags: string;
  importance: number;
  createdAt: number;
}

// ── MemoryEngine ─────────────────────────────────────────────────────

export class MemoryEngine extends EventEmitter {
  private db!: Database.Database;
  private dbPath: string;

  // Prepared statements (set in init)
  private stmtInsert!: Database.Statement;
  private stmtRecall!: Database.Statement;
  private stmtSearch!: Database.Statement;
  private stmtDelete!: Database.Statement;
  private stmtCount!: Database.Statement;

  constructor(dbPath?: string) {
    super();
    this.dbPath = dbPath ?? join(app.getPath('userData'), 'clawx-memory.db');
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  /**
   * Initialize — open database, create tables, prepare statements
   */
  init(): void {
    logger.info('MemoryEngine initializing...');
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');

      this.db.exec(CREATE_EPISODIC_TABLE);

      // Indexes for fast lookups
      this.db.exec(
        'CREATE INDEX IF NOT EXISTS idx_episodic_employee ON episodic_memories(employeeId)'
      );
      this.db.exec(
        'CREATE INDEX IF NOT EXISTS idx_episodic_importance ON episodic_memories(importance DESC)'
      );

      // Semantic memories table (schema ready for Phase 2)
      this.db.exec(CREATE_SEMANTIC_TABLE);

      this.prepareStatements();
      logger.info(`MemoryEngine initialized (db: ${this.dbPath})`);
    } catch (err) {
      logger.error(`MemoryEngine failed to initialize: ${err}`);
      throw err;
    }
  }

  /**
   * Destroy — close database connection and remove listeners
   */
  destroy(): void {
    logger.info('MemoryEngine destroying...');
    try {
      if (this.db?.open) {
        this.db.close();
      }
    } catch (err) {
      logger.error(`MemoryEngine failed to close database: ${err}`);
    }
    this.removeAllListeners();
  }

  // ── Episodic Memory ──────────────────────────────────────────────

  /**
   * Store a new episodic memory for an employee.
   * @returns The generated memory ID
   */
  storeEpisodic(
    employeeId: string,
    content: string,
    tags: string[] = [],
    importance: number = 3,
    taskId?: string
  ): string {
    const id = crypto.randomUUID();
    const now = Date.now();

    try {
      this.stmtInsert.run({
        id,
        employeeId,
        taskId: taskId ?? null,
        content,
        tags: JSON.stringify(tags),
        importance: Math.max(1, Math.min(5, importance)),
        createdAt: now,
      });

      logger.debug(`Episodic memory stored: ${id} for employee ${employeeId}`);
      this.emit('memory-changed', { type: 'episodic' as MemoryType, action: 'store' });
      return id;
    } catch (err) {
      logger.error(`Failed to store episodic memory: ${err}`);
      throw err;
    }
  }

  /**
   * Recall the most important and recent memories for an employee.
   */
  recall(employeeId: string, limit: number = 10): EpisodicMemory[] {
    try {
      const rows = this.stmtRecall.all(employeeId, limit) as EpisodicRow[];
      return rows.map((row) => this.rowToEpisodic(row));
    } catch (err) {
      logger.error(`Failed to recall memories for employee ${employeeId}: ${err}`);
      throw err;
    }
  }

  /**
   * Search memories by keyword in content and tags.
   */
  search(employeeId: string, query: string, limit: number = 10): EpisodicMemory[] {
    try {
      const pattern = `%${query}%`;
      const rows = this.stmtSearch.all(employeeId, pattern, pattern, limit) as EpisodicRow[];
      return rows.map((row) => this.rowToEpisodic(row));
    } catch (err) {
      logger.error(`Failed to search memories for employee ${employeeId}: ${err}`);
      throw err;
    }
  }

  /**
   * Delete a specific episodic memory by ID.
   */
  deleteEpisodic(id: string): void {
    try {
      this.stmtDelete.run(id);
      logger.debug(`Episodic memory deleted: ${id}`);
      this.emit('memory-changed', { type: 'episodic' as MemoryType, action: 'delete' });
    } catch (err) {
      logger.error(`Failed to delete episodic memory ${id}: ${err}`);
      throw err;
    }
  }

  /**
   * Get the total count of episodic memories for an employee.
   */
  getEpisodicCount(employeeId: string): number {
    try {
      const result = this.stmtCount.get(employeeId) as { cnt: number };
      return result.cnt;
    } catch (err) {
      logger.error(`Failed to count memories for employee ${employeeId}: ${err}`);
      throw err;
    }
  }

  /**
   * Generate the [Past Experience] section for injection into a system prompt.
   * Returns an empty string when the employee has no memories.
   */
  generateEpisodicPromptSection(employeeId: string, limit: number = 5): string {
    const memories = this.recall(employeeId, limit);
    if (memories.length === 0) return '';

    const memoryLines = memories
      .map(
        (m, i) =>
          `${i + 1}. ${m.content}${m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : ''}`
      )
      .join('\n');

    return `\n\n## Past Experience\n\nYou have the following relevant experiences from previous tasks:\n${memoryLines}`;
  }

  // ── Semantic Memory ──────────────────────────────────────────────

  /**
   * Set a semantic memory key-value pair in a category.
   * Upserts: inserts if new, updates if the (category, key) pair already exists.
   */
  setSemantic(category: string, key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO semantic_memories (id, category, key, value, updatedAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(category, key) DO UPDATE SET value = ?, updatedAt = ?`
      )
      .run(crypto.randomUUID(), category, key, value, Date.now(), value, Date.now());
    this.emit('memory-changed', { type: 'semantic' as MemoryType, action: 'set' });
  }

  /**
   * Get a single semantic memory value by category and key.
   */
  getSemantic(category: string, key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM semantic_memories WHERE category = ? AND key = ?')
      .get(category, key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  /**
   * Get all semantic memory key-value pairs for a given category.
   */
  getSemanticByCategory(category: string): Record<string, string> {
    const rows = this.db
      .prepare('SELECT key, value FROM semantic_memories WHERE category = ?')
      .all(category) as { key: string; value: string }[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  /**
   * Get all semantic memories grouped by category.
   */
  getAllSemantic(): Record<string, Record<string, string>> {
    const rows = this.db
      .prepare('SELECT category, key, value FROM semantic_memories')
      .all() as { category: string; key: string; value: string }[];
    const result: Record<string, Record<string, string>> = {};
    for (const row of rows) {
      if (!result[row.category]) result[row.category] = {};
      result[row.category][row.key] = row.value;
    }
    return result;
  }

  /**
   * Delete a specific semantic memory entry.
   */
  deleteSemantic(category: string, key: string): void {
    this.db
      .prepare('DELETE FROM semantic_memories WHERE category = ? AND key = ?')
      .run(category, key);
    this.emit('memory-changed', { type: 'semantic' as MemoryType, action: 'delete' });
  }

  /**
   * Generate a [Business Context] prompt section from all semantic memories.
   * Returns an empty string when no semantic memories exist.
   */
  generateBusinessContextSection(): string {
    const all = this.getAllSemantic();
    if (Object.keys(all).length === 0) return '';

    const sections: string[] = [];
    if (all.brand) {
      sections.push(
        '### Brand\n' +
          Object.entries(all.brand)
            .map(([k, v]) => `- **${k}**: ${v}`)
            .join('\n')
      );
    }
    if (all.product) {
      sections.push(
        '### Product\n' +
          Object.entries(all.product)
            .map(([k, v]) => `- **${k}**: ${v}`)
            .join('\n')
      );
    }
    if (all.competitor) {
      sections.push(
        '### Competitors\n' +
          Object.entries(all.competitor)
            .map(([k, v]) => `- **${k}**: ${v}`)
            .join('\n')
      );
    }
    if (all.audience) {
      sections.push(
        '### Target Audience\n' +
          Object.entries(all.audience)
            .map(([k, v]) => `- **${k}**: ${v}`)
            .join('\n')
      );
    }

    return `\n\n## Business Context\n\n${sections.join('\n\n')}`;
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Prepare reusable SQL statements
   */
  private prepareStatements(): void {
    this.stmtInsert = this.db.prepare(`
      INSERT INTO episodic_memories (id, employeeId, taskId, content, tags, importance, createdAt)
      VALUES (@id, @employeeId, @taskId, @content, @tags, @importance, @createdAt)
    `);

    this.stmtRecall = this.db.prepare(`
      SELECT * FROM episodic_memories
      WHERE employeeId = ?
      ORDER BY importance DESC, createdAt DESC
      LIMIT ?
    `);

    this.stmtSearch = this.db.prepare(`
      SELECT * FROM episodic_memories
      WHERE employeeId = ? AND (content LIKE ? OR tags LIKE ?)
      ORDER BY importance DESC, createdAt DESC
      LIMIT ?
    `);

    this.stmtDelete = this.db.prepare('DELETE FROM episodic_memories WHERE id = ?');

    this.stmtCount = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM episodic_memories WHERE employeeId = ?'
    );
  }

  /**
   * Convert a SQLite row to an EpisodicMemory object
   */
  private rowToEpisodic(row: EpisodicRow): EpisodicMemory {
    return {
      id: row.id,
      employeeId: row.employeeId,
      taskId: row.taskId ?? undefined,
      content: row.content,
      tags: JSON.parse(row.tags || '[]') as string[],
      importance: row.importance,
      createdAt: row.createdAt,
    };
  }
}
