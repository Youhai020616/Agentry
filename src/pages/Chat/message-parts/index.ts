/**
 * Message Parts — Modular message component exports
 *
 * This directory contains the refactored message part components,
 * split from the monolithic ChatMessage.tsx.
 *
 * Structure:
 * - WordByWordFadeIn.tsx: Streaming word-level fade-in animation
 * - UserMessagePart.tsx:  User message with edit/copy/delete actions, long-text truncation
 * - AssistMessagePart.tsx: Assistant message with Markdown, streaming cursor, copy/regenerate
 * - ReasoningPart.tsx:    Collapsible thinking/reasoning block with framer-motion animation
 * - ToolMessagePart.tsx:  Tool status bar + tool card components
 */

export { UserMessagePart } from './UserMessagePart';
export type { UserMessagePartProps } from './UserMessagePart';

export { AssistMessagePart } from './AssistMessagePart';
export type { AssistMessagePartProps } from './AssistMessagePart';

export { ReasoningPart } from './ReasoningPart';
export type { ReasoningPartProps } from './ReasoningPart';

export { ToolStatusBar, ToolCard } from './ToolMessagePart';
export type { ToolStatusItem, ToolCardProps } from './ToolMessagePart';

export { WordByWordFadeIn } from './WordByWordFadeIn';
