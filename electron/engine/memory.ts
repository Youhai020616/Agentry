/**
 * Memory Engine
 * File-backed episodic and brand memory for AI employees.
 *
 * Storage layout:
 *   ~/.clawx/employees/{employeeId}/MEMORY.md  — per-employee episodic memories
 *   ~/.clawx/shared/BRAND.md                   — shared brand context
 *
 * Events:
 *  - 'memory-changed' ({ type: string, action: string }) — emitted after mutations
 */
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { logger } from '../utils/logger';
import type { EpisodicMemory } from '../../src/types/memory';

// ── Constants ────────────────────────────────────────────────────────

const CLAWX_DIR = join(homedir(), '.clawx');
const EMPLOYEES_DIR = join(CLAWX_DIR, 'employees');
const SHARED_DIR = join(CLAWX_DIR, 'shared');
const BRAND_FILE = join(SHARED_DIR, 'BRAND.md');

// ── MemoryEngine ─────────────────────────────────────────────────────

export class MemoryEngine extends EventEmitter {
  // ── Lifecycle ────────────────────────────────────────────────────

  /**
   * Initialize — create directories, auto-detect SQLite migration
   */
  init(): void {
    logger.info('MemoryEngine initializing (file-backed)...');
    try {
      mkdirSync(EMPLOYEES_DIR, { recursive: true });
      mkdirSync(SHARED_DIR, { recursive: true });

      // Auto-detect old SQLite database and migrate if present
      this.autoMigrate();

      logger.info('MemoryEngine initialized (file-backed)');
    } catch (err) {
      logger.error(`MemoryEngine failed to initialize: ${err}`);
      throw err;
    }
  }

  /**
   * Destroy — remove listeners
   */
  destroy(): void {
    logger.info('MemoryEngine destroying...');
    this.removeAllListeners();
  }

  // ── Episodic Memory ──────────────────────────────────────────────

  /**
   * Store a new episodic memory for an employee (append to MEMORY.md).
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
    const now = new Date().toISOString();
    const clampedImportance = Math.max(1, Math.min(5, importance));

    const entry = this.formatMemoryEntry(id, now, clampedImportance, tags, taskId, content);

    const memoryFile = this.getMemoryFilePath(employeeId);
    this.ensureEmployeeDir(employeeId);

    try {
      appendFileSync(memoryFile, entry, 'utf-8');
      logger.debug(`Episodic memory stored: ${id} for employee ${employeeId}`);
      this.emit('memory-changed', { type: 'episodic', action: 'store' });
      return id;
    } catch (err) {
      logger.error(`Failed to store episodic memory: ${err}`);
      throw err;
    }
  }

  /**
   * Recall the most recent memories for an employee.
   * Parses MEMORY.md and returns up to `limit` entries (newest first).
   */
  recall(employeeId: string, limit: number = 10): EpisodicMemory[] {
    const memoryFile = this.getMemoryFilePath(employeeId);
    if (!existsSync(memoryFile)) return [];

    try {
      const content = readFileSync(memoryFile, 'utf-8');
      const entries = this.parseMemoryFile(content, employeeId);
      // Return newest first, limited
      return entries.reverse().slice(0, limit);
    } catch (err) {
      logger.error(`Failed to recall memories for employee ${employeeId}: ${err}`);
      throw err;
    }
  }

  /**
   * Get the total count of episodic memories for an employee.
   */
  getEpisodicCount(employeeId: string): number {
    const memoryFile = this.getMemoryFilePath(employeeId);
    if (!existsSync(memoryFile)) return 0;

    try {
      const content = readFileSync(memoryFile, 'utf-8');
      // Count entry headers (## lines with ISO timestamp)
      return (content.match(/^## \d{4}-\d{2}-\d{2}T/gm) || []).length;
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

  // ── Brand Context ──────────────────────────────────────────────

  /**
   * Set brand context (writes entire BRAND.md).
   */
  setBrandContext(markdown: string): void {
    try {
      writeFileSync(BRAND_FILE, markdown, 'utf-8');
      logger.debug('Brand context updated');
      this.emit('memory-changed', { type: 'brand', action: 'set' });
    } catch (err) {
      logger.error(`Failed to set brand context: ${err}`);
      throw err;
    }
  }

  /**
   * Get brand context (reads entire BRAND.md).
   */
  getBrandContext(): string {
    if (!existsSync(BRAND_FILE)) return '';
    try {
      return readFileSync(BRAND_FILE, 'utf-8');
    } catch (err) {
      logger.error(`Failed to get brand context: ${err}`);
      return '';
    }
  }

  /**
   * Generate a [Business Context] prompt section from BRAND.md.
   * Returns an empty string when no brand context exists.
   */
  generateBusinessContextSection(): string {
    const brand = this.getBrandContext();
    if (!brand.trim()) return '';

    return `\n\n## Business Context\n\n${brand}`;
  }

  // ── File Access ────────────────────────────────────────────────

  /**
   * Get the raw MEMORY.md content for an employee.
   */
  getMemoryFile(employeeId: string): string {
    const memoryFile = this.getMemoryFilePath(employeeId);
    if (!existsSync(memoryFile)) return '';
    try {
      return readFileSync(memoryFile, 'utf-8');
    } catch (err) {
      logger.error(`Failed to read memory file for ${employeeId}: ${err}`);
      return '';
    }
  }

  // ── Migration ──────────────────────────────────────────────────

  /**
   * Migrate episodic and semantic memories from an old SQLite database to files.
   * @returns counts of migrated records
   */
  static async migrateFromSQLite(
    dbPath: string,
    engine: MemoryEngine
  ): Promise<{ episodic: number; semantic: number }> {
    let Database: typeof import('better-sqlite3');
    try {
      Database = (await import('better-sqlite3')).default;
    } catch {
      logger.warn('better-sqlite3 not available, skipping migration');
      return { episodic: 0, semantic: 0 };
    }

    if (!existsSync(dbPath)) {
      return { episodic: 0, semantic: 0 };
    }

    logger.info(`Migrating from SQLite: ${dbPath}`);
    const db = new Database(dbPath, { readonly: true });

    let episodicCount = 0;
    let semanticCount = 0;

    try {
      // Migrate episodic memories
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='episodic_memories'")
        .all();

      if (tables.length > 0) {
        const rows = db
          .prepare('SELECT * FROM episodic_memories ORDER BY createdAt ASC')
          .all() as Array<{
          id: string;
          employeeId: string;
          taskId: string | null;
          content: string;
          tags: string;
          importance: number;
          createdAt: number;
        }>;

        for (const row of rows) {
          const tags = JSON.parse(row.tags || '[]') as string[];
          engine.storeEpisodic(
            row.employeeId,
            row.content,
            tags,
            row.importance,
            row.taskId ?? undefined
          );
          episodicCount++;
        }
      }

      // Migrate semantic memories → BRAND.md
      const semTables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='semantic_memories'"
        )
        .all();

      if (semTables.length > 0) {
        const semRows = db
          .prepare('SELECT category, key, value FROM semantic_memories ORDER BY category, key')
          .all() as Array<{ category: string; key: string; value: string }>;

        if (semRows.length > 0) {
          const sections: Record<string, Array<{ key: string; value: string }>> = {};
          for (const row of semRows) {
            if (!sections[row.category]) sections[row.category] = [];
            sections[row.category].push({ key: row.key, value: row.value });
            semanticCount++;
          }

          const markdown = Object.entries(sections)
            .map(
              ([category, entries]) =>
                `## ${category.charAt(0).toUpperCase() + category.slice(1)}\n\n` +
                entries.map((e) => `- **${e.key}**: ${e.value}`).join('\n')
            )
            .join('\n\n');

          engine.setBrandContext(markdown);
        }
      }

      logger.info(
        `Migration complete: ${episodicCount} episodic, ${semanticCount} semantic records`
      );
    } finally {
      db.close();
    }

    return { episodic: episodicCount, semantic: semanticCount };
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Ensure the employee memory directory exists.
   */
  ensureEmployeeDir(employeeId: string): void {
    const dir = join(EMPLOYEES_DIR, employeeId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private getMemoryFilePath(employeeId: string): string {
    return join(EMPLOYEES_DIR, employeeId, 'MEMORY.md');
  }

  /**
   * Format a single memory entry as Markdown.
   */
  private formatMemoryEntry(
    id: string,
    timestamp: string,
    importance: number,
    tags: string[],
    taskId: string | undefined,
    content: string
  ): string {
    const lines: string[] = [];
    lines.push(`## ${timestamp}`);
    lines.push(`id: ${id}`);
    lines.push(`importance: ${importance}`);
    if (tags.length > 0) {
      lines.push(`tags: ${tags.join(', ')}`);
    }
    if (taskId) {
      lines.push(`task: ${taskId}`);
    }
    lines.push('');
    lines.push(content);
    lines.push('');
    lines.push('---');
    lines.push('');
    return lines.join('\n');
  }

  /**
   * Parse a MEMORY.md file into EpisodicMemory objects.
   * Entries are returned in file order (oldest first).
   */
  private parseMemoryFile(fileContent: string, employeeId: string): EpisodicMemory[] {
    if (!fileContent.trim()) return [];

    const entries: EpisodicMemory[] = [];
    // Split on --- separator
    const blocks = fileContent.split(/^---$/m);

    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;

      // Parse header: ## <timestamp>
      const headerMatch = trimmed.match(/^## (\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/m);
      if (!headerMatch) continue;

      const timestamp = headerMatch[1];
      const createdAt = new Date(timestamp).getTime();
      if (isNaN(createdAt)) continue;

      // Parse metadata lines
      const idMatch = trimmed.match(/^id: (.+)$/m);
      const importanceMatch = trimmed.match(/^importance: (\d+)$/m);
      const tagsMatch = trimmed.match(/^tags: (.+)$/m);
      const taskMatch = trimmed.match(/^task: (.+)$/m);

      const id = idMatch?.[1] ?? crypto.randomUUID();
      const importance = importanceMatch ? parseInt(importanceMatch[1], 10) : 3;
      const tags = tagsMatch ? tagsMatch[1].split(',').map((t) => t.trim()) : [];
      const taskId = taskMatch?.[1];

      // Content is everything after the metadata lines
      const lines = trimmed.split('\n');
      const contentLines: string[] = [];
      let pastMeta = false;
      for (const line of lines) {
        if (
          !pastMeta &&
          (line.startsWith('## ') ||
            line.startsWith('id: ') ||
            line.startsWith('importance: ') ||
            line.startsWith('tags: ') ||
            line.startsWith('task: ') ||
            line.trim() === '')
        ) {
          if (
            line.startsWith('id: ') ||
            line.startsWith('importance: ') ||
            line.startsWith('tags: ') ||
            line.startsWith('task: ') ||
            line.startsWith('## ')
          ) {
            continue;
          }
          // Skip leading empty lines between metadata and content
          if (line.trim() === '' && contentLines.length === 0) {
            continue;
          }
        }
        pastMeta = true;
        contentLines.push(line);
      }

      const content = contentLines.join('\n').trim();
      if (!content) continue;

      entries.push({
        id,
        employeeId,
        taskId,
        content,
        tags,
        importance,
        createdAt,
      });
    }

    return entries;
  }

  /**
   * Auto-detect old SQLite database and migrate if present.
   */
  private autoMigrate(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require('electron') as typeof import('electron');
      const oldDbPath = join(app.getPath('userData'), 'clawx-memory.db');
      if (existsSync(oldDbPath)) {
        logger.info('Old SQLite memory database detected, auto-migrating...');
        // Run migration asynchronously — don't block init
        void MemoryEngine.migrateFromSQLite(oldDbPath, this).catch((err) => {
          logger.warn(`Auto-migration from SQLite failed: ${err}`);
        });
      }
    } catch {
      // app not available (e.g. in tests), skip migration check
    }
  }
}
