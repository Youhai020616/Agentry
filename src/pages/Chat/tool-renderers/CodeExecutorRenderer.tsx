/**
 * Code Executor Tool Renderer
 * Renders code execution results with syntax-highlighted code block and output area.
 * Triggered when tool name contains "code" or "execute".
 */
import { useState, useMemo, memo, useCallback } from 'react';
import { Copy, Check, AlertTriangle, ChevronRight, Terminal, Code2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type { ToolRendererProps } from './index';

/** Try to extract code string from tool input */
function extractCode(input: unknown): string {
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  if (typeof obj.code === 'string') return obj.code;
  if (typeof obj.script === 'string') return obj.script;
  if (typeof obj.source === 'string') return obj.source;
  if (typeof obj.content === 'string') return obj.content;
  return JSON.stringify(input, null, 2);
}

/** Try to extract language from tool input or name */
function extractLanguage(input: unknown, toolName: string): string {
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (typeof obj.language === 'string') return obj.language.toLowerCase();
    if (typeof obj.lang === 'string') return obj.lang.toLowerCase();
    if (typeof obj.type === 'string') return obj.type.toLowerCase();
  }
  const n = toolName.toLowerCase();
  if (n.includes('python') || n.includes('py')) return 'python';
  if (n.includes('javascript') || n.includes('js')) return 'javascript';
  if (n.includes('typescript') || n.includes('ts')) return 'typescript';
  if (n.includes('bash') || n.includes('shell') || n.includes('sh')) return 'bash';
  return 'code';
}

/** Extract output logs or result text from tool output */
function extractOutput(output: unknown): { logs: string[]; error?: string } {
  if (!output) return { logs: [] };
  if (typeof output === 'string') return { logs: [output] };

  const obj = output as Record<string, unknown>;
  const logs: string[] = [];
  let error: string | undefined;

  // Error
  if (typeof obj.error === 'string' && obj.error) {
    error = obj.error;
  }

  // Logs array
  if (Array.isArray(obj.logs)) {
    for (const log of obj.logs) {
      if (typeof log === 'string') {
        logs.push(log);
      } else if (log && typeof log === 'object') {
        const entry = log as Record<string, unknown>;
        if (Array.isArray(entry.args)) {
          const text = (entry.args as Array<Record<string, unknown>>)
            .map((a) => (typeof a.value === 'string' ? a.value : JSON.stringify(a.value ?? a)))
            .join(' ');
          logs.push(text);
        } else if (typeof entry.message === 'string') {
          logs.push(entry.message);
        }
      }
    }
  }

  // Result / output as string
  if (typeof obj.result === 'string' && obj.result) logs.push(obj.result);
  if (typeof obj.output === 'string' && obj.output) logs.push(obj.output);
  if (typeof obj.stdout === 'string' && obj.stdout) logs.push(obj.stdout);
  if (typeof obj.stderr === 'string' && obj.stderr) {
    error = error || obj.stderr;
  }

  // If nothing extracted, try to stringify the entire output
  if (logs.length === 0 && !error && typeof output === 'object') {
    const str = JSON.stringify(output, null, 2);
    if (str !== '{}' && str !== '[]') logs.push(str);
  }

  return { logs, error };
}

export const CodeExecutorRenderer = memo(function CodeExecutorRenderer({
  input,
  output,
}: ToolRendererProps) {
  const { t } = useTranslation('chat');
  const [activeTab, setActiveTab] = useState<'code' | 'output'>(
    output != null ? 'output' : 'code'
  );
  const [copied, setCopied] = useState(false);

  const code = useMemo(() => extractCode(input), [input]);
  const language = useMemo(() => extractLanguage(input, ''), [input]);
  const { logs, error } = useMemo(() => extractOutput(output), [output]);

  const handleCopyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard may not be available
    }
  }, [code]);

  const langLabel = language === 'javascript' ? 'JS' : language === 'python' ? 'PY' : language.toUpperCase();

  return (
    <div className="flex flex-col gap-1">
      {/* Header with language badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            className={cn(
              'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors flex items-center gap-1',
              activeTab === 'code'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            )}
            onClick={() => setActiveTab('code')}
          >
            <Code2 className="h-3 w-3" />
            {t('tool.code', 'Code')}
          </button>
          {output != null && (
            <button
              className={cn(
                'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors flex items-center gap-1',
                activeTab === 'output'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
              onClick={() => setActiveTab('output')}
            >
              <Terminal className="h-3 w-3" />
              {t('tool.output', 'Output')}
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono font-bold text-muted-foreground">
            {langLabel}
          </span>
          <button
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            onClick={handleCopyCode}
          >
            {copied ? (
              <Check className="h-3 w-3 text-emerald-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      {activeTab === 'code' ? (
        <pre className="rounded-lg bg-zinc-950 dark:bg-zinc-900/80 px-3 py-2.5 text-xs text-zinc-200 overflow-x-auto max-h-[400px] overflow-y-auto leading-relaxed font-mono">
          {code || t('tool.noData', 'No data')}
        </pre>
      ) : (
        <div className="rounded-lg bg-muted/50 overflow-hidden max-h-[300px] overflow-y-auto">
          {/* Logs */}
          {logs.length > 0 && (
            <div className="px-3 py-2 space-y-0.5">
              {logs.map((log, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <ChevronRight className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground/50" />
                  <span className="whitespace-pre-wrap break-all">{log}</span>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-1.5 px-3 py-2 bg-destructive/10 text-destructive text-xs border-t border-destructive/20">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
              <span className="whitespace-pre-wrap break-all">{error}</span>
            </div>
          )}

          {/* No output */}
          {logs.length === 0 && !error && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              {t('tool.noOutput', 'No output')}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
CodeExecutorRenderer.displayName = 'CodeExecutorRenderer';
