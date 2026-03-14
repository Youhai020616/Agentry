/**
 * Task Type Definitions
 * Types for task management in the AI Employee Platform
 *
 * Phase 1A: Full task system with projects, dependencies, and messaging.
 */

// ── Task ────────────────────────────────────────────────────────────

/**
 * Task execution status (state machine)
 *
 * pending → in_progress → completed
 *                       → in_review → completed
 *                       → blocked → pending (reassign)
 */
export type TaskStatus = 'pending' | 'in_progress' | 'in_review' | 'completed' | 'blocked';

/**
 * Task priority levels
 */
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * Plan approval status
 */
export type PlanStatus = 'none' | 'submitted' | 'approved' | 'rejected';

/**
 * Who assigned this task
 */
export type AssignedBy = 'self' | 'pm' | 'user';

/**
 * Task instance — a single unit of work assigned to an employee
 */
export interface Task {
  id: string;
  projectId: string;
  subject: string;
  description: string;
  status: TaskStatus;
  owner: string | null;
  assignedBy: AssignedBy;
  blockedBy: string[];
  blocks: string[];
  priority: TaskPriority;

  /** If true, employee must submit a plan before execution */
  requiresApproval: boolean;
  plan: string | null;
  planStatus: PlanStatus;
  planFeedback: string | null;

  /** Task result/deliverable */
  output: string | null;
  outputFiles: string[];
  tokensUsed: number;
  creditsConsumed: number;

  /** Timestamps (epoch ms) */
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  estimatedDuration: number;

  /** Which dependency wave this task belongs to (computed) */
  wave: number;

  /** Quality rating (1-5 stars) given after completion */
  rating?: number;
  /** Optional text feedback on task quality */
  feedback?: string;
}

/**
 * Input for creating a new task
 */
export interface CreateTaskInput {
  projectId: string;
  subject: string;
  description: string;
  owner?: string;
  assignedBy?: AssignedBy;
  blockedBy?: string[];
  priority?: TaskPriority;
  requiresApproval?: boolean;
  estimatedDuration?: number;
  wave?: number;
}

// ── Project ─────────────────────────────────────────────────────────

/**
 * Project status
 */
export type ProjectStatus = 'planning' | 'executing' | 'reviewing' | 'completed';

/**
 * Project — a user goal decomposed into tasks managed by a PM employee
 */
export interface Project {
  id: string;
  goal: string;
  pmEmployeeId: string;
  employees: string[];
  tasks: string[];
  status: ProjectStatus;
  createdAt: number;
  completedAt: number | null;
}

/**
 * Input for creating a new project
 */
export interface CreateProjectInput {
  goal: string;
  pmEmployeeId: string;
  employees: string[];
}

// ── Message Bus ─────────────────────────────────────────────────────

/**
 * Message types for inter-employee communication
 */
export type MessageType =
  | 'message'
  | 'broadcast'
  | 'shutdown_request'
  | 'shutdown_response'
  | 'plan_approval';

/**
 * Message — cross-employee communication record
 */
export interface Message {
  id: string;
  type: MessageType;
  from: string;
  recipient: string;
  content: string;
  summary: string;
  requestId?: string;
  approve?: boolean;
  timestamp: number;
  read: boolean;
}

/**
 * Input for sending a message
 */
export interface SendMessageInput {
  type: MessageType;
  from: string;
  recipient: string;
  content: string;
  summary: string;
  requestId?: string;
  approve?: boolean;
}
