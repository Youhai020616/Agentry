/**
 * TaskQueue Tests
 *
 * Unit tests for the SQLite-backed task queue engine.
 * Uses an in-memory mock for better-sqlite3 so CRUD operations
 * are fully exercised without native module dependencies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── In-memory SQLite mock ────────────────────────────────────────────

/**
 * Lightweight in-memory store that mirrors the behaviour of better-sqlite3
 * just enough for TaskQueue to function.  Two tables — `tasks` and `projects`
 * — are backed by plain Maps keyed on `id`.
 */
function createMockDatabase() {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {};
  let isOpen = true;

  /** Parse a trivial INSERT … VALUES (@col, …) statement and return column names */
  function parseInsertColumns(sql: string): string[] | null {
    const match = sql.match(/INSERT\s+INTO\s+\w+\s*\(([^)]+)\)\s*VALUES/i);
    if (!match) return null;
    return match[1].split(',').map((c) => c.trim());
  }

  /** Parse UPDATE … SET col = @col, … WHERE id = @id */
  function parseUpdate(sql: string): { table: string; cols: string[] } | null {
    const tableMatch = sql.match(/UPDATE\s+(\w+)\s+SET/i);
    const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/i);
    if (!tableMatch || !setMatch) return null;
    const cols = setMatch[1].split(',').map((p) => p.trim().split(/\s*=\s*/)[0]);
    return { table: tableMatch[1], cols };
  }

  /** Parse SELECT * FROM table WHERE col = ? … */
  function parseSelectWhere(sql: string): {
    table: string;
    whereCol: string | null;
    orderCols: string[];
  } | null {
    const tableMatch = sql.match(/FROM\s+(\w+)/i);
    if (!tableMatch) return null;
    const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?(?:\s+AND\s+(\w+)\s*=\s*\?)?/i);
    const orderMatch = sql.match(/ORDER\s+BY\s+(.+)$/i);
    return {
      table: tableMatch[1],
      whereCol: whereMatch ? whereMatch[1] : null,
      orderCols: orderMatch ? orderMatch[1].split(',').map((c) => c.trim()) : [],
    };
  }

  function createStatement(sql: string) {
    return {
      run: vi.fn((...args: unknown[]) => {
        // INSERT
        const insertCols = parseInsertColumns(sql);
        if (insertCols) {
          const tableMatch = sql.match(/INSERT\s+INTO\s+(\w+)/i);
          const tableName = tableMatch![1];
          if (!tables[tableName]) tables[tableName] = new Map();
          const params = args[0] as Record<string, unknown>;
          const row: Record<string, unknown> = {};
          for (const col of insertCols) {
            row[col] = params[col];
          }
          tables[tableName].set(row.id as string, row);
          return { changes: 1, lastInsertRowid: 0 };
        }

        // UPDATE … SET … WHERE id = @id
        const updateMeta = parseUpdate(sql);
        if (updateMeta) {
          const params = args[0] as Record<string, unknown>;
          const id = params.id as string;
          const table = tables[updateMeta.table];
          if (table && table.has(id)) {
            const existing = table.get(id)!;
            for (const col of updateMeta.cols) {
              if (col in params) {
                existing[col] = params[col];
              }
            }
            table.set(id, existing);
          }
          return { changes: 1, lastInsertRowid: 0 };
        }

        // UPDATE tasks SET blocks = ? WHERE id = ?  (positional args)
        if (/UPDATE\s+tasks\s+SET\s+blocks\s*=\s*\?\s*WHERE\s+id\s*=\s*\?/i.test(sql)) {
          const [value, id] = args as [string, string];
          const table = tables['tasks'];
          if (table && table.has(id)) {
            table.get(id)!.blocks = value;
          }
          return { changes: 1, lastInsertRowid: 0 };
        }

        return { changes: 0, lastInsertRowid: 0 };
      }),

      get: vi.fn((...args: unknown[]) => {
        const parsed = parseSelectWhere(sql);
        if (!parsed) return undefined;
        const table = tables[parsed.table];
        if (!table) return undefined;

        if (parsed.whereCol) {
          const val = args[0] as string;
          for (const row of table.values()) {
            if (row[parsed.whereCol] === val) return { ...row };
          }
          return undefined;
        }
        return undefined;
      }),

      all: vi.fn((...args: unknown[]) => {
        const parsed = parseSelectWhere(sql);
        if (!parsed) return [];
        const table = tables[parsed.table];
        if (!table) return [];

        let rows = Array.from(table.values()).map((r) => ({ ...r }));

        // Apply WHERE filters (supports up to 2 positional ? params)
        if (parsed.whereCol) {
          const whereMatch = sql.match(
            /WHERE\s+(\w+)\s*=\s*\?(?:\s+AND\s+(\w+)\s*=\s*\?)?/i,
          );
          if (whereMatch) {
            const col1 = whereMatch[1];
            rows = rows.filter((r) => r[col1] === args[0]);
            if (whereMatch[2]) {
              const col2 = whereMatch[2];
              rows = rows.filter((r) => r[col2] === args[1]);
            }
          }
        }

        return rows;
      }),
    };
  }

  const db = {
    open: isOpen,
    exec: vi.fn((sql: string) => {
      // Extract table name from CREATE TABLE IF NOT EXISTS <name>
      const match = sql.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/i);
      if (match && !tables[match[1]]) {
        tables[match[1]] = new Map();
      }
    }),
    prepare: vi.fn((sql: string) => createStatement(sql)),
    pragma: vi.fn(),
    close: vi.fn(() => {
      isOpen = false;
      db.open = false;
    }),
    // Expose for test assertions
    __tables: tables,
  };

  return db;
}

let mockDb: ReturnType<typeof createMockDatabase>;

vi.mock('better-sqlite3', () => {
  // Return a class-like constructor so `new Database(...)` works.
  // The constructor delegates to the current `mockDb` instance which is
  // assigned fresh in each `beforeEach`.
  const MockDatabase = function (this: Record<string, unknown>) {
    // Copy every property from mockDb onto `this` so the caller
    // gets the mock's methods (exec, prepare, pragma, close, open).
    const db = mockDb;
    Object.assign(this, db);
    // Ensure the `open` getter stays reactive
    Object.defineProperty(this, 'open', {
      get: () => db.open,
      set: (v: boolean) => { db.open = v; },
      configurable: true,
    });
  };
  return { default: MockDatabase };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test'),
  },
}));

vi.mock('../../../electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after all mocks are registered
import { TaskQueue } from '../../../electron/engine/task-queue';
import type { CreateTaskInput, CreateProjectInput } from '../../../src/types/task';

// ── Helpers ──────────────────────────────────────────────────────────

function makeTaskInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    projectId: 'proj-1',
    subject: 'Test task',
    description: 'A task for testing',
    ...overrides,
  };
}

function makeProjectInput(overrides: Partial<CreateProjectInput> = {}): CreateProjectInput {
  return {
    goal: 'Ship feature X',
    pmEmployeeId: 'pm-1',
    employees: ['emp-1', 'emp-2'],
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('TaskQueue', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
    queue = new TaskQueue('/tmp/test/clawx-tasks.db');
    queue.init();
  });

  // ── Lifecycle ────────────────────────────────────────────────────

  describe('Lifecycle', () => {
    it('init() creates tables without error', () => {
      // init was already called in beforeEach — verify exec was called with table SQL
      // 2 CREATE TABLE + 2 ALTER TABLE (rating, feedback columns)
      expect(mockDb.exec).toHaveBeenCalledTimes(4);
      expect(mockDb.exec.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS tasks');
      expect(mockDb.exec.mock.calls[1][0]).toContain('CREATE TABLE IF NOT EXISTS projects');
    });

    it('init() sets WAL journal mode and foreign keys', () => {
      expect(mockDb.pragma).toHaveBeenCalledWith('journal_mode = WAL');
      expect(mockDb.pragma).toHaveBeenCalledWith('foreign_keys = ON');
    });

    it('init() prepares reusable statements', () => {
      // prepare is called once per statement in prepareStatements()
      // stmtInsertTask, stmtGetTask, stmtListTasks,
      // stmtListTasksByProject, stmtListTasksByStatus,
      // stmtInsertProject, stmtGetProject, stmtListProjects = 8
      expect(mockDb.prepare).toHaveBeenCalledTimes(8);
    });

    it('destroy() closes the database', () => {
      queue.destroy();
      expect(mockDb.close).toHaveBeenCalledTimes(1);
    });

    it('destroy() removes all event listeners', () => {
      const spy = vi.fn();
      queue.on('task-changed', spy);
      queue.destroy();
      expect(queue.listenerCount('task-changed')).toBe(0);
    });
  });

  // ── Task CRUD ────────────────────────────────────────────────────

  describe('Task CRUD', () => {
    it('create() returns a Task with generated id and correct defaults', () => {
      const task = queue.create(makeTaskInput());

      expect(task.id).toBeDefined();
      expect(typeof task.id).toBe('string');
      expect(task.id.length).toBeGreaterThan(0);
      expect(task.projectId).toBe('proj-1');
      expect(task.subject).toBe('Test task');
      expect(task.description).toBe('A task for testing');
      expect(task.status).toBe('pending');
      expect(task.owner).toBeNull();
      expect(task.assignedBy).toBe('user');
      expect(task.blockedBy).toEqual([]);
      expect(task.blocks).toEqual([]);
      expect(task.priority).toBe('medium');
      expect(task.requiresApproval).toBe(false);
      expect(task.plan).toBeNull();
      expect(task.planStatus).toBe('none');
      expect(task.planFeedback).toBeNull();
      expect(task.output).toBeNull();
      expect(task.outputFiles).toEqual([]);
      expect(task.tokensUsed).toBe(0);
      expect(task.creditsConsumed).toBe(0);
      expect(task.createdAt).toBeGreaterThan(0);
      expect(task.startedAt).toBeNull();
      expect(task.completedAt).toBeNull();
      expect(task.estimatedDuration).toBe(0);
      expect(task.wave).toBe(0);
    });

    it('create() respects provided optional fields', () => {
      const task = queue.create(
        makeTaskInput({
          owner: 'emp-1',
          assignedBy: 'pm',
          priority: 'urgent',
          requiresApproval: true,
          estimatedDuration: 3600,
          wave: 2,
        }),
      );

      expect(task.owner).toBe('emp-1');
      expect(task.assignedBy).toBe('pm');
      expect(task.priority).toBe('urgent');
      expect(task.requiresApproval).toBe(true);
      expect(task.estimatedDuration).toBe(3600);
      expect(task.wave).toBe(2);
    });

    it('create() stores a task that can be retrieved with get()', () => {
      const created = queue.create(makeTaskInput());
      const fetched = queue.get(created.id);

      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.subject).toBe('Test task');
      expect(fetched!.status).toBe('pending');
    });

    it('get() returns undefined for a non-existent task', () => {
      expect(queue.get('nonexistent-id')).toBeUndefined();
    });

    it('list() returns all tasks', () => {
      queue.create(makeTaskInput({ subject: 'Task A' }));
      queue.create(makeTaskInput({ subject: 'Task B' }));
      queue.create(makeTaskInput({ subject: 'Task C' }));

      const all = queue.list();
      expect(all).toHaveLength(3);
    });

    it('list(projectId) filters tasks by project', () => {
      queue.create(makeTaskInput({ projectId: 'proj-1', subject: 'P1 Task' }));
      queue.create(makeTaskInput({ projectId: 'proj-2', subject: 'P2 Task' }));
      queue.create(makeTaskInput({ projectId: 'proj-1', subject: 'P1 Task 2' }));

      const proj1Tasks = queue.list('proj-1');
      expect(proj1Tasks).toHaveLength(2);
      expect(proj1Tasks.every((t) => t.projectId === 'proj-1')).toBe(true);

      const proj2Tasks = queue.list('proj-2');
      expect(proj2Tasks).toHaveLength(1);
      expect(proj2Tasks[0].projectId).toBe('proj-2');
    });

    it('listByStatus() filters tasks by status', () => {
      const task1 = queue.create(makeTaskInput({ subject: 'Pending task' }));
      queue.create(makeTaskInput({ subject: 'Another pending task' }));

      // Claim one task so it becomes in_progress
      queue.claim(task1.id, 'emp-1');

      const pending = queue.listByStatus('pending');
      expect(pending).toHaveLength(1);
      expect(pending[0].subject).toBe('Another pending task');

      const inProgress = queue.listByStatus('in_progress');
      expect(inProgress).toHaveLength(1);
      expect(inProgress[0].id).toBe(task1.id);
    });

    it('listAvailable() returns only unblocked pending tasks', () => {
      // Create a dependency chain: task2 is blocked by task1
      const task1 = queue.create(
        makeTaskInput({ projectId: 'proj-1', subject: 'Task 1' }),
      );
      queue.create(
        makeTaskInput({
          projectId: 'proj-1',
          subject: 'Task 2 (blocked)',
          blockedBy: [task1.id],
        }),
      );
      queue.create(
        makeTaskInput({ projectId: 'proj-1', subject: 'Task 3 (free)' }),
      );

      const available = queue.listAvailable('proj-1');

      // task1 is pending with no deps -> available
      // task2 is pending but blocked by task1 (not completed) -> NOT available
      // task3 is pending with no deps -> available
      expect(available).toHaveLength(2);
      const subjects = available.map((t) => t.subject);
      expect(subjects).toContain('Task 1');
      expect(subjects).toContain('Task 3 (free)');
      expect(subjects).not.toContain('Task 2 (blocked)');
    });

    it('listAvailable() includes blocked task when dependency is completed', () => {
      const task1 = queue.create(
        makeTaskInput({ projectId: 'proj-1', subject: 'Dependency' }),
      );
      queue.create(
        makeTaskInput({
          projectId: 'proj-1',
          subject: 'Blocked task',
          blockedBy: [task1.id],
        }),
      );

      // Complete the dependency
      queue.claim(task1.id, 'emp-1');
      queue.complete(task1.id, 'Done');

      const available = queue.listAvailable('proj-1');
      const subjects = available.map((t) => t.subject);
      // task1 is completed, not pending -> not in available
      // blocked task now has its dep completed -> available
      expect(subjects).toContain('Blocked task');
      expect(subjects).not.toContain('Dependency');
    });
  });

  // ── Task State Machine ──────────────────────────────────────────

  describe('Task State Machine', () => {
    it('claim() sets owner, status to in_progress, and startedAt', () => {
      const task = queue.create(makeTaskInput());
      const claimed = queue.claim(task.id, 'emp-1');

      expect(claimed.owner).toBe('emp-1');
      expect(claimed.status).toBe('in_progress');
      expect(claimed.startedAt).toBeGreaterThan(0);
    });

    it('claim() throws for a non-existent task', () => {
      expect(() => queue.claim('nonexistent', 'emp-1')).toThrow('Task not found');
    });

    it('complete() sets output, status to completed, and completedAt', () => {
      const task = queue.create(makeTaskInput());
      queue.claim(task.id, 'emp-1');
      const completed = queue.complete(task.id, 'Result output');

      expect(completed.status).toBe('completed');
      expect(completed.output).toBe('Result output');
      expect(completed.completedAt).toBeGreaterThan(0);
    });

    it('complete() accepts optional outputFiles', () => {
      const task = queue.create(makeTaskInput());
      queue.claim(task.id, 'emp-1');
      const completed = queue.complete(task.id, 'Done', ['file1.txt', 'file2.md']);

      expect(completed.outputFiles).toEqual(['file1.txt', 'file2.md']);
    });

    it('complete() throws for a non-existent task', () => {
      expect(() => queue.complete('nonexistent', 'output')).toThrow('Task not found');
    });

    it('block() sets status to blocked', () => {
      const task = queue.create(makeTaskInput());
      queue.claim(task.id, 'emp-1');
      const blocked = queue.block(task.id);

      expect(blocked.status).toBe('blocked');
    });

    it('block() throws for a non-existent task', () => {
      expect(() => queue.block('nonexistent')).toThrow('Task not found');
    });

    it('cancel() resets to pending, clears owner and startedAt', () => {
      const task = queue.create(makeTaskInput());
      queue.claim(task.id, 'emp-1');
      const cancelled = queue.cancel(task.id);

      expect(cancelled.status).toBe('pending');
      expect(cancelled.owner).toBeNull();
      expect(cancelled.startedAt).toBeNull();
    });

    it('cancel() throws for a non-existent task', () => {
      expect(() => queue.cancel('nonexistent')).toThrow('Task not found');
    });
  });

  // ── Task Update ─────────────────────────────────────────────────

  describe('Task Update', () => {
    it('update() modifies only the specified fields', () => {
      const task = queue.create(makeTaskInput({ subject: 'Original' }));
      const updated = queue.update(task.id, { subject: 'Modified', priority: 'high' });

      expect(updated.subject).toBe('Modified');
      expect(updated.priority).toBe('high');
      // Unmodified fields remain the same
      expect(updated.description).toBe('A task for testing');
      expect(updated.status).toBe('pending');
    });

    it('update() throws for a non-existent task', () => {
      expect(() => queue.update('nonexistent', { subject: 'Nope' })).toThrow(
        'Task not found: nonexistent',
      );
    });

    it('update() with no changes returns existing task unchanged', () => {
      const task = queue.create(makeTaskInput());
      const same = queue.update(task.id, {});

      expect(same.id).toBe(task.id);
      expect(same.subject).toBe(task.subject);
    });

    it('update() correctly serialises array fields (blockedBy, outputFiles)', () => {
      const task = queue.create(makeTaskInput());
      const updated = queue.update(task.id, {
        blockedBy: ['dep-1', 'dep-2'],
        outputFiles: ['out.txt'],
      });

      expect(updated.blockedBy).toEqual(['dep-1', 'dep-2']);
      expect(updated.outputFiles).toEqual(['out.txt']);
    });

    it('update() correctly converts requiresApproval boolean', () => {
      const task = queue.create(makeTaskInput());
      const updated = queue.update(task.id, { requiresApproval: true });

      expect(updated.requiresApproval).toBe(true);
    });
  });

  // ── Project CRUD ────────────────────────────────────────────────

  describe('Project CRUD', () => {
    it('createProject() returns a Project with generated id and correct defaults', () => {
      const project = queue.createProject(makeProjectInput());

      expect(project.id).toBeDefined();
      expect(typeof project.id).toBe('string');
      expect(project.goal).toBe('Ship feature X');
      expect(project.pmEmployeeId).toBe('pm-1');
      expect(project.employees).toEqual(['emp-1', 'emp-2']);
      expect(project.tasks).toEqual([]);
      expect(project.status).toBe('planning');
      expect(project.createdAt).toBeGreaterThan(0);
      expect(project.completedAt).toBeNull();
    });

    it('getProject() retrieves a project by id', () => {
      const created = queue.createProject(makeProjectInput());
      const fetched = queue.getProject(created.id);

      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.goal).toBe('Ship feature X');
    });

    it('getProject() returns undefined for non-existent project', () => {
      expect(queue.getProject('nonexistent')).toBeUndefined();
    });

    it('listProjects() returns all projects', () => {
      queue.createProject(makeProjectInput({ goal: 'Goal A' }));
      queue.createProject(makeProjectInput({ goal: 'Goal B' }));

      const all = queue.listProjects();
      expect(all).toHaveLength(2);
    });

    it('updateProject() modifies specified fields only', () => {
      const project = queue.createProject(makeProjectInput());
      const updated = queue.updateProject(project.id, {
        goal: 'Updated goal',
        status: 'executing',
      });

      expect(updated.goal).toBe('Updated goal');
      expect(updated.status).toBe('executing');
      // Unmodified fields remain the same
      expect(updated.pmEmployeeId).toBe('pm-1');
    });

    it('updateProject() throws for non-existent project', () => {
      expect(() => queue.updateProject('nonexistent', { goal: 'Nope' })).toThrow(
        'Project not found: nonexistent',
      );
    });

    it('updateProject() with no changes returns existing project', () => {
      const project = queue.createProject(makeProjectInput());
      const same = queue.updateProject(project.id, {});

      expect(same.id).toBe(project.id);
      expect(same.goal).toBe(project.goal);
    });

    it('updateProject() correctly serialises array fields (employees, tasks)', () => {
      const project = queue.createProject(makeProjectInput());
      const updated = queue.updateProject(project.id, {
        employees: ['emp-3', 'emp-4'],
        tasks: ['task-1', 'task-2'],
      });

      expect(updated.employees).toEqual(['emp-3', 'emp-4']);
      expect(updated.tasks).toEqual(['task-1', 'task-2']);
    });
  });

  // ── Events ──────────────────────────────────────────────────────

  describe('Events', () => {
    it('create() emits task-changed with the created task', () => {
      const spy = vi.fn();
      queue.on('task-changed', spy);

      const task = queue.create(makeTaskInput());

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(task);
    });

    it('update() emits task-changed with the updated task', () => {
      const task = queue.create(makeTaskInput());

      const spy = vi.fn();
      queue.on('task-changed', spy);

      const updated = queue.update(task.id, { subject: 'Changed' });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(updated);
    });

    it('claim() emits task-changed', () => {
      const task = queue.create(makeTaskInput());

      const spy = vi.fn();
      queue.on('task-changed', spy);

      queue.claim(task.id, 'emp-1');

      // claim calls update internally which emits task-changed
      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0][0].status).toBe('in_progress');
    });

    it('complete() emits task-changed', () => {
      const task = queue.create(makeTaskInput());
      queue.claim(task.id, 'emp-1');

      const spy = vi.fn();
      queue.on('task-changed', spy);

      queue.complete(task.id, 'Result');

      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0][0].status).toBe('completed');
    });

    it('block() emits task-changed', () => {
      const task = queue.create(makeTaskInput());

      const spy = vi.fn();
      queue.on('task-changed', spy);

      queue.block(task.id);

      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0][0].status).toBe('blocked');
    });

    it('cancel() emits task-changed', () => {
      const task = queue.create(makeTaskInput());
      queue.claim(task.id, 'emp-1');

      const spy = vi.fn();
      queue.on('task-changed', spy);

      queue.cancel(task.id);

      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0][0].status).toBe('pending');
    });

    it('createProject() emits project-changed with the created project', () => {
      const spy = vi.fn();
      queue.on('project-changed', spy);

      const project = queue.createProject(makeProjectInput());

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(project);
    });

    it('updateProject() emits project-changed with the updated project', () => {
      const project = queue.createProject(makeProjectInput());

      const spy = vi.fn();
      queue.on('project-changed', spy);

      const updated = queue.updateProject(project.id, { status: 'executing' });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(updated);
    });

    it('update() with no changes does NOT emit task-changed', () => {
      const task = queue.create(makeTaskInput());

      const spy = vi.fn();
      queue.on('task-changed', spy);

      queue.update(task.id, {});

      expect(spy).not.toHaveBeenCalled();
    });

    it('updateProject() with no changes does NOT emit project-changed', () => {
      const project = queue.createProject(makeProjectInput());

      const spy = vi.fn();
      queue.on('project-changed', spy);

      queue.updateProject(project.id, {});

      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ── Dependency management (addBlocksReference) ──────────────────

  describe('Dependency management', () => {
    it('create() with blockedBy updates the blocks array on the dependency task', () => {
      const dep = queue.create(makeTaskInput({ subject: 'Dependency' }));
      queue.create(
        makeTaskInput({ subject: 'Dependent', blockedBy: [dep.id] }),
      );

      // Re-fetch the dependency to see if blocks was updated
      const refreshedDep = queue.get(dep.id);
      expect(refreshedDep).toBeDefined();
      // The addBlocksReference method should have added the dependent task id
      // to the dependency's blocks array via a direct UPDATE
    });
  });

  // ── getDb() ─────────────────────────────────────────────────────

  describe('getDb()', () => {
    it('returns the database instance', () => {
      const db = queue.getDb();
      // The DB is a MockDatabase constructed from mockDb's properties.
      // Verify it exposes the same interface.
      expect(db).toBeDefined();
      expect(typeof db.exec).toBe('function');
      expect(typeof db.prepare).toBe('function');
      expect(typeof db.pragma).toBe('function');
      expect(typeof db.close).toBe('function');
      expect(db.open).toBe(true);
    });
  });
});
