/**
 * Task Queue
 * SQLite-backed task queue with CRUD, state machine, and dependency resolution.
 * Manages tasks and projects for the AI Employee Platform.
 */
import { EventEmitter } from 'node:events';
import { app } from 'electron';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { logger } from '../utils/logger';
import type {
  Task,
  TaskStatus,
  TaskPriority,
  PlanStatus,
  AssignedBy,
  CreateTaskInput,
  Project,
  ProjectStatus,
  CreateProjectInput,
} from '../../src/types/task';

// ── SQL Schema ───────────────────────────────────────────────────────

const CREATE_TASKS_TABLE = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  owner TEXT,
  assignedBy TEXT NOT NULL DEFAULT 'user',
  blockedBy TEXT NOT NULL DEFAULT '[]',
  blocks TEXT NOT NULL DEFAULT '[]',
  priority TEXT NOT NULL DEFAULT 'medium',
  requiresApproval INTEGER NOT NULL DEFAULT 0,
  plan TEXT,
  planStatus TEXT NOT NULL DEFAULT 'none',
  planFeedback TEXT,
  output TEXT,
  outputFiles TEXT NOT NULL DEFAULT '[]',
  tokensUsed INTEGER NOT NULL DEFAULT 0,
  creditsConsumed INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  startedAt INTEGER,
  completedAt INTEGER,
  estimatedDuration INTEGER NOT NULL DEFAULT 0,
  wave INTEGER NOT NULL DEFAULT 0,
  rating INTEGER,
  feedback TEXT
);`;

const CREATE_PROJECTS_TABLE = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  pmEmployeeId TEXT NOT NULL,
  employees TEXT NOT NULL DEFAULT '[]',
  tasks TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'planning',
  createdAt INTEGER NOT NULL,
  completedAt INTEGER
);`;

// ── Row types (SQLite representation) ────────────────────────────────

interface TaskRow {
  id: string;
  projectId: string;
  subject: string;
  description: string;
  status: TaskStatus;
  owner: string | null;
  assignedBy: AssignedBy;
  blockedBy: string;
  blocks: string;
  priority: TaskPriority;
  requiresApproval: number;
  plan: string | null;
  planStatus: PlanStatus;
  planFeedback: string | null;
  output: string | null;
  outputFiles: string;
  tokensUsed: number;
  creditsConsumed: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  estimatedDuration: number;
  wave: number;
  rating: number | null;
  feedback: string | null;
}

interface ProjectRow {
  id: string;
  goal: string;
  pmEmployeeId: string;
  employees: string;
  tasks: string;
  status: ProjectStatus;
  createdAt: number;
  completedAt: number | null;
}

/**
 * TaskQueue — SQLite-backed task and project management
 *
 * Events:
 *  - 'task-changed' (task: Task)     — emitted after any task mutation
 *  - 'project-changed' (project: Project) — emitted after any project mutation
 */
export class TaskQueue extends EventEmitter {
  private db!: Database.Database;
  private dbPath: string;

  // Prepared statements (set in init)
  private stmtInsertTask!: Database.Statement;
  private stmtGetTask!: Database.Statement;
  private stmtListTasks!: Database.Statement;
  private stmtListTasksByProject!: Database.Statement;
  private stmtListTasksByStatus!: Database.Statement;
  private stmtInsertProject!: Database.Statement;
  private stmtGetProject!: Database.Statement;
  private stmtListProjects!: Database.Statement;

  constructor(dbPath?: string) {
    super();
    this.dbPath = dbPath ?? join(app.getPath('userData'), 'clawx-tasks.db');
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  /**
   * Initialize — open database, create tables, prepare statements
   */
  init(): void {
    logger.info('TaskQueue initializing...');
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');

      this.db.exec(CREATE_TASKS_TABLE);
      this.db.exec(CREATE_PROJECTS_TABLE);

      // Migration: add rating/feedback columns for existing databases
      try {
        this.db.exec('ALTER TABLE tasks ADD COLUMN rating INTEGER');
        this.db.exec('ALTER TABLE tasks ADD COLUMN feedback TEXT');
      } catch {
        /* columns already exist */
      }

      this.prepareStatements();
      logger.info(`TaskQueue initialized (db: ${this.dbPath})`);
    } catch (err) {
      logger.error(`TaskQueue failed to initialize: ${err}`);
      throw err;
    }
  }

  /**
   * Destroy — close database connection and remove listeners
   */
  destroy(): void {
    logger.info('TaskQueue destroying...');
    try {
      if (this.db?.open) {
        this.db.close();
      }
    } catch (err) {
      logger.error(`TaskQueue failed to close database: ${err}`);
    }
    this.removeAllListeners();
  }

  /**
   * Expose the database instance for sharing with MessageBus
   */
  getDb(): Database.Database {
    return this.db;
  }

  // ── Task CRUD ────────────────────────────────────────────────────

  /**
   * Create a new task
   */
  create(input: CreateTaskInput): Task {
    const now = Date.now();
    const id = crypto.randomUUID();

    const blockedBy = input.blockedBy ?? [];
    const task: Task = {
      id,
      projectId: input.projectId,
      subject: input.subject,
      description: input.description,
      status: 'pending',
      owner: input.owner ?? null,
      assignedBy: input.assignedBy ?? 'user',
      blockedBy,
      blocks: [],
      priority: input.priority ?? 'medium',
      requiresApproval: input.requiresApproval ?? false,
      plan: null,
      planStatus: 'none',
      planFeedback: null,
      output: null,
      outputFiles: [],
      tokensUsed: 0,
      creditsConsumed: 0,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      estimatedDuration: input.estimatedDuration ?? 0,
      wave: input.wave ?? 0,
    };

    try {
      this.stmtInsertTask.run({
        id: task.id,
        projectId: task.projectId,
        subject: task.subject,
        description: task.description,
        status: task.status,
        owner: task.owner,
        assignedBy: task.assignedBy,
        blockedBy: JSON.stringify(task.blockedBy),
        blocks: JSON.stringify(task.blocks),
        priority: task.priority,
        requiresApproval: task.requiresApproval ? 1 : 0,
        plan: task.plan,
        planStatus: task.planStatus,
        planFeedback: task.planFeedback,
        output: task.output,
        outputFiles: JSON.stringify(task.outputFiles),
        tokensUsed: task.tokensUsed,
        creditsConsumed: task.creditsConsumed,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        estimatedDuration: task.estimatedDuration,
        wave: task.wave,
      });

      // Update reverse dependency (blocks) on referenced tasks
      for (const depId of blockedBy) {
        this.addBlocksReference(depId, id);
      }

      logger.info(`Task created: ${id} "${task.subject}" (project: ${task.projectId})`);
      this.emit('task-changed', task);
      return task;
    } catch (err) {
      logger.error(`Failed to create task: ${err}`);
      throw err;
    }
  }

  /**
   * Get a task by ID
   */
  get(id: string): Task | undefined {
    try {
      const row = this.stmtGetTask.get(id) as TaskRow | undefined;
      return row ? this.rowToTask(row) : undefined;
    } catch (err) {
      logger.error(`Failed to get task ${id}: ${err}`);
      throw err;
    }
  }

  /**
   * List all tasks, optionally filtered by project
   */
  list(projectId?: string): Task[] {
    try {
      const rows = projectId
        ? (this.stmtListTasksByProject.all(projectId) as TaskRow[])
        : (this.stmtListTasks.all() as TaskRow[]);
      return rows.map((row) => this.rowToTask(row));
    } catch (err) {
      logger.error(`Failed to list tasks: ${err}`);
      throw err;
    }
  }

  /**
   * List tasks by status
   */
  listByStatus(status: TaskStatus): Task[] {
    try {
      const rows = this.stmtListTasksByStatus.all(status) as TaskRow[];
      return rows.map((row) => this.rowToTask(row));
    } catch (err) {
      logger.error(`Failed to list tasks by status ${status}: ${err}`);
      throw err;
    }
  }

  /**
   * List available tasks for a project — pending tasks with all dependencies completed
   */
  listAvailable(projectId: string): Task[] {
    try {
      const pendingTasks = this.db
        .prepare('SELECT * FROM tasks WHERE projectId = ? AND status = ?')
        .all(projectId, 'pending') as TaskRow[];

      return pendingTasks
        .map((row) => this.rowToTask(row))
        .filter((task) => {
          if (task.blockedBy.length === 0) return true;
          return task.blockedBy.every((depId) => {
            const dep = this.get(depId);
            return dep?.status === 'completed';
          });
        });
    } catch (err) {
      logger.error(`Failed to list available tasks for project ${projectId}: ${err}`);
      throw err;
    }
  }

  /**
   * Update task fields. Emits 'task-changed'.
   */
  update(id: string, changes: Partial<Task>): Task {
    const existing = this.get(id);
    if (!existing) {
      throw new Error(`Task not found: ${id}`);
    }

    // Build SET clause dynamically from provided changes
    const setClauses: string[] = [];
    const values: Record<string, unknown> = { id };

    const fieldMap: Record<string, (v: unknown) => unknown> = {
      subject: (v) => v,
      description: (v) => v,
      status: (v) => v,
      owner: (v) => v,
      assignedBy: (v) => v,
      blockedBy: (v) => JSON.stringify(v),
      blocks: (v) => JSON.stringify(v),
      priority: (v) => v,
      requiresApproval: (v) => (v ? 1 : 0),
      plan: (v) => v,
      planStatus: (v) => v,
      planFeedback: (v) => v,
      output: (v) => v,
      outputFiles: (v) => JSON.stringify(v),
      tokensUsed: (v) => v,
      creditsConsumed: (v) => v,
      startedAt: (v) => v,
      completedAt: (v) => v,
      estimatedDuration: (v) => v,
      wave: (v) => v,
      rating: (v) => v,
      feedback: (v) => v,
    };

    for (const [field, transform] of Object.entries(fieldMap)) {
      if (field in changes) {
        setClauses.push(`${field} = @${field}`);
        values[field] = transform((changes as Record<string, unknown>)[field]);
      }
    }

    if (setClauses.length === 0) {
      return existing;
    }

    try {
      const sql = `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = @id`;
      this.db.prepare(sql).run(values);

      const updated = this.get(id)!;
      logger.debug(`Task updated: ${id} (fields: ${setClauses.map((c) => c.split(' ')[0]).join(', ')})`);
      this.emit('task-changed', updated);
      return updated;
    } catch (err) {
      logger.error(`Failed to update task ${id}: ${err}`);
      throw err;
    }
  }

  /**
   * Claim a task — assign owner and set to in_progress
   */
  claim(taskId: string, employeeId: string): Task {
    const task = this.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    logger.info(`Task claimed: ${taskId} by employee ${employeeId}`);
    return this.update(taskId, {
      owner: employeeId,
      status: 'in_progress',
      startedAt: Date.now(),
    });
  }

  /**
   * Complete a task — set output and mark as completed
   */
  complete(taskId: string, output: string, outputFiles?: string[]): Task {
    const task = this.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    logger.info(`Task completed: ${taskId}`);
    return this.update(taskId, {
      status: 'completed',
      completedAt: Date.now(),
      output,
      outputFiles: outputFiles ?? task.outputFiles,
    });
  }

  /**
   * Block a task — set status to blocked
   */
  block(taskId: string): Task {
    const task = this.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    logger.info(`Task blocked: ${taskId}`);
    return this.update(taskId, { status: 'blocked' });
  }

  /**
   * Cancel a task — reset to pending, clear owner and startedAt
   */
  cancel(taskId: string): Task {
    const task = this.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    logger.info(`Task cancelled: ${taskId}`);
    return this.update(taskId, {
      status: 'pending',
      owner: null,
      startedAt: null,
    });
  }

  /**
   * Rate a completed task
   */
  rate(taskId: string, rating: number, feedback?: string): void {
    const task = this.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const stmt = this.db.prepare('UPDATE tasks SET rating = ?, feedback = ? WHERE id = ?');
    stmt.run(rating, feedback ?? null, taskId);

    logger.info(`Task rated: ${taskId} (${rating} stars)`);
    this.emit('task-changed', { id: taskId, action: 'rated' });
  }

  // ── Project CRUD ─────────────────────────────────────────────────

  /**
   * Create a new project
   */
  createProject(input: CreateProjectInput): Project {
    const now = Date.now();
    const id = crypto.randomUUID();

    const project: Project = {
      id,
      goal: input.goal,
      pmEmployeeId: input.pmEmployeeId,
      employees: input.employees,
      tasks: [],
      status: 'planning',
      createdAt: now,
      completedAt: null,
    };

    try {
      this.stmtInsertProject.run({
        id: project.id,
        goal: project.goal,
        pmEmployeeId: project.pmEmployeeId,
        employees: JSON.stringify(project.employees),
        tasks: JSON.stringify(project.tasks),
        status: project.status,
        createdAt: project.createdAt,
        completedAt: project.completedAt,
      });

      logger.info(`Project created: ${id} "${project.goal}"`);
      this.emit('project-changed', project);
      return project;
    } catch (err) {
      logger.error(`Failed to create project: ${err}`);
      throw err;
    }
  }

  /**
   * Get a project by ID
   */
  getProject(id: string): Project | undefined {
    try {
      const row = this.stmtGetProject.get(id) as ProjectRow | undefined;
      return row ? this.rowToProject(row) : undefined;
    } catch (err) {
      logger.error(`Failed to get project ${id}: ${err}`);
      throw err;
    }
  }

  /**
   * List all projects
   */
  listProjects(): Project[] {
    try {
      const rows = this.stmtListProjects.all() as ProjectRow[];
      return rows.map((row) => this.rowToProject(row));
    } catch (err) {
      logger.error(`Failed to list projects: ${err}`);
      throw err;
    }
  }

  /**
   * Update project fields. Emits 'project-changed'.
   */
  updateProject(id: string, changes: Partial<Project>): Project {
    const existing = this.getProject(id);
    if (!existing) {
      throw new Error(`Project not found: ${id}`);
    }

    const setClauses: string[] = [];
    const values: Record<string, unknown> = { id };

    const fieldMap: Record<string, (v: unknown) => unknown> = {
      goal: (v) => v,
      pmEmployeeId: (v) => v,
      employees: (v) => JSON.stringify(v),
      tasks: (v) => JSON.stringify(v),
      status: (v) => v,
      completedAt: (v) => v,
    };

    for (const [field, transform] of Object.entries(fieldMap)) {
      if (field in changes) {
        setClauses.push(`${field} = @${field}`);
        values[field] = transform((changes as Record<string, unknown>)[field]);
      }
    }

    if (setClauses.length === 0) {
      return existing;
    }

    try {
      const sql = `UPDATE projects SET ${setClauses.join(', ')} WHERE id = @id`;
      this.db.prepare(sql).run(values);

      const updated = this.getProject(id)!;
      logger.debug(`Project updated: ${id} (fields: ${setClauses.map((c) => c.split(' ')[0]).join(', ')})`);
      this.emit('project-changed', updated);
      return updated;
    } catch (err) {
      logger.error(`Failed to update project ${id}: ${err}`);
      throw err;
    }
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Prepare reusable SQL statements
   */
  private prepareStatements(): void {
    this.stmtInsertTask = this.db.prepare(`
      INSERT INTO tasks (
        id, projectId, subject, description, status, owner, assignedBy,
        blockedBy, blocks, priority, requiresApproval, plan, planStatus,
        planFeedback, output, outputFiles, tokensUsed, creditsConsumed,
        createdAt, startedAt, completedAt, estimatedDuration, wave
      ) VALUES (
        @id, @projectId, @subject, @description, @status, @owner, @assignedBy,
        @blockedBy, @blocks, @priority, @requiresApproval, @plan, @planStatus,
        @planFeedback, @output, @outputFiles, @tokensUsed, @creditsConsumed,
        @createdAt, @startedAt, @completedAt, @estimatedDuration, @wave
      )
    `);

    this.stmtGetTask = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    this.stmtListTasks = this.db.prepare('SELECT * FROM tasks ORDER BY createdAt ASC');
    this.stmtListTasksByProject = this.db.prepare('SELECT * FROM tasks WHERE projectId = ? ORDER BY wave ASC, createdAt ASC');
    this.stmtListTasksByStatus = this.db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY createdAt ASC');

    this.stmtInsertProject = this.db.prepare(`
      INSERT INTO projects (id, goal, pmEmployeeId, employees, tasks, status, createdAt, completedAt)
      VALUES (@id, @goal, @pmEmployeeId, @employees, @tasks, @status, @createdAt, @completedAt)
    `);

    this.stmtGetProject = this.db.prepare('SELECT * FROM projects WHERE id = ?');
    this.stmtListProjects = this.db.prepare('SELECT * FROM projects ORDER BY createdAt DESC');
  }

  /**
   * Convert a SQLite task row to a Task object
   */
  private rowToTask(row: TaskRow): Task {
    return {
      id: row.id,
      projectId: row.projectId,
      subject: row.subject,
      description: row.description,
      status: row.status,
      owner: row.owner,
      assignedBy: row.assignedBy,
      blockedBy: JSON.parse(row.blockedBy) as string[],
      blocks: JSON.parse(row.blocks) as string[],
      priority: row.priority,
      requiresApproval: row.requiresApproval === 1,
      plan: row.plan,
      planStatus: row.planStatus,
      planFeedback: row.planFeedback,
      output: row.output,
      outputFiles: JSON.parse(row.outputFiles) as string[],
      tokensUsed: row.tokensUsed,
      creditsConsumed: row.creditsConsumed,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      estimatedDuration: row.estimatedDuration,
      wave: row.wave,
      rating: row.rating ?? undefined,
      feedback: row.feedback ?? undefined,
    };
  }

  /**
   * Convert a SQLite project row to a Project object
   */
  private rowToProject(row: ProjectRow): Project {
    return {
      id: row.id,
      goal: row.goal,
      pmEmployeeId: row.pmEmployeeId,
      employees: JSON.parse(row.employees) as string[],
      tasks: JSON.parse(row.tasks) as string[],
      status: row.status,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    };
  }

  /**
   * Add a task ID to the `blocks` array of another task (reverse dependency)
   */
  private addBlocksReference(targetTaskId: string, blockerTaskId: string): void {
    try {
      const row = this.stmtGetTask.get(targetTaskId) as TaskRow | undefined;
      if (!row) return;

      const blocks = JSON.parse(row.blocks) as string[];
      if (!blocks.includes(blockerTaskId)) {
        blocks.push(blockerTaskId);
        this.db
          .prepare('UPDATE tasks SET blocks = ? WHERE id = ?')
          .run(JSON.stringify(blocks), targetTaskId);
      }
    } catch (err) {
      logger.warn(`Failed to add blocks reference ${targetTaskId} -> ${blockerTaskId}: ${err}`);
    }
  }
}
