/**
 * Activity Aggregator
 * Aggregates activity events from existing SQLite tables (tasks + credits)
 * and in-memory browser action events into a unified timeline feed for the
 * Dashboard → Activity page.
 */
import { logger } from '../utils/logger';
import type { TaskQueue } from './task-queue';
import type { CreditsEngine } from './credits-engine';
import type {
  BrowserEventDetector,
  BrowserActionEvent,
  BrowserAction,
} from './browser-event-detector';
import { MEANINGFUL_ACTIONS } from './browser-event-detector';

// ── Types ─────────────────────────────────────────────────────────────

export interface ActivityEvent {
  id: string;
  type: 'task' | 'credits' | 'employee' | 'system' | 'delegation' | 'browser';
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

// ── Constants ─────────────────────────────────────────────────────────

/** Max number of in-memory browser events to retain */
const MAX_BROWSER_EVENTS = 200;

// ── ActivityAggregator ────────────────────────────────────────────────

export class ActivityAggregator {
  private taskQueue: TaskQueue;
  private creditsEngine: CreditsEngine;

  /** Map of employee ID → display name, populated externally */
  private employeeNames = new Map<string, string>();

  /** In-memory ring buffer of recent browser action events */
  private browserEvents: ActivityEvent[] = [];

  /** Reference to the detector for cleanup */
  private _browserDetector: BrowserEventDetector | null = null;
  private _browserHandler: ((event: BrowserActionEvent) => void) | null = null;

  constructor(taskQueue: TaskQueue, creditsEngine: CreditsEngine) {
    this.taskQueue = taskQueue;
    this.creditsEngine = creditsEngine;
  }

  /**
   * Attach a BrowserEventDetector to automatically collect browser activity.
   * Only meaningful (navigate, click, type, scroll) actions are logged to avoid noise.
   */
  attachBrowserDetector(detector: BrowserEventDetector): void {
    // Detach previous if any
    this.detachBrowserDetector();

    this._browserDetector = detector;
    this._browserHandler = (event: BrowserActionEvent) => {
      // Only log meaningful actions (skip snapshot, screenshot, etc.)
      if (!MEANINGFUL_ACTIONS.has(event.action as BrowserAction)) return;

      const employeeName = this.employeeNames.get(event.employeeId);
      const title = this.formatBrowserTitle(event, employeeName);

      const activityEvent: ActivityEvent = {
        id: `browser-${event.employeeId}-${event.timestamp}`,
        type: 'browser',
        action: event.action,
        title,
        employeeId: event.employeeId,
        employeeName: employeeName,
        timestamp: event.timestamp,
        meta: {
          url: event.params?.url,
          ref: event.params?.ref,
          success: event.success,
          duration: event.duration,
        },
      };

      this.browserEvents.push(activityEvent);

      // Trim to max size
      if (this.browserEvents.length > MAX_BROWSER_EVENTS) {
        this.browserEvents = this.browserEvents.slice(-MAX_BROWSER_EVENTS);
      }
    };

    detector.on('browser-action', this._browserHandler);
    logger.debug('[ActivityAggregator] Attached BrowserEventDetector');
  }

  /**
   * Detach the BrowserEventDetector listener.
   */
  detachBrowserDetector(): void {
    if (this._browserDetector && this._browserHandler) {
      this._browserDetector.removeListener('browser-action', this._browserHandler);
    }
    this._browserDetector = null;
    this._browserHandler = null;
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
   * Merges task events, credit transactions, and browser actions into a unified feed.
   */
  list(limit: number = 50, before?: number): ActivityEvent[] {
    try {
      const taskEvents = this.getTaskEvents(limit, before);
      const creditEvents = this.getCreditEvents(limit, before);
      const browserActivityEvents = this.getBrowserEvents(limit, before);

      // Merge and sort by timestamp descending
      const merged = [...taskEvents, ...creditEvents, ...browserActivityEvents];
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

  // ── Private: Browser events ───────────────────────────────────────

  private getBrowserEvents(limit: number, before?: number): ActivityEvent[] {
    const beforeTs = before ?? Date.now() + 1;

    return this.browserEvents
      .filter((e) => e.timestamp < beforeTs)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Format a human-readable title for a browser action event.
   */
  private formatBrowserTitle(event: BrowserActionEvent, employeeName?: string): string {
    const name = employeeName ?? event.employeeId;
    switch (event.action) {
      case 'open':
        return event.params?.url
          ? `🌐 ${name} navigated to ${event.params.url}`
          : `🌐 ${name} opened a page`;
      case 'click':
        return `🌐 ${name} clicked an element`;
      case 'type':
        return `🌐 ${name} typed text`;
      case 'scroll':
        return `🌐 ${name} scrolled the page`;
      case 'start':
        return `🌐 ${name} started the browser`;
      case 'stop':
        return `🌐 ${name} stopped the browser`;
      default:
        return `🌐 ${name} performed a browser action`;
    }
  }
}
