/**
 * Conversations State Store
 * Manages persistent chat history / conversation threads.
 *
 * Each Conversation is a lightweight metadata record persisted in electron-store.
 * It references a Gateway session key so the actual messages live in the Gateway.
 *
 * Key design decisions:
 * - Conversations are persisted via IPC → electron-store (not localStorage) so
 *   they survive renderer reloads and are accessible from main process.
 * - One employee can have multiple conversations (unlike the old 1:1 mapping).
 * - The store exposes CRUD + filtering actions consumed by the ConversationList UI.
 * - Auto-title generation extracts the first user message as conversation title.
 */
import { create } from 'zustand';
import type {
  Conversation,
  ConversationId,
  CreateConversationInput,
  UpdateConversationInput,
  ConversationFilter,
} from '@/types/conversation';

// ── Constants ──────────────────────────────────────────────────

/** Maximum title length (characters) */
const MAX_TITLE_LENGTH = 60;

/** Maximum preview length (characters) */
const MAX_PREVIEW_LENGTH = 120;

/** Default number of conversations to load */
const DEFAULT_LIMIT = 100;

// ── Helpers ────────────────────────────────────────────────────

/** Generate a short UUID-like id */
function generateId(): string {
  return crypto.randomUUID();
}

/** Truncate text to maxLen, appending '…' if truncated */
function truncate(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen - 1) + '…';
}

/**
 * Auto-generate a conversation title from the first user message.
 * Strips markdown, collapses whitespace, and truncates.
 */
function autoTitle(firstMessage: string): string {
  if (!firstMessage || !firstMessage.trim()) return 'New Chat';
  // Strip markdown syntax
  let clean = firstMessage
    .replace(/^#{1,6}\s+/gm, '') // headers
    .replace(/[*_~`]/g, '') // emphasis
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '') // images
    .replace(/\n+/g, ' ') // newlines to spaces
    .replace(/\s+/g, ' ') // collapse spaces
    .trim();
  if (!clean) return 'New Chat';
  return truncate(clean, MAX_TITLE_LENGTH);
}

// ── Persistence layer (IPC to electron-store) ──────────────────

/**
 * Read all conversations from electron-store via IPC.
 * Uses the dedicated `conversation:listAll` IPC channel which returns
 * all records from the clawx-conversations electron-store.
 * Falls back to empty array if store is not available.
 */
async function readAllConversations(): Promise<Conversation[]> {
  try {
    const result = (await window.electron.ipcRenderer.invoke('conversation:listAll')) as {
      success: boolean;
      result?: Conversation[];
      error?: string;
    };
    if (result.success && Array.isArray(result.result)) {
      return result.result;
    }
    return [];
  } catch (err) {
    console.warn('[conversations] Failed to read from store:', err);
    return [];
  }
}

/**
 * Persist a single conversation create/update/delete via dedicated IPC channels.
 * This avoids reading+writing the full array for every mutation.
 */
async function persistCreate(conversation: Conversation): Promise<void> {
  try {
    await window.electron.ipcRenderer.invoke('conversation:create', {
      title: conversation.title,
      sessionKey: conversation.sessionKey,
      participantType: conversation.participantType,
      employeeId: conversation.employeeId,
      employeeName: conversation.employeeName,
      employeeAvatar: conversation.employeeAvatar,
    });
  } catch (err) {
    console.warn('[conversations] Failed to persist create:', err);
  }
}

async function persistUpdate(id: string, updates: Partial<Conversation>): Promise<void> {
  try {
    await window.electron.ipcRenderer.invoke('conversation:update', {
      id,
      updates: {
        title: updates.title,
        lastMessagePreview: updates.lastMessagePreview,
        messageCount: updates.messageCount,
        pinned: updates.pinned,
        archived: updates.archived,
      },
    });
  } catch (err) {
    console.warn('[conversations] Failed to persist update:', err);
  }
}

async function persistDelete(id: string): Promise<void> {
  try {
    await window.electron.ipcRenderer.invoke('conversation:delete', id);
  } catch (err) {
    console.warn('[conversations] Failed to persist delete:', err);
  }
}

// ── Filter & sort logic ────────────────────────────────────────

function applyFilter(conversations: Conversation[], filter?: ConversationFilter): Conversation[] {
  let result = [...conversations];

  if (filter) {
    // Filter by participant type
    if (filter.participantType) {
      result = result.filter((c) => c.participantType === filter.participantType);
    }

    // Filter by employee ID
    if (filter.employeeId) {
      result = result.filter((c) => c.employeeId === filter.employeeId);
    }

    // Exclude archived unless explicitly included
    if (!filter.includeArchived) {
      result = result.filter((c) => !c.archived);
    }

    // Search
    if (filter.search) {
      const q = filter.search.toLowerCase();
      result = result.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          (c.lastMessagePreview && c.lastMessagePreview.toLowerCase().includes(q)) ||
          (c.employeeName && c.employeeName.toLowerCase().includes(q))
      );
    }

    // Sort: pinned first, then by sortBy field
    const sortBy = filter.sortBy || 'updatedAt';
    const sortDir = filter.sortDirection || 'desc';
    result.sort((a, b) => {
      // Pinned conversations always on top
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;

      let cmp = 0;
      if (sortBy === 'title') {
        cmp = a.title.localeCompare(b.title);
      } else if (sortBy === 'createdAt') {
        cmp = a.createdAt - b.createdAt;
      } else {
        cmp = a.updatedAt - b.updatedAt;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    // Limit
    if (filter.limit && filter.limit > 0) {
      result = result.slice(0, filter.limit);
    }
  } else {
    // Default: non-archived, sorted by updatedAt desc, pinned first
    result = result.filter((c) => !c.archived);
    result.sort((a, b) => {
      // Pinned conversations always on top
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.updatedAt - a.updatedAt;
    });
    result = result.slice(0, DEFAULT_LIMIT);
  }

  return result;
}

// ── Store types ────────────────────────────────────────────────

interface ConversationsState {
  /** All loaded conversations (filtered view) */
  conversations: Conversation[];

  /** Currently active conversation ID */
  activeConversationId: ConversationId | null;

  /** Loading state */
  loading: boolean;

  /** Error message */
  error: string | null;

  /** Current filter applied */
  currentFilter: ConversationFilter | null;

  // ── Actions ──

  /** Load conversations from persistence (with optional filter) */
  loadConversations: (filter?: ConversationFilter) => Promise<void>;

  /** Create a new conversation and make it active */
  createConversation: (input: CreateConversationInput) => Promise<Conversation>;

  /** Update an existing conversation's metadata */
  updateConversation: (id: ConversationId, updates: UpdateConversationInput) => Promise<void>;

  /** Delete a conversation permanently */
  deleteConversation: (id: ConversationId) => Promise<void>;

  /** Archive a conversation (soft-delete) */
  archiveConversation: (id: ConversationId) => Promise<void>;

  /** Unarchive a conversation */
  unarchiveConversation: (id: ConversationId) => Promise<void>;

  /** Pin/unpin a conversation */
  togglePin: (id: ConversationId) => Promise<void>;

  /** Set the active conversation */
  setActiveConversation: (id: ConversationId | null) => void;

  /** Find a conversation by session key */
  findBySessionKey: (sessionKey: string) => Conversation | undefined;

  /** Find conversations by employee ID */
  findByEmployeeId: (employeeId: string) => Conversation[];

  /**
   * Record activity on a conversation — updates timestamp and optionally
   * the last message preview. Called by the chat store after sending/receiving.
   */
  recordActivity: (
    id: ConversationId,
    lastMessagePreview?: string,
    incrementCount?: boolean
  ) => Promise<void>;

  /**
   * Auto-title a conversation from its first user message.
   * Only updates if the current title is a generic placeholder.
   */
  autoTitleFromMessage: (id: ConversationId, firstMessage: string) => Promise<void>;

  /**
   * Get or create a conversation for an employee.
   * If the employee already has an active (non-archived) conversation with the
   * given session key, returns it. Otherwise creates a new one.
   */
  getOrCreateForEmployee: (
    employeeId: string,
    employeeName: string,
    employeeAvatar: string | undefined,
    sessionKey: string
  ) => Promise<Conversation>;

  /**
   * Get or create a conversation for the supervisor.
   */
  getOrCreateForSupervisor: (sessionKey: string) => Promise<Conversation>;

  /** Clear error */
  clearError: () => void;
}

// ── Store ──────────────────────────────────────────────────────

export const useConversationsStore = create<ConversationsState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  loading: false,
  error: null,
  currentFilter: null,

  // ── Load ──

  loadConversations: async (filter?: ConversationFilter) => {
    set({ loading: true, error: null, currentFilter: filter ?? null });

    try {
      const all = await readAllConversations();
      const filtered = applyFilter(all, filter);
      set({ conversations: filtered, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  // ── Create ──

  createConversation: async (input: CreateConversationInput) => {
    const now = Date.now();
    const conversation: Conversation = {
      id: generateId(),
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

    try {
      // Persist via IPC
      await persistCreate(conversation);

      // Re-read from store to get the server-generated record and update local state
      const all = await readAllConversations();
      const { currentFilter } = get();
      const filtered = applyFilter(all, currentFilter ?? undefined);
      set({
        conversations: filtered,
        activeConversationId: conversation.id,
      });

      return conversation;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  // ── Update ──

  updateConversation: async (id: ConversationId, updates: UpdateConversationInput) => {
    try {
      // Persist via IPC
      await persistUpdate(id, updates);

      // Re-read and refresh local state
      const all = await readAllConversations();
      const { currentFilter } = get();
      const filtered = applyFilter(all, currentFilter ?? undefined);
      set({ conversations: filtered });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  // ── Delete ──

  deleteConversation: async (id: ConversationId) => {
    try {
      // Persist via IPC
      await persistDelete(id);

      // Re-read and refresh local state
      const all = await readAllConversations();
      const { currentFilter, activeConversationId } = get();
      const view = applyFilter(all, currentFilter ?? undefined);
      set({
        conversations: view,
        activeConversationId: activeConversationId === id ? null : activeConversationId,
      });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  // ── Archive / Unarchive ──

  archiveConversation: async (id: ConversationId) => {
    await get().updateConversation(id, { archived: true });
  },

  unarchiveConversation: async (id: ConversationId) => {
    await get().updateConversation(id, { archived: false });
  },

  // ── Pin ──

  togglePin: async (id: ConversationId) => {
    const conv = get().conversations.find((c) => c.id === id);
    if (!conv) return;
    await get().updateConversation(id, { pinned: !conv.pinned });
  },

  // ── Active ──

  setActiveConversation: (id: ConversationId | null) => {
    set({ activeConversationId: id });
  },

  // ── Finders ──

  findBySessionKey: (sessionKey: string) => {
    return get().conversations.find((c) => c.sessionKey === sessionKey);
  },

  findByEmployeeId: (employeeId: string) => {
    return get().conversations.filter((c) => c.employeeId === employeeId && !c.archived);
  },

  // ── Record Activity ──

  recordActivity: async (
    id: ConversationId,
    lastMessagePreview?: string,
    incrementCount = true
  ) => {
    try {
      // Build updates
      const updates: Record<string, unknown> = {};
      if (lastMessagePreview !== undefined) {
        updates.lastMessagePreview = truncate(lastMessagePreview, MAX_PREVIEW_LENGTH);
      }
      // For incrementing count we need to read current value first
      if (incrementCount) {
        const conv = get().conversations.find((c) => c.id === id);
        if (conv) {
          updates.messageCount = conv.messageCount + 1;
        }
      }

      await persistUpdate(id, updates as UpdateConversationInput);

      // Re-read and refresh local state
      const all = await readAllConversations();
      const { currentFilter } = get();
      const filtered = applyFilter(all, currentFilter ?? undefined);
      set({ conversations: filtered });
    } catch (err) {
      console.warn('[conversations] Failed to record activity:', err);
    }
  },

  // ── Auto Title ──

  autoTitleFromMessage: async (id: ConversationId, firstMessage: string) => {
    const conv = get().conversations.find((c) => c.id === id);
    if (!conv) return;

    // Only auto-title if current title is a generic placeholder
    const genericTitles = ['New Chat', 'new chat', '新对话', '新しいチャット'];
    if (!genericTitles.includes(conv.title) && conv.title !== conv.sessionKey) return;

    const title = autoTitle(firstMessage);
    if (title === 'New Chat') return; // don't replace with same generic title

    await get().updateConversation(id, { title });
  },

  // ── Get or Create ──

  getOrCreateForEmployee: async (
    employeeId: string,
    employeeName: string,
    employeeAvatar: string | undefined,
    sessionKey: string
  ) => {
    // Check if a conversation already exists for this session key
    const all = await readAllConversations();
    const existing = all.find((c) => c.sessionKey === sessionKey && !c.archived);
    if (existing) {
      set({ activeConversationId: existing.id });
      return existing;
    }

    // Create a new conversation
    return get().createConversation({
      title: `${employeeName}`,
      sessionKey,
      participantType: 'employee',
      employeeId,
      employeeName,
      employeeAvatar,
    });
  },

  getOrCreateForSupervisor: async (sessionKey: string) => {
    const all = await readAllConversations();
    const existing = all.find(
      (c) => c.sessionKey === sessionKey && c.participantType === 'supervisor' && !c.archived
    );
    if (existing) {
      set({ activeConversationId: existing.id });
      return existing;
    }

    return get().createConversation({
      title: 'Supervisor Chat',
      sessionKey,
      participantType: 'supervisor',
    });
  },

  // ── Clear Error ──

  clearError: () => {
    set({ error: null });
  },
}));

// ── Exported Helpers ────────────────────────────────────────────

export { autoTitle, truncate };
