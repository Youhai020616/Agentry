/**
 * SupervisorEngine Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';

vi.mock('../../../electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { SupervisorEngine } from '../../../electron/engine/supervisor';

// ── Mock Helpers ──────────────────────────────────────────────────────

function createMockTaskQueue() {
  return {
    create: vi.fn().mockImplementation((input) => ({
      id: crypto.randomUUID(),
      ...input,
      status: 'pending',
      blockedBy: input.blockedBy ?? [],
      blocks: [],
      createdAt: Date.now(),
    })),
    get: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    listAvailable: vi.fn().mockReturnValue([]),
    update: vi.fn().mockImplementation((id, changes) => ({
      id,
      projectId: 'proj-1',
      subject: 'Test Task',
      owner: 'emp-1',
      ...changes,
    })),
    claim: vi.fn(),
    cancel: vi.fn(),
    createProject: vi.fn().mockImplementation((input) => ({
      id: crypto.randomUUID(),
      ...input,
      tasks: [],
      status: 'planning',
      createdAt: Date.now(),
      completedAt: null,
    })),
    createProjectWithTasks: vi.fn().mockImplementation((projectInput, taskInputs) => {
      const projectId = crypto.randomUUID();
      const project = {
        id: projectId,
        ...projectInput,
        tasks: taskInputs.map(() => crypto.randomUUID()),
        status: 'planning',
        createdAt: Date.now(),
        completedAt: null,
      };
      const tasks = taskInputs.map((input: any, i: number) => ({
        id: project.tasks[i],
        projectId,
        ...input,
        status: 'pending',
        blockedBy: input.blockedBy ?? [],
        blocks: [],
        createdAt: Date.now(),
      }));
      return { project, tasks };
    }),
    getProject: vi.fn(),
    updateProject: vi.fn(),
    on: vi.fn(),
    emit: vi.fn(),
  };
}

function createMockMessageBus() {
  return { send: vi.fn(), on: vi.fn() };
}

function createMockEmployeeManager() {
  return {
    get: vi.fn().mockReturnValue({
      id: 'pm-1',
      role: 'PM',
      status: 'idle',
      gatewaySessionKey: 'session-pm',
    }),
    list: vi.fn().mockReturnValue([]),
    assignTask: vi.fn(),
    completeTask: vi.fn(),
    markError: vi.fn(),
    recover: vi.fn(),
  };
}

function createMockGateway() {
  return {
    rpc: vi.fn().mockResolvedValue('[{"subject":"Task 1","description":"Do something"}]'),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
}

function createMockTaskExecutor() {
  return {
    cancel: vi.fn(),
    on: vi.fn(),
  };
}

describe('SupervisorEngine', () => {
  let engine: SupervisorEngine;
  let taskQueue: ReturnType<typeof createMockTaskQueue>;
  let messageBus: ReturnType<typeof createMockMessageBus>;
  let employeeManager: ReturnType<typeof createMockEmployeeManager>;
  let gateway: ReturnType<typeof createMockGateway>;
  let taskExecutor: ReturnType<typeof createMockTaskExecutor>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    taskQueue = createMockTaskQueue();
    messageBus = createMockMessageBus();
    employeeManager = createMockEmployeeManager();
    gateway = createMockGateway();
    taskExecutor = createMockTaskExecutor();

    engine = new SupervisorEngine(
      taskQueue as any,
      messageBus as any,
      employeeManager as any,
      gateway as any,
      taskExecutor as any,
    );
  });

  afterEach(() => {
    engine.destroy();
    vi.useRealTimers();
  });

  // ── planProject ──────────────────────────────────────────────────

  describe('planProject', () => {
    it('should create a project and ask PM via gateway RPC', async () => {
      const projectId = 'proj-test';
      taskQueue.createProjectWithTasks.mockReturnValue({
        project: {
          id: projectId,
          goal: 'Build feature',
          pmEmployeeId: 'pm-1',
          employees: ['pm-1'],
          tasks: [],
          status: 'planning',
          createdAt: Date.now(),
          completedAt: null,
        },
        tasks: [],
      });
      taskQueue.getProject.mockReturnValue({
        id: projectId,
        goal: 'Build feature',
        pmEmployeeId: 'pm-1',
        employees: ['pm-1'],
        tasks: [],
        status: 'planning',
        createdAt: Date.now(),
        completedAt: null,
      });

      await engine.planProject('Build feature', 'pm-1');

      // Should create a project with tasks atomically
      expect(taskQueue.createProjectWithTasks).toHaveBeenCalledWith(
        expect.objectContaining({
          goal: 'Build feature',
          pmEmployeeId: 'pm-1',
        }),
        expect.any(Array),
      );

      // Should call gateway RPC with chat.send
      expect(gateway.rpc).toHaveBeenCalledWith(
        'chat.send',
        expect.objectContaining({
          session: 'session-pm',
        }),
        60_000,
      );
    });

    it('should parse PM response into tasks', async () => {
      const projectId = 'proj-test';
      gateway.rpc.mockResolvedValue(
        '[{"subject":"Design API","description":"Design the REST API"},{"subject":"Implement API","description":"Implement endpoints","blockedBy":["T0"]}]',
      );

      taskQueue.createProjectWithTasks.mockImplementation((projectInput, taskInputs) => {
        const project = {
          id: projectId,
          ...projectInput,
          tasks: ['task-1', 'task-2'],
          status: 'planning',
          createdAt: Date.now(),
          completedAt: null,
        };
        const tasks = (taskInputs as any[]).map((input: any, i: number) => ({
          id: `task-${i + 1}`,
          projectId,
          ...input,
          status: 'pending',
          blockedBy: input.blockedBy ?? [],
          blocks: [],
          createdAt: Date.now(),
        }));
        return { project, tasks };
      });

      taskQueue.getProject.mockReturnValue({
        id: projectId,
        goal: 'Build API',
        pmEmployeeId: 'pm-1',
        employees: ['pm-1'],
        tasks: ['task-1', 'task-2'],
        status: 'planning',
        createdAt: Date.now(),
        completedAt: null,
      });

      await engine.planProject('Build API', 'pm-1');

      // Should create project with two tasks atomically
      expect(taskQueue.createProjectWithTasks).toHaveBeenCalledTimes(1);
      const [, taskInputs] = taskQueue.createProjectWithTasks.mock.calls[0];
      expect(taskInputs).toHaveLength(2);
      expect(taskInputs[0].subject).toBe('Design API');
      expect(taskInputs[1].subject).toBe('Implement API');
    });

    it('should handle PM response failure gracefully', async () => {
      const projectId = 'proj-fail';
      gateway.rpc.mockRejectedValue(new Error('Gateway timeout'));

      const project = {
        id: projectId,
        goal: 'Failing goal',
        pmEmployeeId: 'pm-1',
        employees: ['pm-1'],
        tasks: [],
        status: 'planning',
        createdAt: Date.now(),
        completedAt: null,
      };
      taskQueue.createProject.mockReturnValue(project);

      // planProject should NOT throw — it catches and returns empty project
      const result = await engine.planProject('Failing goal', 'pm-1');

      expect(result).toBeDefined();
      // Transactional creation was not called since gateway failed
      expect(taskQueue.createProjectWithTasks).not.toHaveBeenCalled();
      // Fallback: createProject was called
      expect(taskQueue.createProject).toHaveBeenCalled();
    });

    it('should throw if PM employee not found', async () => {
      employeeManager.get.mockReturnValue(undefined);

      await expect(engine.planProject('Goal', 'missing-pm')).rejects.toThrow(
        'PM employee not found',
      );
    });

    it('should throw if PM employee has no session key', async () => {
      employeeManager.get.mockReturnValue({
        id: 'pm-1',
        role: 'PM',
        status: 'idle',
        gatewaySessionKey: undefined,
      });

      await expect(engine.planProject('Goal', 'pm-1')).rejects.toThrow(
        'not activated',
      );
    });
  });

  // ── executeProject ───────────────────────────────────────────────

  describe('executeProject', () => {
    it('should update project status and claim available tasks', async () => {
      const project = {
        id: 'proj-1',
        goal: 'Build it',
        pmEmployeeId: 'pm-1',
        employees: ['pm-1', 'emp-2', 'emp-3'],
        tasks: [],
        status: 'planning' as const,
        createdAt: Date.now(),
        completedAt: null,
      };
      taskQueue.getProject.mockReturnValue(project);

      const startedSpy = vi.fn();
      engine.on('project-started', startedSpy);

      await engine.executeProject('proj-1');

      // Should update project status to executing
      expect(taskQueue.updateProject).toHaveBeenCalledWith('proj-1', {
        status: 'executing',
      });

      // Should attempt to claim available tasks
      expect(taskQueue.listAvailable).toHaveBeenCalledWith('proj-1');

      // Should emit project-started event
      expect(startedSpy).toHaveBeenCalledWith(project);
    });

    it('should throw if project not found', async () => {
      taskQueue.getProject.mockReturnValue(undefined);

      await expect(engine.executeProject('nonexistent')).rejects.toThrow(
        'Project not found',
      );
    });
  });

  // ── submitPlan ────────────────────────────────────────────────────

  describe('submitPlan', () => {
    it('should update task and notify PM', async () => {
      const project = {
        id: 'proj-1',
        goal: 'Goal',
        pmEmployeeId: 'pm-1',
        employees: ['pm-1', 'emp-1'],
        tasks: ['task-1'],
        status: 'executing' as const,
        createdAt: Date.now(),
        completedAt: null,
      };
      taskQueue.update.mockReturnValue({
        id: 'task-1',
        projectId: 'proj-1',
        subject: 'My Task',
        owner: 'emp-1',
        plan: 'The plan',
        planStatus: 'submitted',
      });
      taskQueue.getProject.mockReturnValue(project);

      await engine.submitPlan('task-1', 'The plan');

      // Should update the task with plan and planStatus
      expect(taskQueue.update).toHaveBeenCalledWith('task-1', {
        plan: 'The plan',
        planStatus: 'submitted',
      });

      // Should send a message to PM
      expect(messageBus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'plan_approval',
          from: 'emp-1',
          recipient: 'pm-1',
          requestId: 'task-1',
        }),
      );
    });
  });

  // ── approvePlan ──────────────────────────────────────────────────

  describe('approvePlan', () => {
    it('should update planStatus to approved and notify employee', async () => {
      taskQueue.update.mockReturnValue({
        id: 'task-1',
        projectId: 'proj-1',
        subject: 'My Task',
        owner: 'emp-1',
        planStatus: 'approved',
      });

      await engine.approvePlan('task-1');

      expect(taskQueue.update).toHaveBeenCalledWith('task-1', {
        planStatus: 'approved',
      });

      expect(messageBus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'pm',
          recipient: 'emp-1',
          summary: 'Plan approved — proceed',
        }),
      );
    });

    it('should not send message if task has no owner', async () => {
      taskQueue.update.mockReturnValue({
        id: 'task-1',
        projectId: 'proj-1',
        subject: 'My Task',
        owner: null,
        planStatus: 'approved',
      });

      await engine.approvePlan('task-1');

      expect(messageBus.send).not.toHaveBeenCalled();
    });
  });

  // ── rejectPlan ───────────────────────────────────────────────────

  describe('rejectPlan', () => {
    it('should include feedback in the notification', async () => {
      taskQueue.update.mockReturnValue({
        id: 'task-1',
        projectId: 'proj-1',
        subject: 'My Task',
        owner: 'emp-1',
        planStatus: 'rejected',
        planFeedback: 'Needs more detail',
      });

      await engine.rejectPlan('task-1', 'Needs more detail');

      expect(taskQueue.update).toHaveBeenCalledWith('task-1', {
        planStatus: 'rejected',
        planFeedback: 'Needs more detail',
      });

      expect(messageBus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'pm',
          recipient: 'emp-1',
          summary: 'Plan rejected — revise',
        }),
      );

      // The content should include the feedback
      const sentContent = messageBus.send.mock.calls[0][0].content;
      expect(sentContent).toContain('Needs more detail');
    });

    it('should not send message if task has no owner', async () => {
      taskQueue.update.mockReturnValue({
        id: 'task-1',
        projectId: 'proj-1',
        subject: 'My Task',
        owner: null,
        planStatus: 'rejected',
      });

      await engine.rejectPlan('task-1', 'Bad plan');

      expect(messageBus.send).not.toHaveBeenCalled();
    });
  });

  // ── getEmployeeWorkLoopPrompt ────────────────────────────────────

  describe('getEmployeeWorkLoopPrompt', () => {
    it('should return a non-empty string with work loop instructions', () => {
      const prompt = engine.getEmployeeWorkLoopPrompt();

      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain('Work Loop');
      expect(prompt).toContain('taskBoard');
    });
  });

  // ── destroy ──────────────────────────────────────────────────────

  describe('destroy', () => {
    it('should clear all heartbeats', async () => {
      // Set up a project so executeProject starts a heartbeat
      const project = {
        id: 'proj-1',
        goal: 'Goal',
        pmEmployeeId: 'pm-1',
        employees: ['pm-1'],
        tasks: [],
        status: 'planning' as const,
        createdAt: Date.now(),
        completedAt: null,
      };
      taskQueue.getProject.mockReturnValue(project);

      await engine.executeProject('proj-1');

      // Spy on removeAllListeners to verify cleanup
      const removeAllSpy = vi.spyOn(engine, 'removeAllListeners');

      engine.destroy();

      expect(removeAllSpy).toHaveBeenCalled();
    });

    it('should be safe to call multiple times', () => {
      engine.destroy();
      expect(() => engine.destroy()).not.toThrow();
    });
  });
});
