/**
 * Chat Message IPC Handlers
 */
import { ipcMain } from 'electron';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';

export function register({ engineRef, gatewayManager }: IpcContext): void {
  const getMessageStore = async () => {
    if (!engineRef.current) throw new Error('Engine not initialized');
    const lazy = await engineRef.current.getLazy(gatewayManager);
    return lazy.messageStore;
  };

  // chatMessage:save — Save a single message to local SQLite store
  ipcMain.handle(
    'chatMessage:save',
    async (
      _,
      input: {
        id: string;
        sessionKey: string;
        role: string;
        content: string;
        timestamp?: number;
        runId?: string;
        providerId?: string;
        model?: string;
        stopReason?: string;
        toolCalls?: unknown[];
        attachedFiles?: unknown[];
        raw?: Record<string, unknown>;
      }
    ) => {
      try {
        const store = await getMessageStore();
        const message = store.save(input);
        return { success: true, result: message };
      } catch (error) {
        logger.error('chatMessage:save failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // chatMessage:list — List messages for a session from local store
  ipcMain.handle(
    'chatMessage:list',
    async (_, params: { sessionKey: string; limit?: number; offset?: number }) => {
      try {
        const store = await getMessageStore();
        const messages = store.listBySession(
          params.sessionKey,
          params.limit ?? 200,
          params.offset ?? 0
        );
        return { success: true, result: messages };
      } catch (error) {
        logger.error('chatMessage:list failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // chatMessage:sync — Sync messages from Gateway history into local store
  ipcMain.handle('chatMessage:sync', async (_, params: { sessionKey: string }) => {
    try {
      const store = await getMessageStore();

      // Fetch current history from Gateway
      const result = await gatewayManager.rpc<Record<string, unknown>>('chat.history', {
        sessionKey: params.sessionKey,
        limit: 500,
      });

      const data = result as Record<string, unknown>;
      const rawMessages = (data?.messages ?? data?.history ?? []) as Array<Record<string, unknown>>;

      if (rawMessages.length === 0) {
        return {
          success: true,
          result: { synced: 0, total: store.countBySession(params.sessionKey) },
        };
      }

      const synced = store.syncFromGateway(params.sessionKey, rawMessages);
      const total = store.countBySession(params.sessionKey);

      return { success: true, result: { synced, total } };
    } catch (error) {
      logger.error('chatMessage:sync failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // chatMessage:clear — Delete all messages for a session from local store
  ipcMain.handle('chatMessage:clear', async (_, sessionKey: string) => {
    try {
      const store = await getMessageStore();
      const deleted = store.clearSession(sessionKey);
      return { success: true, result: { deleted } };
    } catch (error) {
      logger.error('chatMessage:clear failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // chatMessage:count — Count messages for a session in local store
  ipcMain.handle('chatMessage:count', async (_, sessionKey: string) => {
    try {
      const store = await getMessageStore();
      const count = store.countBySession(sessionKey);
      return { success: true, result: count };
    } catch (error) {
      logger.error('chatMessage:count failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // chatMessage:listSessions — List all sessions with stored messages
  ipcMain.handle('chatMessage:listSessions', async () => {
    try {
      const store = await getMessageStore();
      const sessions = store.listSessionMeta();
      return { success: true, result: sessions };
    } catch (error) {
      logger.error('chatMessage:listSessions failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // Auto-persist incoming Gateway chat events to local store
  gatewayManager.on('chat:message', async (eventData: { message: unknown }) => {
    try {
      const store = await getMessageStore();
      const msg = eventData.message as Record<string, unknown>;
      if (!msg) return;

      // Extract session key from the event
      const sessionKey = (msg.sessionKey ?? msg.session ?? '') as string;
      if (!sessionKey) return;

      // Only persist final/complete messages (not streaming deltas)
      const state = (msg.state ?? msg.status) as string | undefined;
      if (state === 'delta' || state === 'streaming') return;

      const role = (msg.role ?? 'assistant') as string;
      let content = '';
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = (msg.content as Array<{ type?: string; text?: string }>)
          .filter((b) => b.type === 'text' || !b.type)
          .map((b) => b.text ?? '')
          .join('\n');
      }

      // Skip empty messages
      if (!content && role !== 'tool') return;

      const id =
        (msg.id as string) ??
        (msg.providerId as string) ??
        `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      store.save({
        id,
        sessionKey,
        role,
        content,
        timestamp: (msg.timestamp as number) ?? Date.now(),
        runId: msg.runId as string | undefined,
        providerId: msg.providerId as string | undefined,
        model: msg.model as string | undefined,
        stopReason: msg.stopReason as string | undefined,
        toolCalls: msg.toolCalls as unknown[] | undefined,
        attachedFiles: (msg._attachedFiles ?? msg.attachedFiles) as unknown[] | undefined,
        raw: msg,
      });
    } catch (err) {
      // Non-fatal — message persistence is a cache layer
      logger.debug(`Failed to auto-persist chat message: ${err}`);
    }
  });
}
