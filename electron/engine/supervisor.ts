/**
 * Supervisor Engine
 * PM-level orchestration: decompose user goals into task DAGs,
 * execute via employees, monitor progress, synthesize results.
 *
 * The Supervisor coordinates TaskQueue + MessageBus + EmployeeManager + Gateway.
 */
import { EventEmitter } from 'node:events';
import { logger } from '../utils/logger';
import type { TaskQueue } from './task-queue';
import type { MessageBus } from './message-bus';
import type { EmployeeManager } from './employee-manager';
import type { GatewayManager } from '../gateway/manager';
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

  /** Active monitor intervals keyed by projectId */
  private monitors: Map<string, ReturnType<typeof setInterval>> = new Map();

  /** Monitor poll interval (ms) */
  private static readonly POLL_INTERVAL = 30_000;
  /** Threshold to consider a task stuck (ms) */
  private static readonly STUCK_THRESHOLD = 300_000;

  // ── Dedup tracking (P0 fix) ─────────────────────────────────────
  /** Task IDs already reported as stuck — avoids spamming PM every 30s tick */
  private notifiedStuckTasks = new Set<string>();
  /** Task IDs already notified as unblocked — avoids repeated "unblocked" messages */
  private notifiedUnblockedTasks = new Set<string>();
  /** Reusable "feishu-delegations" project ID for persisting delegation tasks */
  private feishuDelegationProjectId: string | null = null;

  constructor(
    taskQueue: TaskQueue,
    messageBus: MessageBus,
    employeeManager: EmployeeManager,
    gateway: GatewayManager
  ) {
    super();
    this.taskQueue = taskQueue;
    this.messageBus = messageBus;
    this.employeeManager = employeeManager;
    this.gateway = gateway;
  }

  // ── Plan Phase ──────────────────────────────────────────────────

  /**
   * Decompose a user goal into a task DAG via the PM employee.
   * The PM analyzes the goal and creates tasks with dependencies.
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

    // Create project first
    const project = this.taskQueue.createProject({
      goal: userGoal,
      pmEmployeeId,
      employees: [pmEmployeeId, ...activeEmployees.map((e) => e.id)],
    });

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

      const tasks = this.parsePMTaskPlan(responseText);

      // Map temporary IDs for blockedBy references
      const tempToReal = new Map<string, string>();

      for (let i = 0; i < tasks.length; i++) {
        const planTask = tasks[i];
        const input: CreateTaskInput = {
          projectId: project.id,
          subject: planTask.subject,
          description: planTask.description,
          owner: planTask.assignTo ?? undefined,
          assignedBy: 'pm',
          blockedBy: [],
          priority: planTask.priority ?? 'medium',
          requiresApproval: planTask.requiresApproval ?? false,
          estimatedDuration: planTask.estimatedDuration ?? 0,
          wave: planTask.wave ?? 0,
        };

        const created = this.taskQueue.create(input);
        tempToReal.set(`T${i}`, created.id);
        tempToReal.set(String(i), created.id);

        // Update project tasks list
        const currentProject = this.taskQueue.getProject(project.id);
        if (currentProject) {
          this.taskQueue.updateProject(project.id, {
            tasks: [...currentProject.tasks, created.id],
          });
        }
      }

      // Resolve blockedBy references (PM may use T0, T1 or indices)
      for (let i = 0; i < tasks.length; i++) {
        const planTask = tasks[i];
        if (planTask.blockedBy && planTask.blockedBy.length > 0) {
          const realId = tempToReal.get(`T${i}`) ?? tempToReal.get(String(i));
          if (realId) {
            const resolvedDeps = planTask.blockedBy
              .map((ref) => tempToReal.get(ref) ?? ref)
              .filter(Boolean);
            if (resolvedDeps.length > 0) {
              this.taskQueue.update(realId, { blockedBy: resolvedDeps });
            }
          }
        }
      }

      logger.info(`Project planned: ${project.id} with ${tasks.length} tasks`);
      return this.taskQueue.getProject(project.id) ?? project;
    } catch (err) {
      logger.error(`Failed to plan project: ${err}`);
      // Keep the empty project so user can manually add tasks
      return project;
    }
  }

  // ── Execute Phase ───────────────────────────────────────────────

  /**
   * Begin project execution: notify employees and start monitor loop
   */
  async executeProject(projectId: string): Promise<void> {
    const project = this.taskQueue.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    logger.info(`Executing project: ${projectId}`);

    // Update project status
    this.taskQueue.updateProject(projectId, { status: 'executing' });

    // Notify all employees that work is available
    for (const employeeId of project.employees) {
      if (employeeId === project.pmEmployeeId) continue;
      this.messageBus.send({
        type: 'message',
        from: project.pmEmployeeId,
        recipient: employeeId,
        content: `New project started: "${project.goal}". Check the task board for available work.`,
        summary: 'New project — check task board',
      });
    }

    // Start monitoring
    this.startMonitorLoop(projectId);

    this.emit('project-started', project);
  }

  // ── Monitor Loop ────────────────────────────────────────────────

  /**
   * Poll-based monitor: detect stuck tasks, auto-unblock, detect completion
   */
  private startMonitorLoop(projectId: string): void {
    // Clear existing monitor if any
    const existing = this.monitors.get(projectId);
    if (existing) clearInterval(existing);

    const interval = setInterval(async () => {
      try {
        await this.monitorTick(projectId);
      } catch (err) {
        logger.error(`Monitor loop error for project ${projectId}: ${err}`);
      }
    }, SupervisorEngine.POLL_INTERVAL);

    this.monitors.set(projectId, interval);
    logger.debug(`Monitor loop started for project: ${projectId}`);
  }

  private async monitorTick(projectId: string): Promise<void> {
    const tasks = this.taskQueue.list(projectId);
    if (tasks.length === 0) return;

    // Prune dedup sets: remove tasks that are no longer stuck (status changed)
    for (const task of tasks) {
      if (task.status !== 'in_progress' && this.notifiedStuckTasks.has(task.id)) {
        this.notifiedStuckTasks.delete(task.id);
      }
      if (task.status !== 'pending' && this.notifiedUnblockedTasks.has(task.id)) {
        this.notifiedUnblockedTasks.delete(task.id);
      }
    }

    // Check for stuck tasks
    for (const task of tasks) {
      if (task.status === 'in_progress' && task.startedAt) {
        const elapsed = Date.now() - task.startedAt;
        if (elapsed > SupervisorEngine.STUCK_THRESHOLD) {
          await this.handleStuckTask(task, projectId);
        }
      }
    }

    // Auto-unblock: notify employees and auto-dispatch when dependencies resolve
    await this.checkAutoUnblock(tasks, projectId);

    // Check if all tasks are completed
    const allDone = tasks.every((t) => t.status === 'completed');
    if (allDone) {
      const monitor = this.monitors.get(projectId);
      if (monitor) {
        clearInterval(monitor);
        this.monitors.delete(projectId);
      }
      await this.onProjectComplete(projectId);
    }
  }

  /**
   * When dependencies resolve, auto-dispatch (if owned) or notify PM (if unassigned).
   * Dedup: only processes each task once via notifiedUnblockedTasks set.
   */
  private async checkAutoUnblock(tasks: Task[], projectId: string): Promise<void> {
    const completedIds = new Set(tasks.filter((t) => t.status === 'completed').map((t) => t.id));

    const project = this.taskQueue.getProject(projectId);
    if (!project) return;

    for (const task of tasks) {
      if (task.status !== 'pending' || task.blockedBy.length === 0) continue;
      if (this.notifiedUnblockedTasks.has(task.id)) continue;

      const allDepsCompleted = task.blockedBy.every((dep) => completedIds.has(dep));
      if (!allDepsCompleted) continue;

      // Mark as notified BEFORE acting to prevent re-entry on next tick
      this.notifiedUnblockedTasks.add(task.id);

      if (task.owner) {
        // Auto-claim → triggers TaskExecutor auto-execute via task-changed event
        try {
          this.taskQueue.claim(task.id, task.owner);
          logger.info(`Auto-dispatched unblocked task "${task.subject}" to owner ${task.owner}`);
        } catch (err) {
          // Remove from dedup set so it can be retried on next tick
          this.notifiedUnblockedTasks.delete(task.id);
          logger.error(`Failed to auto-claim unblocked task ${task.id}: ${err}`);
          continue;
        }

        this.messageBus.send({
          type: 'message',
          from: project.pmEmployeeId,
          recipient: task.owner,
          content: `Task "${task.subject}" is now unblocked and has been dispatched to you.`,
          summary: `Task unblocked & dispatched: ${task.subject}`,
        });
      } else {
        // No owner — ask PM to assign
        logger.warn(`Unblocked task "${task.subject}" (${task.id}) has no owner — notifying PM`);
        this.messageBus.send({
          type: 'message',
          from: 'system',
          recipient: project.pmEmployeeId,
          content: `Task "${task.subject}" is now unblocked but has no assigned employee. Please assign it to an available team member.`,
          summary: `Unblocked & unassigned: ${task.subject}`,
        });
      }
    }
  }

  /**
   * Handle a task that has been in_progress too long.
   * Dedup: only notifies PM once per stuck task via notifiedStuckTasks set.
   */
  private async handleStuckTask(task: Task, projectId: string): Promise<void> {
    // Dedup: skip if already notified for this task
    if (this.notifiedStuckTasks.has(task.id)) return;

    logger.warn(`Task stuck: ${task.id} "${task.subject}" — elapsed since start`);

    const project = this.taskQueue.getProject(projectId);
    if (!project) return;

    // Mark as notified BEFORE sending to prevent re-entry
    this.notifiedStuckTasks.add(task.id);

    // Notify PM about the stuck task
    this.messageBus.send({
      type: 'message',
      from: 'system',
      recipient: project.pmEmployeeId,
      content: `Task "${task.subject}" (assigned to ${task.owner ?? 'unassigned'}) appears stuck. It has been in progress for over 5 minutes. Consider reassigning or checking on the employee.`,
      summary: `Stuck task: ${task.subject}`,
    });

    this.emit('task-stuck', task);
  }

  // ── Plan Approval ───────────────────────────────────────────────

  /**
   * Employee submits a plan for PM review
   */
  async handlePlanSubmission(taskId: string, plan: string): Promise<void> {
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
   * All tasks done → PM synthesizes results into a final deliverable.
   * Also clears dedup sets for the completed project's tasks.
   */
  private async onProjectComplete(projectId: string): Promise<void> {
    logger.info(`All tasks completed for project: ${projectId}`);

    const project = this.taskQueue.getProject(projectId);
    if (!project) return;

    // Clear dedup tracking for this project's tasks
    const projectTasks = this.taskQueue.list(projectId);
    for (const task of projectTasks) {
      this.notifiedStuckTasks.delete(task.id);
      this.notifiedUnblockedTasks.delete(task.id);
    }

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

    // Stop monitor
    const monitor = this.monitors.get(projectId);
    if (monitor) {
      clearInterval(monitor);
      this.monitors.delete(projectId);
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
   * Clean up: stop all monitors, clear dedup sets
   */
  destroy(): void {
    for (const [projectId, interval] of this.monitors) {
      clearInterval(interval);
      logger.debug(`Stopped monitor for project: ${projectId}`);
    }
    this.monitors.clear();
    this.notifiedStuckTasks.clear();
    this.notifiedUnblockedTasks.clear();
    this.feishuDelegationProjectId = null;
    this.disableFeishuDelegation();
    this.removeAllListeners();
  }

  // ── Feishu Delegation ──────────────────────────────────────────

  /** The employee slug acting as Supervisor for Feishu delegation */
  private supervisorSlug: string | null = null;
  /** Track in-flight delegations to avoid duplicate processing */
  private inflightDelegations = new Set<string>();

  /**
   * Enable Feishu delegation mode: listen for Supervisor responses
   * and detect delegation markers.
   */
  enableFeishuDelegation(supervisorSlug: string): void {
    this.supervisorSlug = supervisorSlug;
    this.gateway.on('chat:message', this.onGatewayChatMessage);
    logger.info(`Feishu delegation enabled for supervisor: ${supervisorSlug}`);
  }

  /**
   * Disable Feishu delegation mode.
   */
  disableFeishuDelegation(): void {
    this.supervisorSlug = null;
    this.gateway.removeListener('chat:message', this.onGatewayChatMessage);
    logger.info('Feishu delegation disabled');
  }

  /**
   * Whether Feishu delegation mode is active.
   */
  isFeishuDelegationEnabled(): boolean {
    return this.supervisorSlug !== null;
  }

  /**
   * Get the current supervisor slug (or null if delegation not enabled).
   */
  getSupervisorSlug(): string | null {
    return this.supervisorSlug;
  }

  /**
   * Gateway chat:message event handler — detect delegation markers.
   * Bound as an arrow function so `this` is preserved when used as event listener.
   */
  private onGatewayChatMessage = (data: { message: unknown }): void => {
    if (!this.supervisorSlug) return;
    void this.processGatewayChatEvent(data);
  };

  /**
   * Process a Gateway chat event, looking for delegation markers in Supervisor responses.
   */
  private async processGatewayChatEvent(data: { message: unknown }): Promise<void> {
    const payload = data.message as Record<string, unknown> | undefined;
    if (!payload) return;

    // Only process 'final' state events (complete responses)
    if (payload.state !== 'final') return;

    // Extract the message content
    const msgObj = payload.message as Record<string, unknown> | string | undefined;
    const content =
      typeof msgObj === 'string'
        ? msgObj
        : typeof msgObj === 'object' && msgObj !== null
          ? ((msgObj as Record<string, unknown>).content ??
            (msgObj as Record<string, unknown>).text)
          : undefined;

    if (typeof content !== 'string') return;

    // Check for delegation marker
    const parsed = this.parseDelegation(content);
    if (!parsed) return;

    // Deduplicate: use runId + employee as key
    const runId = String(payload.runId ?? '');
    const dedupeKey = `${runId}:${parsed.delegation.employee}`;
    if (this.inflightDelegations.has(dedupeKey)) return;
    this.inflightDelegations.add(dedupeKey);

    logger.info(
      `Delegation detected: -> ${parsed.delegation.employee} task="${parsed.delegation.task.slice(0, 80)}"`
    );

    // Determine Supervisor's session key for sending results back
    const supervisor = this.employeeManager.get(this.supervisorSlug!);
    // Feishu messages use the default main session, not the employee session
    const supervisorSessionKey = supervisor?.gatewaySessionKey ?? 'agent:main:main';

    try {
      await this.handleFeishuDelegation(supervisorSessionKey, parsed.delegation);
    } finally {
      this.inflightDelegations.delete(dedupeKey);
    }
  }

  /**
   * Parse a delegation block from a Supervisor response.
   * Returns null if no delegation is found.
   *
   * Expected format in the response:
   * ```
   * Human-readable acknowledgment text...
   *
   * <!-- DELEGATE
   * {"employee": "slug", "task": "description", "context": "optional context"}
   * -->
   * ```
   */
  parseDelegation(response: string): {
    acknowledgment: string;
    delegation: { employee: string; task: string; context?: string };
  } | null {
    const match = response.match(/<!--\s*DELEGATE\s*(\{[\s\S]*?\})\s*-->/);
    if (!match) return null;

    const acknowledgment = response.substring(0, response.indexOf('<!--')).trim();

    try {
      const delegation = JSON.parse(match[1]) as {
        employee?: string;
        task?: string;
        context?: string;
      };
      if (!delegation.employee || !delegation.task) {
        logger.warn('DELEGATE block missing required fields (employee, task)');
        return null;
      }
      return {
        acknowledgment,
        delegation: {
          employee: delegation.employee,
          task: delegation.task,
          context: delegation.context,
        },
      };
    } catch (err) {
      logger.warn(`Failed to parse DELEGATE block JSON: ${err}`);
      return null;
    }
  }

  /**
   * Dispatch a task to an employee's Gateway session and wait for the response.
   * This is the bridge between the Supervisor's delegation and the employee's execution.
   */
  async dispatchToEmployee(
    employeeId: string,
    taskDescription: string,
    context?: string,
    timeoutMs = 120_000
  ): Promise<string> {
    const employee = this.employeeManager.get(employeeId);
    if (!employee) {
      throw new Error(`Employee not found: ${employeeId}`);
    }

    // Auto-activate if needed
    if (!employee.gatewaySessionKey || employee.status === 'offline') {
      logger.info(`Auto-activating employee ${employeeId} for delegation`);
      await this.employeeManager.activate(employeeId);
    }

    const updated = this.employeeManager.get(employeeId);
    const sessionKey = updated?.gatewaySessionKey;
    if (!sessionKey) {
      throw new Error(`Employee ${employeeId} has no session key after activation`);
    }

    // Mark employee as working
    this.employeeManager.assignTask(employeeId);

    const prompt = context ? `${taskDescription}\n\n## Context\n${context}` : taskDescription;

    try {
      const response = await this.gateway.rpc<{ content?: string; text?: string }>(
        'chat.send',
        { session: sessionKey, message: prompt },
        timeoutMs
      );

      const responseText =
        typeof response === 'string'
          ? response
          : (response?.content ?? response?.text ?? JSON.stringify(response));

      this.employeeManager.completeTask(employeeId);

      return responseText;
    } catch (err) {
      this.employeeManager.markError(employeeId);
      throw err;
    }
  }

  /**
   * Handle a delegation from the Supervisor's Feishu response.
   *
   * Flow:
   * 1. The Supervisor's acknowledgment text is already delivered to Feishu (Gateway auto-reply)
   * 2. This method dispatches the task to the target employee
   * 3. The employee's result is sent back to the Supervisor session
   * 4. The Supervisor synthesizes and responds (second Feishu message)
   */
  async handleFeishuDelegation(
    supervisorSessionKey: string,
    delegation: { employee: string; task: string; context?: string }
  ): Promise<void> {
    logger.info(`Feishu delegation: dispatching to ${delegation.employee}`);

    // ── Persist delegation as a Task in TaskQueue (P0 fix) ──────
    // Gracefully degrade: if persistence fails, still dispatch the delegation.
    let persistedTaskId: string | null = null;
    try {
      const projectId = this.getOrCreateFeishuDelegationProject();
      const persistedTask = this.taskQueue.create({
        projectId,
        subject: `[Delegation] ${delegation.task.substring(0, 100)}`,
        description: delegation.task,
        owner: delegation.employee,
        assignedBy: this.supervisorSlug ?? 'supervisor',
        priority: 'medium',
      });
      persistedTaskId = persistedTask.id;
      // Claim the task so it shows as in_progress on the TaskBoard
      this.taskQueue.claim(persistedTask.id, delegation.employee);
    } catch (persistErr) {
      logger.warn(`Failed to persist delegation task (non-fatal): ${persistErr}`);
    }

    this.emit('delegation-started', {
      employee: delegation.employee,
      task: delegation.task,
      taskId: persistedTaskId,
    });

    try {
      const employeeResponse = await this.dispatchToEmployee(
        delegation.employee,
        delegation.task,
        delegation.context
      );

      // Mark the persisted task as completed with the employee's output
      if (persistedTaskId) {
        try {
          this.taskQueue.complete(persistedTaskId, employeeResponse);
        } catch (completeErr) {
          logger.warn(`Failed to mark delegation task completed: ${completeErr}`);
        }
      }

      // Send result back to Supervisor session for synthesis
      const synthesisPrompt = `[Employee Result — ${delegation.employee}]

## Original Task
${delegation.task}

## Employee Response
${employeeResponse}

Please present this result to the user. Be concise and helpful. If the result is good, present it directly. If there are issues, explain and suggest next steps.`;

      await this.gateway.rpc(
        'chat.send',
        { session: supervisorSessionKey, message: synthesisPrompt },
        60_000
      );

      this.emit('delegation-completed', {
        employee: delegation.employee,
        task: delegation.task,
        taskId: persistedTaskId,
      });
    } catch (err) {
      logger.error(`Feishu delegation to ${delegation.employee} failed: ${err}`);

      // Mark the persisted task as failed
      if (persistedTaskId) {
        try {
          this.taskQueue.update(persistedTaskId, {
            status: 'cancelled',
            output: `Error: ${String(err)}`,
          });
        } catch (updateErr) {
          logger.warn(`Failed to mark delegation task cancelled: ${updateErr}`);
        }
      }

      // Inform the Supervisor so it can tell the user
      const errorMsg = `[System] Delegation to ${delegation.employee} failed: ${String(err)}. Please inform the user and suggest alternatives.`;

      await this.gateway
        .rpc('chat.send', { session: supervisorSessionKey, message: errorMsg }, 30_000)
        .catch((e: unknown) => logger.error(`Failed to send error to Supervisor: ${e}`));

      this.emit('delegation-failed', {
        employee: delegation.employee,
        error: String(err),
        taskId: persistedTaskId,
      });
    }
  }

  /**
   * Get or create a reusable project for Feishu delegation tasks.
   * All ad-hoc delegations are grouped under one project for visibility.
   */
  private getOrCreateFeishuDelegationProject(): string {
    if (this.feishuDelegationProjectId) {
      const existing = this.taskQueue.getProject(this.feishuDelegationProjectId);
      if (existing) return this.feishuDelegationProjectId;
    }

    const project = this.taskQueue.createProject({
      goal: 'Feishu Delegations',
      pmEmployeeId: this.supervisorSlug ?? 'supervisor',
      employees: [],
    });
    this.feishuDelegationProjectId = project.id;
    // Set to executing so tasks can be tracked
    this.taskQueue.updateProject(project.id, { status: 'executing' });
    logger.info(`Created Feishu delegation project: ${project.id}`);
    return project.id;
  }

  // ── Private Helpers ─────────────────────────────────────────────

  /**
   * Parse PM's JSON response into task plan objects
   */
  private parsePMTaskPlan(responseText: string): PMTaskPlan[] {
    // Try to extract JSON array from the response
    // PM may wrap it in markdown code blocks or add commentary
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
