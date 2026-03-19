/**
 * Employee Manager (Unified)
 *
 * Discovers employees by scanning installed skill directories.
 * Employee = Skill + Persona metadata from manifest.json.
 *
 * Source of truth: skill directories on disk.
 *   - Built-in: resources/employees/ (shipped with app)
 *   - Marketplace: ~/.openclaw/skills/ (installed via ClawHub)
 *
 * No CRUD — hiring/firing is done via skill install/uninstall (ClawHub),
 * then scan() refreshes the in-memory employee list.
 */
import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { logger } from '../utils/logger';
import { getOpenClawSkillsDir, getEmployeeWorkspaceDir } from '../utils/paths';
import { readOpenClawConfig, writeOpenClawConfig } from '../utils/channel-config';
import { configUpdateQueue } from './config-update-queue';
import { ManifestParser } from './manifest-parser';
import { SkillCompiler } from './compiler';
import type { ToolRegistry } from './tool-registry';
import type { Employee, EmployeeStatus, EmployeeSource } from '@shared/types/employee';
import type { SkillManifest } from '@shared/types/manifest';

/**
 * EmployeeManager — scan-based discovery, activation, and status tracking.
 *
 * Events:
 *  - 'status' (id: string, status: EmployeeStatus) — emitted on status changes
 */
export class EmployeeManager extends EventEmitter {
  private employees: Map<string, Employee> = new Map();
  private parser: ManifestParser;
  private compiler: SkillCompiler;
  private toolRegistry: ToolRegistry | null = null;

  constructor() {
    super();
    this.parser = new ManifestParser();
    this.compiler = new SkillCompiler();
  }

  /** Set compiler (with ToolRegistry/MemoryEngine wired in from bootstrap) */
  setCompiler(compiler: SkillCompiler): void {
    this.compiler = compiler;
  }

  /** Set ToolRegistry for registering tools on employee activation */
  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
  }

  /**
   * Initialize — scan skill directories to discover employees
   */
  async init(): Promise<void> {
    logger.info('EmployeeManager initializing (scan-based)...');
    await this.scan();
    logger.info(`EmployeeManager initialized with ${this.employees.size} employee(s)`);
  }

  /**
   * Destroy — clean up listeners
   */
  async destroy(): Promise<void> {
    logger.info('EmployeeManager destroying...');
    this.employees.clear();
    this.removeAllListeners();
  }

  /**
   * Scan skill directories and rebuild the employee list.
   * Preserves runtime state (status, sessionKey) for already-known employees.
   */
  async scan(): Promise<Employee[]> {
    logger.info('Scanning skill directories for employees...');

    const discovered = new Map<string, Employee>();

    // Load onboarding state from persistent storage
    let onboardingState: Record<string, boolean> = {};
    try {
      const store = await this.getOnboardingStore();
      onboardingState = (store.get('onboarding-completed') ?? {}) as Record<string, boolean>;
    } catch {
      // Non-fatal
    }

    // 1. Scan built-in skills (resources/employees/)
    const builtinDir = this.getBuiltinDir();
    if (existsSync(builtinDir)) {
      this.scanDirectory(builtinDir, 'builtin', discovered, onboardingState);
    }

    // 2. Scan marketplace skills (~/.openclaw/skills/)
    const marketplaceDir = getOpenClawSkillsDir();
    if (existsSync(marketplaceDir)) {
      this.scanDirectory(marketplaceDir, 'marketplace', discovered, onboardingState);
    }

    // Merge: preserve runtime state from existing employees
    for (const [slug, newEmp] of discovered) {
      const existing = this.employees.get(slug);
      if (existing) {
        newEmp.status = existing.status;
        newEmp.gatewaySessionKey = existing.gatewaySessionKey;
        newEmp.systemPrompt = existing.systemPrompt;
        newEmp.secrets = existing.secrets;
      }
    }

    this.employees = discovered;
    logger.info(`Scan complete: ${discovered.size} employee(s) discovered`);
    return Array.from(discovered.values());
  }

  /**
   * List employees, optionally filtered by status
   */
  list(status?: EmployeeStatus): Employee[] {
    const all = Array.from(this.employees.values());
    if (status) {
      return all.filter((e) => e.status === status);
    }
    return all;
  }

  /**
   * Get a single employee by slug
   */
  get(id: string): Employee | undefined {
    return this.employees.get(id);
  }

  /**
   * Activate an employee — compile system prompt, generate session key
   */
  async activate(id: string): Promise<Employee> {
    const employee = this.requireEmployee(id);

    logger.info(`Activating employee: ${id} (${employee.role})`);

    // Re-parse manifest, register tools, then compile system prompt
    let manifest: SkillManifest;
    try {
      manifest = this.parser.parseFromPath(employee.skillDir);

      // Register tools from manifest so the compiler can append them to the system prompt
      if (this.toolRegistry) {
        this.toolRegistry.registerFromManifest(id, manifest);

        // Log built-in tool capabilities (e.g. browser automation)
        const builtinTools = this.toolRegistry.getBuiltinTools(id);
        if (builtinTools.length > 0) {
          logger.info(
            `Employee ${id} has built-in tools: ${builtinTools.join(', ')} — prompt sections will be injected`
          );
        }
      }

      employee.systemPrompt = this.compiler.compile(employee.skillDir, manifest, id);
    } catch (err) {
      throw new Error(`Failed to compile system prompt for ${id}: ${err}`, { cause: err });
    }

    // ── Native Multi-Agent: Create workspace + register agent in openclaw.json ──
    // The compiled system prompt is written as AGENTS.md in a per-employee workspace.
    // OpenClaw reads this file as the agent's system prompt — no extraSystemPrompt hack needed.
    this.ensureAgentWorkspace(employee);
    await this.registerAgentInConfig(employee, manifest);

    // Ensure skill is in Gateway's skills directory
    this.installSkillToGateway(employee);

    // Load per-employee secrets
    try {
      const secretsStore = await this.getSecretsStore();
      const secrets = (secretsStore.get(`employee-secrets.${id}`) ?? {}) as Record<string, string>;
      employee.secrets = secrets;
      logger.debug(`Loaded ${Object.keys(secrets).length} secret(s) for employee ${id}`);
    } catch (err) {
      logger.warn(`Failed to load secrets for employee ${id}: ${err}`);
    }

    // Push onboarding cookies to Camofox if available (non-blocking)
    await this.pushCamofoxCookies(employee);

    // Ensure employee memory directory exists
    try {
      const { MemoryEngine } = await import('./memory');
      const tmpEngine = new MemoryEngine();
      tmpEngine.ensureEmployeeDir(id);
    } catch (err) {
      logger.warn(`Failed to ensure memory directory for ${id}: ${err}`);
    }

    // Native multi-agent session key: agent:{slug}:main
    // This format routes to the per-employee OpenClaw agent workspace.
    // (Replaces old `agent:main:employee-{slug}` which required extraSystemPrompt injection)
    const sessionKey = `agent:${id}:main`;
    employee.gatewaySessionKey = sessionKey;
    this.setStatus(employee, 'idle');

    // Emit activated event for pending message delivery (Issue #7)
    this.emit('activated', id);

    logger.info(`Employee activated: ${id}, session=${sessionKey}`);
    return employee;
  }

  /**
   * Deactivate an employee — clear session, set offline
   */
  async deactivate(id: string): Promise<Employee> {
    const employee = this.requireEmployee(id);
    logger.info(`Deactivating employee: ${id} (${employee.role})`);

    employee.gatewaySessionKey = undefined;
    employee.systemPrompt = undefined;
    this.setStatus(employee, 'offline');

    // Update agentToAgent allow list (employee is now offline, so excluded)
    await this.syncAgentToAgentConfig();

    // Clear channel→agent bindings when supervisor goes offline so channel
    // messages are no longer routed to a non-existent agent.
    if (id === 'supervisor') {
      await this.clearChannelBindings();
    }

    logger.info(`Employee deactivated: ${id}`);
    return employee;
  }

  /**
   * Mark an employee's onboarding as completed (persisted)
   */
  async markOnboardingComplete(id: string): Promise<void> {
    const employee = this.requireEmployee(id);
    employee.onboardingCompleted = true;
    employee.updatedAt = Date.now();

    // Persist onboarding state
    try {
      const store = await this.getOnboardingStore();
      const state = (store.get('onboarding-completed') ?? {}) as Record<string, boolean>;
      state[id] = true;
      store.set('onboarding-completed', state);
    } catch (err) {
      logger.warn(`Failed to persist onboarding state for ${id}: ${err}`);
    }

    logger.info(`Onboarding completed for employee: ${id}`);
  }

  /**
   * Check if an employee's runtime.requires are all satisfied.
   * Returns { satisfied, missing[], requires[] }.
   */
  async checkRuntimeRequirements(id: string): Promise<{
    satisfied: boolean;
    missing: Array<{ name: string; status: string; message: string }>;
    requires: string[];
  }> {
    const employee = this.requireEmployee(id);
    const manifest = this.parser.parseFromPath(employee.skillDir);
    const requires = manifest.capabilities?.runtime?.requires ?? [];

    if (requires.length === 0) {
      return { satisfied: true, missing: [], requires };
    }

    const { getExtensionInstaller } = await import('./extension-installer');
    const installer = getExtensionInstaller();
    const results = await installer.checkAll(requires);

    const missing: Array<{ name: string; status: string; message: string }> = [];
    for (const [name, result] of results) {
      if (!result.ready) {
        missing.push({
          name,
          status: result.installed ? 'installed-not-ready' : 'not-installed',
          message: result.message,
        });
      }
    }

    return {
      satisfied: missing.length === 0,
      missing,
      requires,
    };
  }

  /**
   * Get the parsed manifest for an employee
   */
  getManifest(id: string): SkillManifest & { _skillDir: string } {
    const employee = this.requireEmployee(id);
    const manifest = this.parser.parseFromPath(employee.skillDir);
    return { ...manifest, _skillDir: employee.skillDir };
  }

  /**
   * Get the current status of an employee
   */
  getStatus(id: string): EmployeeStatus {
    const employee = this.employees.get(id);
    return employee?.status ?? 'offline';
  }

  /**
   * Return the built-in employees directory path (for IPC handlers)
   */
  getBuiltinDirPath(): string {
    return this.getBuiltinDir();
  }

  // ── Status transitions ──────────────────────────────────────────

  assignTask(id: string): void {
    const employee = this.requireEmployee(id);
    if (employee.status !== 'idle' && employee.status !== 'error') {
      logger.warn(
        `Cannot assign task to ${id}: status is '${employee.status}', expected 'idle' or 'error'`
      );
      return;
    }
    this.setStatus(employee, 'working');
  }

  /**
   * Recover an employee from error or working state back to idle.
   *
   * Fix H2: Previously only handled `error→idle`. Now also handles `working→idle`
   * so that `autoRecoverStuckTask()` can unstick employees that are still in
   * `working` state after their task is cancelled.
   */
  recover(id: string): void {
    const employee = this.requireEmployee(id);
    if (employee.status !== 'error' && employee.status !== 'working') {
      logger.warn(
        `Cannot recover ${id}: status is '${employee.status}', expected 'error' or 'working'`
      );
      return;
    }
    this.setStatus(employee, 'idle');
  }

  completeTask(id: string): void {
    const employee = this.requireEmployee(id);
    this.setStatus(employee, 'idle');
  }

  markBlocked(id: string): void {
    const employee = this.requireEmployee(id);
    this.setStatus(employee, 'blocked');
  }

  markError(id: string): void {
    const employee = this.requireEmployee(id);
    this.setStatus(employee, 'error');
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Scan a single directory for skill packages with valid manifest.json
   */
  private scanDirectory(
    dir: string,
    source: EmployeeSource,
    target: Map<string, Employee>,
    onboardingState: Record<string, boolean>
  ): void {
    let entries: string[];
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch (err) {
      logger.warn(`Failed to scan directory ${dir}: ${err}`);
      return;
    }

    for (const dirName of entries) {
      const skillDir = join(dir, dirName);
      const manifestPath = join(skillDir, 'manifest.json');

      if (!existsSync(manifestPath)) continue;

      try {
        const manifest = this.parser.parseFromPath(skillDir);
        const slug = manifest.name;

        // Skip if already discovered (builtin takes precedence over marketplace)
        if (target.has(slug)) continue;

        const now = Date.now();
        // Resolve lottie path: check manifest field, then fallback to avatar.lottie/.json in skill dir
        let lottieUrl: string | undefined;
        if (manifest.employee.lottie) {
          lottieUrl = join(skillDir, manifest.employee.lottie);
        } else {
          // Try .lottie first, then .json
          for (const ext of ['avatar.lottie', 'avatar.json']) {
            const candidate = join(skillDir, ext);
            if (existsSync(candidate)) {
              lottieUrl = candidate;
              break;
            }
          }
        }

        const employee: Employee = {
          id: slug,
          slug,
          skillDir,
          source,
          name: manifest.employee.roleZh || manifest.employee.role,
          role: manifest.employee.role,
          roleZh: manifest.employee.roleZh,
          avatar: manifest.employee.avatar,
          lottieUrl,
          team: manifest.employee.team,
          status: 'offline',
          config: {},
          hasOnboarding: !!manifest.onboarding,
          onboardingCompleted: onboardingState[slug] ?? false,
          createdAt: now,
          updatedAt: now,
        };

        target.set(slug, employee);
      } catch (err) {
        logger.debug(`Skipping ${dirName}: invalid manifest — ${err}`);
      }
    }
  }

  /**
   * Resolve the built-in employees directory.
   */
  private getBuiltinDir(): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, 'resources', 'employees');
    }
    return join(__dirname, '../../resources/employees');
  }

  /**
   * Copy skill into Gateway's managed skills directory (~/.openclaw/skills/)
   */
  private installSkillToGateway(employee: Employee): void {
    try {
      const skillsDir = getOpenClawSkillsDir();
      const destDir = join(skillsDir, employee.slug);

      if (!existsSync(skillsDir)) {
        mkdirSync(skillsDir, { recursive: true });
      }

      cpSync(employee.skillDir, destDir, { recursive: true, force: true });
      logger.info(`Installed skill "${employee.slug}" to Gateway skills: ${destDir}`);
    } catch (err) {
      logger.warn(`Failed to install skill to Gateway for ${employee.slug}: ${err}`);
    }
  }

  // ── Native Multi-Agent Workspace Management ─────────────────────

  /**
   * Create (or update) the agent workspace directory for an employee.
   * Writes the compiled system prompt as AGENTS.md — the file OpenClaw reads
   * as the agent's system prompt.
   */
  private ensureAgentWorkspace(employee: Employee): void {
    const workspaceDir = getEmployeeWorkspaceDir(employee.id);

    try {
      if (!existsSync(workspaceDir)) {
        mkdirSync(workspaceDir, { recursive: true });
        logger.info(`Created agent workspace: ${workspaceDir}`);
      }

      // Write compiled system prompt as AGENTS.md
      // OpenClaw reads this file as the agent's instructions/system prompt.
      const agentsMdPath = join(workspaceDir, 'AGENTS.md');
      const content = employee.systemPrompt ?? '';
      writeFileSync(agentsMdPath, content, 'utf-8');

      // Also write CLAUDE.md — some OpenClaw versions may check this file
      const claudeMdPath = join(workspaceDir, 'CLAUDE.md');
      writeFileSync(claudeMdPath, content, 'utf-8');

      // Overwrite SOUL.md with a language-aware version.
      // The default OpenClaw SOUL.md is all-English which causes the model
      // to default to English responses even when the user writes in Chinese.
      // OpenClaw gives SOUL.md special priority ("embody its persona and tone").
      const soulMdPath = join(workspaceDir, 'SOUL.md');
      const soulContent = [
        `# ${employee.name ?? employee.role}`,
        '',
        `你是 **${employee.roleZh ?? employee.role}**。`,
        '',
        '## 语言规则 / Language Rule',
        '',
        '**这是最高优先级规则：**',
        '- 用户用中文写 → 你必须全程用中文回复',
        '- User writes in English → respond entirely in English',
        '- 匹配用户每条消息的语言，不要混合语言',
        '',
        '## 风格',
        '',
        '- 直接、专业、不废话',
        '- 不要说"好的"、"当然可以"之类的客套话，直接做事',
        '- 有观点，有立场，不要当没有个性的机器人',
        '- 谨慎对待对外操作，大胆处理内部任务',
      ].join('\n');
      writeFileSync(soulMdPath, soulContent, 'utf-8');

      logger.info(
        `Wrote AGENTS.md for employee ${employee.id} (${content.length} chars) → ${agentsMdPath}`
      );
    } catch (err) {
      logger.error(`Failed to create agent workspace for ${employee.id}: ${err}`);
      throw new Error(`Failed to create agent workspace for ${employee.id}: ${err}`, {
        cause: err,
      });
    }
  }

  /**
   * Register (or update) an employee as an agent in openclaw.json.
   * Uses ConfigUpdateQueue to serialize concurrent writes.
   *
   * The agent entry tells OpenClaw Gateway where to find the workspace directory
   * and optionally which model and tools the agent should use.
   * Gateway hot-reloads the config within ~3s (verified by POC).
   */
  private async registerAgentInConfig(employee: Employee, manifest: SkillManifest): Promise<void> {
    await configUpdateQueue.enqueue(async () => {
      const config = readOpenClawConfig();

      // Ensure agents section exists
      if (!config.agents) {
        (config as Record<string, unknown>).agents = {};
      }
      const agents = (config as Record<string, unknown>).agents as Record<string, unknown>;
      if (!Array.isArray(agents.list)) {
        agents.list = [];
      }
      const agentsList = agents.list as Array<Record<string, unknown>>;

      // Build agent entry
      const workspaceDir = getEmployeeWorkspaceDir(employee.id);
      // Use forward slashes for cross-platform compatibility
      const normalizedWorkspace = workspaceDir.replace(/\\/g, '/');

      const agentEntry: Record<string, unknown> = {
        id: employee.id,
        name: `${employee.avatar ?? ''} ${employee.name}`.trim(),
        workspace: normalizedWorkspace,
      };

      // Map tool policy from manifest → agents.list[].tools
      const toolPolicy = this.mapToolPolicy(manifest);
      if (toolPolicy) {
        agentEntry.tools = toolPolicy;
      }

      // ── Supervisor-specific: enable sub-agent spawning ──
      // The supervisor agent needs `subagents.allowAgents` so it can use
      // the `sessions_spawn` tool to dispatch work to other employee agents.
      if (employee.id === 'supervisor') {
        agentEntry.subagents = {
          allowAgents: ['*'], // supervisor can spawn into any registered agent
        };
      }

      // Map per-employee model override → agents.list[].model
      try {
        const secretsStore = await this.getSecretsStore();
        const modelId = (secretsStore.get(`employee-models.${employee.id}`) ?? '') as string;
        if (modelId) {
          agentEntry.model = `openrouter/${modelId}`;
          logger.debug(
            `[registerAgentInConfig] Set model for ${employee.id}: openrouter/${modelId}`
          );
        }
      } catch (err) {
        logger.debug(`[registerAgentInConfig] Failed to look up model for ${employee.id}: ${err}`);
      }

      // Remove existing entry for this employee (if any), then add the new one
      agents.list = agentsList.filter((a) => a.id !== employee.id);
      (agents.list as Array<Record<string, unknown>>).push(agentEntry);

      // ── Global: ensure agents.defaults.subagents exists ──
      // This configures the sub-agent runtime (concurrency, timeout, archival).
      // Written on every registration but idempotent — values only set if missing.
      if (!agents.defaults) {
        agents.defaults = {};
      }
      const defaults = agents.defaults as Record<string, unknown>;
      if (!defaults.subagents) {
        defaults.subagents = {
          maxConcurrent: 8,
          archiveAfterMinutes: 60,
        };
        logger.debug('[registerAgentInConfig] Set agents.defaults.subagents');
      }

      // ── Global: enable agent-to-agent communication ──
      // OpenClaw's `tools.agentToAgent` allows agents to use `sessions_send`
      // to communicate directly with each other via the Gateway.
      // The `allow` list is rebuilt on every activation to stay in sync.
      if (!(config as Record<string, unknown>).tools) {
        (config as Record<string, unknown>).tools = {};
      }
      const tools = (config as Record<string, unknown>).tools as Record<string, unknown>;

      // Build allow list: all currently non-offline employees + the one being activated
      const activeIds = this.list()
        .filter((e) => e.status !== 'offline')
        .map((e) => e.id);
      if (!activeIds.includes(employee.id)) {
        activeIds.push(employee.id);
      }

      tools.agentToAgent = {
        enabled: true,
        allow: activeIds,
      };
      logger.debug(
        `[registerAgentInConfig] Updated tools.agentToAgent allow: [${activeIds.join(', ')}]`
      );

      // ── Supervisor-specific: bind configured channels to supervisor ──
      // OpenClaw uses `bindings` to route channel messages to specific agents.
      // Without bindings, Feishu (and other channel) messages go to the default
      // agent instead of the supervisor, so the supervisor never receives them.
      if (employee.id === 'supervisor') {
        this.writeChannelBindings(config, employee.id);
      }

      writeOpenClawConfig(config);
      logger.info(
        `Registered agent "${employee.id}" in openclaw.json (workspace: ${normalizedWorkspace})`
      );
    });
  }

  // ── Channel → Agent Bindings ─────────────────────────────────────

  /**
   * Write `bindings` array into an openclaw.json config object.
   * Routes all configured (enabled) channels to the given agent.
   *
   * OpenClaw `bindings` format:
   * ```json
   * { "bindings": [{ "agentId": "supervisor", "match": { "channel": "feishu" } }] }
   * ```
   *
   * Without bindings, channel messages go to the default agent — NOT the supervisor.
   * This is the root cause of "Feishu messages not reaching the supervisor".
   */
  private writeChannelBindings(config: Record<string, unknown>, agentId: string): void {
    // Read configured channels
    const channels = (config.channels ?? {}) as Record<string, { enabled?: boolean } | undefined>;

    const enabledChannels = Object.entries(channels)
      .filter(([, cfg]) => cfg?.enabled !== false)
      .map(([name]) => name);

    if (enabledChannels.length === 0) {
      logger.debug('[writeChannelBindings] No enabled channels — skipping bindings');
      return;
    }

    // Build bindings: one entry per enabled channel → supervisor
    const bindings = enabledChannels.map((channel) => ({
      agentId,
      match: { channel },
    }));

    config.bindings = bindings;
    logger.info(
      `[writeChannelBindings] Bound ${enabledChannels.length} channel(s) to "${agentId}": ${enabledChannels.join(', ')}`
    );
  }

  /**
   * Public helper: sync channel bindings for the supervisor.
   * Call this when a channel is saved/enabled AFTER the supervisor is already active,
   * so the new channel is immediately routed to the supervisor.
   * If the supervisor is offline, clears existing bindings to prevent routing to a dead agent.
   */
  async syncChannelBindings(): Promise<void> {
    const supervisor = this.employees.get('supervisor');
    if (!supervisor || supervisor.status === 'offline') {
      // Supervisor is offline — clear stale bindings so channel messages
      // are not routed to a non-existent agent.
      await this.clearChannelBindings();
      return;
    }

    await configUpdateQueue.enqueue(async () => {
      const config = readOpenClawConfig();
      this.writeChannelBindings(config as Record<string, unknown>, 'supervisor');
      writeOpenClawConfig(config);
      logger.info('[syncChannelBindings] Channel bindings synced for supervisor');
    });
  }

  /**
   * Remove all channel→agent bindings from openclaw.json.
   * Called when the supervisor is deactivated so channel messages
   * fall back to the default agent rather than routing to an offline one.
   */
  private async clearChannelBindings(): Promise<void> {
    await configUpdateQueue.enqueue(async () => {
      const config = readOpenClawConfig() as Record<string, unknown>;
      if (!config.bindings) {
        logger.debug('[clearChannelBindings] No bindings to clear');
        return;
      }
      delete config.bindings;
      writeOpenClawConfig(config);
      logger.info('[clearChannelBindings] Cleared channel bindings (supervisor offline)');
    });
  }

  /**
   * Map manifest tool declarations to OpenClaw agent-level tool policy.
   * Returns `{ allow: [...] }` for the agent entry, or null if no tools to map.
   *
   * OpenClaw supports engine-level tool allow/deny lists per agent.
   * This is a stronger enforcement than prompt-level tool descriptions —
   * the agent physically cannot use tools outside its allow list.
   *
   * Only well-known OpenClaw built-in tool names are mapped here.
   * Custom CLI tools are still handled via prompt injection by the compiler.
   */
  private mapToolPolicy(manifest: SkillManifest): { allow: string[] } | null {
    if (!manifest.tools || manifest.tools.length === 0) {
      return null;
    }

    // OpenClaw Gateway built-in tool names (extracted from openclaw control-ui source).
    // Only tools in this set are written to agents.list[].tools.allow in openclaw.json.
    // Any tool name in manifest.tools[] that matches this set is passed through;
    // custom/unknown names are ignored (they may be prompt-only tool descriptions).
    const OPENCLAW_BUILTIN_TOOLS = new Set([
      // Core filesystem & shell
      'bash',
      'read',
      'write',
      'edit',
      'attach',
      // Browser & web
      'browser',
      'web_search',
      'web_fetch',
      // Process & scheduling
      'process',
      'cron',
      // Agent-to-agent (multi-agent orchestration)
      'sessions_spawn',
      'sessions_send',
      'sessions_list',
      'sessions_history',
      'session_status',
      // MCP tool proxy
      'mcp',
      // UI & device
      'canvas',
      'nodes',
      // Gateway control
      'gateway',
    ]);

    const allow: string[] = [];
    for (const tool of manifest.tools) {
      if (OPENCLAW_BUILTIN_TOOLS.has(tool.name)) {
        allow.push(tool.name);
      }
    }

    return allow.length > 0 ? { allow } : null;
  }

  /**
   * Push onboarding cookies to Camofox (non-blocking)
   */
  private async pushCamofoxCookies(employee: Employee): Promise<void> {
    try {
      const secretsStore = await this.getSecretsStore();
      const onboardingData = secretsStore.get(`onboarding-data.${employee.slug}`) as
        | { cookies?: unknown[]; config?: Record<string, unknown> }
        | undefined;

      if (!onboardingData?.cookies?.length) return;

      const camofoxCfg = (onboardingData.config as Record<string, unknown>)?.camofox as
        | { port?: number; apiKey?: string }
        | undefined;
      const userId =
        ((onboardingData.config as Record<string, unknown>)?.account as Record<string, unknown>)
          ?.camofoxUserId ?? `reddit-${employee.slug.slice(0, 8)}`;

      const { CamofoxClient } = await import('./camofox-client');
      const client = new CamofoxClient({
        port: camofoxCfg?.port ?? 9377,
        apiKey: camofoxCfg?.apiKey ?? 'pocketai',
      });

      const healthy = await client.health();
      if (healthy) {
        await client.pushCookies(String(userId), onboardingData.cookies);
        logger.info(
          `Pushed ${onboardingData.cookies.length} cookies to Camofox for ${employee.slug}`
        );
      }
    } catch (err) {
      logger.warn(`Failed to push onboarding cookies for ${employee.slug}: ${err}`);
    }
  }

  private requireEmployee(id: string): Employee {
    const employee = this.employees.get(id);
    if (!employee) {
      throw new Error(`Employee not found: ${id}`);
    }
    return employee;
  }

  /**
   * Sync `tools.agentToAgent` in openclaw.json with current active employees.
   * Called on deactivation to remove the employee from the allow list.
   * On activation this is handled inline within `registerAgentInConfig`.
   */
  private async syncAgentToAgentConfig(): Promise<void> {
    await configUpdateQueue.enqueue(async () => {
      const config = readOpenClawConfig();

      if (!(config as Record<string, unknown>).tools) {
        (config as Record<string, unknown>).tools = {};
      }
      const tools = (config as Record<string, unknown>).tools as Record<string, unknown>;

      const activeIds = this.list()
        .filter((e) => e.status !== 'offline')
        .map((e) => e.id);

      tools.agentToAgent = {
        enabled: activeIds.length > 0,
        allow: activeIds,
      };

      writeOpenClawConfig(config);
      logger.debug(
        `[syncAgentToAgentConfig] Updated tools.agentToAgent allow: [${activeIds.join(', ')}]`
      );
    });
  }

  private setStatus(employee: Employee, status: EmployeeStatus): void {
    const previous = employee.status;
    employee.status = status;
    employee.updatedAt = Date.now();
    if (previous !== status) {
      logger.debug(`Employee ${employee.slug} status: ${previous} -> ${status}`);
      this.emit('status', employee.slug, status);
    }
  }

  // ── Lazy-loaded electron-store instances ─────────────────────────

  private async getSecretsStore() {
    const { getStore } = await import('../utils/store-factory');
    return getStore('employee-secrets');
  }

  private async getOnboardingStore() {
    const { getStore } = await import('../utils/store-factory');
    return getStore('employee-onboarding');
  }
}
