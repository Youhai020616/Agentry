/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 *
 * Now includes a ConversationList sidebar for chat history management.
 * Users can:
 * - View past conversations in a collapsible sidebar
 * - Create new conversations that are persisted
 * - Switch between conversations
 * - The first user message auto-titles the conversation
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ChevronDown,
  ChevronUp,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useConversationsStore } from '@/stores/conversations';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatToolbar } from './ChatToolbar';
import { WelcomeScreen } from './WelcomeScreen';
import { ConversationList } from '@/components/chat/ConversationList';
import { LightRays } from '@/components/chat/LightRays';
import { extractImages, extractText, extractThinking, extractToolUse } from './message-utils';
import { useTranslation } from 'react-i18next';
import type { Conversation } from '@/types/conversation';

interface ChatProps {
  /** When true, session is managed externally (e.g. by EmployeeChat). Skips loadSessions to avoid overwriting the bound session key. */
  externalSession?: boolean;
  /** Employee name — shown in welcome screen when in employee chat mode */
  employeeName?: string;
  /** Employee avatar emoji — shown in welcome screen when in employee chat mode */
  employeeAvatar?: string;
  /** Employee avatar image path — shown in welcome screen when available */
  employeeAvatarImage?: string;
  /** Employee ID — used to filter conversation history */
  employeeId?: string;
  /** Hide the conversation history sidebar */
  hideHistory?: boolean;
  /** Hide the toolbar row (when toolbar is rendered externally, e.g. Supervisor top bar) */
  hideToolbar?: boolean;
  /** Hide the LightRays background (when parent already provides it, e.g. Supervisor) */
  hideBackground?: boolean;
}

export function Chat({
  externalSession,
  employeeName,
  employeeAvatar,
  employeeAvatarImage,
  employeeId,
  hideHistory = false,
  hideToolbar = false,
  hideBackground = false,
}: ChatProps = {}) {
  const { t } = useTranslation('chat');
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const showThinking = useChatStore((s) => s.showThinking);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingTools = useChatStore((s) => s.streamingTools);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const loadHistory = useChatStore((s) => s.loadHistory);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);

  // Conversation history integration
  const recordActivity = useConversationsStore((s) => s.recordActivity);
  const autoTitleFromMessage = useConversationsStore((s) => s.autoTitleFromMessage);
  const findBySessionKey = useConversationsStore((s) => s.findBySessionKey);
  const getOrCreateForEmployee = useConversationsStore((s) => s.getOrCreateForEmployee);
  const getOrCreateForSupervisor = useConversationsStore((s) => s.getOrCreateForSupervisor);
  const loadConversations = useConversationsStore((s) => s.loadConversations);
  const setActiveConversation = useConversationsStore((s) => s.setActiveConversation);

  const toggleThinking = useChatStore((s) => s.toggleThinking);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [streamingTimestamp, setStreamingTimestamp] = useState<number>(0);
  const [historyCollapsed, setHistoryCollapsed] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Track whether we've initialized the conversation for this session
  const initializedSessionRef = useRef<string | null>(null);

  // Determine if we should show history sidebar
  const showHistory = !hideHistory && isGatewayRunning;

  // Load data when gateway is running
  useEffect(() => {
    if (!isGatewayRunning) return;
    let cancelled = false;
    (async () => {
      // When session is externally managed (e.g. EmployeeChat), skip loadSessions
      // to avoid overwriting the bound session key with the default session.
      if (!externalSession) {
        await loadSessions();
      }
      if (cancelled) return;
      await loadHistory();

      // Load conversation history
      if (showHistory) {
        await loadConversations({
          employeeId,
          participantType: employeeId ? 'employee' : 'supervisor',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isGatewayRunning,
    loadHistory,
    loadSessions,
    externalSession,
    showHistory,
    employeeId,
    loadConversations,
  ]);

  // Auto-create conversation record when session becomes active
  useEffect(() => {
    if (!isGatewayRunning || !currentSessionKey) return;
    if (initializedSessionRef.current === currentSessionKey) return;
    initializedSessionRef.current = currentSessionKey;

    // Check if a conversation already exists for this session
    const existing = findBySessionKey(currentSessionKey);
    if (existing) {
      setActiveConversation(existing.id);
      return;
    }

    // Auto-create a conversation record for the current session
    (async () => {
      try {
        if (employeeId && employeeName) {
          await getOrCreateForEmployee(
            employeeId,
            employeeName,
            employeeAvatar,
            currentSessionKey,
            employeeAvatarImage
          );
        } else {
          await getOrCreateForSupervisor(currentSessionKey);
        }
      } catch (err) {
        console.warn('[Chat] Failed to auto-create conversation:', err);
      }
    })();
  }, [
    isGatewayRunning,
    currentSessionKey,
    employeeId,
    employeeName,
    employeeAvatar,
    employeeAvatarImage,
    findBySessionKey,
    getOrCreateForEmployee,
    getOrCreateForSupervisor,
    setActiveConversation,
  ]);

  // Track session switches to use instant scroll instead of smooth
  const sessionSwitchedAtRef = useRef(0);
  const prevSessionKeyRef = useRef(currentSessionKey);
  useEffect(() => {
    if (currentSessionKey !== prevSessionKeyRef.current) {
      prevSessionKeyRef.current = currentSessionKey;
      // Mark: "a session switch just happened" — keep this flag for 500ms
      // so that when loadHistory() fills messages, the scroll effect uses instant
      sessionSwitchedAtRef.current = Date.now();
    }
  }, [currentSessionKey]);

  // Auto-scroll: instant after session switch, smooth for new messages
  useEffect(() => {
    const recentSwitch = Date.now() - sessionSwitchedAtRef.current < 500;

    requestAnimationFrame(() => {
      if (recentSwitch) {
        // Session just switched — jump to bottom instantly (no animation)
        messagesContainerRef.current?.scrollTo({
          top: messagesContainerRef.current.scrollHeight,
          behavior: 'instant' as ScrollBehavior,
        });
      } else {
        // Same session, new message — smooth scroll
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }, [messages, streamingMessage, sending]);

  // Track scroll position for "scroll to bottom" button
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const scrolledToBottom = scrollHeight - scrollTop - clientHeight < 50;
    setIsAtBottom(scrolledToBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesContainerRef.current?.scrollTo({
      top: messagesContainerRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, []);

  // Build a map of toolCallId → tool result content from toolresult messages
  // so ToolCard renderers can display the output of each tool invocation.
  const toolResultsMap = useMemo(() => {
    const map = new Map<string, unknown>();
    for (const msg of messages) {
      const role = typeof msg.role === 'string' ? msg.role.toLowerCase() : '';
      if (role === 'toolresult' || role === 'tool_result') {
        const id = msg.toolCallId;
        if (id) {
          map.set(id, msg.content);
        }
      }
    }
    return map;
  }, [messages]);

  // Cmd+E / Ctrl+E shortcut to toggle thinking
  // Cmd+Shift+K: copy the last assistant message to clipboard
  // Cmd+Shift+D: delete current session (with confirm dialog)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      // Cmd+E — toggle thinking
      if (e.key.toLowerCase() === 'e' && !e.shiftKey) {
        e.preventDefault();
        toggleThinking();
        return;
      }

      // Cmd+Shift+K — copy last assistant message
      if (e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
        if (lastAssistant) {
          const text = extractText(lastAssistant);
          if (text) {
            navigator.clipboard.writeText(text).catch(() => {
              // clipboard not available
            });
          }
        }
        return;
      }

      // Cmd+Shift+D — delete current conversation (with confirmation)
      if (e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const conv = findBySessionKey(currentSessionKey);
        if (conv) {
          const confirmed = window.confirm(t('history.deleteConfirm'));
          if (confirmed) {
            const deleteConversation = useConversationsStore.getState().deleteConversation;
            deleteConversation(conv.id).catch(() => {
              // ignore
            });
            // Start a fresh session
            newSession();
          }
        }
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleThinking, messages, findBySessionKey, currentSessionKey, t, newSession]);

  // Update timestamp when sending starts
  useEffect(() => {
    if (sending && streamingTimestamp === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStreamingTimestamp(Date.now() / 1000);
    } else if (!sending && streamingTimestamp !== 0) {
      setStreamingTimestamp(0);
    }
  }, [sending, streamingTimestamp]);

  // Handle sending a message — wraps the store's sendMessage to also record
  // conversation activity and auto-title.
  const handleSendMessage = useCallback(
    async (
      text: string,
      attachments?: Array<{
        fileName: string;
        mimeType: string;
        fileSize: number;
        stagedPath: string;
        preview: string | null;
      }>
    ) => {
      // Send the message via the chat store
      await sendMessage(text, attachments);

      // Record activity in conversation history
      const conv = findBySessionKey(currentSessionKey);
      if (conv) {
        // Record the user's message as activity
        await recordActivity(conv.id, text.trim().slice(0, 120), true);

        // Auto-title from the first user message if title is generic
        if (conv.messageCount === 0 || conv.title === 'New Chat') {
          await autoTitleFromMessage(conv.id, text);
        }
      }
    },
    [sendMessage, findBySessionKey, currentSessionKey, recordActivity, autoTitleFromMessage]
  );

  // Handle selecting a conversation from the history
  const handleSelectConversation = useCallback(
    (conversation: Conversation) => {
      switchSession(conversation.sessionKey);
      setActiveConversation(conversation.id);
    },
    [switchSession, setActiveConversation]
  );

  // Handle creating a new conversation
  const handleNewConversation = useCallback(async () => {
    // Create a new session in the chat store
    newSession();

    // Wait a tick for the session key to update
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Get the new session key from the store
    const newSessionKey = useChatStore.getState().currentSessionKey;

    // Reset the initialized ref so the auto-create effect runs
    initializedSessionRef.current = null;

    try {
      if (employeeId && employeeName) {
        await getOrCreateForEmployee(
          employeeId,
          employeeName,
          employeeAvatar,
          newSessionKey,
          employeeAvatarImage
        );
      } else {
        await getOrCreateForSupervisor(newSessionKey);
      }
    } catch (err) {
      console.warn('[Chat] Failed to create conversation for new session:', err);
    }

    // Reload conversation list
    await loadConversations({
      employeeId,
      participantType: employeeId ? 'employee' : undefined,
    });
  }, [
    newSession,
    employeeId,
    employeeName,
    employeeAvatar,
    employeeAvatarImage,
    getOrCreateForEmployee,
    getOrCreateForSupervisor,
    loadConversations,
  ]);

  // Gateway not running
  if (!isGatewayRunning) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center text-center p-8"
        style={{
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          WebkitFontSmoothing: 'auto',
        }}
      >
        <AlertCircle className="h-12 w-12 text-yellow-500 mb-4" />
        <h2 className="text-xl font-semibold mb-2">{t('gatewayNotRunning')}</h2>
        <p className="text-muted-foreground max-w-md">{t('gatewayRequired')}</p>
      </div>
    );
  }

  // Extract streaming text for display
  const streamMsg =
    streamingMessage && typeof streamingMessage === 'object'
      ? (streamingMessage as unknown as { role?: string; content?: unknown; timestamp?: number })
      : null;
  const streamText = streamMsg
    ? extractText(streamMsg)
    : typeof streamingMessage === 'string'
      ? streamingMessage
      : '';
  const hasStreamText = streamText.trim().length > 0;
  const streamThinking = streamMsg ? extractThinking(streamMsg) : null;
  const hasStreamThinking = showThinking && !!streamThinking && streamThinking.trim().length > 0;
  const streamTools = streamMsg ? extractToolUse(streamMsg) : [];
  const hasStreamTools = streamTools.length > 0;
  const streamImages = streamMsg ? extractImages(streamMsg) : [];
  const hasStreamImages = streamImages.length > 0;
  const hasStreamToolStatus = streamingTools.length > 0;
  const shouldRenderStreaming =
    sending &&
    (hasStreamText ||
      hasStreamThinking ||
      hasStreamTools ||
      hasStreamImages ||
      hasStreamToolStatus);

  return (
    <div
      className={cn(
        'flex',
        externalSession
          ? 'h-full overflow-hidden'
          : '-mx-4 -my-3 h-[calc(100%+1.5rem)] overflow-hidden rounded-2xl bg-background'
      )}
      style={{
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        WebkitFontSmoothing: 'auto',
        MozOsxFontSmoothing: 'grayscale',
      }}
    >
      {/* Conversation History Sidebar */}
      {showHistory && (
        <ConversationList
          employeeId={employeeId}
          supervisorOnly={!employeeId}
          onSelect={handleSelectConversation}
          onNewConversation={handleNewConversation}
          activeSessionKey={currentSessionKey}
          collapsed={historyCollapsed}
          onToggleCollapse={() => setHistoryCollapsed(!historyCollapsed)}
        />
      )}

      {/* Main Chat Area */}
      <div className="flex flex-1 flex-col min-w-0 relative overflow-hidden">
        {/* WebGL animated light rays background — skipped when parent provides its own */}
        {!hideBackground && <LightRays className="z-0" />}

        {/* Toolbar — hidden when rendered externally (e.g. Supervisor top bar) */}
        {!hideToolbar && (
          <div className="relative z-[2] flex shrink-0 items-center justify-end px-4 py-2 border-b border-border/40">
            <ChatToolbar hideSessionSelector={externalSession || showHistory} />
          </div>
        )}

        {/* Messages Area */}
        <div className="relative flex-1 min-h-0 z-[2]">
          <div
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="absolute inset-0 overflow-y-auto no-scrollbar px-4 pt-4 pb-10"
          >
            <div className="relative max-w-4xl mx-auto space-y-4">
              {loading ? (
                <div className="flex h-full items-center justify-center py-20">
                  <LoadingSpinner size="lg" />
                </div>
              ) : messages.length === 0 && !sending ? (
                <WelcomeScreen
                  employeeName={employeeName}
                  employeeAvatar={employeeAvatar}
                  employeeAvatarImage={employeeAvatarImage}
                />
              ) : (
                <>
                  {messages.map((msg, idx) => (
                    <ChatMessage
                      key={msg.id || `msg-${idx}`}
                      message={msg}
                      showThinking={showThinking}
                      toolResultsMap={toolResultsMap}
                    />
                  ))}

                  {/* Streaming message */}
                  {shouldRenderStreaming && (
                    <ChatMessage
                      message={
                        (streamMsg
                          ? {
                              ...(streamMsg as Record<string, unknown>),
                              role: (typeof streamMsg.role === 'string'
                                ? streamMsg.role
                                : 'assistant') as RawMessage['role'],
                              content: streamMsg.content ?? streamText,
                              timestamp: streamMsg.timestamp ?? streamingTimestamp,
                            }
                          : {
                              role: 'assistant',
                              content: streamText,
                              timestamp: streamingTimestamp,
                            }) as RawMessage
                      }
                      showThinking={showThinking}
                      isStreaming
                      streamingTools={streamingTools}
                    />
                  )}

                  {/* Typing indicator when sending but no stream yet */}
                  {sending &&
                    !hasStreamText &&
                    !hasStreamThinking &&
                    !hasStreamTools &&
                    !hasStreamImages &&
                    !hasStreamToolStatus && <TypingIndicator />}
                </>
              )}

              {/* Scroll anchor */}
              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>

        {/* Scroll to bottom button */}
        <div className="relative z-[3] flex justify-center -mt-12 pointer-events-none">
          <ScrollToBottomButton
            show={!isAtBottom && messages.length > 0}
            onClick={scrollToBottom}
          />
        </div>

        {/* Expandable Error Bar */}
        <AnimatePresence>
          {error && <ErrorBar error={error} onDismiss={clearError} />}
        </AnimatePresence>

        {/* Input Area — above LightRays */}
        <div className="relative z-[2]">
          <ChatInput
            onSend={handleSendMessage}
            onStop={abortRun}
            disabled={!isGatewayRunning}
            sending={sending}
          />
        </div>
      </div>
    </div>
  );
}

// ── Expandable Error Bar ─────────────────────────────────────────

const ERROR_TRUNCATE_LENGTH = 200;

function ErrorBar({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  const { t } = useTranslation('chat');
  const [isExpanded, setIsExpanded] = useState(false);
  const isTruncatable = error.length > ERROR_TRUNCATE_LENGTH;
  const displayedError = isExpanded ? error : error.slice(0, ERROR_TRUNCATE_LENGTH);

  return (
    <motion.div
      className="relative z-[2] px-4 py-3 bg-destructive/10 border-t border-destructive/20"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25, ease: 'easeInOut' }}
    >
      <div className="max-w-4xl mx-auto">
        <div className="flex items-start gap-3">
          <div className="p-1.5 bg-destructive/10 rounded-md shrink-0 mt-0.5">
            <TriangleAlert className="h-3.5 w-3.5 text-destructive" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm text-destructive mb-1">{t('error.title')}</p>
            <div className="text-sm text-muted-foreground">
              <p className="whitespace-pre-wrap break-words">
                {displayedError}
                {isTruncatable && !isExpanded && '...'}
              </p>
              {isTruncatable && (
                <Button
                  onClick={() => setIsExpanded(!isExpanded)}
                  variant="ghost"
                  size="sm"
                  className="h-auto p-1 text-xs mt-1"
                >
                  {isExpanded ? (
                    <>
                      <ChevronUp className="h-3 w-3 mr-1" />
                      {t('error.showLess')}
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3 mr-1" />
                      {t('error.showMore')}
                    </>
                  )}
                </Button>
              )}
              <p className="text-xs text-muted-foreground/60 mt-2 italic">{t('error.notSaved')}</p>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="text-xs text-destructive/60 hover:text-destructive underline shrink-0 mt-1"
          >
            {t('common:actions.dismiss')}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Scroll To Bottom Button ──────────────────────────────────────

function ScrollToBottomButton({ show, onClick }: { show: boolean; onClick: () => void }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="pointer-events-auto"
        >
          <Button
            onClick={onClick}
            className="shadow-lg backdrop-blur-sm border transition-colors"
            size="icon"
            variant="ghost"
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Typing Indicator ────────────────────────────────────────────

function TypingIndicator() {
  const { t } = useTranslation('chat');

  return (
    <motion.div
      className="flex gap-3"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-600/20 text-primary backdrop-blur-sm">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="glass-typing rounded-2xl px-4 py-3 backdrop-blur-md bg-card/50 glass-border shadow-island">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground/70">{t('typing.thinking')}</span>
          <div className="flex gap-1">
            <motion.span
              className="w-1.5 h-1.5 bg-primary/50 rounded-full"
              animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }}
              transition={{ duration: 1.4, repeat: Infinity, delay: 0 }}
            />
            <motion.span
              className="w-1.5 h-1.5 bg-primary/50 rounded-full"
              animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }}
              transition={{ duration: 1.4, repeat: Infinity, delay: 0.2 }}
            />
            <motion.span
              className="w-1.5 h-1.5 bg-primary/50 rounded-full"
              animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }}
              transition={{ duration: 1.4, repeat: Infinity, delay: 0.4 }}
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
