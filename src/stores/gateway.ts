/**
 * Gateway State Store
 * Manages Gateway connection state and communication
 */
import { create } from 'zustand';
import type { GatewayStatus } from '../types/gateway';

let gatewayInitPromise: Promise<void> | null = null;

/**
 * Dedup: The Gateway may deliver the same streaming event through both the
 * `gateway:notification` (agent) and `gateway:chat-message` (protocol) channels.
 * Track recently seen runId:seq pairs so handleChatEvent is only called once.
 */
const recentEventKeys = new Set<string>();
let dedupTimer: ReturnType<typeof setTimeout> | null = null;

function isDuplicateEvent(event: Record<string, unknown>): boolean {
  const runId = event.runId;
  const seq = event.seq;
  if (!runId) return false; // no key to dedup on — let it through

  const key = `${runId}:${seq ?? ''}`;
  if (recentEventKeys.has(key)) return true;

  recentEventKeys.add(key);
  // Periodically clear to prevent memory leak
  if (!dedupTimer) {
    dedupTimer = setTimeout(() => {
      recentEventKeys.clear();
      dedupTimer = null;
    }, 5000);
  }
  return false;
}

interface GatewayHealth {
  ok: boolean;
  error?: string;
  uptime?: number;
}

interface GatewayState {
  status: GatewayStatus;
  health: GatewayHealth | null;
  isInitialized: boolean;
  lastError: string | null;

  // Actions
  init: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  checkHealth: () => Promise<GatewayHealth>;
  rpc: <T>(method: string, params?: unknown, timeoutMs?: number) => Promise<T>;
  setStatus: (status: GatewayStatus) => void;
  clearError: () => void;
}

export const useGatewayStore = create<GatewayState>((set, get) => ({
  status: {
    state: 'stopped',
    port: 18789,
  },
  health: null,
  isInitialized: false,
  lastError: null,

  init: async () => {
    if (get().isInitialized) return;
    if (gatewayInitPromise) {
      await gatewayInitPromise;
      return;
    }

    gatewayInitPromise = (async () => {
      // Register event listeners UNCONDITIONALLY before any async work.
      // This ensures we receive status updates even if the initial status
      // fetch fails (e.g. due to IPC handlers not yet registered during
      // the main-process bootstrap race window).
      window.electron.ipcRenderer.on('gateway:status-changed', (newStatus) => {
        set({ status: newStatus as GatewayStatus, isInitialized: true });
      });

      window.electron.ipcRenderer.on('gateway:error', (error) => {
        set({ lastError: String(error) });
      });

      // Forward agent notification events to the chat store.
      window.electron.ipcRenderer.on('gateway:notification', (notification) => {
        const payload = notification as { method?: string; params?: Record<string, unknown> } | undefined;
        if (!payload || payload.method !== 'agent' || !payload.params || typeof payload.params !== 'object') {
          return;
        }

        const p = payload.params;
        const data = (p.data && typeof p.data === 'object') ? (p.data as Record<string, unknown>) : {};
        const normalizedEvent: Record<string, unknown> = {
          ...data,
          runId: p.runId ?? data.runId,
          sessionKey: p.sessionKey ?? data.sessionKey,
          stream: p.stream ?? data.stream,
          seq: p.seq ?? data.seq,
          state: p.state ?? data.state,
          message: p.message ?? data.message,
        };

        if (!normalizedEvent.state && !normalizedEvent.message) {
          return;
        }

        if (isDuplicateEvent(normalizedEvent)) return;

        import('./chat')
          .then(({ useChatStore }) => {
            useChatStore.getState().handleChatEvent(normalizedEvent);
          })
          .catch((err) => {
            console.warn('Failed to forward gateway notification event:', err);
          });
      });

      // Forward chat protocol events to the chat store.
      window.electron.ipcRenderer.on('gateway:chat-message', (data) => {
        try {
          import('./chat').then(({ useChatStore }) => {
            const chatData = data as Record<string, unknown>;
            const payload = ('message' in chatData && typeof chatData.message === 'object')
              ? chatData.message as Record<string, unknown>
              : chatData;

            if (payload.state) {
              if (isDuplicateEvent(payload)) return;
              useChatStore.getState().handleChatEvent(payload);
              return;
            }

            const syntheticEvent: Record<string, unknown> = {
              state: 'final',
              message: payload,
              runId: chatData.runId ?? payload.runId,
            };
            if (isDuplicateEvent(syntheticEvent)) return;
            useChatStore.getState().handleChatEvent(syntheticEvent);
          });
        } catch (err) {
          console.warn('Failed to forward chat event:', err);
        }
      });

      // Fetch initial gateway status. This may fail if the main process
      // hasn't registered IPC handlers yet (race condition during startup).
      // In that case we rely on the status-changed event listener above.
      try {
        const status = await window.electron.ipcRenderer.invoke('gateway:status') as GatewayStatus;
        set({ status, isInitialized: true });
      } catch (error) {
        console.warn('Initial gateway status fetch failed (will update via events):', error);
      }

      // Mark initialized even if initial fetch failed — listeners are active.
      set({ isInitialized: true });
      gatewayInitPromise = null;
    })();

    await gatewayInitPromise;
  },

  start: async () => {
    try {
      set({ status: { ...get().status, state: 'starting' }, lastError: null });
      const result = await window.electron.ipcRenderer.invoke('gateway:start') as { success: boolean; error?: string };

      if (!result.success) {
        set({
          status: { ...get().status, state: 'error', error: result.error },
          lastError: result.error || 'Failed to start Gateway'
        });
      }
    } catch (error) {
      set({
        status: { ...get().status, state: 'error', error: String(error) },
        lastError: String(error)
      });
    }
  },

  stop: async () => {
    try {
      await window.electron.ipcRenderer.invoke('gateway:stop');
      set({ status: { ...get().status, state: 'stopped' }, lastError: null });
    } catch (error) {
      console.error('Failed to stop Gateway:', error);
      set({ lastError: String(error) });
    }
  },

  restart: async () => {
    try {
      set({ status: { ...get().status, state: 'starting' }, lastError: null });
      const result = await window.electron.ipcRenderer.invoke('gateway:restart') as { success: boolean; error?: string };

      if (!result.success) {
        set({
          status: { ...get().status, state: 'error', error: result.error },
          lastError: result.error || 'Failed to restart Gateway'
        });
      }
    } catch (error) {
      set({
        status: { ...get().status, state: 'error', error: String(error) },
        lastError: String(error)
      });
    }
  },

  checkHealth: async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('gateway:health') as {
        success: boolean;
        ok: boolean;
        error?: string;
        uptime?: number
      };

      const health: GatewayHealth = {
        ok: result.ok,
        error: result.error,
        uptime: result.uptime,
      };

      set({ health });
      return health;
    } catch (error) {
      const health: GatewayHealth = { ok: false, error: String(error) };
      set({ health });
      return health;
    }
  },

  rpc: async <T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> => {
    const result = await window.electron.ipcRenderer.invoke('gateway:rpc', method, params, timeoutMs) as {
      success: boolean;
      result?: T;
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error || `RPC call failed: ${method}`);
    }

    return result.result as T;
  },

  setStatus: (status) => set({ status }),

  clearError: () => set({ lastError: null }),
}));
