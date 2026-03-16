/**
 * Browser Tool Renderer
 * Renders browser operation results with URL, status badge, and action summary.
 * Triggered when tool name contains "browser".
 */
import { useState, useMemo, memo } from 'react';
import {
  Monitor,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Loader2,
  MousePointer2,
  Eye,
  Type,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type { ToolRendererProps } from './index';

/** Extract URL from input or output */
function extractUrl(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const obj = data as Record<string, unknown>;
  if (typeof obj.url === 'string') return obj.url;
  if (typeof obj.href === 'string') return obj.href;
  if (typeof obj.link === 'string') return obj.link;
  if (typeof obj.page_url === 'string') return obj.page_url;
  return '';
}

/** Detect browser action type from input */
function extractAction(input: unknown): string {
  if (!input || typeof input !== 'object') return 'browse';
  const obj = input as Record<string, unknown>;
  if (typeof obj.action === 'string') return obj.action.toLowerCase();
  if (typeof obj.command === 'string') return obj.command.toLowerCase();
  if (typeof obj.type === 'string') return obj.type.toLowerCase();
  return 'browse';
}

/** Get appropriate icon for browser action */
function ActionIcon({ action, className }: { action: string; className: string }) {
  if (action.includes('click') || action.includes('press')) {
    return <MousePointer2 className={className} />;
  }
  if (action.includes('type') || action.includes('fill') || action.includes('input')) {
    return <Type className={className} />;
  }
  if (action.includes('screenshot') || action.includes('observe') || action.includes('look')) {
    return <Eye className={className} />;
  }
  return <Monitor className={className} />;
}

/** Extract status from output */
function extractStatus(output: unknown): 'success' | 'error' | 'running' {
  if (!output) return 'running';
  if (typeof output === 'object') {
    const obj = output as Record<string, unknown>;
    if (obj.error || obj.isError === true) return 'error';
    if (typeof obj.status === 'string') {
      const s = obj.status.toLowerCase();
      if (s === 'error' || s === 'failed') return 'error';
    }
  }
  return 'success';
}

/** Extract page title from output */
function extractTitle(output: unknown): string {
  if (!output || typeof output !== 'object') return '';
  const obj = output as Record<string, unknown>;
  if (typeof obj.title === 'string') return obj.title;
  if (typeof obj.pageTitle === 'string') return obj.pageTitle;
  return '';
}

export const BrowserRenderer = memo(function BrowserRenderer({
  input,
  output,
}: ToolRendererProps) {
  const { t } = useTranslation('chat');
  const [activeTab, setActiveTab] = useState<'summary' | 'input' | 'output'>(
    output != null ? 'summary' : 'input'
  );

  const url = useMemo(() => extractUrl(input) || extractUrl(output), [input, output]);
  const action = useMemo(() => extractAction(input), [input]);
  const status = useMemo(() => extractStatus(output), [output]);
  const pageTitle = useMemo(() => extractTitle(output), [output]);

  const domain = useMemo(() => {
    if (!url) return '';
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }, [url]);

  const actionLabel = useMemo(() => {
    if (action.includes('click')) return t('tool.browserClick', 'Click');
    if (action.includes('type') || action.includes('fill')) return t('tool.browserType', 'Type');
    if (action.includes('navigate') || action.includes('goto')) return t('tool.browserNavigate', 'Navigate');
    if (action.includes('screenshot')) return t('tool.browserScreenshot', 'Screenshot');
    if (action.includes('scroll')) return t('tool.browserScroll', 'Scroll');
    if (action.includes('observe') || action.includes('look')) return t('tool.browserObserve', 'Observe');
    return t('tool.browserBrowse', 'Browse');
  }, [action, t]);

  return (
    <div className="flex flex-col gap-2">
      {/* Header card with URL + status */}
      <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
        <ActionIcon action={action} className="h-4 w-4 text-muted-foreground shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium">{actionLabel}</span>
            {/* Status badge */}
            {status === 'success' && (
              <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
            )}
            {status === 'error' && <XCircle className="h-3 w-3 text-destructive shrink-0" />}
            {status === 'running' && (
              <Loader2 className="h-3 w-3 text-primary animate-spin shrink-0" />
            )}
          </div>

          {/* URL */}
          {url && (
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[10px] text-muted-foreground/70 truncate">{domain}</span>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-primary/60 hover:text-primary transition-colors"
              >
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
          )}

          {/* Page title */}
          {pageTitle && (
            <p className="text-[10px] text-muted-foreground truncate mt-0.5">{pageTitle}</p>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1">
        {output != null && (
          <button
            className={cn(
              'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
              activeTab === 'summary'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            )}
            onClick={() => setActiveTab('summary')}
          >
            {t('tool.summary', 'Summary')}
          </button>
        )}
        <button
          className={cn(
            'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
            activeTab === 'input'
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
          )}
          onClick={() => setActiveTab('input')}
        >
          {t('tool.input', 'Input')}
        </button>
        {output != null && (
          <button
            className={cn(
              'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
              activeTab === 'output'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            )}
            onClick={() => setActiveTab('output')}
          >
            {t('tool.rawOutput', 'Raw Output')}
          </button>
        )}
      </div>

      {/* Content */}
      {activeTab === 'input' && (
        <pre className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground overflow-x-auto max-h-[300px] overflow-y-auto leading-relaxed">
          {typeof input === 'string' ? input : JSON.stringify(input, null, 2)}
        </pre>
      )}
      {activeTab === 'output' && output != null && (
        <pre className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground overflow-x-auto max-h-[300px] overflow-y-auto leading-relaxed">
          {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
        </pre>
      )}
      {activeTab === 'summary' && output != null && (
        <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground overflow-x-auto max-h-[300px] overflow-y-auto leading-relaxed">
          {typeof output === 'string' ? (
            <p className="whitespace-pre-wrap">{output}</p>
          ) : (
            <pre>{JSON.stringify(output, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
});
BrowserRenderer.displayName = 'BrowserRenderer';
