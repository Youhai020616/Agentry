/**
 * Tool Registry
 * Manages tool definitions from skill manifests and resolves secrets for execution.
 * Generates tool prompt sections for system prompt injection.
 *
 * Supports two categories of tools:
 * 1. **Custom tools** — defined with a `cli` field in the manifest (e.g. `python`, `web-search`)
 * 2. **Built-in tools** — recognized by name (e.g. `browser`), no `cli` needed;
 *    the system generates specialized prompt instructions automatically.
 */
import { logger } from '../utils/logger';
import { isBuiltinTool, generateBuiltinToolPrompt } from './browser-tool-prompt';
import type { SkillManifest } from '@shared/types/manifest';

export interface ToolDefinition {
  name: string;
  description: string;
  cli: string;
  parameters?: Record<string, unknown>;
  requiredSecret?: string;
}

export interface ResolvedTool extends ToolDefinition {
  resolvedEnv: Record<string, string>; // secrets injected
}

/**
 * ToolRegistry — stores per-employee tool definitions derived from skill manifests.
 *
 * Usage:
 *  1. Call `registerFromManifest(employeeId, manifest)` when creating an employee.
 *  2. Call `generateToolPromptSection(employeeId)` in the compiler to append tools to system prompt.
 *  3. Call `resolveTools(employeeId, secrets)` at execution time to inject secret env vars.
 */
export class ToolRegistry {
  /** employeeId → custom CLI tool definitions */
  private tools: Map<string, ToolDefinition[]> = new Map();

  /** employeeId → set of built-in tool names (e.g. 'browser') */
  private builtinTools: Map<string, Set<string>> = new Map();

  /**
   * Register tools from a skill manifest for an employee.
   * Overwrites any previously registered tools for the same employeeId.
   *
   * Tools are split into two categories:
   * - Built-in tools (name recognized by `isBuiltinTool()`) → stored in `builtinTools`
   * - Custom tools (have a `cli` field) → stored in `tools`
   */
  registerFromManifest(employeeId: string, manifest: SkillManifest): void {
    if (!manifest.tools || manifest.tools.length === 0) {
      logger.debug(`[ToolRegistry] No tools in manifest for employee ${employeeId}`);
      return;
    }

    const customDefs: ToolDefinition[] = [];
    const builtins = new Set<string>();

    for (const tool of manifest.tools) {
      if (isBuiltinTool(tool.name)) {
        builtins.add(tool.name);
        logger.debug(
          `[ToolRegistry] Registered built-in tool "${tool.name}" for employee ${employeeId}`
        );
      } else if (tool.cli) {
        customDefs.push({
          name: tool.name,
          description: tool.description || `Tool: ${tool.name}`,
          cli: tool.cli,
          requiredSecret: tool.requiredSecret,
        });
      } else {
        logger.warn(
          `[ToolRegistry] Tool "${tool.name}" for employee ${employeeId} is not a recognized built-in and has no "cli" field — skipping`
        );
      }
    }

    // Store custom tools (overwrite previous)
    if (customDefs.length > 0) {
      this.tools.set(employeeId, customDefs);
    } else {
      this.tools.delete(employeeId);
    }

    // Store built-in tools (overwrite previous)
    if (builtins.size > 0) {
      this.builtinTools.set(employeeId, builtins);
    } else {
      this.builtinTools.delete(employeeId);
    }

    const allNames = [...customDefs.map((d) => d.name), ...builtins];

    if (allNames.length > 0) {
      logger.info(
        `[ToolRegistry] Registered ${allNames.length} tool(s) for employee ${employeeId}: ${allNames.join(', ')}`
      );
    }
  }

  // ── Built-in tool queries ─────────────────────────────────────────

  /**
   * Register a single built-in tool for an employee (programmatic, not from manifest).
   */
  registerBuiltinTool(employeeId: string, toolName: string): void {
    let set = this.builtinTools.get(employeeId);
    if (!set) {
      set = new Set();
      this.builtinTools.set(employeeId, set);
    }
    set.add(toolName);
    logger.debug(
      `[ToolRegistry] Registered built-in tool "${toolName}" for employee ${employeeId}`
    );
  }

  /**
   * Check whether an employee has a specific built-in tool registered.
   */
  hasBuiltinTool(employeeId: string, toolName: string): boolean {
    return this.builtinTools.get(employeeId)?.has(toolName) ?? false;
  }

  /**
   * Get the list of built-in tool names registered for an employee.
   */
  getBuiltinTools(employeeId: string): string[] {
    const set = this.builtinTools.get(employeeId);
    return set ? Array.from(set) : [];
  }

  // ── Custom tool queries ───────────────────────────────────────────

  /**
   * Get raw custom tool definitions for an employee.
   */
  getTools(employeeId: string): ToolDefinition[] {
    return this.tools.get(employeeId) ?? [];
  }

  /**
   * Resolve custom tools with injected secret environment variables.
   * @param employeeId  The employee whose tools to resolve
   * @param secrets     Map of secret key -> value (from employee secrets store)
   * @returns Array of resolved tools with env vars populated
   */
  resolveTools(employeeId: string, secrets: Record<string, string>): ResolvedTool[] {
    const tools = this.getTools(employeeId);
    return tools.map((tool) => ({
      ...tool,
      resolvedEnv:
        tool.requiredSecret && secrets[tool.requiredSecret]
          ? { [tool.requiredSecret]: secrets[tool.requiredSecret] }
          : {},
    }));
  }

  // ── Prompt generation ─────────────────────────────────────────────

  /**
   * Generate a Markdown section describing available tools for system prompt injection.
   *
   * This combines:
   * 1. Custom tool descriptions (cli-based tools from manifest)
   * 2. Built-in tool prompt sections (e.g. comprehensive browser instructions)
   *
   * Returns an empty string if the employee has no registered tools of any kind.
   */
  generateToolPromptSection(employeeId: string): string {
    const customTools = this.getTools(employeeId);
    const builtinNames = this.getBuiltinTools(employeeId);

    if (customTools.length === 0 && builtinNames.length === 0) {
      return '';
    }

    const sections: string[] = [];

    // 1. Custom tool descriptions
    if (customTools.length > 0) {
      const toolDescriptions = customTools
        .map((t) => `- **${t.name}**: Execute via \`${t.cli}\``)
        .join('\n');

      sections.push(
        [
          '',
          '',
          '## Available Tools',
          '',
          'You have access to the following tools:',
          toolDescriptions,
          '',
          'To use a tool, describe what you want to do and the system will execute it.',
        ].join('\n')
      );
    }

    // 2. Built-in tool prompt sections
    for (const toolName of builtinNames) {
      const builtinSection = generateBuiltinToolPrompt(toolName);
      if (builtinSection) {
        sections.push(builtinSection);
      }
    }

    return sections.join('');
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  /**
   * Remove all registered tools (custom + built-in) for an employee.
   */
  unregister(employeeId: string): void {
    this.tools.delete(employeeId);
    this.builtinTools.delete(employeeId);
    logger.debug(`[ToolRegistry] Unregistered all tools for employee ${employeeId}`);
  }

  /**
   * Check whether an employee has any registered tools (custom or built-in).
   */
  hasTools(employeeId: string): boolean {
    const customTools = this.tools.get(employeeId);
    const builtins = this.builtinTools.get(employeeId);
    return (!!customTools && customTools.length > 0) || (!!builtins && builtins.size > 0);
  }
}
