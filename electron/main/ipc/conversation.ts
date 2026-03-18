/**
 * Conversation IPC Handlers
 */
import { ipcMain } from 'electron';
import crypto from 'node:crypto';
import { logger } from '../../utils/logger';
import { getStore } from '../../utils/store-factory';
import type { IpcContext } from './types';


// ---------------------------------------------------------------------------
// Conversation (Chat History) Handlers
// ---------------------------------------------------------------------------

interface ConversationRecord {
  id: string;
  title: string;
  sessionKey: string;
  participantType: 'supervisor' | 'employee';
  employeeId?: string;
  employeeName?: string;
  employeeAvatar?: string;
  createdAt: number;
  updatedAt: number;
  lastMessagePreview?: string;
  messageCount: number;
  pinned: boolean;
  archived: boolean;
}

async function getConversationStore() {
  return getStore('agentry-conversations', { defaults: { conversations: [] } });
}

export function register(_ctx: IpcContext): void {
  // conversation:listAll — get all conversations (raw, for the renderer to filter)
  ipcMain.handle('conversation:listAll', async () => {
    try {
      const store = await getConversationStore();
      const conversations: ConversationRecord[] = (store.get('conversations', []) as ConversationRecord[]) as ConversationRecord[];
      return { success: true, result: conversations };
    } catch (error) {
      logger.error('conversation:listAll failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // conversation:list — get conversations with optional filter
  ipcMain.handle(
    'conversation:list',
    async (
      _,
      filter?: {
        participantType?: string;
        employeeId?: string;
        includeArchived?: boolean;
        search?: string;
        limit?: number;
      }
    ) => {
      try {
        const store = await getConversationStore();
        let conversations: ConversationRecord[] = (store.get('conversations', []) as ConversationRecord[]) as ConversationRecord[];

        if (filter) {
          if (filter.participantType) {
            conversations = conversations.filter(
              (c) => c.participantType === filter.participantType
            );
          }
          if (filter.employeeId) {
            conversations = conversations.filter((c) => c.employeeId === filter.employeeId);
          }
          if (!filter.includeArchived) {
            conversations = conversations.filter((c) => !c.archived);
          }
          if (filter.search) {
            const q = filter.search.toLowerCase();
            conversations = conversations.filter(
              (c) =>
                c.title.toLowerCase().includes(q) ||
                (c.lastMessagePreview && c.lastMessagePreview.toLowerCase().includes(q)) ||
                (c.employeeName && c.employeeName.toLowerCase().includes(q))
            );
          }
          if (filter.limit && filter.limit > 0) {
            conversations = conversations.slice(0, filter.limit);
          }
        } else {
          conversations = conversations.filter((c) => !c.archived);
        }

        // Sort: pinned first, then by updatedAt desc
        conversations.sort((a, b) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return b.updatedAt - a.updatedAt;
        });

        return { success: true, result: conversations };
      } catch (error) {
        logger.error('conversation:list failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // conversation:get — get a single conversation by ID
  ipcMain.handle('conversation:get', async (_, id: string) => {
    try {
      const store = await getConversationStore();
      const conversations: ConversationRecord[] = (store.get('conversations', []) as ConversationRecord[]) as ConversationRecord[];
      const conversation = conversations.find((c) => c.id === id);
      if (!conversation) {
        return { success: false, error: `Conversation not found: ${id}` };
      }
      return { success: true, result: conversation };
    } catch (error) {
      logger.error('conversation:get failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // conversation:create — create a new conversation record
  ipcMain.handle(
    'conversation:create',
    async (
      _,
      input: {
        title?: string;
        sessionKey: string;
        participantType: 'supervisor' | 'employee';
        employeeId?: string;
        employeeName?: string;
        employeeAvatar?: string;
      }
    ) => {
      try {
        const store = await getConversationStore();
        const conversations: ConversationRecord[] = (store.get('conversations', []) as ConversationRecord[]) as ConversationRecord[];

        const now = Date.now();
        const record: ConversationRecord = {
          id: crypto.randomUUID(),
          title: input.title || 'New Chat',
          sessionKey: input.sessionKey,
          participantType: input.participantType,
          employeeId: input.employeeId,
          employeeName: input.employeeName,
          employeeAvatar: input.employeeAvatar,
          createdAt: now,
          updatedAt: now,
          messageCount: 0,
          pinned: false,
          archived: false,
        };

        conversations.unshift(record);
        store.set('conversations', conversations);

        logger.info(`Conversation created: ${record.id} (${record.title})`);
        return { success: true, result: record };
      } catch (error) {
        logger.error('conversation:create failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // conversation:update — update conversation metadata
  ipcMain.handle(
    'conversation:update',
    async (
      _,
      params: {
        id: string;
        updates: {
          title?: string;
          lastMessagePreview?: string;
          messageCount?: number;
          pinned?: boolean;
          archived?: boolean;
        };
      }
    ) => {
      try {
        const store = await getConversationStore();
        const conversations: ConversationRecord[] = (store.get('conversations', []) as ConversationRecord[]) as ConversationRecord[];
        const idx = conversations.findIndex((c) => c.id === params.id);
        if (idx === -1) {
          return { success: false, error: `Conversation not found: ${params.id}` };
        }

        conversations[idx] = {
          ...conversations[idx],
          ...params.updates,
          updatedAt: Date.now(),
        };
        store.set('conversations', conversations);

        return { success: true, result: conversations[idx] };
      } catch (error) {
        logger.error('conversation:update failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // conversation:delete — permanently delete a conversation
  ipcMain.handle('conversation:delete', async (_, id: string) => {
    try {
      const store = await getConversationStore();
      const conversations: ConversationRecord[] = (store.get('conversations', []) as ConversationRecord[]) as ConversationRecord[];
      const filtered = conversations.filter((c) => c.id !== id);
      store.set('conversations', filtered);

      logger.info(`Conversation deleted: ${id}`);
      return { success: true };
    } catch (error) {
      logger.error('conversation:delete failed:', error);
      return { success: false, error: String(error) };
    }
  });
}
