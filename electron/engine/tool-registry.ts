/**
 * Tool Registry
 * Manages tool definitions from skill manifests and resolves secrets for execution.
 * Generates tool prompt sections for system prompt injection.
 */
import { logger } from '../utils/logger';
import type { SkillManifest } from '../../src/types/manifest';

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
  private tools: Map<string, ToolDefinition[]> = new Map(); // employeeId -> tools

  /**
   * Register tools from a skill manifest for an employee.
   * Overwrites any previously registered tools for the same employeeId.
   */
  registerFromManifest(employeeId: string, manifest: SkillManifest): void {
    if (!manifest.tools || manifest.tools.length === 0) {
      logger.debug(`[ToolRegistry] No tools in manifest for employee ${employeeId}`);
      return;
    }

    const defs: ToolDefinition[] = manifest.tools.map((tool) => ({
      name: tool.name,
      description: `Tool: ${tool.name}`,
      cli: tool.cli,
      requiredSecret: tool.requiredSecret,
    }));

    this.tools.set(employeeId, defs);
    logger.info(
      `[ToolRegistry] Registered ${defs.length} tool(s) for employee ${employeeId}: ${defs.map((d) => d.name).join(', ')}`
    );
  }

  /**
   * Get raw tool definitions for an employee.
   */
  getTools(employeeId: string): ToolDefinition[] {
    return this.tools.get(employeeId) ?? [];
  }

  /**
   * Resolve tools with injected secret environment variables.
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

  /**
   * Generate a Markdown section describing available tools for system prompt injection.
   * Returns an empty string if the employee has no registered tools.
   */
  generateToolPromptSection(employeeId: string): string {
    const tools = this.getTools(employeeId);
    if (tools.length === 0) return '';

    const toolDescriptions = tools
      .map((t) => `- **${t.name}**: Execute via \`${t.cli}\``)
      .join('\n');

    return [
      '',
      '',
      '## Available Tools',
      '',
      'You have access to the following tools:',
      toolDescriptions,
      '',
      'To use a tool, describe what you want to do and the system will execute it.',
    ].join('\n');
  }

  /**
   * Remove all registered tools for an employee (e.g., on delete).
   */
  unregister(employeeId: string): void {
    this.tools.delete(employeeId);
    logger.debug(`[ToolRegistry] Unregistered tools for employee ${employeeId}`);
  }

  /**
   * Check whether an employee has any registered tools.
   */
  hasTools(employeeId: string): boolean {
    const tools = this.tools.get(employeeId);
    return !!tools && tools.length > 0;
  }
}
