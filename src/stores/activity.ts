/**
 * Activity State Store
 * Manages the activity feed timeline — fetches historical events
 * and prepends real-time events from IPC subscriptions.
 */
import { create } from 'zustand';

export interface ActivityEvent {
  id: string;
  type: 'task' | 'credits' | 'employee' | 'system' | 'delegation';
  action: string;
  title: string;
  employeeId?: string;
  employeeName?: string;
  taskId?: string;
  amount?: number;
  timestamp: number;
  meta?: Record<string, unknown>;
}

interface ActivityState {
  events: ActivityEvent[];
  loading: boolean;
  hasMore: boolean;
  error: string | null;
  /** Whether init() has been called (prevents duplicate IPC listeners) */
  initialized: boolean;

  /** Initial load */
  fetchEvents: () => Promise<void>;

  /** Load older events (infinite scroll) */
  loadMore: () => Promise<void>;

  /** Prepend a real-time event */
  prependEvent: (event: ActivityEvent) => void;

  /** Subscribe to real-time IPC events */
  init: () => void;
}

const PAGE_SIZE = 50;

export const useActivityStore = create<ActivityState>((set, get) => ({
  events: [],
  loading: false,
  hasMore: true,
  error: null,
  initialized: false,

  fetchEvents: async () => {
    set({ loading: true, error: null });
    try {
      const result = (await window.electron.ipcRenderer.invoke('activity:list', {
        limit: PAGE_SIZE,
      })) as {
        success: boolean;
        result?: ActivityEvent[];
        error?: string;
      };
      if (result.success) {
        const events = result.result ?? [];
        set({
          events,
          hasMore: events.length >= PAGE_SIZE,
          loading: false,
        });
      } else {
        set({ error: result.error ?? 'Unknown error', loading: false });
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  loadMore: async () => {
    const { events, loading, hasMore } = get();
    if (loading || !hasMore) return;

    set({ loading: true });
    try {
      const oldest = events[events.length - 1];
      const result = (await window.electron.ipcRenderer.invoke('activity:list', {
        limit: PAGE_SIZE,
        before: oldest?.timestamp,
      })) as {
        success: boolean;
        result?: ActivityEvent[];
        error?: string;
      };
      if (result.success) {
        const newEvents = result.result ?? [];
        set({
          events: [...events, ...newEvents],
          hasMore: newEvents.length >= PAGE_SIZE,
          loading: false,
        });
      } else {
        set({ loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },

  prependEvent: (event: ActivityEvent) => {
    set((state) => ({
      events: [event, ...state.events],
    }));
  },

  init: () => {
    if (get().initialized) return;
    set({ initialized: true });

    const { prependEvent } = get();

    // Employee status changes
    window.electron.ipcRenderer.on('employee:status-changed', (...args: unknown[]) => {
      const data = args[0] as { employeeId?: string; status?: string; name?: string };
      if (!data?.employeeId || !data?.status) return;

      prependEvent({
        id: `employee-${data.employeeId}-${Date.now()}`,
        type: 'employee',
        action: data.status,
        title: data.status,
        employeeId: data.employeeId,
        employeeName: data.name,
        timestamp: Date.now(),
      });
    });

    // Task changes
    window.electron.ipcRenderer.on('task:changed', (...args: unknown[]) => {
      const task = args[0] as {
        id?: string;
        subject?: string;
        status?: string;
        owner?: string;
        completedAt?: number;
        startedAt?: number;
      };
      if (!task?.id) return;

      let action = 'created';
      if (task.status === 'completed') action = 'completed';
      else if (task.status === 'in_progress') action = 'claimed';

      prependEvent({
        id: `task-${action}-${task.id}-${Date.now()}`,
        type: 'task',
        action,
        title: task.subject ?? '',
        employeeId: task.owner ?? undefined,
        taskId: task.id,
        timestamp: task.completedAt ?? task.startedAt ?? Date.now(),
      });
    });

    // Gateway status changes
    window.electron.ipcRenderer.on('gateway:status-changed', (...args: unknown[]) => {
      const data = args[0] as { status?: string };
      if (!data?.status) return;

      prependEvent({
        id: `gateway-${Date.now()}`,
        type: 'system',
        action: data.status,
        title: data.status,
        timestamp: Date.now(),
      });
    });

    // Note: Legacy supervisor:delegation-* events have been removed (Phase 5).
    // Delegation is now handled natively by the Supervisor agent via `sessions_spawn`.
    // Sub-agent results are announced back through the Gateway — no engine-side routing needed.
  },
}));
