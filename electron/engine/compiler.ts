/**
 * Skill Compiler
 * Compiles SKILL.md templates into system prompts for Gateway sessions
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger';
import type { SkillManifest } from '@shared/types/manifest';
import type { ToolRegistry } from './tool-registry';
import type { MemoryEngine } from './memory';
import type { ProhibitionEngine } from './prohibition';
import type { EmployeeManager } from './employee-manager';

/**
 * SkillCompiler — reads SKILL.md and replaces template variables to produce system prompts
 */
export class SkillCompiler {
  /**
   * Prepended to every compiled system prompt to enforce response language matching.
   * Must be at the very top because OpenClaw injects AGENTS.md into a massive English
   * system prompt (SOUL.md, IDENTITY.md, base prompt are all English).
   * If buried at the end, the model ignores it.
   */
  static readonly LANG_RULE_PREFIX =
    '## CRITICAL: Response Language Rule\n' +
    'You MUST respond in the SAME language the user uses.\n' +
    '- 用户用中文 → 你必须用中文回复\n' +
    '- User writes English → respond in English\n' +
    '- ユーザーが日本語で書いた場合 → 日本語で返信してください\n' +
    '- This rule overrides all other language defaults.\n\n';

  private toolRegistry: ToolRegistry | null = null;
  private memoryEngine: MemoryEngine | null = null;
  private prohibitionEngine: ProhibitionEngine | null = null;
  private employeeManager: EmployeeManager | null = null;
  /** Returns the work loop prompt fragment; set via setSupervisorWorkLoopProvider() */
  private workLoopPromptProvider: (() => string) | null = null;
  /** Employee slug(s) that should NOT receive the work loop prompt (e.g. the supervisor itself) */
  private workLoopExcludeIds = new Set<string>();

  /**
   * Set the ToolRegistry instance for tool prompt injection.
   * Called during bootstrap after both compiler and registry are created.
   */
  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
  }

  /**
   * Set the MemoryEngine instance for episodic memory injection.
   * Called during bootstrap after both compiler and memory engine are created.
   */
  setMemoryEngine(engine: MemoryEngine): void {
    this.memoryEngine = engine;
  }

  /**
   * Set the ProhibitionEngine instance for rules injection.
   * Called during bootstrap after both compiler and prohibition engine are created.
   */
  setProhibitionEngine(engine: ProhibitionEngine): void {
    this.prohibitionEngine = engine;
  }

  /**
   * Set the EmployeeManager instance for team roster injection.
   * Used by the Supervisor skill to populate {{TEAM_ROSTER}} dynamically.
   */
  setEmployeeManager(manager: EmployeeManager): void {
    this.employeeManager = manager;
  }

  /**
   * Set the work loop prompt provider — a function that returns the work loop
   * instructions fragment to append to non-supervisor employee system prompts.
   *
   * Using a function reference (instead of importing SupervisorEngine directly)
   * avoids circular dependencies between compiler ↔ supervisor.
   *
   * @param provider Function that returns the work loop prompt string
   * @param excludeIds Employee slugs that should NOT receive the prompt (e.g. 'supervisor')
   */
  setSupervisorWorkLoopProvider(provider: () => string, excludeIds: string[] = []): void {
    this.workLoopPromptProvider = provider;
    this.workLoopExcludeIds = new Set(excludeIds);
  }

  /**
   * Compile a skill directory's SKILL.md into a system prompt
   * Template variables: {{ROLE}}, {{ROLE_ZH}}, {{TEAM}}, {{PERSONALITY_STYLE}}, {{SKILL_DIR}}
   *
   * If a ToolRegistry is configured and the employee has registered tools,
   * the tool prompt section is appended to the system prompt.
   *
   * @param skillDir Absolute path to the skill package directory
   * @param manifest Parsed SkillManifest for template variable substitution
   * @param employeeId Optional employee ID for tool prompt injection
   * @returns Compiled system prompt string
   */
  compile(skillDir: string, manifest: SkillManifest, employeeId?: string): string {
    const skillMdPath = join(skillDir, 'SKILL.md');

    let template: string;

    if (existsSync(skillMdPath)) {
      logger.debug(`Reading SKILL.md from: ${skillMdPath}`);
      try {
        template = readFileSync(skillMdPath, 'utf-8');
      } catch (err) {
        logger.warn(`Failed to read SKILL.md at ${skillMdPath}, generating from manifest: ${err}`);
        template = this.generateFromManifest(manifest);
      }
    } else {
      logger.info(`SKILL.md not found at ${skillMdPath}, generating from manifest metadata`);
      template = this.generateFromManifest(manifest);
    }

    let systemPrompt = this.replaceVariables(template, manifest, skillDir);

    // Prepend critical language instruction (see LANG_RULE_PREFIX JSDoc for rationale)
    systemPrompt = SkillCompiler.LANG_RULE_PREFIX + systemPrompt;

    // Append tool prompt section if the employee has registered tools
    if (employeeId && this.toolRegistry) {
      const toolSection = this.toolRegistry.generateToolPromptSection(employeeId);
      if (toolSection) {
        systemPrompt += toolSection;
        logger.debug(
          `Appended tool prompt section for employee ${employeeId} (${toolSection.length} chars)`
        );
      }
    }

    // Append episodic memory section if available
    if (employeeId && this.memoryEngine) {
      const memorySection = this.memoryEngine.generateEpisodicPromptSection(employeeId);
      if (memorySection) {
        systemPrompt += memorySection;
        logger.debug(
          `Appended episodic memory section for employee ${employeeId} (${memorySection.length} chars)`
        );
      }
    }

    // Append business context section from semantic memories
    if (this.memoryEngine) {
      const businessContextSection = this.memoryEngine.generateBusinessContextSection();
      if (businessContextSection) {
        systemPrompt += businessContextSection;
        logger.debug(`Appended business context section (${businessContextSection.length} chars)`);
      }
    }

    // Append prohibition rules section
    if (this.prohibitionEngine) {
      const prohibitionSection =
        this.prohibitionEngine.generateProhibitionPromptSection(employeeId);
      if (prohibitionSection) {
        systemPrompt += prohibitionSection;
        logger.debug(
          `Appended prohibition rules section for employee ${employeeId ?? 'global'} (${prohibitionSection.length} chars)`
        );
      }
    }

    // Language instruction is already prepended via LANG_RULE_PREFIX (top of prompt).
    // No need for a duplicate ## Language section here.

    // Append work loop prompt for non-supervisor employees (P0 fix)
    if (employeeId && this.workLoopPromptProvider && !this.workLoopExcludeIds.has(employeeId)) {
      try {
        const workLoopSection = this.workLoopPromptProvider();
        if (workLoopSection) {
          systemPrompt += '\n\n' + workLoopSection;
          logger.debug(
            `Appended work loop prompt for employee ${employeeId} (${workLoopSection.length} chars)`
          );
        }
      } catch (err) {
        logger.warn(`Failed to get work loop prompt for ${employeeId}: ${err}`);
      }
    }

    logger.debug(`Compiled system prompt for ${manifest.name} (${systemPrompt.length} chars)`);
    return systemPrompt;
  }

  /**
   * Replace template variables in the template string
   */
  private replaceVariables(template: string, manifest: SkillManifest, skillDir?: string): string {
    const { employee } = manifest;
    let result = template
      .replace(/\{\{ROLE\}\}/g, employee.role)
      .replace(/\{\{ROLE_ZH\}\}/g, employee.roleZh)
      .replace(/\{\{TEAM\}\}/g, employee.team)
      .replace(/\{\{PERSONALITY_STYLE\}\}/g, employee.personality.style);

    // Replace {{SKILL_DIR}} with the absolute path to the skill directory
    // Use forward slashes for cross-platform compatibility in shell commands
    if (skillDir && result.includes('{{SKILL_DIR}}')) {
      const normalizedDir = skillDir.replace(/\\/g, '/');
      result = result.replace(/\{\{SKILL_DIR\}\}/g, normalizedDir);
    }

    // Replace {{TEAM_ROSTER}} with dynamic employee list (used by Supervisor)
    if (result.includes('{{TEAM_ROSTER}}')) {
      result = result.replace(/\{\{TEAM_ROSTER\}\}/g, this.buildTeamRoster(manifest.name));
    }

    return result;
  }

  /**
   * Build a team roster string listing all available employees (excluding the caller).
   */
  private buildTeamRoster(selfSlug: string): string {
    if (!this.employeeManager) {
      return '(No team roster available — EmployeeManager not configured)';
    }

    const employees = this.employeeManager.list().filter((e) => e.id !== selfSlug);

    if (employees.length === 0) {
      return '(No employees available for delegation)';
    }

    return employees
      .map(
        (e) => `- **${e.role}** (${e.roleZh}): slug=\`${e.id}\`, team=${e.team}, status=${e.status}`
      )
      .join('\n');
  }

  /**
   * Generate a basic system prompt from manifest metadata when SKILL.md is missing
   */
  private generateFromManifest(manifest: SkillManifest): string {
    const { employee, skills, description } = manifest;
    const skillNames = skills.map((s) => s.name).join(', ');

    return [
      `You are ${employee.role} (${employee.roleZh}), a member of the ${employee.team} team.`,
      ``,
      `## About`,
      description,
      ``,
      `## Personality`,
      `Your working style is: ${employee.personality.style}`,
      ``,
      `## Skills`,
      `You are proficient in: ${skillNames}`,
      ``,
      `## Instructions`,
      `Respond professionally according to your role and expertise.`,
      `When given a task, apply your skills methodically and provide actionable results.`,
    ].join('\n');
  }
}
