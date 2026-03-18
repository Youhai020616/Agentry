import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Play, RotateCw, ExternalLink, Monitor, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useStarOfficeStore } from '@/stores/star-office';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { cn } from '@/lib/utils';

const _DESIGN_WIDTH = 1280;
const _DESIGN_HEIGHT = 820; // 720 canvas + 60 chat bar + 40 padding
// Aspect ratio used for sizing, not for CSS transform
const ASPECT_RATIO = _DESIGN_WIDTH / _DESIGN_HEIGHT;
const SUPERVISOR_SESSION_KEY = 'agent:supervisor:main';
const MAX_BUBBLE_TEXT = 500;
const MAX_HISTORY = 30;

export default function Office() {
  const { t } = useTranslation('office');
  const navigate = useNavigate();
  const { status, init, start } = useStarOfficeStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [iframeSize, setIframeSize] = useState({ width: 0, height: 0 });
  const iframeReadyRef = useRef(false);

  // Chat store
  const messages = useChatStore((s) => s.messages);
  const sending = useChatStore((s) => s.sending);
  const streamingText = useChatStore((s) => s.streamingText);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const switchSession = useChatStore((s) => s.switchSession);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  // Ref to debounce state sync
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    init();
  }, [init]);

  // Auto-start Star Office when page loads
  useEffect(() => {
    if (status.state === 'stopped') {
      void start();
    }
  }, [status.state, start]);

  // ── Ensure Supervisor session is selected ──
  useEffect(() => {
    if (!isGatewayRunning) return;
    void loadSessions().then(() => {
      const current = useChatStore.getState().currentSessionKey;
      if (current !== SUPERVISOR_SESSION_KEY) {
        switchSession(SUPERVISOR_SESSION_KEY);
      }
    });
  }, [isGatewayRunning, loadSessions, switchSession]);

  // Calculate iframe size to fill container while maintaining aspect ratio
  const updateSize = useCallback(() => {
    if (containerRef.current) {
      const cw = containerRef.current.clientWidth;
      const ch = containerRef.current.clientHeight;
      if (cw / ch > ASPECT_RATIO) {
        // Container is wider — constrain by height
        setIframeSize({ width: Math.floor(ch * ASPECT_RATIO), height: ch });
      } else {
        // Container is taller — constrain by width
        setIframeSize({ width: cw, height: Math.floor(cw / ASPECT_RATIO) });
      }
    }
  }, []);

  useEffect(() => {
    updateSize();
    const observer = new ResizeObserver(updateSize);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, [updateSize]);

  // ── PostMessage helper ──
  const postToIframe = useCallback((type: string, payload: unknown) => {
    iframeRef.current?.contentWindow?.postMessage({ type, payload }, '*');
  }, []);

  // ── Extract plain text from message content ──
  const extractText = useCallback((content: unknown): string => {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((p: { type?: string }) => p.type === 'text')
        .map((p: { text?: string }) => p.text || '')
        .join('\n');
    }
    return '';
  }, []);

  // ── Declarative state sync: send FULL chat state to iframe ──
  // This is the ONLY path for chat data → iframe. No individual message events.
  const syncChatStateToIframe = useCallback(() => {
    if (!iframeReadyRef.current) return;

    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-MAX_HISTORY)
      .map((m) => ({
        role: m.role as string,
        content: extractText(m.content).substring(0, MAX_BUBBLE_TEXT),
        timestamp: m.timestamp || Date.now(),
      }));

    // If streaming, append a partial assistant message
    const currentStreamText = useChatStore.getState().streamingText;
    if (currentStreamText) {
      history.push({
        role: 'assistant',
        content: currentStreamText.substring(0, MAX_BUBBLE_TEXT),
        timestamp: Date.now(),
      });
    }

    postToIframe('office:chat:state', {
      messages: history,
      sending: useChatStore.getState().sending,
    });
  }, [messages, postToIframe, extractText]);

  // ── Sync on messages / streaming changes (debounced) ──
  useEffect(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(syncChatStateToIframe, 80);
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [messages, streamingText, sending, syncChatStateToIframe]);

  // ── Listen to iframe messages ──
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data.type !== 'string') return;

      switch (data.type) {
        case 'office:chat:ready':
          iframeReadyRef.current = true;
          syncChatStateToIframe();
          break;

        case 'office:chat:send': {
          const text = data.payload?.text;
          if (text && !useChatStore.getState().sending) {
            // Ensure we're on supervisor session before sending
            const current = useChatStore.getState().currentSessionKey;
            if (current !== SUPERVISOR_SESSION_KEY) {
              switchSession(SUPERVISOR_SESSION_KEY);
              // Wait a tick for session switch, then send
              setTimeout(() => void sendMessage(text), 100);
            } else {
              void sendMessage(text);
            }
          }
          break;
        }

        case 'office:chat:navigate':
          navigate('/chat');
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [syncChatStateToIframe, switchSession, sendMessage, navigate]);

  const isRunning = status.state === 'running';
  const isStarting = status.state === 'starting';
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

        {(isStarting || hasError) && (
          <Badge variant={statusVariant} className="ml-1">
            {isStarting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            {t(`status.${status.state}`)}
          </Badge>
        )}

        <div className="flex-1" />

        {isRunning && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleOpenExternal}
            title={t('openExternal')}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        )}

        {hasError && (
          <Button size="sm" variant="ghost" onClick={start} title={t('restart')}>
            <RotateCw className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Content */}
      <div ref={containerRef} className="flex-1 overflow-hidden flex items-center justify-center">
        {isRunning && status.url ? (
          <iframe
            ref={iframeRef}
            src={status.url}
            className="border-0"
            style={{
              width: iframeSize.width || '100%',
              height: iframeSize.height || '100%',
            }}
            title={t('iframeTitle')}
            sandbox="allow-scripts allow-same-origin allow-popups allow-modals allow-forms"
          />
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
