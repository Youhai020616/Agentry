/**
 * Conversation Types
 * Defines the data structures for the chat history system.
 * A Conversation represents a single chat thread between a user and an employee/supervisor.
 * Conversations are persisted locally via electron-store and reference Gateway sessions.
 */

/** Unique identifier for a conversation */
export type ConversationId = string;

/** Who the conversation is with */
export type ConversationParticipant = 'supervisor' | 'employee';

/**
 * Conversation metadata — persisted in electron-store.
 * This is the core unit of the chat history system.
 */
export interface Conversation {
  /** Unique conversation ID (UUID) */
  id: ConversationId;

  /** Display title — auto-generated from first message or user-defined */
  title: string;

  /** The Gateway session key this conversation is bound to */
  sessionKey: string;

  /** Type of participant */
  participantType: ConversationParticipant;

  /** Employee ID (if participantType === 'employee') */
  employeeId?: string;

  /** Employee name snapshot (for display even if employee is deleted) */
  employeeName?: string;

  /** Employee avatar snapshot */
  employeeAvatar?: string;

  /** Timestamp when conversation was created (ms since epoch) */
  createdAt: number;

  /** Timestamp of the last activity (ms since epoch) */
  updatedAt: number;

  /** Preview of the last message content (truncated) */
  lastMessagePreview?: string;

  /** Number of messages in this conversation (approximate, updated on activity) */
  messageCount: number;

  /** Whether this conversation is pinned to the top */
  pinned: boolean;

  /** Whether this conversation is archived (hidden from default view) */
  archived: boolean;
}

/**
 * Input for creating a new conversation.
 * Fields like id, createdAt, updatedAt are auto-generated.
 */
export interface CreateConversationInput {
  /** Optional title — if omitted, auto-generated from first message */
  title?: string;

  /** The Gateway session key to bind to */
  sessionKey: string;

  /** Type of participant */
  participantType: ConversationParticipant;

  /** Employee ID (required when participantType === 'employee') */
  employeeId?: string;

  /** Employee name snapshot */
  employeeName?: string;

  /** Employee avatar snapshot */
  employeeAvatar?: string;
}

/**
 * Input for updating an existing conversation.
 * Only the provided fields will be updated.
 */
export interface UpdateConversationInput {
  /** Updated title */
  title?: string;

  /** Updated last message preview */
  lastMessagePreview?: string;

  /** Updated message count */
  messageCount?: number;

  /** Pin/unpin */
  pinned?: boolean;

  /** Archive/unarchive */
  archived?: boolean;
}

/**
 * Filter options for listing conversations.
 */
export interface ConversationFilter {
  /** Filter by participant type */
  participantType?: ConversationParticipant;

  /** Filter by employee ID */
  employeeId?: string;

  /** Include archived conversations (default: false) */
  includeArchived?: boolean;

  /** Search query — matches against title and lastMessagePreview */
  search?: string;

  /** Maximum number of results */
  limit?: number;

  /** Sort order */
  sortBy?: 'updatedAt' | 'createdAt' | 'title';

  /** Sort direction */
  sortDirection?: 'asc' | 'desc';
}

/**
 * Result of a conversation list operation.
 */
export interface ConversationListResult {
  /** List of conversations matching the filter */
  conversations: Conversation[];

  /** Total count (before limit) */
  total: number;
}
