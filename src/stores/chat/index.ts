/**
 * Chat Store — Barrel Export
 *
 * Re-exports the store and all types so existing imports continue to work:
 *   import { useChatStore, type RawMessage } from '@/stores/chat';
 *
 * Internally the types are defined in ./types.ts and the store in ./store.ts.
 * This structure makes it easy to split the store further in the future.
 */
export { useChatStore } from './store';
export type {
  AttachedFileMeta,
  RawMessage,
  ContentBlock,
  ChatSession,
  ToolStatus,
  ChatState,
} from './types';
