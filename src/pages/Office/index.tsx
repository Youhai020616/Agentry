import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Square, RotateCw, ExternalLink, Monitor, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useStarOfficeStore } from '@/stores/star-office';
import { cn } from '@/lib/utils';

/** Original Star Office design dimensions */
const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 1100; // 720 canvas + 300 bottom panels + 80 paddings/gaps

export default function Office() {
  const { t } = useTranslation('office');
  const { status, init, start, stop, restart } = useStarOfficeStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    init();
  }, [init]);

  const updateScale = useCallback(() => {
    if (containerRef.current) {
      const cw = containerRef.current.clientWidth;
      // Scale to fill container width; vertical overflow handled by scrolling
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

  // Overlay handlers: wheel scrolls parent, click passes through to iframe
  const handleOverlayWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    containerRef.current?.scrollBy({ top: e.deltaY });
  }, []);

  const handleOverlayMouseDown = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    // Hide overlay so pointer events reach the iframe underneath
    overlay.style.pointerEvents = 'none';
    const restore = () => {
      overlay.style.pointerEvents = 'auto';
      window.removeEventListener('mouseup', restore);
    };
    window.addEventListener('mouseup', restore);
  }, []);

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
      <div ref={containerRef} className="flex-1 overflow-auto">
        {isRunning && status.url ? (
          <div
            className="relative mx-auto"
            style={{
              width: Math.ceil(DESIGN_WIDTH * scale),
              height: Math.ceil(DESIGN_HEIGHT * scale),
              overflow: 'hidden',
            }}
          >
            {/* Transparent overlay: captures wheel → scrolls parent, passes clicks → iframe */}
            <div
              ref={overlayRef}
              className="absolute inset-0 z-10"
              onWheel={handleOverlayWheel}
              onMouseDown={handleOverlayMouseDown}
            />
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
              title="Star Office UI"
              sandbox="allow-scripts allow-same-origin allow-popups"
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
