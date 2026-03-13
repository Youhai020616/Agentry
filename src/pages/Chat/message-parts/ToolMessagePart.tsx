/**
 * Tool Message Part
 * Renders tool status bars (running/completed/error) and tool-use cards
 * with expandable request/response details.
 *
 * When expanded, delegates to a specialized renderer (WebSearch, CodeExecutor,
 * Browser, or Default) based on the tool name — providing rich visualisation
 * instead of raw JSON.
 */
import { useState, memo, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Search,
  Globe,
  Monitor,
  Wrench,
  Loader2,
  CheckCircle2,
  XCircle,
  Code2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  WebSearchRenderer,
  CodeExecutorRenderer,
  BrowserRenderer,
  DefaultRenderer,
} from '../tool-renderers';

// ── Shared tool helpers ──────────────────────────────────────────

function formatDuration(durationMs?: number): string | null {
  if (!durationMs || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function renderToolIcon(name: string, className: string): ReactNode {
  const n = name.toLowerCase();
  if (n.includes('search')) return <Search className={className} />;
  if (n.includes('fetch')) return <Globe className={className} />;
  if (n.includes('browser') || n.includes('navigate') || n.includes('playwright'))
    return <Monitor className={className} />;
  if (n.includes('code') || n.includes('execute') || n.includes('interpreter'))
    return <Code2 className={className} />;
  return <Wrench className={className} />;
}

function getToolLabel(name: string): string {
  const n = name.toLowerCase();
  if (n === 'web_search') return 'Web Search';
  if (n === 'web_fetch') return 'Web Fetch';
  if (n === 'browser') return 'Browser';
  return name;
}

// ── Tool Status Bar ──────────────────────────────────────────────

export interface ToolStatusItem {
  id?: string;
  toolCallId?: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
  summary?: string;
}

export const ToolStatusBar = memo(function ToolStatusBar({ tools }: { tools: ToolStatusItem[] }) {
  return (
    <div className="w-full rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm px-3 py-2.5 text-xs">
      <div className="space-y-1.5">
        {tools.map((tool) => {
          const duration = formatDuration(tool.durationMs);
          const label = getToolLabel(tool.name);
          return (
            <div key={tool.toolCallId || tool.id || tool.name} className="flex items-center gap-2">
              {/* Status indicator */}
              {tool.status === 'running' ? (
                <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />
              ) : tool.status === 'error' ? (
                <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              )}

              {/* Tool icon + name */}
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium',
                  tool.status === 'error'
                    ? 'bg-destructive/10 text-destructive'
                    : tool.status === 'running'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                )}
              >
                {renderToolIcon(tool.name, 'h-3 w-3')}
                {label}
              </span>

              {/* Duration */}
              {duration && <span className="text-[11px] text-muted-foreground/70">{duration}</span>}

              {/* Summary */}
              {tool.summary && (
                <span className="truncate text-[11px] text-muted-foreground">{tool.summary}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
ToolStatusBar.displayName = 'ToolStatusBar';

// ── Tool Card ────────────────────────────────────────────────────

export interface ToolCardProps {
  name: string;
  input: unknown;
  /** Tool execution output/result — displayed via specialised renderer */
  output?: unknown;
}

export const ToolCard = memo(function ToolCard({ name, input, output }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const label = getToolLabel(name);

  // Select renderer inline to avoid "component created during render" lint error
  const n = name.toLowerCase();
  const isSearch = n.includes('search');
  const isCode =
    n.includes('code') ||
    n.includes('execute') ||
    n.includes('run_code') ||
    n.includes('interpreter');
  const isBrowser = n.includes('browser') || n.includes('navigate') || n.includes('playwright');

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm text-sm">
      <button
        className="flex items-center gap-2 w-full px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {renderToolIcon(name, 'h-3.5 w-3.5 text-primary/70')}
        <span className="text-xs font-medium">{label}</span>
        {output != null && <CheckCircle2 className="h-3 w-3 text-emerald-500/70" />}
        {expanded ? (
          <ChevronDown className="h-3 w-3 ml-auto" />
        ) : (
          <ChevronRight className="h-3 w-3 ml-auto" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-2.5">
          {isSearch ? (
            <WebSearchRenderer name={name} input={input} output={output} />
          ) : isCode ? (
            <CodeExecutorRenderer name={name} input={input} output={output} />
          ) : isBrowser ? (
            <BrowserRenderer name={name} input={input} output={output} />
          ) : (
            <DefaultRenderer name={name} input={input} output={output} />
          )}
        </div>
      )}
    </div>
  );
});
ToolCard.displayName = 'ToolCard';
