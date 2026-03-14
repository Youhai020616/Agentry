/**
 * Chat State Store — Implementation
 * Manages chat messages, sessions, streaming, and thinking state.
 * Communicates with OpenClaw Gateway via gateway:rpc IPC.
 *
 * Types are in ./types.ts. This file is re-exported from ./index.ts.
 */
import { create } from 'zustand';
import type {
  AttachedFileMeta,
  RawMessage,
  ContentBlock,
  ChatSession,
  ToolStatus,
  ChatState,
} from './types';

const DEFAULT_CANONICAL_PREFIX = 'agent:supervisor';
const DEFAULT_SESSION_KEY = `${DEFAULT_CANONICAL_PREFIX}:main`;

// ── Local image cache ─────────────────────────────────────────
// The Gateway doesn't store image attachments in session content blocks,
// so we cache them locally keyed by staged file path (which appears in the
// [media attached: <path> ...] reference in the Gateway's user message text).
// Keying by path avoids the race condition of keying by runId (which is only
// available after the RPC returns, but history may load before that).
const IMAGE_CACHE_KEY = 'agentry:image-cache';
const IMAGE_CACHE_MAX = 100; // max entries to prevent unbounded growth

function loadImageCache(): Map<string, AttachedFileMeta> {
  try {
    const raw = localStorage.getItem(IMAGE_CACHE_KEY);
    if (raw) {
      const entries = JSON.parse(raw) as Array<[string, AttachedFileMeta]>;
      return new Map(entries);
    }
  } catch {
    /* ignore parse errors */
  }
  return new Map();
}

function saveImageCache(cache: Map<string, AttachedFileMeta>): void {
  try {
    // Evict oldest entries if over limit
    const entries = Array.from(cache.entries());
    const trimmed =
      entries.length > IMAGE_CACHE_MAX ? entries.slice(entries.length - IMAGE_CACHE_MAX) : entries;
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore quota errors */
  }
}

const _imageCache = loadImageCache();

/** Extract plain text from message content (string or content blocks) */
function getMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('\n');
  }
  return '';
}

/** Extract media file refs from [media attached: <path> (<mime>) | ...] patterns */
function extractMediaRefs(text: string): Array<{ filePath: string; mimeType: string }> {
  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const regex = /\[media attached:\s*([^\s(]+)\s*\(([^)]+)\)\s*\|[^\]]*\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    refs.push({ filePath: match[1], mimeType: match[2] });
  }
  return refs;
}

/**
 * Restore _attachedFiles for user messages loaded from history.
 * Uses local cache for previews when available, but ALWAYS creates entries
 * from [media attached: ...] text patterns so file cards show even without cache.
 */
function enrichWithCachedImages(messages: RawMessage[]): RawMessage[] {
  return messages.map((msg) => {
    if (msg.role !== 'user' || msg._attachedFiles) return msg;
    const text = getMessageText(msg.content);
    const refs = extractMediaRefs(text);
    if (refs.length === 0) return msg;
    const files: AttachedFileMeta[] = refs.map((ref) => {
      const cached = _imageCache.get(ref.filePath);
      if (cached) return cached;
      // Fallback: create entry from text pattern (preview loaded later via IPC)
      const fileName = ref.filePath.split(/[\\/]/).pop() || 'file';
      return { fileName, mimeType: ref.mimeType, fileSize: 0, preview: null };
    });
    return { ...msg, _attachedFiles: files };
  });
}

/**
 * Async: load missing previews from disk via IPC for messages that have
 * _attachedFiles with null previews. Updates messages in-place and triggers re-render.
 */
async function loadMissingPreviews(messages: RawMessage[]): Promise<boolean> {
  // Collect all image paths that need previews
  const needPreview: Array<{ filePath: string; mimeType: string }> = [];
  for (const msg of messages) {
    if (msg.role !== 'user' || !msg._attachedFiles) continue;
    const text = getMessageText(msg.content);
    const refs = extractMediaRefs(text);
    for (let i = 0; i < refs.length; i++) {
      const file = msg._attachedFiles[i];
      if (file && file.mimeType.startsWith('image/') && !file.preview) {
        needPreview.push(refs[i]);
      }
    }
  }
  if (needPreview.length === 0) return false;

  try {
    const thumbnails = (await window.electron.ipcRenderer.invoke(
      'media:getThumbnails',
      needPreview
    )) as Record<string, { preview: string | null; fileSize: number }>;

    let updated = false;
    for (const msg of messages) {
      if (msg.role !== 'user' || !msg._attachedFiles) continue;
      const text = getMessageText(msg.content);
      const refs = extractMediaRefs(text);
      for (let i = 0; i < refs.length; i++) {
        const file = msg._attachedFiles[i];
        const thumb = thumbnails[refs[i]?.filePath];
        if (file && thumb && (thumb.preview || thumb.fileSize)) {
          // Build updated file entry immutably — don't mutate state objects directly
          const updatedFile = { ...file };
          if (thumb.preview) updatedFile.preview = thumb.preview;
          if (thumb.fileSize) updatedFile.fileSize = thumb.fileSize;
          msg._attachedFiles[i] = updatedFile;
          // Update cache for future loads
          _imageCache.set(refs[i].filePath, { ...updatedFile });
          updated = true;
        }
      }
    }
    if (updated) saveImageCache(_imageCache);
    return updated;
  } catch (err) {
    console.warn('[loadMissingPreviews] Failed:', err);
    return false;
  }
}

function getCanonicalPrefixFromSessions(sessions: ChatSession[]): string | null {
  const canonical = sessions.find((s) => s.key.startsWith('agent:'))?.key;
  if (!canonical) return null;
  const parts = canonical.split(':');
  if (parts.length < 2) return null;
  return `${parts[0]}:${parts[1]}`;
}

function isToolOnlyMessage(message: RawMessage | undefined): boolean {
  if (!message) return false;
  if (isToolResultRole(message.role)) return true;

  const msg = message as unknown as Record<string, unknown>;
  const content = message.content;

  // Check OpenAI-format tool_calls field (real-time streaming from OpenAI-compatible models)
  const toolCalls = msg.tool_calls ?? msg.toolCalls;
  const hasOpenAITools = Array.isArray(toolCalls) && toolCalls.length > 0;

  if (!Array.isArray(content)) {
    // Content is not an array — check if there's OpenAI-format tool_calls
    if (hasOpenAITools) {
      // Has tool calls but content might be empty/string — treat as tool-only
      // if there's no meaningful text content
      const textContent = typeof content === 'string' ? content.trim() : '';
      return textContent.length === 0;
    }
    return false;
  }

  let hasTool = hasOpenAITools;
  let hasText = false;
  let hasNonToolContent = false;

  for (const block of content as ContentBlock[]) {
    if (
      block.type === 'tool_use' ||
      block.type === 'tool_result' ||
      block.type === 'toolCall' ||
      block.type === 'toolResult'
    ) {
      hasTool = true;
      continue;
    }
    if (block.type === 'text' && block.text && block.text.trim()) {
      hasText = true;
      continue;
    }
    if (block.type === 'image' || block.type === 'thinking') {
      hasNonToolContent = true;
    }
  }

  return hasTool && !hasText && !hasNonToolContent;
}

function isToolResultRole(role: unknown): boolean {
  if (!role) return false;
  const normalized = String(role).toLowerCase();
  return normalized === 'toolresult' || normalized === 'tool_result';
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

function summarizeToolOutput(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return undefined;
  const summaryLines = lines.slice(0, 2);
  let summary = summaryLines.join(' / ');
  if (summary.length > 160) {
    summary = `${summary.slice(0, 157)}...`;
  }
  return summary;
}

function normalizeToolStatus(
  rawStatus: unknown,
  fallback: 'running' | 'completed'
): ToolStatus['status'] {
  const status = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : '';
  if (status === 'error' || status === 'failed') return 'error';
  if (status === 'completed' || status === 'success' || status === 'done') return 'completed';
  return fallback;
}

function parseDurationMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractToolUseUpdates(message: unknown): ToolStatus[] {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const updates: ToolStatus[] = [];

  // Path 1: Anthropic/normalized format — tool blocks inside content array
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if ((block.type !== 'tool_use' && block.type !== 'toolCall') || !block.name) continue;
      updates.push({
        id: block.id || block.name,
        toolCallId: block.id,
        name: block.name,
        status: 'running',
        updatedAt: Date.now(),
      });
    }
  }

  // Path 2: OpenAI format — tool_calls array on the message itself
  if (updates.length === 0) {
    const toolCalls = msg.tool_calls ?? msg.toolCalls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls as Array<Record<string, unknown>>) {
        const fn = (tc.function ?? tc) as Record<string, unknown>;
        const name = typeof fn.name === 'string' ? fn.name : '';
        if (!name) continue;
        const id = typeof tc.id === 'string' ? tc.id : name;
        updates.push({
          id,
          toolCallId: typeof tc.id === 'string' ? tc.id : undefined,
          name,
          status: 'running',
          updatedAt: Date.now(),
        });
      }
    }
  }

  return updates;
}

function extractToolResultBlocks(message: unknown, eventState: string): ToolStatus[] {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const content = msg.content;
  if (!Array.isArray(content)) return [];

  const updates: ToolStatus[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type !== 'tool_result' && block.type !== 'toolResult') continue;
    const outputText = extractTextFromContent(block.content ?? block.text ?? '');
    const summary = summarizeToolOutput(outputText);
    updates.push({
      id: block.id || block.name || 'tool',
      toolCallId: block.id,
      name: block.name || block.id || 'tool',
      status: normalizeToolStatus(undefined, eventState === 'delta' ? 'running' : 'completed'),
      summary,
      updatedAt: Date.now(),
    });
  }

  return updates;
}

function extractToolResultUpdate(message: unknown, eventState: string): ToolStatus | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  const role = typeof msg.role === 'string' ? msg.role.toLowerCase() : '';
  if (!isToolResultRole(role)) return null;

  const toolName =
    typeof msg.toolName === 'string' ? msg.toolName : typeof msg.name === 'string' ? msg.name : '';
  const toolCallId = typeof msg.toolCallId === 'string' ? msg.toolCallId : undefined;
  const details =
    msg.details && typeof msg.details === 'object'
      ? (msg.details as Record<string, unknown>)
      : undefined;
  const rawStatus = msg.status ?? details?.status;
  const fallback = eventState === 'delta' ? 'running' : 'completed';
  const status = normalizeToolStatus(rawStatus, fallback);
  const durationMs = parseDurationMs(
    details?.durationMs ?? details?.duration ?? (msg as Record<string, unknown>).durationMs
  );

  const outputText =
    details && typeof details.aggregated === 'string'
      ? details.aggregated
      : extractTextFromContent(msg.content);
  const summary =
    summarizeToolOutput(outputText) ??
    summarizeToolOutput(String(details?.error ?? msg.error ?? ''));

  const name = toolName || toolCallId || 'tool';
  const id = toolCallId || name;

  return {
    id,
    toolCallId,
    name,
    status,
    durationMs,
    summary,
    updatedAt: Date.now(),
  };
}

function mergeToolStatus(
  existing: ToolStatus['status'],
  incoming: ToolStatus['status']
): ToolStatus['status'] {
  const order: Record<ToolStatus['status'], number> = { running: 0, completed: 1, error: 2 };
  return order[incoming] >= order[existing] ? incoming : existing;
}

function upsertToolStatuses(current: ToolStatus[], updates: ToolStatus[]): ToolStatus[] {
  if (updates.length === 0) return current;
  const next = [...current];
  for (const update of updates) {
    const key = update.toolCallId || update.id || update.name;
    if (!key) continue;
    const index = next.findIndex((tool) => (tool.toolCallId || tool.id || tool.name) === key);
    if (index === -1) {
      next.push(update);
      continue;
    }
    const existing = next[index];
    next[index] = {
      ...existing,
      ...update,
      name: update.name || existing.name,
      status: mergeToolStatus(existing.status, update.status),
      durationMs: update.durationMs ?? existing.durationMs,
      summary: update.summary ?? existing.summary,
      updatedAt: update.updatedAt || existing.updatedAt,
    };
  }
  return next;
}

function collectToolUpdates(message: unknown, eventState: string): ToolStatus[] {
  const updates: ToolStatus[] = [];
  const toolResultUpdate = extractToolResultUpdate(message, eventState);
  if (toolResultUpdate) updates.push(toolResultUpdate);
  updates.push(...extractToolResultBlocks(message, eventState));
  updates.push(...extractToolUseUpdates(message));
  return updates;
}

function hasNonToolAssistantContent(message: RawMessage | undefined): boolean {
  if (!message) return false;
  if (typeof message.content === 'string' && message.content.trim()) return true;

  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if (block.type === 'text' && block.text && block.text.trim()) return true;
      if (block.type === 'thinking' && block.thinking && block.thinking.trim()) return true;
      if (block.type === 'image') return true;
    }
  }

  const msg = message as unknown as Record<string, unknown>;
  if (typeof msg.text === 'string' && msg.text.trim()) return true;

  return false;
}

/**
 * Normalize a timestamp to milliseconds.
 * Gateway may return timestamps in seconds (10 digits) or milliseconds (13 digits).
 * Our local timestamps use Date.now() (milliseconds).
 */
function toMs(ts: number): number {
  // Timestamps < 1e12 are in seconds (up to year 33658 in ms, year 2001 in s).
  // In practice: seconds ≈ 1.74e9, milliseconds ≈ 1.74e12 for 2025.
  return ts < 1e12 ? ts * 1000 : ts;
}

// ── Completed-run guard ─────────────────────────────────────────────
// After a run is fully resolved (lifecycle:end promotes streamingMessage, or a
// normal final with isResolved=true clears sending), late-arriving protocol
// events for the same runId must be dropped — otherwise they create duplicate
// messages. We track recently-completed runIds in a small Set with timer-based
// cleanup to prevent memory leaks.
const recentCompletedRunIds = new Set<string>();
let _completedRunCleanupTimer: ReturnType<typeof setTimeout> | null = null;
const COMPLETED_RUN_TTL_MS = 30_000; // 30 seconds

function markRunCompleted(runId: string): void {
  if (!runId) return;
  recentCompletedRunIds.add(runId);
  if (!_completedRunCleanupTimer) {
    _completedRunCleanupTimer = setTimeout(() => {
      recentCompletedRunIds.clear();
      _completedRunCleanupTimer = null;
    }, COMPLETED_RUN_TTL_MS);
  }
}

// ── Resolved run tracking ───────────────────────────────────────
// Tracks runs where a final event with actual content (isResolved=true)
// has been processed. This closes the gap between when a resolved final
// event clears sending/activeRunId and when lifecycle:end calls
// markRunCompleted(). Without this, late-arriving deltas (duplicate
// delivery via the other IPC channel) can slip through and re-enable
// streaming, causing the promoted message to overwrite the final one.
const recentResolvedRunIds = new Set<string>();
let _resolvedRunCleanupTimer: ReturnType<typeof setTimeout> | null = null;

function markRunResolved(runId: string): void {
  if (!runId) return;
  recentResolvedRunIds.add(runId);
  if (!_resolvedRunCleanupTimer) {
    _resolvedRunCleanupTimer = setTimeout(() => {
      recentResolvedRunIds.clear();
      _resolvedRunCleanupTimer = null;
    }, COMPLETED_RUN_TTL_MS);
  }
}

// ── pendingFinal safety net ──────────────────────────────────────
// If pendingFinal stays true (loadHistory didn't find a resolving message),
// retry loadHistory after a delay, then hard-reset sending state as a last resort.

let _pendingFinalRetryTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingFinalTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

function clearPendingFinalTimers() {
  if (_pendingFinalRetryTimer) {
    clearTimeout(_pendingFinalRetryTimer);
    _pendingFinalRetryTimer = null;
  }
  if (_pendingFinalTimeoutTimer) {
    clearTimeout(_pendingFinalTimeoutTimer);
    _pendingFinalTimeoutTimer = null;
  }
}

function schedulePendingFinalSafetyNet(
  getState: () => ChatState,
  setState: (partial: Partial<ChatState>) => void
) {
  clearPendingFinalTimers();

  // Retry loadHistory after 2 seconds
  _pendingFinalRetryTimer = setTimeout(() => {
    const s = getState();
    if (s.pendingFinal && s.sending) {
      console.warn('[pendingFinal] Retrying loadHistory after 2s');
      s.loadHistory();
    }
  }, 2000);

  // Hard reset after 8 seconds as last resort
  _pendingFinalTimeoutTimer = setTimeout(() => {
    const s = getState();
    if (s.pendingFinal && s.sending) {
      console.warn('[pendingFinal] Hard reset after 8s timeout');
      setState({
        sending: false,
        activeRunId: null,
        pendingFinal: false,
        lastUserMessageAt: null,
      });
    }
  }, 8000);
}

// ── Store ────────────────────────────────────────────────────────

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  loading: false,
  error: null,

  sending: false,
  activeRunId: null,
  streamingText: '',
  streamingMessage: null,
  streamingTools: [],
  pendingFinal: false,
  lastUserMessageAt: null,

  sessions: [],
  currentSessionKey: DEFAULT_SESSION_KEY,

  showThinking: true,
  thinkingLevel: null,

  // ── Load sessions via sessions.list ──

  loadSessions: async () => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('gateway:rpc', 'sessions.list', {
        limit: 50,
      })) as { success: boolean; result?: Record<string, unknown>; error?: string };

      if (result.success && result.result) {
        const data = result.result;
        const rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
        const sessions: ChatSession[] = rawSessions
          .map((s: Record<string, unknown>) => ({
            key: String(s.key || ''),
            label: s.label ? String(s.label) : undefined,
            displayName: s.displayName ? String(s.displayName) : undefined,
            thinkingLevel: s.thinkingLevel ? String(s.thinkingLevel) : undefined,
            model: s.model ? String(s.model) : undefined,
          }))
          .filter((s: ChatSession) => s.key);

        const canonicalBySuffix = new Map<string, string>();
        for (const session of sessions) {
          if (!session.key.startsWith('agent:')) continue;
          const parts = session.key.split(':');
          if (parts.length < 3) continue;
          const suffix = parts.slice(2).join(':');
          if (suffix && !canonicalBySuffix.has(suffix)) {
            canonicalBySuffix.set(suffix, session.key);
          }
        }

        // Deduplicate: if both short and canonical existed, keep canonical only
        const seen = new Set<string>();
        const dedupedSessions = sessions.filter((s) => {
          if (!s.key.startsWith('agent:') && canonicalBySuffix.has(s.key)) return false;
          if (seen.has(s.key)) return false;
          seen.add(s.key);
          return true;
        });

        const { currentSessionKey } = get();
        let nextSessionKey = currentSessionKey || DEFAULT_SESSION_KEY;
        if (!nextSessionKey.startsWith('agent:')) {
          const canonicalMatch = canonicalBySuffix.get(nextSessionKey);
          if (canonicalMatch) {
            nextSessionKey = canonicalMatch;
          }
        }
        if (!dedupedSessions.find((s) => s.key === nextSessionKey) && dedupedSessions.length > 0) {
          // Current session not found at all — switch to the first available session
          nextSessionKey = dedupedSessions[0].key;
        }

        const sessionsWithCurrent =
          !dedupedSessions.find((s) => s.key === nextSessionKey) && nextSessionKey
            ? [...dedupedSessions, { key: nextSessionKey, displayName: nextSessionKey }]
            : dedupedSessions;

        set({ sessions: sessionsWithCurrent, currentSessionKey: nextSessionKey });

        if (currentSessionKey !== nextSessionKey) {
          get().loadHistory();
        }
      }
    } catch (err) {
      console.warn('Failed to load sessions:', err);
    }
  },

  // ── Switch session ──

  switchSession: (key: string) => {
    set({
      currentSessionKey: key,
      messages: [],
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      activeRunId: null,
      error: null,
      pendingFinal: false,
      lastUserMessageAt: null,
    });
    // Load history for new session
    get().loadHistory();
  },

  // ── New session ──

  newSession: () => {
    // Generate a new unique session key and switch to it.
    // The key includes a short random suffix to guarantee uniqueness even
    // if called multiple times within the same millisecond.
    const prefix = getCanonicalPrefixFromSessions(get().sessions) ?? DEFAULT_CANONICAL_PREFIX;
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 6);
    const newKey = `${prefix}:session-${ts}-${rand}`;
    const newSessionEntry: ChatSession = {
      key: newKey,
      displayName: `New Chat ${new Date(ts).toLocaleString()}`,
    };
    set((s) => ({
      currentSessionKey: newKey,
      sessions: [...s.sessions, newSessionEntry],
      messages: [],
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      activeRunId: null,
      error: null,
      pendingFinal: false,
      lastUserMessageAt: null,
    }));
    // Load history for the new (empty) session to initialize properly
    get().loadHistory();
  },

  // ── Load chat history ──

  loadHistory: async () => {
    const sessionKeyAtStart = get().currentSessionKey;
    // Guard: if session changed while awaiting, discard stale results
    const isStale = () => get().currentSessionKey !== sessionKeyAtStart;
    set({ loading: true, error: null });

    // ── Step 1: Try loading from local SQLite store first (survives Gateway restarts) ──
    let localMessages: RawMessage[] = [];
    let usedLocalFallback = false;
    try {
      const localResult = (await window.electron.ipcRenderer.invoke('chatMessage:list', {
        sessionKey: sessionKeyAtStart,
        limit: 200,
      })) as { success: boolean; result?: Array<Record<string, unknown>>; error?: string };

      if (
        localResult.success &&
        Array.isArray(localResult.result) &&
        localResult.result.length > 0
      ) {
        // Convert stored messages back to RawMessage format
        localMessages = localResult.result.map((stored) => {
          const raw = (stored.raw ?? {}) as Record<string, unknown>;
          return {
            ...raw,
            id: stored.id as string,
            role: stored.role as string,
            content: (stored.content as string) || (raw.content as string) || '',
            timestamp: stored.timestamp as number,
            runId: stored.runId as string | undefined,
            providerId: stored.providerId as string | undefined,
            model: stored.model as string | undefined,
            stopReason: stored.stopReason as string | undefined,
            _attachedFiles: (stored.attachedFiles ?? raw._attachedFiles) as
              | AttachedFileMeta[]
              | undefined,
          } as RawMessage;
        });
      }
    } catch (err) {
      console.debug('[loadHistory] Local message store unavailable:', err);
    }

    // ── Step 2: Try loading from Gateway (live source of truth when available) ──
    try {
      const result = (await window.electron.ipcRenderer.invoke('gateway:rpc', 'chat.history', {
        sessionKey: sessionKeyAtStart,
        limit: 200,
      })) as { success: boolean; result?: Record<string, unknown>; error?: string };

      if (result.success && result.result) {
        // Discard if session switched while we were fetching
        if (isStale()) return;
        const data = result.result;
        const rawMessages = Array.isArray(data.messages) ? (data.messages as RawMessage[]) : [];
        const filteredMessages = rawMessages.filter((msg) => !isToolResultRole(msg.role));
        // Restore file attachments for user messages (from cache + text patterns)
        const enrichedMessages = enrichWithCachedImages(filteredMessages);
        const thinkingLevel = data.thinkingLevel ? String(data.thinkingLevel) : null;
        set({ messages: enrichedMessages, thinkingLevel, loading: false });

        // Async: load missing image previews from disk (updates in background)
        loadMissingPreviews(enrichedMessages).then((updated) => {
          if (updated) {
            set({
              messages: enrichedMessages.map((msg) =>
                msg._attachedFiles
                  ? { ...msg, _attachedFiles: msg._attachedFiles.map((f) => ({ ...f })) }
                  : msg
              ),
            });
          }
        });

        // Async: sync Gateway messages to local store for persistence
        window.electron.ipcRenderer
          .invoke('chatMessage:sync', { sessionKey: sessionKeyAtStart })
          .catch((err: unknown) =>
            console.debug('[loadHistory] Background sync to local store failed:', err)
          );

        const { pendingFinal, lastUserMessageAt } = get();
        if (pendingFinal) {
          const recentAssistant = [...filteredMessages].reverse().find((msg) => {
            if (msg.role !== 'assistant') return false;
            if (lastUserMessageAt && msg.timestamp && toMs(msg.timestamp) < toMs(lastUserMessageAt))
              return false;
            // Accept messages with actual content OR error responses
            if (hasNonToolAssistantContent(msg)) return true;
            const sr = msg.stopReason || (msg as unknown as Record<string, unknown>).stop_reason;
            if (sr === 'error' || msg.errorMessage) return true;
            return false;
          });
          if (recentAssistant) {
            // Surface error messages from the LLM provider (e.g., 402 credits exhausted)
            const errMsg = recentAssistant.errorMessage
              ? String(recentAssistant.errorMessage)
              : undefined;
            clearPendingFinalTimers();
            set({
              sending: false,
              activeRunId: null,
              pendingFinal: false,
              ...(errMsg ? { error: errMsg } : {}),
            });
          } else {
            const lastMsg =
              filteredMessages.length > 0 ? filteredMessages[filteredMessages.length - 1] : null;
            if (lastMsg && lastMsg.role === 'assistant' && !hasNonToolAssistantContent(lastMsg)) {
              const errMsg = lastMsg.errorMessage ? String(lastMsg.errorMessage) : undefined;
              clearPendingFinalTimers();
              set({
                sending: false,
                activeRunId: null,
                pendingFinal: false,
                ...(errMsg ? { error: errMsg } : {}),
              });
            }
          }
        }
      } else if (!isStale() && localMessages.length > 0) {
        // Gateway returned no data — fall back to local store
        usedLocalFallback = true;
        const filteredLocal = localMessages.filter((msg) => !isToolResultRole(msg.role));
        const enrichedLocal = enrichWithCachedImages(filteredLocal);
        set({ messages: enrichedLocal, loading: false });
        console.info(
          `[loadHistory] Using ${enrichedLocal.length} messages from local store (Gateway returned empty)`
        );
      } else if (!isStale()) {
        set({ messages: [], loading: false });
      }
    } catch (err) {
      if (isStale()) return;
      // Gateway unreachable — fall back to local store if we have data
      if (localMessages.length > 0) {
        usedLocalFallback = true;
        const filteredLocal = localMessages.filter((msg) => !isToolResultRole(msg.role));
        const enrichedLocal = enrichWithCachedImages(filteredLocal);
        set({ messages: enrichedLocal, loading: false });
        console.info(
          `[loadHistory] Gateway unavailable, loaded ${enrichedLocal.length} messages from local store`
        );
      } else {
        console.warn('Failed to load chat history:', err);
        set({ messages: [], loading: false });
      }
    }

    if (usedLocalFallback) {
      // Load image previews for locally-restored messages
      const msgs = get().messages;
      loadMissingPreviews(msgs).then((updated) => {
        if (updated) {
          set({
            messages: msgs.map((msg) =>
              msg._attachedFiles
                ? { ...msg, _attachedFiles: msg._attachedFiles.map((f) => ({ ...f })) }
                : msg
            ),
          });
        }
      });
    }
  },

  // ── Send message ──

  sendMessage: async (
    text: string,
    attachments?: Array<{
      fileName: string;
      mimeType: string;
      fileSize: number;
      stagedPath: string;
      preview: string | null;
    }>
  ) => {
    const trimmed = text.trim();
    if (!trimmed && (!attachments || attachments.length === 0)) return;

    const { currentSessionKey } = get();

    // Add user message optimistically (with local file metadata for UI display)
    const userMsg: RawMessage = {
      role: 'user',
      content: trimmed || (attachments?.length ? '(file attached)' : ''),
      timestamp: Date.now(),
      id: crypto.randomUUID(),
      _attachedFiles: attachments?.map((a) => ({
        fileName: a.fileName,
        mimeType: a.mimeType,
        fileSize: a.fileSize,
        preview: a.preview,
      })),
    };
    set((s) => ({
      messages: [...s.messages, userMsg],
      sending: true,
      error: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: userMsg.timestamp ?? null,
    }));

    // Persist user message to local SQLite store (non-blocking)
    window.electron.ipcRenderer
      .invoke('chatMessage:save', {
        id: userMsg.id,
        sessionKey: currentSessionKey,
        role: 'user',
        content: userMsg.content,
        timestamp: userMsg.timestamp,
        attachedFiles: userMsg._attachedFiles,
        raw: {
          role: 'user',
          content: userMsg.content,
          timestamp: userMsg.timestamp,
          id: userMsg.id,
        },
      })
      .catch((err: unknown) => console.debug('[sendMessage] Failed to persist user message:', err));

    try {
      const idempotencyKey = crypto.randomUUID();
      const hasMedia = attachments && attachments.length > 0;

      // Cache image attachments BEFORE the IPC call to avoid race condition:
      // history may reload (via Gateway event) before the RPC returns.
      // Keyed by staged file path which appears in [media attached: <path> ...].
      if (hasMedia && attachments) {
        for (const a of attachments) {
          _imageCache.set(a.stagedPath, {
            fileName: a.fileName,
            mimeType: a.mimeType,
            fileSize: a.fileSize,
            preview: a.preview,
          });
        }
        saveImageCache(_imageCache);
      }

      let result: { success: boolean; result?: { runId?: string }; error?: string };

      if (hasMedia) {
        // Use dedicated chat:sendWithMedia handler — main process reads staged files
        // from disk and builds base64 attachments, avoiding large IPC transfers
        result = (await window.electron.ipcRenderer.invoke('chat:sendWithMedia', {
          sessionKey: currentSessionKey,
          message: trimmed || 'Process the attached file(s).',
          deliver: false,
          idempotencyKey,
          media: attachments.map((a) => ({
            filePath: a.stagedPath,
            mimeType: a.mimeType,
            fileName: a.fileName,
          })),
        })) as { success: boolean; result?: { runId?: string }; error?: string };
      } else {
        // No media — use standard lightweight RPC
        result = (await window.electron.ipcRenderer.invoke('gateway:rpc', 'chat.send', {
          sessionKey: currentSessionKey,
          message: trimmed,
          deliver: false,
          idempotencyKey,
        })) as { success: boolean; result?: { runId?: string }; error?: string };
      }

      if (!result.success) {
        set({ error: result.error || 'Failed to send message', sending: false });
      } else if (result.result?.runId) {
        set({ activeRunId: result.result.runId });
      } else {
        // No runId from gateway; keep sending state and wait for events.
      }
    } catch (err) {
      set({ error: String(err), sending: false });
    }
  },

  // ── Abort active run ──

  abortRun: async () => {
    const { currentSessionKey } = get();
    set({
      sending: false,
      streamingText: '',
      streamingMessage: null,
      pendingFinal: false,
      lastUserMessageAt: null,
    });
    set({ streamingTools: [] });

    try {
      await window.electron.ipcRenderer.invoke('gateway:rpc', 'chat.abort', {
        sessionKey: currentSessionKey,
      });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  // ── Handle incoming chat events from Gateway ──

  handleChatEvent: (event: Record<string, unknown>) => {
    const runId = String(event.runId || '');
    const eventState = String(event.state || '');
    const { activeRunId } = get();

    // ── Completed-run guard: drop late events for already-resolved runs ──
    // BUG FIX: A single run can produce multiple assistant messages (e.g.,
    // tool-use intermediate messages followed by a final text reply). Previously,
    // the first resolved final message called markRunCompleted(), causing ALL
    // subsequent messages in the same run to be silently dropped here.
    // Now we allow events that carry a message body through — real duplicates
    // are caught downstream by the alreadyExists (message ID) check.
    if (runId && recentCompletedRunIds.has(runId)) {
      const hasMessageBody = event.message && typeof event.message === 'object';
      if (!hasMessageBody) {
        return;
      }
      // Has message body → continue processing; alreadyExists will dedup
    }

    // Only process events for the active run (or if no active run set).
    // BUG FIX: Also accept events when activeRunId is set but runId is empty —
    // some Gateway protocol events omit runId, and dropping them silently
    // causes "missing response" symptoms.
    if (activeRunId && runId && runId !== activeRunId) return;

    // Defensive: if state is missing but we have a message, try to infer state.
    // This handles the case where the Gateway sends events without a state wrapper
    // (e.g., protocol events where payload is the raw message).
    let resolvedState = eventState;
    if (!resolvedState && event.message && typeof event.message === 'object') {
      const msg = event.message as Record<string, unknown>;
      const stopReason = msg.stopReason ?? msg.stop_reason;
      if (stopReason) {
        // Message has a stopReason → it's a final message
        resolvedState = 'final';
      } else if (msg.role || msg.content) {
        // Message has role/content but no stopReason → treat as delta (streaming)
        resolvedState = 'delta';
      }
    }

    switch (resolvedState) {
      case 'delta': {
        // Streaming update - store the cumulative message.
        // BUG FIX: When the Gateway sends rapid delta events (e.g., during
        // tool-heavy Reddit account nurturing sessions), later deltas would
        // completely overwrite earlier ones. Now we merge content intelligently:
        // if both old and new are objects with text content, we keep the longer
        // / more recent one (Gateway sends cumulative deltas, not incremental).
        //
        // RESOLVED-RUN GUARD: Drop late deltas for runs that already have a
        // resolved final message. Without this, late deltas arriving via the
        // other IPC channel re-enable sending, and the subsequent lifecycle:end
        // promotes streamingMessage as a duplicate message.
        if (runId && recentResolvedRunIds.has(runId)) {
          return;
        }
        //
        // MULTI-MESSAGE FIX: If a previous final message in the same run already
        // set sending=false, but the run is still producing more messages (e.g.,
        // supervisor mode), re-enable sending so the streaming UI renders.
        // Only re-enable if the run hasn't been resolved (activeRunId still set).
        if (
          !get().sending &&
          get().activeRunId &&
          event.message &&
          typeof event.message === 'object'
        ) {
          set({ sending: true });
        }
        const updates = collectToolUpdates(event.message, resolvedState);
        set((s) => ({
          streamingMessage: (() => {
            if (event.message && typeof event.message === 'object') {
              const msgRole = (event.message as RawMessage).role;
              if (isToolResultRole(msgRole)) return s.streamingMessage;
            }
            // Use the new message if present (Gateway sends cumulative content)
            return event.message ?? s.streamingMessage;
          })(),
          streamingTools:
            updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
        }));
        break;
      }
      case 'final': {
        // Message complete - add to history and clear streaming
        const finalMsg = event.message as RawMessage | undefined;
        if (finalMsg) {
          const updates = collectToolUpdates(finalMsg, resolvedState);
          if (isToolResultRole(finalMsg.role)) {
            set((s) => ({
              streamingText: '',
              pendingFinal: true,
              streamingTools:
                updates.length > 0
                  ? upsertToolStatuses(s.streamingTools, updates)
                  : s.streamingTools,
            }));
            break;
          }
          const toolOnly = isToolOnlyMessage(finalMsg);
          const hasOutput = hasNonToolAssistantContent(finalMsg);
          // Detect error responses (e.g., 402 credits exhausted from OpenRouter).
          // These have empty content but errorMessage/stopReason=error.
          const fmAny = finalMsg as unknown as Record<string, unknown>;
          const isErrorResponse = !!(
            finalMsg.errorMessage ||
            finalMsg.stopReason === 'error' ||
            fmAny.stop_reason === 'error'
          );
          // Run is resolved if we have actual content OR it's an error response
          const isResolved = hasOutput || isErrorResponse;

          // BUG FIX: Previously, non-tool messages used `run-${runId}` as ID,
          // meaning multiple assistant messages within the same run would share
          // the same ID. The `alreadyExists` check would then silently drop
          // subsequent messages, causing content loss / "overwriting" behavior.
          // Now every final message gets a unique ID to prevent any overwrites.
          const msgId =
            finalMsg.id ||
            `run-${runId || 'unknown'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          // Surface error message to the store
          if (isErrorResponse && finalMsg.errorMessage) {
            set({ error: String(finalMsg.errorMessage) });
          }
          set((s) => {
            const nextTools =
              updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools;
            // Snapshot tool statuses BEFORE clearing — we attach them to the
            // final message so ChatMessage can render ToolStatusBar even after
            // streaming ends. Only attach if there are meaningful statuses.
            const toolSnapshot = nextTools.length > 0 ? nextTools : undefined;
            const streamingTools = isResolved ? [] : nextTools;
            // Check if message already exists (prevent duplicates)
            const alreadyExists = s.messages.some((m) => m.id === msgId);
            if (alreadyExists) {
              // Just clear streaming state, don't add duplicate
              return toolOnly
                ? {
                    streamingText: '',
                    streamingMessage: null,
                    pendingFinal: true,
                    streamingTools,
                  }
                : {
                    streamingText: '',
                    streamingMessage: null,
                    sending: isResolved ? false : s.sending,
                    activeRunId: isResolved ? null : s.activeRunId,
                    pendingFinal: isResolved ? false : true,
                    streamingTools,
                  };
            }
            return toolOnly
              ? {
                  messages: [
                    ...s.messages,
                    {
                      ...finalMsg,
                      role: finalMsg.role || 'assistant',
                      id: msgId,
                      _toolStatuses: toolSnapshot,
                    },
                  ],
                  streamingText: '',
                  streamingMessage: null,
                  pendingFinal: true,
                  streamingTools,
                }
              : {
                  messages: [
                    ...s.messages,
                    {
                      ...finalMsg,
                      role: finalMsg.role || 'assistant',
                      id: msgId,
                      _toolStatuses: toolSnapshot,
                    },
                  ],
                  streamingText: '',
                  streamingMessage: null,
                  sending: isResolved ? false : s.sending,
                  activeRunId: isResolved ? null : s.activeRunId,
                  pendingFinal: isResolved ? false : true,
                  streamingTools,
                };
          });
          // MULTI-MESSAGE FIX: Do NOT call markRunCompleted() here.
          // A single run can produce multiple assistant messages (tool-use
          // intermediates + final text). Marking the run completed after the
          // first resolved message would block all subsequent messages.
          // Instead, markRunCompleted() is called only when lifecycle:end
          // arrives (the no-message-body branch below), which is the true
          // end-of-run signal from the Gateway.
          //
          // However, mark the run as RESOLVED so that late-arriving deltas
          // (duplicate delivery via the other IPC channel) are dropped by
          // the resolved-run guard in the delta handler. This prevents the
          // "streaming overwrites final" bug where a late delta re-enables
          // sending and lifecycle:end then promotes a duplicate message.
          if (isResolved && runId) {
            markRunResolved(runId);
          }
          // If still pending after set, schedule safety net
          if (get().pendingFinal) {
            schedulePendingFinalSafetyNet(get, set);
          } else {
            clearPendingFinalTimers();
          }
        } else {
          // No message body in final event (e.g., lifecycle:end from Gateway).
          // Promote the current streamingMessage to the message history instead
          // of waiting 8s for the safety net timeout.
          //
          // DEFENSIVE CHECK: If `sending` is already false, a real final event
          // (with full message body) already resolved this run via the `if (finalMsg)`
          // branch above. In that case, skip the promote to avoid overwriting the
          // complete message with a potentially truncated streamingMessage snapshot.
          const { streamingMessage: sm, sending: stillSending } = get();
          if (!stillSending) {
            // Run already resolved by a real final event — nothing to do.
            // Clear any leftover streaming state just in case.
            set({ streamingText: '', streamingMessage: null, pendingFinal: false });
            clearPendingFinalTimers();
            // MULTI-MESSAGE FIX: Still mark the run as completed here.
            // Since we moved markRunCompleted() out of the "final with message body"
            // branch (to allow multiple messages per run), lifecycle:end is now the
            // sole place that marks a run completed. We must do it even when
            // sending is already false to block any further late-arriving events.
            if (runId) {
              markRunCompleted(runId);
            }
            break;
          }
          if (sm && typeof sm === 'object') {
            const promoted = sm as RawMessage;
            const promotedId =
              promoted.id ||
              `run-${runId || 'unknown'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

            clearPendingFinalTimers();
            // Mark run completed BEFORE the set() call so that any late events
            // arriving synchronously or on the next microtask are blocked.
            if (runId) {
              markRunCompleted(runId);
            }
            set((s) => {
              const alreadyExists = s.messages.some((m) => m.id === promotedId);
              // Snapshot tool statuses before clearing so promoted message
              // retains them for ToolStatusBar rendering in ChatMessage.
              const toolSnapshot = s.streamingTools.length > 0 ? s.streamingTools : undefined;
              if (alreadyExists) {
                return {
                  streamingText: '',
                  streamingMessage: null,
                  sending: false,
                  activeRunId: null,
                  pendingFinal: false,
                  streamingTools: [],
                  lastUserMessageAt: null,
                };
              }
              return {
                messages: [
                  ...s.messages,
                  {
                    ...promoted,
                    role: promoted.role || 'assistant',
                    id: promotedId,
                    _toolStatuses: toolSnapshot,
                  },
                ],
                streamingText: '',
                streamingMessage: null,
                sending: false,
                activeRunId: null,
                pendingFinal: false,
                streamingTools: [],
                lastUserMessageAt: null,
              };
            });

            // Persist the promoted message to local store (non-blocking)
            const currentSessionKey = get().currentSessionKey;
            if (currentSessionKey) {
              const finalContent =
                typeof promoted.content === 'string'
                  ? promoted.content
                  : JSON.stringify(promoted.content);
              window.electron.ipcRenderer
                .invoke('chatMessage:save', {
                  id: promotedId,
                  sessionKey: currentSessionKey,
                  role: promoted.role || 'assistant',
                  content: finalContent,
                  timestamp: Date.now(),
                  raw: promoted,
                })
                .catch((err: unknown) =>
                  console.debug('[handleChatEvent] Failed to persist promoted message:', err)
                );
            }
          } else {
            // No streamingMessage either — fall back to reload history
            set({ streamingText: '', streamingMessage: null, pendingFinal: true });
            get().loadHistory();
            schedulePendingFinalSafetyNet(get, set);
          }
        }
        break;
      }
      case 'error': {
        const errorMsg = String(event.errorMessage || 'An error occurred');
        clearPendingFinalTimers();
        set({
          error: errorMsg,
          sending: false,
          activeRunId: null,
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          pendingFinal: false,
          lastUserMessageAt: null,
        });
        break;
      }
      case 'aborted': {
        clearPendingFinalTimers();
        set({
          sending: false,
          activeRunId: null,
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          pendingFinal: false,
          lastUserMessageAt: null,
        });
        break;
      }
      default: {
        // Unknown or empty state — if we're currently sending and receive an event
        // with a message, attempt to process it as streaming data. This handles
        // edge cases where the Gateway sends events without a state field.
        const { sending } = get();
        if (sending && event.message && typeof event.message === 'object') {
          console.warn(
            `[handleChatEvent] Unknown event state "${resolvedState}", treating message as streaming delta. Event keys:`,
            Object.keys(event)
          );
          const updates = collectToolUpdates(event.message, 'delta');
          set((s) => ({
            streamingMessage: event.message ?? s.streamingMessage,
            streamingTools:
              updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
          }));
        }
        break;
      }
    }
  },

  // ── Toggle thinking visibility ──

  toggleThinking: () => set((s) => ({ showThinking: !s.showThinking })),

  // ── Refresh: reload history + sessions ──

  refresh: async () => {
    const { loadHistory, loadSessions } = get();
    await Promise.all([loadHistory(), loadSessions()]);
  },

  clearError: () => set({ error: null }),
}));
