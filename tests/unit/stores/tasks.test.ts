/**
 * Tasks Store Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTasksStore } from '@/stores/tasks';
import { act } from '@testing-library/react';
import type { Task } from '@/types/task';

/** Helper to build a minimal valid Task object */
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    projectId: 'p1',
    subject: 'Test task',
    description: 'Do something',
    status: 'completed',
    owner: null,
    assignedBy: 'user',
    blockedBy: [],
    blocks: [],
    priority: 'medium',
    requiresApproval: false,
    plan: null,
    planStatus: 'none',
    planFeedback: null,
    output: null,
    outputFiles: [],
    tokensUsed: 0,
    creditsConsumed: 0,
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
    estimatedDuration: 0,
    wave: 0,
    ...overrides,
  };
}

describe('useTasksStore', () => {
  beforeEach(() => {
    useTasksStore.setState({
      tasks: [],
      projects: [],
      loading: false,
      error: null,
      selectedProjectId: null,
    });
    vi.clearAllMocks();
  });

  describe('fetchTasks', () => {
    it('should fetch tasks and update state', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
        success: true,
        result: [],
      });

      await act(async () => {
        await useTasksStore.getState().fetchTasks();
      });

      const state = useTasksStore.getState();
      expect(state.tasks).toEqual([]);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should handle IPC error response', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
        success: false,
        error: 'Failed to fetch tasks',
      });

      await act(async () => {
        await useTasksStore.getState().fetchTasks();
      });

      const state = useTasksStore.getState();
      expect(state.error).toBe('Failed to fetch tasks');
      expect(state.loading).toBe(false);
    });

    it('should handle thrown error', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockRejectedValueOnce(
        new Error('Network error'),
      );

      await act(async () => {
        await useTasksStore.getState().fetchTasks();
      });

      const state = useTasksStore.getState();
      expect(state.error).toContain('Network error');
      expect(state.loading).toBe(false);
    });

    it('should set loading true when tasks list is empty', async () => {
      let loadingDuringFetch = false;

      vi.mocked(window.electron.ipcRenderer.invoke).mockImplementationOnce(async () => {
        loadingDuringFetch = useTasksStore.getState().loading;
        return { success: true, result: [] };
      });

      await act(async () => {
        await useTasksStore.getState().fetchTasks();
      });

      expect(loadingDuringFetch).toBe(true);
    });

    it('should not set loading when tasks already populated', async () => {
      useTasksStore.setState({
        tasks: [makeTask()],
      });

      let loadingDuringFetch = false;

      vi.mocked(window.electron.ipcRenderer.invoke).mockImplementationOnce(async () => {
        loadingDuringFetch = useTasksStore.getState().loading;
        return { success: true, result: [] };
      });

      await act(async () => {
        await useTasksStore.getState().fetchTasks();
      });

      expect(loadingDuringFetch).toBe(false);
    });
  });
});
