// @vitest-environment node
/**
 * TaskExecutor Tests
 * Tests the task execution pipeline: validation, activation,
 * gateway dispatch, timeout, cancellation, and queue management.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../../electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Mock Factories ───────────────────────────────────────────────────

function createMockTaskQueue() {
  const emitter = new EventEmitter();
  const tasks = new Map<string, Record<string, unknown>>();

  const queue = {
    ...emitter,
    on: emitter.on.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
    get: vi.fn((id: string) => tasks.get(id) ?? null),
    list: vi.fn((projectId?: string) => {
      return Array.from(tasks.values()).filter(
        (t) => !projectId || t.projectId === projectId
      );
    }),
    create: vi.fn((input: Record<string, unknown>) => {
      const task = {
        id: `task-${tasks.size + 1}`,
        ...input,
        status: 'pending',
        output: null,
        createdAt: Date.now(),
      };
      tasks.set(task.id, task);
      return task;
    }),
    claim: vi.fn((taskId: string, employeeId: string) => {
      const task = tasks.get(taskId);
      if (task) {
        task.status = 'in_progress';
        task.owner = employeeId;
      }
      return task;
    }),
    complete: vi.fn((taskId: string, output: string) => {
      const task = tasks.get(taskId);
      if (task) {
        task.status = 'completed';
        task.output = output;
      }
      return task;
    }),
    block: vi.fn((taskId: string) => {
      const task = tasks.get(taskId);
      if (task) task.status = 'blocked';
      return task;
    }),
    _tasks: tasks,
  };

  return queue;
}

function createMockEmployeeManager() {
  const employees = new Map<string, Record<string, unknown>>();

  return {
    get: vi.fn((id: string) => employees.get(id) ?? null),
    activate: vi.fn(async (id: string) => {
      const emp = employees.get(id);
      if (emp) {
        emp.status = 'idle';
        emp.gatewaySessionKey = `agent:${id}:main`;
      }
      return emp;
    }),
    assignTask: vi.fn((id: string) => {
      const emp = employees.get(id);
      if (emp) emp.status = 'working';
    }),
    completeTask: vi.fn((id: string) => {
      const emp = employees.get(id);
      if (emp) emp.status = 'idle';
    }),
    markError: vi.fn((id: string) => {
      const emp = employees.get(id);
      if (emp) emp.status = 'error';
    }),
    _employees: employees,
  };
}

function createMockGateway() {
  return {
    rpc: vi.fn(async () => ({
      content: 'Task completed successfully. Here is the output.',
    })),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function seedEmployee(
  mgr: ReturnType<typeof createMockEmployeeManager>,
  id: string,
  status = 'idle'
) {
  mgr._employees.set(id, {
    id,
    slug: id,
    status,
    gatewaySessionKey: status !== 'offline' ? `agent:${id}:main` : undefined,
  });
}

function seedTask(
  queue: ReturnType<typeof createMockTaskQueue>,
  id: string,
  projectId = 'proj-1',
  overrides: Record<string, unknown> = {}
) {
  const task = {
    id,
    projectId,
    subject: `Test task ${id}`,
    description: 'Do something useful',
    status: 'in_progress',
    owner: null,
    priority: 'medium',
    requiresApproval: false,
    output: null,
    createdAt: Date.now(),
    ...overrides,
  };
  queue._tasks.set(id, task);
  return task;
}

// ── Tests ────────────────────────────────────────────────────────────

import { TaskExecutor } from '../../../electron/engine/task-executor';

describe('TaskExecutor', () => {
  let taskQueue: ReturnType<typeof createMockTaskQueue>;
  let employeeManager: ReturnType<typeof createMockEmployeeManager>;
  let gateway: ReturnType<typeof createMockGateway>;
  let executor: TaskExecutor;

  beforeEach(() => {
    taskQueue = createMockTaskQueue();
    employeeManager = createMockEmployeeManager();
    gateway = createMockGateway();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    executor = new TaskExecutor(taskQueue as any, employeeManager as any, gateway as any);
  });

  afterEach(() => {
    executor.destroy();
  });

  // ── executeTask ────────────────────────────────────────────────

  describe('executeTask', () => {
    it('should execute a task and return success', async () => {
      seedEmployee(employeeManager, 'emp-1');
      seedTask(taskQueue, 'task-1', 'proj-1', { owner: 'emp-1' });

      const result = await executor.executeTask('task-1', 'emp-1');

      expect(result.success).toBe(true);
      expect(result.taskId).toBe('task-1');
      expect(result.employeeId).toBe('emp-1');
      expect(result.output).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should call gateway.rpc with chat.send', async () => {
      seedEmployee(employeeManager, 'emp-1');
      seedTask(taskQueue, 'task-1', 'proj-1', { owner: 'emp-1' });

      await executor.executeTask('task-1', 'emp-1');

      expect(gateway.rpc).toHaveBeenCalledWith(
        'chat.send',
        expect.objectContaining({
          session: 'agent:emp-1:main',
          deliver: false,
        }),
        expect.any(Number)
      );
    });

    it('should mark task as completed in queue', async () => {
      seedEmployee(employeeManager, 'emp-1');
      seedTask(taskQueue, 'task-1', 'proj-1', { owner: 'emp-1' });

      await executor.executeTask('task-1', 'emp-1');

      expect(taskQueue.complete).toHaveBeenCalledWith('task-1', expect.any(String));
    });

    it('should emit execution:completed event', async () => {
      seedEmployee(employeeManager, 'emp-1');
      seedTask(taskQueue, 'task-1', 'proj-1', { owner: 'emp-1' });

      const listener = vi.fn();
      executor.on('execution:completed', listener);

      await executor.executeTask('task-1', 'emp-1');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-1', success: true })
      );
    });

    it('should fail when task not found', async () => {
      seedEmployee(employeeManager, 'emp-1');

      const result = await executor.executeTask('nonexistent', 'emp-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Task not found');
    });

    it('should fail when employee not found', async () => {
      seedTask(taskQueue, 'task-1');

      const result = await executor.executeTask('task-1', 'nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Employee not found');
    });

    it('should reject duplicate execution', async () => {
      seedEmployee(employeeManager, 'emp-1');
      seedTask(taskQueue, 'task-1', 'proj-1', { owner: 'emp-1' });

      // Make gateway slow so first execution is still in progress
      gateway.rpc.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ content: 'done' }), 200))
      );

      const promise1 = executor.executeTask('task-1', 'emp-1');
      // Tiny delay to ensure first execution has started
      await new Promise((r) => setTimeout(r, 10));
      const result2 = await executor.executeTask('task-1', 'emp-1');

      expect(result2.success).toBe(false);
      expect(result2.error).toContain('already executing');

      await promise1; // Clean up
    });

    it('should auto-activate offline employee', async () => {
      seedEmployee(employeeManager, 'emp-1', 'offline');

      seedTask(taskQueue, 'task-1', 'proj-1', { owner: 'emp-1' });

      await executor.executeTask('task-1', 'emp-1', { autoActivate: true });

      expect(employeeManager.activate).toHaveBeenCalledWith('emp-1');
    });

    it('should handle gateway error gracefully', async () => {
      seedEmployee(employeeManager, 'emp-1');
      seedTask(taskQueue, 'task-1', 'proj-1', { owner: 'emp-1' });

      gateway.rpc.mockRejectedValue(new Error('Gateway connection lost'));

      const result = await executor.executeTask('task-1', 'emp-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Gateway connection lost');
      expect(taskQueue.block).toHaveBeenCalledWith('task-1');
    });

    it('should include project context when requested', async () => {
      seedEmployee(employeeManager, 'emp-1');

      // Add a completed sibling task
      seedTask(taskQueue, 'task-done', 'proj-1', {
        status: 'completed',
        owner: 'emp-2',
        output: 'Research findings: ...',
        subject: 'Research phase',
      });
      seedTask(taskQueue, 'task-2', 'proj-1', { owner: 'emp-1' });

      await executor.executeTask('task-2', 'emp-1', { includeProjectContext: true });

      const sentMessage = gateway.rpc.mock.calls[0][1] as Record<string, unknown>;
      expect(sentMessage.message).toContain('Related Task Outputs');
    });
  });

  // ── executeAdHoc ──────────────────────────────────────────────

  describe('executeAdHoc', () => {
    it('should create and execute a task', async () => {
      seedEmployee(employeeManager, 'emp-1');

      const result = await executor.executeAdHoc('emp-1', 'Summarize the quarterly report');

      expect(taskQueue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'adhoc',
          owner: 'emp-1',
        })
      );
      expect(result.success).toBe(true);
    });
  });

  // ── Cancellation ──────────────────────────────────────────────

  describe('cancel', () => {
    it('should cancel an executing task', async () => {
      seedEmployee(employeeManager, 'emp-1');
      seedTask(taskQueue, 'task-1', 'proj-1', { owner: 'emp-1' });

      // Make gateway slow
      gateway.rpc.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ content: 'done' }), 5000))
      );

      const promise = executor.executeTask('task-1', 'emp-1');
      await new Promise((r) => setTimeout(r, 10));

      const cancelled = executor.cancel('task-1');
      expect(cancelled).toBe(true);

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toContain('cancelled');
    });

    it('should return false for non-executing tasks', () => {
      const cancelled = executor.cancel('nonexistent');
      expect(cancelled).toBe(false);
    });
  });

  describe('cancelAll', () => {
    it('should cancel all executing tasks', async () => {
      seedEmployee(employeeManager, 'emp-1');
      seedEmployee(employeeManager, 'emp-2');
      seedTask(taskQueue, 'task-1', 'proj-1', { owner: 'emp-1' });
      seedTask(taskQueue, 'task-2', 'proj-1', { owner: 'emp-2' });

      gateway.rpc.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ content: 'done' }), 5000))
      );

      const p1 = executor.executeTask('task-1', 'emp-1');
      const p2 = executor.executeTask('task-2', 'emp-2');
      await new Promise((r) => setTimeout(r, 10));

      const count = executor.cancelAll();
      expect(count).toBe(2);

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.success).toBe(false);
      expect(r2.success).toBe(false);
    });
  });

  // ── Queue management ──────────────────────────────────────────

  describe('employee queue', () => {
    it('should queue task when employee is busy', async () => {
      seedEmployee(employeeManager, 'emp-1');
      seedTask(taskQueue, 'task-1', 'proj-1', { owner: 'emp-1' });
      seedTask(taskQueue, 'task-2', 'proj-1', { owner: 'emp-1' });

      // Slow gateway
      gateway.rpc.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ content: 'done' }), 100))
      );

      const p1 = executor.executeTask('task-1', 'emp-1');
      await new Promise((r) => setTimeout(r, 10));

      const result2 = await executor.executeTask('task-2', 'emp-1');
      expect(result2.error).toContain('Queued');

      await p1;
    });
  });

  // ── Status ────────────────────────────────────────────────────

  describe('status methods', () => {
    it('isExecuting should reflect current state', async () => {
      seedEmployee(employeeManager, 'emp-1');
      seedTask(taskQueue, 'task-1', 'proj-1', { owner: 'emp-1' });

      gateway.rpc.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ content: 'done' }), 100))
      );

      const promise = executor.executeTask('task-1', 'emp-1');
      await new Promise((r) => setTimeout(r, 10));

      expect(executor.isExecuting('task-1')).toBe(true);
      expect(executor.getExecutingTasks()).toContain('task-1');

      await promise;
      expect(executor.isExecuting('task-1')).toBe(false);
    });

    it('getStats should return correct counts', () => {
      const stats = executor.getStats();
      expect(stats.executing).toBe(0);
      expect(stats.queued).toBe(0);
      expect(stats.busyEmployees).toBe(0);
    });
  });

  // ── Configuration ─────────────────────────────────────────────

  describe('setAutoExecute', () => {
    it('should toggle auto-execute', () => {
      executor.setAutoExecute(false);
      expect(executor.isAutoExecuteEnabled()).toBe(false);

      executor.setAutoExecute(true);
      expect(executor.isAutoExecuteEnabled()).toBe(true);
    });
  });

  // ── Cleanup ───────────────────────────────────────────────────

  describe('destroy', () => {
    it('should clean up all state', () => {
      executor.destroy();
      expect(executor.getStats().executing).toBe(0);
      expect(executor.getStats().queued).toBe(0);
    });

    it('should remove task-changed listener from queue', () => {
      // TaskExecutor calls taskQueue.removeListener('task-changed', ...) on destroy
      const spy = vi.spyOn(taskQueue, 'removeListener');
      executor.destroy();
      expect(spy).toHaveBeenCalledWith('task-changed', expect.any(Function));
    });
  });
});
