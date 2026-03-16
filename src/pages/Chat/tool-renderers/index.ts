/**
 * Tool Renderer Router
 * Selects the appropriate specialized renderer based on tool name.
 * Falls back to DefaultRenderer for unknown tool types.
 */
import type { ComponentType } from 'react';
import { WebSearchRenderer } from './WebSearchRenderer';
import { CodeExecutorRenderer } from './CodeExecutorRenderer';
import { BrowserRenderer } from './BrowserRenderer';
import { DefaultRenderer } from './DefaultRenderer';

/** Props shared by all tool renderers */
export interface ToolRendererProps {
  /** Tool name */
  name: string;
  /** Tool call input (arguments sent to the tool) */
  input: unknown;
  /** Tool execution output / result (undefined if not yet completed) */
  output?: unknown;
}

/** Select the best renderer component based on tool name */
export function getToolRenderer(toolName: string): ComponentType<ToolRendererProps> {
  const n = toolName.toLowerCase();

  if (n.includes('search')) {
    return WebSearchRenderer;
  }
  if (n.includes('code') || n.includes('execute') || n.includes('run_code') || n.includes('interpreter')) {
    return CodeExecutorRenderer;
  }
  if (n.includes('browser') || n.includes('navigate') || n.includes('playwright')) {
    return BrowserRenderer;
  }

  return DefaultRenderer;
}

export { WebSearchRenderer, CodeExecutorRenderer, BrowserRenderer, DefaultRenderer };
