/**
 * Browser Automation Store
 * Zustand store for managing browser automation state.
 * Communicates with Main process via IPC `browser:*` channels.
 */
import { create } from 'zustand';
import type {
  BrowserStatus,
  BrowserState,
  BrowserSnapshot,
  BrowserScreenshot,
  BrowserError,
  BrowserRequest,
  BrowserAction,
  BrowserTraceResult,
  SnapshotFormat,
} from '@/types/browser';

// ── Store Interface ────────────────────────────────────────────────

interface BrowserStore {
  // ── State ──────────────────────────────────────────────────────
  /** Current browser lifecycle status */
  status: BrowserStatus;
  /** Current page URL */
  currentUrl: string | null;
  /** Active browser profile */
  profile: string | null;
  /** Last snapshot taken */
  snapshot: BrowserSnapshot | null;
  /** Last screenshot taken */
  screenshot: BrowserScreenshot | null;
  /** Console errors from the browser */
  errors: BrowserError[];
  /** Network requests from the browser */
  requests: BrowserRequest[];
  /** Action history timeline */
  actionHistory: BrowserAction[];
  /** Whether a trace recording is active */
  traceActive: boolean;
  /** Last trace result */
  traceResult: BrowserTraceResult | null;
  /** Available browser profiles */
  profiles: string[];
  /** Whether an async operation is in progress */
  loading: boolean;
  /** Which specific operation is loading (for granular UI feedback) */
  loadingAction: string | null;
  /** Last error message */
  error: string | null;
  /** Whether the event listener has been initialized */
  _listenerInitialized: boolean;

  // ── Actions ────────────────────────────────────────────────────

  /** Initialize event listeners for status changes from Main process */
  init: () => void;

  /** Start the managed browser */
  startBrowser: (profile?: string) => Promise<void>;

  /** Stop the managed browser */
  stopBrowser: () => Promise<void>;

  /** Refresh the browser status from Main process */
  refreshStatus: () => Promise<void>;

  /** Navigate to a URL */
  navigate: (url: string) => Promise<void>;

  /** Take a page snapshot */
  takeSnapshot: (format?: SnapshotFormat, options?: { labels?: boolean; selector?: string }) => Promise<void>;

  /** Take a visual screenshot */
  takeScreenshot: (fullPage?: boolean) => Promise<void>;

  /** Click an element by ref */
  clickElement: (ref: string) => Promise<void>;

  /** Type text into an element */
  typeText: (ref: string, text: string, clear?: boolean) => Promise<void>;

  /** Scroll the page */
  scrollPage: (direction: 'up' | 'down' | 'left' | 'right', amount?: number) => Promise<void>;

  /** Highlight an element */
  highlightElement: (ref: string) => Promise<void>;

  /** Fetch console errors */
  fetchErrors: (clear?: boolean) => Promise<void>;

  /** Fetch network requests */
  fetchRequests: (filter?: string, clear?: boolean) => Promise<void>;

  /** Start trace recording */
  startTrace: () => Promise<void>;

  /** Stop trace recording */
  stopTrace: () => Promise<void>;

  /** Fetch available profiles */
  fetchProfiles: () => Promise<void>;

  /** Fetch action history from Main process */
  fetchHistory: () => Promise<void>;

  /** Clear the last error */
  clearError: () => void;

  /** Clear the snapshot */
  clearSnapshot: () => void;

  /** Clear the screenshot */
  clearScreenshot: () => void;

  /** Reset all state (e.g., on browser stop) */
  reset: () => void;
}

// ── IPC Result Type ────────────────────────────────────────────────

interface IpcResult<T = unknown> {
  success: boolean;
  result?: T;
  error?: string;
}

// ── Helper ─────────────────────────────────────────────────────────

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await window.electron.ipcRenderer.invoke(channel, ...args)) as IpcResult<T>;
  if (!result.success) {
    throw new Error(result.error || `IPC call failed: ${channel}`);
  }
  return result.result as T;
}

// ── Initial State ──────────────────────────────────────────────────

const initialState = {
  status: 'idle' as BrowserStatus,
  currentUrl: null as string | null,
  profile: null as string | null,
  snapshot: null as BrowserSnapshot | null,
  screenshot: null as BrowserScreenshot | null,
  errors: [] as BrowserError[],
  requests: [] as BrowserRequest[],
  actionHistory: [] as BrowserAction[],
  traceActive: false,
  traceResult: null as BrowserTraceResult | null,
  profiles: [] as string[],
  loading: false,
  loadingAction: null as string | null,
  error: null as string | null,
  _listenerInitialized: false,
};

// ── Store ──────────────────────────────────────────────────────────

export const useBrowserStore = create<BrowserStore>((set, get) => ({
  ...initialState,

  init: () => {
    if (get()._listenerInitialized) return;

    // Listen for browser status changes from Main process
    window.electron.ipcRenderer.on('browser:status-changed', (...args: unknown[]) => {
      const state = args[0] as BrowserState | undefined;
      if (state) {
        set({
          status: state.status,
          currentUrl: state.url ?? get().currentUrl,
          profile: state.profile ?? get().profile,
          error: state.error ?? null,
        });
      }
    });

    set({ _listenerInitialized: true });
  },

  startBrowser: async (profile?: string) => {
    set({ loading: true, loadingAction: 'start', error: null });
    try {
      const state = await invoke<BrowserState>('browser:start', { profile });
      set({
        status: state.status,
        currentUrl: state.url ?? null,
        profile: state.profile ?? profile ?? null,
        loading: false,
        loadingAction: null,
      });
    } catch (error) {
      set({
        error: String(error),
        loading: false,
        loadingAction: null,
      });
    }
  },

  stopBrowser: async () => {
    set({ loading: true, loadingAction: 'stop', error: null });
    try {
      await invoke<void>('browser:stop');
      set({
        ...initialState,
        _listenerInitialized: get()._listenerInitialized,
        profiles: get().profiles,
      });
    } catch (error) {
      set({
        error: String(error),
        loading: false,
        loadingAction: null,
      });
    }
  },

  refreshStatus: async () => {
    try {
      const state = await invoke<BrowserState>('browser:status');
      set({
        status: state.status,
        currentUrl: state.url ?? get().currentUrl,
        profile: state.profile ?? get().profile,
        error: state.error ?? null,
      });
    } catch (error) {
      set({ error: String(error) });
    }
  },

  navigate: async (url: string) => {
    set({ loading: true, loadingAction: 'navigate', error: null });
    try {
      await invoke<void>('browser:open', { url });
      set({
        currentUrl: url,
        loading: false,
        loadingAction: null,
      });
    } catch (error) {
      set({
        error: String(error),
        loading: false,
        loadingAction: null,
      });
    }
  },

  takeSnapshot: async (
    format?: SnapshotFormat,
    options?: { labels?: boolean; selector?: string }
  ) => {
    set({ loading: true, loadingAction: 'snapshot', error: null });
    try {
      const snapshot = await invoke<BrowserSnapshot>('browser:snapshot', {
        format,
        ...options,
      });
      set({
        snapshot,
        currentUrl: snapshot.url || get().currentUrl,
        loading: false,
        loadingAction: null,
      });
    } catch (error) {
      set({
        error: String(error),
        loading: false,
        loadingAction: null,
      });
    }
  },

  takeScreenshot: async (fullPage?: boolean) => {
    set({ loading: true, loadingAction: 'screenshot', error: null });
    try {
      const screenshot = await invoke<BrowserScreenshot>('browser:screenshot', { fullPage });
      set({
        screenshot,
        loading: false,
        loadingAction: null,
      });
    } catch (error) {
      set({
        error: String(error),
        loading: false,
        loadingAction: null,
      });
    }
  },

  clickElement: async (ref: string) => {
    set({ loading: true, loadingAction: 'click', error: null });
    try {
      await invoke<void>('browser:click', { ref });
      set({ loading: false, loadingAction: null });
    } catch (error) {
      set({
        error: String(error),
        loading: false,
        loadingAction: null,
      });
    }
  },

  typeText: async (ref: string, text: string, clear?: boolean) => {
    set({ loading: true, loadingAction: 'type', error: null });
    try {
      await invoke<void>('browser:type', { ref, text, clear });
      set({ loading: false, loadingAction: null });
    } catch (error) {
      set({
        error: String(error),
        loading: false,
        loadingAction: null,
      });
    }
  },

  scrollPage: async (direction: 'up' | 'down' | 'left' | 'right', amount?: number) => {
    set({ loading: true, loadingAction: 'scroll', error: null });
    try {
      await invoke<void>('browser:scroll', { direction, amount });
      set({ loading: false, loadingAction: null });
    } catch (error) {
      set({
        error: String(error),
        loading: false,
        loadingAction: null,
      });
    }
  },

  highlightElement: async (ref: string) => {
    set({ loading: true, loadingAction: 'highlight', error: null });
    try {
      await invoke<void>('browser:highlight', { ref });
      set({ loading: false, loadingAction: null });
    } catch (error) {
      set({
        error: String(error),
        loading: false,
        loadingAction: null,
      });
    }
  },

  fetchErrors: async (clear?: boolean) => {
    try {
      const errors = await invoke<BrowserError[]>('browser:errors', { clear });
      set({ errors: errors ?? [] });
    } catch (error) {
      set({ error: String(error) });
    }
  },

  fetchRequests: async (filter?: string, clear?: boolean) => {
    try {
      const requests = await invoke<BrowserRequest[]>('browser:requests', { filter, clear });
      set({ requests: requests ?? [] });
    } catch (error) {
      set({ error: String(error) });
    }
  },

  startTrace: async () => {
    set({ loading: true, loadingAction: 'trace_start', error: null });
    try {
      await invoke<void>('browser:trace:start');
      set({
        traceActive: true,
        traceResult: null,
        loading: false,
        loadingAction: null,
      });
    } catch (error) {
      set({
        error: String(error),
        loading: false,
        loadingAction: null,
      });
    }
  },

  stopTrace: async () => {
    set({ loading: true, loadingAction: 'trace_stop', error: null });
    try {
      const result = await invoke<BrowserTraceResult>('browser:trace:stop');
      set({
        traceActive: false,
        traceResult: result,
        loading: false,
        loadingAction: null,
      });
    } catch (error) {
      set({
        error: String(error),
        loading: false,
        loadingAction: null,
      });
    }
  },

  fetchProfiles: async () => {
    try {
      const profiles = await invoke<string[]>('browser:profiles');
      set({ profiles: profiles ?? [] });
    } catch {
      // Non-critical — fall back to empty
      set({ profiles: [] });
    }
  },

  fetchHistory: async () => {
    try {
      const history = await invoke<BrowserAction[]>('browser:history');
      set({ actionHistory: history ?? [] });
    } catch {
      // Non-critical
    }
  },

  clearError: () => set({ error: null }),

  clearSnapshot: () => set({ snapshot: null }),

  clearScreenshot: () => set({ screenshot: null }),

  reset: () =>
    set({
      ...initialState,
      _listenerInitialized: get()._listenerInitialized,
      profiles: get().profiles,
    }),
}));
