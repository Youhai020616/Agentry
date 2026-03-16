/**
 * Chat Message Component — Parts Dispatcher
 *
 * Thin orchestrator that inspects the message role/content and delegates
 * rendering to the appropriate part component from `./message-parts/`.
 *
 * Props interface is backwards-compatible with the previous monolithic version
 * so Chat/index.tsx does not need changes.
 */
import { memo } from 'react';
import type { RawMessage, ToolStatus } from '@/stores/chat';
import { extractText, extractThinking, extractImages, extractToolUse } from './message-utils';
import { UserMessagePart } from './message-parts/UserMessagePart';
import { AssistMessagePart } from './message-parts/AssistMessagePart';
import { ReasoningPart } from './message-parts/ReasoningPart';
import { ToolStatusBar, ToolCard } from './message-parts/ToolMessagePart';

// ── Props (backwards-compatible) ─────────────────────────────────

export interface ChatMessageProps {
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
  /** Map of toolCallId → tool result output, used by ToolCard renderers */
  toolResultsMap?: Map<string, unknown>;
  /** Callback when user edits a message (optional — wired in Phase B) */
  onEditMessage?: (messageId: string, newText: string) => void;
  /** Callback when user deletes a message (optional — wired in Phase B) */
  onDeleteMessage?: (messageId: string) => void;
  /** Callback when user requests regeneration (optional — wired in Phase B) */
  onRegenerate?: () => void;
}

// ── Component ────────────────────────────────────────────────────

export const ChatMessage = memo(
  function ChatMessage({
    message,
    showThinking,
    isStreaming = false,
    streamingTools = [],
    toolResultsMap,
    onEditMessage,
    onDeleteMessage,
    onRegenerate,
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

    // ── User message → delegate to UserMessagePart ────────────
    if (isUser) {
      return (
        <UserMessagePart message={message} onEdit={onEditMessage} onDelete={onDeleteMessage} />
      );
    }

    // ── Assistant message — compose parts ─────────────────────
    return (
      <div className="flex flex-col gap-2">
        {/* Tool status bar — always shown for assistant messages (live or completed) */}
        {isStreaming && streamingTools.length > 0 && (
          <div className="flex gap-3 flex-row">
            <div className="w-8 shrink-0" /> {/* avatar spacer */}
            <div className="flex flex-col w-full max-w-[80%] space-y-2 items-start">
              <ToolStatusBar tools={streamingTools} />
            </div>
          </div>
        )}
        {!isStreaming && savedToolStatuses.length > 0 && (
          <div className="flex gap-3 flex-row">
            <div className="w-8 shrink-0" />
            <div className="flex flex-col w-full max-w-[80%] space-y-2 items-start">
              <ToolStatusBar tools={savedToolStatuses} />
            </div>
          </div>
        )}

        {/* Thinking / Reasoning section */}
        {visibleThinking && (
          <div className="flex gap-3 flex-row">
            <div className="w-8 shrink-0" />
            <div className="flex flex-col w-full max-w-[80%] space-y-2 items-start">
              <ReasoningPart content={visibleThinking} isThinking={isStreaming} />
            </div>
          </div>
        )}

        {/* Tool use cards */}
        {visibleTools.length > 0 && (
          <div className="flex gap-3 flex-row">
            <div className="w-8 shrink-0" />
            <div className="flex flex-col w-full max-w-[80%] space-y-1 items-start">
              {visibleTools.map((tool, i) => (
                <ToolCard
                  key={tool.id || i}
                  name={tool.name}
                  input={tool.input}
                  output={tool.id ? toolResultsMap?.get(tool.id) : undefined}
                />
              ))}
            </div>
          </div>
        )}

        {/* Main assistant text (with avatar, images, actions) */}
        {(hasText || isErrorResponse || images.length > 0 || attachedFiles.length > 0) && (
          <AssistMessagePart
            message={message}
            isStreaming={isStreaming}
            streamingTools={streamingTools}
            onRegenerate={onRegenerate}
          />
        )}
      </div>
    );
  },
  (prev, next) => {
    // Custom memo comparison — only re-render when meaningful props change
    if (prev.message.id !== next.message.id) return false;
    if (prev.message.content !== next.message.content) return false;
    if (prev.message.timestamp !== next.message.timestamp) return false;
    if (prev.message.stopReason !== next.message.stopReason) return false;
    if (prev.message.errorMessage !== next.message.errorMessage) return false;
    if (prev.message._attachedFiles !== next.message._attachedFiles) return false;
    if (prev.message._toolStatuses !== next.message._toolStatuses) return false;
    if (prev.showThinking !== next.showThinking) return false;
    if (prev.isStreaming !== next.isStreaming) return false;
    if (prev.streamingTools !== next.streamingTools) return false;
    if (prev.toolResultsMap !== next.toolResultsMap) return false;
    if (prev.onEditMessage !== next.onEditMessage) return false;
    if (prev.onDeleteMessage !== next.onDeleteMessage) return false;
    if (prev.onRegenerate !== next.onRegenerate) return false;
    return true;
  }
);
ChatMessage.displayName = 'ChatMessage';
