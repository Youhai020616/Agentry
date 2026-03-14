/**
 * Chat Store — Shared Types
 * Extracted from the monolithic chat.ts for reuse across sub-stores.
 */

/** Metadata for locally-attached files (not from Gateway) */
export interface AttachedFileMeta {
  fileName: string;
  mimeType: string;
  fileSize: number;
  preview: string | null;
}

/** Raw message from OpenClaw chat.history */
export interface RawMessage {
  role: 'user' | 'assistant' | 'system' | 'toolresult';
  content: unknown; // string | ContentBlock[]
  timestamp?: number;
  id?: string;
  toolCallId?: string;
  toolName?: string;
  details?: unknown;
  isError?: boolean;
  /** Stop reason from LLM provider (e.g., 'end_turn', 'toolUse', 'error') */
  stopReason?: string;
  /** Error message from the LLM provider (e.g., credits exhausted) */
  errorMessage?: string;
  /** Local-only: file metadata for user-uploaded attachments (not sent to/from Gateway) */
  _attachedFiles?: AttachedFileMeta[];
  /** Local-only: tool call statuses captured during streaming, preserved on final message
   *  so that ChatMessage can render ToolStatusBar for completed (non-streaming) messages. */
  _toolStatuses?: ToolStatus[];
}

/** Content block inside a message */
export interface ContentBlock {
  type: 'text' | 'image' | 'thinking' | 'tool_use' | 'tool_result' | 'toolCall' | 'toolResult';
  text?: string;
  thinking?: string;
  source?: { type: string; media_type: string; data: string };
  id?: string;
  name?: string;
  input?: unknown;
  arguments?: unknown;
  content?: unknown;
}

/** Session from sessions.list */
export interface ChatSession {
  key: string;
  label?: string;
  displayName?: string;
  thinkingLevel?: string;
  model?: string;
}

export interface ToolStatus {
  id?: string;
  toolCallId?: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
  summary?: string;
  updatedAt: number;
}

/** Full chat state interface */
export interface ChatState {
  // Messages
  messages: RawMessage[];
  loading: boolean;
  error: string | null;

  // Streaming
  sending: boolean;
  activeRunId: string | null;
  streamingText: string;
  streamingMessage: unknown | null;
  streamingTools: ToolStatus[];
  pendingFinal: boolean;
  lastUserMessageAt: number | null;

  // Sessions
  sessions: ChatSession[];
  currentSessionKey: string;

  // Thinking
  showThinking: boolean;
  thinkingLevel: string | null;

  // Actions
  loadSessions: () => Promise<void>;
  switchSession: (key: string) => void;
  newSession: () => void;
  loadHistory: () => Promise<void>;
  sendMessage: (
    text: string,
    attachments?: Array<{
      fileName: string;
      mimeType: string;
      fileSize: number;
      stagedPath: string;
      preview: string | null;
    }>
  ) => Promise<void>;
  abortRun: () => Promise<void>;
  handleChatEvent: (event: Record<string, unknown>) => void;
  toggleThinking: () => void;
  refresh: () => Promise<void>;
  clearError: () => void;
}
