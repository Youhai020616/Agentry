/**
 * Spawn Tracker
 *
 * Bridges Gateway-native `sessions_spawn` tool calls to the TaskQueue system.
 *
 * Architecture:
 *   GatewayManager
 *     ↓ emits 'notification' events (tool.call_started / tool.call_completed)
 *   SpawnTracker
 *     ↓ detects sessions_spawn calls, extracts task/agentId/label
 *     ↓ auto-creates Project + Task in TaskQueue
 *   TaskQueue
 *     ↓ emits project-changed / task-changed
 *   Renderer (OrchestrationPanel, ActivityTimeline)
 *
 * This mirrors the BrowserEventDetector pattern.
 */
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import type { GatewayManager } from '../gateway/manager';
import type { TaskQueue } from './task-queue';
import type { EmployeeManager } from './employee-manager';
import type { Task } from '../../shared/types/task';

// ── Helpers ─────────────────────────────────────────────────────────

/** Extract session key from various Gateway notification shapes */
function findSessionKey(params: Record<string, unknown>): string | undefined {
  for (const key of ['sessionKey', 'session', 'sessionId', 'session_key']) {
    const val = params[key];
    if (typeof val === 'string' && val.length > 0) return val;
  }
  for (const wrapper of ['tool_call', 'toolCall', 'meta', 'context']) {
    const nested = params[wrapper];
    if (nested && typeof nested === 'object') {
      const n = nested as Record<string, unknown>;
      for (const key of ['sessionKey', 'session', 'sessionId', 'session_key']) {
        const val = n[key];
        if (typeof val === 'string' && val.length > 0) return val;
      }
    }
  }
  return undefined;
}

/** Resolve tool name from notification params */
function resolveToolName(params: Record<string, unknown>): string | undefined {
  if (typeof params.tool === 'string') return params.tool;
  if (typeof params.name === 'string') return params.name;

  const toolCall = (params.tool_call ?? params.toolCall) as Record<string, unknown> | undefined;
  if (toolCall && typeof toolCall === 'object') {
    if (typeof toolCall.name === 'string') return toolCall.name;
    if (typeof toolCall.tool === 'string') return toolCall.tool;
  }
  return undefined;
}

/** Resolve tool arguments from notification params */
function resolveToolArgs(params: Record<string, unknown>): Record<string, unknown> | undefined {
  if (params.args && typeof params.args === 'object') {
    return params.args as Record<string, unknown>;
  }
  if (params.arguments && typeof params.arguments === 'object') {
    return params.arguments as Record<string, unknown>;
  }
  if (params.input && typeof params.input === 'object') {
    return params.input as Record<string, unknown>;
  }

  const toolCall = (params.tool_call ?? params.toolCall) as Record<string, unknown> | undefined;
  if (toolCall && typeof toolCall === 'object') {
    if (toolCall.arguments && typeof toolCall.arguments === 'object') {
      return toolCall.arguments as Record<string, unknown>;
    }
    if (toolCall.args && typeof toolCall.args === 'object') {
      return toolCall.args as Record<string, unknown>;
    }
  }
  return undefined;
}

/** Resolve toolCallId from notification params */
function resolveToolCallId(params: Record<string, unknown>): string | undefined {
  for (const key of ['toolCallId', 'tool_call_id', 'id', 'callId']) {
    const val = params[key];
    if (typeof val === 'string' && val.length > 0) return val;
  }
  const toolCall = (params.tool_call ?? params.toolCall) as Record<string, unknown> | undefined;
  if (toolCall && typeof toolCall === 'object') {
    for (const key of ['id', 'toolCallId', 'tool_call_id']) {
      const val = (toolCall as Record<string, unknown>)[key];
      if (typeof val === 'string' && val.length > 0) return val;
    }
  }
  return undefined;
}

/** Check if a session key belongs to the supervisor */
function isSupervisorSession(sessionKey: string): boolean {
  return sessionKey.startsWith('agent:supervisor:');
}

// ── Types ───────────────────────────────────────────────────────────

interface TrackedSpawn {
  toolCallId: string;
  taskId: string;
  projectId: string;
  agentId: string;
  supervisorSessionKey: string;
  label: string;
  startedAt: number;
  childSessionKey?: string;
}

// ── Main Class ──────────────────────────────────────────────────────

/**
 * Tracks `sessions_spawn` tool calls from the Supervisor and bridges
 * them into the TaskQueue as Projects + Tasks.
 */
export class SpawnTracker extends EventEmitter {
  private gateway: GatewayManager;
  private taskQueue: TaskQueue;
  private employeeManager: EmployeeManager;
  private _boundHandler: ((notification: unknown) => void) | null = null;
  private _destroyed = false;

  /**
   * Maps supervisor session key → project ID for the current conversation.
   * Each supervisor conversation gets at most one project.
   */
  private sessionProjects = new Map<string, string>();

  /**
   * Maps toolCallId → tracked spawn info for correlating start/complete.
   */
  private activeSpawns = new Map<string, TrackedSpawn>();

  /**
   * Maps childSessionKey → TrackedSpawn for detecting sub-agent completion.
   */
  private childSessions = new Map<string, TrackedSpawn>();

  constructor(
    gateway: GatewayManager,
    taskQueue: TaskQueue,
    employeeManager: EmployeeManager
  ) {
    super();
    this.gateway = gateway;
    this.taskQueue = taskQueue;
    this.employeeManager = employeeManager;
  }

  /**
   * Start listening to Gateway notifications.
   */
  init(): void {
    if (this._boundHandler) return;

    this._boundHandler = this.handleNotification.bind(this);
    this.gateway.on('notification', this._boundHandler);
    logger.info('[SpawnTracker] Initialized — listening for sessions_spawn tool calls');
  }

  /**
   * Stop listening and clean up.
   */
  destroy(): void {
    this._destroyed = true;
    if (this._boundHandler) {
      this.gateway.removeListener('notification', this._boundHandler);
      this._boundHandler = null;
    }
    this.sessionProjects.clear();
    this.activeSpawns.clear();
    this.childSessions.clear();
    this.removeAllListeners();
    logger.info('[SpawnTracker] Destroyed');
  }

  // ── Private: Notification handling ──────────────────────────────

  private handleNotification(notification: unknown): void {
    if (this._destroyed) return;
    if (!notification || typeof notification !== 'object') return;

    const notif = notification as Record<string, unknown>;
    const method = notif.method as string | undefined;
    if (!method) return;

    if (method === 'tool.call_started' || method === 'tool_call_started') {
      this.processToolCallStarted(notif.params);
    } else if (method === 'tool.call_completed' || method === 'tool_call_completed') {
      this.processToolCallCompleted(notif.params);
    }

    // Also detect lifecycle:end for tracked child sessions via agent stream events.
    // These arrive as { method: 'agent.*', params: { stream: 'lifecycle', data: { phase: 'end' }, sessionKey } }
    // OR directly in the params for generic notification forwarding.
    this.detectChildCompletion(notif);
  }

  // ── tool.call_started ─────────────────────────────────────────

  private processToolCallStarted(params: unknown): void {
    if (!params || typeof params !== 'object') return;
    const p = params as Record<string, unknown>;

    const toolName = resolveToolName(p);
    if (toolName !== 'sessions_spawn') return;

    const sessionKey = findSessionKey(p);
    if (!sessionKey || !isSupervisorSession(sessionKey)) return;

    const args = resolveToolArgs(p);
    if (!args) return;

    const task = (args.task ?? args.message ?? '') as string;
    const agentId = (args.agentId ?? args.agent_id ?? args.agent ?? '') as string;
    const label = (args.label ?? '') as string;
    const toolCallId = resolveToolCallId(p) ?? `spawn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (!agentId) {
      logger.warn('[SpawnTracker] sessions_spawn without agentId, skipping');
      return;
    }

    logger.info(
      `[SpawnTracker] sessions_spawn detected: agent=${agentId}, label="${label || '(none)'}", session=${sessionKey}`
    );

    try {
      // Get or create project for this supervisor conversation
      const projectId = this.getOrCreateProject(sessionKey, task);

      // Resolve employee name for the task subject
      const employee = this.employeeManager.get(agentId);
      const employeeName = employee?.name ?? agentId;
      const subject = label || `${employeeName}: ${task.slice(0, 60)}`;

      // Create task in TaskQueue
      const newTask = this.taskQueue.create({
        projectId,
        subject,
        description: task,
        owner: agentId,
        assignedBy: 'pm',
        priority: 'medium',
        wave: 0,
      });

      // Immediately claim it (status → in_progress)
      this.taskQueue.claim(newTask.id, agentId);

      // Track for correlating with tool.call_completed
      this.activeSpawns.set(toolCallId, {
        toolCallId,
        taskId: newTask.id,
        projectId,
        agentId,
        supervisorSessionKey: sessionKey,
        label: subject,
        startedAt: Date.now(),
      });

      this.emit('spawn-started', {
        taskId: newTask.id,
        projectId,
        agentId,
        label: subject,
      });

      logger.info(
        `[SpawnTracker] Created task ${newTask.id} in project ${projectId} for ${agentId}`
      );
    } catch (err) {
      logger.error(`[SpawnTracker] Failed to track spawn: ${err}`);
    }
  }

  // ── tool.call_completed ───────────────────────────────────────

  private processToolCallCompleted(params: unknown): void {
    if (!params || typeof params !== 'object') return;
    const p = params as Record<string, unknown>;

    const toolName = resolveToolName(p);
    if (toolName !== 'sessions_spawn') return;

    const toolCallId = resolveToolCallId(p);
    if (!toolCallId) return;

    const tracked = this.activeSpawns.get(toolCallId);
    if (!tracked) return; // Not a spawn we're tracking

    this.activeSpawns.delete(toolCallId);

    // sessions_spawn completes immediately with { status: "accepted", runId, childSessionKey }
    // Extract childSessionKey to track the sub-agent's lifecycle.
    const result = (p.result ?? p.output ?? p.response) as Record<string, unknown> | undefined;
    const childSessionKey = (
      result?.childSessionKey ?? result?.child_session_key ?? result?.sessionKey
    ) as string | undefined;

    if (childSessionKey) {
      tracked.childSessionKey = childSessionKey;
      this.childSessions.set(childSessionKey, tracked);
      logger.info(
        `[SpawnTracker] Tracking child session ${childSessionKey} for task ${tracked.taskId}`
      );
    } else {
      // No childSessionKey — fall back to agentId-based matching.
      // Keep in activeSpawns by agentId for lifecycle event matching.
      this.activeSpawns.set(tracked.agentId, tracked);
      logger.debug(
        `[SpawnTracker] sessions_spawn accepted for task ${tracked.taskId} (agent: ${tracked.agentId}), no childSessionKey — using agentId fallback`
      );
    }
  }

  // ── Child session completion detection ────────────────────────

  private detectChildCompletion(notif: Record<string, unknown>): void {
    // Detect lifecycle:end events from various notification shapes
    const params = notif.params as Record<string, unknown> | undefined;
    if (!params) return;

    // Shape 1: { params: { stream: 'lifecycle', data: { phase: 'end' }, sessionKey: '...' } }
    const stream = (params.stream ?? '') as string;
    const data = (params.data ?? params) as Record<string, unknown>;
    const phase = (data.phase ?? '') as string;

    if (stream !== 'lifecycle' || (phase !== 'end' && phase !== 'done' && phase !== 'complete')) {
      return;
    }

    const sessionKey = findSessionKey(params) ?? findSessionKey(data);
    if (!sessionKey) return;

    // Check if this is a tracked child session
    const tracked = this.childSessions.get(sessionKey);
    if (tracked) {
      this.childSessions.delete(sessionKey);
      this.handleSpawnCompletion(tracked, sessionKey);
      return;
    }

    // Fallback: match by agentId extracted from session key (agent:<slug>:spawn-*)
    const agentMatch = sessionKey.match(/^agent:([^:]+):spawn/);
    if (agentMatch) {
      const agentId = agentMatch[1];
      const byAgent = this.activeSpawns.get(agentId);
      if (byAgent) {
        this.activeSpawns.delete(agentId);
        this.handleSpawnCompletion(byAgent, sessionKey);
      }
    }
  }

  private handleSpawnCompletion(tracked: TrackedSpawn, _childSessionKey: string): void {
    const durationMs = Date.now() - tracked.startedAt;
    logger.info(
      `[SpawnTracker] Sub-agent completed: task=${tracked.taskId}, agent=${tracked.agentId}, duration=${Math.round(durationMs / 1000)}s`
    );

    try {
      // Mark task as completed
      const task = this.taskQueue.get(tracked.taskId);
      if (task && task.status === 'in_progress') {
        this.taskQueue.complete(tracked.taskId, `Completed by ${tracked.agentId}`);
      }

      // Check if all tasks in the project are done
      const allTasks = this.taskQueue.list(tracked.projectId);
      if (allTasks.length > 0 && allTasks.every((t: Task) => t.status === 'completed')) {
        this.taskQueue.updateProject(tracked.projectId, { status: 'completed' });
        logger.info(`[SpawnTracker] All tasks done — project ${tracked.projectId} completed`);
      }

      this.emit('spawn-completed', {
        taskId: tracked.taskId,
        projectId: tracked.projectId,
        agentId: tracked.agentId,
        durationMs,
      });
    } catch (err) {
      logger.error(`[SpawnTracker] Failed to complete task ${tracked.taskId}: ${err}`);
    }
  }

  // ── Project management ────────────────────────────────────────

  /**
   * Get or create a project for the given supervisor session.
   * One project per supervisor conversation.
   */
  private getOrCreateProject(sessionKey: string, firstTaskDesc: string): string {
    const existing = this.sessionProjects.get(sessionKey);
    if (existing) {
      // Verify project still exists
      const project = this.taskQueue.getProject(existing);
      if (project) return existing;
    }

    // Create a new project
    const goal = firstTaskDesc.length > 100
      ? firstTaskDesc.slice(0, 100) + '...'
      : firstTaskDesc || 'Supervisor task';

    const project = this.taskQueue.createProject({
      goal,
      pmEmployeeId: 'supervisor',
      employees: this.employeeManager
        .list()
        .filter((e) => e.status !== 'offline')
        .map((e) => e.id),
    });

    // Mark as executing immediately
    this.taskQueue.updateProject(project.id, { status: 'executing' });

    this.sessionProjects.set(sessionKey, project.id);

    logger.info(
      `[SpawnTracker] Created project ${project.id} for session ${sessionKey}: "${goal}"`
    );

    return project.id;
  }

  /**
   * Notify that a sub-agent has completed its work.
   * Called externally when the announce result arrives.
   */
  completeTaskForAgent(agentId: string, sessionKey: string, output?: string): void {
    const projectId = this.sessionProjects.get(sessionKey);
    if (!projectId) return;

    // Find in-progress tasks for this agent in this project
    const tasks = this.taskQueue.list(projectId);
    const inProgress = tasks.filter(
      (t: Task) => t.owner === agentId && t.status === 'in_progress'
    );

    for (const task of inProgress) {
      try {
        this.taskQueue.complete(task.id, output ?? 'Completed');
        logger.info(`[SpawnTracker] Completed task ${task.id} for agent ${agentId}`);
      } catch (err) {
        logger.error(`[SpawnTracker] Failed to complete task ${task.id}: ${err}`);
      }
    }

    // Check if all tasks are done → complete the project
    const allTasks = this.taskQueue.list(projectId);
    if (allTasks.length > 0 && allTasks.every((t: Task) => t.status === 'completed')) {
      try {
        this.taskQueue.updateProject(projectId, { status: 'completed' });
        logger.info(`[SpawnTracker] All tasks done — project ${projectId} completed`);
      } catch (err) {
        logger.error(`[SpawnTracker] Failed to complete project ${projectId}: ${err}`);
      }
    }
  }
}
