/**
 * Star Office Store
 * Manages Star Office UI state in the renderer process
 */
import { create } from 'zustand';

export type StarOfficeState = 'stopped' | 'starting' | 'running' | 'error';

interface StarOfficeStatus {
  state: StarOfficeState;
  port: number;
  pid?: number;
  url?: string;
  error?: string;
}

interface StarOfficeStore {
  status: StarOfficeStatus;
  initialized: boolean;

  /** Initialize store and subscribe to IPC events */
  init: () => void;

  /** Start Star Office backend */
  start: () => Promise<void>;

  /** Stop Star Office backend */
  stop: () => Promise<void>;

  /** Restart Star Office backend */
  restart: () => Promise<void>;

  /** Fetch current status */
  fetchStatus: () => Promise<void>;

  /** Get the Star Office URL */
  getUrl: () => Promise<string | null>;
}

export const useStarOfficeStore = create<StarOfficeStore>((set, get) => ({
  status: { state: 'stopped', port: 19000 },
  initialized: false,

  init: () => {
    if (get().initialized) return;

    // Remove any stale listeners first (HMR safety — previous init may have left orphans)
    window.electron.ipcRenderer.off('star-office:status-changed');

    // Subscribe to status changes from main process
    window.electron.ipcRenderer.on(
      'star-office:status-changed',
      (data: unknown) => {
        const status = data as StarOfficeStatus;
        set({ status });
      }
    );

    // Fetch initial status
    void get().fetchStatus();
    set({ initialized: true });
  },

  start: async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('star-office:start');
      const { success, error } = result as { success: boolean; error?: string };
      if (!success) {
        console.error('Star Office start failed:', error);
      }
    } catch (error) {
      console.error('Star Office start error:', error);
    }
  },

  stop: async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('star-office:stop');
      const { success, error } = result as { success: boolean; error?: string };
      if (!success) {
        console.error('Star Office stop failed:', error);
      }
    } catch (error) {
      console.error('Star Office stop error:', error);
    }
  },

  restart: async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('star-office:restart');
      const { success, error } = result as { success: boolean; error?: string };
      if (!success) {
        console.error('Star Office restart failed:', error);
      }
    } catch (error) {
      console.error('Star Office restart error:', error);
    }
  },

  fetchStatus: async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('star-office:status');
      const { success, result: status } = result as {
        success: boolean;
        result?: StarOfficeStatus;
      };
      if (success && status) {
        set({ status });
      }
    } catch (error) {
      console.error('Star Office fetchStatus error:', error);
    }
  },

  getUrl: async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('star-office:get-url');
      const { success, result: url } = result as { success: boolean; result?: string };
      if (success) return url ?? null;
      return null;
    } catch {
      return null;
    }
  },
}));

