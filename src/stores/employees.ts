/**
 * Employees State Store
 * Manages AI employee instances with real-time status updates.
 *
 * Employees are discovered by scanning installed skill directories.
 * Hiring = skill install + scan, Firing = skill uninstall + scan.
 *
 * Also subscribes to browser-action events from BrowserEventDetector
 * to track which employees are actively using browser automation.
 */
import { create } from 'zustand';
import { ipcSafe } from '@/lib/ipc';
import type { Employee, EmployeeStatus } from '../types/employee';

/** Payload shape for `employee:browser-action` IPC events */
interface BrowserActionPayload {
  employeeId: string;
  action: string;
  params?: { url?: string; ref?: string; text?: string };
  timestamp: number;
  success: boolean | null;
}

/** Payload shape for `employee:browser-session` IPC events */
interface BrowserSessionPayload {
  employeeId: string;
  active: boolean;
}

interface DepsCheckResult {
  satisfied: boolean;
  missing: Array<{ name: string; status: string; message: string }>;
  requires: string[];
}

interface EmployeesState {
  employees: Employee[];
  loading: boolean;
  error: string | null;
  initialized: boolean;

  init: () => void;
  fetchEmployees: () => Promise<void>;
  scanEmployees: () => Promise<void>;
  activateEmployee: (id: string) => Promise<void>;
  deactivateEmployee: (id: string) => Promise<void>;
  checkDeps: (id: string) => Promise<DepsCheckResult | null>;
}

export const useEmployeesStore = create<EmployeesState>((set, get) => ({
  employees: [],
  loading: false,
  error: null,
  initialized: false,

  init: () => {
    if (get().initialized) return;
    set({ initialized: true });

    // Subscribe to real-time employee status changes from main process
    window.electron.ipcRenderer.on('employee:status-changed', (data: unknown) => {
      const { employeeId, status } = data as {
        employeeId: string;
        status: EmployeeStatus;
      };
      set((s) => ({
        employees: s.employees.map((e) =>
          e.id === employeeId ? { ...e, status, updatedAt: Date.now() } : e
        ),
      }));
    });

    // Subscribe to browser action events (individual actions)
    window.electron.ipcRenderer.on('employee:browser-action', (data: unknown) => {
      const payload = data as BrowserActionPayload;
      set((s) => ({
        employees: s.employees.map((e) =>
          e.id === payload.employeeId
            ? {
                ...e,
                browserActive: true,
                lastBrowserAction: {
                  action: payload.action,
                  url: payload.params?.url,
                  timestamp: payload.timestamp,
                },
              }
            : e
        ),
      }));
    });

    // Subscribe to browser session state changes (active/inactive)
    window.electron.ipcRenderer.on('employee:browser-session', (data: unknown) => {
      const payload = data as BrowserSessionPayload;
      set((s) => ({
        employees: s.employees.map((e) =>
          e.id === payload.employeeId
            ? {
                ...e,
                browserActive: payload.active,
                lastBrowserAction: payload.active ? e.lastBrowserAction : undefined,
              }
            : e
        ),
      }));
    });
  },

  fetchEmployees: async () => {
    if (get().employees.length === 0) {
      set({ loading: true, error: null });
    }
    const result = await ipcSafe<Employee[]>('employee:list');
    if (result.ok) {
      set({ employees: result.data ?? [], loading: false });
    } else {
      set({ error: result.error, loading: false });
    }
  },

  scanEmployees: async () => {
    const result = await ipcSafe<Employee[]>('employee:scan');
    if (result.ok) {
      set({ employees: result.data ?? [] });
    } else {
      set({ error: result.error });
    }
  },

  activateEmployee: async (id) => {
    const result = await ipcSafe<Employee>('employee:activate', id);
    if (result.ok && result.data) {
      set((s) => ({
        employees: s.employees.map((e) => (e.id === id ? result.data : e)),
      }));
    } else if (!result.ok) {
      set({ error: result.error });
    }
  },

  deactivateEmployee: async (id) => {
    const result = await ipcSafe<Employee>('employee:deactivate', id);
    if (result.ok && result.data) {
      set((s) => ({
        employees: s.employees.map((e) => (e.id === id ? result.data : e)),
      }));
    }
  },

  checkDeps: async (id) => {
    const result = await ipcSafe<DepsCheckResult>('employee:checkDeps', id);
    return result.ok ? result.data : null;
  },
}));
