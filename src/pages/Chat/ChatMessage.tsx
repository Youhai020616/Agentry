/**
 * Chat Message Component
 * Renders user / assistant / system / toolresult messages
 * with markdown, thinking sections, images, and tool cards.
 */
import { useState, useCallback, memo } from 'react';
import {
  User,
  Sparkles,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Wrench,
  FileText,
  Film,
  Music,
  FileArchive,
  File,
  AlertTriangle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { RawMessage, AttachedFileMeta, ToolStatus } from '@/stores/chat';
import {
  extractText,
  extractThinking,
  extractImages,
  extractToolUse,
  formatTimestamp,
} from './message-utils';

interface ChatMessageProps {
  message: RawMessage;
  showThinking: boolean;
  isStreaming?: boolean;
  streamingTools?: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    status: 'running' | 'completed' | 'error';
    durationMs?: number;
    summary?: string;
  }>;
}

export const ChatMessage = memo(function ChatMessage({
  message,
  showThinking,
  isStreaming = false,
  streamingTools = [],
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
  const isToolResult = role === 'toolresult' || role === 'tool_result';
  const text = extractText(message);
  const hasText = text.trim().length > 0;
  const thinking = extractThinking(message);
  const images = extractImages(message);
  const tools = extractToolUse(message);
  const visibleThinking = showThinking ? thinking : null;
  // Tool calls are always visible — they're core information users need to see
  // (only the "thinking" block is controlled by the showThinking toggle)
  const visibleTools = tools;

  const attachedFiles = message._attachedFiles || [];
  const errorMessage = message.errorMessage;
  const isErrorResponse = !isUser && (message.stopReason === 'error' || !!errorMessage);

  // Tool statuses preserved from streaming phase — always render on completed messages
  const savedToolStatuses: ToolStatus[] = (!isStreaming && message._toolStatuses) || [];

  // Never render tool result messages in chat UI
  if (isToolResult) return null;

  // Don't render empty messages (also keep messages with tool status or errors)
  const hasStreamingToolStatus = isStreaming && streamingTools.length > 0;
  const hasSavedToolStatus = savedToolStatuses.length > 0;
  if (
    !hasText &&
    !visibleThinking &&
    images.length === 0 &&
    visibleTools.length === 0 &&
    attachedFiles.length === 0 &&
    !hasStreamingToolStatus &&
    !hasSavedToolStatus &&
    !isErrorResponse
  )
    return null;

  return (
    <div className={cn('flex gap-3 group', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar */}
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-1',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white'
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
      </div>

      {/* Content */}
      <div
        className={cn(
          'flex flex-col w-full max-w-[80%] space-y-2',
          isUser ? 'items-end' : 'items-start'
        )}
      >
        {/* Tool status bar — always shown for assistant messages (live or completed) */}
        {isStreaming && !isUser && streamingTools.length > 0 && (
          <ToolStatusBar tools={streamingTools} />
        )}
        {!isStreaming && !isUser && savedToolStatuses.length > 0 && (
          <ToolStatusBar tools={savedToolStatuses} />
        )}

        {/* Thinking section */}
        {visibleThinking && <ThinkingBlock content={visibleThinking} />}

        {/* Tool use cards */}
        {visibleTools.length > 0 && (
          <div className="space-y-1">
            {visibleTools.map((tool, i) => (
              <ToolCard key={tool.id || i} name={tool.name} input={tool.input} />
            ))}
          </div>
        )}

        {/* Error response from LLM provider */}
        {isErrorResponse && !hasText && (
          <div className="w-full rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{errorMessage || 'An error occurred while generating the response.'}</span>
            </div>
          </div>
        )}

        {/* Images — rendered ABOVE text bubble for user messages */}
        {/* Images from content blocks (Gateway session data) */}
        {isUser && images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => (
              <div key={`content-${i}`} className="w-36 h-36 rounded-xl border overflow-hidden">
                <img
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt="attachment"
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>
        )}

        {/* File attachments — images above text for user, file cards below */}
        {isUser && attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map((file, i) => {
              const isImage = file.mimeType.startsWith('image/');
              // Skip image attachments if we already have images from content blocks
              if (isImage && images.length > 0) return null;
              // Image files → always render as square crop (with preview or placeholder)
              if (isImage) {
                return (
                  <div
                    key={`local-${i}`}
                    className="w-36 h-36 rounded-xl border overflow-hidden bg-muted"
                  >
                    {file.preview ? (
                      <img
                        src={file.preview}
                        alt={file.fileName}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <File className="h-8 w-8" />
                      </div>
                    )}
                  </div>
                );
              }
              // Non-image files → file card
              return <FileCard key={`local-${i}`} file={file} />;
            })}
          </div>
        )}

        {/* Main text bubble */}
        {hasText && (
          <MessageBubble
            text={text}
            isUser={isUser}
            isStreaming={isStreaming}
            timestamp={message.timestamp}
          />
        )}

        {/* Images from content blocks — assistant messages (below text) */}
        {!isUser && images.length > 0 && (
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

        {/* File attachments — assistant messages (below text) */}
        {!isUser && attachedFiles.length > 0 && (
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

        {/* Hover timestamp for user messages (shown below content on hover) */}
        {isUser && message.timestamp && (
          <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-200 select-none">
            {formatTimestamp(message.timestamp)}
          </span>
        )}
      </div>
    </div>
  );
});

function formatDuration(durationMs?: number): string | null {
  if (!durationMs || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function ToolStatusIcon({ status }: { status: 'running' | 'completed' | 'error' }) {
  if (status === 'running') {
    return (
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
      </span>
    );
  }
  if (status === 'error') {
    return <AlertTriangle className="h-3 w-3 text-destructive" />;
  }
  // completed
  return <Check className="h-3 w-3 text-emerald-500" />;
}

function ToolStatusBar({
  tools,
}: {
  tools: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    status: 'running' | 'completed' | 'error';
    durationMs?: number;
    summary?: string;
  }>;
}) {
  return (
    <div className="w-full rounded-xl border border-border/40 bg-muted/30 backdrop-blur-sm px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5 mb-1.5 text-muted-foreground">
        <Wrench className="h-3 w-3" />
        <span className="font-medium text-[11px] uppercase tracking-wide">Tool Calls</span>
      </div>
      <div className="space-y-1">
        {tools.map((tool) => {
          const duration = formatDuration(tool.durationMs);
          return (
            <div
              key={tool.toolCallId || tool.id || `${tool.name}-${tool.status}`}
              className={cn(
                'flex items-center gap-2 rounded-lg px-2 py-1 transition-colors',
                tool.status === 'running' && 'bg-blue-500/5',
                tool.status === 'completed' && 'bg-emerald-500/5',
                tool.status === 'error' && 'bg-destructive/5'
              )}
            >
              <ToolStatusIcon status={tool.status} />
              <span
                className={cn(
                  'font-mono text-[11px] font-medium',
                  tool.status === 'running' && 'text-blue-600 dark:text-blue-400',
                  tool.status === 'completed' && 'text-emerald-600 dark:text-emerald-400',
                  tool.status === 'error' && 'text-destructive'
                )}
              >
                {tool.name}
              </span>
              {duration && (
                <span className="text-[10px] text-muted-foreground/70">{duration}</span>
              )}
              {tool.summary && (
                <span className="truncate text-[10px] text-muted-foreground/70 ml-auto max-w-[200px]">
                  {tool.summary}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Message Bubble ──────────────────────────────────────────────

function MessageBubble({
  text,
  isUser,
  isStreaming,
  timestamp,
}: {
  text: string;
  isUser: boolean;
  isStreaming: boolean;
  timestamp?: number;
}) {
  const [copied, setCopied] = useState(false);

  const copyContent = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <div
      className={cn(
        'relative rounded-2xl px-4 py-3',
        !isUser && 'w-full',
        isUser ? 'glass-bubble-user' : 'glass-bubble-assistant'
      )}
    >
      {isUser ? (
        <p className="whitespace-pre-wrap text-sm">{text}</p>
      ) : (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const isInline = !match && !className;
                if (isInline) {
                  return (
                    <code
                      className="bg-background/50 px-1.5 py-0.5 rounded text-sm font-mono"
                      {...props}
                    >
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
              a({ href, children }) {
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
            }}
          >
            {text}
          </ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-foreground/50 animate-pulse ml-0.5" />
          )}
        </div>
      )}

      {/* Footer: copy button (assistant only; user timestamp is rendered outside the bubble) */}
      {!isUser && (
        <div className="flex items-center justify-between mt-2">
          {timestamp ? (
            <span className="text-xs text-muted-foreground">{formatTimestamp(timestamp)}</span>
          ) : (
            <span />
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={copyContent}
          >
            {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Thinking Block ──────────────────────────────────────────────

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="w-full rounded-xl border border-amber-200/30 dark:border-amber-800/30 bg-amber-50/30 dark:bg-amber-950/10 text-sm">
      <button
        className="flex items-center gap-2 w-full px-3 py-2 text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <span className="font-medium text-xs">💭 Thinking</span>
        {!expanded && (
          <span className="text-[10px] text-amber-600/50 dark:text-amber-400/40 truncate max-w-[300px]">
            {content.slice(0, 80)}
            {content.length > 80 ? '…' : ''}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 text-muted-foreground border-t border-amber-200/20 dark:border-amber-800/20">
          <div className="prose prose-sm dark:prose-invert max-w-none opacity-75 pt-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

// ── File Card (for user-uploaded non-image files) ───────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith('video/')) return <Film className={className} />;
  if (mimeType.startsWith('audio/')) return <Music className={className} />;
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml'
  )
    return <FileText className={className} />;
  if (
    mimeType.includes('zip') ||
    mimeType.includes('compressed') ||
    mimeType.includes('archive') ||
    mimeType.includes('tar') ||
    mimeType.includes('rar') ||
    mimeType.includes('7z')
  )
    return <FileArchive className={className} />;
  if (mimeType === 'application/pdf') return <FileText className={className} />;
  return <File className={className} />;
}

function FileCard({ file }: { file: AttachedFileMeta }) {
  return (
    <div className="flex items-center gap-2 rounded-lg glass-block-subtle px-3 py-2 max-w-[220px]">
      <FileIcon mimeType={file.mimeType} className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 overflow-hidden">
        <p className="text-xs font-medium truncate">{file.fileName}</p>
        <p className="text-[10px] text-muted-foreground">
          {file.fileSize > 0 ? formatFileSize(file.fileSize) : 'File'}
        </p>
      </div>
    </div>
  );
}

// ── Tool Card ───────────────────────────────────────────────────

function ToolCard({ name, input }: { name: string; input: unknown }) {
  const [expanded, setExpanded] = useState(false);

  // Format input for display — truncate long values
  const formattedInput = (() => {
    if (input == null) return null;
    const raw = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
    return raw;
  })();

  // Short preview for collapsed state
  const preview = (() => {
    if (input == null) return '';
    if (typeof input === 'object') {
      const entries = Object.entries(input as Record<string, unknown>);
      if (entries.length === 0) return '';
      const first = entries[0];
      const val = typeof first[1] === 'string' ? first[1] : JSON.stringify(first[1]);
      const short = String(val).slice(0, 60);
      return `${first[0]}=${short}${String(val).length > 60 ? '…' : ''}`;
    }
    const s = String(input);
    return s.length > 60 ? s.slice(0, 60) + '…' : s;
  })();

  return (
    <div className="rounded-xl border border-border/40 bg-muted/20 backdrop-blur-sm text-sm overflow-hidden">
      <button
        className="flex items-center gap-2 w-full px-3 py-2 text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-center h-5 w-5 rounded bg-violet-500/10">
          <Wrench className="h-3 w-3 text-violet-500" />
        </div>
        <span className="font-mono text-xs font-medium">{name}</span>
        {!expanded && preview && (
          <span className="text-[10px] text-muted-foreground/60 truncate ml-1 max-w-[250px]">
            {preview}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="h-3 w-3 ml-auto shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 ml-auto shrink-0" />
        )}
      </button>
      {expanded && formattedInput != null && (
        <div className="border-t border-border/30">
          <pre className="px-3 py-2 text-[11px] text-muted-foreground overflow-x-auto max-h-[200px] overflow-y-auto">
            {formattedInput}
          </pre>
        </div>
      )}
    </div>
  );
}
