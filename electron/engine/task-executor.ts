/**
 * Task Executor
 * Bridges TaskQueue with Gateway to actually execute tasks via employee AI sessions.
 *
 * The TaskExecutor listens to TaskQueue events and orchestrates task execution:
 * 1. When a task is claimed by an employee → dispatches it to the employee's Gateway session
 * 2. Collects the AI response and marks the task as completed (or failed)
 * 3. Handles timeouts, retries, and error states
 * 4. Emits progress events for UI updates
 *
 * Design decisions:
 * - Runs as a singleton service in the main process
 * - Uses the same Gateway RPC as Supervisor.dispatchToEmployee but with richer lifecycle
 * - Supports concurrent task execution (one per employee, employees work in parallel)
 * - Per-employee model overrides are injected at the Gateway RPC level (ipc-handlers.ts)
 * - Task output is persisted in TaskQueue (SQLite)
 */
import { EventEmitter } from 'node:events';
import { logger } from '../utils/logger';
import type { TaskQueue } from './task-queue';
import type { EmployeeManager } from './employee-manager';
import type { GatewayManager } from '../gateway/manager';
import type { Task } from '../../src/types/task';

// ── Types ────────────────────────────────────────────────────────────

export interface TaskExecutionOptions {
  /** Timeout for the AI response in ms (default: 5 minutes) */
  timeoutMs?: number;
  /** Whether to auto-activate the employee if offline (default: true) */
  autoActivate?: boolean;
  /** Additional context to prepend to the task description */
  context?: string;
  /** Whether to include previous task outputs as context (default: false) */
  includeProjectContext?: boolean;
}

export interface TaskExecutionProgress {
  taskId: string;
  employeeId: string;
  phase: 'activating' | 'sending' | 'waiting' | 'completed' | 'failed';
  message?: string;
  startedAt: number;
  elapsedMs?: number;
}

export interface TaskExecutionResult {
  taskId: string;
  employeeId: string;
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
}

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ── TaskExecutor ─────────────────────────────────────────────────────

/**
 * TaskExecutor — executes tasks by dispatching them to employee Gateway sessions.
 *
 * Events:
 *  - 'execution:progress'  (progress: TaskExecutionProgress)
 *  - 'execution:completed' (result: TaskExecutionResult)
 *  - 'execution:failed'    (result: TaskExecutionResult)
 *  - 'execution:queued'    (taskId: string, employeeId: string)
 */
export class TaskExecutor extends EventEmitter {
  private taskQueue: TaskQueue;
  private employeeManager: EmployeeManager;
  private gateway: GatewayManager;

  /** Currently executing tasks keyed by taskId */
  private executing: Map<string, AbortController> = new Map();

  /** Stored reference to the task-changed listener so we can remove it in destroy() */
  private onTaskChanged: ((task: Task) => void) | null = null;

  /** Track which employees are busy (taskId they're working on) */
  private employeeBusy: Map<string, string> = new Map();

  /** Queue of tasks waiting for their assigned employee to become free */
  private pendingQueue: Array<{
    taskId: string;
    employeeId: string;
    options: TaskExecutionOptions;
  }> = [];

  /** Whether auto-execution on task:claimed is enabled */
  private autoExecuteEnabled = true;

  constructor(taskQueue: TaskQueue, employeeManager: EmployeeManager, gateway: GatewayManager) {
    super();
    this.taskQueue = taskQueue;
    this.employeeManager = employeeManager;
    this.gateway = gateway;

    // Listen for task state changes to auto-execute claimed tasks.
    // Store the callback reference so we can remove it in destroy().
    this.onTaskChanged = (task: Task) => {
      if (
        this.autoExecuteEnabled &&
        task.status === 'in_progress' &&
        task.owner &&
        !this.executing.has(task.id) &&
        !this.employeeBusy.has(task.owner)
      ) {
        // A task was just claimed — auto-execute it
        void this.executeTask(task.id, task.owner).catch((err) => {
          logger.error(`[TaskExecutor] Auto-execute failed for task ${task.id}: ${err}`);
        });
      }
    };
    this.taskQueue.on('task-changed', this.onTaskChanged);
  }

  // ── Configuration ──────────────────────────────────────────────

  /**
   * Enable or disable auto-execution when tasks are claimed.
   */
  setAutoExecute(enabled: boolean): void {
    this.autoExecuteEnabled = enabled;
    logger.info(`[TaskExecutor] Auto-execute ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if auto-execute is enabled.
   */
  isAutoExecuteEnabled(): boolean {
    return this.autoExecuteEnabled;
  }

  // ── Core Execution ─────────────────────────────────────────────

  /**
   * Execute a task by sending it to the assigned employee's Gateway session.
   *
   * This is the main entry point. It:
   * 1. Validates the task and employee exist
   * 2. Activates the employee if needed
   * 3. Builds the prompt from the task description + context
   * 4. Sends it via Gateway RPC (chat.send)
   * 5. Waits for the response
   * 6. Updates the task with the result
   *
   * @param taskId    The task to execute
   * @param employeeId  The employee to execute it (must match task.owner or be provided)
   * @param options   Execution options
   * @returns The execution result
   */
  async executeTask(
    taskId: string,
    employeeId: string,
    options: TaskExecutionOptions = {}
  ): Promise<TaskExecutionResult> {
    const {
      timeoutMs = DEFAULT_TIMEOUT_MS,
      autoActivate = true,
      context,
      includeProjectContext = false,
    } = options;

    const startedAt = Date.now();

    // Validate task exists
    const task = this.taskQueue.get(taskId);
    if (!task) {
      const result: TaskExecutionResult = {
        taskId,
        employeeId,
        success: false,
        error: `Task not found: ${taskId}`,
        durationMs: 0,
      };
      this.emit('execution:failed', result);
      return result;
    }

    // Validate employee exists
    const employee = this.employeeManager.get(employeeId);
    if (!employee) {
      const result: TaskExecutionResult = {
        taskId,
        employeeId,
        success: false,
        error: `Employee not found: ${employeeId}`,
        durationMs: 0,
      };
      this.emit('execution:failed', result);
      return result;
    }

    // Check if employee is already busy with another task
    const busyWithTask = this.employeeBusy.get(employeeId);
    if (busyWithTask && busyWithTask !== taskId) {
      // Queue this task for later
      logger.info(
        `[TaskExecutor] Employee ${employeeId} busy with ${busyWithTask}, queuing task ${taskId}`
      );
      this.pendingQueue.push({ taskId, employeeId, options });
      this.emit('execution:queued', taskId, employeeId);
      // Return a pending result — the task will be picked up when the employee finishes
      return {
        taskId,
        employeeId,
        success: false,
        error: 'Queued: employee busy with another task',
        durationMs: 0,
      };
    }

    // Check if this task is already executing
    if (this.executing.has(taskId)) {
      return {
        taskId,
        employeeId,
        success: false,
        error: 'Task is already executing',
        durationMs: 0,
      };
    }

    // Set up abort controller for cancellation
    const abortController = new AbortController();
    this.executing.set(taskId, abortController);
    this.employeeBusy.set(employeeId, taskId);

    // ── Phase: Activating ──
    this.emitProgress(taskId, employeeId, 'activating', startedAt);

    try {
      // Activate employee if needed
      if (autoActivate && (!employee.gatewaySessionKey || employee.status === 'offline')) {
        logger.info(`[TaskExecutor] Auto-activating employee ${employeeId} for task ${taskId}`);
        await this.employeeManager.activate(employeeId);
      }

      // Re-read employee after potential activation
      const updatedEmployee = this.employeeManager.get(employeeId);
      if (!updatedEmployee?.gatewaySessionKey) {
        throw new Error(`Employee ${employeeId} has no Gateway session after activation`);
      }

      const sessionKey = updatedEmployee.gatewaySessionKey;

      // Check for cancellation
      if (abortController.signal.aborted) {
        throw new Error('Task execution cancelled');
      }

      // ── Phase: Building prompt ──
      let prompt = this.buildTaskPrompt(task, context);

      // Optionally include context from completed sibling tasks
      if (includeProjectContext && task.projectId) {
        const projectContext = this.buildProjectContext(task);
        if (projectContext) {
          prompt = `${prompt}\n\n## Related Task Outputs\n${projectContext}`;
        }
      }

      // Mark employee as working
      if (updatedEmployee.status === 'idle') {
        this.employeeManager.assignTask(employeeId);
      }

      // ── Phase: Sending ──
      this.emitProgress(taskId, employeeId, 'sending', startedAt);

      logger.info(
        `[TaskExecutor] Executing task ${taskId} ("${task.subject}") via employee ${employeeId} (session: ${sessionKey})`
      );

      // ── Phase: Waiting for response ──
      this.emitProgress(taskId, employeeId, 'waiting', startedAt);

      const response = await this.sendToGateway(
        sessionKey,
        prompt,
        timeoutMs,
        abortController.signal
      );

      // Check for cancellation after response
      if (abortController.signal.aborted) {
        throw new Error('Task execution cancelled');
      }

      // ── Phase: Completed ──
      const durationMs = Date.now() - startedAt;

      // Update task in queue
      this.taskQueue.complete(taskId, response);

      // Mark employee as idle
      this.employeeManager.completeTask(employeeId);

      const result: TaskExecutionResult = {
        taskId,
        employeeId,
        success: true,
        output: response,
        durationMs,
      };

      this.emitProgress(taskId, employeeId, 'completed', startedAt, response);
      this.emit('execution:completed', result);

      logger.info(
        `[TaskExecutor] Task ${taskId} completed in ${durationMs}ms (output: ${response.length} chars)`
      );

      return result;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const errorMsg = String(err);

      // Mark task as blocked (not failed — can be retried)
      try {
        this.taskQueue.block(taskId);
      } catch {
        // Task may already be in a terminal state
      }

      // Mark employee as error if it was working
      try {
        const emp = this.employeeManager.get(employeeId);
        if (emp && emp.status === 'working') {
          this.employeeManager.markError(employeeId);
        }
      } catch {
        // Non-fatal
      }

      const result: TaskExecutionResult = {
        taskId,
        employeeId,
        success: false,
        error: errorMsg,
        durationMs,
      };

      this.emitProgress(taskId, employeeId, 'failed', startedAt, errorMsg);
      this.emit('execution:failed', result);

      logger.error(`[TaskExecutor] Task ${taskId} failed after ${durationMs}ms: ${errorMsg}`);

      return result;
    } finally {
      // Clean up
      this.executing.delete(taskId);
      this.employeeBusy.delete(employeeId);

      // Check if there are queued tasks for this employee
      this.processQueue(employeeId);
    }
  }

  /**
   * Execute a standalone task (not from TaskQueue) — useful for ad-hoc dispatches.
   * Creates a temporary task, executes it, and returns the result.
   */
  async executeAdHoc(
    employeeId: string,
    description: string,
    options: TaskExecutionOptions = {}
  ): Promise<TaskExecutionResult> {
    // Create a task in the queue
    const task = this.taskQueue.create({
      projectId: 'adhoc',
      subject: description.slice(0, 100),
      description,
      owner: employeeId,
      assignedBy: 'user',
      priority: 'medium',
    });

    // Claim it
    this.taskQueue.claim(task.id, employeeId);

    // Execute (auto-execute listener won't fire because we're already calling executeTask)
    return this.executeTask(task.id, employeeId, options);
  }

  // ── Cancellation ───────────────────────────────────────────────

  /**
   * Cancel a running task execution.
   */
  cancel(taskId: string): boolean {
    const controller = this.executing.get(taskId);
    if (!controller) {
      logger.debug(`[TaskExecutor] cancel(${taskId}): not executing`);
      return false;
    }

    logger.info(`[TaskExecutor] Cancelling task execution: ${taskId}`);
    controller.abort();
    return true;
  }

  /**
   * Cancel all running task executions.
   */
  cancelAll(): number {
    let cancelled = 0;
    for (const [taskId, controller] of this.executing) {
      logger.info(`[TaskExecutor] Cancelling task: ${taskId}`);
      controller.abort();
      cancelled++;
    }
    return cancelled;
  }

  // ── Status ─────────────────────────────────────────────────────

  /**
   * Check if a specific task is currently executing.
   */
  isExecuting(taskId: string): boolean {
    return this.executing.has(taskId);
  }

  /**
   * Get all currently executing task IDs.
   */
  getExecutingTasks(): string[] {
    return Array.from(this.executing.keys());
  }

  /**
   * Get the number of tasks waiting in the queue for a specific employee.
   */
  getQueuedCount(employeeId: string): number {
    return this.pendingQueue.filter((p) => p.employeeId === employeeId).length;
  }

  /**
   * Get total stats about executor state.
   */
  getStats(): {
    executing: number;
    queued: number;
    busyEmployees: number;
  } {
    return {
      executing: this.executing.size,
      queued: this.pendingQueue.length,
      busyEmployees: this.employeeBusy.size,
    };
  }

  // ── Cleanup ────────────────────────────────────────────────────

  /**
   * Destroy — cancel all executions and clean up.
   */
  destroy(): void {
    logger.info('[TaskExecutor] Destroying...');
    this.cancelAll();
    this.pendingQueue.length = 0;
    this.employeeBusy.clear();
    // Remove the listener we placed on taskQueue to prevent a reference leak
    // (this.removeAllListeners() only removes listeners ON this emitter, not FROM taskQueue)
    if (this.onTaskChanged) {
      this.taskQueue.removeListener('task-changed', this.onTaskChanged);
      this.onTaskChanged = null;
    }
    this.removeAllListeners();
  }

  // ── Private helpers ────────────────────────────────────────────

  /**
   * Build the prompt to send to the employee for a task.
   */
  private buildTaskPrompt(task: Task, additionalContext?: string): string {
    const parts: string[] = [];

    parts.push(`## Task: ${task.subject}`);
    parts.push('');

    if (task.description) {
      parts.push(task.description);
      parts.push('');
    }

    if (task.priority && task.priority !== 'medium') {
      parts.push(`**Priority:** ${task.priority}`);
    }

    if (task.requiresApproval) {
      parts.push('**Note:** This task requires approval. Submit your plan before executing.');
    }

    if (additionalContext) {
      parts.push('');
      parts.push('## Additional Context');
      parts.push(additionalContext);
    }

    parts.push('');
    parts.push(
      'Please complete this task and provide your output. Be thorough and include all relevant details in your response.'
    );

    return parts.join('\n');
  }

  /**
   * Build context from completed sibling tasks in the same project.
   */
  private buildProjectContext(task: Task): string | null {
    if (!task.projectId || task.projectId === 'adhoc') return null;

    const siblingTasks = this.taskQueue.list(task.projectId);
    const completedSiblings = siblingTasks.filter(
      (t) => t.id !== task.id && t.status === 'completed' && t.output
    );

    if (completedSiblings.length === 0) return null;

    return completedSiblings
      .map(
        (t) =>
          `### ${t.subject} (by ${t.owner ?? 'unknown'})\n${t.output!.slice(0, 500)}${t.output!.length > 500 ? '...' : ''}`
      )
      .join('\n\n');
  }

  /**
   * Send a message to the Gateway and wait for the complete response.
   * Uses the RPC method which returns the full response (not streaming).
   */
  private async sendToGateway(
    sessionKey: string,
    message: string,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<string> {
    // Create a race between the RPC call and the abort signal
    return new Promise<string>((resolve, reject) => {
      let settled = false;

      const onAbort = () => {
        if (!settled) {
          settled = true;
          reject(new Error('Task execution cancelled'));
        }
      };

      if (signal.aborted) {
        reject(new Error('Task execution cancelled'));
        return;
      }

      signal.addEventListener('abort', onAbort, { once: true });

      this.gateway
        .rpc<Record<string, unknown> | string>(
          'chat.send',
          {
            session: sessionKey,
            message,
            deliver: false,
          },
          timeoutMs
        )
        .then((response) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);

          // Extract text from the response (which may be string or structured)
          const text =
            typeof response === 'string'
              ? response
              : ((response as Record<string, unknown>)?.content ??
                (response as Record<string, unknown>)?.text ??
                JSON.stringify(response));

          resolve(String(text));
        })
        .catch((err) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          reject(err);
        });
    });
  }

  /**
   * Process the pending queue for a specific employee.
   * Called after an employee finishes a task.
   */
  private processQueue(employeeId: string): void {
    const idx = this.pendingQueue.findIndex((p) => p.employeeId === employeeId);
    if (idx === -1) return;

    const next = this.pendingQueue.splice(idx, 1)[0];
    logger.info(`[TaskExecutor] Dequeuing task ${next.taskId} for employee ${employeeId}`);

    // Execute the next queued task (non-blocking)
    void this.executeTask(next.taskId, next.employeeId, next.options).catch((err) => {
      logger.error(`[TaskExecutor] Queued task ${next.taskId} failed: ${err}`);
    });
  }

  /**
   * Emit a progress event.
   */
  private emitProgress(
    taskId: string,
    employeeId: string,
    phase: TaskExecutionProgress['phase'],
    startedAt: number,
    message?: string
  ): void {
    const progress: TaskExecutionProgress = {
      taskId,
      employeeId,
      phase,
      message,
      startedAt,
      elapsedMs: Date.now() - startedAt,
    };
    this.emit('execution:progress', progress);
  }
}
