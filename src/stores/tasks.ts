/**
 * Tasks State Store
 * Manages task and project listing for the Task Board.
 * Uses ipcSafe() for type-safe IPC calls.
 */
import { create } from 'zustand';
import { ipcSafe } from '@/lib/ipc';
import type { Task, Project, CreateTaskInput, CreateProjectInput } from '../types/task';

interface TaskExecutionResult {
  taskId: string;
  employeeId: string;
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
}

interface TasksState {
  tasks: Task[];
  projects: Project[];
  loading: boolean;
  error: string | null;
  selectedProjectId: string | null;
  executingTaskIds: string[];
  initialized: boolean;

  fetchTasks: (projectId?: string) => Promise<void>;
  fetchProjects: () => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<Task | null>;
  updateTask: (id: string, changes: Partial<Task>) => Promise<void>;
  claimTask: (taskId: string, employeeId: string) => Promise<void>;
  completeTask: (taskId: string, output: string) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  rateTask: (taskId: string, rating: number, feedback?: string) => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<Project | null>;
  selectProject: (projectId: string | null) => void;
  executeTask: (
    taskId: string,
    employeeId: string,
    options?: { timeoutMs?: number; context?: string; includeProjectContext?: boolean }
  ) => Promise<TaskExecutionResult | null>;
  executeAdHoc: (
    employeeId: string,
    description: string,
    options?: { timeoutMs?: number; context?: string }
  ) => Promise<TaskExecutionResult | null>;
  cancelExecution: (taskId: string) => Promise<boolean>;
  init: () => void;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  projects: [],
  loading: false,
  error: null,
  selectedProjectId: null,
  executingTaskIds: [],
  initialized: false,

  fetchTasks: async (projectId?: string) => {
    if (get().tasks.length === 0) set({ loading: true, error: null });
    const result = await ipcSafe<Task[]>('task:list', projectId);
    if (result.ok) {
      set({ tasks: result.data ?? [], loading: false });
    } else {
      set({ error: result.error, loading: false });
    }
  },

  fetchProjects: async () => {
    const result = await ipcSafe<Project[]>('project:list');
    if (result.ok) set({ projects: result.data ?? [] });
  },

  createTask: async (input: CreateTaskInput) => {
    const result = await ipcSafe<Task>('task:create', input);
    if (result.ok && result.data) {
      set((s) => ({ tasks: [...s.tasks, result.data] }));
      return result.data;
    }
    if (!result.ok) set({ error: result.error });
    return null;
  },

  updateTask: async (id: string, changes: Partial<Task>) => {
    const result = await ipcSafe<Task>('task:update', id, changes);
    if (result.ok && result.data) {
      set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? result.data : t)) }));
    } else if (!result.ok) {
      set({ error: result.error });
    }
  },

  claimTask: async (taskId: string, employeeId: string) => {
    const result = await ipcSafe<Task>('task:claim', taskId, employeeId);
    if (result.ok && result.data) {
      set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? result.data : t)) }));
    } else if (!result.ok) {
      set({ error: result.error });
    }
  },

  completeTask: async (taskId: string, output: string) => {
    const result = await ipcSafe<Task>('task:complete', taskId, output);
    if (result.ok && result.data) {
      set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? result.data : t)) }));
    }
  },

  cancelTask: async (taskId: string) => {
    const result = await ipcSafe<Task>('task:cancel', taskId);
    if (result.ok && result.data) {
      set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? result.data : t)) }));
    }
  },

  rateTask: async (taskId: string, rating: number, feedback?: string) => {
    const result = await ipcSafe<void>('task:rate', taskId, rating, feedback);
    if (result.ok) {
      set((s) => ({
        tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, rating, feedback } : t)),
      }));
    }
  },

  createProject: async (input: CreateProjectInput) => {
    const result = await ipcSafe<Project>('project:create', input);
    if (result.ok && result.data) {
      set((s) => ({ projects: [...s.projects, result.data] }));
      return result.data;
    }
    if (!result.ok) set({ error: result.error });
    return null;
  },

  selectProject: (projectId: string | null) => set({ selectedProjectId: projectId }),

  executeTask: async (taskId, employeeId, options) => {
    set((s) => ({ executingTaskIds: [...s.executingTaskIds, taskId], error: null }));
    try {
      const task = get().tasks.find((t) => t.id === taskId);
      if (task && task.status === 'pending' && !task.owner) {
        await get().claimTask(taskId, employeeId);
      }
      const result = await ipcSafe<TaskExecutionResult>('task:execute', {
        taskId,
        employeeId,
        timeoutMs: options?.timeoutMs,
        context: options?.context,
        includeProjectContext: options?.includeProjectContext,
      });
      if (result.ok && result.data) {
        await get().fetchTasks();
        return result.data;
      }
      if (!result.ok) set({ error: result.error });
      return null;
    } finally {
      set((s) => ({ executingTaskIds: s.executingTaskIds.filter((id) => id !== taskId) }));
    }
  },

  executeAdHoc: async (employeeId, description, options) => {
    set({ error: null });
    const result = await ipcSafe<TaskExecutionResult>('task:executeAdHoc', {
      employeeId,
      description,
      timeoutMs: options?.timeoutMs,
      context: options?.context,
    });
    if (result.ok && result.data) {
      await get().fetchTasks();
      return result.data;
    }
    if (!result.ok) set({ error: result.error });
    return null;
  },

  cancelExecution: async (taskId) => {
    const result = await ipcSafe<{ cancelled: boolean }>('task:cancelExecution', taskId);
    if (result.ok && result.data?.cancelled) {
      set((s) => ({ executingTaskIds: s.executingTaskIds.filter((id) => id !== taskId) }));
      return true;
    }
    return false;
  },

  init: () => {
    if (get().initialized) return;
    set({ initialized: true });

    window.electron.ipcRenderer.on('task:changed', (...args: unknown[]) => {
      const t = args[0] as Task;
      if (!t?.id) return;
      set((state) => {
        const exists = state.tasks.some((existing) => existing.id === t.id);
        if (exists) {
          return { tasks: state.tasks.map((existing) => (existing.id === t.id ? t : existing)) };
        }
        return { tasks: [...state.tasks, t] };
      });
    });
  },
}));
