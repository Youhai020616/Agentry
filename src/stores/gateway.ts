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
 * We fingerprint events using runId + state + content hash so that true duplicates
 * (same content delivered via both channels with the same state) are caught, while
 * streaming deltas (same runId but progressively longer cumulative content) pass
 * through, AND final events (same content as the last delta but state='final')
 * also pass through.
 *
 * Previous implementation used `runId:seq` which broke streaming when `seq` was
 * missing (common) — the key collapsed to just `runId:` and every delta after
 * the first was dropped as a duplicate.
 */
const recentEventKeys = new Set<string>();
let dedupTimer: ReturnType<typeof setTimeout> | null = null;

/** Simple string hash for dedup fingerprinting (not crypto-grade). */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(36);
}

/** Extract text content from a message object, handling array content blocks. */
function extractContentText(msgObj: Record<string, unknown>): string {
  const raw = msgObj.content ?? msgObj.text ?? msgObj.body;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return (raw as Array<Record<string, unknown>>)
      .map((block) => {
        if (typeof block === 'string') return block;
        return String(block.text ?? block.thinking ?? block.body ?? '');
      })
      .join('');
  }
  if (raw && typeof raw === 'object') {
    return String((raw as Record<string, unknown>).text ?? '');
  }
  return '';
}

function isDuplicateEvent(event: Record<string, unknown>): boolean {
  const runId = event.runId;
  if (!runId) return false; // no key to dedup on — let it through

  // Extract content from the message to build a content-aware fingerprint.
  // This ensures streaming deltas (same runId, growing content) are NOT deduped,
  // while true duplicates (same runId + identical content + same state from dual
  // delivery) ARE caught.
  const msg = event.message;
  const msgObj = msg && typeof msg === 'object' ? (msg as Record<string, unknown>) : {};
  const content = extractContentText(msgObj);
  const contentHash = content ? simpleHash(content) : 'empty';

  // Include state so that the final event (which carries the same cumulative
  // content as the last delta but has state='final') is NOT deduped against it.
  // Also check stopReason on the message itself — some paths infer state from it.
  const state = String(event.state ?? '');
  const stopReason = String(msgObj.stopReason ?? msgObj.stop_reason ?? '');
  const stateTag = state || (stopReason ? 'final' : 'delta');

  const key = `${runId}:${stateTag}:${contentHash}`;

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
    port: 18790,
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
        const payload = notification as
          | { method?: string; params?: Record<string, unknown> }
          | undefined;

        if (
          !payload ||
          payload.method !== 'agent' ||
          !payload.params ||
          typeof payload.params !== 'object'
        ) {
          return;
        }

        const p = payload.params;
        const data =
          p.data && typeof p.data === 'object' ? (p.data as Record<string, unknown>) : {};

        // ── Lifecycle events ────────────────────────────────────────
        // The Gateway signals run completion via:
        //   stream: "lifecycle", data: { phase: "end", endedAt: <ts> }
        // This is the ONLY reliable completion signal — there is no
        // explicit state:"final" or stopReason on the protocol.
        const stream = String(p.stream ?? data.stream ?? '');
        const phase = String(data.phase ?? '');

        if (stream === 'lifecycle' && phase === 'end') {
          const runId = p.runId ?? data.runId;
          const sessionKey = p.sessionKey ?? data.sessionKey;
          console.info(
            `[gateway] lifecycle:end received — runId="${String(runId ?? '').slice(0, 12)}" → synthesizing final event`
          );
          import('./chat')
            .then(({ useChatStore }) => {
              useChatStore.getState().handleChatEvent({
                state: 'final',
                runId,
                sessionKey,
                // No message body — handleChatEvent will promote streamingMessage
              });
            })
            .catch((err) => {
              console.warn('Failed to forward lifecycle:end as final event:', err);
            });
          return;
        }

        const normalizedEvent: Record<string, unknown> = {
          ...data,
          runId: p.runId ?? data.runId,
          sessionKey: p.sessionKey ?? data.sessionKey,
          stream,
          seq: p.seq ?? data.seq,
          state: p.state ?? data.state,
          message: p.message ?? data.message,
        };

        if (!normalizedEvent.state && !normalizedEvent.message) {
          return;
        }

        if (isDuplicateEvent(normalizedEvent)) {
          return;
        }

        import('./chat')
          .then(({ useChatStore }) => {
            useChatStore.getState().handleChatEvent(normalizedEvent);
          })
          .catch((err) => {
            console.warn('Failed to forward gateway notification event:', err);
          });
      });

      // Forward chat protocol events to the chat store.
      // The Gateway sends 'chat' protocol events via handleProtocolEvent which
      // wraps the payload as { message: payload }. The payload itself may or may
      // not contain state/runId fields depending on the OpenClaw protocol version.
      //
      // BUG FIX: Previously, events without a `state` field were blindly marked
      // as 'final', causing streaming deltas to be treated as complete messages.
      // This led to message duplication/overwriting during tool-heavy sessions
      // (e.g., Reddit account nurturing). Now we intelligently infer the state
      // from the message content: stopReason → final, otherwise → delta.
      window.electron.ipcRenderer.on('gateway:chat-message', (data) => {
        import('./chat')
          .then(({ useChatStore }) => {
            const chatData = data as Record<string, unknown>;

            // Unwrap: handleProtocolEvent wraps as { message: payload }
            // but the payload itself might also have a nested message field
            const payload =
              'message' in chatData && typeof chatData.message === 'object'
                ? (chatData.message as Record<string, unknown>)
                : chatData;

            // Case 1: Payload already has an explicit state — use it directly
            if (payload.state) {
              if (isDuplicateEvent(payload)) return;
              useChatStore.getState().handleChatEvent(payload);
              return;
            }

            // Case 2: No explicit state — intelligently infer from message content
            // instead of blindly marking everything as 'final'
            const msgObj =
              payload.message && typeof payload.message === 'object'
                ? (payload.message as Record<string, unknown>)
                : payload;

            // Detect if this is a final message by checking for stop indicators
            const stopReason = msgObj.stopReason ?? msgObj.stop_reason;
            const hasError = !!(msgObj.errorMessage || stopReason === 'error');
            const isFinal = !!stopReason || hasError;

            const syntheticEvent: Record<string, unknown> = {
              state: isFinal ? 'final' : 'delta',
              message: payload.message ?? payload,
              runId: chatData.runId ?? payload.runId ?? msgObj.runId,
              sessionKey: chatData.sessionKey ?? payload.sessionKey ?? msgObj.sessionKey,
              seq: chatData.seq ?? payload.seq ?? msgObj.seq,
            };

            if (isDuplicateEvent(syntheticEvent)) return;
            useChatStore.getState().handleChatEvent(syntheticEvent);
          })
          .catch((err) => {
            console.warn('Failed to forward chat event:', err);
          });
      });

      // Fetch initial gateway status. This may fail if the main process
      // hasn't registered IPC handlers yet (race condition during startup).
      // In that case we rely on the status-changed event listener above.
      try {
        const status = (await window.electron.ipcRenderer.invoke(
          'gateway:status'
        )) as GatewayStatus;
        set({ status, isInitialized: true });
      } catch (error) {
        console.warn('Initial gateway status fetch failed (will update via events):', error);
      }

      // Mark initialized even if initial fetch failed — listeners are active.
      set({ isInitialized: true });
    })();

    await gatewayInitPromise;
    // Clear the promise AFTER the await resolves — prevents a race where a
    // concurrent caller sees gatewayInitPromise as null (cleared inside the IIFE)
    // while this outer await hasn't yet returned, potentially allowing duplicate
    // event listener registration.
    gatewayInitPromise = null;
  },

  start: async () => {
    try {
      set({ status: { ...get().status, state: 'starting' }, lastError: null });
      const result = (await window.electron.ipcRenderer.invoke('gateway:start')) as {
        success: boolean;
        error?: string;
      };

      if (!result.success) {
        set({
          status: { ...get().status, state: 'error', error: result.error },
          lastError: result.error || 'Failed to start Gateway',
        });
      }
    } catch (error) {
      set({
        status: { ...get().status, state: 'error', error: String(error) },
        lastError: String(error),
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
      const result = (await window.electron.ipcRenderer.invoke('gateway:restart')) as {
        success: boolean;
        error?: string;
      };

      if (!result.success) {
        set({
          status: { ...get().status, state: 'error', error: result.error },
          lastError: result.error || 'Failed to restart Gateway',
        });
      }
    } catch (error) {
      set({
        status: { ...get().status, state: 'error', error: String(error) },
        lastError: String(error),
      });
    }
  },

  checkHealth: async () => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('gateway:health')) as {
        success: boolean;
        ok: boolean;
        error?: string;
        uptime?: number;
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
    const result = (await window.electron.ipcRenderer.invoke(
      'gateway:rpc',
      method,
      params,
      timeoutMs
    )) as {
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
