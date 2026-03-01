/**
 * StudioApiLog Component
 * Reusable terminal-style API log display with auto-scroll,
 * colored type badges, and running/complete status indicators.
 */
import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal, Loader2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { ApiLogEntry } from '@/types/media-studio';

interface StudioApiLogProps {
  entries: ApiLogEntry[];
  title: string;
  running: boolean;
}

const TYPE_COLORS: Record<ApiLogEntry['type'], string> = {
  info: 'text-zinc-400',
  request: 'text-blue-400',
  response: 'text-green-400',
  success: 'text-emerald-400',
  error: 'text-red-400',
  tool: 'text-amber-400',
};

const TYPE_BADGE_BG: Record<ApiLogEntry['type'], string> = {
  info: 'bg-zinc-700 text-zinc-300',
  request: 'bg-blue-900/60 text-blue-400',
  response: 'bg-green-900/60 text-green-400',
  success: 'bg-emerald-900/60 text-emerald-400',
  error: 'bg-red-900/60 text-red-400',
  tool: 'bg-amber-900/60 text-amber-400',
};

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function StudioApiLog({ entries, title, running }: StudioApiLogProps) {
  const { t } = useTranslation('media-studio');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  if (entries.length === 0 && !running) {
    return null;
  }

  return (
    <div className="bg-zinc-900 rounded-xl overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-zinc-400" />
          <span className="font-mono text-xs font-medium text-zinc-300">{title}</span>
        </div>
        {running ? (
          <Badge className="bg-blue-900/50 text-blue-400 border-blue-800 gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-[10px]">{t('studio.start')}...</span>
          </Badge>
        ) : entries.length > 0 ? (
          <Badge className="bg-emerald-900/50 text-emerald-400 border-emerald-800 gap-1.5">
            <CheckCircle2 className="h-3 w-3" />
            <span className="text-[10px]">Complete</span>
          </Badge>
        ) : null}
      </div>

      {/* Log body */}
      <div
        ref={scrollRef}
        className="max-h-64 overflow-y-auto p-3 space-y-1.5 scrollbar-thin scrollbar-track-zinc-900 scrollbar-thumb-zinc-700"
      >
        {entries.map((entry) => (
          <div key={entry.id} className="flex items-start gap-2 font-mono text-xs">
            <span className="shrink-0 text-zinc-600">{formatTimestamp(entry.timestamp)}</span>
            <span
              className={cn(
                'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase leading-none',
                TYPE_BADGE_BG[entry.type]
              )}
            >
              {entry.type}
            </span>
            <span className={cn('break-all', TYPE_COLORS[entry.type])}>{entry.message}</span>
          </div>
        ))}
        {running && (
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-zinc-600">{formatTimestamp(Date.now())}</span>
            <span className="flex gap-0.5 text-zinc-500">
              <span className="animate-pulse">.</span>
              <span className="animate-pulse delay-100">.</span>
              <span className="animate-pulse delay-200">.</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
