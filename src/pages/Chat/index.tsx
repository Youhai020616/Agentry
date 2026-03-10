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
import { useEffect, useRef, useState, useCallback } from 'react';
import { AlertCircle, Bot, MessageSquare, Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useConversationsStore } from '@/stores/conversations';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatToolbar } from './ChatToolbar';
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
  /** Employee ID — used to filter conversation history */
  employeeId?: string;
  /** Hide the conversation history sidebar */
  hideHistory?: boolean;
  /** Hide the toolbar row (when toolbar is rendered externally, e.g. Supervisor top bar) */
  hideToolbar?: boolean;
}

export function Chat({
  externalSession,
  employeeName,
  employeeAvatar,
  employeeId,
  hideHistory = false,
  hideToolbar = false,
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [streamingTimestamp, setStreamingTimestamp] = useState<number>(0);
  const [historyCollapsed, setHistoryCollapsed] = useState(true);

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
          await getOrCreateForEmployee(employeeId, employeeName, employeeAvatar, currentSessionKey);
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
    findBySessionKey,
    getOrCreateForEmployee,
    getOrCreateForSupervisor,
    setActiveConversation,
  ]);

  // Auto-scroll on new messages or streaming
  useEffect(() => {
    // Use rAF to ensure DOM has painted new messages before scrolling
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
  }, [messages, streamingMessage, sending]);

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
        await getOrCreateForEmployee(employeeId, employeeName, employeeAvatar, newSessionKey);
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
  const hasStreamTools = showThinking && streamTools.length > 0;
  const streamImages = streamMsg ? extractImages(streamMsg) : [];
  const hasStreamImages = streamImages.length > 0;
  const hasStreamToolStatus = showThinking && streamingTools.length > 0;
  const shouldRenderStreaming =
    sending &&
    (hasStreamText ||
      hasStreamThinking ||
      hasStreamTools ||
      hasStreamImages ||
      hasStreamToolStatus);

  return (
    <div
      className={cn('flex', externalSession ? 'h-full' : '-m-4 h-[calc(100%+2rem)]')}
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
      <div className="flex flex-1 flex-col min-w-0">
        {/* Toolbar — hidden when rendered externally (e.g. Supervisor top bar) */}
        {!hideToolbar && (
          <div className="flex shrink-0 items-center justify-end px-4 py-2 border-b border-border/40">
            <ChatToolbar hideSessionSelector={externalSession || showHistory} />
          </div>
        )}

        {/* Messages Area — LightRays is outside the scroll container so it stays fixed */}
        <div className="relative flex-1 min-h-0">
          {/* WebGL animated light rays background — fixed behind scrollable content */}
          <LightRays className="z-0" />
          {/* Bottom fade overlay — above LightRays, below messages */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 z-[1] bg-gradient-to-t from-background to-transparent" />
          <div className="absolute inset-0 overflow-y-auto px-4 py-4 z-[2]">
            <div className="relative max-w-4xl mx-auto space-y-4">
              {loading ? (
                <div className="flex h-full items-center justify-center py-20">
                  <LoadingSpinner size="lg" />
                </div>
              ) : messages.length === 0 && !sending ? (
                <WelcomeScreen employeeName={employeeName} employeeAvatar={employeeAvatar} />
              ) : (
                <>
                  {messages.map((msg, idx) => (
                    <ChatMessage
                      key={msg.id || `msg-${idx}`}
                      message={msg}
                      showThinking={showThinking}
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

        {/* Error bar */}
        {error && (
          <div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20">
            <div className="max-w-4xl mx-auto flex items-center justify-between">
              <p className="text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {error}
              </p>
              <button
                onClick={clearError}
                className="text-xs text-destructive/60 hover:text-destructive underline"
              >
                {t('common:actions.dismiss')}
              </button>
            </div>
          </div>
        )}

        {/* Input Area */}
        <ChatInput
          onSend={handleSendMessage}
          onStop={abortRun}
          disabled={!isGatewayRunning}
          sending={sending}
        />
      </div>
    </div>
  );
}

// ── Welcome Screen ──────────────────────────────────────────────

function WelcomeScreen({
  employeeName,
  employeeAvatar,
}: {
  employeeName?: string;
  employeeAvatar?: string;
}) {
  const { t } = useTranslation('chat');
  const isEmployee = !!employeeName;

  return (
    <div className="flex flex-col items-center justify-center text-center py-20">
      {isEmployee ? (
        <div className="w-16 h-16 rounded-2xl bg-card glass-border shadow-island flex items-center justify-center mb-6 text-4xl">
          {employeeAvatar || '🤖'}
        </div>
      ) : (
        <div className="w-16 h-16 rounded-2xl bg-card glass-border shadow-island flex items-center justify-center mb-6">
          <Bot className="h-8 w-8 text-primary" />
        </div>
      )}
      <h2 className="text-2xl font-bold mb-2">{isEmployee ? employeeName : t('welcome.title')}</h2>
      <p className="text-muted-foreground mb-8 max-w-md">
        {isEmployee ? t('welcome.employeeSubtitle') : t('welcome.subtitle')}
      </p>

      {!isEmployee && (
        <div className="grid grid-cols-2 gap-4 max-w-lg w-full">
          {[
            {
              icon: MessageSquare,
              title: t('welcome.askQuestions'),
              desc: t('welcome.askQuestionsDesc'),
            },
            {
              icon: Sparkles,
              title: t('welcome.creativeTasks'),
              desc: t('welcome.creativeTasksDesc'),
            },
          ].map((item, i) => (
            <Card key={i} className="text-left rounded-2xl glass-border shadow-island">
              <CardContent className="p-4">
                <item.icon className="h-6 w-6 text-primary mb-2" />
                <h3 className="font-medium">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Typing Indicator ────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-600/20 text-primary backdrop-blur-sm">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="glass-typing rounded-2xl px-4 py-3">
        <div className="flex gap-1">
          <span
            className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
            style={{ animationDelay: '0ms' }}
          />
          <span
            className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
            style={{ animationDelay: '150ms' }}
          />
          <span
            className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
            style={{ animationDelay: '300ms' }}
          />
        </div>
      </div>
    </div>
  );
}
