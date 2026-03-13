/**
 * Web Search Tool Renderer
 * Renders search results as a clean list with titles, URLs, and descriptions.
 * Triggered when tool name contains "search".
 */
import { useState, useMemo, memo } from 'react';
import { ExternalLink, Globe, Search, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type { ToolRendererProps } from './index';

/** A generic search result shape — tolerant of different provider formats */
interface SearchResult {
  title?: string;
  url?: string;
  link?: string;
  href?: string;
  description?: string;
  snippet?: string;
  text?: string;
  content?: string;
}

/** Try to extract an array of search results from tool output */
function extractResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== 'object') return [];

  // Direct array of results
  if (Array.isArray(data)) return data as SearchResult[];

  const obj = data as Record<string, unknown>;

  // Common wrapper fields
  if (Array.isArray(obj.results)) return obj.results as SearchResult[];
  if (Array.isArray(obj.items)) return obj.items as SearchResult[];
  if (Array.isArray(obj.data)) return obj.data as SearchResult[];
  if (Array.isArray(obj.organic)) return obj.organic as SearchResult[];
  if (Array.isArray(obj.web)) return obj.web as SearchResult[];

  return [];
}

function getUrl(result: SearchResult): string {
  return result.url || result.link || result.href || '';
}

function getDescription(result: SearchResult): string {
  return result.description || result.snippet || result.text || result.content || '';
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export const WebSearchRenderer = memo(function WebSearchRenderer({
  name,
  input,
  output,
}: ToolRendererProps) {
  const { t } = useTranslation('chat');
  const [activeTab, setActiveTab] = useState<'results' | 'input'>(
    output != null ? 'results' : 'input'
  );

  const query = useMemo(() => {
    if (!input || typeof input !== 'object') return '';
    const inp = input as Record<string, unknown>;
    return (
      (typeof inp.query === 'string' ? inp.query : '') ||
      (typeof inp.q === 'string' ? inp.q : '') ||
      (typeof inp.search === 'string' ? inp.search : '') ||
      ''
    );
  }, [input]);

  const results = useMemo(() => extractResults(output), [output]);

  const isError = useMemo(() => {
    if (!output || typeof output !== 'object') return false;
    const obj = output as Record<string, unknown>;
    return obj.isError === true || obj.error != null;
  }, [output]);

  const errorMessage = useMemo(() => {
    if (!output || typeof output !== 'object') return '';
    const obj = output as Record<string, unknown>;
    return typeof obj.error === 'string' ? obj.error : '';
  }, [output]);

  // No output yet — show input
  if (output == null) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">
            {t('tool.searchingFor', 'Searching for')}: &ldquo;{query}&rdquo;
          </span>
        </div>
        <pre className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground overflow-x-auto">
          {typeof input === 'string' ? input : JSON.stringify(input, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">
          {t('tool.searchResults', 'Search Results')}
        </span>
        {query && (
          <span className="text-[11px] text-muted-foreground/70 truncate max-w-[200px]">
            &ldquo;{query}&rdquo;
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1">
        <button
          className={cn(
            'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
            activeTab === 'results'
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
          )}
          onClick={() => setActiveTab('results')}
        >
          {t('tool.results', 'Results')} ({results.length})
        </button>
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
      </div>

      {/* Content */}
      {activeTab === 'input' ? (
        <pre className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground overflow-x-auto max-h-[300px] overflow-y-auto leading-relaxed">
          {typeof input === 'string' ? input : JSON.stringify(input, null, 2)}
        </pre>
      ) : isError ? (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{errorMessage || t('tool.searchError', 'Search failed')}</span>
        </div>
      ) : results.length === 0 ? (
        <div className="rounded-lg bg-muted/50 px-3 py-4 text-center text-xs text-muted-foreground">
          {t('tool.noResults', 'No results found')}
        </div>
      ) : (
        <div className="flex flex-col gap-1 max-h-[400px] overflow-y-auto">
          {results.map((result, i) => {
            const url = getUrl(result);
            const desc = getDescription(result);
            return (
              <div
                key={i}
                className="group flex flex-col gap-0.5 rounded-lg px-3 py-2 hover:bg-accent/50 transition-colors"
              >
                {/* Title + link */}
                <div className="flex items-start gap-1.5">
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-primary hover:underline flex items-center gap-1 min-w-0"
                    >
                      <span className="truncate">{result.title || url}</span>
                      <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </a>
                  ) : (
                    <span className="text-xs font-medium">{result.title || `${name} #${i + 1}`}</span>
                  )}
                </div>

                {/* Domain */}
                {url && (
                  <span className="text-[10px] text-muted-foreground/60 truncate">
                    {getDomain(url)}
                  </span>
                )}

                {/* Description */}
                {desc && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                    {desc}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
WebSearchRenderer.displayName = 'WebSearchRenderer';
