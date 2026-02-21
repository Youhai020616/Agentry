/**
 * Tasks State Store
 * Manages task and project listing for the Task Board
 */
import { create } from 'zustand';
import type { Task, Project, CreateTaskInput, CreateProjectInput } from '../types/task';

interface TasksState {
  tasks: Task[];
  projects: Project[];
  loading: boolean;
  error: string | null;
  selectedProjectId: string | null;

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
  init: () => void;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  projects: [],
  loading: false,
  error: null,
  selectedProjectId: null,

  fetchTasks: async (projectId?: string) => {
    if (get().tasks.length === 0) {
      set({ loading: true, error: null });
    }
    try {
      const result = (await window.electron.ipcRenderer.invoke('task:list', projectId)) as {
        success: boolean;
        result?: Task[];
        error?: string;
      };
      if (result.success) {
        set({ tasks: result.result ?? [], loading: false });
      } else {
        set({ error: result.error ?? 'Failed to fetch tasks', loading: false });
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  fetchProjects: async () => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('project:list')) as {
        success: boolean;
        result?: Project[];
        error?: string;
      };
      if (result.success) {
        set({ projects: result.result ?? [] });
      }
    } catch (error) {
      set({ error: String(error) });
    }
  },

  createTask: async (input: CreateTaskInput) => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('task:create', input)) as {
        success: boolean;
        result?: Task;
        error?: string;
      };
      if (result.success && result.result) {
        set((state) => ({ tasks: [...state.tasks, result.result!] }));
        return result.result;
      }
      set({ error: result.error ?? 'Failed to create task' });
      return null;
    } catch (error) {
      set({ error: String(error) });
      return null;
    }
  },

  updateTask: async (id: string, changes: Partial<Task>) => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('task:update', id, changes)) as {
        success: boolean;
        result?: Task;
        error?: string;
      };
      if (result.success && result.result) {
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === id ? result.result! : t)),
        }));
      } else {
        set({ error: result.error ?? 'Failed to update task' });
      }
    } catch (error) {
      set({ error: String(error) });
    }
  },

  claimTask: async (taskId: string, employeeId: string) => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('task:claim', taskId, employeeId)) as {
        success: boolean;
        result?: Task;
        error?: string;
      };
      if (result.success && result.result) {
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === taskId ? result.result! : t)),
        }));
      } else {
        set({ error: result.error ?? 'Failed to claim task' });
      }
    } catch (error) {
      set({ error: String(error) });
    }
  },

  completeTask: async (taskId: string, output: string) => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('task:complete', taskId, output)) as {
        success: boolean;
        result?: Task;
        error?: string;
      };
      if (result.success && result.result) {
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === taskId ? result.result! : t)),
        }));
      }
    } catch (error) {
      set({ error: String(error) });
    }
  },

  cancelTask: async (taskId: string) => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('task:cancel', taskId)) as {
        success: boolean;
        result?: Task;
        error?: string;
      };
      if (result.success && result.result) {
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === taskId ? result.result! : t)),
        }));
      }
    } catch (error) {
      set({ error: String(error) });
    }
  },

  rateTask: async (taskId: string, rating: number, feedback?: string) => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('task:rate', taskId, rating, feedback)) as {
        success: boolean;
        error?: string;
      };
      if (result.success) {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === taskId ? { ...t, rating, feedback } : t
          ),
        }));
      } else {
        console.error('Failed to rate task:', result.error);
      }
    } catch (error) {
      console.error('Error rating task:', error);
    }
  },

  createProject: async (input: CreateProjectInput) => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('project:create', input)) as {
        success: boolean;
        result?: Project;
        error?: string;
      };
      if (result.success && result.result) {
        set((state) => ({ projects: [...state.projects, result.result!] }));
        return result.result;
      }
      set({ error: result.error ?? 'Failed to create project' });
      return null;
    } catch (error) {
      set({ error: String(error) });
      return null;
    }
  },

  selectProject: (projectId: string | null) => {
    set({ selectedProjectId: projectId });
  },

  init: () => {
    window.electron.ipcRenderer.on('task:changed', (_event: unknown, task: unknown) => {
      const t = task as Task;
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
