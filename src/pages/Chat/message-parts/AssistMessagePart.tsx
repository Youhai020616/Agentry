/**
 * Assistant Message Part
 * Renders assistant text with Markdown, streaming cursor, word-by-word fade-in,
 * and hover action buttons (copy / regenerate).
 */
import {
  useState,
  useCallback,
  memo,
  useMemo,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import { Copy, Check, RefreshCw, Sparkles, AlertTriangle, File } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { RawMessage, AttachedFileMeta } from '@/stores/chat';
import { extractText, extractImages, formatTimestamp } from '../message-utils';
import { WordByWordFadeIn } from './WordByWordFadeIn';

// ── File helpers ─────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function FileCard({ file }: { file: AttachedFileMeta }) {
  return (
    <div className="flex items-center gap-2 rounded-lg glass-block-subtle px-3 py-2 max-w-[220px]">
      <File className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 overflow-hidden">
        <p className="text-xs font-medium truncate">{file.fileName}</p>
        <p className="text-[10px] text-muted-foreground">
          {file.fileSize > 0 ? formatFileSize(file.fileSize) : 'File'}
        </p>
      </div>
    </div>
  );
}

// ── Streaming Markdown components ────────────────────────────────

/**
 * Build markdown renderer components that optionally wrap text children
 * in WordByWordFadeIn when streaming.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeStreamingComponents(isStreaming: boolean): any {
  // When not streaming, use default rendering (no fade-in wrappers)
  if (!isStreaming) {
    return {
      code({
        className,
        children,
        ...props
      }: {
        className?: string;
        children?: ReactNode;
        [key: string]: unknown;
      }) {
        const match = /language-(\w+)/.exec(className || '');
        const isInline = !match && !className;
        if (isInline) {
          return (
            <code className="bg-background/50 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
              {children}
            </code>
          );
        }
        return (
          <pre className="bg-background/50 rounded-lg p-4 overflow-x-auto">
            <code className={cn('text-sm font-mono', className)} {...props}>
              {children}
            </code>
          </pre>
        );
      },
      a({ href, children }: { href?: string; children?: ReactNode }) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {children}
          </a>
        );
      },
    };
  }

  // Streaming mode: wrap text in WordByWordFadeIn
  const Wrap = ({ children }: PropsWithChildren) => <WordByWordFadeIn>{children}</WordByWordFadeIn>;

  return {
    p({ children }: { children?: ReactNode }) {
      return (
        <p className="leading-relaxed my-3 break-words">
          <Wrap>{children}</Wrap>
        </p>
      );
    },
    li({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) {
      return (
        <li className="py-0.5 break-words" {...props}>
          <Wrap>{children}</Wrap>
        </li>
      );
    },
    strong({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) {
      return (
        <span className="font-semibold" {...props}>
          <Wrap>{children}</Wrap>
        </span>
      );
    },
    h1({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) {
      return (
        <h1 className="text-2xl font-semibold mt-6 mb-2" {...props}>
          <Wrap>{children}</Wrap>
        </h1>
      );
    },
    h2({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) {
      return (
        <h2 className="text-xl font-semibold mt-5 mb-2" {...props}>
          <Wrap>{children}</Wrap>
        </h2>
      );
    },
    h3({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) {
      return (
        <h3 className="text-lg font-semibold mt-4 mb-2" {...props}>
          <Wrap>{children}</Wrap>
        </h3>
      );
    },
    code({
      className,
      children,
      ...props
    }: {
      className?: string;
      children?: ReactNode;
      [key: string]: unknown;
    }) {
      const match = /language-(\w+)/.exec(className || '');
      const isInline = !match && !className;
      if (isInline) {
        return (
          <code className="bg-background/50 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
            {children}
          </code>
        );
      }
      return (
        <pre className="bg-background/50 rounded-lg p-4 overflow-x-auto">
          <code className={cn('text-sm font-mono', className)} {...props}>
            {children}
          </code>
        </pre>
      );
    },
    a({ href, children }: { href?: string; children?: ReactNode }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          <Wrap>{children}</Wrap>
        </a>
      );
    },
  };
}

// ── Props ────────────────────────────────────────────────────────

export interface AssistMessagePartProps {
  message: RawMessage;
  isStreaming?: boolean;
  streamingTools?: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    status: 'running' | 'completed' | 'error';
    durationMs?: number;
    summary?: string;
  }>;
  onRegenerate?: () => void;
}

// ── Component ────────────────────────────────────────────────────

export const AssistMessagePart = memo(
  function AssistMessagePart({
    message,
    isStreaming = false,
    onRegenerate,
  }: AssistMessagePartProps) {
    const { t } = useTranslation('chat');
    const text = extractText(message);
    const hasText = text.trim().length > 0;
    const images = extractImages(message);
    const attachedFiles = message._attachedFiles || [];
    const isErrorResponse = message.stopReason === 'error' || !!message.errorMessage;

    const [copied, setCopied] = useState(false);

    const copyContent = useCallback(() => {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }, [text]);

     
    const mdComponents = useMemo(() => makeStreamingComponents(isStreaming), [isStreaming]);

    return (
      <div className="flex gap-3 group flex-row">
        {/* Avatar */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-1 bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
          <Sparkles className="h-4 w-4" />
        </div>

        {/* Content */}
        <div className="flex flex-col w-full max-w-[80%] space-y-2 items-start">
          {/* Error response from LLM provider */}
          {isErrorResponse && !hasText && (
            <div className="w-full rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  {message.errorMessage || 'An error occurred while generating the response.'}
                </span>
              </div>
            </div>
          )}

          {/* Main text bubble with Markdown */}
          {hasText && (
            <div className={cn('relative rounded-2xl px-4 py-3 w-full glass-bubble-assistant')}>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {text}
                </ReactMarkdown>
                {isStreaming && (
                  <span className="inline-block w-2 h-4 bg-foreground/50 animate-pulse ml-0.5" />
                )}
              </div>

              {/* Footer: timestamp */}
              {!isStreaming && message.timestamp && (
                <div className="flex items-center mt-2">
                  <span className="text-xs text-muted-foreground">
                    {formatTimestamp(message.timestamp)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Images — assistant (below text) */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {images.map((img, i) => (
                <img
                  key={`content-${i}`}
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt="attachment"
                  className="max-w-xs rounded-lg border"
                />
              ))}
            </div>
          )}

          {/* File attachments — assistant (below text) */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachedFiles.map((file, i) => {
                const isImage = file.mimeType.startsWith('image/');
                if (isImage && images.length > 0) return null;
                if (isImage && file.preview) {
                  return (
                    <img
                      key={`local-${i}`}
                      src={file.preview}
                      alt={file.fileName}
                      className="max-w-xs rounded-lg border"
                    />
                  );
                }
                if (isImage && !file.preview) {
                  return (
                    <div
                      key={`local-${i}`}
                      className="w-36 h-36 rounded-xl border overflow-hidden bg-muted flex items-center justify-center text-muted-foreground"
                    >
                      <File className="h-8 w-8" />
                    </div>
                  );
                }
                return <FileCard key={`local-${i}`} file={file} />;
              })}
            </div>
          )}

          {/* Action buttons — visible on hover */}
          {hasText && !isStreaming && (
            <div className="flex opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copyContent}>
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('message.copy')}</TooltipContent>
              </Tooltip>
              {onRegenerate && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRegenerate}>
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t('message.regenerate')}</TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
        </div>
      </div>
    );
  },
  (prev, next) => {
    if (prev.message.id !== next.message.id) return false;
    if (prev.message.content !== next.message.content) return false;
    if (prev.message.timestamp !== next.message.timestamp) return false;
    if (prev.message.stopReason !== next.message.stopReason) return false;
    if (prev.message.errorMessage !== next.message.errorMessage) return false;
    if (prev.message._attachedFiles !== next.message._attachedFiles) return false;
    if (prev.isStreaming !== next.isStreaming) return false;
    if (prev.onRegenerate !== next.onRegenerate) return false;
    return true;
  }
);
AssistMessagePart.displayName = 'AssistMessagePart';
