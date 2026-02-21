/**
 * Activity Aggregator
 * Aggregates activity events from existing SQLite tables (tasks + credits)
 * into a unified timeline feed for the Dashboard → Activity page.
 */
import { logger } from '../utils/logger';
import type { TaskQueue } from './task-queue';
import type { CreditsEngine } from './credits-engine';

// ── Types ─────────────────────────────────────────────────────────────

export interface ActivityEvent {
  id: string;
  type: 'task' | 'credits' | 'employee' | 'system' | 'delegation';
  action: string;
  title: string;
  employeeId?: string;
  employeeName?: string;
  taskId?: string;
  amount?: number;
  timestamp: number;
  meta?: Record<string, unknown>;
}

interface TaskRow {
  id: string;
  subject: string;
  status: string;
  owner: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  creditsConsumed: number;
}

interface CreditRow {
  id: string;
  type: string;
  amount: number;
  description: string;
  employeeId: string | null;
  taskId: string | null;
  timestamp: number;
}

// ── ActivityAggregator ────────────────────────────────────────────────

export class ActivityAggregator {
  private taskQueue: TaskQueue;
  private creditsEngine: CreditsEngine;

  /** Map of employee ID → display name, populated externally */
  private employeeNames = new Map<string, string>();

  constructor(taskQueue: TaskQueue, creditsEngine: CreditsEngine) {
    this.taskQueue = taskQueue;
    this.creditsEngine = creditsEngine;
  }

  /**
   * Set employee display names for enriching activity events.
   * Called from IPC handlers after employee list is available.
   */
  setEmployeeNames(names: Map<string, string>): void {
    this.employeeNames = names;
  }

  /**
   * List aggregated activity events, sorted by timestamp descending.
   * Merges task events and credit transactions into a unified feed.
   */
  list(limit: number = 50, before?: number): ActivityEvent[] {
    try {
      const taskEvents = this.getTaskEvents(limit, before);
      const creditEvents = this.getCreditEvents(limit, before);

      // Merge and sort by timestamp descending
      const merged = [...taskEvents, ...creditEvents];
      merged.sort((a, b) => b.timestamp - a.timestamp);

      return merged.slice(0, limit);
    } catch (err) {
      logger.error(`ActivityAggregator.list failed: ${err}`);
      return [];
    }
  }

  // ── Private: Task events ──────────────────────────────────────────

  private getTaskEvents(limit: number, before?: number): ActivityEvent[] {
    try {
      const db = this.taskQueue.getDb();
      if (!db?.open) return [];

      const beforeTs = before ?? Date.now() + 1;

      // Get recently changed tasks (completed, started, or created)
      const rows = db
        .prepare(
          `SELECT id, subject, status, owner, createdAt, startedAt, completedAt, creditsConsumed
           FROM tasks
           WHERE COALESCE(completedAt, startedAt, createdAt) < ?
           ORDER BY COALESCE(completedAt, startedAt, createdAt) DESC
           LIMIT ?`
        )
        .all(beforeTs, limit) as TaskRow[];

      const events: ActivityEvent[] = [];

      for (const row of rows) {
        // Pick the most relevant event for this task
        if (row.completedAt) {
          events.push({
            id: `task-completed-${row.id}`,
            type: 'task',
            action: 'completed',
            title: row.subject,
            employeeId: row.owner ?? undefined,
            employeeName: row.owner ? this.employeeNames.get(row.owner) : undefined,
            taskId: row.id,
            amount: row.creditsConsumed > 0 ? row.creditsConsumed : undefined,
            timestamp: row.completedAt,
          });
        } else if (row.startedAt) {
          events.push({
            id: `task-claimed-${row.id}`,
            type: 'task',
            action: 'claimed',
            title: row.subject,
            employeeId: row.owner ?? undefined,
            employeeName: row.owner ? this.employeeNames.get(row.owner) : undefined,
            taskId: row.id,
            timestamp: row.startedAt,
          });
        } else {
          events.push({
            id: `task-created-${row.id}`,
            type: 'task',
            action: 'created',
            title: row.subject,
            taskId: row.id,
            timestamp: row.createdAt,
          });
        }
      }

      return events;
    } catch (err) {
      logger.warn(`ActivityAggregator: failed to get task events: ${err}`);
      return [];
    }
  }

  // ── Private: Credit events ────────────────────────────────────────

  private getCreditEvents(limit: number, before?: number): ActivityEvent[] {
    try {
      const db = this.creditsEngine.getDb();
      if (!db?.open) return [];

      const beforeTs = before ?? Date.now() + 1;

      const rows = db
        .prepare(
          `SELECT id, type, amount, description, employeeId, taskId, timestamp
           FROM credit_transactions
           WHERE timestamp < ? AND amount < 0
           ORDER BY timestamp DESC
           LIMIT ?`
        )
        .all(beforeTs, limit) as CreditRow[];

      return rows.map((row) => ({
        id: `credit-${row.id}`,
        type: 'credits' as const,
        action: 'consumed',
        title: row.description || row.type,
        employeeId: row.employeeId ?? undefined,
        employeeName: row.employeeId ? this.employeeNames.get(row.employeeId) : undefined,
        taskId: row.taskId ?? undefined,
        amount: Math.abs(row.amount),
        timestamp: row.timestamp,
        meta: { creditType: row.type },
      }));
    } catch (err) {
      logger.warn(`ActivityAggregator: failed to get credit events: ${err}`);
      return [];
    }
  }
}
