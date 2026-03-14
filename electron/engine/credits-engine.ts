/**
 * Credits Engine
 * SQLite-backed credits consumption and tracking engine.
 * Handles balance queries, consumption, top-ups, and history.
 */
import { EventEmitter } from 'node:events';
import { app } from 'electron';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { logger } from '../utils/logger';
import type {
  CreditTransaction,
  CreditTransactionType,
  CreditsBalance,
  CreditsDailySummary,
} from '@shared/types/credits';

// ── SQL Schema ───────────────────────────────────────────────────────

const CREATE_CREDIT_TRANSACTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS credit_transactions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  employeeId TEXT,
  taskId TEXT,
  timestamp INTEGER NOT NULL
)`;

// ── Row types (SQLite representation) ────────────────────────────────

interface CreditTransactionRow {
  id: string;
  type: CreditTransactionType;
  amount: number;
  description: string;
  employeeId: string | null;
  taskId: string | null;
  timestamp: number;
}

interface DailySummaryRow {
  day: string;
  consumed: number;
  transactions: number;
}

/**
 * CreditsEngine — SQLite-backed credit balance and transaction management
 *
 * Events:
 *  - 'credits-changed' — emitted after any balance mutation
 */
export class CreditsEngine extends EventEmitter {
  private db!: Database.Database;
  private dbPath: string;

  // Prepared statements (set in init)
  private stmtInsert!: Database.Statement;
  private stmtGetAll!: Database.Statement;
  private stmtGetByEmployee!: Database.Statement;
  private stmtGetByType!: Database.Statement;
  private stmtCount!: Database.Statement;

  constructor(dbPath?: string) {
    super();
    this.dbPath = dbPath ?? join(app.getPath('userData'), 'agentry-credits.db');
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  /**
   * Initialize — open database, create tables, prepare statements, seed if empty
   */
  init(): void {
    logger.info('CreditsEngine initializing...');
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('foreign_keys = ON');

      this.db.exec(CREATE_CREDIT_TRANSACTIONS_TABLE);

      // Indexes for common query patterns
      this.db.exec(
        `CREATE INDEX IF NOT EXISTS idx_credits_timestamp ON credit_transactions(timestamp)`
      );
      this.db.exec(
        `CREATE INDEX IF NOT EXISTS idx_credits_employeeId ON credit_transactions(employeeId)`
      );
      this.db.exec(
        `CREATE INDEX IF NOT EXISTS idx_credits_type ON credit_transactions(type)`
      );

      this.prepareStatements();

      // Seed initial credits for new users (1000 free credits)
      const count = this.stmtCount.get() as { cnt: number };
      if (count.cnt === 0) {
        this.stmtInsert.run({
          id: crypto.randomUUID(),
          type: 'bonus',
          amount: 1000,
          description: 'Welcome bonus',
          employeeId: null,
          taskId: null,
          timestamp: Date.now(),
        });
        logger.info('CreditsEngine seeded 1000 welcome bonus credits');
      }

      logger.info(`CreditsEngine initialized (db: ${this.dbPath})`);
    } catch (err) {
      logger.error(`CreditsEngine failed to initialize: ${err}`);
      throw err;
    }
  }

  /**
   * Destroy — close database connection and remove listeners
   */
  destroy(): void {
    logger.info('CreditsEngine destroying...');
    try {
      if (this.db?.open) {
        this.db.close();
      }
    } catch (err) {
      logger.error(`CreditsEngine failed to close database: ${err}`);
    }
    this.removeAllListeners();
  }

  /**
   * Expose the database instance for sharing with ActivityAggregator
   */
  getDb(): Database.Database {
    return this.db;
  }

  // ── Consumption ────────────────────────────────────────────────────

  /**
   * Consume credits. Returns true if successful, false if insufficient balance.
   */
  consume(
    type: CreditTransactionType,
    amount: number,
    description: string,
    employeeId?: string,
    taskId?: string
  ): boolean {
    const balance = this.getBalance();
    if (balance.remaining < amount) {
      logger.warn(`Insufficient credits: need ${amount}, remaining ${balance.remaining}`);
      return false;
    }

    try {
      this.stmtInsert.run({
        id: crypto.randomUUID(),
        type,
        amount: -amount,
        description,
        employeeId: employeeId ?? null,
        taskId: taskId ?? null,
        timestamp: Date.now(),
      });

      logger.debug(`Credits consumed: ${amount} (${type}) ${employeeId ? `by ${employeeId}` : ''}`);
      this.emit('credits-changed');
      return true;
    } catch (err) {
      logger.error(`Failed to consume credits: ${err}`);
      throw err;
    }
  }

  // ── Top-up / Bonus ────────────────────────────────────────────────

  /**
   * Add credits (top-up or bonus)
   */
  topup(amount: number, description: string = 'Credits top-up'): void {
    try {
      this.stmtInsert.run({
        id: crypto.randomUUID(),
        type: 'topup',
        amount,
        description,
        employeeId: null,
        taskId: null,
        timestamp: Date.now(),
      });

      logger.info(`Credits topped up: +${amount} (${description})`);
      this.emit('credits-changed');
    } catch (err) {
      logger.error(`Failed to top up credits: ${err}`);
      throw err;
    }
  }

  // ── Balance ────────────────────────────────────────────────────────

  /**
   * Get current balance (total income, total consumed, remaining)
   */
  getBalance(): CreditsBalance {
    try {
      const result = this.db
        .prepare(
          `SELECT
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as total,
            COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) as used
          FROM credit_transactions`
        )
        .get() as { total: number; used: number };

      return {
        total: result.total,
        used: result.used,
        remaining: result.total - result.used,
      };
    } catch (err) {
      logger.error(`Failed to get balance: ${err}`);
      throw err;
    }
  }

  // ── History ────────────────────────────────────────────────────────

  /**
   * Get paginated transaction history
   */
  getHistory(
    limit: number = 50,
    offset: number = 0
  ): { transactions: CreditTransaction[]; total: number } {
    try {
      const total = (this.stmtCount.get() as { cnt: number }).cnt;
      const rows = this.stmtGetAll.all(limit, offset) as CreditTransactionRow[];

      return {
        transactions: rows.map((row) => this.rowToTransaction(row)),
        total,
      };
    } catch (err) {
      logger.error(`Failed to get history: ${err}`);
      throw err;
    }
  }

  /**
   * Get transaction history for a specific employee
   */
  getHistoryByEmployee(employeeId: string, limit: number = 50): CreditTransaction[] {
    try {
      const rows = this.stmtGetByEmployee.all(employeeId, limit) as CreditTransactionRow[];
      return rows.map((row) => this.rowToTransaction(row));
    } catch (err) {
      logger.error(`Failed to get history for employee ${employeeId}: ${err}`);
      throw err;
    }
  }

  /**
   * Get transaction history by type
   */
  getHistoryByType(type: CreditTransactionType, limit: number = 50): CreditTransaction[] {
    try {
      const rows = this.stmtGetByType.all(type, limit) as CreditTransactionRow[];
      return rows.map((row) => this.rowToTransaction(row));
    } catch (err) {
      logger.error(`Failed to get history for type ${type}: ${err}`);
      throw err;
    }
  }

  // ── Analytics ──────────────────────────────────────────────────────

  /**
   * Get daily consumption summary for the last N days (for chart data)
   */
  getDailySummary(days: number = 30): CreditsDailySummary[] {
    try {
      const since = Date.now() - days * 24 * 60 * 60 * 1000;
      const rows = this.db
        .prepare(
          `SELECT
            date(timestamp / 1000, 'unixepoch', 'localtime') as day,
            SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as consumed,
            COUNT(*) as transactions
          FROM credit_transactions
          WHERE timestamp > ?
          GROUP BY day
          ORDER BY day DESC`
        )
        .all(since) as DailySummaryRow[];

      return rows;
    } catch (err) {
      logger.error(`Failed to get daily summary: ${err}`);
      throw err;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Prepare reusable SQL statements
   */
  private prepareStatements(): void {
    this.stmtInsert = this.db.prepare(`
      INSERT INTO credit_transactions (
        id, type, amount, description, employeeId, taskId, timestamp
      ) VALUES (
        @id, @type, @amount, @description, @employeeId, @taskId, @timestamp
      )
    `);

    this.stmtGetAll = this.db.prepare(
      'SELECT * FROM credit_transactions ORDER BY timestamp DESC LIMIT ? OFFSET ?'
    );

    this.stmtGetByEmployee = this.db.prepare(
      'SELECT * FROM credit_transactions WHERE employeeId = ? ORDER BY timestamp DESC LIMIT ?'
    );

    this.stmtGetByType = this.db.prepare(
      'SELECT * FROM credit_transactions WHERE type = ? ORDER BY timestamp DESC LIMIT ?'
    );

    this.stmtCount = this.db.prepare('SELECT COUNT(*) as cnt FROM credit_transactions');
  }

  /**
   * Convert a SQLite row to a CreditTransaction object
   */
  private rowToTransaction(row: CreditTransactionRow): CreditTransaction {
    return {
      id: row.id,
      type: row.type,
      amount: row.amount,
      description: row.description,
      employeeId: row.employeeId ?? undefined,
      taskId: row.taskId ?? undefined,
      timestamp: row.timestamp,
    };
  }
}
