/**
 * ConversationList Component
 * Renders a scrollable list of past conversations (chat history) in a sidebar panel.
 * Supports:
 * - Viewing conversation history per employee or supervisor
 * - Creating new conversations
 * - Switching between conversations
 * - Renaming, pinning, archiving, and deleting conversations
 * - Search filtering
 * - Auto-loading on mount
 * - Resizable panel width via drag handle
 */
import { useEffect, useState, useCallback, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MessageSquarePlus,
  Search,
  Pin,
  PinOff,
  Trash2,
  Archive,
  ArchiveRestore,
  Pencil,
  Check,
  X,
  MoreHorizontal,
  MessageSquare,
  Clock,
  PanelRight,
  PanelRightClose,
  GripVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useConversationsStore } from '@/stores/conversations';
import type { Conversation, ConversationId } from '@/types/conversation';

// ── Constants ──────────────────────────────────────────────────

const MIN_WIDTH = 160;
const MAX_WIDTH = 320;
const DEFAULT_WIDTH = 220;
const COLLAPSE_THRESHOLD = 140;
const STORAGE_KEY = 'agentry:history-panel-width';

// ── Types ──────────────────────────────────────────────────────

interface ConversationListProps {
  /** Filter conversations to a specific employee */
  employeeId?: string;
  /** Filter to supervisor conversations only */
  supervisorOnly?: boolean;
  /** Called when user selects a conversation (switches session) */
  onSelect?: (conversation: Conversation) => void;
  /** Called when user creates a new conversation */
  onNewConversation?: () => void;
  /** Currently active session key (to highlight) */
  activeSessionKey?: string;
  /** Whether the panel is collapsed */
  collapsed?: boolean;
  /** Toggle collapse callback */
  onToggleCollapse?: () => void;
  /** Additional class names */
  className?: string;
}

// ── Helpers ────────────────────────────────────────────────────

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  const date = new Date(timestamp);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}/${day}`;
}

/** Group conversations by date category */
function groupByDate(conversations: Conversation[]): Map<string, Conversation[]> {
  const groups = new Map<string, Conversation[]>();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const weekAgo = today - 7 * 86400000;
  const monthAgo = today - 30 * 86400000;

  for (const conv of conversations) {
    let group: string;
    if (conv.updatedAt >= today) {
      group = 'Today';
    } else if (conv.updatedAt >= yesterday) {
      group = 'Yesterday';
    } else if (conv.updatedAt >= weekAgo) {
      group = 'This Week';
    } else if (conv.updatedAt >= monthAgo) {
      group = 'This Month';
    } else {
      group = 'Older';
    }

    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group)!.push(conv);
  }

  return groups;
}

/** Load persisted width from localStorage */
function loadPersistedWidth(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const w = parseInt(stored, 10);
      if (!isNaN(w) && w >= MIN_WIDTH && w <= MAX_WIDTH) return w;
    }
  } catch {
    // ignore
  }
  return DEFAULT_WIDTH;
}

/** Save width to localStorage */
function persistWidth(width: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // ignore
  }
}

// ── Resize Hook ────────────────────────────────────────────────

function useResizable(options: {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  collapseThreshold: number;
  onCollapse?: () => void;
}) {
  const { defaultWidth, minWidth, maxWidth, collapseThreshold, onCollapse } = options;
  const [width, setWidth] = useState(defaultWidth);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      setIsDragging(true);
    },
    [width]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const delta = e.clientX - startXRef.current;
      const newWidth = startWidthRef.current + delta;

      if (newWidth < collapseThreshold) {
        // Auto-collapse when dragged below threshold
        setIsDragging(false);
        onCollapse?.();
        return;
      }

      const clamped = Math.max(minWidth, Math.min(maxWidth, newWidth));
      setWidth(clamped);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      // Persist when drag ends
      persistWidth(width);
    };

    // Apply cursor style to entire document during drag
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, width, minWidth, maxWidth, collapseThreshold, onCollapse]);

  const handleDoubleClick = useCallback(() => {
    setWidth(DEFAULT_WIDTH);
    persistWidth(DEFAULT_WIDTH);
  }, []);

  return { width, isDragging, handleMouseDown, handleDoubleClick, setWidth };
}

// ── Sub-components ──────────────────────────────────────────────

/** Drag handle rendered on the right edge of the panel */
function ResizeHandle({
  isDragging,
  onMouseDown,
  onDoubleClick,
}: {
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}) {
  return (
    <div
      className={cn(
        'absolute right-0 top-0 bottom-0 z-10 flex w-[6px] cursor-col-resize items-center justify-center',
        'transition-colors duration-150',
        'group/handle',
        isDragging ? 'bg-primary/20' : 'hover:bg-primary/10'
      )}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize history panel"
    >
      {/* Visual grip indicator — appears on hover or while dragging */}
      <div
        className={cn(
          'flex h-8 w-[4px] items-center justify-center rounded-full transition-opacity duration-150',
          isDragging
            ? 'opacity-100 bg-primary/30'
            : 'opacity-0 group-hover/handle:opacity-100 bg-muted-foreground/20'
        )}
      >
        <GripVertical className="h-3 w-3 text-muted-foreground/60" />
      </div>
    </div>
  );
}

/** Context menu for a conversation item */
function ConversationContextMenu({
  conversation,
  onRename,
  onTogglePin,
  onArchive,
  onDelete,
  onClose,
}: {
  conversation: Conversation;
  onRename: () => void;
  onTogglePin: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className={cn(
        'absolute right-0 top-full z-50 mt-1',
        'min-w-[160px] rounded-lg border border-border/60 bg-popover/80 backdrop-blur-xl p-1 shadow-lg'
      )}
    >
      <button
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent"
        onClick={(e) => {
          e.stopPropagation();
          onRename();
          onClose();
        }}
      >
        <Pencil className="h-3 w-3" />
        Rename
      </button>
      <button
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
          onClose();
        }}
      >
        {conversation.pinned ? (
          <>
            <PinOff className="h-3 w-3" />
            Unpin
          </>
        ) : (
          <>
            <Pin className="h-3 w-3" />
            Pin
          </>
        )}
      </button>
      <button
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent"
        onClick={(e) => {
          e.stopPropagation();
          onArchive();
          onClose();
        }}
      >
        {conversation.archived ? (
          <>
            <ArchiveRestore className="h-3 w-3" />
            Unarchive
          </>
        ) : (
          <>
            <Archive className="h-3 w-3" />
            Archive
          </>
        )}
      </button>
      <div className="my-1 h-px bg-border" />
      <button
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
          onClose();
        }}
      >
        <Trash2 className="h-3 w-3" />
        Delete
      </button>
    </div>
  );
}

/** Single conversation item */
const ConversationItem = memo(function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onRename,
  onTogglePin,
  onArchive,
  onDelete,
}: {
  conversation: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onRename: (id: ConversationId, title: string) => void;
  onTogglePin: (id: ConversationId) => void;
  onArchive: (id: ConversationId) => void;
  onDelete: (id: ConversationId) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(conversation.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSaveRename = useCallback(() => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== conversation.title) {
      onRename(conversation.id, trimmed);
    }
    setIsEditing(false);
  }, [editTitle, conversation.id, conversation.title, onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSaveRename();
      } else if (e.key === 'Escape') {
        setEditTitle(conversation.title);
        setIsEditing(false);
      }
    },
    [handleSaveRename, conversation.title]
  );

  return (
    <div
      className={cn(
        'group relative flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5',
        'transition-all duration-150',
        isActive ? 'bg-input text-foreground' : 'text-foreground/80 hover:bg-input'
      )}
      onClick={onSelect}
    >
      {/* Icon */}
      <MessageSquare
        className={cn(
          'mt-0.5 h-3.5 w-3.5 shrink-0',
          isActive ? 'text-primary' : 'text-muted-foreground'
        )}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSaveRename}
              className={cn(
                'w-full rounded border border-border bg-background px-1.5 py-0.5',
                'text-xs focus:outline-none focus:ring-1 focus:ring-ring'
              )}
              onClick={(e) => e.stopPropagation()}
            />
            <button
              className="shrink-0 rounded p-0.5 hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation();
                handleSaveRename();
              }}
            >
              <Check className="h-3 w-3 text-green-500" />
            </button>
            <button
              className="shrink-0 rounded p-0.5 hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation();
                setEditTitle(conversation.title);
                setIsEditing(false);
              }}
            >
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          </div>
        ) : (
          <>
            {/* Title + timestamp on same line */}
            <div className="flex items-center gap-1">
              {conversation.pinned && <Pin className="h-2.5 w-2.5 shrink-0 text-amber-500" />}
              <p className="flex-1 truncate text-xs font-medium leading-tight">
                {conversation.title}
              </p>
              <span className="shrink-0 text-[10px] text-muted-foreground/60">
                {formatRelativeTime(conversation.updatedAt)}
              </span>
            </div>

            {/* Preview (if available) */}
            {conversation.lastMessagePreview && (
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground leading-tight">
                {conversation.lastMessagePreview}
              </p>
            )}
          </>
        )}
      </div>

      {/* Context menu trigger */}
      {!isEditing && (
        <div className="relative">
          <button
            className={cn(
              'shrink-0 rounded p-0.5 opacity-0 transition-opacity duration-150',
              'group-hover:opacity-100 hover:bg-accent',
              showMenu && 'opacity-100'
            )}
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
          >
            <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          {showMenu && (
            <ConversationContextMenu
              conversation={conversation}
              onRename={() => {
                setEditTitle(conversation.title);
                setIsEditing(true);
              }}
              onTogglePin={() => onTogglePin(conversation.id)}
              onArchive={() => onArchive(conversation.id)}
              onDelete={() => onDelete(conversation.id)}
              onClose={() => setShowMenu(false)}
            />
          )}
        </div>
      )}
    </div>
  );
});

// ── Main Component ──────────────────────────────────────────────

export function ConversationList({
  employeeId,
  supervisorOnly,
  onSelect,
  onNewConversation,
  activeSessionKey,
  collapsed = false,
  onToggleCollapse,
  className,
}: ConversationListProps) {
  const { t } = useTranslation('chat');

  const conversations = useConversationsStore((s) => s.conversations);
  const loading = useConversationsStore((s) => s.loading);
  const loadConversations = useConversationsStore((s) => s.loadConversations);
  const updateConversation = useConversationsStore((s) => s.updateConversation);
  const deleteConversation = useConversationsStore((s) => s.deleteConversation);
  const togglePin = useConversationsStore((s) => s.togglePin);
  const archiveConversation = useConversationsStore((s) => s.archiveConversation);
  const unarchiveConversation = useConversationsStore((s) => s.unarchiveConversation);

  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  // Resizable panel
  const { width, isDragging, handleMouseDown, handleDoubleClick } = useResizable({
    defaultWidth: loadPersistedWidth(),
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH,
    collapseThreshold: COLLAPSE_THRESHOLD,
    onCollapse: onToggleCollapse,
  });

  // Load conversations on mount and when filters change
  useEffect(() => {
    loadConversations({
      employeeId,
      participantType: supervisorOnly ? 'supervisor' : employeeId ? 'employee' : undefined,
      search: searchQuery || undefined,
    });
  }, [employeeId, supervisorOnly, searchQuery, loadConversations]);

  // Handlers
  const handleRename = useCallback(
    async (id: ConversationId, title: string) => {
      await updateConversation(id, { title });
    },
    [updateConversation]
  );

  const handleTogglePin = useCallback(
    async (id: ConversationId) => {
      await togglePin(id);
    },
    [togglePin]
  );

  const handleArchive = useCallback(
    async (id: ConversationId) => {
      const conv = conversations.find((c) => c.id === id);
      if (!conv) return;
      if (conv.archived) {
        await unarchiveConversation(id);
      } else {
        await archiveConversation(id);
      }
    },
    [conversations, archiveConversation, unarchiveConversation]
  );

  const handleDelete = useCallback(
    async (id: ConversationId) => {
      await deleteConversation(id);
    },
    [deleteConversation]
  );

  // Group conversations by date
  const grouped = groupByDate(conversations);

  // Collapsed view — just show toggle button and mini conversation indicators
  if (collapsed) {
    return (
      <div
        className={cn(
          'flex flex-col items-center gap-2 py-2 px-1',
          'border-r border-border/80 bg-background/50 backdrop-blur-md',
          className
        )}
      >
        {onToggleCollapse && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg text-muted-foreground/60 hover:text-foreground"
            onClick={onToggleCollapse}
          >
            <PanelRight className="h-4 w-4" />
          </Button>
        )}
        {onNewConversation && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg"
            onClick={onNewConversation}
            title={t('toolbar.newSession', 'New Chat')}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
          </Button>
        )}
        <div className="my-1 h-px w-5 bg-border/60" />
        <div className="flex flex-col items-center gap-1 overflow-y-auto flex-1 no-scrollbar py-1">
          {conversations.slice(0, 10).map((conv) => (
            <button
              key={conv.id}
              className={cn(
                'h-7 w-7 rounded-lg flex items-center justify-center',
                'text-[10px] font-medium transition-colors',
                conv.sessionKey === activeSessionKey
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent/50'
              )}
              onClick={() => onSelect?.(conv)}
              title={conv.title}
            >
              {conv.employeeAvatar || '💬'}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative flex h-full flex-col shrink-0',
        'border-r border-border/80 bg-background/50 backdrop-blur-md',
        isDragging && 'select-none',
        className
      )}
      style={{ width: `${width}px` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border/40">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-foreground/80">
            {t('history.title', 'History')}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-md"
            onClick={() => setShowSearch(!showSearch)}
          >
            <Search className="h-3 w-3" />
          </Button>
          {onNewConversation && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-md"
              onClick={onNewConversation}
              title={t('toolbar.newSession', 'New Chat')}
            >
              <MessageSquarePlus className="h-3 w-3" />
            </Button>
          )}
          {onToggleCollapse && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-md text-muted-foreground/60 hover:text-foreground"
              onClick={onToggleCollapse}
            >
              <PanelRightClose className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Search */}
      {showSearch && (
        <div className="px-1.5 py-1.5 border-b border-border/20">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <input
              type="text"
              placeholder={t('history.search', 'Search chats...')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cn(
                'w-full rounded-md border border-border/50 bg-background',
                'pl-7 pr-2 py-1 text-xs',
                'placeholder:text-muted-foreground/50',
                'focus:outline-none focus:ring-1 focus:ring-ring/50'
              )}
            />
            {searchQuery && (
              <button
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-accent"
                onClick={() => setSearchQuery('')}
              >
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-2 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground/20 mb-2" />
            <p className="text-xs text-muted-foreground/60">
              {searchQuery
                ? t('history.noResults', 'No matching conversations')
                : t('history.empty', 'No conversations yet')}
            </p>
            {!searchQuery && onNewConversation && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 h-7 text-xs gap-1"
                onClick={onNewConversation}
              >
                <MessageSquarePlus className="h-3 w-3" />
                {t('history.startNew', 'Start a chat')}
              </Button>
            )}
          </div>
        ) : (
          Array.from(grouped.entries()).map(([groupLabel, items]) => (
            <div key={groupLabel} className="mb-1.5">
              {/* Group header */}
              <div className="px-2 py-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  {groupLabel}
                </span>
              </div>
              {/* Items */}
              <div className="space-y-px">
                {items.map((conv) => (
                  <ConversationItem
                    key={conv.id}
                    conversation={conv}
                    isActive={conv.sessionKey === activeSessionKey}
                    onSelect={() => onSelect?.(conv)}
                    onRename={handleRename}
                    onTogglePin={handleTogglePin}
                    onArchive={handleArchive}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer stats */}
      {conversations.length > 0 && (
        <div className="border-t border-border/40 px-3 py-1.5">
          <p className="text-[10px] text-muted-foreground/50 text-center">
            {conversations.length} {conversations.length === 1 ? 'conversation' : 'conversations'}
          </p>
        </div>
      )}

      {/* Resize drag handle on right edge */}
      <ResizeHandle
        isDragging={isDragging}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      />
    </div>
  );
}

export default ConversationList;
