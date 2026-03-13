/**
 * Default Tool Renderer
 * Enhanced JSON view with formatted output, Copy button, and syntax highlighting.
 * Used as fallback when no specialized renderer matches the tool name.
 */
import { useState, memo, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type { ToolRendererProps } from './index';

export const DefaultRenderer = memo(function DefaultRenderer({
  input,
  output,
}: ToolRendererProps) {
  const { t } = useTranslation('chat');
  const [activeTab, setActiveTab] = useState<'input' | 'output'>(output != null ? 'output' : 'input');
  const [copied, setCopied] = useState(false);

  const currentData = activeTab === 'input' ? input : output;
  const formatted =
    typeof currentData === 'string' ? currentData : JSON.stringify(currentData, null, 2);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(formatted ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard may not be available
    }
  }, [formatted]);

  return (
    <div className="flex flex-col gap-1">
      {/* Tab bar + copy button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
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
              {t('tool.output', 'Output')}
            </button>
          )}
        </div>

        <button
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-500" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          {copied ? t('tool.copied', 'Copied') : t('tool.copy', 'Copy')}
        </button>
      </div>

      {/* Content */}
      <pre className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground overflow-x-auto max-h-[300px] overflow-y-auto leading-relaxed">
        {formatted || t('tool.noData', 'No data')}
      </pre>
    </div>
  );
});
DefaultRenderer.displayName = 'DefaultRenderer';
