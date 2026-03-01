/**
 * Supervisor Engine E2E Integration Test
 *
 * Tests the FULL Supervisor workflow with:
 * - Real SQLite (better-sqlite3) — no mocks
 * - Real TaskQueue + MessageBus + EmployeeManager wiring
 * - Mocked Gateway RPC (simulates LLM responses)
 * - Mocked Electron APIs (app.getPath, electron-store)
 *
 * Flow tested:
 *   User goal → PM plans tasks (DAG) → employees execute → auto-unblock → synthesis
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Mock Electron APIs before importing engine modules ────────────────

// Mock electron app.getPath
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return '/tmp/clawx-test';
      return `/tmp/${name}`;
    },
  },
}));

// Mock electron-store (used by EmployeeManager for onboarding state)
vi.mock('electron-store', () => {
  const store = new Map<string, unknown>();
  return {
    default: class MockStore {
      get(key: string) {
        return store.get(key);
      }
      set(key: string, value: unknown) {
        store.set(key, value);
      }
    },
  };
});

// Mock logger to suppress noise (enable for debugging)
vi.mock('../../electron/utils/logger', () => ({
  logger: {
    info: () => {},
    debug: () => {},
    warn: (...args: unknown[]) => console.warn('[WARN]', ...args),
    error: (...args: unknown[]) => console.error('[ERROR]', ...args),
  },
}));

// ── Now import engine modules ──────────────────────────────────────────

import { TaskQueue } from '../../electron/engine/task-queue';
import { MessageBus } from '../../electron/engine/message-bus';
import { SupervisorEngine } from '../../electron/engine/supervisor';
import { TaskExecutor } from '../../electron/engine/task-executor';
import type { Employee } from '../../src/types/employee';
import type { Task } from '../../src/types/task';

// ── Fake Gateway (simulates LLM responses) ─────────────────────────────

class FakeGateway extends EventEmitter {
  /**
   * Map of session key → response handler.
   * The handler receives the prompt and returns a fake LLM response.
   */
  private handlers: Map<string, (prompt: string) => string> = new Map();

  /** Record of all RPC calls for assertions */
  calls: Array<{ method: string; session: string; message: string }> = [];

  registerHandler(sessionKey: string, handler: (prompt: string) => string) {
    this.handlers.set(sessionKey, handler);
  }

  async rpc<T>(method: string, params: Record<string, unknown>, _timeout?: number): Promise<T> {
    const session = params.session as string;
    const message = params.message as string;
    this.calls.push({ method, session, message });

    const handler = this.handlers.get(session);
    if (handler) {
      const response = handler(message);
      return { content: response } as T;
    }

    return { content: `[No handler for session: ${session}]` } as T;
  }
}

// ── Fake EmployeeManager ───────────────────────────────────────────────

class FakeEmployeeManager {
  private employees: Map<string, Employee> = new Map();

  addEmployee(employee: Employee) {
    this.employees.set(employee.id, employee);
  }

  get(id: string): Employee | undefined {
    // Support lookup by id or slug
    return this.employees.get(id) ?? [...this.employees.values()].find((e) => e.slug === id);
  }

  list(status?: string): Employee[] {
    const all = [...this.employees.values()];
    if (status) return all.filter((e) => e.status === status);
    return all;
  }

  async activate(id: string): Promise<void> {
    const emp = this.get(id);
    if (emp) {
      emp.status = 'idle';
      emp.gatewaySessionKey = `agent:${emp.slug}:main`;
    }
  }

  assignTask(id: string) {
    const emp = this.get(id);
    if (emp) emp.status = 'working';
  }

  completeTask(id: string) {
    const emp = this.get(id);
    if (emp) emp.status = 'idle';
  }

  markError(id: string) {
    const emp = this.get(id);
    if (emp) emp.status = 'error';
  }

  markBlocked(id: string) {
    const emp = this.get(id);
    if (emp) emp.status = 'blocked';
  }
}

// ── Helper: create a fake employee ─────────────────────────────────────

function makeEmployee(overrides: Partial<Employee> & { id: string; slug: string }): Employee {
  return {
    name: overrides.slug,
    role: overrides.role ?? 'Worker',
    roleZh: overrides.role ?? '工人',
    avatar: '🤖',
    team: overrides.team ?? 'default',
    status: overrides.status ?? 'idle',
    config: {},
    gatewaySessionKey: overrides.gatewaySessionKey ?? `agent:${overrides.slug}:main`,
    systemPrompt: '',
    skillDir: `/fake/skills/${overrides.slug}`,
    source: 'builtin',
    hasOnboarding: false,
    onboardingCompleted: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ── Test Suite ──────────────────────────────────────────────────────────

describe('Supervisor Engine E2E (Real SQLite)', () => {
  let tmpDir: string;
  let taskQueue: TaskQueue;
  let messageBus: MessageBus;
  let gateway: FakeGateway;
  let employeeManager: FakeEmployeeManager;
  let supervisor: SupervisorEngine;
  let taskExecutor: TaskExecutor;

  beforeEach(() => {
    // Create a temp directory for SQLite databases
    tmpDir = mkdtempSync(join(tmpdir(), 'clawx-e2e-'));

    // Initialize TaskQueue with real SQLite
    const dbPath = join(tmpDir, 'tasks.db');
    taskQueue = new TaskQueue(dbPath);
    taskQueue.init();

    // Initialize MessageBus sharing the same DB
    employeeManager = new FakeEmployeeManager();
    messageBus = new MessageBus(taskQueue.getDb(), () =>
      employeeManager
        .list('idle')
        .concat(employeeManager.list('working'))
        .map((e) => e.id)
    );
    messageBus.init();

    // Initialize fake Gateway
    gateway = new FakeGateway();

    // Initialize TaskExecutor (disable auto-execute for manual control)
    taskExecutor = new TaskExecutor(
      taskQueue,
      employeeManager as unknown as import('../../electron/engine/employee-manager').EmployeeManager,
      gateway as unknown as import('../../electron/gateway/manager').GatewayManager
    );
    taskExecutor.setAutoExecute(false);

    // Initialize Supervisor (requires taskExecutor as 5th arg)
    supervisor = new SupervisorEngine(
      taskQueue,
      messageBus,
      employeeManager as unknown as import('../../electron/engine/employee-manager').EmployeeManager,
      gateway as unknown as import('../../electron/gateway/manager').GatewayManager,
      taskExecutor
    );
  });

  afterEach(() => {
    supervisor.destroy();
    taskExecutor.destroy();
    taskQueue.destroy();
    // Clean up temp database
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // ── Test 1: Full Project Lifecycle ────────────────────────────────

  it('should complete a full project lifecycle: plan → execute → synthesize', async () => {
    // 1. Set up employees
    const pm = makeEmployee({
      id: 'supervisor',
      slug: 'supervisor',
      role: 'Project Manager',
      team: 'Management',
      gatewaySessionKey: 'agent:supervisor:main',
    });

    const seoExpert = makeEmployee({
      id: 'seo-specialist',
      slug: 'seo-specialist',
      role: 'SEO Specialist',
      team: 'Marketing',
    });

    const copywriter = makeEmployee({
      id: 'copywriter',
      slug: 'copywriter',
      role: 'Copywriter',
      team: 'Marketing',
    });

    employeeManager.addEmployee(pm);
    employeeManager.addEmployee(seoExpert);
    employeeManager.addEmployee(copywriter);

    // 2. Register Gateway handlers (simulate LLM responses)

    // PM plans the project
    gateway.registerHandler('agent:supervisor:main', (prompt: string) => {
      if (prompt.includes('Analyze the following goal')) {
        // PM returns a task plan with dependencies
        return JSON.stringify([
          {
            subject: 'Keyword Research',
            description: 'Research top keywords for the product launch',
            assignTo: 'seo-specialist',
            blockedBy: [],
            priority: 'high',
            wave: 0,
          },
          {
            subject: 'Product Tagline',
            description: 'Write a catchy product tagline',
            assignTo: 'copywriter',
            blockedBy: [],
            priority: 'high',
            wave: 0,
          },
          {
            subject: 'Landing Page Copy',
            description: 'Write landing page copy using the keyword research and tagline',
            assignTo: 'copywriter',
            blockedBy: ['T0', 'T1'],
            priority: 'medium',
            wave: 1,
          },
          {
            subject: 'SEO Optimization',
            description: 'Optimize the landing page copy for SEO',
            assignTo: 'seo-specialist',
            blockedBy: ['T2'],
            priority: 'medium',
            wave: 2,
          },
        ]);
      }

      if (prompt.includes('All tasks for project')) {
        // PM synthesizes results
        return (
          '## Product Launch Marketing Package\n\n' +
          '### Key Findings\n' +
          '- Top keywords: "AI assistant", "productivity"\n' +
          '- Tagline: "Work Smarter, Not Harder"\n' +
          '- Landing page copy optimized for SEO\n\n' +
          '### Next Steps\n' +
          '1. Deploy landing page\n' +
          '2. Start PPC campaign'
        );
      }

      return 'OK';
    });

    // SEO Expert handles tasks
    gateway.registerHandler('agent:seo-specialist:main', (prompt: string) => {
      if (prompt.includes('Keyword Research')) {
        return 'Top keywords: "AI assistant" (vol: 12K), "productivity tool" (vol: 8K), "automate work" (vol: 5K)';
      }
      if (prompt.includes('SEO Optimization')) {
        return 'SEO optimized: Added meta tags, H1/H2 structure, keyword density 2.1%, internal links added.';
      }
      return 'SEO analysis complete';
    });

    // Copywriter handles tasks
    gateway.registerHandler('agent:copywriter:main', (prompt: string) => {
      if (prompt.includes('Landing Page Copy') || prompt.includes('landing page copy')) {
        return '# Transform Your Workflow\n\nMeet the AI assistant that helps you work smarter...';
      }
      if (prompt.includes('Product Tagline') || prompt.includes('tagline')) {
        return '"Work Smarter, Not Harder" — AI-powered productivity for modern teams.';
      }
      return 'Copy complete';
    });

    // 3. Plan the project
    const project = await supervisor.planProject(
      'Prepare marketing materials for our new AI product launch',
      'supervisor'
    );

    expect(project).toBeDefined();
    expect(project.status).toBe('planning');
    expect(project.pmEmployeeId).toBe('supervisor');

    // 4. Verify tasks were created correctly
    const tasks = taskQueue.list(project.id);
    expect(tasks).toHaveLength(4);

    // Verify Wave 0 tasks (no dependencies)
    const wave0 = tasks.filter((t) => t.wave === 0);
    expect(wave0).toHaveLength(2);
    expect(wave0[0].subject).toBe('Keyword Research');
    expect(wave0[0].owner).toBe('seo-specialist');
    expect(wave0[0].blockedBy).toEqual([]);
    expect(wave0[1].subject).toBe('Product Tagline');
    expect(wave0[1].owner).toBe('copywriter');
    expect(wave0[1].blockedBy).toEqual([]);

    // Verify Wave 1 task (depends on Wave 0)
    const wave1 = tasks.filter((t) => t.wave === 1);
    expect(wave1).toHaveLength(1);
    expect(wave1[0].subject).toBe('Landing Page Copy');
    expect(wave1[0].blockedBy).toHaveLength(2);

    // Verify Wave 2 task (depends on Wave 1)
    const wave2 = tasks.filter((t) => t.wave === 2);
    expect(wave2).toHaveLength(1);
    expect(wave2[0].subject).toBe('SEO Optimization');
    expect(wave2[0].blockedBy).toHaveLength(1);
    expect(wave2[0].blockedBy[0]).toBe(wave1[0].id);

    // 5. Verify DAG: Wave 1 depends on the real IDs of Wave 0 tasks
    const keywordTaskId = wave0[0].id;
    const taglineTaskId = wave0[1].id;
    expect(wave1[0].blockedBy).toContain(keywordTaskId);
    expect(wave1[0].blockedBy).toContain(taglineTaskId);

    // 6. Start project execution
    await supervisor.executeProject(project.id);

    const executingProject = taskQueue.getProject(project.id);
    expect(executingProject?.status).toBe('executing');

    // 7. Verify available tasks (only Wave 0 should be available)
    const available = taskQueue.listAvailable(project.id);
    expect(available).toHaveLength(2);
    expect(available.map((t) => t.subject).sort()).toEqual(['Keyword Research', 'Product Tagline']);

    // 8. Execute Wave 0 tasks
    // Claim and execute "Keyword Research"
    taskQueue.claim(wave0[0].id, 'seo-specialist');
    const result1 = await taskExecutor.executeTask(wave0[0].id, 'seo-specialist');
    expect(result1.success).toBe(true);
    expect(result1.output).toContain('AI assistant');

    // Claim and execute "Product Tagline"
    taskQueue.claim(wave0[1].id, 'copywriter');
    const result2 = await taskExecutor.executeTask(wave0[1].id, 'copywriter');
    expect(result2.success).toBe(true);
    expect(result2.output).toContain('Work Smarter');

    // 9. Verify task states
    const afterWave0 = taskQueue.list(project.id);
    expect(afterWave0.filter((t) => t.status === 'completed')).toHaveLength(2);
    expect(afterWave0.filter((t) => t.status === 'pending')).toHaveLength(2);

    // 10. Verify auto-unblock: Wave 1 task should now be available
    const availableAfterWave0 = taskQueue.listAvailable(project.id);
    expect(availableAfterWave0).toHaveLength(1);
    expect(availableAfterWave0[0].subject).toBe('Landing Page Copy');

    // Wave 2 should NOT be available yet
    const wave2Task = taskQueue.get(wave2[0].id)!;
    const wave2Dep = taskQueue.get(wave2Task.blockedBy[0])!;
    expect(wave2Dep.status).toBe('pending'); // Wave 1 hasn't completed yet

    // 11. Execute Wave 1 task
    taskQueue.claim(wave1[0].id, 'copywriter');
    const result3 = await taskExecutor.executeTask(wave1[0].id, 'copywriter', {
      includeProjectContext: true,
    });
    expect(result3.success).toBe(true);
    expect(result3.output).toContain('Transform Your Workflow');

    // 12. Verify Wave 2 is now available
    const availableAfterWave1 = taskQueue.listAvailable(project.id);
    expect(availableAfterWave1).toHaveLength(1);
    expect(availableAfterWave1[0].subject).toBe('SEO Optimization');

    // 13. Execute Wave 2 task
    taskQueue.claim(wave2[0].id, 'seo-specialist');
    const result4 = await taskExecutor.executeTask(wave2[0].id, 'seo-specialist');
    expect(result4.success).toBe(true);
    expect(result4.output).toContain('SEO optimized');

    // 14. Verify all tasks are completed
    const finalTasks = taskQueue.list(project.id);
    expect(finalTasks.every((t) => t.status === 'completed')).toBe(true);

    // Verify all outputs are persisted in SQLite
    for (const task of finalTasks) {
      expect(task.output).toBeTruthy();
      expect(task.completedAt).toBeGreaterThan(0);
    }

    // 15. Synthesize results
    const synthesis = await supervisor.synthesizeResults(project.id);
    expect(synthesis).toContain('Product Launch Marketing Package');
    expect(synthesis).toContain('Next Steps');

    // 16. Verify Gateway was called for synthesis
    const synthesisCalls = gateway.calls.filter(
      (c) => c.session === 'agent:supervisor:main' && c.message.includes('All tasks for project')
    );
    expect(synthesisCalls).toHaveLength(1);
  });

  // ── Test 2: DAG Dependency Blocking ──────────────────────────────

  it('should block tasks whose dependencies are not yet completed', () => {
    // Create a project with dependency chain: T0 → T1 → T2
    const project = taskQueue.createProject({
      goal: 'Test dependency chain',
      pmEmployeeId: 'supervisor',
      employees: ['supervisor', 'worker-a'],
    });

    const t0 = taskQueue.create({
      projectId: project.id,
      subject: 'Step 1',
      description: 'First step',
      owner: 'worker-a',
      wave: 0,
    });

    const t1 = taskQueue.create({
      projectId: project.id,
      subject: 'Step 2',
      description: 'Depends on Step 1',
      owner: 'worker-a',
      blockedBy: [t0.id],
      wave: 1,
    });

    const t2 = taskQueue.create({
      projectId: project.id,
      subject: 'Step 3',
      description: 'Depends on Step 2',
      owner: 'worker-a',
      blockedBy: [t1.id],
      wave: 2,
    });

    // Initially only T0 is available
    let available = taskQueue.listAvailable(project.id);
    expect(available).toHaveLength(1);
    expect(available[0].id).toBe(t0.id);

    // Complete T0 → T1 becomes available
    taskQueue.claim(t0.id, 'worker-a');
    taskQueue.complete(t0.id, 'Step 1 done');
    available = taskQueue.listAvailable(project.id);
    expect(available).toHaveLength(1);
    expect(available[0].id).toBe(t1.id);

    // T2 is still blocked
    const t2State = taskQueue.get(t2.id)!;
    expect(t2State.status).toBe('pending');
    expect(t2State.blockedBy).toContain(t1.id);

    // Complete T1 → T2 becomes available
    taskQueue.claim(t1.id, 'worker-a');
    taskQueue.complete(t1.id, 'Step 2 done');
    available = taskQueue.listAvailable(project.id);
    expect(available).toHaveLength(1);
    expect(available[0].id).toBe(t2.id);

    // Complete T2 → nothing available
    taskQueue.claim(t2.id, 'worker-a');
    taskQueue.complete(t2.id, 'Step 3 done');
    available = taskQueue.listAvailable(project.id);
    expect(available).toHaveLength(0);

    // All completed
    const allTasks = taskQueue.list(project.id);
    expect(allTasks.every((t) => t.status === 'completed')).toBe(true);
  });

  // ── Test 3: Parallel Wave Execution ──────────────────────────────

  it('should allow parallel tasks in the same wave', () => {
    const project = taskQueue.createProject({
      goal: 'Test parallel waves',
      pmEmployeeId: 'pm',
      employees: ['pm', 'worker-a', 'worker-b', 'worker-c'],
    });

    // Wave 0: 3 independent tasks
    const t1 = taskQueue.create({
      projectId: project.id,
      subject: 'Task A',
      description: 'Independent A',
      owner: 'worker-a',
      wave: 0,
    });
    const t2 = taskQueue.create({
      projectId: project.id,
      subject: 'Task B',
      description: 'Independent B',
      owner: 'worker-b',
      wave: 0,
    });
    const t3 = taskQueue.create({
      projectId: project.id,
      subject: 'Task C',
      description: 'Independent C',
      owner: 'worker-c',
      wave: 0,
    });

    // Wave 1: depends on all of Wave 0
    const t4 = taskQueue.create({
      projectId: project.id,
      subject: 'Synthesis',
      description: 'Combine all results',
      owner: 'pm',
      blockedBy: [t1.id, t2.id, t3.id],
      wave: 1,
    });

    // All Wave 0 tasks should be available simultaneously
    let available = taskQueue.listAvailable(project.id);
    expect(available).toHaveLength(3);

    // Complete 2 of 3 — synthesis still blocked
    taskQueue.claim(t1.id, 'worker-a');
    taskQueue.complete(t1.id, 'Result A');
    taskQueue.claim(t2.id, 'worker-b');
    taskQueue.complete(t2.id, 'Result B');

    available = taskQueue.listAvailable(project.id);
    expect(available).toHaveLength(1);
    expect(available[0].id).toBe(t3.id); // Only Task C left

    // Synthesis is NOT available yet (Task C not done)
    const synthTask = taskQueue.get(t4.id)!;
    const allDepsCompleted = synthTask.blockedBy.every((depId) => {
      const dep = taskQueue.get(depId);
      return dep?.status === 'completed';
    });
    expect(allDepsCompleted).toBe(false);

    // Complete Task C → synthesis becomes available
    taskQueue.claim(t3.id, 'worker-c');
    taskQueue.complete(t3.id, 'Result C');

    available = taskQueue.listAvailable(project.id);
    expect(available).toHaveLength(1);
    expect(available[0].id).toBe(t4.id);
  });

  // ── Test 4: Plan Approval Gate ───────────────────────────────────

  it('should support plan approval workflow', async () => {
    const pm = makeEmployee({
      id: 'supervisor',
      slug: 'supervisor',
      role: 'PM',
      gatewaySessionKey: 'agent:supervisor:main',
    });
    employeeManager.addEmployee(pm);

    const project = taskQueue.createProject({
      goal: 'Test approval',
      pmEmployeeId: 'supervisor',
      employees: ['supervisor', 'worker'],
    });

    const task = taskQueue.create({
      projectId: project.id,
      subject: 'High-risk task',
      description: 'Needs approval',
      owner: 'worker',
      requiresApproval: true,
    });

    // Employee submits a plan
    await supervisor.submitPlan(task.id, 'My plan: do X then Y');

    // Verify plan is saved
    const submitted = taskQueue.get(task.id)!;
    expect(submitted.plan).toBe('My plan: do X then Y');
    expect(submitted.planStatus).toBe('submitted');

    // PM receives the plan in their inbox
    const pmInbox = messageBus.getInbox('supervisor');
    expect(pmInbox).toHaveLength(1);
    expect(pmInbox[0].type).toBe('plan_approval');
    expect(pmInbox[0].content).toContain('My plan: do X then Y');

    // PM rejects the plan
    await supervisor.rejectPlan(task.id, 'Need more detail on step X');

    const rejected = taskQueue.get(task.id)!;
    expect(rejected.planStatus).toBe('rejected');
    expect(rejected.planFeedback).toBe('Need more detail on step X');

    // Worker gets the rejection message
    const workerInbox = messageBus.getInbox('worker');
    expect(workerInbox.some((m) => m.content.includes('rejected'))).toBe(true);

    // Employee resubmits
    await supervisor.submitPlan(task.id, 'Revised plan: X with details, then Y');

    // PM approves
    await supervisor.approvePlan(task.id);

    const approved = taskQueue.get(task.id)!;
    expect(approved.planStatus).toBe('approved');

    // Worker gets approval message
    const workerInbox2 = messageBus.getInbox('worker');
    expect(workerInbox2.some((m) => m.content.includes('approved'))).toBe(true);
  });

  // ── Test 5: Monitor Loop — Stuck Task Detection ──────────────────

  it('should detect stuck tasks in monitor tick', async () => {
    const pm = makeEmployee({
      id: 'supervisor',
      slug: 'supervisor',
      role: 'PM',
      gatewaySessionKey: 'agent:supervisor:main',
    });
    employeeManager.addEmployee(pm);

    const project = taskQueue.createProject({
      goal: 'Test stuck detection',
      pmEmployeeId: 'supervisor',
      employees: ['supervisor', 'worker'],
    });

    const task = taskQueue.create({
      projectId: project.id,
      subject: 'Stuck task',
      description: 'Will get stuck',
      owner: 'worker',
    });

    // Claim the task and backdate its startedAt
    taskQueue.claim(task.id, 'worker');
    // Set startedAt to 10 minutes ago (beyond 5-minute STUCK_THRESHOLD)
    taskQueue.update(task.id, { startedAt: Date.now() - 10 * 60 * 1000 });

    // Listen for stuck event
    const stuckEvents: Task[] = [];
    supervisor.on('task-stuck', (t: Task) => stuckEvents.push(t));

    // Manually trigger a monitor tick
    // (We access the private method via prototype for testing)
    await (supervisor as any).monitorTick(project.id);

    // Verify stuck task was detected
    expect(stuckEvents).toHaveLength(1);
    expect(stuckEvents[0].id).toBe(task.id);

    // PM should have received a message about the stuck task
    const pmInbox = messageBus.getInbox('supervisor');
    expect(pmInbox.some((m) => m.content.includes('stuck'))).toBe(true);
  });

  // ── Test 6: Auto-Unblock via Monitor Tick ────────────────────────

  it('should notify employees when dependencies are resolved during monitor tick', async () => {
    const pm = makeEmployee({
      id: 'supervisor',
      slug: 'supervisor',
      role: 'PM',
      gatewaySessionKey: 'agent:supervisor:main',
    });
    employeeManager.addEmployee(pm);

    const project = taskQueue.createProject({
      goal: 'Test auto-unblock',
      pmEmployeeId: 'supervisor',
      employees: ['supervisor', 'worker-a', 'worker-b'],
    });

    const t0 = taskQueue.create({
      projectId: project.id,
      subject: 'First task',
      description: 'First',
      owner: 'worker-a',
      wave: 0,
    });

    taskQueue.create({
      projectId: project.id,
      subject: 'Dependent task',
      description: 'Second',
      owner: 'worker-b',
      blockedBy: [t0.id],
      wave: 1,
    });

    // Complete the dependency
    taskQueue.claim(t0.id, 'worker-a');
    taskQueue.complete(t0.id, 'Done');

    // Run monitor tick
    await (supervisor as any).monitorTick(project.id);

    // worker-b should receive an unblock notification
    const workerBInbox = messageBus.getInbox('worker-b');
    expect(workerBInbox.some((m) => m.content.includes('unblocked'))).toBe(true);
  });

  // ── Test 7: Project Completion Detection ─────────────────────────

  it('should detect project completion and trigger synthesis', async () => {
    const pm = makeEmployee({
      id: 'supervisor',
      slug: 'supervisor',
      role: 'PM',
      gatewaySessionKey: 'agent:supervisor:main',
    });
    employeeManager.addEmployee(pm);

    // Register synthesis handler
    gateway.registerHandler('agent:supervisor:main', () => {
      return 'Final synthesis: all tasks completed successfully.';
    });

    const project = taskQueue.createProject({
      goal: 'Test completion detection',
      pmEmployeeId: 'supervisor',
      employees: ['supervisor', 'worker'],
    });

    const t0 = taskQueue.create({
      projectId: project.id,
      subject: 'Only task',
      description: 'Only one task',
      owner: 'worker',
    });

    // Listen for project-completed event
    const completedEvents: Array<{ project: any; synthesis: string }> = [];
    supervisor.on('project-completed', (proj: any, synthesis: string) => {
      completedEvents.push({ project: proj, synthesis });
    });

    // Complete the task
    taskQueue.claim(t0.id, 'worker');
    taskQueue.complete(t0.id, 'Task result');

    // Run monitor tick — should detect all-done and trigger synthesis
    await (supervisor as any).monitorTick(project.id);

    // Wait briefly for async synthesis
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Project should be completed
    const finalProject = taskQueue.getProject(project.id);
    expect(finalProject?.status).toBe('completed');
    expect(finalProject?.completedAt).toBeGreaterThan(0);

    // Synthesis event should have fired
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].synthesis).toContain('Final synthesis');
  });

  // ── Test 8: Task Executor Error Recovery ─────────────────────────

  it('should handle task execution failure gracefully', async () => {
    const worker = makeEmployee({
      id: 'flaky-worker',
      slug: 'flaky-worker',
      role: 'Worker',
      gatewaySessionKey: 'agent:flaky-worker:main',
    });
    employeeManager.addEmployee(worker);

    // Gateway throws error for this employee
    gateway.registerHandler('agent:flaky-worker:main', () => {
      throw new Error('LLM API timeout');
    });

    const project = taskQueue.createProject({
      goal: 'Test error handling',
      pmEmployeeId: 'pm',
      employees: ['pm', 'flaky-worker'],
    });

    const task = taskQueue.create({
      projectId: project.id,
      subject: 'Failing task',
      description: 'Will fail',
      owner: 'flaky-worker',
    });

    taskQueue.claim(task.id, 'flaky-worker');

    const result = await taskExecutor.executeTask(task.id, 'flaky-worker');

    // Task should fail gracefully
    expect(result.success).toBe(false);
    expect(result.error).toContain('LLM API timeout');

    // Task should be blocked (not deleted)
    const blockedTask = taskQueue.get(task.id)!;
    expect(blockedTask.status).toBe('blocked');

    // Employee should be in error state
    const emp = employeeManager.get('flaky-worker')!;
    expect(emp.status).toBe('error');
  });

  // ── Test 9: Reverse Dependency (blocks) ──────────────────────────

  it('should maintain reverse dependency references (blocks array)', () => {
    const project = taskQueue.createProject({
      goal: 'Test blocks',
      pmEmployeeId: 'pm',
      employees: ['pm'],
    });

    const t0 = taskQueue.create({
      projectId: project.id,
      subject: 'Dependency',
      description: 'Base task',
    });

    taskQueue.create({
      projectId: project.id,
      subject: 'Dependent A',
      description: 'Needs base',
      blockedBy: [t0.id],
    });

    taskQueue.create({
      projectId: project.id,
      subject: 'Dependent B',
      description: 'Also needs base',
      blockedBy: [t0.id],
    });

    // Re-read t0 — blocks should contain both dependent IDs
    const refreshed = taskQueue.get(t0.id)!;
    expect(refreshed.blocks).toHaveLength(2);
  });

  // ── Test 10: SQLite Persistence ──────────────────────────────────

  it('should persist tasks across database reopen', () => {
    const dbPath = join(tmpDir, 'persist-test.db');

    // Create and populate
    const queue1 = new TaskQueue(dbPath);
    queue1.init();

    const project = queue1.createProject({
      goal: 'Persistence test',
      pmEmployeeId: 'pm',
      employees: ['pm'],
    });

    queue1.create({
      projectId: project.id,
      subject: 'Persistent task',
      description: 'Should survive reopen',
      owner: 'worker',
    });

    queue1.destroy();

    // Reopen — data should still be there
    const queue2 = new TaskQueue(dbPath);
    queue2.init();

    const tasks = queue2.list(project.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].subject).toBe('Persistent task');
    expect(tasks[0].owner).toBe('worker');

    const projects = queue2.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].goal).toBe('Persistence test');

    queue2.destroy();
  });

  // ── Test 11: PM JSON Parsing (markdown code blocks) ──────────────

  it('should parse PM task plans wrapped in markdown code blocks', async () => {
    const pm = makeEmployee({
      id: 'supervisor',
      slug: 'supervisor',
      role: 'PM',
      gatewaySessionKey: 'agent:supervisor:main',
    });
    employeeManager.addEmployee(pm);

    // PM returns JSON wrapped in code fences
    gateway.registerHandler('agent:supervisor:main', () => {
      return '```json\n[\n  {\n    "subject": "Task from code block",\n    "description": "Parsed correctly",\n    "assignTo": "worker",\n    "wave": 0\n  }\n]\n```';
    });

    const project = await supervisor.planProject('Test parsing', 'supervisor');
    const tasks = taskQueue.list(project.id);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].subject).toBe('Task from code block');
  });

  // ── Test 12: Feishu Delegation Parsing ───────────────────────────

  it('should parse DELEGATE markers from Supervisor responses', () => {
    const response = `好的，我来安排 SEO 专家帮你分析一下。

<!-- DELEGATE
{"employee": "seo-specialist", "task": "Analyze https://example.com for SEO issues", "context": "User wants a quick audit"}
-->`;

    const parsed = supervisor.parseDelegation(response);
    expect(parsed).not.toBeNull();
    expect(parsed!.acknowledgment).toBe('好的，我来安排 SEO 专家帮你分析一下。');
    expect(parsed!.delegation.employee).toBe('seo-specialist');
    expect(parsed!.delegation.task).toContain('Analyze');
    expect(parsed!.delegation.context).toBe('User wants a quick audit');
  });

  it('should return null for responses without DELEGATE markers', () => {
    const parsed = supervisor.parseDelegation('Just a normal response without delegation');
    expect(parsed).toBeNull();
  });

  // ── Test 13: Message Bus Roundtrip ───────────────────────────────

  it('should deliver messages between employees via MessageBus', () => {
    // Send a message from PM to worker
    messageBus.send({
      type: 'message',
      from: 'supervisor',
      recipient: 'worker-a',
      content: 'Please start working on the SEO audit',
      summary: 'Start SEO audit',
    });

    // Worker checks inbox
    const inbox = messageBus.getInbox('worker-a');
    expect(inbox).toHaveLength(1);
    expect(inbox[0].from).toBe('supervisor');
    expect(inbox[0].content).toContain('SEO audit');
    expect(inbox[0].read).toBe(false);

    // Mark as read
    messageBus.markRead(inbox[0].id);
    const afterRead = messageBus.getInbox('worker-a');
    expect(afterRead).toHaveLength(0);

    // Unread count
    messageBus.send({
      type: 'message',
      from: 'supervisor',
      recipient: 'worker-a',
      content: 'Second message',
      summary: 'Second',
    });
    expect(messageBus.getUnreadCount('worker-a')).toBe(1);
  });
});
