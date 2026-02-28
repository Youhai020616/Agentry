/**
 * Browser Control Page
 * Provides a GUI for OpenClaw's browser automation capabilities.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────┐
 *   │  Header: Title + Status Badge + Start/Stop      │
 *   ├─────────────────────────────────────────────────┤
 *   │  URL Bar: [🔒] [url input          ] [Go]       │
 *   ├─────────────────────────────────────────────────┤
 *   │  Action Toolbar: Snapshot | Screenshot | Trace  │
 *   ├──────────────────────┬──────────────────────────┤
 *   │  Tab Panels:         │                          │
 *   │  [Snapshot] [Screen] │  (content area)          │
 *   │  [Interact] [Console]│                          │
 *   │  [History]           │                          │
 *   └──────────────────────┴──────────────────────────┘
 */
import { useEffect, useState, useCallback, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useBrowserStore } from '@/stores/browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Globe,
  Play,
  Square,
  Camera,
  ScanSearch,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  XCircle,
  MousePointerClick,
  Type,
  ArrowUp,
  ArrowDown,
  Highlighter,
  Trash2,
  Copy,
  Loader2,
  Circle,
  ChevronUp,
  Image,
  Terminal,
  History,
  Hand,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';
import type { SnapshotFormat } from '@/types/browser';

// ── Sub-components ─────────────────────────────────────────────────

/**
 * Status badge with color coding
 */
function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation('browser');

  const variants: Record<string, { color: string; icon: React.ReactNode }> = {
    idle: {
      color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
      icon: <Circle className="h-2 w-2 fill-current" />,
    },
    starting: {
      color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
    },
    running: {
      color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
      icon: <CheckCircle2 className="h-3 w-3" />,
    },
    stopping: {
      color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
    },
    error: {
      color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      icon: <XCircle className="h-3 w-3" />,
    },
  };

  const v = variants[status] ?? variants.idle;

  return (
    <Badge
      variant="outline"
      className={cn('gap-1.5 px-2.5 py-0.5 text-xs font-medium border-0', v.color)}
    >
      {v.icon}
      {t(`status.${status}`)}
    </Badge>
  );
}

/**
 * Empty state — shown when browser is not running
 */
function EmptyState() {
  const { t } = useTranslation('browser');
  const startBrowser = useBrowserStore((s) => s.startBrowser);
  const loading = useBrowserStore((s) => s.loading);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center px-8">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-violet-100 dark:bg-violet-500/15">
        <Globe className="h-10 w-10 text-violet-500" />
      </div>
      <div className="space-y-2 max-w-md">
        <h2 className="text-xl font-semibold">{t('empty.title')}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{t('empty.description')}</p>
      </div>
      <Button size="lg" className="gap-2" onClick={() => startBrowser()} disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        {t('empty.startButton')}
      </Button>
    </div>
  );
}

/**
 * URL bar with navigation
 */
function UrlBar() {
  const { t } = useTranslation('browser');
  const currentUrl = useBrowserStore((s) => s.currentUrl);
  const navigate = useBrowserStore((s) => s.navigate);
  const loading = useBrowserStore((s) => s.loading);
  const loadingAction = useBrowserStore((s) => s.loadingAction);
  const [urlInput, setUrlInput] = useState(currentUrl ?? '');

  // Sync url input when external navigation occurs
  useEffect(() => {
    if (currentUrl && currentUrl !== urlInput) {
      setUrlInput(currentUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUrl]);

  const handleNavigate = useCallback(() => {
    if (!urlInput.trim()) return;
    let url = urlInput.trim();
    // Auto-add https:// if no protocol
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }
    navigate(url);
  }, [urlInput, navigate]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleNavigate();
    }
  };

  const isNavigating = loading && loadingAction === 'navigate';

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
      <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
      <Input
        value={urlInput}
        onChange={(e) => setUrlInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('urlBar.placeholder')}
        className="flex-1 h-8 text-sm bg-background"
        disabled={isNavigating}
      />
      <Button
        size="sm"
        variant="secondary"
        className="h-8 gap-1.5 px-3"
        onClick={handleNavigate}
        disabled={isNavigating || !urlInput.trim()}
      >
        {isNavigating ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ArrowRight className="h-3.5 w-3.5" />
        )}
        {t('urlBar.go')}
      </Button>
    </div>
  );
}

/**
 * Action toolbar — quick actions for snapshot, screenshot, trace
 */
function ActionToolbar() {
  const { t } = useTranslation('browser');
  const takeSnapshot = useBrowserStore((s) => s.takeSnapshot);
  const takeScreenshot = useBrowserStore((s) => s.takeScreenshot);
  const startTrace = useBrowserStore((s) => s.startTrace);
  const stopTrace = useBrowserStore((s) => s.stopTrace);
  const traceActive = useBrowserStore((s) => s.traceActive);
  const fetchErrors = useBrowserStore((s) => s.fetchErrors);
  const fetchRequests = useBrowserStore((s) => s.fetchRequests);
  const loading = useBrowserStore((s) => s.loading);
  const loadingAction = useBrowserStore((s) => s.loadingAction);

  const [snapshotFormat, setSnapshotFormat] = useState<SnapshotFormat>('ai');

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b flex-wrap">
      {/* Snapshot */}
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={() => takeSnapshot(snapshotFormat)}
              disabled={loading && loadingAction === 'snapshot'}
            >
              {loading && loadingAction === 'snapshot' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ScanSearch className="h-3 w-3" />
              )}
              {t('actions.snapshot')}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('tooltips.takeSnapshot')}</TooltipContent>
        </Tooltip>
        <Select
          value={snapshotFormat}
          onValueChange={(v: string) => setSnapshotFormat(v as SnapshotFormat)}
        >
          <SelectTrigger className="h-7 w-24 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ai">{t('snapshot.formatAi')}</SelectItem>
            <SelectItem value="interactive">{t('snapshot.formatInteractive')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="h-4 w-px bg-border" />

      {/* Screenshot */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={() => takeScreenshot()}
            disabled={loading && loadingAction === 'screenshot'}
          >
            {loading && loadingAction === 'screenshot' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Camera className="h-3 w-3" />
            )}
            {t('actions.screenshot')}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('tooltips.takeScreenshot')}</TooltipContent>
      </Tooltip>

      <div className="h-4 w-px bg-border" />

      {/* Trace */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant={traceActive ? 'destructive' : 'outline'}
            className="h-7 gap-1.5 text-xs"
            onClick={() => (traceActive ? stopTrace() : startTrace())}
            disabled={
              loading && (loadingAction === 'trace_start' || loadingAction === 'trace_stop')
            }
          >
            {loading && (loadingAction === 'trace_start' || loadingAction === 'trace_stop') ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : traceActive ? (
              <Circle className="h-3 w-3 fill-red-500 text-red-500 animate-pulse" />
            ) : (
              <Circle className="h-3 w-3" />
            )}
            {traceActive ? t('trace.stop') : t('trace.start')}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {traceActive ? t('tooltips.stopTrace') : t('tooltips.startTrace')}
        </TooltipContent>
      </Tooltip>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Refresh data */}
      <Button
        size="sm"
        variant="ghost"
        className="h-7 gap-1.5 text-xs text-muted-foreground"
        onClick={() => {
          fetchErrors();
          fetchRequests();
        }}
      >
        <RotateCcw className="h-3 w-3" />
        {t('console.title')}
      </Button>
    </div>
  );
}

/**
 * Snapshot viewer panel
 */
function SnapshotPanel() {
  const { t } = useTranslation('browser');
  const snapshot = useBrowserStore((s) => s.snapshot);
  const clickElement = useBrowserStore((s) => s.clickElement);
  const highlightElement = useBrowserStore((s) => s.highlightElement);

  const handleCopy = useCallback(() => {
    if (snapshot?.content) {
      navigator.clipboard.writeText(snapshot.content);
    }
  }, [snapshot]);

  if (!snapshot) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <div className="space-y-2">
          <ScanSearch className="h-10 w-10 mx-auto text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">{t('snapshot.empty')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Snapshot meta */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="font-medium">{snapshot.title || snapshot.url}</span>
          <Badge variant="secondary" className="text-[10px] h-5">
            {t('snapshot.refs', { count: snapshot.refs.length })}
          </Badge>
          <Badge variant="outline" className="text-[10px] h-5">
            {snapshot.format === 'ai' ? t('snapshot.formatAi') : t('snapshot.formatInteractive')}
          </Badge>
        </div>
        <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={handleCopy}>
          <Copy className="h-3 w-3" />
          {t('snapshot.copyContent')}
        </Button>
      </div>

      {/* Snapshot content */}
      <ScrollArea className="flex-1">
        <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-words leading-relaxed">
          {snapshot.content}
        </pre>
      </ScrollArea>

      {/* Ref quick-actions */}
      {snapshot.refs.length > 0 && (
        <div className="border-t px-3 py-2 bg-muted/20">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-muted-foreground mr-1">Refs:</span>
            {snapshot.refs.slice(0, 30).map((ref) => (
              <Tooltip key={ref.id}>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-5 px-1.5 text-[10px] font-mono"
                    onClick={() => clickElement(ref.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      highlightElement(ref.id);
                    }}
                  >
                    {ref.id}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <span>
                    Click: {t('actions.click')} | Right-click: {t('actions.highlight')}
                    {ref.role && ` | ${ref.role}`}
                    {ref.name && `: ${ref.name}`}
                  </span>
                </TooltipContent>
              </Tooltip>
            ))}
            {snapshot.refs.length > 30 && (
              <span className="text-[10px] text-muted-foreground ml-1">
                +{snapshot.refs.length - 30} more
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Screenshot viewer panel
 */
function ScreenshotPanel() {
  const { t } = useTranslation('browser');
  const screenshot = useBrowserStore((s) => s.screenshot);
  const [zoom, setZoom] = useState(100);

  if (!screenshot || !screenshot.base64) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <div className="space-y-2">
          <Image className="h-10 w-10 mx-auto text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">{t('screenshot.empty')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Zoom controls */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30 text-xs">
        <span className="text-muted-foreground">{screenshot.url}</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setZoom((z) => Math.max(25, z - 25))}
          >
            <ZoomOut className="h-3 w-3" />
          </Button>
          <span className="text-muted-foreground w-10 text-center">{zoom}%</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setZoom((z) => Math.min(300, z + 25))}
          >
            <ZoomIn className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setZoom(100)}>
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Image */}
      <ScrollArea className="flex-1">
        <div className="p-4 flex items-start justify-center">
          <img
            src={`data:image/png;base64,${screenshot.base64}`}
            alt="Browser screenshot"
            style={{ width: `${zoom}%`, maxWidth: 'none' }}
            className="rounded-lg border shadow-sm"
          />
        </div>
      </ScrollArea>
    </div>
  );
}

/**
 * Interact panel — click, type, scroll, highlight
 */
function InteractPanel() {
  const { t } = useTranslation('browser');
  const clickElement = useBrowserStore((s) => s.clickElement);
  const typeText = useBrowserStore((s) => s.typeText);
  const scrollPage = useBrowserStore((s) => s.scrollPage);
  const highlightElement = useBrowserStore((s) => s.highlightElement);
  const loading = useBrowserStore((s) => s.loading);

  const [clickRef, setClickRef] = useState('');
  const [typeRef, setTypeRef] = useState('');
  const [typeValue, setTypeValue] = useState('');
  const [clearFirst, setClearFirst] = useState(false);
  const [highlightRef, setHighlightRef] = useState('');

  return (
    <ScrollArea className="flex-1">
      <div className="p-4 space-y-6">
        {/* Click */}
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <MousePointerClick className="h-4 w-4 text-violet-500" />
            {t('interact.clickRef')}
          </label>
          <div className="flex gap-2">
            <Input
              value={clickRef}
              onChange={(e) => setClickRef(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && clickRef.trim()) {
                  clickElement(clickRef.trim());
                  setClickRef('');
                }
              }}
              placeholder={t('interact.clickRefPlaceholder')}
              className="flex-1 h-8 text-sm font-mono"
            />
            <Button
              size="sm"
              className="h-8 gap-1.5"
              disabled={!clickRef.trim() || loading}
              onClick={() => {
                clickElement(clickRef.trim());
                setClickRef('');
              }}
            >
              <MousePointerClick className="h-3.5 w-3.5" />
              {t('actions.click')}
            </Button>
          </div>
        </div>

        {/* Type */}
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <Type className="h-4 w-4 text-blue-500" />
            {t('interact.typeRef')}
          </label>
          <div className="flex gap-2">
            <Input
              value={typeRef}
              onChange={(e) => setTypeRef(e.target.value)}
              placeholder={t('interact.typeRefPlaceholder')}
              className="w-24 h-8 text-sm font-mono"
            />
            <Input
              value={typeValue}
              onChange={(e) => setTypeValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && typeRef.trim() && typeValue) {
                  typeText(typeRef.trim(), typeValue, clearFirst);
                  setTypeValue('');
                }
              }}
              placeholder={t('interact.typeTextPlaceholder')}
              className="flex-1 h-8 text-sm"
            />
            <Button
              size="sm"
              className="h-8 gap-1.5"
              disabled={!typeRef.trim() || !typeValue || loading}
              onClick={() => {
                typeText(typeRef.trim(), typeValue, clearFirst);
                setTypeValue('');
              }}
            >
              <Type className="h-3.5 w-3.5" />
              {t('actions.type')}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="clearFirst"
              checked={clearFirst}
              onCheckedChange={(v) => setClearFirst(!!v)}
            />
            <label htmlFor="clearFirst" className="text-xs text-muted-foreground cursor-pointer">
              {t('interact.clearFirst')}
            </label>
          </div>
        </div>

        {/* Scroll */}
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <ChevronUp className="h-4 w-4 text-green-500" />
            {t('actions.scroll')}
          </label>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 flex-1"
              disabled={loading}
              onClick={() => scrollPage('up')}
            >
              <ArrowUp className="h-3.5 w-3.5" />
              {t('interact.scrollUp')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 flex-1"
              disabled={loading}
              onClick={() => scrollPage('down')}
            >
              <ArrowDown className="h-3.5 w-3.5" />
              {t('interact.scrollDown')}
            </Button>
          </div>
        </div>

        {/* Highlight */}
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <Highlighter className="h-4 w-4 text-amber-500" />
            {t('interact.highlightRef')}
          </label>
          <div className="flex gap-2">
            <Input
              value={highlightRef}
              onChange={(e) => setHighlightRef(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && highlightRef.trim()) {
                  highlightElement(highlightRef.trim());
                }
              }}
              placeholder={t('interact.highlightRefPlaceholder')}
              className="flex-1 h-8 text-sm font-mono"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              disabled={!highlightRef.trim() || loading}
              onClick={() => highlightElement(highlightRef.trim())}
            >
              <Highlighter className="h-3.5 w-3.5" />
              {t('actions.highlight')}
            </Button>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

/**
 * Console panel — errors and network requests
 */
function ConsolePanel() {
  const { t } = useTranslation('browser');
  const errors = useBrowserStore((s) => s.errors);
  const requests = useBrowserStore((s) => s.requests);
  const fetchErrors = useBrowserStore((s) => s.fetchErrors);
  const fetchRequests = useBrowserStore((s) => s.fetchRequests);
  const [activeTab, setActiveTab] = useState<'errors' | 'requests'>('errors');

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tabs */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b bg-muted/30">
        <Button
          variant={activeTab === 'errors' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-6 text-xs gap-1"
          onClick={() => {
            setActiveTab('errors');
            fetchErrors();
          }}
        >
          <AlertCircle className="h-3 w-3" />
          {t('console.errors')}
          {errors.length > 0 && (
            <Badge variant="destructive" className="h-4 px-1 text-[10px] ml-1">
              {errors.length}
            </Badge>
          )}
        </Button>
        <Button
          variant={activeTab === 'requests' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-6 text-xs gap-1"
          onClick={() => {
            setActiveTab('requests');
            fetchRequests();
          }}
        >
          <Globe className="h-3 w-3" />
          {t('console.requests')}
          {requests.length > 0 && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px] ml-1">
              {requests.length}
            </Badge>
          )}
        </Button>

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs gap-1"
          onClick={() =>
            activeTab === 'errors' ? fetchErrors(true) : fetchRequests(undefined, true)
          }
        >
          <Trash2 className="h-3 w-3" />
          {t('console.clear')}
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {activeTab === 'errors' ? (
          errors.length === 0 ? (
            <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
              {t('console.noErrors')}
            </div>
          ) : (
            <div className="divide-y">
              {errors.map((err, i) => (
                <div key={i} className="px-3 py-2 text-xs hover:bg-muted/30">
                  <div className="flex items-start gap-2">
                    <AlertCircle
                      className={cn(
                        'h-3.5 w-3.5 mt-0.5 shrink-0',
                        err.level === 'error'
                          ? 'text-red-500'
                          : err.level === 'warning'
                            ? 'text-yellow-500'
                            : 'text-blue-500'
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono break-all">{err.message}</p>
                      {err.source && (
                        <p className="text-muted-foreground mt-0.5">
                          {err.source}
                          {err.line ? `:${err.line}` : ''}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : requests.length === 0 ? (
          <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
            {t('console.noRequests')}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/30 text-muted-foreground">
                <th className="px-3 py-1.5 text-left font-medium">{t('console.columns.status')}</th>
                <th className="px-3 py-1.5 text-left font-medium">{t('console.columns.method')}</th>
                <th className="px-3 py-1.5 text-left font-medium">{t('console.columns.url')}</th>
                <th className="px-3 py-1.5 text-right font-medium">{t('console.columns.size')}</th>
                <th className="px-3 py-1.5 text-right font-medium">
                  {t('console.columns.duration')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {requests.map((req, i) => (
                <tr key={i} className="hover:bg-muted/30">
                  <td className="px-3 py-1.5">
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px] h-4 px-1',
                        req.status && req.status >= 400
                          ? 'text-red-500 border-red-200'
                          : req.status && req.status >= 300
                            ? 'text-yellow-600 border-yellow-200'
                            : 'text-emerald-600 border-emerald-200'
                      )}
                    >
                      {req.status ?? '—'}
                    </Badge>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">{req.method}</td>
                  <td className="px-3 py-1.5 font-mono truncate max-w-[400px]">{req.url}</td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">
                    {req.size ? formatBytes(req.size) : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">
                    {req.duration ? `${req.duration}ms` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ScrollArea>
    </div>
  );
}

/**
 * Action history panel
 */
function HistoryPanel() {
  const { t } = useTranslation('browser');
  const actionHistory = useBrowserStore((s) => s.actionHistory);
  const fetchHistory = useBrowserStore((s) => s.fetchHistory);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  if (actionHistory.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <div className="space-y-2">
          <History className="h-10 w-10 mx-auto text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">{t('history.empty')}</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="divide-y">
        {actionHistory.map((action) => (
          <div
            key={action.id}
            className="flex items-start gap-3 px-3 py-2 text-xs hover:bg-muted/30"
          >
            <div className="mt-0.5">
              {action.success ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-red-500" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium">
                {t(`history.types.${action.type}`, {
                  target: action.target || '',
                  defaultValue: action.type,
                })}
              </p>
              {action.value && (
                <p className="text-muted-foreground mt-0.5 font-mono truncate">{action.value}</p>
              )}
              {action.error && <p className="text-red-500 mt-0.5 truncate">{action.error}</p>}
            </div>
            <time className="text-muted-foreground shrink-0">
              {new Date(action.timestamp).toLocaleTimeString()}
            </time>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ── Main Page Component ────────────────────────────────────────────

export function Browser() {
  const { t } = useTranslation('browser');
  const status = useBrowserStore((s) => s.status);
  const error = useBrowserStore((s) => s.error);
  const startBrowser = useBrowserStore((s) => s.startBrowser);
  const stopBrowser = useBrowserStore((s) => s.stopBrowser);
  const clearError = useBrowserStore((s) => s.clearError);
  const init = useBrowserStore((s) => s.init);
  const refreshStatus = useBrowserStore((s) => s.refreshStatus);
  const loading = useBrowserStore((s) => s.loading);
  const loadingAction = useBrowserStore((s) => s.loadingAction);

  // Initialize event listeners and refresh status on mount
  useEffect(() => {
    init();
    refreshStatus();
  }, [init, refreshStatus]);

  const isRunning = status === 'running';
  const isStarting = status === 'starting' || (loading && loadingAction === 'start');
  const isStopping = status === 'stopping' || (loading && loadingAction === 'stop');

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-500/15">
            <Globe className="h-5 w-5 text-violet-500" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-none">{t('title')}</h1>
            <p className="text-xs text-muted-foreground mt-1">{t('description')}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <StatusBadge status={status} />

          {isRunning ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => stopBrowser()}
              disabled={isStopping}
            >
              {isStopping ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
              {t('actions.stop')}
            </Button>
          ) : (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => startBrowser()}
              disabled={isStarting}
            >
              {isStarting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {t('actions.start')}
            </Button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-950/20 border-b border-red-100 dark:border-red-900/30">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
          <span className="text-sm text-red-700 dark:text-red-400 flex-1 truncate">{error}</span>
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Main content */}
      {!isRunning && status !== 'starting' ? (
        <EmptyState />
      ) : (
        <div className="flex flex-1 flex-col min-h-0">
          <UrlBar />
          <ActionToolbar />

          {/* Tab panels */}
          <Tabs defaultValue="snapshot" className="flex flex-1 flex-col min-h-0">
            <TabsList className="w-full justify-start rounded-none border-b bg-transparent px-4 h-9">
              <TabsTrigger
                value="snapshot"
                className="gap-1.5 text-xs data-[state=active]:bg-background rounded-b-none"
              >
                <ScanSearch className="h-3.5 w-3.5" />
                {t('panels.snapshot')}
              </TabsTrigger>
              <TabsTrigger
                value="screenshot"
                className="gap-1.5 text-xs data-[state=active]:bg-background rounded-b-none"
              >
                <Image className="h-3.5 w-3.5" />
                {t('panels.screenshot')}
              </TabsTrigger>
              <TabsTrigger
                value="interact"
                className="gap-1.5 text-xs data-[state=active]:bg-background rounded-b-none"
              >
                <Hand className="h-3.5 w-3.5" />
                {t('panels.interact')}
              </TabsTrigger>
              <TabsTrigger
                value="console"
                className="gap-1.5 text-xs data-[state=active]:bg-background rounded-b-none"
              >
                <Terminal className="h-3.5 w-3.5" />
                {t('panels.console')}
              </TabsTrigger>
              <TabsTrigger
                value="history"
                className="gap-1.5 text-xs data-[state=active]:bg-background rounded-b-none"
              >
                <History className="h-3.5 w-3.5" />
                {t('panels.history')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="snapshot" className="flex-1 mt-0 min-h-0">
              <SnapshotPanel />
            </TabsContent>
            <TabsContent value="screenshot" className="flex-1 mt-0 min-h-0">
              <ScreenshotPanel />
            </TabsContent>
            <TabsContent value="interact" className="flex-1 mt-0 min-h-0">
              <InteractPanel />
            </TabsContent>
            <TabsContent value="console" className="flex-1 mt-0 min-h-0">
              <ConsolePanel />
            </TabsContent>
            <TabsContent value="history" className="flex-1 mt-0 min-h-0">
              <HistoryPanel />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
