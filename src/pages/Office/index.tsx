import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Play, Square, RotateCw, ExternalLink, Monitor, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useStarOfficeStore } from '@/stores/star-office';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { cn } from '@/lib/utils';

/** Original Star Office design dimensions */
const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 820; // 720 canvas + 60 chat bar + 40 padding

/** Max text length sent to iframe for display (truncated in bubble) */
const MAX_BUBBLE_TEXT = 500;

export default function Office() {
  const { t } = useTranslation('office');
  const navigate = useNavigate();
  const { status, init, start, stop, restart } = useStarOfficeStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const iframReadyRef = useRef(false);

  // Chat store bindings (Supervisor session)
  const messages = useChatStore((s) => s.messages);
  const sending = useChatStore((s) => s.sending);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const loadHistory = useChatStore((s) => s.loadHistory);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  // Track last message count to detect new messages
  const lastMessageCountRef = useRef(0);
  const lastStreamTextRef = useRef('');
  // When streaming ends, the finalized message will appear in messages[].
  // Skip forwarding it to avoid duplicate bubbles.
  const skipNextAssistantRef = useRef(false);
  const skipNextUserRef = useRef(false);

  useEffect(() => {
    init();
  }, [init]);

  // Load supervisor session when gateway is running
  useEffect(() => {
    if (isGatewayRunning) {
      void loadSessions();
    }
  }, [isGatewayRunning, loadSessions]);

  // Load history when session changes
  useEffect(() => {
    if (currentSessionKey) {
      void loadHistory();
    }
  }, [currentSessionKey, loadHistory]);

  const updateScale = useCallback(() => {
    if (containerRef.current) {
      const cw = containerRef.current.clientWidth;
      setScale(Math.min(1, cw / DESIGN_WIDTH));
    }
  }, []);

  useEffect(() => {
    updateScale();
    const observer = new ResizeObserver(updateScale);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, [updateScale]);

  // ── PostMessage helpers ──
  const postToIframe = useCallback(
    (type: string, payload: unknown) => {
      iframeRef.current?.contentWindow?.postMessage({ type, payload }, '*');
    },
    []
  );

  // ── Listen to iframe messages ──
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data.type !== 'string') return;

      switch (data.type) {
        case 'office:chat:ready':
          iframReadyRef.current = true;
          // Send history to iframe
          _syncHistoryToIframe();
          break;

        case 'office:chat:send': {
          const text = data.payload?.text;
          if (text && !sending) {
            // Skip the next user message from messages[] — iframe already rendered it
            skipNextUserRef.current = true;
            void sendMessage(text);
          }
          break;
        }

        case 'office:chat:navigate':
          // Navigate to supervisor chat page
          navigate('/chat');
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, navigate]);

  // Helper to extract plain text from a message
  const _extractText = useCallback((msg: { content?: unknown }): string => {
    const content = msg.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((p: { type?: string }) => p.type === 'text')
        .map((p: { text?: string }) => p.text || '')
        .join('\n');
    }
    return '';
  }, []);

  // Sync full history to iframe
  const _syncHistoryToIframe = useCallback(() => {
    if (!iframReadyRef.current) return;
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-20) // last 20 messages
      .map((m) => ({
        role: m.role,
        content: _extractText(m).substring(0, MAX_BUBBLE_TEXT),
        timestamp: m.timestamp || Date.now(),
      }));
    postToIframe('office:chat:history', { messages: history });
  }, [messages, postToIframe, _extractText]);

  // ── Forward new messages to iframe ──
  useEffect(() => {
    if (!iframReadyRef.current) return;

    const currentCount = messages.length;
    if (currentCount > lastMessageCountRef.current) {
      // New messages added
      const newMessages = messages.slice(lastMessageCountRef.current);
      for (const msg of newMessages) {
        // Skip messages already rendered in iframe to avoid duplicates:
        // - User messages: iframe renders immediately on send
        // - Assistant messages: iframe renders via streaming
        if (msg.role === 'user' && skipNextUserRef.current) {
          skipNextUserRef.current = false;
          continue;
        }
        if (msg.role === 'assistant' && skipNextAssistantRef.current) {
          skipNextAssistantRef.current = false;
          continue;
        }
        if (msg.role === 'user' || msg.role === 'assistant') {
          postToIframe('office:chat:message', {
            id: msg.id || Date.now().toString(),
            role: msg.role,
            content: _extractText(msg).substring(0, MAX_BUBBLE_TEXT),
            timestamp: msg.timestamp || Date.now(),
          });
        }
      }
    }
    lastMessageCountRef.current = currentCount;
  }, [messages, postToIframe, _extractText]);

  // ── Forward streaming to iframe ──
  useEffect(() => {
    if (!iframReadyRef.current) return;

    if (streamingMessage) {
      const text = _extractText(streamingMessage as Record<string, unknown>);
      const msg = streamingMessage as Record<string, unknown>;
      const delta = text.substring(lastStreamTextRef.current.length);
      if (delta) {
        postToIframe('office:chat:stream', {
          id: (msg.id as string) || 'stream',
          delta,
        });
      }
      lastStreamTextRef.current = text;
    } else if (lastStreamTextRef.current) {
      // Streaming ended — mark to skip the next assistant message from messages[]
      // to avoid duplicate bubbles (stream already rendered it)
      skipNextAssistantRef.current = true;
      postToIframe('office:chat:stream:end', { id: 'stream' });
      lastStreamTextRef.current = '';
    }
  }, [streamingMessage, postToIframe, _extractText]);

  // ── Forward sending status ──
  useEffect(() => {
    if (iframReadyRef.current) {
      postToIframe('office:chat:status', { sending });
    }
  }, [sending, postToIframe]);

  const isRunning = status.state === 'running';
  const isStarting = status.state === 'starting';
  const isStopped = status.state === 'stopped';
  const hasError = status.state === 'error';

  const handleOpenExternal = () => {
    if (status.url) {
      window.electron.openExternal(status.url);
    }
  };

  const statusVariant = isRunning ? 'default' : hasError ? 'destructive' : ('secondary' as const);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Monitor className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">{t('title')}</h1>

        <Badge variant={statusVariant} className="ml-1">
          {t(`status.${status.state}`)}
        </Badge>

        <div className="flex-1" />

        {isStopped && (
          <Button size="sm" variant="default" onClick={start}>
            <Play className="mr-1.5 h-3.5 w-3.5" />
            {t('start')}
          </Button>
        )}

        {isStarting && (
          <Button size="sm" variant="secondary" disabled>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            {t('starting')}
          </Button>
        )}

        {isRunning && (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleOpenExternal}
              title={t('openExternal')}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={restart}>
              <RotateCw className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="destructive" onClick={stop}>
              <Square className="mr-1.5 h-3.5 w-3.5" />
              {t('stop')}
            </Button>
          </>
        )}

        {hasError && (
          <Button size="sm" variant="default" onClick={start}>
            <RotateCw className="mr-1.5 h-3.5 w-3.5" />
            {t('restart')}
          </Button>
        )}
      </div>

      {/* Content */}
      <div ref={containerRef} className="flex-1 overflow-hidden">
        {isRunning && status.url ? (
          <div
            className="relative mx-auto"
            style={{
              width: Math.ceil(DESIGN_WIDTH * scale),
              height: Math.ceil(DESIGN_HEIGHT * scale),
              overflow: 'hidden',
            }}
          >
            <iframe
              ref={iframeRef}
              src={status.url}
              className="border-0"
              style={{
                width: DESIGN_WIDTH,
                height: DESIGN_HEIGHT,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }}
              title={t('iframeTitle')}
              sandbox="allow-scripts allow-same-origin allow-popups allow-modals allow-forms"
            />
          </div>
        ) : (
          <EmptyState state={status.state} error={status.error} onStart={start} t={t} />
        )}
      </div>
    </div>
  );
}

function EmptyState({
  state,
  error,
  onStart,
  t,
}: {
  state: string;
  error?: string;
  onStart: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-muted">
          <Monitor className="h-10 w-10 text-muted-foreground" />
        </div>
        <h2 className="mb-2 text-lg font-semibold">{t('empty.title')}</h2>
        <p className="mb-1 text-sm text-muted-foreground">{t('empty.description')}</p>
        <p className="mb-6 text-xs text-muted-foreground/70">{t('empty.requirement')}</p>
        {error && (
          <p className={cn('mb-4 rounded bg-destructive/10 px-3 py-2 text-xs text-destructive')}>
            {error}
          </p>
        )}
        {state === 'starting' ? (
          <Button disabled>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('starting')}
          </Button>
        ) : (
          <Button onClick={onStart}>
            <Play className="mr-2 h-4 w-4" />
            {t('start')}
          </Button>
        )}
      </div>
    </div>
  );
}
