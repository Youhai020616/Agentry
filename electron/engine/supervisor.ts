/**
 * Supervisor Engine
 * PM-level orchestration: decompose user goals into task DAGs,
 * execute via employees, monitor progress, synthesize results.
 *
 * The Supervisor coordinates TaskQueue + MessageBus + EmployeeManager + Gateway.
 *
 * Delegation model (Phase 5):
 *  - The Supervisor agent uses `sessions_spawn` (Gateway-native LLM tool) to delegate
 *    tasks to specialist employees. No engine-side parsing or routing needed.
 *  - Legacy `<!-- DELEGATE -->` comment-marker parsing has been removed.
 *  - Agent-to-agent communication is enabled via `tools.agentToAgent` in openclaw.json.
 *
 * Fixed issues:
 *  - Issue #1: TaskExecutor is sole execution authority (no messageBus.send for execution)
 *  - Issue #3: Transaction safety via taskQueue.createProjectWithTasks()
 *  - Issue #4: Event-driven monitoring (task-changed) + 60s heartbeat
 *  - Issue #5: Two-stage stuck recovery (5min notify, 10min auto-cancel)
 */
import { EventEmitter } from 'node:events';
import { logger } from '../utils/logger';
import type { TaskQueue } from './task-queue';
import type { MessageBus } from './message-bus';
import type { EmployeeManager } from './employee-manager';
import type { GatewayManager } from '../gateway/manager';
import type { TaskExecutor } from './task-executor';
import type { Task, Project, CreateTaskInput } from '../../src/types/task';

/** Parsed task from PM's response */
interface PMTaskPlan {
  subject: string;
  description: string;
  assignTo?: string;
  blockedBy?: string[];
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  requiresApproval?: boolean;
  estimatedDuration?: number;
  wave?: number;
}

/**
 * SupervisorEngine — PM orchestration layer
 *
 * Events:
 *  - 'project-started' (project: Project)
 *  - 'project-completed' (project: Project, synthesis: string)
 *  - 'task-stuck' (task: Task)
 */
export class SupervisorEngine extends EventEmitter {
  private taskQueue: TaskQueue;
  private messageBus: MessageBus;
  private employeeManager: EmployeeManager;
  private gateway: GatewayManager;
  private taskExecutor: TaskExecutor;

  /** Active heartbeat intervals keyed by projectId */
  private heartbeats: Map<string, ReturnType<typeof setInterval>> = new Map();

  /** Track stuck task notification timestamps (taskId → first-notified-at) */
  private stuckNotifiedAt: Map<string, number> = new Map();

  /**
   * Per-project debounce timers for reactive monitoring (fix M5).
   * Previously a single global timer caused only the last projectId in a
   * debounce window to be monitored.
   */
  private debouncedMonitorTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /** Heartbeat interval (ms) — safety net, not primary driver */
  private static readonly HEARTBEAT_INTERVAL = 60_000;
  /** Threshold to consider a task stuck (ms) — 5 minutes */
  private static readonly STUCK_NOTIFY_THRESHOLD = 300_000;
  /** Threshold to auto-cancel a stuck task (ms) — 10 minutes */
  private static readonly STUCK_CANCEL_THRESHOLD = 600_000;
  /** Debounce delay for reactive monitoring (ms) */
  private static readonly DEBOUNCE_MS = 100;

  constructor(
    taskQueue: TaskQueue,
    messageBus: MessageBus,
    employeeManager: EmployeeManager,
    gateway: GatewayManager,
    taskExecutor: TaskExecutor
  ) {
    super();
    this.taskQueue = taskQueue;
    this.messageBus = messageBus;
    this.employeeManager = employeeManager;
    this.gateway = gateway;
    this.taskExecutor = taskExecutor;
  }

  // ── Reactive Monitoring (Issue #4) ────────────────────────────────

  /**
   * Called by bootstrap when TaskQueue emits 'task-changed'.
   * Debounced per-project to prevent concurrent storms (fix M5).
   *
   * Also clears `stuckNotifiedAt` when a task leaves `in_progress` (fix M3).
   */
  onTaskChanged(task: Task): void {
    // M3 fix: clear stuck tracking when a task is no longer in_progress
    if (task.status !== 'in_progress' && this.stuckNotifiedAt.has(task.id)) {
      this.stuckNotifiedAt.delete(task.id);
    }

    const projectId = task.projectId;
    if (!projectId || projectId === 'adhoc') return;

    // M5 fix: per-project debounce so changes from different projects
    // don't clobber each other's monitoring
    const existing = this.debouncedMonitorTimers.get(projectId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debouncedMonitorTimers.delete(projectId);
      void this.reactiveMonitor(projectId).catch((err) => {
        logger.error(`Reactive monitor error for project ${projectId}: ${err}`);
      });
    }, SupervisorEngine.DEBOUNCE_MS);

    this.debouncedMonitorTimers.set(projectId, timer);
  }

  /**
   * Reactive monitor: check project state after a task changes.
   * Handles auto-unblock, completion detection.
   */
  private async reactiveMonitor(projectId: string): Promise<void> {
    const tasks = this.taskQueue.list(projectId);
    if (tasks.length === 0) return;

    // Auto-unblock: claim newly available tasks
    await this.claimAvailableTasks(projectId);

    // Check if all tasks are completed
    const allDone = tasks.every((t) => t.status === 'completed');
    if (allDone) {
      // Stop heartbeat
      const heartbeat = this.heartbeats.get(projectId);
      if (heartbeat) {
        clearInterval(heartbeat);
        this.heartbeats.delete(projectId);
      }
      await this.onProjectComplete(projectId);
    }
  }

  // ── Plan Phase ──────────────────────────────────────────────────

  /**
   * Decompose a user goal into a task DAG via the PM employee.
   * The PM analyzes the goal and creates tasks with dependencies.
   * Uses transactional creation (Issue #3).
   */
  async planProject(userGoal: string, pmEmployeeId: string): Promise<Project> {
    logger.info(`Planning project: "${userGoal}" with PM: ${pmEmployeeId}`);

    const pmEmployee = this.employeeManager.get(pmEmployeeId);
    if (!pmEmployee) {
      throw new Error(`PM employee not found: ${pmEmployeeId}`);
    }
    if (!pmEmployee.gatewaySessionKey) {
      throw new Error(`PM employee ${pmEmployeeId} is not activated (no session)`);
    }

    // Get active employees for context
    const activeEmployees = this.employeeManager
      .list()
      .filter((e) => e.status !== 'offline' && e.id !== pmEmployeeId);

    const employeeList = activeEmployees
      .map((e) => `- ${e.role} (${e.name}): ID=${e.id}`)
      .join('\n');

    // Ask PM to plan
    const planPrompt = `You are the Project Manager. Analyze the following goal and create a task plan.

USER GOAL: ${userGoal}

AVAILABLE EMPLOYEES:
${employeeList || '(No other employees active — you will handle all tasks)'}

Create tasks with:
1. Clear subject and detailed description
2. Assignment to the right employee (use employee ID)
3. Dependencies (blockedBy) where tasks must wait for others
4. Priority (low/medium/high/urgent)
5. Group into waves: wave 0 = no dependencies, wave 1 = depends on wave 0, etc.

Respond ONLY with a JSON array of task objects. Each object should have:
{ "subject": "...", "description": "...", "assignTo": "employee-id", "blockedBy": [], "priority": "medium", "wave": 0 }

Do NOT include any text outside the JSON array.`;

    try {
      const response = await this.gateway.rpc<{ content?: string; text?: string }>(
        'chat.send',
        {
          session: pmEmployee.gatewaySessionKey,
          message: planPrompt,
        },
        60_000 // 60s timeout for planning
      );

      const responseText =
        typeof response === 'string'
          ? response
          : (response?.content ?? response?.text ?? JSON.stringify(response));

      const planTasks = this.parsePMTaskPlan(responseText);

      // Build CreateTaskInput array for transactional creation
      const taskInputs: CreateTaskInput[] = planTasks.map((planTask) => ({
        projectId: '', // Will be set by createProjectWithTasks
        subject: planTask.subject,
        description: planTask.description,
        owner: planTask.assignTo ?? undefined,
        assignedBy: 'pm' as const,
        blockedBy: planTask.blockedBy ?? [],
        priority: planTask.priority ?? 'medium',
        requiresApproval: planTask.requiresApproval ?? false,
        estimatedDuration: planTask.estimatedDuration ?? 0,
        wave: planTask.wave ?? 0,
      }));

      // Issue #3: Atomic creation of project + all tasks
      const { project } = this.taskQueue.createProjectWithTasks(
        {
          goal: userGoal,
          pmEmployeeId,
          employees: [pmEmployeeId, ...activeEmployees.map((e) => e.id)],
        },
        taskInputs
      );

      logger.info(`Project planned: ${project.id} with ${planTasks.length} tasks`);
      return this.taskQueue.getProject(project.id) ?? project;
    } catch (err) {
      logger.error(`Failed to plan project: ${err}`);
      // Create an empty project so user can manually add tasks
      const project = this.taskQueue.createProject({
        goal: userGoal,
        pmEmployeeId,
        employees: [pmEmployeeId, ...activeEmployees.map((e) => e.id)],
      });
      return project;
    }
  }

  // ── Execute Phase ───────────────────────────────────────────────

  /**
   * Begin project execution: claim wave-0 tasks and start heartbeat.
   * Issue #1: Uses taskQueue.claim() instead of messageBus.send()
   */
  async executeProject(projectId: string): Promise<void> {
    const project = this.taskQueue.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    logger.info(`Executing project: ${projectId}`);

    // Update project status
    this.taskQueue.updateProject(projectId, { status: 'executing' });

    // Issue #1: Claim wave-0 tasks via taskQueue.claim() → TaskExecutor auto-executes
    await this.claimAvailableTasks(projectId);

    // Start heartbeat (Issue #4: safety net, 60s interval)
    this.startHeartbeat(projectId);

    this.emit('project-started', project);
  }

  /**
   * Claim available (unblocked, pending) tasks for a project.
   * Issue #1: TaskExecutor will auto-execute when tasks are claimed.
   *
   * Fix M6: tasks without an `owner` are now assigned to any idle employee
   * instead of being silently skipped forever.
   */
  private async claimAvailableTasks(projectId: string): Promise<void> {
    const available = this.taskQueue.listAvailable(projectId);

    for (const task of available) {
      if (task.owner) {
        // Task has an assigned owner — claim it for that employee
        const employee = this.employeeManager.get(task.owner);
        if (employee && (employee.status === 'idle' || employee.status === 'error')) {
          try {
            this.taskQueue.claim(task.id, task.owner);
            logger.info(`Claimed task ${task.id} for employee ${task.owner}`);
          } catch (err) {
            logger.warn(`Failed to claim task ${task.id} for ${task.owner}: ${err}`);
          }
        }
      } else {
        // M6 fix: task has no assigned owner — find any idle employee to claim it
        const idleEmployees = this.employeeManager.list('idle');
        if (idleEmployees.length > 0) {
          const assignee = idleEmployees[0];
          try {
            this.taskQueue.claim(task.id, assignee.id);
            logger.info(
              `Claimed ownerless task ${task.id} for idle employee ${assignee.id} (${assignee.name})`
            );
          } catch (err) {
            logger.warn(`Failed to claim ownerless task ${task.id} for ${assignee.id}: ${err}`);
          }
        } else {
          logger.warn(
            `Task ${task.id} "${task.subject}" has no owner and no idle employees available — will retry on next monitor cycle`
          );
        }
      }
    }
  }

  // ── Heartbeat (Issue #4) ──────────────────────────────────────

  /**
   * Heartbeat loop: safety net to detect stuck tasks and missed events.
   */
  private startHeartbeat(projectId: string): void {
    const existing = this.heartbeats.get(projectId);
    if (existing) clearInterval(existing);

    const interval = setInterval(async () => {
      try {
        await this.heartbeatTick(projectId);
      } catch (err) {
        logger.error(`Heartbeat error for project ${projectId}: ${err}`);
      }
    }, SupervisorEngine.HEARTBEAT_INTERVAL);

    this.heartbeats.set(projectId, interval);
    logger.debug(
      `Heartbeat started for project: ${projectId} (${SupervisorEngine.HEARTBEAT_INTERVAL}ms)`
    );
  }

  private async heartbeatTick(projectId: string): Promise<void> {
    const tasks = this.taskQueue.list(projectId);
    if (tasks.length === 0) return;

    // Check for stuck tasks (Issue #5: two-stage recovery)
    for (const task of tasks) {
      if (task.status === 'in_progress' && task.startedAt) {
        const elapsed = Date.now() - task.startedAt;

        if (elapsed > SupervisorEngine.STUCK_CANCEL_THRESHOLD) {
          // Stage 2: Auto-cancel and reset to pending
          await this.autoRecoverStuckTask(task, projectId);
        } else if (elapsed > SupervisorEngine.STUCK_NOTIFY_THRESHOLD) {
          // Stage 1: Notify PM
          if (!this.stuckNotifiedAt.has(task.id)) {
            await this.handleStuckTask(task, projectId);
            this.stuckNotifiedAt.set(task.id, Date.now());
          }
        }
      }
    }

    // Also claim any newly available tasks
    await this.claimAvailableTasks(projectId);

    // Check if all tasks are completed
    const allDone = tasks.every((t) => t.status === 'completed');
    if (allDone) {
      const heartbeat = this.heartbeats.get(projectId);
      if (heartbeat) {
        clearInterval(heartbeat);
        this.heartbeats.delete(projectId);
      }
      await this.onProjectComplete(projectId);
    }
  }

  /**
   * Issue #5: Stage 1 — Notify PM about stuck task
   */
  private async handleStuckTask(task: Task, projectId: string): Promise<void> {
    logger.warn(`Task stuck: ${task.id} "${task.subject}" — elapsed since start`);

    const project = this.taskQueue.getProject(projectId);
    if (!project) return;

    this.messageBus.send({
      type: 'message',
      from: 'system',
      recipient: project.pmEmployeeId,
      content: `Task "${task.subject}" (assigned to ${task.owner ?? 'unassigned'}) appears stuck. It has been in progress for over 5 minutes. Consider reassigning or checking on the employee.`,
      summary: `Stuck task: ${task.subject}`,
    });

    this.emit('task-stuck', task);
  }

  /**
   * Issue #5: Stage 2 — Auto-cancel stuck task and reset to pending
   */
  private async autoRecoverStuckTask(task: Task, _projectId: string): Promise<void> {
    logger.warn(
      `Auto-recovering stuck task: ${task.id} "${task.subject}" — cancelling and resetting to pending`
    );

    try {
      // Cancel the task (resets to pending, clears owner)
      this.taskQueue.cancel(task.id);

      // Recover the employee from error/working state
      if (task.owner) {
        const employee = this.employeeManager.get(task.owner);
        if (employee && (employee.status === 'working' || employee.status === 'error')) {
          this.employeeManager.recover(task.owner);
        }
      }

      // Cancel execution if running
      this.taskExecutor.cancel(task.id);

      // Clean up stuck tracking
      this.stuckNotifiedAt.delete(task.id);

      logger.info(`Task ${task.id} auto-recovered: reset to pending`);
    } catch (err) {
      logger.error(`Failed to auto-recover task ${task.id}: ${err}`);
    }
  }

  // ── Plan Approval ───────────────────────────────────────────────

  /**
   * Employee submits a plan for PM review
   */
  async submitPlan(taskId: string, plan: string): Promise<void> {
    const task = this.taskQueue.update(taskId, {
      plan,
      planStatus: 'submitted',
    });

    const project = this.taskQueue.getProject(task.projectId);
    if (!project) return;

    this.messageBus.send({
      type: 'plan_approval',
      from: task.owner ?? 'unknown',
      recipient: project.pmEmployeeId,
      content: `Plan submitted for "${task.subject}":\n\n${plan}\n\nApprove or reject with feedback.`,
      summary: `Plan submitted: ${task.subject}`,
      requestId: taskId,
    });
  }

  /**
   * PM approves a submitted plan
   */
  async approvePlan(taskId: string): Promise<void> {
    const task = this.taskQueue.update(taskId, { planStatus: 'approved' });

    if (task.owner) {
      this.messageBus.send({
        type: 'message',
        from: 'pm',
        recipient: task.owner,
        content: `Your plan for "${task.subject}" has been approved. Proceed with execution.`,
        summary: 'Plan approved — proceed',
      });
    }
  }

  /**
   * PM rejects a submitted plan with feedback
   */
  async rejectPlan(taskId: string, feedback: string): Promise<void> {
    const task = this.taskQueue.update(taskId, {
      planStatus: 'rejected',
      planFeedback: feedback,
    });

    if (task.owner) {
      this.messageBus.send({
        type: 'message',
        from: 'pm',
        recipient: task.owner,
        content: `Your plan for "${task.subject}" was rejected.\nFeedback: ${feedback}\nPlease revise and resubmit.`,
        summary: 'Plan rejected — revise',
      });
    }
  }

  // ── Synthesis ───────────────────────────────────────────────────

  /**
   * All tasks done → PM synthesizes results into a final deliverable
   */
  private async onProjectComplete(projectId: string): Promise<void> {
    logger.info(`All tasks completed for project: ${projectId}`);

    const project = this.taskQueue.getProject(projectId);
    if (!project) return;

    this.taskQueue.updateProject(projectId, { status: 'reviewing' });

    try {
      const synthesis = await this.synthesizeResults(projectId);
      this.taskQueue.updateProject(projectId, {
        status: 'completed',
        completedAt: Date.now(),
      });

      this.emit('project-completed', project, synthesis);
    } catch (err) {
      logger.error(`Failed to synthesize results for project ${projectId}: ${err}`);
      // Still mark as completed even if synthesis fails
      this.taskQueue.updateProject(projectId, {
        status: 'completed',
        completedAt: Date.now(),
      });
    }
  }

  /**
   * Ask PM employee to synthesize all task outputs into a cohesive deliverable
   */
  async synthesizeResults(projectId: string): Promise<string> {
    const project = this.taskQueue.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const pmEmployee = this.employeeManager.get(project.pmEmployeeId);
    if (!pmEmployee?.gatewaySessionKey) {
      throw new Error('PM employee not available for synthesis');
    }

    const tasks = this.taskQueue.list(projectId);
    const results = tasks
      .filter((t) => t.status === 'completed' && t.output)
      .map((t) => ({
        subject: t.subject,
        owner: t.owner,
        output: t.output,
        files: t.outputFiles,
      }));

    const synthesisPrompt = `All tasks for project "${project.goal}" are complete.

Results from each employee:
${JSON.stringify(results, null, 2)}

Please synthesize these into a cohesive final deliverable for the user.
Highlight key findings, cross-reference between employee outputs,
and provide actionable next steps.`;

    const response = await this.gateway.rpc<{ content?: string; text?: string }>(
      'chat.send',
      {
        session: pmEmployee.gatewaySessionKey,
        message: synthesisPrompt,
      },
      120_000 // 2 min for synthesis
    );

    return typeof response === 'string'
      ? response
      : (response?.content ?? response?.text ?? JSON.stringify(response));
  }

  // ── Shutdown ────────────────────────────────────────────────────

  /**
   * Gracefully close a project: notify employees, archive
   */
  async closeProject(projectId: string): Promise<void> {
    const project = this.taskQueue.getProject(projectId);
    if (!project) return;

    logger.info(`Closing project: ${projectId}`);

    // Stop heartbeat
    const heartbeat = this.heartbeats.get(projectId);
    if (heartbeat) {
      clearInterval(heartbeat);
      this.heartbeats.delete(projectId);
    }

    // Notify employees
    for (const employeeId of project.employees) {
      if (employeeId === project.pmEmployeeId) continue;
      this.messageBus.send({
        type: 'shutdown_request',
        from: project.pmEmployeeId,
        recipient: employeeId,
        content: 'Project completed. Wrapping up.',
        summary: 'Project complete',
      });
    }

    // Mark project completed if not already
    if (project.status !== 'completed') {
      this.taskQueue.updateProject(projectId, {
        status: 'completed',
        completedAt: Date.now(),
      });
    }
  }

  /**
   * Get the work loop prompt fragment for employee system prompts
   */
  getEmployeeWorkLoopPrompt(): string {
    return `## Work Loop Instructions

After each task, check the task board for more work:
1. Call taskBoard.list() to see available tasks
2. Find tasks where: status=pending, owner=null, all blockedBy completed
3. Claim the lowest-ID available task (prefer sequential order)
4. If task requires approval: submit your plan first, wait for PM approval
5. Execute the task using your skills
6. Mark task as completed with your output
7. Notify PM of completion
8. Check for more tasks
9. If no tasks available, go idle and notify PM`;
  }

  /**
   * Clean up: stop all heartbeats
   */
  destroy(): void {
    for (const [_projectId, timer] of this.debouncedMonitorTimers) {
      clearTimeout(timer);
    }
    this.debouncedMonitorTimers.clear();
    for (const [projectId, interval] of this.heartbeats) {
      clearInterval(interval);
      logger.debug(`Stopped heartbeat for project: ${projectId}`);
    }
    this.heartbeats.clear();
    this.stuckNotifiedAt.clear();
    this.removeAllListeners();
  }

  // ── Private Helpers ─────────────────────────────────────────────

  /**
   * Parse PM's JSON response into task plan objects
   */
  private parsePMTaskPlan(responseText: string): PMTaskPlan[] {
    // Try to extract JSON array from the response
    let jsonStr = responseText.trim();

    // Strip markdown code fences
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    // Try to find JSON array
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      jsonStr = arrayMatch[0];
    }

    try {
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) {
        logger.warn('PM response is not an array, wrapping in array');
        return [parsed as PMTaskPlan];
      }
      return parsed as PMTaskPlan[];
    } catch (err) {
      logger.error(`Failed to parse PM task plan: ${err}`);
      logger.debug(`Raw PM response: ${responseText.substring(0, 500)}`);
      // Return a single fallback task so the project isn't empty
      return [
        {
          subject: 'Execute goal',
          description: responseText,
          priority: 'medium',
          wave: 0,
        },
      ];
    }
  }
}
